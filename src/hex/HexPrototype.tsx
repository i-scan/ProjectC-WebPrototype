import { useEffect, useMemo, useState } from 'react'
import {
  CARD_LIBRARY,
  actorAt,
  cellAt,
  getPlayer,
  phaseLabel,
  type BasicAction,
  type Card,
  type Coord,
  type GameState,
  type Layer,
} from '../game'
import type { VisualEvent, VisualSelection } from '../visual/InteractiveThreeBoard'
import { buildVisualEvents, type PlaybackEvent } from '../visual/visualPlayback'
import { HexThreeBoard } from './HexThreeBoard'
import { HexTravelMap } from './HexTravelMap'
import {
  activeScenarioCells,
  createHexRoomState,
  findScenarioObjective,
  roomCellCount,
  ROOM_DEFAULT_RADIUS,
  ROOM_MAX_RADIUS,
  ROOM_MIN_RADIUS,
  type HexMapStructure,
} from './hexRoom'
import { countMountainCells } from './hexTerrain'
import {
  advanceHexPhase,
  endHexPlayerTurn,
  getHexNeighbors,
  hexDistance,
  isHexInside,
  performHexBasicAction,
  playHexCard,
} from './hexRules'
import {
  advanceTravelClock,
  createHexTravelState,
  detectTravelInterrupt,
  findHexTravelPath,
  findNearestTravelThreat,
  movePlayerInTravel,
  runHexTravelTick,
  summarizeTravelPath,
  type HexMode,
  type TravelPreference,
} from './hexTravel'
import './hex.css'
import './hex-travel.css'
import './hex-view-mode.css'
import './hex-room.css'
import './hex-mountain.css'

const cardIcons: Record<Card['effect'], string> = {
  'heat-cell': '☀',
  'cool-cell': '❄',
  grip: '✦',
  'hot-strike': '⚔',
  'cold-strike': '◇',
  'push-strike': '➜',
  pierce: '↗',
  bleed: '✢',
  guard: '⬡',
  temper: '◉',
}

const speedLabels = ['手动', '0.5×', '1×', '2×', '4×'] as const
const phaseDelays = [0, 1400, 850, 450, 220] as const
const travelDelays = [0, 1050, 680, 400, 230] as const
const cueDelays = [360, 520, 340, 210, 120] as const
const maxUndoSteps = 120
type HexRenderer = '2d' | '3d'

function eventKindForCard(card: Card): VisualEvent['kind'] {
  if (card.effect === 'cool-cell' || card.effect === 'cold-strike') return 'cool'
  if (card.effect === 'heat-cell' || card.effect === 'hot-strike' || card.effect === 'grip') return 'heat'
  if (card.effect === 'guard' || card.effect === 'temper') return 'guard'
  return 'attack'
}

function formatTemperature(value: number) {
  return value > 0 ? `+${value}` : String(value)
}

function fallbackEvent(kind: VisualEvent['kind'], target: Coord | undefined, label: string): PlaybackEvent {
  return { id: Date.now(), kind, target, label, effect: kind }
}

type HexHistoryEntry = {
  state: GameState
  mode: HexMode
  travelPath: Coord[]
  travelTarget?: Coord
  travelProgress: number
  worldTicks: number
  traveling: boolean
  travelMessage: string
}

export function HexPrototype() {
  const [mapStructure, setMapStructure] = useState<HexMapStructure>('room')
  const [roomRadius, setRoomRadius] = useState(ROOM_DEFAULT_RADIUS)
  const [state, setState] = useState(() => createHexRoomState(ROOM_DEFAULT_RADIUS))
  const [undoStack, setUndoStack] = useState<HexHistoryEntry[]>([])
  const [mode, setMode] = useState<HexMode>('tactical')
  const [rendererMode, setRendererMode] = useState<HexRenderer>('3d')
  const [selection, setSelection] = useState<VisualSelection>({ kind: 'inspect' })
  const [targetLayer, setTargetLayer] = useState<Layer>('ground')
  const [selectedCoord, setSelectedCoord] = useState<Coord>(() => ({ ...getPlayer(state).position }))
  const [hoverCoord, setHoverCoord] = useState<Coord | undefined>()
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [showSky, setShowSky] = useState(true)
  const [showDebug, setShowDebug] = useState(false)
  const [simulationSpeed, setSimulationSpeed] = useState(2)
  const [eventQueue, setEventQueue] = useState<PlaybackEvent[]>([])
  const [travelPreference, setTravelPreference] = useState<TravelPreference>('fastest')
  const [travelPath, setTravelPath] = useState<Coord[]>([])
  const [travelTarget, setTravelTarget] = useState<Coord | undefined>()
  const [travelProgress, setTravelProgress] = useState(0)
  const [worldTicks, setWorldTicks] = useState(0)
  const [traveling, setTraveling] = useState(false)
  const [travelMessage, setTravelMessage] = useState('调整房间半径，比较战术密度、移动空间与环境覆盖。')

  const player = getPlayer(state)
  const currentEvent = eventQueue[0]
  const playbackActive = eventQueue.length > 0
  const inspectCoord = hoverCoord ?? selectedCoord
  const inspectedCell = cellAt(state, inspectCoord)
  const inspectedActor = actorAt(state, inspectCoord)
  const handCards = state.hand
    .map((id) => CARD_LIBRARY.find((card) => card.id === id))
    .filter((card): card is Card => Boolean(card))
  const selectedDistance = hexDistance(player.position, inspectCoord)
  const availableNeighbors = getHexNeighbors(player.position)
    .filter((entry) => {
      const cell = cellAt(state, entry.coord)
      return isHexInside(state, entry.coord) && Boolean(cell) && !cell!.tags.includes('Blocked') && !actorAt(state, entry.coord)
    })
  const threat = findNearestTravelThreat(state)
  const pathSummary = useMemo(
    () => summarizeTravelPath(state, travelPath, travelProgress),
    [state, travelPath, travelProgress],
  )
  const scenarioObjective = findScenarioObjective(state)
  const activeCellCount = activeScenarioCells(state).length
  const mountainCellCount = countMountainCells(state)
  const reachedObjective = Boolean(scenarioObjective && player.position.x === scenarioObjective.x && player.position.y === scenarioObjective.y)

  const objectives = useMemo(() => [
    { done: worldTicks > 0, label: '移动触发世界演算' },
    { done: mode === 'tactical', label: '进入战术操作模式' },
    { done: reachedObjective, label: mapStructure === 'room' ? '抵达房间目标' : '抵达远端求救地点' },
  ], [worldTicks, mode, reachedObjective, mapStructure])

  const captureHistory = (snapshotState: GameState = state): HexHistoryEntry => ({
    state: structuredClone(snapshotState),
    mode,
    travelPath: travelPath.map((coord) => ({ ...coord })),
    travelTarget: travelTarget ? { ...travelTarget } : undefined,
    travelProgress,
    worldTicks,
    traveling,
    travelMessage,
  })

  const queueTransition = (
    before: GameState,
    after: GameState,
    fallbackKind: VisualEvent['kind'],
    fallbackTarget?: Coord,
    historyEntry: HexHistoryEntry = captureHistory(before),
  ) => {
    const cues = buildVisualEvents(before, after, fallbackTarget)
    if (cues.length === 1 && before.phase === after.phase && before.turn === after.turn && after.logs[0] !== before.logs[0]) {
      cues[0] = { ...cues[0], kind: fallbackKind, effect: fallbackKind, label: after.logs[0], target: fallbackTarget }
    }
    setUndoStack((current) => [...current, historyEntry].slice(-maxUndoSteps))
    setState(after)
    setEventQueue(cues.length > 0
      ? cues
      : [fallbackEvent(fallbackKind, fallbackTarget, after.logs[0] ?? 'Hex6 状态已更新')])
  }

  function planTravel(destination: Coord, autoStart = true) {
    const path = findHexTravelPath(state, player.position, destination, travelPreference)
    setSelectedCoord(destination)
    if (path.length <= 1) {
      setTravelPath(path)
      setTravelTarget(path.length === 1 ? { ...destination } : undefined)
      setTraveling(false)
      setTravelMessage(path.length === 0 ? '该目标不可到达或被地形阻挡。' : '玩家已经位于该 Hex。')
      return
    }
    setTravelTarget({ ...destination })
    setTravelPath(path)
    setTraveling(autoStart)
    setTravelMessage(`${travelPreference === 'fastest' ? '最快' : '安全'}路径已规划：${path.length - 1} 格。`)
  }

  function performTravelStep() {
    if (mode !== 'travel' || travelPath.length <= 1 || playbackActive || state.status !== 'active') return
    const destination = travelPath[1]
    const before = state
    const historyEntry = captureHistory(before)
    let after = movePlayerInTravel(before, destination)
    if (getPlayer(after).position.x === getPlayer(before).position.x && getPlayer(after).position.y === getPlayer(before).position.y) {
      setTraveling(false)
      setTravelMessage('下一格已被阻挡，旅行暂停并等待重新规划。')
      return
    }

    const clock = advanceTravelClock(travelProgress, 1, before.config.baseAP)
    for (let index = 0; index < clock.ticks; index += 1) after = runHexTravelTick(after)
    const remainingPath = travelPath.slice(1)
    const cues = buildVisualEvents(before, after, destination)
    if (clock.ticks > 0) {
      cues.unshift({
        id: Date.now() + 7,
        kind: 'phase',
        effect: 'phase',
        target: { ...destination },
        label: `旅行累计达到 ${before.config.baseAP} 格：世界演算推进 ${clock.ticks} 次`,
      })
    }

    setUndoStack((current) => [...current, historyEntry].slice(-maxUndoSteps))
    setState(after)
    setSelectedCoord({ ...destination })
    setTravelPath(remainingPath)
    setTravelProgress(clock.remainder)
    setWorldTicks((value) => value + clock.ticks)
    setEventQueue(cues.length > 0 ? cues : [fallbackEvent('move', destination, `旅行到 (${destination.x},${destination.y})`)])

    const interrupt = detectTravelInterrupt(after)
    if (interrupt) {
      setMode('tactical')
      setTraveling(false)
      setSelection({ kind: 'inspect' })
      setTravelMessage(`旅行被打断：${interrupt.label}。剩余路径已保留。`)
      return
    }
    if (remainingPath.length <= 1) {
      setTraveling(false)
      setTravelMessage('已抵达旅行目标。可继续选择目的地或主动进入战术模式。')
      return
    }
    setTravelMessage(`旅行中：剩余 ${remainingPath.length - 1} 格，世界时钟 ${clock.remainder}/${before.config.baseAP}。`)
  }

  useEffect(() => {
    const handleKeyDown = (eventValue: KeyboardEvent) => {
      if (eventValue.key === 'Escape') {
        setSelection({ kind: 'inspect' })
        if (mode === 'travel') setTraveling(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode])

  useEffect(() => {
    if (eventQueue.length === 0) return
    const timer = window.setTimeout(() => setEventQueue((current) => current.slice(1)), cueDelays[simulationSpeed])
    return () => window.clearTimeout(timer)
  }, [eventQueue, simulationSpeed])

  useEffect(() => {
    if (mode !== 'tactical' || simulationSpeed === 0 || state.phase === 'player' || state.status !== 'active' || eventQueue.length > 0) return
    const timer = window.setTimeout(() => {
      const before = state
      const after = advanceHexPhase(before)
      queueTransition(before, after, 'phase', getPlayer(before).position)
    }, phaseDelays[simulationSpeed])
    return () => window.clearTimeout(timer)
  }, [mode, simulationSpeed, state, eventQueue.length])

  useEffect(() => {
    if (mode !== 'travel' || !traveling || simulationSpeed === 0 || travelPath.length <= 1 || eventQueue.length > 0 || state.status !== 'active') return
    const timer = window.setTimeout(performTravelStep, travelDelays[simulationSpeed])
    return () => window.clearTimeout(timer)
  }, [mode, traveling, simulationSpeed, travelPath, eventQueue.length, state, travelProgress])

  useEffect(() => {
    if (!travelTarget || mode !== 'travel' || traveling) return
    const path = findHexTravelPath(state, player.position, travelTarget, travelPreference)
    setTravelPath(path)
  }, [travelPreference])

  const handleBoardClick = (coord: Coord) => {
    setSelectedCoord(coord)
    if (playbackActive || state.status !== 'active') return
    if (mode === 'travel') {
      planTravel(coord, true)
      return
    }
    if (state.phase !== 'player') return
    if (selection.kind === 'basic') {
      const before = state
      const after = performHexBasicAction(before, selection.action, coord)
      queueTransition(before, after, selection.action === 'move' ? 'move' : 'attack', coord)
      if (selection.action === 'attack' || after.ap < 1) setSelection({ kind: 'inspect' })
      return
    }
    if (selection.kind === 'card') {
      const before = state
      const after = playHexCard(before, selection.card.id, coord, targetLayer)
      queueTransition(before, after, eventKindForCard(selection.card), coord)
      setSelection({ kind: 'inspect' })
    }
  }

  const chooseBasicAction = (action: BasicAction) => {
    if (playbackActive || mode !== 'tactical') return
    setSelection((current) => current.kind === 'basic' && current.action === action ? { kind: 'inspect' } : { kind: 'basic', action })
  }

  const chooseCard = (card: Card) => {
    if (playbackActive || mode !== 'tactical') return
    if (card.target === 'self') {
      const before = state
      const after = playHexCard(before, card.id, undefined, targetLayer)
      queueTransition(before, after, eventKindForCard(card), player.position)
      setSelection({ kind: 'inspect' })
      return
    }
    setSelection((current) => current.kind === 'card' && current.card.id === card.id ? { kind: 'inspect' } : { kind: 'card', card })
    if (card.layer === 'ground' || card.layer === 'sky') setTargetLayer(card.layer)
  }

  const advance = () => {
    if (playbackActive || mode !== 'tactical') return
    const before = state
    const after = before.phase === 'player' ? endHexPlayerTurn(before) : advanceHexPhase(before)
    queueTransition(before, after, 'phase', player.position)
    setSelection({ kind: 'inspect' })
  }

  const enterTactical = (reason = '玩家主动切换') => {
    setMode('tactical')
    setTraveling(false)
    setSelection({ kind: 'inspect' })
    setTravelMessage(`${reason}：进入战术模式。旅行目标和剩余路径已保留。`)
  }

  const resumeTravel = () => {
    const currentThreat = findNearestTravelThreat(state)
    if (currentThreat) {
      setTravelMessage(`无法恢复旅行：${currentThreat.actor.name} 仍在 ${currentThreat.distance} 格内。`)
      return
    }
    setMode('travel')
    setSelection({ kind: 'inspect' })
    if (travelTarget) {
      const path = findHexTravelPath(state, player.position, travelTarget, travelPreference)
      setTravelPath(path)
      setTraveling(path.length > 1)
      setTravelMessage(path.length > 1 ? '危险解除，已根据当前世界状态重新计算并恢复旅行。' : '没有可继续的旅行路径。')
    } else {
      setTravelMessage('已返回旅行模式，请选择新的远端目标。')
    }
  }

  const undo = () => {
    if (undoStack.length === 0) return
    const previous = undoStack[undoStack.length - 1]
    setSimulationSpeed(0)
    setUndoStack((current) => current.slice(0, -1))
    setState(previous.state)
    setMode(previous.mode)
    setTravelPath(previous.travelPath)
    setTravelTarget(previous.travelTarget)
    setTravelProgress(previous.travelProgress)
    setWorldTicks(previous.worldTicks)
    setTraveling(previous.traveling)
    setTravelMessage(previous.travelMessage)
    setSelectedCoord({ ...getPlayer(previous.state).position })
    setHoverCoord(undefined)
    setSelection({ kind: 'inspect' })
    setEventQueue([fallbackEvent('reset', getPlayer(previous.state).position, `悔棋：Turn ${previous.state.turn} · ${previous.mode === 'travel' ? '旅行' : phaseLabel(previous.state.phase)}`)])
  }

  const loadScenario = (structure: HexMapStructure, radius = roomRadius) => {
    const next = structure === 'room'
      ? createHexRoomState(radius, { turnMode: state.config.turnMode, baseAP: state.config.baseAP })
      : createHexTravelState({ turnMode: state.config.turnMode, baseAP: state.config.baseAP })
    const start = getPlayer(next).position
    setMapStructure(structure)
    setRoomRadius(radius)
    setState(next)
    setUndoStack([])
    setTravelPath([])
    setTravelTarget(undefined)
    setTravelProgress(0)
    setWorldTicks(0)
    setTraveling(false)
    setTravelMessage(structure === 'room'
      ? `房间半径 ${radius}：${roomCellCount(radius)} 个有效 Cell。`
      : '点击远端 Hex 规划路径并自动旅行。')
    setSelectedCoord({ ...start })
    setHoverCoord(undefined)
    setSelection({ kind: 'inspect' })
    setCameraResetToken((value) => value + 1)
    setEventQueue([fallbackEvent('reset', start, structure === 'room' ? `房间尺寸切换为 R${radius}` : '连续 Hex6 地图已重新开始')])
  }

  const restart = () => loadScenario(mapStructure, roomRadius)

  const selectedLabel = selection.kind === 'inspect'
    ? '查看六边态势'
    : selection.kind === 'basic'
      ? selection.action === 'move'
        ? '连续移动：六个方向中选择相邻格'
        : '选择六边邻接敌人'
      : `为「${selection.card.name}」选择六边距离目标`
  const autoResolving = mode === 'tactical' && simulationSpeed > 0 && state.phase !== 'player' && state.status === 'active'
  const topActionDisabled = state.status !== 'active' || playbackActive || (mode === 'tactical' && autoResolving) || (mode === 'travel' && travelPath.length <= 1)

  const topAction = () => {
    if (mode === 'tactical') {
      advance()
      return
    }
    if (simulationSpeed === 0) {
      performTravelStep()
      return
    }
    setTraveling((value) => !value)
  }

  const topActionLabel = mode === 'tactical'
    ? state.phase === 'player'
      ? playbackActive ? '表现队列中…' : '结束玩家回合'
      : autoResolving ? '自动演算中…' : playbackActive ? '表现队列中…' : '推进一步'
    : simulationSpeed === 0
      ? '旅行一步'
      : traveling ? '暂停旅行' : '继续旅行'

  return (
    <main className="visual-prototype hex-prototype">
      <header className="visual-hud">
        <div className="visual-brand">
          <p className="eyebrow">ProjectC · Hex6 Map Structure Lab</p>
          <h1>{mapStructure === 'room' ? '小房间尺寸验证' : '连续大地图验证'}</h1>
        </div>
        <div className="hex-mode-switch" role="tablist" aria-label="地图操作模式">
          <button className={mode === 'travel' ? 'active' : ''} onClick={() => mode === 'travel' ? undefined : resumeTravel()}>旅行 Travel</button>
          <button className={mode === 'tactical' ? 'active' : ''} onClick={() => mode === 'tactical' ? undefined : enterTactical()}>战术 Tactical</button>
        </div>
        <div className="hex-view-switch" role="tablist" aria-label="地图表现方式">
          <button className={rendererMode === '2d' ? 'active' : ''} onClick={() => { setRendererMode('2d'); setHoverCoord(undefined) }}>2D</button>
          <button className={rendererMode === '3d' ? 'active' : ''} onClick={() => { setRendererMode('3d'); setHoverCoord(undefined) }}>3D</button>
        </div>
        <div className="visual-turn-strip">
          <div><span>World</span><strong>{state.turn}</strong></div>
          <div><span>Mode</span><strong>{mode === 'travel' ? 'Travel' : phaseLabel(state.phase)}</strong></div>
          <div><span>{mode === 'travel' ? 'Clock' : 'AP'}</span><strong>{mode === 'travel' ? `${travelProgress}/${state.config.baseAP}` : state.ap}</strong></div>
          <label className="visual-speed-control">
            <span>{mode === 'travel' ? '旅行速度' : '演算速度'}</span>
            <input aria-label="Hex6 推进速度" type="range" min="0" max="4" step="1" value={simulationSpeed} onChange={(eventValue) => setSimulationSpeed(Number(eventValue.target.value))} />
            <strong>{speedLabels[simulationSpeed]}</strong>
          </label>
          <button className="visual-primary" disabled={topActionDisabled} onClick={topAction}>{topActionLabel}</button>
        </div>
      </header>

      <section className="visual-layout">
        <aside className="visual-panel visual-left-panel">
          <section className="visual-actor-card">
            <div className="visual-portrait hex-portrait">⬡</div>
            <div>
              <p>{mode === 'travel' ? 'Travel Actor' : 'Tactical Actor'}</p>
              <h2>{player.name}</h2>
              <div className="visual-bars">
                <div><span>HP</span><i><b style={{ width: `${(player.hp / player.maxHp) * 100}%` }} /></i><strong>{player.hp}/{player.maxHp}</strong></div>
                <div><span>体温</span><i className="temperature"><b style={{ width: `${((player.bodyTemperature + 3) / 6) * 100}%` }} /></i><strong>{formatTemperature(player.bodyTemperature)}</strong></div>
              </div>
            </div>
          </section>

          <section className="hex-map-structure-panel">
            <div className="visual-section-heading"><h3>地图结构</h3><span>{mapStructure === 'room' ? `Room R${roomRadius}` : 'World 16×12'}</span></div>
            <div className="hex-structure-switch">
              <button className={mapStructure === 'world' ? 'active' : ''} onClick={() => loadScenario('world', roomRadius)}>大地图 World</button>
              <button className={mapStructure === 'room' ? 'active' : ''} onClick={() => loadScenario('room', roomRadius)}>小房间 Room</button>
            </div>
            {mapStructure === 'room' ? (
              <div className="hex-room-size-control">
                <div><span>房间半径</span><strong>R{roomRadius}</strong></div>
                <input aria-label="Hex6 房间大小" type="range" min={ROOM_MIN_RADIUS} max={ROOM_MAX_RADIUS} step="1" value={roomRadius} onChange={(eventValue) => loadScenario('room', Number(eventValue.target.value))} />
                <div className="hex-room-size-labels"><span>紧凑 · 19 Cells</span><span>宽阔 · 169 Cells</span></div>
                <div className="hex-room-metrics">
                  <div><span>最长轴</span><strong>{roomRadius * 2 + 1} 格</strong></div>
                  <div><span>有效 Cell</span><strong>{activeCellCount}</strong></div>
                  <div><span>山体碰撞</span><strong>{mountainCellCount}</strong></div>
                </div>
              </div>
            ) : (
              <p className="hex-world-structure-note">保留当前连续 16×12 地图作为对照。切回 Room 后可继续用滑杆比较战术空间密度。</p>
            )}
          </section>

          {mode === 'travel' ? (
            <section className="hex-travel-panel">
              <div className="visual-section-heading"><h3>旅行控制</h3><span>{traveling ? '自动行进中' : '已暂停'}</span></div>
              <div className="hex-route-preference">
                <button className={travelPreference === 'fastest' ? 'active fastest' : ''} onClick={() => setTravelPreference('fastest')}>最快路线</button>
                <button className={travelPreference === 'safest' ? 'active' : ''} onClick={() => setTravelPreference('safest')}>安全路线</button>
              </div>
              <div className="hex-travel-clock">
                <div><i style={{ width: `${travelProgress / Math.max(1, state.config.baseAP) * 100}%` }} /></div>
                <p>每累计移动 {state.config.baseAP} 格推进一次世界演算。提高基础 AP 会增加单位世界时间内的旅行距离。</p>
              </div>
              <div className="hex-travel-metrics">
                <div><span>剩余格数</span><strong>{pathSummary.steps}</strong></div>
                <div><span>预计演算</span><strong>{pathSummary.expectedTicks}</strong></div>
                <div><span>路线风险</span><strong>{pathSummary.risk}</strong></div>
              </div>
              <div className="hex-travel-controls">
                <button disabled={travelPath.length <= 1} onClick={() => simulationSpeed === 0 ? performTravelStep() : setTraveling((value) => !value)}>{simulationSpeed === 0 ? '推进一格' : traveling ? '暂停' : '继续'}</button>
                <button onClick={() => enterTactical('玩家主动检查局部态势')}>进入战术</button>
              </div>
              <p className="hex-travel-status">{travelMessage}</p>
            </section>
          ) : (
            <section>
              <div className="visual-section-heading"><h3>基础行动</h3><span>{selectedLabel}</span></div>
              <div className="visual-action-grid">
                <button className={selection.kind === 'basic' && selection.action === 'move' ? 'active sticky' : ''} disabled={playbackActive || state.phase !== 'player' || state.ap < 1} onClick={() => chooseBasicAction('move')}><span>⬡</span><strong>六向移动</strong><small>1 AP / 格 · 保持选择</small></button>
                <button className={selection.kind === 'basic' && selection.action === 'attack' ? 'active danger' : ''} disabled={playbackActive || state.phase !== 'player' || state.ap < 1} onClick={() => chooseBasicAction('attack')}><span>⚔</span><strong>邻接攻击</strong><small>六方向 · 1 AP</small></button>
              </div>
              <div className="hex-travel-controls">
                <button disabled={Boolean(threat) || state.phase !== 'player'} onClick={resumeTravel}>恢复旅行</button>
                <button onClick={() => setCameraResetToken((value) => value + 1)}>重置镜头</button>
              </div>
              <p className="hex-travel-status">{threat ? `${threat.actor.name} 距离 ${threat.distance}：需解除威胁后恢复旅行。` : '当前无近距威胁，可以恢复原旅行目标。'}</p>
            </section>
          )}

          <section>
            <div className="visual-section-heading"><h3>验证目标</h3><span>{state.status}</span></div>
            <div className="visual-objectives">{objectives.map((item) => <div className={item.done ? 'done' : ''} key={item.label}><span>{item.done ? '✓' : '○'}</span><p>{item.label}</p></div>)}</div>
          </section>
        </aside>

        <section className="visual-board-column hex-board-column">
          <div className="hex-comparison-strip">
            <strong>{mapStructure === 'room' ? `紧凑房间 · R${roomRadius}` : mode === 'travel' ? '连续地图旅行' : '同坐标战术局部'}</strong>
            <span>{mapStructure === 'room'
              ? `${activeCellCount} 个有效 Cell、${mountainCellCount} 个山体；比较隘口、侧翼和视线。`
              : mode === 'travel'
                ? '点击远端目标后自动沿路径移动；世界、敌人和天气按旅行时钟推进。'
                : 'Actor、Ground、Sky 与旅行模式保持原坐标，只切换操作粒度和信息密度。'}</span>
            <span>{travelTarget ? `目标 (${travelTarget.x},${travelTarget.y})` : '尚未选择目标'}</span>
          </div>
          <div className="visual-board-toolbar">
            <div className="visual-camera-help">
              <button onClick={() => setCameraResetToken((value) => value + 1)}>重置视图</button>
              <span>{rendererMode === '3d'
                ? mode === 'travel'
                  ? '3D 旅行：点击远端 Hex 规划路径；拖动旋转，滚轮缩放。'
                  : '3D 战术：拖动旋转 · 滚轮缩放 · 逐格战术操作。'
                : mode === 'travel'
                  ? '2D 旅行：总览路径、风险、地标与世界状态。'
                  : '2D 战术：有效目标、敌人意图与计划中的旅行路径同时可见。'}</span>
            </div>
            <div className="visual-layer-switch">
              <button className={targetLayer === 'ground' ? 'active' : ''} onClick={() => setTargetLayer('ground')}>Ground</button>
              <button className={targetLayer === 'sky' ? 'active' : ''} onClick={() => setTargetLayer('sky')}>Sky</button>
            </div>
            <div className="visual-session-controls">
              <button className="visual-undo" disabled={undoStack.length === 0} onClick={undo}>↶ 悔棋 <small>{undoStack.length}</small></button>
              <button className={showSky ? 'active' : ''} onClick={() => setShowSky((value) => !value)}>天空层</button>
              <button className={showDebug ? 'active' : ''} onClick={() => setShowDebug((value) => !value)}>Debug</button>
              <button className="visual-restart" onClick={restart}>重开地图</button>
            </div>
          </div>

          <div className={`visual-board-frame hex-board-frame view-${rendererMode}`}>
            {rendererMode === '2d' ? (
              <HexTravelMap
                state={state}
                mode={mode}
                path={travelPath}
                selectedCoord={selectedCoord}
                hoverCoord={hoverCoord}
                selection={selection}
                targetLayer={targetLayer}
                preference={travelPreference}
                onCellClick={handleBoardClick}
                onCellHover={setHoverCoord}
              />
            ) : (
              <HexThreeBoard
                state={state}
                mode={mode}
                travelPath={travelPath}
                travelTarget={travelTarget}
                travelPreference={travelPreference}
                selectedCoord={selectedCoord}
                hoverCoord={hoverCoord}
                selection={selection}
                targetLayer={targetLayer}
                cameraResetToken={cameraResetToken}
                showSky={showSky}
                showDebug={showDebug}
                event={currentEvent}
                onCellClick={handleBoardClick}
                onCellHover={setHoverCoord}
              />
            )}
            {currentEvent && <div className={`visual-event-banner ${currentEvent.kind}`}><strong>{currentEvent.label ?? 'Hex6 状态演出'}</strong>{currentEvent.amount ? <span>{currentEvent.kind === 'attack' ? '伤害' : '变化'} {currentEvent.amount}</span> : null}{eventQueue.length > 1 ? <small>后续 {eventQueue.length - 1} 项</small> : null}</div>}
            {mode === 'tactical' && travelMessage.startsWith('旅行被打断') && <div className="hex-interrupt-banner">{travelMessage}</div>}
            <div className="visual-board-legend"><span><i className="cold" />偏冷</span><span><i className="neutral" />中性</span><span><i className="hot" />偏热</span><span><i className="cloud" />Ground / Sky 连续共享</span><span className="hex-collision-legend"><i />山体：阻挡移动 / 击退 / 直线</span></div>
          </div>

          {mode === 'tactical' ? (
            <section className="visual-hand">
              <div className="visual-hand-heading"><div><h2>介入物 / 手牌</h2><p>旅行期间牌序保持；进入战术后恢复逐 AP 出牌。</p></div><span>Deck {state.deck.length} · Discard {state.discard.length}</span></div>
              <div className="visual-card-row">{handCards.map((card) => { const active = selection.kind === 'card' && selection.card.id === card.id; const temperatureClass = card.effect.includes('cool') ? 'cool' : card.effect.includes('heat') || card.effect === 'grip' ? 'heat' : ''; return <button className={`visual-card ${active ? 'active' : ''} ${temperatureClass}`} disabled={playbackActive || state.phase !== 'player' || state.ap < card.cost || state.status !== 'active'} key={card.id} onClick={() => chooseCard(card)}><div className="visual-card-cost">{card.cost}</div><div className="visual-card-icon">{cardIcons[card.effect]}</div><strong>{card.name}</strong><p>{card.description}</p><small>{card.target === 'self' ? '自身' : `${card.range} Hex · ${card.layer ?? card.target}`}</small></button> })}</div>
            </section>
          ) : (
            <section className="visual-hand hex-travel-hand-note">
              <p>旅行模式收起卡牌操作，只保留路线、风险、发现与世界时间。切入战术时使用同一手牌、牌库和弃牌堆。</p>
              <div className="hex-travel-route-list"><div><span>路线</span><strong>{travelPreference === 'fastest' ? '最快' : '安全'}</strong></div><div><span>移动成本</span><strong>{pathSummary.movementCost}</strong></div><div><span>世界演算</span><strong>{worldTicks}</strong></div><div><span>近距威胁</span><strong>{threat ? `${threat.distance} Hex` : '无'}</strong></div></div>
            </section>
          )}
        </section>

        <aside className="visual-panel visual-right-panel">
          <section>
            <div className="visual-section-heading"><h3>Hex Inspector</h3><span>({inspectCoord.x},{inspectCoord.y}) · D{selectedDistance}</span></div>
            {inspectedCell && <div className="visual-inspector-stack"><div className="visual-inspector-block ground"><div className="visual-inspector-title"><span className={`visual-temp-orb temp-${Math.max(-3, Math.min(3, inspectedCell.groundTemp)) + 3}`} /><div><strong>Ground Hex</strong><p>{inspectedCell.tags.includes('Blocked') ? '不可通行山脊' : '连续地图地面层'}</p></div></div><dl><div><dt>Temperature</dt><dd>{formatTemperature(inspectedCell.groundTemp)}</dd></div><div><dt>Fill</dt><dd>{inspectedCell.groundFill}</dd></div><div><dt>Moisture</dt><dd>{inspectedCell.moisture}</dd></div><div><dt>Tags</dt><dd>{inspectedCell.tags.join(', ') || '—'}</dd></div></dl></div><div className={`visual-inspector-block sky ${inspectedCell.skyFill === 'clear' ? 'is-clear' : ''}`}><div className="visual-inspector-title"><span className={`visual-temp-orb temp-${Math.max(-3, Math.min(3, inspectedCell.skyTemp)) + 3}`} /><div><strong>Sky Hex</strong><p>旅行与战术共用的上层状态</p></div></div><dl><div><dt>Temperature</dt><dd>{formatTemperature(inspectedCell.skyTemp)}</dd></div><div><dt>Fill</dt><dd>{inspectedCell.skyFill}</dd></div><div><dt>Cloud Age</dt><dd>{inspectedCell.cloudAge || '—'}</dd></div><div><dt>Wind</dt><dd>{String(inspectedCell.wind ?? '—')}</dd></div><div><dt>Intent</dt><dd>{inspectedCell.intents.map((intent) => `${intent.type} T+${intent.countdown}`).join(', ') || '—'}</dd></div></dl></div></div>}
            {inspectedActor && <div className="visual-inspector-block actor"><div className="visual-inspector-title"><span className={`visual-faction ${inspectedActor.faction}`} /><div><strong>{inspectedActor.name}</strong><p>{inspectedActor.actorType} · {inspectedActor.intent || '无公开意图'}</p></div></div><dl><div><dt>HP / Shield</dt><dd>{inspectedActor.hp}/{inspectedActor.maxHp} · {inspectedActor.shield}</dd></div><div><dt>体温 / 平衡</dt><dd>{formatTemperature(inspectedActor.bodyTemperature)} / {formatTemperature(inspectedActor.balanceTemperature)}</dd></div><div><dt>Mass</dt><dd>{inspectedActor.mass}</dd></div></dl></div>}
          </section>

          <section>
            <div className="visual-section-heading"><h3>地图时间线</h3><span>{playbackActive ? `表现队列 ${eventQueue.length}` : mode === 'travel' ? `Clock ${travelProgress}/${state.config.baseAP}` : autoResolving ? `${speedLabels[simulationSpeed]} 自动演算` : '最近日志'}</span></div>
            <div className="visual-causality">{state.logs.slice(0, 9).map((log, index) => <div key={`${index}-${log}`}><span>{index + 1}</span><p>{log}</p></div>)}</div>
          </section>

          <section className="visual-slice-note">
            <h3>本轮验证问题</h3>
            <p>{mapStructure === 'room' ? '哪一个房间半径能在移动自由、卡牌覆盖和局部拥挤之间形成最佳张力？' : '最快路线是否因为天气与敌人变得不稳定，而安全路线值得额外距离？'}</p>
            <p>每 baseAP 格推进一次世界后，高 AP 是否自然表现为更高旅行机动性？</p>
            <p>遭遇切入战术后，位置、天气和剩余路径是否仍然连续、可理解？</p>
          </section>
        </aside>
      </section>
    </main>
  )
}
