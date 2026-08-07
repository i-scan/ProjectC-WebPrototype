import {
  actorAt,
  cellAt,
  getPlayer,
  type Actor,
  type Coord,
  type GameState,
} from '../game'
import { performHexBasicAction } from './hexRules'
import {
  HEX_DIRECTIONS,
  hexAdvance,
  hexDirectionBetween,
  type HexDirection,
} from './hexTopology'
import {
  actionDefinitionFor,
  type ActionDefinition,
  type ActionPhaseDefinition,
} from './unifiedTimeline'

export type SpatialInertiaState = {
  axis: HexDirection | null
  pendingMomentum: 0 | 1 | 2 | 3
  chainOpen: boolean
}

export type DrivePlan = {
  direction: HexDirection
  route: Coord[]
  valid: boolean
  reason?: string
}

export type RushStrikeTarget = {
  actor: Actor
  direction: HexDirection
  chained: boolean
}

export type EvaluatedAction = {
  definition: ActionDefinition
  phases: ActionPhaseDefinition[]
  actionTimeAt: number
  chained: boolean
  skippedPhaseIds: string[]
}

export function createSpatialInertiaState(): SpatialInertiaState {
  return { axis: null, pendingMomentum: 0, chainOpen: false }
}

export function evaluateUt2Action(
  actionId: string,
  spatial: SpatialInertiaState,
  direction?: HexDirection,
): EvaluatedAction {
  const definition = actionDefinitionFor(actionId)
  if (!definition) throw new Error(`Unknown UT2 action: ${actionId}`)

  const canChain = actionId === 'rush-strike'
    && spatial.chainOpen
    && spatial.pendingMomentum >= 1
    && spatial.axis !== null
    && direction === spatial.axis
  const skippedPhaseId = canChain ? definition.intro?.skipPhaseIdWhenChained : undefined
  const phases = skippedPhaseId
    ? definition.phases.filter((phase) => phase.id !== skippedPhaseId)
    : [...definition.phases]

  return {
    definition,
    phases,
    actionTimeAt: phases.reduce((total, phase) => total + phase.durationAt, 0),
    chained: canChain,
    skippedPhaseIds: skippedPhaseId ? [skippedPhaseId] : [],
  }
}

function isClearDriveCell(state: GameState, coord: Coord): boolean {
  const cell = cellAt(state, coord)
  return Boolean(
    cell
    && !cell.tags.includes('Blocked')
    && !cell.tags.includes('Void')
    && !actorAt(state, coord),
  )
}

export function drivePlanFor(state: GameState, direction: HexDirection): DrivePlan {
  const origin = getPlayer(state).position
  const route = [1, 2, 3].map((steps) => hexAdvance(origin, direction, steps))
  const blockedIndex = route.findIndex((coord) => !isClearDriveCell(state, coord))
  return blockedIndex < 0
    ? { direction, route, valid: true }
    : {
        direction,
        route,
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
  return state.actors
    .filter((actor) => actor.alive && actor.faction === 'enemy')
    .map((actor) => ({ actor, direction: hexDirectionBetween(player.position, actor.position) }))
    .filter((entry): entry is { actor: Actor; direction: HexDirection } => entry.direction !== null)
    .map((entry) => ({
      ...entry,
      chained: spatial.chainOpen && spatial.pendingMomentum >= 1 && spatial.axis === entry.direction,
    }))
}

function prependUt2Log(state: GameState, message: string): GameState {
  const next = structuredClone(state)
  next.logs.unshift(`[UT2 · ${message}]`)
  next.logs = next.logs.slice(0, 120)
  return next
}

function moveAlongAxis(state: GameState, direction: HexDirection, steps: number): GameState {
  const next = structuredClone(state)
  const player = getPlayer(next)
  const route = Array.from({ length: steps }, (_, index) => hexAdvance(player.position, direction, index + 1))
  if (route.some((coord) => !isClearDriveCell(next, coord))) {
    return prependUt2Log(next, `Drive 中止 · ${direction} 路线发生 Contact`)
  }
  player.position = route[route.length - 1]
  return next
}

export function applyUt2ActionPhase(
  state: GameState,
  evaluated: EvaluatedAction,
  phase: ActionPhaseDefinition,
  direction: HexDirection,
  targetActorId?: string,
): GameState {
  if (evaluated.definition.id === 'drive') {
    const moved = moveAlongAxis(state, direction, phase.movementSteps ?? 0)
    return prependUt2Log(
      moved,
      `Drive [${phase.label}] · Axis ${direction} · Momentum ${phase.momentumAfter ?? 0}`,
    )
  }

  if (evaluated.definition.id === 'rush-strike' && phase.id === 'start') {
    return prependUt2Log(state, 'Rush Strike [Start] · 从静止启动')
  }

  if (evaluated.definition.id === 'rush-strike' && phase.id === 'strike') {
    const target = state.actors.find((actor) => actor.id === targetActorId && actor.alive)
    if (!target) return prependUt2Log(state, 'Rush Strike [Strike] · 目标已离开或失效')
    const attacked = performHexBasicAction(state, 'attack', target.position, { useActionPoints: false })
    return prependUt2Log(
      attacked,
      evaluated.chained
        ? `Rush Strike [Strike] · 继承 Momentum，跳过 Start，${direction} 同轴出手`
        : 'Rush Strike [Strike] · 完成常规起步后出手',
    )
  }

  return prependUt2Log(state, `${evaluated.definition.label} [${phase.label}]`)
}

export function spatialAfterUt2Action(
  evaluated: EvaluatedAction,
  direction: HexDirection,
): SpatialInertiaState {
  const outro = evaluated.definition.outro
  if (!outro || !outro.opensChainWindow || outro.pendingMomentum === 0) {
    return createSpatialInertiaState()
  }
  return {
    axis: outro.preserveAxis ? direction : null,
    pendingMomentum: outro.pendingMomentum,
    chainOpen: true,
  }
}

export function prepareUt2ChainScenario(state: GameState): GameState {
  const next = structuredClone(state)
  const center = {
    x: Math.floor(next.config.width / 2),
    y: Math.floor(next.config.height / 2),
  }
  const player = getPlayer(next)
  const hunter = next.actors.find((actor) => actor.id === 'hunter')
  const playerPosition = hexAdvance(center, 'W', 2)
  const hunterPosition = hexAdvance(center, 'E', 2)
  const playerCell = cellAt(next, playerPosition)
  const hunterCell = cellAt(next, hunterPosition)

  if (playerCell && hunterCell
    && !playerCell.tags.includes('Blocked') && !playerCell.tags.includes('Void')
    && !hunterCell.tags.includes('Blocked') && !hunterCell.tags.includes('Void')) {
    player.position = playerPosition
    if (hunter) {
      hunter.position = hunterPosition
      hunter.name = '动作链接战假人'
      hunter.intent = '在 3 AT 时重新行动；先验证 Drive → Rush Strike'
    }
  }

  next.logs.unshift('[UT2] 固定链路场景：向 E 执行 Drive，结束后对轴线前方目标使用 Rush Strike。')
  return next
}
