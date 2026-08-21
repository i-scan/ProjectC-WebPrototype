import { describe, expect, it } from 'vitest'
import { createUt7State } from './actorLoopUt7'

describe('UT7 Playground room topology', () => {
  it('creates a real R10 topology instead of only changing the setup slider', () => {
    const state = createUt7State({ boardRadius: 10, spawnEnemies: false })
    const activeCells = state.game.cells.filter((cell) => !cell.tags.includes('Void'))

    expect(state.setup.boardRadius).toBe(10)
    expect(state.game.config.width).toBe(21)
    expect(state.game.config.height).toBe(21)
    expect(activeCells).toHaveLength(331)
  })

  it('keeps the UT7 minimum R4 topology exact', () => {
    const state = createUt7State({ boardRadius: 4, spawnEnemies: false })
    const activeCells = state.game.cells.filter((cell) => !cell.tags.includes('Void'))

    expect(state.game.config.width).toBe(9)
    expect(state.game.config.height).toBe(9)
    expect(activeCells).toHaveLength(61)
  })
})
