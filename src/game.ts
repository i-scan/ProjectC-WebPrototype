export type Coord = { x: number; y: number }
export type Direction = 'N' | 'E' | 'S' | 'W' | null
export type ActorType = 'player' | 'hunter' | 'elite' | 'npc'
export type Faction = 'player' | 'enemy' | 'neutral' | 'allied'
export type Mass = 'light' | 'normal' | 'heavy'
export type GroundFill = 'none' | 'water' | 'grass' | 'fire' | 'ice'
export type SkyFill = 'clear' | 'cloud' | 'smoke'
export type Moisture = 0 | 1 | 2
export type Layer = 'ground' | 'sky'
export type TurnMode = 'local-global' | 'global-before-enemy' | 'double-global'
export type Phase = 'player' | 'enemy' | 'enemy-local' | 'global' | 'thermal'
export type BasicAction = 'move' | 'attack'
export type CardEffect =
  | 'heat-cell'
  | 'cool-cell'
  | 'grip'
  | 'hot-strike'
  | 'cold-strike'
  | 'push-strike'
  | 'pierce'
  | 'bleed'
  | 'guard'
  | 'temper'

export type Intent = {
  id: string
  type: 'rain'
  countdown: number
}

export type Cell = {
  coord: Coord
  groundTemp: number
  skyTemp: number
  moisture: Moisture
  groundFill: GroundFill
  skyFill: SkyFill
  cloudAge: number
  wind: Direction
  intents: Intent[]
  tags: string[]
}

export type Equipment = {
  id: string
  name: string
  slot: 'weapon' | 'armor' | 'shoes'
  damage?: number
  shieldBonus?: number
  thermalInsulation?: number
  tags?: string[]
}

export type Actor = {
  id: string
  name: string
  actorType: ActorType
  faction: Faction
  position: Coord
  hp: number
  maxHp: number
  shield: number
  bodyTemperature: number
  balanceTemperature: number
  thermalRegulation: number
  thermalInsulation: number
  mass: Mass
  attackPower: number
  weapon?: Equipment
  armor?: Equipment
  shoes?: Equipment
  intent: string
  immobilized?: boolean
  rescued?: boolean
  bleedTurns?: number
  alive: boolean
}

export type Card = {
  id: string
  name: string
  cost: number
  description: string
  effect: CardEffect
  range: number
  target: 'cell' | 'actor' | 'self'
  layer?: Layer | 'either'
}

export type ObjectiveState = {
  eliteDefeated: boolean
  npcWarmed: boolean
  extracted: boolean
}

export type GameConfig = {
  width: number
  height: number
  baseAP: number
  maxReservedAP: number
  directTemperatureMin: number
  directTemperatureMax: number
  temperatureMin: number
  temperatureMax: number
  turnMode: TurnMode
  enableExtremeAccumulation: boolean
}

export type GameState = {
  config: GameConfig
  cells: Cell[]
  actors: Actor[]
  cards: Card[]
  deck: string[]
  hand: string[]
  discard: string[]
  turn: number
  phase: Phase
  phaseQueue: Phase[]
  ap: number
  reservedAP: number
  entropy: number
  logs: string[]
  objectives: ObjectiveState
  status: 'active' | 'won' | 'lost'
}

const DIRECTIONS: Array<{ direction: Exclude<Direction, null>; dx: number; dy: number }> = [
  { direction: 'N', dx: 0, dy: -1 },
  { direction: 'E', dx: 1, dy: 0 },
  { direction: 'S', dx: 0, dy: 1 },
  { direction: 'W', dx: -1, dy: 0 },
]

export const CARD_LIBRARY: Card[] = [
  {
    id: 'heat-cell',
    name: '升温',
    cost: 1,
    description: '使范围 3 内目标层温度 +1。普通效果不能越过 ±2。',
    effect: 'heat-cell',
    range: 3,
    target: 'cell',
    layer: 'either',
  },
  {
    id: 'cool-cell',
    name: '降温',
    cost: 1,
    description: '使范围 3 内目标层温度 -1。普通效果不能越过 ±2。',
    effect: 'cool-cell',
    range: 3,
    target: 'cell',
    layer: 'either',
  },
  {
    id: 'grip',
    name: '紧握',
    cost: 1,
    description: '自身体温 -1，使相邻地面 Cell 温度 +1。',
    effect: 'grip',
    range: 1,
    target: 'cell',
    layer: 'ground',
  },
  {
    id: 'hot-strike',
    name: '热势斩',
    cost: 2,
    description: '执行一次剑攻击，并使目标所在 Cell 温度 +1。',
    effect: 'hot-strike',
    range: 1,
    target: 'actor',
  },
  {
    id: 'cold-strike',
    name: '冷锋',
    cost: 2,
    description: '执行一次剑攻击，并使目标所在 Cell 温度 -1。',
    effect: 'cold-strike',
    range: 1,
    target: 'actor',
  },
  {
    id: 'push-strike',
    name: '推斩',
    cost: 2,
    description: '执行一次剑攻击，并将 Normal / Light 目标击退 1 格。',
    effect: 'push-strike',
    range: 1,
    target: 'actor',
  },
  {
    id: 'pierce',
    name: '穿刺',
    cost: 2,
    description: '对直线距离 2 内目标造成 1 点无视 Shield 的伤害。',
    effect: 'pierce',
    range: 2,
    target: 'actor',
  },
  {
    id: 'bleed',
    name: '放血',
    cost: 2,
    description: '执行一次剑攻击，并附加 2 回合流血。',
    effect: 'bleed',
    range: 1,
    target: 'actor',
  },
  {
    id: 'guard',
    name: '格挡',
    cost: 1,
    description: '获得 2 Shield。',
    effect: 'guard',
    range: 0,
    target: 'self',
  },
  {
    id: 'temper',
    name: '回火',
    cost: 1,
    description: '自身体温向平衡温度移动 1 格，并获得 1 Shield。',
    effect: 'temper',
    range: 0,
    target: 'self',
  },
]

const sword: Equipment = { id: 'sword', name: '剑', slot: 'weapon', damage: 1 }
const normalArmor: Equipment = {
  id: 'normal-clothes',
  name: '普通衣服',
  slot: 'armor',
  shieldBonus: 1,
  thermalInsulation: 1,
}
const normalShoes: Equipment = { id: 'normal-shoes', name: '普通鞋', slot: 'shoes' }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const clone = <T>(value: T): T => structuredClone(value)
const sameCoord = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y
export const distance = (a: Coord, b: Coord) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
const keyOf = (coord: Coord) => `${coord.x},${coord.y}`

export function cellAt(state: GameState, coord: Coord): Cell | undefined {
  return state.cells.find((cell) => sameCoord(cell.coord, coord))
}

export function actorAt(state: GameState, coord: Coord, includeAllies = true): Actor | undefined {
  return state.actors.find(
    (actor) => actor.alive && sameCoord(actor.position, coord) && (includeAllies || actor.faction === 'enemy'),
  )
}

export function getPlayer(state: GameState): Actor {
  const player = state.actors.find((actor) => actor.actorType === 'player')
  if (!player) throw new Error('Player actor is missing')
  return player
}

export function getNpc(state: GameState): Actor {
  const npc = state.actors.find((actor) => actor.actorType === 'npc')
  if (!npc) throw new Error('NPC actor is missing')
  return npc
}

function createCells(width: number, height: number): Cell[] {
  const cells: Cell[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const isWater = (x === 3 || x === 4) && y >= 3 && y <= 5
      const isGrass = x >= 6 && x <= 8 && y >= 6 && y <= 8
      const isShelter = x <= 1 && y >= height - 2
      const groundTemp = isWater ? 0 : x <= 2 ? -1 : x >= 7 ? 1 : 0
      const skyTemp = x <= 2 ? -1 : x >= 7 ? 1 : 0
      cells.push({
        coord: { x, y },
        groundTemp,
        skyTemp,
        moisture: isWater ? 2 : 1,
        groundFill: isWater ? 'water' : isGrass ? 'grass' : 'none',
        skyFill: x === 7 && y === 4 ? 'cloud' : 'clear',
        cloudAge: x === 7 && y === 4 ? 1 : 0,
        wind: null,
        intents: [],
        tags: isShelter ? ['Shelter'] : [],
      })
    }
  }
  return cells
}

function createActors(): Actor[] {
  return [
    {
      id: 'player',
      name: '玩家',
      actorType: 'player',
      faction: 'player',
      position: { x: 1, y: 8 },
      hp: 8,
      maxHp: 8,
      shield: 1,
      bodyTemperature: 1,
      balanceTemperature: 1,
      thermalRegulation: 1,
      thermalInsulation: 1,
      mass: 'normal',
      attackPower: 1,
      weapon: sword,
      armor: normalArmor,
      shoes: normalShoes,
      intent: '等待玩家操作',
      alive: true,
    },
    {
      id: 'hunter',
      name: '追猎者',
      actorType: 'hunter',
      faction: 'enemy',
      position: { x: 8, y: 8 },
      hp: 3,
      maxHp: 3,
      shield: 0,
      bodyTemperature: 1,
      balanceTemperature: 1,
      thermalRegulation: 1,
      thermalInsulation: 0,
      mass: 'light',
      attackPower: 1,
      intent: '',
      alive: true,
    },
    {
      id: 'elite',
      name: '精英守卫',
      actorType: 'elite',
      faction: 'enemy',
      position: { x: 6, y: 2 },
      hp: 6,
      maxHp: 6,
      shield: 1,
      bodyTemperature: 1,
      balanceTemperature: 1,
      thermalRegulation: 1,
      thermalInsulation: 1,
      mass: 'heavy',
      attackPower: 2,
      intent: '',
      alive: true,
    },
    {
      id: 'npc',
      name: '失温者',
      actorType: 'npc',
      faction: 'neutral',
      position: { x: 5, y: 2 },
      hp: 3,
      maxHp: 3,
      shield: 0,
      bodyTemperature: -3,
      balanceTemperature: 1,
      thermalRegulation: 0,
      thermalInsulation: 0,
      mass: 'normal',
      attackPower: 0,
      intent: '失温，无法行动',
      immobilized: true,
      rescued: false,
      alive: true,
    },
  ]
}

export function createInitialState(overrides?: Partial<GameConfig>): GameState {
  const config: GameConfig = {
    width: 10,
    height: 10,
    baseAP: 3,
    maxReservedAP: 1,
    directTemperatureMin: -2,
    directTemperatureMax: 2,
    temperatureMin: -3,
    temperatureMax: 3,
    turnMode: 'local-global',
    enableExtremeAccumulation: false,
    ...overrides,
  }
  const deck = CARD_LIBRARY.map((card) => card.id)
  const state: GameState = {
    config,
    cells: createCells(config.width, config.height),
    actors: createActors(),
    cards: CARD_LIBRARY,
    deck: deck.slice(5),
    hand: deck.slice(0, 5),
    discard: [],
    turn: 1,
    phase: 'player',
    phaseQueue: [],
    ap: config.baseAP,
    reservedAP: 0,
    entropy: 0,
    logs: ['Turn 1：规则实验开始。'],
    objectives: { eliteDefeated: false, npcWarmed: false, extracted: false },
    status: 'active',
  }
  return computeEnemyIntents(state)
}

function addLog(state: GameState, message: string): void {
  state.logs.unshift(`[T${state.turn} · ${state.phase}] ${message}`)
  state.logs = state.logs.slice(0, 120)
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

function isInside(state: GameState, coord: Coord): boolean {
  return coord.x >= 0 && coord.y >= 0 && coord.x < state.config.width && coord.y < state.config.height
}

function isBlocked(state: GameState, coord: Coord, movingActorId?: string): boolean {
  const cell = cellAt(state, coord)
  if (!cell) return true
  return state.actors.some(
    (actor) =>
      actor.alive &&
      actor.id !== movingActorId &&
      actor.faction === 'enemy' &&
      sameCoord(actor.position, coord),
  )
}

function stepToward(state: GameState, from: Coord, to: Coord, movingActorId: string): Coord {
  const candidates: Coord[] = []
  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) && dx !== 0) {
    candidates.push({ x: from.x + dx, y: from.y })
  }
  if (dy !== 0) candidates.push({ x: from.x, y: from.y + dy })
  if (dx !== 0) candidates.push({ x: from.x + dx, y: from.y })
  return candidates.find((coord) => isInside(state, coord) && !isBlocked(state, coord, movingActorId)) ?? from
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

export function performBasicAction(state: GameState, action: BasicAction, target: Coord): GameState {
  const next = clone(state)
  const player = getPlayer(next)
  if (next.phase !== 'player' || next.status !== 'active') return next

  if (action === 'move') {
    if (distance(player.position, target) !== 1 || !isInside(next, target) || isBlocked(next, target, player.id)) {
      addLog(next, '移动失败：目标必须是相邻可通行 Cell。')
      return next
    }
    if (!spendAP(next, 1, '移动')) return next
    player.position = target
    addLog(next, `玩家移动到 (${target.x},${target.y})。`)
  }

  if (action === 'attack') {
    const targetActor = actorAt(next, target, false)
    if (!targetActor || distance(player.position, targetActor.position) !== 1) {
      addLog(next, '攻击失败：需要选择相邻敌人。')
      return next
    }
    if (!spendAP(next, 1, '攻击')) return next
    applyDamage(next, targetActor, weaponDamage(player), '剑攻击')
  }

  runLocalReactionsInPlace(next, '玩家行动')
  updateObjectivesInPlace(next)
  return computeEnemyIntents(next)
}

function removeCardFromHand(state: GameState, cardId: string): void {
  const index = state.hand.indexOf(cardId)
  if (index >= 0) state.hand.splice(index, 1)
  state.discard.push(cardId)
}

function targetActorForCard(state: GameState, target: Coord): Actor | undefined {
  return state.actors.find((actor) => actor.alive && sameCoord(actor.position, target))
}

function pushActor(state: GameState, actor: Actor, awayFrom: Coord): void {
  if (actor.mass === 'heavy') {
    addLog(state, `${actor.name} 质量为 Heavy，普通推斩无法击退。`)
    return
  }
  const dx = Math.sign(actor.position.x - awayFrom.x)
  const dy = Math.sign(actor.position.y - awayFrom.y)
  const destination = { x: actor.position.x + dx, y: actor.position.y + dy }
  if (isInside(state, destination) && !isBlocked(state, destination, actor.id)) {
    actor.position = destination
    addLog(state, `${actor.name} 被击退到 (${destination.x},${destination.y})。`)
  } else {
    addLog(state, `${actor.name} 的击退被阻挡。`)
  }
}

export function playCard(state: GameState, cardId: string, target?: Coord, layer: Layer = 'ground'): GameState {
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
    if (distance(player.position, target) > card.range) return fail(`目标超出范围 ${card.range}。`)
  }

  if (card.effect === 'heat-cell' || card.effect === 'cool-cell') {
    modifyCellTemperature(next, target!, layer, card.effect === 'heat-cell' ? 1 : -1, card.name)
  }

  if (card.effect === 'grip') {
    if (layer !== 'ground' || distance(player.position, target!) !== 1) return fail('紧握只能选择相邻地面 Cell。')
    player.bodyTemperature = clamp(player.bodyTemperature - 1, next.config.temperatureMin, next.config.temperatureMax)
    modifyCellTemperature(next, target!, 'ground', 1, card.name)
    addLog(next, `玩家体温降低至 ${player.bodyTemperature}。`)
  }

  if (['hot-strike', 'cold-strike', 'push-strike', 'pierce', 'bleed'].includes(card.effect)) {
    const targetActor = targetActorForCard(next, target!)
    if (!targetActor || targetActor.faction !== 'enemy') return fail('需要选择有效敌人。')
    if (card.effect === 'pierce') {
      const aligned = player.position.x === targetActor.position.x || player.position.y === targetActor.position.y
      if (!aligned) return fail('穿刺要求与目标处于同一直线。')
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
  return computeEnemyIntents(next)
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

export function endPlayerTurn(state: GameState): GameState {
  const next = clone(state)
  if (next.phase !== 'player' || next.status !== 'active') return next
  next.reservedAP = Math.min(next.ap, next.config.maxReservedAP)
  next.ap = 0
  next.discard.push(...next.hand)
  next.hand = []

  if (next.config.turnMode === 'global-before-enemy') {
    next.phaseQueue = ['global', 'enemy', 'enemy-local', 'thermal']
  } else if (next.config.turnMode === 'double-global') {
    next.phaseQueue = ['global', 'enemy', 'enemy-local', 'global', 'thermal']
  } else {
    next.phaseQueue = ['enemy', 'enemy-local', 'global', 'thermal']
  }
  next.phase = next.phaseQueue.shift()!
  addLog(next, `玩家结束回合，保留 ${next.reservedAP} AP。`)
  return next
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

  if (distance(actor.position, player.position) === 1) {
    applyDamage(state, player, actor.attackPower, `${actor.name}攻击`)
    return
  }

  const maxSteps = actor.actorType === 'hunter' ? 2 : 1
  const eliteShouldMove = actor.actorType !== 'elite' || distance(actor.position, player.position) <= 4
  if (!eliteShouldMove) {
    addLog(state, `${actor.name} 留在 NPC 附近守卫。`)
    return
  }

  for (let step = 0; step < maxSteps; step += 1) {
    if (distance(actor.position, player.position) === 1) break
    const destination = stepToward(state, actor.position, player.position, actor.id)
    if (sameCoord(destination, actor.position)) break
    actor.position = destination
    addLog(state, `${actor.name} 移动到 (${destination.x},${destination.y})。`)
  }
  if (distance(actor.position, player.position) === 1) {
    applyDamage(state, player, actor.attackPower, `${actor.name}攻击`)
  }
}

function npcAct(state: GameState): void {
  const npc = getNpc(state)
  const player = getPlayer(state)
  if (!npc.alive || !npc.rescued || npc.immobilized) return
  if (sameCoord(npc.position, player.position)) return
  const destination = stepToward(state, npc.position, player.position, npc.id)
  npc.position = destination
  addLog(state, `失温者跟随玩家移动到 (${destination.x},${destination.y})。`)
}

function runEnemyPhaseInPlace(state: GameState): void {
  addLog(state, '敌人阶段开始。')
  for (const actor of state.actors.filter((entry) => entry.faction === 'enemy')) enemyAct(state, actor)
  npcAct(state)
}

function runEnemyLocalInPlace(state: GameState): void {
  runLocalReactionsInPlace(state, '敌人阶段局部反应')
  addLog(state, '敌人阶段局部反应完成。')
}

function directionDelta(direction: Direction): Coord {
  const entry = DIRECTIONS.find((candidate) => candidate.direction === direction)
  return entry ? { x: entry.dx, y: entry.dy } : { x: 0, y: 0 }
}

function generateWind(state: GameState): void {
  for (const cell of state.cells) {
    let best: { direction: Exclude<Direction, null>; difference: number } | undefined
    for (const candidate of DIRECTIONS) {
      const neighbor = cellAt(state, { x: cell.coord.x + candidate.dx, y: cell.coord.y + candidate.dy })
      if (!neighbor) continue
      const difference = cell.skyTemp - neighbor.skyTemp
      if (difference >= 2 && (!best || difference > best.difference)) {
        best = { direction: candidate.direction, difference }
      }
    }
    cell.wind = best?.direction ?? null
  }
}

function coupleGroundAndSky(state: GameState): void {
  for (const cell of state.cells) {
    const difference = cell.groundTemp - cell.skyTemp
    if (Math.abs(difference) >= 2) {
      cell.skyTemp = clamp(
        cell.skyTemp + Math.sign(difference),
        state.config.temperatureMin,
        state.config.temperatureMax,
      )
      addLog(state, `地空换热：Sky(${cell.coord.x},${cell.coord.y}) 温度变为 ${cell.skyTemp}。`)
    }
    if (
      state.config.enableExtremeAccumulation &&
      Math.abs(cell.groundTemp) === 2 &&
      cell.groundTemp === cell.skyTemp
    ) {
      cell.groundTemp = clamp(
        cell.groundTemp + Math.sign(cell.groundTemp),
        state.config.temperatureMin,
        state.config.temperatureMax,
      )
      addLog(state, `持续同向温度使 Ground(${cell.coord.x},${cell.coord.y}) 达到极端 ${cell.groundTemp}。`)
    }
  }
}

function moveClouds(state: GameState): void {
  const moves: Array<{ from: Coord; to: Coord; age: number }> = []
  const occupiedTargets = new Set<string>()
  for (const cell of state.cells) {
    if (cell.skyFill !== 'cloud' || !cell.wind) continue
    const delta = directionDelta(cell.wind)
    const destination = { x: cell.coord.x + delta.x, y: cell.coord.y + delta.y }
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
    addLog(state, `Cloud 从 (${move.from.x},${move.from.y}) 移动到 (${move.to.x},${move.to.y})。`)
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
      if (intent.type === 'rain') {
        cell.moisture = clamp(cell.moisture + 1, 0, 2) as Moisture
        if (cell.groundFill === 'fire') cell.groundFill = 'none'
        cell.groundTemp -= Math.sign(cell.groundTemp)
        cell.skyFill = 'clear'
        cell.cloudAge = 0
        addLog(state, `Rain(${cell.coord.x},${cell.coord.y}) 生效：湿度上升，温度向 0 回落。`)
      }
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

export function runGlobalEnvironment(state: GameState): GameState {
  const next = clone(state)
  next.phase = 'global'
  resolveExistingIntents(next)
  coupleGroundAndSky(next)
  generateWind(next)
  moveClouds(next)
  ageCloudsAndCreateRain(next)
  runLocalReactionsInPlace(next, '全局环境演化')
  addLog(next, '全局环境演化完成。')
  return next
}

function runGlobalEnvironmentInPlace(state: GameState): void {
  const result = runGlobalEnvironment(state)
  Object.assign(state, result)
}

export function runThermalPhase(state: GameState): GameState {
  const next = clone(state)
  next.phase = 'thermal'
  for (const actor of next.actors.filter((entry) => entry.alive)) {
    const cell = cellAt(next, actor.position)
    if (!cell) continue
    const difference = cell.groundTemp - actor.bodyTemperature
    const threshold = Math.max(1, actor.thermalInsulation + 1)
    if (Math.abs(difference) >= threshold) {
      actor.bodyTemperature = clamp(
        actor.bodyTemperature + Math.sign(difference),
        next.config.temperatureMin,
        next.config.temperatureMax,
      )
      addLog(next, `${actor.name} 受 Cell 影响，体温变为 ${actor.bodyTemperature}。`)
    } else if (
      actor.thermalRegulation > 0 &&
      Math.abs(actor.balanceTemperature - actor.bodyTemperature) >= 2
    ) {
      actor.bodyTemperature += Math.sign(actor.balanceTemperature - actor.bodyTemperature)
      addLog(next, `${actor.name} 通过体温调节恢复至 ${actor.bodyTemperature}。`)
    }

    if (Math.abs(actor.bodyTemperature) === 3) {
      applyDamage(next, actor, 1, actor.bodyTemperature > 0 ? '过热' : '失温')
    }
  }
  updateObjectivesInPlace(next)
  return next
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

export function advancePhase(state: GameState): GameState {
  let next = clone(state)
  if (next.phase === 'player' || next.status !== 'active') return next

  if (next.phase === 'enemy') runEnemyPhaseInPlace(next)
  else if (next.phase === 'enemy-local') runEnemyLocalInPlace(next)
  else if (next.phase === 'global') runGlobalEnvironmentInPlace(next)
  else if (next.phase === 'thermal') next = runThermalPhase(next)

  updateObjectivesInPlace(next)
  if (next.status !== 'active') return next

  const following = next.phaseQueue.shift()
  if (following) {
    next.phase = following
    return computeEnemyIntents(next)
  }

  next.turn += 1
  next.phase = 'player'
  next.ap = next.config.baseAP + next.reservedAP
  next.reservedAP = 0
  drawToFive(next)
  addLog(next, `Turn ${next.turn} 开始，当前 AP ${next.ap}。`)
  return computeEnemyIntents(next)
}

export function computeEnemyIntents(state: GameState): GameState {
  const next = clone(state)
  const player = getPlayer(next)
  for (const actor of next.actors) {
    if (!actor.alive || actor.faction !== 'enemy') continue
    if (distance(actor.position, player.position) === 1) {
      actor.intent = `攻击玩家，预计 ${actor.attackPower} 伤害`
    } else if (actor.actorType === 'hunter') {
      actor.intent = '向玩家移动最多 2 格；若接邻则攻击'
    } else if (distance(actor.position, player.position) <= 4) {
      actor.intent = '离开守位，向玩家移动 1 格并尝试攻击'
    } else {
      actor.intent = '守卫失温 NPC'
    }
  }
  return next
}

export function toggleArmor(state: GameState): GameState {
  const next = clone(state)
  const player = getPlayer(next)
  if (player.armor) {
    player.shield = Math.max(0, player.shield - (player.armor.shieldBonus ?? 0))
    player.thermalInsulation = Math.max(0, player.thermalInsulation - (player.armor.thermalInsulation ?? 0))
    player.armor = undefined
    addLog(next, '玩家脱下普通衣服。')
  } else {
    player.armor = normalArmor
    player.shield += normalArmor.shieldBonus ?? 0
    player.thermalInsulation += normalArmor.thermalInsulation ?? 0
    addLog(next, '玩家穿上普通衣服。')
  }
  return next
}

export function updateConfig(state: GameState, patch: Partial<GameConfig>): GameState {
  const next = clone(state)
  next.config = { ...next.config, ...patch }
  addLog(next, '规则配置已更新；建议重开场景后比较结果。')
  return next
}

export function phaseLabel(phase: Phase): string {
  const labels: Record<Phase, string> = {
    player: '玩家行动',
    enemy: '敌人行动',
    'enemy-local': '敌人局部反应',
    global: '全局环境',
    thermal: '热交换 / 任务结算',
  }
  return labels[phase]
}

export const windArrow = (direction: Direction): string =>
  ({ N: '↑', E: '→', S: '↓', W: '←', null: '·' })[String(direction) as 'N' | 'E' | 'S' | 'W' | 'null']

export function actorSymbol(actor: Actor): string {
  if (actor.actorType === 'player') return 'P'
  if (actor.actorType === 'hunter') return 'H'
  if (actor.actorType === 'elite') return 'E'
  return actor.rescued ? 'N✓' : 'N!'
}
