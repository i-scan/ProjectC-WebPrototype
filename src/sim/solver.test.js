import { describe, expect, it } from 'vitest'
import { axialToWorld, worldToAxial } from './hex.js'
import {
  createInitialState,
  DEFAULT_SOLVER_CONFIG,
  simulateDiscreteImpulse,
  simulateImpulse,
  simulateSpatial,
} from './solver.js'

const noObstacles = []

function runHybrid(state, actionId, hex) {
  return simulateImpulse({
    state,
    actionId,
    aimPoint: hex ? axialToWorld(hex) : null,
    config: DEFAULT_SOLVER_CONFIG,
    obstacles: noObstacles,
  })
}

function runDiscrete(state, actionId, hex) {
  return simulateDiscreteImpulse({
    state,
    actionId,
    aimPoint: hex ? axialToWorld(hex) : null,
    config: DEFAULT_SOLVER_CONFIG,
    obstacles: noObstacles,
  })
}

describe('shared spatial input contract', () => {
  it('restores Basic Move as a 1 AT base command without creating Momentum at rest', () => {
    const initial = createInitialState()
    const discrete = runDiscrete(initial, 'basic-move', { q: 4, r: 0 })
    const hybrid = runHybrid(initial, 'basic-move', { q: 4, r: 0 })

    expect(discrete.valid).toBe(true)
    expect(hybrid.valid).toBe(true)
    expect(discrete.finalState.position).toEqual(axialToWorld({ q: 1, r: 0 }))
    expect(hybrid.finalState.position.x).toBeCloseTo(1, 6)
    expect(hybrid.finalState.position.z).toBeCloseTo(0, 6)
    expect(discrete.finalSpeed).toBeCloseTo(0, 6)
    expect(hybrid.finalSpeed).toBeCloseTo(0, 6)
    expect(discrete.finalState.worldAt).toBe(1)
    expect(hybrid.finalState.worldAt).toBe(1)
  })

  it('Basic Move combines voluntary displacement with inertia but does not auto-spend M', () => {
    const state = { position: { x: 0, z: 0 }, velocity: { x: 1.7, z: 0 }, worldAt: 0 }
    const plan = runHybrid(state, 'basic-move', { q: 0, r: -2 })

    expect(plan.valid).toBe(true)
    expect(plan.finalState.velocity.x).toBeCloseTo(1.7, 6)
    expect(plan.finalState.velocity.z).toBeCloseTo(0, 6)
    expect(plan.finalM).toBe(2)
    expect(plan.finalState.position.x).toBeLessThan(1.7)
    expect(plan.finalState.position.z).toBeLessThan(-0.5)
  })

  it('Drive accepts a 120 degree Aim and turns by vector addition instead of legality gating', () => {
    const state = { position: { x: 0, z: 0 }, velocity: { x: 0.85, z: 0 }, worldAt: 0 }
    const aim = { q: 0, r: -2 }
    const hybrid = runHybrid(state, 'drive', aim)
    const discrete = runDiscrete(state, 'drive', aim)

    expect(hybrid.valid).toBe(true)
    expect(discrete.valid).toBe(true)
    expect(hybrid.finalState.velocity.x).toBeGreaterThan(0.3)
    expect(hybrid.finalState.velocity.x).toBeLessThan(0.6)
    expect(hybrid.finalState.velocity.z).toBeLessThan(-0.6)
    expect(discrete.finalState.velocity.x).toBeCloseTo(hybrid.finalState.velocity.x, 6)
    expect(discrete.finalState.velocity.z).toBeCloseTo(hybrid.finalState.velocity.z, 6)
    expect(worldToAxial(discrete.finalState.position)).toEqual({ q: 1, r: -1 })
  })

  it('Hybrid restores a curved turn presentation while keeping the vector-sum endpoint', () => {
    const state = { position: { x: 0, z: 0 }, velocity: { x: 0.85, z: 0 }, worldAt: 0 }
    const plan = runHybrid(state, 'drive', { q: 0, r: -2 })

    expect(plan.valid).toBe(true)
    expect(plan.curveUsed).toBe(true)
    expect(plan.samples.length).toBe(DEFAULT_SOLVER_CONFIG.steps + 1)

    const midpoint = plan.samples[Math.floor(plan.samples.length / 2)].position
    const endpoint = plan.samples.at(-1).position
    const cross = midpoint.x * endpoint.z - midpoint.z * endpoint.x
    expect(Math.abs(cross)).toBeGreaterThan(0.04)
    expect(plan.samples[0].velocity.x).toBeCloseTo(0.85, 6)
    expect(plan.samples[0].velocity.z).toBeCloseTo(0, 6)
    expect(plan.samples.at(-1).velocity.x).toBeCloseTo(plan.finalState.velocity.x, 6)
    expect(plan.samples.at(-1).velocity.z).toBeCloseTo(plan.finalState.velocity.z, 6)
  })

  it('still gives Discrete and Hybrid different spatial outcomes from the same Aim Cell', () => {
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

  it('coast preserves velocity in Hybrid instead of spending a movement resource', () => {
    const first = runHybrid(createInitialState(), 'drive', { q: 2, r: 0 })
    const coast = runHybrid(first.finalState, 'coast')
    expect(coast.valid).toBe(true)
    expect(coast.finalSpeed).toBeCloseTo(first.finalSpeed, 6)
  })

  it('Counter Impulse still enforces its reverse semantic and reduces speed', () => {
    const state = { position: { x: 0, z: 0 }, velocity: { x: 2, z: 0 }, worldAt: 0 }
    const backward = runHybrid(state, 'counter', { q: -2, r: 0 })
    const sideways = runHybrid(state, 'counter', { q: 0, r: -2 })

    expect(backward.valid).toBe(true)
    expect(backward.finalSpeed).toBeLessThan(2)
    expect(sideways.valid).toBe(false)
  })

  it('is deterministic for identical mode, state and input', () => {
    const input = {
      spatialMode: 'hybrid',
      state: { position: { x: 0.2, z: -0.1 }, velocity: { x: 1.1, z: 0.25 }, worldAt: 3 },
      actionId: 'drive',
      aimPoint: axialToWorld({ q: 0, r: -3 }),
      config: DEFAULT_SOLVER_CONFIG,
      obstacles: noObstacles,
    }
    expect(simulateSpatial(input)).toEqual(simulateSpatial(input))
  })

  it('Hybrid still reflects from a hard obstacle without pathfinding around it', () => {
    const obstacle = [{ id: 'wall', hex: { q: 1, r: 0 }, radius: 0.34, kind: 'hard' }]
    const state = { position: { x: 0, z: 0 }, velocity: { x: 1.6, z: 0 }, worldAt: 0 }
    const plan = simulateImpulse({
      state,
      actionId: 'coast',
      aimPoint: null,
      config: DEFAULT_SOLVER_CONFIG,
      obstacles: obstacle,
    })
    expect(plan.collisions.length).toBeGreaterThan(0)
    expect(plan.finalState.velocity.x).toBeLessThan(0)
  })
})
