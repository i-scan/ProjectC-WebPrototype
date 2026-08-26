import { HEX_DIRECTIONS, axialToWorld, directionVector, worldToAxialFraction } from './hex.js'
import { normalize, reflect } from './vector.js'

const EPSILON = 1e-7
const CORNER_EPSILON = 1e-5

// The outer board faces sit half a Cell beyond the last center. The six map
// corners get one additional symmetric chamfer closer to the corner Cell center.
// This turns "travel along one edge into the corner" into a mirror trajectory
// that naturally exits along the neighboring edge instead of sticking/sliding.
export const BOARD_CLIP_MARGIN = 0.5
export const BOARD_CORNER_CHAMFER_OFFSET = 0.25
export const BOARD_CORNER_CHAMFER_RADIUS = 0.66
export const SURFACE_GEOMETRY_RULE = 'clipped-cell-mirror-v2'
export const REFLECTION_CONTINUATION_RULE = 'contact-ray-step-budget-v3'

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

function sub2(a, b) {
  return { x: a.x - b.x, z: a.z - b.z }
}

function dot2(a, b) {
  return a.x * b.x + a.z * b.z
}

function distance2(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z)
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

function cornerDefinitions(radius) {
  const r = Math.max(0, Number(radius) || 0)
  return [
    { hex: { q: r, r: 0 }, faces: [['q', 1], ['s', -1]] },
    { hex: { q: r, r: -r }, faces: [['q', 1], ['r', -1]] },
    { hex: { q: 0, r: -r }, faces: [['r', -1], ['s', 1]] },
    { hex: { q: -r, r: 0 }, faces: [['q', -1], ['s', 1]] },
    { hex: { q: -r, r }, faces: [['q', -1], ['r', 1]] },
    { hex: { q: 0, r }, faces: [['r', 1], ['s', -1]] },
  ]
}

function cornerChamferHits(fromWorld, toWorld, boardRadius) {
  const hits = []
  for (const corner of cornerDefinitions(boardRadius)) {
    const center = axialToWorld(corner.hex)
    const outward = combineNormals(corner.faces.map(([axis, sign]) => faceNormal(axis, sign)))
    const startDistance = dot2(sub2(fromWorld, center), outward)
    const endDistance = dot2(sub2(toWorld, center), outward)
    const denominator = endDistance - startDistance
    if (Math.abs(denominator) <= EPSILON) continue
    if (startDistance <= BOARD_CORNER_CHAMFER_OFFSET + EPSILON && endDistance > BOARD_CORNER_CHAMFER_OFFSET + EPSILON) {
      const t = (BOARD_CORNER_CHAMFER_OFFSET - startDistance) / denominator
      if (t < -EPSILON || t > 1 + EPSILON) continue
      const point = lerp2(fromWorld, toWorld, Math.max(0, Math.min(1, t)))
      if (distance2(point, center) > BOARD_CORNER_CHAMFER_RADIUS) continue
      hits.push({
        kind: 'boundary-corner-chamfer',
        t,
        point,
        normal: scale2(outward, -1),
        faceIds: corner.faces.map(([axis, sign]) => `${sign > 0 ? '+' : '-'}${axis}`),
        cornerHex: { ...corner.hex },
      })
    }
  }
  return hits
}

export function boardBoundaryImpact(fromWorld, toWorld, boardRadius, margin = BOARD_CLIP_MARGIN) {
  const start = cubeCoordinates(fromWorld)
  const end = cubeCoordinates(toWorld)
  const limit = Math.max(0, Number(boardRadius) || 0) + margin
  const hits = [...cornerChamferHits(fromWorld, toWorld, boardRadius)]

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
  const cornerHit = hits.find((entry) => entry.kind === 'boundary-corner-chamfer' && Math.abs(entry.t - earliest) <= CORNER_EPSILON)
  if (cornerHit) {
    return {
      ...cornerHit,
      t: Math.max(0, Math.min(1, cornerHit.t)),
    }
  }

  const simultaneous = hits.filter((entry) => !entry.kind && Math.abs(entry.t - earliest) <= CORNER_EPSILON)
  const outward = combineNormals(simultaneous.map((entry) => entry.outwardNormal))
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
    // A sharp wall-Cell vertex has no unique physical normal. Keep the old
    // bisector normal for diagnostics/backward compatibility, but also expose
    // the actual incident faces so the continuation solver can choose one
    // mirror branch instead of manufacturing a 180-degree return path.
    candidateNormals: simultaneous.length > 1
      ? simultaneous.map((entry) => ({ ...entry.outwardNormal }))
      : null,
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

function rankedDirectionsFromContact(currentHex, contactPoint, reflectedVector) {
  const reflectedUnit = normalize(reflectedVector)
  return HEX_DIRECTIONS.map((direction) => {
    const center = axialToWorld({ q: currentHex.q + direction.q, r: currentHex.r + direction.r })
    const towardCenter = normalize(sub2(center, contactPoint))
    return {
      direction,
      score: dot2(reflectedUnit, towardCenter),
    }
  }).sort((a, b) => b.score - a.score)
}

// Return physical continuation candidates without prematurely collapsing a
// continuous mirror ray into "the opposite neighbor". For an unambiguous face
// this is simply the reflected ray ranked against the six neighboring Cell
// centers from the real contact point. For a sharp wall vertex we expose one
// branch per incident face; callers can then reject occupied/reserved Cells.
export function mirrorStepOptions(incomingAxisId, impact, currentHex) {
  if (!incomingAxisId || !impact?.normal || !currentHex) return []
  const incoming = directionVector(incomingAxisId)
  const normals = impact.candidateNormals?.length ? impact.candidateNormals : [impact.normal]
  const options = []
  const seen = new Set()

  normals.forEach((normal, faceIndex) => {
    const reflectedVector = reflect(incoming, normal, 1)
    for (const ranked of rankedDirectionsFromContact(currentHex, impact.point, reflectedVector)) {
      if (ranked.score <= 0.08) continue
      const key = `${faceIndex}:${ranked.direction.id}`
      if (seen.has(key)) continue
      seen.add(key)
      options.push({
        direction: ranked.direction,
        reflected: reflectedVector,
        normal: { ...normal },
        score: ranked.score,
        faceIndex,
        ambiguousVertex: normals.length > 1,
      })
    }
  })

  return options.sort((a, b) => b.score - a.score)
}

export function fractionalHexForWorldPoint(point) {
  const axial = worldToAxialFraction(point)
  return { q: axial.q, r: axial.r }
}

export function nudgeFromSurface(point, directionId, distance = 0.035) {
  const direction = directionVector(directionId)
  return { x: point.x + direction.x * distance, z: point.z + direction.z * distance }
}

export function nudgeFromSurfaceVector(point, vector, distance = 0.035) {
  const direction = normalize(vector)
  return { x: point.x + direction.x * distance, z: point.z + direction.z * distance }
}
