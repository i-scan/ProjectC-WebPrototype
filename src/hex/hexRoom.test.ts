import { describe, expect, test } from 'vitest'
import { cellAt, getPlayer } from '../game'
import {
  activeScenarioCells,
  createHexRoomState,
  findScenarioObjective,
  roomCellCount,
  ROOM_MAX_RADIUS,
  ROOM_MIN_RADIUS,
} from './hexRoom'
import { hexDistance } from './hexTopology'

describe('adjustable compact Hex6 rooms', () => {
  test('room cell counts follow a compact hex radius', () => {
    expect(roomCellCount(2)).toBe(19)
    expect(roomCellCount(3)).toBe(37)
    expect(roomCellCount(4)).toBe(61)
    expect(roomCellCount(7)).toBe(169)
  })

  test('generated active cells match the requested radius', () => {
    for (let radius = ROOM_MIN_RADIUS; radius <= ROOM_MAX_RADIUS; radius += 1) {
      const state = createHexRoomState(radius)
      expect(activeScenarioCells(state)).toHaveLength(roomCellCount(radius))
    }
  })

  test('all actors and the objective remain inside the active room', () => {
    const state = createHexRoomState(2)
    for (const actor of state.actors) {
      expect(cellAt(state, actor.position)?.tags.includes('Void')).toBe(false)
    }
    const objective = findScenarioObjective(state)
    expect(objective).toBeDefined()
    expect(cellAt(state, objective!)?.tags.includes('Void')).toBe(false)
  })

  test('room diameter grows predictably with the slider radius', () => {
    const small = createHexRoomState(2)
    const large = createHexRoomState(6)
    const smallObjective = findScenarioObjective(small)!
    const largeObjective = findScenarioObjective(large)!
    expect(hexDistance(getPlayer(small).position, smallObjective)).toBe(4)
    expect(hexDistance(getPlayer(large).position, largeObjective)).toBe(12)
  })
})
