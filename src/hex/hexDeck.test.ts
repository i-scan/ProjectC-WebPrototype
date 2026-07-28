import { describe, expect, test } from 'vitest'
import { createInitialState } from '../game'
import { randomizeHexDeck, shuffleCards } from './hexDeck'

describe('Hex6 deck randomization', () => {
  test('shuffle preserves every card exactly once', () => {
    const cards = ['a', 'b', 'c', 'd', 'e', 'f']
    const shuffled = shuffleCards(cards, () => 0.25)

    expect(shuffled).toHaveLength(cards.length)
    expect([...shuffled].sort()).toEqual([...cards].sort())
  })

  test('different random streams can produce different opening hands', () => {
    const first = createInitialState()
    const second = createInitialState()

    randomizeHexDeck(first, () => 0)
    randomizeHexDeck(second, () => 0.999999)

    expect(first.hand).not.toEqual(second.hand)
    expect([...first.hand, ...first.deck].sort()).toEqual([...second.hand, ...second.deck].sort())
  })
})
