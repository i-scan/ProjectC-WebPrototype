import { useEffect, useMemo, useRef, useState } from 'react'
import { Board3D } from './Board3D.jsx'
import { ThermalPendulum } from './ThermalPendulum.jsx'
import { axialDistance, axialKey, axialToWorld, directionVector, worldToAxial } from '../sim/hex.js'
import { cellAt, collisionObstaclesFromCells, createCellWorld } from '../sim/world.js'
import {
  ACTIONS,
  AT_VISUAL_MS,
  DEFAULT_SOLVER_CONFIG,
  actionById,
  createInitialState,
  momentumLevel,
  momentumSpeed,
  planSummary,
  playbackElapsedMs,
  simulateSpatial,
} from '../sim/solver.js'
import {
  conflictScenario,
  createConflictActors,
  decorateConflictCells,
  resolveCellConflicts,
} from '../sim/conflict.js'
import {
  THERMAL_PERIOD_AT,
  advanceThermal,
  createInitialThermalState,
  formatThermal,
  thermalBehaviorFor,
  thermalDomainFor,
} from '../sim/thermal.js'

const velocityPresets = [
  { label: 'M0', speed: 0 },
  { label: 'E · M1', speed: 0.85 },
  { label: 'E · M2', speed: 1.7 },
  { label: 'E · M3', speed: 2.65 },
]

const axisIndicatorOptions = [
  { id: 'auto', label: 'Auto' },
  { id: 'm0', label: 'M0' },
  { id: 'down-1', label: 'Down M1' },
  { id: 'down-2', label: 'Down M2' },
  { id: 'down-3', label: 'Down M3' },
]

function speedOf(velocity) { return Math.hypot(velocity.x, velocity.z) }
function headingOf(velocity) {
  const speed = speedOf(velocity)
  if (speed < 0.02) return null
  return (Math.atan2(velocity.z, velocity.x) * 180 / Math.PI + 360) % 360
}
function sameHex(a, b) { return Boolean(a && b && a.q === b.q && a.r === b.r) }
function terrainLabel(cell) {
  if (!cell) return '—'
  const names = { grass: 'Grass', water: 'Water', ice: 'Ice', fire: 'Fire', stone: 'Open Ground' }
  return names[cell.groundFill] ?? cell.groundFill
}
function initialPrototypeState() {
  return { ...createInitialState(), actors: createConflictActors('chain') }
}
function stateForConflictScenario(kind) {
  const scenario = conflictScenario(kind)
  const direction = directionVector(scenario.directionId)
  const speed = momentumSpeed(scenario.momentum)
  return {
    position: axialToWorld(scenario.playerHex),
    velocity: { x: direction.x * speed, z: direction.z * speed },
    worldAt: 0,
    actors: scenario.actors,
  }
}
function actorCellList(actors = []) {
  return actors.map((actor) => `${actor.label ?? actor.id}:${actor.hex.q},${actor.hex.r}`).join(' · ')
}

export function App() {
  const [state, setState] = useState(() => initialPrototypeState())
  const [thermal, setThermal] = useState(() => createInitialThermalState())
  const [history, setHistory] = useState([])
  const [actionId, setActionId] = useState('drive')
  const [spatialMode, setSpatialMode] = useState('discrete')
  const [hoverHex, setHoverHex] = useState(null)
  const [selectedAimHex, setSelectedAimHex] = useState(null)
  const [boardRadius, setBoardRadius] = useState(7)
  const [obstaclesEnabled, setObstaclesEnabled] = useState(true)
  const [restitution, setRestitution] = useState(DEFAULT_SOLVER_CONFIG.restitution)
  const [atVisualMs, setAtVisualMs] = useState(AT_VISUAL_MS)
  const [axisIndicatorPreview, setAxisIndicatorPreview] = useState('auto')
  const [viewMode, setViewMode] = useState('isometric')
  const [showWeather, setShowWeather] = useState(true)
  const [showThermal, setShowThermal] = useState(true)
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [playback, setPlayback] = useState(null)
  const playbackIdRef = useRef(1)

  const action = actionById(actionId)
  const speed = speedOf(state.velocity)
  const momentum = momentumLevel(speed)
  const heading = headingOf(state.velocity)
  const currentHex = worldToAxial(state.position)
  const actors = state.actors ?? []
  const cells = useMemo(() => createCellWorld(boardRadius), [boardRadius])
  const currentCell = cellAt(cells, currentHex)
  const aimedCell = cellAt(cells, hoverHex ?? selectedAimHex)
  const obstacles = useMemo(() => obstaclesEnabled ? collisionObstaclesFromCells(cells) : [], [cells, obstaclesEnabled])
  const config = useMemo(() => ({ ...DEFAULT_SOLVER_CONFIG, boardRadius, restitution }), [boardRadius, restitution])
  const aimPoint = hoverHex ? axialToWorld(hoverHex) : null
  const previewPlan = useMemo(() => {
    if (playback) return null
    if (actionId !== 'coast' && !hoverHex) return null
    const basePlan = simulateSpatial({ spatialMode, state, actionId, aimPoint, config, obstacles })
    return resolveCellConflicts({ plan: basePlan, actors, obstacles, boardRadius })
  }, [spatialMode, state, actionId, hoverHex, aimPoint, config, obstacles, playback, actors, boardRadius])

  const predictedHex = previewPlan?.valid ? worldToAxial(previewPlan.finalState.position) : null
  const projectedActors = previewPlan?.actorStates ?? playback?.finalState?.actors ?? actors
  const displayCells = useMemo(
    () => decorateConflictCells(cells, actors, projectedActors),
    [cells, actors, projectedActors],
  )
  const isPlaying = Boolean(playback)
  const thermalDomain = thermalDomainFor(thermal.temperature)
  const actionDescriptor = action.kind === 'basic'
    ? 'BASE · 1 AT · M2 ⇒ Range +1 ⇒ M-1'
    : action.kind === 'coast'
      ? 'COAST · ΔV 0'
      : `ΔV ${action.force.toFixed(2)}`
  const inputContract = action.kind === 'basic'
    ? `Basic Move + adjacent Aim Cell → Axis / Redirect Cell path → ${momentum >= 2 ? 'Range 2' : 'Range 1'}`
    : action.kind === 'coast'
      ? `Coast → Current Velocity → ${spatialMode === 'discrete' ? 'Cell-step resolution' : 'Continuous Position + Velocity'}`
      : `Impulse Card + Aim Cell → Current Velocity + ΔV → ${spatialMode === 'discrete' ? 'Cell-step resolution' : 'Continuous curved resolution'}`

  const changeSpatialMode = (mode) => {
    if (mode !== 'discrete' && mode !== 'hybrid') return false
    if (isPlaying) return false
    setSpatialMode(mode)
    setHoverHex(null)
    setSelectedAimHex(null)
    return true
  }

  const changeAtVisualMs = (value) => {
    if (isPlaying || !Number.isFinite(value)) return false
    setAtVisualMs(Math.max(250, Math.min(1600, Math.round(value / 50) * 50)))
    return true
  }

  const changeAxisIndicatorPreview = (value) => {
    if (!axisIndicatorOptions.some((entry) => entry.id === value)) return false
    setAxisIndicatorPreview(value)
    return true
  }

  const changeHoverHex = (hex) => {
    if (isPlaying) return false
    if (actionId === 'basic-move' && hex && axialDistance(currentHex, hex) !== 1) {
      setHoverHex(null)
      return false
    }
    setHoverHex(hex)
    return true
  }

  const resolveClick = (hex) => {
    if (isPlaying) return false
    if (actionId === 'basic-move' && axialDistance(currentHex, hex) !== 1) return false
    const point = axialToWorld(hex)
    const basePlan = simulateSpatial({ spatialMode, state, actionId, aimPoint: actionId === 'coast' ? null : point, config, obstacles })
    const plan = resolveCellConflicts({ plan: basePlan, actors, obstacles, boardRadius })
    if (!plan.valid) return false
    if (actionId === 'coast' && !plan.traversedCells.some((entry) => sameHex(entry, hex))) return false

    const thermalBehavior = thermalBehaviorFor({
      actionId,
      beforeSpeed: speed,
      collisions: plan.collisions.length,
    })
    const finalThermal = advanceThermal(thermal, thermalBehavior, 1)

    setHistory((current) => [...current, {
      state: structuredClone(state),
      thermal: structuredClone(thermal),
      spatialMode,
    }].slice(-80))
    setSelectedAimHex({ ...hex })
    setHoverHex(null)
    setPlayback({
      id: playbackIdRef.current++,
      startedAt: performance.now(),
      pausedAt: null,
      pausedTotal: 0,
      durationMs: atVisualMs,
      startWorldAt: state.worldAt,
      startThermal: structuredClone(thermal),
      samples: plan.samples,
      finalState: plan.finalState,
      finalThermal,
      thermalBehavior,
      summary: planSummary(plan),
      spatialMode,
      conflictEvents: plan.conflictEvents ?? [],
    })
    return true
  }

  useEffect(() => {
    if (!playback || playback.pausedAt !== null) return undefined
    const remainingMs = Math.max(0, (playback.durationMs ?? atVisualMs) - playbackElapsedMs(playback))
    const timer = window.setTimeout(() => {
      setState(playback.finalState)
      setThermal(playback.finalThermal)
      setPlayback((current) => current?.id === playback.id ? null : current)
    }, remainingMs)
    return () => window.clearTimeout(timer)
  }, [playback?.id, playback?.pausedAt, playback?.pausedTotal, atVisualMs])

  useEffect(() => {
    const handleVisibility = () => {
      const now = performance.now()
      setPlayback((current) => {
        if (!current) return current
        if (document.hidden && current.pausedAt === null) return { ...current, pausedAt: now }
        if (!document.hidden && current.pausedAt !== null) {
          return { ...current, pausedTotal: current.pausedTotal + (now - current.pausedAt), pausedAt: null }
        }
        return current
      })
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  const runConflictScenario = (kind) => {
    if (isPlaying) return false
    setState(stateForConflictScenario(kind))
    setThermal(createInitialThermalState())
    setHistory([])
    setSpatialMode('discrete')
    setActionId('basic-move')
    setHoverHex(null)
    setSelectedAimHex(null)
    return true
  }

  useEffect(() => {
    window.__PROJECTC_PROTOTYPE__ = {
      fireAt(q, r) { return resolveClick({ q, r }) },
      setSpatialMode(mode) { return changeSpatialMode(mode) },
      setAction(id) {
        if (isPlaying || !ACTIONS.some((entry) => entry.id === id)) return false
        setActionId(id)
        setHoverHex(null)
        return true
      },
      setVelocity(x, z) {
        if (isPlaying || !Number.isFinite(x) || !Number.isFinite(z)) return false
        setState((current) => ({ ...current, velocity: { x, z } }))
        setHoverHex(null)
        return true
      },
      setAtMs(value) { return changeAtVisualMs(Number(value)) },
      setAxisIndicator(value) { return changeAxisIndicatorPreview(String(value)) },
      setConflictScenario(kind) { return runConflictScenario(String(kind)) },
      trajectory() {
        return structuredClone(playback?.samples ?? previewPlan?.samples ?? [])
      },
      conflicts() {
        return structuredClone(playback?.conflictEvents ?? previewPlan?.conflictEvents ?? [])
      },
      snapshot() {
        return {
          ...structuredClone(state),
          thermal: structuredClone(thermal),
          spatialMode,
          actionId,
          atVisualMs,
          axisIndicatorPreview,
          actors: structuredClone(actors),
        }
      },
    }
    return () => { delete window.__PROJECTC_PROTOTYPE__ }
  })

  const undo = () => {
    if (isPlaying) return
    const previous = history.at(-1)
    if (!previous) return
    setHistory((current) => current.slice(0, -1))
    setState(previous.state)
    setThermal(previous.thermal)
    setSpatialMode(previous.spatialMode)
    setHoverHex(null)
    setSelectedAimHex(null)
  }

  const reset = () => {
    if (isPlaying) return
    setState(initialPrototypeState())
    setThermal(createInitialThermalState())
    setHistory([])
    setHoverHex(null)
    setSelectedAimHex(null)
    setPlayback(null)
  }

  const setPreset = (preset) => {
    if (isPlaying) return
    const direction = directionVector('E')
    setState((current) => ({ ...current, velocity: { x: direction.x * preset.speed, z: direction.z * preset.speed } }))
    setHoverHex(null)
  }

  const changeRadius = (radius) => {
    if (isPlaying) return
    setBoardRadius(radius)
    setState(initialPrototypeState())
    setThermal(createInitialThermalState())
    setHistory([])
    setHoverHex(null)
    setSelectedAimHex(null)
  }

  const idleAimText = actionId === 'basic-move' ? 'Hover an adjacent Cell to steer' : 'Hover a Cell to aim'
  const handHelp = actionId === 'basic-move'
    ? 'Basic Move only accepts an adjacent Aim Cell. Momentum may make the resolved 1 AT path cross multiple Cells.'
    : 'Aim Cell defines impulse direction; preview and execution share one solver.'

  return (
    <main
      className="current-prototype cell-world-prototype"
      data-implementation="cell-world-spatial-ab-v3"
      data-spatial-mode={spatialMode}
      data-action-id={actionId}
      data-playing={isPlaying}
      data-world-at={state.worldAt.toFixed(1)}
      data-logical-x={state.position.x.toFixed(4)}
      data-logical-z={state.position.z.toFixed(4)}
      data-speed={speed.toFixed(4)}
      data-momentum={momentum}
      data-thermal-temperature={thermal.temperature.toFixed(4)}
      data-thermal-drift={thermal.drift.toFixed(4)}
      data-preview-valid={previewPlan?.valid === true}
      data-authority="cell-world-plus-spatial-state"
      data-cell-world="true"
      data-basic-aim-contract="adjacent-only"
      data-at-visual-ms={atVisualMs}
      data-solver-steps={config.steps}
      data-axis-indicator-preview={axisIndicatorPreview}
      data-conflict-actors={actors.length}
      data-cell-conflict={previewPlan?.cellConflict ? 'preview' : playback?.conflictEvents?.length ? 'playback' : 'idle'}
    >
      <header className="prototype-header">
        <div className="brand">
          <p>ProjectC · Cell World / Inertia A-B</p>
          <h1>Inertia Driving Playground</h1>
        </div>
        <div className="headline-state">
          <div><span>World Time</span><strong>{state.worldAt.toFixed(1)} AT</strong></div>
          <div className={`thermal-${thermalDomain.toLowerCase()}`}><span>Thermal</span><strong>{thermalDomain} · T {formatThermal(thermal.temperature)}</strong></div>
          <div><span>Momentum</span><strong>M{momentum}</strong></div>
          <div><span>Axis</span><strong>{heading === null ? 'M0' : `${heading.toFixed(0)}°`}</strong></div>
          <div><span>Spatial</span><strong>{spatialMode === 'discrete' ? 'Discrete' : 'Hybrid'}</strong></div>
        </div>
      </header>

      <section className="lab-grid">
        <aside className="side-panel left-panel">
          <section className="panel-card actor-card">
            <div className="portrait">⬡</div>
            <div><p>Impulse Actor</p><h2>Courier</h2><span className="actor-sub">Cell World explorer</span></div>
          </section>

          <section className="panel-card actor-vitals">
            <div className="section-heading"><h3>Actor / World State</h3><span>{thermalDomain}</span></div>
            <div className="vital-row"><span>HP</span><i><b style={{ width: '84%' }} /></i><strong>84/100</strong></div>
            <div className="vital-row thermal"><span>Thermal</span><i><b style={{ width: `${Math.max(8, Math.min(92, (thermal.temperature + 4) / 8 * 100))}%` }} /></i><strong>{formatThermal(thermal.temperature)}</strong></div>
            <ThermalPendulum thermal={thermal} elapsedAt={state.worldAt} playback={playback} />
            <dl className="state-list actor-state-list">
              <div><dt>Cell</dt><dd>{currentHex.q},{currentHex.r}</dd></div>
              <div><dt>Terrain</dt><dd>{terrainLabel(currentCell)}</dd></div>
              <div><dt>Cell Temp</dt><dd>{currentCell?.groundTemp ?? 0}</dd></div>
              <div><dt>Moisture</dt><dd>{currentCell?.moisture ?? 0}</dd></div>
              <div><dt>Heading</dt><dd>{heading === null ? 'M0 / none' : `${heading.toFixed(0)}°`}</dd></div>
              <div><dt>Velocity</dt><dd>{speed.toFixed(2)}</dd></div>
              <div><dt>Momentum</dt><dd>M{momentum}</dd></div>
            </dl>
          </section>

          <section className="panel-card prediction-card">
            <div className="section-heading"><h3>Predicted Outcome</h3><span>{previewPlan?.valid ? spatialMode : 'waiting aim'}</span></div>
            <p>{previewPlan ? planSummary(previewPlan) : actionId === 'coast' ? 'Coast uses the current velocity direction.' : actionId === 'basic-move' ? 'Hover an adjacent Cell to preview the inertia-constrained Cell path.' : 'Hover a Cell to preview this action.'}</p>
            {previewPlan?.valid && (
              <dl className="state-list compact">
                <div><dt>Aim Cell</dt><dd>{hoverHex ? axialKey(hoverHex) : 'velocity'}</dd></div>
                <div><dt>Final Position</dt><dd>{previewPlan.finalState.position.x.toFixed(2)} / {previewPlan.finalState.position.z.toFixed(2)}</dd></div>
                <div><dt>Final Cell</dt><dd>{predictedHex.q},{predictedHex.r}</dd></div>
                <div><dt>Cells touched</dt><dd>{previewPlan.traversedCells.length}</dd></div>
                <div><dt>Collisions</dt><dd>{previewPlan.collisions.length}</dd></div>
                <div><dt>Cell Conflict</dt><dd>{previewPlan.cellConflict ? `${previewPlan.cellConflict.targetActorId} · M${previewPlan.cellConflict.impactM} · ${previewPlan.cellConflict.resolved ? 'push' : 'blocked'}` : '—'}</dd></div>
                <div><dt>Target Cells</dt><dd>{actorCellList(previewPlan.actorStates ?? actors) || '—'}</dd></div>
              </dl>
            )}
          </section>
        </aside>

        <section className="center-column">
          <div className="board-strip">
            <strong>{inputContract}</strong>
            <span>{isPlaying ? `Resolving 1 AT · ${playback?.summary ?? ''}` : hoverHex ? `Aim Cell ${axialKey(hoverHex)} · ${terrainLabel(aimedCell)}` : idleAimText}</span>
          </div>
          <div className="board-toolbar">
            <div className="view-switch spatial-mode-switch" role="group" aria-label="Spatial model">
              <button type="button" data-spatial-select="discrete" aria-pressed={spatialMode === 'discrete'} className={spatialMode === 'discrete' ? 'active' : ''} disabled={isPlaying} onClick={() => changeSpatialMode('discrete')}>Discrete</button>
              <button type="button" data-spatial-select="hybrid" aria-pressed={spatialMode === 'hybrid'} className={spatialMode === 'hybrid' ? 'active' : ''} disabled={isPlaying} onClick={() => changeSpatialMode('hybrid')}>Hybrid</button>
              <span className="toolbar-divider" />
              <button type="button" className={viewMode === 'isometric' ? 'active' : ''} onClick={() => setViewMode('isometric')}>3D</button>
              <button type="button" className={viewMode === 'top' ? 'active' : ''} onClick={() => setViewMode('top')}>Top</button>
              <button type="button" onClick={() => setCameraResetToken((value) => value + 1)}>Reset View</button>
            </div>
            <div className="session-buttons">
              <button type="button" disabled={history.length === 0 || isPlaying} onClick={undo}>Undo</button>
              <button type="button" disabled={isPlaying} onClick={reset}>Reset</button>
            </div>
          </div>
          <div className={`board-frame ${isPlaying ? 'playing' : ''}`}>
            <Board3D
              cells={displayCells}
              obstacles={obstacles}
              state={state}
              previewPlan={previewPlan}
              playback={playback}
              atVisualMs={atVisualMs}
              axisIndicatorPreview={axisIndicatorPreview}
              boardRadius={boardRadius}
              viewMode={viewMode}
              cameraResetToken={cameraResetToken}
              hoverHex={hoverHex}
              selectedAimHex={selectedAimHex}
              showWeather={showWeather}
              showThermal={showThermal}
              onHoverHex={isPlaying ? () => {} : changeHoverHex}
              onClickHex={resolveClick}
            />
            <div className="board-legend">
              <span><i className={spatialMode === 'discrete' ? 'trajectory discrete' : 'trajectory'} />Rule-constrained steering preview</span>
              <span><i className="terrain" />Beacon = occupied Actor · cyan marker = projected landing</span>
              <span><i className="momentum-axis" />Legacy Axis HUD · dots = M</span>
            </div>
            {isPlaying && <div className="playback-badge">{playback?.spatialMode === 'discrete' ? 'Discrete' : 'Hybrid'} · 1 AT · {(playback?.durationMs / 1000).toFixed(2)} s · {playback?.thermalBehavior}</div>}
          </div>

          <section className="action-hand">
            <div className="hand-heading">
              <div><h2>Basic Command + Momentum Cards · Cell Aim</h2><p>{handHelp}</p></div>
              <span>{action.label} · {actionDescriptor}</span>
            </div>
            <div className="action-row">
              {ACTIONS.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className={`action-card ${entry.id === actionId ? 'selected' : ''}`}
                  data-action-id={entry.id}
                  disabled={isPlaying}
                  onClick={() => { setActionId(entry.id); setHoverHex(null) }}
                >
                  <header>
                    <strong>{entry.label}</strong>
                    <em>{entry.kind === 'basic' ? 'BASE' : entry.kind === 'coast' ? 'ΔV 0' : `ΔV ${entry.force.toFixed(2)}`}</em>
                  </header>
                  <p>{entry.description}</p>
                  <span>{entry.short}</span>
                </button>
              ))}
            </div>
          </section>
        </section>

        <aside className="side-panel right-panel">
          <section className="panel-card spatial-ab-card">
            <div className="section-heading"><h3>Spatial Model A/B</h3><span>same board</span></div>
            <div className="ab-explain">
              <button type="button" data-spatial-panel-select="discrete" className={spatialMode === 'discrete' ? 'chosen' : ''} disabled={isPlaying} onClick={() => changeSpatialMode('discrete')}><b>Discrete</b><span>Cell-center presentation + Cell Conflict / knockback test</span></button>
              <button type="button" data-spatial-panel-select="hybrid" className={spatialMode === 'hybrid' ? 'chosen' : ''} disabled={isPlaying} onClick={() => changeSpatialMode('hybrid')}><b>Hybrid</b><span>Continuous impulse P/V; actor Cell Conflict is intentionally not applied yet</span></button>
            </div>
            <small>本轮 Cell Conflict 只验证 Discrete：先证明“占格冲突 + 动量传播”是否值得继续，再决定是否把同一语义映射进 Hybrid。</small>
          </section>

          <section className="panel-card cell-inspector">
            <div className="section-heading"><h3>Cell Inspector</h3><span>{aimedCell ? aimedCell.key : currentCell?.key}</span></div>
            {(() => { const cell = aimedCell ?? currentCell; return cell ? <dl className="state-list">
              <div><dt>Ground</dt><dd>{terrainLabel(cell)}</dd></div>
              <div><dt>Temperature</dt><dd>{cell.groundTemp}</dd></div>
              <div><dt>Moisture</dt><dd>{cell.moisture}</dd></div>
              <div><dt>Sky</dt><dd>{cell.skyFill}{cell.rain ? ' + rain' : ''}</dd></div>
              <div><dt>Wind</dt><dd>{cell.wind ?? '—'}</dd></div>
              <div><dt>Tags</dt><dd>{cell.tags.length ? cell.tags.join(', ') : '—'}</dd></div>
            </dl> : null })()}
          </section>

          <section className="panel-card axis-indicator-card">
            <div className="section-heading"><h3>Axis Indicator</h3><span>legacy HUD preview</span></div>
            <div className="axis-preview-grid">
              {axisIndicatorOptions.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  data-axis-indicator-select={entry.id}
                  className={axisIndicatorPreview === entry.id ? 'active' : ''}
                  onClick={() => changeAxisIndicatorPreview(entry.id)}
                >{entry.label}</button>
              ))}
            </div>
            <small>Auto 按当前 Velocity 显示 Horizontal Axis，M0 会保留零惯性标记。Down M 是旧规则中的 Grounded / Position Authority 指示，仅在这里预览视觉，不会伪装成当前二维向下速度。</small>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>World Layers</h3><span>visual rules</span></div>
            <button type="button" className={showWeather ? 'active wide-button' : 'wide-button'} onClick={() => setShowWeather((value) => !value)}>Weather / Sky {showWeather ? 'ON' : 'OFF'}</button>
            <button type="button" className={showThermal ? 'active wide-button' : 'wide-button'} onClick={() => setShowThermal((value) => !value)}>Thermal Tint {showThermal ? 'ON' : 'OFF'}</button>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Quick Momentum</h3><span>debug</span></div>
            <div className="quick-grid">{velocityPresets.map((preset) => <button type="button" key={preset.label} disabled={isPlaying} onClick={() => setPreset(preset)}>{preset.label}</button>)}</div>
          </section>

          <section className="panel-card timebase-card">
            <div className="section-heading"><h3>Timebase</h3><span>visual speed</span></div>
            <label className="range-row timebase-range">
              <span>Real time / AT</span>
              <input
                data-timebase-slider
                type="range"
                min="250"
                max="1600"
                step="50"
                value={atVisualMs}
                disabled={isPlaying}
                onChange={(event) => changeAtVisualMs(Number(event.target.value))}
              />
              <output>{(atVisualMs / 1000).toFixed(2)} s</output>
            </label>
            <div className="timebase-facts">
              <span>1 AT <b>{atVisualMs} ms</b></span>
              <span>Thermal cycle <b>{THERMAL_PERIOD_AT} AT</b></span>
              <span>Cycle real time <b>{(THERMAL_PERIOD_AT * atVisualMs / 1000).toFixed(1)} s</b></span>
            </div>
            <small>滑杆只改变播放速度，不改变求解结果。热力摆仍以 AT 为单位，因此会跟随同一时间轴同步加速或减速。</small>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Cell Conflict / Board</h3><span>prototype</span></div>
            <div className="quick-grid">
              <button type="button" data-conflict-scenario="chain" disabled={isPlaying} onClick={() => runConflictScenario('chain')}>Chain Setup</button>
              <button type="button" data-conflict-scenario="wall" disabled={isPlaying} onClick={() => runConflictScenario('wall')}>Wall Setup</button>
            </div>
            <p className="actor-sub">Discrete test rule: M0 is blocked by occupancy; M1–M3 becomes Impact Power. Knockback transfers through occupied Cells; a wall on the first push step prevents the defender from vacating.</p>
            <dl className="state-list compact">
              <div><dt>Actors</dt><dd>{actorCellList(actors) || '—'}</dd></div>
              <div><dt>Preview</dt><dd>{previewPlan?.cellConflict ? `${previewPlan.cellConflict.resolved ? 'PUSH' : 'BLOCK'} · M${previewPlan.cellConflict.impactM}` : '—'}</dd></div>
            </dl>
            <label className="range-row"><span>Restitution</span><input type="range" min="0" max="0.9" step="0.05" value={restitution} disabled={isPlaying} onChange={(event) => setRestitution(Number(event.target.value))} /><output>{restitution.toFixed(2)}</output></label>
            <button type="button" className={obstaclesEnabled ? 'active wide-button' : 'wide-button'} disabled={isPlaying} onClick={() => setObstaclesEnabled((value) => !value)}>Collision Surfaces {obstaclesEnabled ? 'ON' : 'OFF'}</button>
            <label className="range-row"><span>Board Radius</span><input type="range" min="4" max="10" step="1" value={boardRadius} disabled={isPlaying} onChange={(event) => changeRadius(Number(event.target.value))} /><output>{boardRadius}</output></label>
          </section>
        </aside>
      </section>
    </main>
  )
}
