import { describe, expect, it } from 'vitest'
import { getPlayer } from '../game'
import { createSpatialState, createUt7State, defaultUt7Settings, downAxis, horizontalAxis, setSpatialDebug } from './actorLoopUt7'
import { basicMovePlansForTarget } from './actorLoopUt7BasicMove'
import { hexAdvance, hexDistance } from './hexTopology'

describe('UT7 Basic Move command layer', () => {
  it('only accepts an adjacent Basic Move target', () => {
    const state = createUt7State({ spawnEnemies: false })
    const player = getPlayer(state.game)
    const adjacent = hexAdvance(player.position, 'E', 1)
    const far = hexAdvance(player.position, 'E', 3)

    expect(basicMovePlansForTarget(state, adjacent, defaultUt7Settings())).toHaveLength(1)
    expect(basicMovePlansForTarget(state, far, defaultUt7Settings())).toHaveLength(0)
  })

  it('each Basic Move command costs exactly 1 AT and advances at most one cell', () => {
    const state = createUt7State({ spawnEnemies: false })
    const target = hexAdvance(getPlayer(state.game).position, 'E', 1)
    const plan = basicMovePlansForTarget(state, target, defaultUt7Settings())[0]

    expect(plan.atCost).toBe(1)
    expect(plan.timeline).toHaveLength(1)
    expect(plan.path.length).toBeLessThanOrEqual(1)
    expect(plan.result.worldTimeAt).toBe(1)
    expect(hexDistance(getPlayer(state.game).position, getPlayer(plan.result.game).position)).toBeLessThanOrEqual(1)
  })

  it('Horizontal M uses inertia to resolve the actual one-cell result rather than auto-navigating to the clicked cell', () => {
    let state = createUt7State({ spawnEnemies: false })
    state = setSpatialDebug(state, 'player', createSpatialState(3, horizontalAxis('E')))
    const origin = { ...getPlayer(state.game).position }
    const intendedWest = hexAdvance(origin, 'W', 1)
    const plans = basicMovePlansForTarget(state, intendedWest, defaultUt7Settings())

    expect(plans).toHaveLength(2)
    for (const plan of plans) {
      expect(plan.atCost).toBe(1)
      expect(plan.result.worldTimeAt).toBe(1)
      expect(hexDistance(origin, getPlayer(plan.result.game).position)).toBeLessThanOrEqual(1)
      expect(getPlayer(plan.result.game).position).not.toEqual(intendedWest)
      expect(plan.result.spatialByActorId.player.level).toBe(2)
    }
  })

  it('Down M consumes one Breakaway AT per Basic Move command instead of accumulating a multi-AT route', () => {
    let state = createUt7State({ spawnEnemies: false })
    state = setSpatialDebug(state, 'player', createSpatialState(3, downAxis()))
    const origin = { ...getPlayer(state.game).position }
    const target = hexAdvance(origin, 'E', 1)

    const first = basicMovePlansForTarget(state, target, defaultUt7Settings())[0]
    expect(first.atCost).toBe(1)
    expect(first.result.worldTimeAt).toBe(1)
    expect(getPlayer(first.result.game).position).toEqual(origin)
    expect(first.result.spatialByActorId.player.level).toBe(2)

    const secondTarget = hexAdvance(getPlayer(first.result.game).position, 'E', 1)
    const second = basicMovePlansForTarget(first.result, secondTarget, defaultUt7Settings())[0]
    expect(second.result.worldTimeAt).toBe(2)
    expect(getPlayer(second.result.game).position).toEqual(origin)
    expect(second.result.spatialByActorId.player.level).toBe(1)

    const thirdTarget = hexAdvance(getPlayer(second.result.game).position, 'E', 1)
    const third = basicMovePlansForTarget(second.result, thirdTarget, defaultUt7Settings())[0]
    expect(third.result.worldTimeAt).toBe(3)
    expect(getPlayer(third.result.game).position).toEqual(thirdTarget)
    expect(third.result.spatialByActorId.player.level).toBe(0)
  })

  it('never auto-detours when the inertia-resolved cell is blocked', () => {
    let state = createUt7State({ spawnEnemies: false })
    state = setSpatialDebug(state, 'player', createSpatialState(3, horizontalAxis('E')))
    const player = getPlayer(state.game)
    const actualEast = hexAdvance(player.position, 'E', 1)
    const eastCell = state.game.cells.find((cell) => cell.coord.x === actualEast.x && cell.coord.y === actualEast.y)!
    eastCell.tags.push('Blocked')
    const intendedNorthWest = hexAdvance(player.position, 'NW', 1)
    const plan = basicMovePlansForTarget(state, intendedNorthWest, defaultUt7Settings())[0]

    expect(plan.atCost).toBe(1)
    expect(plan.path).toHaveLength(0)
    expect(getPlayer(plan.result.game).position).toEqual(player.position)
    expect(plan.timeline[0].detail).toContain('no auto-detour')
  })
})
