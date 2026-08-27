import { describe, expect, it } from 'vitest'
import { axialToWorld, directionVector } from './hex.js'
import { momentumSpeed } from './solver.js'
import { simulateBasicMoveRule } from './spatial-rules.js'
import {
  REFLECTED_ACTOR_CONFLICT_RULE,
  WALL_TRAVEL_BUDGET_RULE,
  resolveCellConflicts,
} from './conflict.js'

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

function manualPlan(from, contact, axisId, level, finalM = Math.max(0, level - 1)) {
  const direction = directionVector(axisId)
  const speed = momentumSpeed(level)
  const finalSpeed = momentumSpeed(finalM)
  return {
    valid: true,
    action: { id: 'basic-move', label: 'Basic Move', kind: 'basic' },
    actionKind: 'basic',
    spatialMode: 'discrete',
    samples: [
      { t: 0, position: axialToWorld(from), velocity: { x: direction.x * speed, z: direction.z * speed }, axisId },
      { t: 1, position: axialToWorld(contact), velocity: { x: direction.x * finalSpeed, z: direction.z * finalSpeed }, axisId },
    ],
    collisions: [],
    traversedCells: [from, contact],
    finalState: {
      position: axialToWorld(contact),
      velocity: { x: direction.x * finalSpeed, z: direction.z * finalSpeed },
      axisId,
      worldAt: 1,
    },
    beforeSpeed: speed,
    afterImpulseSpeed: speed,
    finalSpeed,
    beforeM: level,
    finalM,
    axisBefore: axisId,
    axisAfter: axisId,
  }
}

describe('wall travel budget regression', () => {
  it.each([
    [1, 1, { q: -1, r: 0 }],
    [2, 1, { q: -1, r: 0 }],
    [3, 2, { q: -2, r: 0 }],
  ])('uses current-M travel after Basic spend for player M%d wall reflection', (level, expectedMovedSteps, expectedHex) => {
    const wall = nsWallAt(0, 0)
    const plan = simulateBasicMoveRule({
      state: stateAt({ q: -1, r: 0 }, 'E', level),
      aimPoint: axialToWorld({ q: 0, r: 0 }),
      spatialMode: 'discrete',
      obstacles: [wall],
    })

    expect(plan.valid).toBe(true)
    expect(plan.collisions[0]).toMatchObject({
      wallCellPivot: true,
      wallCellTravelCost: 1,
      contactCell: { q: 0, r: 0 },
    })
    expect(plan.reflectedMovementBudget).toBe(level)
    expect(plan.reflectedMovedSteps).toBe(expectedMovedSteps)
    expect(plan.finalState.position).toEqual(axialToWorld(expectedHex))
  })

  it('makes an M1 knocked target bounce to its original Cell when a wall is directly behind it', () => {
    const wall = nsWallAt(2, 0)
    const plan = manualPlan({ q: 0, r: 0 }, { q: 1, r: 0 }, 'E', 1, 1)
    const resolved = resolveCellConflicts({
      plan,
      actors: [{ id: 'a', label: 'A', hex: { q: 1, r: 0 }, velocity: { x: 0, z: 0 }, axisId: null }],
      obstacles: [wall],
      boardRadius: 7,
    })

    expect(resolved.actorStates[0].hex).toEqual({ q: 1, r: 0 })
    expect(resolved.traversedCells).toEqual([{ q: 0, r: 0 }])
    expect(resolved.cellConflict).toMatchObject({ resolved: false })
    expect(resolved.actorTrajectories.a[0]).toEqual({ q: 1, r: 0 })
    expect(resolved.actorTrajectories.a.at(-1)).toEqual({ q: 1, r: 0 })
    expect(resolved.conflictEvents.some((event) => event.kind === 'surface-reflection' && event.wallCellTravelCost === 1)).toBe(true)
    expect(resolved.conflictEvents.some((event) => event.travelBudgetRule === WALL_TRAVEL_BUDGET_RULE)).toBe(true)
  })

  it('resolves an occupied first reflection-exit Cell as a new actor collision using reflected current M', () => {
    const wall = nsWallAt(0, 0)
    const plan = manualPlan({ q: 2, r: -2 }, { q: 1, r: -1 }, 'SW', 2, 1)
    const resolved = resolveCellConflicts({
      plan,
      actors: [
        { id: 'a', label: 'A', hex: { q: 1, r: -1 }, velocity: { x: 0, z: 0 }, axisId: null },
        { id: 'b', label: 'B', hex: { q: 0, r: 1 }, velocity: { x: 0, z: 0 }, axisId: null },
      ],
      obstacles: [wall],
      boardRadius: 7,
      surfaceRestitution: 0.58,
      boundaryRestitution: 0.42,
    })

    const reflectedTransfer = resolved.conflictEvents.find((event) => (
      event.kind === 'momentum-transfer'
      && event.sourceActorId === 'a'
      && event.targetActorId === 'b'
    ))
    expect(reflectedTransfer).toMatchObject({
      model: REFLECTED_ACTOR_CONFLICT_RULE,
      reflectedSource: true,
      sourceBeforeM: 1,
      targetBeforeM: 0,
      targetAfterM: 1,
    })

    const byId = Object.fromEntries(resolved.actorStates.map((actor) => [actor.id, actor]))
    expect(byId.a.hex).toEqual({ q: 0, r: 1 })
    expect(byId.b.hex).toEqual({ q: 0, r: 2 })
    expect(resolved.actorTrajectories.a).toContainEqual({ q: 0, r: 0 })
    expect(resolved.actorTrajectories.a).toContainEqual({ q: 0, r: 1 })
    expect(resolved.actorTrajectories.b).toEqual([{ q: 0, r: 1 }, { q: 0, r: 2 }])
  })
})
