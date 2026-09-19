import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Board3D } from '../../ui/Board3D.jsx'
import { createCellWorld } from '../../sim/world.js'
import { axialKey } from '../../sim/hex.js'
import { formatThermal, solveThermalSegment, thermalDiagnostics } from '../thermal/thermal-clock-model.js'
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
  resolveThermalImpulseStep,
} from '../../thermal/thermal-runtime.js'
import {
  GAMEPLAY_ACTIONS_V1,
  GAMEPLAY_V1,
  actorBoardRecord,
  actorSpatialState,
  advanceTelegraphedEnemies,
  createDefaultEnemies,
  createMomentumActor,
  isDownSide,
  momentumBand,
  reachableTargets,
  resolveDomainNaturalBuild,
  resolveGameplayAction,
  resolveThermalEvents,
} from './gameplay-momentum-model.js'

const BOARD_RADIUS = 5
const PIVOT = { x: 150, y: 24 }
const TRACK_RADIUS = 112
const BOB_RADIUS = 97
const HISTORY_RADIUS = 99
const ARROW_RADIUS = 128
const ZONE_VALUES = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const clone = (value) => JSON.parse(JSON.stringify(value))

function pointAt(angleDeg, radius) {
  const radians = angleDeg * Math.PI / 180
  return { x: PIVOT.x + Math.sin(radians) * radius, y: PIVOT.y + Math.cos(radians) * radius }
}

function angleForTemperature(temperature, setPoint) {
  return clamp((temperature - setPoint) * 12, -80, 80)
}

function arcPath(startAngle, endAngle, radius) {
  const steps = Math.max(3, Math.ceil(Math.abs(endAngle - startAngle) / 3))
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps
    const point = pointAt(startAngle + (endAngle - startAngle) * t, radius)
    return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  }).join(' ')
}

function zoneClass(value) {
  if (value <= -4 || value >= 4) return 'extreme'
  if (value === -3) return 'cold-3'
  if (value === -2) return 'cold-2'
  if (value === -1) return 'cold-1'
  if (value === 0) return 'neutral'
  if (value === 1) return 'hot-1'
  if (value === 2) return 'hot-2'
  return 'hot-3'
}

function thermalDomain(temperature) {
  if (temperature >= 3) return 'HOT'
  if (temperature <= -3) return 'COLD'
  return 'NEUTRAL'
}

function GameplayThermalPendulum({ thermal, config, previousThermal }) {
  const angle = angleForTemperature(thermal.temperature, thermal.setPoint)
  const current = pointAt(angle, BOB_RADIUS)
  const skipNextState = solveThermalSegment(thermal, config, 1)
  const nextAngle = angleForTemperature(skipNextState.temperature, thermal.setPoint)
  const next = pointAt(nextAngle, ARROW_RADIUS)
  const previous = previousThermal ? pointAt(angleForTemperature(previousThermal.temperature, previousThermal.setPoint), HISTORY_RADIUS) : null
  const arrow = Math.abs(nextAngle - angle) > 0.15 ? arcPath(angle, nextAngle, ARROW_RADIUS) : ''
  const zonePaths = ZONE_VALUES.map((value) => ({
    value,
    className: zoneClass(value),
    path: arcPath((value - 0.5 - thermal.setPoint) * 12, (value + 0.5 - thermal.setPoint) * 12, TRACK_RADIUS),
  }))
  const diagnostics = thermalDiagnostics(thermal, config)

  return (
    <div className="thermal-pendulum gameplay-thermal-pendulum" data-gameplay-thermal-pendulum="shared-runtime-v1">
      <div className="thermal-pendulum__header">
        <span className={diagnostics.adiabatic ? 'adiabatic is-on' : 'adiabatic'}>{diagnostics.adiabatic ? 'ADIABATIC' : 'ENV COUPLED'}</span>
        <strong>{thermal.drift > 0.001 ? 'HOTWARD' : thermal.drift < -0.001 ? 'COLDWARD' : 'STILL'}</strong>
      </div>
      <svg viewBox="0 0 300 172" role="img" aria-label="Gameplay Thermal Pendulum using the shared Thermal runtime">
        <defs><marker id="gameplay-skip-arrow-head" markerWidth="7" markerHeight="7" refX="5.7" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 7 3.5 L 0 7 Z" /></marker></defs>
        <g className="thermal-pendulum__zone-track">{zonePaths.map((zone) => <path key={zone.value} className={`thermal-pendulum__zone ${zone.className}`} d={zone.path} />)}</g>
        {previous && <circle className="thermal-pendulum__history-ring" cx={previous.x} cy={previous.y} r="7" />}
        {arrow ? <path className="thermal-pendulum__skip-arrow" d={arrow} markerEnd="url(#gameplay-skip-arrow-head)" /> : <circle className="thermal-pendulum__skip-idle" cx={next.x} cy={next.y} r="3" />}
        <circle className="thermal-pendulum__skip-next" cx={next.x} cy={next.y} r="2.6" />
        <line className="thermal-pendulum__set-line" x1={PIVOT.x} y1={PIVOT.y + 4} x2={PIVOT.x} y2={PIVOT.y + TRACK_RADIUS - 4} />
        <circle className="thermal-pendulum__pivot" cx={PIVOT.x} cy={PIVOT.y} r="6" />
        <line className="thermal-pendulum__arm" x1={PIVOT.x} y1={PIVOT.y + 4} x2={current.x} y2={current.y} />
        <circle className={`thermal-pendulum__bob ${zoneClass(Math.round(clamp(thermal.temperature, -4, 4)))}`} cx={current.x} cy={current.y} r="9" />
        <circle className="thermal-pendulum__bob-core" cx={current.x} cy={current.y} r="2.5" />
        <text className="thermal-pendulum__cold-label" x="14" y="163">COLD</text>
        <text className="thermal-pendulum__set-label" x="150" y="163" textAnchor="middle">S {formatThermal(thermal.setPoint, 1)}</text>
        <text className="thermal-pendulum__hot-label" x="286" y="163" textAnchor="end">HOT</text>
      </svg>
      <div className="thermal-pendulum__readout">
        <div><span>T</span><strong>{formatThermal(thermal.temperature, 2)}</strong></div>
        <div><span>V</span><strong>{formatThermal(thermal.drift, 2)}</strong></div>
        <div><span>Domain</span><strong>{thermalDomain(thermal.temperature)}</strong></div>
      </div>
    </div>
  )
}

function replaceActor(actors, update) {
  if (!update) return actors
  return actors.map((entry) => entry.id === update.id ? update : entry)
}

function previewPlanFromResolution(player, enemies, result, worldAt) {
  if (!result?.valid) return null
  const startState = actorSpatialState(player, worldAt)
  const finalState = actorSpatialState(result.actor, worldAt + 1)
  const path = result.path ?? []
  const cells = [player.hex, ...path]
  const samples = cells.map((hex, index) => {
    const state = actorSpatialState({ ...result.actor, hex }, worldAt + (cells.length <= 1 ? 0 : index / Math.max(1, cells.length - 1)))
    return { t: cells.length <= 1 ? 0 : index / Math.max(1, cells.length - 1), position: state.position, velocity: state.velocity, axisId: state.axisId }
  })
  if (samples.length < 2) samples.push({ t: 1, position: finalState.position, velocity: finalState.velocity, axisId: finalState.axisId })

  const actorTrajectories = {}
  if (result.targetUpdate && result.targetPath?.length) {
    const before = enemies.find((entry) => entry.id === result.targetUpdate.id)
    actorTrajectories[result.targetUpdate.id] = [before?.hex ?? result.targetUpdate.hex, ...result.targetPath]
  }

  return {
    valid: true,
    reason: '',
    spatialMode: 'discrete',
    destinationDriven: true,
    samples,
    traversedCells: cells,
    collisions: result.dissipatedM > 0 ? [{ kind: 'actor', t: 0.6 }] : [],
    actorTrajectories,
    finalState: {
      ...finalState,
      actors: replaceActor(enemies, result.targetUpdate).map(actorBoardRecord),
    },
  }
}

function traceSummary(result, thermalEvents, domainTrace) {
  if (!result?.valid) return result?.reason || 'Select a valid target.'
  const parts = []
  for (const entry of result.trace ?? []) {
    if (entry.from && entry.to) parts.push(`${entry.from}→${entry.to} · ${entry.cause}`)
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
  const targetHex = selectedHex || hoverHex
  const requiresTarget = selectedAction.target !== 'none'
  const canCommit = !requiresTarget || Boolean(selectedHex)

  const previewResolution = useMemo(() => {
    if (requiresTarget && !targetHex) return null
    return resolveGameplayAction({
      actor: player,
      actionId: selectedActionId,
      targetHex,
      actors: allActors,
      boardRadius: BOARD_RADIUS,
      collisionDamage,
    })
  }, [player, selectedActionId, targetHex?.q, targetHex?.r, allActors, collisionDamage, requiresTarget])

  const previewThermalEvents = useMemo(
    () => previewResolution?.valid
      ? resolveThermalEvents(previewResolution.thermal, { momentumFactor, collisionHeatFactor })
      : [],
    [previewResolution, momentumFactor, collisionHeatFactor],
  )
  const previewSourceImpulse = previewThermalEvents
    .filter((entry) => entry.scope === 'source' || entry.scope === 'both')
    .reduce((sum, entry) => sum + entry.impulse, 0)
  const previewThermal = useMemo(
    () => resolveThermalImpulseStep({
      state: thermal,
      profile,
      impulse: previewSourceImpulse,
      sourceId: 'momentum-events-v1',
      environmentId,
      durationAt: 1,
    }),
    [thermal, profile, previewSourceImpulse, environmentId],
  )
  const previewSpentH = previewThermalEvents.some((entry) => entry.source === 'Active H Spend')
  const previewSpentD = previewThermalEvents.some((entry) => entry.source === 'Active D Spend / Convert')
  const previewDomain = previewResolution?.valid
    ? resolveDomainNaturalBuild(previewResolution.actor, thermalDomain(previewThermal.finalState.temperature), {
      enabled: domainNaturalBuild,
      spentH: previewSpentH,
      spentD: previewSpentD,
      hadHorizontalTravel: Boolean(previewResolution.path?.length),
      stable: !previewResolution.path?.length && !previewResolution.actor.axisId,
    })
    : { actor: player, trace: [] }
  const previewPlan = previewPlanFromResolution(player, enemies, previewResolution, worldAt)
  const playerSpatial = actorSpatialState(player, worldAt)
  const boardActors = enemies.filter((entry) => entry.hp > 0).map(actorBoardRecord)
  const axisDisplayOverride = isDownSide(player) ? `down-${Math.max(1, player.downM)}` : 'auto'

  const clearAim = () => {
    setHoverHex(null)
    setSelectedHex(null)
  }

  const commit = () => {
    if (!canCommit) return
    const result = resolveGameplayAction({
      actor: player,
      actionId: selectedActionId,
      targetHex: selectedHex,
      actors: allActors,
      boardRadius: BOARD_RADIUS,
      collisionDamage,
    })
    if (!result.valid) {
      setLastTrace(result.reason)
      return
    }

    const before = {
      player: clone(player),
      enemies: clone(enemies),
      thermal: clone(thermal),
      previousThermal: previousThermal ? clone(previousThermal) : null,
      worldAt,
      lastTrace,
    }

    const thermalEvents = resolveThermalEvents(result.thermal, { momentumFactor, collisionHeatFactor })
    const sourceImpulse = thermalEvents
      .filter((entry) => entry.scope === 'source' || entry.scope === 'both')
      .reduce((sum, entry) => sum + entry.impulse, 0)
    const thermalResult = resolveThermalImpulseStep({
      state: thermal,
      profile,
      impulse: sourceImpulse,
      sourceId: 'momentum-events-v1',
      environmentId,
      durationAt: 1,
    })

    let nextEnemies = replaceActor(enemies, result.targetUpdate)
    let nextPlayer = result.actor
    const spentH = thermalEvents.some((entry) => entry.source === 'Active H Spend')
    const spentD = thermalEvents.some((entry) => entry.source === 'Active D Spend / Convert')
    const domain = resolveDomainNaturalBuild(nextPlayer, thermalDomain(thermalResult.finalState.temperature), {
      enabled: domainNaturalBuild,
      spentH,
      spentD,
      hadHorizontalTravel: Boolean(result.path?.length),
      stable: !result.path?.length && !nextPlayer.axisId,
    })
    nextPlayer = domain.actor

    const enemyStep = advanceTelegraphedEnemies(nextEnemies, nextPlayer, BOARD_RADIUS)
    nextEnemies = enemyStep.enemies
    nextPlayer = enemyStep.player

    setHistory((entries) => [...entries, before].slice(-40))
    setPreviousThermal(thermal)
    setThermal(thermalResult.finalState)
    setPlayer(nextPlayer)
    setEnemies(nextEnemies)
    setWorldAt((value) => value + 1)
    setLastTrace(traceSummary(
      { ...result, trace: [...(result.trace ?? []), ...(enemyStep.trace ?? [])] },
      thermalEvents,
      domain.trace,
    ))
    clearAim()
  }

  const undo = () => {
    const previous = history.at(-1)
    if (!previous) return
    setHistory((entries) => entries.slice(0, -1))
    setPlayer(previous.player)
    setEnemies(previous.enemies)
    setThermal(previous.thermal)
    setPreviousThermal(previous.previousThermal)
    setWorldAt(previous.worldAt)
    setLastTrace(previous.lastTrace)
    clearAim()
  }

  const reset = () => {
    setPlayer(createMomentumActor({ id: 'player' }))
    setEnemies(createDefaultEnemies())
    setThermal(thermalStateFromProfile(profile))
    setPreviousThermal(null)
    setWorldAt(0)
    setSelectedActionId('move')
    setEnvironmentId('adiabatic')
    setHistory([])
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
    >
      <header className="prototype-header">
        <div className="brand"><p>ProjectC · Gameplay × Momentum × Thermal v1</p><h1>Gameplay Lab</h1></div>
        <div className="headline-state">
          <div><span>World Time</span><strong>{worldAt.toFixed(1)} AT</strong></div>
          <div><span>Momentum</span><strong>{momentumBand(player)}</strong></div>
          <div className={`thermal-${thermalDomain(thermal.temperature).toLowerCase()}`}><span>Thermal</span><strong>{thermalDomain(thermal.temperature)} · T {formatThermal(thermal.temperature, 2)}</strong></div>
          <div><span>Drift</span><strong>{formatThermal(thermal.drift, 2)} / AT</strong></div>
          <div><span>Cell</span><strong>{player.hex.q},{player.hex.r}</strong></div>
        </div>
      </header>

      <section className="lab-grid gameplay-grid">
        <aside className="side-panel left-panel">
          <section className="panel-card actor-card">
            <div className="portrait">⬡</div>
            <div><p>Gameplay Actor</p><h2>Courier</h2><span className="actor-sub">Momentum / Thermal candidate</span></div>
          </section>

          <section className="panel-card actor-vitals">
            <div className="section-heading"><h3>Actor State</h3><span>{momentumBand(player)}</span></div>
            <div className="vital-row"><span>HP</span><i><b style={{ width: `${player.hp}%` }} /></i><strong>{player.hp}/100</strong></div>
            <div className="momentum-state-grid">
              <div><span>Horizontal</span><strong>{player.axisId ? `H${player.hM} · ${player.axisId}` : '—'}</strong></div>
              <div><span>Down</span><strong>{isDownSide(player) ? `D${player.downM}` : '—'}</strong></div>
            </div>
            <GameplayThermalPendulum thermal={thermal} config={thermalConfig} previousThermal={previousThermal} />
            <dl className="state-list actor-state-list">
              <div><dt>Temperature</dt><dd>{formatThermal(thermal.temperature, 2)}</dd></div>
              <div><dt>Drift</dt><dd>{formatThermal(thermal.drift, 2)}</dd></div>
              <div><dt>Set Point</dt><dd>{formatThermal(thermal.setPoint, 2)}</dd></div>
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
            <span>{requiresTarget
              ? (selectedHex ? `Target ${axialKey(selectedHex)} selected` : (reachable.length ? 'Choose a highlighted target / direction' : 'Current state has no legal target'))
              : selectedAction.short}</span>
          </div>
          <div className="board-toolbar">
            <div className="view-switch">
              <button type="button" className={viewMode === 'isometric' ? 'active' : ''} onClick={() => setViewMode('isometric')}>3D</button>
              <button type="button" className={viewMode === 'top' ? 'active' : ''} onClick={() => setViewMode('top')}>Top</button>
              <button type="button" onClick={() => setCameraResetToken((value) => value + 1)}>Reset View</button>
            </div>
            <div className="session-buttons"><button type="button" disabled={!history.length} onClick={undo}>Undo</button><button type="button" onClick={reset}>Reset</button></div>
          </div>

          <div className="board-frame gameplay-board-frame">
            <Board3D
              cells={cells}
              obstacles={[]}
              actors={boardActors}
              reachableCells={reachable}
              state={playerSpatial}
              previewPlan={previewPlan}
              playback={null}
              atVisualMs={650}
              axisDisplayOverride={axisDisplayOverride}
              boardRadius={BOARD_RADIUS}
              viewMode={viewMode}
              cameraResetToken={cameraResetToken}
              hoverHex={hoverHex}
              selectedAimHex={selectedHex}
              showWeather
              showThermal
              onHoverHex={(hex) => {
                if (!hex || !requiresTarget || !reachableKeys.has(axialKey(hex))) return setHoverHex(null)
                setHoverHex(hex)
              }}
              onClickHex={(hex) => {
                if (!hex || !requiresTarget || !reachableKeys.has(axialKey(hex))) return
                setSelectedHex({ ...hex })
                setHoverHex(null)
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
              <button type="button" className="gameplay-commit" disabled={!canCommit || (requiresTarget && !reachable.length)} onClick={commit}>Commit 1AT</button>
            </div>
            <div className="action-row gameplay-action-row">
              {actions.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className={`action-card ${entry.id === selectedActionId ? 'selected' : ''} gameplay-action-${entry.id}`}
                  data-gameplay-action-id={entry.id}
                  onClick={() => { setSelectedActionId(entry.id); clearAim() }}
                >
                  <header><strong>{entry.label}</strong><em>{entry.badge}</em></header>
                  <p>{entry.short}</p>
                  <span>1AT · {entry.target === 'none' ? 'no target' : entry.target}</span>
                </button>
              ))}
            </div>
          </section>
        </section>

        <aside className="side-panel right-panel gameplay-right-panel">
          <section className="panel-card gameplay-controls-card">
            <div className="section-heading"><h3>v1 Experiment Controls</h3><span>LIVE</span></div>
            <label><span>M-T Factor</span><input aria-label="M-T Factor" type="range" min="0" max="1.6" step="0.05" value={momentumFactor} onChange={(event) => setMomentumFactor(Number(event.target.value))} /><strong>{momentumFactor.toFixed(2)}</strong></label>
            <label><span>Collision Heat</span><input aria-label="Collision Heat Factor" type="range" min="0" max="1.6" step="0.05" value={collisionHeatFactor} onChange={(event) => setCollisionHeatFactor(Number(event.target.value))} /><strong>{collisionHeatFactor.toFixed(2)}</strong></label>
            <div className="gameplay-toggle-row">
              <button type="button" className={collisionDamage ? 'chosen' : ''} onClick={() => setCollisionDamage((value) => !value)}>Collision Damage {collisionDamage ? 'ON' : 'OFF'}</button>
              <button type="button" className={domainNaturalBuild ? 'chosen' : ''} onClick={() => setDomainNaturalBuild((value) => !value)}>Domain Build {domainNaturalBuild ? 'ON' : 'OFF'}</button>
            </div>
          </section>

          <section className="panel-card gameplay-enemy-card">
            <div className="section-heading"><h3>Telegraphed Enemies</h3><span>deterministic</span></div>
            <div className="enemy-intent-list">
              {enemies.map((enemy) => (
                <div key={enemy.id} className={enemy.hp <= 0 ? 'is-dead' : ''}>
                  <strong>{enemy.id}</strong>
                  <span>HP {enemy.hp} · {momentumBand(enemy)}</span>
                  <em>Next: {enemy.intent?.toUpperCase() || 'WAIT'}</em>
                </div>
              ))}
            </div>
          </section>

          <section className="panel-card">
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
          </section>

          <section className="panel-card" data-gameplay-resolution-trace="momentum-thermal-v1">
            <div className="section-heading"><h3>Resolution Trace</h3><span>cause-aware</span></div>
            <p className="gameplay-resolution-text">{lastTrace}</p>
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
            </ul>
          </section>
        </aside>
      </section>
    </main>
  )
}
