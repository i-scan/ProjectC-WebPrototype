import { useEffect, useMemo, useState } from 'react'
import {
  CARD_LIBRARY,
  actorAt,
  advancePhase,
  cellAt,
  createInitialState,
  endPlayerTurn,
  getPlayer,
  phaseLabel,
  performBasicAction,
  playCard,
  type BasicAction,
  type Card,
  type Coord,
  type GameState,
  type Layer,
} from '../game'
import {
  InteractiveThreeBoard,
  type VisualEvent,
  type VisualSelection,
} from './InteractiveThreeBoard'
import { PixiVisualBoard } from './PixiVisualBoard'
import { buildVisualEvents, type PlaybackEvent } from './visualPlayback'
import './visual.css'
import './visual-v2.css'
import './visual-history.css'

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

type RendererMode = 'three' | 'pixi'

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
  return { id: Date.now(), kind, target, label }
}

export function VisualPrototype() {
  const [state, setState] = useState(() => createInitialState())
  const [undoStack, setUndoStack] = useState<GameState[]>([])
  const [selection, setSelection] = useState<VisualSelection>({ kind: 'inspect' })
  const [targetLayer, setTargetLayer] = useState<Layer>('ground')
  const [selectedCoord, setSelectedCoord] = useState<Coord>({ x: 1, y: 8 })
  const [hoverCoord, setHoverCoord] = useState<Coord | undefined>()
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [showSky, setShowSky] = useState(true)
  const [showDebug, setShowDebug] = useState(false)
  const [simulationSpeed, setSimulationSpeed] = useState(2)
  const [rendererMode, setRendererMode] = useState<RendererMode>('three')
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

  const objectiveItems = useMemo(
    () => [
      { done: state.objectives.npcWarmed, label: '恢复失温者体温' },
      { done: state.objectives.eliteDefeated, label: '击败精英守卫' },
      { done: state.objectives.extracted, label: '返回 Shelter 撤离' },
    ],
    [state.objectives],
  )

  const commitTransition = (
    before: GameState,
    after: GameState,
    fallbackKind: VisualEvent['kind'],
    fallbackTarget?: Coord,
  ) => {
    const cues = buildVisualEvents(before, after, fallbackTarget)
    if (
      cues.length === 1 &&
      before.phase === after.phase &&
      before.turn === after.turn &&
      after.logs[0] !== before.logs[0]
    ) {
      cues[0] = { ...cues[0], kind: fallbackKind, label: after.logs[0], target: fallbackTarget }
    }
    setUndoStack((current) => [...current, before].slice(-maxUndoSteps))
    setState(after)
    setEventQueue(cues.length > 0
      ? cues
      : [fallbackEvent(fallbackKind, fallbackTarget, after.logs[0] ?? '状态已更新')])
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
    const timer = window.setTimeout(() => {
      setEventQueue((current) => current.slice(1))
    }, cueDelays[simulationSpeed])
    return () => window.clearTimeout(timer)
  }, [eventQueue, simulationSpeed])

  useEffect(() => {
    if (
      simulationSpeed === 0 ||
      state.phase === 'player' ||
      state.status !== 'active' ||
      eventQueue.length > 0
    ) return

    const timer = window.setTimeout(() => {
      const before = state
      const target = getPlayer(before).position
      const after = advancePhase(before)
      commitTransition(before, after, 'phase', target)
    }, phaseDelays[simulationSpeed])
    return () => window.clearTimeout(timer)
  }, [simulationSpeed, state, eventQueue.length])

  const handleBoardClick = (coord: Coord) => {
    setSelectedCoord(coord)
    if (playbackActive || state.phase !== 'player' || state.status !== 'active') return

    if (selection.kind === 'basic') {
      const before = state
      const after = performBasicAction(before, selection.action, coord)
      commitTransition(before, after, selection.action === 'move' ? 'move' : 'attack', coord)
      if (selection.action === 'attack' || after.ap < 1) setSelection({ kind: 'inspect' })
      return
    }

    if (selection.kind === 'card') {
      const before = state
      const after = playCard(before, selection.card.id, coord, targetLayer)
      commitTransition(before, after, eventKindForCard(selection.card), coord)
      setSelection({ kind: 'inspect' })
    }
  }

  const chooseBasicAction = (action: BasicAction) => {
    if (playbackActive) return
    setSelection((current) =>
      current.kind === 'basic' && current.action === action
        ? { kind: 'inspect' }
        : { kind: 'basic', action },
    )
  }

  const chooseCard = (card: Card) => {
    if (playbackActive) return
    if (card.target === 'self') {
      const before = state
      const after = playCard(before, card.id, undefined, targetLayer)
      commitTransition(before, after, eventKindForCard(card), player.position)
      setSelection({ kind: 'inspect' })
      return
    }
    setSelection((current) =>
      current.kind === 'card' && current.card.id === card.id
        ? { kind: 'inspect' }
        : { kind: 'card', card },
    )
    if (card.layer === 'ground' || card.layer === 'sky') setTargetLayer(card.layer)
  }

  const advance = () => {
    if (playbackActive) return
    const before = state
    const after = before.phase === 'player' ? endPlayerTurn(before) : advancePhase(before)
    commitTransition(before, after, 'phase', player.position)
    setSelection({ kind: 'inspect' })
  }

  const undo = () => {
    if (undoStack.length === 0) return
    const previous = undoStack[undoStack.length - 1]
    const previousPlayer = getPlayer(previous)
    setSimulationSpeed(0)
    setUndoStack((current) => current.slice(0, -1))
    setState(previous)
    setHoverCoord(undefined)
    setSelection({ kind: 'inspect' })
    setEventQueue([
      fallbackEvent(
        'reset',
        previousPlayer.position,
        `已悔棋：Turn ${previous.turn} · ${phaseLabel(previous.phase)}`,
      ),
    ])
  }

  const restart = () => {
    const next = createInitialState({ turnMode: state.config.turnMode })
    setState(next)
    setUndoStack([])
    setSelectedCoord({ x: 1, y: 8 })
    setHoverCoord(undefined)
    setSelection({ kind: 'inspect' })
    setEventQueue([fallbackEvent('reset', { x: 1, y: 8 }, '棋局已重新开始')])
  }

  const selectedLabel = selection.kind === 'inspect'
    ? '查看态势'
    : selection.kind === 'basic'
      ? selection.action === 'move'
        ? '连续移动：点击相邻格；再次点击按钮或按 Esc 退出'
        : '选择相邻敌人'
      : `为「${selection.card.name}」选择目标`

  const autoResolving = simulationSpeed > 0 && state.phase !== 'player' && state.status === 'active'
  const boardHelp = rendererMode === 'three'
    ? '拖动旋转 · 滚轮缩放 · Q/E 或 A/D 连续旋转 · W/S 调整俯角'
    : '拖动平移 · 滚轮缩放 · 固定等轴测构图，突出 2D 图层与轮廓控制'

  return (
    <main className="visual-prototype">
      <header className="visual-hud">
        <div className="visual-brand">
          <p className="eyebrow">ProjectC · {rendererMode === 'three' ? 'Three.js 3D' : 'PixiJS 2D'} Visual Slice</p>
          <h1>双层环境棋盘 · 视觉验证切片</h1>
        </div>

        <div className="visual-turn-strip">
          <div><span>Turn</span><strong>{state.turn}</strong></div>
          <div><span>Phase</span><strong>{phaseLabel(state.phase)}</strong></div>
          <div><span>AP</span><strong>{state.ap}</strong></div>
          <div><span>Entropy</span><strong>{state.entropy}</strong></div>
          <label className="visual-speed-control">
            <span>演算速度</span>
            <input
              aria-label="演算速度"
              type="range"
              min="0"
              max="4"
              step="1"
              value={simulationSpeed}
              onChange={(eventValue) => setSimulationSpeed(Number(eventValue.target.value))}
            />
            <strong>{speedLabels[simulationSpeed]}</strong>
          </label>
          <button
            className="visual-primary"
            disabled={state.status !== 'active' || playbackActive || autoResolving}
            onClick={advance}
          >
            {state.phase === 'player'
              ? playbackActive ? '表现队列中…' : '结束玩家回合'
              : autoResolving
                ? '自动演算中…'
                : playbackActive ? '表现队列中…' : '推进一步'}
          </button>
        </div>
      </header>

      <section className="visual-layout">
        <aside className="visual-panel visual-left-panel">
          <section className="visual-actor-card">
            <div className="visual-portrait">✦</div>
            <div>
              <p>Player Actor</p>
              <h2>{player.name}</h2>
              <div className="visual-bars">
                <div><span>HP</span><i><b style={{ width: `${(player.hp / player.maxHp) * 100}%` }} /></i><strong>{player.hp}/{player.maxHp}</strong></div>
                <div><span>体温</span><i className="temperature"><b style={{ width: `${((player.bodyTemperature + 3) / 6) * 100}%` }} /></i><strong>{formatTemperature(player.bodyTemperature)}</strong></div>
              </div>
            </div>
          </section>

          <section>
            <div className="visual-section-heading"><h3>基础行动</h3><span>{selectedLabel}</span></div>
            <div className="visual-action-grid">
              <button
                className={selection.kind === 'basic' && selection.action === 'move' ? 'active sticky' : ''}
                disabled={playbackActive || state.phase !== 'player' || state.ap < 1}
                onClick={() => chooseBasicAction('move')}
              >
                <span>➜</span><strong>连续移动</strong><small>1 AP / 格 · 保持选择</small>
              </button>
              <button
                className={selection.kind === 'basic' && selection.action === 'attack' ? 'active danger' : ''}
                disabled={playbackActive || state.phase !== 'player' || state.ap < 1}
                onClick={() => chooseBasicAction('attack')}
              >
                <span>⚔</span><strong>剑攻击</strong><small>1 AP · 相邻敌人</small>
              </button>
            </div>
          </section>

          <section>
            <div className="visual-section-heading"><h3>任务</h3><span>{state.status}</span></div>
            <div className="visual-objectives">
              {objectiveItems.map((item) => (
                <div className={item.done ? 'done' : ''} key={item.label}>
                  <span>{item.done ? '✓' : '○'}</span><p>{item.label}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="visual-equipment">
            <h3>装备</h3>
            <div><span>武器</span><strong>{player.weapon?.name ?? '无'}</strong></div>
            <div><span>衣服</span><strong>{player.armor?.name ?? '无'}</strong></div>
            <div><span>鞋子</span><strong>{player.shoes?.name ?? '无'}</strong></div>
          </section>
        </aside>

        <section className="visual-board-column">
          <div className="visual-renderer-tabs" role="tablist" aria-label="视觉切片渲染方案">
            <button
              className={rendererMode === 'three' ? 'active' : ''}
              onClick={() => { setRendererMode('three'); setHoverCoord(undefined) }}
            >
              <strong>Three.js 3D</strong><span>真实高度、灯光、云影与自由镜头</span>
            </button>
            <button
              className={rendererMode === 'pixi' ? 'active' : ''}
              onClick={() => { setRendererMode('pixi'); setHoverCoord(undefined) }}
            >
              <strong>PixiJS 2D</strong><span>固定等轴测、清晰轮廓与精灵化特效</span>
            </button>
            <p>两个切片共用同一 GameState；切换不会重置局面。</p>
          </div>

          <div className="visual-board-toolbar">
            <div className="visual-camera-help">
              <button onClick={() => setCameraResetToken((value) => value + 1)}>重置镜头</button>
              <span>{boardHelp}</span>
            </div>
            <div className="visual-layer-switch">
              <button className={targetLayer === 'ground' ? 'active' : ''} onClick={() => setTargetLayer('ground')}>Ground</button>
              <button className={targetLayer === 'sky' ? 'active' : ''} onClick={() => setTargetLayer('sky')}>Sky</button>
            </div>
            <div className="visual-session-controls">
              <button
                className="visual-undo"
                disabled={undoStack.length === 0}
                title="回退最近一次玩家行动或阶段演算"
                onClick={undo}
              >
                ↶ 悔棋 <small>{undoStack.length}</small>
              </button>
              <button className={showSky ? 'active' : ''} onClick={() => setShowSky((value) => !value)}>天空层</button>
              <button className={showDebug ? 'active' : ''} onClick={() => setShowDebug((value) => !value)}>Debug</button>
              <button className="visual-restart" title="清空悔棋历史并重建初始局面" onClick={restart}>重开棋局</button>
            </div>
          </div>

          <div className={`visual-board-frame renderer-${rendererMode}`}>
            {rendererMode === 'three' ? (
              <InteractiveThreeBoard
                state={state}
                selectedCoord={selectedCoord}
                selection={selection}
                targetLayer={targetLayer}
                cameraResetToken={cameraResetToken}
                showSky={showSky}
                showDebug={showDebug}
                event={currentEvent}
                onCellClick={handleBoardClick}
                onCellHover={setHoverCoord}
              />
            ) : (
              <PixiVisualBoard
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
            )}

            {currentEvent && (
              <div className={`visual-event-banner ${currentEvent.kind}`}>
                <strong>{currentEvent.label ?? '状态演出'}</strong>
                {currentEvent.amount ? <span>{currentEvent.kind === 'attack' ? '伤害' : '变化'} {currentEvent.amount}</span> : null}
                {eventQueue.length > 1 ? <small>后续 {eventQueue.length - 1} 项</small> : null}
              </div>
            )}

            <div className="visual-board-legend">
              <span><i className="cold" />偏冷</span>
              <span><i className="neutral" />中性</span>
              <span><i className="hot" />偏热</span>
              <span><i className="cloud" />Sky 对象位于 Ground 上方</span>
            </div>
          </div>

          <section className="visual-hand">
            <div className="visual-hand-heading">
              <div><h2>介入物 / 手牌</h2><p>先选牌，再选择目标；自身牌立即结算。</p></div>
              <span>Deck {state.deck.length} · Discard {state.discard.length}</span>
            </div>
            <div className="visual-card-row">
              {handCards.map((card) => {
                const active = selection.kind === 'card' && selection.card.id === card.id
                const temperatureClass = card.effect.includes('cool')
                  ? 'cool'
                  : card.effect.includes('heat') || card.effect === 'grip'
                    ? 'heat'
                    : ''
                return (
                  <button
                    className={`visual-card ${active ? 'active' : ''} ${temperatureClass}`}
                    disabled={playbackActive || state.phase !== 'player' || state.ap < card.cost || state.status !== 'active'}
                    key={card.id}
                    onClick={() => chooseCard(card)}
                  >
                    <div className="visual-card-cost">{card.cost}</div>
                    <div className="visual-card-icon">{cardIcons[card.effect]}</div>
                    <strong>{card.name}</strong>
                    <p>{card.description}</p>
                    <small>{card.target === 'self' ? '自身' : `${card.range} 格 · ${card.layer ?? card.target}`}</small>
                  </button>
                )
              })}
            </div>
          </section>
        </section>

        <aside className="visual-panel visual-right-panel">
          <section>
            <div className="visual-section-heading"><h3>Context Inspector</h3><span>({inspectCoord.x},{inspectCoord.y})</span></div>
            {inspectedCell && (
              <div className="visual-inspector-stack">
                <div className="visual-inspector-block ground">
                  <div className="visual-inspector-title">
                    <span className={`visual-temp-orb temp-${Math.max(-3, Math.min(3, inspectedCell.groundTemp)) + 3}`} />
                    <div><strong>Ground Cell</strong><p>当前坐标的地面层</p></div>
                  </div>
                  <dl>
                    <div><dt>Temperature</dt><dd>{formatTemperature(inspectedCell.groundTemp)}</dd></div>
                    <div><dt>Fill</dt><dd>{inspectedCell.groundFill}</dd></div>
                    <div><dt>Moisture</dt><dd>{inspectedCell.moisture}</dd></div>
                    <div><dt>Tags</dt><dd>{inspectedCell.tags.join(', ') || '—'}</dd></div>
                  </dl>
                </div>

                <div className={`visual-inspector-block sky ${inspectedCell.skyFill === 'clear' ? 'is-clear' : ''}`}>
                  <div className="visual-inspector-title">
                    <span className={`visual-temp-orb temp-${Math.max(-3, Math.min(3, inspectedCell.skyTemp)) + 3}`} />
                    <div><strong>Sky Cell</strong><p>位于该 Ground Cell 正上方</p></div>
                  </div>
                  <dl>
                    <div><dt>Temperature</dt><dd>{formatTemperature(inspectedCell.skyTemp)}</dd></div>
                    <div><dt>Fill</dt><dd>{inspectedCell.skyFill}</dd></div>
                    <div><dt>Cloud Age</dt><dd>{inspectedCell.cloudAge || '—'}</dd></div>
                    <div><dt>Wind</dt><dd>{inspectedCell.wind ?? '—'}</dd></div>
                    <div><dt>Intent</dt><dd>{inspectedCell.intents.map((intentValue) => `${intentValue.type} T+${intentValue.countdown}`).join(', ') || '—'}</dd></div>
                  </dl>
                </div>
              </div>
            )}

            {inspectedActor && (
              <div className="visual-inspector-block actor">
                <div className="visual-inspector-title">
                  <span className={`visual-faction ${inspectedActor.faction}`} />
                  <div><strong>{inspectedActor.name}</strong><p>{inspectedActor.actorType} · {inspectedActor.intent || '无公开意图'}</p></div>
                </div>
                <dl>
                  <div><dt>HP / Shield</dt><dd>{inspectedActor.hp}/{inspectedActor.maxHp} · {inspectedActor.shield}</dd></div>
                  <div><dt>体温 / 平衡</dt><dd>{formatTemperature(inspectedActor.bodyTemperature)} / {formatTemperature(inspectedActor.balanceTemperature)}</dd></div>
                  <div><dt>Mass</dt><dd>{inspectedActor.mass}</dd></div>
                </dl>
              </div>
            )}
          </section>

          <section>
            <div className="visual-section-heading">
              <h3>本轮因果链</h3>
              <span>{playbackActive ? `表现队列 ${eventQueue.length}` : autoResolving ? `${speedLabels[simulationSpeed]} 自动演算` : '最近日志'}</span>
            </div>
            <div className="visual-causality">
              {state.logs.slice(0, 7).map((log, index) => (
                <div key={`${index}-${log}`}><span>{index + 1}</span><p>{log}</p></div>
              ))}
            </div>
          </section>

          <section className="visual-slice-note">
            <h3>当前对照重点</h3>
            <p>Three.js 强调真实高度、自由镜头、灯光和遮挡；PixiJS 强调固定构图、清晰轮廓、图层排序和低成本 2D 特效。</p>
            <p>悔棋会回退一次玩家行动或自动阶段演算，并自动切换到手动速度；重开棋局会清空历史，但保留渲染方案和显示设置。</p>
          </section>
        </aside>
      </section>
    </main>
  )
}
