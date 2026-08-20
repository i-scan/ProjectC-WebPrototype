import experimentConfigJson from '../../config/experiments/val-012-actor-loop-v0.v6.json'
import { actorAt, cellAt, getPlayer, type Actor, type Coord, type GameState } from '../game'
import { createHexRoomState } from './hexRoom'
import {
  HEX_DIRECTIONS,
  hexAdvance,
  hexDirectionBetween,
  hexDistance,
  type HexDirection,
} from './hexTopology'

export type MomentumLevel = 0 | 1 | 2 | 3
export type NaturalBuildStartMode = 'axis-first' | 'immediate-m1'
export type ThermalReleaseMode = 'direct' | 'drift' | 'mixed'
export type SpatialAxis =
  | { kind: 'horizontal'; dir: HexDirection }
  | { kind: 'down' }
  | { kind: 'up' }

export type ThermalInertiaState = {
  temperature: number
  drift: number
  setPoint: number
}

export type SpatialInertiaState = {
  level: MomentumLevel
  axis: SpatialAxis | null
}

export type BehaviorContinuity = {
  axis: SpatialAxis | null
  streak: number
}

export type ActorLoopSettings = {
  naturalBuildStartMode: NaturalBuildStartMode
  launchBrakeMinM: 1 | 2
  buildAfterConversionSameAt: boolean
  drivePreservesMomentum: boolean
  driveContinuousTraversal: boolean
  thermalReleaseMode: ThermalReleaseMode
  at0Enabled: boolean
}

export type ActorLoopLog = {
  id: number
  timeAt: number
  action: string
  atCost: number
  beforeSpatial: SpatialInertiaState
  afterSpatial: SpatialInertiaState
  beforeThermal: ThermalInertiaState
  afterThermal: ThermalInertiaState
  detail: string
}

export type At0State = {
  windowUntilAt: number | null
  weaponUsedAt: number | null
}

export type ActorLoopState = {
  game: GameState
  worldTimeAt: number
  thermal: ThermalInertiaState
  spatialByActorId: Record<string, SpatialInertiaState>
  continuityByActorId: Record<string, BehaviorContinuity>
  selectedActorId: string
  at0: At0State
  logs: ActorLoopLog[]
  logSequence: number
}

export type ActionPlan = {
  id: string
  label: string
  valid: boolean
  reason: string
  atCost: number
  summary: string
  path: Coord[]
  result: ActorLoopState
}

type Config = {
  schemaVersion: string
  rulesetVersion: string
  implementationId: string
  thermal: {
    temperatureMin: number
    temperatureMax: number
    setPointMin: number
    setPointMax: number
    hotDomainThreshold: number
    coldDomainThreshold: number
    damping: number
    thermalPeriodAt: number
    ambientThermalBias: number
    settleTemperatureEpsilon: number
    settleDriftEpsilon: number
    integrationSubstepsPerAt: number
  }
  momentum: {
    maxLevel: number
    naturalBuildStartMode: NaturalBuildStartMode
    naturalBuildCap: number
    domainBuildCap: number
    basicMoveSpendEnabled: boolean
    basicAttackDownSpendEnabled: boolean
    rebuildSpentMomentumSameAt: boolean
    launchBrakeMinM: 1 | 2
    buildAfterConversionSameAt: boolean
    drivePreservesMomentum: boolean
    driveContinuousTraversal: boolean
    momentumProtectionEnabled: boolean
  }
  actions: {
    basicMoveAt: number
    basicAttackAt: number
    holdGroundAt: number
    launchAt: number
    brakeAt: number
    drivePhaseAt: number
    drivePhaseCount: number
    drivePhaseDistances: number[]
    raikiriAt: number
    groundBreakAt: number
  }
  weapon: {
    basicDamage: number
    downSpendIncomingM: number
    horizontalAttackInterruptsTrend: boolean
  }
  conversion: {
    momentumLoss: number
    hotwardDriftInput: number
  }
  incoming: {
    maxInjectedM: number
    secondaryImpactLimit: number
  }
  release: {
    thermalReleaseMode: ThermalReleaseMode
    directTemperatureDelta: number
    driftDelta: number
    raikiri: {
      temperatureThreshold: number
      momentumThreshold: number
      range: number
      damage: number
      releaseAllHorizontalMomentum: boolean
      grantAt0Window: boolean
    }
    groundBreak: {
      momentumThreshold: number
      radius: number
      damage: number
      ring1IncomingM: number
      ring2IncomingM: number
      releaseAllDownMomentum: boolean
    }
  }
  at0: {
    enabled: boolean
    safetyMode: 'debug-only' | 'must-consume-nonrecoverable-state'
    postRaikiriWindowAt: number
    weaponAttacksPerGlobalAt: number
  }
}

export const actorLoopConfig = experimentConfigJson as Config

const clone = <T>(value: T): T => structuredClone(value)
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const sameCoord = (left: Coord, right: Coord) => left.x === right.x && left.y === right.y

export function clampMomentum(value: number): MomentumLevel {
  return clamp(Math.round(value), 0, actorLoopConfig.momentum.maxLevel) as MomentumLevel
}

export function horizontalAxis(dir: HexDirection): SpatialAxis {
  return { kind: 'horizontal', dir }
}

export function downAxis(): SpatialAxis {
  return { kind: 'down' }
}

export function axisEquals(left: SpatialAxis | null, right: SpatialAxis | null): boolean {
  if (!left || !right) return left === right
  if (left.kind !== right.kind) return false
  return left.kind !== 'horizontal' || right.kind !== 'horizontal' || left.dir === right.dir
}

export function axisLabel(axis: SpatialAxis | null): string {
  if (!axis) return 'None'
  if (axis.kind === 'horizontal') return `Axis ${axis.dir}`
  if (axis.kind === 'down') return 'Down'
  return 'Up'
}

export function createSpatialState(level: MomentumLevel = 0, axis: SpatialAxis | null = null): SpatialInertiaState {
  const nextLevel = clampMomentum(level)
  return {
    level: nextLevel,
    axis: nextLevel > 0 && !axis ? downAxis() : clone(axis),
  }
}

export function thermalDomainFor(temperature: number): 'cold' | 'neutral' | 'hot' {
  if (temperature <= actorLoopConfig.thermal.coldDomainThreshold) return 'cold'
  if (temperature >= actorLoopConfig.thermal.hotDomainThreshold) return 'hot'
  return 'neutral'
}

export function defaultActorLoopSettings(): ActorLoopSettings {
  return {
    naturalBuildStartMode: actorLoopConfig.momentum.naturalBuildStartMode,
    launchBrakeMinM: actorLoopConfig.momentum.launchBrakeMinM,
    buildAfterConversionSameAt: actorLoopConfig.momentum.buildAfterConversionSameAt,
    drivePreservesMomentum: actorLoopConfig.momentum.drivePreservesMomentum,
    driveContinuousTraversal: actorLoopConfig.momentum.driveContinuousTraversal,
    thermalReleaseMode: actorLoopConfig.release.thermalReleaseMode,
    at0Enabled: actorLoopConfig.at0.enabled,
  }
}

function advanceThermal(input: ThermalInertiaState, deltaAt: number) {
  const duration = Math.max(0, deltaAt)
  let next = clone(input)
  let minimumTemperature = next.temperature
  let maximumTemperature = next.temperature
  if (duration <= 0) return { state: next, minimumTemperature, maximumTemperature }

  const omega = Math.PI * 2 / Math.max(0.25, actorLoopConfig.thermal.thermalPeriodAt)
  const substeps = Math.max(1, Math.ceil(duration * actorLoopConfig.thermal.integrationSubstepsPerAt))
  const dt = duration / substeps
  for (let index = 0; index < substeps; index += 1) {
    const offset = next.temperature - next.setPoint
    const acceleration = -omega * omega * offset
      - Math.max(0, actorLoopConfig.thermal.damping) * next.drift
      + actorLoopConfig.thermal.ambientThermalBias
    next.drift += acceleration * dt
    next.temperature = clamp(
      next.temperature + next.drift * dt,
      actorLoopConfig.thermal.temperatureMin,
      actorLoopConfig.thermal.temperatureMax,
    )
    minimumTemperature = Math.min(minimumTemperature, next.temperature)
    maximumTemperature = Math.max(maximumTemperature, next.temperature)
  }
  if (
    Math.abs(next.temperature - next.setPoint) <= actorLoopConfig.thermal.settleTemperatureEpsilon
    && Math.abs(next.drift) <= actorLoopConfig.thermal.settleDriftEpsilon
  ) {
    next.temperature = next.setPoint
    next.drift = 0
  }
  return { state: next, minimumTemperature, maximumTemperature }
}

function spatialFor(state: ActorLoopState, actorId: string) {
  return state.spatialByActorId[actorId] ?? createSpatialState()
}

function setSpatial(state: ActorLoopState, actorId: string, spatial: SpatialInertiaState) {
  state.spatialByActorId[actorId] = createSpatialState(spatial.level, spatial.axis)
}

function continuityFor(state: ActorLoopState, actorId: string) {
  return state.continuityByActorId[actorId] ?? { axis: null, streak: 0 }
}

function rememberBehavior(state: ActorLoopState, actorId: string, axis: SpatialAxis) {
  const current = continuityFor(state, actorId)
  state.continuityByActorId[actorId] = axisEquals(current.axis, axis)
    ? { axis: clone(axis), streak: current.streak + 1 }
    : { axis: clone(axis), streak: 1 }
}

function clearContinuity(state: ActorLoopState, actorId: string) {
  state.continuityByActorId[actorId] = { axis: null, streak: 0 }
}

function appendLog(
  state: ActorLoopState,
  action: string,
  atCost: number,
  beforeSpatial: SpatialInertiaState,
  beforeThermal: ThermalInertiaState,
  detail: string,
) {
  state.logSequence += 1
  state.logs.unshift({
    id: state.logSequence,
    timeAt: state.worldTimeAt,
    action,
    atCost,
    beforeSpatial,
    afterSpatial: clone(spatialFor(state, 'player')),
    beforeThermal,
    afterThermal: clone(state.thermal),
    detail,
  })
  state.logs = state.logs.slice(0, 100)
}

function traversable(game: GameState, coord: Coord, movingActorId = 'player') {
  const cell = cellAt(game, coord)
  if (!cell || cell.tags.some((tag) => tag === 'Void' || tag === 'Blocked' || tag === 'Mountain')) return false
  const occupant = actorAt(game, coord)
  return !occupant || occupant.id === movingActorId
}

function actorById(game: GameState, actorId: string) {
  return game.actors.find((actor) => actor.id === actorId && actor.alive)
}

function applyBuild(
  state: ActorLoopState,
  actorId: string,
  behaviorAxis: SpatialAxis,
  thermalTrace: { minimumTemperature: number; maximumTemperature: number },
  settings: ActorLoopSettings,
) {
  rememberBehavior(state, actorId, behaviorAxis)
  const continuity = continuityFor(state, actorId)
  const current = spatialFor(state, actorId)

  const hotMatch = behaviorAxis.kind === 'horizontal'
    && thermalTrace.minimumTemperature >= actorLoopConfig.thermal.hotDomainThreshold
  const coldMatch = behaviorAxis.kind === 'down'
    && thermalTrace.maximumTemperature <= actorLoopConfig.thermal.coldDomainThreshold
  const cap = hotMatch || coldMatch
    ? actorLoopConfig.momentum.domainBuildCap
    : actorLoopConfig.momentum.naturalBuildCap

  if (current.level > 0 && !axisEquals(current.axis, behaviorAxis)) {
    return `Build blocked by existing ${axisLabel(current.axis)} M${current.level}`
  }

  if (current.level === 0) {
    if (settings.naturalBuildStartMode === 'axis-first') {
      if (!axisEquals(current.axis, behaviorAxis) || continuity.streak < 2) {
        setSpatial(state, actorId, createSpatialState(0, behaviorAxis))
        return `Axis First → ${axisLabel(behaviorAxis)} / M0`
      }
      setSpatial(state, actorId, createSpatialState(1, behaviorAxis))
      return `Natural Build → ${axisLabel(behaviorAxis)} M1`
    }
    setSpatial(state, actorId, createSpatialState(1, behaviorAxis))
    return `Immediate Build → ${axisLabel(behaviorAxis)} M1`
  }

  if (current.level >= cap) return `${hotMatch || coldMatch ? 'Domain' : 'Natural'} cap M${cap}`
  const nextLevel = clampMomentum(current.level + 1)
  setSpatial(state, actorId, createSpatialState(nextLevel, behaviorAxis))
  return `${hotMatch || coldMatch ? 'Domain' : 'Natural'} Build → ${axisLabel(behaviorAxis)} M${nextLevel}`
}

function resolveAt(
  state: ActorLoopState,
  atCost: number,
  behaviorAxis: SpatialAxis | null,
  settings: ActorLoopSettings,
  options: { spentLocked?: boolean; conversion?: boolean; resetContinuity?: boolean } = {},
) {
  if (atCost <= 0) return ['AT0: World / Thermal / Build frozen']
  const detail: string[] = []
  for (let at = 0; at < atCost; at += 1) {
    if (options.resetContinuity && behaviorAxis) clearContinuity(state, 'player')
    const trace = advanceThermal(state.thermal, 1)
    state.thermal = trace.state
    state.worldTimeAt += 1
    getPlayer(state.game).bodyTemperature = state.thermal.temperature
    if (behaviorAxis) {
      if (options.spentLocked && !actorLoopConfig.momentum.rebuildSpentMomentumSameAt) {
        rememberBehavior(state, 'player', behaviorAxis)
        detail.push('Same-AT Spend Lock: no refund Build')
      } else if (options.conversion && !settings.buildAfterConversionSameAt) {
        rememberBehavior(state, 'player', behaviorAxis)
        detail.push('Conversion Build OFF')
      } else {
        detail.push(applyBuild(state, 'player', behaviorAxis, trace, settings))
      }
    } else {
      clearContinuity(state, 'player')
    }
  }
  return detail
}

function spendOne(state: ActorLoopState, actorId: string) {
  const current = spatialFor(state, actorId)
  const nextLevel = clampMomentum(current.level - 1)
  setSpatial(state, actorId, createSpatialState(nextLevel, nextLevel > 0 ? current.axis : current.axis))
  return nextLevel
}

function movePath(game: GameState, actorId: string, direction: HexDirection, distance: number) {
  const actor = actorById(game, actorId)
  if (!actor) return { moved: 0, path: [] as Coord[], blocked: true }
  const path: Coord[] = []
  for (let step = 0; step < distance; step += 1) {
    const next = hexAdvance(actor.position, direction)
    if (!traversable(game, next, actorId)) return { moved: path.length, path, blocked: true }
    actor.position = next
    path.push({ ...next })
  }
  return { moved: path.length, path, blocked: false }
}

function outwardDirection(center: Coord, actor: Coord): HexDirection {
  let best = HEX_DIRECTIONS[0].direction
  let bestDistance = -Infinity
  for (const entry of HEX_DIRECTIONS) {
    const next = hexAdvance(actor, entry.direction)
    const distance = hexDistance(center, next)
    if (distance > bestDistance) {
      bestDistance = distance
      best = entry.direction
    }
  }
  return best
}

export type IncomingResult = {
  state: ActorLoopState
  moved: number
  remainingIncoming: MomentumLevel
  detail: string
}

export function applyIncomingMomentum(
  input: ActorLoopState,
  actorId: string,
  direction: HexDirection,
  incomingInput: number,
): IncomingResult {
  const state = clone(input)
  const incoming = clampMomentum(incomingInput)
  const current = spatialFor(state, actorId)
  const incomingAxis = horizontalAxis(direction)
  if (incoming <= 0) return { state, moved: 0, remainingIncoming: 0, detail: 'Incoming M0' }

  let remainingIncoming = incoming
  if (current.level > 0 && current.axis && !axisEquals(current.axis, incomingAxis)) {
    const cancel = Math.min(current.level, remainingIncoming)
    const existingLeft = clampMomentum(current.level - cancel)
    remainingIncoming = clampMomentum(remainingIncoming - cancel)
    if (existingLeft > 0) {
      setSpatial(state, actorId, createSpatialState(existingLeft, current.axis))
      return {
        state,
        moved: 0,
        remainingIncoming,
        detail: `Incoming ${direction} M${incoming} cancels ${cancel}; existing ${axisLabel(current.axis)} M${existingLeft} survives → no Forced Move`,
      }
    }
    if (remainingIncoming <= 0) {
      setSpatial(state, actorId, createSpatialState())
      return {
        state,
        moved: 0,
        remainingIncoming: 0,
        detail: `Incoming ${direction} M${incoming} fully cancels existing ${axisLabel(current.axis)} M${current.level} → M0`,
      }
    }
  }

  const nextLevel = current.level > 0 && axisEquals(current.axis, incomingAxis)
    ? clampMomentum(current.level + remainingIncoming)
    : remainingIncoming
  setSpatial(state, actorId, createSpatialState(nextLevel, incomingAxis))
  const movement = movePath(state.game, actorId, direction, remainingIncoming)
  return {
    state,
    moved: movement.moved,
    remainingIncoming,
    detail: `Incoming ${direction} M${incoming} → Remaining M${remainingIncoming} → Forced Move ${movement.moved}/${remainingIncoming} → ${axisLabel(incomingAxis)} M${nextLevel}${movement.blocked ? ' · blocked during per-cell check' : ''}`,
  }
}

export function basicMovePlan(input: ActorLoopState, direction: HexDirection, settings: ActorLoopSettings): ActionPlan {
  const state = clone(input)
  const player = getPlayer(state.game)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  if (beforeSpatial.level > 0 && beforeSpatial.axis && !axisEquals(beforeSpatial.axis, horizontalAxis(direction))) {
    return invalidPlan(input, 'basic-move', 'Basic Move', `Existing ${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} must be resolved before ${direction}`)
  }
  const compatible = actorLoopConfig.momentum.basicMoveSpendEnabled
    && beforeSpatial.level > 0
    && beforeSpatial.axis?.kind === 'horizontal'
    && beforeSpatial.axis.dir === direction
  const distance = compatible ? 2 : 1
  let probe = { ...player.position }
  for (let step = 0; step < distance; step += 1) {
    probe = hexAdvance(probe, direction)
    if (!traversable(state.game, probe, 'player')) return invalidPlan(input, 'basic-move', 'Basic Move', `Move${distance} path blocked at step ${step + 1}`)
  }
  if (compatible) spendOne(state, 'player')
  const movement = movePath(state.game, 'player', direction, distance)
  const build = resolveAt(state, actorLoopConfig.actions.basicMoveAt, horizontalAxis(direction), settings, { spentLocked: compatible })
  const detail = `${compatible ? 'Spend 1M → ' : ''}Move${movement.moved} · ${build.join(' · ')}`
  appendLog(state, 'Basic Move', actorLoopConfig.actions.basicMoveAt, beforeSpatial, beforeThermal, detail)
  return {
    id: 'basic-move',
    label: 'Basic Move',
    valid: true,
    reason: '',
    atCost: actorLoopConfig.actions.basicMoveAt,
    summary: `${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} → Move${distance} → ${axisLabel(spatialFor(state, 'player').axis)} M${spatialFor(state, 'player').level}`,
    path: movement.path,
    result: state,
  }
}

function at0WeaponAvailable(state: ActorLoopState, settings: ActorLoopSettings) {
  return settings.at0Enabled
    && state.at0.windowUntilAt !== null
    && state.worldTimeAt < state.at0.windowUntilAt
    && state.at0.weaponUsedAt !== state.worldTimeAt
}

export function basicAttackPlan(input: ActorLoopState, targetActorId: string, settings: ActorLoopSettings): ActionPlan {
  let state = clone(input)
  const player = getPlayer(state.game)
  const target = actorById(state.game, targetActorId)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  if (!target || hexDistance(player.position, target.position) !== 1) {
    return invalidPlan(input, 'basic-attack', 'Basic Attack', 'Target must be an adjacent alive Actor')
  }
  const atCost = at0WeaponAvailable(state, settings) ? 0 : actorLoopConfig.actions.basicAttackAt
  const direction = hexDirectionBetween(player.position, target.position)
  if (!direction) return invalidPlan(input, 'basic-attack', 'Basic Attack', 'Target direction is invalid')

  target.hp = Math.max(1, target.hp - actorLoopConfig.weapon.basicDamage)
  const spendDown = actorLoopConfig.momentum.basicAttackDownSpendEnabled
    && beforeSpatial.level > 0
    && beforeSpatial.axis?.kind === 'down'
  let incomingDetail = ''
  if (spendDown) {
    spendOne(state, 'player')
    const incoming = applyIncomingMomentum(state, targetActorId, direction, actorLoopConfig.weapon.downSpendIncomingM)
    state = incoming.state
    incomingDetail = incoming.detail
  }

  if (atCost === 0) {
    state.at0.weaponUsedAt = state.worldTimeAt
  } else {
    resolveAt(state, atCost, downAxis(), settings, { spentLocked: spendDown })
  }
  const detail = `Damage ${actorLoopConfig.weapon.basicDamage}${spendDown ? ` · Spend 1 Down M · ${incomingDetail}` : ''}${atCost === 0 ? ' · AT0 charge consumed' : ''}`
  appendLog(state, 'Basic Attack', atCost, beforeSpatial, beforeThermal, detail)
  return {
    id: 'basic-attack',
    label: 'Basic Attack',
    valid: true,
    reason: '',
    atCost,
    summary: `${atCost} AT · ${spendDown ? 'Spend 1 Down M → Incoming M1' : 'Damage only'} · Player ${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} → ${axisLabel(spatialFor(state, 'player').axis)} M${spatialFor(state, 'player').level}`,
    path: [],
    result: state,
  }
}

export function holdGroundPlan(input: ActorLoopState, settings: ActorLoopSettings): ActionPlan {
  const state = clone(input)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  const detail = resolveAt(state, actorLoopConfig.actions.holdGroundAt, downAxis(), settings).join(' · ')
  appendLog(state, 'Hold Ground', actorLoopConfig.actions.holdGroundAt, beforeSpatial, beforeThermal, detail)
  return {
    id: 'hold-ground',
    label: 'Hold Ground',
    valid: true,
    reason: '',
    atCost: actorLoopConfig.actions.holdGroundAt,
    summary: `Grounded-compatible · ${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} → ${axisLabel(spatialFor(state, 'player').axis)} M${spatialFor(state, 'player').level}`,
    path: [],
    result: state,
  }
}

export function launchPlan(input: ActorLoopState, direction: HexDirection, settings: ActorLoopSettings): ActionPlan {
  const state = clone(input)
  const player = getPlayer(state.game)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  if (beforeSpatial.axis?.kind !== 'down' || beforeSpatial.level < settings.launchBrakeMinM) {
    return invalidPlan(input, 'launch', 'Launch', `Requires Down M${settings.launchBrakeMinM}+`)
  }
  const destination = hexAdvance(player.position, direction)
  if (!traversable(state.game, destination, 'player')) return invalidPlan(input, 'launch', 'Launch', 'Landing cell is blocked')
  const nextM = clampMomentum(beforeSpatial.level - actorLoopConfig.conversion.momentumLoss)
  setSpatial(state, 'player', createSpatialState(nextM, horizontalAxis(direction)))
  player.position = destination
  state.thermal.drift += actorLoopConfig.conversion.hotwardDriftInput
  const build = resolveAt(state, actorLoopConfig.actions.launchAt, horizontalAxis(direction), settings, { conversion: true })
  appendLog(state, 'Launch', actorLoopConfig.actions.launchAt, beforeSpatial, beforeThermal, `Down M${beforeSpatial.level} → ${axisLabel(horizontalAxis(direction))} M${nextM} · Move1 · Drift +${actorLoopConfig.conversion.hotwardDriftInput} · ${build.join(' · ')}`)
  return {
    id: 'launch', label: 'Launch', valid: true, reason: '', atCost: actorLoopConfig.actions.launchAt,
    summary: `Down M${beforeSpatial.level} → ${axisLabel(spatialFor(state, 'player').axis)} M${spatialFor(state, 'player').level} · Move1`,
    path: [{ ...destination }], result: state,
  }
}

export function brakePlan(input: ActorLoopState, settings: ActorLoopSettings): ActionPlan {
  const state = clone(input)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  if (beforeSpatial.axis?.kind !== 'horizontal' || beforeSpatial.level < settings.launchBrakeMinM) {
    return invalidPlan(input, 'brake', 'Brake', `Requires Horizontal M${settings.launchBrakeMinM}+`)
  }
  const nextM = clampMomentum(beforeSpatial.level - actorLoopConfig.conversion.momentumLoss)
  setSpatial(state, 'player', createSpatialState(nextM, downAxis()))
  state.thermal.drift += actorLoopConfig.conversion.hotwardDriftInput
  const build = resolveAt(state, actorLoopConfig.actions.brakeAt, downAxis(), settings, { conversion: true })
  appendLog(state, 'Brake', actorLoopConfig.actions.brakeAt, beforeSpatial, beforeThermal, `${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} → Down M${nextM} · Drift +${actorLoopConfig.conversion.hotwardDriftInput} · ${build.join(' · ')}`)
  return {
    id: 'brake', label: 'Brake', valid: true, reason: '', atCost: actorLoopConfig.actions.brakeAt,
    summary: `${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} → ${axisLabel(spatialFor(state, 'player').axis)} M${spatialFor(state, 'player').level}`,
    path: [], result: state,
  }
}

export function drivePlan(input: ActorLoopState, direction: HexDirection, settings: ActorLoopSettings): ActionPlan {
  const state = clone(input)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  const desired = horizontalAxis(direction)
  if (beforeSpatial.level > 0 && beforeSpatial.axis && !axisEquals(beforeSpatial.axis, desired)) {
    return invalidPlan(input, 'drive', 'Drive', `Existing ${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} blocks committed ${direction}`)
  }
  if (beforeSpatial.level === 0) setSpatial(state, 'player', createSpatialState(0, desired))
  const path: Coord[] = []
  const details: string[] = []
  for (let phase = 0; phase < actorLoopConfig.actions.drivePhaseCount; phase += 1) {
    let spent = false
    const current = spatialFor(state, 'player')
    if (!settings.drivePreservesMomentum && current.level > 0 && axisEquals(current.axis, desired)) {
      spendOne(state, 'player')
      spent = true
      details.push(`Phase ${phase + 1}: Preserve OFF → Spend 1M`)
    }
    const movement = movePath(state.game, 'player', direction, actorLoopConfig.actions.drivePhaseDistances[phase] ?? 1)
    path.push(...movement.path)
    if (movement.blocked) details.push(`Phase ${phase + 1}: traversal blocked after ${movement.moved}`)
    const build = resolveAt(state, actorLoopConfig.actions.drivePhaseAt, desired, settings, {
      spentLocked: spent,
      resetContinuity: phase > 0 && !settings.driveContinuousTraversal,
    })
    details.push(`Phase ${phase + 1}: Move${movement.moved} · ${build.join(' · ')}`)
    if (movement.blocked) break
  }
  const atCost = details.filter((line) => line.startsWith('Phase ') && line.includes('Move')).length * actorLoopConfig.actions.drivePhaseAt
  appendLog(state, 'Drive', atCost, beforeSpatial, beforeThermal, details.join(' · '))
  return {
    id: 'drive', label: 'Drive', valid: true, reason: '', atCost,
    summary: `Committed ${direction} · ${settings.drivePreservesMomentum ? 'Preserve ON' : 'Preserve OFF'} · ${settings.driveContinuousTraversal ? 'Continuous' : 'Reset continuity'} · ${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} → ${axisLabel(spatialFor(state, 'player').axis)} M${spatialFor(state, 'player').level}`,
    path, result: state,
  }
}

function applyThermalRelease(state: ActorLoopState, mode: ThermalReleaseMode) {
  if (mode === 'direct' || mode === 'mixed') {
    state.thermal.temperature = clamp(
      state.thermal.temperature + actorLoopConfig.release.directTemperatureDelta,
      actorLoopConfig.thermal.temperatureMin,
      actorLoopConfig.thermal.temperatureMax,
    )
  }
  if (mode === 'drift' || mode === 'mixed') state.thermal.drift += actorLoopConfig.release.driftDelta
  getPlayer(state.game).bodyTemperature = state.thermal.temperature
}

export function raikiriPlan(input: ActorLoopState, settings: ActorLoopSettings): ActionPlan {
  const state = clone(input)
  const player = getPlayer(state.game)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  if (state.thermal.temperature < actorLoopConfig.release.raikiri.temperatureThreshold) {
    return invalidPlan(input, 'raikiri', 'Raikiri', `Requires T >= ${actorLoopConfig.release.raikiri.temperatureThreshold}`)
  }
  if (beforeSpatial.axis?.kind !== 'horizontal' || beforeSpatial.level < actorLoopConfig.release.raikiri.momentumThreshold) {
    return invalidPlan(input, 'raikiri', 'Raikiri', `Requires Horizontal M${actorLoopConfig.release.raikiri.momentumThreshold}+`)
  }
  const direction = beforeSpatial.axis.dir
  const path: Coord[] = []
  let target: Actor | undefined
  for (let step = 0; step < actorLoopConfig.release.raikiri.range; step += 1) {
    const next = hexAdvance(player.position, direction)
    const occupant = actorAt(state.game, next)
    if (occupant && occupant.id !== 'player') {
      target = occupant
      break
    }
    if (!traversable(state.game, next, 'player')) break
    player.position = next
    path.push({ ...next })
  }
  if (target) target.hp = Math.max(1, target.hp - actorLoopConfig.release.raikiri.damage)
  if (actorLoopConfig.release.raikiri.releaseAllHorizontalMomentum) setSpatial(state, 'player', createSpatialState())
  applyThermalRelease(state, settings.thermalReleaseMode)
  const build = resolveAt(state, actorLoopConfig.actions.raikiriAt, horizontalAxis(direction), settings)
  if (settings.at0Enabled && actorLoopConfig.release.raikiri.grantAt0Window) {
    state.at0.windowUntilAt = state.worldTimeAt + actorLoopConfig.at0.postRaikiriWindowAt
    state.at0.weaponUsedAt = null
  }
  appendLog(state, 'Raikiri', actorLoopConfig.actions.raikiriAt, beforeSpatial, beforeThermal, `Traverse ${path.length} · ${target ? `Impact ${target.name} / Damage ${actorLoopConfig.release.raikiri.damage}` : 'No target impact'} · Release Horizontal M · Thermal ${settings.thermalReleaseMode} · ${build.join(' · ')}${state.at0.windowUntilAt ? ` · AT0 window until ${state.at0.windowUntilAt.toFixed(1)}` : ''}`)
  return {
    id: 'raikiri', label: 'Raikiri', valid: true, reason: '', atCost: actorLoopConfig.actions.raikiriAt,
    summary: `Release ${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} + Thermal(${settings.thermalReleaseMode})${target ? ` · Impact ${target.name}` : ''}`,
    path, result: state,
  }
}

export function groundBreakPlan(input: ActorLoopState, settings: ActorLoopSettings): ActionPlan {
  let state = clone(input)
  const player = getPlayer(state.game)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  if (beforeSpatial.axis?.kind !== 'down' || beforeSpatial.level < actorLoopConfig.release.groundBreak.momentumThreshold) {
    return invalidPlan(input, 'ground-break', 'Ground Break', `Requires Down M${actorLoopConfig.release.groundBreak.momentumThreshold}+`)
  }
  if (actorLoopConfig.release.groundBreak.releaseAllDownMomentum) setSpatial(state, 'player', createSpatialState())
  const impacted: string[] = []
  for (const actor of state.game.actors.filter((candidate) => candidate.alive && candidate.id !== 'player')) {
    const distance = hexDistance(player.position, actor.position)
    if (distance < 1 || distance > actorLoopConfig.release.groundBreak.radius) continue
    actor.hp = Math.max(1, actor.hp - actorLoopConfig.release.groundBreak.damage)
    const strength = distance === 1
      ? actorLoopConfig.release.groundBreak.ring1IncomingM
      : actorLoopConfig.release.groundBreak.ring2IncomingM
    const direction = outwardDirection(player.position, actor.position)
    const incoming = applyIncomingMomentum(state, actor.id, direction, strength)
    state = incoming.state
    impacted.push(`${actor.name}: R${distance} / Incoming M${strength} / Move${incoming.moved}`)
  }
  applyThermalRelease(state, settings.thermalReleaseMode)
  const build = resolveAt(state, actorLoopConfig.actions.groundBreakAt, downAxis(), settings)
  appendLog(state, 'Ground Break', actorLoopConfig.actions.groundBreakAt, beforeSpatial, beforeThermal, `Release Down M${beforeSpatial.level} · ${impacted.join(' · ') || 'No Actor in R2'} · Thermal ${settings.thermalReleaseMode} · ${build.join(' · ')}`)
  return {
    id: 'ground-break', label: 'Ground Break', valid: true, reason: '', atCost: actorLoopConfig.actions.groundBreakAt,
    summary: `R2 Release Down M${beforeSpatial.level} · ${impacted.length} Actor(s) · Thermal(${settings.thermalReleaseMode})`,
    path: [], result: state,
  }
}

export function injectIncomingPlan(input: ActorLoopState, actorId: string, direction: HexDirection, strength: MomentumLevel): ActionPlan {
  const beforeSpatial = clone(spatialFor(input, 'player'))
  const beforeThermal = clone(input.thermal)
  const incoming = applyIncomingMomentum(input, actorId, direction, strength)
  const state = incoming.state
  appendLog(state, `Debug Incoming → ${actorId}`, 0, beforeSpatial, beforeThermal, incoming.detail)
  return {
    id: 'inject-incoming', label: 'Inject Incoming', valid: true, reason: '', atCost: 0,
    summary: incoming.detail,
    path: [], result: state,
  }
}

export function stepWorldPlan(input: ActorLoopState, settings: ActorLoopSettings): ActionPlan {
  const state = clone(input)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  const detail = resolveAt(state, 1, null, settings).join(' · ')
  appendLog(state, 'Wait / Timeline +1 AT', 1, beforeSpatial, beforeThermal, detail)
  return { id: 'wait', label: 'Wait', valid: true, reason: '', atCost: 1, summary: 'World +1 AT · no Momentum Build', path: [], result: state }
}

function invalidPlan(input: ActorLoopState, id: string, label: string, reason: string): ActionPlan {
  return { id, label, valid: false, reason, atCost: 0, summary: reason, path: [], result: clone(input) }
}

export function setThermalDebug(input: ActorLoopState, patch: Partial<ThermalInertiaState>) {
  const state = clone(input)
  state.thermal = {
    temperature: clamp(patch.temperature ?? state.thermal.temperature, actorLoopConfig.thermal.temperatureMin, actorLoopConfig.thermal.temperatureMax),
    drift: patch.drift ?? state.thermal.drift,
    setPoint: clamp(patch.setPoint ?? state.thermal.setPoint, actorLoopConfig.thermal.setPointMin, actorLoopConfig.thermal.setPointMax),
  }
  getPlayer(state.game).bodyTemperature = state.thermal.temperature
  return state
}

export function setSpatialDebug(input: ActorLoopState, actorId: string, spatial: SpatialInertiaState) {
  const state = clone(input)
  setSpatial(state, actorId, spatial)
  clearContinuity(state, actorId)
  return state
}

export function setSelectedActor(input: ActorLoopState, actorId: string) {
  const state = clone(input)
  if (state.game.actors.some((actor) => actor.id === actorId)) state.selectedActorId = actorId
  return state
}

export type ActorLoopPreset = 'neutral' | 'hot-horizontal' | 'cold-down' | 'incoming' | 'release'

export function applyPreset(input: ActorLoopState, preset: ActorLoopPreset) {
  let state = createActorLoopState()
  if (preset === 'hot-horizontal') {
    state = setThermalDebug(state, { temperature: 4, drift: 0, setPoint: 1 })
    state = setSpatialDebug(state, 'player', createSpatialState(2, horizontalAxis('E')))
  } else if (preset === 'cold-down') {
    state = setThermalDebug(state, { temperature: -4, drift: 0, setPoint: 1 })
    state = setSpatialDebug(state, 'player', createSpatialState(2, downAxis()))
  } else if (preset === 'incoming') {
    state = setSpatialDebug(state, 'player', createSpatialState(1, downAxis()))
  } else if (preset === 'release') {
    state = setThermalDebug(state, { temperature: 4, drift: 0, setPoint: 1 })
    state = setSpatialDebug(state, 'player', createSpatialState(3, horizontalAxis('E')))
  }
  state.logs.unshift({
    id: 0,
    timeAt: 0,
    action: `Preset · ${preset}`,
    atCost: 0,
    beforeSpatial: createSpatialState(),
    afterSpatial: clone(spatialFor(state, 'player')),
    beforeThermal: { temperature: 1, drift: 0, setPoint: 1 },
    afterThermal: clone(state.thermal),
    detail: 'Debug preset; not a gameplay action.',
  })
  return state
}

function configurePlaygroundGame(): GameState {
  const game = createHexRoomState(4)
  const center = { x: 4, y: 4 }
  for (const cell of game.cells) {
    if (cell.tags.includes('Void')) continue
    cell.tags = cell.tags.filter((tag) => !['Blocked', 'Mountain', 'Ridge', 'Peak', 'UT3Hard', 'UT3ReflectLeft', 'UT3ReflectRight', 'UT4Hard', 'UT4ReflectLeft', 'UT4ReflectRight', 'UT5Hard', 'UT5ReflectLeft', 'UT5ReflectRight'].includes(tag))
    cell.groundTemp = 0
    cell.skyTemp = 0
    cell.skyFill = 'clear'
    cell.intents = []
  }

  const player = getPlayer(game)
  player.position = center
  player.name = 'Player'
  player.hp = player.maxHp = 12
  player.bodyTemperature = 1
  player.intent = 'Actor Loop manual control'

  const dummies = game.actors.filter((actor) => actor.id !== 'player')
  const placements: Array<{ dir: HexDirection; distance: number }> = [
    { dir: 'E', distance: 2 },
    { dir: 'NE', distance: 1 },
    { dir: 'SE', distance: 2 },
  ]
  dummies.slice(0, 3).forEach((actor, index) => {
    actor.name = `Dummy ${String.fromCharCode(65 + index)}`
    actor.faction = 'enemy'
    actor.position = hexAdvance(center, placements[index].dir, placements[index].distance)
    actor.hp = actor.maxHp = 99
    actor.shield = 0
    actor.alive = true
    actor.intent = 'AI OFF · Actor Loop fixture'
  })
  const extra = clone(dummies[0])
  extra.id = 'dummy-d'
  extra.name = 'Dummy D'
  extra.position = hexAdvance(center, 'W', 1)
  extra.hp = extra.maxHp = 99
  extra.alive = true
  game.actors = [player, ...dummies.slice(0, 3), extra]
  game.phase = 'player'
  game.phaseQueue = []
  game.ap = 0
  game.reservedAP = 0
  game.logs = ['[UT6] Actor Loop Playground · AI OFF']
  game.status = 'active'
  return game
}

export function createActorLoopState(): ActorLoopState {
  const game = configurePlaygroundGame()
  const spatialByActorId = Object.fromEntries(game.actors.map((actor) => [actor.id, createSpatialState()]))
  const continuityByActorId = Object.fromEntries(game.actors.map((actor) => [actor.id, { axis: null, streak: 0 }]))
  return {
    game,
    worldTimeAt: 0,
    thermal: { temperature: 1, drift: 0, setPoint: 1 },
    spatialByActorId,
    continuityByActorId,
    selectedActorId: 'player',
    at0: { windowUntilAt: null, weaponUsedAt: null },
    logs: [],
    logSequence: 0,
  }
}
