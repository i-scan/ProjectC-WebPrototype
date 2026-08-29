import { axialKey, axialToWorld, directionVector, worldToAxialFraction } from './hex.js'
import { momentumLevel, momentumSpeed } from './solver.js'
import { SURFACE_GEOMETRY_RULE, REFLECTION_CONTINUATION_RULE } from './surface-geometry.js'
import {
  CELL_MOTION_TRACE_RULE,
  CELL_TRAVEL_BUDGET_RULE,
  directionIdBetween,
  runCellMotion,
} from './cell-motion.js'
import {
  ACTOR_COLLISION_RESTITUTION,
  WALL_TRAVEL_BUDGET_RULE,
  createConflictActors,
  conflictScenario,
  decorateConflictCells,
  exchangeActorMomentum,
} from './conflict-v2.js'

export {
  ACTOR_COLLISION_RESTITUTION,
  WALL_TRAVEL_BUDGET_RULE,
  createConflictActors,
  conflictScenario,
  decorateConflictCells,
  exchangeActorMomentum,
}

export const CELL_CONFLICT_MOTION_RULE = 'spatial-inertia-v1-contact-resolution'
export const ACTOR_MOTION_RULE = 'forced-move-cell-motion-v1'
export const CAUSAL_PLAYBACK_RULE = 'motion-trace-causal-playback-v1'
export const STRIKE_RULE = 'contact-strike-direct-transfer-v1'
export const FORCED_USE_RULE = 'forced-use-on-first-travel-v1'
export const INCOMING_COMPOSITION_RULE = 'incoming-momentum-composition-ab-v1'
export const TRUE_VECTOR_COMPOSITION = 'true-vector'
export const HEX_LOOKUP_COMPOSITION = 'hex-lookup'
export const HEX_LOOKUP_CANDIDATE_RULE = 'hex-angle-lookup-prototype-candidate-v1'

const cloneHex = (hex) => ({ q: hex.q, r: hex.r })
const cloneVelocity = (velocity = { x: 0, z: 0 }) => ({ x: velocity.x, z: velocity.z })
const sameHex = (a, b) => Boolean(a && b && a.q === b.q && a.r === b.r)
const clampSystemM = (value) => Math.max(0, Math.min(4, Math.round(Number(value) || 0)))
const isDownAxis = (axisId) => String(axisId ?? '').toLowerCase() === 'down'

function speedForM(level) {
  const m = clampSystemM(level)
  if (m <= 3) return momentumSpeed(m)
  // Presentation-only canonical speed for transient M4. Rules read the explicit
  // momentumLevel field, so this value is not used as the gameplay authority.
  return momentumSpeed(3) + 0.9
}

function actorM(actor) {
  if (Number.isFinite(actor?.momentumLevel)) return clampSystemM(actor.momentumLevel)
  return Math.min(3, momentumLevel(Math.hypot(actor?.velocity?.x ?? 0, actor?.velocity?.z ?? 0)))
}

function cloneActor(actor) {
  return {
    ...actor,
    hex: cloneHex(actor.hex),
    velocity: cloneVelocity(actor.velocity),
    momentumLevel: actorM(actor),
  }
}

function velocityFor(axisId, level) {
  if (!axisId || isDownAxis(axisId) || level <= 0) return { x: 0, z: 0 }
  const direction = directionVector(axisId)
  const speed = speedForM(level)
  return { x: direction.x * speed, z: direction.z * speed }
}

function nearestAxis(vector) {
  const magnitude = Math.hypot(vector.x, vector.z)
  if (magnitude < 1e-6) return null
  const source = { x: vector.x / magnitude, z: vector.z / magnitude }
  const candidates = ['E', 'NE', 'NW', 'W', 'SW', 'SE']
  let best = candidates[0]
  let bestDot = -Infinity
  for (const axisId of candidates) {
    const direction = directionVector(axisId)
    const dot = direction.x * source.x + direction.z * source.z
    if (dot > bestDot) {
      bestDot = dot
      best = axisId
    }
  }
  return best
}

function axialAngleSteps(a, b) {
  const ids = ['E', 'NE', 'NW', 'W', 'SW', 'SE']
  const ai = ids.indexOf(a)
  const bi = ids.indexOf(b)
  if (ai < 0 || bi < 0) return 0
  const raw = Math.abs(ai - bi)
  return Math.min(raw, 6 - raw)
}

function trueVectorComposition(existingM, existingAxis, incomingM, incomingAxis) {
  if (existingM <= 0 || !existingAxis) return { momentum: incomingM, axisId: incomingAxis }
  const existing = directionVector(existingAxis)
  const incoming = directionVector(incomingAxis)
  const vector = {
    x: existing.x * existingM + incoming.x * incomingM,
    z: existing.z * existingM + incoming.z * incomingM,
  }
  const magnitude = Math.hypot(vector.x, vector.z)
  return {
    momentum: clampSystemM(Math.round(magnitude)),
    axisId: nearestAxis(vector),
  }
}

function hexLookupComposition(existingM, existingAxis, incomingM, incomingAxis) {
  if (existingM <= 0 || !existingAxis) return { momentum: incomingM, axisId: incomingAxis }
  const steps = axialAngleSteps(existingAxis, incomingAxis)
  let momentum
  if (steps === 0) momentum = existingM + incomingM
  else if (steps === 1) momentum = Math.max(existingM, incomingM) + Math.ceil(Math.min(existingM, incomingM) / 2)
  else if (steps === 2) momentum = Math.max(existingM, incomingM)
  else momentum = Math.abs(existingM - incomingM)

  const existing = directionVector(existingAxis)
  const incoming = directionVector(incomingAxis)
  const axisId = momentum <= 0
    ? existingAxis
    : nearestAxis({
        x: existing.x * existingM + incoming.x * incomingM,
        z: existing.z * existingM + incoming.z * incomingM,
      }) ?? (existingM >= incomingM ? existingAxis : incomingAxis)
  return { momentum: clampSystemM(momentum), axisId }
}

export function composeIncomingMomentum({ target, incomingM, incomingAxis, mode = TRUE_VECTOR_COMPOSITION }) {
  const sourceM = clampSystemM(incomingM)
  const beforeM = actorM(target)
  const beforeAxis = target?.axisId ?? null

  if (isDownAxis(beforeAxis)) {
    const cancelled = Math.min(beforeM, sourceM)
    const downAfter = beforeM - cancelled
    const incomingAfter = sourceM - cancelled
    if (incomingAfter <= 0) {
      return {
        rule: INCOMING_COMPOSITION_RULE,
        mode: 'down-1-to-1-cancel',
        beforeM,
        beforeAxis,
        incomingM: sourceM,
        incomingAxis,
        momentum: downAfter,
        axisId: downAfter > 0 ? beforeAxis : null,
        cancelled,
      }
    }
    return {
      rule: INCOMING_COMPOSITION_RULE,
      mode: 'down-1-to-1-cancel',
      beforeM,
      beforeAxis,
      incomingM: sourceM,
      incomingAxis,
      momentum: incomingAfter,
      axisId: incomingAxis,
      cancelled,
    }
  }

  const result = mode === HEX_LOOKUP_COMPOSITION
    ? hexLookupComposition(beforeM, beforeAxis, sourceM, incomingAxis)
    : trueVectorComposition(beforeM, beforeAxis, sourceM, incomingAxis)

  return {
    rule: INCOMING_COMPOSITION_RULE,
    lookupRule: mode === HEX_LOOKUP_COMPOSITION ? HEX_LOOKUP_CANDIDATE_RULE : null,
    mode,
    beforeM,
    beforeAxis,
    incomingM: sourceM,
    incomingAxis,
    momentum: result.momentum,
    axisId: result.axisId,
    cancelled: 0,
  }
}

function fractionalHex(point) {
  const value = worldToAxialFraction(point)
  const snap = (number) => Math.abs(number - Math.round(number)) < 1e-6 ? Math.round(number) : number
  return { q: snap(value.q), r: snap(value.r) }
}

function trajectoryFromTimeline(timeline = []) {
  const result = []
  for (const record of timeline) {
    if (!record?.position) continue
    const next = fractionalHex(record.position)
    const previous = result.at(-1)
    if (!previous || Math.abs(previous.q - next.q) > 1e-6 || Math.abs(previous.r - next.r) > 1e-6) result.push(next)
  }
  return result
}

function mergeTrajectory(target, addition) {
  for (const point of addition) {
    const previous = target.at(-1)
    if (!previous || Math.abs(previous.q - point.q) > 1e-6 || Math.abs(previous.r - point.r) > 1e-6) target.push({ ...point })
  }
}

function buildCausalPlaybackWindows(causalOrder, trajectories) {
  const windows = {}
  const entries = [...causalOrder.entries()]
    .filter(([id]) => (trajectories[id]?.length ?? 0) > 1)
    .sort((a, b) => a[1].order - b[1].order)
  for (const [id, meta] of entries) {
    const pathPoints = Math.max(1, (trajectories[id]?.length ?? 2) - 1)
    const start = Math.min(0.72, 0.48 + meta.depth * 0.045 + meta.order * 0.012)
    const duration = Math.min(0.38, 0.22 + pathPoints * 0.035)
    windows[id] = { start, end: Math.min(0.94, start + duration), rule: CAUSAL_PLAYBACK_RULE }
  }
  return windows
}

function fallbackTrace(plan) {
  const cells = plan?.traversedCells ?? []
  if (cells.length < 2) return []
  const beforeM = clampSystemM(plan.beforeM ?? 0)
  return cells.slice(1).map((to, index) => {
    const from = cells[index]
    const axisId = directionIdBetween(from, to) ?? plan.axisAfter ?? plan.axisBefore
    return {
      index,
      kind: 'cell-step',
      from: cloneHex(from),
      to: cloneHex(to),
      cost: 1,
      axisBefore: axisId,
      axisAfter: axisId,
      momentumBefore: beforeM,
      momentumAfter: beforeM,
      remainingBefore: Math.max(0, cells.length - 1 - index),
      remainingAfter: Math.max(0, cells.length - 2 - index),
      allowed: true,
      motionTraceRule: 'legacy-adjacent-trace-fallback-v1',
      travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
    }
  })
}

function playerSamples(points, plan, finalVelocity, finalAxisId) {
  const source = points.length ? points : [plan.samples?.[0]?.position ?? plan.finalState.position]
  if (source.length === 1) source.push({ ...source[0] })
  return source.map((position, index) => ({
    t: index / Math.max(1, source.length - 1),
    position: { ...position },
    velocity: index === 0 ? cloneVelocity(plan.samples?.[0]?.velocity ?? { x: 0, z: 0 }) : cloneVelocity(finalVelocity),
    axisId: index === 0 ? (plan.axisBefore ?? null) : finalAxisId,
  }))
}

function pushVisualPoint(points, point) {
  if (!point) return
  const next = { x: point.x, z: point.z }
  const previous = points.at(-1)
  if (!previous || Math.hypot(previous.x - next.x, previous.z - next.z) > 0.001) points.push(next)
}

function translateSurfaceEvents(actorId, motion, conflictEvents) {
  for (const collision of motion.collisions ?? []) {
    const boundary = collision.kind === 'boundary'
    conflictEvents.push({
      kind: 'surface-reflection',
      actorId,
      obstacleKind: boundary ? 'boundary' : collision.kind,
      obstacleId: collision.obstacleId ?? null,
      geometryKind: collision.geometryKind,
      from: collision.from ? cloneHex(collision.from) : undefined,
      contactPoint: { ...collision.position },
      attemptedCell: cloneHex(collision.attemptedCell),
      axisBefore: collision.axisBefore,
      axisAfter: collision.axisAfter,
      beforeM: collision.beforeM,
      afterM: collision.beforeM,
      normal: collision.normal ? { ...collision.normal } : null,
      reflectedVector: collision.reflectedVector ? { ...collision.reflectedVector } : null,
      surfaceGeometry: SURFACE_GEOMETRY_RULE,
      reflectionContinuation: collision.reflectionContinuation,
      wallCellPivot: Boolean(collision.wallCellPivot),
      wallCellTravelCost: collision.wallCellTravelCost ?? 0,
      wallAxis: collision.wallAxis ?? null,
      directMomentumLoss: false,
      motionTraceRule: CELL_MOTION_TRACE_RULE,
      travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
    })
  }
}

function createForcedMoveResolver({
  actors,
  obstacles,
  boardRadius,
  reservedCells,
  conflictEvents,
  momentumEvents,
  incomingCompositionMode,
}) {
  const actorStates = actors.map(cloneActor)
  const actorById = new Map(actorStates.map((actor) => [actor.id, actor]))
  const occupancy = new Map(actorStates.map((actor) => [axialKey(actor.hex), actor.id]))
  const reserved = new Set(reservedCells.map(axialKey))
  const actorTrajectories = Object.fromEntries(actorStates.map((actor) => [actor.id, [cloneHex(actor.hex)]]))
  const actorMotionTrace = Object.fromEntries(actorStates.map((actor) => [actor.id, []]))
  const causalOrder = new Map()
  let nextOrder = 0

  const noteMotion = (id, depth) => {
    if (!causalOrder.has(id)) causalOrder.set(id, { order: nextOrder++, depth })
  }

  const moveActor = (actorId, axisId, power, depth = 0) => {
    const actor = actorById.get(actorId)
    const incomingPower = clampSystemM(power)
    if (!actor || incomingPower <= 0 || depth > actorStates.length + 6) {
      return { vacated: false, momentumAfter: actor ? actorM(actor) : 0, axisAfter: axisId, motion: null }
    }

    noteMotion(actorId, depth)
    const startHex = cloneHex(actor.hex)
    let logicalM = incomingPower
    let forcedUseResolved = false

    actor.axisId = axisId
    actor.momentumLevel = incomingPower
    actor.velocity = velocityFor(axisId, incomingPower)

    const motion = runCellMotion({
      startHex,
      initialAxisId: axisId,
      // CellMotionTrace v1 currently stores M0~M3. M4 is carried as logicalM
      // until its mandatory first Forced Use settles it to M3.
      initialMomentum: Math.min(3, incomingPower),
      travelBudget: incomingPower,
      authoredPathCells: [],
      obstacles,
      boardRadius,
      capRemainingByMomentum: true,
      reflectionMomentum: ({ momentum }) => ({ momentum, restitution: null }),
      onEnterCell: ({ from, to, axisId: entryAxis }) => {
        if (!forcedUseResolved) {
          const fromM = logicalM
          logicalM = Math.max(0, logicalM - 1)
          forcedUseResolved = true
          const event = { actorId, fromM, toM: logicalM, cause: 'Forced Use', rule: FORCED_USE_RULE }
          momentumEvents.push(event)
          conflictEvents.push({ kind: 'momentum-event', ...event })
        }

        const sameAsCurrent = sameHex(from, to)
        if (reserved.has(axialKey(to)) && !sameAsCurrent) {
          conflictEvents.push({
            kind: 'reserved-cell-stop', actorId,
            cell: cloneHex(from), attemptedCell: cloneHex(to),
            beforeM: logicalM, afterM: logicalM,
            motionTraceRule: CELL_MOTION_TRACE_RULE,
          })
          return { allowed: false, stop: true, momentum: Math.min(3, logicalM), reason: 'reserved-player-cell' }
        }

        const occupantId = occupancy.get(axialKey(to))
        if (occupantId && occupantId !== actorId) {
          const target = actorById.get(occupantId)
          const transferM = logicalM
          const targetBeforeM = actorM(target)
          const composition = composeIncomingMomentum({
            target,
            incomingM: transferM,
            incomingAxis: entryAxis,
            mode: incomingCompositionMode,
          })
          const transfer = {
            sourceBeforeM: transferM,
            sourceAfterM: 0,
            targetBeforeM,
            targetAfterM: composition.momentum,
            directionId: entryAxis,
            model: STRIKE_RULE,
          }
          conflictEvents.push({
            kind: transferM > 0 ? 'cell-conflict' : 'cell-conflict-blocked',
            sourceActorId: actorId,
            targetActorId: occupantId,
            power: composition.momentum,
            impactM: transferM,
            cell: cloneHex(to),
            chained: true,
            contactBehavior: 'Strike',
            motionTraceRule: CELL_MOTION_TRACE_RULE,
          })
          conflictEvents.push({
            kind: 'momentum-transfer', sourceActorId: actorId, targetActorId: occupantId,
            ...transfer, composition, chained: true,
            motionTraceRule: CELL_MOTION_TRACE_RULE,
          })
          momentumEvents.push({ actorId, fromM: transferM, toM: 0, cause: 'Transfer', targetActorId: occupantId })
          logicalM = 0

          if (transferM <= 0 || composition.momentum <= 0) {
            return { allowed: false, stop: true, momentum: 0, reason: 'strike-no-forced-move' }
          }

          target.axisId = composition.axisId
          target.momentumLevel = composition.momentum
          target.velocity = velocityFor(composition.axisId, composition.momentum)
          const child = moveActor(occupantId, composition.axisId, composition.momentum, depth + 1)
          const targetStillHere = occupancy.get(axialKey(to)) === occupantId
          if (!child.vacated || targetStillHere) {
            conflictEvents.push({
              kind: 'cell-conflict-blocked', sourceActorId: actorId, targetActorId: occupantId,
              power: composition.momentum, impactM: transferM, cell: cloneHex(to), chained: true,
              partial: child.vacated,
              contactBehavior: 'Strike',
              transferRefunded: false,
              motionTraceRule: CELL_MOTION_TRACE_RULE,
            })
            return { allowed: false, stop: true, momentum: 0, reason: 'target-did-not-vacate' }
          }

          occupancy.delete(axialKey(from))
          occupancy.set(axialKey(to), actorId)
          return { allowed: true, stop: true, momentum: 0, reason: 'strike-contact-stop' }
        }

        if (!sameAsCurrent) {
          occupancy.delete(axialKey(from))
          occupancy.set(axialKey(to), actorId)
        }
        return { allowed: true, momentum: Math.min(3, logicalM) }
      },
    })

    actor.hex = cloneHex(motion.finalHex)
    actor.axisId = motion.axisAfter ?? axisId
    actor.momentumLevel = logicalM
    actor.velocity = velocityFor(actor.axisId, logicalM)
    translateSurfaceEvents(actorId, motion, conflictEvents)
    mergeTrajectory(actorTrajectories[actorId], trajectoryFromTimeline(motion.timeline))
    actorMotionTrace[actorId].push(...motion.trace.map((entry) => ({ ...entry })))

    return {
      vacated: !sameHex(startHex, actor.hex),
      momentumAfter: logicalM,
      axisAfter: actor.axisId,
      motion,
    }
  }

  const receiveStrike = (targetActorId, incomingM, incomingAxis, depth = 0) => {
    const target = actorById.get(targetActorId)
    if (!target) return { vacated: false, composition: null, motion: null }
    const composition = composeIncomingMomentum({
      target,
      incomingM,
      incomingAxis,
      mode: incomingCompositionMode,
    })
    const targetBeforeM = actorM(target)
    conflictEvents.push({
      kind: 'momentum-transfer',
      sourceActorId: depth === 0 ? 'player' : null,
      targetActorId,
      sourceBeforeM: incomingM,
      sourceAfterM: 0,
      targetBeforeM,
      targetAfterM: composition.momentum,
      directionId: incomingAxis,
      model: STRIKE_RULE,
      composition,
      chained: depth > 0,
      motionTraceRule: CELL_MOTION_TRACE_RULE,
    })
    target.axisId = composition.axisId
    target.momentumLevel = composition.momentum
    target.velocity = velocityFor(composition.axisId, composition.momentum)
    const motion = composition.momentum > 0 && composition.axisId
      ? moveActor(targetActorId, composition.axisId, composition.momentum, depth)
      : { vacated: false, momentumAfter: composition.momentum, axisAfter: composition.axisId, motion: null }
    return { ...motion, composition }
  }

  return {
    actorStates,
    actorById,
    occupancy,
    actorTrajectories,
    actorMotionTrace,
    causalOrder,
    moveActor,
    receiveStrike,
    playbackWindows: () => buildCausalPlaybackWindows(causalOrder, actorTrajectories),
  }
}

function transactionForPlan(plan) {
  if (plan?.actionTransaction) return { ...plan.actionTransaction }
  return {
    rule: 'legacy-plan-transaction-fallback',
    fromM: clampSystemM(plan?.beforeM ?? 0),
    toM: clampSystemM(plan?.finalM ?? plan?.beforeM ?? 0),
    cause: 'Use',
    status: 'pending',
  }
}

function applyTransaction(transaction, currentM, momentumEvents, conflictEvents) {
  const fromM = currentM
  const toM = clampSystemM(transaction.toM)
  const event = {
    fromM,
    toM,
    cause: transaction.cause,
    source: 'initiative-action',
    rule: transaction.rule,
  }
  if (fromM !== toM) {
    momentumEvents.push(event)
    conflictEvents.push({ kind: 'momentum-event', ...event })
  }
  return toM
}

export function resolveCellConflicts({
  plan,
  actors = [],
  obstacles = [],
  boardRadius = 7,
  incomingCompositionMode = TRUE_VECTOR_COMPOSITION,
}) {
  const initialActors = actors.map(cloneActor)
  if (!plan?.valid) return { ...plan, actorStates: initialActors, conflictEvents: [], momentumEvents: plan?.momentumEvents ?? [], pushAtomic: false }
  if (plan.spatialMode !== 'discrete') {
    return {
      ...plan,
      actorStates: initialActors,
      conflictEvents: [],
      pushAtomic: false,
      incomingCompositionMode,
      finalState: { ...plan.finalState, actors: initialActors.map(cloneActor) },
    }
  }

  const trace = (plan.motionTrace?.length ? plan.motionTrace : fallbackTrace(plan)).map((entry) => ({ ...entry }))
  if (!trace.length || initialActors.length === 0) {
    return {
      ...plan,
      actorStates: initialActors,
      conflictEvents: [],
      actorMotionTrace: {},
      actorTrajectories: Object.fromEntries(initialActors.map((actor) => [actor.id, [cloneHex(actor.hex)]])),
      pushAtomic: false,
      incomingCompositionMode,
      finalState: { ...plan.finalState, actors: initialActors.map(cloneActor) },
    }
  }

  const conflictEvents = []
  const momentumEvents = []
  const playerStart = cloneHex(trace[0]?.from ?? plan.traversedCells?.[0] ?? worldToAxialFallback(plan.finalState.position))
  let playerCell = cloneHex(playerStart)
  const playerRoute = [cloneHex(playerCell)]
  const playerVisualPoints = [axialToWorld(playerCell)]
  const processedTrace = []
  let playerConflict = null
  let currentM = clampSystemM(plan.beforeM ?? 0)
  let transactionResolved = false
  const transaction = transactionForPlan(plan)

  const actorMotion = createForcedMoveResolver({
    actors: initialActors,
    obstacles,
    boardRadius,
    reservedCells: [playerStart],
    conflictEvents,
    momentumEvents,
    incomingCompositionMode,
  })

  for (const rawEvent of trace) {
    const event = { ...rawEvent, momentumBefore: currentM, momentumAfter: currentM }
    if (event.collision?.position) pushVisualPoint(playerVisualPoints, event.collision.position)
    else if (event.context?.collision?.position) pushVisualPoint(playerVisualPoints, event.context.collision.position)

    if ((event.cost ?? 0) === 0) {
      processedTrace.push(event)
      continue
    }

    const next = cloneHex(event.to)
    const directionId = event.axisAfter ?? event.axisBefore ?? directionIdBetween(playerCell, next)
    const targetActorId = actorMotion.occupancy.get(axialKey(next))

    // Contact has priority over an initiative transaction that has not yet
    // earned its first successful Travel.
    if (targetActorId) {
      const impactM = currentM
      const targetBefore = actorMotion.actorById.get(targetActorId)
      const targetBeforeM = actorM(targetBefore)
      const attempted = impactM > 0
        ? actorMotion.receiveStrike(targetActorId, impactM, directionId, 0)
        : { vacated: false, composition: composeIncomingMomentum({ target: targetBefore, incomingM: 0, incomingAxis: directionId, mode: incomingCompositionMode }) }

      const composition = attempted.composition
      const momentumExchange = {
        sourceBeforeM: impactM,
        sourceAfterM: 0,
        targetBeforeM,
        targetAfterM: composition?.momentum ?? targetBeforeM,
        directionId,
        model: STRIKE_RULE,
      }
      conflictEvents.unshift({
        kind: impactM > 0 ? 'cell-conflict' : 'cell-conflict-blocked',
        sourceActorId: 'player',
        targetActorId,
        power: composition?.momentum ?? 0,
        impactM,
        cell: cloneHex(next),
        chained: false,
        contactBehavior: 'Strike',
        motionTraceRule: CELL_MOTION_TRACE_RULE,
      })
      momentumEvents.push({ actorId: 'player', fromM: impactM, toM: 0, cause: 'Transfer', targetActorId })

      if (!transactionResolved) {
        transactionResolved = true
        transaction.status = 'preempted-by-strike'
      }
      currentM = 0
      event.momentumAfter = 0

      if (impactM > 0 && attempted.vacated && !actorMotion.occupancy.has(axialKey(next))) {
        playerCell = cloneHex(next)
        playerRoute.push(cloneHex(playerCell))
        pushVisualPoint(playerVisualPoints, axialToWorld(playerCell))
        processedTrace.push({ ...event, actorConflict: targetActorId, actorVacated: true, stop: true })
        playerConflict = { targetActorId, impactM, resolved: true, directionId, momentumExchange, composition }
      } else {
        processedTrace.push({ ...event, kind: 'actor-blocked-entry', allowed: false, actorConflict: targetActorId, stop: true })
        playerConflict = { targetActorId, impactM, resolved: false, directionId, momentumExchange, composition }
      }
      break
    }

    playerCell = cloneHex(next)
    playerRoute.push(cloneHex(playerCell))
    pushVisualPoint(playerVisualPoints, axialToWorld(playerCell))

    if (!transactionResolved) {
      currentM = applyTransaction(transaction, currentM, momentumEvents, conflictEvents)
      transactionResolved = true
      transaction.status = 'committed'
      event.actionTransaction = { ...transaction }
    }
    event.momentumAfter = currentM
    processedTrace.push(event)
  }

  const actorStates = actorMotion.actorStates.map(cloneActor)
  const actorPlaybackWindows = buildCausalPlaybackWindows(actorMotion.causalOrder, actorMotion.actorTrajectories)

  if (!playerConflict) {
    return {
      ...plan,
      actionTransaction: transactionResolved ? { ...transaction, status: 'committed' } : plan.actionTransaction,
      actorStates,
      actorTrajectories: actorMotion.actorTrajectories,
      actorMotionTrace: actorMotion.actorMotionTrace,
      actorPlaybackWindows,
      conflictEvents,
      momentumEvents: [...(plan.momentumEvents ?? []), ...momentumEvents],
      pushAtomic: false,
      incomingCompositionMode,
      motionTraceRule: CELL_MOTION_TRACE_RULE,
      cellConflictMotionRule: CELL_CONFLICT_MOTION_RULE,
      finalState: { ...plan.finalState, actors: actorStates.map(cloneActor) },
    }
  }

  const finalAxisId = playerConflict.directionId ?? plan.axisAfter ?? plan.axisBefore
  const playerVelocity = velocityFor(finalAxisId, 0)
  const finalPosition = axialToWorld(playerCell)
  const samples = playerSamples(playerVisualPoints, plan, playerVelocity, finalAxisId)

  return {
    ...plan,
    samples,
    traversedCells: playerRoute,
    motionTrace: processedTrace,
    actorStates,
    actorTrajectories: actorMotion.actorTrajectories,
    actorMotionTrace: actorMotion.actorMotionTrace,
    actorPlaybackWindows,
    playerPlaybackEnd: playerConflict.resolved ? 0.44 : 1,
    conflictEvents,
    momentumEvents: [...(plan.momentumEvents ?? []), ...momentumEvents],
    pushAtomic: false,
    incomingCompositionMode,
    motionTraceRule: CELL_MOTION_TRACE_RULE,
    travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
    cellConflictMotionRule: CELL_CONFLICT_MOTION_RULE,
    finalState: {
      ...plan.finalState,
      position: finalPosition,
      velocity: playerVelocity,
      axisId: finalAxisId,
      actors: actorStates.map(cloneActor),
    },
    finalSpeed: 0,
    finalM: 0,
    actionTransaction: { ...transaction },
    cellConflict: {
      targetActorId: playerConflict.targetActorId,
      impactM: playerConflict.impactM,
      resolved: playerConflict.resolved,
      playerCell: cloneHex(playerCell),
      atomic: false,
      contactBehavior: 'Strike',
      resolution: STRIKE_RULE,
      motionResolution: CELL_CONFLICT_MOTION_RULE,
      surfaceGeometry: SURFACE_GEOMETRY_RULE,
      reflectionContinuation: plan.reflectionContinuation ?? REFLECTION_CONTINUATION_RULE,
      momentumExchange: playerConflict.momentumExchange,
      composition: playerConflict.composition,
      transferRefunded: false,
    },
  }
}

function worldToAxialFallback(position) {
  // Only used by malformed legacy plans. Normal v1 plans always provide trace.from.
  const x = Number(position?.x) || 0
  const z = Number(position?.z) || 0
  return { q: Math.round(x), r: Math.round(z) }
}
