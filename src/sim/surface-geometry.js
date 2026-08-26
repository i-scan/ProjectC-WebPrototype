import { HEX_DIRECTIONS, axialToWorld, directionVector, worldToAxialFraction } from './hex.js'
import { normalize, reflect } from './vector.js'

const EPSILON = 1e-7
const CORNER_EPSILON = 1e-5

// The outer board faces sit half a Cell beyond the last center. The six map
// corners get one additional symmetric chamfer closer to the corner Cell center.
export const BOARD_CLIP_MARGIN = 0.5
export const BOARD_CORNER_CHAMFER_OFFSET = 0.25
export const BOARD_CORNER_CHAMFER_RADIUS = 0.66
export const SURFACE_GEOMETRY_RULE = 'clipped-cell-mirror-v2'
export const REFLECTION_CONTINUATION_RULE = 'contact-ray-step-budget-v3'
export const OBSTACLE_SURFACE_RULE = 'render-footprint-contact-ray-v1'
export const MIRROR_QUANTIZATION_RULE = 'mirror-vector-hex6-before-cell-v1'

// These values intentionally mirror Board3D.createObstacleMesh(). Internal
// blockers are physical objects inside a Cell; they are not the Cell boundary.
const DEFAULT_OBSTACLE_FOOTPRINTS = Object.freeze({
  hard: Object.freeze({ shape: 'box', sizeX: 0.76, sizeZ: 0.20, rotation: 0 }),
  reflector: Object.freeze({ shape: 'box', sizeX: 0.65, sizeZ: 0.12, rotation: 0 }),
})

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

function rotateVector(vector, angle) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: vector.x * cos - vector.z * sin,
    z: vector.x * sin + vector.z * cos,
  }
}

function pointToObstacleLocal(point, center, rotation) {
  return rotateVector(sub2(point, center), -rotation)
}

function pointFromObstacleLocal(point, center, rotation) {
  return add2(center, rotateVector(point, rotation))
}

function obstacleFootprint(obstacle) {
  const fallback = DEFAULT_OBSTACLE_FOOTPRINTS[obstacle?.kind]
  if (!fallback && !obstacle?.shape) return null
  return {
    shape: obstacle?.shape ?? fallback.shape,
    sizeX: Math.max(0.02, Number(obstacle?.sizeX ?? fallback?.sizeX ?? 0.76)),
    sizeZ: Math.max(0.02, Number(obstacle?.sizeZ ?? fallback?.sizeZ ?? 0.20)),
    rotation: Number(obstacle?.rotation ?? fallback?.rotation ?? 0) || 0,
  }
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
      if (t >= -EPSILON && t <= 1 + EPSILON) hits.push({ axis, sign: 1, t, outwardNormal: faceNormal(axis, 1) })
    }
    if (a >= -limit - EPSILON && b < -limit - EPSILON) {
      const t = (-limit - a) / delta
      if (t >= -EPSILON && t <= 1 + EPSILON) hits.push({ axis, sign: -1, t, outwardNormal: faceNormal(axis, -1) })
    }
  }

  if (!hits.length) return null
  const earliest = Math.min(...hits.map((entry) => entry.t))
  const cornerHit = hits.find((entry) => entry.kind === 'boundary-corner-chamfer' && Math.abs(entry.t - earliest) <= CORNER_EPSILON)
  if (cornerHit) return { ...cornerHit, t: Math.max(0, Math.min(1, cornerHit.t)) }

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

// Kept as a grid-geometry helper/fallback. It is no longer the collision shape
// used by the rendered Hard/Reflector wall objects.
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
    candidateNormals: simultaneous.length > 1 ? simultaneous.map((entry) => ({ ...entry.outwardNormal })) : null,
    faceIds: simultaneous.map((entry) => `${entry.sign > 0 ? '+' : '-'}${entry.axis}`),
  }
}

export function obstacleBoxImpact(fromWorld, toWorld, obstacle) {
  const footprint = obstacleFootprint(obstacle)
  if (!obstacle?.hex || footprint?.shape !== 'box') return null

  const center = axialToWorld(obstacle.hex)
  const from = pointToObstacleLocal(fromWorld, center, footprint.rotation)
  const to = pointToObstacleLocal(toWorld, center, footprint.rotation)
  const delta = sub2(to, from)
  const half = { x: footprint.sizeX * 0.5, z: footprint.sizeZ * 0.5 }

  let entryT = -Infinity
  let exitT = Infinity
  const entryFaces = []

  for (const axis of ['x', 'z']) {
    const origin = from[axis]
    const velocity = delta[axis]
    const extent = half[axis]
    if (Math.abs(velocity) <= EPSILON) {
      if (origin < -extent - EPSILON || origin > extent + EPSILON) return null
      continue
    }

    let nearT
    let farT
    let nearSign
    if (velocity > 0) {
      nearT = (-extent - origin) / velocity
      farT = (extent - origin) / velocity
      nearSign = -1
    } else {
      nearT = (extent - origin) / velocity
      farT = (-extent - origin) / velocity
      nearSign = 1
    }

    if (nearT > entryT + CORNER_EPSILON) {
      entryT = nearT
      entryFaces.length = 0
      entryFaces.push({ axis, sign: nearSign })
    } else if (Math.abs(nearT - entryT) <= CORNER_EPSILON) {
      entryFaces.push({ axis, sign: nearSign })
    }
    exitT = Math.min(exitT, farT)
    if (entryT > exitT + CORNER_EPSILON) return null
  }

  if (!Number.isFinite(entryT) || entryT < EPSILON || entryT > 1 + EPSILON || exitT < EPSILON) return null
  const t = Math.max(0, Math.min(1, entryT))
  const localPoint = lerp2(from, to, t)
  const point = pointFromObstacleLocal(localPoint, center, footprint.rotation)
  const incoming = normalize(sub2(toWorld, fromWorld))
  const candidates = entryFaces.map(({ axis, sign }) => {
    const localNormal = axis === 'x' ? { x: sign, z: 0 } : { x: 0, z: sign }
    const worldNormal = normalize(rotateVector(localNormal, footprint.rotation))
    return {
      axis,
      sign,
      normal: worldNormal,
      opposition: -dot2(incoming, worldNormal),
    }
  }).sort((a, b) => b.opposition - a.opposition)
  const primary = candidates[0]

  return {
    kind: candidates.length > 1 ? 'obstacle-box-corner' : 'obstacle-box-face',
    t,
    point,
    normal: { ...primary.normal },
    candidateNormals: candidates.length > 1 ? candidates.map((entry) => ({ ...entry.normal })) : null,
    faceIds: candidates.map((entry) => `${entry.axis}${entry.sign > 0 ? '+' : '-'}`),
    footprint: { ...footprint },
    footprintRule: OBSTACLE_SURFACE_RULE,
  }
}

export function obstacleFootprintImpact(fromWorld, toWorld, obstacle) {
  const footprint = obstacleFootprint(obstacle)
  if (footprint?.shape === 'box') return obstacleBoxImpact(fromWorld, toWorld, obstacle)
  return obstacleHexImpact(fromWorld, toWorld, obstacle?.hex)
}

export function firstSurfaceImpact({ fromWorld, toWorld, boardRadius, obstacle = null }) {
  const boundary = boardBoundaryImpact(fromWorld, toWorld, boardRadius)
  const obstacleImpact = obstacle ? obstacleFootprintImpact(fromWorld, toWorld, obstacle) : null
  if (!boundary) return obstacleImpact ? { ...obstacleImpact, surface: 'obstacle', obstacle } : null
  if (!obstacleImpact) return { ...boundary, surface: 'boundary', obstacle: null }
  if (obstacleImpact.t <= boundary.t + CORNER_EPSILON) return { ...obstacleImpact, surface: 'obstacle', obstacle }
  return { ...boundary, surface: 'boundary', obstacle: null }
}

export function mirrorHexDirection(incomingAxisId, normal) {
  if (!incomingAxisId || !normal) return { direction: null, reflected: { x: 0, z: 0 } }
  const incoming = directionVector(incomingAxisId)
  const reflectedVector = reflect(incoming, normal, 1)
  return { direction: nearestHexDirection(reflectedVector), reflected: reflectedVector }
}

// One physical face produces one mirror ray, and that mirror ray produces one
// Hex6 Axis immediately. The exact contact point is retained for preview and
// animation, but it must not bias the first reflected Cell by ranking nearby
// Cell centers. For a true geometric corner we expose one branch per face.
export function mirrorStepOptions(incomingAxisId, impact, currentHex) {
  if (!incomingAxisId || !impact?.normal || !currentHex) return []
  const incoming = directionVector(incomingAxisId)
  const normals = impact.candidateNormals?.length ? impact.candidateNormals : [impact.normal]
  const options = []
  const seen = new Set()

  normals.forEach((normal, faceIndex) => {
    const reflectedVector = reflect(incoming, normal, 1)
    const direction = nearestHexDirection(reflectedVector)
    if (!direction) return
    const key = direction.id
    if (seen.has(key)) return
    seen.add(key)
    options.push({
      direction,
      reflected: reflectedVector,
      normal: { ...normal },
      score: dot2(normalize(reflectedVector), directionVector(direction.id)),
      faceIndex,
      ambiguousVertex: normals.length > 1,
      footprintRule: impact.footprintRule ?? null,
      quantizationRule: MIRROR_QUANTIZATION_RULE,
    })
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
