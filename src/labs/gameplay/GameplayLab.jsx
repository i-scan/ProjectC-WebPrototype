import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Board3D } from '../../ui/Board3D.jsx'
import { createCellWorld } from '../../sim/world.js'
import { HEX_DIRECTIONS, axialDistance, axialKey, axialToWorld, worldToAxial } from '../../sim/hex.js'
import { createInitialState } from '../../sim/solver.js'
import { formatThermal, solveThermalSegment, thermalDiagnostics } from '../thermal/thermal-clock-model.js'
import {
  thermalActionList,
  thermalConfigFromProfile,
  thermalEnvironment,
  thermalStateFromProfile,
} from '../../thermal/thermal-profile.js'
import {
  getActiveThermalProfile,
  subscribeThermalProfile,
} from '../../thermal/thermal-profile-store.js'
import { SHARED_THERMAL_RUNTIME, resolveThermalStep } from '../../thermal/thermal-runtime.js'

const BOARD_RADIUS = 5
const PIVOT = { x: 150, y: 24 }
const TRACK_RADIUS = 112
const BOB_RADIUS = 97
const HISTORY_RADIUS = 99
const ARROW_RADIUS = 128
const ZONE_VALUES = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

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
  const previous = previousThermal ? pointAt(angleForTemperature(previousThermal.temperature, thermal.setPoint), HISTORY_RADIUS) : null
  const arrow = Math.abs(nextAngle - angle) > 0.15 ? arcPath(angle, nextAngle, ARROW_RADIUS) : ''
  const zonePaths = ZONE_VALUES.map((value) => ({ value, className: zoneClass(value), path: arcPath((value - 0.5 - thermal.setPoint) * 12, (value + 0.5 - thermal.setPoint) * 12, TRACK_RADIUS) }))
  const diagnostics = thermalDiagnostics(thermal, config)

  return (
    <div className="thermal-pendulum gameplay-thermal-pendulum" data-gameplay-thermal-pendulum="shared-runtime-v1">
      <div className="thermal-pendulum__header"><span className={diagnostics.adiabatic ? 'adiabatic is-on' : 'adiabatic'}>{diagnostics.adiabatic ? 'ADIABATIC' : 'ENV COUPLED'}</span><strong>{thermal.drift > 0.001 ? 'HOTWARD' : thermal.drift < -0.001 ? 'COLDWARD' : 'STILL'}</strong></div>
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
        <text className="thermal-pendulum__cold-label" x="14" y="163">COLD</text><text className="thermal-pendulum__set-label" x="150" y="163" textAnchor="middle">S {formatThermal(thermal.setPoint, 1)}</text><text className="thermal-pendulum__hot-label" x="286" y="163" textAnchor="end">HOT</text>
      </svg>
      <div className="thermal-pendulum__readout"><div><span>T</span><strong>{formatThermal(thermal.temperature, 2)}</strong></div><div><span>V</span><strong>{formatThermal(thermal.drift, 2)}</strong></div><div><span>Domain</span><strong>{thermalDomain(thermal.temperature)}</strong></div></div>
    </div>
  )
}

function gameplayActions(profile) {
  return [
    { id: 'basic-move', label: 'Basic Move', kind: 'move', thermalActionId: 'skip', short: 'Move 1 Cell · thermal free evolution', badge: 'MOVE' },
    ...thermalActionList(profile).map((action) => ({ id: action.id, label: action.label, kind: 'thermal', thermalActionId: action.id, short: action.sign === 0 ? 'No impulse · free evolution' : `${action.sign > 0 ? 'Hotward' : 'Coldward'} Drift impulse`, badge: action.id.toUpperCase() })),
  ]
}

function initialSpatialState() {
  return { ...createInitialState(), axisId: null }
}

export function GameplayLab() {
  const profile = useSyncExternalStore(subscribeThermalProfile, getActiveThermalProfile, getActiveThermalProfile)
  const actions = useMemo(() => gameplayActions(profile), [profile])
  const [thermal, setThermal] = useState(() => thermalStateFromProfile(getActiveThermalProfile()))
  const [previousThermal, setPreviousThermal] = useState(null)
  const [spatial, setSpatial] = useState(() => initialSpatialState())
  const [selectedActionId, setSelectedActionId] = useState('heat-ii')
  const [environmentId, setEnvironmentId] = useState('adiabatic')
  const [hoverHex, setHoverHex] = useState(null)
  const [selectedHex, setSelectedHex] = useState(null)
  const [viewMode, setViewMode] = useState('isometric')
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [history, setHistory] = useState([])
  const [lastResolution, setLastResolution] = useState('Gameplay Integration v0 ready. Select a card; Basic Move also needs a highlighted Cell.')

  const cells = useMemo(() => createCellWorld(BOARD_RADIUS), [])
  const currentHex = worldToAxial(spatial.position)
  const selectedAction = actions.find((entry) => entry.id === selectedActionId) || actions[0]
  const environment = thermalEnvironment(profile, environmentId)
  const thermalConfig = thermalConfigFromProfile(profile, environmentId)
  const preview = useMemo(() => resolveThermalStep({ state: thermal, profile, actionId: selectedAction.thermalActionId, environmentId, durationAt: 1 }), [thermal, profile, selectedAction, environmentId])

  const adjacentHexes = useMemo(() => HEX_DIRECTIONS.map((direction) => ({ q: currentHex.q + direction.q, r: currentHex.r + direction.r })).filter((hex) => axialDistance(hex) <= BOARD_RADIUS), [currentHex.q, currentHex.r])
  const reachableCells = selectedAction.kind === 'move' ? adjacentHexes.map((hex) => ({ hex, rule: 'gameplay-adjacent-move-v0' })) : []
  const moveTarget = selectedAction.kind === 'move' ? (selectedHex || hoverHex) : null
  const canCommit = selectedAction.kind !== 'move' || Boolean(selectedHex)

  const commit = () => {
    if (!canCommit) return
    const resolved = resolveThermalStep({ state: thermal, profile, actionId: selectedAction.thermalActionId, environmentId, durationAt: 1 })
    const beforeSpatial = { ...spatial, position: { ...spatial.position }, velocity: { ...spatial.velocity } }
    const beforeThermal = { ...thermal }
    const target = selectedAction.kind === 'move' ? selectedHex : null
    const nextSpatial = {
      ...spatial,
      position: target ? axialToWorld(target) : { ...spatial.position },
      worldAt: spatial.worldAt + 1,
    }
    setHistory((entries) => [...entries, {
      spatial: beforeSpatial,
      thermal: beforeThermal,
      actionId: selectedAction.id,
      thermalActionId: selectedAction.thermalActionId,
      profileId: resolved.profileId,
      profileRevision: resolved.profileRevision,
      resolvedImpulse: resolved.action.impulse,
      environmentId,
    }].slice(-40))
    setPreviousThermal(beforeThermal)
    setThermal(resolved.finalState)
    setSpatial(nextSpatial)
    setHoverHex(null)
    setSelectedHex(null)
    setLastResolution(`${selectedAction.label} · ${resolved.action.id} → ${resolved.action.impulse >= 0 ? '+' : ''}${resolved.action.impulse.toFixed(2)}V · ${resolved.profileId} r${resolved.profileRevision} · Ready T ${formatThermal(resolved.finalState.temperature, 2)} / V ${formatThermal(resolved.finalState.drift, 2)}.`)
  }

  const undo = () => {
    const previous = history.at(-1)
    if (!previous) return
    setHistory((entries) => entries.slice(0, -1))
    setSpatial(previous.spatial)
    setThermal(previous.thermal)
    setPreviousThermal(history.at(-2)?.thermal ?? null)
    setHoverHex(null)
    setSelectedHex(null)
    setLastResolution(`Undo → worldAt ${previous.spatial.worldAt.toFixed(1)}.`)
  }

  const reset = () => {
    setSpatial(initialSpatialState())
    setThermal(thermalStateFromProfile(profile))
    setPreviousThermal(null)
    setSelectedActionId('heat-ii')
    setEnvironmentId('adiabatic')
    setHoverHex(null)
    setSelectedHex(null)
    setHistory([])
    setLastResolution(`Reset from ${profile.label} r${profile.revision}.`)
  }

  useEffect(() => {
    window.__PROJECTC_GAMEPLAY_LAB__ = {
      snapshot: () => ({
        implementation: 'gameplay-thermal-integration-v0-candidate',
        runtime: SHARED_THERMAL_RUNTIME,
        profile: { id: profile.id, revision: profile.revision },
        selectedActionId,
        thermalActionId: selectedAction.thermalActionId,
        resolvedImpulse: preview.action.impulse,
        environmentId,
        spatial: { ...spatial, position: { ...spatial.position }, velocity: { ...spatial.velocity } },
        thermal: { ...thermal },
        predictedThermal: { ...preview.finalState },
        historyEntries: history.length,
      }),
      reset,
    }
    return () => { delete window.__PROJECTC_GAMEPLAY_LAB__ }
  })

  return (
    <main className="current-prototype cell-world-prototype gameplay-lab" data-implementation="gameplay-thermal-integration-v0-candidate" data-shared-thermal-runtime={SHARED_THERMAL_RUNTIME} data-profile-id={profile.id} data-profile-revision={profile.revision} data-thermal-action-id={selectedAction.thermalActionId} data-world-at={spatial.worldAt.toFixed(1)}>
      <header className="prototype-header">
        <div className="brand"><p>ProjectC · Gameplay Integration v0 Candidate</p><h1>Gameplay Lab</h1></div>
        <div className="headline-state">
          <div><span>World Time</span><strong>{spatial.worldAt.toFixed(1)} AT</strong></div>
          <div className={`thermal-${thermalDomain(thermal.temperature).toLowerCase()}`}><span>Thermal</span><strong>{thermalDomain(thermal.temperature)} · T {formatThermal(thermal.temperature, 2)}</strong></div>
          <div><span>Drift</span><strong>{formatThermal(thermal.drift, 2)} / AT</strong></div>
          <div><span>Cell</span><strong>{currentHex.q},{currentHex.r}</strong></div>
          <div><span>Profile</span><strong>{profile.id} · r{profile.revision}</strong></div>
        </div>
      </header>

      <section className="lab-grid gameplay-grid">
        <aside className="side-panel left-panel">
          <section className="panel-card actor-card"><div className="portrait">⬡</div><div><p>Gameplay Actor</p><h2>Courier</h2><span className="actor-sub">Shared Thermal runtime test</span></div></section>
          <section className="panel-card actor-vitals">
            <div className="section-heading"><h3>Actor / Thermal State</h3><span>{thermalDomain(thermal.temperature)}</span></div>
            <div className="vital-row"><span>HP</span><i><b style={{ width: '84%' }} /></i><strong>84/100</strong></div>
            <div className="vital-row thermal"><span>Thermal</span><i><b style={{ width: `${Math.max(8, Math.min(92, (thermal.temperature + 4) / 8 * 100))}%` }} /></i><strong>{formatThermal(thermal.temperature, 2)}</strong></div>
            <GameplayThermalPendulum thermal={thermal} config={thermalConfig} previousThermal={previousThermal} />
            <dl className="state-list actor-state-list"><div><dt>Cell</dt><dd>{currentHex.q},{currentHex.r}</dd></div><div><dt>Temperature</dt><dd>{formatThermal(thermal.temperature, 2)}</dd></div><div><dt>Drift</dt><dd>{formatThermal(thermal.drift, 2)}</dd></div><div><dt>Set Point</dt><dd>{formatThermal(thermal.setPoint, 2)}</dd></div><div><dt>Environment</dt><dd>{environment.label}</dd></div><div><dt>Profile Rev</dt><dd>r{profile.revision}</dd></div></dl>
          </section>
          <section className="panel-card prediction-card"><div className="section-heading"><h3>Predicted Outcome</h3><span>same solver</span></div><p>{selectedAction.kind === 'move' ? (selectedHex ? `Move to ${axialKey(selectedHex)}; Thermal uses Skip/free evolution.` : 'Select one highlighted adjacent Cell before Commit.') : `${selectedAction.label} resolves ${selectedAction.thermalActionId} from the shared Action Catalog.`}</p><dl className="state-list compact"><div><dt>Thermal Action</dt><dd>{preview.action.id}</dd></div><div><dt>Resolved ΔV</dt><dd>{preview.action.impulse >= 0 ? '+' : ''}{preview.action.impulse.toFixed(2)}</dd></div><div><dt>Ready T</dt><dd>{formatThermal(preview.finalState.temperature, 2)}</dd></div><div><dt>Ready V</dt><dd>{formatThermal(preview.finalState.drift, 2)}</dd></div><div><dt>Target Cell</dt><dd>{moveTarget ? axialKey(moveTarget) : '—'}</dd></div></dl></section>
        </aside>

        <section className="center-column">
          <div className="board-strip"><strong>{selectedAction.label} · 1AT</strong><span>{selectedAction.kind === 'move' ? (selectedHex ? `Landing Cell ${axialKey(selectedHex)} selected` : 'Click a highlighted adjacent Cell') : `${selectedAction.thermalActionId} → ${preview.action.impulse >= 0 ? '+' : ''}${preview.action.impulse.toFixed(2)} Drift`}</span></div>
          <div className="board-toolbar"><div className="view-switch"><button type="button" className={viewMode === 'isometric' ? 'active' : ''} onClick={() => setViewMode('isometric')}>3D</button><button type="button" className={viewMode === 'top' ? 'active' : ''} onClick={() => setViewMode('top')}>Top</button><button type="button" onClick={() => setCameraResetToken((value) => value + 1)}>Reset View</button></div><div className="session-buttons"><button type="button" disabled={!history.length} onClick={undo}>Undo</button><button type="button" onClick={reset}>Reset</button></div></div>
          <div className="board-frame gameplay-board-frame">
            <Board3D cells={cells} obstacles={[]} actors={[]} reachableCells={reachableCells} state={spatial} previewPlan={null} playback={null} atVisualMs={650} axisDisplayOverride="auto" boardRadius={BOARD_RADIUS} viewMode={viewMode} cameraResetToken={cameraResetToken} hoverHex={hoverHex} selectedAimHex={selectedHex} showWeather showThermal onHoverHex={(hex) => { if (selectedAction.kind !== 'move' || !hex || axialKey(hex) === axialKey(currentHex)) return setHoverHex(null); if (!adjacentHexes.some((entry) => axialKey(entry) === axialKey(hex))) return setHoverHex(null); setHoverHex(hex) }} onClickHex={(hex) => { if (selectedAction.kind !== 'move' || !hex) return; if (!adjacentHexes.some((entry) => axialKey(entry) === axialKey(hex))) return; setSelectedHex({ ...hex }); setHoverHex(null) }} />
            <div className="board-legend"><span><i className="terrain" />Bright outline = legal Basic Move Cell</span><span><i className="trajectory" />Thermal cards do not move the Actor in v0</span><span><i className="momentum-axis" />Board presentation reused from Driving Lab A</span></div>
          </div>

          <section className="action-hand gameplay-action-hand">
            <div className="hand-heading"><div><h2>Gameplay Actions · Shared Thermal IDs</h2><p>Cards store semantic IDs such as <code>heat-ii</code>; resolved ΔV always comes from the active shared Thermal Profile.</p></div><button type="button" className="gameplay-commit" disabled={!canCommit} onClick={commit}>Commit 1AT</button></div>
            <div className="action-row gameplay-action-row">{actions.map((entry) => {
              const resolved = entry.thermalActionId === 'skip' ? 0 : profile.actions[entry.thermalActionId] ? resolveThermalStep({ state: thermal, profile, actionId: entry.thermalActionId, environmentId, durationAt: 1 }).action.impulse : 0
              return <button type="button" key={entry.id} className={`action-card ${entry.id === selectedActionId ? 'selected' : ''} ${entry.thermalActionId.startsWith('heat') ? 'gameplay-heat' : entry.thermalActionId.startsWith('cool') ? 'gameplay-cool' : ''}`} data-gameplay-action-id={entry.id} data-thermal-action-id={entry.thermalActionId} onClick={() => { setSelectedActionId(entry.id); setHoverHex(null); setSelectedHex(null) }}><header><strong>{entry.label}</strong><em>{entry.badge}</em></header><p>{entry.short}</p><span>{entry.kind === 'move' ? '1AT · target Cell' : `1AT · ${entry.thermalActionId} · ${resolved >= 0 ? '+' : ''}${resolved.toFixed(2)}V`}</span></button>
            })}</div>
          </section>
        </section>

        <aside className="side-panel right-panel gameplay-right-panel">
          <section className="panel-card gameplay-profile-card" data-gameplay-profile="shared-live-v1"><div className="section-heading"><h3>Shared Thermal Profile</h3><span>LIVE</span></div><strong>{profile.label}</strong><p>{profile.id} · revision {profile.revision}</p><dl className="state-list compact"><div><dt>kS</dt><dd>{profile.dynamics.restoringK.toFixed(2)}</dd></div><div><dt>cBase</dt><dd>{profile.dynamics.baseDamping.toFixed(2)}</dd></div><div><dt>Small</dt><dd>{profile.impulseTiers.small.toFixed(2)}</dd></div><div><dt>Medium</dt><dd>{profile.impulseTiers.medium.toFixed(2)}</dd></div><div><dt>Large</dt><dd>{profile.impulseTiers.large.toFixed(2)}</dd></div></dl><small>Thermal Clock → Apply Live updates this panel and every card resolution without duplicating values.</small></section>
          <section className="panel-card"><div className="section-heading"><h3>Environment Context</h3><span>Weather hook</span></div><div className="gameplay-environment-buttons">{Object.values(profile.environments).map((entry) => <button type="button" key={entry.id} className={environmentId === entry.id ? 'chosen' : ''} onClick={() => setEnvironmentId(entry.id)}>{entry.label}</button>)}</div><dl className="state-list compact"><div><dt>Tenv</dt><dd>{environment.environmentTemperature.toFixed(1)}</dd></div><div><dt>kE</dt><dd>{environment.environmentCoupling.toFixed(2)}</dd></div><div><dt>cEff</dt><dd>{thermalDiagnostics(thermal, thermalConfig).cEff.toFixed(3)}</dd></div></dl><small>Weather Lab can later own this context; Gameplay only consumes environment ID / resolved parameters.</small></section>
          <section className="panel-card"><div className="section-heading"><h3>Resolution Trace</h3><span>reproducible</span></div><p className="gameplay-resolution-text">{lastResolution}</p>{history.at(-1) && <dl className="state-list compact"><div><dt>Action</dt><dd>{history.at(-1).actionId}</dd></div><div><dt>Thermal ID</dt><dd>{history.at(-1).thermalActionId}</dd></div><div><dt>Profile</dt><dd>{history.at(-1).profileId} r{history.at(-1).profileRevision}</dd></div><div><dt>Resolved ΔV</dt><dd>{history.at(-1).resolvedImpulse >= 0 ? '+' : ''}{history.at(-1).resolvedImpulse.toFixed(2)}</dd></div></dl>}</section>
          <section className="panel-card gameplay-scope-card"><div className="section-heading"><h3>v0 Scope</h3><span>candidate</span></div><ul><li>Shared Thermal Profile + Action Catalog</li><li>1AT Thermal resolution with same analytic solver</li><li>Driving-style board + card hand</li><li>Basic Move only as adjacent board interaction</li><li>No Weather propagation / enemy AI / full combat yet</li></ul></section>
        </aside>
      </section>
    </main>
  )
}
