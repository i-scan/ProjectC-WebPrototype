import {
  actorAt,
  cellAt,
  getPlayer,
  type Actor,
  type Coord,
  type GameState,
} from '../game'
import {
  HEX_DIRECTIONS,
  hexAdvance,
  hexDirectionOnLine,
  hexDistance,
  type HexDirection,
} from './hexTopology'
import {
  actionDefinitionFor,
  type ActionDefinition,
  type ActionPhaseDefinition,
} from './unifiedTimeline'

export type MomentumLevel = 0 | 1 | 2 | 3
export type MomentumImpact = 'normal' | 'push' | 'launch' | 'pierce'
export type MomentumInterruption = 'normal-hit' | 'intercept'
export type MomentumLabPreset =
  | 'chain'
  | 'm0'
  | 'm1'
  | 'm2'
  | 'm3'
  | 'normal-hit'
  | 'intercept'
  | 'hard'
  | 'reflect-left'
  | 'reflect-right'
  | 'brake'

export type SpatialInertiaState = {
  axis: HexDirection | null
  activeMomentum: MomentumLevel
  pendingMomentum: MomentumLevel
  chainOpen: boolean
}

export type DrivePlan = {
  direction: HexDirection
  route: Coord[]
  endpoint: Coord
  valid: boolean
  reason?: string
}

export type RushStrikeTarget = {
  actor: Actor
  direction: HexDirection
  distance: 1 | 2
  route: Coord[]
  chained: boolean
  steeringLoss: MomentumLevel
  brakeRequired: boolean
  momentumAtImpact: MomentumLevel
  impact: MomentumImpact
}

export type EvaluatedAction = {
  definition: ActionDefinition
  phases: ActionPhaseDefinition[]
  actionTimeAt: number
  chained: boolean
  skippedPhaseIds: string[]
  activeMomentumStart: MomentumLevel
  activeMomentumEnd: MomentumLevel
  steeringLoss: MomentumLevel
  brakeRequired: boolean
  impact: MomentumImpact
}

const impactByMomentum: MomentumImpact[] = ['normal', 'push', 'launch', 'pierce']
const UT3_SURFACE_TAGS = ['UT3Hard', 'UT3ReflectLeft', 'UT3ReflectRight'] as const

export function createSpatialInertiaState(overrides: Partial<SpatialInertiaState> = {}): SpatialInertiaState {
  return {
    axis: null,
    activeMomentum: 0,
    pendingMomentum: 0,
    chainOpen: false,
    ...overrides,
  }
}

function clampMomentum(value: number): MomentumLevel {
  return Math.max(0, Math.min(3, Math.round(value))) as MomentumLevel
}

export function impactForMomentum(momentum: MomentumLevel): MomentumImpact {
  return impactByMomentum[momentum]
}

function directionIndex(direction: HexDirection) {
  return HEX_DIRECTIONS.findIndex((entry) => entry.direction === direction)
}

export function directionTurnSteps(from: HexDirection | null, to: HexDirection): 0 | 1 | 2 | 3 {
  if (!from) return 0
  const difference = Math.abs(directionIndex(from) - directionIndex(to))
  return Math.min(difference, 6 - difference) as 0 | 1 | 2 | 3
}

export function steeringMomentumLoss(from: HexDirection | null, to: HexDirection): MomentumLevel {
  const steps = directionTurnSteps(from, to)
  return steps === 1 ? 1 : steps === 2 ? 2 : steps === 3 ? 3 : 0
}

export function evaluateUt3Action(
  actionId: 'drive' | 'rush-strike' | 'brake',
  spatial: SpatialInertiaState,
  direction?: HexDirection,
): EvaluatedAction {
  const definition = actionDefinitionFor(actionId)
  if (!definition) throw new Error(`Unknown UT3 action: ${actionId}`)

  const turnSteps = direction ? directionTurnSteps(spatial.axis, direction) : 0
  const brakeRequired = actionId === 'rush-strike'
    && spatial.chainOpen
    && spatial.pendingMomentum > 0
    && turnSteps === 3
  const steeringLoss = actionId === 'rush-strike' && spatial.chainOpen && direction
    ? steeringMomentumLoss(spatial.axis, direction)
    : 0
  const activeMomentumStart = actionId === 'rush-strike'
    ? clampMomentum(spatial.pendingMomentum - (brakeRequired ? spatial.pendingMomentum : steeringLoss))
    : actionId === 'drive' ? 0 : spatial.activeMomentum
  const canCarry = actionId === 'rush-strike'
    && spatial.chainOpen
    && spatial.pendingMomentum >= 1
    && spatial.axis !== null
    && direction === spatial.axis
    && !brakeRequired
  const skippedPhaseId = canCarry ? definition.intro?.skipPhaseIdWhenChained : undefined
  const phases = skippedPhaseId
    ? definition.phases.filter((phase) => phase.id !== skippedPhaseId)
    : [...definition.phases]

  return {
    definition,
    phases,
    actionTimeAt: phases.reduce((total, phase) => total + phase.durationAt, 0),
    chained: canCarry,
    skippedPhaseIds: skippedPhaseId ? [skippedPhaseId] : [],
    activeMomentumStart,
    activeMomentumEnd: actionId === 'drive' ? 2 : 0,
    steeringLoss,
    brakeRequired,
    impact: impactForMomentum(activeMomentumStart),
  }
}

function isTraversableCell(state: GameState, coord: Coord, ignoreActorId?: string): boolean {
  const cell = cellAt(state, coord)
  const occupant = actorAt(state, coord)
  return Boolean(
    cell
    && !cell.tags.includes('Blocked')
    && !cell.tags.includes('Void')
    && !cell.tags.includes('Mountain')
    && (!occupant || occupant.id === ignoreActorId),
  )
}

export function drivePlanFor(state: GameState, direction: HexDirection): DrivePlan {
  const origin = getPlayer(state).position
  const route = [1, 2, 3].map((steps) => hexAdvance(origin, direction, steps))
  const blockedIndex = route.findIndex((coord) => !isTraversableCell(state, coord))
  return blockedIndex < 0
    ? { direction, route, endpoint: route[2], valid: true }
    : {
        direction,
        route,
        endpoint: route[2],
        valid: false,
        reason: `第 ${blockedIndex + 1} 格被边界、地形或 Actor 阻挡`,
      }
}

export function allDrivePlans(state: GameState): DrivePlan[] {
  return HEX_DIRECTIONS.map(({ direction }) => drivePlanFor(state, direction))
}

export function rushStrikeTargets(
  state: GameState,
  spatial: SpatialInertiaState,
): RushStrikeTarget[] {
  const player = getPlayer(state)
  const targets: RushStrikeTarget[] = []
  for (const { direction } of HEX_DIRECTIONS) {
    const route = [hexAdvance(player.position, direction, 1), hexAdvance(player.position, direction, 2)]
    const firstActor = route
      .map((coord) => actorAt(state, coord))
      .find((actor) => actor?.alive && actor.faction === 'enemy')
    if (!firstActor) continue
    const distance = hexDistance(player.position, firstActor.position) as 1 | 2
    const evaluated = evaluateUt3Action('rush-strike', spatial, direction)
    targets.push({
      actor: firstActor,
      direction,
      distance,
      route: route.slice(0, distance),
      chained: evaluated.chained,
      steeringLoss: evaluated.steeringLoss,
      brakeRequired: evaluated.brakeRequired,
      momentumAtImpact: evaluated.activeMomentumStart,
      impact: evaluated.impact,
    })
  }
  return targets
}

function prependUt3Log(state: GameState, message: string): GameState {
  const next = structuredClone(state)
  next.logs.unshift(`[UT3] ${message}`)
  next.logs = next.logs.slice(0, 120)
  return next
}

function damageActor(actor: Actor, amount: number) {
  actor.hp = Math.max(0, actor.hp - amount)
  actor.alive = actor.hp > 0
}

function rotateDirection(direction: HexDirection, delta: -1 | 1): HexDirection {
  const index = directionIndex(direction)
  return HEX_DIRECTIONS[(index + delta + 6) % 6].direction
}

function surfaceAt(state: GameState, coord: Coord) {
  const tags = cellAt(state, coord)?.tags ?? []
  if (tags.includes('UT3Hard')) return 'hard' as const
  if (tags.includes('UT3ReflectLeft')) return 'reflect-left' as const
  if (tags.includes('UT3ReflectRight')) return 'reflect-right' as const
  return undefined
}

function applyForcedMotion(
  state: GameState,
  target: Actor,
  direction: HexDirection,
  distance: number,
  momentum: MomentumLevel,
): { label: string; path: Coord[] } {
  let currentDirection = direction
  let remaining = distance
  let currentMomentum = momentum
  const path: Coord[] = []
  let secondaryImpactCount = 0
  let result = distance === 1 ? 'Push' : 'Launch'

  while (remaining > 0 && currentMomentum > 0) {
    const nextCoord = hexAdvance(target.position, currentDirection)
    const surface = surfaceAt(state, nextCoord)
    if (surface === 'hard') {
      result = `Crash · Hard Wall · M${currentMomentum}→0`
      break
    }
    if (surface === 'reflect-left' || surface === 'reflect-right') {
      currentMomentum = clampMomentum(currentMomentum - 1)
      currentDirection = rotateDirection(currentDirection, surface === 'reflect-left' ? -1 : 1)
      result = `Bounce · ${surface === 'reflect-left' ? 'Reflect Left' : 'Reflect Right'} · M${currentMomentum}`
      remaining -= 1
      continue
    }
    const secondary = actorAt(state, nextCoord)
    if (secondary && secondary.id !== target.id) {
      if (secondaryImpactCount >= 1) break
      secondaryImpactCount += 1
      damageActor(secondary, 1)
      const secondaryLanding = hexAdvance(secondary.position, currentDirection)
      if (isTraversableCell(state, secondaryLanding, secondary.id)) secondary.position = secondaryLanding
      result = `Secondary Impact · ${secondary.name} 被推 1 格`
      break
    }
    if (!isTraversableCell(state, nextCoord, target.id)) {
      result = `Crash · 路径阻挡 · M${currentMomentum}→0`
      break
    }
    target.position = nextCoord
    path.push({ ...nextCoord })
    remaining -= 1
  }

  return { label: result, path }
}

function applyRushStrike(
  state: GameState,
  evaluated: EvaluatedAction,
  direction: HexDirection,
  targetActorId?: string,
): GameState {
  const next = structuredClone(state)
  const player = getPlayer(next)
  const target = next.actors.find((actor) => actor.id === targetActorId && actor.alive)
  if (!target) return prependUt3Log(next, 'Rush Strike [Strike] · 目标已离开或失效')
  if (evaluated.brakeRequired) return prependUt3Log(next, 'Rush Strike 被 180° 方向承诺阻止 · 必须先 Brake')

  const directionToTarget = hexDirectionOnLine(player.position, target.position)
  const distanceToTarget = hexDistance(player.position, target.position)
  if (directionToTarget !== direction || distanceToTarget < 1 || distanceToTarget > 2) {
    return prependUt3Log(next, 'Rush Strike [Strike] · 目标不在两格内的所选轴线上')
  }

  if (distanceToTarget === 2) {
    const approach = hexAdvance(player.position, direction)
    if (isTraversableCell(next, approach, player.id)) player.position = approach
  }
  damageActor(target, 1)

  let outcome = 'Normal Hit · 基础 Hit Stop'
  if (evaluated.impact === 'push') {
    outcome = applyForcedMotion(next, target, direction, 1, evaluated.activeMomentumStart).label
  } else if (evaluated.impact === 'launch') {
    outcome = `${applyForcedMotion(next, target, direction, 2, evaluated.activeMomentumStart).label} · Arc / Landing`
  } else if (evaluated.impact === 'pierce') {
    const landing = hexAdvance(target.position, direction)
    if (isTraversableCell(next, landing, player.id)) {
      player.position = landing
      outcome = 'Pierce · 穿越目标并落在其后方'
    } else {
      outcome = 'Pierce Crash · 后方落点被阻挡'
    }
  }

  return prependUt3Log(
    next,
    `Rush Strike [Strike] · Active M${evaluated.activeMomentumStart} · ${outcome}${evaluated.chained ? ' · Carry 跳过 Start' : ''}`,
  )
}

function moveAlongAxis(state: GameState, direction: HexDirection, steps: number): GameState {
  const next = structuredClone(state)
  const player = getPlayer(next)
  const route = Array.from({ length: steps }, (_, index) => hexAdvance(player.position, direction, index + 1))
  if (route.some((coord) => !isTraversableCell(next, coord, player.id))) {
    return prependUt3Log(next, `Drive 中止 · ${direction} 路线发生 Contact`)
  }
  player.position = route[route.length - 1]
  return next
}

export function applyUt3ActionPhase(
  state: GameState,
  evaluated: EvaluatedAction,
  phase: ActionPhaseDefinition,
  direction: HexDirection = 'E',
  targetActorId?: string,
): GameState {
  if (evaluated.definition.id === 'drive') {
    const moved = moveAlongAxis(state, direction, phase.movementSteps ?? 0)
    return prependUt3Log(moved, `Drive [${phase.label}] · Axis ${direction} · Active M${phase.momentumAfter ?? 0}`)
  }
  if (evaluated.definition.id === 'rush-strike' && phase.id === 'start') {
    return prependUt3Log(state, 'Rush Strike [Start] · 从静止建立攻击姿态')
  }
  if (evaluated.definition.id === 'rush-strike' && phase.id === 'strike') {
    return applyRushStrike(state, evaluated, direction, targetActorId)
  }
  if (evaluated.definition.id === 'brake') {
    return prependUt3Log(state, `Brake [Skid Stop] · Active/Pending Momentum 清零 · Axis ${state ? '解除' : '解除'}`)
  }
  return prependUt3Log(state, `${evaluated.definition.label} [${phase.label}]`)
}

export function spatialAfterUt3Action(
  evaluated: EvaluatedAction,
  direction?: HexDirection,
): SpatialInertiaState {
  const outro = evaluated.definition.outro
  if (!outro || !outro.opensChainWindow || outro.pendingMomentum === 0) return createSpatialInertiaState()
  return createSpatialInertiaState({
    axis: outro.preserveAxis ? direction ?? null : null,
    pendingMomentum: outro.pendingMomentum,
    chainOpen: true,
  })
}

export function applyMomentumInterruption(
  spatial: SpatialInertiaState,
  kind: MomentumInterruption,
): { spatial: SpatialInertiaState; stopped: boolean; label: string } {
  const loss = kind === 'normal-hit' ? 1 : 2
  const source = spatial.activeMomentum > 0 ? spatial.activeMomentum : spatial.pendingMomentum
  const remaining = clampMomentum(source - loss)
  const stopped = remaining === 0
  return {
    spatial: stopped
      ? createSpatialInertiaState()
      : createSpatialInertiaState({
          ...spatial,
          activeMomentum: spatial.activeMomentum > 0 ? remaining : 0,
          pendingMomentum: spatial.activeMomentum > 0 ? spatial.pendingMomentum : remaining,
        }),
    stopped,
    label: kind === 'normal-hit'
      ? `Normal Hit · 命中并造成伤害 · Momentum ${source}→${remaining}${stopped ? ' · Stop' : ' · Stability 继续'}`
      : `Intercept · Momentum ${source}→${remaining}${stopped ? ' · 轨迹与 Chain 中断' : ' · 仍在推进'}`,
  }
}

function clearLabCell(state: GameState, coord: Coord) {
  const cell = cellAt(state, coord)
  if (!cell) return
  cell.tags = cell.tags.filter((tag) => ![
    'Void', 'Blocked', 'Mountain', 'BlocksSight', 'Ridge', 'Peak',
    ...UT3_SURFACE_TAGS,
  ].includes(tag))
  if (!cell.tags.includes('Room')) cell.tags.push('Room')
  cell.groundFill = 'none'
  cell.groundTemp = 0
}

function markLabSurface(state: GameState, coord: Coord, preset: MomentumLabPreset) {
  clearLabCell(state, coord)
  const cell = cellAt(state, coord)
  if (!cell) return
  if (preset === 'hard') cell.tags.push('UT3Hard')
  if (preset === 'reflect-left') cell.tags.push('UT3ReflectLeft')
  if (preset === 'reflect-right') cell.tags.push('UT3ReflectRight')
}

export function prepareUt3MomentumScenario(
  state: GameState,
  preset: MomentumLabPreset = 'chain',
): { state: GameState; spatial: SpatialInertiaState } {
  const next = structuredClone(state)
  const center = { x: Math.floor(next.config.width / 2), y: Math.floor(next.config.height / 2) }
  for (const cell of next.cells) cell.tags = cell.tags.filter((tag) => !UT3_SURFACE_TAGS.includes(tag as typeof UT3_SURFACE_TAGS[number]))
  for (const direction of HEX_DIRECTIONS.map((entry) => entry.direction)) {
    for (let step = 0; step <= 4; step += 1) clearLabCell(next, hexAdvance(center, direction, step))
  }

  const player = getPlayer(next)
  const dummy = next.actors.find((actor) => actor.id === 'hunter')!
  const interceptor = next.actors.find((actor) => actor.id === 'elite')!
  const normalHit = next.actors.find((actor) => actor.id === 'npc')!
  for (const actor of next.actors) {
    actor.alive = true
    actor.hp = actor.maxHp
  }
  dummy.name = 'Momentum Dummy'
  dummy.intent = '承受 Normal / Push / Launch / Pierce'
  dummy.position = hexAdvance(center, 'E', preset === 'chain' ? 2 : 0)
  interceptor.name = 'Intercept Actor'
  interceptor.intent = 'Intercept：Momentum -2，归零时截断轨迹'
  interceptor.position = hexAdvance(center, 'NW', 2)
  normalHit.name = 'Normal Hit Actor'
  normalHit.intent = 'Normal Hit：造成伤害并使 Momentum -1'
  normalHit.position = hexAdvance(center, 'SW', 2)

  player.position = preset === 'chain' ? hexAdvance(center, 'W', 2) : hexAdvance(center, 'W', 1)
  player.intent = '选择行动卡，再点击棋盘上的高亮落点或 Actor'
  let momentum: MomentumLevel = preset === 'm1' ? 1 : preset === 'm2' ? 2 : preset === 'm3' ? 3 : 0
  if (['hard', 'reflect-left', 'reflect-right', 'normal-hit', 'intercept', 'brake'].includes(preset)) momentum = 2
  let spatial = momentum > 0
    ? createSpatialInertiaState({ axis: 'E', pendingMomentum: momentum, chainOpen: true })
    : createSpatialInertiaState()

  if (preset === 'chain') spatial = createSpatialInertiaState()
  if (preset === 'brake') {
    dummy.position = hexAdvance(player.position, 'W', 1)
    clearLabCell(next, dummy.position)
  }
  if (preset === 'hard' || preset === 'reflect-left' || preset === 'reflect-right') {
    markLabSurface(next, hexAdvance(dummy.position, 'E'), preset)
  }

  next.phase = 'player'
  next.phaseQueue = []
  next.status = 'active'
  next.logs = [`[UT3 Lab] ${preset} 预设已加载；规则结果与 #hex-prototype 共用 actionChain.ts。`, ...next.logs].slice(0, 120)
  return { state: next, spatial }
}
