import { describe, expect, test } from 'vitest'
import { cellAt, getPlayer } from '../game'
import {
  advanceTravelClock,
  createHexTravelState,
  findHexTravelPath,
  movePlayerInTravel,
  runHexTravelTick,
  travelCellRisk,
  TRAVEL_OBJECTIVE,
} from './hexTravel'

describe('continuous Hex6 travel prototype', () => {
  test('travel clock advances once per base AP hexes', () => {
    expect(advanceTravelClock(0, 2, 3)).toEqual({ ticks: 0, remainder: 2 })
    expect(advanceTravelClock(2, 1, 3)).toEqual({ ticks: 1, remainder: 0 })
    expect(advanceTravelClock(1, 6, 3)).toEqual({ ticks: 2, remainder: 1 })
  })

  test('higher AP produces fewer world ticks over the same distance', () => {
    expect(advanceTravelClock(0, 12, 3).ticks).toBe(4)
    expect(advanceTravelClock(0, 12, 4).ticks).toBe(3)
    expect(advanceTravelClock(0, 12, 6).ticks).toBe(2)
  })

  test('fastest and safest routes reach the same objective without crossing blocked cells', () => {
    const state = createHexTravelState()
    const start = getPlayer(state).position
    const fastest = findHexTravelPath(state, start, TRAVEL_OBJECTIVE, 'fastest')
    const safest = findHexTravelPath(state, start, TRAVEL_OBJECTIVE, 'safest')

    expect(fastest.length).toBeGreaterThan(1)
    expect(safest.length).toBeGreaterThan(1)
    expect(fastest.at(-1)).toEqual(TRAVEL_OBJECTIVE)
    expect(safest.at(-1)).toEqual(TRAVEL_OBJECTIVE)
    expect(fastest.some((coord) => cellAt(state, coord)?.tags.includes('Blocked'))).toBe(false)
    expect(safest.some((coord) => cellAt(state, coord)?.tags.includes('Blocked'))).toBe(false)

    const fastestRisk = fastest.slice(1).reduce((sum, coord) => sum + travelCellRisk(cellAt(state, coord)!), 0)
    const safestRisk = safest.slice(1).reduce((sum, coord) => sum + travelCellRisk(cellAt(state, coord)!), 0)
    expect(safestRisk).toBeLessThanOrEqual(fastestRisk)
  })

  test('travel world tick preserves the current card zones', () => {
    const state = createHexTravelState()
    const hand = [...state.hand]
    const deck = [...state.deck]
    const discard = [...state.discard]
    const next = runHexTravelTick(state)

    expect(next.turn).toBe(state.turn + 1)
    expect(next.hand).toEqual(hand)
    expect(next.deck).toEqual(deck)
    expect(next.discard).toEqual(discard)
  })

  test('one travel move changes only to an adjacent path cell', () => {
    const state = createHexTravelState()
    const start = getPlayer(state).position
    const path = findHexTravelPath(state, start, TRAVEL_OBJECTIVE, 'fastest')
    const next = movePlayerInTravel(state, path[1])
    expect(getPlayer(next).position).toEqual(path[1])
  })
})
