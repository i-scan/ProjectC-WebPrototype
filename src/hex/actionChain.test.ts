import { describe, expect, it } from 'vitest'
import { actorAt, getPlayer } from '../game'
import { createHexRoomState } from './hexRoom'
import { hexAdvance } from './hexTopology'
import {
  allDrivePlans,
  applyUt2ActionPhase,
  createSpatialInertiaState,
  evaluateUt2Action,
  prepareUt2ChainScenario,
  rushStrikeTargets,
  spatialAfterUt2Action,
} from './actionChain'

describe('VAL-012 UT2 action chain', () => {
  it('prepares the fixed Drive to Rush Strike line without changing topology', () => {
    const state = prepareUt2ChainScenario(createHexRoomState(4))
    const east = allDrivePlans(state).find((plan) => plan.direction === 'E')!

    expect(east.valid).toBe(true)
    expect(east.route).toHaveLength(3)
    expect(actorAt(state, east.route[2])).toBeUndefined()
  })

  it('resolves Drive as two distinct phases and opens Pending Momentum', () => {
    const state = prepareUt2ChainScenario(createHexRoomState(4))
    const action = evaluateUt2Action('drive', createSpatialInertiaState(), 'E')
    const afterStep = applyUt2ActionPhase(state, action, action.phases[0], 'E')
    const afterDash = applyUt2ActionPhase(afterStep, action, action.phases[1], 'E')
    const spatial = spatialAfterUt2Action(action, 'E')

    expect(action.phases.map((phase) => phase.id)).toEqual(['step', 'dash'])
    expect(getPlayer(afterDash).position).toEqual(hexAdvance(getPlayer(state).position, 'E', 3))
    expect(spatial).toEqual({ axis: 'E', pendingMomentum: 2, chainOpen: true })
  })

  it('skips Rush Strike Start only for a same-axis Chain', () => {
    const spatial = { axis: 'E' as const, pendingMomentum: 2 as const, chainOpen: true }
    const chained = evaluateUt2Action('rush-strike', spatial, 'E')
    const redirected = evaluateUt2Action('rush-strike', spatial, 'NE')

    expect(chained.chained).toBe(true)
    expect(chained.actionTimeAt).toBe(1)
    expect(chained.phases.map((phase) => phase.id)).toEqual(['strike'])
    expect(redirected.chained).toBe(false)
    expect(redirected.actionTimeAt).toBe(2)
  })

  it('finds the fixed target ahead after Drive and marks it chain-compatible', () => {
    const initial = prepareUt2ChainScenario(createHexRoomState(4))
    const drive = evaluateUt2Action('drive', createSpatialInertiaState(), 'E')
    const afterStep = applyUt2ActionPhase(initial, drive, drive.phases[0], 'E')
    const afterDash = applyUt2ActionPhase(afterStep, drive, drive.phases[1], 'E')
    const spatial = spatialAfterUt2Action(drive, 'E')
    const targets = rushStrikeTargets(afterDash, spatial)

    expect(targets.map((target) => [target.actor.id, target.direction, target.chained]))
      .toContainEqual(['hunter', 'E', true])
  })
})
