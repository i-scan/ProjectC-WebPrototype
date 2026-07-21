import { describe, expect, test } from 'vitest'
import { getPlayer } from '../game'
import { createHexInitialState, playHexCard } from './hexRules'
import {
  HEX_DIRECTIONS,
  axialToOffset,
  getHexNeighbors,
  hexAdvance,
  hexDirectionBetween,
  hexDirectionOnLine,
  hexDirectionWorldVector,
  hexDistance,
  hexLine,
  hexWorldOffset,
  offsetToAxial,
} from './hexTopology'

describe('Hex6 canonical topology', () => {
  test('offset and axial coordinates round-trip across odd and even rows', () => {
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 10; x += 1) {
        expect(axialToOffset(offsetToAxial({ x, y }))).toEqual({ x, y })
      }
    }
  })

  test('all six logical directions match their world-space vectors', () => {
    const origin = { x: 4, y: 4 }
    const originWorld = hexWorldOffset(origin)

    for (const { direction } of HEX_DIRECTIONS) {
      const neighbor = hexAdvance(origin, direction)
      const neighborWorld = hexWorldOffset(neighbor)
      const directionWorld = hexDirectionWorldVector(direction)

      expect(hexDistance(origin, neighbor)).toBe(1)
      expect(hexDirectionBetween(origin, neighbor)).toBe(direction)
      expect(neighborWorld.x - originWorld.x).toBeCloseTo(directionWorld.x, 8)
      expect(neighborWorld.z - originWorld.z).toBeCloseTo(directionWorld.z, 8)
    }
  })

  test('continuing a direction always stays on the same Hex6 axis', () => {
    const origin = { x: 4, y: 4 }

    for (const { direction } of HEX_DIRECTIONS) {
      const first = hexAdvance(origin, direction)
      const second = hexAdvance(first, direction)
      const line = hexLine(origin, second)

      expect(hexDirectionOnLine(origin, second)).toBe(direction)
      expect(hexDistance(origin, second)).toBe(2)
      expect(line).toEqual([origin, first, second])
    }
  })

  test('neighbor enumeration is identical to advancing once in every direction', () => {
    const origin = { x: 4, y: 5 }
    const neighbors = getHexNeighbors(origin)

    for (const { direction } of HEX_DIRECTIONS) {
      expect(neighbors.find((entry) => entry.direction === direction)?.coord).toEqual(
        hexAdvance(origin, direction),
      )
    }
  })
})

describe('Hex6 directional gameplay rules', () => {
  test.each(HEX_DIRECTIONS.map((entry) => entry.direction))(
    'push strike continues exactly along %s',
    (direction) => {
      const state = createHexInitialState()
      const player = getPlayer(state)
      const hunter = state.actors.find((actor) => actor.id === 'hunter')!
      const origin = { x: 4, y: 4 }
      const target = hexAdvance(origin, direction)
      const expected = hexAdvance(target, direction)

      player.position = origin
      hunter.position = target
      hunter.hp = hunter.maxHp
      state.actors.find((actor) => actor.id === 'elite')!.position = { x: 9, y: 0 }
      state.actors.find((actor) => actor.id === 'npc')!.position = { x: 0, y: 9 }
      state.hand = ['push-strike']
      state.ap = 3

      const next = playHexCard(state, 'push-strike', target)
      expect(next.actors.find((actor) => actor.id === 'hunter')?.position).toEqual(expected)
    },
  )

  test('a blocked extension does not make the pushed actor slide sideways', () => {
    const state = createHexInitialState()
    const player = getPlayer(state)
    const hunter = state.actors.find((actor) => actor.id === 'hunter')!
    const blocker = state.actors.find((actor) => actor.id === 'npc')!
    const origin = { x: 4, y: 4 }
    const target = hexAdvance(origin, 'NE')
    const blockedDestination = hexAdvance(target, 'NE')

    player.position = origin
    hunter.position = target
    blocker.position = blockedDestination
    blocker.immobilized = true
    state.actors.find((actor) => actor.id === 'elite')!.position = { x: 9, y: 0 }
    state.hand = ['push-strike']
    state.ap = 3

    const next = playHexCard(state, 'push-strike', target)
    expect(next.actors.find((actor) => actor.id === 'hunter')?.position).toEqual(target)
  })
})
