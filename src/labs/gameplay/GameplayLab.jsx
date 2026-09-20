import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { playbackFromPlan, playbackProgress, playbackRemainingMs } from '../../sim/plan-playback.js'
import { buildGameplayATPlan, buildGameplaySpatialPreview, GAMEPLAY_TIMELINE, sampleGameplayATPlan } from './gameplay-at-plan.js'
import { ThermalPendulum } from '../thermal/ThermalClockLabV3.jsx'
import { Board3D } from '../../ui/Board3D.jsx'
import { createCellWorld } from '../../sim/world.js'
import { axialKey } from '../../sim/hex.js'
import { formatThermal } from '../thermal/thermal-clock-model.js'
import {
  thermalConfigFromProfile,
  thermalEnvironment,
  thermalStateFromProfile,
} from '../../thermal/thermal-profile.js'
import {
  getActiveThermalProfile,
  subscribeThermalProfile,
} from '../../thermal/thermal-profile-store.js'
import {
  SHARED_THERMAL_RUNTIME,
} from '../../thermal/thermal-runtime.js'
import {
  GAMEPLAY_ACTIONS_V1,
  GAMEPLAY_V1,
  actorBoardRecord,
  actorSpatialState,
  createDefaultEnemies,
  createMomentumActor,
  isDownSide,
  momentumBand,
  reachableTargets,
} from './gameplay-momentum-model.js'

const BOARD_RADIUS = 5
const clone = (value) => JSON.parse(JSON.stringify(value))

function thermalDomain(temperature) {
  if (temperature >= 3) return 'HOT'
  if (temperature <= -3) return 'COLD'
  return 'NEUTRAL'
}

function traceSummary(result, thermalEvents, domainTrace) {
  if (!result?.valid) return result?.reason || 'Select a valid target.'
  const parts = []
  for (const entry of result.trace ?? []) {
    if (entry.from && entry.to) parts.push(`${entry.actorId ? `${entry.actorId}: ` : ''}${entry.from}→${entry.to} · ${entry.cause}`)
    else if (entry.cause) parts.push(entry.actorId ? `${entry.cause}(${entry.actorId})` : entry.cause)
  }
  for (const entry of thermalEvents) {
    parts.push(`${entry.source}: ${entry.impulse >= 0 ? '+' : ''}${entry.impulse.toFixed(2)}V [${entry.scope}]`)
  }
  for (const entry of domainTrace ?? []) {
    parts.push(entry.suppressed
      ? `Domain ${entry.channel} suppressed · ${entry.reason}`
      : `Domain ${entry.channel} ${entry.fromM}→${entry.toM}`)
  }
  return parts.join(' · ') || '1AT resolved.'
}

export function GameplayLab() {
  const profile = useSyncExternalStore(subscribeThermalProfile, getActiveThermalProfile, getActiveThermalProfile)
  const [thermal, setThermal] = useState(() => thermalStateFromProfile(getActiveThermalProfile()))
  const [previousThermal, setPreviousThermal] = useState(null)
  const [player, setPlayer] = useState(() => createMomentumActor({ id: 'player' }))
  const [enemies, setEnemies] = useState(() => createDefaultEnemies())
  const [worldAt, setWorldAt] = useState(0)
  const [selectedActionId, setSelectedActionId] = useState('move')
  const [environmentId, setEnvironmentId] = useState('adiabatic')
  const [hoverHex, setHoverHex] = useState(null)
  const [selectedHex, setSelectedHex] = useState(null)
  const [viewMode, setViewMode] = useState('isometric')
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [history, setHistory] = useState([])
  const [lastTrace, setLastTrace] = useState('Gameplay v1 ready · build / spend Momentum and watch Thermal feedback.')
  const [momentumFactor, setMomentumFactor] = useState(0.8)
  const [collisionHeatFactor, setCollisionHeatFactor] = useState(0.8)
  const [collisionDamage, setCollisionDamage] = useState(false)
  const [domainNaturalBuild, setDomainNaturalBuild] = useState(true)
  const [atVisualMs, setAtVisualMs] = useState(950)
  const [playback, setPlayback] = useState(null)
  const [uiProgress, setUiProgress] = useState(0)
  const [fullPreviewEntry, setFullPreviewEntry] = useState(null)
  const [lastPlanningMs, setLastPlanningMs] = useState(0)
  const [lastPlan, setLastPlan] = useState(null)
  const playbackRef = useRef(null)
  const playbackId = useRef(0)
  const ready = !playback

  const cells = useMemo(() => createCellWorld(BOARD_RADIUS), [])
  const actions = GAMEPLAY_ACTIONS_V1
  const selectedAction = actions.find((entry) => entry.id === selectedActionId) ?? actions[0]
  const environment = thermalEnvironment(profile, environmentId)
  const thermalConfig = thermalConfigFromProfile(profile, environmentId)
  const allActors = useMemo(() => [player, ...enemies], [player, enemies])
  const reachable = useMemo(
    () => reachableTargets(player, selectedActionId, BOARD_RADIUS, allActors),
    [player, selectedActionId, allActors],
  )
  const reachableKeys = useMemo(() => new Set(reachable.map((entry) => axialKey(entry.hex))), [reachable])
  const targetHex = hoverHex ?? selectedHex
  const requiresTarget = selectedAction.target !== 'none'
  const planInput = useMemo(() => ({ player, enemies, thermal, profile, worldAt, environmentId,
    boardRadius: BOARD_RADIUS, collisionDamage, momentumFactor, collisionHeatFactor, domainNaturalBuild }),
  [player, enemies, thermal, profile, worldAt, environmentId, collisionDamage, momentumFactor, collisionHeatFactor, domainNaturalBuild])
  const previewKey = requiresTarget && targetHex ? `${selectedActionId}:${axialKey(targetHex)}` : null
  const lightPreviewPlan = useMemo(() => previewKey
    ? buildGameplaySpatialPreview({ player, enemies, worldAt, actionId: selectedActionId, targetHex, boardRadius: BOARD_RADIUS })
    : null,
  [previewKey, player, enemies, worldAt, selectedActionId, targetHex?.q, targetHex?.r])
  const fullPreviewPlan = fullPreviewEntry?.key === previewKey ? fullPreviewEntry.plan : null

  useEffect(() => {
    if (!previewKey || playbackRef.current) {
      setFullPreviewEntry(null)
      return undefined
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      const started = performance.now()
      const plan = buildGameplayATPlan({ ...planInput, actionId: selectedActionId, targetHex })
      const planningMs = performance.now() - started
      if (!cancelled) {
        setLastPlanningMs(planningMs)
        setFullPreviewEntry({ key: previewKey, plan })
      }
    }, 70)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [previewKey, planInput, selectedActionId, targetHex?.q, targetHex?.r])

  const previewPlan = fullPreviewPlan ?? lightPreviewPlan
  const shownPlan = playback ?? fullPreviewPlan
  const previewThermalEvents = shownPlan?.sourceThermalEvents ?? []
  const previewSourceImpulse = previewThermalEvents.reduce((sum, entry) => sum + entry.impulse, 0)
  const previewThermal = { finalState: shownPlan?.finalState?.thermal ?? thermal }
  const previewDomain = { actor: shownPlan?.finalState?.player ?? player, trace: shownPlan?.domainTrace ?? [] }
  const previewResolution = shownPlan ? { valid: shownPlan.valid, reason: shownPlan.reason,
    trace: shownPlan.events?.filter((entry) => entry.type === 'MomentumTransaction').flatMap((entry) => entry.trace.map((trace) => ({ ...trace, actorId: entry.actorId }))) ?? [] } : null
  const visual = useMemo(() => playback ? sampleGameplayATPlan(playback, uiProgress) : null, [playback, uiProgress])
  const displayThermal = visual?.thermal ?? thermal
  const displayPlayer = visual?.player.actor ?? player
  const displayEnemies = visual ? enemies.map((actor) => visual.actors[actor.id].actor) : enemies
  const displayConfig = playback?.config ?? thermalConfig
  const playerSpatial = useMemo(() => actorSpatialState(player, worldAt), [player, worldAt])
  const boardActors = useMemo(() => enemies.filter((entry) => entry.hp > 0).map(actorBoardRecord), [enemies])
  const axisDisplayOverride = isDownSide(displayPlayer) ? `down-${displayPlayer.downM}` : 'auto'

  const clearAim = () => {
    setHoverHex(null)
    setSelectedHex(null)
  }

  const beginAction = (actionId, hex = null) => {
    if (playbackRef.current) return false
    const actionKey = hex ? `${actionId}:${axialKey(hex)}` : null
    let plan = fullPreviewEntry?.key === actionKey ? fullPreviewEntry.plan : null
    if (!plan) {
      const started = performance.now()
      plan = buildGameplayATPlan({ ...planInput, actionId, targetHex: hex })
      setLastPlanningMs(performance.now() - started)
    }
    if (!plan?.valid) { setLastTrace(plan?.reason || 'No legal target.'); return false }
    const before = {
      player: clone(player),
      enemies: clone(enemies),
      thermal: clone(thermal),
      previousThermal: previousThermal ? clone(previousThermal) : null,
      worldAt,
      lastTrace,
    }
    setHistory((entries) => [...entries, before].slice(-40))
    const next = playbackFromPlan(plan, ++playbackId.current, atVisualMs)
    playbackRef.current = next
    setPlayback(next)
    setUiProgress(0)
    setSelectedActionId(actionId)
    setSelectedHex(hex)
    setHoverHex(null)
    return true
  }

  useEffect(() => {
    if (!playback) return undefined

    // Same contract as Trajectory: renderers sample the frozen playback clock;
    // React only samples it at a low diagnostic rate and never drives simulation.
    const updateUiSample = () => {
      if (playbackRef.current?.id !== playback.id) return
      setUiProgress(playbackProgress(playback))
    }
    updateUiSample()
    const uiTimer = window.setInterval(updateUiSample, 50)

    const commitTimer = window.setTimeout(() => {
      if (playbackRef.current?.id !== playback.id) return
      setUiProgress(1)
      // Only this boundary mutates the authoritative Ready state.
      setPreviousThermal(thermal)
      setPlayer(playback.finalState.player)
      setEnemies(playback.finalState.enemies)
      setThermal(playback.finalState.thermal)
      setWorldAt(playback.finalState.worldAt)
      setLastPlan(playback)
      setLastTrace(playback.events.filter((event) => !['Declare', 'Ready'].includes(event.type))
        .map((event) => `${event.t.toFixed(2)}AT ${event.type}${event.type === 'ThermalImpulse' ? ` · ${event.source} ${event.impulse >= 0 ? '+' : ''}${event.impulse.toFixed(2)}V` : ''}`).join(' · '))
      playbackRef.current = null
      setPlayback(null)
      clearAim()
    }, playbackRemainingMs(playback))

    return () => {
      window.clearInterval(uiTimer)
      window.clearTimeout(commitTimer)
    }
  }, [playback?.id])

  const undo = () => {
    if (playbackRef.current) return
    const previous = history.at(-1)
    if (!previous) return
    setHistory((entries) => entries.slice(0, -1))
    setPlayer(previous.player)
    setEnemies(previous.enemies)
    setThermal(previous.thermal)
    setPreviousThermal(previous.previousThermal)
    setWorldAt(previous.worldAt)
    setLastTrace(previous.lastTrace)
    setLastPlan(null)
    clearAim()
  }

  const reset = () => {
    if (playbackRef.current) return
    setPlayer(createMomentumActor({ id: 'player' }))
    setEnemies(createDefaultEnemies())
    setThermal(thermalStateFromProfile(profile))
    setPreviousThermal(null)
    setWorldAt(0)
    setSelectedActionId('move')
    setEnvironmentId('adiabatic')
    setHistory([])
    setLastPlan(null)
    setLastTrace(`Reset from ${profile.label} r${profile.revision}.`)
    clearAim()
  }

  useEffect(() => {
    window.__PROJECTC_GAMEPLAY_LAB__ = {
      snapshot: () => ({
        implementation: GAMEPLAY_V1,
        runtime: SHARED_THERMAL_RUNTIME,
        profile: { id: profile.id, revision: profile.revision },
        selectedActionId,
        player: clone(player),
        momentumBand: momentumBand(player),
        enemies: clone(enemies),
        environmentId,
        factors: { momentumFactor, collisionHeatFactor, collisionDamage, domainNaturalBuild },
        thermal: clone(thermal),
        predictedThermal: clone(previewThermal.finalState),
        previewThermalEvents: clone(previewThermalEvents),
        worldAt,
        timeline: GAMEPLAY_TIMELINE,
        ready,
        progress: uiProgress,
        visual: visual ? clone(visual) : null,
        previewFinal: fullPreviewPlan?.valid ? clone(fullPreviewPlan.finalState) : null,
        planningMs: lastPlanningMs,
        playbackFinal: playback ? clone(playback.finalState) : null,
        events: clone((playback ?? previewPlan ?? lastPlan)?.events ?? []),
        historyEntries: history.length,
      }),
      reset,
    }
    return () => { delete window.__PROJECTC_GAMEPLAY_LAB__ }
  })

  return (
    <main
      className="current-prototype cell-world-prototype gameplay-lab"
      data-implementation={GAMEPLAY_V1}
      data-shared-thermal-runtime={SHARED_THERMAL_RUNTIME}
      data-profile-id={profile.id}
      data-profile-revision={profile.revision}
      data-gameplay-action-id={selectedActionId}
      data-momentum-band={momentumBand(player)}
      data-world-at={worldAt.toFixed(1)}
      data-gameplay-timeline={GAMEPLAY_TIMELINE}
      data-playback-state={ready ? 'ready' : 'playing'}
      data-playback-at={ready ? '0' : uiProgress.toFixed(3)}
    >
      <header className="prototype-header">
        <div className="brand"><p>ProjectC · Gameplay × Momentum × Thermal v1</p><h1>Gameplay Lab</h1></div>
        <div className="headline-state">
          <div><span>{ready ? 'Ready · World Time' : 'Playback · World Time'}</span><strong>{(worldAt + (ready ? 0 : uiProgress)).toFixed(2)} AT</strong></div>
          <div><span>Momentum</span><strong>{momentumBand(displayPlayer)}</strong></div>
          <div className={`thermal-${thermalDomain(displayThermal.temperature).toLowerCase()}`}><span>Thermal</span><strong>{thermalDomain(displayThermal.temperature)} · T {formatThermal(displayThermal.temperature, 2)}</strong></div>
          <div><span>Drift</span><strong>{formatThermal(displayThermal.drift, 2)} / AT</strong></div>
          <div><span>Cell</span><strong>{displayPlayer.hex.q},{displayPlayer.hex.r}</strong></div>
        </div>
      </header>

      <section className="lab-grid gameplay-grid">
        <aside className="side-panel left-panel">
          <section className="panel-card actor-card">
            <div className="portrait">⬡</div>
            <div><p>Gameplay Actor</p><h2>Courier</h2><span className="actor-sub">Momentum / Thermal candidate</span></div>
          </section>

          <section className="panel-card actor-vitals">
            <div className="section-heading"><h3>Actor State</h3><span>{momentumBand(displayPlayer)}</span></div>
            <div className="vital-row"><span>HP</span><i><b style={{ width: `${displayPlayer.hp}%` }} /></i><strong>{displayPlayer.hp}/100</strong></div>
            <div className="momentum-state-grid">
              <div><span>Horizontal</span><strong>{displayPlayer.axisId ? `H${displayPlayer.hM} · ${displayPlayer.axisId}` : '—'}</strong></div>
              <div><span>Down</span><strong>{isDownSide(displayPlayer) ? `D${displayPlayer.downM}` : '—'}</strong></div>
            </div>
            <ThermalPendulum state={displayThermal} config={displayConfig} previousState={previousThermal} className="gameplay-thermal-pendulum" />
            <dl className="state-list actor-state-list">
              <div><dt>Temperature</dt><dd>{formatThermal(displayThermal.temperature, 2)}</dd></div>
              <div><dt>Drift</dt><dd>{formatThermal(displayThermal.drift, 2)}</dd></div>
              <div><dt>Set Point</dt><dd>{formatThermal(displayThermal.setPoint, 2)}</dd></div>
              <div><dt>Environment</dt><dd>{environment.label}</dd></div>
            </dl>
          </section>

          <section className="panel-card prediction-card">
            <div className="section-heading"><h3>Predicted Outcome</h3><span>candidate</span></div>
            <p>{previewResolution?.valid
              ? traceSummary(previewResolution, previewThermalEvents, previewDomain.trace)
              : requiresTarget
                ? (reachable.length ? 'Select a highlighted target / direction.' : 'No legal target for this action in the current Momentum state.')
                : previewResolution?.reason || 'Ready.'}</p>
            <dl className="state-list compact">
              <div><dt>Ready Momentum</dt><dd>{momentumBand(previewDomain.actor)}</dd></div>
              <div><dt>Action ΔV</dt><dd>{previewSourceImpulse >= 0 ? '+' : ''}{previewSourceImpulse.toFixed(2)}</dd></div>
              <div><dt>Ready T</dt><dd>{formatThermal(previewThermal.finalState.temperature, 2)}</dd></div>
              <div><dt>Ready V</dt><dd>{formatThermal(previewThermal.finalState.drift, 2)}</dd></div>
              <div><dt>Target</dt><dd>{targetHex ? axialKey(targetHex) : '—'}</dd></div>
            </dl>
          </section>
        </aside>

        <section className="center-column">
          <div className="board-strip">
            <strong>{selectedAction.label} · 1AT</strong>
            <span>{!ready ? `PLAYING ${uiProgress.toFixed(2)} / 1 AT · input locked` : requiresTarget
              ? (selectedHex ? `Target ${axialKey(selectedHex)} selected` : (reachable.length ? 'Choose a highlighted target / direction' : 'Current state has no legal target'))
              : selectedAction.short}</span>
          </div>
          <div className="board-toolbar">
            <div className="view-switch">
              <button type="button" className={viewMode === 'isometric' ? 'active' : ''} onClick={() => setViewMode('isometric')}>3D</button>
              <button type="button" className={viewMode === 'top' ? 'active' : ''} onClick={() => setViewMode('top')}>Top</button>
              <button type="button" onClick={() => setCameraResetToken((value) => value + 1)}>Reset View</button>
            </div>
            <div className="session-buttons"><button type="button" disabled={!ready || !history.length} onClick={undo}>Undo</button><button type="button" disabled={!ready} onClick={reset}>Reset</button></div>
          </div>

          <div className="board-frame gameplay-board-frame">
            <Board3D
              cells={cells}
              obstacles={[]}
              actors={boardActors}
              reachableCells={ready ? reachable : []}
              state={playerSpatial}
              previewPlan={ready ? previewPlan : null}
              playback={playback}
              atVisualMs={atVisualMs}
              axisDisplayOverride={axisDisplayOverride}
              boardRadius={BOARD_RADIUS}
              viewMode={viewMode}
              cameraResetToken={cameraResetToken}
              hoverHex={hoverHex}
              selectedAimHex={selectedHex}
              showWeather={false}
              showThermal
              onHoverHex={(hex) => {
                if (playbackRef.current) return
                if (!hex || !requiresTarget || !reachableKeys.has(axialKey(hex))) return setHoverHex(null)
                setHoverHex(hex)
              }}
              onClickHex={(hex) => {
                if (playbackRef.current || !hex || !requiresTarget || !reachableKeys.has(axialKey(hex))) return
                beginAction(selectedActionId, { ...hex })
              }}
            />
            <div className="board-legend">
              <span><i className="terrain" />Bright outline = legal action target</span>
              <span><i className="trajectory" />Dashed path = current Momentum preview</span>
              <span><i className="momentum-axis" />HM0 keeps Axis arrow; No Axis removes it</span>
            </div>
          </div>

          <section className="action-hand gameplay-action-hand">
            <div className="hand-heading">
              <div><h2>Gameplay Actions · Momentum v1</h2><p>Move / Drive push Horizontal; Brace / Skip settle toward Down; Launch / Release cash Down back into Horizontal pressure.</p></div>
              <span className="gameplay-ready-label" role="status">{ready ? 'READY · select → hover → click target' : `PLAYING · ${(uiProgress * 100).toFixed(0)}%`}</span>
            </div>
            <div className="action-row gameplay-action-row">
              {actions.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className={`action-card ${entry.id === selectedActionId ? 'selected' : ''} gameplay-action-${entry.id}`}
                  data-gameplay-action-id={entry.id}
                  disabled={!ready || player.hp <= 0}
                  onClick={() => {
                    if (playbackRef.current) return
                    if (entry.target === 'none') beginAction(entry.id)
                    else { setSelectedActionId(entry.id); clearAim() }
                  }}
                >
                  <header><strong>{entry.label}</strong><em>{entry.badge}</em></header>
                  <p>{entry.short}</p>
                  <span>1AT · {entry.target === 'none' ? 'click to play' : entry.target}</span>
                </button>
              ))}
            </div>
          </section>
        </section>

        <aside className="side-panel right-panel gameplay-right-panel">
          <fieldset disabled={!ready} className="panel-card gameplay-controls-card">
            <div className="section-heading"><h3>v1 Experiment Controls</h3><span>LIVE</span></div>
            <label><span>Playback / AT</span><input aria-label="Gameplay AT playback duration" type="range" min="200" max="3000" step="25" value={atVisualMs} onChange={(event) => setAtVisualMs(Number(event.target.value))} /><strong>{(atVisualMs / 1000).toFixed(2)}s</strong></label>
            <label><span>M-T Factor</span><input aria-label="M-T Factor" type="range" min="0" max="1.6" step="0.05" value={momentumFactor} onChange={(event) => setMomentumFactor(Number(event.target.value))} /><strong>{momentumFactor.toFixed(2)}</strong></label>
            <label><span>Collision Heat</span><input aria-label="Collision Heat Factor" type="range" min="0" max="1.6" step="0.05" value={collisionHeatFactor} onChange={(event) => setCollisionHeatFactor(Number(event.target.value))} /><strong>{collisionHeatFactor.toFixed(2)}</strong></label>
            <div className="gameplay-toggle-row">
              <button type="button" className={collisionDamage ? 'chosen' : ''} onClick={() => setCollisionDamage((value) => !value)}>Collision Damage {collisionDamage ? 'ON' : 'OFF'}</button>
              <button type="button" className={domainNaturalBuild ? 'chosen' : ''} onClick={() => setDomainNaturalBuild((value) => !value)}>Domain Build {domainNaturalBuild ? 'ON' : 'OFF'}</button>
            </div>
          </fieldset>

          <section className="panel-card gameplay-enemy-card">
            <div className="section-heading"><h3>Telegraphed Enemies</h3><span>deterministic</span></div>
            <div className="enemy-intent-list">
              {displayEnemies.map((enemy) => (
                <div key={enemy.id} className={enemy.hp <= 0 ? 'is-dead' : ''}>
                  <strong>{enemy.id}</strong>
                  <span>HP {enemy.hp} · {momentumBand(enemy)}</span>
                  <em>Next: {enemy.intent?.toUpperCase() || 'WAIT'}</em>
                </div>
              ))}
            </div>
          </section>

          <fieldset disabled={!ready} className="panel-card gameplay-environment-card">
            <div className="section-heading"><h3>Environment Context</h3><span>Weather hook</span></div>
            <div className="gameplay-environment-buttons">
              {Object.values(profile.environments).map((entry) => <button type="button" key={entry.id} className={environmentId === entry.id ? 'chosen' : ''} onClick={() => setEnvironmentId(entry.id)}>{entry.label}</button>)}
            </div>
            <dl className="state-list compact">
              <div><dt>Tenv</dt><dd>{environment.environmentTemperature.toFixed(1)}</dd></div>
              <div><dt>kE</dt><dd>{environment.environmentCoupling.toFixed(2)}</dd></div>
              <div><dt>cEff</dt><dd>{thermalDiagnostics(thermal, thermalConfig).cEff.toFixed(3)}</dd></div>
              <div><dt>Profile</dt><dd>{profile.id} r{profile.revision}</dd></div>
            </dl>
          </fieldset>

          <section className="panel-card" data-gameplay-resolution-trace="momentum-thermal-v1">
            <div className="section-heading"><h3>Resolution Trace</h3><span>cause-aware</span></div>
            <p className="gameplay-resolution-text">{lastTrace}</p>
            <ol className="gameplay-timeline" aria-label="AT event timeline">
              {(playback ?? previewPlan ?? lastPlan)?.events?.map((event) => <li key={event.id} data-event-type={event.type} className={playback && event.t <= uiProgress ? 'is-elapsed' : ''}>
                <time>{event.t.toFixed(2)}</time> {event.type} <small>{event.actorId ?? ''}{event.targetId ? ` → ${event.targetId}` : ''}{event.source ? ` · ${event.source}` : ''}</small>
              </li>)}
            </ol>
            <small>Trace distinguishes Active H/D Build/Spend, Incoming H, Collision dissipatedM, Domain Natural Build and same-AT suppression.</small>
          </section>

          <section className="panel-card gameplay-scope-card">
            <div className="section-heading"><h3>v1 Scope</h3><span>candidate</span></div>
            <ul>
              <li>HM0 Axis → No Axis → DM0 Skip chain</li>
              <li>Drive / Brace symmetric fast establish</li>
              <li>HM2→DM0 and DM2→HM0 cross-channel candidate</li>
              <li>Launch / Release 1:1</li>
              <li>M ↔ Thermal + Domain Natural Build</li>
              <li>2 deterministic telegraphed enemies</li>
              <li>Deflect / Link / full AI still deferred</li>
              <li>P0: simultaneous contested Cell holds both; full settlement / chained resolution deferred</li>
              <li>Clash is a visible hook, not a frozen damage rule</li>
            </ul>
          </section>
        </aside>
      </section>
    </main>
  )
}
