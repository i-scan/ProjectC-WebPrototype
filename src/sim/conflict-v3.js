import { HEX_DIRECTIONS, axialDistance, axialKey, axialToWorld, directionVector } from './hex.js'
import { momentumLevel, momentumSpeed } from './solver.js'
import { internalWallCellImpact } from './wall-cell-reflection.js'
import {
  ACTOR_COLLISION_RESTITUTION,
  REFLECTED_ACTOR_CONFLICT_RULE,
  WALL_TRAVEL_BUDGET_RULE,
  exchangeActorMomentum,
} from './conflict-v2.js'
import { resolveCellConflicts as resolveCellConflictsCompat } from './conflict-compat.js'

export * from './conflict-compat.js'

export const CURRENT_M_TRAVEL_RULE = 'remaining-travel-capped-by-current-m-v1'
export const REFLECTED_CONTACT_PLAYBACK_RULE = 'reflected-contact-causal-window-v1'

const cloneHex = (hex) => ({ q: hex.q, r: hex.r })
const cloneVelocity = (velocity = { x: 0, z: 0 }) => ({ x: velocity.x, z: velocity.z })
const cloneActor = (actor) => ({ ...actor, hex: cloneHex(actor.hex), velocity: cloneVelocity(actor.velocity) })
const sameHex = (a, b) => Boolean(a && b && a.q === b.q && a.r === b.r)
const clampM = (value) => Math.max(0, Math.min(3, Math.round(Number(value) || 0)))

function directionById(id) {
  return HEX_DIRECTIONS.find((entry) => entry.id === id) ?? null
}

function stepCell(cell, direction) {
  return { q: cell.q + direction.q, r: cell.r + direction.r }
}

function obstacleAt(obstacles, hex) {
  return obstacles.find((entry) => sameHex(entry.hex, hex)) ?? null
}

function velocityFor(directionId, level) {
  if (!directionId || level <= 0) return { x: 0, z: 0 }
  const direction = directionVector(directionId)
  const speed = momentumSpeed(level)
  return { x: direction.x * speed, z: direction.z * speed }
}

function surfaceBounceM(power, obstacle, surfaceRestitution) {
  const restitution = obstacle?.kind === 'reflector'
    ? Math.min(0.92, surfaceRestitution + 0.22)
    : surfaceRestitution
  return {
    restitution,
    momentum: momentumLevel(momentumSpeed(clampM(power)) * restitution),
  }
}

function compactTrajectory(path = []) {
  const result = []
  for (const point of path) {
    if (!result.length || !sameHex(result.at(-1), point)) result.push(cloneHex(point))
  }
  return result
}

function buildCausalPlaybackWindows(meta, trajectories) {
  const entries = [...meta.entries()]
    .filter(([id]) => (trajectories[id]?.length ?? 0) > 1)
    .sort((a, b) => a[1].startTick - b[1].startTick || a[1].depth - b[1].depth)
  if (!entries.length) return {}
  const maxTick = Math.max(1, ...entries.map(([, value]) => value.endTick))
  const windows = {}
  for (const [id, value] of entries) {
    const start = 0.46 + (value.startTick / maxTick) * 0.28
    const end = Math.min(0.92, Math.max(start + 0.12, 0.50 + (value.endTick / maxTick) * 0.38))
    windows[id] = { start, end }
  }
  return windows
}

function canonicalInternalWallKnockback({
  actors,
  actorId,
  directionId,
  power,
  obstacles,
  boardRadius,
  reservedCells = [],
  surfaceRestitution = 0.58,
}) {
  const shadowActors = actors.map(cloneActor)
  const actorById = new Map(shadowActors.map((actor) => [actor.id, actor]))
  const occupancy = new Map(shadowActors.map((actor) => [axialKey(actor.hex), actor.id]))
  const reserved = new Set(reservedCells.map(axialKey))
  const trajectories = Object.fromEntries(shadowActors.map((actor) => [actor.id, [cloneHex(actor.hex)]]))
  const events = []
  const playbackMeta = new Map()
  const legacyRestoreM = new Map()
  let globalTick = 0

  const touchMeta = (id, depth) => {
    const current = playbackMeta.get(id)
    if (!current) playbackMeta.set(id, { startTick: globalTick, endTick: globalTick + 1, depth })
    else current.endTick = Math.max(current.endTick, globalTick + 1)
  }

  const moveActor = (currentActorId, initialDirectionId, initialPower, depth = 0) => {
    const actor = actorById.get(currentActorId)
    if (!actor || depth > shadowActors.length + 4) return { vacated: false, activeM: 0, remainingTravel: 0 }
    const startHex = cloneHex(actor.hex)
    let activeDirection = directionById(initialDirectionId)
    let activeM = clampM(initialPower)
    let remainingTravel = clampM(initialPower)
    let hasReflected = false
    let guard = 0

    if (!activeDirection || activeM <= 0 || remainingTravel <= 0) {
      return { vacated: false, activeM: 0, remainingTravel: 0 }
    }

    touchMeta(currentActorId, depth)

    const enterCell = (next, { cost = 1, costAlreadyPaid = false } = {}) => {
      const sameAsCurrent = sameHex(next, actor.hex)
      if (reserved.has(axialKey(next)) && !sameAsCurrent) {
        activeM = 0
        remainingTravel = 0
        actor.velocity = { x: 0, z: 0 }
        events.push({
          kind: 'reserved-cell-stop', actorId: currentActorId,
          cell: cloneHex(actor.hex), attemptedCell: cloneHex(next),
          afterM: 0, remainingTravel: 0,
          travelBudgetRule: CURRENT_M_TRAVEL_RULE,
        })
        return false
      }

      const occupantId = occupancy.get(axialKey(next))
      if (occupantId && occupantId !== currentActorId) {
        const targetActor = actorById.get(occupantId)
        let transfer
        let childPower
        let sourceAfterM
        let model

        if (hasReflected) {
          transfer = exchangeActorMomentum({
            sourceM: activeM,
            targetVelocity: targetActor?.velocity,
            directionId: activeDirection.id,
            restitution: ACTOR_COLLISION_RESTITUTION,
          })
          childPower = transfer.targetAfterM
          sourceAfterM = transfer.sourceAfterM
          model = REFLECTED_ACTOR_CONFLICT_RULE
        } else {
          childPower = Math.max(1, activeM - 1)
          sourceAfterM = Math.max(0, activeM - childPower)
          transfer = {
            sourceBeforeM: activeM,
            sourceAfterM,
            targetBeforeM: momentumLevel(Math.hypot(targetActor?.velocity?.x ?? 0, targetActor?.velocity?.z ?? 0)),
            targetAfterM: childPower,
          }
          model = 'chain-decay-prototype'
          legacyRestoreM.set(currentActorId, activeM)
        }

        events.push({
          kind: 'cell-conflict', sourceActorId: currentActorId, targetActorId: occupantId,
          power: childPower, cell: cloneHex(next), chained: true,
          reflectedSource: hasReflected,
          remainingTravelBefore: remainingTravel,
          travelBudgetRule: CURRENT_M_TRAVEL_RULE,
        })
        events.push({
          kind: 'momentum-transfer', sourceActorId: currentActorId, targetActorId: occupantId,
          ...transfer, chained: true, model, reflectedSource: hasReflected,
          travelBudgetRule: CURRENT_M_TRAVEL_RULE,
        })

        if (childPower <= 0) {
          activeM = sourceAfterM
          remainingTravel = Math.min(remainingTravel, activeM)
          actor.velocity = velocityFor(activeDirection.id, activeM)
          return false
        }

        const child = moveActor(occupantId, activeDirection.id, childPower, depth + 1)
        activeM = sourceAfterM
        remainingTravel = Math.min(remainingTravel, activeM)
        if (!child.vacated || occupancy.get(axialKey(next)) === occupantId) {
          actor.velocity = velocityFor(activeDirection.id, activeM)
          events.push({
            kind: 'cell-conflict-blocked', sourceActorId: currentActorId, targetActorId: occupantId,
            power: childPower, cell: cloneHex(next), chained: true,
            reflectedSource: hasReflected,
            remainingTravelAfter: remainingTravel,
            travelBudgetRule: CURRENT_M_TRAVEL_RULE,
          })
          return false
        }
      }

      if (!sameAsCurrent) {
        occupancy.delete(axialKey(actor.hex))
        actor.hex = cloneHex(next)
        occupancy.set(axialKey(actor.hex), actor.id)
      }
      trajectories[currentActorId].push(cloneHex(actor.hex))
      if (!costAlreadyPaid) remainingTravel = Math.max(0, remainingTravel - cost)
      globalTick += 1
      touchMeta(currentActorId, depth)
      return true
    }

    while (remainingTravel > 0 && activeM > 0 && guard < 24) {
      guard += 1
      const next = stepCell(actor.hex, activeDirection)
      const obstacle = obstacleAt(obstacles, next)
      const wallImpact = obstacle?.wallAxis
        ? internalWallCellImpact({ obstacle, incomingAxisId: activeDirection.id })
        : null

      if (wallImpact) {
        const beforeM = activeM
        const beforeRemaining = remainingTravel
        const bounce = surfaceBounceM(activeM, obstacle, surfaceRestitution)
        trajectories[currentActorId].push(cloneHex(wallImpact.pivotHex))
        remainingTravel = Math.max(0, remainingTravel - (wallImpact.wallCellTravelCost ?? 1))
        activeDirection = wallImpact.direction
        activeM = bounce.momentum
        remainingTravel = Math.min(remainingTravel, activeM)
        hasReflected = true
        actor.axisId = activeDirection.id
        actor.velocity = velocityFor(activeDirection.id, activeM)
        events.push({
          kind: 'wall-crash', actorId: currentActorId,
          obstacleId: obstacle.id, obstacleKind: obstacle.kind ?? 'hard',
          geometryKind: wallImpact.kind,
          from: cloneHex(actor.hex), cell: cloneHex(wallImpact.pivotHex),
          contactPoint: { ...wallImpact.point },
          wallCellPivot: true, wallCellTravelCost: wallImpact.wallCellTravelCost ?? 1,
          wallAxis: wallImpact.wallAxis,
          beforeM, afterM: activeM,
          remainingTravelBefore: beforeRemaining,
          remainingTravelAfter: remainingTravel,
          travelBudgetRule: CURRENT_M_TRAVEL_RULE,
        })
        events.push({
          kind: 'surface-reflection', actorId: currentActorId,
          obstacleId: obstacle.id, obstacleKind: obstacle.kind ?? 'hard',
          geometryKind: wallImpact.kind,
          from: cloneHex(actor.hex), attemptedCell: cloneHex(wallImpact.pivotHex),
          to: cloneHex(wallImpact.exitHex),
          axisBefore: wallImpact.direction.id === activeDirection.id ? null : undefined,
          axisAfter: activeDirection.id,
          beforeM, afterM: activeM,
          restitution: bounce.restitution,
          wallCellPivot: true, wallCellTravelCost: wallImpact.wallCellTravelCost ?? 1,
          wallAxis: wallImpact.wallAxis,
          travelBudgetRule: WALL_TRAVEL_BUDGET_RULE,
          currentMTravelRule: CURRENT_M_TRAVEL_RULE,
        })

        const entered = enterCell(wallImpact.exitHex, { costAlreadyPaid: true })
        if (!entered && !sameHex(wallImpact.exitHex, actor.hex)) break
        if (remainingTravel <= 0 || activeM <= 0) break
        continue
      }

      if (axialDistance(next) > boardRadius || obstacle) {
        activeM = 0
        remainingTravel = 0
        actor.velocity = { x: 0, z: 0 }
        events.push({
          kind: 'surface-stop', actorId: currentActorId,
          cell: cloneHex(actor.hex), attemptedCell: cloneHex(next),
          afterM: 0, remainingTravel: 0,
          travelBudgetRule: CURRENT_M_TRAVEL_RULE,
        })
        break
      }

      const entered = enterCell(next)
      if (!entered) break
    }

    const restoreM = legacyRestoreM.get(currentActorId)
    if (restoreM != null && !hasReflected && actor.axisId) actor.velocity = velocityFor(actor.axisId, restoreM)
    else actor.velocity = activeM > 0 ? velocityFor(activeDirection.id, activeM) : { x: 0, z: 0 }
    actor.axisId = activeDirection.id
    trajectories[currentActorId] = compactTrajectory(trajectories[currentActorId])
    return {
      vacated: !sameHex(actor.hex, startHex),
      activeM,
      remainingTravel,
      direction: activeDirection,
    }
  }

  const result = moveActor(actorId, directionId, power)
  return {
    moved: result.vacated,
    actors: shadowActors.map(cloneActor),
    events,
    trajectories,
    actorPlaybackWindows: buildCausalPlaybackWindows(playbackMeta, trajectories),
  }
}

function primaryPrefix(events, targetActorId) {
  const index = events.findIndex((event) => (
    event.actorId === targetActorId
    || (event.sourceActorId && event.sourceActorId !== 'player')
  ))
  return index < 0 ? events.filter((event) => event.sourceActorId === 'player') : events.slice(0, index)
}

export function resolveCellConflicts(input) {
  const baseline = resolveCellConflictsCompat(input)
  const reflectedTransfer = baseline?.conflictEvents?.find((event) => (
    event.kind === 'momentum-transfer'
    && event.model === REFLECTED_ACTOR_CONFLICT_RULE
    && event.reflectedSource
  ))
  if (!reflectedTransfer) return baseline

  const primaryTransfer = baseline.conflictEvents.find((event) => (
    event.kind === 'momentum-transfer'
    && event.sourceActorId === 'player'
    && event.chained === false
  ))
  const primaryConflict = baseline.conflictEvents.find((event) => (
    event.kind === 'cell-conflict'
    && event.sourceActorId === 'player'
    && event.chained === false
  ))
  const targetActorId = primaryTransfer?.targetActorId ?? baseline.cellConflict?.targetActorId
  const directionId = primaryTransfer?.directionId ?? baseline.cellConflict?.momentumExchange?.directionId
  const power = clampM(primaryTransfer?.targetAfterM ?? primaryConflict?.power ?? 0)
  const contactCell = primaryConflict?.cell
  if (!targetActorId || !directionId || !contactCell || power <= 0) return baseline

  const route = input.plan?.traversedCells ?? []
  const contactIndex = route.findIndex((cell) => sameHex(cell, contactCell))
  const playerBeforeContact = contactIndex > 0 ? route[contactIndex - 1] : route[0]
  const rerun = canonicalInternalWallKnockback({
    actors: input.actors ?? [],
    actorId: targetActorId,
    directionId,
    power,
    obstacles: input.obstacles ?? [],
    boardRadius: input.boardRadius ?? 7,
    reservedCells: [contactCell, playerBeforeContact].filter(Boolean),
    surfaceRestitution: input.surfaceRestitution ?? 0.58,
  })

  const actorStates = rerun.actors.map(cloneActor)
  const finalActors = actorStates.map(cloneActor)
  const mergedEvents = [
    ...primaryPrefix(baseline.conflictEvents ?? [], targetActorId),
    ...rerun.events,
  ]

  return {
    ...baseline,
    actorStates,
    actorTrajectories: rerun.trajectories,
    actorPlaybackWindows: rerun.actorPlaybackWindows,
    conflictEvents: mergedEvents,
    travelBudgetRule: CURRENT_M_TRAVEL_RULE,
    reflectedContactPlaybackRule: REFLECTED_CONTACT_PLAYBACK_RULE,
    finalState: baseline.finalState
      ? { ...baseline.finalState, actors: finalActors }
      : baseline.finalState,
    cellConflict: baseline.cellConflict
      ? { ...baseline.cellConflict, resolution: 'stepwise-clipped-mirror-v2' }
      : baseline.cellConflict,
  }
}
