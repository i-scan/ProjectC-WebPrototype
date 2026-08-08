import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CARD_LIBRARY,
  actorAt,
  cellAt,
  getPlayer,
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
import { ThermalPendulumPortal } from './ThermalPendulumPortal'
import type {
  ThermalClockRuntimeAction,
  ThermalClockRuntimeSignal,
} from './thermalClockRuntime'
import {
  activeScenarioCells,
  createHexRoomState,
  roomCellCount,
  ROOM_DEFAULT_RADIUS,
  ROOM_MAX_RADIUS,
  ROOM_MIN_RADIUS,
  type HexMapStructure,
} from './hexRoom'
import {
  AT_PLAYBACK_RATE_STEP,
  atPlaybackTiming,
  formatAtPlaybackRate,
  MAX_AT_PLAYBACK_RATE,
  playbackDelayForAt,
} from './atPlayback'
import { countMountainCells } from './hexTerrain'
import {
  allDrivePlans,
  applyUt2ActionPhase,
  createSpatialInertiaState,
  evaluateUt2Action,
  prepareUt2ChainScenario,
  rushStrikeTargets,
  spatialAfterUt2Action,
  type SpatialInertiaState,
} from './actionChain'
import {
  getHexNeighbors,
  hexDistance,
  isHexInside,
  performHexBasicAction,
  playHexCard,
  runHexActorReady,
  runHexGlobalEnvironment,
} from './hexRules'
import {
  actionKindFor,
  actionTimeFor,
  applyUnifiedFixedHand,
  createUnifiedTimeline,
  nextReadySummary,
  previewInterveningEvents,
  resolveUnifiedPlayerPhasedAction,
  resolveUnifiedPlayerAction,
  unifiedTimelineConfig,
  type TimelinePhaseTrace,
  type TimelineState,
} from './unifiedTimeline'
import type { HexDirection } from './hexTopology'
import {
  createHexTravelState,
  detectTravelInterrupt,
  findHexTravelPath,
  findNearestTravelThreat,
  movePlayerInTravel,
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

const maxUndoSteps = 120
type HexRenderer = '2d' | '3d'
type RightInspectorTab = 'hex' | 'thermal'

function eventKindForCard(card: Card): VisualEvent['kind'] {
  if (card.effect === 'cool-cell' || card.effect === 'cold-strike') return 'cool'
  if (card.effect === 'heat-cell' || card.effect === 'hot-strike' || card.effect === 'grip') return 'heat'
  if (card.effect === 'guard' || card.effect === 'temper') return 'guard'
  return 'attack'
}

function formatTemperature(value: number) {
  return value > 0 ? `+${value}` : String(value)
}

function fallbackEvent(kind: VisualEvent['kind'], target: Coord | undefined, label: string, durationAt = 0.5): PlaybackEvent {
  return { id: Date.now(), kind, target, label, effect: kind, durationAt }
}

type HexHistoryEntry = {
  state: GameState
  timeline: TimelineState
  spatialInertia: SpatialInertiaState
  lastActionPhases: TimelinePhaseTrace[]
  lastUt2ActionId?: 'drive' | 'rush-strike'
  mode: HexMode
  travelPath: Coord[]
  travelTarget?: Coord
  travelProgress: number
  worldTicks: number
  traveling: boolean
  travelMessage: string
  thermalAdvanced: boolean
}

export function HexPrototype() {
  const [mapStructure, setMapStructure] = useState<HexMapStructure>('room')
  const [roomRadius, setRoomRadius] = useState(ROOM_DEFAULT_RADIUS)
  const [state, setState] = useState(() => applyUnifiedFixedHand(prepareUt2ChainScenario(createHexRoomState(ROOM_DEFAULT_RADIUS))))
  const [timeline, setTimeline] = useState(createUnifiedTimeline)
  const [spatialInertia, setSpatialInertia] = useState(createSpatialInertiaState)
  const [lastActionPhases, setLastActionPhases] = useState<TimelinePhaseTrace[]>([])
  const [lastUt2ActionId, setLastUt2ActionId] = useState<'drive' | 'rush-strike'>()
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
  const [playbackRate, setPlaybackRate] = useState(1)
  const playbackTiming = useMemo(() => atPlaybackTiming(playbackRate), [playbackRate])
  const [eventQueue, setEventQueue] = useState<PlaybackEvent[]>([])
  const [travelPreference, setTravelPreference] = useState<TravelPreference>('fastest')
  const [travelPath, setTravelPath] = useState<Coord[]>([])
  const [travelTarget, setTravelTarget] = useState<Coord | undefined>()
  const [travelProgress, setTravelProgress] = useState(0)
  const [worldTicks, setWorldTicks] = useState(0)
  const [traveling, setTraveling] = useState(false)
  const [travelMessage, setTravelMessage] = useState('调整房间半径，比较战术密度、移动空间与环境覆盖。')
  const [rightInspectorTab, setRightInspectorTab] = useState<RightInspectorTab>('hex')
  const [thermalRuntimeSignal, setThermalRuntimeSignal] = useState<ThermalClockRuntimeSignal>()
  const thermalRuntimeSequenceRef = useRef(0)

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
  const activeCellCount = activeScenarioCells(state).length
  const mountainCellCount = countMountainCells(state)
  const queuedTimelineEvents = nextReadySummary(timeline)
  const drivePlans = allDrivePlans(state)
  const rushTargets = rushStrikeTargets(state, spatialInertia)
  const objectives = useMemo(() => [
    { done: timeline.worldTimeAt > 0, label: 'AT 推进全局时间' },
    { done: spatialInertia.chainOpen, label: 'Drive 生成 Chain Window' },
    { done: lastUt2ActionId === 'rush-strike', label: 'Rush Strike 读取 Momentum' },
  ], [timeline.worldTimeAt, spatialInertia.chainOpen, lastUt2ActionId])

  const nextThermalSequence = () => {
    thermalRuntimeSequenceRef.current += 1
    return thermalRuntimeSequenceRef.current
  }

  const emitThermalAction = (action: Omit<ThermalClockRuntimeAction, 'sequence' | 'type'>) => {
    setThermalRuntimeSignal({
      ...action,
      sequence: nextThermalSequence(),
      type: 'action',
    })
  }

  const emitThermalCommand = (type: 'undo' | 'restart') => {
    setThermalRuntimeSignal({ sequence: nextThermalSequence(), type })
  }

  const captureHistory = (
    snapshotState: GameState = state,
    thermalAdvanced = false,
  ): HexHistoryEntry => ({
    state: structuredClone(snapshotState),
    timeline: structuredClone(timeline),
    spatialInertia: structuredClone(spatialInertia),
    lastActionPhases: structuredClone(lastActionPhases),
    lastUt2ActionId,
    mode,
    travelPath: travelPath.map((coord) => ({ ...coord })),
    travelTarget: travelTarget ? { ...travelTarget } : undefined,
    travelProgress,
    worldTicks,
    traveling,
    travelMessage,
    thermalAdvanced,
  })

  const queueTransition = (
    before: GameState,
    after: GameState,
    fallbackKind: VisualEvent['kind'],
    fallbackTarget?: Coord,
    historyEntry: HexHistoryEntry = captureHistory(before),
    elapsedAt = 1,
  ) => {
    const cues = buildVisualEvents(before, after, fallbackTarget)
    if (cues.length === 1 && before.phase === after.phase && before.turn === after.turn && after.logs[0] !== before.logs[0]) {
      cues[0] = { ...cues[0], kind: fallbackKind, effect: fallbackKind, label: after.logs[0], target: fallbackTarget }
    }
    const durationAt = elapsedAt / Math.max(1, cues.length)
    const timedCues = cues.map((cue) => ({ ...cue, durationAt }))
    setUndoStack((current) => [...current, historyEntry].slice(-maxUndoSteps))
    setState(after)
    setEventQueue(timedCues.length > 0
      ? timedCues
      : [fallbackEvent(fallbackKind, fallbackTarget, after.logs[0] ?? 'Hex6 状态已更新', elapsedAt)])
  }

  const resolveAtomicAction = (
    before: GameState,
    immediate: GameState,
    actionId: string,
    source: ThermalClockRuntimeAction['source'],
    label: string,
    fallbackKind: VisualEvent['kind'],
    fallbackTarget?: Coord,
  ) => {
    const actionTime = actionTimeFor(actionId)
    const committed = structuredClone(immediate)
    if (spatialInertia.chainOpen) {
      committed.logs.unshift(`[UT2] 放弃 Pending Momentum ${spatialInertia.pendingMomentum} / ${spatialInertia.axis}，按常规 Intro 执行动作。`)
    }
    const resolution = resolveUnifiedPlayerAction(
      committed,
      timeline,
      actionTime,
      (value) => value,
      {
        resolveActor: runHexActorReady,
        resolveEnvironment: runHexGlobalEnvironment,
      },
    )
    resolution.value.phase = 'player'
    resolution.value.phaseQueue = []
    const historyEntry = captureHistory(before, true)
    setTimeline(resolution.timeline)
    setSpatialInertia(createSpatialInertiaState())
    setLastActionPhases([])
    setWorldTicks((value) => value + resolution.interveningEvents.filter((event) => event.type === 'environment').length)
    emitThermalAction({
      source,
      id: actionId,
      label,
      baseApCost: 0,
      actionTime: resolution.elapsedAt,
      offsetDelta: getPlayer(immediate).bodyTemperature - getPlayer(before).bodyTemperature,
    })
    queueTransition(before, resolution.value, fallbackKind, fallbackTarget, historyEntry, resolution.elapsedAt)
    return resolution
  }

  const resolveUt2Action = (
    actionId: 'drive' | 'rush-strike',
    direction: HexDirection,
    targetActorId?: string,
  ) => {
    if (playbackActive || mode !== 'tactical' || state.status !== 'active') return
    if (actionId === 'drive') {
      const plan = drivePlans.find((entry) => entry.direction === direction)
      if (!plan?.valid) {
        const invalid = structuredClone(state)
        invalid.logs.unshift(`[UT2] Drive 失败：${plan?.reason ?? '路线不可用'}。`)
        setState(invalid)
        return
      }
    }

    const evaluated = evaluateUt2Action(actionId, spatialInertia, direction)
    const before = state
    const historyEntry = captureHistory(before, true)
    const resolution = resolveUnifiedPlayerPhasedAction(
      before,
      timeline,
      evaluated.phases,
      (value, phase) => applyUt2ActionPhase(value, evaluated, phase, direction, targetActorId),
      {
        resolveActor: runHexActorReady,
        resolveEnvironment: runHexGlobalEnvironment,
      },
    )
    resolution.value.phase = 'player'
    resolution.value.phaseQueue = []
    const nextSpatial = spatialAfterUt2Action(evaluated, direction)
    setTimeline(resolution.timeline)
    setSpatialInertia(nextSpatial)
    setLastActionPhases(resolution.phases)
    setLastUt2ActionId(actionId)
    setWorldTicks((value) => value + resolution.interveningEvents.filter((event) => event.type === 'environment').length)
    emitThermalAction({
      source: 'card',
      id: actionId,
      label: `${evaluated.definition.label} · ${resolution.phases.map((phase) => `[${phase.label}]`).join(' → ')}${evaluated.chained ? ' · Chain' : ''}`,
      baseApCost: 0,
      actionTime: resolution.elapsedAt,
      offsetDelta: 0,
    })
    queueTransition(
      before,
      resolution.value,
      actionId === 'drive' ? 'move' : 'attack',
      actionId === 'drive' ? getPlayer(resolution.value).position : state.actors.find((actor) => actor.id === targetActorId)?.position,
      historyEntry,
      resolution.elapsedAt,
    )
    setSelection({ kind: 'inspect' })
  }

  const resolveCardAttempt = (
    before: GameState,
    after: GameState,
    card: Card,
    fallbackTarget?: Coord,
  ): boolean => {
    const cardPlayed = after.logs[0] !== before.logs[0] && !after.logs[0]?.includes('失败')
    if (!cardPlayed) {
      // Preserve the rule failure log, but do not create undo history or visual playback.
      setState(after)
      return false
    }
    resolveAtomicAction(
      before,
      after,
      card.id,
      'card',
      `原子动作 · ${card.name} · ${actionTimeFor(card.id)} AT`,
      eventKindForCard(card),
      fallbackTarget,
    )
    return true
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
    const immediate = movePlayerInTravel(before, destination)
    if (getPlayer(immediate).position.x === getPlayer(before).position.x && getPlayer(immediate).position.y === getPlayer(before).position.y) {
      setTraveling(false)
      setTravelMessage('下一格已被阻挡，旅行暂停并等待重新规划。')
      return
    }

    const remainingPath = travelPath.slice(1)
    const resolution = resolveAtomicAction(
      before,
      immediate,
      'move',
      'travel',
      '旅行原子动作 · Quick Step · 1 AT',
      'move',
      destination,
    )
    const after = resolution.value
    setSelectedCoord({ ...destination })
    setTravelPath(remainingPath)
    setTravelProgress(0)

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
    setTravelMessage(`旅行中：剩余 ${remainingPath.length - 1} 格；全局时间 ${resolution.timeline.worldTimeAt} AT。`)
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
    const timer = window.setTimeout(
      () => setEventQueue((current) => current.slice(1)),
      playbackDelayForAt(playbackTiming, eventQueue[0]?.durationAt ?? 0.5),
    )
    return () => window.clearTimeout(timer)
  }, [eventQueue, playbackTiming])

  useEffect(() => {
    if (mode !== 'travel' || !traveling || playbackTiming.manual || travelPath.length <= 1 || eventQueue.length > 0 || state.status !== 'active') return
    performTravelStep()
  }, [mode, traveling, playbackTiming.manual, travelPath, eventQueue.length, state, travelProgress])

  useEffect(() => {
    if (!travelTarget || mode !== 'travel' || traveling) return
    const path = findHexTravelPath(state, player.position, travelTarget, travelPreference)
    setTravelPath(path)
  }, [travelPreference])

  const executeBasicAction = (action: BasicAction, coord: Coord) => {
      const before = state
      const immediate = performHexBasicAction(before, action, coord, { useActionPoints: false })
      const succeeded = immediate.logs[0] !== before.logs[0] && !immediate.logs[0]?.includes('失败')
      if (!succeeded) {
        setState(immediate)
        return false
      }
      resolveAtomicAction(
        before,
        immediate,
        action,
        'basic-action',
        `${action === 'move' ? 'Basic Move' : 'Basic Attack'} · 1 AT`,
        action === 'move' ? 'move' : 'attack',
        coord,
      )
      if (action === 'attack') setSelection({ kind: 'inspect' })
      return true
  }

  const handleBoardClick = (coord: Coord) => {
    setSelectedCoord(coord)
    if (playbackActive || state.status !== 'active') return
    if (mode === 'travel') {
      planTravel(coord, true)
      return
    }
    if (selection.kind === 'basic') {
      executeBasicAction(selection.action, coord)
      return
    }
    if (selection.kind === 'card') {
      const before = state
      const after = playHexCard(before, selection.card.id, coord, targetLayer, { useActionPoints: false, consumeCard: false })
      const cardPlayed = resolveCardAttempt(before, after, selection.card, coord)
      if (cardPlayed) setSelection({ kind: 'inspect' })
      return
    }

    const clickedActor = actorAt(state, coord)
    if (clickedActor?.faction === 'enemy' && hexDistance(player.position, coord) === 1) {
      executeBasicAction('attack', coord)
      return
    }
    const clickedCell = cellAt(state, coord)
    if (clickedCell && hexDistance(player.position, coord) === 1 && !clickedCell.tags.includes('Blocked') && !actorAt(state, coord)) {
      executeBasicAction('move', coord)
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
      const after = playHexCard(before, card.id, undefined, targetLayer, { useActionPoints: false, consumeCard: false })
      resolveCardAttempt(before, after, card, player.position)
      setSelection({ kind: 'inspect' })
      return
    }
    setSelection((current) => current.kind === 'card' && current.card.id === card.id ? { kind: 'inspect' } : { kind: 'card', card })
    if (card.layer === 'ground' || card.layer === 'sky') setTargetLayer(card.layer)
  }

  const advance = () => {
    if (playbackActive || mode !== 'tactical') return
    const before = state
    const immediate = structuredClone(before)
    immediate.logs.unshift('玩家观察并等待：不产生即时效果。')
    resolveAtomicAction(before, immediate, 'wait', 'system', 'Observe · 1 AT', 'phase', player.position)
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
    setPlaybackRate(0)
    setUndoStack((current) => current.slice(0, -1))
    setState(previous.state)
    setTimeline(previous.timeline)
    setSpatialInertia(previous.spatialInertia)
    setLastActionPhases(previous.lastActionPhases)
    setLastUt2ActionId(previous.lastUt2ActionId)
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
    setEventQueue([fallbackEvent('reset', getPlayer(previous.state).position, `悔棋：World ${previous.timeline.worldTimeAt} AT · ${previous.mode === 'travel' ? '旅行' : '战术'}`)])
    if (previous.thermalAdvanced) emitThermalCommand('undo')
  }

  const loadScenario = (structure: HexMapStructure, radius = roomRadius) => {
    const scenarioState = structure === 'room'
      ? createHexRoomState(radius, { turnMode: state.config.turnMode, baseAP: state.config.baseAP })
      : createHexTravelState({ turnMode: state.config.turnMode, baseAP: state.config.baseAP })
    const next = applyUnifiedFixedHand(prepareUt2ChainScenario(scenarioState))
    const start = getPlayer(next).position
    setMapStructure(structure)
    setRoomRadius(radius)
    setState(next)
    setTimeline(createUnifiedTimeline())
    setSpatialInertia(createSpatialInertiaState())
    setLastActionPhases([])
    setLastUt2ActionId(undefined)
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
    emitThermalCommand('restart')
  }

  const restart = () => loadScenario(mapStructure, roomRadius)

  const selectedLabel = selection.kind === 'inspect'
    ? '查看六边态势'
    : selection.kind === 'basic'
      ? selection.action === 'move'
        ? '连续移动：六个方向中选择相邻格'
        : '选择六边邻接敌人'
      : `为「${selection.card.name}」选择六边距离目标`
  const previewActionId = selection.kind === 'basic'
    ? selection.action
    : selection.kind === 'card'
      ? selection.card.id
      : spatialInertia.chainOpen ? 'rush-strike' : 'drive'
  const previewRushDirection = rushTargets.find((target) => target.chained)?.direction ?? spatialInertia.axis ?? 'E'
  const previewUt2Action = previewActionId === 'drive' || previewActionId === 'rush-strike'
    ? evaluateUt2Action(previewActionId, spatialInertia, previewActionId === 'drive' ? 'E' : previewRushDirection)
    : undefined
  const previewActionTime = previewUt2Action?.actionTimeAt ?? actionTimeFor(previewActionId)
  const previewEvents = previewInterveningEvents(timeline, previewActionTime)
  const topActionDisabled = state.status !== 'active' || playbackActive || (mode === 'travel' && travelPath.length <= 1)

  const topAction = () => {
    if (mode === 'tactical') {
      advance()
      return
    }
    if (playbackTiming.manual) {
      performTravelStep()
      return
    }
    setTraveling((value) => !value)
  }

  const topActionLabel = mode === 'tactical'
    ? playbackActive ? '表现队列中…' : '等待 1 AT'
    : playbackTiming.manual
      ? '旅行一步'
      : traveling ? '暂停旅行' : '继续旅行'

  return (
    <>
      <main
        className={`visual-prototype hex-prototype inspector-${rightInspectorTab} ${spatialInertia.chainOpen ? 'chain-open' : ''}`}
        data-ruleset-id={unifiedTimelineConfig.rulesetId}
        data-implementation-id={unifiedTimelineConfig.implementationId}
        data-world-time-at={timeline.worldTimeAt}
        data-chain-open={spatialInertia.chainOpen}
      >
        <header className="visual-hud">
          <div className="visual-brand">
            <p className="eyebrow">ProjectC · VAL-012-UT2 · action-chain-phase-v1</p>
            <h1>{mapStructure === 'room' ? 'Hex6 动作链与统一时间验证' : '连续世界动作时间验证'}</h1>
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
            <div><span>World Time</span><strong>{timeline.worldTimeAt} AT</strong></div>
            <div><span>Player Ready</span><strong>{timeline.actors.player.nextReadyAt} AT</strong></div>
            <div><span>Next Event</span><strong>{queuedTimelineEvents[0]?.timeAt ?? '—'} AT</strong></div>
            <label className="visual-speed-control hex-at-playback-control" data-at-playback-control="v1" title="只改变播放节奏，不改变规则结算与世界时间">
              <span>AT 播放速度</span>
              <input aria-label="每 AT 播放速度" type="range" min="0" max={MAX_AT_PLAYBACK_RATE} step={AT_PLAYBACK_RATE_STEP} value={playbackRate} onChange={(eventValue) => setPlaybackRate(Number(eventValue.target.value))} />
              <strong>{formatAtPlaybackRate(playbackTiming)}</strong>
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
                  <div><i style={{ width: `${(timeline.worldTimeAt % unifiedTimelineConfig.thermalPeriodAt) / unifiedTimelineConfig.thermalPeriodAt * 100}%` }} /></div>
                  <p>每移动一格是完整的 1 AT 原子动作；敌人、环境与 Thermal Clock 使用同一条全局时间轴。</p>
                </div>
                <div className="hex-travel-metrics">
                  <div><span>剩余格数</span><strong>{pathSummary.steps}</strong></div>
                  <div><span>预计耗时</span><strong>{pathSummary.steps} AT</strong></div>
                  <div><span>路线风险</span><strong>{pathSummary.risk}</strong></div>
                </div>
                <div className="hex-travel-controls">
                  <button disabled={travelPath.length <= 1} onClick={() => playbackTiming.manual ? performTravelStep() : setTraveling((value) => !value)}>{playbackTiming.manual ? '推进一格' : traveling ? '暂停' : '继续'}</button>
                  <button onClick={() => enterTactical('玩家主动检查局部态势')}>进入战术</button>
                </div>
                <p className="hex-travel-status">{travelMessage}</p>
              </section>
            ) : (
              <section>
                <div className="visual-section-heading"><h3>基础行动</h3><span>{selectedLabel}</span></div>
                <div className="visual-action-grid">
                  <button className={selection.kind === 'basic' && selection.action === 'move' ? 'active sticky' : ''} disabled={playbackActive} onClick={() => chooseBasicAction('move')}><span>⬡</span><strong>Basic Move</strong><small>空格点击直达 · 1 AT</small></button>
                  <button className={selection.kind === 'basic' && selection.action === 'attack' ? 'active danger' : ''} disabled={playbackActive} onClick={() => chooseBasicAction('attack')}><span>⚔</span><strong>Basic Attack</strong><small>敌人格点击直达 · 1 AT</small></button>
                </div>
                <p className="hex-travel-status">{threat ? `${threat.actor.name} 距离 ${threat.distance}：需解除威胁后才能返回旅行。` : '当前无近距威胁；可使用顶部 Travel 切换返回旅行。'}</p>
              </section>
            )}

            <section>
              <div className="visual-section-heading"><h3>验证目标</h3><span>{state.status}</span></div>
              <div className="visual-objectives">{objectives.map((item) => <div className={item.done ? 'done' : ''} key={item.label}><span>{item.done ? '✓' : '○'}</span><p>{item.label}</p></div>)}</div>
            </section>
          </aside>

          <section className="visual-board-column hex-board-column">
            <div className="hex-comparison-strip">
              <strong>{mapStructure === 'room' ? `UT2 动作链房间 · R${roomRadius}` : mode === 'travel' ? '连续地图旅行' : '同坐标战术局部'}</strong>
              <span>{mapStructure === 'room'
                ? `${activeCellCount} 个有效 Cell、${mountainCellCount} 个山体；比较隘口、侧翼和视线。`
                : mode === 'travel'
                  ? '点击远端目标后自动沿路径移动；世界、敌人和天气按旅行时钟推进。'
                  : 'Actor、Ground、Sky 与旅行模式保持原坐标，只切换操作粒度和信息密度。'}</span>
              <span>{travelTarget ? `目标 (${travelTarget.x},${travelTarget.y})` : '尚未选择目标'}</span>
            </div>
            <section className="unified-time-preview" aria-label="统一行动预览">
              <div><span>Now</span><strong>{timeline.worldTimeAt} AT</strong></div>
              <div><span>选择</span><strong>{previewActionTime} AT · {previewUt2Action?.definition.label ?? actionKindFor(previewActionId)}</strong></div>
              <div><span>再次就绪</span><strong>{timeline.worldTimeAt + previewActionTime} AT</strong></div>
              <div className="ut2-phase-preview"><span>Action Phases</span><strong>{previewUt2Action ? previewUt2Action.phases.map((phase, index) => `[${index + 1}] ${phase.label}`).join(' → ') : 'Legacy atomic compatibility'}</strong></div>
              <div className="unified-time-preview-events"><span>期间事件</span><strong>{previewEvents.length ? previewEvents.map((event) => `${event.timeAt}:${event.sourceId}`).join(' · ') : '无'}</strong></div>
            </section>
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
              {spatialInertia.chainOpen && (
                <div className="ut2-chain-window" role="status" aria-live="polite">
                  <small>CHAIN WINDOW · 世界暂停 · 不限时</small>
                  <strong>Pending Momentum {spatialInertia.pendingMomentum} <b>→ {spatialInertia.axis}</b></strong>
                  <span>选择同轴 Rush Strike：跳过 Start，AT2 → AT1</span>
                </div>
              )}
              {mode === 'tactical' && travelMessage.startsWith('旅行被打断') && <div className="hex-interrupt-banner">{travelMessage}</div>}
              <div className="visual-board-legend"><span><i className="cold" />偏冷</span><span><i className="neutral" />中性</span><span><i className="hot" />偏热</span><span><i className="cloud" />Ground / Sky 连续共享</span><span className="hex-collision-legend"><i />山体：阻挡移动 / 击退 / 直线</span></div>
            </div>

            {mode === 'tactical' ? (
              <section className="visual-hand">
                <div className="visual-hand-heading"><div><h2>UT2 动作链</h2><p>Action = Intro → AT Phases → Outro；先完成 Drive，再在暂停节点选择顺势攻击。</p></div><span>{spatialInertia.chainOpen ? 'Chain Open' : 'Player Ready'}</span></div>
                <div className="ut2-action-grid">
                  <article className="ut2-action-card drive">
                    <div className="ut2-action-title"><div><b>2<small>AT</small></b><span>Drive</span></div><em>Outro · Chain</em></div>
                    <div className="ut2-phase-row"><span>[1] Step 1 <b>M1</b></span><i>→</i><span>[2] Dash 2 <b>M2</b></span></div>
                    <p>选择三格无阻直线。每个 Phase 后世界处理到点事件。</p>
                    <div className="ut2-direction-buttons" aria-label="Drive Axis">
                      {drivePlans.map((plan) => <button data-action-id="drive" data-axis={plan.direction} key={plan.direction} disabled={playbackActive || !plan.valid} title={plan.valid ? `沿 ${plan.direction} 推进三格` : plan.reason} onClick={() => resolveUt2Action('drive', plan.direction)}>{plan.direction}</button>)}
                    </div>
                  </article>
                  <article className={`ut2-action-card rush ${rushTargets.some((target) => target.chained) ? 'chain-ready' : ''}`}>
                    <div className="ut2-action-title"><div><b>{rushTargets.some((target) => target.chained) ? 1 : 2}<small>AT</small></b><span>Rush Strike</span></div><em>{rushTargets.some((target) => target.chained) ? 'Intro skipped' : 'Base AT2'}</em></div>
                    <div className="ut2-phase-row"><span className={rushTargets.some((target) => target.chained) ? 'skipped' : ''}>[1] Start</span><i>→</i><span>[2] Strike</span></div>
                    <p>{spatialInertia.chainOpen ? `读取 Pending M${spatialInertia.pendingMomentum} / ${spatialInertia.axis}；同轴目标可顺势出手。` : '从静止使用时保留 Start，完整占用 2 AT。'}</p>
                    <div className="ut2-rush-targets">
                      {rushTargets.length > 0
                        ? rushTargets.map((target) => <button className={target.chained ? 'chain-target' : ''} data-action-id="rush-strike" data-axis={target.direction} data-chain-compatible={target.chained} data-target-actor={target.actor.id} disabled={playbackActive} key={target.actor.id} onClick={() => resolveUt2Action('rush-strike', target.direction, target.actor.id)}>{target.actor.name}<small>{target.direction} · {target.chained ? 'Chain AT1' : 'AT2'}</small></button>)
                        : <span>需要一个相邻敌人；固定场景先向 E 使用 Drive。</span>}
                    </div>
                  </article>
                </div>
                <details className="ut2-legacy-actions">
                  <summary>UT1 Thermal 介入动作 · {handCards.length}</summary>
                  <div className="visual-card-row">{handCards.map((card) => { const active = selection.kind === 'card' && selection.card.id === card.id; const temperatureClass = card.effect.includes('cool') ? 'cool' : card.effect.includes('heat') || card.effect === 'grip' ? 'heat' : ''; const actionTime = actionTimeFor(card.id); return <button className={`visual-card ${active ? 'active' : ''} ${temperatureClass}`} disabled={playbackActive || state.status !== 'active'} key={card.id} onClick={() => chooseCard(card)}><div className="visual-card-cost">{actionTime}<small>AT</small></div><div className="visual-card-icon">{cardIcons[card.effect]}</div><strong>{card.name}</strong><p>{card.description}</p><small>{card.target === 'self' ? '自身' : `${card.range} Hex · ${card.layer ?? card.target}`} · UT1 compatibility</small></button> })}</div>
                </details>
              </section>
            ) : (
              <section className="visual-hand hex-travel-hand-note">
                <p>旅行与 Tactical 不再使用两套时钟：每格 1 AT，并在玩家再次就绪前结算共享队列中的敌人与环境事件。</p>
                <div className="hex-travel-route-list"><div><span>路线</span><strong>{travelPreference === 'fastest' ? '最快' : '安全'}</strong></div><div><span>移动成本</span><strong>{pathSummary.movementCost}</strong></div><div><span>世界时间</span><strong>{timeline.worldTimeAt} AT</strong></div><div><span>近距威胁</span><strong>{threat ? `${threat.distance} Hex` : '无'}</strong></div></div>
              </section>
            )}
          </section>

          <aside className={`visual-panel visual-right-panel inspector-panel-${rightInspectorTab}`}>
            <div className="hex-inspector-tabs" role="tablist" aria-label="右侧 Inspector">
              <button
                id="hex-inspector-tab"
                type="button"
                role="tab"
                aria-controls="hex-inspector-content"
                aria-selected={rightInspectorTab === 'hex'}
                className={rightInspectorTab === 'hex' ? 'active' : ''}
                onClick={() => setRightInspectorTab('hex')}
              >
                Hex Inspector
              </button>
              <button
                id="thermal-inspector-tab"
                type="button"
                role="tab"
                aria-controls="thermal-inspector-content"
                aria-selected={rightInspectorTab === 'thermal'}
                className={rightInspectorTab === 'thermal' ? 'active' : ''}
                onClick={() => setRightInspectorTab('thermal')}
              >
                Global Thermal Clock
              </button>
              <span className="hex-inspector-coordinate" role="status" aria-live="polite">
                ({inspectCoord.x},{inspectCoord.y}) · D{selectedDistance}
              </span>
            </div>

            {rightInspectorTab === 'hex' ? (
              <div id="hex-inspector-content" role="tabpanel" aria-labelledby="hex-inspector-tab" className="hex-inspector-content">
                <section className="hex-inspector-pane">
                  {inspectedCell && <div className="visual-inspector-stack"><div className="visual-inspector-block ground"><div className="visual-inspector-title"><span className={`visual-temp-orb temp-${Math.max(-3, Math.min(3, inspectedCell.groundTemp)) + 3}`} /><div><strong>Ground Hex</strong><p>{inspectedCell.tags.includes('Blocked') ? '不可通行山脊' : '连续地图地面层'}</p></div></div><dl><div><dt>Temperature</dt><dd>{formatTemperature(inspectedCell.groundTemp)}</dd></div><div><dt>Fill</dt><dd>{inspectedCell.groundFill}</dd></div><div><dt>Moisture</dt><dd>{inspectedCell.moisture}</dd></div><div><dt>Tags</dt><dd>{inspectedCell.tags.join(', ') || '—'}</dd></div></dl></div><div className={`visual-inspector-block sky ${inspectedCell.skyFill === 'clear' ? 'is-clear' : ''}`}><div className="visual-inspector-title"><span className={`visual-temp-orb temp-${Math.max(-3, Math.min(3, inspectedCell.skyTemp)) + 3}`} /><div><strong>Sky Hex</strong><p>旅行与战术共用的上层状态</p></div></div><dl><div><dt>Temperature</dt><dd>{formatTemperature(inspectedCell.skyTemp)}</dd></div><div><dt>Fill</dt><dd>{inspectedCell.skyFill}</dd></div><div><dt>Cloud Age</dt><dd>{inspectedCell.cloudAge || '—'}</dd></div><div><dt>Wind</dt><dd>{String(inspectedCell.wind ?? '—')}</dd></div><div><dt>Intent</dt><dd>{inspectedCell.intents.map((intent) => `${intent.type} T+${intent.countdown}`).join(', ') || '—'}</dd></div></dl></div></div>}
                  {inspectedActor && <div className="visual-inspector-block actor"><div className="visual-inspector-title"><span className={`visual-faction ${inspectedActor.faction}`} /><div><strong>{inspectedActor.name}</strong><p>{inspectedActor.actorType} · {inspectedActor.intent || '无公开意图'}</p></div></div><dl><div><dt>HP / Shield</dt><dd>{inspectedActor.hp}/{inspectedActor.maxHp} · {inspectedActor.shield}</dd></div><div><dt>体温 / 平衡</dt><dd>{formatTemperature(inspectedActor.bodyTemperature)} / {formatTemperature(inspectedActor.balanceTemperature)}</dd></div><div><dt>Next Ready</dt><dd>{timeline.actors[inspectedActor.id]?.nextReadyAt ?? '—'} AT</dd></div><div><dt>Mass</dt><dd>{inspectedActor.mass}</dd></div></dl></div>}
                </section>

                <section>
                  <div className="visual-section-heading"><h3>全局事件队列</h3><span>{playbackActive ? `表现队列 ${eventQueue.length}` : `World ${timeline.worldTimeAt} AT`}</span></div>
                  <div className="unified-ready-list">{queuedTimelineEvents.map((event) => <div key={`${event.stableId}-${event.timeAt}`}><span>{event.timeAt} AT</span><strong>{event.label}</strong></div>)}</div>
                  <div className="visual-causality">{state.logs.slice(0, 6).map((log, index) => <div key={`${index}-${log}`}><span>{index + 1}</span><p>{log}</p></div>)}</div>
                </section>

                <section className="visual-slice-note">
                  <h3>本轮验证问题</h3>
                  <p>{mapStructure === 'room' ? '哪一个房间半径能在移动自由、卡牌覆盖和局部拥挤之间形成最佳张力？' : '最快路线是否因为天气与敌人变得不稳定，而安全路线值得额外距离？'}</p>
                  <p>1 / 2 / 3 AT 是否形成“灵活性溢价”与重动作不可分割价值，而不是新的行动点预算？</p>
                  <p>8 AT Thermal Period 与全局队列叠加后，玩家能否从统一预览判断期间会发生什么？</p>
                </section>
              </div>
            ) : (
              <section id="thermal-inspector-content" role="tabpanel" aria-labelledby="thermal-inspector-tab" className="thermal-clock-inspector-pane">
                <div id="thermal-clock-inspector-slot" />
              </section>
            )}
          </aside>
        </section>
      </main>

      <ThermalPendulumPortal
        enabled
        inspectorActive={rightInspectorTab === 'thermal'}
        runtimeSignal={thermalRuntimeSignal}
        onOpenInspector={() => setRightInspectorTab('thermal')}
        onTemperatureChange={(temperature) => setState((current) => {
          const currentPlayer = getPlayer(current)
          if (Math.abs(currentPlayer.bodyTemperature - temperature) < 1e-6) return current
          const next = structuredClone(current)
          getPlayer(next).bodyTemperature = temperature
          return next
        })}
      />
    </>
  )
}
