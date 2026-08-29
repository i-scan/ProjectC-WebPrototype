import { describe, expect, it } from 'vitest'
import { axialToWorld, directionVector } from './hex.js'
import { momentumSpeed } from './solver.js'
import { simulateBasicMoveRule } from './spatial-rules.js'
import { STRIKE_RULE, resolveCellConflicts } from './conflict.js'

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

describe('reflected Actor Spatial Inertia v1 regression', () => {
  it('uses adjacent Strike before the Basic transaction, then Forced Use before reflected exit Contact', () => {
    const obstacles = [
      { id: 'UT3Hard-3,0', hex: { q: 3, r: 0 }, radius: 0.34, kind: 'hard', wallAxis: 'NS' },
    ]
    const actors = [
      { id: 'dummy-a', label: 'A', hex: { q: 4, r: -1 }, velocity: { x: 0, z: 0 }, axisId: null },
      { id: 'dummy-b', label: 'B', hex: { q: 3, r: 1 }, velocity: { x: 0, z: 0 }, axisId: null },
    ]

    const plan = simulateBasicMoveRule({
      spatialMode: 'discrete',
      state: stateAt({ q: 5, r: -2 }, 3, 'SW'),
      aimPoint: axialToWorld({ q: 3, r: 0 }),
      obstacles,
    })

    expect(plan.valid).toBe(true)
    expect(plan.inputTargetHex).toEqual({ q: 3, r: 0 })

    const resolved = resolveCellConflicts({
      plan,
      actors,
      obstacles,
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({
      targetActorId: 'dummy-a',
      impactM: 3,
      resolved: true,
      contactBehavior: 'Strike',
      momentumExchange: {
        sourceBeforeM: 3,
        sourceAfterM: 0,
        targetAfterM: 3,
        model: STRIKE_RULE,
      },
    })
    expect(resolved.actionTransaction.status).toBe('preempted-by-strike')

    const forcedA = resolved.conflictEvents.find((event) => (
      event.kind === 'momentum-event'
      && event.actorId === 'dummy-a'
      && event.cause === 'Forced Use'
    ))
    expect(forcedA).toMatchObject({ fromM: 3, toM: 2 })

    const reflectedTransfer = resolved.conflictEvents.find((event) => (
      event.kind === 'momentum-transfer'
      && event.sourceActorId === 'dummy-a'
      && event.targetActorId === 'dummy-b'
    ))
    expect(reflectedTransfer).toMatchObject({
      model: STRIKE_RULE,
      sourceBeforeM: 2,
      sourceAfterM: 0,
      targetAfterM: 2,
    })

    const reflection = resolved.conflictEvents.find((event) => (
      event.kind === 'surface-reflection' && event.actorId === 'dummy-a'
    ))
    expect(reflection).toMatchObject({ beforeM: 3, afterM: 3, directMomentumLoss: false })

    const actorCells = Object.fromEntries(resolved.actorStates.map((actor) => [actor.id, actor.hex]))
    expect(actorCells['dummy-a']).toEqual({ q: 3, r: 1 })
    expect(actorCells['dummy-b']).toEqual({ q: 3, r: 3 })

    expect(resolved.actorTrajectories['dummy-a'].at(-1)).toEqual({ q: 3, r: 1 })
    expect(resolved.actorTrajectories['dummy-b']).toEqual([
      { q: 3, r: 1 },
      { q: 3, r: 2 },
      { q: 3, r: 3 },
    ])
    expect(resolved.actorStates.find((actor) => actor.id === 'dummy-b').momentumLevel).toBe(1)

    const aTrace = resolved.actorMotionTrace['dummy-a']
    expect(aTrace).toHaveLength(1)
    expect(aTrace[0]).toMatchObject({
      kind: 'wall-cell-step',
      cost: 1,
      remainingBefore: 3,
      remainingAfter: 0,
      momentumBefore: 3,
      momentumAfter: 0,
    })
  })
})
