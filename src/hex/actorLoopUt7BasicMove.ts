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
  hexDirectionOnLine,
  hexDistance,
  type HexDirection,
} from './hexTopology'

const directionOrder = HEX_DIRECTIONS.map((entry) => entry.direction)
const clone = <T>(value: T): T => structuredClone(value)
const sameCoord = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y

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

function makeTrace(
  state: Ut7State,
  beforeSpatial: SpatialInertiaState,
  beforeThermal: ThermalInertiaState,
  behavior: ThermalBehavior,
  cellSteps: SteeringAtTrace['cellSteps'],
  detail: string,
): SteeringAtTrace {
  const afterSpatial = spatialFor(state, 'player')
  return {
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
    cellSteps,
    detail,
  }
}

function buildBasicMovePlan(
  input: Ut7State,
  target: Coord,
  settings: Ut7Settings,
  bias: TurnBias,
): ActionPlan {
  const state = clone(input)
  const player = getPlayer(state.game)
  const beforePosition = clone(player.position)
  const beforeSpatial = clone(spatialFor(state, 'player'))
  const beforeThermal = clone(state.thermal)
  const path: Coord[] = []
  const cellSteps: SteeringAtTrace['cellSteps'] = []
  let behavior: ThermalBehavior = 'generate'
  let detail = `Intent (${target.x},${target.y})`

  if (beforeSpatial.level > 0 && beforeSpatial.axis?.kind === 'down') {
    const hotSide = thermalSideFor(state.thermal.temperature, state.thermal.setPoint) === 'hot'
    const reduction = settings.hotSideBreakawayAssistEnabled && hotSide
      ? ut7Config.breakaway.hotSideReductionPerAt
      : ut7Config.breakaway.reductionPerAt
    const nextLevel = clampMomentum(beforeSpatial.level - reduction)
    setSpatial(state, 'player', createSpatialState(nextLevel, downAxis()))
    behavior = 'resist'
    detail += ` · Down Breakaway M${beforeSpatial.level} → M${nextLevel}`

    if (nextLevel === 0) {
      const desired = chooseTargetBearing(player.position, target, undefined, bias)
      if (!desired) return invalidPlan(input, 'No horizontal bearing after Down Breakaway', bias)
      const next = hexAdvance(player.position, desired)
      if (!traversable(state, next)) return invalidPlan(input, `Breakaway path blocked toward ${desired}`, bias)
      const from = clone(player.position)
      player.position = next
      path.push(clone(next))
      cellSteps.push({ index: 1, from, to: clone(next), oldAxis: downAxis(), newAxis: downAxis(), moveDirection: desired })
      detail += ` · same-AT Move1 ${desired} · no Horizontal Build`
    } else {
      detail += ' · no displacement this AT'
    }

    applyThermalIntent(state, behavior)
    clearContinuity(state, 'player')
  } else if (beforeSpatial.level > 0 && beforeSpatial.axis?.kind === 'horizontal') {
    const residual = clampMomentum(beforeSpatial.level - 1)
    let currentAxis = beforeSpatial.axis.dir
    setSpatial(state, 'player', createSpatialState(residual, horizontalAxis(currentAxis)))
    let redirected = false

    for (let stepIndex = 0; stepIndex < ut7Config.steering.horizontalCellStepsPerAt; stepIndex += 1) {
      if (sameCoord(player.position, target)) break
      const desired = chooseTargetBearing(player.position, target, currentAxis, bias)
      if (!desired) return invalidPlan(input, 'Unable to resolve Target Bearing', bias)
      const newDirection = redirectOne(currentAxis, desired, bias)
      if (newDirection !== currentAxis) redirected = true
      const moveDirection = residual > 0 ? currentAxis : newDirection
      const next = hexAdvance(player.position, moveDirection)
      if (!traversable(state, next)) return invalidPlan(input, `Steering path blocked at ${moveDirection}`, bias)
      const from = clone(player.position)
      player.position = next
      setSpatial(state, 'player', createSpatialState(residual, horizontalAxis(newDirection)))
      path.push(clone(next))
      cellSteps.push({
        index: stepIndex + 1,
        from,
        to: clone(next),
        oldAxis: horizontalAxis(currentAxis),
        newAxis: horizontalAxis(newDirection),
        moveDirection,
      })
      currentAxis = newDirection
    }

    behavior = redirected ? 'resist' : 'use'
    applyThermalIntent(state, behavior)
    rememberBehavior(state, 'player', horizontalAxis(currentAxis))
    detail += ` · Horizontal M${beforeSpatial.level} → M${residual} once/AT · Move${path.length}${redirected ? ' · Redirect/Resist' : ' · Same-axis Use'} · same-AT no refund`
  } else {
    const desired = chooseTargetBearing(player.position, target, undefined, bias)
    if (!desired) return invalidPlan(input, 'Unable to resolve M0 Target Bearing', bias)
    const next = hexAdvance(player.position, desired)
    if (!traversable(state, next)) return invalidPlan(input, `Basic Move path blocked toward ${desired}`, bias)
    const from = clone(player.position)
    player.position = next
    path.push(clone(next))
    setSpatial(state, 'player', createSpatialState(0, horizontalAxis(desired)))
    behavior = 'generate'
    applyThermalIntent(state, behavior)
    const build = applyBuild(state, horizontalAxis(desired), settings)
    cellSteps.push({ index: 1, from, to: clone(next), oldAxis: clone(beforeSpatial.axis), newAxis: horizontalAxis(desired), moveDirection: desired })
    detail += ` · Move1 ${desired} · Generate/Hotward · ${build}`
  }

  appendLog(state, 'Basic Move', behavior, beforeSpatial, beforeThermal, detail)
  const afterSpatial = spatialFor(state, 'player')
  const afterPosition = getPlayer(state.game).position
  const trace = makeTrace(state, beforeSpatial, beforeThermal, behavior, cellSteps, detail)

  return {
    id: 'basic-move',
    label: 'Basic Move',
    valid: true,
    reason: '',
    atCost: 1,
    summary: `Intent (${target.x},${target.y}) · ${path.length > 0 ? `Path ${path.length} Cell${path.length > 1 ? 's' : ''} → (${afterPosition.x},${afterPosition.y})` : `Hold (${beforePosition.x},${beforePosition.y})`} · ${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} → ${axisLabel(afterSpatial.axis)} M${afterSpatial.level}`,
    path,
    branch: bias,
    timeline: [trace],
    result: state,
  }
}

export function basicMoveIntentRadius(input: Ut7State) {
  const spatial = spatialFor(input, 'player')
  return spatial.level > 0 && spatial.axis?.kind === 'horizontal'
    ? ut7Config.steering.horizontalCellStepsPerAt
    : ut7Config.steering.m0MoveCellsPerAt
}

export function basicMovePlansForTarget(input: Ut7State, target: Coord, settings: Ut7Settings): ActionPlan[] {
  const player = getPlayer(input.game)
  const distance = hexDistance(player.position, target)
  if (distance < 1 || distance > basicMoveIntentRadius(input)) return []

  const targetCell = cellAt(input.game, target)
  if (!targetCell || targetCell.tags.some((tag) => tag === 'Void' || tag === 'Blocked' || tag === 'Mountain')) return []
  if (actorAt(input.game, target)) return []

  const spatial = spatialFor(input, 'player')
  const direct = hexDirectionOnLine(player.position, target)
  const reverse = spatial.level > 0
    && spatial.axis?.kind === 'horizontal'
    && direct === oppositeDirection(spatial.axis.dir)
    && ut7Config.steering.allowReverseBranchChoice

  if (!reverse) {
    const plan = buildBasicMovePlan(input, target, settings, 'ccw')
    return plan.valid ? [plan] : []
  }

  const candidates = (['cw', 'ccw'] as TurnBias[])
    .map((bias) => buildBasicMovePlan(input, target, settings, bias))
    .filter((plan) => plan.valid)
  if (candidates.length < 2) return candidates
  const signature = (plan: ActionPlan) => `${plan.path.map((coord) => `${coord.x},${coord.y}`).join('|')}::${axisLabel(plan.timeline[0]?.afterAxis ?? null)}`
  return signature(candidates[0]) === signature(candidates[1]) ? [candidates[0]] : candidates
}

export function basicMoveTargetCoords(input: Ut7State, settings: Ut7Settings): Coord[] {
  const player = getPlayer(input.game)
  const radius = basicMoveIntentRadius(input)
  return input.game.cells
    .filter((cell) => {
      const distance = hexDistance(player.position, cell.coord)
      return distance >= 1 && distance <= radius
    })
    .map((cell) => clone(cell.coord))
    .filter((coord) => basicMovePlansForTarget(input, coord, settings).length > 0)
}
