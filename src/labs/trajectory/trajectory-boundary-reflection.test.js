import { describe, expect, it } from 'vitest'
import { axialDistance, axialToWorld } from '../../sim/hex.js'
import {
  makeTrajectoryState,
  trajectoryActionPlan,
  trajectoryCoastIntentMatches,
  withCoastProjection,
} from './trajectory-rules.js'

const plan = (state, actionId, selectedHex = null, extra = {}) => trajectoryActionPlan({
  state,
  actionId,
  selectedHex,
  boardRadius: 4,
  responseCurve: 'linear',
  ...extra,
})

describe('Trajectory board-edge reflection regression', () => {
  it('keeps Drive authored toward the edge and lets cell motion own the reflection', () => {
    const state = makeTrajectoryState({ hex: { q: 2, r: 0 }, axisId: 'E', momentum: 2 })
    const result = plan(state, 'drive', { q: 4, r: 0 })

    expect(result.valid).toBe(true)
    expect(result.requestedTravelSteps).toBe(3)
    expect(result.reflectionCount).toBeGreaterThan(0)
    expect(result.collisions[0]).toMatchObject({ kind: 'boundary', axisBefore: 'E', axisAfter: 'W' })
    expect(result.nominalPathCells.some((hex) => axialDistance(hex) > 4)).toBe(true)
    expect(result.pathCells.every((hex) => axialDistance(hex) <= 4)).toBe(true)
    expect(result.pathCells).toEqual([
      { q: 2, r: 0 },
      { q: 3, r: 0 },
      { q: 4, r: 0 },
      { q: 3, r: 0 },
    ])
  })

  it('keeps reflected Coast intent straight until the boundary for controlled actions', () => {
    const state = makeTrajectoryState({ hex: { q: 3, r: 0 }, axisId: 'E', momentum: 2 })
    const coast = plan(state, 'skip')
    expect(coast.reflectionCount).toBeGreaterThan(0)
    expect(trajectoryCoastIntentMatches(coast, { q: 4, r: 0 })).toBe(true)

    const controlled = plan(state, 'drive', { q: 4, r: 0 }, { intentAxisId: 'E' })
    expect(controlled.reflectionCount).toBeGreaterThan(0)
    expect(controlled.collisions[0]).toMatchObject({ kind: 'boundary', axisBefore: 'E', axisAfter: 'W' })
    expect(controlled.finalState.axisId).toBe('W')

    const preview = withCoastProjection(controlled, coast)
    const collision = controlled.collisions[0]
    expect(preview.samples.some((sample) => sample.collision)).toBe(true)
    expect(preview.samples.some((sample) => Math.hypot(
      sample.position.x - collision.position.x,
      sample.position.z - collision.position.z,
    ) < 0.0001)).toBe(true)
    expect(preview.samples.at(-1).axisId).toBe('W')
  })

  it('allows an M0 Move boundary reflection while still rejecting internal-wall initiation elsewhere', () => {
    const state = makeTrajectoryState({ hex: { q: 4, r: 0 }, axisId: 'E', momentum: 0 })
    const result = plan(state, 'steer', { q: 3, r: 0 }, { intentAxisId: 'E' })

    expect(result.valid).toBe(true)
    expect(result.reflectionCount).toBe(1)
    expect(result.collisions[0]).toMatchObject({ kind: 'boundary', axisBefore: 'E', axisAfter: 'W' })
    expect(result.finalHex).toEqual({ q: 3, r: 0 })
    expect(result.finalState.axisId).toBe('W')
    expect(result.finalM).toBe(0)
    expect(result.samples.some((sample) => sample.collision)).toBe(true)
    expect(result.samples.at(-1).position).toEqual(axialToWorld({ q: 3, r: 0 }))
  })
})