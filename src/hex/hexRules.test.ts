import { describe, expect, test } from 'vitest'
import { cellAt, getPlayer } from '../game'
import {
  createHexInitialState,
  getHexNeighbors,
  hexDistance,
  performHexBasicAction,
  runHexGlobalEnvironment,
} from './hexRules'

describe('ProjectC hex topology prototype', () => {
  test('an interior cell has six unique neighbors', () => {
    const neighbors = getHexNeighbors({ x: 4, y: 4 }).map((entry) => `${entry.coord.x},${entry.coord.y}`)
    expect(new Set(neighbors).size).toBe(6)
  })

  test('odd-r diagonal neighbor is one hex step despite Manhattan distance two', () => {
    expect(hexDistance({ x: 1, y: 8 }, { x: 0, y: 7 })).toBe(1)
  })

  test('player can move through a hex-only diagonal adjacency', () => {
    const state = createHexInitialState()
    const next = performHexBasicAction(state, 'move', { x: 0, y: 7 })
    expect(getPlayer(next).position).toEqual({ x: 0, y: 7 })
    expect(next.ap).toBe(2)
  })

  test('six-direction wind can move a cloud diagonally', () => {
    const state = createHexInitialState()
    for (const cell of state.cells) {
      cell.skyFill = 'clear'
      cell.cloudAge = 0
      cell.skyTemp = 2
      cell.groundTemp = 2
      cell.intents = []
    }
    const sourceCoord = { x: 4, y: 4 }
    const diagonalTarget = getHexNeighbors(sourceCoord).find((entry) => entry.direction === 'NW')!.coord
    const source = cellAt(state, sourceCoord)!
    const target = cellAt(state, diagonalTarget)!
    source.skyFill = 'cloud'
    target.skyTemp = 0
    target.groundTemp = 0

    const next = runHexGlobalEnvironment(state)
    expect(cellAt(next, diagonalTarget)?.skyFill).toBe('cloud')
    expect(cellAt(next, sourceCoord)?.skyFill).toBe('clear')
  })
})
