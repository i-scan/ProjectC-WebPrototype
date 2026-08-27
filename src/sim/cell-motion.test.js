import { describe, expect, it } from 'vitest'
import { runCellMotion, CELL_MOTION_TRACE_RULE } from './cell-motion.js'

const nsWall = { id: 'wall-ns', hex: { q: 0, r: 0 }, kind: 'hard', wallAxis: 'NS' }

function straightPath(start, axis, count) {
  const deltas = {
    E: { q: 1, r: 0 }, NE: { q: 1, r: -1 }, NW: { q: 0, r: -1 },
    W: { q: -1, r: 0 }, SW: { q: -1, r: 1 }, SE: { q: 0, r: 1 },
  }
  const d = deltas[axis]
  return Array.from({ length: count }, (_, index) => ({
    q: start.q + d.q * (index + 1),
    r: start.r + d.r * (index + 1),
  }))
}

describe('authoritative per-Cell motion trace', () => {
  it.each([
    [1, { q: -1, r: 0 }],
    [2, { q: -2, r: 0 }],
    [3, { q: -3, r: 0 }],
  ])('charges a head-on internal wall round-trip as exactly one of M%d travel units', (level, expected) => {
    const start = { q: -1, r: 0 }
    const result = runCellMotion({
      startHex: start,
      initialAxisId: 'E',
      initialMomentum: level,
      travelBudget: level,
      authoredPathCells: straightPath(start, 'E', level),
      obstacles: [nsWall],
      boardRadius: 7,
    })

    expect(result.rule).toBe(CELL_MOTION_TRACE_RULE)
    expect(result.spentTravel).toBe(level)
    expect(result.remainingTravel).toBe(0)
    expect(result.finalHex).toEqual(expected)
    expect(result.trace[0]).toMatchObject({
      kind: 'wall-cell-step',
      cost: 1,
      from: start,
      to: start,
      remainingBefore: level,
      remainingAfter: level - 1,
    })
    expect(result.trace.filter((entry) => entry.cost === 1)).toHaveLength(level)
  })

  it('treats an oblique wall crossing as one step from the incoming neighbor through the wall pivot to the mirrored neighbor', () => {
    const start = { q: 1, r: -1 }
    const result = runCellMotion({
      startHex: start,
      initialAxisId: 'SW',
      initialMomentum: 3,
      travelBudget: 3,
      authoredPathCells: [{ q: 0, r: 0 }, { q: -1, r: 1 }, { q: -2, r: 2 }],
      obstacles: [nsWall],
      boardRadius: 7,
    })

    expect(result.trace[0]).toMatchObject({
      kind: 'wall-cell-step',
      cost: 1,
      from: { q: 1, r: -1 },
      to: { q: 0, r: 1 },
      axisBefore: 'SW',
      axisAfter: 'SE',
      remainingBefore: 3,
      remainingAfter: 2,
    })
    expect(result.trace[0].context).toMatchObject({ pivotCell: { q: 0, r: 0 }, wallCellTravelCost: 1 })
    expect(result.finalHex).toEqual({ q: 0, r: 3 })
    expect(result.spentTravel).toBe(3)
  })

  it('keeps map-boundary reflection at zero travel cost and then spends each reflected Cell explicitly', () => {
    const start = { q: 3, r: -1 }
    const result = runCellMotion({
      startHex: start,
      initialAxisId: 'E',
      initialMomentum: 3,
      travelBudget: 3,
      authoredPathCells: straightPath(start, 'E', 3),
      obstacles: [],
      boardRadius: 3,
    })

    expect(result.trace[0]).toMatchObject({ kind: 'boundary-reflection', cost: 0, axisBefore: 'E', axisAfter: 'SW' })
    expect(result.trace.filter((entry) => entry.cost === 1)).toHaveLength(3)
    expect(result.spentTravel).toBe(3)
    expect(result.finalHex).toEqual({ q: 0, r: 2 })
  })

  it('lets the single Cell-entry hook block a reflected exit without inventing an extra movement step', () => {
    const start = { q: 1, r: -1 }
    const attempts = []
    const result = runCellMotion({
      startHex: start,
      initialAxisId: 'SW',
      initialMomentum: 2,
      travelBudget: 2,
      authoredPathCells: [{ q: 0, r: 0 }, { q: -1, r: 1 }],
      obstacles: [nsWall],
      boardRadius: 7,
      onEnterCell: ({ to }) => {
        attempts.push({ ...to })
        return { allowed: false, stop: true, reason: 'occupied' }
      },
    })

    expect(attempts).toEqual([{ q: 0, r: 1 }])
    expect(result.finalHex).toEqual(start)
    expect(result.spentTravel).toBe(1)
    expect(result.remainingTravel).toBe(1)
    expect(result.trace).toHaveLength(1)
    expect(result.trace[0]).toMatchObject({ kind: 'blocked-entry', cost: 1, remainingAfter: 1 })
  })
})
