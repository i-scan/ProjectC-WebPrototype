import { useMemo, useState } from 'react'
import { actorAt, cellAt, getPlayer, type Coord } from '../game'
import type { PlaybackEvent } from '../visual/visualPlayback'
import { CoupledThermalPendulumPortal } from './CoupledThermalPendulumPortal'
import { HexThreeBoard, type HexBoardSelection } from './HexThreeBoard'
import { HexTravelMap } from './HexTravelMap'
import { Ut5AxisOverlay } from './Ut5AxisOverlay'
import {
  actorLoopConfig,
  applyPreset,
  axisLabel,
  basicAttackPlan,
  basicMovePlan,
  brakePlan,
  createActorLoopState,
  createSpatialState,
  defaultActorLoopSettings,
  downAxis,
  drivePlan,
  groundBreakPlan,
  holdGroundPlan,
  horizontalAxis,
  injectIncomingPlan,
  launchPlan,
  raikiriPlan,
  setSelectedActor,
  setSpatialDebug,
  setThermalDebug,
  stepWorldPlan,
  thermalDomainFor,
  type ActionPlan,
  type ActorLoopPreset,
  type ActorLoopSettings,
  type ActorLoopState,
  type MomentumLevel,
  type NaturalBuildStartMode,
  type ThermalReleaseMode,
} from './actorLoopUt6'
import { HEX_DIRECTIONS, hexAdvance, type HexDirection } from './hexTopology'
import './hex.css'
import './hex-travel.css'
import './hex-view-mode.css'
import './thermal-clock.css'
import './thermal-pendulum.css'
import './coupled-inertia-lab.css'
import './actor-loop-ut6.css'

type RendererMode = '2d' | '3d'
type PendingAction = 'move' | 'attack' | 'launch' | 'drive' | null

type BoardPlan = {
  selector: Coord
  direction?: HexDirection
  targetActorId?: string
  plan: ActionPlan
}

const directions = HEX_DIRECTIONS.map((entry) => entry.direction)
const inspectSelection: HexBoardSelection = { kind: 'inspect' }
const sameCoord = (left?: Coord, right?: Coord) => Boolean(left && right && left.x === right.x && left.y === right.y)

function NumberControl({ label, value, min, max, step, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className="ut4-range">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <output>{value.toFixed(step < 1 ? 2 : 0)}</output>
    </label>
  )
}

function eventForPlan(before: ActorLoopState, plan: ActionPlan): PlaybackEvent {
  const beforePlayer = getPlayer(before.game)
  const afterPlayer = getPlayer(plan.result.game)
  if (!sameCoord(beforePlayer.position, afterPlayer.position)) {
    return {
      id: Date.now(),
      kind: 'move',
      effect: 'move',
      actorId: 'player',
      target: { ...afterPlayer.position },
      label: `${plan.label} · ${plan.atCost} AT`,
      durationAt: Math.max(0.5, plan.atCost),
    }
  }
  const changedActor = plan.result.game.actors.find((actor) => {
    const previous = before.game.actors.find((candidate) => candidate.id === actor.id)
    return previous && actor.id !== 'player' && (actor.hp !== previous.hp || !sameCoord(actor.position, previous.position))
  })
  return {
    id: Date.now(),
    kind: changedActor ? 'attack' : 'phase',
    effect: changedActor ? 'attack' : 'phase',
    sourceActorId: changedActor ? 'player' : undefined,
    actorId: changedActor?.id,
    target: changedActor ? { ...changedActor.position } : { ...afterPlayer.position },
    label: `${plan.label} · ${plan.atCost} AT`,
    durationAt: Math.max(0.5, plan.atCost),
  }
}

function axisValue(axis: ReturnType<typeof createSpatialState>['axis']) {
  if (!axis) return 'none'
  if (axis.kind === 'horizontal') return axis.dir
  if (axis.kind === 'down') return 'down'
  return 'none'
}

function selectedAxis(value: string) {
  if (value === 'none') return null
  if (value === 'down') return downAxis()
  return horizontalAxis(value as HexDirection)
}

function domainLabel(domain: ReturnType<typeof thermalDomainFor>) {
  if (domain === 'hot') return 'HOT'
  if (domain === 'cold') return 'COLD'
  return 'NEUTRAL'
}

function actionButtonClass(selected: boolean, valid = true) {
  return `ut2-action-card ut4-action-card ut6-action-card ${selected ? 'selected-action' : ''} ${valid ? '' : 'ut6-invalid-action'}`
}

export function ActorLoopPlayground() {
  const [lab, setLab] = useState(createActorLoopState)
  const [settings, setSettings] = useState(defaultActorLoopSettings)
  const [history, setHistory] = useState<ActorLoopState[]>([])
  const [rendererMode, setRendererMode] = useState<RendererMode>('3d')
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [selectedCoord, setSelectedCoord] = useState<Coord>(() => ({ ...getPlayer(lab.game).position }))
  const [hoverCoord, setHoverCoord] = useState<Coord>()
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [event, setEvent] = useState<PlaybackEvent>()
  const [previewOverride, setPreviewOverride] = useState<ActionPlan>()
  const [incomingDirection, setIncomingDirection] = useState<HexDirection>('E')
  const [incomingStrength, setIncomingStrength] = useState<MomentumLevel>(1)

  const player = getPlayer(lab.game)
  const playerSpatial = lab.spatialByActorId.player ?? createSpatialState()
  const selectedActor = lab.game.actors.find((actor) => actor.id === lab.selectedActorId) ?? player
  const selectedSpatial = lab.spatialByActorId[selectedActor.id] ?? createSpatialState()
  const domain = thermalDomainFor(lab.thermal.temperature)
  const momentumByActorId = useMemo(
    () => Object.fromEntries(Object.entries(lab.spatialByActorId).map(([actorId, spatial]) => [actorId, spatial.level])),
    [lab.spatialByActorId],
  )

  const movePlans = useMemo<BoardPlan[]>(() => directions.flatMap((direction) => {
    const plan = basicMovePlan(lab, direction, settings)
    const selector = plan.path.at(-1)
    return plan.valid && selector ? [{ selector, direction, plan }] : []
  }), [lab, settings])

  const launchPlans = useMemo<BoardPlan[]>(() => directions.flatMap((direction) => {
    const plan = launchPlan(lab, direction, settings)
    const selector = plan.path.at(-1)
    return plan.valid && selector ? [{ selector, direction, plan }] : []
  }), [lab, settings])

  const drivePlans = useMemo<BoardPlan[]>(() => directions.flatMap((direction) => {
    const selector = hexAdvance(player.position, direction)
    const cell = cellAt(lab.game, selector)
    if (!cell || cell.tags.includes('Void')) return []
    const plan = drivePlan(lab, direction, settings)
    return plan.valid ? [{ selector, direction, plan }] : []
  }), [lab, player.position.x, player.position.y, settings])

  const attackPlans = useMemo<BoardPlan[]>(() => lab.game.actors.flatMap((actor) => {
    if (!actor.alive || actor.id === 'player') return []
    const plan = basicAttackPlan(lab, actor.id, settings)
    return plan.valid ? [{ selector: { ...actor.position }, targetActorId: actor.id, plan }] : []
  }), [lab, settings])

  const boardPlans = pendingAction === 'move'
    ? movePlans
    : pendingAction === 'launch'
      ? launchPlans
      : pendingAction === 'drive'
        ? drivePlans
        : pendingAction === 'attack'
          ? attackPlans
          : []
  const hoveredPlan = boardPlans.find((entry) => hoverCoord && sameCoord(entry.selector, hoverCoord))?.plan
  const preview = previewOverride ?? hoveredPlan ?? boardPlans[0]?.plan
  const previewPath = preview?.path ?? []

  const boardSelection: HexBoardSelection = pendingAction
    ? { kind: 'momentum', action: 'drive', validCoords: boardPlans.map((entry) => entry.selector), route: previewPath }
    : inspectSelection

  const brake = useMemo(() => brakePlan(lab, settings), [lab, settings])
  const raikiri = useMemo(() => raikiriPlan(lab, settings), [lab, settings])
  const groundBreak = useMemo(() => groundBreakPlan(lab, settings), [lab, settings])
  const holdGround = useMemo(() => holdGroundPlan(lab, settings), [lab, settings])
  const wait = useMemo(() => stepWorldPlan(lab, settings), [lab, settings])

  const at0Available = settings.at0Enabled
    && lab.at0.windowUntilAt !== null
    && lab.worldTimeAt < lab.at0.windowUntilAt
    && lab.at0.weaponUsedAt !== lab.worldTimeAt

  const commitPlan = (plan: ActionPlan, keepSelection = false) => {
    setPreviewOverride(undefined)
    if (!plan.valid) {
      setPreviewOverride(plan)
      return
    }
    setHistory((current) => [...current, structuredClone(lab)].slice(-120))
    setEvent(eventForPlan(lab, plan))
    setLab(plan.result)
    setSelectedCoord({ ...getPlayer(plan.result.game).position })
    if (!keepSelection) setPendingAction(null)
  }

  const handleBoardClick = (coord: Coord) => {
    setSelectedCoord(coord)
    const boardPlan = boardPlans.find((entry) => sameCoord(entry.selector, coord))
    if (pendingAction && boardPlan) {
      commitPlan(boardPlan.plan, pendingAction === 'move' || pendingAction === 'attack')
      return
    }
    const actor = actorAt(lab.game, coord)
    if (actor) setLab((current) => setSelectedActor(current, actor.id))
  }

  const reset = () => {
    const next = createActorLoopState()
    setLab(next)
    setSettings(defaultActorLoopSettings())
    setHistory([])
    setPendingAction(null)
    setPreviewOverride(undefined)
    setSelectedCoord({ ...getPlayer(next.game).position })
    setHoverCoord(undefined)
    setEvent({ id: Date.now(), kind: 'reset', effect: 'reset', target: getPlayer(next.game).position, label: 'UT6 Reset' })
  }

  const undo = () => {
    const previous = history.at(-1)
    if (!previous) return
    setHistory((current) => current.slice(0, -1))
    setLab(previous)
    setPendingAction(null)
    setPreviewOverride(undefined)
    setSelectedCoord({ ...getPlayer(previous.game).position })
    setEvent({ id: Date.now(), kind: 'reset', effect: 'reset', target: getPlayer(previous.game).position, label: 'Undo Whole Action' })
  }

  const usePreset = (preset: ActorLoopPreset) => {
    const next = applyPreset(lab, preset)
    setHistory((current) => [...current, structuredClone(lab)].slice(-120))
    setLab(next)
    setPendingAction(null)
    setPreviewOverride(undefined)
    setSelectedCoord({ ...getPlayer(next.game).position })
  }

  const setDebugAxis = (value: string) => {
    const axis = selectedAxis(value)
    setLab((current) => setSpatialDebug(current, selectedActor.id, createSpatialState(
      axis ? (selectedSpatial.level > 0 ? selectedSpatial.level : 0) : 0,
      axis,
    )))
  }

  const latest = lab.logs[0]
  const previewText = preview
    ? preview.valid
      ? `${preview.label} · ${preview.atCost} AT · ${preview.summary}`
      : `${preview.label} unavailable · ${preview.reason}`
    : latest?.detail ?? '选择 Basic Action / Card，观察 Build → Spend / Convert / Release → Rebuild。'
  const thermalPercent = clampPercent((lab.thermal.temperature - actorLoopConfig.thermal.temperatureMin) / (actorLoopConfig.thermal.temperatureMax - actorLoopConfig.thermal.temperatureMin) * 100)

  return (
    <>
      <main className="visual-prototype hex-prototype coupled-inertia-lab ut4-hex-layout ut6-actor-loop" data-ruleset="VAL-012-UT6-candidate" data-implementation="actor-loop-playground-v0">
        <header className="visual-hud ut4-hud">
          <div className="visual-brand"><p className="eyebrow">ProjectC · VAL-012-UT6 · Actor Loop v0</p><h1>Actor Loop Playground</h1></div>
          <div className="hex-view-switch" role="tablist" aria-label="Actor Loop renderer">
            <button className={rendererMode === '2d' ? 'active' : ''} onClick={() => setRendererMode('2d')}>2D</button>
            <button className={rendererMode === '3d' ? 'active' : ''} onClick={() => setRendererMode('3d')}>3D</button>
          </div>
          <div className="visual-turn-strip ut4-header-state">
            <div><span>World Time</span><strong>{lab.worldTimeAt.toFixed(1)} AT</strong></div>
            <div className={`domain-${domain}`}><span>Thermal</span><strong>{domainLabel(domain)} · T {lab.thermal.temperature.toFixed(1)}</strong></div>
            <div><span>Momentum</span><strong>M{playerSpatial.level}</strong></div>
            <div><span>Axis</span><strong>{axisLabel(playerSpatial.axis)}</strong></div>
            <div className={at0Available ? 'ut6-at0-live' : ''}><span>AT0</span><strong>{at0Available ? 'READY' : lab.at0.windowUntilAt ? `until ${lab.at0.windowUntilAt.toFixed(1)}` : '—'}</strong></div>
          </div>
        </header>

        <section className="visual-layout ut4-visual-layout">
          <aside className="visual-panel visual-left-panel ut4-left-panel">
            <section className="visual-actor-card ut4-player-card">
              <div className="visual-portrait hex-portrait">⬡</div>
              <div><p>Actor Loop</p><h2>{player.name}</h2><div className="visual-bars">
                <div><span>HP</span><i><b style={{ width: `${player.hp / player.maxHp * 100}%` }} /></i><strong>{player.hp}/{player.maxHp}</strong></div>
                <div><span>Thermal</span><i className="temperature"><b style={{ width: `${thermalPercent}%` }} /></i><strong>{lab.thermal.temperature.toFixed(1)}</strong></div>
              </div></div>
            </section>
            <section className="ut4-state-summary">
              <div className="visual-section-heading"><h3>World State</h3><span>{domainLabel(domain)}</span></div>
              <dl>
                <div><dt>Temperature</dt><dd>{lab.thermal.temperature.toFixed(2)}</dd></div>
                <div><dt>Drift</dt><dd>{lab.thermal.drift.toFixed(2)}</dd></div>
                <div><dt>Set Point</dt><dd>{lab.thermal.setPoint.toFixed(2)}</dd></div>
                <div><dt>Momentum</dt><dd>M{playerSpatial.level}</dd></div>
                <div><dt>Axis</dt><dd>{axisLabel(playerSpatial.axis)}</dd></div>
                <div><dt>Continuity</dt><dd>{lab.continuityByActorId.player?.streak ?? 0} AT · {axisLabel(lab.continuityByActorId.player?.axis ?? null)}</dd></div>
              </dl>
            </section>
            <section className="visual-slice-note ut4-test-guide">
              <h3>Actor Loop v0</h3>
              <p>Momentum 是空间行为的持续历史：Build → Spend / Convert / Release → Rebuild。</p>
              <p>Basic Action 强化必须真实 Spend；同一 AT 不 refund。</p>
              <p>Thermal 只提高相容 Momentum 的 Build 上限，不凭空产 M，也不跨零清 M。</p>
            </section>
          </aside>

          <section className="visual-board-column hex-board-column ut4-board-column">
            <div className="hex-comparison-strip ut4-comparison-strip" data-preview-valid={preview?.valid ?? false}>
              <strong>UT6 Actor Loop</strong><span className="ut6-action-preview">{previewText}</span><span>Selected ({selectedCoord.x},{selectedCoord.y})</span>
            </div>
            <div className="visual-board-toolbar ut4-board-toolbar">
              <div className="visual-camera-help"><button onClick={() => setCameraResetToken((value) => value + 1)}>重置视图</button><span>选择动作后悬停高亮格查看 before → after；点击提交同一 ActionPlan。</span></div>
              <div className="visual-session-controls"><button disabled={history.length === 0} onClick={undo}>Undo</button><button onClick={reset}>Reset</button></div>
            </div>
            <div className={`visual-board-frame ut4-board-frame view-${rendererMode}`}>
              {rendererMode === '2d' ? (
                <HexTravelMap state={lab.game} mode="tactical" path={previewPath} selectedCoord={selectedCoord} hoverCoord={hoverCoord} selection={boardSelection} targetLayer="ground" preference="fastest" event={event} momentumByActorId={momentumByActorId} onCellClick={handleBoardClick} onCellHover={setHoverCoord} />
              ) : (
                <HexThreeBoard state={lab.game} mode="tactical" travelPath={previewPath} selectedCoord={selectedCoord} hoverCoord={hoverCoord} selection={boardSelection} targetLayer="ground" cameraResetToken={cameraResetToken} showSky={false} showDebug={false} event={event} eventDurationMs={480} momentumByActorId={momentumByActorId} onCellClick={handleBoardClick} onCellHover={setHoverCoord} />
              )}
              <Ut5AxisOverlay state={lab.game} spatialByActorId={lab.spatialByActorId} cameraResetToken={cameraResetToken} active={rendererMode === '3d'} showAxisAtZero />
              {event && <div className={`visual-event-banner ${event.kind}`}><strong>{event.label ?? 'UT6 action'}</strong></div>}
              <div className={`ut6-at0-banner ${at0Available ? 'open' : ''}`}><span>AT0 Window</span><strong>{at0Available ? 'next Weapon Attack = 0 AT' : 'world time runs normally'}</strong></div>
              <div className="visual-board-legend ut4-board-legend"><span><i className="cold" />Cold + Grounded → Down cap M3</span><span><i className="neutral" />Natural cap M1</span><span><i className="hot" />Hot + Horizontal → cap M3</span></div>
            </div>

            <section className="visual-hand ut4-action-hand ut6-action-hand">
              <div className="visual-hand-heading"><div><h2>Basic Action + Candidate Cards</h2><p>Basic Action 自动 Spend；Card 负责 Convert / Preserve / Release，不使用通用 Chain Window。</p></div><span>{pendingAction ? `Board target · ${pendingAction}` : 'Actor Ready'}</span></div>
              <div className="ut4-action-card-row ut6-action-card-row">
                <button data-action-id="basic-move" className={actionButtonClass(pendingAction === 'move')} onClick={() => { setPreviewOverride(undefined); setPendingAction((current) => current === 'move' ? null : 'move') }}><div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Basic Move</span></div><em>Basic</em></div><p>M0 → Move1；matching Horizontal M → Spend1M → Move2。</p><span className="ut3-card-cta">{pendingAction === 'move' ? '选择落点' : 'Move'}</span></button>
                <button data-action-id="basic-attack" className={actionButtonClass(pendingAction === 'attack')} onClick={() => { setPreviewOverride(undefined); setPendingAction((current) => current === 'attack' ? null : 'attack') }}><div className="ut2-action-title"><div><b>{at0Available ? 0 : 1}<small>AT</small></b><span>Basic Attack</span></div><em>Basic</em></div><p>Down M → Spend1 → 本次攻击额外 Apply Incoming M1。</p><span className="ut3-card-cta">{pendingAction === 'attack' ? '选择 Actor' : 'Attack'}</span></button>
                <button data-action-id="launch" className={actionButtonClass(pendingAction === 'launch', launchPlans.length > 0)} onClick={() => { setPreviewOverride(launchPlans[0]?.plan); setPendingAction((current) => current === 'launch' ? null : 'launch') }}><div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Launch</span></div><em>Convert</em></div><p>Down M → Horizontal M-1，Move1，Drift 向 Hot。</p><span className="ut3-card-cta">选择 Axis</span></button>
                <button data-action-id="brake" className={actionButtonClass(false, brake.valid)} onMouseEnter={() => setPreviewOverride(brake)} onMouseLeave={() => setPreviewOverride(undefined)} onClick={() => commitPlan(brake)}><div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Brake</span></div><em>Convert</em></div><p>Horizontal M → Down M-1；停止当前水平趋势。</p><span className="ut3-card-cta">{brake.valid ? 'Convert' : brake.reason}</span></button>
                <button data-action-id="drive" className={actionButtonClass(pendingAction === 'drive', drivePlans.length > 0)} onClick={() => { setPreviewOverride(undefined); setPendingAction((current) => current === 'drive' ? null : 'drive') }}><div className="ut2-action-title"><div><b>2<small>AT</small></b><span>Drive</span></div><em>Card</em></div><p>AT1 Move1 → AT2 Move2；测试 Preserve / Continuous Traversal 的牌位价值。</p><span className="ut3-card-cta">选择 Axis</span></button>
                <button data-action-id="raikiri" className={actionButtonClass(false, raikiri.valid)} onMouseEnter={() => setPreviewOverride(raikiri)} onMouseLeave={() => setPreviewOverride(undefined)} onClick={() => commitPlan(raikiri)}><div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Raikiri</span></div><em>Release</em></div><p>T + Horizontal M 高速贯穿 / Impact，释放惯性与 Thermal。</p><span className="ut3-card-cta">{raikiri.valid ? 'Release' : raikiri.reason}</span></button>
                <button data-action-id="ground-break" className={actionButtonClass(false, groundBreak.valid)} onMouseEnter={() => setPreviewOverride(groundBreak)} onMouseLeave={() => setPreviewOverride(undefined)} onClick={() => commitPlan(groundBreak)}><div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Ground Break</span></div><em>Release</em></div><p>Down M → R2 outward Incoming；Ring1 M2 / Ring2 M1。</p><span className="ut3-card-cta">{groundBreak.valid ? 'Release' : groundBreak.reason}</span></button>
              </div>
            </section>

            <details className="ut4-diagnostics">
              <summary>Event Log · {lab.logs.length} events · Build / Spend / Convert / Incoming / Thermal Evolution</summary>
              <div className="ut4-diagnostics-body"><div className="ut4-log-list">
                {lab.logs.length === 0 && <p className="ut4-empty">从 Basic Move / Attack 开始，尝试形成 10~15 AT 的 Build → Spend → Rebuild 循环。</p>}
                {lab.logs.map((entry) => <article key={entry.id}><header><strong>{entry.timeAt.toFixed(1)} AT · {entry.action} · {entry.atCost} AT</strong><span>{axisLabel(entry.beforeSpatial.axis)} M{entry.beforeSpatial.level} → {axisLabel(entry.afterSpatial.axis)} M{entry.afterSpatial.level}</span></header><p>T {entry.beforeThermal.temperature.toFixed(2)} → {entry.afterThermal.temperature.toFixed(2)} · Drift {entry.beforeThermal.drift.toFixed(2)} → {entry.afterThermal.drift.toFixed(2)}</p><small>{entry.detail}</small></article>)}
              </div><div className="ut4-test-strip"><strong>UT6 T1–T14</strong><span>Natural A/B</span><span>Basic Spend</span><span>No Refund</span><span>Domain M3</span><span>Convert</span><span>Incoming</span><span>AT0</span><span>Drive</span><span>Release</span></div></div>
            </details>
          </section>

          <aside className="visual-panel visual-right-panel ut4-debug-panel ut6-debug-panel">
            <section>
              <div className="visual-section-heading"><h3>Presets / Loop Control</h3><span>debug setup</span></div>
              <div className="ut6-preset-grid">
                {(['neutral', 'hot-horizontal', 'cold-down', 'incoming', 'release'] as ActorLoopPreset[]).map((preset) => <button key={preset} onClick={() => usePreset(preset)}>{preset}</button>)}
              </div>
              <div className="ut4-time-controls"><button onMouseEnter={() => setPreviewOverride(holdGround)} onMouseLeave={() => setPreviewOverride(undefined)} onClick={() => commitPlan(holdGround)}>Hold Ground · 1AT</button><button onMouseEnter={() => setPreviewOverride(wait)} onMouseLeave={() => setPreviewOverride(undefined)} onClick={() => commitPlan(wait)}>Wait · +1AT</button><button disabled={history.length === 0} onClick={undo}>Undo</button></div>
              <small className="ut6-note">Hold Ground 仅是 Playground 的 Grounded-compatible 行为样板，不等于已确定正式 Card。</small>
            </section>

            <section id="ut6-thermal-debug">
              <div className="visual-section-heading"><h3>Thermal State</h3><span>{domainLabel(domain)}</span></div>
              <div className="ut4-quick-row"><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: -4 }))}>T -4</button><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: 1 }))}>T +1</button><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: 4 }))}>T +4</button></div>
              <NumberControl label="Temperature" value={lab.thermal.temperature} min={-6} max={6} step={0.25} onChange={(temperature) => setLab((current) => setThermalDebug(current, { temperature }))} />
              <NumberControl label="Drift" value={lab.thermal.drift} min={-4} max={4} step={0.25} onChange={(drift) => setLab((current) => setThermalDebug(current, { drift }))} />
              <NumberControl label="Set Point" value={lab.thermal.setPoint} min={-2} max={2} step={0.25} onChange={(setPoint) => setLab((current) => setThermalDebug(current, { setPoint }))} />
            </section>

            <section>
              <div className="visual-section-heading"><h3>Spatial / Incoming</h3><span>{selectedActor.name}</span></div>
              <label className="ut4-select-row"><span>Actor</span><select value={selectedActor.id} onChange={(event) => setLab((current) => setSelectedActor(current, event.target.value))}>{lab.game.actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
              <label className="ut4-select-row"><span>Momentum</span><select value={selectedSpatial.level} onChange={(event) => setLab((current) => setSpatialDebug(current, selectedActor.id, createSpatialState(Number(event.target.value) as MomentumLevel, selectedSpatial.axis)))}>{[0, 1, 2, 3].map((level) => <option key={level} value={level}>M{level}</option>)}</select></label>
              <label className="ut4-select-row"><span>Axis</span><select value={axisValue(selectedSpatial.axis)} onChange={(event) => setDebugAxis(event.target.value)}><option value="none">None</option><option value="down">Down</option>{directions.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></label>
              <label className="ut4-select-row"><span>Incoming Axis</span><select value={incomingDirection} onChange={(event) => setIncomingDirection(event.target.value as HexDirection)}>{directions.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></label>
              <label className="ut4-select-row"><span>Incoming M</span><select value={incomingStrength} onChange={(event) => setIncomingStrength(Number(event.target.value) as MomentumLevel)}>{[1, 2, 3].map((level) => <option key={level} value={level}>M{level}</option>)}</select></label>
              <button className="ut4-primary" disabled={selectedActor.id === 'player' && incomingStrength === 0} onClick={() => commitPlan(injectIncomingPlan(lab, selectedActor.id, incomingDirection, incomingStrength))}>Inject Incoming · 0 AT</button>
            </section>

            <section>
              <div className="visual-section-heading"><h3>Actor Loop A/B</h3><span>candidate variables</span></div>
              <label className="ut4-select-row"><span>Natural Start</span><select value={settings.naturalBuildStartMode} onChange={(event) => setSettings((current) => ({ ...current, naturalBuildStartMode: event.target.value as NaturalBuildStartMode }))}><option value="axis-first">Axis First</option><option value="immediate-m1">Immediate M1</option></select></label>
              <label className="ut4-select-row"><span>Launch/Brake Min</span><select value={settings.launchBrakeMinM} onChange={(event) => setSettings((current) => ({ ...current, launchBrakeMinM: Number(event.target.value) as 1 | 2 }))}><option value="1">M1</option><option value="2">M2</option></select></label>
              <div className="ut6-toggle-list">
                <button className={settings.buildAfterConversionSameAt ? 'active' : ''} onClick={() => setSettings((current) => ({ ...current, buildAfterConversionSameAt: !current.buildAfterConversionSameAt }))}>Conversion same-AT Build · {settings.buildAfterConversionSameAt ? 'ON' : 'OFF'}</button>
                <button className={settings.drivePreservesMomentum ? 'active' : ''} onClick={() => setSettings((current) => ({ ...current, drivePreservesMomentum: !current.drivePreservesMomentum }))}>Drive Preserve · {settings.drivePreservesMomentum ? 'ON' : 'OFF'}</button>
                <button className={settings.driveContinuousTraversal ? 'active' : ''} onClick={() => setSettings((current) => ({ ...current, driveContinuousTraversal: !current.driveContinuousTraversal }))}>Drive Continuous · {settings.driveContinuousTraversal ? 'ON' : 'OFF'}</button>
                <button className={settings.at0Enabled ? 'active' : ''} onClick={() => setSettings((current) => ({ ...current, at0Enabled: !current.at0Enabled }))}>AT0 · {settings.at0Enabled ? 'ON' : 'OFF'}</button>
              </div>
              <label className="ut4-select-row"><span>Thermal Release</span><select value={settings.thermalReleaseMode} onChange={(event) => setSettings((current) => ({ ...current, thermalReleaseMode: event.target.value as ThermalReleaseMode }))}><option value="direct">Direct T</option><option value="drift">Drift-only</option><option value="mixed">Mixed</option></select></label>
              <small className="ut6-note">Basic Move / Attack 的 Spend 与 same-AT no-refund 已冻结，不再提供 Sustain A/B。</small>
            </section>
          </aside>
        </section>
      </main>
      <CoupledThermalPendulumPortal enabled temperature={lab.thermal.temperature} setPoint={lab.thermal.setPoint} drift={lab.thermal.drift} elapsedAt={lab.worldTimeAt} thermalPeriodAt={actorLoopConfig.thermal.thermalPeriodAt} onOpenDebug={() => document.getElementById('ut6-thermal-debug')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })} />
    </>
  )
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value))
}
