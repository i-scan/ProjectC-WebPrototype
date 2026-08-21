import experimentConfigJson from '../../config/experiments/val-012-inertia-driving.v7.json'
import { actorAt, cellAt, getPlayer, type Actor, type Coord, type GameState } from '../game'
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
export type NaturalBuildStartMode = 'axis-first' | 'immediate-m1'
export type ThermalBehavior = 'use' | 'resist' | 'generate' | 'passive-dissipation' | 'neutral'
export type ThermalIntent = 'hotward' | 'coldward' | 'balancing' | 'imbalancing' | 'neutral'
export type TurnBias = 'cw' | 'ccw'

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

export type Ut7Setup = {
  boardRadius: number
  spawnEnemies: boolean
}

export type Ut7Settings = {
  naturalBuildStartMode: NaturalBuildStartMode
  launchBrakeMinM: 1 | 2
  buildAfterConversionSameAt: boolean
  hotSideBreakawayAssistEnabled: boolean
}

export type SteeringCellStep = {
  index: number
  from: Coord
  to: Coord
  oldAxis: SpatialAxis | null
  newAxis: SpatialAxis | null
  moveDirection: HexDirection
}

export type SteeringAtTrace = {
  atIndex: number
  beforeM: MomentumLevel
  afterM: MomentumLevel
  beforeAxis: SpatialAxis | null
  afterAxis: SpatialAxis | null
  behavior: ThermalBehavior
  thermalIntent: ThermalIntent
  temperatureBefore: number
  temperatureAfter: number
  driftBefore: number
  driftAfter: number
  cellSteps: SteeringCellStep[]
  detail: string
}

export type Ut7Log = {
  id: number
  timeAt: number
  action: string
  atCost: number
  behavior: ThermalBehavior
  thermalIntent: ThermalIntent
  beforeSpatial: SpatialInertiaState
  afterSpatial: SpatialInertiaState
  beforeThermal: ThermalInertiaState
  afterThermal: ThermalInertiaState
  detail: string
}

export type Ut7State = {
  game: GameState
  worldTimeAt: number
  thermal: ThermalInertiaState
  spatialByActorId: Record<string, SpatialInertiaState>
  continuityByActorId: Record<string, BehaviorContinuity>
  selectedActorId: string
  setup: Ut7Setup
  logs: Ut7Log[]
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
  branch?: TurnBias
  timeline: SteeringAtTrace[]
  result: Ut7State
}

type Config = {
  schemaVersion: string
  rulesetVersion: string
  implementationId: string
  prototypeRoute: string
  thermal: {
    temperatureMin: number
    temperatureMax: number
    setPointMin: number
    setPointMax: number
    hotDomainThreshold: number
    coldDomainThreshold: number
    sideEpsilon: number
    damping: number
    thermalPeriodAt: number
    ambientThermalBias: number
    settleTemperatureEpsilon: number
    settleDriftEpsilon: number
    integrationSubstepsPerAt: number
    behaviorDriftImpulse: number
    balancingDriftRetention: number
  }
  momentum: {
    maxLevel: number
    naturalBuildStartMode: NaturalBuildStartMode
    normalBuildAmount: number
    domainBuildAmount: number
    rebuildReducedMomentumSameAt: boolean
    launchBrakeMinM: 1 | 2
    buildAfterConversionSameAt: boolean
  }
  steering: {
    redirectStepsPerCell: number
    horizontalCellStepsPerAt: number
    m0MoveCellsPerAt: number
    maxPlanningAt: number
    allowReverseBranchChoice: boolean
  }
  breakaway: {
    reductionPerAt: number
    hotSideAssistEnabled: boolean
    hotSideReductionPerAt: number
  }
  passive: { horizontalDissipationPerAt: number }
  weapon: { basicDamage: number; downSpendIncomingM: number }
  conversion: { momentumLoss: number }
  incoming: { maxInjectedM: number }
  playground: {
    minimumRadius: number
    maximumRadius: number
    defaultRadius: number
    spawnEnemiesDefault: boolean
  }
}

export const ut7Config = experimentConfigJson as Config
const directionOrder = HEX_DIRECTIONS.map((entry) => entry.direction)
const clone = <T>(value: T): T => structuredClone(value)
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const sameCoord = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y

export function clampMomentum(value: number): MomentumLevel {
  return clamp(Math.round(value), 0, ut7Config.momentum.maxLevel) as MomentumLevel
}

export function horizontalAxis(dir: HexDirection): SpatialAxis {
  return { kind: 'horizontal', dir }
}

export function downAxis(): SpatialAxis {
  return { kind: 'down' }
}

export function axisEquals(left: SpatialAxis | null, right: SpatialAxis | null) {
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
  return { level: clampMomentum(level), axis: clone(axis) }
}

export function thermalDomainFor(temperature: number): 'cold' | 'neutral' | 'hot' {
  if (temperature <= ut7Config.thermal.coldDomainThreshold) return 'cold'
  if (temperature >= ut7Config.thermal.hotDomainThreshold) return 'hot'
  return 'neutral'
}

export function thermalSideFor(temperature: number, setPoint: number): 'cold' | 'neutral' | 'hot' {
  const offset = temperature - setPoint
  if (offset > ut7Config.thermal.sideEpsilon) return 'hot'
  if (offset < -ut7Config.thermal.sideEpsilon) return 'cold'
  return 'neutral'
}

export function behaviorIntent(behavior: ThermalBehavior): ThermalIntent {
  if (behavior === 'use') return 'coldward'
  if (behavior === 'resist' || behavior === 'generate') return 'hotward'
  if (behavior === 'passive-dissipation') return 'balancing'
  return 'neutral'
}

export function defaultUt7Settings(): Ut7Settings {
  return {
    naturalBuildStartMode: ut7Config.momentum.naturalBuildStartMode,
    launchBrakeMinM: ut7Config.momentum.launchBrakeMinM,
    buildAfterConversionSameAt: ut7Config.momentum.buildAfterConversionSameAt,
    hotSideBreakawayAssistEnabled: ut7Config.breakaway.hotSideAssistEnabled,
  }
}

function spatialFor(state: Ut7State, actorId: string) {
  return state.spatialByActorId[actorId] ?? createSpatialState()
}

function setSpatial(state: Ut7State, actorId: string, spatial: SpatialInertiaState) {
  state.spatialByActorId[actorId] = createSpatialState(spatial.level, spatial.axis)
}

function rememberBehavior(state: Ut7State, actorId: string, axis: SpatialAxis) {
  const current = state.continuityByActorId[actorId] ?? { axis: null, streak: 0 }
  state.continuityByActorId[actorId] = axisEquals(current.axis, axis)
    ? { axis: clone(axis), streak: current.streak + 1 }
    : { axis: clone(axis), streak: 1 }
}

function clearContinuity(state: Ut7State, actorId: string) {
  state.continuityByActorId[actorId] = { axis: null, streak: 0 }
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
    next.temperature = clamp(next.temperature + next.drift * dt, ut7Config.thermal.temperatureMin, ut7Config.thermal.temperatureMax)
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

function applyThermalIntent(state: Ut7State, intent: ThermalIntent) {
  if (intent === 'hotward') state.thermal.drift += ut7Config.thermal.behaviorDriftImpulse
  else if (intent === 'coldward') state.thermal.drift -= ut7Config.thermal.behaviorDriftImpulse
  else if (intent === 'balancing') state.thermal.drift *= ut7Config.thermal.balancingDriftRetention
  state.thermal = advanceThermal(state.thermal, 1)
  state.worldTimeAt += 1
  getPlayer(state.game).bodyTemperature = state.thermal.temperature
}

function matchingSideCap(state: Ut7State, axis: SpatialAxis) {
  const side = thermalSideFor(state.thermal.temperature, state.thermal.setPoint)
  const matching = (axis.kind === 'horizontal' && side === 'hot') || (axis.kind === 'down' && side === 'cold')
  return matching ? ut7Config.momentum.maxLevel : 1
}

function matchingDomain(state: Ut7State, axis: SpatialAxis) {
  const domain = thermalDomainFor(state.thermal.temperature)
  return (axis.kind === 'horizontal' && domain === 'hot') || (axis.kind === 'down' && domain === 'cold')
}

function applyBuild(state: Ut7State, actorId: string, axis: SpatialAxis, settings: Ut7Settings) {
  rememberBehavior(state, actorId, axis)
  const continuity = state.continuityByActorId[actorId] ?? { axis: null, streak: 0 }
  const current = spatialFor(state, actorId)
  if (current.level > 0 && current.axis && !axisEquals(current.axis, axis)) {
    return `Build blocked by existing ${axisLabel(current.axis)} M${current.level}`
  }
  const cap = matchingSideCap(state, axis)
  const domain = matchingDomain(state, axis)
  if (current.level >= cap) return `${domain ? 'Domain efficiency' : 'Side'} cap M${cap}`

  if (current.level === 0) {
    setSpatial(state, actorId, createSpatialState(0, axis))
    if (settings.naturalBuildStartMode === 'axis-first' && continuity.streak < 2) {
      return `Axis First → ${axisLabel(axis)} / M0`
    }
    setSpatial(state, actorId, createSpatialState(1, axis))
    return `Initial Build → ${axisLabel(axis)} M1`
  }

  const amount = domain ? ut7Config.momentum.domainBuildAmount : ut7Config.momentum.normalBuildAmount
  const nextLevel = clampMomentum(Math.min(cap, current.level + amount))
  setSpatial(state, actorId, createSpatialState(nextLevel, axis))
  return `${domain ? `Domain +${amount}` : `Normal +${amount}`} → ${axisLabel(axis)} M${nextLevel}`
}

function appendLog(
  state: Ut7State,
  action: string,
  atCost: number,
  behavior: ThermalBehavior,
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
    behavior,
    thermalIntent: behaviorIntent(behavior),
    beforeSpatial,
    afterSpatial: clone(spatialFor(state, 'player')),
    beforeThermal,
    afterThermal: clone(state.thermal),
    detail,
  })
  state.logs = state.logs.slice(0, 140)
}

function directionIndex(direction: HexDirection) {
  return directionOrder.indexOf(direction)
}

function rotateDirection(direction: HexDirection, delta: number): HexDirection {
  const index = directionIndex(direction)
  return directionOrder[(index + delta + directionOrder.length * 4) % directionOrder.length]
}

function angularDistance(from: HexDirection, to: HexDirection) {
  const diff = Math.abs(directionIndex(from) - directionIndex(to))
  return Math.min(diff, directionOrder.length - diff)
}

function oppositeDirection(direction: HexDirection) {
  return rotateDirection(direction, 3)
}

function bearingCandidates(from: Coord, target: Coord) {
  const currentDistance = hexDistance(from, target)
  return directionOrder.filter((direction) => hexDistance(hexAdvance(from, direction), target) < currentDistance)
}

function chooseTargetBearing(from: Coord, target: Coord, axis?: HexDirection, bias: TurnBias = 'ccw'): HexDirection | null {
  const direct = hexDirectionOnLine(from, target)
  if (direct) return direct
  const candidates = bearingCandidates(from, target)
  if (candidates.length === 0) return null
  if (!axis || candidates.length === 1) return candidates[0]
  const bestDistance = Math.min(...candidates.map((candidate) => angularDistance(axis, candidate)))
  const tied = candidates.filter((candidate) => angularDistance(axis, candidate) === bestDistance)
  if (tied.length === 1) return tied[0]
  return tied.find((candidate) => {
    const diff = (directionIndex(candidate) - directionIndex(axis) + 6) % 6
    return bias === 'ccw' ? diff > 0 && diff <= 3 : diff >= 3
  }) ?? tied[0]
}

function redirectOne(oldDirection: HexDirection, desired: HexDirection, bias: TurnBias) {
  const diff = (directionIndex(desired) - directionIndex(oldDirection) + 6) % 6
  if (diff === 0) return oldDirection
  if (diff === 3) return rotateDirection(oldDirection, bias === 'ccw' ? 1 : -1)
  return rotateDirection(oldDirection, diff < 3 ? 1 : -1)
}

function traceFor(
  state: Ut7State,
  atIndex: number,
  beforeSpatial: SpatialInertiaState,
  beforeThermal: ThermalInertiaState,
  behavior: ThermalBehavior,
  steps: SteeringCellStep[],
  detail: string,
): SteeringAtTrace {
  return {
    atIndex,
    beforeM: beforeSpatial.level,
    afterM: spatialFor(state, 'player').level,
    beforeAxis: clone(beforeSpatial.axis),
    afterAxis: clone(spatialFor(state, 'player').axis),
    behavior,
    thermalIntent: behaviorIntent(behavior),
    temperatureBefore: beforeThermal.temperature,
    temperatureAfter: state.thermal.temperature,
    driftBefore: beforeThermal.drift,
    driftAfter: state.thermal.drift,
    cellSteps: steps,
    detail,
  }
}

type AtResolution = { ok: true; trace: SteeringAtTrace } | { ok: false; reason: string }

function resolveMovementAt(state: Ut7State, target: Coord, settings: Ut7Settings, bias: TurnBias, atIndex: number): AtResolution {
  const player = getPlayer(state.game)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  const steps: SteeringCellStep[] = []

  if (beforeSpatial.level > 0 && beforeSpatial.axis?.kind === 'down') {
    const hotSide = thermalSideFor(state.thermal.temperature, state.thermal.setPoint) === 'hot'
    const reduction = settings.hotSideBreakawayAssistEnabled && hotSide
      ? ut7Config.breakaway.hotSideReductionPerAt
      : ut7Config.breakaway.reductionPerAt
    const nextLevel = clampMomentum(beforeSpatial.level - reduction)
    setSpatial(state, 'player', createSpatialState(nextLevel, downAxis()))
    let detail = `Down Breakaway M${beforeSpatial.level} → M${nextLevel} (${reduction}M/AT)`
    if (nextLevel === 0) {
      const desired = chooseTargetBearing(player.position, target, undefined, bias)
      if (!desired) return { ok: false, reason: 'No horizontal bearing to target after Down Breakaway' }
      const next = hexAdvance(player.position, desired)
      if (!traversable(state.game, next, 'player')) return { ok: false, reason: `Breakaway Move1 blocked toward ${desired}` }
      const from = { ...player.position }
      player.position = next
      steps.push({ index: 1, from, to: { ...next }, oldAxis: downAxis(), newAxis: downAxis(), moveDirection: desired })
      detail += ` · same-AT Move1 ${desired} · no Horizontal Build`
    } else {
      detail += ' · no displacement'
    }
    applyThermalIntent(state, 'hotward')
    clearContinuity(state, 'player')
    appendLog(state, 'Steer / Down Breakaway', 1, 'resist', beforeSpatial, beforeThermal, detail)
    return { ok: true, trace: traceFor(state, atIndex, beforeSpatial, beforeThermal, 'resist', steps, detail) }
  }

  if (beforeSpatial.level > 0 && beforeSpatial.axis?.kind === 'horizontal') {
    const residual = clampMomentum(beforeSpatial.level - 1)
    let currentAxis = beforeSpatial.axis.dir
    setSpatial(state, 'player', createSpatialState(residual, horizontalAxis(currentAxis)))
    let redirected = false
    for (let stepIndex = 0; stepIndex < ut7Config.steering.horizontalCellStepsPerAt; stepIndex += 1) {
      if (sameCoord(player.position, target)) break
      const desired = chooseTargetBearing(player.position, target, currentAxis, bias)
      if (!desired) return { ok: false, reason: 'Unable to resolve Target Bearing' }
      const newDirection = redirectOne(currentAxis, desired, bias)
      if (newDirection !== currentAxis) redirected = true
      const moveDirection = residual > 0 ? currentAxis : newDirection
      const next = hexAdvance(player.position, moveDirection)
      if (!traversable(state.game, next, 'player')) return { ok: false, reason: `Steering path blocked at ${moveDirection}` }
      const from = { ...player.position }
      player.position = next
      setSpatial(state, 'player', createSpatialState(residual, horizontalAxis(newDirection)))
      steps.push({
        index: stepIndex + 1,
        from,
        to: { ...next },
        oldAxis: horizontalAxis(currentAxis),
        newAxis: horizontalAxis(newDirection),
        moveDirection,
      })
      currentAxis = newDirection
    }
    const behavior: ThermalBehavior = redirected ? 'resist' : 'use'
    applyThermalIntent(state, behaviorIntent(behavior))
    rememberBehavior(state, 'player', horizontalAxis(currentAxis))
    const detail = `Horizontal M${beforeSpatial.level} → M${residual} once/AT · Move${steps.length}${redirected ? ' · Redirect/Resist' : ' · Same-axis Use'} · no same-AT refund`
    appendLog(state, 'Steer / Horizontal', 1, behavior, beforeSpatial, beforeThermal, detail)
    return { ok: true, trace: traceFor(state, atIndex, beforeSpatial, beforeThermal, behavior, steps, detail) }
  }

  const oldAxis = beforeSpatial.axis
  const desired = chooseTargetBearing(player.position, target, undefined, bias)
  if (!desired) return { ok: false, reason: 'Unable to resolve M0 Target Bearing' }
  const next = hexAdvance(player.position, desired)
  if (!traversable(state.game, next, 'player')) return { ok: false, reason: `M0 Move1 blocked toward ${desired}` }
  const from = { ...player.position }
  player.position = next
  setSpatial(state, 'player', createSpatialState(0, horizontalAxis(desired)))
  steps.push({ index: 1, from, to: { ...next }, oldAxis: clone(oldAxis), newAxis: horizontalAxis(desired), moveDirection: desired })
  applyThermalIntent(state, 'hotward')
  const build = applyBuild(state, 'player', horizontalAxis(desired), settings)
  const detail = `M0 Move1 ${desired} · Generate/Hotward · ${build}`
  appendLog(state, 'Steer / Generate', 1, 'generate', beforeSpatial, beforeThermal, detail)
  return { ok: true, trace: traceFor(state, atIndex, beforeSpatial, beforeThermal, 'generate', steps, detail) }
}

function invalidPlan(input: Ut7State, id: string, label: string, reason: string, branch?: TurnBias): ActionPlan {
  return { id, label, valid: false, reason, atCost: 0, summary: reason, path: [], branch, timeline: [], result: clone(input) }
}

function buildSteeringPlan(input: Ut7State, target: Coord, settings: Ut7Settings, bias: TurnBias): ActionPlan {
  const targetCell = cellAt(input.game, target)
  if (!targetCell || targetCell.tags.includes('Void')) return invalidPlan(input, 'steer', 'Steer', 'Target is outside the active board', bias)
  const occupant = actorAt(input.game, target)
  if (occupant && occupant.id !== 'player') return invalidPlan(input, 'steer', 'Steer', 'Attack and Move occupancy remain separate', bias)
  const state = clone(input)
  const player = getPlayer(state.game)
  if (sameCoord(player.position, target)) return invalidPlan(input, 'steer', 'Steer', 'Target equals current position', bias)

  const path: Coord[] = []
  const timeline: SteeringAtTrace[] = []
  for (let atIndex = 1; atIndex <= ut7Config.steering.maxPlanningAt; atIndex += 1) {
    if (sameCoord(player.position, target)) break
    const result = resolveMovementAt(state, target, settings, bias, atIndex)
    if (!result.ok) return invalidPlan(input, 'steer', 'Steer', result.reason, bias)
    timeline.push(result.trace)
    path.push(...result.trace.cellSteps.map((step) => ({ ...step.to })))
    if (sameCoord(player.position, target)) break
  }
  if (!sameCoord(player.position, target)) return invalidPlan(input, 'steer', 'Steer', `Target exceeds ${ut7Config.steering.maxPlanningAt} AT planning horizon`, bias)
  const first = spatialFor(input, 'player')
  const last = spatialFor(state, 'player')
  const behaviors = [...new Set(timeline.map((entry) => entry.behavior))].join(' → ')
  return {
    id: 'steer',
    label: 'Steer',
    valid: true,
    reason: '',
    atCost: timeline.length,
    summary: `${axisLabel(first.axis)} M${first.level} → ${axisLabel(last.axis)} M${last.level} · ETA ${timeline.length} AT · ${behaviors}`,
    path,
    branch: bias,
    timeline,
    result: state,
  }
}

export function steeringPlansForTarget(input: Ut7State, target: Coord, settings: Ut7Settings): ActionPlan[] {
  const player = getPlayer(input.game)
  const spatial = spatialFor(input, 'player')
  const direct = hexDirectionOnLine(player.position, target)
  const reverse = spatial.level > 0
    && spatial.axis?.kind === 'horizontal'
    && direct === oppositeDirection(spatial.axis.dir)
    && ut7Config.steering.allowReverseBranchChoice

  if (!reverse) {
    const plan = buildSteeringPlan(input, target, settings, 'ccw')
    return plan.valid ? [plan] : []
  }

  const candidates = (['cw', 'ccw'] as TurnBias[])
    .map((bias) => buildSteeringPlan(input, target, settings, bias))
    .filter((plan) => plan.valid)
  if (candidates.length < 2) return candidates
  const pathKey = (plan: ActionPlan) => plan.path.map((coord) => `${coord.x},${coord.y}`).join('|')
  return pathKey(candidates[0]) === pathKey(candidates[1]) ? [candidates[0]] : candidates
}

function forcedMove(state: Ut7State, actorId: string, direction: HexDirection, distance: number) {
  const actor = actorById(state.game, actorId)
  if (!actor) return 0
  let moved = 0
  for (let index = 0; index < distance; index += 1) {
    const next = hexAdvance(actor.position, direction)
    if (!traversable(state.game, next, actorId)) break
    actor.position = next
    moved += 1
  }
  return moved
}

function applyIncomingMutable(state: Ut7State, actorId: string, direction: HexDirection, incomingValue: number) {
  const incoming = clampMomentum(incomingValue)
  const current = spatialFor(state, actorId)
  if (incoming <= 0) return 'Incoming M0'
  let remaining = incoming
  if (current.level > 0 && current.axis && !axisEquals(current.axis, horizontalAxis(direction))) {
    const cancel = Math.min(current.level, remaining)
    const existingLeft = clampMomentum(current.level - cancel)
    remaining = clampMomentum(remaining - cancel)
    if (existingLeft > 0) {
      setSpatial(state, actorId, createSpatialState(existingLeft, current.axis))
      return `Incoming ${direction} M${incoming} cancels ${cancel}; ${axisLabel(current.axis)} M${existingLeft} survives`
    }
    if (remaining === 0) {
      setSpatial(state, actorId, createSpatialState(0, current.axis))
      return `Incoming ${direction} M${incoming} fully cancels existing M${current.level}`
    }
  }
  const nextLevel = current.level > 0 && axisEquals(current.axis, horizontalAxis(direction))
    ? clampMomentum(current.level + remaining)
    : remaining
  setSpatial(state, actorId, createSpatialState(nextLevel, horizontalAxis(direction)))
  const moved = forcedMove(state, actorId, direction, remaining)
  return `Incoming ${direction} M${incoming} → Remaining M${remaining} → Forced Move ${moved}/${remaining} → Axis ${direction} M${nextLevel}`
}

export function basicAttackPlan(input: Ut7State, targetActorId: string, settings: Ut7Settings): ActionPlan {
  const state = clone(input)
  const player = getPlayer(state.game)
  const target = actorById(state.game, targetActorId)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  if (!target || hexDistance(player.position, target.position) !== 1) return invalidPlan(input, 'basic-attack', 'Basic Attack', 'Target must be adjacent')
  const direction = hexDirectionBetween(player.position, target.position)
  if (!direction) return invalidPlan(input, 'basic-attack', 'Basic Attack', 'Target direction is invalid')

  target.hp = Math.max(1, target.hp - ut7Config.weapon.basicDamage)
  let behavior: ThermalBehavior = 'neutral'
  let detail = `Damage ${ut7Config.weapon.basicDamage}`
  if (beforeSpatial.level > 0 && beforeSpatial.axis?.kind === 'down') {
    const nextLevel = clampMomentum(beforeSpatial.level - 1)
    setSpatial(state, 'player', createSpatialState(nextLevel, downAxis()))
    const incoming = applyIncomingMutable(state, targetActorId, direction, ut7Config.weapon.downSpendIncomingM)
    behavior = 'use'
    detail += ` · Spend 1 Down M → M${nextLevel} · ${incoming}`
    rememberBehavior(state, 'player', downAxis())
  } else if (beforeSpatial.level === 0) {
    setSpatial(state, 'player', createSpatialState(0, downAxis()))
    behavior = 'generate'
    detail += ' · Grounded Generate'
  }
  applyThermalIntent(state, behaviorIntent(behavior))
  if (behavior === 'generate') detail += ` · ${applyBuild(state, 'player', downAxis(), settings)}`
  else if (behavior === 'use') detail += ' · Same-AT Spend Lock: no refund Build'
  appendLog(state, 'Basic Attack', 1, behavior, beforeSpatial, beforeThermal, detail)
  return {
    id: 'basic-attack', label: 'Basic Attack', valid: true, reason: '', atCost: 1,
    summary: `${behavior} · ${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} → ${axisLabel(spatialFor(state, 'player').axis)} M${spatialFor(state, 'player').level}`,
    path: [], timeline: [traceFor(state, 1, beforeSpatial, beforeThermal, behavior, [], detail)], result: state,
  }
}

export function waitPlan(input: Ut7State): ActionPlan {
  const state = clone(input)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  let behavior: ThermalBehavior = 'neutral'
  let detail = 'Wait +1AT'
  if (beforeSpatial.level > 0 && beforeSpatial.axis?.kind === 'horizontal') {
    const nextLevel = clampMomentum(beforeSpatial.level - ut7Config.passive.horizontalDissipationPerAt)
    setSpatial(state, 'player', createSpatialState(nextLevel, beforeSpatial.axis))
    behavior = 'passive-dissipation'
    detail += ` · Horizontal M${beforeSpatial.level} → M${nextLevel} · Axis persists · no Down Build`
    clearContinuity(state, 'player')
  }
  applyThermalIntent(state, behaviorIntent(behavior))
  appendLog(state, 'Wait / Passive Stop', 1, behavior, beforeSpatial, beforeThermal, detail)
  return {
    id: 'wait', label: 'Wait / Passive Stop', valid: true, reason: '', atCost: 1,
    summary: `${behavior} · ${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} → ${axisLabel(spatialFor(state, 'player').axis)} M${spatialFor(state, 'player').level}`,
    path: [], timeline: [traceFor(state, 1, beforeSpatial, beforeThermal, behavior, [], detail)], result: state,
  }
}

export function launchPlan(input: Ut7State, direction: HexDirection, settings: Ut7Settings): ActionPlan {
  const state = clone(input)
  const player = getPlayer(state.game)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  if (beforeSpatial.axis?.kind !== 'down' || beforeSpatial.level < settings.launchBrakeMinM) {
    return invalidPlan(input, 'launch', 'Launch', `Requires Down M${settings.launchBrakeMinM}+`)
  }
  const destination = hexAdvance(player.position, direction)
  if (!traversable(state.game, destination, 'player')) return invalidPlan(input, 'launch', 'Launch', 'Landing cell is blocked')
  const nextLevel = clampMomentum(beforeSpatial.level - ut7Config.conversion.momentumLoss)
  player.position = destination
  setSpatial(state, 'player', createSpatialState(nextLevel, horizontalAxis(direction)))
  applyThermalIntent(state, 'hotward')
  let detail = `Convert Down M${beforeSpatial.level} → ${direction} M${nextLevel} · Move1 · Resist/Hotward`
  if (settings.buildAfterConversionSameAt) detail += ` · ${applyBuild(state, 'player', horizontalAxis(direction), settings)}`
  else detail += ' · Conversion Build OFF'
  appendLog(state, 'Launch', 1, 'resist', beforeSpatial, beforeThermal, detail)
  const step: SteeringCellStep = { index: 1, from: getPlayer(input.game).position, to: { ...destination }, oldAxis: clone(beforeSpatial.axis), newAxis: horizontalAxis(direction), moveDirection: direction }
  return {
    id: 'launch', label: 'Launch', valid: true, reason: '', atCost: 1,
    summary: `Down M${beforeSpatial.level} → ${axisLabel(spatialFor(state, 'player').axis)} M${spatialFor(state, 'player').level}`,
    path: [{ ...destination }], timeline: [traceFor(state, 1, beforeSpatial, beforeThermal, 'resist', [step], detail)], result: state,
  }
}

export function brakePlan(input: Ut7State, settings: Ut7Settings): ActionPlan {
  const state = clone(input)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  if (beforeSpatial.axis?.kind !== 'horizontal' || beforeSpatial.level < settings.launchBrakeMinM) {
    return invalidPlan(input, 'brake', 'Brake', `Requires Horizontal M${settings.launchBrakeMinM}+`)
  }
  const nextLevel = clampMomentum(beforeSpatial.level - ut7Config.conversion.momentumLoss)
  setSpatial(state, 'player', createSpatialState(nextLevel, downAxis()))
  applyThermalIntent(state, 'hotward')
  let detail = `Convert ${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} → Down M${nextLevel} · Resist/Hotward`
  if (settings.buildAfterConversionSameAt) detail += ` · ${applyBuild(state, 'player', downAxis(), settings)}`
  else detail += ' · Conversion Build OFF'
  appendLog(state, 'Brake', 1, 'resist', beforeSpatial, beforeThermal, detail)
  return {
    id: 'brake', label: 'Brake', valid: true, reason: '', atCost: 1,
    summary: `${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} → Down M${spatialFor(state, 'player').level}`,
    path: [], timeline: [traceFor(state, 1, beforeSpatial, beforeThermal, 'resist', [], detail)], result: state,
  }
}

export function injectIncomingPlan(input: Ut7State, actorId: string, direction: HexDirection, strength: MomentumLevel): ActionPlan {
  const state = clone(input)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  const detail = applyIncomingMutable(state, actorId, direction, strength)
  appendLog(state, `Debug Incoming → ${actorId}`, 0, 'neutral', beforeSpatial, beforeThermal, detail)
  return {
    id: 'inject-incoming', label: 'Inject Incoming', valid: true, reason: '', atCost: 0,
    summary: detail, path: [], timeline: [], result: state,
  }
}

export function debugBuildProbePlan(input: Ut7State, axis: SpatialAxis, settings: Ut7Settings): ActionPlan {
  const state = clone(input)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  applyThermalIntent(state, 'neutral')
  const build = applyBuild(state, 'player', axis, settings)
  const detail = `Debug compatible Build probe · ${build}`
  appendLog(state, 'Debug Build Probe', 1, 'neutral', beforeSpatial, beforeThermal, detail)
  return {
    id: 'debug-build', label: 'Debug Build Probe', valid: true, reason: '', atCost: 1,
    summary: detail, path: [], timeline: [traceFor(state, 1, beforeSpatial, beforeThermal, 'neutral', [], detail)], result: state,
  }
}

export function setThermalDebug(input: Ut7State, patch: Partial<ThermalInertiaState>) {
  const state = clone(input)
  state.thermal = {
    temperature: clamp(patch.temperature ?? state.thermal.temperature, ut7Config.thermal.temperatureMin, ut7Config.thermal.temperatureMax),
    drift: patch.drift ?? state.thermal.drift,
    setPoint: clamp(patch.setPoint ?? state.thermal.setPoint, ut7Config.thermal.setPointMin, ut7Config.thermal.setPointMax),
  }
  getPlayer(state.game).bodyTemperature = state.thermal.temperature
  return state
}

export function setSpatialDebug(input: Ut7State, actorId: string, spatial: SpatialInertiaState) {
  const state = clone(input)
  setSpatial(state, actorId, spatial)
  clearContinuity(state, actorId)
  return state
}

export function setSelectedActor(input: Ut7State, actorId: string) {
  const state = clone(input)
  if (state.game.actors.some((actor) => actor.id === actorId)) state.selectedActorId = actorId
  return state
}

export type Ut7Preset = 'neutral' | 'm1-east' | 'm2-east' | 'm3-east' | 'cold-down'

export function applyPreset(input: Ut7State, preset: Ut7Preset) {
  let state = createUt7State(input.setup)
  if (preset === 'm1-east') state = setSpatialDebug(state, 'player', createSpatialState(1, horizontalAxis('E')))
  if (preset === 'm2-east') state = setSpatialDebug(state, 'player', createSpatialState(2, horizontalAxis('E')))
  if (preset === 'm3-east') state = setSpatialDebug(state, 'player', createSpatialState(3, horizontalAxis('E')))
  if (preset === 'cold-down') {
    state = setThermalDebug(state, { temperature: -4, drift: 0, setPoint: 1 })
    state = setSpatialDebug(state, 'player', createSpatialState(3, downAxis()))
  }
  return state
}

function cleanCellTags(game: GameState) {
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
}

function nearestLegalCell(game: GameState, preferred: Coord, occupied: Coord[]) {
  const candidates = game.cells
    .filter((cell) => !cell.tags.includes('Void') && !cell.tags.includes('Blocked') && !cell.tags.includes('Mountain'))
    .map((cell) => cell.coord)
    .filter((coord) => !occupied.some((entry) => sameCoord(entry, coord)))
    .sort((a, b) => hexDistance(a, preferred) - hexDistance(b, preferred))
  return candidates[0]
}

function configurePlaygroundGame(radius: number, spawnEnemies: boolean, playerPosition?: Coord): GameState {
  const game = createHexRoomState(radius)
  cleanCellTags(game)
  const center = { x: radius, y: radius }
  const player = getPlayer(game)
  const preferredPlayer = playerPosition && cellAt(game, playerPosition) && !cellAt(game, playerPosition)?.tags.includes('Void')
    ? playerPosition
    : center
  player.position = { ...preferredPlayer }
  player.name = 'Player'
  player.hp = player.maxHp = 12
  player.bodyTemperature = 1
  player.intent = 'UT7 Target-driven Steering'

  const templates = game.actors.filter((actor) => actor.id !== 'player')
  game.actors = [player]
  if (spawnEnemies && templates.length > 0) {
    const placements: Array<{ dir: HexDirection; distance: number }> = [
      { dir: 'E', distance: 3 },
      { dir: 'NE', distance: 2 },
      { dir: 'SE', distance: 3 },
      { dir: 'W', distance: 2 },
    ]
    const occupied: Coord[] = [{ ...player.position }]
    placements.forEach((placement, index) => {
      const template = templates[index % templates.length]
      const actor: Actor = clone(template)
      actor.id = `ut7-dummy-${index + 1}`
      actor.name = `Dummy ${String.fromCharCode(65 + index)}`
      actor.faction = 'enemy'
      actor.hp = actor.maxHp = 20
      actor.shield = 0
      actor.alive = true
      actor.intent = 'AI OFF · UT7 fixture'
      const preferred = hexAdvance(center, placement.dir, placement.distance)
      const position = nearestLegalCell(game, preferred, occupied)
      if (!position) return
      actor.position = { ...position }
      occupied.push({ ...position })
      game.actors.push(actor)
    })
  }
  game.phase = 'player'
  game.phaseQueue = []
  game.ap = 0
  game.reservedAP = 0
  game.logs = ['[UT7] Inertia Driving Playground · AI OFF']
  game.status = 'active'
  return game
}

export function createUt7State(setupInput?: Partial<Ut7Setup>): Ut7State {
  const setup: Ut7Setup = {
    boardRadius: clamp(Math.round(setupInput?.boardRadius ?? ut7Config.playground.defaultRadius), ut7Config.playground.minimumRadius, ut7Config.playground.maximumRadius),
    spawnEnemies: setupInput?.spawnEnemies ?? ut7Config.playground.spawnEnemiesDefault,
  }
  const game = configurePlaygroundGame(setup.boardRadius, setup.spawnEnemies)
  return {
    game,
    worldTimeAt: 0,
    thermal: { temperature: 1, drift: 0, setPoint: 1 },
    spatialByActorId: Object.fromEntries(game.actors.map((actor) => [actor.id, createSpatialState()])),
    continuityByActorId: Object.fromEntries(game.actors.map((actor) => [actor.id, { axis: null, streak: 0 }])),
    selectedActorId: 'player',
    setup,
    logs: [],
    logSequence: 0,
  }
}

export function reconfigureUt7State(input: Ut7State, patch: Partial<Ut7Setup>) {
  const nextSetup = { ...input.setup, ...patch }
  if (nextSetup.boardRadius !== input.setup.boardRadius) return createUt7State(nextSetup)
  const oldPlayer = getPlayer(input.game)
  const next = createUt7State(nextSetup)
  next.game = configurePlaygroundGame(nextSetup.boardRadius, nextSetup.spawnEnemies, oldPlayer.position)
  const nextPlayer = getPlayer(next.game)
  nextPlayer.hp = oldPlayer.hp
  nextPlayer.maxHp = oldPlayer.maxHp
  nextPlayer.bodyTemperature = oldPlayer.bodyTemperature
  next.worldTimeAt = input.worldTimeAt
  next.thermal = clone(input.thermal)
  next.spatialByActorId.player = clone(input.spatialByActorId.player ?? createSpatialState())
  next.continuityByActorId.player = clone(input.continuityByActorId.player ?? { axis: null, streak: 0 })
  for (const actor of next.game.actors.filter((actor) => actor.id !== 'player')) {
    next.spatialByActorId[actor.id] = createSpatialState()
    next.continuityByActorId[actor.id] = { axis: null, streak: 0 }
  }
  next.logs = clone(input.logs)
  next.logSequence = input.logSequence
  next.selectedActorId = 'player'
  return next
}
