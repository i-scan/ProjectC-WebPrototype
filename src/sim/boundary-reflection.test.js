import { describe, expect, it } from 'vitest'
import { axialKey, axialToWorld, directionVector, worldToAxial } from './hex.js'
import { DEFAULT_SOLVER_CONFIG, momentumSpeed } from './solver.js'
import { basicMoveReachability, discreteActionReachability, simulateBasicMoveRule, simulatePrototypeSpatial } from './spatial-rules.js'

function stateAt(hex, axisId = 'E', level = 3) {
  const direction = directionVector(axisId)
  const speed = momentumSpeed(level)
  return {
    position: axialToWorld(hex),
    velocity: { x: direction.x * speed, z: direction.z * speed },
    axisId,
    worldAt: 0,
  }
}

function configFor(boardRadius) {
  return { ...DEFAULT_SOLVER_CONFIG, boardRadius }
}

function reachMap(state, actionId = 'basic-move', boardRadius = 3, obstacles = []) {
  const config = configFor(boardRadius)
  const entries = actionId === 'basic-move'
    ? basicMoveReachability({ state, spatialMode: 'discrete', config, obstacles })
    : discreteActionReachability({ state, actionId, spatialMode: 'discrete', config, obstacles })
  return new Map(entries.map((entry) => [axialKey(entry.finalHex), entry]))
}

describe('player physical boundary reflection', () => {
  it('keeps reachable Cells at the outer edge instead of deleting every route that touches the boundary', () => {
    const state = stateAt({ q: 3, r: 0 }, 'E', 3)
    const reach = reachMap(state, 'basic-move', 3)

    expect(reach.size).toBeGreaterThan(0)
    expect([...reach.values()].some((entry) => entry.reflectionCount > 0)).toBe(true)
    expect([...reach.keys()].some((key) => key === '1,0' || key === '2,0')).toBe(true)
  })

  it('reflects the forward M3 route physically and spends M for both long travel and the reflection', () => {
    const state = stateAt({ q: 3, r: 0 }, 'E', 3)
    const plan = simulateBasicMoveRule({
      state,
      aimPoint: axialToWorld({ q: 1, r: 0 }),
      spatialMode: 'discrete',
      config: configFor(3),
      obstacles: [],
    })

    expect(plan.valid).toBe(true)
    expect(plan.playerReflectionRule).toBe('physical-multi-bounce-v1')
    expect(plan.reflectionCount).toBe(1)
    expect(plan.collisions[0]).toMatchObject({ kind: 'boundary', reflection: true, axisBefore: 'E', axisAfter: 'W' })
    expect(plan.traversedCells).toEqual([
      { q: 3, r: 0 },
      { q: 2, r: 0 },
      { q: 1, r: 0 },
    ])
    expect(worldToAxial(plan.finalState.position)).toEqual({ q: 1, r: 0 })
    expect(plan.axisAfter).toBe('W')
    expect(plan.finalM).toBe(1)
  })

  it('does not impose a one-reflection-per-AT cap in the corner experiment', () => {
    const state = stateAt({ q: 1, r: 0 }, 'E', 3)
    const obstacles = [
      { id: 'wall-a', hex: { q: 2, r: 0 }, kind: 'hard' },
      { id: 'wall-b', hex: { q: 0, r: 0 }, kind: 'hard' },
    ]
    const reach = reachMap(state, 'basic-move', 3, obstacles)
    const multi = [...reach.values()].find((entry) => entry.reflectionCount >= 2)

    expect(multi).toBeTruthy()
    expect(multi.reflectionCount).toBeGreaterThanOrEqual(2)
    expect(multi.finalM).toBe(0)
  })

  it('lets Discrete Drive use the same reflected landing contract at the edge', () => {
    const state = stateAt({ q: 3, r: 0 }, 'E', 3)
    const reach = reachMap(state, 'drive', 3)
    expect(reach.size).toBeGreaterThan(0)
    expect([...reach.values()].some((entry) => entry.reflectionCount > 0)).toBe(true)

    const reflected = [...reach.values()].find((entry) => entry.reflectionCount > 0 && entry.finalHex.q < 3)
    expect(reflected).toBeTruthy()
    const plan = simulatePrototypeSpatial({
      state,
      actionId: 'drive',
      spatialMode: 'discrete',
      aimPoint: axialToWorld(reflected.finalHex),
      config: configFor(3),
      obstacles: [],
    })
    expect(plan.valid).toBe(true)
    expect(plan.reflectionCount).toBeGreaterThan(0)
    expect(plan.axisAfter).not.toBe('E')
  })
})
