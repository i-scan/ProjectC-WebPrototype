import { describe, expect, it } from 'vitest'
import { axialToWorld, directionVector } from './hex.js'
import { momentumSpeed } from './solver.js'
import { simulateBasicMoveRule } from './spatial-rules.js'
import { resolveCellConflicts } from './conflict.js'

function stateAt(hex, level, axisId) {
  const direction = directionVector(axisId)
  const speed = momentumSpeed(level)
  return {
    position: axialToWorld(hex),
    velocity: { x: direction.x * speed, z: direction.z * speed },
    axisId,
    worldAt: 0,
  }
}

describe('reflected Actor current-M travel regression', () => {
  it('caps the reflected source by its new M immediately after Actor contact', () => {
    const obstacles = [
      { id: 'UT3Hard-3,0', hex: { q: 3, r: 0 }, radius: 0.34, kind: 'hard', wallAxis: 'NS' },
    ]
    const actors = [
      { id: 'dummy-a', label: 'A', hex: { q: 4, r: -1 }, velocity: { x: 0, z: 0 }, axisId: null },
      { id: 'dummy-b', label: 'B', hex: { q: 3, r: 1 }, velocity: { x: 0, z: 0 }, axisId: null },
    ]

    // Current reflected-route input uses the first collision Cell as the
    // clickable landing proxy. The nominal M3 SW route would continue to
    // (2,1), but its authored N-S wall contact is (3,0).
    const plan = simulateBasicMoveRule({
      spatialMode: 'discrete',
      state: stateAt({ q: 5, r: -2 }, 3, 'SW'),
      aimPoint: axialToWorld({ q: 3, r: 0 }),
      obstacles,
    })

    expect(plan.valid).toBe(true)
    expect(plan.inputTargetHex).toEqual({ q: 3, r: 0 })
    expect(plan.nominalTargetHex).toEqual({ q: 2, r: 1 })

    const resolved = resolveCellConflicts({
      plan,
      actors,
      obstacles,
      boardRadius: 7,
      surfaceRestitution: 0.58,
      boundaryRestitution: 0.42,
    })

    expect(resolved.cellConflict).toMatchObject({
      targetActorId: 'dummy-a',
      impactM: 3,
      resolved: true,
    })

    const reflectedTransfer = resolved.conflictEvents.find((event) => (
      event.kind === 'momentum-transfer'
      && event.sourceActorId === 'dummy-a'
      && event.targetActorId === 'dummy-b'
      && event.model === 'reflected-actor-current-m-exchange-v1'
    ))
    expect(reflectedTransfer).toMatchObject({
      sourceBeforeM: 2,
      sourceAfterM: 1,
      targetAfterM: 2,
    })

    const actorCells = Object.fromEntries(resolved.actorStates.map((actor) => [actor.id, actor.hex]))
    expect(actorCells).toEqual({
      'dummy-a': { q: 3, r: 2 },
      'dummy-b': { q: 3, r: 3 },
    })

    const aPath = resolved.actorTrajectories['dummy-a']
    const bPath = resolved.actorTrajectories['dummy-b']
    expect(aPath.at(-1)).toEqual({ q: 3, r: 2 })
    expect(aPath).not.toContainEqual({ q: 3, r: 3 })
    expect(bPath.at(-1)).toEqual({ q: 3, r: 3 })

    const aTrace = resolved.actorMotionTrace['dummy-a']
    expect(aTrace[0]).toMatchObject({
      kind: 'wall-cell-step',
      cost: 1,
      remainingBefore: 3,
      remainingAfter: 1,
      momentumAfter: 1,
    })
    expect(aTrace[1]).toMatchObject({
      kind: 'cell-step',
      cost: 1,
      remainingBefore: 1,
      remainingAfter: 0,
      momentumBefore: 1,
      momentumAfter: 1,
    })
    expect(aTrace.filter((entry) => entry.cost === 1)).toHaveLength(2)

    const aWindow = resolved.actorPlaybackWindows['dummy-a']
    const bWindow = resolved.actorPlaybackWindows['dummy-b']
    expect(aWindow).toBeTruthy()
    expect(bWindow).toBeTruthy()
    expect(bWindow.start - aWindow.start).toBeLessThan(0.08)
    expect(bWindow.start).toBeLessThan(aWindow.end)
  })
})
