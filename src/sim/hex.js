export const HEX_RADIUS = 1 / Math.sqrt(3)
export const SQRT3 = Math.sqrt(3)

export const HEX_DIRECTIONS = [
  { id: 'E', q: 1, r: 0 },
  { id: 'NE', q: 1, r: -1 },
  { id: 'NW', q: 0, r: -1 },
  { id: 'W', q: -1, r: 0 },
  { id: 'SW', q: -1, r: 1 },
  { id: 'SE', q: 0, r: 1 },
]

export function axialKey(hex) {
  return `${hex.q},${hex.r}`
}

export function axialDistance(a, b = { q: 0, r: 0 }) {
  const dq = a.q - b.q
  const dr = a.r - b.r
  const ds = -(a.q + a.r) + (b.q + b.r)
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds))
}

export function axialToWorld(hex) {
  return {
    x: SQRT3 * (hex.q + hex.r * 0.5) * HEX_RADIUS,
    z: 1.5 * hex.r * HEX_RADIUS,
  }
}

export function worldToAxialFraction(point) {
  return {
    q: (SQRT3 / 3 * point.x - 1 / 3 * point.z) / HEX_RADIUS,
    r: (2 / 3 * point.z) / HEX_RADIUS,
  }
}

function cubeRound(q, r) {
  const x = q
  const z = r
  const y = -x - z
  let rx = Math.round(x)
  let ry = Math.round(y)
  let rz = Math.round(z)
  const xDiff = Math.abs(rx - x)
  const yDiff = Math.abs(ry - y)
  const zDiff = Math.abs(rz - z)
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz
  else if (yDiff > zDiff) ry = -rx - rz
  else rz = -rx - ry
  return { q: rx, r: rz }
}

export function worldToAxial(point) {
  const fractional = worldToAxialFraction(point)
  return cubeRound(fractional.q, fractional.r)
}

export function createHexBoard(radius) {
  const cells = []
  for (let q = -radius; q <= radius; q += 1) {
    const minR = Math.max(-radius, -q - radius)
    const maxR = Math.min(radius, -q + radius)
    for (let r = minR; r <= maxR; r += 1) cells.push({ q, r })
  }
  return cells
}

export function isInsideBoard(point, radius) {
  return axialDistance(worldToAxial(point)) <= radius
}

export function directionIdBetween(from, to) {
  if (!from || !to) return null
  const dq = to.q - from.q
  const dr = to.r - from.r
  return HEX_DIRECTIONS.find((entry) => entry.q === dq && entry.r === dr)?.id ?? null
}

export function directionVector(directionId) {
  const direction = HEX_DIRECTIONS.find((entry) => entry.id === directionId) ?? HEX_DIRECTIONS[0]
  const origin = axialToWorld({ q: 0, r: 0 })
  const target = axialToWorld({ q: direction.q, r: direction.r })
  const dx = target.x - origin.x
  const dz = target.z - origin.z
  const length = Math.hypot(dx, dz) || 1
  return { x: dx / length, z: dz / length }
}
