import {
  CARD_LIBRARY,
  actorAt,
  cellAt,
  createInitialState,
  endPlayerTurn,
  getNpc,
  getPlayer,
  runThermalPhase,
  type Actor,
  type BasicAction,
  type Card,
  type Coord,
  type GameConfig,
  type GameState,
  type Intent,
  type Layer,
  type Moisture,
} from '../game'

export type HexDirection = 'E' | 'NE' | 'NW' | 'W' | 'SW' | 'SE'

type Axial = { q: number; r: number }

const HEX_DIRECTIONS: Array<{ direction: HexDirection; q: number; r: number }> = [
  { direction: 'E', q: 1, r: 0 },
  { direction: 'NE', q: 1, r: -1 },
  { direction: 'NW', q: 0, r: -1 },
  { direction: 'W', q: -1, r: 0 },
  { direction: 'SW', q: -1, r: 1 },
  { direction: 'SE', q: 0, r: 1 },
]

const clone = <T>(value: T): T => structuredClone(value)
const sameCoord = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const keyOf = (coord: Coord) => `${coord.x},${coord.y}`

export function offsetToAxial(coord: Coord): Axial {
  return {
    q: coord.x - (coord.y - (coord.y & 1)) / 2,
    r: coord.y,
  }
}

export function axialToOffset(axial: Axial): Coord {
  return {
    x: axial.q + (axial.r - (axial.r & 1)) / 2,
    y: axial.r,
  }
}

export function hexDistance(a: Coord, b: Coord): number {
  const first = offsetToAxial(a)
  const second = offsetToAxial(b)
  const dq = first.q - second.q
  const dr = first.r - second.r
  const ds = -first.q - first.r + second.q + second.r
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds))
}

export function getHexNeighbors(coord: Coord): Array<{ coord: Coord; direction: HexDirection }> {
  const axial = offsetToAxial(coord)
  return HEX_DIRECTIONS.map((entry) => ({
    direction: entry.direction,
    coord: axialToOffset({ q: axial.q + entry.q, r: axial.r + entry.r }),
  }))
}

export function hexDirectionBetween(from: Coord, to: Coord): HexDirection | null {
  return getHexNeighbors(from).find((entry) => sameCoord(entry.coord, to))?.direction ?? null
}

export function hexDirectionDelta(coord: Coord, direction: HexDirection): Coord {
  return getHexNeighbors(coord).find((entry) => entry.direction === direction)?.coord ?? coord
}

export function isHexStraightLine(a: Coord, b: Coord): boolean {
  const first = offsetToAxial(a)
  const second = offsetToAxial(b)
  const dq = second.q - first.q
  const dr = second.r - first.r
  const ds = -dq - dr
  return dq === 0 || dr === 0 || ds === 0
}

export function isHexInside(state: GameState, coord: Coord): boolean {
  return coord.x >= 0 && coord.y >= 0 && coord.x < state.config.width && coord.y < state.config.height
}

export function getHexWind(cell: GameState['cells'][number]): HexDirection | null {
  return (cell.wind as unknown as HexDirection | null) ?? null
}

function setHexWind(cell: GameState['cells'][number], direction: HexDirection | null) {
  ;(cell as unknown as { wind: HexDirection | null }).wind = direction
}

function addLog(state: GameState, message: string): void {
  state.logs.unshift(`[T${state.turn} · ${state.phase} · Hex] ${message}`)
  state.logs = state.logs.slice(0, 120)
}

function isBlocked(state: GameState, coord: Coord, movingActorId?: string): boolean {
  if (!cellAt(state, coord)) return true
  return state.actors.some((actor) => actor.alive && actor.id !== movingActorId && sameCoord(actor.position, coord))
}

export function hexStepToward(state: GameState, from: Coord, to: Coord, movingActorId: string): Coord {
  return getHexNeighbors(from)
    .map((entry) => entry.coord)
    .filter((coord) => isHexInside(state, coord) && !isBlocked(state, coord, movingActorId))
    .sort((a, b) => hexDistance(a, to) - hexDistance(b, to))[0] ?? from
}

export function buildHexPath(state: GameState, from: Coord, to: Coord, maxSteps: number, movingActorId = ''): Coord[] {
  const path: Coord[] = [{ ...from }]
  let current = { ...from }
  for (let index = 0; index < maxSteps && hexDistance(current, to) > 0; index += 1) {
    const next = hexStepToward(state, current, to, movingActorId)
    if (sameCoord(next, current)) break
    path.push(next)
    current = next
  }
  return path
}

function spendAP(state: GameState, amount: number, label: string): boolean {
  if (state.status !== 'active' || state.phase !== 'player') return false
  if (state.ap < amount) {
    addLog(state, `${label}失败：AP 不足。`)
    return false
  }
  state.ap -= amount
  state.entropy += amount
  return true
}

function applyDamage(state: GameState, actor: Actor, damage: number, source: string, ignoreShield = false): void {
  if (!actor.alive || damage <= 0) return
  let remaining = damage
  if (!ignoreShield && actor.shield > 0) {
    const absorbed = Math.min(actor.shield, remaining)
    actor.shield -= absorbed
    remaining -= absorbed
    addLog(state, `${source}被 ${actor.name} 的 Shield 吸收 ${absorbed}。`)
  }
  if (remaining > 0) {
    actor.hp -= remaining
    addLog(state, `${source}对 ${actor.name} 造成 ${remaining} 伤害。`)
  }
  if (actor.hp <= 0) {
    actor.hp = 0
    actor.alive = false
    addLog(state, `${actor.name} 失去行动能力。`)
  }
}

function weaponDamage(actor: Actor): number {
  return actor.weapon?.damage ?? actor.attackPower
}

function modifyCellTemperature(
  state: GameState,
  coord: Coord,
  layer: Layer,
  delta: number,
  source: string,
  direct = true,
): void {
  const cell = cellAt(state, coord)
  if (!cell) return
  const min = direct ? state.config.directTemperatureMin : state.config.temperatureMin
  const max = direct ? state.config.directTemperatureMax : state.config.temperatureMax
  if (layer === 'ground') {
    const before = cell.groundTemp
    cell.groundTemp = clamp(cell.groundTemp + delta, min, max)
    addLog(state, `${source}：Ground(${coord.x},${coord.y}) 温度 ${before} → ${cell.groundTemp}。`)
  } else {
    const before = cell.skyTemp
    cell.skyTemp = clamp(cell.skyTemp + delta, min, max)
    addLog(state, `${source}：Sky(${coord.x},${coord.y}) 温度 ${before} → ${cell.skyTemp}。`)
  }
}

function runLocalReactionsInPlace(state: GameState, source: string): void {
  for (const cell of state.cells) {
    if (cell.groundFill === 'water' && cell.groundTemp <= -1) {
      cell.groundFill = 'ice'
      addLog(state, `${source}触发：Water(${cell.coord.x},${cell.coord.y}) 冻结为 Ice。`)
    }
    if (cell.groundFill === 'ice' && cell.groundTemp >= 1) {
      cell.groundFill = 'water'
      addLog(state, `${source}触发：Ice(${cell.coord.x},${cell.coord.y}) 融化为 Water。`)
    }
    if (cell.groundFill === 'grass' && cell.groundTemp >= 2 && cell.moisture < 2) {
      cell.groundFill = 'fire'
      addLog(state, `${source}触发：Grass(${cell.coord.x},${cell.coord.y}) 被点燃。`)
    }
    if (cell.groundFill === 'water' && cell.groundTemp >= 1 && cell.skyFill === 'clear') {
      cell.skyFill = 'cloud'
      cell.cloudAge = 0
      addLog(state, `${source}触发：Water(${cell.coord.x},${cell.coord.y}) 上方形成 Cloud。`)
    }
  }
}

function updateObjectivesInPlace(state: GameState): void {
  const player = getPlayer(state)
  const npc = getNpc(state)
  const elite = state.actors.find((actor) => actor.actorType === 'elite')
  state.objectives.eliteDefeated = !elite?.alive
  if (npc.bodyTemperature >= 0 && !npc.rescued) {
    npc.rescued = true
    npc.immobilized = false
    npc.faction = 'allied'
    npc.intent = '跟随玩家返回 Shelter'
    addLog(state, '失温者恢复至安全体温，开始跟随玩家。')
  }
  state.objectives.npcWarmed = Boolean(npc.rescued)
  const shelter = (coord: Coord) => cellAt(state, coord)?.tags.includes('Shelter') ?? false
  state.objectives.extracted = Boolean(npc.rescued && shelter(player.position) && shelter(npc.position))
  if (state.objectives.extracted && state.status === 'active') {
    state.status = 'won'
    addLog(state, '救援目标完成：玩家与 NPC 已返回 Shelter。')
  }
  if (!player.alive && state.status === 'active') {
    state.status = 'lost'
    addLog(state, 'Session 失败：玩家失去行动能力。')
  }
}

export function createHexInitialState(overrides?: Partial<GameConfig>): GameState {
  const state = createInitialState(overrides)
  state.logs = ['Turn 1：六边格规则验证开始。']
  return computeHexEnemyIntents(state)
}

export function performHexBasicAction(state: GameState, action: BasicAction, target: Coord): GameState {
  const next = clone(state)
  const player = getPlayer(next)
  if (next.phase !== 'player' || next.status !== 'active') return next

  if (action === 'move') {
    if (hexDistance(player.position, target) !== 1 || !isHexInside(next, target) || isBlocked(next, target, player.id)) {
      addLog(next, '移动失败：目标必须是六边格相邻可通行 Cell。')
      return next
    }
    if (!spendAP(next, 1, '移动')) return next
    player.position = target
    addLog(next, `玩家沿六边邻接移动到 (${target.x},${target.y})。`)
  }

  if (action === 'attack') {
    const targetActor = actorAt(next, target, false)
    if (!targetActor || hexDistance(player.position, targetActor.position) !== 1) {
      addLog(next, '攻击失败：需要选择六边邻接的敌人。')
      return next
    }
    if (!spendAP(next, 1, '攻击')) return next
    applyDamage(next, targetActor, weaponDamage(player), '剑攻击')
  }

  runLocalReactionsInPlace(next, '玩家行动')
  updateObjectivesInPlace(next)
  return computeHexEnemyIntents(next)
}

function targetActorForCard(state: GameState, target: Coord): Actor | undefined {
  return state.actors.find((actor) => actor.alive && sameCoord(actor.position, target))
}

function pushActor(state: GameState, actor: Actor, awayFrom: Coord): void {
  if (actor.mass === 'heavy') {
    addLog(state, `${actor.name} 质量为 Heavy，普通推斩无法击退。`)
    return
  }
  const destination = getHexNeighbors(actor.position)
    .map((entry) => entry.coord)
    .filter((coord) => isHexInside(state, coord) && !isBlocked(state, coord, actor.id))
    .sort((a, b) => hexDistance(b, awayFrom) - hexDistance(a, awayFrom))[0]
  if (destination && hexDistance(destination, awayFrom) > hexDistance(actor.position, awayFrom)) {
    actor.position = destination
    addLog(state, `${actor.name} 被沿六边方向击退到 (${destination.x},${destination.y})。`)
  } else {
    addLog(state, `${actor.name} 的击退被阻挡。`)
  }
}

function removeCardFromHand(state: GameState, cardId: string): void {
  const index = state.hand.indexOf(cardId)
  if (index >= 0) state.hand.splice(index, 1)
  state.discard.push(cardId)
}

export function playHexCard(state: GameState, cardId: string, target?: Coord, layer: Layer = 'ground'): GameState {
  const next = clone(state)
  if (next.phase !== 'player' || next.status !== 'active' || !next.hand.includes(cardId)) return next
  const card = next.cards.find((entry) => entry.id === cardId)
  if (!card) return next
  const player = getPlayer(next)
  if (!spendAP(next, card.cost, card.name)) return next

  const fail = (message: string): GameState => {
    next.ap += card.cost
    next.entropy -= card.cost
    addLog(next, `${card.name}失败：${message}`)
    return next
  }

  if (card.target !== 'self') {
    if (!target) return fail('缺少目标。')
    if (hexDistance(player.position, target) > card.range) return fail(`目标超出六边距离 ${card.range}。`)
  }

  if (card.effect === 'heat-cell' || card.effect === 'cool-cell') {
    modifyCellTemperature(next, target!, layer, card.effect === 'heat-cell' ? 1 : -1, card.name)
  }

  if (card.effect === 'grip') {
    if (layer !== 'ground' || hexDistance(player.position, target!) !== 1) return fail('紧握只能选择六边邻接地面 Cell。')
    player.bodyTemperature = clamp(player.bodyTemperature - 1, next.config.temperatureMin, next.config.temperatureMax)
    modifyCellTemperature(next, target!, 'ground', 1, card.name)
    addLog(next, `玩家体温降低至 ${player.bodyTemperature}。`)
  }

  if (['hot-strike', 'cold-strike', 'push-strike', 'pierce', 'bleed'].includes(card.effect)) {
    const targetActor = targetActorForCard(next, target!)
    if (!targetActor || targetActor.faction !== 'enemy') return fail('需要选择有效敌人。')
    if (card.effect === 'pierce') {
      if (!isHexStraightLine(player.position, targetActor.position)) return fail('穿刺要求目标位于六边格三条主轴之一。')
      applyDamage(next, targetActor, 1, card.name, true)
    } else {
      applyDamage(next, targetActor, weaponDamage(player), card.name)
    }
    if (card.effect === 'hot-strike') modifyCellTemperature(next, targetActor.position, 'ground', 1, card.name)
    if (card.effect === 'cold-strike') modifyCellTemperature(next, targetActor.position, 'ground', -1, card.name)
    if (card.effect === 'push-strike' && targetActor.alive) pushActor(next, targetActor, player.position)
    if (card.effect === 'bleed' && targetActor.alive) {
      targetActor.bleedTurns = 2
      addLog(next, `${targetActor.name} 获得 2 回合流血。`)
    }
  }

  if (card.effect === 'guard') {
    player.shield += 2
    addLog(next, `玩家获得 2 Shield，当前 ${player.shield}。`)
  }

  if (card.effect === 'temper') {
    const difference = player.balanceTemperature - player.bodyTemperature
    player.bodyTemperature += Math.sign(difference)
    player.shield += 1
    addLog(next, `回火后玩家体温为 ${player.bodyTemperature}，Shield 为 ${player.shield}。`)
  }

  removeCardFromHand(next, card.id)
  runLocalReactionsInPlace(next, `卡牌「${card.name}」`)
  updateObjectivesInPlace(next)
  return computeHexEnemyIntents(next)
}

export function endHexPlayerTurn(state: GameState): GameState {
  return computeHexEnemyIntents(endPlayerTurn(state))
}

function processBleed(state: GameState, actor: Actor): void {
  if (!actor.alive || !actor.bleedTurns || actor.bleedTurns <= 0) return
  applyDamage(state, actor, 1, '流血')
  actor.bleedTurns -= 1
}

function enemyAct(state: GameState, actor: Actor): void {
  const player = getPlayer(state)
  if (!actor.alive || !player.alive) return
  processBleed(state, actor)
  if (!actor.alive) return

  if (hexDistance(actor.position, player.position) === 1) {
    applyDamage(state, player, actor.attackPower, `${actor.name}攻击`)
    return
  }

  const maxSteps = actor.actorType === 'hunter' ? 2 : 1
  const eliteShouldMove = actor.actorType !== 'elite' || hexDistance(actor.position, player.position) <= 4
  if (!eliteShouldMove) {
    addLog(state, `${actor.name} 留在 NPC 附近守卫。`)
    return
  }

  for (let step = 0; step < maxSteps; step += 1) {
    if (hexDistance(actor.position, player.position) === 1) break
    const destination = hexStepToward(state, actor.position, player.position, actor.id)
    if (sameCoord(destination, actor.position)) break
    actor.position = destination
    addLog(state, `${actor.name} 沿六边邻接移动到 (${destination.x},${destination.y})。`)
  }
  if (hexDistance(actor.position, player.position) === 1) applyDamage(state, player, actor.attackPower, `${actor.name}攻击`)
}

function npcAct(state: GameState): void {
  const npc = getNpc(state)
  const player = getPlayer(state)
  if (!npc.alive || !npc.rescued || npc.immobilized || sameCoord(npc.position, player.position)) return
  const destination = hexStepToward(state, npc.position, player.position, npc.id)
  npc.position = destination
  addLog(state, `失温者沿六边邻接跟随到 (${destination.x},${destination.y})。`)
}

function runEnemyPhaseInPlace(state: GameState): void {
  addLog(state, '六边格敌人阶段开始。')
  for (const actor of state.actors.filter((entry) => entry.faction === 'enemy')) enemyAct(state, actor)
  npcAct(state)
}

function coupleGroundAndSky(state: GameState): void {
  for (const cell of state.cells) {
    const difference = cell.groundTemp - cell.skyTemp
    if (Math.abs(difference) >= 2) {
      cell.skyTemp = clamp(cell.skyTemp + Math.sign(difference), state.config.temperatureMin, state.config.temperatureMax)
      addLog(state, `地空换热：Sky(${cell.coord.x},${cell.coord.y}) 温度变为 ${cell.skyTemp}。`)
    }
    if (state.config.enableExtremeAccumulation && Math.abs(cell.groundTemp) === 2 && cell.groundTemp === cell.skyTemp) {
      cell.groundTemp = clamp(cell.groundTemp + Math.sign(cell.groundTemp), state.config.temperatureMin, state.config.temperatureMax)
      addLog(state, `持续同向温度使 Ground(${cell.coord.x},${cell.coord.y}) 达到极端 ${cell.groundTemp}。`)
    }
  }
}

function generateWind(state: GameState): void {
  for (const cell of state.cells) {
    let best: { direction: HexDirection; difference: number } | undefined
    for (const candidate of getHexNeighbors(cell.coord)) {
      const neighbor = cellAt(state, candidate.coord)
      if (!neighbor) continue
      const difference = cell.skyTemp - neighbor.skyTemp
      if (difference >= 2 && (!best || difference > best.difference)) best = { direction: candidate.direction, difference }
    }
    setHexWind(cell, best?.direction ?? null)
  }
}

function moveClouds(state: GameState): void {
  const moves: Array<{ from: Coord; to: Coord; age: number }> = []
  const occupiedTargets = new Set<string>()
  for (const cell of state.cells) {
    if (cell.skyFill !== 'cloud') continue
    const wind = getHexWind(cell)
    if (!wind) continue
    const destination = hexDirectionDelta(cell.coord, wind)
    const target = cellAt(state, destination)
    if (!target || target.skyFill !== 'clear' || occupiedTargets.has(keyOf(destination))) continue
    moves.push({ from: cell.coord, to: destination, age: cell.cloudAge })
    occupiedTargets.add(keyOf(destination))
  }
  for (const move of moves) {
    const from = cellAt(state, move.from)!
    const to = cellAt(state, move.to)!
    from.skyFill = 'clear'
    from.cloudAge = 0
    to.skyFill = 'cloud'
    to.cloudAge = move.age
    addLog(state, `Cloud 沿六边风向从 (${move.from.x},${move.from.y}) 移动到 (${move.to.x},${move.to.y})。`)
  }
}

function resolveExistingIntents(state: GameState): void {
  for (const cell of state.cells) {
    const remaining: Intent[] = []
    for (const intent of cell.intents) {
      const countdown = intent.countdown - 1
      if (countdown > 0) {
        remaining.push({ ...intent, countdown })
        continue
      }
      cell.moisture = clamp(cell.moisture + 1, 0, 2) as Moisture
      if (cell.groundFill === 'fire') cell.groundFill = 'none'
      cell.groundTemp -= Math.sign(cell.groundTemp)
      cell.skyFill = 'clear'
      cell.cloudAge = 0
      addLog(state, `Rain(${cell.coord.x},${cell.coord.y}) 生效：湿度上升，温度向 0 回落。`)
    }
    cell.intents = remaining
  }
}

function ageCloudsAndCreateRain(state: GameState): void {
  for (const cell of state.cells) {
    if (cell.skyFill !== 'cloud') continue
    cell.cloudAge += 1
    if (cell.cloudAge >= 2 && !cell.intents.some((intent) => intent.type === 'rain')) {
      cell.intents.push({ id: `rain-${state.turn}-${keyOf(cell.coord)}`, type: 'rain', countdown: 1 })
      addLog(state, `Cloud(${cell.coord.x},${cell.coord.y}) 生成 RainNextTurn。`)
    }
  }
}

export function runHexGlobalEnvironment(state: GameState): GameState {
  const next = clone(state)
  next.phase = 'global'
  resolveExistingIntents(next)
  coupleGroundAndSky(next)
  generateWind(next)
  moveClouds(next)
  ageCloudsAndCreateRain(next)
  runLocalReactionsInPlace(next, '六边格全局环境演化')
  addLog(next, '六方向环境演化完成。')
  return next
}

function drawToFive(state: GameState): void {
  while (state.hand.length < 5) {
    if (state.deck.length === 0) {
      state.deck = [...state.discard]
      state.discard = []
    }
    const card = state.deck.shift()
    if (!card) break
    state.hand.push(card)
  }
}

export function advanceHexPhase(state: GameState): GameState {
  let next = clone(state)
  if (next.phase === 'player' || next.status !== 'active') return next

  if (next.phase === 'enemy') runEnemyPhaseInPlace(next)
  else if (next.phase === 'enemy-local') {
    runLocalReactionsInPlace(next, '敌人阶段局部反应')
    addLog(next, '敌人阶段局部反应完成。')
  } else if (next.phase === 'global') next = runHexGlobalEnvironment(next)
  else if (next.phase === 'thermal') next = runThermalPhase(next)

  updateObjectivesInPlace(next)
  if (next.status !== 'active') return next

  const following = next.phaseQueue.shift()
  if (following) {
    next.phase = following
    return computeHexEnemyIntents(next)
  }

  next.turn += 1
  next.phase = 'player'
  next.ap = next.config.baseAP + next.reservedAP
  next.reservedAP = 0
  drawToFive(next)
  addLog(next, `Turn ${next.turn} 开始，当前 AP ${next.ap}。`)
  return computeHexEnemyIntents(next)
}

export function computeHexEnemyIntents(state: GameState): GameState {
  const next = clone(state)
  const player = getPlayer(next)
  for (const actor of next.actors) {
    if (!actor.alive || actor.faction !== 'enemy') continue
    if (hexDistance(actor.position, player.position) === 1) {
      actor.intent = `六边邻接攻击玩家，预计 ${actor.attackPower} 伤害`
    } else if (actor.actorType === 'hunter') {
      actor.intent = '沿六方向向玩家移动最多 2 格；若接邻则攻击'
    } else if (hexDistance(actor.position, player.position) <= 4) {
      actor.intent = '离开守位，沿六方向移动 1 格并尝试攻击'
    } else {
      actor.intent = '守卫失温 NPC'
    }
  }
  return next
}

export function cardById(cardId: string): Card | undefined {
  return CARD_LIBRARY.find((card) => card.id === cardId)
}
