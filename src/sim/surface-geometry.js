import { HEX_DIRECTIONS, directionVector, worldToAxialFraction } from './hex.js'
import { normalize, reflect } from './vector.js'

const SQRT3 = Math.sqrt(3)
const EPSILON = 1e-7
const CORNER_EPSILON = 1e-5

// The playable board is treated as a convex clipped hexagon around the outer
// Cell centers. Each cube-coordinate face sits half a Cell beyond the last
// center. An edge Cell therefore has its wall-facing corner clipped; a board
// corner is the symmetric intersection of two such clipping planes.
export const BOARD_CLIP_MARGIN = 0.5
export const SURFACE_GEOMETRY_RULE = 'clipped-cell-mirror-v2'

const AXIAL_FACE_NORMALS = Object.freeze({
  q: Object.freeze({ x: Math.sqrt(3) / 2, z: -0.5 }),
  r: Object.freeze({ x: 0, z: 1 }),
  s: Object.freeze({ x: -Math.sqrt(3) / 2, z: -0.5 }),
})

function scale2(vector, factor) {
  return { x: vector.x * factor, z: vector.z * factor }
}

function add2(a, b) {
  return { x: a.x + b.x, z: a.z + b.z }
}

function lerp2(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
}

function cubeCoordinates(point) {
  const axial = worldToAxialFraction(point)
  return { q: axial.q, r: axial.r, s: -axial.q - axial.r }
}

function faceNormal(axis, sign) {
  return scale2(AXIAL_FACE_NORMALS[axis], sign)
}

function combineNormals(normals) {
  const sum = normals.reduce((result, entry) => add2(result, entry), { x: 0, z: 0 })
  return normalize(sum)
}

function nearestHexDirection(vector) {
  const unit = normalize(vector)
  let best = null
  let bestDot = -Infinity
  for (const entry of HEX_DIRECTIONS) {
    const direction = directionVector(entry.id)
    const dot = direction.x * unit.x + direction.z * unit.z
    if (dot > bestDot) {
      bestDot = dot
      best = entry
    }
  }
  return best
}

export function boardBoundaryImpact(fromWorld, toWorld, boardRadius, margin = BOARD_CLIP_MARGIN) {
  const start = cubeCoordinates(fromWorld)
  const end = cubeCoordinates(toWorld)
  const limit = Math.max(0, Number(boardRadius) || 0) + margin
  const hits = []

  for (const axis of ['q', 'r', 's']) {
    const a = start[axis]
    const b = end[axis]
    const delta = b - a
    if (Math.abs(delta) <= EPSILON) continue

    if (a <= limit + EPSILON && b > limit + EPSILON) {
      const t = (limit - a) / delta
      if (t >= -EPSILON && t <= 1 + EPSILON) {
        hits.push({ axis, sign: 1, t, outwardNormal: faceNormal(axis, 1) })
      }
    }
    if (a >= -limit - EPSILON && b < -limit - EPSILON) {
      const t = (-limit - a) / delta
      if (t >= -EPSILON && t <= 1 + EPSILON) {
        hits.push({ axis, sign: -1, t, outwardNormal: faceNormal(axis, -1) })
      }
    }
  }

  if (!hits.length) return null
  const earliest = Math.min(...hits.map((entry) => entry.t))
  const simultaneous = hits.filter((entry) => Math.abs(entry.t - earliest) <= CORNER_EPSILON)
  const outward = combineNormals(simultaneous.map((entry) => entry.outwardNormal))
  // reflect() expects the normal to oppose incoming motion. For the board wall
  // that means pointing back into the playable polygon.
  const inward = scale2(outward, -1)
  const t = Math.max(0, Math.min(1, earliest))
  return {
    kind: simultaneous.length > 1 ? 'boundary-corner' : 'boundary',
    t,
    point: lerp2(fromWorld, toWorld, t),
    normal: inward,
    faceIds: simultaneous.map((entry) => `${entry.sign > 0 ? '+' : '-'}${entry.axis}`),
  }
}

export function obstacleHexImpact(fromWorld, toWorld, obstacleHex, margin = BOARD_CLIP_MARGIN) {
  if (!obstacleHex) return null
  const startCube = cubeCoordinates(fromWorld)
  const endCube = cubeCoordinates(toWorld)
  const obstacle = { q: obstacleHex.q, r: obstacleHex.r, s: -obstacleHex.q - obstacleHex.r }
  const crossings = []

  for (const axis of ['q', 'r', 's']) {
    const a = startCube[axis] - obstacle[axis]
    const b = endCube[axis] - obstacle[axis]
    const delta = b - a
    if (Math.abs(delta) <= EPSILON) continue

    if (a > margin + EPSILON && b <= margin + EPSILON) {
      const t = (margin - a) / delta
      crossings.push({ axis, sign: 1, t, outwardNormal: faceNormal(axis, 1) })
    }
    if (a < -margin - EPSILON && b >= -margin - EPSILON) {
      const t = (-margin - a) / delta
      crossings.push({ axis, sign: -1, t, outwardNormal: faceNormal(axis, -1) })
    }
  }

  if (!crossings.length) return null
  // Entering a convex hex requires satisfying all previously violated planes;
  // the latest crossing is therefore the actual first contact with the polygon.
  const entryT = Math.max(...crossings.map((entry) => entry.t))
  if (entryT < -EPSILON || entryT > 1 + EPSILON) return null
  const simultaneous = crossings.filter((entry) => Math.abs(entry.t - entryT) <= CORNER_EPSILON)
  const normal = combineNormals(simultaneous.map((entry) => entry.outwardNormal))
  const t = Math.max(0, Math.min(1, entryT))
  return {
    kind: simultaneous.length > 1 ? 'obstacle-corner' : 'obstacle',
    t,
    point: lerp2(fromWorld, toWorld, t),
    normal,
    faceIds: simultaneous.map((entry) => `${entry.sign > 0 ? '+' : '-'}${entry.axis}`),
  }
}

export function firstSurfaceImpact({ fromWorld, toWorld, boardRadius, obstacle = null }) {
  const boundary = boardBoundaryImpact(fromWorld, toWorld, boardRadius)
  const obstacleImpact = obstacle ? obstacleHexImpact(fromWorld, toWorld, obstacle.hex) : null
  if (!boundary) return obstacleImpact ? { ...obstacleImpact, surface: 'obstacle', obstacle } : null
  if (!obstacleImpact) return { ...boundary, surface: 'boundary', obstacle: null }
  if (obstacleImpact.t <= boundary.t + CORNER_EPSILON) {
    return { ...obstacleImpact, surface: 'obstacle', obstacle }
  }
  return { ...boundary, surface: 'boundary', obstacle: null }
}

export function mirrorHexDirection(incomingAxisId, normal) {
  if (!incomingAxisId || !normal) return { direction: null, reflected: { x: 0, z: 0 } }
  const incoming = directionVector(incomingAxisId)
  const reflectedVector = reflect(incoming, normal, 1)
  return { direction: nearestHexDirection(reflectedVector), reflected: reflectedVector }
}

export function fractionalHexForWorldPoint(point) {
  const axial = worldToAxialFraction(point)
  return { q: axial.q, r: axial.r }
}

export function nudgeFromSurface(point, directionId, distance = 0.035) {
  const direction = directionVector(directionId)
  return { x: point.x + direction.x * distance, z: point.z + direction.z * distance }
}
