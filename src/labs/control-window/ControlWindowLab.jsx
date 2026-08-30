import { useEffect, useMemo, useRef, useState } from 'react'
import { Board3D } from '../../ui/Board3D.jsx'
import { HEX_DIRECTIONS, axialKey, directionIdBetween, worldToAxial } from '../../sim/hex.js'
import { collisionObstaclesFromCells, createCellWorld } from '../../sim/world.js'
import { AT_VISUAL_MS } from '../../sim/solver.js'
import {
  CONTROL_WINDOW_COLLISION_RULE,
  CONTROL_WINDOW_COMPOSITION,
  CONTROL_WINDOW_DEFAULT_THRESHOLD,
  CONTROL_WINDOW_RULE,
  CONTROL_WINDOW_TIMEBASE,
  CONTROL_WINDOW_WANDER_RULE,
  actionPlan,
  controlWindowChoices,
  createControlWindowEnemies,
  localInterventionPlan,
  makeControlWindowState,
  persistentToWindowPlan,
  stateMomentum,
} from './control-window-rules.js'

const BOARD_RADIUS = 6
const INITIAL_WANDER_SEED = 17
const ACTIONS = [
  {
    id: 'move',
    label: 'Move',
    tag: 'BASE',
    description: 'Inject M1 through Hex Lookup. The active step moves 1 Cell and normally Uses 1M; any unresolved M above the Control threshold then auto-resolves inside the same 1 AT packet.',
  },
  {
    id: 'drive',
    label: 'Drive',
    tag: 'DRIVE',
    description: 'Inject M1 through Hex Lookup. Drive moves its active 1 Cell without spending the composed M; remaining M above the Control threshold auto-resolves inside the same 1 AT packet.',
  },
]

function directionCells(hex) {
  return HEX_DIRECTIONS.map((entry) => ({
    hex: { q: hex.q + entry.q, r: hex.r + entry.r },
    id: entry.id,
    rule: 'control-vector-direction',
  }))
}

function actorCellList(actors = []) {
  return actors.map((actor) => `${actor.label ?? actor.id}: ${actor.hex.q},${actor.hex.r} · M${actor.momentumLevel ?? 0} / ${actor.axisId ?? 'none'}`).join(' · ')
}

function playbackFromPlan(plan, id, durationMs) {
  return {
    id,
    startedAt: performance.now(),
    pausedAt: null,
    pausedTotal: 0,
    durationMs,
    samples: plan.samples,
    collisions: plan.collisions ?? [],
    finalState: plan.finalState,
    summary: plan.summary,
    spatialMode: 'discrete',
    destinationDriven: true,
    actorTrajectories: plan.actorTrajectories ?? {},
    actorPlaybackWindows: plan.actorPlaybackWindows ?? {},
    actorStates: plan.actorStates ?? [],
    playerPlaybackEnd: plan.playerPlaybackEnd ?? 1,
    conflictEvents: plan.conflictEvents ?? [],
    controlWindowPlanKind: plan.kind,
    atCost: plan.atCost,
    wanderSeedAfter: plan.wanderSeedAfter,
    cellConflict: plan.cellConflict ?? null,
  }
}

function initialState(momentum = 3) {
  return makeControlWindowState({ hex: { q: 0, r: 0 }, axisId: 'E', momentum, worldAt: 0 })
}

export function ControlWindowLab() {
  const [state, setState] = useState(() => initialState(3))
  const [actors, setActors] = useState(() => createControlWindowEnemies())
  const [threshold, setThreshold] = useState(CONTROL_WINDOW_DEFAULT_THRESHOLD)
  const [actionId, setActionId] = useState('move')
  const [windowOpen, setWindowOpen] = useState(false)
  const [wanderEnabled, setWanderEnabled] = useState(true)
  const [wanderSeed, setWanderSeed] = useState(INITIAL_WANDER_SEED)
  const [hoverHex, setHoverHex] = useState(null)
  const [selectedAimHex, setSelectedAimHex] = useState(null)
  const [playback, setPlayback] = useState(null)
  const [history, setHistory] = useState([])
  const [lastEvent, setLastEvent] = useState('Preset M3/E loaded. Resolve 1 AT to reach the first Control Window.')
  const [viewMode, setViewMode] = useState('isometric')
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [atVisualMs, setAtVisualMs] = useState(AT_VISUAL_MS)
  const playbackIdRef = useRef(1)
  const completionRef = useRef(null)

  const cells = useMemo(() => createCellWorld(BOARD_RADIUS), [])
  const obstacles = useMemo(() => collisionObstaclesFromCells(cells), [cells])
  const momentum = stateMomentum(state)
  const currentHex = worldToAxial(state.position)
  const phase = playback ? 'RESOLVING' : windowOpen ? (momentum === 0 ? 'READY' : 'CONTROL WINDOW') : 'PERSISTENT'
  const reachableCells = useMemo(() => windowOpen && !playback ? directionCells(currentHex) : [], [windowOpen, playback, currentHex.q, currentHex.r])
  const reachableKeys = useMemo(() => new Set(reachableCells.map((entry) => axialKey(entry.hex))), [reachableCells])

  const previewPlan = useMemo(() => {
    if (!windowOpen || playback || !hoverHex || !reachableKeys.has(axialKey(hoverHex))) return null
    const aimAxis = directionIdBetween(currentHex, hoverHex)
    if (!aimAxis) return null
    return actionPlan({
      state,
      actionId,
      aimAxis,
      threshold,
      obstacles,
      actors,
      boardRadius: BOARD_RADIUS,
      wanderEnabled: false,
      wanderSeed,
    })
  }, [windowOpen, playback, hoverHex, reachableKeys, currentHex.q, currentHex.r, state, actionId, threshold, obstacles, actors, wanderSeed])

  const saveHistory = () => {
    setHistory((entries) => [...entries, {
      state: structuredClone(state),
      actors: structuredClone(actors),
      threshold,
      actionId,
      windowOpen,
      wanderEnabled,
      wanderSeed,
      lastEvent,
    }].slice(-50))
  }

  const beginPlayback = (plan, onComplete, durationMs = atVisualMs) => {
    if (!plan?.valid || playback) return false
    completionRef.current = onComplete ?? null
    setHoverHex(null)
    setSelectedAimHex(null)
    setPlayback(playbackFromPlan(plan, playbackIdRef.current++, durationMs))
    setLastEvent(plan.summary)
    return true
  }

  const openAtState = (nextState) => {
    setWindowOpen(true)
    setLastEvent(stateMomentum(nextState) === 0
      ? 'M0 reached. Actor is Ready; Axis remains established.'
      : `Control Window open at M${stateMomentum(nextState)} / ${nextState.axisId ?? 'none'}.`)
  }

  useEffect(() => {
    if (!playback) return undefined
    const remainingMs = Math.max(0, playback.durationMs - (performance.now() - playback.startedAt))
    const timer = window.setTimeout(() => {
      const finalState = playback.finalState
      const finalActors = playback.actorStates ?? finalState?.actors ?? actors
      const completion = completionRef.current
      completionRef.current = null
      setState(finalState)
      setActors(finalActors)
      if (Number.isFinite(playback.wanderSeedAfter)) setWanderSeed(playback.wanderSeedAfter)
      setPlayback(null)
      if (completion) window.setTimeout(() => completion(finalState), 0)
    }, remainingMs)
    return () => window.clearTimeout(timer)
  }, [playback?.id])

  const runPersistent = () => {
    if (playback) return false
    const plan = persistentToWindowPlan({
      state,
      threshold,
      obstacles,
      actors,
      boardRadius: BOARD_RADIUS,
      wanderEnabled,
      wanderSeed,
    })
    if (plan.atCost === 0) {
      openAtState(state)
      return true
    }
    saveHistory()
    setWindowOpen(false)
    return beginPlayback(plan, (resolved) => openAtState(resolved))
  }

  const chooseIntervention = (targetM) => {
    if (!windowOpen || playback || targetM > momentum || targetM < 0) return false
    if (targetM === momentum) {
      setLastEvent(`Intervention point held at M${momentum}; world remains frozen at ${state.worldAt.toFixed(1)} AT.`)
      return true
    }
    saveHistory()
    const plan = localInterventionPlan({
      state,
      targetM,
      threshold,
      obstacles,
      actors,
      boardRadius: BOARD_RADIUS,
      wanderSeed,
    })
    return beginPlayback(plan, (resolved) => openAtState(resolved), Math.max(260, atVisualMs * 0.62))
  }

  const noIntervention = () => {
    if (!windowOpen || playback) return false
    if (momentum <= 0) return true
    saveHistory()
    const plan = localInterventionPlan({
      state,
      targetM: 0,
      threshold,
      obstacles,
      actors,
      boardRadius: BOARD_RADIUS,
      wanderSeed,
    })
    return beginPlayback(plan, (resolved) => {
      setWindowOpen(true)
      setLastEvent(plan.cellConflict
        ? `No intervention was preempted by Contact with ${plan.cellConflict.targetActorId}.`
        : `No intervention · unresolved M completed locally to M${stateMomentum(resolved)} · world still ${resolved.worldAt.toFixed(1)} AT.`)
    }, Math.max(300, atVisualMs * 0.72))
  }

  const executeAction = (hex) => {
    if (!windowOpen || playback || !hex || !reachableKeys.has(axialKey(hex))) return false
    const aimAxis = directionIdBetween(currentHex, hex)
    if (!aimAxis) return false
    const plan = actionPlan({
      state,
      actionId,
      aimAxis,
      threshold,
      obstacles,
      actors,
      boardRadius: BOARD_RADIUS,
      wanderEnabled,
      wanderSeed,
    })
    if (!plan.valid) return false
    saveHistory()
    setSelectedAimHex({ ...hex })
    setWindowOpen(false)
    return beginPlayback(plan, (resolved) => openAtState(resolved))
  }

  const setPreset = (level) => {
    if (playback) return false
    const next = initialState(level)
    setState(next)
    setHistory([])
    setHoverHex(null)
    setSelectedAimHex(null)
    setWindowOpen(level <= threshold)
    setLastEvent(level <= threshold
      ? `Preset M${level}/E loaded inside current Control threshold.`
      : `Preset M${level}/E loaded. Resolve 1 AT to reach Control threshold M${threshold}.`)
    return true
  }

  const changeThreshold = (level) => {
    if (playback || ![1, 2].includes(level)) return false
    setThreshold(level)
    setWindowOpen(momentum <= level)
    setLastEvent(`Control capability changed: intervene at M≤${level}.`)
    return true
  }

  const resetEnemies = () => {
    if (playback) return false
    saveHistory()
    setActors(createControlWindowEnemies())
    setWanderSeed(INITIAL_WANDER_SEED)
    setLastEvent('Two wandering targets reset to their test positions.')
    return true
  }

  const undo = () => {
    if (playback || history.length === 0) return false
    const previous = history.at(-1)
    setHistory((entries) => entries.slice(0, -1))
    setState(previous.state)
    setActors(previous.actors)
    setThreshold(previous.threshold)
    setActionId(previous.actionId)
    setWindowOpen(previous.windowOpen)
    setWanderEnabled(previous.wanderEnabled)
    setWanderSeed(previous.wanderSeed)
    setLastEvent(previous.lastEvent)
    setHoverHex(null)
    setSelectedAimHex(null)
    return true
  }

  const reset = () => {
    if (playback) return false
    setState(initialState(3))
    setActors(createControlWindowEnemies())
    setThreshold(1)
    setActionId('move')
    setWindowOpen(false)
    setWanderEnabled(true)
    setWanderSeed(INITIAL_WANDER_SEED)
    setHistory([])
    setHoverHex(null)
    setSelectedAimHex(null)
    setLastEvent('Preset M3/E loaded. Resolve 1 AT to reach the first Control Window.')
    return true
  }

  useEffect(() => {
    window.__PROJECTC_CONTROL_WINDOW__ = {
      snapshot: () => ({
        implementation: CONTROL_WINDOW_RULE,
        worldAt: state.worldAt,
        momentum,
        axisId: state.axisId,
        phase,
        threshold,
        actionId,
        windowOpen,
        wanderEnabled,
        enemyCount: actors.length,
        wallCount: obstacles.length,
        actors: structuredClone(actors),
        hex: worldToAxial(state.position),
        playback: Boolean(playback),
        lastConflict: playback?.cellConflict ?? null,
      }),
      setPreset,
      setThreshold: changeThreshold,
      runPersistent,
      chooseIntervention,
      setAction: (id) => {
        if (playback || !ACTIONS.some((entry) => entry.id === id)) return false
        setActionId(id)
        return true
      },
      setWander: (value) => {
        if (playback) return false
        setWanderEnabled(Boolean(value))
        return true
      },
      resetEnemies,
      fireAt: (q, r) => executeAction({ q, r }),
      reset,
    }
    return () => { delete window.__PROJECTC_CONTROL_WINDOW__ }
  })

  const choices = windowOpen ? controlWindowChoices(momentum) : []
  const action = ACTIONS.find((entry) => entry.id === actionId) ?? ACTIONS[0]

  return (
    <main
      className="cell-world-prototype control-window-lab"
      data-implementation={CONTROL_WINDOW_RULE}
      data-control-window-composition={CONTROL_WINDOW_COMPOSITION}
      data-control-window-timebase={CONTROL_WINDOW_TIMEBASE}
      data-control-window-collision={CONTROL_WINDOW_COLLISION_RULE}
      data-control-window-wander={CONTROL_WINDOW_WANDER_RULE}
      data-control-threshold={`M${threshold}`}
      data-world-at={state.worldAt}
      data-momentum={momentum}
      data-axis={state.axisId ?? 'none'}
      data-phase={phase}
      data-playing={Boolean(playback)}
      data-spatial-mode="discrete"
      data-cw-enemy-count={actors.length}
      data-cw-wall-count={obstacles.length}
      data-cw-wander={wanderEnabled ? 'on' : 'off'}
    >
      <header className="prototype-header">
        <div className="brand">
          <p>ProjectC · isolated candidate</p>
          <h1>Control Window Lab</h1>
        </div>
        <div className="headline-state">
          <div><span>World Time</span><strong>{state.worldAt.toFixed(1)} AT</strong></div>
          <div><span>Momentum</span><strong>M{momentum}</strong></div>
          <div><span>Axis</span><strong>{state.axisId ?? 'none'}</strong></div>
          <div><span>Phase</span><strong>{phase}</strong></div>
          <div><span>Control</span><strong>M≤{threshold}</strong></div>
        </div>
      </header>

      <section className="lab-grid">
        <aside className="side-panel left-panel">
          <section className="panel-card actor-card">
            <div className="portrait">⬡</div>
            <div><p>Motion Commitment Actor</p><h2>Courier / CW</h2><span className="actor-sub">isolated from Spatial Inertia v1</span></div>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Current Contract</h3><span>candidate v2</span></div>
            <dl className="state-list">
              <div><dt>Cell</dt><dd>{currentHex.q},{currentHex.r}</dd></div>
              <div><dt>Horizontal M</dt><dd>M{momentum}</dd></div>
              <div><dt>Axis</dt><dd>{state.axisId ?? 'none'}</dd></div>
              <div><dt>World AT</dt><dd>{state.worldAt.toFixed(1)}</dd></div>
              <div><dt>Window</dt><dd>{windowOpen ? 'OPEN' : 'closed'}</dd></div>
              <div><dt>Threshold</dt><dd>M≤{threshold}</dd></div>
            </dl>
          </section>

          <section className="panel-card prediction-card">
            <div className="section-heading"><h3>Predicted Action</h3><span>{action.label}</span></div>
            <p>{previewPlan?.summary ?? (windowOpen ? 'Hover one of the six bright direction Cells.' : 'Resolve Persistent Motion to a Control Window first.')}</p>
            {previewPlan && (
              <dl className="state-list compact">
                <div><dt>Hex Lookup</dt><dd>M{previewPlan.beforeM}+M1 → M{previewPlan.effectiveM}</dd></div>
                <div><dt>Axis</dt><dd>{previewPlan.axisBefore ?? 'none'} → {previewPlan.axisAfter ?? 'none'}</dd></div>
                <div><dt>Active / Auto</dt><dd>{previewPlan.activeSteps ?? 0} / {previewPlan.autoSteps ?? 0} Cell</dd></div>
                <div><dt>Resolved Travel</dt><dd>{previewPlan.travelSteps} Cell / 1 AT</dd></div>
                <div><dt>Residual</dt><dd>M{previewPlan.finalM}</dd></div>
                <div><dt>Wall</dt><dd>{previewPlan.collisions?.length ? `${previewPlan.collisions.length} reflection/contact` : '—'}</dd></div>
                <div><dt>Contact</dt><dd>{previewPlan.cellConflict ? `${previewPlan.cellConflict.targetActorId} · impact M${previewPlan.cellConflict.impactM}` : '—'}</dd></div>
              </dl>
            )}
          </section>
        </aside>

        <section className="center-column">
          <div className={`control-window-status ${windowOpen ? 'is-open' : ''}`}>
            <strong>{windowOpen ? (momentum > 0 ? `CONTROL WINDOW · M${momentum}` : 'READY · M0') : `PERSISTENT MOTION · M${momentum}`}</strong>
            <span>{lastEvent}</span>
          </div>

          <div className="board-toolbar">
            <div className="view-switch" role="group" aria-label="Control Window view">
              <button type="button" className={viewMode === 'isometric' ? 'active' : ''} onClick={() => setViewMode('isometric')}>3D</button>
              <button type="button" className={viewMode === 'top' ? 'active' : ''} onClick={() => setViewMode('top')}>Top</button>
              <button type="button" onClick={() => setCameraResetToken((value) => value + 1)}>Reset View</button>
            </div>
            <div className="session-buttons">
              <button type="button" disabled={history.length === 0 || Boolean(playback)} onClick={undo}>Undo</button>
              <button type="button" disabled={Boolean(playback)} onClick={reset}>Reset</button>
            </div>
          </div>

          <div className={`board-frame ${playback ? 'playing' : ''}`}>
            <Board3D
              cells={cells}
              obstacles={obstacles}
              actors={actors}
              reachableCells={reachableCells}
              state={state}
              previewPlan={previewPlan}
              playback={playback}
              atVisualMs={atVisualMs}
              axisDisplayOverride="auto"
              boardRadius={BOARD_RADIUS}
              viewMode={viewMode}
              cameraResetToken={cameraResetToken}
              hoverHex={hoverHex}
              selectedAimHex={selectedAimHex}
              showWeather={false}
              showThermal={false}
              onHoverHex={(hex) => {
                if (playback || !windowOpen || (hex && !reachableKeys.has(axialKey(hex)))) return setHoverHex(null)
                setHoverHex(hex)
              }}
              onClickHex={executeAction}
            />
            <div className="board-legend">
              <span><i className="trajectory" />Blue route = Action + auto motion packet</span>
              <span><i className="terrain" />Bright Cells = six Control-vector directions</span>
              <span><i className="momentum-axis" />Yellow Axis / purple M = player + targets</span>
              <span>Walls reflect unresolved motion</span>
            </div>
            {playback && <div className="playback-badge">{playback.controlWindowPlanKind} · +{playback.atCost} AT · {(playback.durationMs / 1000).toFixed(2)} s</div>}
          </div>

          <section className="action-hand">
            <div className="hand-heading">
              <div><h2>Control Actions</h2><p>Both cards inject M1 through Hex Lookup. The card profile decides what the active step does before unresolved motion auto-resolves to the next Window.</p></div>
              <span>{action.label}</span>
            </div>
            <div className="action-row cw-action-row">
              {ACTIONS.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className={`action-card ${entry.id === actionId ? 'selected' : ''}`}
                  data-cw-action={entry.id}
                  disabled={Boolean(playback) || !windowOpen}
                  onClick={() => { setActionId(entry.id); setHoverHex(null) }}
                >
                  <header><strong>{entry.label}</strong><em>{entry.tag}</em></header>
                  <p>{entry.description}</p>
                  <span>{entry.id === 'move' ? 'Active Travel 1 · Use 1M · 1 AT packet' : 'Active Travel 1 · preserve composed M · 1 AT packet'}</span>
                </button>
              ))}
            </div>
          </section>
        </section>

        <aside className="side-panel right-panel">
          <section className={`panel-card control-window-card ${windowOpen ? 'is-open' : ''}`} data-control-window-panel>
            <div className="section-heading"><h3>Control Window</h3><span>{windowOpen ? 'OPEN' : 'waiting'}</span></div>
            {windowOpen ? (
              <>
                <p className="actor-sub">Choose the actual intervention point while World Time stays frozen. Reaching a later point resolves only this Actor and costs +0 AT; Wall / Contact can preempt the chosen point.</p>
                <div className="cw-intervention-grid">
                  {choices.map((level) => (
                    <button type="button" key={level} data-intervention-m={level} disabled={Boolean(playback)} onClick={() => chooseIntervention(level)}>
                      {level === momentum ? `M${level} · NOW` : `M${level}`}
                    </button>
                  ))}
                </div>
                <button type="button" className="wide-button" disabled={Boolean(playback) || momentum === 0} onClick={noIntervention}>No Intervention → resolve toward M0</button>
              </>
            ) : (
              <button type="button" className="active wide-button" disabled={Boolean(playback)} data-run-persistent onClick={runPersistent}>
                Resolve to Window · 1 AT
              </button>
            )}
          </section>

          <section className="panel-card spatial-ab-card">
            <div className="section-heading"><h3>Control Capability</h3><span>A/B</span></div>
            <div className="ab-explain">
              <button type="button" data-control-threshold="1" className={threshold === 1 ? 'chosen' : ''} disabled={Boolean(playback)} onClick={() => changeThreshold(1)}><b>M≤1</b><span>Default: M3 resolves two passive Cells before the first Window</span></button>
              <button type="button" data-control-threshold="2" className={threshold === 2 ? 'chosen' : ''} disabled={Boolean(playback)} onClick={() => changeThreshold(2)}><b>M≤2</b><span>Enhanced Control: M3 resolves one passive Cell before the first Window</span></button>
            </div>
          </section>

          <section className="panel-card" data-cw-enemy-panel>
            <div className="section-heading"><h3>Wandering Targets</h3><span>{wanderEnabled ? 'LIVE' : 'FROZEN'}</span></div>
            <p className="actor-sub">Two targets take one deterministic-random adjacent step whenever World Time advances by 1 AT. Window-local +0 AT motion does not move them. Targets struck this AT skip their wander step.</p>
            <p className="cw-enemy-readout">{actorCellList(actors)}</p>
            <div className="quick-grid">
              <button type="button" className={wanderEnabled ? 'active' : ''} disabled={Boolean(playback)} onClick={() => setWanderEnabled((value) => !value)}>Wander {wanderEnabled ? 'ON' : 'OFF'}</button>
              <button type="button" disabled={Boolean(playback)} onClick={resetEnemies}>Reset Targets</button>
            </div>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Quick M / Axis</h3><span>debug</span></div>
            <div className="quick-grid">
              {[0, 1, 2, 3].map((level) => <button type="button" key={level} disabled={Boolean(playback)} onClick={() => setPreset(level)}>E · M{level}</button>)}
            </div>
          </section>

          <section className="panel-card timebase-card">
            <div className="section-heading"><h3>Playback</h3><span>visual only</span></div>
            <label className="range-row timebase-range">
              <span>Real time / AT</span>
              <input type="range" min="300" max="1200" step="50" value={atVisualMs} disabled={Boolean(playback)} onChange={(event) => setAtVisualMs(Number(event.target.value))} />
              <strong>{(atVisualMs / 1000).toFixed(2)}s</strong>
            </label>
            <small>Control Window timing is logical, not QTE timing. Window-local motion explicitly costs +0 World AT.</small>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Isolation Contract</h3><span>safe to delete</span></div>
            <p className="actor-sub">This lab owns its action packet, wall/contact integration, target wander, and rule file. Existing Spatial Inertia v1 authority is not modified.</p>
            <dl className="state-list compact">
              <div><dt>Rule</dt><dd>{CONTROL_WINDOW_RULE}</dd></div>
              <div><dt>Composition</dt><dd>{CONTROL_WINDOW_COMPOSITION}</dd></div>
              <div><dt>Collision</dt><dd>{CONTROL_WINDOW_COLLISION_RULE}</dd></div>
              <div><dt>Wander</dt><dd>{CONTROL_WINDOW_WANDER_RULE}</dd></div>
              <div><dt>Window Time</dt><dd>+0 AT</dd></div>
            </dl>
          </section>
        </aside>
      </section>
    </main>
  )
}
