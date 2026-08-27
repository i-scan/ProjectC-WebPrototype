import { axialKey, axialToWorld, directionVector, worldToAxialFraction } from './hex.js'
import { momentumLevel, momentumSpeed } from './solver.js'
import { SURFACE_GEOMETRY_RULE, REFLECTION_CONTINUATION_RULE } from './surface-geometry.js'
import { WALL_CELL_TRAVEL_RULE } from './wall-cell-reflection.js'
import {
  CELL_MOTION_TRACE_RULE,
  CELL_TRAVEL_BUDGET_RULE,
  directionIdBetween,
  runCellMotion,
} from './cell-motion.js'
import {
  ACTOR_COLLISION_RESTITUTION,
  REFLECTED_ACTOR_CONFLICT_RULE,
  WALL_TRAVEL_BUDGET_RULE,
  createConflictActors,
  conflictScenario,
  decorateConflictCells,
  exchangeActorMomentum,
} from './conflict-v2.js'

export {
  ACTOR_COLLISION_RESTITUTION,
  REFLECTED_ACTOR_CONFLICT_RULE,
  WALL_TRAVEL_BUDGET_RULE,
  createConflictActors,
  conflictScenario,
  decorateConflictCells,
  exchangeActorMomentum,
}

export const CELL_CONFLICT_MOTION_RULE = 'cell-conflict-consumes-motion-trace-v1'
export const ACTOR_MOTION_RULE = 'actor-knockback-cell-motion-v1'
export const CAUSAL_PLAYBACK_RULE = 'motion-trace-causal-playback-v1'

const cloneHex = (hex) => ({ q: hex.q, r: hex.r })
const cloneVelocity = (velocity = { x: 0, z: 0 }) => ({ x: velocity.x, z: velocity.z })
const cloneActor = (actor) => ({ ...actor, hex: cloneHex(actor.hex), velocity: cloneVelocity(actor.velocity) })
const sameHex = (a, b) => Boolean(a && b && a.q === b.q && a.r === b.r)
const clampM = (value) => Math.max(0, Math.min(3, Math.round(Number(value) || 0)))

function velocityFor(directionId, level) {
  if (!directionId || level <= 0) return { x: 0, z: 0 }
  const direction = directionVector(directionId)
  const speed = momentumSpeed(level)
  return { x: direction.x * speed, z: direction.z * speed }
}

function scalarActorM(actor) {
  return momentumLevel(Math.hypot(actor?.velocity?.x ?? 0, actor?.velocity?.z ?? 0))
}

function surfaceBounceM(power, obstacle, boundary, surfaceRestitution, boundaryRestitution) {
  const restitution = obstacle?.kind === 'reflector'
    ? Math.min(0.92, surfaceRestitution + 0.22)
    : boundary
      ? boundaryRestitution
      : surfaceRestitution
  return {
    restitution,
    momentum: momentumLevel(momentumSpeed(clampM(power)) * restitution),
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
  let momentum = clampM(plan.beforeM ?? momentumLevel(plan.beforeSpeed ?? 0))
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
      momentumBefore: momentum,
      momentumAfter: momentum,
      remainingBefore: Math.max(0, cells.length - 1 - index),
      remainingAfter: Math.max(0, cells.length - 2 - index),
      allowed: true,
      motionTraceRule: 'legacy-adjacent-trace-fallback-v1',
      travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
      context: null,
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
      kind: 'wall-crash',
      actorId,
      power: collision.beforeM,
      obstacleId: collision.obstacleId ?? null,
      obstacleKind: boundary ? 'boundary' : collision.kind,
      geometryKind: collision.geometryKind,
      from: collision.from ? cloneHex(collision.from) : undefined,
      cell: cloneHex(collision.contactCell),
      contactPoint: { ...collision.position },
      faceIds: [...(collision.faceIds ?? [])],
      surfaceGeometry: SURFACE_GEOMETRY_RULE,
      reflectionContinuation: collision.reflectionContinuation,
      wallCellPivot: Boolean(collision.wallCellPivot),
      wallCellTravelCost: collision.wallCellTravelCost ?? 0,
      wallAxis: collision.wallAxis ?? null,
      travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
      motionTraceRule: CELL_MOTION_TRACE_RULE,
    })
    conflictEvents.push({
      kind: collision.reflection ? 'surface-reflection' : 'surface-stop',
      actorId,
      obstacleKind: boundary ? 'boundary' : collision.kind,
      geometryKind: collision.geometryKind,
      obstacleId: collision.obstacleId ?? null,
      from: collision.from ? cloneHex(collision.from) : undefined,
      contactPoint: { ...collision.position },
      attemptedCell: cloneHex(collision.attemptedCell),
      to: collision.reflection && collision.axisAfter
        ? undefined
        : collision.from ? cloneHex(collision.from) : undefined,
      axisBefore: collision.axisBefore,
      axisAfter: collision.reflection ? collision.axisAfter : null,
      reflectedAxis: collision.reflection ? collision.axisAfter : null,
      beforeM: collision.beforeM,
      afterM: collision.afterM,
      restitution: collision.restitution,
      normal: collision.normal ? { ...collision.normal } : null,
      reflectedVector: collision.reflectedVector ? { ...collision.reflectedVector } : null,
      faceIds: [...(collision.faceIds ?? [])],
      surfaceGeometry: SURFACE_GEOMETRY_RULE,
      reflectionContinuation: collision.reflectionContinuation,
      ambiguousVertexBranch: Boolean(collision.ambiguousVertexBranch),
      wallCellPivot: Boolean(collision.wallCellPivot),
      wallCellTravelCost: collision.wallCellTravelCost ?? 0,
      wallAxis: collision.wallAxis ?? null,
      travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
      motionTraceRule: CELL_MOTION_TRACE_RULE,
    })
  }
}

function createActorMotionResolver({
  actors,
  obstacles,
  boardRadius,
  reservedCells,
  surfaceRestitution,
  boundaryRestitution,
  conflictEvents,
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

  const moveActor = (actorId, axisId, power, depth = 0, sourceReflected = false) => {
    const actor = actorById.get(actorId)
    if (!actor || power <= 0 || depth > actorStates.length + 4) {
      return { vacated: false, momentumAfter: 0, axisAfter: axisId, motion: null }
    }

    noteMotion(actorId, depth)
    const startHex = cloneHex(actor.hex)

    const motion = runCellMotion({
      startHex,
      initialAxisId: axisId,
      initialMomentum: power,
      travelBudget: power,
      authoredPathCells: [],
      obstacles,
      boardRadius,
      capRemainingByMomentum: true,
      reflectionMomentum: ({ momentum, obstacle, boundary }) => (
        surfaceBounceM(momentum, obstacle, boundary, surfaceRestitution, boundaryRestitution)
      ),
      onEnterCell: ({ from, to, axisId: entryAxis, momentum, reflected }) => {
        const sameAsCurrent = sameHex(from, to)
        if (reserved.has(axialKey(to)) && !sameAsCurrent) {
          conflictEvents.push({
            kind: 'reserved-cell-stop', actorId,
            cell: cloneHex(from), attemptedCell: cloneHex(to),
            beforeM: momentum, afterM: 0,
            motionTraceRule: CELL_MOTION_TRACE_RULE,
          })
          return { allowed: false, stop: true, momentum: 0, reason: 'reserved-player-cell' }
        }

        const occupantId = occupancy.get(axialKey(to))
        if (occupantId && occupantId !== actorId) {
          const target = actorById.get(occupantId)
          const useCurrentExchange = Boolean(reflected || sourceReflected)
          let childPower
          let sourceAfterM
          let transfer
          let model

          if (useCurrentExchange) {
            transfer = exchangeActorMomentum({
              sourceM: momentum,
              targetVelocity: target?.velocity,
              directionId: entryAxis,
            })
            childPower = transfer.targetAfterM
            sourceAfterM = transfer.sourceAfterM
            model = REFLECTED_ACTOR_CONFLICT_RULE
          } else {
            childPower = Math.max(1, momentum - 1)
            sourceAfterM = momentum
            transfer = {
              sourceBeforeM: momentum,
              sourceAfterM,
              targetBeforeM: scalarActorM(target),
              targetAfterM: childPower,
              directionId: entryAxis,
            }
            model = 'chain-decay-prototype'
          }

          conflictEvents.push({
            kind: 'cell-conflict', sourceActorId: actorId, targetActorId: occupantId,
            power: childPower, cell: cloneHex(to), chained: true,
            reflectedSource: useCurrentExchange,
            motionTraceRule: CELL_MOTION_TRACE_RULE,
          })
          conflictEvents.push({
            kind: 'momentum-transfer', sourceActorId: actorId, targetActorId: occupantId,
            ...transfer, chained: true, model, reflectedSource: useCurrentExchange,
            motionTraceRule: CELL_MOTION_TRACE_RULE,
          })

          if (childPower <= 0) {
            return { allowed: false, stop: true, momentum: sourceAfterM, reason: 'target-no-knockback' }
          }

          const child = moveActor(occupantId, entryAxis, childPower, depth + 1, useCurrentExchange)
          const targetStillHere = occupancy.get(axialKey(to)) === occupantId
          if (!child.vacated || targetStillHere) {
            conflictEvents.push({
              kind: 'cell-conflict-blocked', sourceActorId: actorId, targetActorId: occupantId,
              power: childPower, cell: cloneHex(to), chained: true,
              reflectedSource: useCurrentExchange,
              partial: true,
              motionTraceRule: CELL_MOTION_TRACE_RULE,
            })
            return { allowed: false, stop: true, momentum: sourceAfterM, reason: 'target-did-not-vacate' }
          }

          occupancy.delete(axialKey(from))
          occupancy.set(axialKey(to), actorId)
          return { allowed: true, momentum: sourceAfterM }
        }

        if (!sameAsCurrent) {
          occupancy.delete(axialKey(from))
          occupancy.set(axialKey(to), actorId)
        }
        return { allowed: true }
      },
    })

    actor.hex = cloneHex(motion.finalHex)
    actor.axisId = motion.axisAfter
    actor.velocity = velocityFor(motion.axisAfter, motion.momentumAfter)
    translateSurfaceEvents(actorId, motion, conflictEvents)
    mergeTrajectory(actorTrajectories[actorId], trajectoryFromTimeline(motion.timeline))
    actorMotionTrace[actorId].push(...motion.trace.map((entry) => ({ ...entry })))

    return {
      vacated: !sameHex(startHex, actor.hex),
      momentumAfter: motion.momentumAfter,
      axisAfter: motion.axisAfter,
      motion,
    }
  }

  return {
    actorStates,
    actorById,
    occupancy,
    actorTrajectories,
    actorMotionTrace,
    causalOrder,
    moveActor,
    playbackWindows: () => buildCausalPlaybackWindows(causalOrder, actorTrajectories),
  }
}

export function resolveCellConflicts({
  plan,
  actors = [],
  obstacles = [],
  boardRadius = 7,
  surfaceRestitution = 0.58,
  boundaryRestitution = 0.42,
}) {
  const initialActors = actors.map(cloneActor)
  if (!plan?.valid) return { ...plan, actorStates: initialActors, conflictEvents: [], pushAtomic: false }
  if (plan.spatialMode !== 'discrete') {
    return {
      ...plan,
      actorStates: initialActors,
      conflictEvents: [],
      pushAtomic: false,
      finalState: { ...plan.finalState, actors: initialActors.map(cloneActor) },
    }
  }

  if (initialActors.length === 0) {
    return {
      ...plan,
      actorStates: initialActors,
      conflictEvents: [],
      actorMotionTrace: {},
      pushAtomic: false,
      finalState: { ...plan.finalState, actors: [] },
    }
  }

  const trace = (plan.motionTrace?.length ? plan.motionTrace : fallbackTrace(plan)).map((entry) => ({ ...entry }))
  if (!trace.length) {
    return {
      ...plan,
      actorStates: initialActors,
      conflictEvents: [],
      actorMotionTrace: {},
      pushAtomic: false,
      finalState: { ...plan.finalState, actors: initialActors.map(cloneActor) },
    }
  }

  const conflictEvents = []
  const playerStart = cloneHex(trace[0]?.from ?? plan.traversedCells?.[0] ?? plan.finalState.position)
  let playerCell = cloneHex(playerStart)
  const playerRoute = [cloneHex(playerCell)]
  const playerVisualPoints = [axialToWorld(playerCell)]
  const processedTrace = []
  let playerConflict = null

  const actorMotion = createActorMotionResolver({
    actors: initialActors,
    obstacles,
    boardRadius,
    reservedCells: [playerStart],
    surfaceRestitution,
    boundaryRestitution,
    conflictEvents,
  })

  for (const event of trace) {
    if (event.collision?.position) pushVisualPoint(playerVisualPoints, event.collision.position)
    else if (event.context?.collision?.position) pushVisualPoint(playerVisualPoints, event.context.collision.position)

    if ((event.cost ?? 0) === 0) {
      processedTrace.push({ ...event })
      continue
    }

    const next = cloneHex(event.to)
    const directionId = event.axisAfter ?? event.axisBefore ?? directionIdBetween(playerCell, next)
    const targetActorId = actorMotion.occupancy.get(axialKey(next))

    if (!targetActorId) {
      playerCell = cloneHex(next)
      playerRoute.push(cloneHex(playerCell))
      pushVisualPoint(playerVisualPoints, axialToWorld(playerCell))
      processedTrace.push({ ...event })
      continue
    }

    const impactM = clampM(event.momentumAfter ?? event.momentumBefore ?? plan.beforeM ?? 0)
    const targetActor = actorMotion.actorById.get(targetActorId)
    const momentumExchange = exchangeActorMomentum({
      sourceM: impactM,
      targetVelocity: targetActor?.velocity,
      directionId,
    })

    conflictEvents.push({
      kind: impactM > 0 ? 'cell-conflict' : 'cell-conflict-blocked',
      sourceActorId: 'player', targetActorId,
      power: momentumExchange.targetAfterM, impactM,
      cell: cloneHex(next), chained: false,
      motionTraceRule: CELL_MOTION_TRACE_RULE,
    })
    conflictEvents.push({
      kind: 'momentum-transfer', sourceActorId: 'player', targetActorId,
      ...momentumExchange, chained: false, model: 'equal-mass-1d',
      motionTraceRule: CELL_MOTION_TRACE_RULE,
    })

    if (impactM <= 0 || momentumExchange.targetAfterM <= 0) {
      processedTrace.push({ ...event, kind: 'actor-blocked-entry', allowed: false, actorConflict: targetActorId })
      playerConflict = { targetActorId, impactM, resolved: false, directionId, momentumExchange }
      break
    }

    const reserved = [next, playerCell]
    const targetMover = createActorMotionResolver({
      actors: actorMotion.actorStates,
      obstacles,
      boardRadius,
      reservedCells: reserved,
      surfaceRestitution,
      boundaryRestitution,
      conflictEvents,
    })
    const attempted = targetMover.moveActor(targetActorId, directionId, momentumExchange.targetAfterM, 0, false)

    // Replace the shared Actor snapshot with the authoritative result from the
    // knockback motion tree. The player has not entered `next` yet, so it is
    // still reserved throughout the target's movement.
    actorMotion.actorStates.splice(0, actorMotion.actorStates.length, ...targetMover.actorStates.map(cloneActor))
    actorMotion.actorById.clear()
    targetMover.actorStates.forEach((actor) => actorMotion.actorById.set(actor.id, actor))
    actorMotion.occupancy.clear()
    targetMover.actorStates.forEach((actor) => actorMotion.occupancy.set(axialKey(actor.hex), actor.id))
    Object.assign(actorMotion.actorTrajectories, targetMover.actorTrajectories)
    Object.assign(actorMotion.actorMotionTrace, targetMover.actorMotionTrace)
    for (const [id, meta] of targetMover.causalOrder.entries()) actorMotion.causalOrder.set(id, meta)

    if (attempted.vacated && !actorMotion.occupancy.has(axialKey(next))) {
      playerCell = cloneHex(next)
      playerRoute.push(cloneHex(playerCell))
      pushVisualPoint(playerVisualPoints, axialToWorld(playerCell))
      processedTrace.push({ ...event, actorConflict: targetActorId, actorVacated: true })
      playerConflict = { targetActorId, impactM, resolved: true, directionId, momentumExchange }
    } else {
      conflictEvents.push({
        kind: 'cell-conflict-blocked', sourceActorId: 'player', targetActorId,
        power: momentumExchange.targetAfterM, impactM, cell: cloneHex(next), chained: false,
        partial: attempted.vacated,
        motionTraceRule: CELL_MOTION_TRACE_RULE,
      })
      processedTrace.push({ ...event, kind: 'actor-blocked-entry', allowed: false, actorConflict: targetActorId })
      playerConflict = { targetActorId, impactM, resolved: false, directionId, momentumExchange }
    }
    break
  }

  const actorStates = actorMotion.actorStates.map(cloneActor)
  const actorPlaybackWindows = buildCausalPlaybackWindows(actorMotion.causalOrder, actorMotion.actorTrajectories)

  if (!playerConflict) {
    return {
      ...plan,
      actorStates,
      actorTrajectories: actorMotion.actorTrajectories,
      actorMotionTrace: actorMotion.actorMotionTrace,
      actorPlaybackWindows,
      conflictEvents,
      pushAtomic: false,
      motionTraceRule: CELL_MOTION_TRACE_RULE,
      cellConflictMotionRule: CELL_CONFLICT_MOTION_RULE,
      finalState: { ...plan.finalState, actors: actorStates.map(cloneActor) },
    }
  }

  const finalPlayerM = playerConflict.resolved
    ? Math.min(Math.max(0, plan.finalM ?? 0), playerConflict.momentumExchange?.sourceAfterM ?? 0)
    : 0
  const finalAxisId = playerConflict.directionId ?? plan.axisAfter ?? plan.axisBefore
  const playerVelocity = velocityFor(finalAxisId, finalPlayerM)
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
    pushAtomic: false,
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
    finalSpeed: Math.hypot(playerVelocity.x, playerVelocity.z),
    finalM: finalPlayerM,
    cellConflict: {
      targetActorId: playerConflict.targetActorId,
      impactM: playerConflict.impactM,
      resolved: playerConflict.resolved,
      playerCell: cloneHex(playerCell),
      atomic: false,
      resolution: 'stepwise-clipped-mirror-v2',
      motionResolution: CELL_CONFLICT_MOTION_RULE,
      surfaceGeometry: SURFACE_GEOMETRY_RULE,
      reflectionContinuation: plan.reflectionContinuation ?? REFLECTION_CONTINUATION_RULE,
      momentumExchange: playerConflict.momentumExchange ?? null,
    },
  }
}
