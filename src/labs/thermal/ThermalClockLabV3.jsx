import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  THERMAL_ACTIONS,
  THERMAL_CLOCK_AT_RULE,
  THERMAL_CLOCK_GHOST_RULE,
  THERMAL_CLOCK_PREVIEW_RULE,
  THERMAL_CLOCK_RULE,
  THERMAL_CLOCK_SOLVER,
  THERMAL_PREVIEW_HORIZONS,
  actionImpulse,
  applyThermalImpulse,
  formatThermal,
  predictThermalAction,
  solveThermalSegment,
  thermalDiagnostics,
} from './thermal-clock-model.js'
import {
  thermalConfigFromProfile,
  thermalImpulsesFromProfile,
  thermalStateFromProfile,
  withThermalTuning,
} from '../../thermal/thermal-profile.js'
import {
  applyLiveThermalProfile,
  getActiveThermalProfile,
  loadThermalDraft,
  saveThermalDraft,
  subscribeThermalProfile,
} from '../../thermal/thermal-profile-store.js'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const copyState = (state) => ({ ...state })
const copyConfig = (config) => ({ ...config })
const copyImpulses = (impulses) => ({ ...impulses })
const PAST_WINDOWS = Object.freeze([4, 8, 12, 16])
const ZONE_VALUES = Object.freeze([-4, -3, -2, -1, 0, 1, 2, 3, 4])
const PIVOT = Object.freeze({ x: 150, y: 24 })
const TRACK_RADIUS = 112
const BOB_RADIUS = 97
const HISTORY_RADIUS = 99
const ARROW_RADIUS = 128
const DEFAULT_DIAGRAM_Y = Object.freeze({ min: -6, max: 6 })

const ENVIRONMENT_PRESETS = Object.freeze([
  { id: 'adiabatic', label: 'Adiabatic', environmentTemperature: 1, environmentCoupling: 0 },
  { id: 'mild-cold', label: 'Mild Cold', environmentTemperature: -2, environmentCoupling: 0.1 },
  { id: 'strong-cold', label: 'Strong Cold', environmentTemperature: -4, environmentCoupling: 0.3 },
  { id: 'mild-hot', label: 'Mild Hot', environmentTemperature: 3, environmentCoupling: 0.1 },
  { id: 'strong-hot', label: 'Strong Hot', environmentTemperature: 5, environmentCoupling: 0.3 },
])

const DYNAMICS_PRESETS = Object.freeze([
  { id: 'light', label: 'Light Oscillation', restoringK: 0.25, baseDamping: 0.25 },
  { id: 'critical', label: 'Near Critical', restoringK: 0.25, baseDamping: 1.0 },
  { id: 'over', label: 'Overdamped', restoringK: 0.25, baseDamping: 1.5 },
])

function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return '—'
  return Number(value).toFixed(digits)
}

function formatAt(value) {
  if (!Number.isFinite(value)) return '—'
  return `${Number(value).toFixed(2)} AT`
}

function thermalDirection(drift) {
  if (drift > 0.001) return 'HOTWARD'
  if (drift < -0.001) return 'COLDWARD'
  return 'STILL'
}

function angleForTemperature(temperature, setPoint, shouldClamp = false) {
  const angle = (temperature - setPoint) * 12
  return shouldClamp ? clamp(angle, -80, 80) : angle
}

function pointAt(angleDeg, radius) {
  const radians = angleDeg * Math.PI / 180
  return {
    x: PIVOT.x + Math.sin(radians) * radius,
    y: PIVOT.y + Math.cos(radians) * radius,
  }
}

function arcPath(startAngle, endAngle, radius = TRACK_RADIUS) {
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

function sampleFuture(state, config, horizonAt, absoluteStartAt = 0, samplesPerAt = 24) {
  const horizon = Math.max(0, Number(horizonAt) || 0)
  const count = Math.max(2, Math.round(horizon * samplesPerAt))
  return Array.from({ length: count + 1 }, (_, index) => {
    const relativeAt = horizon * (index / count)
    const solved = solveThermalSegment(state, config, relativeAt)
    return { ...solved, at: absoluteStartAt + relativeAt, relativeAt }
  })
}

function integerFuture(state, config, horizonAt, absoluteStartAt = 0) {
  const ghosts = []
  for (let offset = 1; offset <= Math.floor(horizonAt + 1e-7); offset += 1) {
    ghosts.push({ ...solveThermalSegment(state, config, offset), at: absoluteStartAt + offset, offset })
  }
  return ghosts
}

function RangeField({ label, value, min, max, step, onChange, disabled = false, suffix = '' }) {
  const update = (next) => onChange(Number(next))
  return (
    <label className="thermal-range-field">
      <span>{label}</span>
      <div className="thermal-range-field__controls">
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => update(event.target.value)} />
        <input type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => update(event.target.value)} />
        {suffix && <em>{suffix}</em>}
      </div>
    </label>
  )
}

function ThermalPendulum({ state, config, previousState, diagnostics }) {
  const currentAngle = angleForTemperature(state.temperature, state.setPoint, true)
  const current = pointAt(currentAngle, BOB_RADIUS)
  const skipNext = solveThermalSegment(state, config, 1)
  const nextAngle = angleForTemperature(skipNext.temperature, state.setPoint, true)
  const nextPoint = pointAt(nextAngle, ARROW_RADIUS)
  const arrow = Math.abs(nextAngle - currentAngle) > 0.15 ? arcPath(currentAngle, nextAngle, ARROW_RADIUS) : ''
  const previousPoint = previousState
    ? pointAt(angleForTemperature(previousState.temperature, state.setPoint, true), HISTORY_RADIUS)
    : null
  const zonePaths = ZONE_VALUES.map((value) => ({
    value,
    className: zoneClass(value),
    path: arcPath(angleForTemperature(value - 0.5, state.setPoint), angleForTemperature(value + 0.5, state.setPoint)),
  }))

  return (
    <div className="thermal-pendulum thermal-pendulum--compact" data-thermal-pendulum="inner-bob-outer-skip-v4">
      <div className="thermal-pendulum__header">
        <span className={diagnostics.adiabatic ? 'adiabatic is-on' : 'adiabatic'}>{diagnostics.adiabatic ? 'ADIABATIC' : 'ENV COUPLED'}</span>
        <strong>{thermalDirection(state.drift)}</strong>
      </div>
      <svg viewBox="0 0 300 172" role="img" aria-label="Thermal Pendulum: bob and history inside the temperature scale, Skip arrow outside">
        <defs>
          <marker id="thermal-skip-arrow-head-v4" markerWidth="7" markerHeight="7" refX="5.7" refY="3.5" orient="auto" markerUnits="strokeWidth">
            <path d="M 0 0 L 7 3.5 L 0 7 Z" />
          </marker>
        </defs>
        <g className="thermal-pendulum__zone-track" data-thermal-zone-track="pendulum-arc-v2">
          {zonePaths.map((zone) => <path key={zone.value} className={`thermal-pendulum__zone ${zone.className}`} d={zone.path} />)}
        </g>
        {previousPoint && (
          <circle className="thermal-pendulum__history-ring" data-thermal-pendulum-history-ring="previous-at-inner-v2" cx={previousPoint.x} cy={previousPoint.y} r="7" />
        )}
        {arrow ? (
          <path className="thermal-pendulum__skip-arrow" data-thermal-pendulum-skip-arrow="outer-next-at-v2" d={arrow} markerEnd="url(#thermal-skip-arrow-head-v4)" />
        ) : (
          <circle className="thermal-pendulum__skip-idle" data-thermal-pendulum-skip-arrow="outer-next-at-v2" cx={nextPoint.x} cy={nextPoint.y} r="3" />
        )}
        <circle className="thermal-pendulum__skip-next" cx={nextPoint.x} cy={nextPoint.y} r="2.6" />
        <line className="thermal-pendulum__set-line" x1={PIVOT.x} y1={PIVOT.y + 4} x2={PIVOT.x} y2={PIVOT.y + TRACK_RADIUS - 4} />
        <path className="thermal-pendulum__set-marker" d={`M ${PIVOT.x - 5} ${PIVOT.y + TRACK_RADIUS - 1} L ${PIVOT.x + 5} ${PIVOT.y + TRACK_RADIUS - 1} L ${PIVOT.x} ${PIVOT.y + TRACK_RADIUS + 7} Z`} />
        <circle className="thermal-pendulum__pivot" cx={PIVOT.x} cy={PIVOT.y} r="6" />
        <line className="thermal-pendulum__arm" x1={PIVOT.x} y1={PIVOT.y + 4} x2={current.x} y2={current.y} />
        <circle className={`thermal-pendulum__bob ${zoneClass(Math.round(clamp(state.temperature, -4, 4)))}`} cx={current.x} cy={current.y} r="9" />
        <circle className="thermal-pendulum__bob-core" cx={current.x} cy={current.y} r="2.5" />
        <text className="thermal-pendulum__cold-label" x="14" y="163">COLD</text>
        <text className="thermal-pendulum__set-label" x="150" y="163" textAnchor="middle">S {formatThermal(state.setPoint, 1)}</text>
        <text className="thermal-pendulum__hot-label" x="286" y="163" textAnchor="end">HOT</text>
      </svg>
      <div className="thermal-pendulum__legend thermal-pendulum__legend--compact">
        <span><i className="skip-arrow" /> Skip → next AT</span>
        <span><i className="history-ring" /> previous AT</span>
      </div>
      <div className="thermal-pendulum__readout">
        <div><span>Temperature T</span><strong>{formatThermal(state.temperature, 2)}</strong></div>
        <div><span>Drift V</span><strong>{formatThermal(state.drift, 2)} / AT</strong></div>
        <div><span>Set Point S</span><strong>{formatThermal(state.setPoint, 2)}</strong></div>
      </div>
    </div>
  )
}

function ThermalDiagram({ state, history, selectedFuture, skipFuture, futureGhosts, diagnostics, pastWindow, futureWindow, actionLabel, resolving, yMin, yMax }) {
  const minAt = state.worldAt - pastWindow
  const maxAt = state.worldAt + futureWindow
  const historySamples = history.flatMap((entry) => entry.samples ?? []).filter((sample) => sample.at >= minAt - 1e-6 && sample.at <= state.worldAt + 1e-6)
  const historicalIntegerPoints = history.map((entry) => entry.finalState).filter((sample) => sample && sample.worldAt >= minAt - 1e-6 && sample.worldAt <= state.worldAt + 1e-6)
  const minT = Math.min(yMin, yMax - 0.5)
  const maxT = Math.max(yMax, minT + 0.5)

  const width = 760
  const height = 250
  const pad = { left: 42, right: 18, top: 18, bottom: 30 }
  const innerWidth = width - pad.left - pad.right
  const innerHeight = height - pad.top - pad.bottom
  const xFor = (at) => pad.left + ((at - minAt) / Math.max(0.001, maxAt - minAt)) * innerWidth
  const yFor = (temperature) => pad.top + (1 - (temperature - minT) / Math.max(0.001, maxT - minT)) * innerHeight
  const pointsFor = (samples) => samples.filter((sample) => Number.isFinite(sample.temperature) && Number.isFinite(sample.at)).map((sample) => `${xFor(sample.at).toFixed(2)},${yFor(sample.temperature).toFixed(2)}`).join(' ')
  const xTicks = []
  for (let tick = Math.ceil(minAt); tick <= Math.floor(maxAt); tick += 1) xTicks.push(tick)
  const yTicks = Array.from({ length: 5 }, (_, index) => minT + (maxT - minT) * (index / 4))
  const nowX = xFor(state.worldAt)
  const setPointY = yFor(state.setPoint)
  const teqY = Number.isFinite(diagnostics.equilibriumTemperature) ? yFor(diagnostics.equilibriumTemperature) : null

  return (
    <section className="thermal-card thermal-timeline thermal-diagram" data-thermal-diagram="fixed-y-live-forecast-v3" data-thermal-y-min={minT} data-thermal-y-max={maxT}>
      <div className="thermal-section-heading">
        <div><h3>Thermal Diagram</h3><p>Solid = actual history · dashed = live future · Y range is manually fixed.</p></div>
        <span>Y {formatThermal(minT, 1)}…{formatThermal(maxT, 1)} · −{pastWindow}AT / +{futureWindow}AT</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Thermal Diagram with manually controlled Y axis">
        <defs><clipPath id="thermal-diagram-clip-v3"><rect x={pad.left} y={pad.top} width={innerWidth} height={innerHeight} /></clipPath></defs>
        <rect className="thermal-timeline__plot" x={pad.left} y={pad.top} width={innerWidth} height={innerHeight} />
        {yTicks.map((tick) => <g key={`y-${tick}`}><line className="thermal-timeline__grid" x1={pad.left} x2={width - pad.right} y1={yFor(tick)} y2={yFor(tick)} /><text className="thermal-timeline__axis-label" x={pad.left - 7} y={yFor(tick) + 3} textAnchor="end">{formatThermal(tick, 1)}</text></g>)}
        {xTicks.map((tick) => <g key={`x-${tick}`}><line className="thermal-timeline__grid" x1={xFor(tick)} x2={xFor(tick)} y1={pad.top} y2={height - pad.bottom} /><text className="thermal-timeline__axis-label" x={xFor(tick)} y={height - 10} textAnchor="middle">{tick}</text></g>)}
        <g clipPath="url(#thermal-diagram-clip-v3)">
          <line className="thermal-timeline__setpoint" x1={pad.left} x2={width - pad.right} y1={setPointY} y2={setPointY} />
          {teqY !== null && Math.abs((diagnostics.equilibriumTemperature ?? state.setPoint) - state.setPoint) > 0.01 && <line className="thermal-timeline__teq" x1={pad.left} x2={width - pad.right} y1={teqY} y2={teqY} />}
          {historySamples.length > 1 && <polyline className="thermal-timeline__history" points={pointsFor(historySamples)} />}
          {!resolving && skipFuture.length > 1 && <polyline className="thermal-timeline__skip" points={pointsFor(skipFuture)} />}
          {selectedFuture.length > 1 && <polyline className="thermal-timeline__future" points={pointsFor(selectedFuture)} />}
          <line className="thermal-timeline__now" x1={nowX} x2={nowX} y1={pad.top} y2={height - pad.bottom} />
          <circle className="thermal-timeline__current" cx={nowX} cy={yFor(state.temperature)} r="5" />
          {historicalIntegerPoints.map((sample) => <circle key={`past-${sample.worldAt}`} className="thermal-timeline__history-marker" cx={xFor(sample.worldAt)} cy={yFor(sample.temperature)} r="3.2" />)}
          <g data-thermal-integer-ghosts="diagram-live-v2">{futureGhosts.map((ghost) => <g key={`future-${ghost.offset}`}><circle className="thermal-timeline__future-marker" cx={xFor(ghost.at)} cy={yFor(ghost.temperature)} r="4" /><text className="thermal-timeline__future-label" x={xFor(ghost.at)} y={yFor(ghost.temperature) - 8} textAnchor="middle">+{ghost.offset}</text></g>)}</g>
        </g>
        {setPointY >= pad.top && setPointY <= height - pad.bottom && <text className="thermal-timeline__setpoint-label" x={width - pad.right - 4} y={setPointY - 5} textAnchor="end">S {formatThermal(state.setPoint, 1)}</text>}
        {teqY !== null && teqY >= pad.top && teqY <= height - pad.bottom && Math.abs((diagnostics.equilibriumTemperature ?? state.setPoint) - state.setPoint) > 0.01 && <text className="thermal-timeline__teq-label" x={pad.left + 5} y={teqY - 5}>Teq {formatThermal(diagnostics.equilibriumTemperature, 1)}</text>}
        <text className="thermal-timeline__now-label" x={nowX + 5} y={pad.top + 12}>NOW</text>
      </svg>
      <div className="thermal-timeline__legend">
        <span><i className="history" /> actual history</span>
        <span><i className="future" /> {resolving ? 'committed trajectory' : `${actionLabel} forecast`}</span>
        {!resolving && <span><i className="skip" /> Skip reference</span>}
        <span><i className="setpoint" /> Set Point</span>
      </div>
    </section>
  )
}

function ParameterGuide({ diagnostics, config }) {
  const currentPeriod = diagnostics.adiabatic && diagnostics.regime === 'underdamped' ? `P ≈ ${formatAt(diagnostics.dampedPeriodAt)}` : 'Set kE=0 and remain underdamped to expose a clock period.'
  return (
    <section className="thermal-card thermal-parameter-guide" data-thermal-parameter-guide="v1">
      <div className="thermal-section-heading"><h3>Parameter Guide</h3><span>focus groups</span></div>
      <div className="thermal-focus-groups">
        <article><b>Adiabatic Clock</b><span><code>kE=0</code> · tune <code>kS + cBase</code></span></article>
        <article><b>Environment Feel</b><span><code>Tenv + kE + cEnvGain</code></span></article>
        <article><b>Card Authority</b><span>impulse size + current <code>T/V</code> phase</span></article>
      </div>
      <dl className="thermal-parameter-list">
        <div><dt>kS</dt><dd>Restoring toward S. Higher = faster swing / shorter period.</dd></div>
        <div><dt>cBase</dt><dd>Intrinsic Drift damping. Higher = faster amplitude decay; enough removes oscillation.</dd></div>
        <div><dt>kE / Tenv</dt><dd>Environment coupling strength / environment target. kE=0 is adiabatic.</dd></div>
        <div><dt>cEnvGain</dt><dd>Optional extra damping contributed by environment coupling.</dd></div>
        <div><dt>T / V / Impulse</dt><dd>Current phase and action authority. They change phase/amplitude, not the unchanged system's natural period.</dd></div>
        <div><dt>Clamp / Playback</dt><dd>Debug safety / visual speed only. Diagram Y range is display-only.</dd></div>
      </dl>
      <div className="thermal-period-help" data-thermal-period-guide="adiabatic-underdamped-v1"><b>Adiabatic period</b><span><code>P = 2π / √(kS − cBase²/4)</code>. Raise kS → shorter period; keep cBase low for a near-simple harmonic clock.</span><span>Current: kS {formatNumber(config.restoringK, 2)} · cBase {formatNumber(config.baseDamping, 2)} · {currentPeriod}</span></div>
    </section>
  )
}

export function ThermalClockLab() {
  const liveProfile = useSyncExternalStore(subscribeThermalProfile, getActiveThermalProfile, getActiveThermalProfile)
  const [state, setState] = useState(() => thermalStateFromProfile(getActiveThermalProfile()))
  const [visualState, setVisualState] = useState(() => thermalStateFromProfile(getActiveThermalProfile()))
  const [config, setConfig] = useState(() => thermalConfigFromProfile(getActiveThermalProfile(), 'adiabatic'))
  const [impulses, setImpulses] = useState(() => thermalImpulsesFromProfile(getActiveThermalProfile()))
  const [selectedAction, setSelectedAction] = useState('heat-ii')
  const [previewHorizon, setPreviewHorizon] = useState(12)
  const [pastWindow, setPastWindow] = useState(8)
  const [diagramYMin, setDiagramYMin] = useState(DEFAULT_DIAGRAM_Y.min)
  const [diagramYMax, setDiagramYMax] = useState(DEFAULT_DIAGRAM_Y.max)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [playback, setPlayback] = useState(null)
  const [history, setHistory] = useState([])
  const [lastEvent, setLastEvent] = useState('Shared Thermal Profile loaded. Heat II is selected; no world time has advanced.')
  const playbackIdRef = useRef(1)

  const diagnostics = useMemo(() => thermalDiagnostics(state, config), [state, config])
  const selectedPreview = useMemo(() => predictThermalAction({ state, config, actionId: selectedAction, impulses, horizonAt: previewHorizon }), [state, config, selectedAction, impulses, previewHorizon])
  const selectedImpulse = actionImpulse(selectedAction, impulses)
  const action = THERMAL_ACTIONS.find((entry) => entry.id === selectedAction) ?? THERMAL_ACTIONS.at(-1)
  const candidateProfile = useMemo(() => withThermalTuning(liveProfile, { config, impulses }), [liveProfile, config, impulses])
  const profileDirty = JSON.stringify(candidateProfile.dynamics) !== JSON.stringify(liveProfile.dynamics) || JSON.stringify(candidateProfile.impulseTiers) !== JSON.stringify(liveProfile.impulseTiers)

  const diagramConfig = playback?.config ?? config
  const diagramDiagnostics = useMemo(() => thermalDiagnostics(visualState, diagramConfig), [visualState, diagramConfig])
  const diagramSelectedStart = useMemo(() => playback ? copyState(visualState) : applyThermalImpulse(visualState, selectedImpulse), [playback, visualState, selectedImpulse])
  const selectedFuture = useMemo(() => sampleFuture(diagramSelectedStart, diagramConfig, previewHorizon, visualState.worldAt), [diagramSelectedStart, diagramConfig, previewHorizon, visualState.worldAt])
  const skipFuture = useMemo(() => playback ? [] : sampleFuture(visualState, config, previewHorizon, visualState.worldAt), [playback, visualState, config, previewHorizon])
  const futureGhosts = useMemo(() => integerFuture(diagramSelectedStart, diagramConfig, previewHorizon, visualState.worldAt), [diagramSelectedStart, diagramConfig, previewHorizon, visualState.worldAt])
  const previousState = history.at(-1)?.state ?? null

  const updateStateField = (key, value) => {
    if (playback) return
    setState((current) => { const next = { ...current, [key]: value }; setVisualState(next); return next })
    setLastEvent(`Debug Thermal state changed: ${key}=${formatThermal(value, 2)}.`)
  }
  const updateConfigField = (key, value) => {
    if (playback) return
    setConfig((current) => ({ ...current, [key]: value }))
    setLastEvent(`Dynamics parameter changed: ${key}=${value}. Thermal Diagram recomputed without advancing AT.`)
  }
  const applyEnvironmentPreset = (preset) => {
    if (playback) return
    setConfig((current) => ({ ...current, environmentTemperature: preset.environmentTemperature, environmentCoupling: preset.environmentCoupling }))
    setLastEvent(`${preset.label} environment loaded. cEnvGain remains independently tunable.`)
  }
  const applyDynamicsPreset = (preset) => {
    if (playback) return
    setConfig((current) => ({ ...current, restoringK: preset.restoringK, baseDamping: preset.baseDamping }))
    setLastEvent(`${preset.label} dynamics loaded. Thermal Diagram updated.`)
  }
  const applyLive = () => {
    if (playback) return
    const applied = applyLiveThermalProfile(candidateProfile)
    setLastEvent(`Applied Live → ${applied.label} r${applied.revision}. Gameplay Lab now resolves the same profile.`)
  }
  const saveDraft = () => {
    if (playback) return
    saveThermalDraft(candidateProfile)
    setLastEvent(`Saved browser draft for ${candidateProfile.label}. This does not modify repository defaults.`)
  }
  const loadDraft = () => {
    if (playback) return
    const draft = loadThermalDraft()
    if (!draft) { setLastEvent('No saved Thermal Profile draft found in this browser.'); return }
    const draftConfig = thermalConfigFromProfile(draft, 'adiabatic')
    setConfig((current) => ({ ...draftConfig, environmentTemperature: current.environmentTemperature, environmentCoupling: current.environmentCoupling }))
    setImpulses(thermalImpulsesFromProfile(draft))
    setLastEvent(`Loaded draft ${draft.label} r${draft.revision} into Thermal Lab controls. Apply Live when ready.`)
  }
  const revertLive = () => {
    if (playback) return
    const liveConfig = thermalConfigFromProfile(liveProfile, 'adiabatic')
    setConfig((current) => ({ ...liveConfig, environmentTemperature: current.environmentTemperature, environmentCoupling: current.environmentCoupling }))
    setImpulses(thermalImpulsesFromProfile(liveProfile))
    setLastEvent(`Reverted tunable Dynamics / Impulses to live ${liveProfile.label} r${liveProfile.revision}.`)
  }

  const reset = () => {
    if (playback) return
    const nextState = thermalStateFromProfile(liveProfile)
    setState(nextState); setVisualState(nextState)
    setConfig(thermalConfigFromProfile(liveProfile, 'adiabatic'))
    setImpulses(thermalImpulsesFromProfile(liveProfile))
    setSelectedAction('heat-ii'); setPreviewHorizon(12); setPastWindow(8)
    setDiagramYMin(DEFAULT_DIAGRAM_Y.min); setDiagramYMax(DEFAULT_DIAGRAM_Y.max)
    setPlaybackSpeed(1); setHistory([])
    setLastEvent(`Lab reset from live ${liveProfile.label} r${liveProfile.revision}; worldAt = 0.`)
  }
  const undo = () => {
    if (playback || history.length === 0) return
    const previous = history.at(-1)
    setHistory((entries) => entries.slice(0, -1)); setState(copyState(previous.state)); setVisualState(copyState(previous.state))
    setLastEvent(`Undo lab commit → worldAt ${previous.state.worldAt.toFixed(1)}.`)
  }
  const commit = () => {
    if (playback) return
    const source = copyState(state)
    const configSnapshot = copyConfig(config)
    const impulse = actionImpulse(selectedAction, impulses)
    const afterImpulse = applyThermalImpulse(source, impulse)
    const solved = solveThermalSegment(afterImpulse, configSnapshot, 1)
    const finalState = { ...solved, worldAt: source.worldAt + 1 }
    const samples = sampleFuture(afterImpulse, configSnapshot, 1, source.worldAt, 40)
    setHistory((entries) => [...entries, { state: source, finalState, samples, actionId: selectedAction, impulse }].slice(-60))
    setPlayback({ id: playbackIdRef.current++, source, config: configSnapshot, actionId: selectedAction, afterImpulse, finalState, startedAt: performance.now(), durationMs: 650 / Math.max(0.25, playbackSpeed) })
    setLastEvent(`${action?.label ?? selectedAction} committed · resolving 1AT with the analytic solver.`)
  }

  useEffect(() => {
    if (!playback) return undefined
    let frame = 0
    const tick = (now) => {
      const progress = clamp((now - playback.startedAt) / Math.max(1, playback.durationMs), 0, 1)
      const sampled = solveThermalSegment(playback.afterImpulse, playback.config, progress)
      setVisualState({ ...sampled, worldAt: playback.source.worldAt + progress })
      if (progress >= 1) {
        setState(copyState(playback.finalState)); setVisualState(copyState(playback.finalState)); setPlayback(null)
        setLastEvent(`${THERMAL_ACTIONS.find((entry) => entry.id === playback.actionId)?.label ?? playback.actionId} Ready · T ${formatThermal(playback.finalState.temperature, 2)} · V ${formatThermal(playback.finalState.drift, 2)} · worldAt ${playback.finalState.worldAt.toFixed(1)}.`)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playback])

  useEffect(() => {
    window.__PROJECTC_THERMAL_CLOCK__ = {
      snapshot: () => ({ implementation: THERMAL_CLOCK_RULE, solver: THERMAL_CLOCK_SOLVER, atRule: THERMAL_CLOCK_AT_RULE, previewRule: THERMAL_CLOCK_PREVIEW_RULE, ghostRule: THERMAL_CLOCK_GHOST_RULE, state: copyState(state), visualState: copyState(visualState), config: copyConfig(config), impulses: copyImpulses(impulses), selectedAction, previewHorizon, pastWindow, diagramY: { min: diagramYMin, max: diagramYMax }, liveProfile: { id: liveProfile.id, revision: liveProfile.revision }, diagnostics: thermalDiagnostics(state, config), predictedReady: copyState(selectedPreview.finalState), historySegments: history.length, playback: Boolean(playback) }),
      reset,
    }
    return () => { delete window.__PROJECTC_THERMAL_CLOCK__ }
  })

  return (
    <main className="thermal-clock-lab" data-implementation={THERMAL_CLOCK_RULE} data-thermal-solver={THERMAL_CLOCK_SOLVER} data-thermal-at={THERMAL_CLOCK_AT_RULE} data-thermal-preview={THERMAL_CLOCK_PREVIEW_RULE} data-thermal-ghost={THERMAL_CLOCK_GHOST_RULE} data-thermal-adiabatic={diagnostics.adiabatic ? 'true' : 'false'} data-thermal-regime={diagnostics.regime} data-thermal-action={selectedAction} data-world-at={state.worldAt.toFixed(3)}>
      <header className="thermal-clock-header">
        <div><p>ProjectC · VAL-012 Thermal Clock Lab v0</p><h1>Thermal Clock Lab</h1></div>
        <div className="thermal-clock-headline">
          <div><span>World Time</span><strong>{visualState.worldAt.toFixed(2)} AT</strong></div><div><span>Temperature</span><strong>{formatThermal(visualState.temperature, 2)}</strong></div><div><span>Drift</span><strong>{formatThermal(visualState.drift, 2)}</strong></div><div><span>Regime</span><strong>{diagnostics.regime}</strong></div><div><span>Period</span><strong>{diagnostics.dampedPeriodAt ? formatAt(diagnostics.dampedPeriodAt) : '—'}</strong></div>
        </div>
      </header>

      <section className="thermal-profile-bar" data-thermal-profile-bridge="shared-live-v1">
        <div><span>Shared Thermal Profile</span><strong>{liveProfile.label} · r{liveProfile.revision}</strong><em>{profileDirty ? 'LOCAL TUNING DIRTY' : 'MATCHES LIVE'}</em></div>
        <div className="thermal-profile-actions"><button type="button" disabled={Boolean(playback) || !profileDirty} onClick={applyLive}>Apply Live</button><button type="button" disabled={Boolean(playback)} onClick={saveDraft}>Save Draft</button><button type="button" disabled={Boolean(playback)} onClick={loadDraft}>Load Draft</button><button type="button" disabled={Boolean(playback) || !profileDirty} onClick={revertLive}>Revert Live</button></div>
      </section>

      <section className="thermal-clock-grid">
        <aside className="thermal-panel thermal-left">
          <section className="thermal-card thermal-pendulum-card"><div className="thermal-section-heading"><h2>Thermal Pendulum</h2><span>bob/history inside · Skip outside</span></div><ThermalPendulum state={visualState} config={diagramConfig} previousState={previousState} diagnostics={diagramDiagnostics} /></section>
          <section className="thermal-card" data-thermal-state-debug><div className="thermal-section-heading"><h3>Actor Thermal State</h3><span>LAB DEBUG</span></div><RangeField label="Current T" value={state.temperature} min={-6} max={6} step={0.05} disabled={Boolean(playback)} onChange={(value) => updateStateField('temperature', value)} /><RangeField label="Current Drift V" value={state.drift} min={-3} max={3} step={0.05} disabled={Boolean(playback)} onChange={(value) => updateStateField('drift', value)} suffix="/AT" /><RangeField label="Set Point S" value={state.setPoint} min={-4} max={4} step={0.05} disabled={Boolean(playback)} onChange={(value) => updateStateField('setPoint', value)} /><p className="thermal-proxy-note">Set Point slider = <b>DEBUG / BUILD PROXY</b>. Environment does not rewrite S.</p></section>
        </aside>

        <section className="thermal-center">
          <div className={`thermal-status ${playback ? 'is-resolving' : 'is-ready'}`}><strong>{playback ? 'ACTION IN FLIGHT · DIAGRAM UPDATES FROM LIVE NOW' : 'READY · SELECT → FORECAST → COMMIT'}</strong><span>{lastEvent}</span></div>
          <ThermalDiagram state={visualState} history={history} selectedFuture={selectedFuture} skipFuture={skipFuture} futureGhosts={futureGhosts} diagnostics={diagramDiagnostics} pastWindow={pastWindow} futureWindow={previewHorizon} actionLabel={action?.label ?? selectedAction} resolving={Boolean(playback)} yMin={diagramYMin} yMax={diagramYMax} />
          <section className="thermal-board-reserved thermal-board-reserved--compact" data-thermal-board-reserved="true"><div className="thermal-board-reserved__grid" /><div><p>RESERVED BOARD</p><h2>Future Trajectory Integration</h2><span>Thermal Dynamics remains isolated while the diagram and pendulum are evaluated.</span></div></section>
          <section className="thermal-action-hand"><div className="thermal-hand-heading"><div><h2>Thermal Actions</h2><p>Selected card applies one Drift impulse now; Apply Live publishes tuned Dynamics / impulse tiers to Gameplay Lab.</p></div><button type="button" className="thermal-commit" data-thermal-commit disabled={Boolean(playback)} onClick={commit}>Commit 1AT</button></div><div className="thermal-action-row">{THERMAL_ACTIONS.map((entry) => <button type="button" key={entry.id} data-thermal-card={entry.id} className={`thermal-action-card ${entry.id === selectedAction ? 'selected' : ''} ${entry.sign > 0 ? 'heat' : entry.sign < 0 ? 'cool' : 'skip'}`} disabled={Boolean(playback)} onClick={() => { setSelectedAction(entry.id); setLastEvent(`${entry.label} selected. Thermal Diagram updated; worldAt has not advanced.`) }}><header><strong>{entry.label}</strong><em>1AT</em></header><span>{entry.sign === 0 ? 'Impulse 0' : `V ${entry.sign > 0 ? '+=' : '-='} ${formatNumber(Math.abs(actionImpulse(entry.id, impulses)), 2)}`}</span></button>)}</div><div className="thermal-impulse-tuning" data-thermal-impulses><RangeField label="Small impulse" value={impulses.small} min={0} max={2.5} step={0.05} disabled={Boolean(playback)} onChange={(value) => setImpulses((current) => ({ ...current, small: value }))} /><RangeField label="Medium impulse" value={impulses.medium} min={0} max={3} step={0.05} disabled={Boolean(playback)} onChange={(value) => setImpulses((current) => ({ ...current, medium: value }))} /><RangeField label="Large impulse" value={impulses.large} min={0} max={4} step={0.05} disabled={Boolean(playback)} onChange={(value) => setImpulses((current) => ({ ...current, large: value }))} /></div></section>
        </section>

        <aside className="thermal-panel thermal-right">
          <section className="thermal-card" data-thermal-environment><div className="thermal-section-heading"><h3>Environment</h3><span>runtime context</span></div><div className="thermal-preset-row">{ENVIRONMENT_PRESETS.map((preset) => <button type="button" key={preset.id} disabled={Boolean(playback)} onClick={() => applyEnvironmentPreset(preset)}>{preset.label}</button>)}</div><RangeField label="Tenv" value={config.environmentTemperature} min={-6} max={6} step={0.1} disabled={Boolean(playback)} onChange={(value) => updateConfigField('environmentTemperature', value)} /><RangeField label="kE" value={config.environmentCoupling} min={0} max={1} step={0.01} disabled={Boolean(playback)} onChange={(value) => updateConfigField('environmentCoupling', value)} /><RangeField label="cEnvGain" value={config.environmentDampingGain} min={0} max={4} step={0.05} disabled={Boolean(playback)} onChange={(value) => updateConfigField('environmentDampingGain', value)} /></section>
          <section className="thermal-card" data-thermal-dynamics><div className="thermal-section-heading"><h3>Dynamics</h3><span>shared profile tuning</span></div><div className="thermal-preset-row">{DYNAMICS_PRESETS.map((preset) => <button type="button" key={preset.id} disabled={Boolean(playback)} onClick={() => applyDynamicsPreset(preset)}>{preset.label}</button>)}</div><RangeField label="kS · restoring" value={config.restoringK} min={0} max={2} step={0.01} disabled={Boolean(playback)} onChange={(value) => updateConfigField('restoringK', value)} /><RangeField label="cBase · damping" value={config.baseDamping} min={0} max={3} step={0.01} disabled={Boolean(playback)} onChange={(value) => updateConfigField('baseDamping', value)} /><div className="thermal-clamp-row"><RangeField label="Clamp Min" value={config.clampMin} min={-12} max={0} step={0.5} disabled={Boolean(playback)} onChange={(value) => updateConfigField('clampMin', value)} /><RangeField label="Clamp Max" value={config.clampMax} min={0} max={12} step={0.5} disabled={Boolean(playback)} onChange={(value) => updateConfigField('clampMax', value)} /></div></section>
          <section className="thermal-card thermal-diagnostics" data-thermal-diagnostics><div className="thermal-section-heading"><h3>Derived Diagnostics</h3><span>solver</span></div><dl><div><dt>K</dt><dd>{formatNumber(diagnostics.K)}</dd></div><div><dt>Teq</dt><dd>{formatThermal(diagnostics.equilibriumTemperature, 3)}</dd></div><div><dt>cEff</dt><dd>{formatNumber(diagnostics.cEff)}</dd></div><div><dt>D</dt><dd>{formatNumber(diagnostics.discriminant)}</dd></div><div><dt>Regime</dt><dd>{diagnostics.regime}</dd></div><div><dt>Adiabatic</dt><dd>{diagnostics.adiabatic ? 'YES' : 'NO'}</dd></div><div><dt>Damped Period</dt><dd>{diagnostics.dampedPeriodAt ? formatAt(diagnostics.dampedPeriodAt) : '—'}</dd></div><div><dt>Decay / cycle</dt><dd>{Number.isFinite(diagnostics.amplitudeDecayPerCycle) ? `${(diagnostics.amplitudeDecayPerCycle * 100).toFixed(1)}%` : '—'}</dd></div></dl></section>
          <section className="thermal-card" data-thermal-preview-controls><div className="thermal-section-heading"><h3>Diagram / Playback</h3><span>display only</span></div><label className="thermal-choice-label">Past history shown</label><div className="thermal-choice-row" role="group" aria-label="Past History Window" data-thermal-past-window>{PAST_WINDOWS.map((windowAt) => <button type="button" key={windowAt} className={pastWindow === windowAt ? 'selected' : ''} disabled={Boolean(playback)} onClick={() => setPastWindow(windowAt)}>{windowAt} AT</button>)}</div><label className="thermal-choice-label">Future forecast shown</label><div className="thermal-choice-row" role="group" aria-label="Preview Horizon" data-thermal-future-window>{THERMAL_PREVIEW_HORIZONS.map((horizon) => <button type="button" key={horizon} className={previewHorizon === horizon ? 'selected' : ''} disabled={Boolean(playback)} onClick={() => setPreviewHorizon(horizon)}>{horizon} AT</button>)}</div><div className="thermal-clamp-row" data-thermal-diagram-y-range="manual-v1"><RangeField label="Diagram Y Min" value={diagramYMin} min={-12} max={0} step={0.5} disabled={Boolean(playback)} onChange={(value) => setDiagramYMin(Math.min(value, diagramYMax - 0.5))} /><RangeField label="Diagram Y Max" value={diagramYMax} min={0} max={12} step={0.5} disabled={Boolean(playback)} onChange={(value) => setDiagramYMax(Math.max(value, diagramYMin + 0.5))} /></div><RangeField label="Playback speed" value={playbackSpeed} min={0.25} max={2.5} step={0.25} disabled={Boolean(playback)} onChange={setPlaybackSpeed} suffix="×" /><div className="thermal-session-buttons"><button type="button" disabled={Boolean(playback) || history.length === 0} onClick={undo}>Undo 1 step</button><button type="button" disabled={Boolean(playback)} onClick={reset}>Reset Lab</button></div></section>
          <ParameterGuide diagnostics={diagnostics} config={config} />
        </aside>
      </section>
    </main>
  )
}
