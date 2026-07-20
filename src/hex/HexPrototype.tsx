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
import {
  advanceHexPhase,
  createHexInitialState,
  endHexPlayerTurn,
  getHexNeighbors,
  hexDistance,
  isHexInside,
  performHexBasicAction,
  playHexCard,
} from './hexRules'
import './hex.css'

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
const cueDelays = [360, 520, 340, 210, 120] as const
const maxUndoSteps = 120

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

export function HexPrototype() {
  const [state, setState] = useState(() => createHexInitialState())
  const [undoStack, setUndoStack] = useState<GameState[]>([])
  const [selection, setSelection] = useState<VisualSelection>({ kind: 'inspect' })
  const [targetLayer, setTargetLayer] = useState<Layer>('ground')
  const [selectedCoord, setSelectedCoord] = useState<Coord>({ x: 1, y: 8 })
  const [hoverCoord, setHoverCoord] = useState<Coord | undefined>()
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [showSky, setShowSky] = useState(true)
  const [showDebug, setShowDebug] = useState(false)
  const [simulationSpeed, setSimulationSpeed] = useState(2)
  const [eventQueue, setEventQueue] = useState<PlaybackEvent[]>([])

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
    .filter((entry) => isHexInside(state, entry.coord) && !actorAt(state, entry.coord))

  const objectives = useMemo(() => [
    { done: state.objectives.npcWarmed, label: '恢复失温者体温' },
    { done: state.objectives.eliteDefeated, label: '击败精英守卫' },
    { done: state.objectives.extracted, label: '返回 Shelter 撤离' },
  ], [state.objectives])

  const commitTransition = (
    before: GameState,
    after: GameState,
    fallbackKind: VisualEvent['kind'],
    fallbackTarget?: Coord,
  ) => {
    const cues = buildVisualEvents(before, after, fallbackTarget)
    if (cues.length === 1 && before.phase === after.phase && before.turn === after.turn && after.logs[0] !== before.logs[0]) {
      cues[0] = { ...cues[0], kind: fallbackKind, effect: fallbackKind, label: after.logs[0], target: fallbackTarget }
    }
    setUndoStack((current) => [...current, before].slice(-maxUndoSteps))
    setState(after)
    setEventQueue(cues.length > 0 ? cues : [fallbackEvent(fallbackKind, fallbackTarget, after.logs[0] ?? '六边格状态已更新')])
  }

  useEffect(() => {
    const handleKeyDown = (eventValue: KeyboardEvent) => {
      if (eventValue.key === 'Escape') setSelection({ kind: 'inspect' })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (eventQueue.length === 0) return
    const timer = window.setTimeout(() => setEventQueue((current) => current.slice(1)), cueDelays[simulationSpeed])
    return () => window.clearTimeout(timer)
  }, [eventQueue, simulationSpeed])

  useEffect(() => {
    if (simulationSpeed === 0 || state.phase === 'player' || state.status !== 'active' || eventQueue.length > 0) return
    const timer = window.setTimeout(() => {
      const before = state
      const after = advanceHexPhase(before)
      commitTransition(before, after, 'phase', getPlayer(before).position)
    }, phaseDelays[simulationSpeed])
    return () => window.clearTimeout(timer)
  }, [simulationSpeed, state, eventQueue.length])

  const handleBoardClick = (coord: Coord) => {
    setSelectedCoord(coord)
    if (playbackActive || state.phase !== 'player' || state.status !== 'active') return
    if (selection.kind === 'basic') {
      const before = state
      const after = performHexBasicAction(before, selection.action, coord)
      commitTransition(before, after, selection.action === 'move' ? 'move' : 'attack', coord)
      if (selection.action === 'attack' || after.ap < 1) setSelection({ kind: 'inspect' })
      return
    }
    if (selection.kind === 'card') {
      const before = state
      const after = playHexCard(before, selection.card.id, coord, targetLayer)
      commitTransition(before, after, eventKindForCard(selection.card), coord)
      setSelection({ kind: 'inspect' })
    }
  }

  const chooseBasicAction = (action: BasicAction) => {
    if (playbackActive) return
    setSelection((current) => current.kind === 'basic' && current.action === action ? { kind: 'inspect' } : { kind: 'basic', action })
  }

  const chooseCard = (card: Card) => {
    if (playbackActive) return
    if (card.target === 'self') {
      const before = state
      const after = playHexCard(before, card.id, undefined, targetLayer)
      commitTransition(before, after, eventKindForCard(card), player.position)
      setSelection({ kind: 'inspect' })
      return
    }
    setSelection((current) => current.kind === 'card' && current.card.id === card.id ? { kind: 'inspect' } : { kind: 'card', card })
    if (card.layer === 'ground' || card.layer === 'sky') setTargetLayer(card.layer)
  }

  const advance = () => {
    if (playbackActive) return
    const before = state
    const after = before.phase === 'player' ? endHexPlayerTurn(before) : advanceHexPhase(before)
    commitTransition(before, after, 'phase', player.position)
    setSelection({ kind: 'inspect' })
  }

  const undo = () => {
    if (undoStack.length === 0) return
    const previous = undoStack[undoStack.length - 1]
    setSimulationSpeed(0)
    setUndoStack((current) => current.slice(0, -1))
    setState(previous)
    setHoverCoord(undefined)
    setSelection({ kind: 'inspect' })
    setEventQueue([fallbackEvent('reset', getPlayer(previous).position, `六边格悔棋：Turn ${previous.turn} · ${phaseLabel(previous.phase)}`)])
  }

  const restart = () => {
    const next = createHexInitialState({ turnMode: state.config.turnMode })
    setState(next)
    setUndoStack([])
    setSelectedCoord({ x: 1, y: 8 })
    setHoverCoord(undefined)
    setSelection({ kind: 'inspect' })
    setEventQueue([fallbackEvent('reset', { x: 1, y: 8 }, '六边格棋局已重新开始')])
  }

  const selectedLabel = selection.kind === 'inspect'
    ? '查看六边态势'
    : selection.kind === 'basic'
      ? selection.action === 'move'
        ? '连续移动：六个方向中选择相邻格'
        : '选择六边邻接敌人'
      : `为「${selection.card.name}」选择六边距离目标`
  const autoResolving = simulationSpeed > 0 && state.phase !== 'player' && state.status === 'active'

  return (
    <main className="visual-prototype hex-prototype">
      <header className="visual-hud">
        <div className="visual-brand">
          <p className="eyebrow">ProjectC · Three.js Hex Validation</p>
          <h1>六边格双层环境棋盘</h1>
        </div>
        <div className="hex-topology-summary">
          <span>odd-r offset</span>
          <strong>6 邻接</strong>
          <small>位置博弈 · 环境传播 · 风暴空间</small>
        </div>
        <div className="visual-turn-strip">
          <div><span>Turn</span><strong>{state.turn}</strong></div>
          <div><span>Phase</span><strong>{phaseLabel(state.phase)}</strong></div>
          <div><span>AP</span><strong>{state.ap}</strong></div>
          <label className="visual-speed-control">
            <span>演算速度</span>
            <input aria-label="六边格演算速度" type="range" min="0" max="4" step="1" value={simulationSpeed} onChange={(eventValue) => setSimulationSpeed(Number(eventValue.target.value))} />
            <strong>{speedLabels[simulationSpeed]}</strong>
          </label>
          <button className="visual-primary" disabled={state.status !== 'active' || playbackActive || autoResolving} onClick={advance}>
            {state.phase === 'player' ? playbackActive ? '表现队列中…' : '结束玩家回合' : autoResolving ? '自动演算中…' : playbackActive ? '表现队列中…' : '推进一步'}
          </button>
        </div>
      </header>

      <section className="visual-layout">
        <aside className="visual-panel visual-left-panel">
          <section className="visual-actor-card">
            <div className="visual-portrait hex-portrait">⬡</div>
            <div>
              <p>Hex Player Actor</p>
              <h2>{player.name}</h2>
              <div className="visual-bars">
                <div><span>HP</span><i><b style={{ width: `${(player.hp / player.maxHp) * 100}%` }} /></i><strong>{player.hp}/{player.maxHp}</strong></div>
                <div><span>体温</span><i className="temperature"><b style={{ width: `${((player.bodyTemperature + 3) / 6) * 100}%` }} /></i><strong>{formatTemperature(player.bodyTemperature)}</strong></div>
              </div>
            </div>
          </section>

          <section className="hex-metrics">
            <div><span>当前可走邻格</span><strong>{availableNeighbors.length}</strong></div>
            <div><span>指向格距离</span><strong>{selectedDistance}</strong></div>
            <div><span>邻接上限</span><strong>6</strong></div>
          </section>

          <section>
            <div className="visual-section-heading"><h3>基础行动</h3><span>{selectedLabel}</span></div>
            <div className="visual-action-grid">
              <button className={selection.kind === 'basic' && selection.action === 'move' ? 'active sticky' : ''} disabled={playbackActive || state.phase !== 'player' || state.ap < 1} onClick={() => chooseBasicAction('move')}>
                <span>⬡</span><strong>六向移动</strong><small>1 AP / 格 · 保持选择</small>
              </button>
              <button className={selection.kind === 'basic' && selection.action === 'attack' ? 'active danger' : ''} disabled={playbackActive || state.phase !== 'player' || state.ap < 1} onClick={() => chooseBasicAction('attack')}>
                <span>⚔</span><strong>邻接攻击</strong><small>六方向 · 1 AP</small>
              </button>
            </div>
          </section>

          <section>
            <div className="visual-section-heading"><h3>任务</h3><span>{state.status}</span></div>
            <div className="visual-objectives">
              {objectives.map((item) => <div className={item.done ? 'done' : ''} key={item.label}><span>{item.done ? '✓' : '○'}</span><p>{item.label}</p></div>)}
            </div>
          </section>
        </aside>

        <section className="visual-board-column hex-board-column">
          <div className="hex-comparison-strip">
            <strong>六边格验证重点</strong>
            <span>每格六邻接减少对角线歧义，扩大包围、绕行与环境扩散的方向选择。</span>
            <span>当前方格版本仍保留在“2D / 3D 视觉切片”中。</span>
          </div>
          <div className="visual-board-toolbar">
            <div className="visual-camera-help">
              <button onClick={() => setCameraResetToken((value) => value + 1)}>重置镜头</button>
              <span>拖动旋转 · 滚轮缩放 · 六边格固定为 pointy-top / odd-r</span>
            </div>
            <div className="visual-layer-switch">
              <button className={targetLayer === 'ground' ? 'active' : ''} onClick={() => setTargetLayer('ground')}>Ground</button>
              <button className={targetLayer === 'sky' ? 'active' : ''} onClick={() => setTargetLayer('sky')}>Sky</button>
            </div>
            <div className="visual-session-controls">
              <button className="visual-undo" disabled={undoStack.length === 0} onClick={undo}>↶ 悔棋 <small>{undoStack.length}</small></button>
              <button className={showSky ? 'active' : ''} onClick={() => setShowSky((value) => !value)}>天空层</button>
              <button className={showDebug ? 'active' : ''} onClick={() => setShowDebug((value) => !value)}>Debug</button>
              <button className="visual-restart" onClick={restart}>重开棋局</button>
            </div>
          </div>

          <div className="visual-board-frame hex-board-frame">
            <HexThreeBoard
              state={state}
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
            {currentEvent && (
              <div className={`visual-event-banner ${currentEvent.kind}`}>
                <strong>{currentEvent.label ?? '六边格状态演出'}</strong>
                {currentEvent.amount ? <span>{currentEvent.kind === 'attack' ? '伤害' : '变化'} {currentEvent.amount}</span> : null}
                {eventQueue.length > 1 ? <small>后续 {eventQueue.length - 1} 项</small> : null}
              </div>
            )}
            <div className="hex-direction-legend" aria-label="六边格方向">
              <span>NW</span><span>NE</span><span>W</span><i>⬡</i><span>E</span><span>SW</span><span>SE</span>
            </div>
            <div className="visual-board-legend">
              <span><i className="cold" />偏冷</span><span><i className="neutral" />中性</span><span><i className="hot" />偏热</span><span><i className="cloud" />Sky 位于六边 Ground 上方</span>
            </div>
          </div>

          <section className="visual-hand">
            <div className="visual-hand-heading"><div><h2>介入物 / 手牌</h2><p>范围与直线判断已切换为六边距离和三条主轴。</p></div><span>Deck {state.deck.length} · Discard {state.discard.length}</span></div>
            <div className="visual-card-row">
              {handCards.map((card) => {
                const active = selection.kind === 'card' && selection.card.id === card.id
                const temperatureClass = card.effect.includes('cool') ? 'cool' : card.effect.includes('heat') || card.effect === 'grip' ? 'heat' : ''
                return (
                  <button className={`visual-card ${active ? 'active' : ''} ${temperatureClass}`} disabled={playbackActive || state.phase !== 'player' || state.ap < card.cost || state.status !== 'active'} key={card.id} onClick={() => chooseCard(card)}>
                    <div className="visual-card-cost">{card.cost}</div><div className="visual-card-icon">{cardIcons[card.effect]}</div><strong>{card.name}</strong><p>{card.description}</p><small>{card.target === 'self' ? '自身' : `${card.range} Hex · ${card.layer ?? card.target}`}</small>
                  </button>
                )
              })}
            </div>
          </section>
        </section>

        <aside className="visual-panel visual-right-panel">
          <section>
            <div className="visual-section-heading"><h3>Hex Inspector</h3><span>({inspectCoord.x},{inspectCoord.y}) · D{selectedDistance}</span></div>
            {inspectedCell && (
              <div className="visual-inspector-stack">
                <div className="visual-inspector-block ground">
                  <div className="visual-inspector-title"><span className={`visual-temp-orb temp-${Math.max(-3, Math.min(3, inspectedCell.groundTemp)) + 3}`} /><div><strong>Ground Hex</strong><p>六边逻辑格的地面层</p></div></div>
                  <dl><div><dt>Temperature</dt><dd>{formatTemperature(inspectedCell.groundTemp)}</dd></div><div><dt>Fill</dt><dd>{inspectedCell.groundFill}</dd></div><div><dt>Moisture</dt><dd>{inspectedCell.moisture}</dd></div><div><dt>Tags</dt><dd>{inspectedCell.tags.join(', ') || '—'}</dd></div></dl>
                </div>
                <div className={`visual-inspector-block sky ${inspectedCell.skyFill === 'clear' ? 'is-clear' : ''}`}>
                  <div className="visual-inspector-title"><span className={`visual-temp-orb temp-${Math.max(-3, Math.min(3, inspectedCell.skyTemp)) + 3}`} /><div><strong>Sky Hex</strong><p>与 Ground Hex 一一对应的上层空间</p></div></div>
                  <dl><div><dt>Temperature</dt><dd>{formatTemperature(inspectedCell.skyTemp)}</dd></div><div><dt>Fill</dt><dd>{inspectedCell.skyFill}</dd></div><div><dt>Cloud Age</dt><dd>{inspectedCell.cloudAge || '—'}</dd></div><div><dt>Wind</dt><dd>{String(inspectedCell.wind ?? '—')}</dd></div><div><dt>Intent</dt><dd>{inspectedCell.intents.map((intent) => `${intent.type} T+${intent.countdown}`).join(', ') || '—'}</dd></div></dl>
                </div>
              </div>
            )}
            {inspectedActor && (
              <div className="visual-inspector-block actor">
                <div className="visual-inspector-title"><span className={`visual-faction ${inspectedActor.faction}`} /><div><strong>{inspectedActor.name}</strong><p>{inspectedActor.actorType} · {inspectedActor.intent || '无公开意图'}</p></div></div>
                <dl><div><dt>HP / Shield</dt><dd>{inspectedActor.hp}/{inspectedActor.maxHp} · {inspectedActor.shield}</dd></div><div><dt>体温 / 平衡</dt><dd>{formatTemperature(inspectedActor.bodyTemperature)} / {formatTemperature(inspectedActor.balanceTemperature)}</dd></div><div><dt>Mass</dt><dd>{inspectedActor.mass}</dd></div></dl>
              </div>
            )}
          </section>

          <section>
            <div className="visual-section-heading"><h3>六边因果链</h3><span>{playbackActive ? `表现队列 ${eventQueue.length}` : autoResolving ? `${speedLabels[simulationSpeed]} 自动演算` : '最近日志'}</span></div>
            <div className="visual-causality">{state.logs.slice(0, 8).map((log, index) => <div key={`${index}-${log}`}><span>{index + 1}</span><p>{log}</p></div>)}</div>
          </section>

          <section className="visual-slice-note">
            <h3>本轮观察问题</h3>
            <p>六个相邻方向是否显著增加绕行、包围、守位与撤退的选择？</p>
            <p>风、云和天气沿六方向传播后，是否比四方向更自然、更有空间连续性？</p>
            <p>六边范围是否更容易形成近似圆形的热区、冷区和风暴区？</p>
          </section>
        </aside>
      </section>
    </main>
  )
}
