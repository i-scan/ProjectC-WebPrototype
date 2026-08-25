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
  momentumSpeed,
  planSummary,
  playbackElapsedMs,
} from '../sim/solver.js'
import {
  axisIdFromState,
  discreteActionReachability,
  isDestinationDrivenAction,
  momentumRange,
  reachableKeySet,
  simulatePrototypeSpatial,
} from '../sim/spatial-rules.js'
import {
  ACTOR_COLLISION_RESTITUTION,
  conflictScenario,
  createConflictActors,
  resolveCellConflicts,
} from '../sim/conflict.js'
import {
  THERMAL_PERIOD_AT,
  THERMAL_PERIOD_OPTIONS,
  advanceThermal,
  createInitialThermalState,
  formatThermal,
  normalizeThermalPeriodAt,
  thermalBehaviorFor,
  thermalDomainFor,
} from '../sim/thermal.js'

const velocityPresets = [
  { label: 'Free M0', axisId: null, level: 0 },
  { label: 'E · M0', axisId: 'E', level: 0 },
  { label: 'E · M1', axisId: 'E', level: 1 },
  { label: 'E · M2', axisId: 'E', level: 2 },
  { label: 'E · M3', axisId: 'E', level: 3 },
]
const downAxisPreviews = [1, 2, 3]

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
  return { ...createInitialState(), axisId: null, actors: createConflictActors('chain') }
}
function stateForConflictScenario(kind) {
  const scenario = conflictScenario(kind)
  const direction = directionVector(scenario.directionId)
  const speed = momentumSpeed(scenario.momentum)
  return {
    position: axialToWorld(scenario.playerHex),
    velocity: { x: direction.x * speed, z: direction.z * speed },
    axisId: scenario.directionId,
    worldAt: 0,
    actors: scenario.actors,
  }
}
function actorCellList(actors = []) {
  return actors.map((actor) => `${actor.label ?? actor.id}:${actor.hex.q},${actor.hex.r}`).join(' · ')
}
function kinematicState(current, axisId, level) {
  const normalizedLevel = Math.max(0, Math.min(3, Math.round(Number(level) || 0)))
  const direction = axisId ? directionVector(axisId) : { x: 0, z: 0 }
  const speed = momentumSpeed(normalizedLevel)
  return {
    ...current,
    axisId: axisId || null,
    velocity: axisId ? { x: direction.x * speed, z: direction.z * speed } : { x: 0, z: 0 },
  }
}
function uniqueReachable(reachability) {
  const seen = new Set()
  const result = []
  for (const entry of reachability) {
    const hex = entry.finalHex ?? entry.targetHex
    if (!hex) continue
    const key = axialKey(hex)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ hex, rule: entry.rule, id: entry.id })
  }
  return result
}
function exchangeText(exchange) {
  if (!exchange) return '—'
  return `M${exchange.sourceBeforeM}+M${exchange.targetBeforeM} → M${exchange.sourceAfterM}+M${exchange.targetAfterM}`
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
  const [thermalPeriodAt, setThermalPeriodAt] = useState(THERMAL_PERIOD_AT)
  const [axisDisplayOverride, setAxisDisplayOverride] = useState('auto')
  const [viewMode, setViewMode] = useState('isometric')
  const [showWeather, setShowWeather] = useState(true)
  const [showThermal, setShowThermal] = useState(true)
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [playback, setPlayback] = useState(null)
  const playbackIdRef = useRef(1)

  const action = actionById(actionId)
  const speed = speedOf(state.velocity)
  const momentum = momentumLevel(speed)
  const axisId = axisIdFromState(state)
  const heading = headingOf(state.velocity)
  const currentHex = worldToAxial(state.position)
  const actors = state.actors ?? []
  const cells = useMemo(() => createCellWorld(boardRadius), [boardRadius])
  const currentCell = cellAt(cells, currentHex)
  const aimedCell = cellAt(cells, hoverHex ?? selectedAimHex)
  const obstacles = useMemo(() => obstaclesEnabled ? collisionObstaclesFromCells(cells) : [], [cells, obstaclesEnabled])
  const config = useMemo(() => ({ ...DEFAULT_SOLVER_CONFIG, boardRadius, restitution }), [boardRadius, restitution])
  const isPlaying = Boolean(playback)
  const destinationDriven = isDestinationDrivenAction(actionId, spatialMode)

  const reachability = useMemo(() => {
    if (playback || !destinationDriven) return []
    return discreteActionReachability({ state, actionId, spatialMode, config, obstacles })
  }, [playback, destinationDriven, state, actionId, spatialMode, config, obstacles])
  const reachableKeys = useMemo(() => reachableKeySet(reachability), [reachability])
  const reachableCells = useMemo(() => uniqueReachable(reachability), [reachability])

  const previewPlan = useMemo(() => {
    if (playback) return null
    if (actionId !== 'coast' && !hoverHex) return null
    if (destinationDriven && hoverHex && !reachableKeys.has(axialKey(hoverHex))) return null
    const aimPoint = hoverHex ? axialToWorld(hoverHex) : null
    const basePlan = simulatePrototypeSpatial({ spatialMode, state, actionId, aimPoint, config, obstacles })
    return resolveCellConflicts({ plan: basePlan, actors, obstacles, boardRadius })
  }, [playback, actionId, hoverHex, destinationDriven, reachableKeys, spatialMode, state, config, obstacles, actors, boardRadius])

  const predictedHex = previewPlan?.valid ? worldToAxial(previewPlan.finalState.position) : null
  const thermalDomain = thermalDomainFor(thermal.temperature)
  const basicRange = momentumRange(momentum)
  const actionDescriptor = action.kind === 'basic'
    ? `CELL TARGET · M${momentum} envelope · M2/M3 long Move spends 1M`
    : action.kind === 'coast'
      ? 'COAST · ΔV 0'
      : spatialMode === 'discrete' && ['drive', 'heavy-drive', 'hard-turn'].includes(actionId)
        ? `CELL TARGET · ΔV ${action.force.toFixed(2)} · curved landing path`
        : `ΔV ${action.force.toFixed(2)}`
  const inputContract = destinationDriven
    ? `${action.label} → click a highlighted reachable Cell → follow the shown curve → commit the landing Cell`
    : action.kind === 'coast'
      ? 'Coast → current Velocity → 1 AT trajectory'
      : `Impulse Card + Aim Cell → Current Velocity + ΔV → ${spatialMode === 'hybrid' ? 'continuous curved result' : 'discrete result'}`

  const changeSpatialMode = (mode) => {
    if (mode !== 'discrete' && mode !== 'hybrid') return false
    if (isPlaying) return false
    setSpatialMode(mode)
    setAxisDisplayOverride('auto')
    setHoverHex(null)
    setSelectedAimHex(null)
    return true
  }

  const changeAtVisualMs = (value) => {
    if (isPlaying || !Number.isFinite(value)) return false
    setAtVisualMs(Math.max(250, Math.min(1600, Math.round(value / 50) * 50)))
    return true
  }

  const changeThermalPeriod = (value) => {
    if (isPlaying || !Number.isFinite(value)) return false
    setThermalPeriodAt(normalizeThermalPeriodAt(value))
    return true
  }

  const changeAxisDisplay = (value) => {
    if (isPlaying) return false
    if (value !== 'auto' && !['down-1', 'down-2', 'down-3'].includes(value)) return false
    setAxisDisplayOverride(value)
    return true
  }

  const changeHoverHex = (hex) => {
    if (isPlaying) return false
    if (destinationDriven && hex && !reachableKeys.has(axialKey(hex))) {
      setHoverHex(null)
      return false
    }
    setHoverHex(hex)
    return true
  }

  const resolveClick = (hex) => {
    if (isPlaying) return false
    if (destinationDriven && !reachableKeys.has(axialKey(hex))) return false

    const point = axialToWorld(hex)
    const basePlan = simulatePrototypeSpatial({
      spatialMode,
      state,
      actionId,
      aimPoint: actionId === 'coast' ? null : point,
      config,
      obstacles,
    })
    const plan = resolveCellConflicts({ plan: basePlan, actors, obstacles, boardRadius })
    if (!plan.valid) return false
    if (actionId === 'coast' && !plan.traversedCells.some((entry) => sameHex(entry, hex))) return false

    const thermalBehavior = thermalBehaviorFor({
      actionId,
      beforeSpeed: speed,
      collisions: plan.collisions.length,
    })
    const finalThermal = advanceThermal(thermal, thermalBehavior, 1, thermalPeriodAt)

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
      destinationDriven: Boolean(plan.destinationDriven),
      conflictEvents: plan.conflictEvents ?? [],
      actorTrajectories: plan.actorTrajectories ?? {},
      cellConflict: plan.cellConflict ?? null,
      thermalPeriodAt,
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
    setAxisDisplayOverride('auto')
    setActionId('basic-move')
    setHoverHex(null)
    setSelectedAimHex(null)
    return true
  }

  const reset = () => {
    setPlayback(null)
    setState(initialPrototypeState())
    setThermal(createInitialThermalState())
    setHistory([])
    setAxisDisplayOverride('auto')
    setHoverHex(null)
    setSelectedAimHex(null)
  }

  useEffect(() => {
    window.__PROJECTC_PROTOTYPE__ = {
      fireAt(q, r) { return resolveClick({ q, r }) },
      setSpatialMode(mode) { return changeSpatialMode(mode) },
      setAction(id) {
        if (isPlaying || !ACTIONS.some((entry) => entry.id === id)) return false
        setActionId(id)
        setHoverHex(null)
        setSelectedAimHex(null)
        return true
      },
      setVelocity(x, z) {
        if (isPlaying || !Number.isFinite(x) || !Number.isFinite(z)) return false
        setAxisDisplayOverride('auto')
        setState((current) => {
          const velocity = { x, z }
          const inferred = axisIdFromState({ velocity })
          return { ...current, velocity, axisId: Math.hypot(x, z) > 0.02 ? inferred : current.axisId }
        })
        setHoverHex(null)
        return true
      },
      setKinematics(nextAxisId, level) {
        if (isPlaying) return false
        const normalizedAxis = String(nextAxisId || '')
        const axis = normalizedAxis === 'none' ? null : normalizedAxis
        if (axis && !['E', 'NE', 'NW', 'W', 'SW', 'SE'].includes(axis)) return false
        setAxisDisplayOverride('auto')
        setState((current) => kinematicState(current, axis, Number(level)))
        setHoverHex(null)
        return true
      },
      setAxisDisplay(value) { return changeAxisDisplay(String(value)) },
      setAtMs(value) { return changeAtVisualMs(Number(value)) },
      setThermalPeriod(value) { return changeThermalPeriod(Number(value)) },
      setConflictScenario(kind) { return runConflictScenario(String(kind)) },
      reset() { reset(); return true },
      trajectory() { return structuredClone(playback?.samples ?? previewPlan?.samples ?? []) },
      conflicts() { return structuredClone(playback?.conflictEvents ?? previewPlan?.conflictEvents ?? []) },
      actorTrajectories() { return structuredClone(playback?.actorTrajectories ?? previewPlan?.actorTrajectories ?? {}) },
      reachability() { return structuredClone(reachability) },
      snapshot() {
        return {
          ...structuredClone(state),
          thermal: structuredClone(thermal),
          spatialMode,
          actionId,
          atVisualMs,
          thermalPeriodAt,
          axisDisplayOverride,
          axisId,
          momentum,
          destinationDriven,
          reachableCount: reachableCells.length,
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
    setAxisDisplayOverride('auto')
    setHoverHex(null)
    setSelectedAimHex(null)
  }

  const setPreset = (preset) => {
    if (isPlaying) return
    setAxisDisplayOverride('auto')
    setState((current) => kinematicState(current, preset.axisId, preset.level))
    setHoverHex(null)
    setSelectedAimHex(null)
  }

  const changeRadius = (radius) => {
    if (isPlaying) return
    setBoardRadius(radius)
    setState(initialPrototypeState())
    setThermal(createInitialThermalState())
    setHistory([])
    setAxisDisplayOverride('auto')
    setHoverHex(null)
    setSelectedAimHex(null)
  }

  const idleAimText = destinationDriven ? 'Hover / click a highlighted reachable Cell' : 'Hover a Cell to aim'
  const handHelp = destinationDriven
    ? 'Landing Cell is the input. The dashed curve only explains the route; it is not a second steering input.'
    : 'Aim Cell defines impulse direction; preview and execution share one solver.'
  const axisHeadline = axisDisplayOverride.startsWith('down-')
    ? `Down · M${axisDisplayOverride.split('-')[1]}`
    : spatialMode === 'discrete'
      ? axisId ?? 'None'
      : heading === null ? (axisId ?? 'M0') : `${heading.toFixed(0)}°`
  const reachableText = reachability.length
    ? reachability.map((entry) => `${entry.id}:${entry.finalHex.q},${entry.finalHex.r}`).join(' · ')
    : '—'
  const exchange = previewPlan?.cellConflict?.momentumExchange ?? playback?.cellConflict?.momentumExchange ?? null

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
      data-axis-id={axisId ?? 'none'}
      data-axis-display-override={axisDisplayOverride}
      data-thermal-temperature={thermal.temperature.toFixed(4)}
      data-thermal-drift={thermal.drift.toFixed(4)}
      data-thermal-period-at={thermalPeriodAt}
      data-preview-valid={previewPlan?.valid === true}
      data-authority="cell-world-plus-spatial-state"
      data-cell-world="true"
      data-basic-aim-contract="reachable-cell-target-v4"
      data-basic-move-rules="connected-envelope-m-spend-v4"
      data-drive-rule="cell-target-curved-composition"
      data-axis-ui="actor-screen-arrow-v4"
      data-at-visual-ms={atVisualMs}
      data-solver-steps={config.steps}
      data-conflict-actors={actors.length}
      data-cell-conflict={previewPlan?.cellConflict ? 'preview' : playback?.conflictEvents?.length ? 'playback' : 'idle'}
      data-push-atomic="true"
      data-actor-collision-restitution={ACTOR_COLLISION_RESTITUTION}
      data-reachable-count={reachableCells.length}
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
          <div><span>Axis</span><strong>{axisHeadline}</strong></div>
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
            <ThermalPendulum thermal={thermal} elapsedAt={state.worldAt} playback={playback} periodAt={thermalPeriodAt} />
            <dl className="state-list actor-state-list">
              <div><dt>Cell</dt><dd>{currentHex.q},{currentHex.r}</dd></div>
              <div><dt>Terrain</dt><dd>{terrainLabel(currentCell)}</dd></div>
              <div><dt>Cell Temp</dt><dd>{currentCell?.groundTemp ?? 0}</dd></div>
              <div><dt>Moisture</dt><dd>{currentCell?.moisture ?? 0}</dd></div>
              <div><dt>Axis</dt><dd>{axisHeadline}</dd></div>
              <div><dt>Velocity</dt><dd>{speed.toFixed(2)}</dd></div>
              <div><dt>Momentum</dt><dd>M{momentum}</dd></div>
            </dl>
          </section>

          <section className="panel-card prediction-card">
            <div className="section-heading"><h3>Predicted Outcome</h3><span>{previewPlan?.valid ? spatialMode : 'waiting target'}</span></div>
            <p>{previewPlan ? planSummary(previewPlan) : destinationDriven ? 'Bright outlined Cells are legal landing Cells.' : 'Hover a Cell to preview this action.'}</p>
            {previewPlan?.valid && (
              <dl className="state-list compact">
                <div><dt>Clicked Cell</dt><dd>{hoverHex ? axialKey(hoverHex) : '—'}</dd></div>
                <div><dt>Final Cell</dt><dd>{predictedHex ? `${predictedHex.q},${predictedHex.r}` : '—'}</dd></div>
                <div><dt>Rule</dt><dd>{previewPlan.basicRule ?? previewPlan.driveRule ?? 'impulse'}</dd></div>
                <div><dt>Axis</dt><dd>{previewPlan.axisBefore ?? axisId ?? 'none'} → {previewPlan.axisAfter ?? '—'}</dd></div>
                <div><dt>Momentum</dt><dd>M{previewPlan.beforeM} → M{previewPlan.finalM}</dd></div>
                <div><dt>Cell Conflict</dt><dd>{previewPlan.cellConflict ? `${previewPlan.cellConflict.targetActorId} · M${previewPlan.cellConflict.impactM} · ${previewPlan.cellConflict.resolved ? 'push' : 'blocked'}` : '—'}</dd></div>
                <div><dt>M Exchange</dt><dd>{exchangeText(previewPlan.cellConflict?.momentumExchange)}</dd></div>
                <div><dt>Target Actors</dt><dd>{actorCellList(previewPlan.actorStates ?? actors) || '—'}</dd></div>
              </dl>
            )}
          </section>
        </aside>

        <section className="center-column">
          <div className="board-strip">
            <strong>{inputContract}</strong>
            <span>{isPlaying ? `Resolving 1 AT · ${playback?.summary ?? ''}` : hoverHex ? `Landing Cell ${axialKey(hoverHex)} · ${terrainLabel(aimedCell)}` : idleAimText}</span>
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
              <button type="button" onClick={reset}>Reset</button>
            </div>
          </div>
          <div className={`board-frame ${isPlaying ? 'playing' : ''}`}>
            <Board3D
              cells={cells}
              obstacles={obstacles}
              actors={actors}
              reachableCells={reachableCells}
              state={state}
              previewPlan={previewPlan}
              playback={playback}
              atVisualMs={atVisualMs}
              axisDisplayOverride={axisDisplayOverride}
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
              <span><i className="trajectory" />Blue dashed line = player route</span>
              <span><i className="terrain" />Bright outline = legal landing Cell</span>
              <span><i className="momentum-axis" />30px / 2.5px actor Axis arrow</span>
              <span><i className="knockback-path" />Yellow dashed line = knockback / launch route</span>
            </div>
            {isPlaying && <div className="playback-badge">{playback?.spatialMode === 'discrete' ? 'Discrete' : 'Hybrid'} · 1 AT · {(playback?.durationMs / 1000).toFixed(2)} s · {playback?.thermalBehavior}</div>}
          </div>

          <section className="action-hand">
            <div className="hand-heading">
              <div><h2>Basic Command + Momentum Cards · Landing Cell Input</h2><p>{handHelp}</p></div>
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
                  onClick={() => { setActionId(entry.id); setHoverHex(null); setSelectedAimHex(null) }}
                >
                  <header>
                    <strong>{entry.label}</strong>
                    <em>{entry.kind === 'basic' ? 'BASE' : entry.kind === 'coast' ? 'ΔV 0' : `ΔV ${entry.force.toFixed(2)}`}</em>
                  </header>
                  <p>{entry.id === 'basic-move'
                    ? '点击高亮落点。M1=除反向外五邻格；M2=连续五格弧；M3=收窄后的连续五格前弧。M1 同轴仍可建立 M2；M2/M3 使用额外距离后本 AT 消耗 1M；转向同样 M-1。'
                    : entry.id === 'drive' && spatialMode === 'discrete'
                      ? 'Discrete Drive 与 Move 使用同一落点域和曲线路径；ΔV 仍用于决定 Momentum 结果。'
                      : entry.description}</p>
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
              <button type="button" data-spatial-panel-select="discrete" className={spatialMode === 'discrete' ? 'chosen' : ''} disabled={isPlaying} onClick={() => changeSpatialMode('discrete')}><b>Discrete</b><span>Cell landing + Axis/M + curved authored route + atomic Cell Conflict</span></button>
              <button type="button" data-spatial-panel-select="hybrid" className={spatialMode === 'hybrid' ? 'chosen' : ''} disabled={isPlaying} onClick={() => changeSpatialMode('hybrid')}><b>Hybrid</b><span>Continuous impulse P/V; Basic Move still uses explicit landing Cells</span></button>
            </div>
            <small>Axis 直接常驻在 Actor 上。Horizontal 恢复之前 30px / 2.5px 的短粗规格；Down Axis 也保留为 Actor 上的测试指示，不重新增加独立 Axis 浮窗。</small>
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
            <div className="section-heading"><h3>Reachable Landing Cells</h3><span>{destinationDriven ? 'click target' : 'free aim'}</span></div>
            <dl className="state-list compact">
              <div><dt>Axis</dt><dd>{axisHeadline}</dd></div>
              <div><dt>Momentum</dt><dd>M{momentum}</dd></div>
              <div><dt>Nominal Range</dt><dd>{basicRange}</dd></div>
              <div><dt>Reachable</dt><dd>{reachableCells.length}</dd></div>
            </dl>
            <p className="actor-sub">{reachableText}</p>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>World Layers</h3><span>visual rules</span></div>
            <button type="button" className={showWeather ? 'active wide-button' : 'wide-button'} onClick={() => setShowWeather((value) => !value)}>Weather / Sky {showWeather ? 'ON' : 'OFF'}</button>
            <button type="button" className={showThermal ? 'active wide-button' : 'wide-button'} onClick={() => setShowThermal((value) => !value)}>Thermal Tint {showThermal ? 'ON' : 'OFF'}</button>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Quick Momentum / Axis</h3><span>debug</span></div>
            <div className="quick-grid">{velocityPresets.map((preset) => <button type="button" key={preset.label} disabled={isPlaying} onClick={() => setPreset(preset)}>{preset.label}</button>)}</div>
            <div className="quick-grid" data-down-axis-controls>
              <button type="button" data-axis-display="auto" className={axisDisplayOverride === 'auto' ? 'active' : ''} disabled={isPlaying} onClick={() => changeAxisDisplay('auto')}>Axis Auto</button>
              {downAxisPreviews.map((level) => (
                <button type="button" key={level} data-axis-display={`down-${level}`} className={axisDisplayOverride === `down-${level}` ? 'active' : ''} disabled={isPlaying} onClick={() => changeAxisDisplay(`down-${level}`)}>Down M{level}</button>
              ))}
            </div>
            <small>Down M1/M2/M3 当前用于保留和验证 Down Axis 的 Actor 常驻指示；它暂不改写 Horizontal 移动 solver。</small>
          </section>

          <section className="panel-card timebase-card">
            <div className="section-heading"><h3>Timebase</h3><span>visual + Thermal</span></div>
            <label className="range-row timebase-range">
              <span>Real time / AT</span>
              <input data-timebase-slider type="range" min="250" max="1600" step="50" value={atVisualMs} disabled={isPlaying} onChange={(event) => changeAtVisualMs(Number(event.target.value))} />
              <output>{(atVisualMs / 1000).toFixed(2)} s</output>
            </label>
            <div className="quick-grid" data-thermal-period-controls>
              {THERMAL_PERIOD_OPTIONS.map((period) => (
                <button type="button" key={period} data-thermal-period={period} className={thermalPeriodAt === period ? 'active' : ''} disabled={isPlaying} onClick={() => changeThermalPeriod(period)}>{period} AT</button>
              ))}
            </div>
            <div className="timebase-facts">
              <span>1 AT <b>{atVisualMs} ms</b></span>
              <span>Thermal cycle <b>{thermalPeriodAt} AT</b></span>
              <span>Half swing <b>{thermalPeriodAt / 2} AT</b></span>
              <span>Cycle real time <b>{(thermalPeriodAt * atVisualMs / 1000).toFixed(1)} s</b></span>
            </div>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Cell Conflict / Board</h3><span>momentum exchange + atomic push</span></div>
            <div className="quick-grid">
              <button type="button" data-conflict-scenario="chain" disabled={isPlaying} onClick={() => runConflictScenario('chain')}>Chain Setup</button>
              <button type="button" data-conflict-scenario="wall" disabled={isPlaying} onClick={() => runConflictScenario('wall')}>Wall Setup</button>
            </div>
            <p className="actor-sub">先按等质量 1D Actor 碰撞计算 M 交换，再用目标交换后的 M 进行整条击退链预检与动画。当前 Actor 恢复系数 e={ACTOR_COLLISION_RESTITUTION.toFixed(2)}，仅作为原型候选。</p>
            <dl className="state-list compact">
              <div><dt>Actors</dt><dd>{actorCellList(actors) || '—'}</dd></div>
              <div><dt>Preview</dt><dd>{previewPlan?.cellConflict ? `${previewPlan.cellConflict.resolved ? 'PUSH' : 'BLOCK'} · impact M${previewPlan.cellConflict.impactM}` : '—'}</dd></div>
              <div><dt>M Exchange</dt><dd>{exchangeText(exchange)}</dd></div>
              <div><dt>Actor e</dt><dd>{ACTOR_COLLISION_RESTITUTION.toFixed(2)}</dd></div>
              <div><dt>Atomic</dt><dd>exchange → preflight → animate → commit</dd></div>
            </dl>
            <label className="range-row"><span>Surface Restitution</span><input type="range" min="0" max="0.9" step="0.05" value={restitution} disabled={isPlaying} onChange={(event) => setRestitution(Number(event.target.value))} /><output>{restitution.toFixed(2)}</output></label>
            <button type="button" className={obstaclesEnabled ? 'active wide-button' : 'wide-button'} disabled={isPlaying} onClick={() => setObstaclesEnabled((value) => !value)}>Collision Surfaces {obstaclesEnabled ? 'ON' : 'OFF'}</button>
            <label className="range-row"><span>Board Radius</span><input type="range" min="4" max="10" step="1" value={boardRadius} disabled={isPlaying} onChange={(event) => changeRadius(Number(event.target.value))} /><output>{boardRadius}</output></label>
          </section>
        </aside>
      </section>
    </main>
  )
}
