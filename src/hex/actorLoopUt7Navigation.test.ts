import { describe, expect, it } from 'vitest'
import { getPlayer } from '../game'
import { createSpatialState, createUt7State, defaultUt7Settings, downAxis, horizontalAxis, setSpatialDebug } from './actorLoopUt7'
import { basicMoveNavigationPlan, basicMoveNavigationTargetCoords } from './actorLoopUt7Navigation'
import { hexAdvance, hexDistance } from './hexTopology'

const sameCoord = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x === b.x && a.y === b.y

describe('UT7 multi-AT Basic Move navigation', () => {
  it('accepts a remote Target Cell and reaches it through multiple ordinary AT settlements', () => {
    const state = createUt7State({ spawnEnemies: false })
    const origin = { ...getPlayer(state.game).position }
    const target = hexAdvance(origin, 'E', 5)
    const plan = basicMoveNavigationPlan(state, target, defaultUt7Settings())

    expect(plan.valid).toBe(true)
    expect(plan.atCost).toBeGreaterThan(1)
    expect(plan.timeline).toHaveLength(plan.atCost)
    expect(plan.result.worldTimeAt).toBe(plan.atCost)
    expect(getPlayer(plan.result.game).position).toEqual(target)
    expect(plan.path.length).toBeGreaterThan(1)
    expect(plan.timeline.map((trace) => trace.atIndex)).toEqual(
      Array.from({ length: plan.atCost }, (_, index) => index + 1),
    )

    const completePath = [origin, ...plan.path]
    expect(completePath.slice(1).every((coord, index) => hexDistance(completePath[index], coord) === 1)).toBe(true)
  })

  it('uses the one-AT inertia primitive at every step instead of teleporting to the final target', () => {
    let state = createUt7State({ spawnEnemies: false })
    state = setSpatialDebug(state, 'player', createSpatialState(3, horizontalAxis('E')))
    const origin = { ...getPlayer(state.game).position }
    const target = hexAdvance(origin, 'NW', 4)
    const plan = basicMoveNavigationPlan(state, target, defaultUt7Settings())

    expect(plan.valid).toBe(true)
    expect(plan.atCost).toBeGreaterThan(1)
    expect(getPlayer(plan.result.game).position).toEqual(target)
    expect(plan.timeline[0].cellSteps[0].moveDirection).toBe('E')
    expect(sameCoord(plan.path[0], target)).toBe(false)
    expect(plan.timeline.reduce((sum, trace) => sum + trace.cellSteps.length, 0)).toBe(plan.path.length)
  })

  it('spends multiple Breakaway ATs while Down M is active, then continues navigation to the target', () => {
    let state = createUt7State({ spawnEnemies: false })
    state = setSpatialDebug(state, 'player', createSpatialState(3, downAxis()))
    const origin = { ...getPlayer(state.game).position }
    const target = hexAdvance(origin, 'E', 3)
    const plan = basicMoveNavigationPlan(state, target, defaultUt7Settings())

    expect(plan.valid).toBe(true)
    expect(plan.atCost).toBeGreaterThanOrEqual(4)
    expect(plan.timeline[0].cellSteps).toHaveLength(0)
    expect(plan.timeline[1].cellSteps).toHaveLength(0)
    expect(getPlayer(plan.result.game).position).toEqual(target)
  })

  it('routes around a blocked direct cell when another inertia-valid route exists', () => {
    const state = createUt7State({ spawnEnemies: false })
    const origin = { ...getPlayer(state.game).position }
    const blocked = hexAdvance(origin, 'E', 1)
    const target = hexAdvance(origin, 'E', 3)
    const blockedCell = state.game.cells.find((cell) => sameCoord(cell.coord, blocked))!
    blockedCell.tags.push('Blocked')

    const plan = basicMoveNavigationPlan(state, target, defaultUt7Settings())
    expect(plan.valid).toBe(true)
    expect(getPlayer(plan.result.game).position).toEqual(target)
    expect(plan.path.some((coord) => sameCoord(coord, blocked))).toBe(false)
  })

  it('exposes remote terrain-reachable cells as selectable navigation targets', () => {
    const state = createUt7State({ spawnEnemies: false })
    const origin = { ...getPlayer(state.game).position }
    const remote = hexAdvance(origin, 'SE', 5)
    const targets = basicMoveNavigationTargetCoords(state)

    expect(targets.some((coord) => sameCoord(coord, remote))).toBe(true)
    expect(targets.some((coord) => hexDistance(origin, coord) > 2)).toBe(true)
  })
})
