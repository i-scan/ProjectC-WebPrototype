import { describe, expect, it } from 'vitest'
import { getPlayer } from '../game'
import {
  createSpatialState,
  createUt7State,
  defaultUt7Settings,
  horizontalAxis,
  setSpatialDebug,
} from './actorLoopUt7'
import {
  continuousInertiaPath,
  inReachableField,
  inertiaFieldMovePlan,
  inertiaReachableTargetCoords,
  normalizedCellCenter,
} from './actorLoopUt7ReachableField'
import { axialToOffset, hexAdvance, hexDistance } from './hexTopology'

const hasCoord = (coords: Array<{ x: number; y: number }>, target: { x: number; y: number }) =>
  coords.some((coord) => coord.x === target.x && coord.y === target.y)

describe('UT7 inertia reachable field A/B candidate', () => {
  it('keeps M0 as the six-cell adjacent ring', () => {
    const origin = axialToOffset({ q: 0, r: 0 })
    const candidates = []
    for (let q = -2; q <= 2; q += 1) {
      for (let r = -2; r <= 2; r += 1) {
        const target = axialToOffset({ q, r })
        if (inReachableField(origin, target, 0)) candidates.push(target)
      }
    }
    expect(candidates).toHaveLength(6)
    expect(candidates.every((target) => hexDistance(origin, target) === 1)).toBe(true)
  })

  it('makes M1 a compact seven-target 3x3-ish footprint with the direct rear closed', () => {
    const origin = axialToOffset({ q: 0, r: 0 })
    const candidates = []
    for (let q = -2; q <= 2; q += 1) {
      for (let r = -2; r <= 2; r += 1) {
        const target = axialToOffset({ q, r })
        if (inReachableField(origin, target, 1, 'E')) candidates.push(target)
      }
    }
    expect(candidates).toHaveLength(7)
    expect(hasCoord(candidates, hexAdvance(origin, 'W'))).toBe(false)
    expect(hasCoord(candidates, hexAdvance(hexAdvance(origin, 'E'), 'NE'))).toBe(true)
    expect(hasCoord(candidates, hexAdvance(hexAdvance(origin, 'E'), 'SE'))).toBe(true)
  })

  it('extends M2 and M3 into progressively longer E-axis teardrops', () => {
    const origin = axialToOffset({ q: 0, r: 0 })
    expect(inReachableField(origin, hexAdvance(origin, 'E', 3), 2, 'E')).toBe(true)
    expect(inReachableField(origin, hexAdvance(origin, 'E', 4), 2, 'E')).toBe(false)
    expect(inReachableField(origin, hexAdvance(origin, 'E', 4), 3, 'E')).toBe(true)
    expect(inReachableField(origin, hexAdvance(origin, 'E', 5), 3, 'E')).toBe(false)
    expect(inReachableField(origin, hexAdvance(origin, 'W'), 2, 'E')).toBe(false)
    expect(inReachableField(origin, hexAdvance(origin, 'W'), 3, 'E')).toBe(false)
  })

  it('uses the field cell as a guaranteed one-AT endpoint and spends one Horizontal M', () => {
    let state = createUt7State({ spawnEnemies: false })
    state = setSpatialDebug(state, 'player', createSpatialState(2, horizontalAxis('E')))
    const origin = { ...getPlayer(state.game).position }
    const target = hexAdvance(origin, 'E', 3)
    const targets = inertiaReachableTargetCoords(state, defaultUt7Settings())
    const plan = inertiaFieldMovePlan(state, target, defaultUt7Settings())

    expect(hasCoord(targets, target)).toBe(true)
    expect(plan.valid).toBe(true)
    expect(plan.atCost).toBe(1)
    expect(plan.result.worldTimeAt).toBe(1)
    expect(getPlayer(plan.result.game).position).toEqual(target)
    expect(plan.path.at(-1)).toEqual(target)
    expect(plan.result.spatialByActorId.player.level).toBe(1)
  })

  it('keeps Hybrid target selection identical while producing a smooth non-center endpoint', () => {
    let state = createUt7State({ spawnEnemies: false })
    state = setSpatialDebug(state, 'player', createSpatialState(3, horizontalAxis('E')))
    const origin = { ...getPlayer(state.game).position }
    const target = hexAdvance(origin, 'E', 4)
    const targets = inertiaReachableTargetCoords(state, defaultUt7Settings())
    const path = continuousInertiaPath(state, target, defaultUt7Settings())
    const targetCenter = normalizedCellCenter(target)

    expect(hasCoord(targets, target)).toBe(true)
    expect(path.length).toBeGreaterThan(6)
    expect(path[0]).toEqual(normalizedCellCenter(origin))
    expect(path.at(-1)).not.toEqual(targetCenter)
    expect(Math.hypot(path.at(-1)!.x - targetCenter.x, path.at(-1)!.z - targetCenter.z)).toBeLessThan(0.5)
  })
})
