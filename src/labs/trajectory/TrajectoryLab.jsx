import { useEffect, useMemo, useRef, useState } from 'react'
import { Board3D } from '../../ui/Board3D.jsx'
import { axialKey, worldToAxial } from '../../sim/hex.js'
import { collisionObstaclesFromCells, createCellWorld } from '../../sim/world.js'
import { AT_VISUAL_MS } from '../../sim/solver.js'
import {
  TRAJECTORY_BASE_DISSIPATION,
  TRAJECTORY_CELL_AUTHORITY_RULE,
  TRAJECTORY_DEFAULT_RADIUS,
  TRAJECTORY_DISSIPATION_RULE,
  TRAJECTORY_MAX_RADIUS,
  TRAJECTORY_MIN_RADIUS,
  TRAJECTORY_PATH_RULE,
  TRAJECTORY_PREVIEW_RULE,
  TRAJECTORY_READY_RULE,
  TRAJECTORY_REFLECTION_RULE,
  TRAJECTORY_RULE,
  TRAJECTORY_STEERING_RULE,
  createTrajectoryTargets,
  makeTrajectoryState,
  resolveTrajectoryTargetContacts,
  trajectoryActionPlan,
  trajectoryCoastIntentMatches,
  trajectoryHeading,
  trajectoryMomentum,
  withCoastProjection,
} from './trajectory-rules.js'

const DIRECTION_ACTIONS = new Set(['steer', 'drive', 'heavy-drive'])

function actionTitle(actionId, momentum) {
  if (actionId === 'drive') return 'Drive'
  if (actionId === 'heavy-drive') return 'Heavy Drive'
  if (actionId === 'skip') return 'Skip'
  return momentum > 0 ? 'Steer' : 'Move'
}

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
    actorTrajectories: plan.actorTrajectories ?? {},
    actorPlaybackWindows: plan.actorPlaybackWindows ?? {},
    actorStates: plan.actorStates ?? [],
    playerPlaybackEnd: plan.playerPlaybackEnd ?? 1,
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
  const holdSamples = start
    ? [start, { ...start, t: 1, position: { ...start.position }, velocity: { ...start.velocity } }]
    : coastPlan.samples
  return {
    ...coastPlan,
    samples: holdSamples,
    actorTrajectories: { ...(coastPlan.actorTrajectories ?? {}), coastProjection: coastPlan.pathCells ?? [] },
    actorPlaybackWindows: coastPlan.actorPlaybackWindows ?? {},
    actorTrajectoryPolylineIds: [
      ...(coastPlan.actorTrajectoryPolylineIds ?? []),
      ...((coastPlan.reflectionCount ?? 0) > 0 ? ['coastProjection'] : []),
    ],
  }
}

export function TrajectoryLab() {
  const [state, setState] = useState(() => presetState(2))
  const [actionId, setActionId] = useState('steer')
  const [selectedHex, setSelectedHex] = useState(null)
  const [hoverHex, setHoverHex] = useState(null)
  const [responseCurve, setResponseCurve] = useState('linear')
  const [boardRadius, setBoardRadius] = useState(TRAJECTORY_DEFAULT_RADIUS)
  const [wallsEnabled, setWallsEnabled] = useState(true)
  const [targetsEnabled, setTargetsEnabled] = useState(true)
  const [actors, setActors] = useState(() => createTrajectoryTargets(TRAJECTORY_DEFAULT_RADIUS))
  const [viewMode, setViewMode] = useState('isometric')
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [atVisualMs, setAtVisualMs] = useState(AT_VISUAL_MS)
  const [playback, setPlayback] = useState(null)
  const [history, setHistory] = useState([])
  const [lastEvent, setLastEvent] = useState('E / M2 preset. Trajectory is Cell-center authoritative: hover a direction to preview the center-to-center polyline, then click once to execute.')
  const [lastPlan, setLastPlan] = useState(null)
  const playbackIdRef = useRef(1)

  const cells = useMemo(() => createCellWorld(boardRadius), [boardRadius])
  const obstacles = useMemo(() => wallsEnabled ? collisionObstaclesFromCells(cells).filter((entry) => entry.wallAxis) : [], [cells, wallsEnabled])
  const momentum = trajectoryMomentum(state)
  const currentHex = worldToAxial(state.position)
  const ready = !playback
  const directionalAction = DIRECTION_ACTIONS.has(actionId)
  const activeTitle = actionTitle(actionId, momentum)

  const skipPlan = useMemo(() => {
    const base = trajectoryActionPlan({
      state,
      actionId: 'skip',
      boardRadius,
      responseCurve,
      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,
      obstacles,
    })
    return targetsEnabled ? resolveTrajectoryTargetContacts(base, { actors, obstacles, boardRadius }) : base
  }, [state, boardRadius, responseCurve, obstacles, targetsEnabled, actors])

  const intentHex = directionalAction ? (hoverHex ?? selectedHex) : null
  const coastIntentAxis = intentHex && trajectoryCoastIntentMatches(skipPlan, intentHex) ? state.axisId : null
  const controlledPlan = useMemo(() => {
    if (!intentHex) return null
    const base = trajectoryActionPlan({
      state,
      actionId,
      selectedHex: intentHex,
      intentAxisId: coastIntentAxis,
      boardRadius,
      responseCurve,
      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,
      obstacles,
    })
    return targetsEnabled ? resolveTrajectoryTargetContacts(base, { actors, obstacles, boardRadius }) : base
  }, [state, actionId, intentHex?.q, intentHex?.r, coastIntentAxis, boardRadius, responseCurve, obstacles, targetsEnabled, actors])
  const previewPlan = useMemo(() => {
    if (controlledPlan?.valid) return withCoastProjection(controlledPlan, skipPlan)
    return projectionShell(skipPlan)
  }, [controlledPlan, skipPlan])

  const saveHistory = () => {
    setHistory((entries) => [...entries, {
      state: structuredClone(state),
      actionId,
      selectedHex: selectedHex ? { ...selectedHex } : null,
      responseCurve,
      boardRadius,
      wallsEnabled,
      targetsEnabled,
      actors: structuredClone(actors),
      lastEvent,
      lastPlan: lastPlan ? structuredClone(lastPlan) : null,
    }].slice(-60))
  }

  useEffect(() => {
    if (!playback) return undefined
    const remainingMs = Math.max(0, playback.durationMs - (performance.now() - playback.startedAt))
    const timer = window.setTimeout(() => {
      setState(playback.finalState)
      if (targetsEnabled) setActors(structuredClone(playback.actorStates ?? actors))
      setLastPlan(playback)
      setPlayback(null)
      setSelectedHex(null)
      setHoverHex(null)
      const nextM = trajectoryMomentum(playback.finalState)
      setLastEvent(`${playback.summary} · READY at Cell ${cellText(playback.finalHex)} center; predicted/actual Axis ${playback.finalState.axisId ?? 'none'}.`)
    }, remainingMs)
    return () => window.clearTimeout(timer)
  }, [playback?.id])

  const beginPlan = (plan) => {
    if (playback || !plan?.valid) return false
    saveHistory()
    setPlayback(playbackFromPlan(plan, playbackIdRef.current++, atVisualMs))
    setLastEvent(`${plan.summary} · resolving ${plan.travelSteps} center-to-center Cell segment${plan.travelSteps === 1 ? '' : 's'} inside this 1 AT.`)
    return true
  }

  const commitDirectional = (hex, forcedActionId = actionId) => {
    if (playback || !DIRECTION_ACTIONS.has(forcedActionId) || !hex) return false
    const intentAxisId = trajectoryCoastIntentMatches(skipPlan, hex) ? state.axisId : null
    const base = trajectoryActionPlan({
      state,
      actionId: forcedActionId,
      selectedHex: hex,
      intentAxisId,
      boardRadius,
      responseCurve,
      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,
      obstacles,
    })
    const plan = targetsEnabled ? resolveTrajectoryTargetContacts(base, { actors, obstacles, boardRadius }) : base
    if (!plan.valid) return false
    setSelectedHex({ ...hex })
    return beginPlan(plan)
  }

  const commitSkip = () => {
    if (playback) return false
    setActionId('skip')
    setHoverHex(null)
    setSelectedHex(null)
    return beginPlan(skipPlan)
  }

  const chooseDirectional = (nextActionId) => {
    if (playback) return false
    setActionId(nextActionId)
    setSelectedHex(null)
    setHoverHex(null)
    return true
  }

  const reset = () => {
    if (playback) return false
    setState(presetState(2))
    setActionId('steer')
    setSelectedHex(null)
    setHoverHex(null)
    setResponseCurve('linear')
    setBoardRadius(TRAJECTORY_DEFAULT_RADIUS)
    setWallsEnabled(true)
    setTargetsEnabled(true)
    setActors(createTrajectoryTargets(TRAJECTORY_DEFAULT_RADIUS))
    setHistory([])
    setLastPlan(null)
    setCameraResetToken((value) => value + 1)
    setLastEvent('E / M2 preset. Trajectory is Cell-center authoritative: hover a direction to preview the center-to-center polyline, then click once to execute.')
    return true
  }

  const setPreset = (level, axisId = 'E') => {
    if (playback) return false
    setState(level === 0 && !axisId ? noAxisState() : presetState(level, axisId))
    setActionId('steer')
    setSelectedHex(null)
    setHoverHex(null)
    setLastPlan(null)
    if (targetsEnabled) setActors(createTrajectoryTargets(boardRadius))
    setHistory([])
    setLastEvent(level === 0 && !axisId
      ? 'M0 / NoAxis: Move is fully six-directional; click any direction Cell to move one adjacent Cell and establish Axis.'
      : `Preset ${axisId ?? 'NoAxis'} / M${level} loaded at Cell center.`)
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
    if (targetsEnabled) setActors(createTrajectoryTargets(next))
    setHistory([])
    setCameraResetToken((value) => value + 1)
    setLastEvent(`Board Radius changed to ${next}. Scene reset to E / M2.`)
    return true
  }

  const undo = () => {
    if (playback || history.length === 0) return false
    const previous = history.at(-1)
    setHistory((entries) => entries.slice(0, -1))
    setState(previous.state)
    setActionId(previous.actionId ?? 'steer')
    setSelectedHex(previous.selectedHex)
    setResponseCurve(previous.responseCurve)
    setBoardRadius(previous.boardRadius)
    setWallsEnabled(previous.wallsEnabled ?? true)
    setTargetsEnabled(previous.targetsEnabled ?? true)
    setActors(structuredClone(previous.actors ?? createTrajectoryTargets(previous.boardRadius)))
    setLastEvent(previous.lastEvent)
    setLastPlan(previous.lastPlan)
    setHoverHex(null)
    return true
  }

  const toggleWalls = () => {
    if (playback) return false
    setWallsEnabled((value) => !value)
    setHoverHex(null)
    setSelectedHex(null)
    setLastPlan(null)
    return true
  }

  const toggleTargets = () => {
    if (playback) return false
    const next = !targetsEnabled
    setTargetsEnabled(next)
    setActors(next ? createTrajectoryTargets(boardRadius) : [])
    setHoverHex(null)
    setSelectedHex(null)
    setLastPlan(null)
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
        pathRule: TRAJECTORY_PATH_RULE,
        reflectionRule: TRAJECTORY_REFLECTION_RULE,
        wallsEnabled,
        targetsEnabled,
        targetCount: actors.length,
        steerInput: 'direct-cell-click',
        worldAt: state.worldAt,
        momentum,
        axisId: state.axisId,
        headingDeg: Number.isFinite(trajectoryHeading(state)) ? trajectoryHeading(state) * 180 / Math.PI : null,
        cell: currentHex,
        actionId,
        activeTitle,
        responseCurve,
        boardRadius,
        playback: Boolean(playback),
        skipFinal: skipPlan?.valid ? { cell: skipPlan.finalHex, axis: skipPlan.finalState.axisId, m: skipPlan.finalM } : null,
        controlledFinal: controlledPlan?.valid ? { cell: controlledPlan.finalHex, axis: controlledPlan.finalState.axisId, m: controlledPlan.finalM, path: controlledPlan.pathCells, reflections: controlledPlan.reflectionCount ?? 0 } : null,
      }),
      setPreset: (level) => setPreset(level, 'E'),
      setNoAxis: () => setPreset(0, null),
      setResponseCurve,
      setRadius: changeRadius,
      setWalls: (enabled) => { if (Boolean(enabled) !== wallsEnabled) return toggleWalls(); return true },
      setTargets: (enabled) => { if (Boolean(enabled) !== targetsEnabled) return toggleTargets(); return true },
      setAction: chooseDirectional,
      steerAt: (q, r) => commitDirectional({ q, r }, 'steer'),
      driveAt: (q, r) => commitDirectional({ q, r }, 'drive'),
      heavyDriveAt: (q, r) => commitDirectional({ q, r }, 'heavy-drive'),
      skip: commitSkip,
      reset,
    }
    return () => { delete window.__PROJECTC_TRAJECTORY__ }
  })

  const skipCell = skipPlan?.finalHex
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
      data-trajectory-path={TRAJECTORY_PATH_RULE}
      data-trajectory-preview={TRAJECTORY_PREVIEW_RULE}
      data-trajectory-reflection={TRAJECTORY_REFLECTION_RULE}
      data-walls={wallsEnabled ? 'on' : 'off'}
      data-targets={targetsEnabled ? 'on' : 'off'}
      data-steer-input="direct-cell-click"
      data-world-at={state.worldAt}
      data-momentum={momentum}
      data-axis={state.axisId ?? 'none'}
      data-ready={ready ? 'true' : 'false'}
      data-spatial-mode="discrete"
      data-board-radius={boardRadius}
      data-response-curve={responseCurve}
      data-active-action={actionId}
    >
      <header className="prototype-header">
        <div className="brand"><p>ProjectC · VAL-012 Process Steering A/B</p><h1>Trajectory Lab</h1></div>
        <div className="headline-state">
          <div><span>World Time</span><strong>{state.worldAt.toFixed(1)} AT</strong></div>
          <div><span>Momentum</span><strong>M{momentum}</strong></div>
          <div><span>Axis</span><strong>{state.axisId ?? 'none'}</strong></div>
          <div><span>State</span><strong>{playback ? 'RESOLVING' : 'READY'}</strong></div>
          <div><span>Action</span><strong>{activeTitle}</strong></div>
        </div>
      </header>

      <section className="lab-grid">
        <aside className="side-panel left-panel">
          <section className="panel-card actor-card">
            <div className="portrait">➤</div>
            <div><p>Persistent Motion Actor</p><h2>Courier / PS</h2><span className="actor-sub">Cells define rule occupancy · one global curve defines visual motion</span></div>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Current State</h3><span>B candidate</span></div>
            <dl className="state-list">
              <div><dt>Cell</dt><dd>{cellText(currentHex)}</dd></div>
              <div><dt>Horizontal M</dt><dd>M{momentum}</dd></div>
              <div><dt>Axis</dt><dd>{state.axisId ?? 'none'}</dd></div>
              <div><dt>Ready</dt><dd>{ready ? 'CELL CENTER' : 'resolving'}</dd></div>
              <div><dt>World AT</dt><dd>{state.worldAt.toFixed(1)}</dd></div>
              <div><dt>Action</dt><dd>{activeTitle}</dd></div>
            </dl>
          </section>

          <section className="panel-card prediction-card" data-trajectory-preview-panel>
            <div className="section-heading"><h3>Projection</h3><span>global tangent curve</span></div>
            <div className="projection-pair">
              <div className="projection-entry coast">
                <b>SKIP / COAST</b>
                <span>Cell {cellText(skipCell)}</span>
                <span>{skipPlan?.finalState.axisId ?? 'none'} · M{skipPlan?.finalM ?? momentum}</span>
              </div>
              <div className={`projection-entry controlled ${controlledPlan?.valid ? 'active' : ''}`}>
                <b>{actionId === 'drive' ? 'DRIVE' : actionId === 'heavy-drive' ? 'HEAVY DRIVE' : 'CONTROLLED'}</b>
                <span>Cell {cellText(controlledCell)}</span>
                <span>{controlledPlan?.valid ? `${controlledPlan.finalState.axisId ?? 'none'} · M${controlledPlan.finalM}` : (directionalAction ? 'hover a Cell' : 'select a directional action')}</span>
              </div>
            </div>
            {controlledPlan?.valid && (
              <dl className="state-list compact">
                <div><dt>Target Δ</dt><dd>{degreesText(controlledPlan.targetDeltaDeg)}</dd></div>
                <div><dt>Steering</dt><dd>{degreesText(controlledPlan.steeringAppliedDeg)}</dd></div>
                <div><dt>Build</dt><dd>{controlledPlan.buildM ? `+${controlledPlan.buildM}M` : 'none'}</dd></div>
                <div><dt>Cell Path</dt><dd>{controlledPlan.pathCells.map(cellText).join(' → ')}</dd></div>
                <div><dt>Ready Axis</dt><dd>{controlledPlan.finalState.axisId ?? 'none'}</dd></div>
              </dl>
            )}
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Previous Motion</h3><span>history</span></div>
            <p className="actor-sub">{lastPlan ? `${lastPlan.kind.toUpperCase()} · ${Math.max(0, lastCrossings.length - 1)} Cell segments · ${lastPlan.pathCells.map(cellText).join(' → ')} · Ready Axis ${lastPlan.finalState.axisId ?? 'none'}.` : 'No committed B Action yet.'}</p>
          </section>
        </aside>

        <section className="center-column">
          <div className={`trajectory-status ${ready ? 'is-ready' : 'is-resolving'}`}>
            <strong>{ready ? `READY · CELL ${cellText(currentHex)} · M${momentum} · ${state.axisId ?? 'NO AXIS'}` : `ACTION IN FLIGHT · ${activeTitle.toUpperCase()}`}</strong>
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
              actors={actors}
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
              showDebugCollisionFx={true}
              onHoverHex={(hex) => {
                if (playback || !directionalAction) return setHoverHex(null)
                if (!hex || axialKey(hex) === axialKey(currentHex)) return setHoverHex(null)
                setHoverHex(hex)
              }}
              onClickHex={(hex) => {
                if (playback || !directionalAction || !hex || axialKey(hex) === axialKey(currentHex)) return
                setSelectedHex({ ...hex })
                setHoverHex(null)
                commitDirectional(hex)
              }}
            />
            <div className="trajectory-vector-compass" data-steering-vector={controlledPlan?.valid ? 'visible' : 'hidden'}>
              <div className="vector-row yellow"><i>➜</i><span>Yellow · Skip/Coast baseline{(skipPlan?.reflectionCount ?? 0) > 0 ? ' · reflected Cells selectable as forward intent' : ''}</span></div>
              <div className="vector-row blue"><i>➜</i><span>Blue · {controlledPlan?.valid ? `${activeTitle} intent ${degreesText(controlledPlan.targetDeltaDeg)}` : (directionalAction ? 'hover Cell to preview' : 'select Move / Drive first')}</span></div>
            </div>
            {ready && momentum > 0 && (
              <div className="motion-freeze-badge" data-motion-freeze={`m${momentum}`}>
                <i>{'›'.repeat(momentum + 2)}</i><b>M{momentum} · MOTION STATE</b><i>{'›'.repeat(momentum + 2)}</i>
              </div>
            )}
            <div className="board-legend">
              <span><i className="trajectory" />Blue = one global visual curve</span>
              <span><i className="momentum-axis" />Yellow = discrete Skip/Coast Cell authority</span>
              <span>Blue is not clamped to Cell centers or Cell borders</span>
              <span>Wall contact is a real geometric breakpoint; final stub shows Ready Axis</span>
            </div>
            {playback && <div className="playback-badge">1 Action · +1 AT · continuous visual curve over discrete Travel</div>}
          </div>

          <section className="action-hand">
            <div className="hand-heading">
              <div><h2>Ready Actions</h2><p>Select action → hover → click Cell. Skip executes directly.</p></div>
              <span>{activeTitle}</span>
            </div>
            <div className="action-row trajectory-action-row" data-action-layout="driving-row">
              <button type="button" className={`action-card ${actionId === 'steer' ? 'selected' : ''}`} data-trajectory-action="steer" data-direct-input="cell-click" disabled={Boolean(playback)} onClick={() => chooseDirectional('steer')}>
                <header><strong>{momentum > 0 ? 'Steer' : 'Move'}</strong><em>CONTROL</em></header>
                <p>{momentum > 0 ? 'No extra M. Apply up to 60° total Steering while the Action traverses its M Cell-center path; unsustained M dissipates at Action end.' : 'Fully six-directional at M0. Move exactly one adjacent Cell center and freely establish/rewrite Axis; a compatible second Move can establish M1.'}</p>
                <span>{momentum > 0 ? '≤60° / Action · M-1' : 'all 6 directions · 1 Cell'}</span>
              </button>

              <button type="button" className={`action-card ${actionId === 'drive' ? 'selected' : ''}`} data-trajectory-action="drive" data-direct-input="cell-click" disabled={Boolean(playback)} onClick={() => chooseDirectional('drive')}>
                <header><strong>Drive</strong><em>BUILD</em></header>
                <p>+1M · sustain · same Steering rules.</p>
                <span>+1M · sustain · targeted</span>
              </button>

              <button type="button" className={`action-card ${actionId === 'heavy-drive' ? 'selected' : ''}`} data-trajectory-action="heavy-drive" data-direct-input="cell-click" disabled={Boolean(playback)} onClick={() => chooseDirectional('heavy-drive')}>
                <header><strong>Heavy Drive</strong><em>BUILD+</em></header>
                <p>+2M · sustain · cap M3.</p>
                <span>+2M · cap M3 · targeted</span>
              </button>

              <button type="button" className={`action-card ${actionId === 'skip' ? 'selected' : ''}`} data-trajectory-action="skip" disabled={Boolean(playback)} onClick={commitSkip}>
                <header><strong>Skip</strong><em>{momentum > 0 ? 'COAST' : 'WAIT'}</em></header>
                <p>{momentum > 0 ? 'Coast · no Steering · M-1.' : 'Spend 1 AT · stay in place.'}</p>
                <span>+1 AT · no Steering · M-1 if M&gt;0</span>
              </button>
            </div>
            <p className="trajectory-direct-input-note" data-direct-input-note>Move / Steer / Drive / Heavy Drive → hover previews → click Cell executes. Skip executes directly.</p>
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
            <div className="section-heading"><h3>Test Presets</h3><span>debug</span></div>
            <div className="quick-grid trajectory-presets">
              <button type="button" disabled={Boolean(playback)} onClick={() => setPreset(0, null)}>NoAxis · M0</button>
              {[0, 1, 2, 3].map((level) => <button type="button" key={level} disabled={Boolean(playback)} onClick={() => setPreset(level, 'E')}>E · M{level}</button>)}
            </div>
            <button type="button" data-trajectory-walls className={wallsEnabled ? 'active wide-button' : 'wide-button'} disabled={Boolean(playback)} onClick={toggleWalls}>Walls · {wallsEnabled ? 'ON' : 'OFF'}</button>
            <button type="button" data-trajectory-targets className={targetsEnabled ? 'active wide-button' : 'wide-button'} disabled={Boolean(playback)} onClick={toggleTargets}>Targets · {targetsEnabled ? `ON · ${actors.length}` : 'OFF'}</button>
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
            <small>1 Action remains exactly 1 logical AT. Cell route is logical authority; the actor follows the authored global curve until a reflection breakpoint.</small>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Current Gate</h3><span>VAL-012-PS-AB</span></div>
            <dl className="state-list compact">
              <div><dt>Path authority</dt><dd>discrete Cell route</dd></div>
              <div><dt>M0 Move</dt><dd>free Hex6</dd></div>
              <div><dt>Steering</dt><dd>≤60° / Action</dd></div>
              <div><dt>Speed Band</dt><dd>M1/2/3 = 1/2/3 Cell</dd></div>
              <div><dt>Drive test</dt><dd>+1M sustain</dd></div>
              <div><dt>Heavy test</dt><dd>+2M sustain</dd></div>
              <div><dt>Wall reflection</dt><dd>Driving v1</dd></div>
              <div><dt>Coast intent</dt><dd>reflected path selectable</dd></div>
              <div><dt>Target Contact</dt><dd>existing Strike / Forced Move</dd></div>
            </dl>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Isolation Contract</h3><span>trajectory v1</span></div>
            <p className="actor-sub">Rules stay under <code>src/labs/trajectory/</code>. Drive / Heavy Drive are test candidates, not newly frozen design law. Reachable Shape A remains unchanged.</p>
          </section>
        </aside>
      </section>
    </main>
  )
}
