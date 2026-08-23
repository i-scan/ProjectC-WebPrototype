import { describe, expect, it } from 'vitest'
import { axialToWorld, directionVector } from './hex.js'
import { momentumSpeed } from './solver.js'
import { simulateBasicMoveRule } from './spatial-rules.js'

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

describe('Basic Move foundation rules', () => {
  it('establishes Axis at M0 without creating Momentum', () => {
    const plan = move(stateAt({ q: 0, r: 0 }), { q: 1, r: 0 })
    expect(plan.valid).toBe(true)
    expect(plan.basicRule).toBe('establish-axis')
    expect(plan.finalState.axisId).toBe('E')
    expect(plan.finalM).toBe(0)
    expect(plan.traversedCells.at(-1)).toEqual({ q: 1, r: 0 })
  })

  it('builds M by repeating Basic Move on the same Axis', () => {
    const m0ToM1 = move(stateAt({ q: 0, r: 0 }, 'E', 0), { q: 1, r: 0 })
    expect(m0ToM1.basicRule).toBe('same-axis-build')
    expect(m0ToM1.finalM).toBe(1)

    const m1ToM2 = move(stateAt({ q: 0, r: 0 }, 'E', 1), { q: 1, r: 0 })
    expect(m1ToM2.finalM).toBe(2)
    expect(m1ToM2.range).toBe(1)

    const m2ToM3 = move(stateAt({ q: 0, r: 0 }, 'E', 2), { q: 1, r: 0 })
    expect(m2ToM3.finalM).toBe(3)
    expect(m2ToM3.range).toBe(2)
    expect(m2ToM3.traversedCells.at(-1)).toEqual({ q: 2, r: 0 })
  })

  it('lets M0 freely re-establish Axis in the opposite direction', () => {
    const plan = move(stateAt({ q: 0, r: 0 }, 'E', 0), { q: -1, r: 0 })
    expect(plan.valid).toBe(true)
    expect(plan.basicRule).toBe('establish-axis')
    expect(plan.finalState.axisId).toBe('W')
    expect(plan.finalM).toBe(0)
  })

  it('spends one M while steering and preserves the M2 turning path', () => {
    const plan = move(stateAt({ q: 0, r: 0 }, 'E', 2), { q: 0, r: -1 })
    expect(plan.valid).toBe(true)
    expect(plan.basicRule).toBe('steer-spend')
    expect(plan.range).toBe(2)
    expect(plan.finalM).toBe(1)
    expect(plan.traversedCells).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: -1 },
    ])
  })

  it('gives M3 a larger turn radius / Range 3 experimental envelope', () => {
    const plan = move(stateAt({ q: 0, r: 0 }, 'E', 3), { q: 0, r: -1 })
    expect(plan.valid).toBe(true)
    expect(plan.range).toBe(3)
    expect(plan.finalM).toBe(2)
    expect(plan.traversedCells).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: -1 },
      { q: 2, r: -2 },
    ])
  })

  it('rejects a 180-degree Basic Move safely while M is active', () => {
    const state = stateAt({ q: 0, r: 0 }, 'E', 2)
    const plan = move(state, { q: -1, r: 0 })
    expect(plan.valid).toBe(false)
    expect(plan.reason).toContain('outside the steering envelope')
    expect(plan.finalState.position).toEqual(state.position)
    expect(plan.finalState.axisId).toBe('E')
    expect(plan.samples).toHaveLength(1)
  })
})
