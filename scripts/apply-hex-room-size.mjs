import fs from 'node:fs'

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing patch target: ${label}`)
  return source.replace(before, after)
}

const prototypePath = 'src/hex/HexPrototype.tsx'
let prototype = fs.readFileSync(prototypePath, 'utf8')

prototype = replaceOnce(
  prototype,
  "import { HexTravelMap } from './HexTravelMap'\n",
  "import { HexTravelMap } from './HexTravelMap'\nimport {\n  activeScenarioCells,\n  createHexRoomState,\n  findScenarioObjective,\n  roomCellCount,\n  ROOM_DEFAULT_RADIUS,\n  ROOM_MAX_RADIUS,\n  ROOM_MIN_RADIUS,\n  type HexMapStructure,\n} from './hexRoom'\n",
  'room imports',
)
prototype = prototype.replace('  TRAVEL_OBJECTIVE,\n', '')
prototype = replaceOnce(
  prototype,
  "import './hex-view-mode.css'\n",
  "import './hex-view-mode.css'\nimport './hex-room.css'\n",
  'room css import',
)
prototype = replaceOnce(
  prototype,
  "  const [state, setState] = useState(() => createHexTravelState())\n  const [undoStack, setUndoStack] = useState<HexHistoryEntry[]>([])\n  const [mode, setMode] = useState<HexMode>('travel')\n",
  "  const [mapStructure, setMapStructure] = useState<HexMapStructure>('room')\n  const [roomRadius, setRoomRadius] = useState(ROOM_DEFAULT_RADIUS)\n  const [state, setState] = useState(() => createHexRoomState(ROOM_DEFAULT_RADIUS))\n  const [undoStack, setUndoStack] = useState<HexHistoryEntry[]>([])\n  const [mode, setMode] = useState<HexMode>('tactical')\n",
  'initial room state',
)
prototype = replaceOnce(
  prototype,
  "  const [travelMessage, setTravelMessage] = useState('点击远端 Hex 规划路径并自动旅行。')\n",
  "  const [travelMessage, setTravelMessage] = useState('调整房间半径，比较战术密度、移动空间与环境覆盖。')\n",
  'initial room message',
)
prototype = replaceOnce(
  prototype,
  "  const availableNeighbors = getHexNeighbors(player.position)\n    .filter((entry) => isHexInside(state, entry.coord) && !actorAt(state, entry.coord))\n",
  "  const availableNeighbors = getHexNeighbors(player.position)\n    .filter((entry) => {\n      const cell = cellAt(state, entry.coord)\n      return isHexInside(state, entry.coord) && Boolean(cell) && !cell!.tags.includes('Blocked') && !actorAt(state, entry.coord)\n    })\n",
  'active neighbor filtering',
)
prototype = replaceOnce(
  prototype,
  "  const reachedObjective = player.position.x === TRAVEL_OBJECTIVE.x && player.position.y === TRAVEL_OBJECTIVE.y\n\n  const objectives = useMemo(() => [\n    { done: worldTicks > 0, label: '旅行移动触发世界演算' },\n    { done: mode === 'tactical', label: '由旅行切入战术模式' },\n    { done: reachedObjective, label: '抵达远端求救地点' },\n  ], [worldTicks, mode, reachedObjective])\n",
  "  const scenarioObjective = findScenarioObjective(state)\n  const activeCellCount = activeScenarioCells(state).length\n  const reachedObjective = Boolean(scenarioObjective && player.position.x === scenarioObjective.x && player.position.y === scenarioObjective.y)\n\n  const objectives = useMemo(() => [\n    { done: worldTicks > 0, label: '移动触发世界演算' },\n    { done: mode === 'tactical', label: '进入战术操作模式' },\n    { done: reachedObjective, label: mapStructure === 'room' ? '抵达房间目标' : '抵达远端求救地点' },\n  ], [worldTicks, mode, reachedObjective, mapStructure])\n",
  'scenario objective and metrics',
)
prototype = replaceOnce(
  prototype,
  "  const restart = () => {\n    const next = createHexTravelState({ turnMode: state.config.turnMode, baseAP: state.config.baseAP })\n    const start = getPlayer(next).position\n    setState(next)\n    setUndoStack([])\n    setMode('travel')\n    setTravelPath([])\n    setTravelTarget(undefined)\n    setTravelProgress(0)\n    setWorldTicks(0)\n    setTraveling(false)\n    setTravelMessage('点击远端 Hex 规划路径并自动旅行。')\n    setSelectedCoord({ ...start })\n    setHoverCoord(undefined)\n    setSelection({ kind: 'inspect' })\n    setEventQueue([fallbackEvent('reset', start, '连续 Hex6 地图已重新开始')])\n  }\n",
  "  const loadScenario = (structure: HexMapStructure, radius = roomRadius) => {\n    const next = structure === 'room'\n      ? createHexRoomState(radius, { turnMode: state.config.turnMode, baseAP: state.config.baseAP })\n      : createHexTravelState({ turnMode: state.config.turnMode, baseAP: state.config.baseAP })\n    const start = getPlayer(next).position\n    setMapStructure(structure)\n    setRoomRadius(radius)\n    setState(next)\n    setUndoStack([])\n    setTravelPath([])\n    setTravelTarget(undefined)\n    setTravelProgress(0)\n    setWorldTicks(0)\n    setTraveling(false)\n    setTravelMessage(structure === 'room'\n      ? `房间半径 ${radius}：${roomCellCount(radius)} 个有效 Cell。`\n      : '点击远端 Hex 规划路径并自动旅行。')\n    setSelectedCoord({ ...start })\n    setHoverCoord(undefined)\n    setSelection({ kind: 'inspect' })\n    setCameraResetToken((value) => value + 1)\n    setEventQueue([fallbackEvent('reset', start, structure === 'room' ? `房间尺寸切换为 R${radius}` : '连续 Hex6 地图已重新开始')])\n  }\n\n  const restart = () => loadScenario(mapStructure, roomRadius)\n",
  'scenario loader',
)
prototype = replaceOnce(
  prototype,
  "          <p className=\"eyebrow\">ProjectC · Continuous Hex6 Map</p>\n          <h1>旅行 / 战术双模式验证</h1>\n",
  "          <p className=\"eyebrow\">ProjectC · Hex6 Map Structure Lab</p>\n          <h1>{mapStructure === 'room' ? '小房间尺寸验证' : '连续大地图验证'}</h1>\n",
  'dynamic page title',
)
prototype = replaceOnce(
  prototype,
  "          </section>\n\n          {mode === 'travel' ? (\n",
  "          </section>\n\n          <section className=\"hex-map-structure-panel\">\n            <div className=\"visual-section-heading\"><h3>地图结构</h3><span>{mapStructure === 'room' ? `Room R${roomRadius}` : 'World 16×12'}</span></div>\n            <div className=\"hex-structure-switch\">\n              <button className={mapStructure === 'world' ? 'active' : ''} onClick={() => loadScenario('world', roomRadius)}>大地图 World</button>\n              <button className={mapStructure === 'room' ? 'active' : ''} onClick={() => loadScenario('room', roomRadius)}>小房间 Room</button>\n            </div>\n            {mapStructure === 'room' ? (\n              <div className=\"hex-room-size-control\">\n                <div><span>房间半径</span><strong>R{roomRadius}</strong></div>\n                <input aria-label=\"Hex6 房间大小\" type=\"range\" min={ROOM_MIN_RADIUS} max={ROOM_MAX_RADIUS} step=\"1\" value={roomRadius} onChange={(eventValue) => loadScenario('room', Number(eventValue.target.value))} />\n                <div className=\"hex-room-size-labels\"><span>紧凑 · 19 Cells</span><span>宽阔 · 169 Cells</span></div>\n                <div className=\"hex-room-metrics\">\n                  <div><span>最长轴</span><strong>{roomRadius * 2 + 1} 格</strong></div>\n                  <div><span>有效 Cell</span><strong>{activeCellCount}</strong></div>\n                  <div><span>理论 Cell</span><strong>{roomCellCount(roomRadius)}</strong></div>\n                </div>\n              </div>\n            ) : (\n              <p className=\"hex-world-structure-note\">保留当前连续 16×12 地图作为对照。切回 Room 后可继续用滑杆比较战术空间密度。</p>\n            )}\n          </section>\n\n          {mode === 'travel' ? (\n",
  'room size controls',
)
prototype = replaceOnce(
  prototype,
  "            <strong>{mode === 'travel' ? '连续地图旅行' : '同坐标战术局部'}</strong>\n            <span>{mode === 'travel' ? '点击远端目标后自动沿路径移动；世界、敌人和天气按旅行时钟推进。' : 'Actor、Ground、Sky 与旅行模式保持原坐标，只切换操作粒度和信息密度。'}</span>\n",
  "            <strong>{mapStructure === 'room' ? `紧凑房间 · R${roomRadius}` : mode === 'travel' ? '连续地图旅行' : '同坐标战术局部'}</strong>\n            <span>{mapStructure === 'room'\n              ? `${activeCellCount} 个有效 Cell；用同一套卡牌、Actor 和环境规则比较房间尺寸。`\n              : mode === 'travel'\n                ? '点击远端目标后自动沿路径移动；世界、敌人和天气按旅行时钟推进。'\n                : 'Actor、Ground、Sky 与旅行模式保持原坐标，只切换操作粒度和信息密度。'}</span>\n",
  'structure comparison strip',
)
prototype = replaceOnce(
  prototype,
  "            <p>最快路线是否因为天气与敌人变得不稳定，而安全路线值得额外距离？</p>\n",
  "            <p>{mapStructure === 'room' ? '哪一个房间半径能在移动自由、卡牌覆盖和局部拥挤之间形成最佳张力？' : '最快路线是否因为天气与敌人变得不稳定，而安全路线值得额外距离？'}</p>\n",
  'room validation question',
)

fs.writeFileSync(prototypePath, prototype)

const boardPath = 'src/hex/HexThreeBoard.tsx'
let board = fs.readFileSync(boardPath, 'utf8')
board = replaceOnce(
  board,
  "import { actorAt, getPlayer, type Actor, type Cell, type Coord, type GameState, type Layer } from '../game'",
  "import { actorAt, cellAt, getPlayer, type Actor, type Cell, type Coord, type GameState, type Layer } from '../game'",
  'board cellAt import',
)
board = replaceOnce(
  board,
  "function isValidTarget(state: GameState, selection: VisualSelection, coord: Coord) {\n  const player = getPlayer(state)\n",
  "function isValidTarget(state: GameState, selection: VisualSelection, coord: Coord) {\n  const cell = cellAt(state, coord)\n  if (!cell || cell.tags.includes('Blocked') || cell.tags.includes('Void')) return false\n  const player = getPlayer(state)\n",
  'board blocked target filter',
)
board = replaceOnce(
  board,
  "      for (const cell of currentState.cells) {\n        const center = hexWorldPosition(cell.coord, currentState)\n",
  "      for (const cell of currentState.cells) {\n        if (cell.tags.includes('Void')) continue\n        const center = hexWorldPosition(cell.coord, currentState)\n",
  'board pointer void filter',
)
board = replaceOnce(
  board,
  "    for (const cell of state.cells) {\n      const position = hexWorldPosition(cell.coord, state)\n",
  "    for (const cell of state.cells) {\n      if (cell.tags.includes('Void')) continue\n      const position = hexWorldPosition(cell.coord, state)\n",
  'board render void filter',
)
fs.writeFileSync(boardPath, board)

const rulesPath = 'src/hex/hexRules.ts'
let rules = fs.readFileSync(rulesPath, 'utf8')
rules = replaceOnce(
  rules,
  "function isBlocked(state: GameState, coord: Coord, movingActorId?: string): boolean {\n  if (!cellAt(state, coord)) return true\n  return state.actors.some((actor) => actor.alive && actor.id !== movingActorId && sameCoord(actor.position, coord))\n}\n",
  "function isBlocked(state: GameState, coord: Coord, movingActorId?: string): boolean {\n  const cell = cellAt(state, coord)\n  if (!cell || cell.tags.includes('Blocked') || cell.tags.includes('Void')) return true\n  return state.actors.some((actor) => actor.alive && actor.id !== movingActorId && sameCoord(actor.position, coord))\n}\n",
  'rules blocked cell filter',
)
fs.writeFileSync(rulesPath, rules)
