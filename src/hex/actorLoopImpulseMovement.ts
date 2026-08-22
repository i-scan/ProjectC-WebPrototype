import { actorAt, cellAt, getPlayer, type Actor, type Coord } from '../game'
import {
  axisEquals,
  behaviorIntent,
  clampMomentum,
  createSpatialState,
  horizontalAxis,
  ut7Config,
  type MomentumLevel,
  type SpatialAxis,
  type SpatialInertiaState,
  type ThermalBehavior,
  type ThermalInertiaState,
  type Ut7State,
} from './actorLoopUt7'
import {
  HEX_DIRECTIONS,
  getHexNeighbors,
  hexAdvance,
  hexDirectionWorldVector,
  hexWorldOffset,
  type HexDirection,
} from './hexTopology'

export type ImpulseActionId = 'coast' | 'drive' | 'heavy-drive' | 'counter' | 'hard-turn'
export type CollisionMode = 'bounce' | 'stop'

export type ImpulseActionSpec = {
  id: ImpulseActionId
  label: string
  shortLabel: string
  force: number
  centerOffsetDeg: number
  aimWindowDeg: number
  description: string
}

export type ImpulseSettings = {
  collisionMode: CollisionMode
  hardRetention: number
  reflectorRetention: number
  actorMomentumLoss: number
}

export type ImpulseKinematics = {
  headingDeg: number | null
}

export type ImpulseCollision = {
  kind: 'surface' | 'actor' | 'boundary'
  coord: Coord
  label: string
  speedBefore: MomentumLevel
  speedAfter: MomentumLevel
  actorId?: string
  reflectedHeadingDeg?: number
}

export type ImpulsePlan = {
  valid: boolean
  reason: string
  action: ImpulseActionSpec
  aimDeg: number
  beforeM: MomentumLevel
  afterImpulseM: MomentumLevel
  afterM: MomentumLevel
  beforeHeadingDeg: number | null
  resolvedHeadingDeg: number | null
  finalHeadingDeg: number | null
  path: Coord[]
  collisions: ImpulseCollision[]
  behavior: ThermalBehavior
  thermalIntent: ReturnType<typeof behaviorIntent>
  result: Ut7State
  summary: string
}

export const impulseActionSpecs: ReadonlyArray<ImpulseActionSpec> = [
  {
    id: 'coast',
    label: 'Coast',
    shortLabel: '滑行',
    force: 0,
    centerOffsetDeg: 0,
    aimWindowDeg: 0,
    description: '不施加新力；让当前 Momentum 自己完成本 AT 的位移。',
  },
  {
    id: 'drive',
    label: 'Drive',
    shortLabel: '推进',
    force: 1,
    centerOffsetDeg: 0,
    aimWindowDeg: 60,
    description: '沿当前趋势附近施加 Force 1；M0 时可以向任意方向起步。',
  },
  {
    id: 'heavy-drive',
    label: 'Heavy Drive',
    shortLabel: '重推进',
    force: 2,
    centerOffsetDeg: 0,
    aimWindowDeg: 60,
    description: '沿当前趋势附近施加 Force 2；用于快速建立或强化 Momentum。',
  },
  {
    id: 'counter',
    label: 'Counter Impulse',
    shortLabel: '反冲',
    force: 1,
    centerOffsetDeg: 180,
    aimWindowDeg: 60,
    description: '向当前运动反方向附近施加 Force 1；这是主动减速而不是自动消耗 M。',
  },
  {
    id: 'hard-turn',
    label: 'Hard Turn',
    shortLabel: '急转',
    force: 1,
    centerOffsetDeg: 0,
    aimWindowDeg: 120,
    description: '允许更大的侧向冲量；通常会被视为 Resist / Hotward。',
  },
]

export const defaultImpulseSettings: ImpulseSettings = {
  collisionMode: 'bounce',
  hardRetention: 0.45,
  reflectorRetention: 0.8,
  actorMomentumLoss: 1,
}

const clone = <T>(value: T): T => structuredClone(value)
const normalizeDeg = (value: number) => ((value % 360) + 360) % 360
const shortestDeltaDeg = (from: number, to: number) => {
  const delta = normalizeDeg(to) - normalizeDeg(from)
  return ((delta + 540) % 360) - 180
}
const sameCoord = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y
const surfaceTags = ['UT3Hard', 'UT3ReflectLeft', 'UT3ReflectRight'] as const

function axisAngle(direction: HexDirection) {
  const vector = hexDirectionWorldVector(direction, 1)
  return normalizeDeg(Math.atan2(vector.z, vector.x) * 180 / Math.PI)
}

export function nearestHexDirection(angleDeg: number): HexDirection {
  return HEX_DIRECTIONS
    .map((entry) => ({ direction: entry.direction, delta: Math.abs(shortestDeltaDeg(axisAngle(entry.direction), angleDeg)) }))
    .sort((a, b) => a.delta - b.delta)[0].direction
}

export function headingForState(state: Ut7State, kinematics: ImpulseKinematics): number | null {
  if (kinematics.headingDeg !== null) return normalizeDeg(kinematics.headingDeg)
  const spatial = state.spatialByActorId.player ?? createSpatialState()
  return spatial.level > 0 && spatial.axis?.kind === 'horizontal' ? axisAngle(spatial.axis.dir) : null
}

function vectorFor(angleDeg: number, magnitude: number) {
  const radians = angleDeg * Math.PI / 180
  return { x: Math.cos(radians) * magnitude, z: Math.sin(radians) * magnitude }
}

function vectorAngle(vector: { x: number; z: number }) {
  return normalizeDeg(Math.atan2(vector.z, vector.x) * 180 / Math.PI)
}

function cellIsSurface(state: Ut7State, coord: Coord) {
  const cell = cellAt(state.game, coord)
  return cell?.tags.some((tag) => surfaceTags.includes(tag as typeof surfaceTags[number])) ?? false
}

function cellIsHardBlocked(state: Ut7State, coord: Coord) {
  const cell = cellAt(state.game, coord)
  return !cell || cell.tags.some((tag) => tag === 'Void' || tag === 'Blocked' || tag === 'Mountain')
}

function actorCanBePushed(state: Ut7State, actor: Actor, direction: HexDirection) {
  const target = hexAdvance(actor.position, direction)
  if (cellIsHardBlocked(state, target) || cellIsSurface(state, target)) return null
  if (actorAt(state.game, target)) return null
  return target
}

function chooseGeometricNeighbor(current: Coord, segmentOrigin: Coord, headingDeg: number, localStep: number) {
  const origin = hexWorldOffset(segmentOrigin, 1)
  const spacingVector = hexDirectionWorldVector('E', 1)
  const spacing = Math.hypot(spacingVector.x, spacingVector.z)
  const unit = vectorFor(headingDeg, 1)
  const targetPoint = {
    x: origin.x + unit.x * spacing * localStep,
    z: origin.z + unit.z * spacing * localStep,
  }
  return getHexNeighbors(current)
    .map((entry) => {
      const point = hexWorldOffset(entry.coord, 1)
      return {
        ...entry,
        distanceSquared: (point.x - targetPoint.x) ** 2 + (point.z - targetPoint.z) ** 2,
      }
    })
    .sort((a, b) => a.distanceSquared - b.distanceSquared)[0]
}

function reflectHeading(headingDeg: number, collisionDirection: HexDirection, biasDeg = 0) {
  const velocity = vectorFor(headingDeg, 1)
  const normalVector = hexDirectionWorldVector(collisionDirection, 1)
  const normalLength = Math.max(0.0001, Math.hypot(normalVector.x, normalVector.z))
  const normal = { x: normalVector.x / normalLength, z: normalVector.z / normalLength }
  const dot = velocity.x * normal.x + velocity.z * normal.z
  const reflected = {
    x: velocity.x - 2 * dot * normal.x,
    z: velocity.z - 2 * dot * normal.z,
  }
  return normalizeDeg(vectorAngle(reflected) + biasDeg)
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

function updateContinuity(state: Ut7State, spatial: SpatialInertiaState) {
  if (!spatial.axis || spatial.level === 0) {
    state.continuityByActorId.player = { axis: null, streak: 0 }
    return
  }
  const current = state.continuityByActorId.player ?? { axis: null, streak: 0 }
  state.continuityByActorId.player = axisEquals(current.axis, spatial.axis)
    ? { axis: clone(spatial.axis), streak: current.streak + 1 }
    : { axis: clone(spatial.axis), streak: 1 }
}

function behaviorFor(beforeM: MomentumLevel, beforeHeading: number | null, action: ImpulseActionSpec, aimDeg: number, collided: boolean): ThermalBehavior {
  if (collided) return 'resist'
  if (action.force === 0) return beforeM > 0 ? 'use' : 'passive-dissipation'
  if (beforeM === 0 || beforeHeading === null) return 'generate'
  const delta = Math.abs(shortestDeltaDeg(beforeHeading, aimDeg))
  return delta <= 60 && action.id !== 'hard-turn' ? 'use' : 'resist'
}

function appendLog(
  state: Ut7State,
  action: ImpulseActionSpec,
  beforeSpatial: SpatialInertiaState,
  beforeThermal: ThermalInertiaState,
  behavior: ThermalBehavior,
  detail: string,
) {
  state.logSequence += 1
  state.logs.unshift({
    id: state.logSequence,
    timeAt: state.worldTimeAt,
    action: `Impulse · ${action.label}`,
    atCost: 1,
    behavior,
    thermalIntent: behaviorIntent(behavior),
    beforeSpatial: clone(beforeSpatial),
    afterSpatial: clone(state.spatialByActorId.player ?? createSpatialState()),
    beforeThermal,
    afterThermal: clone(state.thermal),
    detail,
  })
  state.logs = state.logs.slice(0, 140)
  state.game.logs.unshift(`[Impulse] ${detail}`)
  state.game.logs = state.game.logs.slice(0, 120)
}

function invalidPlan(input: Ut7State, action: ImpulseActionSpec, aimDeg: number, reason: string): ImpulsePlan {
  const spatial = input.spatialByActorId.player ?? createSpatialState()
  const heading = spatial.level > 0 && spatial.axis?.kind === 'horizontal' ? axisAngle(spatial.axis.dir) : null
  return {
    valid: false,
    reason,
    action,
    aimDeg,
    beforeM: spatial.level,
    afterImpulseM: spatial.level,
    afterM: spatial.level,
    beforeHeadingDeg: heading,
    resolvedHeadingDeg: heading,
    finalHeadingDeg: heading,
    path: [],
    collisions: [],
    behavior: 'neutral',
    thermalIntent: 'neutral',
    result: clone(input),
    summary: reason,
  }
}

export function actionById(id: ImpulseActionId) {
  return impulseActionSpecs.find((action) => action.id === id) ?? impulseActionSpecs[1]
}

export function aimCenterForAction(state: Ut7State, kinematics: ImpulseKinematics, action: ImpulseActionSpec) {
  const heading = headingForState(state, kinematics)
  if (heading === null) return 0
  return normalizeDeg(heading + action.centerOffsetDeg)
}

export function impulsePlan(
  input: Ut7State,
  kinematics: ImpulseKinematics,
  action: ImpulseActionSpec,
  aimDegInput: number,
  settings: ImpulseSettings = defaultImpulseSettings,
): ImpulsePlan {
  const state = clone(input)
  const player = getPlayer(state.game)
  const beforeSpatial = clone(state.spatialByActorId.player ?? createSpatialState())
  const beforeThermal = clone(state.thermal)
  const beforeHeading = headingForState(state, kinematics)
  const aimDeg = normalizeDeg(aimDegInput)

  if (action.id === 'coast' && beforeSpatial.level === 0) return invalidPlan(input, action, aimDeg, 'M0 cannot Coast; apply an impulse first')
  if (action.id === 'counter' && beforeSpatial.level === 0) return invalidPlan(input, action, aimDeg, 'M0 has no existing velocity to counter')

  if (beforeSpatial.level > 0 && beforeHeading !== null && action.force > 0) {
    const center = normalizeDeg(beforeHeading + action.centerOffsetDeg)
    const delta = Math.abs(shortestDeltaDeg(center, aimDeg))
    if (delta > action.aimWindowDeg + 0.001) {
      return invalidPlan(input, action, aimDeg, `${action.label} aim is outside ±${action.aimWindowDeg}° control window`)
    }
  }

  const currentVelocity = beforeSpatial.level > 0 && beforeHeading !== null
    ? vectorFor(beforeHeading, beforeSpatial.level)
    : { x: 0, z: 0 }
  const impulse = action.force > 0 ? vectorFor(aimDeg, action.force) : { x: 0, z: 0 }
  let resolvedVector = { x: currentVelocity.x + impulse.x, z: currentVelocity.z + impulse.z }
  const afterImpulseMagnitude = Math.hypot(resolvedVector.x, resolvedVector.z)
  let speed = clampMomentum(afterImpulseMagnitude)
  let heading = speed > 0 ? vectorAngle(resolvedVector) : null
  const resolvedHeading = heading
  const afterImpulseM = speed
  const path: Coord[] = []
  const collisions: ImpulseCollision[] = []
  let current = clone(player.position)
  let remaining = speed
  let segmentOrigin = clone(current)
  let segmentStep = 0

  while (remaining > 0 && heading !== null) {
    segmentStep += 1
    const desired = chooseGeometricNeighbor(current, segmentOrigin, heading, segmentStep)
    const targetCell = cellAt(state.game, desired.coord)

    if (!targetCell || targetCell.tags.includes('Void')) {
      const speedBefore = speed
      if (settings.collisionMode === 'stop') speed = 0
      else {
        heading = reflectHeading(heading, desired.direction)
        speed = clampMomentum(speed * settings.hardRetention)
      }
      collisions.push({
        kind: 'boundary',
        coord: clone(desired.coord),
        label: 'World Boundary',
        speedBefore,
        speedAfter: speed,
        reflectedHeadingDeg: speed > 0 ? heading ?? undefined : undefined,
      })
      remaining = Math.min(Math.max(0, remaining - 1), speed)
      segmentOrigin = clone(current)
      segmentStep = 0
      if (speed === 0) break
      continue
    }

    const surfaceTag = targetCell.tags.find((tag) => surfaceTags.includes(tag as typeof surfaceTags[number]))
    if (surfaceTag || targetCell.tags.includes('Blocked') || targetCell.tags.includes('Mountain')) {
      const speedBefore = speed
      const isReflector = surfaceTag === 'UT3ReflectLeft' || surfaceTag === 'UT3ReflectRight'
      const retention = isReflector ? settings.reflectorRetention : settings.hardRetention
      const bias = surfaceTag === 'UT3ReflectLeft' ? 30 : surfaceTag === 'UT3ReflectRight' ? -30 : 0
      if (settings.collisionMode === 'stop') speed = 0
      else {
        heading = reflectHeading(heading, desired.direction, bias)
        speed = clampMomentum(speed * retention)
      }
      collisions.push({
        kind: 'surface',
        coord: clone(desired.coord),
        label: surfaceTag ?? (targetCell.tags.includes('Mountain') ? 'Mountain' : 'Hard Surface'),
        speedBefore,
        speedAfter: speed,
        reflectedHeadingDeg: speed > 0 ? heading ?? undefined : undefined,
      })
      remaining = Math.min(Math.max(0, remaining - 1), speed)
      segmentOrigin = clone(current)
      segmentStep = 0
      if (speed === 0) break
      continue
    }

    const occupant = actorAt(state.game, desired.coord)
    if (occupant && occupant.id !== 'player') {
      const speedBefore = speed
      const pushTarget = actorCanBePushed(state, occupant, desired.direction)
      if (pushTarget) {
        occupant.position = clone(pushTarget)
        current = clone(desired.coord)
        player.position = clone(current)
        path.push(clone(current))
        speed = clampMomentum(speed - settings.actorMomentumLoss)
        collisions.push({
          kind: 'actor',
          coord: clone(desired.coord),
          label: `Transfer → ${occupant.name}`,
          speedBefore,
          speedAfter: speed,
          actorId: occupant.id,
        })
        remaining = Math.min(Math.max(0, remaining - 1), speed)
        segmentOrigin = clone(current)
        segmentStep = 0
        if (speed === 0) break
        continue
      }

      if (settings.collisionMode === 'stop') speed = 0
      else {
        heading = reflectHeading(heading, desired.direction)
        speed = clampMomentum(speed * settings.hardRetention)
      }
      collisions.push({
        kind: 'actor',
        coord: clone(desired.coord),
        label: `Blocked by ${occupant.name}`,
        speedBefore,
        speedAfter: speed,
        actorId: occupant.id,
        reflectedHeadingDeg: speed > 0 ? heading ?? undefined : undefined,
      })
      remaining = Math.min(Math.max(0, remaining - 1), speed)
      segmentOrigin = clone(current)
      segmentStep = 0
      if (speed === 0) break
      continue
    }

    current = clone(desired.coord)
    player.position = clone(current)
    path.push(clone(current))
    remaining -= 1
  }

  const finalHeading = speed > 0 && heading !== null ? normalizeDeg(heading) : null
  const finalAxis: SpatialAxis | null = finalHeading === null ? null : horizontalAxis(nearestHexDirection(finalHeading))
  const finalSpatial = createSpatialState(speed, finalAxis)
  state.spatialByActorId.player = finalSpatial
  updateContinuity(state, finalSpatial)

  const behavior = behaviorFor(beforeSpatial.level, beforeHeading, action, aimDeg, collisions.length > 0)
  applyThermal(state, behavior)
  const collisionText = collisions.length > 0
    ? ` · ${collisions.map((entry) => `${entry.label} M${entry.speedBefore}→M${entry.speedAfter}`).join(' / ')}`
    : ''
  const detail = `${action.label} · Aim ${aimDeg.toFixed(0)}° · Force ${action.force} · M${beforeSpatial.level}→M${afterImpulseM}→M${speed} · ${path.length} Cell displacement${collisionText}`
  appendLog(state, action, beforeSpatial, beforeThermal, behavior, detail)

  return {
    valid: true,
    reason: '',
    action,
    aimDeg,
    beforeM: beforeSpatial.level,
    afterImpulseM,
    afterM: speed,
    beforeHeadingDeg: beforeHeading,
    resolvedHeadingDeg: resolvedHeading,
    finalHeadingDeg: finalHeading,
    path,
    collisions,
    behavior,
    thermalIntent: behaviorIntent(behavior),
    result: state,
    summary: detail,
  }
}

export function aimAngleToCoord(origin: Coord, coord: Coord) {
  if (sameCoord(origin, coord)) return null
  const from = hexWorldOffset(origin, 1)
  const to = hexWorldOffset(coord, 1)
  return normalizeDeg(Math.atan2(to.z - from.z, to.x - from.x) * 180 / Math.PI)
}

export function collisionCourse(input: Ut7State) {
  const state = clone(input)
  for (const cell of state.game.cells) {
    cell.tags = cell.tags.filter((tag) => !surfaceTags.includes(tag as typeof surfaceTags[number]) && tag !== 'Blocked')
  }
  const player = getPlayer(state.game)
  const placements: Array<{ coord: Coord; tag: typeof surfaceTags[number] }> = [
    { coord: hexAdvance(player.position, 'E', 3), tag: 'UT3Hard' },
    { coord: hexAdvance(player.position, 'NE', 3), tag: 'UT3ReflectLeft' },
    { coord: hexAdvance(player.position, 'SE', 3), tag: 'UT3ReflectRight' },
  ]
  for (const placement of placements) {
    const cell = cellAt(state.game, placement.coord)
    if (!cell || cell.tags.includes('Void')) continue
    cell.tags.push(placement.tag)
  }
  return state
}
