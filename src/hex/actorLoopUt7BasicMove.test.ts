import { describe, expect, it } from 'vitest'
import { getPlayer } from '../game'
import { createSpatialState, createUt7State, defaultUt7Settings, downAxis, horizontalAxis, setSpatialDebug } from './actorLoopUt7'
import { basicMovePlansForTarget, basicMoveTargetCoords } from './actorLoopUt7BasicMove'
import { hexAdvance, hexDistance } from './hexTopology'

describe('UT7 Basic Move one-AT inertia path layer', () => {
  it('keeps M0 Basic Move at Move1 / AT', () => {
    const state = createUt7State({ spawnEnemies: false })
    const player = getPlayer(state.game)
    const adjacent = hexAdvance(player.position, 'E', 1)
    const far = hexAdvance(player.position, 'E', 2)

    expect(basicMovePlansForTarget(state, adjacent, defaultUt7Settings())).toHaveLength(1)
    expect(basicMovePlansForTarget(state, far, defaultUt7Settings())).toHaveLength(0)
    expect(basicMoveTargetCoords(state, defaultUt7Settings()).every((target) => hexDistance(player.position, target) === 1)).toBe(true)
  })

  it('Horizontal M exposes a two-cell Steering Intent field while still costing exactly 1 AT', () => {
    let state = createUt7State({ spawnEnemies: false })
    state = setSpatialDebug(state, 'player', createSpatialState(2, horizontalAxis('E')))
    const origin = { ...getPlayer(state.game).position }
    const target = hexAdvance(origin, 'E', 2)
    const targets = basicMoveTargetCoords(state, defaultUt7Settings())
    const plan = basicMovePlansForTarget(state, target, defaultUt7Settings())[0]

    expect(targets.some((coord) => coord.x === target.x && coord.y === target.y)).toBe(true)
    expect(targets.some((coord) => hexDistance(origin, coord) === 2)).toBe(true)
    expect(plan.atCost).toBe(1)
    expect(plan.result.worldTimeAt).toBe(1)
    expect(plan.path).toHaveLength(2)
    expect(plan.timeline).toHaveLength(1)
    expect(plan.timeline[0].cellSteps).toHaveLength(2)
    expect(getPlayer(plan.result.game).position).toEqual(target)
    expect(plan.result.spatialByActorId.player.level).toBe(1)
  })

  it('treats the clicked cell as Steering Intent rather than a guaranteed destination under residual inertia', () => {
    let state = createUt7State({ spawnEnemies: false })
    state = setSpatialDebug(state, 'player', createSpatialState(3, horizontalAxis('E')))
    const origin = { ...getPlayer(state.game).position }
    const intendedNorthWest = hexAdvance(origin, 'NW', 2)
    const plan = basicMovePlansForTarget(state, intendedNorthWest, defaultUt7Settings())[0]

    expect(plan.atCost).toBe(1)
    expect(plan.path).toHaveLength(2)
    expect(getPlayer(plan.result.game).position).not.toEqual(intendedNorthWest)
    expect(plan.timeline[0].cellSteps[0].moveDirection).toBe('E')
    expect(plan.result.spatialByActorId.player.level).toBe(2)
    expect(plan.timeline[0].behavior).toBe('resist')
  })

  it('offers distinct clockwise and counter-clockwise one-AT paths for a reverse Steering Intent', () => {
    let state = createUt7State({ spawnEnemies: false })
    state = setSpatialDebug(state, 'player', createSpatialState(3, horizontalAxis('E')))
    const origin = { ...getPlayer(state.game).position }
    const intendedWest = hexAdvance(origin, 'W', 2)
    const plans = basicMovePlansForTarget(state, intendedWest, defaultUt7Settings())

    expect(plans).toHaveLength(2)
    expect(new Set(plans.map((plan) => plan.branch))).toEqual(new Set(['cw', 'ccw']))
    expect(plans.every((plan) => plan.atCost === 1 && plan.timeline[0].cellSteps.length === 2)).toBe(true)
    expect(plans[0].timeline[0].afterAxis).not.toEqual(plans[1].timeline[0].afterAxis)
  })

  it('Down M consumes Breakaway one AT at a time and only moves when M reaches zero', () => {
    let state = createUt7State({ spawnEnemies: false })
    state = setSpatialDebug(state, 'player', createSpatialState(3, downAxis()))
    const origin = { ...getPlayer(state.game).position }
    const target = hexAdvance(origin, 'E', 1)

    const first = basicMovePlansForTarget(state, target, defaultUt7Settings())[0]
    expect(first.atCost).toBe(1)
    expect(first.result.worldTimeAt).toBe(1)
    expect(getPlayer(first.result.game).position).toEqual(origin)
    expect(first.result.spatialByActorId.player.level).toBe(2)

    const second = basicMovePlansForTarget(first.result, target, defaultUt7Settings())[0]
    expect(second.result.worldTimeAt).toBe(2)
    expect(getPlayer(second.result.game).position).toEqual(origin)
    expect(second.result.spatialByActorId.player.level).toBe(1)

    const third = basicMovePlansForTarget(second.result, target, defaultUt7Settings())[0]
    expect(third.result.worldTimeAt).toBe(3)
    expect(getPlayer(third.result.game).position).toEqual(target)
    expect(third.result.spatialByActorId.player.level).toBe(0)
  })

  it('rejects a Steering Intent when any required inertia-resolved Cell-step is blocked', () => {
    let state = createUt7State({ spawnEnemies: false })
    state = setSpatialDebug(state, 'player', createSpatialState(2, horizontalAxis('E')))
    const player = getPlayer(state.game)
    const firstEast = hexAdvance(player.position, 'E', 1)
    const target = hexAdvance(player.position, 'E', 2)
    const blockedCell = state.game.cells.find((cell) => cell.coord.x === firstEast.x && cell.coord.y === firstEast.y)!
    blockedCell.tags.push('Blocked')

    expect(basicMovePlansForTarget(state, target, defaultUt7Settings())).toHaveLength(0)
    expect(basicMoveTargetCoords(state, defaultUt7Settings()).some((coord) => coord.x === target.x && coord.y === target.y)).toBe(false)
  })
})
