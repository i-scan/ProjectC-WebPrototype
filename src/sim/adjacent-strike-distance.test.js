import { describe, expect, it } from 'vitest'
import { axialToWorld, directionVector } from './hex.js'
import { momentumSpeed } from './solver.js'
import { resolveCellConflicts } from './conflict.js'

function velocityFor(level, axisId = 'E') {
  const direction = directionVector(axisId)
  const speed = momentumSpeed(level)
  return { x: direction.x * speed, z: direction.z * speed }
}

function adjacentContactPlan(level) {
  const from = { q: 0, r: 0 }
  const contact = { q: 1, r: 0 }
  return {
    valid: true,
    action: { id: 'basic-move', label: 'Basic Move', kind: 'basic' },
    actionKind: 'basic',
    spatialMode: 'discrete',
    samples: [
      { t: 0, position: axialToWorld(from), velocity: velocityFor(level), axisId: 'E' },
      { t: 1, position: axialToWorld(contact), velocity: velocityFor(Math.max(0, level - 1)), axisId: 'E' },
    ],
    collisions: [],
    traversedCells: [from, contact],
    motionTrace: [{
      index: 0,
      kind: 'cell-step',
      from,
      to: contact,
      cost: 1,
      axisBefore: 'E',
      axisAfter: 'E',
      momentumBefore: level,
      momentumAfter: level,
      remainingBefore: 1,
      remainingAfter: 0,
      allowed: true,
    }],
    finalState: {
      position: axialToWorld(contact),
      velocity: velocityFor(Math.max(0, level - 1)),
      axisId: 'E',
      worldAt: 1,
    },
    beforeSpeed: momentumSpeed(level),
    afterImpulseSpeed: momentumSpeed(level),
    finalSpeed: momentumSpeed(Math.max(0, level - 1)),
    beforeM: level,
    finalM: Math.max(0, level - 1),
    axisBefore: 'E',
    axisAfter: 'E',
    actionTransaction: {
      rule: 'first-successful-travel-transaction-v1',
      fromM: level,
      toM: Math.max(0, level - 1),
      cause: 'Use',
      status: 'pending',
    },
  }
}

function targetWith(level = 0, axisId = level > 0 ? 'E' : null) {
  return [{
    id: 'dummy',
    label: 'A',
    hex: { q: 1, r: 0 },
    velocity: level > 0 && axisId ? velocityFor(level, axisId) : { x: 0, z: 0 },
    axisId,
    momentumLevel: level,
  }]
}

describe('adjacent Strike forced displacement', () => {
  it('M1 -> stationary M0 target moves exactly 1 Cell and settles M0', () => {
    const resolved = resolveCellConflicts({
      plan: adjacentContactPlan(1),
      actors: targetWith(0),
      obstacles: [],
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({ impactM: 1, resolved: true })
    expect(resolved.actorTrajectories.dummy).toEqual([
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ])
    expect(resolved.actorStates[0]).toMatchObject({
      hex: { q: 2, r: 0 },
      momentumLevel: 0,
      axisId: 'E',
    })
  })

  it('M2 -> stationary M0 target moves exactly 2 Cells and settles M1', () => {
    const resolved = resolveCellConflicts({
      plan: adjacentContactPlan(2),
      actors: targetWith(0),
      obstacles: [],
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({ impactM: 2, resolved: true })
    expect(resolved.actorTrajectories.dummy).toEqual([
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
    ])
    expect(resolved.actorStates[0]).toMatchObject({
      hex: { q: 3, r: 0 },
      momentumLevel: 1,
      axisId: 'E',
    })
  })

  it('existing E M1 + incoming E M1 composes to M2 and therefore travels 2 Cells', () => {
    const resolved = resolveCellConflicts({
      plan: adjacentContactPlan(1),
      actors: targetWith(1, 'E'),
      obstacles: [],
      boardRadius: 7,
    })

    expect(resolved.cellConflict?.momentumExchange).toMatchObject({
      sourceBeforeM: 1,
      targetBeforeM: 1,
      targetAfterM: 2,
    })
    expect(resolved.actorTrajectories.dummy).toEqual([
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
    ])
    expect(resolved.actorStates[0]).toMatchObject({
      hex: { q: 3, r: 0 },
      momentumLevel: 1,
      axisId: 'E',
    })
  })

  it('existing E M2 + incoming E M2 composes to transient M4 and therefore travels 4 Cells', () => {
    const resolved = resolveCellConflicts({
      plan: adjacentContactPlan(2),
      actors: targetWith(2, 'E'),
      obstacles: [],
      boardRadius: 7,
    })

    expect(resolved.cellConflict?.momentumExchange).toMatchObject({
      sourceBeforeM: 2,
      targetBeforeM: 2,
      targetAfterM: 4,
    })
    expect(resolved.actorTrajectories.dummy).toEqual([
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
      { q: 4, r: 0 },
      { q: 5, r: 0 },
    ])
    expect(resolved.actorStates[0]).toMatchObject({
      hex: { q: 5, r: 0 },
      momentumLevel: 3,
      axisId: 'E',
    })
  })
})
