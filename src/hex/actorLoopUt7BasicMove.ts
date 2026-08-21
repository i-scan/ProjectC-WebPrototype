import { actorAt, cellAt, getPlayer, type Coord } from '../game'
import {
  axisEquals,
  axisLabel,
  behaviorIntent,
  clampMomentum,
  createSpatialState,
  downAxis,
  horizontalAxis,
  thermalDomainFor,
  thermalSideFor,
  ut7Config,
  type ActionPlan,
  type SpatialAxis,
  type SpatialInertiaState,
  type SteeringAtTrace,
  type ThermalBehavior,
  type ThermalInertiaState,
  type TurnBias,
  type Ut7Settings,
  type Ut7State,
} from './actorLoopUt7'
import {
  HEX_DIRECTIONS,
  hexAdvance,
  hexDirectionBetween,
  hexDistance,
  type HexDirection,
} from './hexTopology'

const directionOrder = HEX_DIRECTIONS.map((entry) => entry.direction)
const clone = <T>(value: T): T => structuredClone(value)

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

function traversable(state: Ut7State, coord: Coord) {
  const cell = cellAt(state.game, coord)
  if (!cell || cell.tags.some((tag) => tag === 'Void' || tag === 'Blocked' || tag === 'Mountain')) return false
  const occupant = actorAt(state.game, coord)
  return !occupant || occupant.id === 'player'
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

function applyThermalIntent(state: Ut7State, behavior: ThermalBehavior) {
  const intent = behaviorIntent(behavior)
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

function applyBuild(state: Ut7State, axis: SpatialAxis, settings: Ut7Settings) {
  rememberBehavior(state, 'player', axis)
  const continuity = state.continuityByActorId.player ?? { axis: null, streak: 0 }
  const current = spatialFor(state, 'player')
  if (current.level > 0 && current.axis && !axisEquals(current.axis, axis)) {
    return `Build blocked by existing ${axisLabel(current.axis)} M${current.level}`
  }

  const cap = matchingSideCap(state, axis)
  const domain = matchingDomain(state, axis)
  if (current.level >= cap) return `${domain ? 'Domain efficiency' : 'Side'} cap M${cap}`

  if (current.level === 0) {
    setSpatial(state, 'player', createSpatialState(0, axis))
    if (settings.naturalBuildStartMode === 'axis-first' && continuity.streak < 2) {
      return `Axis First → ${axisLabel(axis)} / M0`
    }
    setSpatial(state, 'player', createSpatialState(1, axis))
    return `Initial Build → ${axisLabel(axis)} M1`
  }

  const amount = domain ? ut7Config.momentum.domainBuildAmount : ut7Config.momentum.normalBuildAmount
  const nextLevel = clampMomentum(Math.min(cap, current.level + amount))
  setSpatial(state, 'player', createSpatialState(nextLevel, axis))
  return `${domain ? `Domain +${amount}` : `Normal +${amount}`} → ${axisLabel(axis)} M${nextLevel}`
}

function appendLog(
  state: Ut7State,
  action: string,
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
    atCost: 1,
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

function oppositeDirection(direction: HexDirection) {
  return rotateDirection(direction, 3)
}

function redirectOne(oldDirection: HexDirection, desired: HexDirection, bias: TurnBias) {
  const diff = (directionIndex(desired) - directionIndex(oldDirection) + 6) % 6
  if (diff === 0) return oldDirection
  if (diff === 3) return rotateDirection(oldDirection, bias === 'ccw' ? 1 : -1)
  return rotateDirection(oldDirection, diff < 3 ? 1 : -1)
}

function traceFor(
  state: Ut7State,
  beforeSpatial: SpatialInertiaState,
  beforeThermal: ThermalInertiaState,
  behavior: ThermalBehavior,
  path: Coord[],
  oldAxis: SpatialAxis | null,
  moveDirection: HexDirection | null,
  detail: string,
): SteeringAtTrace {
  const after = spatialFor(state, 'player')
  return {
    atIndex: 1,
    beforeM: beforeSpatial.level,
    afterM: after.level,
    beforeAxis: clone(beforeSpatial.axis),
    afterAxis: clone(after.axis),
    behavior,
    thermalIntent: behaviorIntent(behavior),
    temperatureBefore: beforeThermal.temperature,
    temperatureAfter: state.thermal.temperature,
    driftBefore: beforeThermal.drift,
    driftAfter: state.thermal.drift,
    cellSteps: path.map((to, index) => ({
      index: index + 1,
      from: index === 0 ? clone(getPlayer(state.game).position) : clone(path[index - 1]),
      to: clone(to),
      oldAxis: clone(oldAxis),
      newAxis: clone(after.axis),
      moveDirection: moveDirection ?? 'E',
    })),
    detail,
  }
}

function invalidPlan(input: Ut7State, reason: string, branch?: TurnBias): ActionPlan {
  return {
    id: 'basic-move',
    label: 'Basic Move',
    valid: false,
    reason,
    atCost: 0,
    summary: reason,
    path: [],
    branch,
    timeline: [],
    result: clone(input),
  }
}

function buildBasicMovePlan(
  input: Ut7State,
  intendedDirection: HexDirection,
  settings: Ut7Settings,
  bias: TurnBias,
): ActionPlan {
  const state = clone(input)
  const player = getPlayer(state.game)
  const beforePosition = clone(player.position)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  const path: Coord[] = []
  let behavior: ThermalBehavior = 'generate'
  let detail = ''
  let actualDirection: HexDirection | null = null

  if (beforeSpatial.level > 0 && beforeSpatial.axis?.kind === 'down') {
    const hotSide = thermalSideFor(state.thermal.temperature, state.thermal.setPoint) === 'hot'
    const reduction = settings.hotSideBreakawayAssistEnabled && hotSide
      ? ut7Config.breakaway.hotSideReductionPerAt
      : ut7Config.breakaway.reductionPerAt
    const nextLevel = clampMomentum(beforeSpatial.level - reduction)
    setSpatial(state, 'player', createSpatialState(nextLevel, downAxis()))
    behavior = 'resist'
    detail = `Intent ${intendedDirection} · Down Breakaway M${beforeSpatial.level} → M${nextLevel}`
    if (nextLevel === 0) {
      const next = hexAdvance(player.position, intendedDirection)
      if (traversable(state, next)) {
        player.position = next
        path.push(clone(next))
        actualDirection = intendedDirection
        detail += ` · Move1 ${intendedDirection}`
      } else {
        detail += ' · resolved move blocked'
      }
    } else {
      detail += ' · no displacement this AT'
    }
    applyThermalIntent(state, behavior)
    clearContinuity(state, 'player')
  } else if (beforeSpatial.level > 0 && beforeSpatial.axis?.kind === 'horizontal') {
    const residual = clampMomentum(beforeSpatial.level - 1)
    const oldDirection = beforeSpatial.axis.dir
    const newDirection = redirectOne(oldDirection, intendedDirection, bias)
    const redirected = newDirection !== oldDirection
    actualDirection = residual > 0 ? oldDirection : newDirection
    const next = hexAdvance(player.position, actualDirection)
    setSpatial(state, 'player', createSpatialState(residual, horizontalAxis(newDirection)))
    behavior = redirected ? 'resist' : 'use'
    if (traversable(state, next)) {
      player.position = next
      path.push(clone(next))
      detail = `Intent ${intendedDirection} · Horizontal M${beforeSpatial.level} → M${residual} · Axis ${oldDirection} → ${newDirection} · Move1 ${actualDirection}`
    } else {
      detail = `Intent ${intendedDirection} · Horizontal M${beforeSpatial.level} → M${residual} · Axis ${oldDirection} → ${newDirection} · actual ${actualDirection} blocked · no auto-detour`
    }
    applyThermalIntent(state, behavior)
    rememberBehavior(state, 'player', horizontalAxis(newDirection))
    detail += ' · Spend once / same-AT no refund'
  } else {
    const next = hexAdvance(player.position, intendedDirection)
    if (!traversable(state, next)) return invalidPlan(input, `Basic Move ${intendedDirection} is blocked`, bias)
    actualDirection = intendedDirection
    player.position = next
    path.push(clone(next))
    setSpatial(state, 'player', createSpatialState(0, horizontalAxis(intendedDirection)))
    behavior = 'generate'
    applyThermalIntent(state, behavior)
    const build = applyBuild(state, horizontalAxis(intendedDirection), settings)
    detail = `Intent ${intendedDirection} · Move1 ${intendedDirection} · Generate/Hotward · ${build}`
  }

  appendLog(state, 'Basic Move', behavior, beforeSpatial, beforeThermal, detail)
  const afterSpatial = spatialFor(state, 'player')
  const trace: SteeringAtTrace = {
    atIndex: 1,
    beforeM: beforeSpatial.level,
    afterM: afterSpatial.level,
    beforeAxis: clone(beforeSpatial.axis),
    afterAxis: clone(afterSpatial.axis),
    behavior,
    thermalIntent: behaviorIntent(behavior),
    temperatureBefore: beforeThermal.temperature,
    temperatureAfter: state.thermal.temperature,
    driftBefore: beforeThermal.drift,
    driftAfter: state.thermal.drift,
    cellSteps: path.map((to, index) => ({
      index: index + 1,
      from: index === 0 ? beforePosition : clone(path[index - 1]),
      to: clone(to),
      oldAxis: clone(beforeSpatial.axis),
      newAxis: clone(afterSpatial.axis),
      moveDirection: actualDirection ?? intendedDirection,
    })),
    detail,
  }

  return {
    id: 'basic-move',
    label: 'Basic Move',
    valid: true,
    reason: '',
    atCost: 1,
    summary: `Intent ${intendedDirection} · ${path.length > 0 ? `Move1 ${actualDirection}` : 'No Move'} · ${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} → ${axisLabel(afterSpatial.axis)} M${afterSpatial.level}`,
    path,
    branch: bias,
    timeline: [trace],
    result: state,
  }
}

export function basicMovePlansForTarget(input: Ut7State, target: Coord, settings: Ut7Settings): ActionPlan[] {
  const player = getPlayer(input.game)
  if (hexDistance(player.position, target) !== 1) return []
  const targetCell = cellAt(input.game, target)
  if (!targetCell || targetCell.tags.some((tag) => tag === 'Void' || tag === 'Blocked' || tag === 'Mountain')) return []
  if (actorAt(input.game, target)) return []
  const intendedDirection = hexDirectionBetween(player.position, target)
  if (!intendedDirection) return []

  const spatial = spatialFor(input, 'player')
  const reverse = spatial.level > 0
    && spatial.axis?.kind === 'horizontal'
    && intendedDirection === oppositeDirection(spatial.axis.dir)
    && ut7Config.steering.allowReverseBranchChoice

  if (!reverse) return [buildBasicMovePlan(input, intendedDirection, settings, 'ccw')]

  const candidates = (['cw', 'ccw'] as TurnBias[])
    .map((bias) => buildBasicMovePlan(input, intendedDirection, settings, bias))
    .filter((plan) => plan.valid)
  const signature = (plan: ActionPlan) => `${plan.path.map((coord) => `${coord.x},${coord.y}`).join('|')}::${axisLabel(plan.timeline[0]?.afterAxis ?? null)}`
  if (candidates.length === 2 && signature(candidates[0]) === signature(candidates[1])) return [candidates[0]]
  return candidates
}
