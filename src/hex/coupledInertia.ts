import experimentConfigJson from '../../config/experiments/val-012-coupled-inertia-lab.v4.json'
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

export type SpatialInertiaMode = 'none' | 'movement' | 'position'
export type SpatialInertiaLevel = 0 | 1 | 2 | 3
export type HitType = 'normal' | 'push' | 'heavy'
export type WeaponProfile = 'spear' | 'hammer'
export type SurfaceRule = 'hard' | 'reflect-left' | 'reflect-right'

export type ThermalInertiaState = {
  temperature: number
  drift: number
  setPoint: number
}

export type SpatialInertiaState = {
  level: SpatialInertiaLevel
  mode: SpatialInertiaMode
  axis: HexDirection | null
  pendingLevel: SpatialInertiaLevel
  chainOpen: boolean
  anchorCellId: string | null
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
    steeringLoss60: number
    steeringLoss120: number
    positionStabilityPerLevel: number
    contestPushDistancePlus1: number
    contestPushDistancePlus2: number
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
    consumeAllPositionInertia: boolean
  }
  hits: Record<HitType, { damage: number; forcedStrength: number }>
}

export const coupledInertiaExperimentConfig = experimentConfigJson as InertiaExperimentConfig

export type RuntimeTuning = {
  damping: number
  thermalPeriodAt: number
  ambientThermalBias: number
  hitHotwardDrift: Record<HitType, number>
  forcedMotionExtraHotwardDrift: number
  heavyReleaseSelfHotwardDrift: number
  steeringLoss60: number
  steeringLoss120: number
}

export function defaultRuntimeTuning(): RuntimeTuning {
  return {
    damping: coupledInertiaExperimentConfig.thermal.damping,
    thermalPeriodAt: coupledInertiaExperimentConfig.thermal.thermalPeriodAt,
    ambientThermalBias: coupledInertiaExperimentConfig.thermal.ambientThermalBias,
    hitHotwardDrift: {
      normal: coupledInertiaExperimentConfig.thermalInputs.normalHitHotwardDrift,
      push: coupledInertiaExperimentConfig.thermalInputs.pushHitHotwardDrift,
      heavy: coupledInertiaExperimentConfig.thermalInputs.heavyHitHotwardDrift,
    },
    forcedMotionExtraHotwardDrift: coupledInertiaExperimentConfig.thermalInputs.forcedMotionExtraHotwardDrift,
    heavyReleaseSelfHotwardDrift: coupledInertiaExperimentConfig.thermalInputs.heavyReleaseSelfHotwardDrift,
    steeringLoss60: coupledInertiaExperimentConfig.spatial.steeringLoss60,
    steeringLoss120: coupledInertiaExperimentConfig.spatial.steeringLoss120,
  }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const keyOf = (coord: Coord) => `${coord.x},${coord.y}`
const sameCoord = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y

function clone<T>(value: T): T {
  return structuredClone(value)
}

export function createSpatialInertiaState(overrides: Partial<SpatialInertiaState> = {}): SpatialInertiaState {
  return {
    level: 0,
    mode: 'none',
    axis: null,
    pendingLevel: 0,
    chainOpen: false,
    anchorCellId: null,
    ...overrides,
  }
}

export function clampSpatialLevel(value: number): SpatialInertiaLevel {
  return clamp(Math.round(value), 0, 3) as SpatialInertiaLevel
}

export function thermalDomainFor(temperature: number): 'cold' | 'neutral' | 'hot' {
  if (temperature <= coupledInertiaExperimentConfig.thermal.coldDomainThreshold) return 'cold'
  if (temperature >= coupledInertiaExperimentConfig.thermal.hotDomainThreshold) return 'hot'
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
  const configuredSubsteps = Math.max(4, coupledInertiaExperimentConfig.thermal.integrationSubstepsPerAt)
  const substeps = Math.max(1, Math.ceil(duration * configuredSubsteps))
  const dt = duration / substeps

  for (let index = 0; index < substeps; index += 1) {
    const offset = next.temperature - next.setPoint
    const acceleration = -omega * omega * offset - Math.max(0, tuning.damping) * next.drift + tuning.ambientThermalBias
    next.drift += acceleration * dt
    next.temperature += next.drift * dt
    next.temperature = clamp(
      next.temperature,
      coupledInertiaExperimentConfig.thermal.temperatureMin,
      coupledInertiaExperimentConfig.thermal.temperatureMax,
    )
    minimumTemperature = Math.min(minimumTemperature, next.temperature)
    maximumTemperature = Math.max(maximumTemperature, next.temperature)
  }

  const settled = Math.abs(next.temperature - next.setPoint) <= coupledInertiaExperimentConfig.thermal.settleTemperatureEpsilon
    && Math.abs(next.drift) <= coupledInertiaExperimentConfig.thermal.settleDriftEpsilon
  if (settled) {
    next.temperature = next.setPoint
    next.drift = 0
  }
  return { state: next, minimumTemperature, maximumTemperature, settled }
}

export function reconcileSpatialWithTemperature(
  spatial: SpatialInertiaState,
  temperature: number,
): { spatial: SpatialInertiaState; clearedReason?: string } {
  if (spatial.mode === 'movement' && temperature < 0) {
    return { spatial: createSpatialInertiaState(), clearedReason: 'Movement M crossed below Temperature 0' }
  }
  if (spatial.mode === 'position' && temperature > 0) {
    return { spatial: createSpatialInertiaState(), clearedReason: 'Position M crossed above Temperature 0' }
  }
  if (spatial.level <= 0 && spatial.pendingLevel <= 0) return { spatial: createSpatialInertiaState() }
  return { spatial: clone(spatial) }
}

export function directionTurnSteps(from: HexDirection | null, to: HexDirection): 0 | 1 | 2 | 3 {
  if (!from) return 0
  const fromIndex = HEX_DIRECTIONS.findIndex((entry) => entry.direction === from)
  const toIndex = HEX_DIRECTIONS.findIndex((entry) => entry.direction === to)
  const raw = Math.abs(fromIndex - toIndex)
  return Math.min(raw, 6 - raw) as 0 | 1 | 2 | 3
}

function rotateDirection(direction: HexDirection, delta: number): HexDirection {
  const index = HEX_DIRECTIONS.findIndex((entry) => entry.direction === direction)
  return HEX_DIRECTIONS[(index + delta + 6 * 10) % 6].direction
}

export function oppositeDirection(direction: HexDirection): HexDirection {
  return rotateDirection(direction, 3)
}

export function steeringLossFor(
  from: HexDirection | null,
  to: HexDirection,
  tuning: RuntimeTuning,
): number {
  const steps = directionTurnSteps(from, to)
  if (steps === 1) return tuning.steeringLoss60
  if (steps === 2) return tuning.steeringLoss120
  if (steps === 3) return 99
  return 0
}

function movementBuild(
  spatialInput: SpatialInertiaState,
  direction: HexDirection,
  thermalTrace: ThermalTrace,
  tuning: RuntimeTuning,
): SpatialInertiaState {
  if (thermalTrace.minimumTemperature < coupledInertiaExperimentConfig.thermal.hotDomainThreshold) {
    return reconcileSpatialWithTemperature(spatialInput, thermalTrace.state.temperature).spatial
  }

  const spatial = spatialInput.mode === 'movement'
    ? clone(spatialInput)
    : createSpatialInertiaState({ mode: 'movement', axis: direction })
  const turnSteps = directionTurnSteps(spatial.axis, direction)
  if (turnSteps === 3 && spatial.level > 0) {
    return createSpatialInertiaState({ mode: 'movement', axis: direction })
  }
  const afterLoss = clampSpatialLevel(spatial.level - steeringLossFor(spatial.axis, direction, tuning))
  const nextLevel = clampSpatialLevel(afterLoss + 1)
  return createSpatialInertiaState({
    level: nextLevel,
    mode: 'movement',
    axis: direction,
    pendingLevel: nextLevel,
    chainOpen: nextLevel > 0,
  })
}

function positionBuild(
  spatialInput: SpatialInertiaState,
  coord: Coord,
  thermalTrace: ThermalTrace,
): SpatialInertiaState {
  if (thermalTrace.maximumTemperature > coupledInertiaExperimentConfig.thermal.coldDomainThreshold) {
    return reconcileSpatialWithTemperature(spatialInput, thermalTrace.state.temperature).spatial
  }
  const sourceLevel = spatialInput.mode === 'position' ? spatialInput.level : 0
  const nextLevel = clampSpatialLevel(sourceLevel + 1)
  return createSpatialInertiaState({
    level: nextLevel,
    mode: 'position',
    anchorCellId: keyOf(coord),
  })
}

function massPower(mass: Mass): number {
  if (mass === 'heavy') return 3
  if (mass === 'light') return 1
  return 2
}

function actorSpatial(state: CoupledInertiaLabState, actorId: string): SpatialInertiaState {
  return state.spatialByActorId[actorId] ?? createSpatialInertiaState()
}

function setActorSpatial(state: CoupledInertiaLabState, actorId: string, spatial: SpatialInertiaState) {
  state.spatialByActorId[actorId] = spatial
}

function spatialPowerForMove(spatial: SpatialInertiaState, direction: HexDirection): number {
  return spatial.mode === 'movement' && spatial.axis === direction ? spatial.level : 0
}

function spatialPowerForDefense(spatial: SpatialInertiaState, coord: Coord): number {
  return spatial.mode === 'position' && spatial.anchorCellId === keyOf(coord) ? spatial.level : 0
}

function surfaceAt(game: GameState, coord: Coord): SurfaceRule | undefined {
  const tags = cellAt(game, coord)?.tags ?? []
  if (tags.includes('UT4Hard')) return 'hard'
  if (tags.includes('UT4ReflectLeft')) return 'reflect-left'
  if (tags.includes('UT4ReflectRight')) return 'reflect-right'
  return undefined
}

function traversable(game: GameState, coord: Coord, movingActorId?: string): boolean {
  const cell = cellAt(game, coord)
  if (!cell || cell.tags.includes('Void') || cell.tags.includes('Blocked') || cell.tags.includes('Mountain')) return false
  const occupant = actorAt(game, coord)
  return !occupant || occupant.id === movingActorId
}

function clearPositionIfAnchorBroken(state: CoupledInertiaLabState, actorId: string, previousCoord: Coord, nextCoord: Coord) {
  const spatial = actorSpatial(state, actorId)
  if (spatial.mode !== 'position' || !spatial.anchorCellId) return
  if (sameCoord(previousCoord, nextCoord)) return
  setActorSpatial(state, actorId, createSpatialInertiaState())
}

function forcedMove(
  state: CoupledInertiaLabState,
  actorId: string,
  directionInput: HexDirection,
  distance: number,
): { moved: number; detail: string; finalDirection: HexDirection } {
  const actor = state.game.actors.find((candidate) => candidate.id === actorId && candidate.alive)
  if (!actor || distance <= 0) return { moved: 0, detail: 'No forced motion', finalDirection: directionInput }
  let direction = directionInput
  let moved = 0
  let detail = ''
  let secondaryImpactCount = 0

  for (let step = 0; step < distance; step += 1) {
    const nextCoord = hexAdvance(actor.position, direction)
    const surface = surfaceAt(state.game, nextCoord)
    if (surface === 'hard') {
      detail = `Crash at Hard surface after ${moved} cell(s)`
      break
    }
    if (surface === 'reflect-left' || surface === 'reflect-right') {
      direction = rotateDirection(direction, surface === 'reflect-left' ? -1 : 1)
      detail = `Bounce ${surface}`
      continue
    }
    const secondary = actorAt(state.game, nextCoord)
    if (secondary && secondary.id !== actor.id) {
      if (secondaryImpactCount >= 1) {
        detail = 'Secondary conflict limit reached'
        break
      }
      secondaryImpactCount += 1
      const landing = hexAdvance(secondary.position, direction)
      const previousSecondary = { ...secondary.position }
      if (traversable(state.game, landing, secondary.id)) {
        secondary.position = landing
        clearPositionIfAnchorBroken(state, secondary.id, previousSecondary, landing)
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
    const previous = { ...actor.position }
    actor.position = nextCoord
    clearPositionIfAnchorBroken(state, actor.id, previous, nextCoord)
    moved += 1
  }

  return { moved, detail: detail || `Forced motion ${moved} cell(s)`, finalDirection: direction }
}

function contestCell(
  state: CoupledInertiaLabState,
  attackerId: string,
  defenderId: string,
  direction: HexDirection,
): { winner: 'attacker' | 'defender'; detail: string } {
  const attacker = state.game.actors.find((actor) => actor.id === attackerId)!
  const defender = state.game.actors.find((actor) => actor.id === defenderId)!
  const attackerSpatial = actorSpatial(state, attackerId)
  const defenderSpatial = actorSpatial(state, defenderId)
  const attackerPower = massPower(attacker.mass) + spatialPowerForMove(attackerSpatial, direction)
  const defenderPower = massPower(defender.mass) + spatialPowerForDefense(defenderSpatial, defender.position)
  const difference = attackerPower - defenderPower

  if (difference <= 0) {
    return {
      winner: 'defender',
      detail: `Cell Contest ${attackerPower} vs ${defenderPower}: Clash，入侵者未占格`,
    }
  }

  const defenderOrigin = { ...defender.position }
  const pushDistance = difference >= 2
    ? coupledInertiaExperimentConfig.spatial.contestPushDistancePlus2
    : coupledInertiaExperimentConfig.spatial.contestPushDistancePlus1
  const pushed = forcedMove(state, defenderId, direction, pushDistance)
  if (sameCoord(defender.position, defenderOrigin)) {
    return {
      winner: 'defender',
      detail: `Cell Contest ${attackerPower} vs ${defenderPower}: defender 无法被推出，Clash`,
    }
  }
  const attackerOrigin = { ...attacker.position }
  attacker.position = defenderOrigin
  clearPositionIfAnchorBroken(state, attackerId, attackerOrigin, attacker.position)
  return {
    winner: 'attacker',
    detail: `Cell Contest ${attackerPower} vs ${defenderPower}: attacker 占格；${pushed.detail}`,
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
  state.logs = state.logs.slice(0, 40)
}

function advancePlayerThermal(
  state: CoupledInertiaLabState,
  deltaAt: number,
  tuning: RuntimeTuning,
): ThermalTrace {
  const trace = advanceThermalInertia(state.thermal, deltaAt, tuning)
  state.thermal = trace.state
  state.worldTimeAt += deltaAt
  const reconciled = reconcileSpatialWithTemperature(actorSpatial(state, 'player'), state.thermal.temperature)
  setActorSpatial(state, 'player', reconciled.spatial)
  getPlayer(state.game).bodyTemperature = state.thermal.temperature
  return trace
}

function processQueuedDummyMove(state: CoupledInertiaLabState) {
  const queued = state.queuedDummyMove
  if (!queued || queued.executeAt > state.worldTimeAt) return ''
  const actor = state.game.actors.find((candidate) => candidate.id === queued.actorId && candidate.alive)
  state.queuedDummyMove = undefined
  if (!actor) return 'Queued Dummy Move cancelled: actor missing'
  const target = hexAdvance(actor.position, queued.direction)
  const occupant = actorAt(state.game, target)
  if (occupant && occupant.id !== actor.id) {
    return `Queued Dummy Move: ${contestCell(state, actor.id, occupant.id, queued.direction).detail}`
  }
  if (!traversable(state.game, target, actor.id)) return 'Queued Dummy Move blocked'
  const previous = { ...actor.position }
  actor.position = target
  clearPositionIfAnchorBroken(state, actor.id, previous, target)
  return `Queued Dummy Move: ${actor.name} → ${queued.direction}`
}

export function stepWorld(
  input: CoupledInertiaLabState,
  deltaAt: number,
  tuning: RuntimeTuning,
  label = 'Step World',
): CoupledInertiaLabState {
  const state = clone(input)
  const thermalBefore = clone(state.thermal)
  const spatialBefore = clone(actorSpatial(state, 'player'))
  const trace = advancePlayerThermal(state, Math.max(0, deltaAt), tuning)
  const queuedDetail = processQueuedDummyMove(state)
  appendLog(
    state,
    label,
    thermalBefore,
    spatialBefore,
    `${deltaAt} AT · domain ${thermalDomainFor(state.thermal.temperature)}${trace.settled ? ' · Settle' : ''}${queuedDetail ? ` · ${queuedDetail}` : ''}`,
  )
  return state
}

function damageDiagnostic(actor: Actor, amount: number) {
  actor.hp = Math.max(1, actor.hp - amount)
  actor.alive = true
}

export function injectHit(
  input: CoupledInertiaLabState,
  hitType: HitType,
  incomingDirection: HexDirection,
  tuning: RuntimeTuning,
): CoupledInertiaLabState {
  const state = clone(input)
  const player = getPlayer(state.game)
  const spatialBefore = clone(actorSpatial(state, 'player'))
  const thermalBefore = clone(state.thermal)
  const hit = coupledInertiaExperimentConfig.hits[hitType]
  const anchoredPositionLevel = spatialBefore.mode === 'position'
    && spatialBefore.anchorCellId === keyOf(player.position)
    ? spatialBefore.level
    : 0
  const stability = anchoredPositionLevel * coupledInertiaExperimentConfig.spatial.positionStabilityPerLevel
  const remainingStrength = Math.max(0, hit.forcedStrength - stability)
  const forceDirection = oppositeDirection(incomingDirection)
  let forcedDetail = '位置未改变'

  if (remainingStrength > 0) {
    const motion = forcedMove(state, 'player', forceDirection, remainingStrength)
    forcedDetail = motion.detail
  }
  damageDiagnostic(player, hit.damage)
  const driftGain = tuning.hitHotwardDrift[hitType]
    + (hit.forcedStrength > 0 ? tuning.forcedMotionExtraHotwardDrift : 0)
  state.thermal.drift += driftGain
  const reconciled = reconcileSpatialWithTemperature(actorSpatial(state, 'player'), state.thermal.temperature)
  setActorSpatial(state, 'player', reconciled.spatial)
  player.bodyTemperature = state.thermal.temperature
  appendLog(
    state,
    `Inject Hit · ${hitType}`,
    thermalBefore,
    spatialBefore,
    `pre-M ${spatialBefore.mode} M${spatialBefore.level} · stability ${stability} · incoming ${incomingDirection} · ${forcedDetail} · Damage ${hit.damage} · Drift +${driftGain.toFixed(2)}`,
  )
  return state
}

export function holdPosition(
  input: CoupledInertiaLabState,
  tuning: RuntimeTuning,
): CoupledInertiaLabState {
  const state = clone(input)
  const player = getPlayer(state.game)
  const thermalBefore = clone(state.thermal)
  const spatialBefore = clone(actorSpatial(state, 'player'))
  const trace = advancePlayerThermal(state, coupledInertiaExperimentConfig.actions.holdPositionAt, tuning)
  const built = positionBuild(actorSpatial(state, 'player'), player.position, trace)
  setActorSpatial(state, 'player', built)
  const queued = processQueuedDummyMove(state)
  appendLog(
    state,
    'Hold Position',
    thermalBefore,
    spatialBefore,
    `${trace.maximumTemperature <= coupledInertiaExperimentConfig.thermal.coldDomainThreshold ? `Cold stationary build → M${built.level}` : '未保持完整 Cold Domain，不 Build'}${queued ? ` · ${queued}` : ''}`,
  )
  return state
}

export function brake(
  input: CoupledInertiaLabState,
  tuning: RuntimeTuning,
): CoupledInertiaLabState {
  const state = clone(input)
  const thermalBefore = clone(state.thermal)
  const spatialBefore = clone(actorSpatial(state, 'player'))
  setActorSpatial(state, 'player', createSpatialInertiaState())
  advancePlayerThermal(state, coupledInertiaExperimentConfig.actions.brakeAt, tuning)
  const queued = processQueuedDummyMove(state)
  appendLog(state, 'Brake', thermalBefore, spatialBefore, `Movement/Position M 清零${queued ? ` · ${queued}` : ''}`)
  return state
}

export function basicMove(
  input: CoupledInertiaLabState,
  destination: Coord,
  tuning: RuntimeTuning,
): CoupledInertiaLabState {
  const state = clone(input)
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
  let actionDetail = ''
  if (occupant && occupant.id !== player.id) {
    actionDetail = contestCell(state, player.id, occupant.id, direction).detail
  } else if (traversable(state.game, destination, player.id)) {
    player.position = destination
    clearPositionIfAnchorBroken(state, 'player', origin, destination)
    actionDetail = `Move ${direction}`
  } else {
    appendLog(state, 'Basic Move rejected', thermalBefore, spatialBefore, '目标 Cell 不可通行')
    return state
  }

  const trace = advancePlayerThermal(state, coupledInertiaExperimentConfig.actions.basicMoveAt, tuning)
  if (!sameCoord(origin, player.position)) {
    setActorSpatial(state, 'player', movementBuild(actorSpatial(state, 'player'), direction, trace, tuning))
  }
  const queued = processQueuedDummyMove(state)
  appendLog(state, 'Basic Move', thermalBefore, spatialBefore, `${actionDetail}${queued ? ` · ${queued}` : ''}`)
  return state
}

export function defaultWeaponAction(
  input: CoupledInertiaLabState,
  targetActorId: string,
  tuning: RuntimeTuning,
): CoupledInertiaLabState {
  const state = clone(input)
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

  damageDiagnostic(target, 1)
  const trace = advancePlayerThermal(state, coupledInertiaExperimentConfig.actions.defaultWeaponAt, tuning)
  setActorSpatial(state, 'player', positionBuild(actorSpatial(state, 'player'), player.position, trace))
  const queued = processQueuedDummyMove(state)
  appendLog(
    state,
    `Default Weapon · ${state.weapon}`,
    thermalBefore,
    spatialBefore,
    `Damage 1 · attacker Cell unchanged · no Cell Contest${queued ? ` · ${queued}` : ''}`,
  )
  return state
}

export function heavyRelease(
  input: CoupledInertiaLabState,
  targetActorId: string,
  tuning: RuntimeTuning,
): CoupledInertiaLabState {
  const state = clone(input)
  const player = getPlayer(state.game)
  const target = state.game.actors.find((actor) => actor.id === targetActorId && actor.alive)
  const thermalBefore = clone(state.thermal)
  const spatialBefore = clone(actorSpatial(state, 'player'))
  if (!target || hexDistance(player.position, target.position) !== 1) {
    appendLog(state, 'Heavy Release rejected', thermalBefore, spatialBefore, '需要相邻 Dummy')
    return state
  }
  const direction = hexDirectionBetween(player.position, target.position)!
  const availablePositionM = spatialBefore.mode === 'position'
    && spatialBefore.anchorCellId === keyOf(player.position)
    ? spatialBefore.level
    : 0
  damageDiagnostic(target, coupledInertiaExperimentConfig.heavyRelease.damage)
  let distance = 0
  let mode = 'Damage only'
  if (availablePositionM === 1) {
    distance = coupledInertiaExperimentConfig.heavyRelease.pushDistanceM1
    mode = 'Push'
  } else if (availablePositionM === 2) {
    distance = coupledInertiaExperimentConfig.heavyRelease.pushDistanceM2
    mode = 'Strong Push'
  } else if (availablePositionM >= 3) {
    distance = coupledInertiaExperimentConfig.heavyRelease.launchDistanceM3
    mode = 'Launch'
  }
  const motion = distance > 0 ? forcedMove(state, targetActorId, direction, distance) : undefined
  if (coupledInertiaExperimentConfig.heavyRelease.consumeAllPositionInertia) {
    setActorSpatial(state, 'player', createSpatialInertiaState())
  }
  state.thermal.drift += tuning.heavyReleaseSelfHotwardDrift
  advancePlayerThermal(state, coupledInertiaExperimentConfig.actions.heavyReleaseAt, tuning)
  const queued = processQueuedDummyMove(state)
  appendLog(
    state,
    'Heavy Release',
    thermalBefore,
    spatialBefore,
    `Position M${availablePositionM} → ${mode}${motion ? ` · ${motion.detail}` : ''} · self Drift +${tuning.heavyReleaseSelfHotwardDrift.toFixed(2)}${queued ? ` · ${queued}` : ''}`,
  )
  return state
}

export type DriveFrame = {
  state: CoupledInertiaLabState
  phaseIndex: number
  direction: HexDirection
  detail: string
}

function drivePhase(
  input: CoupledInertiaLabState,
  directionInput: HexDirection,
  tuning: RuntimeTuning,
  phaseIndex: number,
): DriveFrame {
  const state = clone(input)
  const player = getPlayer(state.game)
  const thermalBefore = clone(state.thermal)
  const spatialBefore = clone(actorSpatial(state, 'player'))
  let direction = directionInput
  let destination = hexAdvance(player.position, direction)
  let detail = `Phase ${phaseIndex + 1}`
  const surface = surfaceAt(state.game, destination)

  if (surface === 'hard' || (!traversable(state.game, destination, player.id) && !actorAt(state.game, destination))) {
    const candidates: Array<{ direction: HexDirection; label: string }> = [
      { direction: rotateDirection(direction, -1), label: 'Redirect -60°' },
      { direction: rotateDirection(direction, 1), label: 'Redirect +60°' },
    ]
    const redirect = candidates.find((candidate) => traversable(state.game, hexAdvance(player.position, candidate.direction), player.id))
    if (!redirect) {
      advancePlayerThermal(state, coupledInertiaExperimentConfig.actions.drivePhaseAt, tuning)
      setActorSpatial(state, 'player', reconcileSpatialWithTemperature(actorSpatial(state, 'player'), state.thermal.temperature).spatial)
      appendLog(state, 'Drive Contact', thermalBefore, spatialBefore, `${surface === 'hard' ? 'Hard Crash' : 'Blocked'} · no redirect candidate`)
      return { state, phaseIndex, direction, detail: 'Crash / Stop' }
    }
    direction = redirect.direction
    destination = hexAdvance(player.position, direction)
    detail += ` · ${redirect.label}`
  } else if (surface === 'reflect-left' || surface === 'reflect-right') {
    direction = rotateDirection(direction, surface === 'reflect-left' ? -1 : 1)
    destination = hexAdvance(player.position, direction)
    detail += ` · Bounce ${surface}`
  }

  const occupant = actorAt(state.game, destination)
  if (occupant && occupant.id !== player.id) {
    detail += ` · ${contestCell(state, player.id, occupant.id, direction).detail}`
  } else if (traversable(state.game, destination, player.id)) {
    const origin = { ...player.position }
    player.position = destination
    clearPositionIfAnchorBroken(state, 'player', origin, destination)
    detail += ` · Move ${direction}`
  } else {
    detail += ' · Stop'
  }

  const trace = advancePlayerThermal(state, coupledInertiaExperimentConfig.actions.drivePhaseAt, tuning)
  if (!sameCoord(player.position, hexAdvance(player.position, oppositeDirection(direction)))) {
    setActorSpatial(state, 'player', movementBuild(actorSpatial(state, 'player'), direction, trace, tuning))
  }
  appendLog(state, `Drive · AT Phase ${phaseIndex + 1}`, thermalBefore, spatialBefore, detail)
  return { state, phaseIndex, direction, detail }
}

export function resolveDrive(
  input: CoupledInertiaLabState,
  direction: HexDirection,
  tuning: RuntimeTuning,
): DriveFrame[] {
  const frames: DriveFrame[] = []
  let current = clone(input)
  let currentDirection = direction
  for (let phaseIndex = 0; phaseIndex < coupledInertiaExperimentConfig.actions.drivePhaseCount; phaseIndex += 1) {
    const frame = drivePhase(current, currentDirection, tuning, phaseIndex)
    current = frame.state
    currentDirection = frame.direction
    frames.push(frame)
  }
  const spatial = actorSpatial(current, 'player')
  if (spatial.mode === 'movement' && spatial.level > 0) {
    setActorSpatial(current, 'player', {
      ...spatial,
      pendingLevel: spatial.level,
      chainOpen: true,
    })
    if (frames.length > 0) frames[frames.length - 1] = { ...frames[frames.length - 1], state: clone(current) }
  }
  return frames
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

export function setThermalDebug(
  input: CoupledInertiaLabState,
  patch: Partial<ThermalInertiaState>,
): CoupledInertiaLabState {
  const state = clone(input)
  const current = { ...state.thermal, ...patch }
  current.temperature = clamp(current.temperature, coupledInertiaExperimentConfig.thermal.temperatureMin, coupledInertiaExperimentConfig.thermal.temperatureMax)
  current.setPoint = clamp(current.setPoint, coupledInertiaExperimentConfig.thermal.setPointMin, coupledInertiaExperimentConfig.thermal.setPointMax)
  state.thermal = current
  getPlayer(state.game).bodyTemperature = current.temperature
  return state
}

export function setSpatialDebug(
  input: CoupledInertiaLabState,
  actorId: string,
  patch: Partial<SpatialInertiaState>,
): CoupledInertiaLabState {
  const state = clone(input)
  const next = { ...actorSpatial(state, actorId), ...patch }
  next.level = clampSpatialLevel(next.level)
  next.pendingLevel = clampSpatialLevel(next.pendingLevel)
  if (next.mode === 'movement') next.anchorCellId = null
  if (next.mode === 'position') {
    next.axis = null
    const actor = state.game.actors.find((candidate) => candidate.id === actorId)
    next.anchorCellId = next.anchorCellId ?? (actor ? keyOf(actor.position) : null)
  }
  if (next.mode === 'none') return setSpatialDebug(state, actorId, createSpatialInertiaState())
  setActorSpatial(state, actorId, next)
  return state
}

export function setActorMass(
  input: CoupledInertiaLabState,
  actorId: string,
  mass: Mass,
): CoupledInertiaLabState {
  const state = clone(input)
  const actor = state.game.actors.find((candidate) => candidate.id === actorId)
  if (actor) actor.mass = mass
  return state
}

export function setSelectedActor(input: CoupledInertiaLabState, actorId: string): CoupledInertiaLabState {
  const state = clone(input)
  if (state.game.actors.some((actor) => actor.id === actorId && actor.alive)) state.selectedActorId = actorId
  return state
}

export function setWeapon(input: CoupledInertiaLabState, weapon: WeaponProfile): CoupledInertiaLabState {
  return { ...clone(input), weapon }
}

function configureLabGame(): GameState {
  const game = createHexRoomState(3)
  const center = { x: 3, y: 3 }
  for (const cell of game.cells) {
    if (cell.tags.includes('Void')) continue
    cell.tags = cell.tags.filter((tag) => !['Blocked', 'Mountain', 'Ridge', 'Peak', 'UT3Hard', 'UT3ReflectLeft', 'UT3ReflectRight'].includes(tag))
    cell.groundTemp = 0
    cell.skyTemp = 0
    cell.skyFill = 'clear'
    cell.intents = []
  }
  cellAt(game, hexAdvance(center, 'W', 3))?.tags.push('UT4Hard')
  cellAt(game, hexAdvance(center, 'NW', 3))?.tags.push('UT4ReflectLeft')
  cellAt(game, hexAdvance(center, 'SW', 3))?.tags.push('UT4ReflectRight')

  const player = getPlayer(game)
  player.position = center
  player.name = 'Player'
  player.hp = player.maxHp = 99
  player.bodyTemperature = -4
  player.intent = 'UT4 manual control'

  const dummies = game.actors.filter((actor) => actor.id !== 'player').slice(0, 3)
  const placements: HexDirection[] = ['E', 'NE', 'SE']
  dummies.forEach((actor, index) => {
    actor.name = `Dummy ${String.fromCharCode(65 + index)}`
    actor.faction = 'enemy'
    actor.position = hexAdvance(center, placements[index], index === 0 ? 1 : 2)
    actor.hp = actor.maxHp = 99
    actor.alive = true
    actor.intent = 'AI OFF · Immortal Dummy'
    actor.mass = index === 1 ? 'heavy' : index === 2 ? 'light' : 'normal'
  })
  game.actors = [player, ...dummies]
  game.phase = 'player'
  game.phaseQueue = []
  game.ap = 0
  game.reservedAP = 0
  game.logs = ['[UT4] Coupled Inertia Sandbox · Enemy AI OFF · Invulnerable diagnostics']
  return game
}

export function createCoupledInertiaLabState(): CoupledInertiaLabState {
  const game = configureLabGame()
  const spatialByActorId = Object.fromEntries(game.actors.map((actor) => [actor.id, createSpatialInertiaState()]))
  const thermal: ThermalInertiaState = { temperature: -4, drift: 0, setPoint: 0 }
  getPlayer(game).bodyTemperature = thermal.temperature
  return {
    game,
    worldTimeAt: 0,
    thermal,
    spatialByActorId,
    selectedActorId: 'player',
    weapon: 'hammer',
    logs: [],
    logSequence: 0,
  }
}

export function directionFromPlayerToActor(state: CoupledInertiaLabState, actorId: string): HexDirection | null {
  const actor = state.game.actors.find((candidate) => candidate.id === actorId)
  return actor ? hexDirectionOnLine(getPlayer(state.game).position, actor.position) : null
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
