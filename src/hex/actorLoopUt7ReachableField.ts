import { actorAt, cellAt, getPlayer, type Coord } from '../game'
import {
  axisEquals,
  axisLabel,
  behaviorIntent,
  clampMomentum,
  createSpatialState,
  horizontalAxis,
  thermalDomainFor,
  thermalSideFor,
  ut7Config,
  type ActionPlan,
  type MomentumLevel,
  type SpatialAxis,
  type SpatialInertiaState,
  type SteeringCellStep,
  type ThermalBehavior,
  type ThermalInertiaState,
  type Ut7Settings,
  type Ut7State,
} from './actorLoopUt7'
import { basicMovePlansForTarget, basicMoveTargetCoords } from './actorLoopUt7BasicMove'
import {
  HEX_DIRECTIONS,
  getHexNeighbors,
  hexDirectionBetween,
  hexDirectionWorldVector,
  hexDistance,
  hexWorldOffset,
  type HexDirection,
} from './hexTopology'

export type NormalizedHexPoint = { x: number; z: number }

const clone = <T>(value: T): T => structuredClone(value)
const sameCoord = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y
const keyOf = (coord: Coord) => `${coord.x},${coord.y}`
const directionOrder = HEX_DIRECTIONS.map((entry) => entry.direction)

function traversable(state: Ut7State, coord: Coord) {
  const cell = cellAt(state.game, coord)
  if (!cell || cell.tags.some((tag) => tag === 'Void' || tag === 'Blocked' || tag === 'Mountain')) return false
  const occupant = actorAt(state.game, coord)
  return !occupant || occupant.id === 'player'
}

function spatialFor(state: Ut7State): SpatialInertiaState {
  return state.spatialByActorId.player ?? createSpatialState()
}

function directionIndex(direction: HexDirection) {
  return directionOrder.indexOf(direction)
}

function angularDistance(from: HexDirection, to: HexDirection) {
  const diff = Math.abs(directionIndex(from) - directionIndex(to))
  return Math.min(diff, directionOrder.length - diff)
}

function projection(origin: Coord, target: Coord, axis: HexDirection) {
  const originPoint = hexWorldOffset(origin, 1)
  const targetPoint = hexWorldOffset(target, 1)
  const axisVector = hexDirectionWorldVector(axis, 1)
  const spacing = Math.hypot(axisVector.x, axisVector.z)
  const ux = axisVector.x / spacing
  const uz = axisVector.z / spacing
  const dx = targetPoint.x - originPoint.x
  const dz = targetPoint.z - originPoint.z
  return {
    forward: (dx * ux + dz * uz) / spacing,
    lateral: Math.abs(dx * uz - dz * ux) / spacing,
  }
}

/**
 * Candidate field silhouette discussed in planning:
 * M0: the adjacent ring.
 * M1: a compact 3x3-ish footprint with the direct rear removed.
 * M2/M3: progressively longer axis-oriented teardrops.
 *
 * The geometry is deliberately isolated here so the silhouette can be tuned
 * without changing movement settlement or presentation mode.
 */
export function inReachableField(origin: Coord, target: Coord, level: MomentumLevel, axis?: HexDirection) {
  const distance = hexDistance(origin, target)
  if (distance < 1) return false
  if (level === 0 || !axis) return distance === 1

  const { forward, lateral } = projection(origin, target, axis)
  if (level === 1) {
    return distance <= 2
      && forward > -0.75
      && forward <= 1.6
      && lateral <= 1.01
  }

  const maxDistance = level + 1
  const maxForward = level === 2 ? 3.05 : 4.05
  const baseWidth = level === 2 ? 1.46 : 1.64
  const taper = level === 2 ? 0.19 : 0.22
  const width = Math.max(0.56, baseWidth - taper * Math.max(0, forward))
  return distance <= maxDistance
    && forward >= -0.56
    && forward <= maxForward
    && lateral <= width
}

type PathNode = {
  coord: Coord
  direction: HexDirection
  steps: number
  parent?: PathNode
}

function findFieldPath(input: Ut7State, target: Coord): Coord[] | null {
  const player = getPlayer(input.game)
  const spatial = spatialFor(input)
  if (spatial.level === 0 || spatial.axis?.kind !== 'horizontal') return null
  if (!inReachableField(player.position, target, spatial.level, spatial.axis.dir)) return null
  if (!traversable(input, target)) return null

  const maxSteps = spatial.level + 1
  const turnLimit = spatial.level === 1 ? 2 : 1
  const startDirection = spatial.axis.dir
  const queue: PathNode[] = []
  const visited = new Set<string>()

  for (const entry of getHexNeighbors(player.position)) {
    if (angularDistance(startDirection, entry.direction) > turnLimit) continue
    if (!inReachableField(player.position, entry.coord, spatial.level, startDirection)) continue
    if (!traversable(input, entry.coord)) continue
    const node: PathNode = { coord: clone(entry.coord), direction: entry.direction, steps: 1 }
    queue.push(node)
    visited.add(`${keyOf(entry.coord)}|${entry.direction}|1`)
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]
    if (sameCoord(current.coord, target)) {
      const path: Coord[] = []
      let node: PathNode | undefined = current
      while (node) {
        path.push(clone(node.coord))
        node = node.parent
      }
      path.reverse()
      return path
    }
    if (current.steps >= maxSteps) continue

    const candidates = getHexNeighbors(current.coord)
      .filter((entry) => angularDistance(current.direction, entry.direction) <= turnLimit)
      .sort((left, right) => {
        const leftDistance = hexDistance(left.coord, target)
        const rightDistance = hexDistance(right.coord, target)
        return leftDistance - rightDistance
          || angularDistance(current.direction, left.direction) - angularDistance(current.direction, right.direction)
      })

    for (const entry of candidates) {
      if (!inReachableField(player.position, entry.coord, spatial.level, startDirection)) continue
      if (!traversable(input, entry.coord)) continue
      const key = `${keyOf(entry.coord)}|${entry.direction}|${current.steps + 1}`
      if (visited.has(key)) continue
      visited.add(key)
      queue.push({
        coord: clone(entry.coord),
        direction: entry.direction,
        steps: current.steps + 1,
        parent: current,
      })
    }
  }

  return null
}

export function inertiaReachableTargetCoords(input: Ut7State, settings: Ut7Settings): Coord[] {
  const player = getPlayer(input.game)
  const spatial = spatialFor(input)
  if (spatial.level === 0 || spatial.axis?.kind !== 'horizontal') {
    return basicMoveTargetCoords(input, settings)
  }

  return input.game.cells
    .map((cell) => clone(cell.coord))
    .filter((coord) => inReachableField(player.position, coord, spatial.level, spatial.axis!.kind === 'horizontal' ? spatial.axis.dir : undefined))
    .filter((coord) => traversable(input, coord))
    .filter((coord) => findFieldPath(input, coord) !== null)
}

function advanceThermal(input: ThermalInertiaState, deltaAt: number) {
  const duration = Math.max(0, deltaAt)
  let next = clone(input)
  if (duration <= 0) return next
  const omega = Math.PI * 2 / Math.max(0.25, ut7Config.thermal.thermalPeriodAt)
  const substeps = Math.max(1, Math.ceil(duration * ut7Config.thermal.integrationSubstepsPerAt))
  const dt = duration / substeps
  for (let index = 0; index < substeps; index += 1) {
    const offset = next.temperature - next.setPoint
    const acceleration = -omega * omega * offset
      - Math.max(0, ut7Config.thermal.damping) * next.drift
      + ut7Config.thermal.ambientThermalBias
    next.drift += acceleration * dt
    next.temperature = Math.max(
      ut7Config.thermal.temperatureMin,
      Math.min(ut7Config.thermal.temperatureMax, next.temperature + next.drift * dt),
    )
  }
  if (
    Math.abs(next.temperature - next.setPoint) <= ut7Config.thermal.settleTemperatureEpsilon
    && Math.abs(next.drift) <= ut7Config.thermal.settleDriftEpsilon
  ) {
    next.temperature = next.setPoint
    next.drift = 0
  }
  return next
}

function applyThermal(state: Ut7State, behavior: ThermalBehavior) {
  const intent = behaviorIntent(behavior)
  if (intent === 'hotward') state.thermal.drift += ut7Config.thermal.behaviorDriftImpulse
  else if (intent === 'coldward') state.thermal.drift -= ut7Config.thermal.behaviorDriftImpulse
  else if (intent === 'balancing') state.thermal.drift *= ut7Config.thermal.balancingDriftRetention
  state.thermal = advanceThermal(state.thermal, 1)
  state.worldTimeAt += 1
  getPlayer(state.game).bodyTemperature = state.thermal.temperature
}

function rememberBehavior(state: Ut7State, axis: SpatialAxis) {
  const current = state.continuityByActorId.player ?? { axis: null, streak: 0 }
  state.continuityByActorId.player = axisEquals(current.axis, axis)
    ? { axis: clone(axis), streak: current.streak + 1 }
    : { axis: clone(axis), streak: 1 }
}

function appendLog(
  state: Ut7State,
  beforeSpatial: SpatialInertiaState,
  beforeThermal: ThermalInertiaState,
  behavior: ThermalBehavior,
  detail: string,
) {
  state.logSequence += 1
  state.logs.unshift({
    id: state.logSequence,
    timeAt: state.worldTimeAt,
    action: 'Basic Move · Reachable Field',
    atCost: 1,
    behavior,
    thermalIntent: behaviorIntent(behavior),
    beforeSpatial,
    afterSpatial: clone(spatialFor(state)),
    beforeThermal,
    afterThermal: clone(state.thermal),
    detail,
  })
  state.logs = state.logs.slice(0, 140)
}

function invalidPlan(input: Ut7State, reason: string): ActionPlan {
  return {
    id: 'basic-move-field',
    label: 'Basic Move',
    valid: false,
    reason,
    atCost: 0,
    summary: reason,
    path: [],
    timeline: [],
    result: clone(input),
  }
}

/** One click is one tactical Basic Move / 1 AT. The selected field cell is a guaranteed endpoint. */
export function inertiaFieldMovePlan(input: Ut7State, target: Coord, settings: Ut7Settings): ActionPlan {
  const player = getPlayer(input.game)
  const spatial = spatialFor(input)

  if (spatial.level === 0 || spatial.axis?.kind !== 'horizontal') {
    return basicMovePlansForTarget(input, target, settings)[0]
      ?? invalidPlan(input, 'Target is outside the current Basic Move field')
  }

  const path = findFieldPath(input, target)
  if (!path) return invalidPlan(input, 'Target is outside the current inertia reachable field')

  const state = clone(input)
  const beforeSpatial = clone(spatial)
  const beforeThermal = clone(state.thermal)
  const statePlayer = getPlayer(state.game)
  const cellSteps: SteeringCellStep[] = []
  let from = clone(statePlayer.position)
  let previousAxis: SpatialAxis = horizontalAxis(spatial.axis.dir)

  for (let index = 0; index < path.length; index += 1) {
    const to = path[index]
    const direction = hexDirectionBetween(from, to)
    if (!direction) return invalidPlan(input, 'Reachable field path contains a non-adjacent step')
    const newAxis = horizontalAxis(direction)
    cellSteps.push({
      index: index + 1,
      from: clone(from),
      to: clone(to),
      oldAxis: clone(previousAxis),
      newAxis: clone(newAxis),
      moveDirection: direction,
    })
    previousAxis = newAxis
    from = clone(to)
  }

  const endDirection = cellSteps.at(-1)?.moveDirection ?? spatial.axis.dir
  const redirected = cellSteps.some((step) => step.moveDirection !== spatial.axis!.dir)
  const behavior: ThermalBehavior = redirected ? 'resist' : 'use'
  const nextLevel = clampMomentum(spatial.level - 1)
  statePlayer.position = clone(target)
  state.spatialByActorId.player = createSpatialState(nextLevel, horizontalAxis(endDirection))
  applyThermal(state, behavior)
  rememberBehavior(state, horizontalAxis(endDirection))

  const detail = `Reachable Field M${spatial.level} · ${axisLabel(spatial.axis)} · ${path.length} Cell path · endpoint (${target.x},${target.y}) · Spend1 M → M${nextLevel} · ${redirected ? 'Redirect/Resist' : 'Same-axis Use'}`
  appendLog(state, beforeSpatial, beforeThermal, behavior, detail)

  return {
    id: 'basic-move-field',
    label: 'Basic Move',
    valid: true,
    reason: '',
    atCost: 1,
    summary: `Field endpoint (${target.x},${target.y}) · 1 AT · ${path.length} Cell path · ${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} → ${axisLabel(state.spatialByActorId.player.axis)} M${nextLevel}`,
    path: path.map(clone),
    timeline: [{
      atIndex: 1,
      beforeM: beforeSpatial.level,
      afterM: nextLevel,
      beforeAxis: clone(beforeSpatial.axis),
      afterAxis: clone(state.spatialByActorId.player.axis),
      behavior,
      thermalIntent: behaviorIntent(behavior),
      temperatureBefore: beforeThermal.temperature,
      temperatureAfter: state.thermal.temperature,
      driftBefore: beforeThermal.drift,
      driftAfter: state.thermal.drift,
      cellSteps,
      detail,
    }],
    result: state,
  }
}

export function normalizedCellCenter(coord: Coord): NormalizedHexPoint {
  return hexWorldOffset(coord, 1)
}

function chaikin(points: NormalizedHexPoint[]) {
  if (points.length < 3) return points.map(clone)
  const next: NormalizedHexPoint[] = [clone(points[0])]
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]
    const b = points[index + 1]
    next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 })
    next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 })
  }
  next.push(clone(points.at(-1)!))
  return next
}

/**
 * Continuous presentation of the same field move. Coordinates are normalized
 * Hex world coordinates (radius=1); the renderer scales them to its tile size.
 */
export function continuousInertiaPath(
  input: Ut7State,
  target: Coord,
  settings: Ut7Settings,
  startPoint?: NormalizedHexPoint,
): NormalizedHexPoint[] {
  const plan = inertiaFieldMovePlan(input, target, settings)
  if (!plan.valid || plan.path.length === 0) return []

  const player = getPlayer(input.game)
  const spatial = spatialFor(input)
  const start = startPoint ? clone(startPoint) : normalizedCellCenter(player.position)
  const points: NormalizedHexPoint[] = [start]

  if (spatial.level > 0 && spatial.axis?.kind === 'horizontal') {
    const axis = hexDirectionWorldVector(spatial.axis.dir, 1)
    const length = Math.hypot(axis.x, axis.z)
    const guideDistance = 0.34 + spatial.level * 0.08
    points.push({
      x: start.x + axis.x / length * guideDistance,
      z: start.z + axis.z / length * guideDistance,
    })
  }

  const centers = plan.path.map(normalizedCellCenter)
  const targetCenter = centers.at(-1)!
  const previous = centers.length > 1 ? centers[centers.length - 2] : start
  const incomingX = targetCenter.x - previous.x
  const incomingZ = targetCenter.z - previous.z
  const incomingLength = Math.max(0.001, Math.hypot(incomingX, incomingZ))
  const endpoint: NormalizedHexPoint = {
    x: targetCenter.x - incomingX / incomingLength * 0.32,
    z: targetCenter.z - incomingZ / incomingLength * 0.32,
  }

  for (let index = 0; index < centers.length - 1; index += 1) points.push(centers[index])
  points.push(endpoint)

  const deduped = points.filter((point, index) => {
    if (index === 0) return true
    const previousPoint = points[index - 1]
    return Math.hypot(point.x - previousPoint.x, point.z - previousPoint.z) > 0.02
  })
  return chaikin(chaikin(deduped))
}

export function reachableFieldProfile(input: Ut7State) {
  const spatial = spatialFor(input)
  if (spatial.level === 0) return 'M0 · adjacent ring'
  if (spatial.axis?.kind !== 'horizontal') return `${axisLabel(spatial.axis)} M${spatial.level} · breakaway field`
  if (spatial.level === 1) return `M1 · compact 3×3-ish / rear closed · ${spatial.axis.dir}`
  return `M${spatial.level} · ${spatial.level === 2 ? 'short' : 'long'} teardrop · ${spatial.axis.dir}`
}

export function fieldShapeDiagnostics(input: Ut7State, settings: Ut7Settings) {
  const targets = inertiaReachableTargetCoords(input, settings)
  const spatial = spatialFor(input)
  const player = getPlayer(input.game)
  const maxDistance = targets.reduce((max, target) => Math.max(max, hexDistance(player.position, target)), 0)
  return { level: spatial.level, axis: axisLabel(spatial.axis), targetCount: targets.length, maxDistance }
}

export function thermalMatchForField(input: Ut7State) {
  const spatial = spatialFor(input)
  if (!spatial.axis) return 'none'
  const side = thermalSideFor(input.thermal.temperature, input.thermal.setPoint)
  const domain = thermalDomainFor(input.thermal.temperature)
  return `${side}/${domain}`
}
