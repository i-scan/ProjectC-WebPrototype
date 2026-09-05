import { describe, expect, it } from 'vitest'
import { axialDistance, axialToWorld, directionIdBetween } from '../../sim/hex.js'
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
    expect(result.collisions[0]).toMatchObject({ kind: 'boundary', axisBefore: 'E' })
    expect(result.collisions[0].axisAfter).not.toBe('E')
    expect(result.nominalPathCells.some((hex) => axialDistance(hex) > 4)).toBe(true)
    expect(result.pathCells.every((hex) => axialDistance(hex) <= 4)).toBe(true)
    expect(result.pathCells.slice(0, 3)).toEqual([
      { q: 2, r: 0 },
      { q: 3, r: 0 },
      { q: 4, r: 0 },
    ])
    expect(result.pathCells).toHaveLength(4)
    expect(directionIdBetween({ q: 4, r: 0 }, result.pathCells.at(-1))).toBe(result.collisions[0].axisAfter)
  })

  it('keeps reflected Coast intent straight until the boundary for controlled actions', () => {
    const state = makeTrajectoryState({ hex: { q: 3, r: 0 }, axisId: 'E', momentum: 2 })
    const coast = plan(state, 'skip')
    expect(coast.reflectionCount).toBeGreaterThan(0)
    expect(trajectoryCoastIntentMatches(coast, { q: 4, r: 0 })).toBe(true)

    const controlled = plan(state, 'drive', { q: 4, r: 0 }, { intentAxisId: 'E' })
    expect(controlled.reflectionCount).toBeGreaterThan(0)
    expect(controlled.collisions[0]).toMatchObject({ kind: 'boundary', axisBefore: 'E' })
    expect(controlled.finalState.axisId).toBe(controlled.collisions.at(-1).axisAfter)

    const preview = withCoastProjection(controlled, coast)
    const collision = controlled.collisions[0]
    expect(preview.samples.some((sample) => sample.collision)).toBe(true)
    expect(preview.samples.some((sample) => Math.hypot(
      sample.position.x - collision.position.x,
      sample.position.z - collision.position.z,
    ) < 0.0001)).toBe(true)
    expect(preview.samples.at(-1).axisId).toBe(controlled.finalState.axisId)
  })

  it('allows an M0 Move boundary reflection but still rejects an internal-wall initiation', () => {
    const state = makeTrajectoryState({ hex: { q: 4, r: 0 }, axisId: 'E', momentum: 0 })
    const result = plan(state, 'steer', { q: 3, r: 0 }, { intentAxisId: 'E' })

    expect(result.valid).toBe(true)
    expect(result.reflectionCount).toBe(1)
    expect(result.collisions[0]).toMatchObject({ kind: 'boundary', axisBefore: 'E' })
    expect(directionIdBetween({ q: 4, r: 0 }, result.finalHex)).toBe(result.collisions[0].axisAfter)
    expect(result.finalState.axisId).toBe(result.collisions[0].axisAfter)
    expect(result.finalM).toBe(0)
    expect(result.samples.some((sample) => sample.collision)).toBe(true)
    expect(result.samples.at(-1).position).toEqual(axialToWorld(result.finalHex))

    const wall = { id: 'm0-wall', hex: { q: 0, r: 0 }, kind: 'hard', wallAxis: 'NS' }
    const wallStart = makeTrajectoryState({ hex: { q: -1, r: 0 }, axisId: 'E', momentum: 0 })
    const blocked = plan(wallStart, 'steer', { q: 0, r: 0 }, { obstacles: [wall] })
    expect(blocked.valid).toBe(false)
    expect(blocked.reason).toContain('internal Wall / Surface')
  })
})