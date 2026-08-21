import {
  cellAt,
  getPlayer,
  type Cell,
  type Coord,
  type GameConfig,
  type GameState,
} from '../game'
import { computeHexEnemyIntents, createHexInitialState } from './hexRules'
import { markMountain } from './hexTerrain'
import { hexAdvance, hexDistance } from './hexTopology'

export type HexMapStructure = 'world' | 'room'

export const ROOM_MIN_RADIUS = 2
export const ROOM_MAX_RADIUS = 7
export const ROOM_DEFAULT_RADIUS = 4

const clampRadius = (radius: number, maximumRadius = ROOM_MAX_RADIUS) => Math.max(
  ROOM_MIN_RADIUS,
  Math.min(Math.max(ROOM_MIN_RADIUS, Math.round(maximumRadius)), Math.round(radius)),
)

export function roomCellCount(radius: number): number {
  const value = clampRadius(radius)
  return 1 + 3 * value * (value + 1)
}

export function isVoidCell(cell: Cell): boolean {
  return cell.tags.includes('Void')
}

export function activeScenarioCells(state: GameState): Cell[] {
  return state.cells.filter((cell) => !isVoidCell(cell))
}

export function findScenarioObjective(state: GameState): Coord | undefined {
  const cell = state.cells.find((entry) => entry.tags.includes('Objective') && !isVoidCell(entry))
  return cell ? { ...cell.coord } : undefined
}

function resetCell(cell: Cell): void {
  cell.groundTemp = 0
  cell.skyTemp = 0
  cell.moisture = 1
  cell.groundFill = 'none'
  cell.skyFill = 'clear'
  cell.cloudAge = 0
  cell.wind = null
  cell.intents = []
  cell.tags = []
}

function configureRoomCells(state: GameState, center: Coord, radius: number): void {
  for (const cell of state.cells) {
    resetCell(cell)
    const distance = hexDistance(center, cell.coord)
    if (distance > radius) {
      cell.tags.push('Void', 'Blocked')
      cell.moisture = 0
      continue
    }

    cell.tags.push('Room')
    if (distance === radius) cell.tags.push('RoomEdge')

    const northBias = cell.coord.y < center.y
    const eastBias = cell.coord.x > center.x
    const southBias = cell.coord.y > center.y

    if (northBias && distance >= Math.max(1, radius - 2)) {
      cell.groundFill = 'grass'
      cell.moisture = 2
      cell.groundTemp = -1
      if ((cell.coord.x + cell.coord.y) % 3 === 0) {
        cell.skyFill = 'cloud'
        cell.cloudAge = 1
      }
    }

    if (southBias && !eastBias && distance >= Math.max(1, radius - 2)) {
      cell.groundFill = 'water'
      cell.moisture = 2
    }

    if (eastBias && distance >= Math.max(1, radius - 1)) {
      cell.groundTemp = 1
      cell.skyTemp = 1
    }
  }

  const shelter = hexAdvance(center, 'W', radius)
  const objective = hexAdvance(center, 'E', radius)
  const resource = { ...center }
  const fire = hexAdvance(center, 'SW', Math.max(1, radius - 2))
  const cloud = hexAdvance(center, 'NE', Math.max(1, radius - 1))

  cellAt(state, shelter)?.tags.push('Shelter')
  cellAt(state, objective)?.tags.push('Objective')
  cellAt(state, resource)?.tags.push('Resource')

  const fireCell = cellAt(state, fire)
  if (fireCell && !isVoidCell(fireCell)) {
    fireCell.groundFill = 'fire'
    fireCell.groundTemp = 2
    fireCell.moisture = 0
    fireCell.tags.push('WeatherHazard')
  }

  const cloudCell = cellAt(state, cloud)
  if (cloudCell && !isVoidCell(cloudCell)) {
    cloudCell.skyFill = 'cloud'
    cloudCell.cloudAge = 2
    cloudCell.intents = [{ id: `room-rain-${radius}`, type: 'rain', countdown: 1 }]
  }

  const ridgeLength = Math.max(1, Math.floor(radius / 2))
  for (let step = 1; step <= ridgeLength; step += 1) {
    markMountain(state, hexAdvance(center, 'NW', step), 'ridge')
    markMountain(state, hexAdvance(center, 'SE', step), 'ridge')
  }

  markMountain(state, hexAdvance(center, 'W', Math.max(1, radius - 1)), 'peak')
}

function configureRoomActors(state: GameState, center: Coord, radius: number): void {
  const player = getPlayer(state)
  player.position = hexAdvance(center, 'W', radius)
  player.intent = '利用山体通口、侧翼和视线展开战术'

  const hunter = state.actors.find((actor) => actor.id === 'hunter')
  if (hunter) {
    hunter.position = hexAdvance(center, 'SE', radius)
    hunter.name = '山脊侧翼追猎者'
  }

  const elite = state.actors.find((actor) => actor.id === 'elite')
  if (elite) {
    elite.position = hexAdvance(center, 'NE', radius)
    elite.name = '山口守卫'
  }

  const npc = state.actors.find((actor) => actor.id === 'npc')
  if (npc) {
    npc.position = hexAdvance(center, 'E', radius)
    npc.name = '房间目标'
  }

  state.actors = state.actors.filter((actor) => actor.id !== 'hunter-forest')
}

export function createHexRoomState(
  radiusInput = ROOM_DEFAULT_RADIUS,
  overrides?: Partial<GameConfig>,
  maximumRadius = Math.max(ROOM_MAX_RADIUS, Math.round(radiusInput)),
): GameState {
  const radius = clampRadius(radiusInput, maximumRadius)
  const size = radius * 2 + 1
  const center: Coord = { x: radius, y: radius }
  const state = createHexInitialState({
    width: size,
    height: size,
    baseAP: 3,
    ...overrides,
  })

  configureRoomCells(state, center, radius)
  configureRoomActors(state, center, radius)
  state.turn = 1
  state.phase = 'player'
  state.phaseQueue = []
  state.ap = state.config.baseAP
  state.reservedAP = 0
  state.entropy = 0
  state.status = 'active'
  state.objectives = { eliteDefeated: false, npcWarmed: false, extracted: false }
  state.logs = [
    `紧凑 Hex6 房间验证开始：半径 ${radius}，有效 Cell ${1 + 3 * radius * (radius + 1)}；山体会阻挡移动、击退与直线攻击。`,
  ]
  return computeHexEnemyIntents(state)
}