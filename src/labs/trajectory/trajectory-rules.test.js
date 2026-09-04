import { describe, expect, it } from 'vitest'
import { axialDistance, axialToWorld, directionIdBetween, directionVector } from '../../sim/hex.js'
import {
  TRAJECTORY_DEFAULT_RADIUS,
  TRAJECTORY_MAX_STEER_DEG,
  TRAJECTORY_PATH_RULE,
  TRAJECTORY_PREVIEW_RULE,
  TRAJECTORY_REFLECTION_RULE,
  compatibleStartupMove,
  makeTrajectoryState,
  trajectoryActionPlan,
  withCoastProjection,
} from './trajectory-rules.js'

const plan = (state, actionId, selectedHex = null, extra = {}) => trajectoryActionPlan({
  state,
  actionId,
  selectedHex,
  boardRadius: TRAJECTORY_DEFAULT_RADIUS,
  responseCurve: 'linear',
  ...extra,
})

const expectCenter = (position, hex) => {
  const center = axialToWorld(hex)
  expect(position.x).toBeCloseTo(center.x, 6)
  expect(position.z).toBeCloseTo(center.z, 6)
}

const samplePositions = (result) => result.samples.map((sample) => [
  Number(sample.position.x.toFixed(6)), Number(sample.position.z.toFixed(6)),
])

describe('VAL-012 Process Steering global-curve candidate', () => {
  it('uses two compatible M0 Moves to establish persistent M1', () => {
    const first = plan(makeTrajectoryState({ axisId: null, momentum: 0 }), 'steer', { q: 1, r: 0 })
    expect(first.finalM).toBe(0)
    expect(first.finalState.axisId).toBe('E')
    expect(first.pathCells).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }])
    expectCenter(first.finalState.position, { q: 1, r: 0 })

    const second = plan(first.finalState, 'steer', { q: 2, r: 0 })
    expect(second.startupCompatible).toBe(true)
    expect(second.generatedM).toBe(1)
    expect(second.finalM).toBe(1)
    expect(second.finalState.axisId).toBe('E')
  })

  it('lets M0 freely Move behind and rewrite Axis without generating incompatible M', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 0 })
    expect(compatibleStartupMove(state, { q: -1, r: 0 })).toBe(false)
    const result = plan(state, 'steer', { q: -1, r: 0 })
    expect(result.finalM).toBe(0)
    expect(result.finalState.axisId).toBe('W')
    expectCenter(result.finalState.position, { q: -1, r: 0 })
  })

  it('keeps M1 travel straight when only the zero-M Ready Axis settles afterward', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 1 })
    const result = plan(state, 'steer', { q: 1, r: -1 })
    expect(result.pathCells).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }])
    expect(result.segmentAxes).toEqual(['E'])
    expect(result.travelEndAxis).toBe('E')
    expect(result.finalM).toBe(0)
    expect(result.finalState.axisId).toBe('NE')
    expect(result.samples.every((sample) => Math.abs(sample.position.z) < 0.000001)).toBe(true)
  })

  it('keeps discrete Cell route authoritative without forcing visual samples through intermediate centers', () => {
    const result = plan(makeTrajectoryState({ axisId: 'E', momentum: 3 }), 'steer', { q: 2, r: 1 })
    expect(result.pathRule).toBe(TRAJECTORY_PATH_RULE)
    expect(result.pathCells.length).toBe(4)
    for (let index = 1; index < result.pathCells.length; index += 1) {
      expect(axialDistance(result.pathCells[index], result.pathCells[index - 1])).toBe(1)
      expect(directionIdBetween(result.pathCells[index - 1], result.pathCells[index])).not.toBeNull()
    }
    expect(result.segmentAxes).toEqual(['E', 'E', 'SE'])
    expect(result.finalState.axisId).toBe('SE')
    expect(result.visualCurveAuthoritative).toBe(true)
    expect(result.samples.some((sample) => sample.cellCenterAnchor)).toBe(false)
    expectCenter(result.samples.at(0).position, { q: 0, r: 0 })
    expectCenter(result.samples.at(-1).position, result.finalHex)
  })

  it('keeps 60 degrees per Action as inertia while high M crosses more logical Cells', () => {
    const m1 = plan(makeTrajectoryState({ axisId: 'E', momentum: 1 }), 'steer', { q: -3, r: 0 })
    const m3 = plan(makeTrajectoryState({ axisId: 'E', momentum: 3 }), 'steer', { q: -3, r: 0 })
    expect(Math.abs(m1.steeringAppliedDeg)).toBeCloseTo(TRAJECTORY_MAX_STEER_DEG, 4)
    expect(Math.abs(m3.steeringAppliedDeg)).toBeCloseTo(TRAJECTORY_MAX_STEER_DEG, 4)
    expect(m1.travelSteps).toBe(1)
    expect(m3.travelSteps).toBe(3)
  })

  it('treats Skip as deliberate Coast and Drive/Heavy Drive as isolated sustain profiles', () => {
    const moving = plan(makeTrajectoryState({ axisId: 'E', momentum: 3 }), 'skip')
    expect(moving.travelSteps).toBe(3)
    expect(moving.finalM).toBe(2)
    expect(moving.segmentAxes).toEqual(['E', 'E', 'E'])

    const drive1 = plan(makeTrajectoryState({ axisId: 'E', momentum: 1 }), 'drive', { q: 3, r: 0 })
    expect(drive1.finalM).toBe(2)
    expect(drive1.travelSteps).toBe(2)

    const heavy1 = plan(makeTrajectoryState({ axisId: 'E', momentum: 1 }), 'heavy-drive', { q: 4, r: 0 })
    expect(heavy1.finalM).toBe(3)
    expect(heavy1.travelSteps).toBe(3)
  })

  it('exposes both M3 turn timings on both sides of the current Axis', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const earlyNe = plan(state, 'steer', { q: 3, r: -2 })
    const lateNe = plan(state, 'steer', { q: 3, r: -1 })
    const lateSe = plan(state, 'steer', { q: 2, r: 1 })
    const earlySe = plan(state, 'steer', { q: 1, r: 2 })
    expect(earlyNe.segmentAxes).toEqual(['E', 'NE', 'NE'])
    expect(lateNe.segmentAxes).toEqual(['E', 'E', 'NE'])
    expect(lateSe.segmentAxes).toEqual(['E', 'E', 'SE'])
    expect(earlySe.segmentAxes).toEqual(['E', 'SE', 'SE'])
  })

  it('canonicalizes identical rule results to identical global curves', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const coast = plan(state, 'skip')
    const a = plan(state, 'steer', { q: 3, r: -2 })
    const b = plan(state, 'steer', { q: 4, r: -3 })
    expect(b.pathCells).toEqual(a.pathCells)
    expect(b.finalState.axisId).toBe(a.finalState.axisId)
    expect(samplePositions(withCoastProjection(b, coast))).toEqual(samplePositions(withCoastProjection(a, coast)))
  })

  it('draws a broad smooth turn with exact start/end travel tangents instead of Cell-border clamping', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const controlled = plan(state, 'steer', { q: 3, r: -2 })
    const preview = withCoastProjection(controlled, plan(state, 'skip'))
    expect(preview.previewRule).toBe(TRAJECTORY_PREVIEW_RULE)
    expect(preview.visualCurveAuthoritative).toBe(true)

    const travel = controlled.samples
    const first = travel[0].position
    const second = travel[1].position
    const beforeEnd = travel.at(-2).position
    const end = travel.at(-1).position
    const startDirection = directionVector('E')
    const endDirection = directionVector('NE')
    const startDelta = { x: second.x - first.x, z: second.z - first.z }
    const endDelta = { x: end.x - beforeEnd.x, z: end.z - beforeEnd.z }
    const startLen = Math.hypot(startDelta.x, startDelta.z)
    const endLen = Math.hypot(endDelta.x, endDelta.z)
    expect((startDelta.x * startDirection.x + startDelta.z * startDirection.z) / startLen).toBeGreaterThan(0.995)
    expect((endDelta.x * endDirection.x + endDelta.z * endDirection.z) / endLen).toBeGreaterThan(0.995)

    const chordMid = pointLerpForTest(first, end, 0.5)
    const middle = travel[Math.floor(travel.length / 2)].position
    expect(Math.hypot(middle.x - chordMid.x, middle.z - chordMid.z)).toBeGreaterThan(0.18)
  })

  it('keeps M0 straight preview straight and appends a readable final-Axis stub', () => {
    const state = makeTrajectoryState({ axisId: null, momentum: 0 })
    const controlled = plan(state, 'steer', { q: 2, r: 0 })
    const preview = withCoastProjection(controlled, plan(state, 'skip'))
    expect(preview.samples.every((sample) => Math.abs(sample.position.z) < 0.000001)).toBe(true)
    const finalCenter = controlled.finalState.position
    const end = preview.samples.at(-1).position
    expect(Math.hypot(end.x - finalCenter.x, end.z - finalCenter.z)).toBeGreaterThan(0.3)
  })

  it('reuses Driving Lab wall-pivot reflection: redirect Axis, no reflection M tax, continue remaining Travel', () => {
    const wall = { id: 'trajectory-ns-wall', hex: { q: 2, r: 0 }, kind: 'hard', wallAxis: 'NS' }
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const result = plan(state, 'steer', { q: 3, r: 0 }, { obstacles: [wall] })
    expect(result.valid).toBe(true)
    expect(result.reflectionRule).toBe(TRAJECTORY_REFLECTION_RULE)
    expect(result.reflectionCount).toBe(1)
    expect(result.collisions[0]).toMatchObject({
      wallCellPivot: true,
      wallAxis: 'NS',
      axisBefore: 'E',
      axisAfter: 'W',
      beforeM: 3,
      afterM: 3,
      wallCellTravelCost: 1,
    })
    expect(result.finalM).toBe(2)
    expect(result.finalState.axisId).toBe('W')
    expect(result.finalHex).toEqual({ q: 0, r: 0 })
    expect(result.samples.some((sample) => sample.collision)).toBe(true)
  })
})

function pointLerpForTest(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
}
