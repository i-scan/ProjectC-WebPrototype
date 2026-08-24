import { describe, expect, it } from 'vitest'
import { axialKey, axialToWorld, directionVector } from './hex.js'
import { momentumSpeed } from './solver.js'
import {
  basicMoveReachability,
  discreteActionReachability,
  simulateBasicMoveRule,
  simulatePrototypeSpatial,
} from './spatial-rules.js'

function stateAt(hex, axisId = null, level = 0) {
  const direction = axisId ? directionVector(axisId) : { x: 0, z: 0 }
  const speed = momentumSpeed(level)
  return {
    position: axialToWorld(hex),
    velocity: { x: direction.x * speed, z: direction.z * speed },
    axisId,
    worldAt: 0,
  }
}

function move(state, aimHex) {
  return simulateBasicMoveRule({
    state,
    aimPoint: axialToWorld(aimHex),
    spatialMode: 'discrete',
    obstacles: [],
  })
}

function reachKeys(level, axisId = 'E') {
  return basicMoveReachability({
    state: stateAt({ q: 0, r: 0 }, axisId, level),
    spatialMode: 'discrete',
    obstacles: [],
  }).map((entry) => axialKey(entry.finalHex)).sort()
}

describe('destination-driven Basic Move envelope', () => {
  it('keeps M0 as the six adjacent Cells', () => {
    expect(reachKeys(0)).toEqual(['-1,0', '-1,1', '0,-1', '0,1', '1,-1', '1,0'])
  })

  it('makes M1 five adjacent Cells except the reverse Cell', () => {
    expect(reachKeys(1)).toEqual(['-1,1', '0,-1', '0,1', '1,-1', '1,0'])

    const nw = move(stateAt({ q: 0, r: 0 }, 'E', 1), { q: 0, r: -1 })
    expect(nw.valid).toBe(true)
    expect(nw.finalM).toBe(0)
    expect(nw.traversedCells).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
    ])

    const sw = move(stateAt({ q: 0, r: 0 }, 'E', 1), { q: -1, r: 1 })
    expect(sw.traversedCells).toEqual([
      { q: 0, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
    ])
  })

  it('makes M2 a connected five-Cell arc and sends the two inner side landings through E', () => {
    expect(reachKeys(2)).toEqual(['0,1', '1,-1', '1,1', '2,-1', '2,0'])

    const innerNe = move(stateAt({ q: 0, r: 0 }, 'E', 2), { q: 1, r: -1 })
    expect(innerNe.valid).toBe(true)
    expect(innerNe.finalM).toBe(1)
    expect(innerNe.traversedCells).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 1, r: -1 },
    ])

    const innerSe = move(stateAt({ q: 0, r: 0 }, 'E', 2), { q: 0, r: 1 })
    expect(innerSe.traversedCells).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
    ])
  })

  it('makes M3 a connected seven-Cell front instead of three disconnected segments', () => {
    expect(reachKeys(3)).toEqual(['0,2', '1,2', '2,-2', '2,1', '3,-1', '3,-2', '3,0'])

    const connectorNe = move(stateAt({ q: 0, r: 0 }, 'E', 3), { q: 3, r: -1 })
    expect(connectorNe.valid).toBe(true)
    expect(connectorNe.finalM).toBe(2)
    expect(connectorNe.traversedCells).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: -1 },
    ])

    const connectorSe = move(stateAt({ q: 0, r: 0 }, 'E', 3), { q: 2, r: 1 })
    expect(connectorSe.traversedCells).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 2, r: 1 },
    ])
  })

  it('rotates the authored envelope with the current Axis', () => {
    const e = new Set(reachKeys(2, 'E'))
    const ne = new Set(reachKeys(2, 'NE'))
    expect(e).not.toEqual(ne)
    expect(ne).toEqual(new Set(['1,-2', '2,-2', '2,-1', '1,-1', '0,-1']))
  })

  it('preserves M0 Axis establishment and same-Axis natural M build', () => {
    const establish = move(stateAt({ q: 0, r: 0 }), { q: 1, r: 0 })
    expect(establish.basicRule).toBe('establish-axis')
    expect(establish.finalState.axisId).toBe('E')
    expect(establish.finalM).toBe(0)

    const m0ToM1 = move(stateAt({ q: 0, r: 0 }, 'E', 0), { q: 1, r: 0 })
    expect(m0ToM1.basicRule).toBe('same-axis-build')
    expect(m0ToM1.finalM).toBe(1)

    const m1ToM2 = move(stateAt({ q: 0, r: 0 }, 'E', 1), { q: 1, r: 0 })
    expect(m1ToM2.finalM).toBe(2)

    const m2ToM3 = move(stateAt({ q: 0, r: 0 }, 'E', 2), { q: 2, r: 0 })
    expect(m2ToM3.finalM).toBe(3)
  })

  it('rejects non-reachable reverse landings without entering a movement plan', () => {
    const state = stateAt({ q: 0, r: 0 }, 'E', 2)
    const plan = move(state, { q: -1, r: 0 })
    expect(plan.valid).toBe(false)
    expect(plan.reason).toContain('highlighted reachable Cells')
    expect(plan.finalState.position).toEqual(state.position)
    expect(plan.finalState.axisId).toBe('E')
    expect(plan.samples).toHaveLength(1)
  })
})

describe('discrete Drive uses the same Cell landing contract', () => {
  it('exposes the same M2 landing Cells as Basic Move', () => {
    const state = stateAt({ q: 0, r: 0 }, 'E', 2)
    const moveReach = basicMoveReachability({ state, spatialMode: 'discrete', obstacles: [] })
      .map((entry) => axialKey(entry.finalHex)).sort()
    const driveReach = discreteActionReachability({ state, actionId: 'drive', spatialMode: 'discrete', obstacles: [] })
      .map((entry) => axialKey(entry.finalHex)).sort()
    expect(driveReach).toEqual(moveReach)
  })

  it('moves to the clicked Cell through the authored curve instead of a straight resultant line', () => {
    const state = stateAt({ q: 0, r: 0 }, 'E', 2)
    const plan = simulatePrototypeSpatial({
      state,
      actionId: 'drive',
      spatialMode: 'discrete',
      aimPoint: axialToWorld({ q: 1, r: -1 }),
      obstacles: [],
    })
    expect(plan.valid).toBe(true)
    expect(plan.driveRule).toBe('cell-target-curved-composition')
    expect(plan.traversedCells).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 1, r: -1 },
    ])
    expect(plan.finalState.position).toEqual(axialToWorld({ q: 1, r: -1 }))
  })

  it('rejects opposite Drive targeting safely while M is active', () => {
    const state = stateAt({ q: 0, r: 0 }, 'E', 2)
    const plan = simulatePrototypeSpatial({
      state,
      actionId: 'drive',
      spatialMode: 'discrete',
      aimPoint: axialToWorld({ q: -1, r: 0 }),
      obstacles: [],
    })
    expect(plan.valid).toBe(false)
    expect(plan.samples).toHaveLength(1)
    expect(plan.finalState.position).toEqual(state.position)
  })
})
