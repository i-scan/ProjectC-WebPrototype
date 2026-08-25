import { HEX_DIRECTIONS, axialDistance, axialKey, axialToWorld, directionVector } from './hex.js'
import { momentumLevel, momentumSpeed } from './solver.js'

export const ACTOR_COLLISION_RESTITUTION = 0.75

const cloneHex = (hex) => ({ q: hex.q, r: hex.r })
const cloneVelocity = (velocity = { x: 0, z: 0 }) => ({ x: velocity.x, z: velocity.z })
const cloneActor = (actor) => ({ ...actor, hex: cloneHex(actor.hex), velocity: cloneVelocity(actor.velocity) })
const sameHex = (a, b) => Boolean(a && b && a.q === b.q && a.r === b.r)

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
  const sourceBeforeSpeed = momentumSpeed(Math.max(0, Math.min(3, sourceM)))
  const targetBeforeSpeed = scalarAlong(targetVelocity, directionId)
  // Equal-mass 1D collision along the contact axis.
  const sourceAfterSpeed = ((1 - e) * sourceBeforeSpeed + (1 + e) * targetBeforeSpeed) * 0.5
  const targetAfterSpeed = ((1 + e) * sourceBeforeSpeed + (1 - e) * targetBeforeSpeed) * 0.5
  const sourceAfterM = momentumLevel(Math.abs(sourceAfterSpeed))
  const targetBeforeM = momentumLevel(Math.abs(targetBeforeSpeed))
  const targetAfterM = momentumLevel(Math.abs(targetAfterSpeed))
  return {
    restitution: e,
    sourceBeforeM: Math.max(0, Math.min(3, sourceM)),
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
      { id: 'dummy-a', label: 'A', hex: { q: 2, r: 0 }, velocity: { x: 0, z: 0 }, axisId: null },
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
    playerHex: kind === 'wall' ? { q: 0, r: 0 } : { q: 0, r: 1 },
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

function attemptAtomicPush({ actors, actorId, direction, power, obstacles, boardRadius }) {
  const shadowActors = actors.map(cloneActor)
  const actorById = new Map(shadowActors.map((actor) => [actor.id, actor]))
  const occupancy = new Map(shadowActors.map((actor) => [axialKey(actor.hex), actor.id]))
  const obstacleByKey = new Map(obstacles.map((entry) => [axialKey(entry.hex), entry]))
  const events = []
  const trajectories = Object.fromEntries(shadowActors.map((actor) => [actor.id, [cloneHex(actor.hex)]]))

  const pushActor = (currentActorId, currentPower, depth = 0) => {
    const actor = actorById.get(currentActorId)
    if (!actor || currentPower <= 0 || depth > shadowActors.length + 2) return false

    for (let step = 0; step < currentPower; step += 1) {
      const next = { q: actor.hex.q + direction.q, r: actor.hex.r + direction.r }
      const obstacle = obstacleByKey.get(axialKey(next))
      const boundary = axialDistance(next) > boardRadius
      if (obstacle || boundary) {
        events.push({
          kind: 'wall-crash',
          actorId: currentActorId,
          power: currentPower,
          obstacleId: obstacle?.id ?? null,
          obstacleKind: boundary ? 'boundary' : obstacle?.kind ?? 'hard',
          from: cloneHex(actor.hex),
          cell: cloneHex(next),
          atomicRejected: true,
        })
        return false
      }

      const occupantId = occupancy.get(axialKey(next))
      if (occupantId && occupantId !== currentActorId) {
        const childPower = Math.max(1, currentPower - step - 1)
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
          sourceBeforeM: currentPower,
          sourceAfterM: Math.max(0, currentPower - childPower),
          targetBeforeM: momentumLevel(Math.hypot(actorById.get(occupantId)?.velocity?.x ?? 0, actorById.get(occupantId)?.velocity?.z ?? 0)),
          targetAfterM: childPower,
          chained: true,
          model: 'chain-decay-prototype',
        })
        if (!pushActor(occupantId, childPower, depth + 1)) {
          events.push({
            kind: 'cell-conflict-blocked',
            sourceActorId: currentActorId,
            targetActorId: occupantId,
            power: childPower,
            cell: cloneHex(next),
            chained: true,
            atomicRejected: true,
          })
          return false
        }
      }

      occupancy.delete(axialKey(actor.hex))
      actor.hex = cloneHex(next)
      occupancy.set(axialKey(actor.hex), actor.id)
      trajectories[actor.id].push(cloneHex(actor.hex))
    }

    actor.velocity = velocityFor(direction.id, Math.max(0, Math.min(3, currentPower)))
    actor.axisId = direction.id
    return true
  }

  const valid = pushActor(actorId, power)
  if (!valid) {
    return {
      valid: false,
      actors: actors.map(cloneActor),
      events,
      trajectories: Object.fromEntries(actors.map((actor) => [actor.id, [cloneHex(actor.hex)]])),
    }
  }

  return { valid: true, actors: shadowActors.map(cloneActor), events, trajectories }
}

export function resolveCellConflicts({ plan, actors = [], obstacles = [], boardRadius = 7 }) {
  let actorStates = actors.map(cloneActor)
  if (!plan?.valid) return { ...plan, actorStates, conflictEvents: [], pushAtomic: true }

  if (plan.spatialMode !== 'discrete') {
    return {
      ...plan,
      actorStates,
      conflictEvents: [],
      pushAtomic: true,
      finalState: { ...plan.finalState, actors: actorStates.map(cloneActor) },
    }
  }

  const route = uniqueRoute(plan.traversedCells)
  if (route.length < 2 || actorStates.length === 0) {
    return {
      ...plan,
      actorStates,
      conflictEvents: [],
      pushAtomic: true,
      finalState: { ...plan.finalState, actors: actorStates.map(cloneActor) },
    }
  }

  let occupancy = new Map(actorStates.map((actor) => [axialKey(actor.hex), actor.id]))
  const conflictEvents = []
  let actorTrajectories = Object.fromEntries(actorStates.map((actor) => [actor.id, [cloneHex(actor.hex)]]))
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
      ? Math.max(0, Math.min(3, plan.beforeM ?? 0))
      : Math.max(0, Math.min(3, momentumLevel(plan.afterImpulseSpeed ?? plan.finalSpeed ?? 0)))
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

    const attempted = attemptAtomicPush({
      actors: actorStates,
      actorId: targetActorId,
      direction,
      power: momentumExchange.targetAfterM,
      obstacles,
      boardRadius,
    })
    conflictEvents.push(...attempted.events)
    if (!attempted.valid) {
      conflictEvents.push({
        kind: 'cell-conflict-blocked',
        sourceActorId: 'player',
        targetActorId,
        power: momentumExchange.targetAfterM,
        impactM,
        cell: cloneHex(next),
        chained: false,
        atomicRejected: true,
      })
      playerConflict = { targetActorId, impactM, resolved: false, direction, momentumExchange }
      break
    }

    actorStates = attempted.actors.map(cloneActor)
    actorTrajectories = attempted.trajectories
    occupancy = new Map(actorStates.map((actor) => [axialKey(actor.hex), actor.id]))
    playerCell = cloneHex(next)
    playerRoute.push(cloneHex(playerCell))
    playerConflict = { targetActorId, impactM, resolved: true, direction, momentumExchange }
    break
  }

  if (!playerConflict) {
    return {
      ...plan,
      actorStates: actorStates.map(cloneActor),
      actorTrajectories,
      conflictEvents,
      pushAtomic: true,
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
      { t: 0, position: finalPosition, velocity: startVelocity },
      { t: 1, position: finalPosition, velocity: cloneVelocity(playerVelocity) },
    ]
  } else {
    samples = playerRoute.map((cell, index) => ({
      t: index / (playerRoute.length - 1),
      position: axialToWorld(cell),
      velocity: index === 0 ? cloneVelocity(plan.samples?.[0]?.velocity ?? { x: 0, z: 0 }) : cloneVelocity(playerVelocity),
    }))
  }

  return {
    ...plan,
    samples,
    traversedCells: playerRoute,
    collisions: [...(plan.collisions ?? [])],
    actorStates: actorStates.map(cloneActor),
    actorTrajectories,
    conflictEvents,
    pushAtomic: true,
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
      atomic: true,
      momentumExchange: playerConflict.momentumExchange ?? null,
    },
  }
}
