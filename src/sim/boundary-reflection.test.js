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
  return new Map(entries.map((entry) => [axialKey(entry.targetHex), entry]))
}

describe('player clipped mirror boundary reflection', () => {
  it('highlights the collision Cell while keeping the reflected physical landing separate', () => {
    const state = stateAt({ q: 3, r: -1 }, 'E', 3)
    const reach = reachMap(state, 'basic-move', 3)

    expect(reach.size).toBeGreaterThan(0)
    const bounce = reach.get('3,-1')
    expect(bounce).toBeTruthy()
    expect(bounce.reflectionCount).toBeGreaterThan(0)
    expect(bounce.finalHex).toEqual({ q: 3, r: -1 })
    expect(bounce.resolvedFinalHex).not.toEqual(bounce.finalHex)
  })

  it('treats an immediate boundary hit as Redirect and preserves the declared Travel3 budget', () => {
    const state = stateAt({ q: 3, r: -1 }, 'E', 3)
    const plan = simulateBasicMoveRule({
      state,
      aimPoint: axialToWorld({ q: 3, r: -1 }),
      spatialMode: 'discrete',
      config: configFor(3),
      obstacles: [],
    })

    expect(plan.valid).toBe(true)
    expect(plan.surfaceGeometry).toBe('clipped-cell-mirror-v2')
    expect(plan.reflectionContinuation).toBe('contact-ray-step-budget-v3')
    expect(plan.reflectionCount).toBe(1)
    expect(plan.reflectedMovementBudget).toBe(3)
    expect(plan.reflectedMovedSteps).toBe(3)
    expect(plan.collisions[0]).toMatchObject({
      kind: 'boundary',
      geometryKind: 'boundary',
      reflection: true,
      axisBefore: 'E',
      axisAfter: 'SW',
      beforeM: 3,
      afterM: 3,
      contactCell: { q: 3, r: -1 },
      faceIds: ['+q'],
      reflectionContinuation: 'contact-ray-step-budget-v3',
    })
    expect(plan.actionTransaction).toMatchObject({ fromM: 3, toM: 2, cause: 'Use' })
    expect(plan.traversedCells).toHaveLength(4)
    expect(worldToAxial(plan.finalState.position)).not.toEqual({ q: 3, r: -1 })
    expect(plan.axisAfter).toBe('SW')
    expect(plan.finalM).toBe(2)
    expect(plan.samples.some((sample) => sample.collision)).toBe(true)
    expect(plan.samples.some((sample) => sample.reflectionGuide)).toBe(true)
  })

  it('preserves spent Cells before a corner reflection without adding a second Momentum cost', () => {
    const state = stateAt({ q: 3, r: -1 }, 'SE', 3)
    const plan = simulateBasicMoveRule({
      state,
      aimPoint: axialToWorld({ q: 3, r: 0 }),
      spatialMode: 'discrete',
      config: configFor(3),
      obstacles: [],
    })

    expect(plan.valid).toBe(true)
    expect(plan.reflectionCount).toBe(1)
    expect(plan.reflectedMovementBudget).toBe(3)
    expect(plan.reflectedMovedSteps).toBe(3)
    expect(plan.collisions[0]).toMatchObject({
      geometryKind: 'boundary-corner-chamfer',
      axisBefore: 'SE',
      axisAfter: 'SW',
      beforeM: 2,
      afterM: 2,
      contactCell: { q: 3, r: 0 },
    })
    expect(plan.traversedCells[0]).toEqual({ q: 3, r: -1 })
    expect(plan.traversedCells[1]).toEqual({ q: 3, r: 0 })
    expect(plan.traversedCells).toHaveLength(4)
    expect(plan.axisAfter).toBe('SW')
    expect(plan.finalM).toBe(2)
  })

  it('chooses one incident wall face at a sharp obstacle vertex and continues the full declared route', () => {
    const state = stateAt({ q: 1, r: 0 }, 'E', 3)
    const obstacles = [{ id: 'wall-a', hex: { q: 2, r: 0 }, kind: 'hard' }]
    const reach = reachMap(state, 'basic-move', 3, obstacles)
    const reflected = reach.get('1,0')

    expect(reflected).toBeTruthy()
    expect(reflected.reflectionCount).toBe(1)
    expect(reflected.movedSteps).toBe(reflected.movementBudget)
    expect(reflected.axisAfter).not.toBe('W')
    expect(['NW', 'SW']).toContain(reflected.axisAfter)
    expect(reflected.resolvedFinalHex).not.toEqual({ q: 0, r: 0 })
  })

  it('lets Drive use the same collision-Cell input and surface redirect continuation', () => {
    const state = stateAt({ q: 3, r: -1 }, 'E', 3)
    const reach = reachMap(state, 'drive', 3)
    const reflected = reach.get('3,-1')
    expect(reflected).toBeTruthy()
    expect(reflected.reflectionCount).toBeGreaterThan(0)
    expect(reflected.movedSteps).toBe(reflected.movementBudget)

    const plan = simulatePrototypeSpatial({
      state,
      actionId: 'drive',
      spatialMode: 'discrete',
      aimPoint: axialToWorld(reflected.targetHex),
      config: configFor(3),
      obstacles: [],
    })
    expect(plan.valid).toBe(true)
    expect(plan.reflectionCount).toBeGreaterThan(0)
    expect(plan.axisAfter).toBe('SW')
    expect(plan.reflectedMovedSteps).toBe(plan.reflectedMovementBudget)
    expect(worldToAxial(plan.finalState.position)).toEqual(reflected.resolvedFinalHex)
    expect(plan.finalM).toBe(3)
  })
})
