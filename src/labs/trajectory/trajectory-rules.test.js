import { describe, expect, it } from 'vitest'
import { worldToAxial } from '../../sim/hex.js'
import {
  TRAJECTORY_DEFAULT_RADIUS,
  TRAJECTORY_MAX_STEER_DEG,
  compatibleStartupMove,
  makeTrajectoryState,
  trajectoryActionPlan,
  trajectoryProjectionPair,
} from './trajectory-rules.js'

const plan = (state, actionId, selectedHex = null, extra = {}) => trajectoryActionPlan({
  state,
  actionId,
  selectedHex,
  boardRadius: TRAJECTORY_DEFAULT_RADIUS,
  responseCurve: 'linear',
  ...extra,
})

describe('VAL-012 Process Steering A/B candidate', () => {
  it('uses two compatible M0 Moves to establish persistent M1', () => {
    const first = plan(makeTrajectoryState({ axisId: null, momentum: 0 }), 'steer', { q: 1, r: 0 })
    expect(first.valid).toBe(true)
    expect(first.finalM).toBe(0)
    expect(first.finalState.axisId).toBe('E')
    expect(first.finalState.worldAt).toBe(1)

    const second = plan(first.finalState, 'steer', { q: 2, r: 0 })
    expect(second.startupCompatible).toBe(true)
    expect(second.generatedM).toBe(1)
    expect(second.finalM).toBe(1)
    expect(second.finalState.axisId).toBe('E')
    expect(second.finalState.worldAt).toBe(2)
  })

  it('does not build M1 from a large-angle M0 rewrite', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 0 })
    expect(compatibleStartupMove(state, { q: -1, r: 0 })).toBe(false)
    const result = plan(state, 'steer', { q: -1, r: 0 })
    expect(result.finalM).toBe(0)
    expect(result.finalState.axisId).toBe('W')
  })

  it('coasts persistently for the current M band and dissipates once at Action end', () => {
    const m3 = plan(makeTrajectoryState({ axisId: 'E', momentum: 3 }), 'coast')
    expect(m3.travelDistance).toBe(3)
    expect(m3.finalM).toBe(2)
    expect(m3.finalState.worldAt).toBe(1)
    expect(worldToAxial(m3.finalState.position).q).toBeGreaterThanOrEqual(2)

    const m2 = plan(makeTrajectoryState({ axisId: 'E', momentum: 2 }), 'coast')
    expect(m2.travelDistance).toBe(2)
    expect(m2.finalM).toBe(1)

    const m1 = plan(makeTrajectoryState({ axisId: 'E', momentum: 1 }), 'coast')
    expect(m1.travelDistance).toBe(1)
    expect(m1.finalM).toBe(0)
  })

  it('caps Basic Steer at 60 degrees per complete Action, not per Cell', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const result = plan(state, 'steer', { q: -2, r: 0 })
    expect(Math.abs(result.steeringAppliedDeg)).toBeCloseTo(TRAJECTORY_MAX_STEER_DEG, 4)
    expect(result.travelDistance).toBe(3)
    expect(result.finalM).toBe(2)
  })

  it('applies zero-M steering settlement without adding Travel', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 1 })
    const result = plan(state, 'steer', { q: -2, r: 0 })
    expect(result.travelDistance).toBe(1)
    expect(result.finalM).toBe(0)
    expect(Math.abs(result.steeringAppliedDeg)).toBeCloseTo(60, 4)
    expect(Math.abs(result.zeroMSettlementDeg)).toBeCloseTo(60, 4)
  })

  it('keeps Preview authority shared between Coast and Controlled projections', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 2 })
    const { controlled, coast } = trajectoryProjectionPair({
      state,
      actionId: 'steer',
      selectedHex: { q: 1, r: -2 },
      boardRadius: TRAJECTORY_DEFAULT_RADIUS,
      responseCurve: 'smoothstep',
    })
    expect(controlled.valid).toBe(true)
    expect(coast.valid).toBe(true)
    expect(controlled.beforeM).toBe(coast.beforeM)
    expect(controlled.finalM).toBe(coast.finalM)
    expect(controlled.samples.length).toBe(coast.samples.length)
    expect(controlled.finalHex).not.toEqual(coast.finalHex)
  })
})
