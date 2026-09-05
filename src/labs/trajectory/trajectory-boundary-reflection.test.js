import { describe, expect, it } from 'vitest'
import { axialDistance, directionIdBetween, directionVector } from '../../sim/hex.js'
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

  it('accepts an outside-ring M0 Move direction from the exact board edge', () => {
    const state = makeTrajectoryState({ hex: { q: 4, r: 0 }, axisId: 'E', momentum: 0 })
    const result = plan(state, 'steer', { q: 5, r: 0 })
    const collision = result.collisions[0]

    expect(result.valid).toBe(true)
    expect(result.requestedTravelSteps).toBe(1)
    expect(result.travelSteps).toBe(1)
    expect(result.reflectionCount).toBe(1)
    expect(collision).toMatchObject({ kind: 'boundary', axisBefore: 'E' })
    expect(collision.axisAfter).not.toBe('E')
    expect(result.pathCells.every((hex) => axialDistance(hex) <= 4)).toBe(true)
    expect(directionIdBetween({ q: 4, r: 0 }, result.finalHex)).toBe(collision.axisAfter)
    expect(result.finalState.axisId).toBe(collision.axisAfter)
    expect(result.finalM).toBe(1)
  })

  it('accepts an outside-ring Drive direction and spends the full reflected Travel budget', () => {
    const state = makeTrajectoryState({ hex: { q: 4, r: 0 }, axisId: 'E', momentum: 1 })
    const result = plan(state, 'drive', { q: 5, r: 0 })
    const collision = result.collisions[0]

    expect(result.valid).toBe(true)
    expect(result.requestedTravelSteps).toBe(2)
    expect(result.travelSteps).toBe(2)
    expect(result.reflectionCount).toBe(1)
    expect(collision).toMatchObject({ kind: 'boundary', axisBefore: 'E' })
    expect(result.pathCells).toHaveLength(3)
    expect(result.pathCells.every((hex) => axialDistance(hex) <= 4)).toBe(true)
    expect(directionIdBetween({ q: 4, r: 0 }, result.pathCells[1])).toBe(collision.axisAfter)
    expect(directionIdBetween(result.pathCells[1], result.pathCells[2])).toBe(collision.axisAfter)
    expect(result.finalState.axisId).toBe(collision.axisAfter)
    expect(result.finalM).toBe(2)
  })

  it('keeps the blue preview on the exact collision breakpoint and reflected ray', () => {
    const state = makeTrajectoryState({ hex: { q: 4, r: 0 }, axisId: 'E', momentum: 1 })
    const coast = plan(state, 'skip')
    const controlled = plan(state, 'drive', { q: 5, r: 0 })
    const preview = withCoastProjection(controlled, coast)
    const collision = controlled.collisions[0]
    const collisionIndex = preview.samples.findIndex((sample) => sample.collision)

    expect(coast.reflectionCount).toBeGreaterThan(0)
    expect(trajectoryCoastIntentMatches(coast, coast.pathCells.at(-1))).toBe(true)
    expect(collisionIndex).toBeGreaterThanOrEqual(0)
    expect(preview.samples[collisionIndex].position).toEqual(collision.position)

    const next = preview.samples[collisionIndex + 1]
    expect(next).toBeTruthy()
    const reflected = directionVector(collision.axisAfter)
    const delta = {
      x: next.position.x - collision.position.x,
      z: next.position.z - collision.position.z,
    }
    const forward = delta.x * reflected.x + delta.z * reflected.z
    const cross = Math.abs(delta.x * reflected.z - delta.z * reflected.x)
    expect(forward).toBeGreaterThan(0)
    expect(cross).toBeLessThan(0.02)
    expect(preview.samples.at(-1).axisId).toBe(controlled.finalState.axisId)
  })
})
