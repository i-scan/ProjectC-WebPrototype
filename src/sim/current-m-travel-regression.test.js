import { describe, expect, it } from 'vitest'
import { axialToWorld, directionVector } from './hex.js'
import { momentumSpeed } from './solver.js'
import { simulateBasicMoveRule } from './spatial-rules.js'
import { resolveCellConflicts } from './conflict.js'

const nsWallAt = (q, r) => ({ id: `wall-${q}-${r}`, hex: { q, r }, kind: 'hard', wallAxis: 'NS', radius: 0.34 })

function stateAt(hex, axisId, level) {
  const direction = directionVector(axisId)
  const speed = momentumSpeed(level)
  return {
    position: axialToWorld(hex),
    velocity: { x: direction.x * speed, z: direction.z * speed },
    axisId,
    worldAt: 0,
  }
}

function basicPlan(state, aimHex, obstacles = []) {
  return simulateBasicMoveRule({
    state,
    aimPoint: axialToWorld(aimHex),
    spatialMode: 'discrete',
    obstacles,
  })
}

describe('Spatial Inertia v1 travel transaction accounting', () => {
  it('lets an M2 wall roundtrip consume one Travel, then commits Use M2→M1 without truncating the declared route', () => {
    const wall = nsWallAt(0, 0)
    const plan = basicPlan(stateAt({ q: -1, r: 0 }, 'E', 2), { q: 0, r: 0 }, [wall])

    expect(plan.valid).toBe(true)
    expect(plan.motionTrace[0]).toMatchObject({
      kind: 'wall-cell-step',
      cost: 1,
      momentumBefore: 2,
      momentumAfter: 1,
      remainingBefore: 2,
      remainingAfter: 1,
    })
    expect(plan.motionTrace.filter((entry) => entry.cost === 1)).toHaveLength(2)
    expect(plan.reflectedMovedSteps).toBe(2)
    expect(plan.remainingTravel).toBe(0)
    expect(plan.finalM).toBe(1)
    expect(plan.finalState.position).toEqual(axialToWorld({ q: -2, r: 0 }))
    expect(plan.collisions[0]).toMatchObject({ beforeM: 2, afterM: 2 })
  })

  it('lets an M3 wall roundtrip preserve the full Travel3 route while the one Action transaction settles M3→M2', () => {
    const wall = nsWallAt(0, 0)
    const plan = basicPlan(stateAt({ q: -1, r: 0 }, 'E', 3), { q: 0, r: 0 }, [wall])

    expect(plan.valid).toBe(true)
    expect(plan.motionTrace[0]).toMatchObject({
      kind: 'wall-cell-step',
      cost: 1,
      momentumBefore: 3,
      momentumAfter: 2,
      remainingBefore: 3,
      remainingAfter: 2,
    })
    expect(plan.motionTrace.filter((entry) => entry.cost === 1)).toHaveLength(3)
    expect(plan.reflectedMovedSteps).toBe(3)
    expect(plan.remainingTravel).toBe(0)
    expect(plan.finalM).toBe(2)
    expect(plan.finalState.position).toEqual(axialToWorld({ q: -3, r: 0 }))
    expect(plan.collisions[0]).toMatchObject({ beforeM: 3, afterM: 3 })
  })

  it('uses M1 after one successful Travel when an M2 Basic Move later hits a stationary Actor', () => {
    const plan = basicPlan(stateAt({ q: 0, r: 1 }, 'E', 2), { q: 2, r: 1 })
    expect(plan.motionTrace.every((entry) => entry.momentumAfter === 1)).toBe(true)

    const resolved = resolveCellConflicts({
      plan,
      actors: [{ id: 'target', label: 'T', hex: { q: 2, r: 1 }, velocity: { x: 0, z: 0 }, axisId: null }],
      obstacles: [],
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({
      targetActorId: 'target',
      impactM: 1,
      resolved: true,
      momentumExchange: {
        sourceBeforeM: 1,
        sourceAfterM: 0,
        targetAfterM: 1,
      },
    })
    expect(resolved.actorTrajectories.target).toEqual([
      { q: 2, r: 1 },
      { q: 3, r: 1 },
    ])
    expect(resolved.actorStates[0].hex).toEqual({ q: 3, r: 1 })
  })

  it('uses M2 after prior Travel when an M3 Basic Move hits a stationary Actor on its third Cell', () => {
    const plan = basicPlan(stateAt({ q: 0, r: 0 }, 'E', 3), { q: 3, r: 0 })
    const resolved = resolveCellConflicts({
      plan,
      actors: [{ id: 'target', label: 'T', hex: { q: 3, r: 0 }, velocity: { x: 0, z: 0 }, axisId: null }],
      obstacles: [],
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({
      impactM: 2,
      momentumExchange: { sourceBeforeM: 2, sourceAfterM: 0, targetAfterM: 2 },
    })
    expect(resolved.actorTrajectories.target).toEqual([
      { q: 3, r: 0 },
      { q: 4, r: 0 },
      { q: 5, r: 0 },
    ])
    expect(resolved.actorStates[0].hex).toEqual({ q: 5, r: 0 })
  })
})
