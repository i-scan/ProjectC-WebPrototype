import { useEffect, useMemo, useState } from 'react'
import { actorAt, cellAt, getPlayer, type Coord, type Mass } from '../game'
import type { PlaybackEvent } from '../visual/visualPlayback'
import { CoupledThermalPendulumPortal } from './CoupledThermalPendulumPortal'
import { HexThreeBoard, type HexBoardSelection } from './HexThreeBoard'
import { HexTravelMap } from './HexTravelMap'
import { Ut5AxisOverlay } from './Ut5AxisOverlay'
import { Ut5DiagnosticSurfaceOverlay } from './Ut5DiagnosticSurfaceOverlay'
import {
  axisInertiaExperimentConfig,
  axisLabel,
  basicMove,
  brake,
  createCoupledInertiaLabState,
  createDrivePlan,
  createSpatialInertiaState,
  defaultRuntimeTuning,
  defaultWeaponAction,
  downAxis,
  heavyRelease,
  holdPosition,
  horizontalAxis,
  injectHit,
  injectHitAndResolveAt,
  nearestDummyDirection,
  queueDummyMove,
  resolveReaction,
  setActorMass,
  setReactionSettings,
  setSelectedActor,
  setSpatialDebug,
  setThermalDebug,
  setWeapon,
  stepWorld,
  thermalDomainFor,
  type CoupledInertiaLabState,
  type DriveFrame,
  type DrivePlan,
  type HitType,
  type MomentumLevel,
  type RuntimeTuning,
  type SpatialAxis,
  type WeaponProfile,
} from './coupledInertiaUt5'
import { HEX_DIRECTIONS, hexAdvance, hexDirectionBetween, hexDirectionOnLine, hexDistance, type HexDirection } from './hexTopology'
import './hex.css'
import './hex-travel.css'
import './hex-view-mode.css'
import './thermal-clock.css'
import './thermal-pendulum.css'
import './coupled-inertia-lab.css'

type PendingBoardAction = 'move' | 'drive' | 'weapon' | 'heavy' | null
type RendererMode = '2d' | '3d'

type DriveCandidate = {
  direction: HexDirection
  selector: Coord
  plan: DrivePlan
}

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

function applyNobodyDies(before: CoupledInertiaLabState, after: CoupledInertiaLabState, enabled: boolean) {
  if (!enabled) return after
  const next = structuredClone(after)
  for (const actor of next.game.actors) {
    const previous = before.game.actors.find((candidate) => candidate.id === actor.id)
    if (!previous?.alive || actor.alive || actor.hp > 0) continue
    actor.hp = actor.maxHp
    actor.alive = true
    if (next.logs[0]) next.logs[0].detail += ` · Nobody Dies: ${actor.name} refill → ${actor.maxHp}`
  }
  return next
}

function axisFromUi(value: string): SpatialAxis | null {
  if (value === 'none') return null
  if (value === 'down') return downAxis()
  return horizontalAxis(value as HexDirection)
}

function axisUiValue(axis: SpatialAxis | null) {
  if (!axis) return 'none'
  if (axis.kind === 'horizontal') return axis.dir
  if (axis.kind === 'down') return 'down'
  return 'none'
}

export function Ut5InertiaLab() {
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
  const [nobodyDies, setNobodyDies] = useState(true)

  const player = getPlayer(lab.game)
  const playerSpatial = lab.spatialByActorId.player ?? createSpatialInertiaState()
  const selectedActor = lab.game.actors.find((actor) => actor.id === lab.selectedActorId) ?? player
  const selectedSpatial = lab.spatialByActorId[selectedActor.id] ?? createSpatialInertiaState()
  const domain = thermalDomainFor(lab.thermal.temperature)
  const busy = driveFrames.length > 0
  const momentumByActorId = useMemo(
    () => Object.fromEntries(Object.entries(lab.spatialByActorId).map(([actorId, spatial]) => [actorId, spatial.level])),
    [lab.spatialByActorId],
  )

  const driveCandidates = useMemo<DriveCandidate[]>(() => directions.flatMap((direction) => {
    const selector = hexAdvance(player.position, direction)
    const cell = cellAt(lab.game, selector)
    if (!cell || cell.tags.includes('Void')) return []
    return [{ direction, selector, plan: createDrivePlan(lab, direction, tuning) }]
  }), [lab, player.position.x, player.position.y, tuning])

  const previewDrive = pendingBoardAction === 'drive'
    ? driveCandidates.find((candidate) => hoverCoord && sameCoord(candidate.selector, hoverCoord))
      ?? driveCandidates.find((candidate) => candidate.plan.valid)
    : undefined
  const previewPath = previewDrive?.plan.path ?? []

  const boardSelection: HexBoardSelection = lab.pendingReaction
    ? { kind: 'momentum', action: 'drive', validCoords: lab.pendingReaction.legalCoords }
    : pendingBoardAction === 'move'
      ? { kind: 'basic', action: 'move' }
      : pendingBoardAction === 'drive'
        ? { kind: 'momentum', action: 'drive', validCoords: driveCandidates.filter((candidate) => candidate.plan.valid).map((candidate) => candidate.selector) }
        : selectionInspect

  useEffect(() => {
    if (driveFrames.length === 0) return
    const timer = window.setTimeout(() => {
      const [next, ...remaining] = driveFrames
      setLab((current) => applyNobodyDies(current, next.state, nobodyDies))
      setSelectedCoord({ ...getPlayer(next.state.game).position })
      setEvent(eventForStateChange(lab, next.state, `Drive · AT PHASE ${next.phaseIndex + 1}`))
      setDriveFrames(remaining)
    }, Math.max(90, 520 / playbackRate))
    return () => window.clearTimeout(timer)
  }, [driveFrames, nobodyDies, playbackRate])

  useEffect(() => {
    if (!autoRun || busy || lab.pendingReaction) return
    const timer = window.setInterval(() => {
      setLab((current) => stepWorld(current, 1, tuning, 'Auto Run +1 AT'))
    }, Math.max(120, 650 / playbackRate))
    return () => window.clearInterval(timer)
  }, [autoRun, busy, lab.pendingReaction, playbackRate, tuning])

  const updateLab = (
    transform: (current: CoupledInertiaLabState) => CoupledInertiaLabState,
    label: string,
    targetActorId?: string,
  ) => {
    if (busy) return
    setLab((current) => {
      const next = applyNobodyDies(current, transform(current), nobodyDies)
      setSelectedCoord({ ...getPlayer(next.game).position })
      setEvent(eventForStateChange(current, next, label, targetActorId))
      return next
    })
  }

  const startDrive = (candidate: DriveCandidate) => {
    if (busy || !candidate.plan.valid || candidate.plan.frames.length === 0) return
    const [first, ...remaining] = candidate.plan.frames
    setLab((current) => applyNobodyDies(current, first.state, nobodyDies))
    setSelectedCoord({ ...getPlayer(first.state.game).position })
    setEvent(eventForStateChange(lab, first.state, 'Drive · AT PHASE 1'))
    setDriveFrames(remaining)
    setPendingBoardAction(null)
  }

  const resolvePendingReaction = (coord: Coord | null) => {
    if (!lab.pendingReaction) return
    updateLab((current) => resolveReaction(current, coord, tuning), coord ? 'Resolve Reaction · side-shift' : 'Resolve Reaction · decline')
  }

  const handleBoardClick = (coord: Coord) => {
    setSelectedCoord(coord)
    if (lab.pendingReaction) {
      if (lab.pendingReaction.legalCoords.some((candidate) => sameCoord(candidate, coord))) resolvePendingReaction(coord)
      return
    }
    const clickedActor = actorAt(lab.game, coord)
    if (!pendingBoardAction) {
      if (clickedActor) setLab((current) => setSelectedActor(current, clickedActor.id))
      return
    }
    if (pendingBoardAction === 'move') {
      const targetCell = cellAt(lab.game, coord)
      if (!targetCell || targetCell.tags.some((tag) => ['Void', 'Blocked', 'Mountain'].includes(tag))) return
      updateLab((current) => basicMove(current, coord, tuning), 'Basic Move')
      return
    }
    if (pendingBoardAction === 'drive') {
      const candidate = driveCandidates.find((item) => sameCoord(item.selector, coord))
      if (candidate) startDrive(candidate)
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

  const resetState = () => {
    const next = createCoupledInertiaLabState()
    setLab(next)
    setTuning(defaultRuntimeTuning())
    setSelectedCoord({ ...getPlayer(next.game).position })
    setHoverCoord(undefined)
    setPendingBoardAction(null)
    setDriveFrames([])
    setAutoRun(false)
    setEvent({ id: Date.now(), kind: 'reset', effect: 'reset', target: getPlayer(next.game).position, label: 'UT5 Reset' })
  }

  const injectSelectedHit = (resolveAt: boolean) => {
    const direction = hitDirection === 'auto' ? nearestDummyDirection(lab) : hitDirection
    updateLab(
      (current) => resolveAt
        ? injectHitAndResolveAt(current, hitType, direction, tuning)
        : injectHit(current, hitType, direction, tuning),
      resolveAt ? `Hit + Resolve 1 AT · ${hitType}` : `Hit 0 AT · ${hitType}`,
      'player',
    )
  }

  const setAxisDebug = (value: string) => {
    const axis = axisFromUi(value)
    setLab((current) => setSpatialDebug(current, selectedActor.id, axis
      ? { axis, level: selectedSpatial.level > 0 ? selectedSpatial.level : 1 }
      : { axis: null, level: 0 }))
  }

  const queueContest = () => {
    if (selectedActor.id === 'player') return
    const adjacent = hexDirectionBetween(selectedActor.position, player.position)
    const direction = adjacent ?? hexDirectionOnLine(selectedActor.position, player.position)
    if (direction) setLab((current) => queueDummyMove(current, selectedActor.id, direction))
  }

  const openThermalDebug = () => document.getElementById('ut5-thermal-debug')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  const selectedDistance = hexDistance(player.position, selectedCoord)
  const latestLog = lab.logs[0]
  const runtimeFeedback = lab.pendingReaction
    ? `${lab.pendingReaction.kind === 'sidestep' ? 'Reaction Sidestep' : 'Failed Occupancy Fallback'}：点击高亮侧格，或在右栏 Decline。Axis 保持 ${axisLabel(lab.pendingReaction.axisSnapshot)}。`
    : pendingBoardAction === 'drive' && previewDrive
      ? previewDrive.plan.valid
        ? `Drive ${previewDrive.direction}：Preview path ${previewDrive.plan.path.map((coord) => `(${coord.x},${coord.y})`).join(' → ') || 'no displacement'}；提交后直接播放同一 Plan。`
        : previewDrive.plan.reason
      : latestLog?.detail ?? 'UT5：Actor 持久拥有 M + Axis；Thermal Domain 只负责每个完整 AT 的免费 Build。'
  const pendingLabel = pendingBoardAction === 'move'
    ? 'Basic Move：连续点击相邻格；位置变化不等于 Axis 改写'
    : pendingBoardAction === 'drive'
      ? runtimeFeedback
      : pendingBoardAction === 'weapon'
        ? `Default ${lab.weapon}：点击 Dummy`
        : pendingBoardAction === 'heavy'
          ? 'Heavy Release：点击相邻 Dummy；读取真实 Down M，与当前温度无关'
          : runtimeFeedback
  const thermalPercent = Math.max(0, Math.min(100, (lab.thermal.temperature + 6) / 12 * 100))
  const chainAvailable = playerSpatial.level > 0 && !busy && !lab.pendingReaction

  return (
    <>
      <main className="visual-prototype hex-prototype coupled-inertia-lab ut4-hex-layout" data-ruleset="VAL-012-UT5" data-implementation="axis-inertia-sandbox-v1">
        <header className="visual-hud ut4-hud">
          <div className="visual-brand"><p className="eyebrow">ProjectC · VAL-012-UT5 · Unified Axis Inertia</p><h1>惯性实验室 · UT5</h1></div>
          <div className="hex-view-switch" role="tablist" aria-label="惯性实验室表现方式">
            <button className={rendererMode === '2d' ? 'active' : ''} onClick={() => { setRendererMode('2d'); setHoverCoord(undefined) }}>2D</button>
            <button className={rendererMode === '3d' ? 'active' : ''} onClick={() => { setRendererMode('3d'); setHoverCoord(undefined) }}>3D</button>
          </div>
          <div className="visual-turn-strip ut4-header-state">
            <div><span>World Time</span><strong>{lab.worldTimeAt.toFixed(1)} AT</strong></div>
            <div className={`domain-${domain}`}><span>Thermal</span><strong>{domainLabel(domain)} · T {lab.thermal.temperature.toFixed(1)}</strong></div>
            <div><span>Momentum</span><strong>M{playerSpatial.level}</strong></div>
            <div><span>Axis</span><strong>{axisLabel(playerSpatial.axis)}</strong></div>
          </div>
        </header>

        <section className="visual-layout ut4-visual-layout">
          <aside className="visual-panel visual-left-panel ut4-left-panel">
            <section className="visual-actor-card ut4-player-card">
              <div className="visual-portrait hex-portrait">⬡</div>
              <div><p>Unified Axis Actor</p><h2>{player.name}</h2><div className="visual-bars">
                <div><span>HP</span><i><b style={{ width: `${Math.max(0, (player.hp / player.maxHp) * 100)}%` }} /></i><strong>{player.hp}/{player.maxHp}</strong></div>
                <div><span>Thermal</span><i className="temperature"><b style={{ width: `${thermalPercent}%` }} /></i><strong>{lab.thermal.temperature.toFixed(1)}</strong></div>
              </div></div>
            </section>
            <section className="ut4-state-summary">
              <div className="visual-section-heading"><h3>Actor World State</h3><span>{domainLabel(domain)}</span></div>
              <dl>
                <div><dt>Temperature</dt><dd>{lab.thermal.temperature.toFixed(2)}</dd></div>
                <div><dt>Drift</dt><dd>{lab.thermal.drift.toFixed(2)} · {thermalDirectionLabel(lab.thermal.drift)}</dd></div>
                <div><dt>Set Point</dt><dd>{lab.thermal.setPoint.toFixed(2)}</dd></div>
                <div><dt>Momentum</dt><dd>M{playerSpatial.level}</dd></div>
                <div><dt>Axis</dt><dd>{axisLabel(playerSpatial.axis)}</dd></div>
                <div><dt>Chain reads</dt><dd>{playerSpatial.level > 0 ? `${axisLabel(playerSpatial.axis)} M${playerSpatial.level}` : 'None'}</dd></div>
              </dl>
            </section>
            <section className="visual-slice-note ut4-test-guide">
              <h3>UT5 核心</h3>
              <p>Spatial = 一套 M + Axis。Down 与六个水平轴共用同一 Resolver。</p>
              <p>Cell 位移不会自动改 Axis；旧 M 未耗尽前，新方向不能接管。</p>
              <p>Hit + Resolve 1 AT：先 Spatial，再 Damage / Drift，再用新 Drift 推进同一个 AT。</p>
            </section>
          </aside>

          <section className="visual-board-column hex-board-column ut4-board-column">
            <div className="hex-comparison-strip ut4-comparison-strip"><strong>UT5 Axis Inertia Sandbox</strong><span>{pendingLabel}</span><span>Selected ({selectedCoord.x},{selectedCoord.y}) · D{selectedDistance}</span></div>
            <div className="visual-board-toolbar ut4-board-toolbar">
              <div className="visual-camera-help"><button onClick={() => setCameraResetToken((value) => value + 1)}>重置视图</button><span>{rendererMode === '3d' ? '拖动旋转 · 滚轮缩放 · Drive 悬停相邻候选格可预览精确 Plan。' : '2D 用于检查 Momentum Exchange / Cell Contest / Reaction。'}</span></div>
              <div className="visual-session-controls"><button onClick={resetState}>重置状态</button><button onClick={() => setTuning(defaultRuntimeTuning())}>重置参数</button></div>
            </div>
            <div className={`visual-board-frame ut4-board-frame view-${rendererMode}`}>
              {rendererMode === '2d' ? (
                <HexTravelMap state={lab.game} mode="tactical" path={previewPath} selectedCoord={selectedCoord} hoverCoord={hoverCoord} selection={boardSelection} targetLayer="ground" preference="fastest" event={event} momentumByActorId={momentumByActorId} onCellClick={handleBoardClick} onCellHover={setHoverCoord} />
              ) : (
                <HexThreeBoard state={lab.game} mode="tactical" travelPath={previewPath} selectedCoord={selectedCoord} hoverCoord={hoverCoord} selection={boardSelection} targetLayer="ground" cameraResetToken={cameraResetToken} showSky={false} showDebug={false} event={event} eventDurationMs={Math.max(120, 520 / playbackRate)} momentumByActorId={momentumByActorId} onCellClick={handleBoardClick} onCellHover={setHoverCoord} />
              )}
              <Ut5DiagnosticSurfaceOverlay state={lab.game} rendererMode={rendererMode} cameraResetToken={cameraResetToken} />
              <Ut5AxisOverlay state={lab.game} spatialByActorId={lab.spatialByActorId} cameraResetToken={cameraResetToken} active={rendererMode === '3d'} />
              {event && <div className={`visual-event-banner ${event.kind}`}><strong>{event.label ?? 'UT5 状态更新'}</strong></div>}
              <div className={`ut4-chain-window ${chainAvailable ? 'open' : ''}`}><span>Chain Window · reads Actor state</span><strong>{chainAvailable ? `${axisLabel(playerSpatial.axis)} M${playerSpatial.level}` : lab.pendingReaction ? 'Reaction pending' : 'closed'}</strong></div>
              <div className="visual-board-legend ut4-board-legend"><span><i className="cold" />Cold ≤ -3 → Down free build</span><span><i className="neutral" />Neutral keeps M</span><span><i className="hot" />Hot ≥ +3 → same-axis free build</span></div>
            </div>

            <section className="visual-hand ut4-action-hand">
              <div className="visual-hand-heading"><div><h2>Player Actions</h2><p>动作不离开手牌。Drive 选择的是 Axis；预览与执行使用同一个不可变 Plan。</p></div><span>{busy ? 'AT PHASE playback' : lab.pendingReaction ? 'Reaction Choice' : pendingBoardAction ? 'Choose on board' : 'Player Ready'}</span></div>
              <div className="ut4-action-card-row">
                <button type="button" data-action-id="basic-move" className={`ut2-action-card ut4-action-card ${pendingBoardAction === 'move' ? 'selected-action' : ''}`} disabled={busy || Boolean(lab.pendingReaction)} onClick={() => setPendingBoardAction((current) => current === 'move' ? null : 'move')}><div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Basic Move</span></div><em>Position</em></div><p>连续移动；不会因为换格自动改写 M / Axis。Hot 且沿已有水平 Axis 时可获得免费 Build。</p><span className="ut3-card-cta">{pendingBoardAction === 'move' ? '连续点击棋盘' : '选择移动'}</span></button>
                <button type="button" data-action-id="default-weapon" className={`ut2-action-card ut4-action-card ${pendingBoardAction === 'weapon' ? 'selected-action' : ''}`} disabled={busy || Boolean(lab.pendingReaction)} onClick={() => setPendingBoardAction((current) => current === 'weapon' ? null : 'weapon')}><div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Default Weapon</span></div><em>{lab.weapon}</em></div><p>攻击与 Occupancy 分离。静态完整 Cold AT 可以自然建立 Down M。</p><span className="ut3-card-cta">{pendingBoardAction === 'weapon' ? '点击 Dummy' : `使用 ${lab.weapon}`}</span></button>
                <button type="button" data-action-id="hold-position" className="ut2-action-card ut4-action-card" disabled={busy || Boolean(lab.pendingReaction)} onClick={() => updateLab((current) => holdPosition(current, tuning), 'Hold Position')}><div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Hold Position</span></div><em>Grounded</em></div><p>不直接生成第二套 Position 资源；完整 Cold AT 通过统一 Resolver 免费建立 Down M。</p><span className="ut3-card-cta">执行 Hold</span></button>
                <button type="button" data-action-id="drive" className={`ut2-action-card ut4-action-card ${pendingBoardAction === 'drive' ? 'selected-action' : ''}`} disabled={busy || Boolean(lab.pendingReaction)} onClick={() => setPendingBoardAction((current) => current === 'drive' ? null : 'drive')}><div className="ut2-action-title"><div><b>3<small>AT</small></b><span>Drive</span></div><em>Axis Commit</em></div><p>Intro 处理旧 M 后建立所选水平 Axis。墙/占格不再自动绕路；Reflect 才能按 Surface Rule 改轴。</p><span className="ut3-card-cta">{pendingBoardAction === 'drive' ? '悬停预览 · 点击提交' : '选择 Drive'}</span></button>
                <button type="button" data-action-id="heavy-release" className={`ut2-action-card ut4-action-card ${pendingBoardAction === 'heavy' ? 'selected-action' : ''}`} disabled={busy || Boolean(lab.pendingReaction)} onClick={() => setPendingBoardAction((current) => current === 'heavy' ? null : 'heavy')}><div className="ut2-action-title"><div><b>2<small>AT</small></b><span>Heavy Release</span></div><em>Down M</em></div><p>读取当前真实 Down M；即使 Temperature 已回 Neutral，也可以兑现为 Push / Launch。</p><span className="ut3-card-cta">{pendingBoardAction === 'heavy' ? '点击 Dummy' : '选择释放'}</span></button>
                <button type="button" data-action-id="brake" className="ut2-action-card ut4-action-card" disabled={busy || Boolean(lab.pendingReaction)} onClick={() => updateLab((current) => brake(current, tuning), 'Brake')}><div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Brake</span></div><em>M → 0</em></div><p>明确处理旧 Momentum；180° 或无法克服旧轴时不允许偷偷覆盖 Axis。</p><span className="ut3-card-cta">执行 Brake</span></button>
              </div>
            </section>

            <details className="ut4-diagnostics">
              <summary>Action / Event Log · {lab.logs.length} events · UT5 causality</summary>
              <div className="ut4-diagnostics-body"><div className="ut4-log-list">
                {lab.logs.length === 0 && <p className="ut4-empty">执行 Hold / Drive / Hit + Resolve 1 AT，观察 Spatial → Thermal → Domain Build 顺序。</p>}
                {lab.logs.map((entry) => <article key={entry.id}><header><strong>{entry.timeAt.toFixed(1)} AT · {entry.label}</strong><span>{axisLabel(entry.spatialBefore.axis)} M{entry.spatialBefore.level} → {axisLabel(entry.spatialAfter.axis)} M{entry.spatialAfter.level}</span></header><p>T {entry.thermalBefore.temperature.toFixed(2)} → {entry.thermalAfter.temperature.toFixed(2)} · Drift {entry.thermalBefore.drift.toFixed(2)} → {entry.thermalAfter.drift.toFixed(2)}</p><small>{entry.detail}</small></article>)}
              </div><div className="ut4-test-strip"><strong>UT5 验证</strong><span>Neutral keeps M</span><span>Cold → Down</span><span>Hot → Horizontal</span><span>Exchange Cap</span><span>Hit same-AT T</span><span>No auto redirect</span><span>Reaction A/B</span><span>Preview = Execute</span></div></div>
            </details>
          </section>

          <aside className="visual-panel visual-right-panel ut4-debug-panel">
            <section id="ut5-thermal-debug">
              <div className="visual-section-heading"><h3>Thermal Debug</h3><span>State constructor</span></div>
              <div className="ut4-quick-row"><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: -4 }))}>T -4</button><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: 1 }))}>T +1</button><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: 4 }))}>T +4</button></div>
              <NumberControl label="Temperature" value={lab.thermal.temperature} min={-6} max={6} step={0.25} onChange={(temperature) => setLab((current) => setThermalDebug(current, { temperature }))} />
              <NumberControl label="Drift" value={lab.thermal.drift} min={-4} max={4} step={0.25} onChange={(drift) => setLab((current) => setThermalDebug(current, { drift }))} />
              <NumberControl label="Set Point" value={lab.thermal.setPoint} min={-2} max={2} step={0.25} onChange={(setPoint) => setLab((current) => setThermalDebug(current, { setPoint }))} />
              <NumberControl label="Damping" value={tuning.damping} min={0} max={2} step={0.02} onChange={(damping) => setTuning((current) => ({ ...current, damping }))} />
              <label className="ut4-select-row"><span>Period</span><select value={tuning.thermalPeriodAt} onChange={(event) => setTuning((current) => ({ ...current, thermalPeriodAt: Number(event.target.value) }))}><option value="4">4 AT</option><option value="8">8 AT</option><option value="12">12 AT</option></select></label>
              <NumberControl label="Ambient Force" value={tuning.ambientThermalBias} min={-2} max={2} step={0.05} onChange={(ambientThermalBias) => setTuning((current) => ({ ...current, ambientThermalBias }))} />
            </section>

            <section>
              <div className="visual-section-heading"><h3>Spatial Debug</h3><span>{selectedActor.name}</span></div>
              <label className="ut4-select-row"><span>Actor</span><select value={selectedActor.id} onChange={(event) => setLab((current) => setSelectedActor(current, event.target.value))}>{lab.game.actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
              <label className="ut4-select-row"><span>Momentum</span><select value={selectedSpatial.level} onChange={(event) => setLab((current) => setSpatialDebug(current, selectedActor.id, { level: Number(event.target.value) as MomentumLevel }))}>{[0, 1, 2, 3].map((value) => <option key={value} value={value}>M{value}</option>)}</select></label>
              <label className="ut4-select-row"><span>Axis</span><select value={axisUiValue(selectedSpatial.axis)} onChange={(event) => setAxisDebug(event.target.value)}><option value="none">None</option><option value="down">Down</option>{directions.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></label>
              <label className="ut4-select-row"><span>Mass</span><select value={selectedActor.mass} onChange={(event) => setLab((current) => setActorMass(current, selectedActor.id, event.target.value as Mass))}><option value="light">Light · 1</option><option value="normal">Normal · 2</option><option value="heavy">Heavy · 3</option></select></label>
              {selectedActor.id !== 'player' && <div className="ut4-dummy-queue"><span>Dummy timeline</span><div className="ut4-direction-grid">{directions.map((direction) => <button key={direction} onClick={() => setLab((current) => queueDummyMove(current, selectedActor.id, direction))}>{direction}</button>)}</div><button onClick={queueContest}>Queue Contest → Player</button></div>}
            </section>

            <section>
              <div className="visual-section-heading"><h3>Hit / Contact</h3><span>Spatial → Thermal</span></div>
              <label className="ut4-select-row"><span>Weapon</span><select value={lab.weapon} disabled={busy} onChange={(event) => setLab((current) => setWeapon(current, event.target.value as WeaponProfile))}><option value="hammer">Hammer · adjacent</option><option value="spear">Spear · straight Reach 2</option></select></label>
              <div className="ut4-segmented">{(['normal', 'push', 'heavy'] as HitType[]).map((kind) => <button className={hitType === kind ? 'active' : ''} key={kind} onClick={() => setHitType(kind)}>{kind}</button>)}</div>
              <label className="ut4-select-row"><span>Incoming</span><select value={hitDirection} onChange={(event) => setHitDirection(event.target.value as 'auto' | HexDirection)}><option value="auto">Auto nearest Dummy</option>{directions.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></label>
              <div className="ut4-time-controls"><button disabled={busy || Boolean(lab.pendingReaction)} onClick={() => injectSelectedHit(false)}>Inject 0 AT</button><button disabled={busy || Boolean(lab.pendingReaction)} onClick={() => injectSelectedHit(true)}>Hit + Resolve 1 AT</button><button disabled={!lab.pendingReaction} onClick={() => resolvePendingReaction(null)}>Decline Reaction</button></div>
            </section>

            <section>
              <div className="visual-section-heading"><h3>Reaction A/B</h3><span>player choice</span></div>
              <div className="ut4-segmented"><button className={lab.reactionSettings.reactionSidestep ? 'active' : ''} onClick={() => setLab((current) => setReactionSettings(current, { reactionSidestep: !current.reactionSettings.reactionSidestep }))}>Reaction Sidestep</button><button className={lab.reactionSettings.failedOccupancyFallback ? 'active' : ''} onClick={() => setLab((current) => setReactionSettings(current, { failedOccupancyFallback: !current.reactionSettings.failedOccupancyFallback }))}>Failed Fallback</button><button disabled={!lab.pendingReaction} onClick={() => resolvePendingReaction(null)}>Decline</button></div>
              <label className="ut4-select-row"><span>Sidestep Min/Cost</span><span>M{lab.reactionSettings.minSidestepM} / M{lab.reactionSettings.sidestepCostM}</span></label>
              <label className="ut4-select-row"><span>Fallback Min/Cost</span><span>M{lab.reactionSettings.minFallbackM} / M{lab.reactionSettings.fallbackCostM}</span></label>
            </section>

            <section>
              <div className="visual-section-heading"><h3>Time Controls</h3><span>{autoRun ? 'AUTO' : 'paused'}</span></div>
              <div className="ut4-time-controls"><button disabled={busy || Boolean(lab.pendingReaction)} onClick={() => updateLab((current) => stepWorld(current, 1, tuning, 'Step +1 AT'), 'Step +1 AT')}>+1 AT</button><button disabled={busy || Boolean(lab.pendingReaction)} onClick={() => updateLab((current) => stepWorld(current, 4, tuning, 'Step +4 AT'), 'Step +4 AT')}>+4 AT</button><button className={autoRun ? 'active' : ''} disabled={busy || Boolean(lab.pendingReaction)} onClick={() => setAutoRun((value) => !value)}>{autoRun ? 'Pause' : 'Auto Run'}</button></div>
              <label className="ut4-select-row"><span>Playback</span><select value={playbackRate} onChange={(event) => setPlaybackRate(Number(event.target.value))}><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
            </section>

            <details className="ut4-tuning-details">
              <summary>Momentum / Thermal Tuning</summary>
              <NumberControl label="Exchange Cap" value={tuning.momentumExchangeCap} min={0} max={3} step={1} onChange={(momentumExchangeCap) => setTuning((current) => ({ ...current, momentumExchangeCap }))} />
              <NumberControl label="Drive Intro Cap" value={tuning.driveIntroExchangeCap} min={0} max={3} step={1} onChange={(driveIntroExchangeCap) => setTuning((current) => ({ ...current, driveIntroExchangeCap }))} />
              <NumberControl label="Normal Hit Drift" value={tuning.hitHotwardDrift.normal} min={0} max={3} step={0.1} onChange={(value) => setTuning((current) => ({ ...current, hitHotwardDrift: { ...current.hitHotwardDrift, normal: value } }))} />
              <NumberControl label="Push Hit Drift" value={tuning.hitHotwardDrift.push} min={0} max={3} step={0.1} onChange={(value) => setTuning((current) => ({ ...current, hitHotwardDrift: { ...current.hitHotwardDrift, push: value } }))} />
              <NumberControl label="Heavy Hit Drift" value={tuning.hitHotwardDrift.heavy} min={0} max={4} step={0.1} onChange={(value) => setTuning((current) => ({ ...current, hitHotwardDrift: { ...current.hitHotwardDrift, heavy: value } }))} />
            </details>

            <section data-control="nobody-dies" style={{ marginTop: 6 }}>
              <div className="visual-section-heading"><h3>Nobody Dies</h3><span>lab convenience</span></div>
              <button className={`ut4-primary ${nobodyDies ? 'active' : ''}`} onClick={() => setNobodyDies((value) => !value)}>Nobody Dies · {nobodyDies ? 'ON' : 'OFF'}</button>
              <small style={{ display: 'block', marginTop: 5, color: '#7188a4', fontSize: 8 }}>低频实验辅助项放在右栏最底部；伤害照常结算，致死时仅在 ON 状态自动回满。</small>
            </section>
          </aside>
        </section>
      </main>
      <CoupledThermalPendulumPortal enabled temperature={lab.thermal.temperature} setPoint={lab.thermal.setPoint} drift={lab.thermal.drift} elapsedAt={lab.worldTimeAt} thermalPeriodAt={tuning.thermalPeriodAt} onOpenDebug={openThermalDebug} />
    </>
  )
}
