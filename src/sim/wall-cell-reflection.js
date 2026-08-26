import { HEX_DIRECTIONS, axialToWorld, directionVector } from './hex.js'
import { dot, normalize, reflect, scale } from './vector.js'

export const WALL_CELL_TRAVEL_RULE = 'wall-cell-pivot-budget-v1'
export const WALL_VISUAL_CONTRACT = 'wall-axis-mesh-v1'
export const WALL_REFLECTION_PATH_CONTRACT = 'wall-pivot-polyline-v1'

const cloneHex = (hex) => ({ q: hex.q, r: hex.r })

function nearestHexDirection(vector) {
  const unit = normalize(vector)
  let best = HEX_DIRECTIONS[0]
  let bestDot = -Infinity
  for (const direction of HEX_DIRECTIONS) {
    const axis = directionVector(direction.id)
    const score = dot(unit, axis)
    if (score > bestDot) {
      bestDot = score
      best = direction
    }
  }
  return best
}

function tangentForWallAxis(wallAxis) {
  if (wallAxis === 'NS') return { x: 0, z: 1 }
  if (wallAxis === 'EW') return { x: 1, z: 0 }
  if (wallAxis === 'NE_SW') return directionVector('NE')
  if (wallAxis === 'NW_SE') return directionVector('NW')
  return null
}

export function wallVisualYaw(wallAxis) {
  const tangent = tangentForWallAxis(wallAxis)
  if (!tangent) return 0
  // BoxGeometry is authored with its long edge on local +X. Three.js positive
  // Y rotation maps local +X to world (cos(yaw), -sin(yaw)) in X/Z, so negate
  // atan2 to align the visible wall with the same tangent used by reflection.
  return -Math.atan2(tangent.z, tangent.x)
}

function opposedNormal(incoming, tangent) {
  const base = normalize({ x: -tangent.z, z: tangent.x })
  return dot(incoming, base) > 0 ? scale(base, -1) : base
}

/**
 * Internal walls are centered inside their occupied Cell. A reflected crossing
 * therefore uses the wall Cell as a pivot: entry half + exit half consumes one
 * Cell of travel, and the outgoing Cell is adjacent to the wall pivot rather
 * than adjacent to the incoming Actor Cell.
 */
export function internalWallCellImpact({ obstacle, incomingAxisId }) {
  const wallAxis = obstacle?.wallAxis
  const tangent = tangentForWallAxis(wallAxis)
  if (!obstacle?.hex || !incomingAxisId || !tangent) return null

  const incoming = directionVector(incomingAxisId)
  const normal = opposedNormal(incoming, tangent)
  const reflected = reflect(incoming, normal, 1)
  const direction = nearestHexDirection(reflected)
  const pivotHex = cloneHex(obstacle.hex)
  const exitHex = {
    q: pivotHex.q + direction.q,
    r: pivotHex.r + direction.r,
  }

  return {
    kind: 'obstacle-wall-cell-pivot',
    surface: 'obstacle',
    obstacle,
    t: 1,
    point: axialToWorld(pivotHex),
    normal: { ...normal },
    reflected: { ...reflected },
    direction,
    pivotHex,
    exitHex,
    wallAxis,
    faceIds: [`wall-${wallAxis}`],
    wallCellPivot: true,
    wallCellTravelCost: 1,
    reflectionContinuation: WALL_CELL_TRAVEL_RULE,
  }
}
