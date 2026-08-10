import { useEffect, useMemo, useState } from 'react'
import { actorAt, getPlayer, type Coord, type Mass } from '../game'
import type { PlaybackEvent } from '../visual/visualPlayback'
import { CoupledThermalPendulumPortal } from './CoupledThermalPendulumPortal'
import { HexThreeBoard, type HexBoardSelection } from './HexThreeBoard'
import { HexTravelMap } from './HexTravelMap'
import {
  basicMove,
  brake,
  createCoupledInertiaLabState,
  createSpatialInertiaState,
  defaultRuntimeTuning,
  defaultWeaponAction,
  heavyRelease,
  holdPosition,
  injectHit,
  nearestDummyDirection,
  queueDummyMove,
  resolveDrive,
  setActorMass,
  setSelectedActor,
  setSpatialDebug,
  setThermalDebug,
  setWeapon,
  stepWorld,
  thermalDomainFor,
  type CoupledInertiaLabState,
  type DriveFrame,
  type HitType,
  type RuntimeTuning,
  type SpatialInertiaMode,
  type WeaponProfile,
} from './coupledInertia'
import { HEX_DIRECTIONS, hexDistance, type HexDirection } from './hexTopology'
import './hex.css'
import './hex-travel.css'
import './hex-view-mode.css'
import './thermal-clock.css'
import './thermal-pendulum.css'
import './coupled-inertia-lab.css'

type PendingBoardAction = 'move' | 'weapon' | 'heavy' | null
type RendererMode = '2d' | '3d'

const selectionInspect: HexBoardSelection = { kind: 'inspect' }
const directions = HEX_DIRECTIONS.map((entry) => entry.direction)

function sameCoord(a: Coord, b: Coord) {
  return a.x === b.x && a.y === b.y
}

function eventForStateChange(
  before: CoupledInertiaLabState,
  after: CoupledInertiaLabState,
  label: string,
  targetActorId?: string,
): PlaybackEvent {
  const beforePlayer = getPlayer(before.game)
  const afterPlayer = getPlayer(after.game)
  if (!sameCoord(beforePlayer.position, afterPlayer.position)) {
    return {
      id: Date.now(),
      kind: 'move',
      effect: 'move',
      actorId: 'player',
      target: { ...afterPlayer.position },
      label,
      durationAt: Math.max(1, after.worldTimeAt - before.worldTimeAt),
    }
  }
  const target = targetActorId
    ? after.game.actors.find((actor) => actor.id === targetActorId)?.position
    : afterPlayer.position
  return {
    id: Date.now(),
    kind: targetActorId ? 'attack' : 'phase',
    effect: targetActorId ? 'attack' : 'phase',
    actorId: targetActorId,
    sourceActorId: targetActorId ? 'player' : undefined,
    target: target ? { ...target } : undefined,
    label,
    durationAt: Math.max(1, after.worldTimeAt - before.worldTimeAt),
  }
}

function NumberControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
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

function spatialModeLabel(mode: SpatialInertiaMode) {
  if (mode === 'movement') return 'Movement'
  if (mode === 'position') return 'Position'
  return 'None'
}

function thermalDirectionLabel(drift: number) {
  if (drift > 0.03) return '→ Hot'
  if (drift < -0.03) return '→ Cold'
  return 'Still'
}

function domainLabel(domain: ReturnType<typeof thermalDomainFor>) {
  if (domain === 'hot') return 'HOT'
  if (domain === 'cold') return 'COLD'
  return 'NEUTRAL'
}

export function CoupledInertiaLab() {
  const [lab, setLab] = useState(createCoupledInertiaLabState)
  const [tuning, setTuning] = useState<RuntimeTuning>(defaultRuntimeTuning)
  const [rendererMode, setRendererMode] = useState<RendererMode>('3d')
  const [pendingBoardAction, setPendingBoardAction] = useState<PendingBoardAction>(null)
  const [selectedCoord, setSelectedCoord] = useState<Coord>(() => ({ ...getPlayer(lab.game).position }))
  const [hoverCoord, setHoverCoord] = useState<Coord>()
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [event, setEvent] = useState<PlaybackEvent>()
  const [hitType, setHitType] = useState<HitType>('normal')
  const [hitDirection, setHitDirection] = useState<'auto' | HexDirection>('auto')
  const [driveFrames, setDriveFrames] = useState<DriveFrame[]>([])
  const [playbackRate, setPlaybackRate] = useState(1)
  const [autoRun, setAutoRun] = useState(false)

  const player = getPlayer(lab.game)
  const playerSpatial = lab.spatialByActorId.player ?? createSpatialInertiaState()
  const selectedActor = lab.game.actors.find((actor) => actor.id === lab.selectedActorId) ?? player
  const selectedSpatial = lab.spatialByActorId[selectedActor.id] ?? createSpatialInertiaState()
  const domain = thermalDomainFor(lab.thermal.temperature)
  const momentumByActorId = useMemo(
    () => Object.fromEntries(Object.entries(lab.spatialByActorId).map(([actorId, spatial]) => [actorId, spatial.level])),
    [lab.spatialByActorId],
  )

  useEffect(() => {
    if (driveFrames.length === 0) return
    const timer = window.setTimeout(() => {
      const [next, ...remaining] = driveFrames
      setLab(next.state)
      setSelectedCoord({ ...getPlayer(next.state.game).position })
      setEvent(eventForStateChange(lab, next.state, `Drive · AT PHASE ${next.phaseIndex + 1}`))
      setDriveFrames(remaining)
    }, Math.max(90, 520 / playbackRate))
    return () => window.clearTimeout(timer)
  }, [driveFrames, playbackRate])

  useEffect(() => {
    if (!autoRun || driveFrames.length > 0) return
    const timer = window.setInterval(() => {
      setLab((current) => stepWorld(current, 1, tuning, 'Auto Run +1 AT'))
    }, Math.max(120, 650 / playbackRate))
    return () => window.clearInterval(timer)
  }, [autoRun, driveFrames.length, playbackRate, tuning])

  const updateLab = (
    transform: (current: CoupledInertiaLabState) => CoupledInertiaLabState,
    label: string,
    targetActorId?: string,
  ) => {
    if (driveFrames.length > 0) return
    setLab((current) => {
      const next = transform(current)
      setSelectedCoord({ ...getPlayer(next.game).position })
      setEvent(eventForStateChange(current, next, label, targetActorId))
      return next
    })
  }

  const handleBoardClick = (coord: Coord) => {
    setSelectedCoord(coord)
    const clickedActor = actorAt(lab.game, coord)
    if (!pendingBoardAction) {
      if (clickedActor) setLab((current) => setSelectedActor(current, clickedActor.id))
      return
    }

    if (pendingBoardAction === 'move') {
      updateLab((current) => basicMove(current, coord, tuning), 'Basic Move')
      setPendingBoardAction(null)
      return
    }
    if (!clickedActor || clickedActor.id === 'player') return
    if (pendingBoardAction === 'weapon') {
      updateLab((current) => defaultWeaponAction(current, clickedActor.id, tuning), `Default ${lab.weapon}`, clickedActor.id)
      setPendingBoardAction(null)
      return
    }
    updateLab((current) => heavyRelease(current, clickedActor.id, tuning), 'Heavy Release', clickedActor.id)
    setPendingBoardAction(null)
  }

  const startDrive = (direction: HexDirection) => {
    if (driveFrames.length > 0) return
    const frames = resolveDrive(lab, direction, tuning)
    if (frames.length === 0) return
    const [first, ...remaining] = frames
    setLab(first.state)
    setSelectedCoord({ ...getPlayer(first.state.game).position })
    setEvent(eventForStateChange(lab, first.state, 'Drive · AT PHASE 1'))
    setDriveFrames(remaining)
    setPendingBoardAction(null)
  }

  const resetState = () => {
    const next = createCoupledInertiaLabState()
    setLab(next)
    setSelectedCoord({ ...getPlayer(next.game).position })
    setHoverCoord(undefined)
    setPendingBoardAction(null)
    setDriveFrames([])
    setAutoRun(false)
    setEvent({ id: Date.now(), kind: 'reset', effect: 'reset', target: getPlayer(next.game).position, label: 'UT4 Reset' })
  }

  const setMode = (mode: SpatialInertiaMode) => {
    setLab((current) => {
      if (mode === 'none') {
        const next = structuredClone(current)
        next.spatialByActorId[selectedActor.id] = createSpatialInertiaState()
        return next
      }
      return setSpatialDebug(current, selectedActor.id, {
        mode,
        axis: mode === 'movement' ? (selectedSpatial.axis ?? 'E') : null,
        anchorCellId: mode === 'position' ? `${selectedActor.position.x},${selectedActor.position.y}` : null,
      })
    })
  }

  const injectSelectedHit = () => {
    const direction = hitDirection === 'auto' ? nearestDummyDirection(lab) : hitDirection
    updateLab((current) => injectHit(current, hitType, direction, tuning), `Inject Hit · ${hitType}`, 'player')
  }

  const openThermalDebug = () => {
    document.getElementById('ut4-thermal-debug')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const selectedDistance = hexDistance(player.position, selectedCoord)
  const busy = driveFrames.length > 0
  const pendingLabel = pendingBoardAction === 'move'
    ? 'Basic Move：点击目标格'
    : pendingBoardAction === 'weapon'
      ? `Default ${lab.weapon}：点击 Dummy`
      : pendingBoardAction === 'heavy'
        ? 'Heavy Release：点击 Dummy'
        : '点击 Actor 可切换 Spatial Debug 目标'
  const thermalPercent = Math.max(0, Math.min(100, (lab.thermal.temperature + 6) / 12 * 100))

  return (
    <>
      <main
        className="visual-prototype hex-prototype coupled-inertia-lab ut4-hex-layout"
        data-ruleset="VAL-012-UT4"
        data-implementation="coupled-inertia-sandbox-v1"
      >
        <header className="visual-hud ut4-hud">
          <div className="visual-brand">
            <p className="eyebrow">ProjectC · VAL-012-UT4 · Thermal × Spatial Coupled Inertia</p>
            <h1>惯性实验室 · Hex6 Layout</h1>
          </div>
          <div className="hex-view-switch" role="tablist" aria-label="惯性实验室表现方式">
            <button className={rendererMode === '2d' ? 'active' : ''} onClick={() => { setRendererMode('2d'); setHoverCoord(undefined) }}>2D</button>
            <button className={rendererMode === '3d' ? 'active' : ''} onClick={() => { setRendererMode('3d'); setHoverCoord(undefined) }}>3D</button>
          </div>
          <div className="visual-turn-strip ut4-header-state">
            <div><span>World Time</span><strong>{lab.worldTimeAt.toFixed(1)} AT</strong></div>
            <div className={`domain-${domain}`}><span>Thermal</span><strong>{domainLabel(domain)} · T {lab.thermal.temperature.toFixed(1)}</strong></div>
            <div><span>Spatial</span><strong>{spatialModeLabel(playerSpatial.mode)} M{playerSpatial.level}</strong></div>
            <div><span>Axis / Anchor</span><strong>{playerSpatial.mode === 'movement' ? playerSpatial.axis ?? '—' : playerSpatial.mode === 'position' ? playerSpatial.anchorCellId ?? '—' : '—'}</strong></div>
          </div>
        </header>

        <section className="visual-layout ut4-visual-layout">
          <aside className="visual-panel visual-left-panel ut4-left-panel">
            <section className="visual-actor-card ut4-player-card">
              <div className="visual-portrait hex-portrait">⬡</div>
              <div>
                <p>Coupled Inertia Actor</p>
                <h2>{player.name}</h2>
                <div className="visual-bars">
                  <div><span>HP</span><i><b style={{ width: `${(player.hp / player.maxHp) * 100}%` }} /></i><strong>{player.hp}/{player.maxHp}</strong></div>
                  <div><span>Thermal</span><i className="temperature"><b style={{ width: `${thermalPercent}%` }} /></i><strong>{lab.thermal.temperature.toFixed(1)}</strong></div>
                </div>
              </div>
            </section>

            <section className="ut4-state-summary">
              <div className="visual-section-heading"><h3>Coupled State</h3><span>{domainLabel(domain)}</span></div>
              <dl>
                <div><dt>Temperature</dt><dd>{lab.thermal.temperature.toFixed(2)}</dd></div>
                <div><dt>Drift</dt><dd>{lab.thermal.drift.toFixed(2)} · {thermalDirectionLabel(lab.thermal.drift)}</dd></div>
                <div><dt>Set Point</dt><dd>{lab.thermal.setPoint.toFixed(2)}</dd></div>
                <div><dt>Spatial</dt><dd>{spatialModeLabel(playerSpatial.mode)} M{playerSpatial.level}</dd></div>
                <div><dt>Chain</dt><dd>{playerSpatial.chainOpen ? `OPEN · M${playerSpatial.pendingLevel}` : 'closed'}</dd></div>
              </dl>
            </section>

            <section className="visual-slice-note ut4-test-guide">
              <h3>测试逻辑</h3>
              <p>右侧先构造 Thermal / Spatial 状态，再在中央用动作卡提交操作。</p>
              <p>进入占用格会走 Cell Contest；Default Weapon 只攻击，不争格。</p>
              <p>需要查结算因果时，再展开动作卡下方的 Action / Event Log。</p>
            </section>
          </aside>

          <section className="visual-board-column hex-board-column ut4-board-column">
            <div className="hex-comparison-strip ut4-comparison-strip">
              <strong>UT4 Coupled Inertia Sandbox</strong>
              <span>{pendingLabel}</span>
              <span>Selected ({selectedCoord.x},{selectedCoord.y}) · D{selectedDistance}</span>
            </div>

            <div className="visual-board-toolbar ut4-board-toolbar">
              <div className="visual-camera-help">
                <button onClick={() => setCameraResetToken((value) => value + 1)}>重置视图</button>
                <span>{rendererMode === '3d' ? '拖动旋转 · 滚轮缩放 · 点击格/Actor 提交已选动作。' : '2D 用于快速观察 Cell Contest、Forced Motion 与 Axis。'}</span>
              </div>
              <div className="visual-session-controls">
                <button onClick={resetState}>重置状态</button>
                <button onClick={() => setTuning(defaultRuntimeTuning())}>重置参数</button>
              </div>
            </div>

            <div className={`visual-board-frame ut4-board-frame view-${rendererMode}`}>
              {rendererMode === '2d' ? (
                <HexTravelMap
                  state={lab.game}
                  mode="tactical"
                  path={[]}
                  selectedCoord={selectedCoord}
                  hoverCoord={hoverCoord}
                  selection={selectionInspect}
                  targetLayer="ground"
                  preference="fastest"
                  event={event}
                  momentumByActorId={momentumByActorId}
                  onCellClick={handleBoardClick}
                  onCellHover={setHoverCoord}
                />
              ) : (
                <HexThreeBoard
                  state={lab.game}
                  mode="tactical"
                  travelPath={[]}
                  selectedCoord={selectedCoord}
                  hoverCoord={hoverCoord}
                  selection={selectionInspect}
                  targetLayer="ground"
                  cameraResetToken={cameraResetToken}
                  showSky={false}
                  showDebug={false}
                  event={event}
                  eventDurationMs={Math.max(120, 520 / playbackRate)}
                  momentumByActorId={momentumByActorId}
                  onCellClick={handleBoardClick}
                  onCellHover={setHoverCoord}
                />
              )}
              {event && <div className={`visual-event-banner ${event.kind}`}><strong>{event.label ?? 'UT4 状态更新'}</strong></div>}
              <div className={`ut4-chain-window ${playerSpatial.chainOpen ? 'open' : ''}`}>
                <span>Chain Window</span>
                <strong>{playerSpatial.chainOpen ? `M${playerSpatial.pendingLevel} · ${playerSpatial.axis ?? '—'}` : 'closed'}</strong>
              </div>
              <div className="visual-board-legend ut4-board-legend"><span><i className="cold" />Cold ≤ -3</span><span><i className="neutral" />Neutral</span><span><i className="hot" />Hot ≥ +3</span><span>Spatial M0–M3</span></div>
            </div>

            <section className="visual-hand ut4-action-hand">
              <div className="visual-hand-heading">
                <div><h2>Player Actions</h2><p>实验动作不消耗、不离开手牌；选择动作后直接在棋盘提交。</p></div>
                <span>{busy ? 'AT PHASE playback' : pendingBoardAction ? 'Choose on board' : 'Player Ready'}</span>
              </div>
              <div className="ut4-action-card-row">
                <button type="button" data-action-id="basic-move" className={`ut2-action-card ut4-action-card ${pendingBoardAction === 'move' ? 'selected-action' : ''}`} disabled={busy} onClick={() => setPendingBoardAction((current) => current === 'move' ? null : 'move')}>
                  <div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Basic Move</span></div><em>Contest</em></div><p>点击任意目标格。目标格被占用时改走 Cell Contest。</p><span className="ut3-card-cta">{pendingBoardAction === 'move' ? '点击棋盘提交' : '选择移动'}</span>
                </button>
                <button type="button" data-action-id="default-weapon" className={`ut2-action-card ut4-action-card ${pendingBoardAction === 'weapon' ? 'selected-action' : ''}`} disabled={busy} onClick={() => setPendingBoardAction((current) => current === 'weapon' ? null : 'weapon')}>
                  <div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Default Weapon</span></div><em>{lab.weapon}</em></div><p>点击 Dummy 攻击。与移动争格分离，不触发 Cell Contest。</p><span className="ut3-card-cta">{pendingBoardAction === 'weapon' ? '点击 Dummy' : `使用 ${lab.weapon}`}</span>
                </button>
                <button type="button" data-action-id="hold-position" className="ut2-action-card ut4-action-card" disabled={busy} onClick={() => updateLab((current) => holdPosition(current, tuning), 'Hold Position')}>
                  <div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Hold Position</span></div><em>Cold Build</em></div><p>全过程保持 Cold 且不换格：Position M +1，单次最多 +1。</p><span className="ut3-card-cta">执行 Hold</span>
                </button>
                <div className="ut2-action-card ut4-action-card ut4-drive-card" data-action-id="drive">
                  <div className="ut2-action-title"><div><b>3<small>AT</small></b><span>Drive</span></div><em>Axis Commit</em></div><p>3 × 1 AT 分段推进；点击方向直接提交，途中按 Phase 结算碰撞。</p><div className="ut4-card-direction-grid">{directions.map((direction) => <button type="button" key={direction} disabled={busy} onClick={() => startDrive(direction)}>{direction}</button>)}</div>
                </div>
                <button type="button" data-action-id="heavy-release" className={`ut2-action-card ut4-action-card ${pendingBoardAction === 'heavy' ? 'selected-action' : ''}`} disabled={busy} onClick={() => setPendingBoardAction((current) => current === 'heavy' ? null : 'heavy')}>
                  <div className="ut2-action-title"><div><b>2<small>AT</small></b><span>Heavy Release</span></div><em>Position M</em></div><p>消耗 Position M，将其转为 Push / Strong Push / Launch，并产生自身热偏移。</p><span className="ut3-card-cta">{pendingBoardAction === 'heavy' ? '点击 Dummy' : '选择释放'}</span>
                </button>
                <button type="button" data-action-id="brake" className="ut2-action-card ut4-action-card" disabled={busy} onClick={() => updateLab((current) => brake(current, tuning), 'Brake')}>
                  <div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Brake</span></div><em>M → 0</em></div><p>主动解除当前 Spatial Momentum 与 Axis 承诺。</p><span className="ut3-card-cta">执行 Brake</span>
                </button>
              </div>
            </section>

            <details className="ut4-diagnostics">
              <summary>Action / Event Log · {lab.logs.length} events · 验证清单</summary>
              <div className="ut4-diagnostics-body">
                <div className="ut4-log-list">
                  {lab.logs.length === 0 && <p className="ut4-empty">执行动作、受击或 Step AT 后记录 T / Drift / Spatial / Contest 因果。</p>}
                  {lab.logs.map((entry) => <article key={entry.id}><header><strong>{entry.timeAt.toFixed(1)} AT · {entry.label}</strong><span>{entry.spatialBefore.mode} M{entry.spatialBefore.level} → {entry.spatialAfter.mode} M{entry.spatialAfter.level}</span></header><p>T {entry.thermalBefore.temperature.toFixed(2)} → {entry.thermalAfter.temperature.toFixed(2)} · Drift {entry.thermalBefore.drift.toFixed(2)} → {entry.thermalAfter.drift.toFixed(2)}</p><small>{entry.detail}</small></article>)}
                </div>
                <div className="ut4-test-strip"><strong>快速验证</strong><span>Damping</span><span>Hot Build</span><span>Cold Build</span><span>Hit Heat</span><span>Heavy Release</span><span>Attack ≠ Contest</span><span>Cold → Hot → Cold</span></div>
              </div>
            </details>
          </section>

          <aside className="visual-panel visual-right-panel ut4-debug-panel">
            <section id="ut4-thermal-debug">
              <div className="visual-section-heading"><h3>Thermal Debug</h3><span>Damped Solver</span></div>
              <div className="ut4-quick-row"><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: -4 }))}>T -4</button><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: 0 }))}>T 0</button><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: 4 }))}>T +4</button></div>
              <NumberControl label="Temperature" value={lab.thermal.temperature} min={-6} max={6} step={0.1} onChange={(temperature) => setLab((current) => setThermalDebug(current, { temperature }))} />
              <NumberControl label="Drift" value={lab.thermal.drift} min={-4} max={4} step={0.1} onChange={(drift) => setLab((current) => setThermalDebug(current, { drift }))} />
              <NumberControl label="Set Point" value={lab.thermal.setPoint} min={-2} max={2} step={0.25} onChange={(setPoint) => setLab((current) => setThermalDebug(current, { setPoint }))} />
              <NumberControl label="Damping" value={tuning.damping} min={0} max={2} step={0.02} onChange={(damping) => setTuning((current) => ({ ...current, damping }))} />
              <label className="ut4-select-row"><span>Period</span><select value={tuning.thermalPeriodAt} onChange={(event) => setTuning((current) => ({ ...current, thermalPeriodAt: Number(event.target.value) }))}><option value="4">4 AT</option><option value="8">8 AT</option><option value="12">12 AT</option></select></label>
              <NumberControl label="Ambient Bias" value={tuning.ambientThermalBias} min={-2} max={2} step={0.05} onChange={(ambientThermalBias) => setTuning((current) => ({ ...current, ambientThermalBias }))} />
            </section>

            <section>
              <div className="visual-section-heading"><h3>Spatial Debug</h3><span>{selectedActor.name}</span></div>
              <label className="ut4-select-row"><span>Actor</span><select value={selectedActor.id} onChange={(event) => setLab((current) => setSelectedActor(current, event.target.value))}>{lab.game.actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
              <div className="ut4-segmented">{(['none', 'movement', 'position'] as SpatialInertiaMode[]).map((mode) => <button key={mode} className={selectedSpatial.mode === mode ? 'active' : ''} onClick={() => setMode(mode)}>{mode}</button>)}</div>
              <label className="ut4-select-row"><span>Spatial M</span><select value={selectedSpatial.level} onChange={(event) => setLab((current) => setSpatialDebug(current, selectedActor.id, { level: Number(event.target.value) as 0 | 1 | 2 | 3 }))}>{[0, 1, 2, 3].map((value) => <option key={value} value={value}>M{value}</option>)}</select></label>
              <label className="ut4-select-row"><span>Axis</span><select disabled={selectedSpatial.mode !== 'movement'} value={selectedSpatial.axis ?? 'E'} onChange={(event) => setLab((current) => setSpatialDebug(current, selectedActor.id, { axis: event.target.value as HexDirection }))}>{directions.map((direction) => <option key={direction}>{direction}</option>)}</select></label>
              <label className="ut4-select-row"><span>Mass</span><select value={selectedActor.mass} onChange={(event) => setLab((current) => setActorMass(current, selectedActor.id, event.target.value as Mass))}><option value="light">Light · 1</option><option value="normal">Normal · 2</option><option value="heavy">Heavy · 3</option></select></label>
              {selectedActor.id !== 'player' && <div className="ut4-dummy-queue"><span>Queue Dummy Move @ next AT</span><div className="ut4-direction-grid">{directions.map((direction) => <button key={direction} onClick={() => setLab((current) => queueDummyMove(current, selectedActor.id, direction))}>{direction}</button>)}</div></div>}
            </section>

            <section>
              <div className="visual-section-heading"><h3>Weapon / Inject Hit</h3><span>Combat Test</span></div>
              <label className="ut4-select-row"><span>Weapon</span><select value={lab.weapon} disabled={busy} onChange={(event) => setLab((current) => setWeapon(current, event.target.value as WeaponProfile))}><option value="hammer">Hammer · adjacent</option><option value="spear">Spear · straight Reach 2</option></select></label>
              <div className="ut4-segmented">{(['normal', 'push', 'heavy'] as HitType[]).map((kind) => <button className={hitType === kind ? 'active' : ''} key={kind} onClick={() => setHitType(kind)}>{kind}</button>)}</div>
              <label className="ut4-select-row"><span>Incoming</span><select value={hitDirection} onChange={(event) => setHitDirection(event.target.value as 'auto' | HexDirection)}><option value="auto">Auto nearest Dummy</option>{directions.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></label>
              <button className="ut4-primary" disabled={busy} onClick={injectSelectedHit}>受击 / Hit Player</button>
            </section>

            <section>
              <div className="visual-section-heading"><h3>Time Controls</h3><span>{autoRun ? 'AUTO' : 'paused'}</span></div>
              <div className="ut4-time-controls"><button disabled={busy} onClick={() => updateLab((current) => stepWorld(current, 1, tuning, 'Step +1 AT'), 'Step +1 AT')}>+1 AT</button><button disabled={busy} onClick={() => updateLab((current) => stepWorld(current, 4, tuning, 'Step +4 AT'), 'Step +4 AT')}>+4 AT</button><button className={autoRun ? 'active' : ''} disabled={busy} onClick={() => setAutoRun((value) => !value)}>{autoRun ? 'Pause' : 'Auto Run'}</button></div>
              <label className="ut4-select-row"><span>Playback</span><select value={playbackRate} onChange={(event) => setPlaybackRate(Number(event.target.value))}><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
            </section>

            <details className="ut4-tuning-details">
              <summary>Hit / Release Tuning</summary>
              <NumberControl label="Normal Hit Drift" value={tuning.hitHotwardDrift.normal} min={0} max={3} step={0.1} onChange={(value) => setTuning((current) => ({ ...current, hitHotwardDrift: { ...current.hitHotwardDrift, normal: value } }))} />
              <NumberControl label="Push Hit Drift" value={tuning.hitHotwardDrift.push} min={0} max={3} step={0.1} onChange={(value) => setTuning((current) => ({ ...current, hitHotwardDrift: { ...current.hitHotwardDrift, push: value } }))} />
              <NumberControl label="Heavy Hit Drift" value={tuning.hitHotwardDrift.heavy} min={0} max={4} step={0.1} onChange={(value) => setTuning((current) => ({ ...current, hitHotwardDrift: { ...current.hitHotwardDrift, heavy: value } }))} />
              <NumberControl label="Forced Extra Drift" value={tuning.forcedMotionExtraHotwardDrift} min={0} max={3} step={0.1} onChange={(forcedMotionExtraHotwardDrift) => setTuning((current) => ({ ...current, forcedMotionExtraHotwardDrift }))} />
              <NumberControl label="Heavy Release Self Heat" value={tuning.heavyReleaseSelfHotwardDrift} min={0} max={4} step={0.1} onChange={(heavyReleaseSelfHotwardDrift) => setTuning((current) => ({ ...current, heavyReleaseSelfHotwardDrift }))} />
            </details>
          </aside>
        </section>
      </main>

      <CoupledThermalPendulumPortal
        enabled
        temperature={lab.thermal.temperature}
        setPoint={lab.thermal.setPoint}
        drift={lab.thermal.drift}
        elapsedAt={lab.worldTimeAt}
        thermalPeriodAt={tuning.thermalPeriodAt}
        onOpenDebug={openThermalDebug}
      />
    </>
  )
}
