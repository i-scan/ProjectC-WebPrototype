import { describe, expect, it } from 'vitest'
import { cellAt, getPlayer } from '../game'
import { createHexRoomState } from './hexRoom'
import { hexAdvance } from './hexTopology'
import {
  allDrivePlans,
  applyMomentumInterruption,
  applyUt3ActionPhase,
  createSpatialInertiaState,
  evaluateUt3Action,
  prepareUt3MomentumScenario,
  rushStrikeTargets,
  spatialAfterUt3Action,
} from './actionChain'

describe('VAL-012 UT3 momentum rules', () => {
  it('resolves Drive phases, then exposes a board target for a same-axis Carry', () => {
    const prepared = prepareUt3MomentumScenario(createHexRoomState(4), 'chain')
    const plan = allDrivePlans(prepared.state).find((candidate) => candidate.direction === 'E')!
    const drive = evaluateUt3Action('drive', prepared.spatial, 'E')
    const afterStep = applyUt3ActionPhase(prepared.state, drive, drive.phases[0], 'E')
    const afterDash = applyUt3ActionPhase(afterStep, drive, drive.phases[1], 'E')
    const spatial = spatialAfterUt3Action(drive, 'E')
    const target = rushStrikeTargets(afterDash, spatial).find((candidate) => candidate.actor.id === 'hunter')

    expect(plan.valid).toBe(true)
    expect(getPlayer(afterDash).position).toEqual(plan.endpoint)
    expect(spatial).toEqual({ axis: 'E', activeMomentum: 0, pendingMomentum: 2, chainOpen: true })
    expect(target).toMatchObject({ direction: 'E', distance: 1, chained: true, momentumAtImpact: 2, impact: 'launch' })
  })

  it('only Carry-skips Start on the committed axis and charges steering loss otherwise', () => {
    const spatial = createSpatialInertiaState({ axis: 'E', pendingMomentum: 3, chainOpen: true })
    const sameAxis = evaluateUt3Action('rush-strike', spatial, 'E')
    const sixty = evaluateUt3Action('rush-strike', spatial, 'NE')
    const oneTwenty = evaluateUt3Action('rush-strike', spatial, 'NW')
    const reverse = evaluateUt3Action('rush-strike', spatial, 'W')

    expect(sameAxis.phases.map((phase) => phase.id)).toEqual(['strike'])
    expect(sameAxis.actionTimeAt).toBe(1)
    expect(sixty).toMatchObject({ chained: false, steeringLoss: 1, activeMomentumStart: 2 })
    expect(oneTwenty).toMatchObject({ chained: false, steeringLoss: 2, activeMomentumStart: 1 })
    expect(reverse).toMatchObject({ brakeRequired: true, activeMomentumStart: 0 })
  })

  it.each([
    ['m0', 'Normal Hit', 0],
    ['m1', 'Push', 1],
    ['m2', 'Launch', 2],
    ['m3', 'Pierce', 3],
  ] as const)('maps %s to a distinguishable %s result', (preset, expectedLabel, momentum) => {
    const prepared = prepareUt3MomentumScenario(createHexRoomState(4), preset)
    const target = rushStrikeTargets(prepared.state, prepared.spatial).find((candidate) => candidate.actor.id === 'hunter')!
    const evaluated = evaluateUt3Action('rush-strike', prepared.spatial, target.direction)
    const result = evaluated.phases.reduce(
      (value, phase) => applyUt3ActionPhase(value, evaluated, phase, target.direction, target.actor.id),
      prepared.state,
    )

    expect(evaluated.activeMomentumStart).toBe(momentum)
    expect(result.logs[0]).toContain(expectedLabel)
  })

  it('stops Launch at a Hard Wall and deflects it on a discrete reflect surface', () => {
    const hard = prepareUt3MomentumScenario(createHexRoomState(4), 'hard')
    const hardTarget = rushStrikeTargets(hard.state, hard.spatial)[0]
    const hardAction = evaluateUt3Action('rush-strike', hard.spatial, hardTarget.direction)
    const hardResult = applyUt3ActionPhase(hard.state, hardAction, hardAction.phases.at(-1)!, hardTarget.direction, hardTarget.actor.id)

    const reflect = prepareUt3MomentumScenario(createHexRoomState(4), 'reflect-left')
    const reflectTarget = rushStrikeTargets(reflect.state, reflect.spatial)[0]
    const reflectAction = evaluateUt3Action('rush-strike', reflect.spatial, reflectTarget.direction)
    const reflectResult = applyUt3ActionPhase(reflect.state, reflectAction, reflectAction.phases.at(-1)!, reflectTarget.direction, reflectTarget.actor.id)

    expect(hardResult.logs[0]).toContain('Crash · Hard Wall')
    expect(reflectResult.logs[0]).toContain('Bounce · Reflect Left')
    expect(cellAt(reflectResult, hexAdvance(reflectTarget.actor.position, 'E'))?.tags).toContain('UT3ReflectLeft')
  })

  it('keeps normal hits as damage-plus-decay and lets Intercept break the chain', () => {
    const spatial = createSpatialInertiaState({ axis: 'E', pendingMomentum: 2, chainOpen: true })
    const normal = applyMomentumInterruption(spatial, 'normal-hit')
    const intercepted = applyMomentumInterruption(spatial, 'intercept')

    expect(normal).toMatchObject({ stopped: false, spatial: { axis: 'E', pendingMomentum: 1, chainOpen: true } })
    expect(normal.label).toContain('Stability 继续')
    expect(intercepted.stopped).toBe(true)
    expect(intercepted.spatial).toEqual(createSpatialInertiaState())
  })

  it('Brake costs one AT and clears Momentum and Axis in the Outro', () => {
    const spatial = createSpatialInertiaState({ axis: 'E', pendingMomentum: 2, chainOpen: true })
    const brake = evaluateUt3Action('brake', spatial, 'E')

    expect(brake.actionTimeAt).toBe(1)
    expect(spatialAfterUt3Action(brake)).toEqual(createSpatialInertiaState())
  })
})
