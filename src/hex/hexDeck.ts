import type { GameState } from '../game'

export type RandomSource = () => number

export function shuffleCards<T>(cards: readonly T[], random: RandomSource = Math.random): T[] {
  const shuffled = [...cards]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}

export function randomizeHexDeck(state: GameState, random: RandomSource = Math.random): void {
  const cards = shuffleCards([...state.hand, ...state.deck, ...state.discard], random)
  state.hand = cards.slice(0, 5)
  state.deck = cards.slice(5)
  state.discard = []
}
