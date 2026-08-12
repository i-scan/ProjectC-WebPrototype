import experimentConfigJson from '../../config/experiments/val-012-axis-inertia-lab.v5.json'
import {
  actorAt,
  cellAt,
  getPlayer,
  type Actor,
  type Coord,
  type GameState,
  type Mass,
} from '../game'
import { createHexRoomState } from './hexRoom'
import {
  HEX_DIRECTIONS,
  hexAdvance,
  hexDirectionBetween,
  hexDirectionOnLine,
  hexDistance,
  type HexDirection,
} from './hexTopology'

export type MomentumLevel = 0 | 1 | 2 | 3
export type HitType = 'normal' | 'push' | 'heavy'
export type WeaponProfile = 'spear' | 'hammer'
export type SurfaceRule = 'hard' | 'reflect-left' | 'reflect-right'
export type SpatialAxis =
  | { kind: 'horizontal'; dir: HexDirection }
  | { kind: 'down'; dir?: never }
  | { kind: 'up'; dir?: never }

export type ThermalInertiaState = {
  temperature: number
  drift: number
  setPoint: number
}

export type SpatialInertiaState = {
  level: MomentumLevel
  axis: SpatialAxis | null
  pendingLevel: MomentumLevel
  pendingAxis: SpatialAxis | null
  chainOpen: boolean
}

export type ReactionSettings = {
  reactionSidestep: boolean
  failedOccupancyFallback: boolean
  minSidestepM: MomentumLevel
  sidestepCostM: MomentumLevel
  minFallbackM: MomentumLevel
  fallbackCostM: MomentumLevel
}

type DriveContinuation = {
  kind: 'drive'
  direction: HexDirection
  remainingPhases: number
}

export type PendingReaction = {
  kind: 'sidestep' | 'fallback'
  actorId: string
  legalCoords: Coord[]
  costM: MomentumLevel
  axisSnapshot: SpatialAxis
  resolveThermalAt: number
  sourceLabel: string
  continuation?: DriveContinuation
}

export type LabEventLogEntry = {
  id: number
  timeAt: number
  label: string
  thermalBefore: ThermalInertiaState
  thermalAfter: ThermalInertiaState
  spatialBefore: SpatialInertiaState
  spatialAfter: SpatialInertiaState
  detail: string
}

export type QueuedDummyMove = {
  actorId: string
  direction: HexDirection
  executeAt: number
}

export type CoupledInertiaLabState = {
  game: GameState
  worldTimeAt: number
  thermal: ThermalInertiaState
  spatialByActorId: Record<string, SpatialInertiaState>
  selectedActorId: string
  weapon: WeaponProfile
  reactionSettings: ReactionSettings
  pendingReaction?: PendingReaction
  queuedDummyMove?: QueuedDummyMove
  logs: LabEventLogEntry[]
  logSequence: number
}

export type ThermalTrace = {
  state: ThermalInertiaState
  minimumTemperature: number
  maximumTemperature: number
  settled: boolean
}

export type SpatialBuildTracker = {
  hadHorizontalMove: boolean
  movedAlongCurrentAxis: boolean
  remainedGrounded: boolean
}

type InertiaExperimentConfig = {
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
  spatial: {
    maxLevel: number
    momentumExchangeCap: number
    steeringCost60: number
    steeringCost120: number
    downStabilityDistanceReduction: number
    contestPushDistancePlus1: number
    contestPushDistancePlus2: number
    driveIntroExchangeCap: number
    driveStartMomentum: number
    minReactionSidestepM: number
    reactionSidestepCostM: number
    minFallbackM: number
    fallbackCostM: number
  }
  thermalInputs: {
    normalHitHotwardDrift: number
    pushHitHotwardDrift: number
    heavyHitHotwardDrift: number
    forcedMotionExtraHotwardDrift: number
    heavyReleaseSelfHotwardDrift: number
  }
  actions: {
    basicMoveAt: number
    defaultWeaponAt: number
    holdPositionAt: number
    drivePhaseAt: number
    drivePhaseCount: number
    heavyReleaseAt: number
    brakeAt: number
  }
  heavyRelease: {
    damage: number
    pushDistanceM1: number
    pushDistanceM2: number
    launchDistanceM3: number
    consumeAllDownMomentum: boolean
  }
  hits: Record<HitType, { damage: number; forcedStrength: number }>
}

export const axisInertiaExperimentConfig = experimentConfigJson as InertiaExperimentConfig

export type RuntimeTuning = {
  damping: number
  thermalPeriodAt: number
  ambientThermalBias: number
  hitHotwardDrift: Record<HitType, number>
  forcedMotionExtraHotwardDrift: number
  heavyReleaseSelfHotwardDrift: number
  momentumExchangeCap: number
  steeringCost60: number
  steeringCost120: number
  driveIntroExchangeCap: number
  driveStartMomentum: MomentumLevel
}

export function defaultRuntimeTuning(): RuntimeTuning {
  return {
    damping: axisInertiaExperimentConfig.thermal.damping,
    thermalPeriodAt: axisInertiaExperimentConfig.thermal.thermalPeriodAt,
    ambientThermalBias: axisInertiaExperimentConfig.thermal.ambientThermalBias,
    hitHotwardDrift: {
      normal: axisInertiaExperimentConfig.thermalInputs.normalHitHotwardDrift,
      push: axisInertiaExperimentConfig.thermalInputs.pushHitHotwardDrift,
      heavy: axisInertiaExperimentConfig.thermalInputs.heavyHitHotwardDrift,
    },
    forcedMotionExtraHotwardDrift: axisInertiaExperimentConfig.thermalInputs.forcedMotionExtraHotwardDrift,
    heavyReleaseSelfHotwardDrift: axisInertiaExperimentConfig.thermalInputs.heavyReleaseSelfHotwardDrift,
    momentumExchangeCap: axisInertiaExperimentConfig.spatial.momentumExchangeCap,
    steeringCost60: axisInertiaExperimentConfig.spatial.steeringCost60,
    steeringCost120: axisInertiaExperimentConfig.spatial.steeringCost120,
    driveIntroExchangeCap: axisInertiaExperimentConfig.spatial.driveIntroExchangeCap,
    driveStartMomentum: clampMomentum(axisInertiaExperimentConfig.spatial.driveStartMomentum),
  }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const sameCoord = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y

function clone<T>(value: T): T {
  return structuredClone(value)
}

export function clampMomentum(value: number): MomentumLevel {
  return clamp(Math.round(value), 0, axisInertiaExperimentConfig.spatial.maxLevel) as MomentumLevel
}

export function horizontalAxis(direction: HexDirection): SpatialAxis {
  return { kind: 'horizontal', dir: direction }
}

export function downAxis(): SpatialAxis {
  return { kind: 'down' }
}

export function axisEquals(left: SpatialAxis | null, right: SpatialAxis | null): boolean {
  if (!left || !right) return left === right
  if (left.kind !== right.kind) return false
  if (left.kind === 'horizontal' && right.kind === 'horizontal') return left.dir === right.dir
  return true
}

export function axisLabel(axis: SpatialAxis | null): string {
  if (!axis) return 'None'
  if (axis.kind === 'horizontal') return axis.dir
  if (axis.kind === 'down') return 'Down'
  return 'Up'
}

export function createSpatialInertiaState(overrides: Partial<SpatialInertiaState> = {}): SpatialInertiaState {
  const next: SpatialInertiaState = {
    level: 0,
    axis: null,
    pendingLevel: 0,
    pendingAxis: null,
    chainOpen: false,
    ...overrides,
  }
  next.level = clampMomentum(next.level)
  if (next.level === 0) next.axis = null
  if (next.level > 0 && !next.axis) next.axis = downAxis()
  next.pendingLevel = clampMomentum(next.pendingLevel)
  if (next.pendingLevel === 0) next.pendingAxis = null
  return next
}

export function thermalDomainFor(temperature: number): 'cold' | 'neutral' | 'hot' {
  if (temperature <= axisInertiaExperimentConfig.thermal.coldDomainThreshold) return 'cold'
  if (temperature >= axisInertiaExperimentConfig.thermal.hotDomainThreshold) return 'hot'
  return 'neutral'
}

export function advanceThermalInertia(
  input: ThermalInertiaState,
  deltaAt: number,
  tuning: RuntimeTuning,
): ThermalTrace {
  const duration = Math.max(0, deltaAt)
  let next = clone(input)
  let minimumTemperature = next.temperature
  let maximumTemperature = next.temperature
  if (duration <= 0) return { state: next, minimumTemperature, maximumTemperature, settled: false }

  const period = Math.max(0.25, tuning.thermalPeriodAt)
  const omega = Math.PI * 2 / period
  const configuredSubsteps = Math.max(4, axisInertiaExperimentConfig.thermal.integrationSubstepsPerAt)
  const substeps = Math.max(1, Math.ceil(duration * configuredSubsteps))
  const dt = duration / substeps

  for (let index = 0; index < substeps; index += 1) {
    const offset = next.temperature - next.setPoint
    const acceleration = -omega * omega * offset - Math.max(0, tuning.damping) * next.drift + tuning.ambientThermalBias
    next.drift += acceleration * dt
    next.temperature += next.drift * dt
    next.temperature = clamp(
      next.temperature,
      axisInertiaExperimentConfig.thermal.temperatureMin,
      axisInertiaExperimentConfig.thermal.temperatureMax,
    )
    minimumTemperature = Math.min(minimumTemperature, next.temperature)
    maximumTemperature = Math.max(maximumTemperature, next.temperature)
  }

  const settled = Math.abs(next.temperature - next.setPoint) <= axisInertiaExperimentConfig.thermal.settleTemperatureEpsilon
    && Math.abs(next.drift) <= axisInertiaExperimentConfig.thermal.settleDriftEpsilon
  if (settled) {
    next.temperature = next.setPoint
    next.drift = 0
  }
  return { state: next, minimumTemperature, maximumTemperature, settled }
}

function actorSpatial(state: CoupledInertiaLabState, actorId: string): SpatialInertiaState {
  return state.spatialByActorId[actorId] ?? createSpatialInertiaState()
}

function setActorSpatial(state: CoupledInertiaLabState, actorId: string, spatial: SpatialInertiaState) {
  state.spatialByActorId[actorId] = createSpatialInertiaState(spatial)
}

export type MomentumExchangeResult = {
  state: SpatialInertiaState
  exchanged: MomentumLevel
  remainingIncoming: MomentumLevel
  axisChanged: boolean
}

export function resolveMomentumInteraction(
  currentInput: SpatialInertiaState,
  incomingAxis: SpatialAxis,
  incomingAmountInput: number,
  exchangeCapInput: number,
): MomentumExchangeResult {
  const current = createSpatialInertiaState(currentInput)
  let incomingAmount = clampMomentum(incomingAmountInput)
  const exchangeCap = Math.max(0, Math.floor(exchangeCapInput))
  const beforeAxis = clone(current.axis)

  if (incomingAmount <= 0) {
    return { state: current, exchanged: 0, remainingIncoming: 0, axisChanged: false }
  }

  if (current.level <= 0 || !current.axis) {
    const state = createSpatialInertiaState({ level: incomingAmount, axis: clone(incomingAxis) })
    return { state, exchanged: 0, remainingIncoming: 0, axisChanged: true }
  }

  if (axisEquals(current.axis, incomingAxis)) {
    const state = createSpatialInertiaState({
      ...current,
      level: clampMomentum(current.level + incomingAmount),
    })
    return { state, exchanged: 0, remainingIncoming: 0, axisChanged: false }
  }

  const exchanged = clampMomentum(Math.min(current.level, incomingAmount, exchangeCap))
  current.level = clampMomentum(current.level - exchanged)
  incomingAmount = clampMomentum(incomingAmount - exchanged)

  if (current.level > 0) {
    return {
      state: createSpatialInertiaState(current),
      exchanged,
      remainingIncoming: incomingAmount,
      axisChanged: false,
    }
  }

  if (incomingAmount > 0) {
    const state = createSpatialInertiaState({ level: incomingAmount, axis: clone(incomingAxis) })
    return { state, exchanged, remainingIncoming: 0, axisChanged: !axisEquals(beforeAxis, state.axis) }
  }

  return {
    state: createSpatialInertiaState(),
    exchanged,
    remainingIncoming: 0,
    axisChanged: Boolean(beforeAxis),
  }
}

function appendLog(
  state: CoupledInertiaLabState,
  label: string,
  thermalBefore: ThermalInertiaState,
  spatialBefore: SpatialInertiaState,
  detail: string,
) {
  state.logSequence += 1
  state.logs.unshift({
    id: state.logSequence,
    timeAt: state.worldTimeAt,
    label,
    thermalBefore,
    thermalAfter: clone(state.thermal),
    spatialBefore,
    spatialAfter: clone(actorSpatial(state, 'player')),
    detail,
  })
  state.logs = state.logs.slice(0, 60)
}

function massPower(mass: Mass): number {
  if (mass === 'heavy') return 3
  if (mass === 'light') return 1
  return 2
}

function rotateDirection(direction: HexDirection, delta: number): HexDirection {
  const index = HEX_DIRECTIONS.findIndex((entry) => entry.direction === direction)
  return HEX_DIRECTIONS[(index + delta + 60) % 6].direction
}

export function oppositeDirection(direction: HexDirection): HexDirection {
  return rotateDirection(direction, 3)
}

export function directionTurnSteps(from: HexDirection, to: HexDirection): 0 | 1 | 2 | 3 {
  const fromIndex = HEX_DIRECTIONS.findIndex((entry) => entry.direction === from)
  const toIndex = HEX_DIRECTIONS.findIndex((entry) => entry.direction === to)
  const raw = Math.abs(fromIndex - toIndex)
  return Math.min(raw, 6 - raw) as 0 | 1 | 2 | 3
}

export function steeringCost(from: SpatialAxis | null, to: HexDirection, tuning: RuntimeTuning): number {
  if (!from || from.kind !== 'horizontal') return 0
  const steps = directionTurnSteps(from.dir, to)
  if (steps === 1) return tuning.steeringCost60
  if (steps === 2) return tuning.steeringCost120
  if (steps === 3) return 99
  return 0
}

function surfaceAt(game: GameState, coord: Coord): SurfaceRule | undefined {
  const tags = cellAt(game, coord)?.tags ?? []
  if (tags.includes('UT5Hard') || tags.includes('UT4Hard')) return 'hard'
  if (tags.includes('UT5ReflectLeft') || tags.includes('UT4ReflectLeft')) return 'reflect-left'
  if (tags.includes('UT5ReflectRight') || tags.includes('UT4ReflectRight')) return 'reflect-right'
  return undefined
}

function traversable(game: GameState, coord: Coord, movingActorId?: string): boolean {
  const cell = cellAt(game, coord)
  if (!cell || cell.tags.includes('Void') || cell.tags.includes('Blocked') || cell.tags.includes('Mountain')) return false
  const occupant = actorAt(game, coord)
  return !occupant || occupant.id === movingActorId
}

function sideCoords(game: GameState, actor: Actor, axis: SpatialAxis): Coord[] {
  if (axis.kind !== 'horizontal') return []
  const left = hexAdvance(actor.position, rotateDirection(axis.dir, -1))
  const right = hexAdvance(actor.position, rotateDirection(axis.dir, 1))
  return [left, right].filter((coord) => traversable(game, coord, actor.id))
}

function setHorizontalAxisPreservingMomentum(state: CoupledInertiaLabState, actorId: string, direction: HexDirection) {
  const current = actorSpatial(state, actorId)
  if (current.level <= 0) return
  setActorSpatial(state, actorId, { ...current, axis: horizontalAxis(direction) })
}

function forcedPositionMove(
  state: CoupledInertiaLabState,
  actorId: string,
  directionInput: HexDirection,
  distance: number,
): { moved: number; detail: string; finalDirection: HexDirection } {
  const actor = state.game.actors.find((candidate) => candidate.id === actorId && candidate.alive)
  if (!actor || distance <= 0) return { moved: 0, detail: 'No forced position change', finalDirection: directionInput }
  let direction = directionInput
  let moved = 0
  let detail = ''
  let secondaryImpactCount = 0

  for (let step = 0; step < distance; step += 1) {
    let nextCoord = hexAdvance(actor.position, direction)
    const surface = surfaceAt(state.game, nextCoord)
    if (surface === 'hard') {
      detail = `Crash at Hard surface after ${moved} cell(s)`
      break
    }
    if (surface === 'reflect-left' || surface === 'reflect-right') {
      direction = rotateDirection(direction, surface === 'reflect-left' ? -1 : 1)
      setHorizontalAxisPreservingMomentum(state, actorId, direction)
      nextCoord = hexAdvance(actor.position, direction)
      detail = `Surface reorient ${surface}`
    }

    const secondary = actorAt(state.game, nextCoord)
    if (secondary && secondary.id !== actor.id) {
      if (secondaryImpactCount >= 1) {
        detail = 'Secondary conflict limit reached'
        break
      }
      secondaryImpactCount += 1
      const landing = hexAdvance(secondary.position, direction)
      if (traversable(state.game, landing, secondary.id)) {
        secondary.position = landing
        detail = `Secondary conflict pushed ${secondary.name}`
      } else {
        detail = `Secondary conflict blocked by ${secondary.name}`
      }
      break
    }
    if (!traversable(state.game, nextCoord, actor.id)) {
      detail = `Crash after ${moved} cell(s)`
      break
    }
    actor.position = nextCoord
    moved += 1
  }

  return { moved, detail: detail || `Forced position ${moved} cell(s)`, finalDirection: direction }
}

function applyDomainFreeBuild(
  state: CoupledInertiaLabState,
  trace: ThermalTrace,
  tracker: SpatialBuildTracker,
  tuning: RuntimeTuning,
): string {
  const current = actorSpatial(state, 'player')
  if (
    trace.maximumTemperature <= axisInertiaExperimentConfig.thermal.coldDomainThreshold
    && !tracker.hadHorizontalMove
    && tracker.remainedGrounded
  ) {
    const result = resolveMomentumInteraction(current, downAxis(), 1, tuning.momentumExchangeCap)
    setActorSpatial(state, 'player', result.state)
    return `Cold free build → ${axisLabel(result.state.axis)} M${result.state.level}`
  }

  if (
    trace.minimumTemperature >= axisInertiaExperimentConfig.thermal.hotDomainThreshold
    && tracker.movedAlongCurrentAxis
    && current.axis?.kind === 'horizontal'
  ) {
    const result = resolveMomentumInteraction(current, current.axis, 1, tuning.momentumExchangeCap)
    setActorSpatial(state, 'player', result.state)
    return `Hot free build → ${axisLabel(result.state.axis)} M${result.state.level}`
  }
  return ''
}

function processQueuedDummyMove(state: CoupledInertiaLabState, tuning: RuntimeTuning): string {
  const queued = state.queuedDummyMove
  if (!queued || queued.executeAt > state.worldTimeAt) return ''
  state.queuedDummyMove = undefined
  const actor = state.game.actors.find((candidate) => candidate.id === queued.actorId && candidate.alive)
  if (!actor) return 'Queued Dummy Move cancelled: actor missing'
  const target = hexAdvance(actor.position, queued.direction)
  const occupant = actorAt(state.game, target)
  if (occupant && occupant.id !== actor.id) {
    const result = contestCell(state, actor.id, occupant.id, queued.direction, tuning, false)
    return `Queued Dummy Move: ${result.detail}`
  }
  if (!traversable(state.game, target, actor.id)) return 'Queued Dummy Move blocked'
  actor.position = target
  return `Queued Dummy Move: ${actor.name} → ${queued.direction}`
}

function advanceOneAt(
  state: CoupledInertiaLabState,
  tuning: RuntimeTuning,
  tracker: SpatialBuildTracker,
): { trace: ThermalTrace; buildDetail: string; queuedDetail: string } {
  const trace = advanceThermalInertia(state.thermal, 1, tuning)
  state.thermal = trace.state
  state.worldTimeAt += 1
  getPlayer(state.game).bodyTemperature = state.thermal.temperature
  const buildDetail = applyDomainFreeBuild(state, trace, tracker, tuning)
  const queuedDetail = processQueuedDummyMove(state, tuning)
  return { trace, buildDetail, queuedDetail }
}

function advanceActionAt(
  state: CoupledInertiaLabState,
  durationAt: number,
  tuning: RuntimeTuning,
  tracker: SpatialBuildTracker,
): string[] {
  const details: string[] = []
  const whole = Math.floor(Math.max(0, durationAt))
  for (let index = 0; index < whole; index += 1) {
    const result = advanceOneAt(state, tuning, tracker)
    if (result.buildDetail) details.push(result.buildDetail)
    if (result.queuedDetail) details.push(result.queuedDetail)
  }
  const remainder = Math.max(0, durationAt) - whole
  if (remainder > 0) {
    const trace = advanceThermalInertia(state.thermal, remainder, tuning)
    state.thermal = trace.state
    state.worldTimeAt += remainder
    getPlayer(state.game).bodyTemperature = state.thermal.temperature
  }
  return details
}

function damageActor(actor: Actor, amount: number) {
  if (amount <= 0 || !actor.alive) return
  actor.hp = Math.max(0, actor.hp - amount)
  actor.alive = actor.hp > 0
}

function effectiveHorizontalMomentum(spatial: SpatialInertiaState, direction: HexDirection): number {
  return spatial.axis?.kind === 'horizontal' && spatial.axis.dir === direction ? spatial.level : 0
}

function defensiveDownMomentum(spatial: SpatialInertiaState): number {
  return spatial.axis?.kind === 'down' ? spatial.level : 0
}

type ContestResult = {
  winner: 'attacker' | 'defender'
  detail: string
  reactionOpened: boolean
}

function openFallbackReaction(
  state: CoupledInertiaLabState,
  actorId: string,
  continuation?: DriveContinuation,
): boolean {
  const actor = state.game.actors.find((candidate) => candidate.id === actorId && candidate.alive)
  const spatial = actor ? actorSpatial(state, actorId) : undefined
  if (
    !actor
    || actorId !== 'player'
    || !state.reactionSettings.failedOccupancyFallback
    || !spatial?.axis
    || spatial.axis.kind !== 'horizontal'
    || spatial.level < state.reactionSettings.minFallbackM
  ) return false
  const legalCoords = sideCoords(state.game, actor, spatial.axis)
  if (legalCoords.length === 0) return false
  state.pendingReaction = {
    kind: 'fallback',
    actorId,
    legalCoords,
    costM: state.reactionSettings.fallbackCostM,
    axisSnapshot: clone(spatial.axis),
    resolveThermalAt: 0,
    sourceLabel: 'Failed Occupancy Fallback',
    continuation,
  }
  return true
}

function contestCell(
  state: CoupledInertiaLabState,
  attackerId: string,
  defenderId: string,
  direction: HexDirection,
  tuning: RuntimeTuning,
  allowFallback = true,
  continuation?: DriveContinuation,
): ContestResult {
  const attacker = state.game.actors.find((actor) => actor.id === attackerId)!
  const defender = state.game.actors.find((actor) => actor.id === defenderId)!
  const attackerSpatial = actorSpatial(state, attackerId)
  const defenderSpatial = actorSpatial(state, defenderId)
  const attackerM = effectiveHorizontalMomentum(attackerSpatial, direction)
  const defenderM = defensiveDownMomentum(defenderSpatial)
  const attackerPower = massPower(attacker.mass) + attackerM
  const defenderPower = massPower(defender.mass) + defenderM
  const difference = attackerPower - defenderPower

  if (difference <= 0) {
    const reactionOpened = allowFallback && openFallbackReaction(state, attackerId, continuation)
    return {
      winner: 'defender',
      reactionOpened,
      detail: `Cell Contest ${attackerPower} vs ${defenderPower}: Clash · Horizontal M${attackerM} / Down M${defenderM}${reactionOpened ? ' · Fallback choice' : ''}`,
    }
  }

  const defenderOrigin = { ...defender.position }
  const pushDistance = difference >= 2
    ? axisInertiaExperimentConfig.spatial.contestPushDistancePlus2
    : axisInertiaExperimentConfig.spatial.contestPushDistancePlus1
  const defenderExchange = resolveMomentumInteraction(
    defenderSpatial,
    horizontalAxis(direction),
    pushDistance,
    tuning.momentumExchangeCap,
  )
  setActorSpatial(state, defenderId, defenderExchange.state)
  const motion = forcedPositionMove(state, defenderId, direction, pushDistance)
  if (sameCoord(defender.position, defenderOrigin)) {
    return {
      winner: 'defender',
      reactionOpened: false,
      detail: `Cell Contest ${attackerPower} vs ${defenderPower}: defender 无法被推出 · Clash`,
    }
  }
  attacker.position = defenderOrigin
  return {
    winner: 'attacker',
    reactionOpened: false,
    detail: `Cell Contest ${attackerPower} vs ${defenderPower}: attacker 占格 · ${motion.detail}`,
  }
}

function maybeOpenSidestepReaction(
  state: CoupledInertiaLabState,
  resolveThermalAt: number,
  sourceLabel: string,
): boolean {
  const player = getPlayer(state.game)
  const spatial = actorSpatial(state, 'player')
  if (
    !state.reactionSettings.reactionSidestep
    || !spatial.axis
    || spatial.axis.kind !== 'horizontal'
    || spatial.level < state.reactionSettings.minSidestepM
  ) return false
  const legalCoords = sideCoords(state.game, player, spatial.axis)
  if (legalCoords.length === 0) return false
  state.pendingReaction = {
    kind: 'sidestep',
    actorId: 'player',
    legalCoords,
    costM: state.reactionSettings.sidestepCostM,
    axisSnapshot: clone(spatial.axis),
    resolveThermalAt,
    sourceLabel,
  }
  return true
}

function hitCore(
  input: CoupledInertiaLabState,
  hitType: HitType,
  incomingDirection: HexDirection,
  tuning: RuntimeTuning,
  resolveAt: number,
): CoupledInertiaLabState {
  const state = clone(input)
  if (state.pendingReaction) return state
  const player = getPlayer(state.game)
  const thermalBefore = clone(state.thermal)
  const spatialBefore = clone(actorSpatial(state, 'player'))
  const hit = axisInertiaExperimentConfig.hits[hitType]
  const forceDirection = oppositeDirection(incomingDirection)
  const forceAxis = horizontalAxis(forceDirection)

  const exchange = resolveMomentumInteraction(
    spatialBefore,
    forceAxis,
    hit.forcedStrength,
    tuning.momentumExchangeCap,
  )
  setActorSpatial(state, 'player', exchange.state)

  const downStability = spatialBefore.axis?.kind === 'down' && spatialBefore.level > 0
    ? axisInertiaExperimentConfig.spatial.downStabilityDistanceReduction
    : 0
  const forcedDistance = Math.max(0, hit.forcedStrength - downStability)
  const positionBefore = { ...player.position }
  const motion = forcedPositionMove(state, 'player', forceDirection, forcedDistance)
  const actualForcedMotion = !sameCoord(positionBefore, player.position)

  damageActor(player, hit.damage)
  const driftGain = tuning.hitHotwardDrift[hitType]
    + (actualForcedMotion ? tuning.forcedMotionExtraHotwardDrift : 0)
  state.thermal.drift += driftGain
  player.bodyTemperature = state.thermal.temperature

  const reactionOpened = player.alive && maybeOpenSidestepReaction(state, resolveAt, `Hit · ${hitType}`)
  const details = [
    `Spatial first: ${axisLabel(spatialBefore.axis)} M${spatialBefore.level} + incoming ${forceDirection} M${hit.forcedStrength}`,
    `exchange ${exchange.exchanged} → ${axisLabel(actorSpatial(state, 'player').axis)} M${actorSpatial(state, 'player').level}`,
    motion.detail,
    `Damage ${hit.damage}`,
    `Drift +${driftGain.toFixed(2)}`,
  ]

  if (resolveAt > 0 && !reactionOpened) {
    details.push(...advanceActionAt(state, resolveAt, tuning, {
      hadHorizontalMove: false,
      movedAlongCurrentAxis: false,
      remainedGrounded: true,
    }))
    details.push(`same-AT Thermal Evolution → T ${state.thermal.temperature.toFixed(2)}`)
  } else if (reactionOpened) {
    details.push(`Reaction Sidestep choice before ${resolveAt > 0 ? 'same-AT Thermal Evolution' : 'return to Ready'}`)
  }

  appendLog(
    state,
    resolveAt > 0 ? `Inject Hit + Resolve ${resolveAt} AT · ${hitType}` : `Inject Hit 0 AT · ${hitType}`,
    thermalBefore,
    spatialBefore,
    details.filter(Boolean).join(' · '),
  )
  return state
}

export function injectHit(
  input: CoupledInertiaLabState,
  hitType: HitType,
  incomingDirection: HexDirection,
  tuning: RuntimeTuning,
): CoupledInertiaLabState {
  return hitCore(input, hitType, incomingDirection, tuning, 0)
}

export function injectHitAndResolveAt(
  input: CoupledInertiaLabState,
  hitType: HitType,
  incomingDirection: HexDirection,
  tuning: RuntimeTuning,
): CoupledInertiaLabState {
  return hitCore(input, hitType, incomingDirection, tuning, 1)
}

export function stepWorld(
  input: CoupledInertiaLabState,
  deltaAt: number,
  tuning: RuntimeTuning,
  label = 'Step World',
): CoupledInertiaLabState {
  const state = clone(input)
  if (state.pendingReaction) return state
  const thermalBefore = clone(state.thermal)
  const spatialBefore = clone(actorSpatial(state, 'player'))
  const details = advanceActionAt(state, Math.max(0, deltaAt), tuning, {
    hadHorizontalMove: false,
    movedAlongCurrentAxis: false,
    remainedGrounded: true,
  })
  appendLog(
    state,
    label,
    thermalBefore,
    spatialBefore,
    `${deltaAt} AT · domain ${thermalDomainFor(state.thermal.temperature)}${details.length ? ` · ${details.join(' · ')}` : ''}`,
  )
  return state
}

export function holdPosition(input: CoupledInertiaLabState, tuning: RuntimeTuning): CoupledInertiaLabState {
  const state = clone(input)
  if (state.pendingReaction) return state
  const thermalBefore = clone(state.thermal)
  const spatialBefore = clone(actorSpatial(state, 'player'))
  const details = advanceActionAt(state, axisInertiaExperimentConfig.actions.holdPositionAt, tuning, {
    hadHorizontalMove: false,
    movedAlongCurrentAxis: false,
    remainedGrounded: true,
  })
  appendLog(state, 'Hold Position', thermalBefore, spatialBefore, details.length ? details.join(' · ') : 'Grounded 1 AT')
  return state
}

export function brake(input: CoupledInertiaLabState, tuning: RuntimeTuning): CoupledInertiaLabState {
  const state = clone(input)
  if (state.pendingReaction) return state
  const thermalBefore = clone(state.thermal)
  const spatialBefore = clone(actorSpatial(state, 'player'))
  setActorSpatial(state, 'player', createSpatialInertiaState())
  const details = advanceActionAt(state, axisInertiaExperimentConfig.actions.brakeAt, tuning, {
    hadHorizontalMove: false,
    movedAlongCurrentAxis: false,
    remainedGrounded: true,
  })
  appendLog(state, 'Brake', thermalBefore, spatialBefore, `M / Axis cleared${details.length ? ` · ${details.join(' · ')}` : ''}`)
  return state
}

export function basicMove(
  input: CoupledInertiaLabState,
  destination: Coord,
  tuning: RuntimeTuning,
): CoupledInertiaLabState {
  const state = clone(input)
  if (state.pendingReaction) return state
  const player = getPlayer(state.game)
  const origin = { ...player.position }
  const direction = hexDirectionBetween(origin, destination)
  const thermalBefore = clone(state.thermal)
  const spatialBefore = clone(actorSpatial(state, 'player'))
  if (!direction) {
    appendLog(state, 'Basic Move rejected', thermalBefore, spatialBefore, '目标不是相邻 Hex')
    return state
  }

  const occupant = actorAt(state.game, destination)
  let detail = ''
  if (occupant && occupant.id !== player.id) {
    const contest = contestCell(state, 'player', occupant.id, direction, tuning, true)
    detail = contest.detail
    if (contest.reactionOpened) {
      appendLog(state, 'Basic Move · Contact', thermalBefore, spatialBefore, detail)
      return state
    }
  } else if (traversable(state.game, destination, player.id)) {
    player.position = destination
    detail = `Position ${direction}; Axis remains ${axisLabel(actorSpatial(state, 'player').axis)}`
  } else {
    appendLog(state, 'Basic Move rejected', thermalBefore, spatialBefore, '目标 Cell 不可通行')
    return state
  }

  const spatialDuringMove = actorSpatial(state, 'player')
  const moved = !sameCoord(origin, player.position)
  const movedAlongAxis = moved && spatialDuringMove.axis?.kind === 'horizontal' && spatialDuringMove.axis.dir === direction
  const details = advanceActionAt(state, axisInertiaExperimentConfig.actions.basicMoveAt, tuning, {
    hadHorizontalMove: moved,
    movedAlongCurrentAxis: movedAlongAxis,
    remainedGrounded: true,
  })
  appendLog(state, 'Basic Move', thermalBefore, spatialBefore, `${detail}${details.length ? ` · ${details.join(' · ')}` : ''}`)
  return state
}

export function defaultWeaponAction(
  input: CoupledInertiaLabState,
  targetActorId: string,
  tuning: RuntimeTuning,
): CoupledInertiaLabState {
  const state = clone(input)
  if (state.pendingReaction) return state
  const player = getPlayer(state.game)
  const target = state.game.actors.find((actor) => actor.id === targetActorId && actor.alive)
  const thermalBefore = clone(state.thermal)
  const spatialBefore = clone(actorSpatial(state, 'player'))
  if (!target) {
    appendLog(state, 'Default Weapon rejected', thermalBefore, spatialBefore, '目标不存在')
    return state
  }
  const distance = hexDistance(player.position, target.position)
  const onLine = hexDirectionOnLine(player.position, target.position)
  const valid = state.weapon === 'spear'
    ? distance >= 1 && distance <= 2 && Boolean(onLine)
    : distance === 1
  if (!valid) {
    appendLog(state, 'Default Weapon rejected', thermalBefore, spatialBefore, `${state.weapon} 目标距离不合法`)
    return state
  }
  damageActor(target, 1)
  const details = advanceActionAt(state, axisInertiaExperimentConfig.actions.defaultWeaponAt, tuning, {
    hadHorizontalMove: false,
    movedAlongCurrentAxis: false,
    remainedGrounded: true,
  })
  appendLog(
    state,
    `Default Weapon · ${state.weapon}`,
    thermalBefore,
    spatialBefore,
    `Damage 1 · attacker Cell unchanged · Attack ≠ Occupancy${details.length ? ` · ${details.join(' · ')}` : ''}`,
  )
  return state
}

export function heavyRelease(
  input: CoupledInertiaLabState,
  targetActorId: string,
  tuning: RuntimeTuning,
): CoupledInertiaLabState {
  const state = clone(input)
  if (state.pendingReaction) return state
  const player = getPlayer(state.game)
  const target = state.game.actors.find((actor) => actor.id === targetActorId && actor.alive)
  const thermalBefore = clone(state.thermal)
  const spatialBefore = clone(actorSpatial(state, 'player'))
  if (!target || hexDistance(player.position, target.position) !== 1) {
    appendLog(state, 'Heavy Release rejected', thermalBefore, spatialBefore, '需要相邻 Dummy')
    return state
  }
  const direction = hexDirectionBetween(player.position, target.position)!
  const availableDownM = spatialBefore.axis?.kind === 'down' ? spatialBefore.level : 0
  damageActor(target, axisInertiaExperimentConfig.heavyRelease.damage)

  let distance = 0
  let mode = 'Damage only'
  if (availableDownM === 1) {
    distance = axisInertiaExperimentConfig.heavyRelease.pushDistanceM1
    mode = 'Push'
  } else if (availableDownM === 2) {
    distance = axisInertiaExperimentConfig.heavyRelease.pushDistanceM2
    mode = 'Strong Push'
  } else if (availableDownM >= 3) {
    distance = axisInertiaExperimentConfig.heavyRelease.launchDistanceM3
    mode = 'Launch'
  }

  let motionDetail = ''
  if (distance > 0) {
    const targetSpatial = actorSpatial(state, targetActorId)
    const exchange = resolveMomentumInteraction(targetSpatial, horizontalAxis(direction), availableDownM, tuning.momentumExchangeCap)
    setActorSpatial(state, targetActorId, exchange.state)
    motionDetail = forcedPositionMove(state, targetActorId, direction, distance).detail
  }
  if (axisInertiaExperimentConfig.heavyRelease.consumeAllDownMomentum && spatialBefore.axis?.kind === 'down') {
    setActorSpatial(state, 'player', createSpatialInertiaState())
  }
  state.thermal.drift += tuning.heavyReleaseSelfHotwardDrift
  const details = advanceActionAt(state, axisInertiaExperimentConfig.actions.heavyReleaseAt, tuning, {
    hadHorizontalMove: false,
    movedAlongCurrentAxis: false,
    remainedGrounded: true,
  })
  appendLog(
    state,
    'Heavy Release',
    thermalBefore,
    spatialBefore,
    `Down M${availableDownM} → ${mode}${motionDetail ? ` · ${motionDetail}` : ''} · self Drift +${tuning.heavyReleaseSelfHotwardDrift.toFixed(2)}${details.length ? ` · ${details.join(' · ')}` : ''}`,
  )
  return state
}

function prepareDriveAxis(
  state: CoupledInertiaLabState,
  direction: HexDirection,
  tuning: RuntimeTuning,
): { valid: boolean; detail: string } {
  const current = actorSpatial(state, 'player')
  const selected = horizontalAxis(direction)
  if (current.level <= 0 || !current.axis) {
    setActorSpatial(state, 'player', createSpatialInertiaState({ level: tuning.driveStartMomentum, axis: selected }))
    return { valid: true, detail: `Drive Intro → ${direction} M${tuning.driveStartMomentum}` }
  }
  if (axisEquals(current.axis, selected)) {
    return { valid: true, detail: `Drive keeps ${direction} M${current.level}` }
  }

  const consumed = clampMomentum(Math.min(current.level, tuning.driveIntroExchangeCap))
  const remaining = clampMomentum(current.level - consumed)
  if (remaining > 0) {
    return {
      valid: false,
      detail: `Drive Intro blocked: old ${axisLabel(current.axis)} M${current.level} - ${consumed} → M${remaining}; Brake / more Intro required`,
    }
  }
  setActorSpatial(state, 'player', createSpatialInertiaState({ level: tuning.driveStartMomentum, axis: selected }))
  return { valid: true, detail: `Drive Intro consumed old M${current.level} → ${direction} M${tuning.driveStartMomentum}` }
}

export type DriveFrame = {
  state: CoupledInertiaLabState
  phaseIndex: number
  direction: HexDirection
  detail: string
}

export type DrivePlan = {
  direction: HexDirection
  valid: boolean
  reason: string
  endpoint: Coord
  path: Coord[]
  frames: DriveFrame[]
}

function resolveDrivePhases(
  input: CoupledInertiaLabState,
  directionInput: HexDirection,
  tuning: RuntimeTuning,
  phaseCount: number,
  phaseOffset = 0,
): DriveFrame[] {
  const frames: DriveFrame[] = []
  let current = clone(input)
  let direction = directionInput
  let stopped = false

  for (let localIndex = 0; localIndex < phaseCount; localIndex += 1) {
    const phaseIndex = phaseOffset + localIndex
    const state = clone(current)
    const player = getPlayer(state.game)
    const origin = { ...player.position }
    const thermalBefore = clone(state.thermal)
    const spatialBefore = clone(actorSpatial(state, 'player'))
    let detail = `Phase ${phaseIndex + 1}`
    let moved = false
    let movedAlongAxis = false

    if (stopped) {
      const extra = advanceActionAt(state, axisInertiaExperimentConfig.actions.drivePhaseAt, tuning, {
        hadHorizontalMove: false,
        movedAlongCurrentAxis: false,
        remainedGrounded: true,
      })
      detail += ` · Recovery${extra.length ? ` · ${extra.join(' · ')}` : ''}`
      appendLog(state, `Drive · Recovery ${phaseIndex + 1}`, thermalBefore, spatialBefore, detail)
      frames.push({ state, phaseIndex, direction, detail })
      current = state
      continue
    }

    let destination = hexAdvance(player.position, direction)
    const surface = surfaceAt(state.game, destination)
    if (surface === 'hard') {
      setActorSpatial(state, 'player', createSpatialInertiaState())
      stopped = true
      const extra = advanceActionAt(state, axisInertiaExperimentConfig.actions.drivePhaseAt, tuning, {
        hadHorizontalMove: false,
        movedAlongCurrentAxis: false,
        remainedGrounded: true,
      })
      detail += ` · Hard Crash · M/Axis cleared${extra.length ? ` · ${extra.join(' · ')}` : ''}`
      appendLog(state, 'Drive Contact', thermalBefore, spatialBefore, detail)
      frames.push({ state, phaseIndex, direction, detail })
      current = state
      continue
    }

    if (surface === 'reflect-left' || surface === 'reflect-right') {
      direction = rotateDirection(direction, surface === 'reflect-left' ? -1 : 1)
      setHorizontalAxisPreservingMomentum(state, 'player', direction)
      destination = hexAdvance(player.position, direction)
      detail += ` · Surface Reorient ${surface} → ${direction}`
    }

    const occupant = actorAt(state.game, destination)
    if (occupant && occupant.id !== player.id) {
      const remainingPhases = Math.max(0, phaseCount - localIndex - 1)
      const contest = contestCell(
        state,
        'player',
        occupant.id,
        direction,
        tuning,
        true,
        remainingPhases > 0 ? { kind: 'drive', direction, remainingPhases } : undefined,
      )
      detail += ` · ${contest.detail}`
      moved = !sameCoord(origin, player.position)
      movedAlongAxis = moved && actorSpatial(state, 'player').axis?.kind === 'horizontal'
        && actorSpatial(state, 'player').axis?.dir === direction
      if (contest.winner === 'defender') stopped = true
      if (contest.reactionOpened) {
        appendLog(state, 'Drive Contact · Reaction', thermalBefore, spatialBefore, detail)
        frames.push({ state, phaseIndex, direction, detail })
        break
      }
    } else if (traversable(state.game, destination, player.id)) {
      player.position = destination
      moved = true
      movedAlongAxis = actorSpatial(state, 'player').axis?.kind === 'horizontal'
        && actorSpatial(state, 'player').axis?.dir === direction
      detail += ` · Move ${direction}`
    } else {
      setActorSpatial(state, 'player', createSpatialInertiaState())
      stopped = true
      detail += ' · Blocked Crash · no auto redirect · M/Axis cleared'
    }

    const extra = advanceActionAt(state, axisInertiaExperimentConfig.actions.drivePhaseAt, tuning, {
      hadHorizontalMove: moved,
      movedAlongCurrentAxis: movedAlongAxis,
      remainedGrounded: true,
    })
    if (extra.length) detail += ` · ${extra.join(' · ')}`
    appendLog(state, `Drive · AT Phase ${phaseIndex + 1}`, thermalBefore, spatialBefore, detail)
    frames.push({ state, phaseIndex, direction, detail })
    current = state
  }
  return frames
}

export function createDrivePlan(
  input: CoupledInertiaLabState,
  direction: HexDirection,
  tuning: RuntimeTuning,
): DrivePlan {
  const start = clone(input)
  if (start.pendingReaction) {
    return {
      direction,
      valid: false,
      reason: 'Resolve current Reaction first',
      endpoint: { ...getPlayer(start.game).position },
      path: [],
      frames: [],
    }
  }
  const intro = prepareDriveAxis(start, direction, tuning)
  if (!intro.valid) {
    return {
      direction,
      valid: false,
      reason: intro.detail,
      endpoint: { ...getPlayer(start.game).position },
      path: [],
      frames: [],
    }
  }
  const frames = resolveDrivePhases(
    start,
    direction,
    tuning,
    axisInertiaExperimentConfig.actions.drivePhaseCount,
  )
  if (frames[0] && frames[0].state.logs[0]) frames[0].state.logs[0].detail = `${intro.detail} · ${frames[0].state.logs[0].detail}`
  const path: Coord[] = []
  let previous = getPlayer(input.game).position
  for (const frame of frames) {
    const current = getPlayer(frame.state.game).position
    if (!sameCoord(previous, current)) path.push({ ...current })
    previous = current
  }
  const finalState = frames.at(-1)?.state ?? start
  return {
    direction,
    valid: true,
    reason: intro.detail,
    endpoint: { ...getPlayer(finalState.game).position },
    path,
    frames,
  }
}

export function resolveDrive(
  input: CoupledInertiaLabState,
  direction: HexDirection,
  tuning: RuntimeTuning,
): DriveFrame[] {
  return createDrivePlan(input, direction, tuning).frames
}

function resumeDriveAfterReaction(
  state: CoupledInertiaLabState,
  continuation: DriveContinuation,
  tuning: RuntimeTuning,
): string {
  const frames = resolveDrivePhases(state, continuation.direction, tuning, continuation.remainingPhases)
  const final = frames.at(-1)?.state
  if (!final) return ''
  Object.assign(state, final)
  return `Drive continuation resolved ${continuation.remainingPhases} phase(s)`
}

export function resolveReaction(
  input: CoupledInertiaLabState,
  destination: Coord | null,
  tuning: RuntimeTuning,
): CoupledInertiaLabState {
  const state = clone(input)
  const reaction = state.pendingReaction
  if (!reaction) return state
  const thermalBefore = clone(state.thermal)
  const spatialBefore = clone(actorSpatial(state, reaction.actorId))
  const actor = state.game.actors.find((candidate) => candidate.id === reaction.actorId)
  state.pendingReaction = undefined
  const detail: string[] = [reaction.sourceLabel]
  let sideMoved = false

  if (destination && actor && reaction.legalCoords.some((coord) => sameCoord(coord, destination))) {
    const current = actorSpatial(state, reaction.actorId)
    const remaining = clampMomentum(current.level - reaction.costM)
    actor.position = { ...destination }
    setActorSpatial(state, reaction.actorId, createSpatialInertiaState({
      ...current,
      level: remaining,
      axis: remaining > 0 ? clone(reaction.axisSnapshot) : null,
    }))
    sideMoved = true
    detail.push(`active side-shift → (${destination.x},${destination.y}) · M-${reaction.costM} · Axis stays ${axisLabel(reaction.axisSnapshot)}`)
  } else {
    detail.push('declined')
  }

  if (reaction.resolveThermalAt > 0) {
    detail.push(...advanceActionAt(state, reaction.resolveThermalAt, tuning, {
      hadHorizontalMove: sideMoved,
      movedAlongCurrentAxis: false,
      remainedGrounded: true,
    }))
    detail.push(`same-AT Thermal Evolution → T ${state.thermal.temperature.toFixed(2)}`)
  }
  if (reaction.continuation) detail.push(resumeDriveAfterReaction(state, reaction.continuation, tuning))

  appendLog(state, `Resolve Reaction · ${reaction.kind}`, thermalBefore, spatialBefore, detail.filter(Boolean).join(' · '))
  return state
}

export function setSpatialDebug(
  input: CoupledInertiaLabState,
  actorId: string,
  patch: Partial<SpatialInertiaState>,
): CoupledInertiaLabState {
  const state = clone(input)
  const current = { ...actorSpatial(state, actorId), ...patch }
  current.level = clampMomentum(current.level)
  if (current.level <= 0) current.axis = null
  if (current.level > 0 && !current.axis) current.axis = downAxis()
  setActorSpatial(state, actorId, current)
  return state
}

export function setReactionSettings(
  input: CoupledInertiaLabState,
  patch: Partial<ReactionSettings>,
): CoupledInertiaLabState {
  const state = clone(input)
  state.reactionSettings = { ...state.reactionSettings, ...patch }
  return state
}

export function setThermalDebug(
  input: CoupledInertiaLabState,
  patch: Partial<ThermalInertiaState>,
): CoupledInertiaLabState {
  const state = clone(input)
  const current = { ...state.thermal, ...patch }
  current.temperature = clamp(current.temperature, axisInertiaExperimentConfig.thermal.temperatureMin, axisInertiaExperimentConfig.thermal.temperatureMax)
  current.setPoint = clamp(current.setPoint, axisInertiaExperimentConfig.thermal.setPointMin, axisInertiaExperimentConfig.thermal.setPointMax)
  state.thermal = current
  getPlayer(state.game).bodyTemperature = current.temperature
  return state
}

export function setActorMass(input: CoupledInertiaLabState, actorId: string, mass: Mass): CoupledInertiaLabState {
  const state = clone(input)
  const actor = state.game.actors.find((candidate) => candidate.id === actorId)
  if (actor) actor.mass = mass
  return state
}

export function setSelectedActor(input: CoupledInertiaLabState, actorId: string): CoupledInertiaLabState {
  const state = clone(input)
  if (state.game.actors.some((actor) => actor.id === actorId)) state.selectedActorId = actorId
  return state
}

export function setWeapon(input: CoupledInertiaLabState, weapon: WeaponProfile): CoupledInertiaLabState {
  return { ...clone(input), weapon }
}

export function queueDummyMove(
  input: CoupledInertiaLabState,
  actorId: string,
  direction: HexDirection,
): CoupledInertiaLabState {
  const state = clone(input)
  const thermalBefore = clone(state.thermal)
  const spatialBefore = clone(actorSpatial(state, 'player'))
  state.queuedDummyMove = { actorId, direction, executeAt: state.worldTimeAt + 1 }
  appendLog(state, 'Queue Dummy Move', thermalBefore, spatialBefore, `${actorId} ${direction} @ ${state.worldTimeAt + 1} AT`)
  return state
}

function configureLabGame(): GameState {
  const game = createHexRoomState(3)
  const center = { x: 3, y: 3 }
  for (const cell of game.cells) {
    if (cell.tags.includes('Void')) continue
    cell.tags = cell.tags.filter((tag) => ![
      'Blocked', 'Mountain', 'Ridge', 'Peak',
      'UT3Hard', 'UT3ReflectLeft', 'UT3ReflectRight',
      'UT4Hard', 'UT4ReflectLeft', 'UT4ReflectRight',
      'UT5Hard', 'UT5ReflectLeft', 'UT5ReflectRight',
    ].includes(tag))
    cell.groundTemp = 0
    cell.skyTemp = 0
    cell.skyFill = 'clear'
    cell.intents = []
  }
  cellAt(game, hexAdvance(center, 'W', 3))?.tags.push('UT5Hard')
  cellAt(game, hexAdvance(center, 'NW', 3))?.tags.push('UT5ReflectLeft')
  cellAt(game, hexAdvance(center, 'SW', 3))?.tags.push('UT5ReflectRight')

  const player = getPlayer(game)
  player.position = center
  player.name = 'Player'
  player.hp = player.maxHp = 12
  player.bodyTemperature = 1
  player.intent = 'UT5 manual control'

  const dummies = game.actors.filter((actor) => actor.id !== 'player').slice(0, 3)
  const placements: HexDirection[] = ['E', 'NE', 'SE']
  dummies.forEach((actor, index) => {
    actor.name = `Dummy ${String.fromCharCode(65 + index)}`
    actor.faction = 'enemy'
    actor.position = hexAdvance(center, placements[index], index === 0 ? 1 : 2)
    actor.hp = actor.maxHp = 12
    actor.alive = true
    actor.intent = 'AI OFF · Diagnostic Dummy'
    actor.mass = index === 1 ? 'heavy' : index === 2 ? 'light' : 'normal'
  })
  game.actors = [player, ...dummies]
  game.phase = 'player'
  game.phaseQueue = []
  game.ap = 0
  game.reservedAP = 0
  game.logs = ['[UT5] Axis Inertia Sandbox · Enemy AI OFF']
  return game
}

export function createCoupledInertiaLabState(): CoupledInertiaLabState {
  const game = configureLabGame()
  const spatialByActorId = Object.fromEntries(game.actors.map((actor) => [actor.id, createSpatialInertiaState()]))
  const thermal: ThermalInertiaState = { temperature: 1, drift: 0, setPoint: 1 }
  getPlayer(game).bodyTemperature = thermal.temperature
  return {
    game,
    worldTimeAt: 0,
    thermal,
    spatialByActorId,
    selectedActorId: 'player',
    weapon: 'hammer',
    reactionSettings: {
      reactionSidestep: false,
      failedOccupancyFallback: false,
      minSidestepM: clampMomentum(axisInertiaExperimentConfig.spatial.minReactionSidestepM),
      sidestepCostM: clampMomentum(axisInertiaExperimentConfig.spatial.reactionSidestepCostM),
      minFallbackM: clampMomentum(axisInertiaExperimentConfig.spatial.minFallbackM),
      fallbackCostM: clampMomentum(axisInertiaExperimentConfig.spatial.fallbackCostM),
    },
    logs: [],
    logSequence: 0,
  }
}

export function nearestDummyDirection(state: CoupledInertiaLabState): HexDirection {
  const player = getPlayer(state.game)
  const candidates = state.game.actors
    .filter((actor) => actor.id !== 'player' && actor.alive)
    .map((actor) => ({ actor, distance: hexDistance(player.position, actor.position) }))
    .sort((left, right) => left.distance - right.distance || left.actor.id.localeCompare(right.actor.id))
  return candidates[0] ? hexDirectionOnLine(player.position, candidates[0].actor.position) ?? 'E' : 'E'
}

export function labSurfaceLabel(game: GameState, coord: Coord): string | undefined {
  const surface = surfaceAt(game, coord)
  if (surface === 'hard') return 'Hard'
  if (surface === 'reflect-left') return 'Reflect L'
  if (surface === 'reflect-right') return 'Reflect R'
  return undefined
}
