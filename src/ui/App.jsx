import { useEffect, useMemo, useRef, useState } from 'react'
import { Board3D } from './Board3D.jsx'
import { ThermalPendulum } from './ThermalPendulum.jsx'
import { axialKey, axialToWorld, directionVector, worldToAxial } from '../sim/hex.js'
import { cellAt, collisionObstaclesFromCells, createCellWorld } from '../sim/world.js'
import {
  ACTIONS,
  AT_VISUAL_MS,
  DEFAULT_SOLVER_CONFIG,
  actionById,
  createInitialState,
  momentumLevel,
  planSummary,
  playbackElapsedMs,
  simulateSpatial,
} from '../sim/solver.js'
import {
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

export function App() {
  const [state, setState] = useState(() => createInitialState())
  const [thermal, setThermal] = useState(() => createInitialThermalState())
  const [history, setHistory] = useState([])
  const [actionId, setActionId] = useState('drive')
  const [spatialMode, setSpatialMode] = useState('discrete')
  const [hoverHex, setHoverHex] = useState(null)
  const [selectedAimHex, setSelectedAimHex] = useState(null)
  const [boardRadius, setBoardRadius] = useState(7)
  const [obstaclesEnabled, setObstaclesEnabled] = useState(true)
  const [restitution, setRestitution] = useState(DEFAULT_SOLVER_CONFIG.restitution)
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
  const cells = useMemo(() => createCellWorld(boardRadius), [boardRadius])
  const currentCell = cellAt(cells, currentHex)
  const aimedCell = cellAt(cells, hoverHex ?? selectedAimHex)
  const obstacles = useMemo(() => obstaclesEnabled ? collisionObstaclesFromCells(cells) : [], [cells, obstaclesEnabled])
  const config = useMemo(() => ({ ...DEFAULT_SOLVER_CONFIG, boardRadius, restitution }), [boardRadius, restitution])
  const aimPoint = hoverHex ? axialToWorld(hoverHex) : null
  const previewPlan = useMemo(() => {
    if (playback) return null
    if (actionId !== 'coast' && !hoverHex) return null
    return simulateSpatial({ spatialMode, state, actionId, aimPoint, config, obstacles })
  }, [spatialMode, state, actionId, hoverHex, config, obstacles, playback])

  const predictedHex = previewPlan?.valid ? worldToAxial(previewPlan.finalState.position) : null
  const isPlaying = Boolean(playback)
  const thermalDomain = thermalDomainFor(thermal.temperature)
  const actionDescriptor = action.kind === 'basic'
    ? 'BASE · 1 AT · ΔM 0'
    : action.kind === 'coast'
      ? 'COAST · ΔV 0'
      : `ΔV ${action.force.toFixed(2)}`
  const inputContract = action.kind === 'basic'
    ? `Basic Move + Aim Cell → Voluntary Move + Current Inertia → ${spatialMode === 'discrete' ? 'Cell-step resolution' : 'Continuous curved resolution'}`
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

  const resolveClick = (hex) => {
    if (isPlaying) return false
    const point = axialToWorld(hex)
    const plan = simulateSpatial({ spatialMode, state, actionId, aimPoint: actionId === 'coast' ? null : point, config, obstacles })
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
      samples: plan.samples,
      finalState: plan.finalState,
      finalThermal,
      thermalBehavior,
      summary: planSummary(plan),
      spatialMode,
    })
    return true
  }

  useEffect(() => {
    if (!playback || playback.pausedAt !== null) return undefined
    const remainingMs = Math.max(0, AT_VISUAL_MS - playbackElapsedMs(playback))
    const timer = window.setTimeout(() => {
      setState(playback.finalState)
      setThermal(playback.finalThermal)
      setPlayback((current) => current?.id === playback.id ? null : current)
    }, remainingMs)
    return () => window.clearTimeout(timer)
  }, [playback?.id, playback?.pausedAt, playback?.pausedTotal])

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
      trajectory() {
        return structuredClone(playback?.samples ?? previewPlan?.samples ?? [])
      },
      snapshot() {
        return {
          ...structuredClone(state),
          thermal: structuredClone(thermal),
          spatialMode,
          actionId,
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
    setState(createInitialState())
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
    setState(createInitialState())
    setThermal(createInitialThermalState())
    setHistory([])
    setHoverHex(null)
    setSelectedAimHex(null)
  }

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
      data-at-visual-ms={AT_VISUAL_MS}
      data-solver-steps={config.steps}
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
          <div><span>Axis</span><strong>{heading === null ? '—' : `${heading.toFixed(0)}°`}</strong></div>
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
            <ThermalPendulum thermal={thermal} elapsedAt={state.worldAt} />
            <dl className="state-list actor-state-list">
              <div><dt>Cell</dt><dd>{currentHex.q},{currentHex.r}</dd></div>
              <div><dt>Terrain</dt><dd>{terrainLabel(currentCell)}</dd></div>
              <div><dt>Cell Temp</dt><dd>{currentCell?.groundTemp ?? 0}</dd></div>
              <div><dt>Moisture</dt><dd>{currentCell?.moisture ?? 0}</dd></div>
              <div><dt>Heading</dt><dd>{heading === null ? '—' : `${heading.toFixed(0)}°`}</dd></div>
              <div><dt>Velocity</dt><dd>{speed.toFixed(2)}</dd></div>
              <div><dt>Momentum</dt><dd>M{momentum}</dd></div>
            </dl>
          </section>

          <section className="panel-card prediction-card">
            <div className="section-heading"><h3>Predicted Outcome</h3><span>{previewPlan?.valid ? spatialMode : 'waiting aim'}</span></div>
            <p>{previewPlan ? planSummary(previewPlan) : actionId === 'coast' ? 'Coast uses the current velocity direction.' : 'Hover a Cell to preview this action.'}</p>
            {previewPlan?.valid && (
              <dl className="state-list compact">
                <div><dt>Aim Cell</dt><dd>{hoverHex ? axialKey(hoverHex) : 'velocity'}</dd></div>
                <div><dt>Final Position</dt><dd>{previewPlan.finalState.position.x.toFixed(2)} / {previewPlan.finalState.position.z.toFixed(2)}</dd></div>
                <div><dt>Final Cell</dt><dd>{predictedHex.q},{predictedHex.r}</dd></div>
                <div><dt>Cells touched</dt><dd>{previewPlan.traversedCells.length}</dd></div>
                <div><dt>Collisions</dt><dd>{previewPlan.collisions.length}</dd></div>
              </dl>
            )}
          </section>
        </aside>

        <section className="center-column">
          <div className="board-strip">
            <strong>{inputContract}</strong>
            <span>{isPlaying ? `Resolving 1 AT · ${playback?.summary ?? ''}` : hoverHex ? `Aim Cell ${axialKey(hoverHex)} · ${terrainLabel(aimedCell)}` : 'Hover a Cell to aim'}</span>
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
              cells={cells}
              obstacles={obstacles}
              state={state}
              previewPlan={previewPlan}
              playback={playback}
              boardRadius={boardRadius}
              viewMode={viewMode}
              cameraResetToken={cameraResetToken}
              hoverHex={hoverHex}
              selectedAimHex={selectedAimHex}
              showWeather={showWeather}
              showThermal={showThermal}
              onHoverHex={isPlaying ? () => {} : setHoverHex}
              onClickHex={resolveClick}
            />
            <div className="board-legend">
              <span><i className={spatialMode === 'discrete' ? 'trajectory discrete' : 'trajectory'} />{spatialMode === 'discrete' ? 'Cell-step trajectory' : 'Continuous / curved trajectory'}</span>
              <span><i className="terrain" />Cell terrain / weather</span>
              <span><i className="momentum-axis" />Axis arrow = direction · dots = M</span>
            </div>
            {isPlaying && <div className="playback-badge">{playback?.spatialMode === 'discrete' ? 'Discrete' : 'Hybrid'} · 1 AT · fixed visible {AT_VISUAL_MS} ms · {playback?.thermalBehavior}</div>}
          </div>

          <section className="action-hand">
            <div className="hand-heading">
              <div><h2>Basic Command + Momentum Cards · Cell Aim</h2><p>Aim Cell defines direction, never a destination. Preview and execution share one solver.</p></div>
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
              <button type="button" data-spatial-panel-select="discrete" className={spatialMode === 'discrete' ? 'chosen' : ''} disabled={isPlaying} onClick={() => changeSpatialMode('discrete')}><b>Discrete</b><span>Cell-center presentation of the same Aim / action input</span></button>
              <button type="button" data-spatial-panel-select="hybrid" className={spatialMode === 'hybrid' ? 'chosen' : ''} disabled={isPlaying} onClick={() => changeSpatialMode('hybrid')}><b>Hybrid</b><span>Continuous P/V with curved momentum blending inside the Cell world</span></button>
            </div>
            <small>两种模式共用 Aim、基础行动/冲量规则和固定 1 AT 时钟；只比较空间呈现与落位方式。</small>
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

          <section className="panel-card">
            <div className="section-heading"><h3>World Layers</h3><span>visual rules</span></div>
            <button type="button" className={showWeather ? 'active wide-button' : 'wide-button'} onClick={() => setShowWeather((value) => !value)}>Weather / Sky {showWeather ? 'ON' : 'OFF'}</button>
            <button type="button" className={showThermal ? 'active wide-button' : 'wide-button'} onClick={() => setShowThermal((value) => !value)}>Thermal Tint {showThermal ? 'ON' : 'OFF'}</button>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Quick Momentum</h3><span>debug</span></div>
            <div className="quick-grid">{velocityPresets.map((preset) => <button type="button" key={preset.label} disabled={isPlaying} onClick={() => setPreset(preset)}>{preset.label}</button>)}</div>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Collision / Board</h3><span>deterministic</span></div>
            <label className="range-row"><span>Restitution</span><input type="range" min="0" max="0.9" step="0.05" value={restitution} disabled={isPlaying} onChange={(event) => setRestitution(Number(event.target.value))} /><output>{restitution.toFixed(2)}</output></label>
            <button type="button" className={obstaclesEnabled ? 'active wide-button' : 'wide-button'} disabled={isPlaying} onClick={() => setObstaclesEnabled((value) => !value)}>Collision Surfaces {obstaclesEnabled ? 'ON' : 'OFF'}</button>
            <label className="range-row"><span>Board Radius</span><input type="range" min="4" max="10" step="1" value={boardRadius} disabled={isPlaying} onChange={(event) => changeRadius(Number(event.target.value))} /><output>{boardRadius}</output></label>
          </section>
        </aside>
      </section>
    </main>
  )
}
