import { HEX_DIRECTIONS, axialDistance, axialKey, axialToWorld, directionVector } from './hex.js'
import { momentumLevel, momentumSpeed } from './solver.js'
import {
  SURFACE_GEOMETRY_RULE,
  firstSurfaceImpact,
  fractionalHexForWorldPoint,
  mirrorHexDirection,
  nudgeFromSurface,
} from './surface-geometry.js'

export const ACTOR_COLLISION_RESTITUTION = 0.75

const cloneHex = (hex) => ({ q: hex.q, r: hex.r })
const cloneVelocity = (velocity = { x: 0, z: 0 }) => ({ x: velocity.x, z: velocity.z })
const cloneActor = (actor) => ({ ...actor, hex: cloneHex(actor.hex), velocity: cloneVelocity(actor.velocity) })
const sameHex = (a, b) => Boolean(a && b && a.q === b.q && a.r === b.r)
const clampM = (value) => Math.max(0, Math.min(3, Math.round(Number(value) || 0)))

function directionFromStep(from, to) {
  const delta = { q: to.q - from.q, r: to.r - from.r }
  return HEX_DIRECTIONS.find((entry) => entry.q === delta.q && entry.r === delta.r) ?? null
}

function velocityFor(directionId, level) {
  if (!directionId || level <= 0) return { x: 0, z: 0 }
  const direction = directionVector(directionId)
  const speed = momentumSpeed(level)
  return { x: direction.x * speed, z: direction.z * speed }
}

function uniqueRoute(cells = []) {
  const result = []
  for (const cell of cells) {
    if (!result.length || !sameHex(result.at(-1), cell)) result.push(cloneHex(cell))
  }
  return result
}

function scalarAlong(velocity, directionId) {
  if (!directionId) return 0
  const axis = directionVector(directionId)
  return (velocity?.x ?? 0) * axis.x + (velocity?.z ?? 0) * axis.z
}

export function exchangeActorMomentum({
  sourceM,
  targetVelocity = { x: 0, z: 0 },
  directionId,
  restitution = ACTOR_COLLISION_RESTITUTION,
}) {
  const e = Math.max(0, Math.min(1, Number(restitution) || 0))
  const sourceBeforeSpeed = momentumSpeed(clampM(sourceM))
  const targetBeforeSpeed = scalarAlong(targetVelocity, directionId)
  const sourceAfterSpeed = ((1 - e) * sourceBeforeSpeed + (1 + e) * targetBeforeSpeed) * 0.5
  const targetAfterSpeed = ((1 + e) * sourceBeforeSpeed + (1 - e) * targetBeforeSpeed) * 0.5
  const sourceAfterM = momentumLevel(Math.abs(sourceAfterSpeed))
  const targetBeforeM = momentumLevel(Math.abs(targetBeforeSpeed))
  const targetAfterM = momentumLevel(Math.abs(targetAfterSpeed))
  return {
    restitution: e,
    sourceBeforeM: clampM(sourceM),
    targetBeforeM,
    sourceAfterM,
    targetAfterM,
    sourceBeforeSpeed,
    targetBeforeSpeed,
    sourceAfterSpeed,
    targetAfterSpeed,
    directionId,
  }
}

export function createConflictActors(kind = 'chain') {
  if (kind === 'wall') {
    return [
      { id: 'dummy-a', label: 'A', hex: { q: 1, r: 0 }, velocity: { x: 0, z: 0 }, axisId: null },
    ]
  }

  return [
    { id: 'dummy-a', label: 'A', hex: { q: 2, r: 1 }, velocity: { x: 0, z: 0 }, axisId: null },
    { id: 'dummy-b', label: 'B', hex: { q: 4, r: 1 }, velocity: { x: 0, z: 0 }, axisId: null },
    { id: 'dummy-c', label: 'C', hex: { q: 5, r: 1 }, velocity: { x: 0, z: 0 }, axisId: null },
  ]
}

export function conflictScenario(kind = 'chain') {
  return {
    kind,
    playerHex: kind === 'wall' ? { q: -1, r: 0 } : { q: 0, r: 1 },
    directionId: 'E',
    momentum: 2,
    actors: createConflictActors(kind),
  }
}

export function decorateConflictCells(cells, actors = [], projectedActors = [], reachableCells = []) {
  const actualByKey = new Map(actors.map((actor) => [axialKey(actor.hex), actor]))
  const projectedByKey = new Map()
  const reachableByKey = new Map(reachableCells.map((entry) => [axialKey(entry.hex ?? entry), entry]))
  for (const actor of projectedActors) {
    const current = actors.find((entry) => entry.id === actor.id)
    if (current && !sameHex(current.hex, actor.hex)) projectedByKey.set(axialKey(actor.hex), actor)
  }

  return cells.map((cell) => {
    const actual = actualByKey.get(cell.key)
    const projected = projectedByKey.get(cell.key)
    const reachable = reachableByKey.get(cell.key)
    if (!actual && !projected && !reachable) return cell

    const tags = [...cell.tags]
    if (actual && !tags.includes('Shelter')) tags.push('Shelter')
    if (projected && !tags.some((tag) => tag === 'UT3ReflectLeft' || tag === 'UT3ReflectRight')) tags.push('UT3ReflectLeft')
    if (reachable && !tags.includes('BasicReachable')) tags.push('BasicReachable')

    const showReachable = Boolean(reachable && !actual && !projected)
    return {
      ...cell,
      groundFill: projected || showReachable ? 'ice' : cell.groundFill,
      moisture: projected || showReachable ? 0 : cell.moisture,
      tags,
      conflictActor: actual?.id ?? null,
      conflictProjection: projected?.id ?? null,
      basicReachable: reachable ? (reachable.rule ?? true) : null,
    }
  })
}

function obstacleAt(obstacles, hex) {
  return obstacles.find((entry) => sameHex(entry.hex, hex)) ?? null
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

function stepCell(cell, direction) {
  return { q: cell.q + direction.q, r: cell.r + direction.r }
}

function buildActorPlaybackWindows(orderByActor, trajectories) {
  const ordered = [...orderByActor.entries()]
    .filter(([id]) => (trajectories[id]?.length ?? 0) > 1)
    .sort((a, b) => a[1] - b[1])
  const windows = {}
  ordered.forEach(([id], index) => {
    const pathSteps = Math.max(1, Math.ceil(((trajectories[id]?.length ?? 2) - 1) / 2))
    const start = Math.min(0.72, 0.48 + index * 0.09)
    const duration = Math.min(0.32, 0.18 + pathSteps * 0.05)
    windows[id] = { start, end: Math.min(0.90, start + duration) }
  })
  return windows
}

function resolveStepwiseKnockback({
  actors,
  actorId,
  direction,
  power,
  obstacles,
  boardRadius,
  reservedCells = [],
  surfaceRestitution = 0.58,
  boundaryRestitution = 0.42,
}) {
  const shadowActors = actors.map(cloneActor)
  const actorById = new Map(shadowActors.map((actor) => [actor.id, actor]))
  const occupancy = new Map(shadowActors.map((actor) => [axialKey(actor.hex), actor.id]))
  const reserved = new Set(reservedCells.map(axialKey))
  const events = []
  const trajectories = Object.fromEntries(shadowActors.map((actor) => [actor.id, [cloneHex(actor.hex)]]))
  const motionOrder = new Map()
  let nextMotionOrder = 0

  const markMotionIntent = (id) => {
    if (!motionOrder.has(id)) motionOrder.set(id, nextMotionOrder++)
  }

  const legalReflectionCell = (cell, currentActorId) => {
    if (axialDistance(cell) > boardRadius) return false
    if (obstacleAt(obstacles, cell)) return false
    if (reserved.has(axialKey(cell))) return false
    const occupantId = occupancy.get(axialKey(cell))
    return !occupantId || occupantId === currentActorId
  }

  const moveActor = (currentActorId, initialDirection, initialPower, depth = 0) => {
    const actor = actorById.get(currentActorId)
    let activeM = clampM(initialPower)
    let activeDirection = initialDirection
    let movedSteps = 0
    let segmentStart = actor ? axialToWorld(actor.hex) : { x: 0, z: 0 }
    if (!actor || activeM <= 0 || depth > shadowActors.length + 3) {
      return { vacated: false, activeM: 0, direction: activeDirection }
    }

    markMotionIntent(currentActorId)
    const movementBudget = activeM
    for (let step = 0; step < movementBudget && activeM > 0; step += 1) {
      const next = stepCell(actor.hex, activeDirection)
      const nextWorld = axialToWorld(next)
      const obstacle = obstacleAt(obstacles, next)
      const impact = firstSurfaceImpact({
        fromWorld: segmentStart,
        toWorld: nextWorld,
        boardRadius,
        obstacle,
      })

      if (impact) {
        const boundary = impact.surface === 'boundary'
        const beforeM = activeM
        const axisBefore = activeDirection.id
        const bounce = surfaceBounceM(activeM, obstacle, boundary, surfaceRestitution, boundaryRestitution)
        events.push({
          kind: 'wall-crash',
          actorId: currentActorId,
          power: activeM,
          obstacleId: obstacle?.id ?? null,
          obstacleKind: boundary ? 'boundary' : obstacle?.kind ?? 'hard',
          geometryKind: impact.kind,
          from: cloneHex(actor.hex),
          cell: cloneHex(next),
          contactPoint: { ...impact.point },
          faceIds: [...(impact.faceIds ?? [])],
          surfaceGeometry: SURFACE_GEOMETRY_RULE,
          partial: movedSteps > 0,
        })
        trajectories[actor.id].push(fractionalHexForWorldPoint(impact.point))

        const mirror = mirrorHexDirection(activeDirection.id, impact.normal)
        const reflectedDirection = bounce.momentum > 0 ? mirror.direction : null
        const reflectedCell = reflectedDirection ? stepCell(actor.hex, reflectedDirection) : null
        const reflectionLegal = Boolean(reflectedCell && legalReflectionCell(reflectedCell, currentActorId))

        if (!reflectedDirection || !reflectionLegal) {
          activeM = 0
          actor.velocity = { x: 0, z: 0 }
          actor.axisId = activeDirection.id
          events.push({
            kind: 'surface-stop',
            actorId: currentActorId,
            obstacleKind: boundary ? 'boundary' : obstacle?.kind ?? 'hard',
            geometryKind: impact.kind,
            cell: cloneHex(actor.hex),
            attemptedCell: cloneHex(next),
            reflectedAxis: reflectedDirection?.id ?? null,
            reflectedCell: reflectedCell ? cloneHex(reflectedCell) : null,
            beforeM,
            afterM: 0,
            surfaceGeometry: SURFACE_GEOMETRY_RULE,
          })
          // The physical contact point is useful for preview, but an illegal
          // reflection ends at the authoritative current Cell. Returning to its
          // center in the trajectory prevents a visual snap on AT commit.
          trajectories[actor.id].push(cloneHex(actor.hex))
          break
        }

        activeDirection = reflectedDirection
        activeM = bounce.momentum
        trajectories[actor.id].push(fractionalHexForWorldPoint(nudgeFromSurface(impact.point, activeDirection.id)))
        occupancy.delete(axialKey(actor.hex))
        actor.hex = cloneHex(reflectedCell)
        occupancy.set(axialKey(actor.hex), actor.id)
        trajectories[actor.id].push(cloneHex(actor.hex))
        movedSteps += 1
        segmentStart = axialToWorld(actor.hex)
        actor.velocity = velocityFor(activeDirection.id, activeM)
        actor.axisId = activeDirection.id
        events.push({
          kind: 'surface-reflection',
          actorId: currentActorId,
          obstacleKind: boundary ? 'boundary' : obstacle?.kind ?? 'hard',
          geometryKind: impact.kind,
          obstacleId: obstacle?.id ?? null,
          from: cloneHex(trajectories[actor.id].at(-4) ?? actor.hex),
          contactPoint: { ...impact.point },
          attemptedCell: cloneHex(next),
          to: cloneHex(actor.hex),
          axisBefore,
          axisAfter: activeDirection.id,
          beforeM,
          afterM: activeM,
          restitution: bounce.restitution,
          normal: { ...impact.normal },
          faceIds: [...(impact.faceIds ?? [])],
          surfaceGeometry: SURFACE_GEOMETRY_RULE,
        })
        continue
      }

      // The player's contact Cell remains physically occupied for the entire
      // knockback sequence. Previously this guard only applied to the first
      // reflected Cell, allowing later reflected steps to pass through the
      // player and appear behind them.
      if (reserved.has(axialKey(next))) {
        activeM = 0
        actor.velocity = { x: 0, z: 0 }
        actor.axisId = activeDirection.id
        events.push({
          kind: 'reserved-cell-stop',
          actorId: currentActorId,
          cell: cloneHex(actor.hex),
          attemptedCell: cloneHex(next),
          beforeM: clampM(initialPower),
          afterM: 0,
        })
        break
      }

      const occupantId = occupancy.get(axialKey(next))
      if (occupantId && occupantId !== currentActorId) {
        const childPower = Math.max(1, activeM - 1)
        const targetActor = actorById.get(occupantId)
        events.push({
          kind: 'cell-conflict',
          sourceActorId: currentActorId,
          targetActorId: occupantId,
          power: childPower,
          cell: cloneHex(next),
          chained: true,
        })
        events.push({
          kind: 'momentum-transfer',
          sourceActorId: currentActorId,
          targetActorId: occupantId,
          sourceBeforeM: activeM,
          sourceAfterM: Math.max(0, activeM - childPower),
          targetBeforeM: momentumLevel(Math.hypot(targetActor?.velocity?.x ?? 0, targetActor?.velocity?.z ?? 0)),
          targetAfterM: childPower,
          chained: true,
          model: 'chain-decay-prototype',
        })
        const child = moveActor(occupantId, activeDirection, childPower, depth + 1)
        if (!child.vacated || occupancy.get(axialKey(next)) === occupantId) {
          activeM = Math.max(0, activeM - 1)
          actor.velocity = velocityFor(activeDirection.id, activeM)
          actor.axisId = activeDirection.id
          events.push({
            kind: 'cell-conflict-blocked',
            sourceActorId: currentActorId,
            targetActorId: occupantId,
            power: childPower,
            cell: cloneHex(next),
            chained: true,
            partial: movedSteps > 0,
          })
          break
        }
      }

      occupancy.delete(axialKey(actor.hex))
      actor.hex = cloneHex(next)
      occupancy.set(axialKey(actor.hex), actor.id)
      trajectories[actor.id].push(cloneHex(actor.hex))
      movedSteps += 1
      segmentStart = axialToWorld(actor.hex)
    }

    actor.velocity = activeM > 0 ? velocityFor(activeDirection.id, activeM) : { x: 0, z: 0 }
    actor.axisId = activeDirection.id
    return { vacated: movedSteps > 0, activeM, direction: activeDirection }
  }

  const result = moveActor(actorId, direction, power)
  return {
    moved: result.vacated,
    actors: shadowActors.map(cloneActor),
    events,
    trajectories,
    actorPlaybackWindows: buildActorPlaybackWindows(motionOrder, trajectories),
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
  let actorStates = actors.map(cloneActor)
  if (!plan?.valid) return { ...plan, actorStates, conflictEvents: [], pushAtomic: false }

  if (plan.spatialMode !== 'discrete') {
    return {
      ...plan,
      actorStates,
      conflictEvents: [],
      pushAtomic: false,
      finalState: { ...plan.finalState, actors: actorStates.map(cloneActor) },
    }
  }

  const route = uniqueRoute(plan.traversedCells)
  if (route.length < 2 || actorStates.length === 0) {
    return {
      ...plan,
      actorStates,
      conflictEvents: [],
      pushAtomic: false,
      finalState: { ...plan.finalState, actors: actorStates.map(cloneActor) },
    }
  }

  let occupancy = new Map(actorStates.map((actor) => [axialKey(actor.hex), actor.id]))
  const conflictEvents = []
  let actorTrajectories = Object.fromEntries(actorStates.map((actor) => [actor.id, [cloneHex(actor.hex)]]))
  let actorPlaybackWindows = {}
  let playerCell = cloneHex(route[0])
  const playerRoute = [cloneHex(playerCell)]
  let playerConflict = null

  for (let index = 1; index < route.length; index += 1) {
    const next = route[index]
    const direction = directionFromStep(playerCell, next)
    if (!direction) break

    const targetActorId = occupancy.get(axialKey(next))
    if (!targetActorId) {
      playerCell = cloneHex(next)
      playerRoute.push(cloneHex(playerCell))
      continue
    }

    const impactM = plan.actionKind === 'basic'
      ? clampM(plan.beforeM ?? 0)
      : clampM(momentumLevel(plan.afterImpulseSpeed ?? plan.finalSpeed ?? 0))
    const targetActor = actorStates.find((actor) => actor.id === targetActorId)
    const momentumExchange = exchangeActorMomentum({
      sourceM: impactM,
      targetVelocity: targetActor?.velocity,
      directionId: direction.id,
    })

    conflictEvents.push({
      kind: impactM > 0 ? 'cell-conflict' : 'cell-conflict-blocked',
      sourceActorId: 'player',
      targetActorId,
      power: momentumExchange.targetAfterM,
      impactM,
      cell: cloneHex(next),
      chained: false,
    })
    conflictEvents.push({
      kind: 'momentum-transfer',
      sourceActorId: 'player',
      targetActorId,
      ...momentumExchange,
      chained: false,
      model: 'equal-mass-1d',
    })

    if (impactM <= 0 || momentumExchange.targetAfterM <= 0) {
      playerConflict = { targetActorId, impactM, resolved: false, direction, momentumExchange }
      break
    }

    const attempted = resolveStepwiseKnockback({
      actors: actorStates,
      actorId: targetActorId,
      direction,
      power: momentumExchange.targetAfterM,
      obstacles,
      boardRadius,
      reservedCells: [next],
      surfaceRestitution,
      boundaryRestitution,
    })
    actorStates = attempted.actors.map(cloneActor)
    actorTrajectories = attempted.trajectories
    actorPlaybackWindows = attempted.actorPlaybackWindows
    conflictEvents.push(...attempted.events)
    occupancy = new Map(actorStates.map((actor) => [axialKey(actor.hex), actor.id]))

    if (attempted.moved && !occupancy.has(axialKey(next))) {
      playerCell = cloneHex(next)
      playerRoute.push(cloneHex(playerCell))
      playerConflict = { targetActorId, impactM, resolved: true, direction, momentumExchange }
    } else {
      conflictEvents.push({
        kind: 'cell-conflict-blocked',
        sourceActorId: 'player',
        targetActorId,
        power: momentumExchange.targetAfterM,
        impactM,
        cell: cloneHex(next),
        chained: false,
        partial: attempted.moved,
      })
      playerConflict = { targetActorId, impactM, resolved: false, direction, momentumExchange }
    }
    break
  }

  if (!playerConflict) {
    return {
      ...plan,
      actorStates: actorStates.map(cloneActor),
      actorTrajectories,
      actorPlaybackWindows,
      conflictEvents,
      pushAtomic: false,
      finalState: { ...plan.finalState, actors: actorStates.map(cloneActor) },
    }
  }

  const finalPlayerM = playerConflict.resolved
    ? Math.min(Math.max(0, plan.finalM ?? 0), playerConflict.momentumExchange?.sourceAfterM ?? 0)
    : 0
  const playerVelocity = velocityFor(playerConflict.direction.id, finalPlayerM)
  const finalPosition = axialToWorld(playerCell)
  let samples
  if (playerRoute.length <= 1) {
    const startVelocity = cloneVelocity(plan.samples?.[0]?.velocity ?? { x: 0, z: 0 })
    samples = [
      { t: 0, position: finalPosition, velocity: startVelocity, axisId: plan.axisBefore ?? null },
      { t: 1, position: finalPosition, velocity: cloneVelocity(playerVelocity), axisId: playerConflict.direction.id },
    ]
  } else {
    samples = playerRoute.map((cell, index) => ({
      t: index / (playerRoute.length - 1),
      position: axialToWorld(cell),
      velocity: index === 0 ? cloneVelocity(plan.samples?.[0]?.velocity ?? { x: 0, z: 0 }) : cloneVelocity(playerVelocity),
      axisId: index === 0 ? (plan.axisBefore ?? null) : playerConflict.direction.id,
    }))
  }

  return {
    ...plan,
    samples,
    traversedCells: playerRoute,
    collisions: [...(plan.collisions ?? [])],
    actorStates: actorStates.map(cloneActor),
    actorTrajectories,
    actorPlaybackWindows,
    playerPlaybackEnd: playerConflict.resolved ? 0.44 : 1,
    conflictEvents,
    pushAtomic: false,
    finalState: {
      ...plan.finalState,
      position: finalPosition,
      velocity: playerVelocity,
      axisId: playerConflict.direction.id,
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
      surfaceGeometry: SURFACE_GEOMETRY_RULE,
      momentumExchange: playerConflict.momentumExchange ?? null,
    },
  }
}
