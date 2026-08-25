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

  it('blocks M0 from entering an occupied Cell without producing a one-sample playback', () => {
    const state = stateAt({ q: 0, r: 0 }, 0)
    const plan = basicPlan(state, { q: 1, r: 0 })
    const resolved = resolveCellConflicts({
      plan,
      actors: [{ id: 'dummy', label: 'A', hex: { q: 1, r: 0 }, velocity: { x: 0, z: 0 }, axisId: null }],
      obstacles: [],
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({ impactM: 0, resolved: false, atomic: true })
    expect(resolved.traversedCells).toEqual([{ q: 0, r: 0 }])
    expect(resolved.actorStates[0].hex).toEqual({ q: 1, r: 0 })
    expect(resolved.finalM).toBe(0)
    expect(resolved.samples).toHaveLength(2)
  })

  it('transfers M2 into a stationary actor before the atomic knockback chain resolves', () => {
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
      atomic: true,
      momentumExchange: {
        sourceBeforeM: 2,
        targetBeforeM: 0,
        sourceAfterM: 1,
        targetAfterM: 2,
      },
    })
    expect(resolved.pushAtomic).toBe(true)
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
    expect(resolved.actorTrajectories['dummy-b'].length).toBeGreaterThan(1)
    expect(resolved.actorTrajectories['dummy-c'].length).toBeGreaterThan(1)
    expect(momentumLevel(Math.hypot(resolved.actorStates[0].velocity.x, resolved.actorStates[0].velocity.z))).toBe(2)
    expect(resolved.conflictEvents.some((event) => event.kind === 'momentum-transfer' && event.sourceActorId === 'player' && event.targetAfterM === 2)).toBe(true)
    // Basic Move itself spends M2 -> M1, and the actor collision also leaves the
    // source at M1, so the combined final state remains M1 rather than M2/M3.
    expect(resolved.finalM).toBe(1)
  })

  it('keeps the defender in place when a hard wall prevents the first knockback step', () => {
    const state = stateAt({ q: 0, r: 0 }, 2, 'E')
    const obstacles = [{ id: 'wall', hex: { q: 3, r: 0 }, radius: 0.34, kind: 'hard' }]
    const plan = basicPlan(state, { q: 2, r: 0 }, obstacles)
    const resolved = resolveCellConflicts({
      plan,
      actors: createConflictActors('wall'),
      obstacles,
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({ targetActorId: 'dummy-a', impactM: 2, resolved: false, atomic: true })
    expect(resolved.cellConflict.momentumExchange).toMatchObject({ sourceAfterM: 1, targetAfterM: 2 })
    expect(resolved.traversedCells.at(-1)).toEqual({ q: 1, r: 0 })
    expect(resolved.actorStates[0].hex).toEqual({ q: 2, r: 0 })
    expect(resolved.actorTrajectories['dummy-a']).toEqual([{ q: 2, r: 0 }])
    expect(resolved.conflictEvents.some((event) => event.kind === 'wall-crash' && event.actorId === 'dummy-a')).toBe(true)
    expect(resolved.finalM).toBe(0)
  })

  it('rejects the whole push when a later knockback Cell hits a wall', () => {
    const state = stateAt({ q: 0, r: 0 }, 2, 'E')
    const obstacles = [{ id: 'late-wall', hex: { q: 4, r: 0 }, radius: 0.34, kind: 'hard' }]
    const plan = basicPlan(state, { q: 2, r: 0 })
    const actors = [{ id: 'dummy', label: 'A', hex: { q: 2, r: 0 }, velocity: { x: 0, z: 0 }, axisId: null }]
    const resolved = resolveCellConflicts({ plan, actors, obstacles, boardRadius: 7 })

    expect(resolved.cellConflict).toMatchObject({ impactM: 2, resolved: false, atomic: true })
    expect(resolved.actorStates[0].hex).toEqual({ q: 2, r: 0 })
    expect(resolved.actorTrajectories.dummy).toEqual([{ q: 2, r: 0 }])
    expect(resolved.traversedCells.at(-1)).toEqual({ q: 1, r: 0 })
    expect(resolved.conflictEvents.some((event) => event.kind === 'wall-crash' && event.atomicRejected)).toBe(true)
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
