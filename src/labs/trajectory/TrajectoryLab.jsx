import { useEffect, useMemo, useRef, useState } from 'react'
import { Board3D } from '../../ui/Board3D.jsx'
import { axialKey, worldToAxial } from '../../sim/hex.js'
import { createCellWorld } from '../../sim/world.js'
import { AT_VISUAL_MS } from '../../sim/solver.js'
import {
  TRAJECTORY_BASE_DISSIPATION,
  TRAJECTORY_CELL_AUTHORITY_RULE,
  TRAJECTORY_DEFAULT_RADIUS,
  TRAJECTORY_DISSIPATION_RULE,
  TRAJECTORY_MAX_RADIUS,
  TRAJECTORY_MIN_RADIUS,
  TRAJECTORY_READY_RULE,
  TRAJECTORY_RULE,
  TRAJECTORY_STEERING_RULE,
  makeTrajectoryState,
  trajectoryActionPlan,
  trajectoryHeading,
  trajectoryMomentum,
  trajectoryProjectionPair,
  withCoastProjection,
} from './trajectory-rules.js'

const RESPONSE_CURVES = [
  { id: 'linear', label: 'Linear', note: 'Uniform steering response through the full Action.' },
  { id: 'smoothstep', label: 'Smooth', note: 'Gentler start/end while preserving the same total 60° authority.' },
]

function playbackFromPlan(plan, id, durationMs) {
  return {
    ...plan,
    id,
    startedAt: performance.now(),
    pausedAt: null,
    pausedTotal: 0,
    durationMs,
    spatialMode: 'hybrid',
    destinationDriven: false,
    actorTrajectories: {},
    actorPlaybackWindows: {},
    actorStates: [],
    playerPlaybackEnd: 1,
  }
}

function presetState(level, axisId = 'E') {
  return makeTrajectoryState({ hex: { q: 0, r: 0 }, axisId, momentum: level, worldAt: 0 })
}

function noAxisState() {
  return makeTrajectoryState({ hex: { q: 0, r: 0 }, axisId: null, momentum: 0, worldAt: 0 })
}

function cellText(hex) {
  return hex ? `${hex.q},${hex.r}` : '—'
}

function degreesText(value) {
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}°`
}

function projectionShell(coastPlan) {
  if (!coastPlan?.valid) return coastPlan
  const start = coastPlan.samples?.[0]
  const holdSamples = start ? [start, { ...start, t: 1, position: { ...start.position }, velocity: { ...start.velocity } }] : coastPlan.samples
  return {
    ...coastPlan,
    samples: holdSamples,
    actorTrajectories: { coastProjection: (coastPlan.crossings ?? []).map((entry) => ({ ...entry.hex })) },
  }
}

export function TrajectoryLab() {
  const [state, setState] = useState(() => presetState(2))
  const [actionId, setActionId] = useState('steer')
  const [selectedHex, setSelectedHex] = useState(null)
  const [hoverHex, setHoverHex] = useState(null)
  const [responseCurve, setResponseCurve] = useState('linear')
  const [boardRadius, setBoardRadius] = useState(TRAJECTORY_DEFAULT_RADIUS)
  const [viewMode, setViewMode] = useState('isometric')
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [atVisualMs, setAtVisualMs] = useState(AT_VISUAL_MS)
  const [playback, setPlayback] = useState(null)
  const [history, setHistory] = useState([])
  const [lastEvent, setLastEvent] = useState('B preset loaded at E / M2. Hover previews direction; with Move / Steer selected, click a Cell to execute immediately. Ready always settles on a Cell center.')
  const [lastPlan, setLastPlan] = useState(null)
  const playbackIdRef = useRef(1)

  const cells = useMemo(() => createCellWorld(boardRadius), [boardRadius])
  // Wall / Contact response is explicitly outside the first Process Steering Gate.
  // Keep the trajectory board visually clean rather than showing walls that this B solver does not yet resolve.
  const obstacles = useMemo(() => [], [])
  const momentum = trajectoryMomentum(state)
  const currentHex = worldToAxial(state.position)
  const ready = !playback
  const actionLabel = momentum > 0 ? 'Steer' : 'Move'
  const coastLabel = momentum > 0 ? 'Coast' : 'Wait'

  const coastPlan = useMemo(() => trajectoryActionPlan({
    state,
    actionId: 'coast',
    boardRadius,
    responseCurve,
    baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,
  }), [state, boardRadius, responseCurve])

  const intentHex = hoverHex ?? selectedHex
  const pair = useMemo(() => {
    if (!intentHex) return { controlled: null, coast: coastPlan }
    return trajectoryProjectionPair({
      state,
      actionId: 'steer',
      selectedHex: intentHex,
      boardRadius,
      responseCurve,
      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,
    })
  }, [state, intentHex?.q, intentHex?.r, boardRadius, responseCurve, coastPlan])

  const controlledPlan = pair.controlled
  const previewPlan = useMemo(() => {
    if (controlledPlan?.valid) return withCoastProjection(controlledPlan, coastPlan)
    return projectionShell(coastPlan)
  }, [controlledPlan, coastPlan])

  const saveHistory = () => {
    setHistory((entries) => [...entries, {
      state: structuredClone(state),
      selectedHex: selectedHex ? { ...selectedHex } : null,
      responseCurve,
      boardRadius,
      lastEvent,
      lastPlan: lastPlan ? structuredClone(lastPlan) : null,
    }].slice(-60))
  }

  useEffect(() => {
    if (!playback) return undefined
    const remainingMs = Math.max(0, playback.durationMs - (performance.now() - playback.startedAt))
    const timer = window.setTimeout(() => {
      setState(playback.finalState)
      setLastPlan(playback)
      setPlayback(null)
      setSelectedHex(null)
      setHoverHex(null)
      const nextM = trajectoryMomentum(playback.finalState)
      setLastEvent(`${playback.summary} · READY on Cell ${cellText(playback.finalHex)} at M${nextM}; ${nextM > 0 ? 'motion history remains for the next Action' : 'Horizontal M has dissipated to M0'}.`)
    }, remainingMs)
    return () => window.clearTimeout(timer)
  }, [playback?.id])

  const beginPlan = (plan) => {
    if (playback || !plan?.valid) return false
    saveHistory()
    setPlayback(playbackFromPlan(plan, playbackIdRef.current++, atVisualMs))
    setLastEvent(`${plan.summary} · resolving the complete 1 AT transition to Cell ${cellText(plan.finalHex)}; no intermediate Ready Window.`)
    return true
  }

  const commitSteer = (hex) => {
    if (playback || actionId !== 'steer' || !hex) return false
    const plan = trajectoryActionPlan({
      state,
      actionId: 'steer',
      selectedHex: hex,
      boardRadius,
      responseCurve,
      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,
    })
    if (!plan.valid) return false
    setSelectedHex({ ...hex })
    return beginPlan(plan)
  }

  const commitCoast = () => {
    if (playback) return false
    setActionId('coast')
    setHoverHex(null)
    setSelectedHex(null)
    return beginPlan(coastPlan)
  }

  const reset = () => {
    if (playback) return false
    setState(presetState(2))
    setActionId('steer')
    setSelectedHex(null)
    setHoverHex(null)
    setResponseCurve('linear')
    setBoardRadius(TRAJECTORY_DEFAULT_RADIUS)
    setHistory([])
    setLastPlan(null)
    setCameraResetToken((value) => value + 1)
    setLastEvent('B preset loaded at E / M2. Hover previews direction; with Move / Steer selected, click a Cell to execute immediately. Ready always settles on a Cell center.')
    return true
  }

  const setPreset = (level, axisId = 'E') => {
    if (playback) return false
    setState(level === 0 && !axisId ? noAxisState() : presetState(level, axisId))
    setActionId('steer')
    setSelectedHex(null)
    setHoverHex(null)
    setLastPlan(null)
    setHistory([])
    setLastEvent(level === 0 && !axisId
      ? 'M0 / NoAxis startup preset. Move is selected: hover previews, click a Cell executes and establishes Axis while remaining M0.'
      : `Preset ${axisId ?? 'NoAxis'} / M${level} loaded at a Cell-center Ready state.`)
    return true
  }

  const changeRadius = (radius) => {
    if (playback) return false
    const next = Math.max(TRAJECTORY_MIN_RADIUS, Math.min(TRAJECTORY_MAX_RADIUS, Math.round(radius)))
    setBoardRadius(next)
    setState(presetState(2))
    setActionId('steer')
    setSelectedHex(null)
    setHoverHex(null)
    setLastPlan(null)
    setHistory([])
    setCameraResetToken((value) => value + 1)
    setLastEvent(`Board Radius changed to ${next}. Trajectory scene reset to E / M2 at the origin Cell center.`)
    return true
  }

  const undo = () => {
    if (playback || history.length === 0) return false
    const previous = history.at(-1)
    setHistory((entries) => entries.slice(0, -1))
    setState(previous.state)
    setSelectedHex(previous.selectedHex)
    setResponseCurve(previous.responseCurve)
    setBoardRadius(previous.boardRadius)
    setLastEvent(previous.lastEvent)
    setLastPlan(previous.lastPlan)
    setHoverHex(null)
    return true
  }

  const switchToA = () => { window.location.hash = 'hex-prototype' }

  useEffect(() => {
    window.__PROJECTC_TRAJECTORY__ = {
      snapshot: () => ({
        implementation: TRAJECTORY_RULE,
        readyRule: TRAJECTORY_READY_RULE,
        steeringRule: TRAJECTORY_STEERING_RULE,
        dissipationRule: TRAJECTORY_DISSIPATION_RULE,
        cellAuthorityRule: TRAJECTORY_CELL_AUTHORITY_RULE,
        steerInput: 'direct-cell-click',
        worldAt: state.worldAt,
        momentum,
        axisId: state.axisId,
        headingDeg: Number.isFinite(trajectoryHeading(state)) ? trajectoryHeading(state) * 180 / Math.PI : null,
        cell: worldToAxial(state.position),
        actionLabel,
        coastLabel,
        responseCurve,
        boardRadius,
        playback: Boolean(playback),
        coastFinal: coastPlan?.valid ? { cell: coastPlan.finalHex, axis: coastPlan.finalState.axisId, m: coastPlan.finalM } : null,
        controlledFinal: controlledPlan?.valid ? { cell: controlledPlan.finalHex, axis: controlledPlan.finalState.axisId, m: controlledPlan.finalM } : null,
      }),
      setPreset: (level) => setPreset(level, 'E'),
      setNoAxis: () => setPreset(0, null),
      setResponseCurve,
      setRadius: changeRadius,
      steerAt: (q, r) => {
        if (playback) return false
        setActionId('steer')
        const plan = trajectoryActionPlan({
          state,
          actionId: 'steer',
          selectedHex: { q, r },
          boardRadius,
          responseCurve,
          baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,
        })
        if (!plan.valid) return false
        setSelectedHex({ q, r })
        return beginPlan(plan)
      },
      coast: commitCoast,
      reset,
    }
    return () => { delete window.__PROJECTC_TRAJECTORY__ }
  })

  const coastCell = coastPlan?.finalHex
  const controlledCell = controlledPlan?.finalHex
  const freezeStrength = Math.max(0, momentum)
  const lastCrossings = lastPlan?.crossings ?? []

  return (
    <main
      className="cell-world-prototype trajectory-lab"
      data-implementation={TRAJECTORY_RULE}
      data-trajectory-ready={TRAJECTORY_READY_RULE}
      data-trajectory-steering={TRAJECTORY_STEERING_RULE}
      data-trajectory-dissipation={TRAJECTORY_DISSIPATION_RULE}
      data-cell-authority={TRAJECTORY_CELL_AUTHORITY_RULE}
      data-steer-input="direct-cell-click"
      data-world-at={state.worldAt}
      data-momentum={momentum}
      data-axis={state.axisId ?? 'none'}
      data-ready={ready ? 'true' : 'false'}
      data-spatial-mode="hybrid"
      data-board-radius={boardRadius}
      data-response-curve={responseCurve}
    >
      <header className="prototype-header">
        <div className="brand"><p>ProjectC · VAL-012 Process Steering A/B</p><h1>Trajectory Lab</h1></div>
        <div className="headline-state">
          <div><span>World Time</span><strong>{state.worldAt.toFixed(1)} AT</strong></div>
          <div><span>Momentum</span><strong>M{momentum}</strong></div>
          <div><span>Axis</span><strong>{state.axisId ?? 'none'}</strong></div>
          <div><span>State</span><strong>{playback ? 'RESOLVING' : 'READY'}</strong></div>
          <div><span>Action</span><strong>{actionId === 'coast' ? coastLabel : actionLabel}</strong></div>
        </div>
      </header>

      <section className="lab-grid">
        <aside className="side-panel left-panel">
          <section className="panel-card actor-card">
            <div className="portrait">➤</div>
            <div><p>Persistent Motion Actor</p><h2>Courier / PS</h2><span className="actor-sub">Cell authority · continuous 1AT transition · Cell-center Ready</span></div>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Current State</h3><span>B candidate</span></div>
            <dl className="state-list">
              <div><dt>Cell</dt><dd>{cellText(currentHex)}</dd></div>
              <div><dt>Horizontal M</dt><dd>M{momentum}</dd></div>
              <div><dt>Axis</dt><dd>{state.axisId ?? 'none'}</dd></div>
              <div><dt>Ready</dt><dd>{ready ? 'CELL CENTER' : 'resolving'}</dd></div>
              <div><dt>World AT</dt><dd>{state.worldAt.toFixed(1)}</dd></div>
              <div><dt>Position</dt><dd>{state.position.x.toFixed(2)}, {state.position.z.toFixed(2)}</dd></div>
            </dl>
          </section>

          <section className="panel-card prediction-card" data-trajectory-preview-panel>
            <div className="section-heading"><h3>Projection</h3><span>hover only</span></div>
            <div className="projection-pair">
              <div className="projection-entry coast">
                <b>COAST</b>
                <span>Cell {cellText(coastCell)}</span>
                <span>{coastPlan?.finalState.axisId ?? 'none'} · M{coastPlan?.finalM ?? momentum}</span>
              </div>
              <div className={`projection-entry controlled ${controlledPlan?.valid ? 'active' : ''}`}>
                <b>CONTROLLED</b>
                <span>Cell {cellText(controlledCell)}</span>
                <span>{controlledPlan?.valid ? `${controlledPlan.finalState.axisId ?? 'none'} · M${controlledPlan.finalM}` : 'hover a Cell'}</span>
              </div>
            </div>
            {controlledPlan?.valid && (
              <dl className="state-list compact">
                <div><dt>Target Δ</dt><dd>{degreesText(controlledPlan.targetDeltaDeg)}</dd></div>
                <div><dt>Action Steering</dt><dd>{degreesText(controlledPlan.steeringAppliedDeg)}</dd></div>
                <div><dt>M→0 Settlement</dt><dd>{degreesText(controlledPlan.zeroMSettlementDeg)}</dd></div>
                <div><dt>Travel Band</dt><dd>{controlledPlan.travelDistance.toFixed(1)} Cell / AT</dd></div>
                <div><dt>Landing</dt><dd>{cellText(controlledPlan.finalHex)} center</dd></div>
              </dl>
            )}
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Previous Motion</h3><span>history</span></div>
            <p className="actor-sub">{lastPlan ? `${lastPlan.kind.toUpperCase()} · ${Math.max(0, lastCrossings.length - 1)} Cell crossings · settled at ${cellText(lastPlan.finalHex)} center.` : 'No committed B Action yet.'}</p>
          </section>
        </aside>

        <section className="center-column">
          <div className={`trajectory-status ${ready ? 'is-ready' : 'is-resolving'}`}>
            <strong>{ready ? `READY · CELL ${cellText(currentHex)} · M${momentum}` : `ACTION IN FLIGHT · ${actionId.toUpperCase()}`}</strong>
            <span>{lastEvent}</span>
          </div>

          <div className="board-toolbar">
            <div className="view-switch" role="group" aria-label="Trajectory view">
              <button type="button" className={viewMode === 'isometric' ? 'active' : ''} onClick={() => setViewMode('isometric')}>3D</button>
              <button type="button" className={viewMode === 'top' ? 'active' : ''} onClick={() => setViewMode('top')}>Top</button>
              <button type="button" onClick={() => setCameraResetToken((value) => value + 1)}>Reset View</button>
            </div>
            <div className="session-buttons">
              <button type="button" disabled={history.length === 0 || Boolean(playback)} onClick={undo}>Undo</button>
              <button type="button" disabled={Boolean(playback)} onClick={reset}>Reset</button>
            </div>
          </div>

          <div className={`board-frame trajectory-board-frame m${freezeStrength} ${playback ? 'playing' : ''}`}>
            <Board3D
              cells={cells}
              obstacles={obstacles}
              actors={[]}
              reachableCells={[]}
              state={state}
              previewPlan={previewPlan}
              playback={playback}
              atVisualMs={atVisualMs}
              axisDisplayOverride="auto"
              boardRadius={boardRadius}
              viewMode={viewMode}
              cameraResetToken={cameraResetToken}
              hoverHex={null}
              selectedAimHex={null}
              showWeather={false}
              showThermal={false}
              onHoverHex={(hex) => {
                if (playback || actionId !== 'steer') return setHoverHex(null)
                if (!hex || axialKey(hex) === axialKey(currentHex)) return setHoverHex(null)
                setHoverHex(hex)
              }}
              onClickHex={(hex) => {
                if (playback || actionId !== 'steer' || !hex || axialKey(hex) === axialKey(currentHex)) return
                setSelectedHex({ ...hex })
                setHoverHex(null)
                commitSteer(hex)
              }}
            />
            <div className="trajectory-vector-compass" data-steering-vector={controlledPlan?.valid ? 'visible' : 'hidden'}>
              <div className="vector-row yellow"><i>➜</i><span>Yellow · current motion history</span></div>
              <div className="vector-row blue"><i>➜</i><span>Blue · {controlledPlan?.valid ? `steering intent ${degreesText(controlledPlan.targetDeltaDeg)}` : (actionId === 'steer' ? 'hover Cell to preview' : 'select Move / Steer first')}</span></div>
            </div>
            {ready && momentum > 0 && (
              <div className="motion-freeze-badge" data-motion-freeze={`m${momentum}`}>
                <i>{'›'.repeat(momentum + 2)}</i><b>M{momentum} · MOTION STATE</b><i>{'›'.repeat(momentum + 2)}</i>
              </div>
            )}
            <div className="board-legend">
              <span><i className="trajectory" />Blue = Controlled Projection</span>
              <span><i className="momentum-axis" />Yellow = Axis / Coast Projection</span>
              <span>Move / Steer selected → click Cell = execute direction immediately</span>
              <span>Ready / Action end = exact Cell center</span>
            </div>
            {playback && <div className="playback-badge">1 Action · +1 AT · continuous transition → Cell center</div>}
          </div>

          <section className="action-hand">
            <div className="hand-heading">
              <div><h2>Ready Actions</h2><p>Move / Steer: select the action, hover to preview, then click a Cell to execute immediately. There is no separate Commit step.</p></div>
              <span>{actionId === 'coast' ? coastLabel : actionLabel}</span>
            </div>
            <div className="action-row trajectory-action-row">
              <button
                type="button"
                className={`action-card ${actionId === 'steer' ? 'selected' : ''}`}
                data-trajectory-action="steer"
                data-direct-input="cell-click"
                disabled={Boolean(playback)}
                onClick={() => {
                  setActionId('steer')
                  setSelectedHex(null)
                  setHoverHex(null)
                }}
              >
                <header><strong>{actionLabel}</strong><em>CONTROL</em></header>
                <p>{momentum > 0 ? 'Hover any Cell to preview its bearing, then click once to execute the 1AT Steering result. The Cell supplies direction, not a promised Destination.' : 'Hover any Cell to preview, then click once to Move. M0 freely establishes/re-writes Axis; Action end settles at the derived Cell center.'}</p>
                <span>{momentum > 0 ? '≤60° / Action · click = execute' : '1 Cell / AT · click = execute'}</span>
              </button>
              <button
                type="button"
                className={`action-card ${actionId === 'coast' ? 'selected' : ''}`}
                data-trajectory-action="coast"
                disabled={Boolean(playback)}
                onClick={commitCoast}
              >
                <header><strong>{coastLabel}</strong><em>PASSIVE</em></header>
                <p>{momentum > 0 ? 'No directional target is needed: clicking Coast executes the complete 1AT persistent-motion result immediately and settles at its derived Cell center.' : 'Wait executes immediately: advance 1 AT without active locomotion.'}</p>
                <span>click action = execute · unsustained M-1</span>
              </button>
            </div>
            <p className="trajectory-direct-input-note" data-direct-input-note>Move / Steer selected → hover previews → click Cell executes. No extra confirmation button.</p>
          </section>
        </section>

        <aside className="side-panel right-panel">
          <section className="panel-card spatial-ab-card">
            <div className="section-heading"><h3>Control Model A/B</h3><span>B active</span></div>
            <div className="ab-explain trajectory-ab">
              <button type="button" data-control-model="reachable-shape" onClick={switchToA}><b>A · Reachable Shape</b><span>Existing Inertia Driving Lab</span></button>
              <button type="button" className="chosen" data-control-model="process-steering"><b>B · Process Steering</b><span>Trajectory Lab</span></button>
            </div>
            <small>A remains untouched as the control group.</small>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Steering Response</h3><span>tunable, not rule</span></div>
            <div className="quick-grid">
              {RESPONSE_CURVES.map((curve) => (
                <button type="button" key={curve.id} data-response-curve={curve.id} className={responseCurve === curve.id ? 'active' : ''} disabled={Boolean(playback)} onClick={() => setResponseCurve(curve.id)}>{curve.label}</button>
              ))}
            </div>
            <p className="actor-sub">{RESPONSE_CURVES.find((entry) => entry.id === responseCurve)?.note}</p>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Test Presets</h3><span>debug</span></div>
            <div className="quick-grid trajectory-presets">
              <button type="button" disabled={Boolean(playback)} onClick={() => setPreset(0, null)}>NoAxis · M0</button>
              {[0, 1, 2, 3].map((level) => <button type="button" key={level} disabled={Boolean(playback)} onClick={() => setPreset(level, 'E')}>E · M{level}</button>)}
            </div>
            <label className="range-row">
              <span>Board Radius</span>
              <input data-trajectory-board-radius type="range" min={TRAJECTORY_MIN_RADIUS} max={TRAJECTORY_MAX_RADIUS} step="1" value={boardRadius} disabled={Boolean(playback)} onChange={(event) => changeRadius(Number(event.target.value))} />
              <output>{boardRadius}</output>
            </label>
          </section>

          <section className="panel-card timebase-card">
            <div className="section-heading"><h3>Playback</h3><span>visual only</span></div>
            <label className="range-row timebase-range">
              <span>Real time / AT</span>
              <input type="range" min="300" max="1400" step="50" value={atVisualMs} disabled={Boolean(playback)} onChange={(event) => setAtVisualMs(Number(event.target.value))} />
              <output>{(atVisualMs / 1000).toFixed(2)} s</output>
            </label>
            <small>1 Action remains exactly 1 logical AT. Only playback between authoritative Cell centers is continuous.</small>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>First Gate</h3><span>VAL-012-PS-AB</span></div>
            <dl className="state-list compact">
              <div><dt>Board authority</dt><dd>Cell centers</dd></div>
              <div><dt>Process</dt><dd>continuous inside 1AT</dd></div>
              <div><dt>Ready</dt><dd>Action complete / Cell center</dd></div>
              <div><dt>Steering</dt><dd>≤60° / Action</dd></div>
              <div><dt>Input</dt><dd>Cell click executes</dd></div>
              <div><dt>Wall / Strike</dt><dd>deferred</dd></div>
            </dl>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Isolation Contract</h3><span>trajectory v1</span></div>
            <p className="actor-sub">Trajectory rules live under <code>src/labs/trajectory/</code>. Continuous samples are transition/solver detail; Ready positions remain on the Hex board's discrete Cell centers. Reachable Shape A is not modified.</p>
          </section>
        </aside>
      </section>
    </main>
  )
}
