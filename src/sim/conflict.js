import { HEX_DIRECTIONS, axialDistance, axialKey, axialToWorld, directionVector } from './hex.js'
import { momentumLevel, momentumSpeed } from './solver.js'

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

export function createConflictActors(kind = 'chain') {
  if (kind === 'wall') {
    return [
      { id: 'dummy-a', label: 'A', hex: { q: 2, r: 0 }, velocity: { x: 0, z: 0 } },
    ]
  }

  return [
    { id: 'dummy-a', label: 'A', hex: { q: 2, r: 1 }, velocity: { x: 0, z: 0 } },
    { id: 'dummy-b', label: 'B', hex: { q: 4, r: 1 }, velocity: { x: 0, z: 0 } },
    { id: 'dummy-c', label: 'C', hex: { q: 5, r: 1 }, velocity: { x: 0, z: 0 } },
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

export function decorateConflictCells(cells, actors = [], projectedActors = []) {
  const actualByKey = new Map(actors.map((actor) => [axialKey(actor.hex), actor]))
  const projectedByKey = new Map()
  for (const actor of projectedActors) {
    const current = actors.find((entry) => entry.id === actor.id)
    if (current && !sameHex(current.hex, actor.hex)) projectedByKey.set(axialKey(actor.hex), actor)
  }

  return cells.map((cell) => {
    const actual = actualByKey.get(cell.key)
    const projected = projectedByKey.get(cell.key)
    if (!actual && !projected) return cell

    const tags = [...cell.tags]
    if (actual && !tags.includes('Shelter')) tags.push('Shelter')
    if (projected && !tags.some((tag) => tag === 'UT3ReflectLeft' || tag === 'UT3ReflectRight')) tags.push('UT3ReflectLeft')

    return {
      ...cell,
      groundFill: projected ? 'ice' : cell.groundFill,
      groundTemp: projected ? Math.min(cell.groundTemp, -1) : cell.groundTemp,
      moisture: projected ? 0 : cell.moisture,
      tags,
      conflictActor: actual?.id ?? null,
      conflictProjection: projected?.id ?? null,
    }
  })
}

export function resolveCellConflicts({ plan, actors = [], obstacles = [], boardRadius = 7 }) {
  const actorStates = actors.map(cloneActor)
  if (!plan?.valid) return { ...plan, actorStates, conflictEvents: [] }

  // This first test layer intentionally targets the discrete Cell model. Hybrid
  // keeps its existing continuous collision experiment until the Cell rules are proven useful.
  if (plan.spatialMode !== 'discrete') {
    return {
      ...plan,
      actorStates,
      conflictEvents: [],
      finalState: { ...plan.finalState, actors: actorStates.map(cloneActor) },
    }
  }

  const route = uniqueRoute(plan.traversedCells)
  if (route.length < 2 || actorStates.length === 0) {
    return {
      ...plan,
      actorStates,
      conflictEvents: [],
      finalState: { ...plan.finalState, actors: actorStates.map(cloneActor) },
    }
  }

  const obstacleByKey = new Map(obstacles.map((entry) => [axialKey(entry.hex), entry]))
  const occupancy = new Map(actorStates.map((actor) => [axialKey(actor.hex), actor.id]))
  const actorById = new Map(actorStates.map((actor) => [actor.id, actor]))
  const conflictEvents = []
  const actorTrajectories = Object.fromEntries(actorStates.map((actor) => [actor.id, [cloneHex(actor.hex)]]))

  const pushActor = (actorId, direction, power, depth = 0) => {
    const actor = actorById.get(actorId)
    if (!actor || power <= 0 || depth > actorStates.length + 2) return { vacated: false, moved: 0, blocked: true }

    const origin = cloneHex(actor.hex)
    let moved = 0
    let blocked = false

    for (let step = 0; step < power; step += 1) {
      const next = { q: actor.hex.q + direction.q, r: actor.hex.r + direction.r }
      const obstacle = obstacleByKey.get(axialKey(next))
      const boundary = axialDistance(next) > boardRadius

      if (obstacle || boundary) {
        blocked = true
        conflictEvents.push({
          kind: 'wall-crash',
          actorId,
          power,
          obstacleId: obstacle?.id ?? null,
          obstacleKind: boundary ? 'boundary' : obstacle?.kind ?? 'hard',
          from: cloneHex(actor.hex),
          cell: cloneHex(next),
        })
        break
      }

      const occupantId = occupancy.get(axialKey(next))
      if (occupantId && occupantId !== actorId) {
        const childPower = Math.max(1, power - step - 1)
        conflictEvents.push({
          kind: 'cell-conflict',
          sourceActorId: actorId,
          targetActorId: occupantId,
          power: childPower,
          cell: cloneHex(next),
          chained: true,
        })
        const child = pushActor(occupantId, direction, childPower, depth + 1)
        if (!child.vacated) {
          blocked = true
          conflictEvents.push({
            kind: 'cell-conflict-blocked',
            sourceActorId: actorId,
            targetActorId: occupantId,
            power: childPower,
            cell: cloneHex(next),
            chained: true,
          })
          break
        }
      }

      occupancy.delete(axialKey(actor.hex))
      actor.hex = cloneHex(next)
      occupancy.set(axialKey(actor.hex), actor.id)
      actorTrajectories[actor.id].push(cloneHex(actor.hex))
      moved += 1
    }

    const residualM = blocked ? 0 : Math.max(0, Math.min(3, power - 1))
    actor.velocity = velocityFor(direction.id, residualM)
    return { vacated: !sameHex(origin, actor.hex), moved, blocked, residualM }
  }

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

    conflictEvents.push({
      kind: impactM > 0 ? 'cell-conflict' : 'cell-conflict-blocked',
      sourceActorId: 'player',
      targetActorId,
      power: impactM,
      cell: cloneHex(next),
      chained: false,
    })

    if (impactM <= 0) {
      playerConflict = { targetActorId, impactM, resolved: false, direction }
      break
    }

    const pushed = pushActor(targetActorId, direction, impactM)
    if (!pushed.vacated) {
      playerConflict = { targetActorId, impactM, resolved: false, direction }
      break
    }

    playerCell = cloneHex(next)
    playerRoute.push(cloneHex(playerCell))
    playerConflict = { targetActorId, impactM, resolved: true, direction }
    // Occupied-Cell contact is the meaningful end of this action segment for the
    // first prototype. The knockback cascade may continue, but the player does not
    // pass through the defender in the same card action.
    break
  }

  if (!playerConflict) {
    return {
      ...plan,
      actorStates: actorStates.map(cloneActor),
      actorTrajectories,
      conflictEvents,
      finalState: { ...plan.finalState, actors: actorStates.map(cloneActor) },
    }
  }

  const finalPlayerM = playerConflict.resolved ? Math.max(0, (plan.finalM ?? 0) - 1) : 0
  const playerVelocity = velocityFor(playerConflict.direction.id, finalPlayerM)
  const finalPosition = axialToWorld(playerCell)
  const sampleCount = Math.max(1, playerRoute.length)
  const samples = playerRoute.map((cell, index) => ({
    t: sampleCount <= 1 ? 0 : index / (sampleCount - 1),
    position: axialToWorld(cell),
    velocity: index === 0 ? cloneVelocity(plan.samples?.[0]?.velocity ?? { x: 0, z: 0 }) : cloneVelocity(playerVelocity),
  }))

  return {
    ...plan,
    samples,
    traversedCells: playerRoute,
    collisions: [...(plan.collisions ?? []), ...conflictEvents],
    actorStates: actorStates.map(cloneActor),
    actorTrajectories,
    conflictEvents,
    finalState: {
      ...plan.finalState,
      position: finalPosition,
      velocity: playerVelocity,
      actors: actorStates.map(cloneActor),
    },
    finalSpeed: Math.hypot(playerVelocity.x, playerVelocity.z),
    finalM: finalPlayerM,
    cellConflict: {
      targetActorId: playerConflict.targetActorId,
      impactM: playerConflict.impactM,
      resolved: playerConflict.resolved,
      playerCell: cloneHex(playerCell),
    },
  }
}
