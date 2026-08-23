import { describe, expect, it } from 'vitest'
import { axialToWorld, directionVector } from './hex.js'
import { simulateSpatial } from './solver.js'
import { createConflictActors, resolveCellConflicts } from './conflict.js'

function stateAt(hex, speed = 0) {
  const east = directionVector('E')
  return {
    position: axialToWorld(hex),
    velocity: { x: east.x * speed, z: east.z * speed },
    worldAt: 0,
  }
}

function basicPlan(state, aimHex, obstacles = []) {
  return simulateSpatial({
    spatialMode: 'discrete',
    state,
    actionId: 'basic-move',
    aimPoint: axialToWorld(aimHex),
    obstacles,
  })
}

describe('Cell Conflict / knockback prototype', () => {
  it('blocks M0 from entering an occupied Cell', () => {
    const state = stateAt({ q: 0, r: 0 }, 0)
    const plan = basicPlan(state, { q: 1, r: 0 })
    const resolved = resolveCellConflicts({
      plan,
      actors: [{ id: 'dummy', label: 'A', hex: { q: 1, r: 0 }, velocity: { x: 0, z: 0 } }],
      obstacles: [],
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({ impactM: 0, resolved: false })
    expect(resolved.traversedCells).toEqual([{ q: 0, r: 0 }])
    expect(resolved.actorStates[0].hex).toEqual({ q: 1, r: 0 })
    expect(resolved.finalM).toBe(0)
  })

  it('transfers M2 into an aligned three-actor knockback chain', () => {
    const state = stateAt({ q: 0, r: -1 }, 1.7)
    const plan = basicPlan(state, { q: 1, r: -1 })
    const resolved = resolveCellConflicts({
      plan,
      actors: createConflictActors('chain'),
      obstacles: [],
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({ targetActorId: 'dummy-a', impactM: 2, resolved: true })
    expect(resolved.traversedCells.at(-1)).toEqual({ q: 2, r: -1 })
    expect(Object.fromEntries(resolved.actorStates.map((actor) => [actor.id, actor.hex]))).toEqual({
      'dummy-a': { q: 4, r: -1 },
      'dummy-b': { q: 5, r: -1 },
      'dummy-c': { q: 6, r: -1 },
    })
    expect(resolved.conflictEvents.filter((event) => event.kind === 'cell-conflict')).toHaveLength(3)
    expect(resolved.finalM).toBe(0)
  })

  it('keeps the defender in place when a hard wall prevents the first knockback step', () => {
    const state = stateAt({ q: 0, r: 0 }, 1.7)
    const obstacles = [{ id: 'wall', hex: { q: 3, r: 0 }, radius: 0.34, kind: 'hard' }]
    const plan = basicPlan(state, { q: 1, r: 0 }, obstacles)
    const resolved = resolveCellConflicts({
      plan,
      actors: createConflictActors('wall'),
      obstacles,
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({ targetActorId: 'dummy-a', impactM: 2, resolved: false })
    expect(resolved.traversedCells.at(-1)).toEqual({ q: 1, r: 0 })
    expect(resolved.actorStates[0].hex).toEqual({ q: 2, r: 0 })
    expect(resolved.conflictEvents.some((event) => event.kind === 'wall-crash' && event.actorId === 'dummy-a')).toBe(true)
    expect(resolved.finalM).toBe(0)
  })

  it('leaves a no-contact discrete plan unchanged apart from attached actor state', () => {
    const state = stateAt({ q: 0, r: 0 }, 0.85)
    const plan = basicPlan(state, { q: 1, r: 0 })
    const actors = createConflictActors('chain')
    const resolved = resolveCellConflicts({ plan, actors, obstacles: [], boardRadius: 7 })

    expect(resolved.cellConflict).toBeUndefined()
    expect(resolved.finalState.position).toEqual(plan.finalState.position)
    expect(resolved.finalM).toBe(plan.finalM)
    expect(resolved.finalState.actors).toHaveLength(3)
  })
})
