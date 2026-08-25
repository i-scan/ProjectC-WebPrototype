import { describe, expect, it } from 'vitest'
import { axialToWorld, directionVector } from './hex.js'
import { momentumLevel, momentumSpeed } from './solver.js'
import { simulateBasicMoveRule } from './spatial-rules.js'
import { ACTOR_COLLISION_RESTITUTION, createConflictActors, exchangeActorMomentum, resolveCellConflicts } from './conflict.js'

function stateAt(hex, level = 0, axisId = level > 0 ? 'E' : null) {
  const direction = axisId ? directionVector(axisId) : { x: 0, z: 0 }
  const speed = momentumSpeed(level)
  return {
    position: axialToWorld(hex),
    velocity: { x: direction.x * speed, z: direction.z * speed },
    axisId,
    worldAt: 0,
  }
}

function basicPlan(state, landingHex, obstacles = []) {
  return simulateBasicMoveRule({
    spatialMode: 'discrete',
    state,
    aimPoint: axialToWorld(landingHex),
    obstacles,
  })
}

function manualContactPlan({ from = { q: 0, r: 0 }, contact = { q: 1, r: 0 }, level = 3, finalM = 2 } = {}) {
  const direction = directionVector('E')
  return {
    valid: true,
    action: { id: 'basic-move', label: 'Basic Move', kind: 'basic' },
    actionKind: 'basic',
    spatialMode: 'discrete',
    samples: [
      { t: 0, position: axialToWorld(from), velocity: velocityForLevel(level), axisId: 'E' },
      { t: 1, position: axialToWorld(contact), velocity: velocityForLevel(finalM), axisId: 'E' },
    ],
    collisions: [],
    traversedCells: [from, contact],
    finalState: {
      position: axialToWorld(contact),
      velocity: { x: direction.x * momentumSpeed(finalM), z: direction.z * momentumSpeed(finalM) },
      axisId: 'E',
      worldAt: 1,
    },
    beforeSpeed: momentumSpeed(level),
    afterImpulseSpeed: momentumSpeed(level),
    finalSpeed: momentumSpeed(finalM),
    beforeM: level,
    finalM,
    axisBefore: 'E',
    axisAfter: 'E',
  }
}

function velocityForLevel(level) {
  return { x: momentumSpeed(level), z: 0 }
}

describe('Cell Conflict / knockback prototype', () => {
  it('quantizes equal-mass actor momentum exchange instead of treating push as position-only', () => {
    const exchange = exchangeActorMomentum({
      sourceM: 2,
      targetVelocity: { x: 0, z: 0 },
      directionId: 'E',
    })
    expect(exchange.restitution).toBe(ACTOR_COLLISION_RESTITUTION)
    expect(exchange.sourceBeforeM).toBe(2)
    expect(exchange.targetBeforeM).toBe(0)
    expect(exchange.sourceAfterM).toBe(1)
    expect(exchange.targetAfterM).toBe(2)
    expect(exchange.sourceAfterSpeed).toBeCloseTo(0.2125, 4)
    expect(exchange.targetAfterSpeed).toBeCloseTo(1.4875, 4)
  })

  it('blocks M0 from entering an occupied Cell without inventing knockback', () => {
    const state = stateAt({ q: 0, r: 0 }, 0)
    const plan = basicPlan(state, { q: 1, r: 0 })
    const resolved = resolveCellConflicts({
      plan,
      actors: [{ id: 'dummy', label: 'A', hex: { q: 1, r: 0 }, velocity: { x: 0, z: 0 }, axisId: null }],
      obstacles: [],
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({ impactM: 0, resolved: false, atomic: false })
    expect(resolved.pushAtomic).toBe(false)
    expect(resolved.traversedCells).toEqual([{ q: 0, r: 0 }])
    expect(resolved.actorStates[0].hex).toEqual({ q: 1, r: 0 })
    expect(resolved.finalM).toBe(0)
    expect(resolved.samples).toHaveLength(2)
  })

  it('transfers M2 into a stationary actor and resolves a chain one Cell at a time', () => {
    const state = stateAt({ q: 0, r: 1 }, 2, 'E')
    const plan = basicPlan(state, { q: 2, r: 1 })
    const resolved = resolveCellConflicts({
      plan,
      actors: createConflictActors('chain'),
      obstacles: [],
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({
      targetActorId: 'dummy-a',
      impactM: 2,
      resolved: true,
      atomic: false,
      resolution: 'stepwise-reflect-v1',
      momentumExchange: {
        sourceBeforeM: 2,
        targetBeforeM: 0,
        sourceAfterM: 1,
        targetAfterM: 2,
      },
    })
    expect(resolved.pushAtomic).toBe(false)
    expect(resolved.traversedCells.at(-1)).toEqual({ q: 2, r: 1 })
    expect(Object.fromEntries(resolved.actorStates.map((actor) => [actor.id, actor.hex]))).toEqual({
      'dummy-a': { q: 4, r: 1 },
      'dummy-b': { q: 5, r: 1 },
      'dummy-c': { q: 6, r: 1 },
    })
    expect(resolved.actorTrajectories['dummy-a']).toEqual([
      { q: 2, r: 1 },
      { q: 3, r: 1 },
      { q: 4, r: 1 },
    ])
    expect(resolved.actorTrajectories['dummy-b']).toEqual([{ q: 4, r: 1 }, { q: 5, r: 1 }])
    expect(resolved.actorTrajectories['dummy-c']).toEqual([{ q: 5, r: 1 }, { q: 6, r: 1 }])
    expect(momentumLevel(Math.hypot(resolved.actorStates[0].velocity.x, resolved.actorStates[0].velocity.z))).toBe(2)
    expect(resolved.finalM).toBe(1)
    expect(resolved.playerPlaybackEnd).toBeLessThan(resolved.actorPlaybackWindows['dummy-a'].start)
    expect(resolved.actorPlaybackWindows['dummy-a'].start).toBeLessThan(resolved.actorPlaybackWindows['dummy-b'].start)
    expect(resolved.actorPlaybackWindows['dummy-b'].start).toBeLessThan(resolved.actorPlaybackWindows['dummy-c'].start)
  })

  it('keeps the first legal knockback Cell when the second step hits a wall and the reflected Cell is blocked by the player', () => {
    const state = stateAt({ q: -1, r: 0 }, 2, 'E')
    const obstacles = [{ id: 'wall', hex: { q: 3, r: 0 }, radius: 0.34, kind: 'hard' }]
    const plan = basicPlan(state, { q: 1, r: 0 }, obstacles)
    const resolved = resolveCellConflicts({
      plan,
      actors: createConflictActors('wall'),
      obstacles,
      boardRadius: 7,
      surfaceRestitution: 0.58,
      boundaryRestitution: 0.42,
    })

    expect(resolved.cellConflict).toMatchObject({ targetActorId: 'dummy-a', impactM: 2, resolved: true, atomic: false })
    expect(resolved.cellConflict.momentumExchange).toMatchObject({ sourceAfterM: 1, targetAfterM: 2 })
    expect(resolved.traversedCells.at(-1)).toEqual({ q: 1, r: 0 })
    expect(resolved.actorStates[0].hex).toEqual({ q: 2, r: 0 })
    expect(resolved.actorTrajectories['dummy-a']).toEqual([{ q: 1, r: 0 }, { q: 2, r: 0 }])
    expect(momentumLevel(Math.hypot(resolved.actorStates[0].velocity.x, resolved.actorStates[0].velocity.z))).toBe(0)
    expect(resolved.conflictEvents.some((event) => event.kind === 'wall-crash' && event.actorId === 'dummy-a' && event.partial)).toBe(true)
    expect(resolved.conflictEvents.some((event) => event.kind === 'surface-stop' && event.actorId === 'dummy-a' && event.reflectedAxis === 'W')).toBe(true)
    expect(resolved.finalM).toBe(1)
  })

  it('reflects a knocked actor from a wall when the authoritative reflected Cell is legal', () => {
    const plan = manualContactPlan()
    const actors = [{ id: 'dummy', label: 'A', hex: { q: 1, r: 0 }, velocity: { x: 0, z: 0 }, axisId: null }]
    const obstacles = [{ id: 'wall', hex: { q: 4, r: 0 }, radius: 0.34, kind: 'hard' }]
    const resolved = resolveCellConflicts({
      plan,
      actors,
      obstacles,
      boardRadius: 7,
      surfaceRestitution: 0.58,
      boundaryRestitution: 0.42,
    })

    expect(resolved.actorTrajectories.dummy).toEqual([
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
      { q: 2, r: 0 },
    ])
    const bounce = resolved.conflictEvents.find((event) => event.kind === 'surface-reflection')
    expect(bounce).toMatchObject({ obstacleKind: 'hard', axisBefore: 'E', axisAfter: 'W', beforeM: 3, afterM: 2 })
    expect(resolved.actorStates[0].hex).toEqual({ q: 2, r: 0 })
    expect(momentumLevel(Math.hypot(resolved.actorStates[0].velocity.x, resolved.actorStates[0].velocity.z))).toBe(2)
  })

  it('reflects a knocked actor from the map boundary using the same directional rule', () => {
    const plan = manualContactPlan()
    const actors = [{ id: 'dummy', label: 'A', hex: { q: 1, r: 0 }, velocity: { x: 0, z: 0 }, axisId: null }]
    const resolved = resolveCellConflicts({
      plan,
      actors,
      obstacles: [],
      boardRadius: 3,
      surfaceRestitution: 0.58,
      boundaryRestitution: 0.8,
    })

    expect(resolved.actorTrajectories.dummy).toEqual([
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
      { q: 2, r: 0 },
    ])
    const bounce = resolved.conflictEvents.find((event) => event.kind === 'surface-reflection')
    expect(bounce).toMatchObject({ obstacleKind: 'boundary', axisBefore: 'E', axisAfter: 'W' })
    expect(resolved.actorStates[0].hex).toEqual({ q: 2, r: 0 })
  })

  it('leaves a no-contact discrete plan unchanged apart from attached actor state', () => {
    const state = stateAt({ q: 0, r: 0 }, 1, 'E')
    const plan = basicPlan(state, { q: 1, r: 0 })
    const actors = createConflictActors('chain')
    const resolved = resolveCellConflicts({ plan, actors, obstacles: [], boardRadius: 7 })

    expect(resolved.cellConflict).toBeUndefined()
    expect(resolved.finalState.position).toEqual(plan.finalState.position)
    expect(resolved.finalM).toBe(plan.finalM)
    expect(resolved.finalState.actors).toHaveLength(3)
  })
})
