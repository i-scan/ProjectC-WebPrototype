import { describe, expect, it } from 'vitest'
import { axialToWorld, directionVector } from './hex.js'
import { momentumLevel, momentumSpeed } from './solver.js'
import { simulateBasicMoveRule } from './spatial-rules.js'
import { resolveCellConflicts } from './conflict.js'

const hardWall = {
  id: 'wall',
  hex: { q: 3, r: 0 },
  kind: 'hard',
  shape: 'box',
  sizeX: 0.76,
  sizeZ: 0.20,
  rotation: 0,
}

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

function manualContactPlan(from, contact, directionId = 'NE', level = 3, finalM = 2) {
  const direction = directionVector(directionId)
  const velocity = { x: direction.x * momentumSpeed(level), z: direction.z * momentumSpeed(level) }
  const finalVelocity = { x: direction.x * momentumSpeed(finalM), z: direction.z * momentumSpeed(finalM) }
  return {
    valid: true,
    action: { id: 'basic-move', label: 'Basic Move', kind: 'basic' },
    actionKind: 'basic',
    spatialMode: 'discrete',
    samples: [
      { t: 0, position: axialToWorld(from), velocity, axisId: directionId },
      { t: 1, position: axialToWorld(contact), velocity: finalVelocity, axisId: directionId },
    ],
    collisions: [],
    traversedCells: [from, contact],
    finalState: {
      position: axialToWorld(contact),
      velocity: finalVelocity,
      axisId: directionId,
      worldAt: 1,
    },
    beforeSpeed: momentumSpeed(level),
    afterImpulseSpeed: momentumSpeed(level),
    finalSpeed: momentumSpeed(finalM),
    beforeM: level,
    finalM,
    axisBefore: directionId,
    axisAfter: directionId,
  }
}

describe('rendered obstacle reflection integration', () => {
  it('turns a player rushing NE into the wall to SE on the very first reflected Cell', () => {
    const start = { q: 2, r: 1 }
    const state = stateAt(start, 'NE', 3)
    const plan = simulateBasicMoveRule({
      state,
      // Near an internal wall the clickable target is the collision Cell.
      aimPoint: axialToWorld(start),
      spatialMode: 'discrete',
      obstacles: [hardWall],
    })

    expect(plan.valid).toBe(true)
    expect(plan.collisions[0]).toMatchObject({
      geometryKind: 'obstacle-box-face',
      axisBefore: 'NE',
      axisAfter: 'SE',
      faceIds: ['z+'],
    })
    expect(plan.traversedCells).toEqual([
      { q: 2, r: 1 },
      { q: 2, r: 2 },
      { q: 2, r: 3 },
      { q: 2, r: 4 },
    ])
    expect(plan.axisAfter).toBe('SE')
  })

  it('launches a knocked target directly onto the reflected SE route without a one-Cell entry-edge detour', () => {
    const playerFrom = { q: 1, r: 2 }
    const targetCell = { q: 2, r: 1 }
    const plan = manualContactPlan(playerFrom, targetCell, 'NE', 3, 2)
    const resolved = resolveCellConflicts({
      plan,
      actors: [{ id: 'dummy', label: 'A', hex: targetCell, velocity: { x: 0, z: 0 }, axisId: null }],
      obstacles: [hardWall],
      boardRadius: 7,
      surfaceRestitution: 0.58,
      boundaryRestitution: 0.42,
    })

    const bounce = resolved.conflictEvents.find((event) => event.kind === 'surface-reflection')
    expect(bounce).toMatchObject({
      actorId: 'dummy',
      geometryKind: 'obstacle-box-face',
      axisBefore: 'NE',
      axisAfter: 'SE',
      faceIds: ['z+'],
    })

    const path = resolved.actorTrajectories.dummy
    const integerCells = path.filter((point) => Number.isInteger(point.q) && Number.isInteger(point.r))
    expect(integerCells.slice(0, 3)).toEqual([
      { q: 2, r: 1 },
      { q: 2, r: 2 },
      { q: 2, r: 3 },
    ])
    expect(integerCells).not.toContainEqual({ q: 3, r: 1 })
    expect(resolved.actorStates[0].axisId).toBe('SE')
    expect(momentumLevel(Math.hypot(resolved.actorStates[0].velocity.x, resolved.actorStates[0].velocity.z))).toBe(2)
  })
})
