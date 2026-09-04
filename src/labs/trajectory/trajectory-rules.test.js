import { describe, expect, it } from 'vitest'
import { axialDistance, axialToWorld, directionIdBetween, directionVector, worldToAxial } from '../../sim/hex.js'
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
    const result = plan(makeTrajectoryState({ axisId: 'E', momentum: 3 }), 'steer', { q: 2, r: 1 })
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
    expect(earlyNe.finalHex).toEqual({ q: 3, r: -2 })
    expect(lateNe.finalHex).toEqual({ q: 3, r: -1 })
    expect(lateSe.finalHex).toEqual({ q: 2, r: 1 })
    expect(earlySe.finalHex).toEqual({ q: 1, r: 2 })
  })

  it('canonicalizes the blue preview by discrete path plus final Axis', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const coast = plan(state, 'skip')
    const a = plan(state, 'steer', { q: 3, r: -2 })
    const b = plan(state, 'steer', { q: 4, r: -3 })
    expect(b.pathCells).toEqual(a.pathCells)
    expect(b.finalState.axisId).toBe(a.finalState.axisId)

    const previewA = withCoastProjection(a, coast)
    const previewB = withCoastProjection(b, coast)
    const positionsA = previewA.samples.map((sample) => [Number(sample.position.x.toFixed(6)), Number(sample.position.z.toFixed(6))])
    const positionsB = previewB.samples.map((sample) => [Number(sample.position.x.toFixed(6)), Number(sample.position.z.toFixed(6))])
    expect(positionsB).toEqual(positionsA)
  })

  it('keeps M0 straight movement straight and makes the terminal Axis stub readable', () => {
    const state = makeTrajectoryState({ axisId: null, momentum: 0 })
    const controlled = plan(state, 'steer', { q: 2, r: 0 })
    const coast = plan(state, 'skip')
    const preview = withCoastProjection(controlled, coast)
    expect(controlled.pathCells).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }])
    expect(controlled.finalState.axisId).toBe('E')
    expect(preview.samples.every((sample) => Math.abs(sample.position.z) < 0.000001)).toBe(true)

    const finalCenter = axialToWorld(controlled.finalHex)
    const end = preview.samples.at(-1).position
    const endDistance = Math.hypot(end.x - finalCenter.x, end.z - finalCenter.z)
    expect(endDistance).toBeGreaterThan(0.32)
    expect(endDistance).toBeLessThan(0.46)
    expect(worldToAxial(end)).toEqual(controlled.finalHex)
  })

  it('uses a stronger canonical turn curve while staying inside visited Cells and ending along final Axis', () => {
    const state = makeTrajectoryState({ axisId: 'E', momentum: 3 })
    const controlled = plan(state, 'steer', { q: 3, r: -2 })
    const coast = plan(state, 'skip')
    const preview = withCoastProjection(controlled, coast)
    expect(preview.previewRule).toBe(TRAJECTORY_PREVIEW_RULE)
    expect(preview.previewAxisStub).toBe(controlled.finalState.axisId)
    expectCenter(controlled.finalState.position, controlled.finalHex)

    const visited = new Set(controlled.pathCells.map((hex) => `${hex.q},${hex.r}`))
    for (const sample of preview.samples) {
      const hex = worldToAxial(sample.position)
      expect(visited.has(`${hex.q},${hex.r}`)).toBe(true)
    }

    const firstCellSamples = preview.samples.filter((sample) => {
      const hex = worldToAxial(sample.position)
      return (hex.q === 0 && hex.r === 0) || (hex.q === 1 && hex.r === 0)
    })
    expect(firstCellSamples.some((sample) => Math.abs(sample.position.z) > 0.055)).toBe(true)

    const finalDirection = directionVector(controlled.finalState.axisId)
    const end = preview.samples.at(-1).position
    const previous = preview.samples.at(-2).position
    const dx = end.x - previous.x
    const dz = end.z - previous.z
    const length = Math.hypot(dx, dz)
    expect((dx * finalDirection.x + dz * finalDirection.z) / length).toBeGreaterThan(0.995)
  })
})