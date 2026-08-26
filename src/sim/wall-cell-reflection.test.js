import { describe, expect, it } from 'vitest'
import { axialToWorld, directionVector } from './hex.js'
import { momentumSpeed } from './solver.js'
import { simulateBasicMoveRule } from './spatial-rules.js'
import { resolveCellConflicts } from './conflict.js'
import { WALL_CELL_TRAVEL_RULE, internalWallCellImpact } from './wall-cell-reflection.js'

const nsWall = {
  id: 'wall-ns',
  hex: { q: 0, r: 0 },
  kind: 'hard',
  wallAxis: 'NS',
}

function stateAt(hex, axisId, level = 3) {
  const direction = directionVector(axisId)
  const speed = momentumSpeed(level)
  return {
    position: axialToWorld(hex),
    velocity: { x: direction.x * speed, z: direction.z * speed },
    axisId,
    worldAt: 0,
  }
}

function manualContactPlan(from, contact, directionId = 'SW', level = 3, finalM = 2) {
  const direction = directionVector(directionId)
  const speed = momentumSpeed(level)
  const finalSpeed = momentumSpeed(finalM)
  return {
    valid: true,
    action: { id: 'basic-move', label: 'Basic Move', kind: 'basic' },
    actionKind: 'basic',
    spatialMode: 'discrete',
    samples: [
      { t: 0, position: axialToWorld(from), velocity: { x: direction.x * speed, z: direction.z * speed }, axisId: directionId },
      { t: 1, position: axialToWorld(contact), velocity: { x: direction.x * finalSpeed, z: direction.z * finalSpeed }, axisId: directionId },
    ],
    collisions: [],
    traversedCells: [from, contact],
    finalState: {
      position: axialToWorld(contact),
      velocity: { x: direction.x * finalSpeed, z: direction.z * finalSpeed },
      axisId: directionId,
      worldAt: 1,
    },
    beforeSpeed: speed,
    afterImpulseSpeed: speed,
    finalSpeed,
    beforeM: level,
    finalM,
    axisBefore: directionId,
    axisAfter: directionId,
  }
}

describe('internal wall Cell pivot reflection', () => {
  it('reflects SW into SE across a north-south wall and exits from the wall Cell', () => {
    const impact = internalWallCellImpact({ obstacle: nsWall, incomingAxisId: 'SW' })
    expect(impact).toMatchObject({
      wallCellPivot: true,
      wallAxis: 'NS',
      pivotHex: { q: 0, r: 0 },
      exitHex: { q: 0, r: 1 },
      direction: { id: 'SE' },
      wallCellTravelCost: 1,
      reflectionContinuation: WALL_CELL_TRAVEL_RULE,
    })
  })

  it('charges one M3 travel step for a head-on wall crossing instead of granting three post-bounce Cells', () => {
    const plan = simulateBasicMoveRule({
      state: stateAt({ q: -1, r: 0 }, 'E', 3),
      aimPoint: axialToWorld({ q: 0, r: 0 }),
      spatialMode: 'discrete',
      obstacles: [nsWall],
    })

    expect(plan.valid).toBe(true)
    expect(plan.inputTargetHex).toEqual({ q: 0, r: 0 })
    expect(plan.reflectionContinuation).toBe(WALL_CELL_TRAVEL_RULE)
    expect(plan.reflectedMovementBudget).toBe(3)
    expect(plan.reflectedMovedSteps).toBe(3)
    expect(plan.collisions[0]).toMatchObject({
      geometryKind: 'obstacle-wall-cell-pivot',
      contactCell: { q: 0, r: 0 },
      attemptedCell: { q: 0, r: 0 },
      axisBefore: 'E',
      axisAfter: 'W',
      wallCellPivot: true,
      wallCellTravelCost: 1,
      wallAxis: 'NS',
    })
    expect(plan.traversedCells).toEqual([
      { q: -1, r: 0 },
      { q: -1, r: 0 },
      { q: -2, r: 0 },
      { q: -3, r: 0 },
    ])
    expect(plan.finalState.position).toEqual(axialToWorld({ q: -3, r: 0 }))
    expect(plan.axisAfter).toBe('W')
  })

  it('uses the wall Cell as the oblique pivot: NE neighbor -> wall -> SE neighbor', () => {
    const plan = simulateBasicMoveRule({
      state: stateAt({ q: 1, r: -1 }, 'SW', 3),
      aimPoint: axialToWorld({ q: 0, r: 0 }),
      spatialMode: 'discrete',
      obstacles: [nsWall],
    })

    expect(plan.valid).toBe(true)
    expect(plan.collisions[0]).toMatchObject({
      contactCell: { q: 0, r: 0 },
      axisBefore: 'SW',
      axisAfter: 'SE',
      wallCellTravelCost: 1,
    })
    expect(plan.traversedCells.slice(0, 2)).toEqual([
      { q: 1, r: -1 },
      { q: 0, r: 1 },
    ])
    expect(plan.traversedCells).not.toContainEqual({ q: 1, r: 0 })
    expect(plan.axisAfter).toBe('SE')
  })

  it('uses the same wall pivot for a knocked target and never inserts the incoming-side offset Cell', () => {
    const targetCell = { q: 1, r: -1 }
    const resolved = resolveCellConflicts({
      plan: manualContactPlan({ q: 2, r: -2 }, targetCell, 'SW', 3, 2),
      actors: [{ id: 'dummy', label: 'A', hex: targetCell, velocity: { x: 0, z: 0 }, axisId: null }],
      obstacles: [nsWall],
      boardRadius: 7,
      surfaceRestitution: 0.58,
      boundaryRestitution: 0.42,
    })

    const bounce = resolved.conflictEvents.find((event) => event.kind === 'surface-reflection' && event.actorId === 'dummy')
    expect(bounce).toMatchObject({
      geometryKind: 'obstacle-wall-cell-pivot',
      attemptedCell: { q: 0, r: 0 },
      to: { q: 0, r: 1 },
      axisBefore: 'SW',
      axisAfter: 'SE',
      wallCellPivot: true,
      wallCellTravelCost: 1,
      wallAxis: 'NS',
      reflectionContinuation: WALL_CELL_TRAVEL_RULE,
    })

    const integerPath = resolved.actorTrajectories.dummy.filter((point) => Number.isInteger(point.q) && Number.isInteger(point.r))
    expect(integerPath.slice(0, 2)).toEqual([
      { q: 1, r: -1 },
      { q: 0, r: 1 },
    ])
    expect(integerPath).not.toContainEqual({ q: 1, r: 0 })
    expect(resolved.actorStates[0].axisId).toBe('SE')
  })
})
