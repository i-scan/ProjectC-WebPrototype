import {
  actorAt,
  cellAt,
  getPlayer,
  runThermalPhase,
  type Actor,
  type Cell,
  type Coord,
  type GameConfig,
  type GameState,
} from '../game'
import {
  computeHexEnemyIntents,
  createHexInitialState,
  getHexNeighbors,
  hexDistance,
  hexStepToward,
  isHexInside,
  runHexGlobalEnvironment,
} from './hexRules'
import { markMountain } from './hexTerrain'

export type HexMode = 'travel' | 'tactical'
export type TravelPreference = 'fastest' | 'safest'

export type TravelClockResult = {
  ticks: number
  remainder: number
}

export type TravelInterrupt = {
  type: 'enemy' | 'landmark' | 'weather'
  label: string
  coord: Coord
}

export type TravelPathSummary = {
  steps: number
  movementCost: number
  risk: number
  expectedTicks: number
}

export const TRAVEL_MAP_WIDTH = 16
export const TRAVEL_MAP_HEIGHT = 12
export const TRAVEL_THREAT_RADIUS = 3
export const TRAVEL_START: Coord = { x: 1, y: 10 }
export const TRAVEL_OBJECTIVE: Coord = { x: 14, y: 1 }

const clone = <T>(value: T): T => structuredClone(value)
const sameCoord = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y
const keyOf = (coord: Coord) => `${coord.x},${coord.y}`

function setCellDefaults(cell: Cell): void {
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

function configureTravelMap(state: GameState): void {
  for (const cell of state.cells) {
    const { x, y } = cell.coord
    setCellDefaults(cell)

    if (x <= 2 && y >= 9) cell.tags.push('Shelter')

    // A vertical ridge splits the map. Two passes create a short dangerous route
    // and a longer safer route for direct comparison.
    if (x === 7 && y >= 1 && y <= 10 && y !== 3 && y !== 8) {
      cell.tags.push('Mountain', 'Blocked', 'BlocksSight', 'Ridge')
      cell.groundTemp = -1
      cell.moisture = 0
    }

    // Northern forest: longer and slower, but mostly safe.
    if (x >= 2 && x <= 6 && y >= 2 && y <= 6) {
      cell.groundFill = 'grass'
      cell.moisture = 2
      cell.groundTemp = -1
      if ((x + y) % 4 === 0) {
        cell.skyFill = 'cloud'
        cell.cloudAge = 1
      }
    }

    // Southern water basin makes the direct lower detour expensive.
    if (x >= 3 && x <= 6 && y >= 8 && y <= 10 && !(x === 6 && y === 8)) {
      cell.groundFill = 'water'
      cell.moisture = 2
    }

    // The short central pass is exposed to heat, rain and enemy patrols.
    if (x >= 8 && x <= 11 && y >= 7 && y <= 9) {
      cell.groundTemp = 2
      cell.skyTemp = 1
      cell.moisture = x === 8 ? 0 : 1
      if (x === 9 && y === 8) cell.groundFill = 'fire'
      if ((x + y) % 2 === 0) {
        cell.skyFill = 'cloud'
        cell.cloudAge = 2
        cell.intents = [{ id: `travel-rain-${x}-${y}`, type: 'rain', countdown: 1 }]
      }
      cell.tags.push('WeatherHazard')
    }

    // Eastern highland gives the destination a distinct colder climate.
    if (x >= 11 && y <= 4) {
      cell.groundTemp = -1
      cell.skyTemp = -1
      if ((x + y) % 3 === 0) cell.groundFill = 'ice'
    }
  }

  for (const coord of [{ x: 4, y: 7 }, { x: 10, y: 6 }, { x: 12, y: 7 }]) {
    markMountain(state, coord, 'peak')
  }

  cellAt(state, { x: 4, y: 5 })?.tags.push('Resource')
  cellAt(state, { x: 7, y: 8 })?.tags.push('NarrowPass')
  cellAt(state, { x: 7, y: 3 })?.tags.push('SafePass')
  cellAt(state, { x: 10, y: 3 })?.tags.push('Watchtower')
  cellAt(state, TRAVEL_OBJECTIVE)?.tags.push('Objective')
}

function configureTravelActors(state: GameState): void {
  const player = getPlayer(state)
  player.position = { ...TRAVEL_START }
  player.intent = '选择远端目的地开始旅行'

  const hunter = state.actors.find((actor) => actor.id === 'hunter')
  if (hunter) {
    hunter.position = { x: 9, y: 8 }
    hunter.name = '中央隘口巡猎者'
  }

  const elite = state.actors.find((actor) => actor.id === 'elite')
  if (elite) {
    elite.position = { x: 13, y: 2 }
    elite.name = '目的地守卫'
  }

  const npc = state.actors.find((actor) => actor.id === 'npc')
  if (npc) {
    npc.position = { ...TRAVEL_OBJECTIVE }
    npc.name = '远端求救者'
  }

  const secondHunter: Actor = {
    id: 'hunter-forest',
    name: '林地巡逻者',
    actorType: 'hunter',
    faction: 'enemy',
    position: { x: 5, y: 4 },
    hp: 3,
    maxHp: 3,
    shield: 0,
    bodyTemperature: 0,
    balanceTemperature: 1,
    thermalRegulation: 1,
    thermalInsulation: 0,
    mass: 'light',
    attackPower: 1,
    intent: '',
    alive: true,
  }
  state.actors = [...state.actors.filter((actor) => actor.id !== secondHunter.id), secondHunter]
}

export function createHexTravelState(overrides?: Partial<GameConfig>): GameState {
  const state = createHexInitialState({
    width: TRAVEL_MAP_WIDTH,
    height: TRAVEL_MAP_HEIGHT,
    baseAP: 3,
    ...overrides,
  })
  configureTravelMap(state)
  configureTravelActors(state)
  state.turn = 1
  state.phase = 'player'
  state.phaseQueue = []
  state.ap = state.config.baseAP
  state.reservedAP = 0
  state.entropy = 0
  state.status = 'active'
  state.objectives = { eliteDefeated: false, npcWarmed: false, extracted: false }
  state.logs = [
    '连续 Hex6 地图验证开始：旅行模式下每累计 baseAP 个移动格推进一次世界演算。',
  ]
  return computeHexEnemyIntents(state)
}

export function isTravelPassable(state: GameState, coord: Coord): boolean {
  const cell = cellAt(state, coord)
  if (!cell || cell.tags.includes('Blocked')) return false
  const occupyingEnemy = actorAt(state, coord, false)
  return !occupyingEnemy
}

export function travelCellRisk(cell: Cell): number {
  let risk = 0
  if (cell.groundFill === 'fire') risk += 7
  if (cell.groundFill === 'water') risk += 2
  if (Math.abs(cell.groundTemp) >= 2) risk += 2
  if (cell.intents.some((intent) => intent.type === 'rain')) risk += 3
  if (cell.tags.includes('WeatherHazard')) risk += 2
  return risk
}

export function travelCellCost(cell: Cell, preference: TravelPreference): number {
  if (preference === 'fastest') return 1
  let cost = 1 + travelCellRisk(cell)
  if (cell.groundFill === 'grass') cost += 1
  if (cell.groundFill === 'water') cost += 2
  if (cell.groundFill === 'ice') cost += 1
  return cost
}

export function findHexTravelPath(
  state: GameState,
  start: Coord,
  goal: Coord,
  preference: TravelPreference = 'fastest',
): Coord[] {
  if (!isHexInside(state, goal) || !cellAt(state, goal)?.tags.includes('Blocked') === false) {
    // Keep the explicit blocked check below readable; this branch only rejects
    // coordinates outside the continuous map.
  }
  if (!isHexInside(state, goal) || cellAt(state, goal)?.tags.includes('Blocked')) return []
  if (sameCoord(start, goal)) return [{ ...start }]

  const open = new Set<string>([keyOf(start)])
  const coords = new Map<string, Coord>([[keyOf(start), { ...start }]])
  const cameFrom = new Map<string, string>()
  const gScore = new Map<string, number>([[keyOf(start), 0]])
  const fScore = new Map<string, number>([[keyOf(start), hexDistance(start, goal)]])

  while (open.size > 0) {
    let currentKey = ''
    let currentScore = Number.POSITIVE_INFINITY
    for (const candidate of open) {
      const score = fScore.get(candidate) ?? Number.POSITIVE_INFINITY
      if (score < currentScore) {
        currentKey = candidate
        currentScore = score
      }
    }

    const current = coords.get(currentKey)
    if (!current) break
    if (sameCoord(current, goal)) {
      const path: Coord[] = [{ ...current }]
      let cursor = currentKey
      while (cameFrom.has(cursor)) {
        cursor = cameFrom.get(cursor)!
        const coord = coords.get(cursor)
        if (coord) path.push({ ...coord })
      }
      return path.reverse()
    }

    open.delete(currentKey)
    for (const neighbor of getHexNeighbors(current).map((entry) => entry.coord)) {
      if (!isHexInside(state, neighbor)) continue
      const cell = cellAt(state, neighbor)
      if (!cell || cell.tags.includes('Blocked')) continue
      const enemy = actorAt(state, neighbor, false)
      if (enemy && !sameCoord(neighbor, goal)) continue

      const neighborKey = keyOf(neighbor)
      coords.set(neighborKey, { ...neighbor })
      const tentative = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + travelCellCost(cell, preference)
      if (tentative >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) continue

      cameFrom.set(neighborKey, currentKey)
      gScore.set(neighborKey, tentative)
      fScore.set(neighborKey, tentative + hexDistance(neighbor, goal))
      open.add(neighborKey)
    }
  }

  return []
}

export function summarizeTravelPath(
  state: GameState,
  path: Coord[],
  progress: number,
): TravelPathSummary {
  const traversed = path.slice(1)
  const movementCost = traversed.reduce((sum, coord) => sum + travelCellCost(cellAt(state, coord)!, 'safest'), 0)
  const risk = traversed.reduce((sum, coord) => sum + travelCellRisk(cellAt(state, coord)!), 0)
  return {
    steps: traversed.length,
    movementCost,
    risk,
    expectedTicks: Math.floor((progress + traversed.length) / Math.max(1, state.config.baseAP)),
  }
}

export function advanceTravelClock(
  currentProgress: number,
  movedHexes: number,
  movementCapacity: number,
): TravelClockResult {
  const capacity = Math.max(1, Math.floor(movementCapacity))
  const total = Math.max(0, currentProgress) + Math.max(0, movedHexes)
  return {
    ticks: Math.floor(total / capacity),
    remainder: total % capacity,
  }
}

export function movePlayerInTravel(state: GameState, destination: Coord): GameState {
  const next = clone(state)
  const player = getPlayer(next)
  if (hexDistance(player.position, destination) !== 1 || !isTravelPassable(next, destination)) return next
  player.position = { ...destination }
  next.logs.unshift(`[T${next.turn} · Travel] 玩家旅行到 (${destination.x},${destination.y})。`)
  next.logs = next.logs.slice(0, 120)
  return computeHexEnemyIntents(next)
}

function patrolEnemy(state: GameState, actorId: string, waypoints: Coord[]): void {
  const actor = state.actors.find((entry) => entry.id === actorId && entry.alive)
  if (!actor || waypoints.length === 0) return
  const target = waypoints[state.turn % waypoints.length]
  const destination = hexStepToward(state, actor.position, target, actor.id)
  if (!sameCoord(destination, actor.position)) actor.position = destination
}

export function runHexTravelTick(state: GameState): GameState {
  let next = clone(state)
  patrolEnemy(next, 'hunter', [
    { x: 9, y: 8 }, { x: 10, y: 8 }, { x: 10, y: 7 }, { x: 9, y: 7 },
  ])
  patrolEnemy(next, 'hunter-forest', [
    { x: 5, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 5 }, { x: 5, y: 5 },
  ])

  next = runHexGlobalEnvironment(next)
  next = runThermalPhase(next)
  next.turn = state.turn + 1
  next.phase = 'player'
  next.phaseQueue = []
  next.ap = next.config.baseAP
  next.reservedAP = 0
  next.logs.unshift(`[T${next.turn} · Travel] 世界演算推进：巡逻、天气与热交换完成。`)
  next.logs = next.logs.slice(0, 120)
  return computeHexEnemyIntents(next)
}

export function findNearestTravelThreat(state: GameState): { actor: Actor; distance: number } | undefined {
  const player = getPlayer(state)
  return state.actors
    .filter((actor) => actor.alive && actor.faction === 'enemy')
    .map((actor) => ({ actor, distance: hexDistance(player.position, actor.position) }))
    .filter((entry) => entry.distance <= TRAVEL_THREAT_RADIUS)
    .sort((a, b) => a.distance - b.distance)[0]
}

export function detectTravelInterrupt(state: GameState): TravelInterrupt | undefined {
  const player = getPlayer(state)
  const threat = findNearestTravelThreat(state)
  if (threat) {
    return {
      type: 'enemy',
      label: `${threat.actor.name} 进入 ${TRAVEL_THREAT_RADIUS} 格警戒范围`,
      coord: { ...threat.actor.position },
    }
  }

  const cell = cellAt(state, player.position)
  if (!cell) return undefined
  const landmark = ['Objective', 'Resource', 'NarrowPass', 'Watchtower']
    .find((tag) => cell.tags.includes(tag))
  if (landmark) {
    return {
      type: 'landmark',
      label: `抵达关键地点：${landmark}`,
      coord: { ...player.position },
    }
  }
  if (cell.groundFill === 'fire' || cell.intents.some((intent) => intent.type === 'rain')) {
    return {
      type: 'weather',
      label: '进入需要逐格处理的天气危险区',
      coord: { ...player.position },
    }
  }
  return undefined
}
