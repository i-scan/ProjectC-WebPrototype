import { HEX_DIRECTIONS, axialDistance, axialToWorld } from './hex.js'
import {
  REFLECTION_CONTINUATION_RULE,
  SURFACE_GEOMETRY_RULE,
  firstSurfaceImpact,
  mirrorStepOptions,
  nudgeFromSurfaceVector,
} from './surface-geometry.js'
import { WALL_CELL_TRAVEL_RULE, internalWallCellImpact } from './wall-cell-reflection.js'

export const CELL_MOTION_TRACE_RULE = 'cell-motion-trace-v1'
export const CELL_TRAVEL_BUDGET_RULE = 'authoritative-cell-travel-budget-v1'
export const CELL_ENTRY_RULE = 'single-cell-entry-resolution-v1'

const cloneHex = (hex) => ({ q: hex.q, r: hex.r })
const clonePoint = (point) => ({ x: point.x, z: point.z })
const sameHex = (a, b) => Boolean(a && b && a.q === b.q && a.r === b.r)
const clampM = (value) => Math.max(0, Math.min(3, Math.round(Number(value) || 0)))

export function cellStep(cell, directionId) {
  const direction = HEX_DIRECTIONS.find((entry) => entry.id === directionId)
  return direction ? { q: cell.q + direction.q, r: cell.r + direction.r } : cloneHex(cell)
}

export function directionIdBetween(from, to) {
  const dq = to.q - from.q
  const dr = to.r - from.r
  return HEX_DIRECTIONS.find((entry) => entry.q === dq && entry.r === dr)?.id ?? null
}

function obstacleAt(obstacles, hex) {
  return obstacles.find((entry) => sameHex(entry.hex, hex)) ?? null
}

function defaultReflectionMomentum({ momentum }) {
  return { momentum: Math.max(0, clampM(momentum) - 1), restitution: null }
}

function normalizeReflectionResult(result, beforeM) {
  if (typeof result === 'number') return { momentum: clampM(result), restitution: null }
  return {
    momentum: clampM(result?.momentum ?? Math.max(0, beforeM - 1)),
    restitution: Number.isFinite(result?.restitution) ? result.restitution : null,
  }
}

function bestMirrorOptions(incomingAxisId, impact, current) {
  const options = mirrorStepOptions(incomingAxisId, impact, current)
  const seenFaces = new Set()
  return options.filter((option) => {
    if (seenFaces.has(option.faceIndex)) return false
    seenFaces.add(option.faceIndex)
    return true
  })
}

function geometryAllowsCell(cell, obstacles, boardRadius) {
  if (axialDistance(cell) > boardRadius) return false
  if (obstacleAt(obstacles, cell)) return false
  return true
}

function chooseMirror(current, impact, incomingAxisId, previousCell, obstacles, boardRadius) {
  if (impact?.wallCellPivot) {
    const cell = cloneHex(impact.exitHex)
    if (!geometryAllowsCell(cell, obstacles, boardRadius)) return null
    return {
      direction: impact.direction,
      reflected: { ...impact.reflected },
      normal: { ...impact.normal },
      faceIndex: 0,
      ambiguousVertex: false,
      cell,
      wallCellPivot: true,
      travelCost: impact.wallCellTravelCost ?? 1,
      reflectionContinuation: WALL_CELL_TRAVEL_RULE,
    }
  }

  const options = bestMirrorOptions(incomingAxisId, impact, current)
    .map((option) => ({ ...option, cell: cellStep(current, option.direction.id) }))
    .filter((option) => geometryAllowsCell(option.cell, obstacles, boardRadius))
  if (!options.length) return null

  if (impact.surface === 'obstacle' && impact.candidateNormals?.length > 1 && previousCell) {
    const nonRetrace = options.find((option) => !sameHex(option.cell, previousCell))
    if (nonRetrace) return nonRetrace
  }
  return options[0]
}

function collisionRecord({ impact, obstacle, attempted, current, axisBefore, axisAfter, beforeM, afterM, mirror, spentBefore, budget, restitution }) {
  const wallCellPivot = Boolean(impact.wallCellPivot)
  const contactCell = wallCellPivot ? attempted : current
  const boundary = impact.surface === 'boundary'
  return {
    t: spentBefore / Math.max(1, budget),
    kind: boundary ? 'boundary' : obstacle?.kind ?? 'hard',
    geometryKind: impact.kind,
    obstacleId: obstacle?.id ?? null,
    from: cloneHex(current),
    position: clonePoint(impact.point),
    contactCell: cloneHex(contactCell),
    cell: cloneHex(contactCell),
    attemptedCell: cloneHex(attempted),
    reflectedCell: mirror?.cell ? cloneHex(mirror.cell) : null,
    axisBefore,
    axisAfter,
    beforeM,
    afterM,
    reflection: Boolean(mirror?.direction),
    normal: clonePoint(mirror?.normal ?? impact.normal),
    reflectedVector: mirror?.reflected ? clonePoint(mirror.reflected) : null,
    faceIds: [...(impact.faceIds ?? [])],
    surfaceGeometry: SURFACE_GEOMETRY_RULE,
    reflectionContinuation: wallCellPivot ? WALL_CELL_TRAVEL_RULE : REFLECTION_CONTINUATION_RULE,
    wallCellPivot,
    wallCellTravelCost: wallCellPivot ? (impact.wallCellTravelCost ?? 1) : 0,
    wallAxis: impact.wallAxis ?? null,
    restitution,
    ambiguousVertexBranch: Boolean(mirror?.ambiguousVertex),
    motionTraceRule: CELL_MOTION_TRACE_RULE,
    travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
  }
}

export function runCellMotion({
  startHex,
  initialAxisId,
  initialMomentum = 0,
  travelBudget = 0,
  authoredPathCells = [],
  obstacles = [],
  boardRadius = 7,
  reflectionMomentum = defaultReflectionMomentum,
  capRemainingByMomentum = false,
  onEnterCell = null,
  maxEvents = 64,
}) {
  const budget = Math.max(0, Math.round(Number(travelBudget) || 0))
  let current = cloneHex(startHex)
  let axisId = initialAxisId ?? directionIdBetween(startHex, authoredPathCells[0] ?? startHex)
  let momentum = clampM(initialMomentum)
  let remainingTravel = budget
  let spentTravel = 0
  let authoredIndex = 0
  let reflected = false
  let previousCell = null
  let segmentStart = axialToWorld(current)
  let guard = 0
  let stopped = false
  let stopReason = null

  const trace = []
  const collisions = []
  const timeline = [{ position: clonePoint(segmentStart), axisId, kind: 'start' }]
  const actualPath = []

  const appendTrace = (event) => {
    trace.push({ index: trace.length, motionTraceRule: CELL_MOTION_TRACE_RULE, travelBudgetRule: CELL_TRAVEL_BUDGET_RULE, ...event })
  }

  const applyEntry = ({ to, cost, entryKind, context }) => {
    const remainingBefore = remainingTravel
    const momentumBefore = momentum
    const eventMomentumBefore = clampM(context?.momentumBefore ?? momentumBefore)
    const from = cloneHex(current)
    const result = onEnterCell
      ? (onEnterCell({
          from: cloneHex(from), to: cloneHex(to), cost, axisId, momentum,
          remainingTravel, spentTravel, reflected, entryKind, context,
        }) ?? {})
      : { allowed: true }

    if (Number.isFinite(result.momentum)) momentum = clampM(result.momentum)
    const allowed = result.allowed !== false
    const consume = Math.max(0, Math.min(remainingTravel, Math.round(Number(cost) || 0)))
    remainingTravel -= consume
    spentTravel += consume
    const momentumChanged = momentum !== eventMomentumBefore
    if (capRemainingByMomentum && momentumChanged) remainingTravel = Math.min(remainingTravel, momentum)

    if (allowed) {
      previousCell = from
      current = cloneHex(to)
      segmentStart = axialToWorld(current)
      actualPath.push(cloneHex(current))
      timeline.push({ position: clonePoint(segmentStart), axisId, kind: entryKind })
    }

    appendTrace({
      kind: allowed ? entryKind : 'blocked-entry',
      from,
      to: cloneHex(to),
      cost: consume,
      axisBefore: context?.axisBefore ?? axisId,
      axisAfter: axisId,
      momentumBefore: eventMomentumBefore,
      momentumAfter: momentum,
      remainingBefore,
      remainingAfter: remainingTravel,
      allowed,
      stop: Boolean(result.stop || !allowed),
      events: [...(result.events ?? [])],
      context: context ?? null,
    })

    if (result.stop || !allowed) {
      stopped = true
      stopReason = result.reason ?? (allowed ? 'entry-stop' : 'blocked-entry')
    }
    return { allowed, result }
  }

  while (!stopped && remainingTravel > 0 && guard < maxEvents) {
    guard += 1
    const authoredCell = authoredPathCells[Math.min(authoredIndex, Math.max(0, authoredPathCells.length - 1))]
    const authoredAxisId = reflected ? null : directionIdBetween(current, authoredCell ?? current)
    const stepAxisId = reflected ? axisId : (authoredAxisId ?? axisId)
    if (!stepAxisId) {
      stopped = true
      stopReason = 'missing-axis'
      break
    }
    axisId = stepAxisId

    const attempted = cellStep(current, stepAxisId)
    const attemptedWorld = axialToWorld(attempted)
    const obstacle = obstacleAt(obstacles, attempted)
    const wallImpact = obstacle ? internalWallCellImpact({ obstacle, incomingAxisId: stepAxisId }) : null
    const impact = wallImpact ?? firstSurfaceImpact({ fromWorld: segmentStart, toWorld: attemptedWorld, boardRadius, obstacle })

    if (!impact) {
      const entry = applyEntry({
        to: attempted,
        cost: 1,
        entryKind: 'cell-step',
        context: { attemptedCell: cloneHex(attempted), axisBefore: stepAxisId, momentumBefore: momentum },
      })
      if (entry.allowed && !reflected) authoredIndex += 1
      continue
    }

    const beforeM = momentum
    const reflectionResult = normalizeReflectionResult(
      reflectionMomentum({ momentum, obstacle, boundary: impact.surface === 'boundary', impact, axisId: stepAxisId }),
      beforeM,
    )
    const mirror = chooseMirror(current, impact, stepAxisId, previousCell, obstacles, boardRadius)
    const axisAfter = mirror?.direction?.id ?? stepAxisId
    const collision = collisionRecord({
      impact, obstacle, attempted, current, axisBefore: stepAxisId, axisAfter,
      beforeM, afterM: reflectionResult.momentum, mirror, spentBefore: spentTravel,
      budget, restitution: reflectionResult.restitution,
    })
    collisions.push(collision)
    timeline.push({ position: clonePoint(impact.point), axisId: axisAfter, kind: 'surface-contact', collision: true })

    if (!mirror?.direction) {
      const wallCost = impact.wallCellPivot ? (impact.wallCellTravelCost ?? 1) : 0
      const remainingBefore = remainingTravel
      const consume = Math.min(remainingTravel, wallCost)
      remainingTravel -= consume
      spentTravel += consume
      appendTrace({
        kind: 'surface-stop', from: cloneHex(current), attemptedCell: cloneHex(attempted),
        pivotCell: impact.wallCellPivot ? cloneHex(attempted) : null, to: cloneHex(current),
        cost: consume, axisBefore: stepAxisId, axisAfter: stepAxisId,
        momentumBefore: beforeM, momentumAfter: 0,
        remainingBefore, remainingAfter: remainingTravel, collision,
      })
      momentum = 0
      stopped = true
      stopReason = 'surface-stop'
      timeline.push({ position: clonePoint(axialToWorld(current)), axisId, kind: 'surface-stop-return' })
      break
    }

    reflected = true
    axisId = axisAfter
    momentum = reflectionResult.momentum
    timeline.push({ position: nudgeFromSurfaceVector(impact.point, mirror.reflected), axisId, kind: 'reflection-guide', reflectionGuide: true })

    if (impact.wallCellPivot) {
      const exitCell = cloneHex(mirror.cell)
      const entry = applyEntry({
        to: exitCell,
        cost: impact.wallCellTravelCost ?? 1,
        entryKind: 'wall-cell-step',
        context: {
          collision, pivotCell: cloneHex(attempted), attemptedCell: cloneHex(attempted),
          axisBefore: stepAxisId, momentumBefore: beforeM, reflectedMomentum: momentum,
          wallCellPivot: true, wallCellTravelCost: impact.wallCellTravelCost ?? 1,
        },
      })
      if (!entry.allowed) timeline.push({ position: clonePoint(axialToWorld(current)), axisId, kind: 'blocked-return' })
      if (momentum <= 0) {
        stopped = true
        stopReason = stopReason ?? 'momentum-zero'
      }
      continue
    }

    const remainingBefore = remainingTravel
    if (capRemainingByMomentum) remainingTravel = Math.min(remainingTravel, momentum)
    appendTrace({
      kind: 'boundary-reflection', from: cloneHex(current), attemptedCell: cloneHex(attempted), to: cloneHex(current),
      cost: 0, axisBefore: stepAxisId, axisAfter: axisId,
      momentumBefore: beforeM, momentumAfter: momentum,
      remainingBefore, remainingAfter: remainingTravel, collision,
    })
    segmentStart = nudgeFromSurfaceVector(impact.point, mirror.reflected)
    if (momentum <= 0) {
      stopped = true
      stopReason = 'momentum-zero'
    }
  }

  if (guard >= maxEvents && !stopped) {
    stopped = true
    stopReason = 'guard-limit'
  }

  const firstCollisionCell = collisions[0]?.contactCell ? cloneHex(collisions[0].contactCell) : null
  return {
    rule: CELL_MOTION_TRACE_RULE,
    travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
    entryRule: CELL_ENTRY_RULE,
    startHex: cloneHex(startHex),
    finalHex: cloneHex(current),
    inputHex: firstCollisionCell,
    axisAfter: axisId,
    momentumAfter: momentum,
    travelBudget: budget,
    spentTravel,
    remainingTravel,
    reflected,
    reflectionCount: collisions.filter((entry) => entry.reflection).length,
    stopped,
    stopReason,
    trace,
    collisions,
    timeline,
    actualPath,
    reflectionContinuation: collisions.some((entry) => entry.wallCellPivot) ? WALL_CELL_TRAVEL_RULE : REFLECTION_CONTINUATION_RULE,
  }
}
