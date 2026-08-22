import { describe, expect, it } from 'vitest'
import { axialToWorld, worldToAxial } from './hex.js'
import { createInitialState, DEFAULT_SOLVER_CONFIG, simulateDiscreteImpulse, simulateImpulse, simulateSpatial } from './solver.js'

const noObstacles = []

function runHybrid(state, actionId, hex) {
  return simulateImpulse({ state, actionId, aimPoint: hex ? axialToWorld(hex) : null, config: DEFAULT_SOLVER_CONFIG, obstacles: noObstacles })
}
function runDiscrete(state, actionId, hex) {
  return simulateDiscreteImpulse({ state, actionId, aimPoint: hex ? axialToWorld(hex) : null, config: DEFAULT_SOLVER_CONFIG, obstacles: noObstacles })
}

describe('shared spatial input contract', () => {
  it('uses the same Aim Cell input while producing different spatial outcomes', () => {
    const initial = createInitialState()
    const discrete = runDiscrete(initial, 'drive', { q: 2, r: 0 })
    const hybrid = runHybrid(initial, 'drive', { q: 2, r: 0 })
    expect(discrete.valid).toBe(true)
    expect(hybrid.valid).toBe(true)
    expect(discrete.spatialMode).toBe('discrete')
    expect(hybrid.spatialMode).toBe('hybrid')
    expect(discrete.finalState.position).toEqual(axialToWorld(worldToAxial(discrete.finalState.position)))
    expect(hybrid.finalState.position.x).toBeGreaterThan(0.7)
    expect(hybrid.finalState.position.x).toBeLessThan(1)
    expect(discrete.finalState.position.x).not.toBeCloseTo(hybrid.finalState.position.x, 4)
  })

  it('hybrid resolves 120 continuous substeps and keeps in-cell final position', () => {
    const plan = runHybrid(createInitialState(), 'drive', { q: 2, r: 0 })
    expect(plan.samples.length).toBe(DEFAULT_SOLVER_CONFIG.steps + 1)
    expect(plan.finalM).toBe(1)
  })

  it('discrete resolves M as Cell steps but shares the same action policy', () => {
    const state = { position: { x: 0, z: 0 }, velocity: { x: 1.7, z: 0 }, worldAt: 0 }
    const plan = runDiscrete(state, 'coast')
    expect(plan.valid).toBe(true)
    expect(plan.traversedCells.length).toBe(3)
    expect(plan.finalState.worldAt).toBe(1)
  })

  it('coast preserves velocity in hybrid instead of spending movement resource', () => {
    const first = runHybrid(createInitialState(), 'drive', { q: 2, r: 0 })
    const coast = runHybrid(first.finalState, 'coast')
    expect(coast.valid).toBe(true)
    expect(coast.finalSpeed).toBeCloseTo(first.finalSpeed, 6)
  })

  it('counter impulse reduces existing speed when aimed backward', () => {
    const state = { position: { x: 0, z: 0 }, velocity: { x: 2, z: 0 }, worldAt: 0 }
    const plan = runHybrid(state, 'counter', { q: -2, r: 0 })
    expect(plan.valid).toBe(true)
    expect(plan.finalSpeed).toBeLessThan(2)
  })

  it('is deterministic for identical mode state and input', () => {
    const input = { spatialMode: 'hybrid', state: { position: { x: 0.2, z: -0.1 }, velocity: { x: 1.1, z: 0.25 }, worldAt: 3 }, actionId: 'hard-turn', aimPoint: axialToWorld({ q: 2, r: 1 }), config: DEFAULT_SOLVER_CONFIG, obstacles: noObstacles }
    expect(simulateSpatial(input)).toEqual(simulateSpatial(input))
  })

  it('hybrid reflects from a hard obstacle without pathfinding around it', () => {
    const obstacle = [{ id: 'wall', hex: { q: 1, r: 0 }, radius: 0.34, kind: 'hard' }]
    const state = { position: { x: 0, z: 0 }, velocity: { x: 1.6, z: 0 }, worldAt: 0 }
    const plan = simulateImpulse({ state, actionId: 'coast', aimPoint: null, config: DEFAULT_SOLVER_CONFIG, obstacles: obstacle })
    expect(plan.collisions.length).toBeGreaterThan(0)
    expect(plan.finalState.velocity.x).toBeLessThan(0)
  })
})
