import { describe, expect, it } from 'vitest'
import { axialDistance, axialToWorld, directionIdBetween, worldToAxial } from '../../sim/hex.js'
import {
  TRAJECTORY_DEFAULT_RADIUS,
  TRAJECTORY_MAX_STEER_DEG,
  TRAJECTORY_PATH_RULE,
  TRAJECTORY_PREVIEW_RULE,
  compatibleStartupMove,
  makeTrajectoryState,
  trajectoryActionPlan,
  trajectoryProjectionPair,
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

describe('VAL-012 Process Steering Cell-center candidate', () => {
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
    expect(second.pathCells).toEqual([{ q: 1, r: 0 }, { q: 2, r: 0 }])
  })

  it('lets M0 freely Move behind and rewrite Axis without generating incompatible M', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 0 })
    expect(compatibleStartupMove(state, { q: -1, r: 0 })).toBe(false)
    const result = plan(state, 'steer', { q: -1, r: 0 })
    expect(result.finalM).toBe(0)
    expect(result.finalState.axisId).toBe('W')
    expect(result.pathCells).toEqual([{ q: 0, r: 0 }, { q: -1, r: 0 }])
    expectCenter(result.finalState.position, { q: -1, r: 0 })
  })

  it('forces M1 E to cash out its first E Cell before Ready Axis can turn to NE', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 1 })
    const result = plan(state, 'steer', { q: 1, r: -1 })
    expect(result.pathCells).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }])
    expect(result.segmentAxes).toEqual(['E'])
    expect(result.finalM).toBe(0)
    expect(result.finalState.axisId).toBe('NE')
    expectCenter(result.finalState.position, { q: 1, r: 0 })
    const interior = result.samples.slice(1, -1)
    expect(interior.some((sample) => Math.abs(sample.position.z) > 0.005)).toBe(true)
  })

  it('builds every rule trajectory from adjacent Cell-center anchors while visual samples curve through them', () => {
    const result = plan(makeTrajectoryState({ axisId: 'E', momentum: 3 }), 'steer', { q: -3, r: 0 })
    expect(result.pathRule).toBe(TRAJECTORY_PATH_RULE)
    expect(result.pathCells.length).toBe(4)
    for (let index = 1; index < result.pathCells.length; index += 1) {
      expect(axialDistance(result.pathCells[index], result.pathCells[index - 1])).toBe(1)
      expect(directionIdBetween(result.pathCells[index - 1], result.pathCells[index])).not.toBeNull()
      const sampleAtCenter = result.samples[result.crossings[index].sampleIndex]
      expect(sampleAtCenter.cellCenterAnchor).toBe(true)
      expectCenter(sampleAtCenter.position, result.pathCells[index])
    }
    expect(result.segmentAxes).toEqual(['E', 'E', 'SE'])
    expect(result.finalState.axisId).toBe('SE')
  })

  it('keeps 60 degrees per Action as inertia while high M crosses more Cell centers', () => {
    const m1 = plan(makeTrajectoryState({ axisId: 'E', momentum: 1 }), 'steer', { q: -3, r: 0 })
    const m3 = plan(makeTrajectoryState({ axisId: 'E', momentum: 3 }), 'steer', { q: -3, r: 0 })
    expect(Math.abs(m1.steeringAppliedDeg)).toBeCloseTo(TRAJECTORY_MAX_STEER_DEG, 4)
    expect(Math.abs(m3.steeringAppliedDeg)).toBeCloseTo(TRAJECTORY_MAX_STEER_DEG, 4)
    expect(m1.travelSteps).toBe(1)
    expect(m3.travelSteps).toBe(3)
    expect(m3.pathCells.length).toBeGreaterThan(m1.pathCells.length)
  })

  it('applies zero-M settlement to Ready Axis without adding a Cell segment', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 1 })
    const result = plan(state, 'steer', { q: -2, r: 0 })
    expect(result.travelSteps).toBe(1)
    expect(result.finalM).toBe(0)
    expect(Math.abs(result.steeringAppliedDeg)).toBeCloseTo(60, 4)
    expect(Math.abs(result.zeroMSettlementDeg)).toBeCloseTo(60, 4)
    expect(result.pathCells.length).toBe(2)
  })

  it('treats Skip as deliberate Coast at M>0 and stationary Wait semantics at M0', () => {
    const moving = plan(makeTrajectoryState({ axisId: 'E', momentum: 3 }), 'skip')
    expect(moving.kind).toBe('skip')
    expect(moving.travelSteps).toBe(3)
    expect(moving.finalM).toBe(2)
    expect(moving.segmentAxes).toEqual(['E', 'E', 'E'])

    const stopped = plan(makeTrajectoryState({ axisId: null, momentum: 0 }), 'skip')
    expect(stopped.travelSteps).toBe(0)
    expect(stopped.finalM).toBe(0)
    expect(stopped.finalState.axisId).toBeNull()
  })

  it('restores Drive and Heavy Drive as isolated Build/Sustain test profiles', () => {
    const drive0 = plan(makeTrajectoryState({ axisId: null, momentum: 0 }), 'drive', { q: 2, r: 0 })
    expect(drive0.buildM).toBe(1)
    expect(drive0.finalM).toBe(1)
    expect(drive0.travelSteps).toBe(1)
    expect(drive0.finalState.axisId).toBe('E')

    const drive1 = plan(makeTrajectoryState({ axisId: 'E', momentum: 1 }), 'drive', { q: 3, r: 0 })
    expect(drive1.finalM).toBe(2)
    expect(drive1.travelSteps).toBe(2)

    const heavy1 = plan(makeTrajectoryState({ axisId: 'E', momentum: 1 }), 'heavy-drive', { q: 4, r: 0 })
    expect(heavy1.buildM).toBe(2)
    expect(heavy1.finalM).toBe(3)
    expect(heavy1.travelSteps).toBe(3)
  })

  it('relaxes the blue preview inside visited Cells and ends near the final Cell center', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const { controlled, coast } = trajectoryProjectionPair({
      state,
      actionId: 'steer',
      selectedHex: { q: -3, r: 0 },
      boardRadius: TRAJECTORY_DEFAULT_RADIUS,
      responseCurve: 'linear',
    })
    const preview = withCoastProjection(controlled, coast)
    expect(preview.previewRule).toBe(TRAJECTORY_PREVIEW_RULE)
    expect(preview.previewAxisStub).toBe(controlled.finalState.axisId)
    expect(preview.actorTrajectories.coastProjection).toEqual(coast.pathCells)
    expectCenter(controlled.finalState.position, controlled.finalHex)

    const visited = new Set(controlled.pathCells.map((hex) => `${hex.q},${hex.r}`))
    for (const sample of preview.samples) {
      const hex = worldToAxial(sample.position)
      expect(visited.has(`${hex.q},${hex.r}`)).toBe(true)
    }

    const interiorCenters = controlled.pathCells.slice(1, -1).map(axialToWorld)
    expect(preview.samples.some((sample) => interiorCenters.every((center) => Math.hypot(sample.position.x - center.x, sample.position.z - center.z) > 0.025))).toBe(true)

    const earlyCurveSamples = preview.samples.filter((sample) => {
      const hex = worldToAxial(sample.position)
      return (hex.q === 0 && hex.r === 0) || (hex.q === 1 && hex.r === 0)
    })
    expect(earlyCurveSamples.some((sample) => Math.abs(sample.position.z) > 0.035)).toBe(true)

    const finalCenter = axialToWorld(controlled.finalHex)
    const end = preview.samples.at(-1).position
    const endDistance = Math.hypot(end.x - finalCenter.x, end.z - finalCenter.z)
    expect(endDistance).toBeGreaterThan(0.04)
    expect(endDistance).toBeLessThan(0.24)
    expect(worldToAxial(end)).toEqual(controlled.finalHex)
  })
})
