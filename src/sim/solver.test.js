import { describe, expect, it } from 'vitest'
import { axialToWorld } from './hex.js'
import { createInitialState, DEFAULT_SOLVER_CONFIG, simulateImpulse } from './solver.js'

const noObstacles = []

function run(state, actionId, hex) {
  return simulateImpulse({ state, actionId, aimPoint: hex ? axialToWorld(hex) : null, config: DEFAULT_SOLVER_CONFIG, obstacles: noObstacles })
}

describe('continuous inertia solver', () => {
  it('starts from rest with a continuous in-cell final position', () => {
    const plan = run(createInitialState(), 'drive', { q: 2, r: 0 })
    expect(plan.valid).toBe(true)
    expect(plan.finalState.position.x).toBeGreaterThan(0.7)
    expect(plan.finalState.position.x).toBeLessThan(1)
    expect(plan.samples.length).toBe(DEFAULT_SOLVER_CONFIG.steps + 1)
    expect(plan.finalM).toBe(1)
  })

  it('coast preserves velocity instead of spending a movement resource', () => {
    const first = run(createInitialState(), 'drive', { q: 2, r: 0 })
    const coast = run(first.finalState, 'coast')
    expect(coast.valid).toBe(true)
    expect(coast.finalSpeed).toBeCloseTo(first.finalSpeed, 6)
    expect(coast.finalState.position.x - first.finalState.position.x).toBeCloseTo(first.finalState.position.x, 5)
  })

  it('counter impulse reduces existing speed when aimed backward', () => {
    const state = { position: { x: 0, z: 0 }, velocity: { x: 2, z: 0 }, worldAt: 0 }
    const plan = run(state, 'counter', { q: -2, r: 0 })
    expect(plan.valid).toBe(true)
    expect(plan.finalSpeed).toBeLessThan(2)
  })

  it('is deterministic for identical state and input', () => {
    const input = { state: { position: { x: 0.2, z: -0.1 }, velocity: { x: 1.1, z: 0.25 }, worldAt: 3 }, actionId: 'hard-turn', aimPoint: axialToWorld({ q: 2, r: 1 }), config: DEFAULT_SOLVER_CONFIG, obstacles: noObstacles }
    expect(simulateImpulse(input)).toEqual(simulateImpulse(input))
  })

  it('reflects from a hard obstacle without pathfinding around it', () => {
    const obstacle = [{ id: 'wall', hex: { q: 1, r: 0 }, radius: 0.34, kind: 'hard' }]
    const state = { position: { x: 0, z: 0 }, velocity: { x: 1.6, z: 0 }, worldAt: 0 }
    const plan = simulateImpulse({ state, actionId: 'coast', aimPoint: null, config: DEFAULT_SOLVER_CONFIG, obstacles: obstacle })
    expect(plan.collisions.length).toBeGreaterThan(0)
    expect(plan.finalState.velocity.x).toBeLessThan(0)
  })
})
