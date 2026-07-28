import { describe, expect, test } from 'vitest'
import { cellAt, getPlayer } from '../game'
import { createHexRoomState } from './hexRoom'
import {
  createHexInitialState,
  findHexActorPath,
  hexPushDestination,
  playHexCard,
} from './hexRules'
import { countMountainCells, hasHexLineOfSight, markMountain } from './hexTerrain'

describe('Hex6 mountain tactical collision', () => {
  test('compact rooms contain scalable mountain obstacles', () => {
    expect(countMountainCells(createHexRoomState(2))).toBeGreaterThanOrEqual(3)
    expect(countMountainCells(createHexRoomState(6))).toBeGreaterThan(countMountainCells(createHexRoomState(2)))
  })

  test('a mountain blocks the exact push extension cell', () => {
    const state = createHexInitialState({ width: 7, height: 7 })
    markMountain(state, { x: 3, y: 3 })
    expect(hexPushDestination(state, { x: 2, y: 3 }, { x: 1, y: 3 }, 'hunter')).toBeNull()
  })

  test('mountains block piercing attacks along a hex axis', () => {
    const state = createHexInitialState({ width: 7, height: 7 })
    const player = getPlayer(state)
    const hunter = state.actors.find((actor) => actor.id === 'hunter')!
    player.position = { x: 1, y: 3 }
    hunter.position = { x: 3, y: 3 }
    hunter.hp = hunter.maxHp
    state.hand = ['pierce']
    state.ap = 3
    markMountain(state, { x: 2, y: 3 })

    expect(hasHexLineOfSight(state, player.position, hunter.position)).toBe(false)
    const next = playHexCard(state, 'pierce', hunter.position)
    expect(next.actors.find((actor) => actor.id === 'hunter')?.hp).toBe(hunter.maxHp)
    expect(next.logs[0]).toContain('山体阻挡')
  })

  test('actor pathfinding routes around mountain cells', () => {
    const state = createHexInitialState({ width: 7, height: 7 })
    const player = getPlayer(state)
    const hunter = state.actors.find((actor) => actor.id === 'hunter')!
    hunter.position = { x: 1, y: 3 }
    player.position = { x: 5, y: 3 }
    state.actors = state.actors.filter((actor) => actor.id === 'player' || actor.id === 'hunter')
    markMountain(state, { x: 2, y: 3 })
    markMountain(state, { x: 3, y: 3 }, 'ridge')

    const path = findHexActorPath(state, hunter.position, player.position, hunter.id)
    expect(path.length).toBeGreaterThan(0)
    expect(path.some((coord) => cellAt(state, coord)?.tags.includes('Mountain'))).toBe(false)
    expect(path[0]).toEqual(hunter.position)
    expect(path[path.length - 1]).toEqual(player.position)
  })
})
