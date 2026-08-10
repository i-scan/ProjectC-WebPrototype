import { useEffect, useMemo, useState } from 'react'
import { actorAt, getPlayer, type Coord, type Mass } from '../game'
import type { PlaybackEvent } from '../visual/visualPlayback'
import { HexThreeBoard, type HexBoardSelection } from './HexThreeBoard'
import { HexTravelMap } from './HexTravelMap'
import { ThermalClockLab } from './ThermalClockLab'
import {
  thermalClockExperimentConfig,
  type ActorThermalState,
  type ThermalActionResolution,
  type ThermalClockAction,
  type ThermalClockExperimentConfig,
  type ThermalClockRuleset,
  type ThermalClockScenario,
} from './thermalClockExperiment'
import {
  advanceThermalInertia,
  basicMove,
  brake,
  coupledInertiaExperimentConfig,
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

  const thermalRules = useMemo<ThermalClockRuleset>(() => ({
    id: 'ut4-damped-runtime',
    label: `UT4 Damped · ${tuning.thermalPeriodAt} AT`,
    thermalPeriodAt: tuning.thermalPeriodAt,
    positionEpsilon: 0.025,
    settleEpsilon: 0.025,
    captureThreshold: 0,
  }), [tuning.thermalPeriodAt])
  const thermalScenario = useMemo<ThermalClockScenario>(() => ({
    id: 'ut4-live-state',
    label: 'UT4 Live Coupled State',
    group: 'UT4',
    description: '由 Coupled Inertia Sandbox 实时驱动；Damping / Ambient / Period 使用外层实验参数。',
    setPoint: lab.thermal.setPoint,
    amplitude: Math.abs(lab.thermal.temperature - lab.thermal.setPoint),
    phaseBeat: 0,
  }), [lab.thermal.setPoint, lab.thermal.temperature])
  const thermalAction = useMemo<ThermalClockAction>(() => ({
    id: 'ut4-step-1at',
    label: 'UT4 Step +1 AT',
    shortLabel: 'Step +1',
    kind: 'impulse',
    baseApCost: 0,
    baseActionTime: 1,
    description: '使用 UT4 Damping Solver 预览下一 AT；不代表正式卡牌。',
  }), [])
  const thermalSession = useMemo(() => ({
    thermal: {
      setPoint: lab.thermal.setPoint,
      offset: lab.thermal.temperature - lab.thermal.setPoint,
      drift: lab.thermal.drift,
    },
    elapsedAt: lab.worldTimeAt,
  }), [lab.thermal, lab.worldTimeAt])
  const thermalPreview = useMemo<ThermalActionResolution>(() => {
    const result = advanceThermalInertia(lab.thermal, 1, tuning)
    const afterThermal: ActorThermalState = {
      setPoint: result.state.setPoint,
      offset: result.state.temperature - result.state.setPoint,
      drift: result.state.drift,
    }
    return {
      actionId: thermalAction.id,
      actionLabel: thermalAction.label,
      before: thermalSession,
      immediate: thermalSession,
      after: { thermal: afterThermal, elapsedAt: lab.worldTimeAt + 1 },
      immediateTrace: { offsetDelta: 0, driftDelta: 0, stabilized: 0, captured: false, settled: false },
      timeline: [],
      summary: { crossing: thermalDomainFor(lab.thermal.temperature) !== thermalDomainFor(result.state.temperature), overshoot: false, apex: false, settle: result.settled, capture: false },
    }
  }, [lab.thermal, lab.worldTimeAt, thermalAction, thermalSession, tuning])
  const thermalConfig = useMemo<ThermalClockExperimentConfig>(() => ({
    ...thermalClockExperimentConfig,
    rulesetVersion: 'VAL-012-UT4',
    activeStage: 'coupled-inertia-sandbox',
    rulesetId: 'VAL-012-UT4',
    implementationId: 'coupled-inertia-sandbox-v1',
    defaultRulesetId: thermalRules.id,
    defaultScenarioId: thermalScenario.id,
    defaultActionId: thermalAction.id,
    rulesets: [thermalRules],
    scenarios: [thermalScenario],
    actions: [thermalAction],
  }), [thermalAction, thermalRules, thermalScenario])

  const thermalStateChange = (patch: Partial<ActorThermalState>) => {
    setLab((current) => {
      const setPoint = patch.setPoint ?? current.thermal.setPoint
      const temperature = patch.offset === undefined
        ? current.thermal.temperature
        : setPoint + patch.offset
      return setThermalDebug(current, {
        setPoint,
        temperature,
        drift: patch.drift ?? current.thermal.drift,
      })
    })
  }

  const selectedDistance = hexDistance(player.position, selectedCoord)
  const busy = driveFrames.length > 0

  return (
    <main className="coupled-inertia-lab" data-ruleset="VAL-012-UT4" data-implementation="coupled-inertia-sandbox-v1">
      <header className="ut4-header">
        <div>
          <p>ProjectC · VAL-012-UT4 · Thermal × Spatial Coupled Inertia</p>
          <h1>惯性实验室 · 双惯性 Sandbox</h1>
          <span>自由构造 Thermal / Spatial 状态，不依赖 Enemy AI 或旧 Preset；目标是完整走通 Cold → Hot → Cold。</span>
        </div>
        <div className="ut4-header-state">
          <div><span>World</span><strong>{lab.worldTimeAt.toFixed(1)} AT</strong></div>
          <div className={`domain-${domain}`}><span>Domain</span><strong>{domain.toUpperCase()}</strong></div>
          <div><span>Temperature</span><strong>{lab.thermal.temperature.toFixed(2)}</strong></div>
          <div><span>Spatial</span><strong>{spatialModeLabel(playerSpatial.mode)} M{playerSpatial.level}</strong></div>
        </div>
      </header>

      <div className="ut4-layout">
        <aside className="ut4-panel ut4-actions-panel">
          <section>
            <div className="ut4-section-heading"><h2>Player Actions</h2><span>{busy ? 'AT PHASE playback' : pendingBoardAction ?? 'ready'}</span></div>
            <div className="ut4-action-grid">
              <button className={pendingBoardAction === 'move' ? 'active' : ''} disabled={busy} onClick={() => setPendingBoardAction('move')}><strong>Basic Move</strong><small>AT1 · occupied Cell = Contest</small></button>
              <button className={pendingBoardAction === 'weapon' ? 'active' : ''} disabled={busy} onClick={() => setPendingBoardAction('weapon')}><strong>Default Weapon</strong><small>AT1 · no Cell Contest</small></button>
              <button disabled={busy} onClick={() => updateLab((current) => holdPosition(current, tuning), 'Hold Position')}><strong>Hold Position</strong><small>AT1 · full Cold → Position +1</small></button>
              <button className={pendingBoardAction === 'heavy' ? 'active danger' : ''} disabled={busy} onClick={() => setPendingBoardAction('heavy')}><strong>Heavy Release</strong><small>AT2 · Position M → Push / Launch</small></button>
              <button disabled={busy} onClick={() => updateLab((current) => brake(current, tuning), 'Brake')}><strong>Brake</strong><small>AT1 · clear Spatial M</small></button>
            </div>
            <label className="ut4-select-row">
              <span>Weapon Profile</span>
              <select value={lab.weapon} disabled={busy} onChange={(event) => setLab((current) => setWeapon(current, event.target.value as WeaponProfile))}>
                <option value="hammer">Hammer · adjacent</option>
                <option value="spear">Spear · straight Reach 2</option>
              </select>
            </label>
          </section>

          <section>
            <div className="ut4-section-heading"><h2>Drive · Axis Commit</h2><span>3 × 1 AT</span></div>
            <div className="ut4-direction-grid">
              {directions.map((direction) => <button key={direction} disabled={busy} onClick={() => startDrive(direction)}>{direction}</button>)}
            </div>
            <p className="ut4-help">途中遇到 Dummy / Hard / Reflect 不再整段 Invalid；按 Phase 产生 Contest、Redirect、Crash 或 Bounce。</p>
          </section>

          <section>
            <div className="ut4-section-heading"><h2>Inject Hit</h2><span>0 AT event</span></div>
            <div className="ut4-segmented">
              {(['normal', 'push', 'heavy'] as HitType[]).map((kind) => <button className={hitType === kind ? 'active' : ''} key={kind} onClick={() => setHitType(kind)}>{kind}</button>)}
            </div>
            <label className="ut4-select-row"><span>Incoming</span><select value={hitDirection} onChange={(event) => setHitDirection(event.target.value as 'auto' | HexDirection)}><option value="auto">Auto nearest Dummy</option>{directions.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></label>
            <button className="ut4-primary" disabled={busy} onClick={injectSelectedHit}>受击 / Hit Player</button>
          </section>

          <section>
            <div className="ut4-section-heading"><h2>Time Controls</h2><span>{autoRun ? 'AUTO' : 'paused'}</span></div>
            <div className="ut4-time-controls">
              <button disabled={busy} onClick={() => updateLab((current) => stepWorld(current, 1, tuning, 'Step +1 AT'), 'Step +1 AT')}>+1 AT</button>
              <button disabled={busy} onClick={() => updateLab((current) => stepWorld(current, 4, tuning, 'Step +4 AT'), 'Step +4 AT')}>+4 AT</button>
              <button className={autoRun ? 'active' : ''} disabled={busy} onClick={() => setAutoRun((value) => !value)}>{autoRun ? 'Pause' : 'Auto Run'}</button>
            </div>
            <label className="ut4-select-row"><span>Playback</span><select value={playbackRate} onChange={(event) => setPlaybackRate(Number(event.target.value))}><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
          </section>

          <section className="ut4-reset-row">
            <button onClick={resetState}>Reset State</button>
            <button onClick={() => setTuning(defaultRuntimeTuning())}>Reset Tuning</button>
          </section>
        </aside>

        <section className="ut4-board-column">
          <div className="ut4-board-toolbar">
            <div>
              <button className={rendererMode === '2d' ? 'active' : ''} onClick={() => setRendererMode('2d')}>2D</button>
              <button className={rendererMode === '3d' ? 'active' : ''} onClick={() => setRendererMode('3d')}>3D</button>
              <button onClick={() => setCameraResetToken((value) => value + 1)}>重置视图</button>
            </div>
            <span>Selected ({selectedCoord.x},{selectedCoord.y}) · D{selectedDistance} · {pendingBoardAction ? '点击棋盘提交动作' : '点击 Actor 选择 Debug 目标'}</span>
          </div>
          <div className={`ut4-board-frame view-${rendererMode}`}>
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
            <div className={`ut4-chain-window ${playerSpatial.chainOpen ? 'open' : ''}`}>
              <span>Chain Window</span>
              <strong>{playerSpatial.chainOpen ? `M${playerSpatial.pendingLevel} · ${playerSpatial.axis ?? '—'}` : 'closed'}</strong>
            </div>
          </div>
          <div className="ut4-board-status">
            <div><span>Thermal</span><strong>T {lab.thermal.temperature.toFixed(2)} · Drift {lab.thermal.drift.toFixed(2)} {thermalDirectionLabel(lab.thermal.drift)}</strong></div>
            <div><span>Movement</span><strong>{playerSpatial.mode === 'movement' ? `M${playerSpatial.level} · Axis ${playerSpatial.axis}` : '—'}</strong></div>
            <div><span>Position</span><strong>{playerSpatial.mode === 'position' ? `M${playerSpatial.level} · Anchor ${playerSpatial.anchorCellId}` : '—'}</strong></div>
          </div>
        </section>

        <aside className="ut4-panel ut4-debug-panel">
          <section>
            <div className="ut4-section-heading"><h2>Thermal Debug</h2><span>Damped Solver</span></div>
            <div className="ut4-quick-row"><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: -4 }))}>T -4</button><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: 0 }))}>T 0</button><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: 4 }))}>T +4</button></div>
            <NumberControl label="Temperature" value={lab.thermal.temperature} min={-6} max={6} step={0.1} onChange={(temperature) => setLab((current) => setThermalDebug(current, { temperature }))} />
            <NumberControl label="Drift" value={lab.thermal.drift} min={-4} max={4} step={0.1} onChange={(drift) => setLab((current) => setThermalDebug(current, { drift }))} />
            <NumberControl label="Set Point" value={lab.thermal.setPoint} min={-2} max={2} step={0.25} onChange={(setPoint) => setLab((current) => setThermalDebug(current, { setPoint }))} />
            <NumberControl label="Damping" value={tuning.damping} min={0} max={2} step={0.02} onChange={(damping) => setTuning((current) => ({ ...current, damping }))} />
            <label className="ut4-select-row"><span>Period</span><select value={tuning.thermalPeriodAt} onChange={(event) => setTuning((current) => ({ ...current, thermalPeriodAt: Number(event.target.value) }))}><option value="4">4 AT</option><option value="8">8 AT</option><option value="12">12 AT</option></select></label>
            <NumberControl label="Ambient Bias" value={tuning.ambientThermalBias} min={-2} max={2} step={0.05} onChange={(ambientThermalBias) => setTuning((current) => ({ ...current, ambientThermalBias }))} />
          </section>

          <section>
            <div className="ut4-section-heading"><h2>Spatial Debug</h2><span>{selectedActor.name}</span></div>
            <label className="ut4-select-row"><span>Actor</span><select value={selectedActor.id} onChange={(event) => setLab((current) => setSelectedActor(current, event.target.value))}>{lab.game.actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
            <div className="ut4-segmented">{(['none', 'movement', 'position'] as SpatialInertiaMode[]).map((mode) => <button key={mode} className={selectedSpatial.mode === mode ? 'active' : ''} onClick={() => setMode(mode)}>{mode}</button>)}</div>
            <label className="ut4-select-row"><span>Spatial M</span><select value={selectedSpatial.level} onChange={(event) => setLab((current) => setSpatialDebug(current, selectedActor.id, { level: Number(event.target.value) as 0 | 1 | 2 | 3 }))}>{[0, 1, 2, 3].map((value) => <option key={value} value={value}>M{value}</option>)}</select></label>
            <label className="ut4-select-row"><span>Axis</span><select disabled={selectedSpatial.mode !== 'movement'} value={selectedSpatial.axis ?? 'E'} onChange={(event) => setLab((current) => setSpatialDebug(current, selectedActor.id, { axis: event.target.value as HexDirection }))}>{directions.map((direction) => <option key={direction}>{direction}</option>)}</select></label>
            <label className="ut4-select-row"><span>Mass</span><select value={selectedActor.mass} onChange={(event) => setLab((current) => setActorMass(current, selectedActor.id, event.target.value as Mass))}><option value="light">Light · 1</option><option value="normal">Normal · 2</option><option value="heavy">Heavy · 3</option></select></label>
            {selectedActor.id !== 'player' && <div className="ut4-dummy-queue"><span>Queue Dummy Move @ next AT</span><div className="ut4-direction-grid">{directions.map((direction) => <button key={direction} onClick={() => setLab((current) => queueDummyMove(current, selectedActor.id, direction))}>{direction}</button>)}</div></div>}
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
      </div>

      <div className="ut4-lower-layout">
        <section className="ut4-thermal-panel">
          <div className="ut4-section-heading"><h2>正式 Thermal Clock</h2><span>同一 UT4 live state</span></div>
          <ThermalClockLab
            open
            embedded
            config={thermalConfig}
            rules={thermalRules}
            scenario={thermalScenario}
            session={thermalSession}
            selectedAction={thermalAction}
            preview={thermalPreview}
            history={[]}
            resolving={false}
            onRulesetChange={() => undefined}
            onScenarioChange={() => undefined}
            onStateChange={thermalStateChange}
            onActionSelect={() => undefined}
            onResolve={() => updateLab((current) => stepWorld(current, 1, tuning, 'Thermal Clock Step +1 AT'), 'Thermal Clock Step +1 AT')}
            onUndo={() => undefined}
            onRestart={resetState}
            onReplay={() => undefined}
          />
        </section>

        <section className="ut4-log-panel">
          <div className="ut4-section-heading"><h2>Event Log</h2><span>{lab.logs.length} events</span></div>
          <div className="ut4-log-list">
            {lab.logs.length === 0 && <p className="ut4-empty">执行动作、受击或 Step AT 后记录 T / Drift / Spatial / Contest 因果。</p>}
            {lab.logs.map((entry) => (
              <article key={entry.id}>
                <header><strong>{entry.timeAt.toFixed(1)} AT · {entry.label}</strong><span>{entry.spatialBefore.mode} M{entry.spatialBefore.level} → {entry.spatialAfter.mode} M{entry.spatialAfter.level}</span></header>
                <p>T {entry.thermalBefore.temperature.toFixed(2)} → {entry.thermalAfter.temperature.toFixed(2)} · Drift {entry.thermalBefore.drift.toFixed(2)} → {entry.thermalAfter.drift.toFixed(2)}</p>
                <small>{entry.detail}</small>
              </article>
            ))}
          </div>
        </section>
      </div>

      <footer className="ut4-test-strip">
        <strong>快速验证：</strong>
        <span>T1 Damping</span><span>T3 Hysteresis</span><span>T4 Hot Build</span><span>T6 Drive Contact</span><span>T7 Cold Build</span><span>T9 Hit Heat</span><span>T11 Heavy Release</span><span>T12 Attack ≠ Contest</span><span>T14 Queue Dummy</span><span>T16 Cold → Hot → Cold</span>
        <small>{coupledInertiaExperimentConfig.rulesetVersion} · {coupledInertiaExperimentConfig.implementationId}</small>
      </footer>
    </main>
  )
}
