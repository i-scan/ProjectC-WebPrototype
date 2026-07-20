import { describe, expect, test } from 'vitest'
import { getPlayer } from '../game'
import {
  createHexInitialState,
  getHexNeighbors,
  hexDirectionBetween,
  hexDistance,
  performHexBasicAction,
} from './hexRules'

describe('ProjectC hex topology prototype', () => {
  test('an interior cell has six unique neighbors', () => {
    const neighbors = getHexNeighbors({ x: 4, y: 4 }).map((entry) => `${entry.coord.x},${entry.coord.y}`)
    expect(new Set(neighbors).size).toBe(6)
  })

  test('odd-r diagonal neighbor is one hex step despite Manhattan distance two', () => {
    expect(hexDistance({ x: 1, y: 8 }, { x: 0, y: 7 })).toBe(1)
    expect(hexDirectionBetween({ x: 1, y: 8 }, { x: 0, y: 7 })).toBe('NW')
  })

  test('player can move through a hex-only diagonal adjacency', () => {
    const state = createHexInitialState()
    const next = performHexBasicAction(state, 'move', { x: 0, y: 7 })
    expect(getPlayer(next).position).toEqual({ x: 0, y: 7 })
    expect(next.ap).toBe(2)
  })
})
