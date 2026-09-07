import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_THERMAL_CONFIG,
  DEFAULT_THERMAL_IMPULSES,
  DEFAULT_THERMAL_STATE,
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
  thermalEventDiagnostics,
} from './thermal-clock-model.js'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const copyState = (state) => ({ ...state })
const copyConfig = (config) => ({ ...config })
const copyImpulses = (impulses) => ({ ...impulses })
const TIMELINE_PAST_WINDOWS = Object.freeze([4, 8, 12, 16])
const PENDULUM_ZONE_VALUES = Object.freeze([-4, -3, -2, -1, 0, 1, 2, 3, 4])
const PENDULUM_PIVOT = Object.freeze({ x: 150, y: 25 })
const PENDULUM_TRACK_RADIUS = 118
const PENDULUM_BOB_RADIUS = 94
const PENDULUM_FORECAST_RADIUS = 132

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

function dialAngleForTemperature(temperature, setPoint, shouldClamp = false) {
  const angle = (temperature - setPoint) * 12
  return shouldClamp ? clamp(angle, -80, 80) : angle
}

function pendulumPoint(angleDeg, radius = PENDULUM_TRACK_RADIUS) {
  const radians = angleDeg * Math.PI / 180
  return {
    x: PENDULUM_PIVOT.x + Math.sin(radians) * radius,
    y: PENDULUM_PIVOT.y + Math.cos(radians) * radius,
  }
}

function sampledArcPath(startAngle, endAngle, radius = PENDULUM_TRACK_RADIUS) {
  const steps = Math.max(3, Math.ceil(Math.abs(endAngle - startAngle) / 3))
  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps
    const point = pendulumPoint(startAngle + (endAngle - startAngle) * progress, radius)
    return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  }).join(' ')
}

function pendulumForecastPath(samples, setPoint) {
  if (!samples?.length) return ''
  return samples.map((sample, index) => {
    const point = pendulumPoint(dialAngleForTemperature(sample.temperature, setPoint, true), PENDULUM_FORECAST_RADIUS)
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

function ThermalPendulum({ state, selectedPreview, futureSamples, diagnostics }) {
  const currentAngle = dialAngleForTemperature(state.temperature, state.setPoint, true)
  const current = pendulumPoint(currentAngle, PENDULUM_BOB_RADIUS)
  const selectedGhosts = (selectedPreview?.ghosts ?? []).slice(0, 4)
  const zonePaths = PENDULUM_ZONE_VALUES.map((value) => ({
    value,
    className: zoneClass(value),
    path: sampledArcPath(
      dialAngleForTemperature(value - 0.5, state.setPoint),
      dialAngleForTemperature(value + 0.5, state.setPoint),
      PENDULUM_TRACK_RADIUS,
    ),
  }))
  const forecastPath = pendulumForecastPath(futureSamples, state.setPoint)

  return (
    <div className="thermal-pendulum" data-thermal-pendulum="temperature-relative-set-point-v2" data-thermal-ghost-count={selectedPreview?.ghosts?.length ?? 0}>
      <div className="thermal-pendulum__header">
        <span className={diagnostics.adiabatic ? 'adiabatic is-on' : 'adiabatic'}>{diagnostics.adiabatic ? 'ADIABATIC' : 'ENV COUPLED'}</span>
        <strong>{thermalDirection(state.drift)}</strong>
      </div>
      <svg viewBox="0 0 300 188" role="img" aria-label="Thermal Pendulum; colored temperature zones follow the physical pendulum track">
        <g className="thermal-pendulum__zone-track" data-thermal-zone-track="pendulum-arc-v1">
          {zonePaths.map((zone) => <path key={zone.value} className={`thermal-pendulum__zone ${zone.className}`} d={zone.path} />)}
        </g>

        {forecastPath && <path className="thermal-pendulum__forecast-path" d={forecastPath} data-thermal-pendulum-forecast="selected-action-dashed-v1" />}

        {selectedGhosts.map((ghost) => {
          const point = pendulumPoint(dialAngleForTemperature(ghost.temperature, state.setPoint, true), PENDULUM_FORECAST_RADIUS)
          return (
            <g key={`selected-${ghost.at}`} className="thermal-pendulum__ghost-group">
              <circle className="thermal-pendulum__ghost thermal-pendulum__ghost--selected" cx={point.x} cy={point.y} r="4.5" />
              <text x={point.x + 7} y={point.y - 5}>+{ghost.at}AT</text>
            </g>
          )
        })}

        <line className="thermal-pendulum__set-line" x1={PENDULUM_PIVOT.x} y1={PENDULUM_PIVOT.y + 5} x2={PENDULUM_PIVOT.x} y2={PENDULUM_PIVOT.y + PENDULUM_TRACK_RADIUS - 5} />
        <path className="thermal-pendulum__set-marker" d={`M ${PENDULUM_PIVOT.x - 5} ${PENDULUM_PIVOT.y + PENDULUM_TRACK_RADIUS - 1} L ${PENDULUM_PIVOT.x + 5} ${PENDULUM_PIVOT.y + PENDULUM_TRACK_RADIUS - 1} L ${PENDULUM_PIVOT.x} ${PENDULUM_PIVOT.y + PENDULUM_TRACK_RADIUS + 7} Z`} />
        <circle className="thermal-pendulum__pivot" cx={PENDULUM_PIVOT.x} cy={PENDULUM_PIVOT.y} r="6" />
        <line className="thermal-pendulum__arm" x1={PENDULUM_PIVOT.x} y1={PENDULUM_PIVOT.y + 4} x2={current.x} y2={current.y} />
        <circle className={`thermal-pendulum__bob ${zoneClass(Math.round(clamp(state.temperature, -4, 4)))}`} cx={current.x} cy={current.y} r="12" />
        <circle className="thermal-pendulum__bob-core" cx={current.x} cy={current.y} r="3.2" />
        <text className="thermal-pendulum__cold-label" x="14" y="174">COLD</text>
        <text className="thermal-pendulum__set-label" x="150" y="174" textAnchor="middle">S {formatThermal(state.setPoint, 1)}</text>
        <text className="thermal-pendulum__hot-label" x="286" y="174" textAnchor="end">HOT</text>
      </svg>
      <div className="thermal-pendulum__legend">
        <span><i className="forecast" /> selected action → future free evolution</span>
        <span><i className="integer" /> integer AT sample</span>
      </div>
      <div className="thermal-pendulum__readout">
        <div><span>Temperature T</span><strong>{formatThermal(state.temperature, 2)}</strong></div>
        <div><span>Drift V</span><strong>{formatThermal(state.drift, 2)} / AT</strong></div>
        <div><span>Set Point S</span><strong>{formatThermal(state.setPoint, 2)}</strong></div>
      </div>
    </div>
  )
}

function ThermalTimeline({
  state,
  history,
  selectedFuture,
  skipFuture,
  selectedGhosts,
  config,
  diagnostics,
  pastWindow,
  futureWindow,
  actionLabel,
}) {
  const minAt = state.worldAt - pastWindow
  const maxAt = state.worldAt + futureWindow
  const historySamples = history
    .flatMap((entry) => entry.samples ?? [])
    .filter((sample) => sample.at >= minAt - 1e-6 && sample.at <= state.worldAt + 1e-6)
  const historicalIntegerPoints = history
    .map((entry) => entry.finalState)
    .filter((sample) => sample && sample.worldAt >= minAt - 1e-6 && sample.worldAt <= state.worldAt + 1e-6)
  const visibleValues = [
    state.temperature,
    ...historySamples.map((sample) => sample.temperature),
    ...selectedFuture.map((sample) => sample.temperature),
    ...skipFuture.map((sample) => sample.temperature),
  ].filter(Number.isFinite)
  const valueMin = visibleValues.length ? Math.min(...visibleValues) : state.setPoint
  const valueMax = visibleValues.length ? Math.max(...visibleValues) : state.setPoint
  let minT = Math.min(state.setPoint - 2.5, valueMin - 0.35)
  let maxT = Math.max(state.setPoint + 2.5, valueMax + 0.35)
  minT = Math.max(config.clampMin, minT)
  maxT = Math.min(config.clampMax, maxT)
  if (maxT - minT < 1) {
    const center = (maxT + minT) / 2
    minT = center - 0.5
    maxT = center + 0.5
  }

  const width = 760
  const height = 250
  const pad = { left: 42, right: 18, top: 18, bottom: 30 }
  const innerWidth = width - pad.left - pad.right
  const innerHeight = height - pad.top - pad.bottom
  const xFor = (at) => pad.left + ((at - minAt) / Math.max(0.001, maxAt - minAt)) * innerWidth
  const yFor = (temperature) => pad.top + (1 - (temperature - minT) / Math.max(0.001, maxT - minT)) * innerHeight
  const pointsFor = (samples, atField = 'at') => samples
    .filter((sample) => Number.isFinite(sample.temperature) && Number.isFinite(sample[atField]))
    .map((sample) => `${xFor(sample[atField]).toFixed(2)},${yFor(sample.temperature).toFixed(2)}`)
    .join(' ')

  const historyPolyline = pointsFor(historySamples)
  const futurePolyline = pointsFor(selectedFuture)
  const skipPolyline = pointsFor(skipFuture)
  const xTicks = []
  for (let tick = Math.ceil(minAt); tick <= Math.floor(maxAt); tick += 1) xTicks.push(tick)
  const yTicks = Array.from({ length: 5 }, (_, index) => minT + (maxT - minT) * (index / 4))
  const nowX = xFor(state.worldAt)
  const setPointY = yFor(state.setPoint)
  const teqY = Number.isFinite(diagnostics.equilibriumTemperature) ? yFor(diagnostics.equilibriumTemperature) : null

  return (
    <section className="thermal-card thermal-timeline" data-thermal-timeline="history-current-selected-future-v1">
      <div className="thermal-section-heading">
        <div><h3>Thermal History + Forecast</h3><p>Past commits are solid. Future = selected card now, then no more impulses.</p></div>
        <span>−{pastWindow}AT / +{futureWindow}AT</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Continuous thermal history and selected-action future forecast">
        <rect className="thermal-timeline__plot" x={pad.left} y={pad.top} width={innerWidth} height={innerHeight} />
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line className="thermal-timeline__grid" x1={pad.left} x2={width - pad.right} y1={yFor(tick)} y2={yFor(tick)} />
            <text className="thermal-timeline__axis-label" x={pad.left - 7} y={yFor(tick) + 3} textAnchor="end">{formatThermal(tick, 1)}</text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={`x-${tick}`}>
            <line className={`thermal-timeline__grid ${Math.abs(tick - state.worldAt) < 1e-6 ? 'now' : ''}`} x1={xFor(tick)} x2={xFor(tick)} y1={pad.top} y2={height - pad.bottom} />
            <text className="thermal-timeline__axis-label" x={xFor(tick)} y={height - 10} textAnchor="middle">{tick}</text>
          </g>
        ))}
        <line className="thermal-timeline__setpoint" x1={pad.left} x2={width - pad.right} y1={setPointY} y2={setPointY} />
        <text className="thermal-timeline__setpoint-label" x={width - pad.right - 4} y={setPointY - 5} textAnchor="end">S {formatThermal(state.setPoint, 1)}</text>
        {teqY !== null && Math.abs((diagnostics.equilibriumTemperature ?? state.setPoint) - state.setPoint) > 0.01 && (
          <>
            <line className="thermal-timeline__teq" x1={pad.left} x2={width - pad.right} y1={teqY} y2={teqY} />
            <text className="thermal-timeline__teq-label" x={pad.left + 5} y={teqY - 5}>Teq {formatThermal(diagnostics.equilibriumTemperature, 1)}</text>
          </>
        )}
        {historyPolyline && <polyline className="thermal-timeline__history" points={historyPolyline} />}
        {skipPolyline && <polyline className="thermal-timeline__skip" points={skipPolyline} />}
        {futurePolyline && <polyline className="thermal-timeline__future" points={futurePolyline} />}
        <line className="thermal-timeline__now" x1={nowX} x2={nowX} y1={pad.top} y2={height - pad.bottom} />
        <circle className="thermal-timeline__current" cx={nowX} cy={yFor(state.temperature)} r="5" />
        {historicalIntegerPoints.map((sample) => (
          <circle key={`past-${sample.worldAt}`} className="thermal-timeline__history-marker" cx={xFor(sample.worldAt)} cy={yFor(sample.temperature)} r="3.2" />
        ))}
        <g data-thermal-integer-ghosts="timeline-v1">
          {selectedGhosts.map((ghost) => {
            const at = state.worldAt + ghost.at
            return (
              <g key={`future-${ghost.at}`}>
                <circle className="thermal-timeline__future-marker" cx={xFor(at)} cy={yFor(ghost.temperature)} r="4" />
                <text className="thermal-timeline__future-label" x={xFor(at)} y={yFor(ghost.temperature) - 8} textAnchor="middle">+{ghost.at}</text>
              </g>
            )
          })}
        </g>
        <text className="thermal-timeline__now-label" x={nowX + 5} y={pad.top + 12}>NOW</text>
      </svg>
      <div className="thermal-timeline__legend">
        <span><i className="history" /> actual history</span>
        <span><i className="future" /> {actionLabel} forecast</span>
        <span><i className="skip" /> Skip / no impulse reference</span>
        <span><i className="setpoint" /> Set Point</span>
      </div>
    </section>
  )
}

function ParameterGuide({ diagnostics, config }) {
  const adiabaticFormula = diagnostics.adiabatic && diagnostics.regime === 'underdamped'
    ? `P ≈ ${formatAt(diagnostics.dampedPeriodAt)}`
    : 'Set kE=0 and remain underdamped to use the clock-period formula.'
  return (
    <section className="thermal-card thermal-parameter-guide" data-thermal-parameter-guide="v1">
      <div className="thermal-section-heading"><h3>Parameter Guide</h3><span>what actually changes what</span></div>
      <div className="thermal-focus-groups">
        <article><b>Adiabatic Clock</b><span><code>kE=0</code> · tune <code>kS + cBase</code></span></article>
        <article><b>Environment Feel</b><span><code>Tenv + kE + cEnvGain</code></span></article>
        <article><b>Card Authority</b><span>impulse size + current <code>T/V</code> phase</span></article>
      </div>
      <dl className="thermal-parameter-list">
        <div><dt>kS</dt><dd>Intrinsic restoring toward S. Higher = faster swing / shorter period. Primary adiabatic period knob.</dd></div>
        <div><dt>cBase</dt><dd>Intrinsic Drift damping. Higher = amplitude dies faster; enough damping removes oscillation. Also slightly lengthens the underdamped period.</dd></div>
        <div><dt>kE</dt><dd>Environment coupling. 0 = adiabatic. Higher pulls harder toward Tenv and also adds to total restoring K.</dd></div>
        <div><dt>Tenv</dt><dd>Environment target temperature. Changes equilibrium direction/offset; does not affect adiabatic motion when kE=0.</dd></div>
        <div><dt>cEnvGain</dt><dd>Extra damping generated by kE. Has no effect when kE=0. Main A/B knob for making strong environments less oscillatory.</dd></div>
        <div><dt>S</dt><dd>Actor thermal center. Shifts the pendulum center; in this linear model it does not set the period.</dd></div>
        <div><dt>T / V</dt><dd>Current position and velocity. They change amplitude and phase, not the system coefficients.</dd></div>
        <div><dt>Impulse</dt><dd>Heat/Cool changes V instantly. It changes phase/amplitude but not the natural period of an unchanged linear parameter set.</dd></div>
        <div><dt>Clamp</dt><dd>Debug safety boundary only. If hit, it clips the analytic result and can distort the apparent motion.</dd></div>
        <div><dt>Playback</dt><dd>Visual speed only. It never changes gameplay AT or the solver.</dd></div>
      </dl>
      <div className="thermal-period-help" data-thermal-period-guide="adiabatic-underdamped-v1">
        <b>To tune the adiabatic pendulum period</b>
        <span>Set <code>kE = 0</code>. For underdamped motion: <code>P = 2π / √(kS − cBase²/4)</code>.</span>
        <span>So: raise <code>kS</code> → shorter period; lower <code>kS</code> → longer period. Keep <code>cBase</code> low if you want something close to a simple harmonic pendulum.</span>
        <span>Current: kS {formatNumber(config.restoringK, 2)} · cBase {formatNumber(config.baseDamping, 2)} · {adiabaticFormula}</span>
      </div>
    </section>
  )
}

export function ThermalClockLab() {
  const [state, setState] = useState(() => copyState(DEFAULT_THERMAL_STATE))
  const [visualState, setVisualState] = useState(() => copyState(DEFAULT_THERMAL_STATE))
  const [config, setConfig] = useState(() => copyConfig(DEFAULT_THERMAL_CONFIG))
  const [impulses, setImpulses] = useState(() => copyImpulses(DEFAULT_THERMAL_IMPULSES))
  const [selectedAction, setSelectedAction] = useState('heat-ii')
  const [previewHorizon, setPreviewHorizon] = useState(12)
  const [pastWindow, setPastWindow] = useState(8)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [playback, setPlayback] = useState(null)
  const [history, setHistory] = useState([])
  const [lastEvent, setLastEvent] = useState('Stage-1 baseline loaded. Heat II is selected for preview; no world time has advanced.')
  const playbackIdRef = useRef(1)

  const diagnostics = useMemo(() => thermalDiagnostics(state, config), [state, config])
  const selectedPreview = useMemo(() => predictThermalAction({ state, config, actionId: selectedAction, impulses, horizonAt: previewHorizon }), [state, config, selectedAction, impulses, previewHorizon])
  const skipPreview = useMemo(() => predictThermalAction({ state, config, actionId: 'skip', impulses, horizonAt: previewHorizon }), [state, config, impulses, previewHorizon])
  const selectedImpulse = actionImpulse(selectedAction, impulses)
  const selectedPostImpulse = useMemo(() => applyThermalImpulse(state, selectedImpulse), [state, selectedImpulse])
  const selectedFuture = useMemo(() => sampleFuture(selectedPostImpulse, config, previewHorizon, state.worldAt), [selectedPostImpulse, config, previewHorizon, state.worldAt])
  const skipFuture = useMemo(() => sampleFuture(state, config, previewHorizon, state.worldAt), [state, config, previewHorizon])
  const eventDiagnostics = useMemo(() => thermalEventDiagnostics(selectedPostImpulse, config, previewHorizon), [selectedPostImpulse, config, previewHorizon])
  const action = THERMAL_ACTIONS.find((entry) => entry.id === selectedAction) ?? THERMAL_ACTIONS.at(-1)

  const updateStateField = (key, value) => {
    if (playback) return
    setState((current) => {
      const next = { ...current, [key]: value }
      setVisualState(next)
      return next
    })
    setLastEvent(`Debug Thermal state changed: ${key}=${formatThermal(value, 2)}.`)
  }

  const updateConfigField = (key, value) => {
    if (playback) return
    setConfig((current) => ({ ...current, [key]: value }))
    setLastEvent(`Dynamics parameter changed: ${key}=${value}. Full future curve recomputed without advancing AT.`)
  }

  const applyEnvironmentPreset = (preset) => {
    if (playback) return
    setConfig((current) => ({ ...current, environmentTemperature: preset.environmentTemperature, environmentCoupling: preset.environmentCoupling }))
    setLastEvent(`${preset.label} environment loaded. cEnvGain remains independently tunable.`)
  }

  const applyDynamicsPreset = (preset) => {
    if (playback) return
    setConfig((current) => ({ ...current, restoringK: preset.restoringK, baseDamping: preset.baseDamping }))
    setLastEvent(`${preset.label} dynamics loaded. Timeline forecast updated.`)
  }

  const reset = () => {
    if (playback) return
    const nextState = copyState(DEFAULT_THERMAL_STATE)
    setState(nextState)
    setVisualState(nextState)
    setConfig(copyConfig(DEFAULT_THERMAL_CONFIG))
    setImpulses(copyImpulses(DEFAULT_THERMAL_IMPULSES))
    setSelectedAction('heat-ii')
    setPreviewHorizon(12)
    setPastWindow(8)
    setPlaybackSpeed(1)
    setHistory([])
    setLastEvent('Stage-1 baseline reset. Heat II forecast selected; worldAt = 0.')
  }

  const undo = () => {
    if (playback || history.length === 0) return
    const previous = history.at(-1)
    setHistory((entries) => entries.slice(0, -1))
    setState(copyState(previous.state))
    setVisualState(copyState(previous.state))
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
    setPlayback({
      id: playbackIdRef.current++,
      source,
      config: configSnapshot,
      actionId: selectedAction,
      impulse,
      afterImpulse,
      finalState,
      startedAt: performance.now(),
      durationMs: 650 / Math.max(0.25, playbackSpeed),
    })
    setLastEvent(`${action?.label ?? selectedAction} committed · impulse ${formatThermal(impulse, 2)} · resolving 1AT with analytic solver.`)
  }

  useEffect(() => {
    if (!playback) return undefined
    let frame = 0
    const tick = (now) => {
      const progress = clamp((now - playback.startedAt) / Math.max(1, playback.durationMs), 0, 1)
      const sampled = solveThermalSegment(playback.afterImpulse, playback.config, progress)
      setVisualState({ ...sampled, worldAt: playback.source.worldAt + progress })
      if (progress >= 1) {
        setState(copyState(playback.finalState))
        setVisualState(copyState(playback.finalState))
        setPlayback(null)
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
      snapshot: () => ({
        implementation: THERMAL_CLOCK_RULE,
        solver: THERMAL_CLOCK_SOLVER,
        atRule: THERMAL_CLOCK_AT_RULE,
        previewRule: THERMAL_CLOCK_PREVIEW_RULE,
        ghostRule: THERMAL_CLOCK_GHOST_RULE,
        state: copyState(state),
        config: copyConfig(config),
        impulses: copyImpulses(impulses),
        selectedAction,
        previewHorizon,
        pastWindow,
        diagnostics: thermalDiagnostics(state, config),
        predictedReady: copyState(selectedPreview.finalState),
        skipReady: copyState(skipPreview.finalState),
        historySegments: history.length,
        playback: Boolean(playback),
      }),
      reset,
    }
    return () => { delete window.__PROJECTC_THERMAL_CLOCK__ }
  })

  return (
    <main
      className="thermal-clock-lab"
      data-implementation={THERMAL_CLOCK_RULE}
      data-thermal-solver={THERMAL_CLOCK_SOLVER}
      data-thermal-at={THERMAL_CLOCK_AT_RULE}
      data-thermal-preview={THERMAL_CLOCK_PREVIEW_RULE}
      data-thermal-ghost={THERMAL_CLOCK_GHOST_RULE}
      data-thermal-adiabatic={diagnostics.adiabatic ? 'true' : 'false'}
      data-thermal-regime={diagnostics.regime}
      data-thermal-action={selectedAction}
      data-world-at={state.worldAt.toFixed(3)}
    >
      <header className="thermal-clock-header">
        <div>
          <p>ProjectC · VAL-012 Thermal Clock Lab v0</p>
          <h1>Thermal Clock Lab</h1>
        </div>
        <div className="thermal-clock-headline">
          <div><span>World Time</span><strong>{visualState.worldAt.toFixed(2)} AT</strong></div>
          <div><span>Temperature</span><strong>{formatThermal(visualState.temperature, 2)}</strong></div>
          <div><span>Drift</span><strong>{formatThermal(visualState.drift, 2)}</strong></div>
          <div><span>Regime</span><strong>{diagnostics.regime}</strong></div>
          <div><span>Period</span><strong>{diagnostics.dampedPeriodAt ? formatAt(diagnostics.dampedPeriodAt) : '—'}</strong></div>
        </div>
      </header>

      <section className="thermal-clock-grid">
        <aside className="thermal-panel thermal-left">
          <section className="thermal-card thermal-pendulum-card">
            <div className="thermal-section-heading"><h2>Thermal Pendulum</h2><span>temperature zones follow the swing track</span></div>
            <ThermalPendulum state={visualState} selectedPreview={selectedPreview} futureSamples={selectedFuture} diagnostics={diagnostics} />
          </section>

          <section className="thermal-card" data-thermal-state-debug>
            <div className="thermal-section-heading"><h3>Actor Thermal State</h3><span>LAB DEBUG</span></div>
            <RangeField label="Current T" value={state.temperature} min={-6} max={6} step={0.05} disabled={Boolean(playback)} onChange={(value) => updateStateField('temperature', value)} />
            <RangeField label="Current Drift V" value={state.drift} min={-3} max={3} step={0.05} disabled={Boolean(playback)} onChange={(value) => updateStateField('drift', value)} suffix="/AT" />
            <RangeField label="Set Point S" value={state.setPoint} min={-4} max={4} step={0.05} disabled={Boolean(playback)} onChange={(value) => updateStateField('setPoint', value)} />
            <p className="thermal-proxy-note">Set Point slider = <b>DEBUG / BUILD PROXY</b>. Environment does not rewrite S.</p>
          </section>

          <section className="thermal-card thermal-next-events">
            <div className="thermal-section-heading"><h3>Next Events</h3><span>selected action forecast</span></div>
            <dl>
              <div><dt>Next Apex</dt><dd>{formatAt(eventDiagnostics.nextApexAt)}</dd></div>
              <div><dt>Next S crossing</dt><dd>{formatAt(eventDiagnostics.nextSetPointCrossingAt)}</dd></div>
              <div><dt>Next Ready T</dt><dd>{formatThermal(selectedPreview.finalState.temperature, 2)}</dd></div>
              <div><dt>Next Ready V</dt><dd>{formatThermal(selectedPreview.finalState.drift, 2)}</dd></div>
            </dl>
          </section>
        </aside>

        <section className="thermal-center">
          <div className={`thermal-status ${playback ? 'is-resolving' : 'is-ready'}`}>
            <strong>{playback ? 'ACTION IN FLIGHT · ANALYTIC T(t), V(t)' : 'READY · SELECT → FORECAST → COMMIT'}</strong>
            <span>{lastEvent}</span>
          </div>

          <ThermalTimeline
            state={visualState}
            history={history}
            selectedFuture={selectedFuture}
            skipFuture={skipFuture}
            selectedGhosts={selectedPreview.ghosts ?? []}
            config={config}
            diagnostics={diagnostics}
            pastWindow={pastWindow}
            futureWindow={previewHorizon}
            actionLabel={action?.label ?? selectedAction}
          />

          <section className="thermal-board-reserved thermal-board-reserved--compact" data-thermal-board-reserved="true">
            <div className="thermal-board-reserved__grid" />
            <div>
              <p>RESERVED BOARD</p>
              <h2>Future Trajectory Integration</h2>
              <span>Thermal Dynamics remains isolated while the timeline and pendulum are evaluated.</span>
            </div>
          </section>

          <section className="thermal-action-hand">
            <div className="thermal-hand-heading">
              <div><h2>Thermal Actions</h2><p>Selected card applies one impulse now; the forecast after that is free evolution under the current parameters.</p></div>
              <button type="button" className="thermal-commit" data-thermal-commit disabled={Boolean(playback)} onClick={commit}>Commit 1AT</button>
            </div>
            <div className="thermal-action-row">
              {THERMAL_ACTIONS.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  data-thermal-card={entry.id}
                  className={`thermal-action-card ${entry.id === selectedAction ? 'selected' : ''} ${entry.sign > 0 ? 'heat' : entry.sign < 0 ? 'cool' : 'skip'}`}
                  disabled={Boolean(playback)}
                  onClick={() => {
                    setSelectedAction(entry.id)
                    setLastEvent(`${entry.label} selected. Full future curve updated; worldAt has not advanced.`)
                  }}
                >
                  <header><strong>{entry.label}</strong><em>1AT</em></header>
                  <span>{entry.sign === 0 ? 'Impulse 0' : `V ${entry.sign > 0 ? '+=' : '-='} ${formatNumber(Math.abs(actionImpulse(entry.id, impulses)), 2)}`}</span>
                </button>
              ))}
            </div>
            <div className="thermal-impulse-tuning" data-thermal-impulses>
              <RangeField label="Small impulse" value={impulses.small} min={0} max={2.5} step={0.05} disabled={Boolean(playback)} onChange={(value) => setImpulses((current) => ({ ...current, small: value }))} />
              <RangeField label="Medium impulse" value={impulses.medium} min={0} max={3} step={0.05} disabled={Boolean(playback)} onChange={(value) => setImpulses((current) => ({ ...current, medium: value }))} />
              <RangeField label="Large impulse" value={impulses.large} min={0} max={4} step={0.05} disabled={Boolean(playback)} onChange={(value) => setImpulses((current) => ({ ...current, large: value }))} />
            </div>
          </section>
        </section>

        <aside className="thermal-panel thermal-right">
          <section className="thermal-card" data-thermal-environment>
            <div className="thermal-section-heading"><h3>Environment</h3><span>equilibrium + damping</span></div>
            <div className="thermal-preset-row">
              {ENVIRONMENT_PRESETS.map((preset) => <button type="button" key={preset.id} disabled={Boolean(playback)} onClick={() => applyEnvironmentPreset(preset)}>{preset.label}</button>)}
            </div>
            <RangeField label="Tenv" value={config.environmentTemperature} min={-6} max={6} step={0.1} disabled={Boolean(playback)} onChange={(value) => updateConfigField('environmentTemperature', value)} />
            <RangeField label="kE" value={config.environmentCoupling} min={0} max={1} step={0.01} disabled={Boolean(playback)} onChange={(value) => updateConfigField('environmentCoupling', value)} />
            <RangeField label="cEnvGain" value={config.environmentDampingGain} min={0} max={4} step={0.05} disabled={Boolean(playback)} onChange={(value) => updateConfigField('environmentDampingGain', value)} />
          </section>

          <section className="thermal-card" data-thermal-dynamics>
            <div className="thermal-section-heading"><h3>Dynamics</h3><span>period + intrinsic damping</span></div>
            <div className="thermal-preset-row">
              {DYNAMICS_PRESETS.map((preset) => <button type="button" key={preset.id} disabled={Boolean(playback)} onClick={() => applyDynamicsPreset(preset)}>{preset.label}</button>)}
            </div>
            <RangeField label="kS · restoring" value={config.restoringK} min={0} max={2} step={0.01} disabled={Boolean(playback)} onChange={(value) => updateConfigField('restoringK', value)} />
            <RangeField label="cBase · damping" value={config.baseDamping} min={0} max={3} step={0.01} disabled={Boolean(playback)} onChange={(value) => updateConfigField('baseDamping', value)} />
            <div className="thermal-clamp-row">
              <RangeField label="Clamp Min" value={config.clampMin} min={-12} max={0} step={0.5} disabled={Boolean(playback)} onChange={(value) => updateConfigField('clampMin', value)} />
              <RangeField label="Clamp Max" value={config.clampMax} min={0} max={12} step={0.5} disabled={Boolean(playback)} onChange={(value) => updateConfigField('clampMax', value)} />
            </div>
          </section>

          <section className="thermal-card thermal-diagnostics" data-thermal-diagnostics>
            <div className="thermal-section-heading"><h3>Derived Diagnostics</h3><span>solver</span></div>
            <dl>
              <div><dt>K</dt><dd>{formatNumber(diagnostics.K)}</dd></div>
              <div><dt>Teq</dt><dd>{formatThermal(diagnostics.equilibriumTemperature, 3)}</dd></div>
              <div><dt>cEff</dt><dd>{formatNumber(diagnostics.cEff)}</dd></div>
              <div><dt>D</dt><dd>{formatNumber(diagnostics.discriminant)}</dd></div>
              <div><dt>Regime</dt><dd>{diagnostics.regime}</dd></div>
              <div><dt>Adiabatic</dt><dd>{diagnostics.adiabatic ? 'YES' : 'NO'}</dd></div>
              <div><dt>Damped Period</dt><dd>{diagnostics.dampedPeriodAt ? formatAt(diagnostics.dampedPeriodAt) : '—'}</dd></div>
              <div><dt>Decay / cycle</dt><dd>{Number.isFinite(diagnostics.amplitudeDecayPerCycle) ? `${(diagnostics.amplitudeDecayPerCycle * 100).toFixed(1)}%` : '—'}</dd></div>
            </dl>
          </section>

          <section className="thermal-card" data-thermal-preview-controls>
            <div className="thermal-section-heading"><h3>Timeline / Playback</h3><span>display window</span></div>
            <label className="thermal-choice-label">Past history shown</label>
            <div className="thermal-choice-row" role="group" aria-label="Past History Window" data-thermal-past-window>
              {TIMELINE_PAST_WINDOWS.map((windowAt) => <button type="button" key={windowAt} className={pastWindow === windowAt ? 'selected' : ''} disabled={Boolean(playback)} onClick={() => setPastWindow(windowAt)}>{windowAt} AT</button>)}
            </div>
            <label className="thermal-choice-label">Future forecast shown</label>
            <div className="thermal-choice-row" role="group" aria-label="Preview Horizon" data-thermal-future-window>
              {THERMAL_PREVIEW_HORIZONS.map((horizon) => <button type="button" key={horizon} className={previewHorizon === horizon ? 'selected' : ''} disabled={Boolean(playback)} onClick={() => setPreviewHorizon(horizon)}>{horizon} AT</button>)}
            </div>
            <RangeField label="Playback speed" value={playbackSpeed} min={0.25} max={2.5} step={0.25} disabled={Boolean(playback)} onChange={setPlaybackSpeed} suffix="×" />
            <div className="thermal-session-buttons">
              <button type="button" disabled={Boolean(playback) || history.length === 0} onClick={undo}>Undo 1 step</button>
              <button type="button" disabled={Boolean(playback)} onClick={reset}>Reset Lab</button>
            </div>
          </section>

          <ParameterGuide diagnostics={diagnostics} config={config} />
        </aside>
      </section>
    </main>
  )
}
