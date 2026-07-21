import type { Coord } from '../game'

export type HexDirection = 'E' | 'NE' | 'NW' | 'W' | 'SW' | 'SE'
export type AxialCoord = { q: number; r: number }
export type HexWorldOffset = { x: number; z: number }

export const HEX_DIRECTIONS: ReadonlyArray<{
  direction: HexDirection
  q: number
  r: number
}> = [
  { direction: 'E', q: 1, r: 0 },
  { direction: 'NE', q: 1, r: -1 },
  { direction: 'NW', q: 0, r: -1 },
  { direction: 'W', q: -1, r: 0 },
  { direction: 'SW', q: -1, r: 1 },
  { direction: 'SE', q: 0, r: 1 },
]

const directionVectors = new Map(
  HEX_DIRECTIONS.map((entry) => [entry.direction, { q: entry.q, r: entry.r }]),
)

export function offsetToAxial(coord: Coord): AxialCoord {
  return {
    q: coord.x - (coord.y - (coord.y & 1)) / 2,
    r: coord.y,
  }
}

export function axialToOffset(axial: AxialCoord): Coord {
  return {
    x: axial.q + (axial.r - (axial.r & 1)) / 2,
    y: axial.r,
  }
}

export function hexAdvance(coord: Coord, direction: HexDirection, steps = 1): Coord {
  const axial = offsetToAxial(coord)
  const vector = directionVectors.get(direction)!
  return axialToOffset({
    q: axial.q + vector.q * steps,
    r: axial.r + vector.r * steps,
  })
}

export function getHexNeighbors(coord: Coord): Array<{ coord: Coord; direction: HexDirection }> {
  return HEX_DIRECTIONS.map((entry) => ({
    direction: entry.direction,
    coord: hexAdvance(coord, entry.direction),
  }))
}

export function hexDistance(a: Coord, b: Coord): number {
  const first = offsetToAxial(a)
  const second = offsetToAxial(b)
  const dq = first.q - second.q
  const dr = first.r - second.r
  const ds = -first.q - first.r + second.q + second.r
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds))
}

export function hexDirectionBetween(from: Coord, to: Coord): HexDirection | null {
  if (hexDistance(from, to) !== 1) return null
  return getHexNeighbors(from).find((entry) => entry.coord.x === to.x && entry.coord.y === to.y)?.direction ?? null
}

export function hexDirectionOnLine(from: Coord, to: Coord): HexDirection | null {
  if (from.x === to.x && from.y === to.y) return null
  const first = offsetToAxial(from)
  const second = offsetToAxial(to)
  const dq = second.q - first.q
  const dr = second.r - first.r

  if (dr === 0) return dq > 0 ? 'E' : 'W'
  if (dq === 0) return dr > 0 ? 'SE' : 'NW'
  if (dq + dr === 0) return dq > 0 ? 'NE' : 'SW'
  return null
}

export function isHexStraightLine(from: Coord, to: Coord): boolean {
  return hexDirectionOnLine(from, to) !== null
}

export function hexRay(origin: Coord, direction: HexDirection, length: number): Coord[] {
  return Array.from({ length }, (_, index) => hexAdvance(origin, direction, index + 1))
}

export function hexLine(from: Coord, to: Coord): Coord[] {
  const direction = hexDirectionOnLine(from, to)
  if (!direction) return []
  return [
    { ...from },
    ...hexRay(from, direction, hexDistance(from, to)),
  ]
}

export function hexWorldOffset(coord: Coord, radius = 1): HexWorldOffset {
  const axial = offsetToAxial(coord)
  return {
    x: Math.sqrt(3) * (axial.q + axial.r * 0.5) * radius,
    z: axial.r * 1.5 * radius,
  }
}

export function hexDirectionWorldVector(direction: HexDirection, radius = 1): HexWorldOffset {
  const origin = hexWorldOffset({ x: 0, y: 0 }, radius)
  const neighbor = hexWorldOffset(hexAdvance({ x: 0, y: 0 }, direction), radius)
  return {
    x: neighbor.x - origin.x,
    z: neighbor.z - origin.z,
  }
}

export function hexDirectionYaw(direction: HexDirection): number {
  const vector = hexDirectionWorldVector(direction)
  return Math.atan2(-vector.z, vector.x)
}
