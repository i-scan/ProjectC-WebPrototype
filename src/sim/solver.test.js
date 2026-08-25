import { describe, expect, it } from 'vitest'
import { axialToWorld, worldToAxial } from './hex.js'
import {
  AT_VISUAL_MS,
  combineImpulseVelocity,
  createInitialState,
  DEFAULT_SOLVER_CONFIG,
  MAX_SPEED,
  momentumLevel,
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

describe('Basic Move adjacent steering contract', () => {
  it('uses 0.5 seconds as the default visible AT', () => {
    expect(AT_VISUAL_MS).toBe(500)
  })

  it('rejects remote Aim Cells in both spatial modes', () => {
    const initial = createInitialState()
    expect(runDiscrete(initial, 'basic-move', { q: 2, r: 0 }).valid).toBe(false)
    expect(runHybrid(initial, 'basic-move', { q: 2, r: 0 }).valid).toBe(false)
  })

  it('moves one adjacent Cell at M0 and remains M0', () => {
    const initial = createInitialState()
    const discrete = runDiscrete(initial, 'basic-move', { q: 1, r: 0 })
    const hybrid = runHybrid(initial, 'basic-move', { q: 1, r: 0 })

    for (const plan of [discrete, hybrid]) {
      expect(plan.valid).toBe(true)
      expect(worldToAxial(plan.finalState.position)).toEqual({ q: 1, r: 0 })
      expect(plan.range).toBe(1)
      expect(plan.finalM).toBe(0)
      expect(plan.finalSpeed).toBeCloseTo(0, 6)
      expect(plan.finalState.worldAt).toBe(1)
    }
  })

  it('resolves M2 as Range+1, then M2 -> M1 once for the AT', () => {
    const state = { position: { x: 0, z: 0 }, velocity: { x: 1.7, z: 0 }, worldAt: 0 }
    const plan = runDiscrete(state, 'basic-move', { q: 1, r: 0 })

    expect(plan.valid).toBe(true)
    expect(plan.range).toBe(2)
    expect(plan.beforeM).toBe(2)
    expect(plan.finalM).toBe(1)
    expect(plan.traversedCells).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }])
    expect(plan.finalSpeed).toBeCloseTo(0.85, 6)
    expect(plan.finalState.worldAt).toBe(1)
  })

  it('uses the incoming Axis for the first M2 Cell-step and redirects at most 60 degrees per Cell', () => {
    const state = { position: { x: 0, z: 0 }, velocity: { x: 1.7, z: 0 }, worldAt: 0 }
    const plan = runDiscrete(state, 'basic-move', { q: 0, r: -1 })

    expect(plan.valid).toBe(true)
    expect(plan.traversedCells).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: -1 }])
    expect(plan.finalM).toBe(1)
    expect(plan.finalState.velocity.x).toBeLessThan(0)
    expect(plan.finalState.velocity.z).toBeLessThan(0)
  })

  it('does not silently choose a left/right branch for a direct opposite Aim', () => {
    const state = { position: { x: 0, z: 0 }, velocity: { x: 1.7, z: 0 }, worldAt: 0 }
    const plan = runDiscrete(state, 'basic-move', { q: -1, r: 0 })
    expect(plan.valid).toBe(false)
    expect(plan.reason).toMatch(/left\/right steering branch/i)
  })

  it('shares the same rule-constrained Basic Move Cell path in Discrete and Hybrid', () => {
    const state = { position: { x: 0, z: 0 }, velocity: { x: 1.7, z: 0 }, worldAt: 0 }
    const discrete = runDiscrete(state, 'basic-move', { q: 1, r: -1 })
    const hybrid = runHybrid(state, 'basic-move', { q: 1, r: -1 })
    expect(discrete.traversedCells).toEqual(hybrid.traversedCells)
    expect(discrete.finalState).toEqual(hybrid.finalState)
    expect(discrete.samples.length).toBe(3)
    expect(hybrid.samples.length).toBe(3)
  })
})

describe('Hold / Passive Dissipation', () => {
  it('waits in the same Cell for 1 AT and dissipates exactly one Horizontal M', () => {
    const state = { position: axialToWorld({ q: 1, r: -1 }), velocity: { x: 1.7, z: 0 }, axisId: 'E', worldAt: 3 }
    for (const plan of [runDiscrete(state, 'hold'), runHybrid(state, 'hold')]) {
      expect(plan.valid).toBe(true)
      expect(plan.actionKind).toBe('hold')
      expect(worldToAxial(plan.finalState.position)).toEqual({ q: 1, r: -1 })
      expect(plan.beforeM).toBe(2)
      expect(plan.finalM).toBe(1)
      expect(momentumLevel(Math.hypot(plan.finalState.velocity.x, plan.finalState.velocity.z))).toBe(1)
      expect(plan.finalState.worldAt).toBe(4)
      expect(plan.traversedCells).toEqual([{ q: 1, r: -1 }])
    }
  })

  it('allows M1 -> M0 without moving', () => {
    const state = { position: { x: 0, z: 0 }, velocity: { x: 0.85, z: 0 }, axisId: 'E', worldAt: 0 }
    const plan = runDiscrete(state, 'hold')
    expect(plan.valid).toBe(true)
    expect(plan.finalM).toBe(0)
    expect(plan.finalState.position).toEqual(state.position)
  })
})

describe('impulse movement regressions', () => {
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
  })

  it('computes V + normalized(Aim) * Force exactly and clamps MaxSpeed', () => {
    const velocity = { x: 1.1, z: -0.35 }
    const force = 0.85
    const direction = { x: -0.5, z: Math.sqrt(3) / 2 }
    const raw = { x: velocity.x + direction.x * force, z: velocity.z + direction.z * force }
    const actual = combineImpulseVelocity(velocity, direction, force, MAX_SPEED)
    expect(actual.x).toBeCloseTo(raw.x, 10)
    expect(actual.z).toBeCloseTo(raw.z, 10)

    const capped = combineImpulseVelocity({ x: 3.1, z: 0 }, { x: 1, z: 0 }, 1.35, MAX_SPEED)
    expect(Math.hypot(capped.x, capped.z)).toBeCloseTo(MAX_SPEED, 10)
  })

  it('keeps Hybrid Drive curved while preserving the vector-sum endpoint velocity', () => {
    const state = { position: { x: 0, z: 0 }, velocity: { x: 0.85, z: 0 }, worldAt: 0 }
    const plan = runHybrid(state, 'drive', { q: 0, r: -2 })
    expect(plan.valid).toBe(true)
    expect(plan.curveUsed).toBe(true)
    expect(plan.samples.length).toBe(DEFAULT_SOLVER_CONFIG.steps + 1)

    const midpoint = plan.samples[Math.floor(plan.samples.length / 2)].position
    const endpoint = plan.samples.at(-1).position
    const cross = midpoint.x * endpoint.z - midpoint.z * endpoint.x
    expect(Math.abs(cross)).toBeGreaterThan(0.02)
  })

  it('keeps Coast velocity unchanged', () => {
    const first = runHybrid(createInitialState(), 'drive', { q: 2, r: 0 })
    const coast = runHybrid(first.finalState, 'coast')
    expect(coast.valid).toBe(true)
    expect(coast.finalSpeed).toBeCloseTo(first.finalSpeed, 6)
  })

  it('keeps Counter reverse semantics', () => {
    const state = { position: { x: 0, z: 0 }, velocity: { x: 2, z: 0 }, worldAt: 0 }
    expect(runHybrid(state, 'counter', { q: -2, r: 0 }).valid).toBe(true)
    expect(runHybrid(state, 'counter', { q: 2, r: 0 }).valid).toBe(false)
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
})
