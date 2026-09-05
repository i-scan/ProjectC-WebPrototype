import { HEX_DIRECTIONS, axialDistance, axialToWorld, directionIdBetween, directionVector, worldToAxial, worldToAxialFraction } from '../../sim/hex.js'
import { runCellMotion } from '../../sim/cell-motion.js'
import { createConflictActors, resolveCellConflicts } from '../../sim/conflict.js'

export const TRAJECTORY_RULE = 'val-012-process-steering-ab-v1-candidate'
export const TRAJECTORY_READY_RULE = 'action-complete-ready-v1'
export const TRAJECTORY_STEERING_RULE = 'max-60deg-per-action-v1'
export const TRAJECTORY_DISSIPATION_RULE = 'persistent-start-m-minus-1-v1'
export const TRAJECTORY_CELL_AUTHORITY_RULE = 'ready-cell-center-v1'
export const TRAJECTORY_PATH_RULE = 'canonical-turn-timing-path-v3'
export const TRAJECTORY_PREVIEW_RULE = 'global-tangent-bezier-preview-v4'
export const TRAJECTORY_REFLECTION_RULE = 'driving-lab-wall-pivot-reflection-v1'
export const TRAJECTORY_COAST_REFLECTION_INTENT_RULE = 'coast-reflection-path-selectable-intent-v1'
export const TRAJECTORY_TARGET_RULE = 'trajectory-target-contact-existing-strike-v1'
export const TRAJECTORY_MIN_RADIUS = 4
export const TRAJECTORY_MAX_RADIUS = 10
export const TRAJECTORY_DEFAULT_RADIUS = 6
export const TRAJECTORY_MAX_STEER_DEG = 60
export const TRAJECTORY_BASE_DISSIPATION = 1
export const TRAJECTORY_ACTION_PROFILES = Object.freeze({
  steer: { id: 'steer', buildM: 0, sustain: false, needsDirection: true },
  skip: { id: 'skip', buildM: 0, sustain: false, needsDirection: false },
  drive: { id: 'drive', buildM: 1, sustain: true, needsDirection: true },
  'heavy-drive': { id: 'heavy-drive', buildM: 2, sustain: true, needsDirection: true },
})

const DEG = Math.PI / 180
const RAD = 180 / Math.PI
const VISUAL_CURVE_SAMPLES = 40
const PREVIEW_END_EXTENSION = 0.34
const BEZIER_TURN_HANDLE = 0.72
const BEZIER_STRAIGHT_HANDLE = 0.34
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const sameHex = (a, b) => Boolean(a && b && a.q === b.q && a.r === b.r)

function normalizeAngle(angle) {
  let value = angle
  while (value <= -Math.PI) value += Math.PI * 2
  while (value > Math.PI) value -= Math.PI * 2
  return value
}

function shortestDelta(from, to) {
  return normalizeAngle(to - from)
}

function vectorAngle(vector) {
  return Math.atan2(vector.z ?? 0, vector.x ?? 0)
}

function axisAngle(axisId) {
  return vectorAngle(directionVector(axisId ?? 'E'))
}

function nearestAxisIdFromAngle(angle) {
  const source = { x: Math.cos(angle), z: Math.sin(angle) }
  let bestId = 'E'
  let bestDot = -Infinity
  for (const entry of HEX_DIRECTIONS) {
    const direction = directionVector(entry.id)
    const dot = direction.x * source.x + direction.z * source.z
    if (dot > bestDot) {
      bestDot = dot
      bestId = entry.id
    }
  }
  return bestId
}

function directionEntry(axisId) {
  return HEX_DIRECTIONS.find((entry) => entry.id === axisId) ?? HEX_DIRECTIONS[0]
}

function addStep(hex, axisId) {
  const direction = directionEntry(axisId)
  return { q: hex.q + direction.q, r: hex.r + direction.r }
}

function responseValue(kind, t) {
  if (kind === 'smoothstep') return t * t * (3 - 2 * t)
  if (kind === 'ease-in') return t * t
  if (kind === 'ease-out') return 1 - ((1 - t) * (1 - t))
  return t
}

function displaySpeed(momentum) {
  return Math.max(0.05, momentum)
}

function velocityFor(axisId, momentum) {
  if (!axisId || momentum <= 0) return { x: 0, z: 0 }
  const direction = directionVector(axisId)
  const speed = displaySpeed(momentum)
  return { x: direction.x * speed, z: direction.z * speed }
}

function velocityForHeading(heading, momentum) {
  if (!Number.isFinite(heading) || momentum <= 0) return { x: 0, z: 0 }
  const speed = displaySpeed(momentum)
  return { x: Math.cos(heading) * speed, z: Math.sin(heading) * speed }
}

function profileFor(actionId) {
  if (actionId === 'coast') return TRAJECTORY_ACTION_PROFILES.skip
  return TRAJECTORY_ACTION_PROFILES[actionId] ?? TRAJECTORY_ACTION_PROFILES.steer
}

export function makeTrajectoryState({ hex = { q: 0, r: 0 }, position = null, axisId = null, momentum = 0, worldAt = 0, heading = null } = {}) {
  const resolvedHex = position ? worldToAxial(position) : { ...hex }
  const resolvedPosition = axialToWorld(resolvedHex)
  const resolvedAxis = axisId ?? (Number.isFinite(heading) ? nearestAxisIdFromAngle(heading) : null)
  const m = clamp(Math.round(momentum), 0, 3)
  return {
    position: resolvedPosition,
    velocity: velocityFor(resolvedAxis, m),
    axisId: resolvedAxis,
    momentumLevel: m,
    heading: resolvedAxis ? axisAngle(resolvedAxis) : null,
    worldAt,
  }
}

export function trajectoryMomentum(state) {
  if (Number.isFinite(state?.momentumLevel)) return clamp(Math.round(state.momentumLevel), 0, 3)
  const speed = Math.hypot(state?.velocity?.x ?? 0, state?.velocity?.z ?? 0)
  if (speed < 0.18) return 0
  if (speed < 1.5) return 1
  if (speed < 2.5) return 2
  return 3
}

export function trajectoryHeading(state) {
  if (state?.axisId) return axisAngle(state.axisId)
  const speed = Math.hypot(state?.velocity?.x ?? 0, state?.velocity?.z ?? 0)
  if (speed > 0.02) return vectorAngle(state.velocity)
  return Number.isFinite(state?.heading) ? state.heading : null
}

export function createTrajectoryTargets(boardRadius = TRAJECTORY_DEFAULT_RADIUS) {
  return createConflictActors('chain')
    .filter((actor) => axialDistance(actor.hex) <= boardRadius)
    .map((actor) => ({ ...actor, hex: { ...actor.hex }, velocity: { ...(actor.velocity ?? { x: 0, z: 0 }) }, momentumLevel: 0 }))
}

export function trajectoryCoastIntentMatches(coastPlan, hex) {
  if (!coastPlan?.valid || (coastPlan.reflectionCount ?? 0) <= 0 || !hex) return false
  return (coastPlan.pathCells ?? []).slice(1).some((cell) => sameHex(cell, hex))
}

export function steeringBearingFromCell(state, selectedHex) {
  const center = axialToWorld(selectedHex)
  const dx = center.x - state.position.x
  const dz = center.z - state.position.z
  if (Math.hypot(dx, dz) < 0.001) return null
  return Math.atan2(dz, dx)
}

export function steeringDeltaDegrees(state, selectedHex) {
  const target = steeringBearingFromCell(state, selectedHex)
  const current = trajectoryHeading(state)
  if (!Number.isFinite(target) || !Number.isFinite(current)) return null
  return shortestDelta(current, target) * RAD
}

export function compatibleStartupMove(state, selectedHex) {
  if (!state?.axisId) return false
  const target = steeringBearingFromCell(state, selectedHex)
  if (!Number.isFinite(target)) return false
  const targetAxis = nearestAxisIdFromAngle(target)
  return Math.abs(shortestDelta(axisAngle(state.axisId), axisAngle(targetAxis)) * RAD) <= TRAJECTORY_MAX_STEER_DEG + 0.001
}

function rotatedAxisId(axisId, offset) {
  const index = HEX_DIRECTIONS.findIndex((entry) => entry.id === axisId)
  if (index < 0) return axisId ?? 'E'
  const count = HEX_DIRECTIONS.length
  return HEX_DIRECTIONS[(index + offset + count) % count].id
}

function routeForAxes(startHex, axes, boardRadius, turnAt = null, turnAxis = null) {
  const path = [{ ...startHex }]
  const segmentAxes = []
  let current = { ...startHex }
  for (const axisId of axes) {
    const next = addStep(current, axisId)
    if (axialDistance(next) > boardRadius) break
    current = next
    path.push({ ...current })
    segmentAxes.push(axisId)
  }
  return { path, segmentAxes, turnAt, turnAxis }
}

function routeTargetScore(route, selectedHex, requestedSteps) {
  const missingSteps = Math.max(0, requestedSteps - route.segmentAxes.length)
  if (!selectedHex) return missingSteps * 100
  const finalHex = route.path.at(-1)
  const finalWorld = axialToWorld(finalHex)
  const targetWorld = axialToWorld(selectedHex)
  const worldDistance = Math.hypot(finalWorld.x - targetWorld.x, finalWorld.z - targetWorld.z)
  return missingSteps * 100 + axialDistance(finalHex, selectedHex) * 10 + worldDistance
}

function buildCenterPath({ state, targetHeading, targetHex, travelSteps, steeringEnabled, responseCurve, boardRadius, freeM0Direction }) {
  const startHex = worldToAxial(state.position)
  const startAxis = state.axisId ?? (Number.isFinite(targetHeading) ? nearestAxisIdFromAngle(targetHeading) : null)
  const targetAxis = Number.isFinite(targetHeading) ? nearestAxisIdFromAngle(targetHeading) : startAxis
  const initialAxis = startAxis ?? targetAxis ?? 'E'
  const startHeading = axisAngle(initialAxis)
  let cappedDelta = 0
  if (steeringEnabled && Number.isFinite(targetHeading)) {
    const rawDelta = shortestDelta(startHeading, targetHeading)
    cappedDelta = freeM0Direction
      ? rawDelta
      : clamp(rawDelta, -TRAJECTORY_MAX_STEER_DEG * DEG, TRAJECTORY_MAX_STEER_DEG * DEG)
  }

  let chosenRoute
  if (freeM0Direction) {
    const freeAxis = targetAxis ?? initialAxis
    chosenRoute = routeForAxes(startHex, Array.from({ length: travelSteps }, () => freeAxis), boardRadius)
  } else {
    const candidates = [
      routeForAxes(startHex, Array.from({ length: travelSteps }, () => initialAxis), boardRadius),
    ]
    if (steeringEnabled && travelSteps >= 2) {
      for (const offset of [-1, 1]) {
        const turnAxis = rotatedAxisId(initialAxis, offset)
        for (let turnAt = 2; turnAt <= travelSteps; turnAt += 1) {
          const axes = Array.from({ length: travelSteps }, (_, index) => (index + 1 < turnAt ? initialAxis : turnAxis))
          candidates.push(routeForAxes(startHex, axes, boardRadius, turnAt, turnAxis))
        }
      }
    }
    candidates.sort((a, b) => routeTargetScore(a, targetHex, travelSteps) - routeTargetScore(b, targetHex, travelSteps))
    chosenRoute = candidates[0]
  }

  return {
    path: chosenRoute.path,
    segmentAxes: chosenRoute.segmentAxes,
    targetAxis: targetAxis ?? initialAxis,
    startAxis: initialAxis,
    startHeading,
    cappedDelta,
    steeringEnabled,
    turnAt: chosenRoute.turnAt,
    turnAxis: chosenRoute.turnAxis,
    responseCurve,
    finalTravelAxis: chosenRoute.segmentAxes.at(-1) ?? initialAxis,
  }
}

function pointLerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
}

function cubicBezierPoint(p0, p1, p2, p3, t) {
  const u = 1 - t
  const uu = u * u
  const tt = t * t
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    z: uu * u * p0.z + 3 * uu * t * p1.z + 3 * u * tt * p2.z + tt * t * p3.z,
  }
}

function cubicBezierDerivative(p0, p1, p2, p3, t) {
  const u = 1 - t
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    z: 3 * u * u * (p1.z - p0.z) + 6 * u * t * (p2.z - p1.z) + 3 * t * t * (p3.z - p2.z),
  }
}

function tangentHandleLengths(from, to, fromHeading, toHeading) {
  const fromDir = { x: Math.cos(fromHeading), z: Math.sin(fromHeading) }
  const toDir = { x: Math.cos(toHeading), z: Math.sin(toHeading) }
  const delta = { x: to.x - from.x, z: to.z - from.z }
  const distance = Math.max(0.0001, Math.hypot(delta.x, delta.z))
  const cross = (a, b) => a.x * b.z - a.z * b.x
  const denominator = cross(fromDir, toDir)
  if (Math.abs(denominator) < 0.0001) {
    const handle = distance * BEZIER_STRAIGHT_HANDLE
    return { fromHandle: handle, toHandle: handle, construction: 'parallel-tangent' }
  }
  const fromToIntersection = cross(delta, toDir) / denominator
  const endBackToIntersection = cross(fromDir, delta) / denominator
  if (fromToIntersection <= 0.001 || endBackToIntersection <= 0.001) {
    const handle = distance * BEZIER_STRAIGHT_HANDLE
    return { fromHandle: handle, toHandle: handle, construction: 'safe-fallback' }
  }
  const maxHandle = distance * 0.9
  return {
    fromHandle: Math.min(maxHandle, fromToIntersection * BEZIER_TURN_HANDLE),
    toHandle: Math.min(maxHandle, endBackToIntersection * BEZIER_TURN_HANDLE),
    construction: 'tangent-intersection',
  }
}

function bezierSection({ from, to, fromAxis, toAxis, movingM, includeStart = true, collisionAtEnd = false }) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z)
  if (distance < 0.0001) {
    return includeStart ? [{ position: { ...from }, axisId: fromAxis ?? toAxis ?? null, momentumLevel: movingM }] : []
  }
  const fromHeading = axisAngle(fromAxis ?? toAxis ?? 'E')
  const toHeading = axisAngle(toAxis ?? fromAxis ?? 'E')
  const handles = tangentHandleLengths(from, to, fromHeading, toHeading)
  const p0 = { ...from }
  const p3 = { ...to }
  const p1 = {
    x: p0.x + Math.cos(fromHeading) * handles.fromHandle,
    z: p0.z + Math.sin(fromHeading) * handles.fromHandle,
  }
  const p2 = {
    x: p3.x - Math.cos(toHeading) * handles.toHandle,
    z: p3.z - Math.sin(toHeading) * handles.toHandle,
  }
  const count = Math.max(12, Math.round(VISUAL_CURVE_SAMPLES * Math.max(0.45, Math.min(1, distance / 3))))
  const samples = []
  for (let index = includeStart ? 0 : 1; index <= count; index += 1) {
    const local = index / count
    const position = cubicBezierPoint(p0, p1, p2, p3, local)
    const derivative = cubicBezierDerivative(p0, p1, p2, p3, local)
    const heading = Math.hypot(derivative.x, derivative.z) > 0.0001 ? Math.atan2(derivative.z, derivative.x) : toHeading
    samples.push({
      position,
      velocity: velocityForHeading(heading, movingM),
      axisId: nearestAxisIdFromAngle(heading),
      momentumLevel: movingM,
      curveConstruction: handles.construction,
      collision: collisionAtEnd && index === count,
    })
  }
  return samples
}

function retimeVisualSamples(samples, finalState) {
  if (!samples.length) return []
  const distances = [0]
  let total = 0
  for (let index = 1; index < samples.length; index += 1) {
    total += Math.hypot(
      samples[index].position.x - samples[index - 1].position.x,
      samples[index].position.z - samples[index - 1].position.z,
    )
    distances.push(total)
  }
  return samples.map((sample, index) => {
    const atEnd = index === samples.length - 1
    return {
      ...sample,
      t: total > 0.0001 ? distances[index] / total : index / Math.max(1, samples.length - 1),
      velocity: atEnd ? { ...finalState.velocity } : sample.velocity,
      axisId: atEnd ? finalState.axisId : sample.axisId,
      momentumLevel: atEnd ? finalState.momentumLevel : sample.momentumLevel,
    }
  })
}

function visualSamplesForMotion({ state, motion, pathResult, movingM, finalState, travelEndAxis }) {
  const finalPosition = finalState.position
  const collisions = motion?.collisions ?? []
  const samples = []
  let from = { ...state.position }
  let fromAxis = pathResult.startAxis ?? state.axisId ?? travelEndAxis
  let first = true

  for (const collision of collisions) {
    if (!collision?.position) continue
    const section = bezierSection({
      from,
      to: collision.position,
      fromAxis,
      toAxis: collision.axisBefore ?? fromAxis,
      movingM,
      includeStart: first,
      collisionAtEnd: true,
    })
    samples.push(...section)
    first = false
    from = { ...collision.position }
    fromAxis = collision.axisAfter ?? fromAxis
  }

  const tail = bezierSection({
    from,
    to: finalPosition,
    fromAxis,
    toAxis: travelEndAxis ?? fromAxis,
    movingM,
    includeStart: first,
  })
  samples.push(...tail)

  if (!samples.length) {
    samples.push({
      position: { ...state.position }, velocity: { ...state.velocity }, axisId: state.axisId ?? null,
      momentumLevel: trajectoryMomentum(state),
    })
    if (Math.hypot(finalPosition.x - state.position.x, finalPosition.z - state.position.z) > 0.0001) {
      samples.push({
        position: { ...finalPosition }, velocity: { ...finalState.velocity }, axisId: finalState.axisId,
        momentumLevel: finalState.momentumLevel,
      })
    }
  }
  return retimeVisualSamples(samples, finalState)
}

function previewSamplesForPlan(plan) {
  if (!plan?.valid || !plan.samples?.length) return plan?.samples ?? []
  const samples = plan.samples.map((sample) => ({
    ...sample,
    position: { ...sample.position },
    velocity: { ...(sample.velocity ?? { x: 0, z: 0 }) },
  }))
  const finalAxis = plan.finalState?.axisId ?? null
  if (!finalAxis) return samples
  const finalCenter = plan.finalState.position
  const direction = directionVector(finalAxis)
  const speed = Math.max(1, plan.beforeM, plan.builtM)
  for (let step = 1; step <= 6; step += 1) {
    const distance = PREVIEW_END_EXTENSION * (step / 6)
    samples.push({
      t: 1,
      position: { x: finalCenter.x + direction.x * distance, z: finalCenter.z + direction.z * distance },
      velocity: velocityForHeading(axisAngle(finalAxis), speed),
      axisId: finalAxis,
      momentumLevel: plan.finalM,
      previewAxisStub: true,
      previewEnd: step === 6,
    })
  }
  return samples
}

export function trajectoryActionPlan({
  state,
  actionId = 'steer',
  selectedHex = null,
  boardRadius = TRAJECTORY_DEFAULT_RADIUS,
  responseCurve = 'linear',
  baseDissipationPerAction = TRAJECTORY_BASE_DISSIPATION,
  obstacles = [],
  intentAxisId = null,
} = {}) {
  const profile = profileFor(actionId)
  const canonicalActionId = profile.id
  const startM = trajectoryMomentum(state)
  const targetHeading = profile.needsDirection
    ? (intentAxisId ? axisAngle(intentAxisId) : selectedHex ? steeringBearingFromCell(state, selectedHex) : null)
    : null
  if (profile.needsDirection && !Number.isFinite(targetHeading)) {
    return { valid: false, reason: 'Hover or click a direction Cell.' }
  }

  const buildM = profile.buildM ?? 0
  const builtM = clamp(startM + buildM, 0, 3)
  const freeM0Direction = startM === 0
  const steeringEnabled = profile.needsDirection

  let requestedTravelSteps = 0
  if (canonicalActionId === 'skip') requestedTravelSteps = startM
  else if (buildM > 0) requestedTravelSteps = Math.max(1, builtM)
  else requestedTravelSteps = startM > 0 ? startM : 1

  const pathResult = buildCenterPath({
    state,
    targetHeading,
    targetHex: intentAxisId ? null : selectedHex,
    travelSteps: requestedTravelSteps,
    steeringEnabled,
    responseCurve,
    boardRadius,
    freeM0Direction,
  })

  const startHex = worldToAxial(state.position)
  const movingM = Math.max(1, startM, builtM)
  const motion = runCellMotion({
    startHex,
    initialAxisId: pathResult.startAxis ?? state.axisId ?? pathResult.finalTravelAxis,
    initialMomentum: Math.max(startM, builtM),
    travelBudget: requestedTravelSteps,
    authoredPathCells: pathResult.path.slice(1),
    obstacles,
    boardRadius,
    capRemainingByMomentum: false,
    // Match Driving Lab / Spatial Inertia v1: surface redirects Axis; reflection itself is not an M tax.
    reflectionMomentum: ({ momentum }) => ({ momentum, restitution: null }),
  })

  if (startM === 0 && buildM === 0 && motion.collisions.length > 0) {
    return {
      valid: false,
      reason: 'M0 Move cannot initiate a Wall / Surface reflection.',
      kind: canonicalActionId,
      actionId: canonicalActionId,
      beforeM: startM,
      finalM: startM,
      collisions: motion.collisions,
      reflectionRule: TRAJECTORY_REFLECTION_RULE,
    }
  }

  let generatedM = 0
  let startupCompatible = false
  let finalM = startM
  if (profile.sustain) {
    finalM = builtM
  } else if (startM === 0) {
    if (canonicalActionId === 'steer') {
      startupCompatible = Boolean(state.axisId) && compatibleStartupMove(state, selectedHex)
      generatedM = startupCompatible ? 1 : 0
      finalM = generatedM
    } else {
      finalM = 0
    }
  } else {
    finalM = Math.max(0, startM - Math.max(0, baseDissipationPerAction))
  }

  const actualPathCells = [startHex, ...(motion.actualPath ?? [])].map((hex) => ({ ...hex }))
  const resolvedSegmentAxes = []
  for (let index = 1; index < actualPathCells.length; index += 1) {
    const axisId = directionIdBetween(actualPathCells[index - 1], actualPathCells[index])
    if (axisId) resolvedSegmentAxes.push(axisId)
  }
  const travelEndAxis = motion.reflected
    ? (motion.axisAfter ?? resolvedSegmentAxes.at(-1) ?? pathResult.finalTravelAxis)
    : (pathResult.finalTravelAxis ?? resolvedSegmentAxes.at(-1) ?? state.axisId ?? pathResult.targetAxis)

  let finalAxis = travelEndAxis
  let zeroMSettlementDeg = 0
  if (!motion.reflected && startM > 0 && finalM === 0 && canonicalActionId === 'steer' && Number.isFinite(targetHeading)) {
    const currentAxisHeading = axisAngle(finalAxis)
    const remaining = shortestDelta(currentAxisHeading, targetHeading)
    if (Math.abs(remaining) > 0.001) {
      const settlement = clamp(remaining, -TRAJECTORY_MAX_STEER_DEG * DEG, TRAJECTORY_MAX_STEER_DEG * DEG)
      finalAxis = nearestAxisIdFromAngle(currentAxisHeading + settlement)
      zeroMSettlementDeg = settlement * RAD
    }
  }
  if (startM === 0 && profile.needsDirection && Number.isFinite(targetHeading) && !motion.reflected) {
    finalAxis = nearestAxisIdFromAngle(targetHeading)
  }
  if (canonicalActionId === 'skip' && startM === 0 && !state.axisId) finalAxis = null

  const finalHex = { ...motion.finalHex }
  const finalPosition = axialToWorld(finalHex)
  const finalState = {
    ...state,
    position: finalPosition,
    velocity: velocityFor(finalAxis, finalM),
    axisId: finalAxis,
    momentumLevel: finalM,
    heading: finalAxis ? axisAngle(finalAxis) : null,
    worldAt: Number(state.worldAt ?? 0) + 1,
  }
  const samples = visualSamplesForMotion({ state, motion, pathResult, movingM, finalState, travelEndAxis })
  const actualSteps = motion.spentTravel
  const crossings = actualPathCells.map((hex, index) => ({
    hex: { ...hex },
    sampleIndex: Math.round((index / Math.max(1, actualPathCells.length - 1)) * Math.max(0, samples.length - 1)),
    t: index / Math.max(1, actualPathCells.length - 1),
    logicalOnly: true,
  }))

  const targetDeltaDeg = Number.isFinite(targetHeading) && state.axisId
    ? shortestDelta(axisAngle(state.axisId), targetHeading) * RAD
    : null
  const steeringAppliedDeg = pathResult.cappedDelta * RAD
  const reachedBoardEdge = actualSteps < requestedTravelSteps && motion.collisions.length === 0
  const verb = canonicalActionId === 'skip'
    ? 'Skip'
    : canonicalActionId === 'drive'
      ? 'Drive'
      : canonicalActionId === 'heavy-drive'
        ? 'Heavy Drive'
        : (startM > 0 ? 'Steer' : 'Move')
  const reflectionText = motion.reflectionCount > 0 ? ` · Reflect×${motion.reflectionCount}` : ''
  const summary = `${verb} · ${actualSteps} Travel / 1 AT · M${startM}→M${finalM} · Axis ${state.axisId ?? 'none'}→${finalAxis ?? 'none'}${reflectionText}`
  const conflictEvents = motion.collisions.map((collision) => ({
    kind: 'surface-reflection',
    actorId: 'player',
    ...collision,
  }))

  return {
    valid: true,
    kind: canonicalActionId,
    actionId: canonicalActionId,
    samples,
    crossings,
    pathCells: actualPathCells,
    nominalPathCells: pathResult.path.map((hex) => ({ ...hex })),
    segmentAxes: motion.reflected ? resolvedSegmentAxes : [...pathResult.segmentAxes],
    finalState,
    finalHex,
    beforeM: startM,
    builtM,
    buildM,
    finalM,
    generatedM,
    startupCompatible,
    travelDistance: actualSteps,
    travelSteps: actualSteps,
    requestedTravelSteps,
    steeringAppliedDeg,
    targetDeltaDeg,
    zeroMSettlementDeg,
    responseCurve,
    reachedBoardEdge,
    cellAuthorityRule: TRAJECTORY_CELL_AUTHORITY_RULE,
    pathRule: TRAJECTORY_PATH_RULE,
    previewRule: TRAJECTORY_PREVIEW_RULE,
    reflectionRule: TRAJECTORY_REFLECTION_RULE,
    coastIntentRule: TRAJECTORY_COAST_REFLECTION_INTENT_RULE,
    intentAxisId: intentAxisId ?? null,
    reflectionCount: motion.reflectionCount,
    motionTrace: motion.trace,
    travelEndAxis,
    atCost: 1,
    spatialMode: 'hybrid',
    destinationDriven: false,
    visualCurveAuthoritative: true,
    collisions: motion.collisions,
    conflictEvents,
    actorTrajectories: {},
    actorPlaybackWindows: {},
    actorStates: [],
    summary,
  }
}


function contactCurveSamples(plan, resolved) {
  if (!resolved?.cellConflict || !plan?.samples?.length) return plan?.samples ?? []
  const contactHex = resolved.cellConflict.playerCell
  const logicalIndex = Math.max(0, (plan.pathCells ?? []).findIndex((cell) => sameHex(cell, contactHex)))
  const crossing = plan.crossings?.[logicalIndex]
  const sampleIndex = clamp(
    Number.isFinite(crossing?.sampleIndex) ? crossing.sampleIndex : Math.round((logicalIndex / Math.max(1, (plan.pathCells?.length ?? 1) - 1)) * (plan.samples.length - 1)),
    0,
    Math.max(0, plan.samples.length - 1),
  )
  const samples = plan.samples.slice(0, Math.max(1, sampleIndex + 1)).map((sample) => ({
    ...sample,
    position: { ...sample.position },
    velocity: { ...(sample.velocity ?? { x: 0, z: 0 }) },
  }))
  const finalPosition = resolved.finalState.position
  const last = samples.at(-1) ?? plan.samples[0]
  const endSample = {
    ...last,
    position: { ...finalPosition },
    velocity: { ...(resolved.finalState.velocity ?? { x: 0, z: 0 }) },
    axisId: resolved.finalState.axisId ?? last?.axisId ?? null,
    momentumLevel: resolved.finalM ?? 0,
    collision: true,
  }
  const prior = samples.at(-1)
  if (!prior || Math.hypot(prior.position.x - finalPosition.x, prior.position.z - finalPosition.z) > 0.001) samples.push(endSample)
  else samples[samples.length - 1] = endSample
  return retimeVisualSamples(samples, { ...resolved.finalState, momentumLevel: resolved.finalM ?? 0 })
}

export function resolveTrajectoryTargetContacts(plan, {
  actors = [],
  obstacles = [],
  boardRadius = TRAJECTORY_DEFAULT_RADIUS,
} = {}) {
  if (!plan?.valid) return plan
  if (!actors.length) return plan
  const activeM = Math.max(0, plan.beforeM ?? 0, plan.builtM ?? 0)
  const collisionPlan = {
    ...plan,
    spatialMode: 'discrete',
    traversedCells: (plan.pathCells ?? []).map((hex) => ({ ...hex })),
    beforeM: activeM,
    axisBefore: plan.samples?.[0]?.axisId ?? plan.travelEndAxis ?? plan.finalState?.axisId ?? null,
    axisAfter: plan.finalState?.axisId ?? plan.travelEndAxis ?? null,
    actionTransaction: {
      rule: 'trajectory-active-m-until-action-end-v1',
      fromM: activeM,
      toM: activeM,
      cause: 'Active M',
      status: 'pending',
    },
  }
  const resolved = resolveCellConflicts({ plan: collisionPlan, actors, obstacles, boardRadius })
  const finalM = resolved.cellConflict ? (resolved.finalM ?? 0) : plan.finalM
  const finalState = {
    ...resolved.finalState,
    momentumLevel: finalM,
    heading: resolved.finalState?.axisId ? axisAngle(resolved.finalState.axisId) : null,
  }
  return {
    ...resolved,
    samples: resolved.cellConflict ? contactCurveSamples(plan, { ...resolved, finalState }) : plan.samples,
    pathCells: (resolved.traversedCells ?? plan.pathCells ?? []).map((hex) => ({ ...hex })),
    finalHex: worldToAxial(finalState.position),
    finalState,
    finalM,
    spatialMode: 'hybrid',
    visualCurveAuthoritative: true,
    targetRule: TRAJECTORY_TARGET_RULE,
    conflictEvents: [...(plan.conflictEvents ?? []), ...(resolved.conflictEvents ?? [])],
  }
}

export function trajectoryProjectionPair(options = {}) {
  const controlled = trajectoryActionPlan(options)
  const coast = trajectoryActionPlan({ ...options, actionId: 'skip', selectedHex: null })
  return { controlled, coast }
}

export function coastProjectionPath(coastPlan) {
  if (!coastPlan?.valid) return []
  if ((coastPlan.reflectionCount ?? 0) <= 0) return (coastPlan.pathCells ?? []).map((hex) => ({ ...hex }))
  return (coastPlan.samples ?? []).map((sample) => worldToAxialFraction(sample.position))
}

export function withCoastProjection(controlledPlan, coastPlan) {
  if (!controlledPlan?.valid) return controlledPlan
  return {
    ...controlledPlan,
    samples: previewSamplesForPlan(controlledPlan),
    actorTrajectories: {
      ...(controlledPlan.actorTrajectories ?? {}),
      ...(coastPlan?.valid ? { coastProjection: coastProjectionPath(coastPlan) } : {}),
    },
    actorPlaybackWindows: controlledPlan.actorPlaybackWindows ?? {},
    actorTrajectoryPolylineIds: [
      ...(controlledPlan.actorTrajectoryPolylineIds ?? []),
      ...((coastPlan?.reflectionCount ?? 0) > 0 ? ['coastProjection'] : []),
    ],
    coastProjectionReflectionCount: coastPlan?.reflectionCount ?? 0,
    previewAxisStub: controlledPlan.finalState?.axisId ?? null,
    previewAxisStubLength: PREVIEW_END_EXTENSION,
    previewRule: TRAJECTORY_PREVIEW_RULE,
    coastPreviewAxis: coastPlan?.finalState?.axisId ?? null,
    visualCurveAuthoritative: true,
  }
}
