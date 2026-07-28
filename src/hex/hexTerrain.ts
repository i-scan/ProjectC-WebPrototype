import { cellAt, type Cell, type Coord, type GameState } from '../game'
import { hexLine } from './hexTopology'

export type MountainKind = 'peak' | 'ridge'

export function isMountainCell(cell: Cell | undefined): boolean {
  return Boolean(cell?.tags.includes('Mountain'))
}

export function isTerrainBlocked(cell: Cell | undefined): boolean {
  return !cell || cell.tags.includes('Blocked') || cell.tags.includes('Void') || isMountainCell(cell)
}

export function blocksHexLineOfSight(cell: Cell | undefined): boolean {
  return Boolean(cell && (cell.tags.includes('BlocksSight') || isMountainCell(cell)))
}

export function markMountain(state: GameState, coord: Coord, kind: MountainKind = 'peak'): boolean {
  const cell = cellAt(state, coord)
  if (!cell || cell.tags.includes('Void')) return false
  cell.tags = cell.tags.filter((tag) => !['Shelter', 'Objective', 'Resource', 'WeatherHazard'].includes(tag))
  for (const tag of ['Mountain', 'Blocked', 'BlocksSight', kind === 'ridge' ? 'Ridge' : 'Peak']) {
    if (!cell.tags.includes(tag)) cell.tags.push(tag)
  }
  cell.groundFill = 'none'
  cell.groundTemp = kind === 'ridge' ? -1 : 0
  cell.moisture = 0
  cell.skyFill = 'clear'
  cell.cloudAge = 0
  cell.intents = []
  return true
}

export function countMountainCells(state: GameState): number {
  return state.cells.filter(isMountainCell).length
}

export function findHexLineBlocker(state: GameState, from: Coord, to: Coord): Cell | undefined {
  const line = hexLine(from, to)
  if (line.length <= 2) return undefined
  return line.slice(1, -1)
    .map((coord) => cellAt(state, coord))
    .find((cell) => blocksHexLineOfSight(cell))
}

export function hasHexLineOfSight(state: GameState, from: Coord, to: Coord): boolean {
  const line = hexLine(from, to)
  if (line.length === 0) return false
  return !findHexLineBlocker(state, from, to)
}
