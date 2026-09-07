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

function angleForTemperature(temperature, setPoint) {
  return clamp((temperature - setPoint) * 18, -74, 74)
}

function pendulumPoint(angleDeg, length = 118) {
  const radians = angleDeg * Math.PI / 180
  return {
    x: 150 + Math.sin(radians) * length,
    y: 26 + Math.cos(radians) * length,
  }
}

function curvePoints(path, clampMin, clampMax, width = 300, height = 110) {
  if (!path?.length) return ''
  const range = Math.max(0.001, clampMax - clampMin)
  return path.map((sample, index) => {
    const x = (index / Math.max(1, path.length - 1)) * width
    const normalized = clamp((sample.temperature - clampMin) / range, 0, 1)
    const y = height - normalized * height
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
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

function ThermalPendulum({ state, selectedPreview, skipPreview, horizon, diagnostics }) {
  const currentAngle = angleForTemperature(state.temperature, state.setPoint)
  const current = pendulumPoint(currentAngle)
  const selectedGhosts = (selectedPreview?.ghosts ?? []).slice(0, Math.min(4, horizon))
  const skipGhosts = (skipPreview?.ghosts ?? []).slice(0, Math.min(4, horizon))

  return (
    <div className="thermal-pendulum" data-thermal-pendulum="temperature-relative-set-point-v1" data-thermal-ghost-count={selectedPreview?.ghosts?.length ?? 0}>
      <div className="thermal-pendulum__header">
        <span className={diagnostics.adiabatic ? 'adiabatic is-on' : 'adiabatic'}>{diagnostics.adiabatic ? 'ADIABATIC' : 'ENV COUPLED'}</span>
        <strong>{thermalDirection(state.drift)}</strong>
      </div>
      <svg viewBox="0 0 300 190" role="img" aria-label="Thermal Pendulum; position is Temperature and lowest point is Set Point">
        <defs>
          <linearGradient id="thermal-clock-arc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#63b6e7" />
            <stop offset="50%" stopColor="#a9b8c3" />
            <stop offset="100%" stopColor="#ef8665" />
          </linearGradient>
        </defs>
        <path className="thermal-pendulum__arc" d="M 38 138 Q 150 8 262 138" />
        <line className="thermal-pendulum__set-line" x1="150" y1="28" x2="150" y2="155" />
        <circle className="thermal-pendulum__pivot" cx="150" cy="26" r="6" />

        {skipGhosts.map((ghost) => {
          const point = pendulumPoint(angleForTemperature(ghost.temperature, state.setPoint), 104)
          return <circle key={`skip-${ghost.at}`} className="thermal-pendulum__ghost thermal-pendulum__ghost--skip" cx={point.x} cy={point.y} r="4" />
        })}

        {selectedGhosts.map((ghost) => {
          const point = pendulumPoint(angleForTemperature(ghost.temperature, state.setPoint), 118)
          return (
            <g key={`selected-${ghost.at}`} className="thermal-pendulum__ghost-group">
              <circle className="thermal-pendulum__ghost thermal-pendulum__ghost--selected" cx={point.x} cy={point.y} r="5" />
              <text x={point.x + 7} y={point.y - 5}>+{ghost.at}AT</text>
            </g>
          )
        })}

        <line className="thermal-pendulum__arm" x1="150" y1="26" x2={current.x} y2={current.y} />
        <circle className="thermal-pendulum__bob" cx={current.x} cy={current.y} r="13" />
        <text className="thermal-pendulum__cold-label" x="16" y="164">COLD</text>
        <text className="thermal-pendulum__set-label" x="150" y="176" textAnchor="middle">S {formatThermal(state.setPoint, 1)}</text>
        <text className="thermal-pendulum__hot-label" x="284" y="164" textAnchor="end">HOT</text>
      </svg>
      <div className="thermal-pendulum__readout">
        <div><span>Temperature T</span><strong>{formatThermal(state.temperature, 2)}</strong></div>
        <div><span>Drift V</span><strong>{formatThermal(state.drift, 2)} / AT</strong></div>
        <div><span>Set Point S</span><strong>{formatThermal(state.setPoint, 2)}</strong></div>
      </div>
    </div>
  )
}

function PreviewCurve({ selectedPreview, skipPreview, config }) {
  const selected = curvePoints(selectedPreview?.path, config.clampMin, config.clampMax)
  const skip = curvePoints(skipPreview?.path, config.clampMin, config.clampMax)
  return (
    <svg className="thermal-preview-curve" viewBox="0 0 300 110" preserveAspectRatio="none" aria-label="Selected action and Skip 1AT thermal trajectories">
      <line x1="0" y1="55" x2="300" y2="55" />
      {skip && <polyline className="skip" points={skip} />}
      {selected && <polyline className="selected" points={selected} />}
    </svg>
  )
}

export function ThermalClockLab() {
  const [state, setState] = useState(() => copyState(DEFAULT_THERMAL_STATE))
  const [visualState, setVisualState] = useState(() => copyState(DEFAULT_THERMAL_STATE))
  const [config, setConfig] = useState(() => copyConfig(DEFAULT_THERMAL_CONFIG))
  const [impulses, setImpulses] = useState(() => copyImpulses(DEFAULT_THERMAL_IMPULSES))
  const [selectedAction, setSelectedAction] = useState('heat-ii')
  const [previewHorizon, setPreviewHorizon] = useState(4)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [playback, setPlayback] = useState(null)
  const [history, setHistory] = useState([])
  const [lastEvent, setLastEvent] = useState('Stage-1 baseline loaded. Heat II is selected for preview; no world time has advanced.')
  const playbackIdRef = useRef(1)

  const diagnostics = useMemo(() => thermalDiagnostics(state, config), [state, config])
  const selectedPreview = useMemo(() => predictThermalAction({
    state,
    config,
    actionId: selectedAction,
    impulses,
    horizonAt: previewHorizon,
  }), [state, config, selectedAction, impulses, previewHorizon])
  const skipPreview = useMemo(() => predictThermalAction({
    state,
    config,
    actionId: 'skip',
    impulses,
    horizonAt: previewHorizon,
  }), [state, config, impulses, previewHorizon])
  const selectedImpulse = actionImpulse(selectedAction, impulses)
  const selectedPostImpulse = useMemo(() => applyThermalImpulse(state, selectedImpulse), [state, selectedImpulse])
  const eventDiagnostics = useMemo(
    () => thermalEventDiagnostics(selectedPostImpulse, config, previewHorizon),
    [selectedPostImpulse, config, previewHorizon],
  )
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
    setLastEvent(`Dynamics parameter changed: ${key}=${value}. Preview recomputed without advancing AT.`)
  }

  const applyEnvironmentPreset = (preset) => {
    if (playback) return
    setConfig((current) => ({
      ...current,
      environmentTemperature: preset.environmentTemperature,
      environmentCoupling: preset.environmentCoupling,
    }))
    setLastEvent(`${preset.label} environment loaded. cEnvGain remains independently tunable.`)
  }

  const applyDynamicsPreset = (preset) => {
    if (playback) return
    setConfig((current) => ({ ...current, restoringK: preset.restoringK, baseDamping: preset.baseDamping }))
    setLastEvent(`${preset.label} dynamics loaded.`)
  }

  const reset = () => {
    if (playback) return
    const nextState = copyState(DEFAULT_THERMAL_STATE)
    setState(nextState)
    setVisualState(nextState)
    setConfig(copyConfig(DEFAULT_THERMAL_CONFIG))
    setImpulses(copyImpulses(DEFAULT_THERMAL_IMPULSES))
    setSelectedAction('heat-ii')
    setPreviewHorizon(4)
    setPlaybackSpeed(1)
    setHistory([])
    setLastEvent('Stage-1 baseline reset. Heat II preview selected; worldAt = 0.')
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
    setHistory((entries) => [...entries, { state: source }].slice(-30))
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
        diagnostics: thermalDiagnostics(state, config),
        predictedReady: copyState(selectedPreview.finalState),
        skipReady: copyState(skipPreview.finalState),
        playback: Boolean(playback),
      }),
      reset,
    }
    return () => { delete window.__PROJECTC_THERMAL_CLOCK__ }
  })

  const selectedPath = selectedPreview.path
  const skipPath = skipPreview.path

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
          <div><span>State</span><strong>{playback ? 'RESOLVING' : 'READY'}</strong></div>
        </div>
      </header>

      <section className="thermal-clock-grid">
        <aside className="thermal-panel thermal-left">
          <section className="thermal-card thermal-pendulum-card">
            <div className="thermal-section-heading"><h2>Thermal Pendulum</h2><span>position = T · lowest = S</span></div>
            <ThermalPendulum state={visualState} selectedPreview={selectedPreview} skipPreview={skipPreview} horizon={previewHorizon} diagnostics={diagnostics} />
          </section>

          <section className="thermal-card" data-thermal-state-debug>
            <div className="thermal-section-heading"><h3>Actor Thermal State</h3><span>LAB DEBUG</span></div>
            <RangeField label="Current T" value={state.temperature} min={-6} max={6} step={0.05} disabled={Boolean(playback)} onChange={(value) => updateStateField('temperature', value)} />
            <RangeField label="Current Drift V" value={state.drift} min={-3} max={3} step={0.05} disabled={Boolean(playback)} onChange={(value) => updateStateField('drift', value)} suffix="/AT" />
            <RangeField label="Set Point S" value={state.setPoint} min={-4} max={4} step={0.05} disabled={Boolean(playback)} onChange={(value) => updateStateField('setPoint', value)} />
            <p className="thermal-proxy-note">Set Point slider = <b>DEBUG / BUILD PROXY</b>. Environment does not rewrite S.</p>
          </section>

          <section className="thermal-card thermal-ghost-readout">
            <div className="thermal-section-heading"><h3>Thermal Clock</h3><span>{previewHorizon} AT horizon</span></div>
            <div className="thermal-ghost-table" data-thermal-integer-ghosts>
              {(selectedPreview.ghosts ?? []).map((ghost) => (
                <div key={ghost.at}><b>+{ghost.at}AT</b><span>T {formatThermal(ghost.temperature, 2)}</span><span>V {formatThermal(ghost.drift, 2)}</span></div>
              ))}
            </div>
          </section>
        </aside>

        <section className="thermal-center">
          <div className={`thermal-status ${playback ? 'is-resolving' : 'is-ready'}`}>
            <strong>{playback ? 'ACTION IN FLIGHT · ANALYTIC T(t), V(t)' : 'READY · SELECT → PREVIEW → COMMIT'}</strong>
            <span>{lastEvent}</span>
          </div>

          <section className="thermal-board-reserved" data-thermal-board-reserved="true">
            <div className="thermal-board-reserved__grid" />
            <div>
              <p>RESERVED BOARD</p>
              <h2>Future Trajectory Integration</h2>
              <span>Stage 1 intentionally isolates Thermal Dynamics. No temporary board interaction is added here.</span>
            </div>
          </section>

          <section className="thermal-card thermal-projection" data-thermal-projection>
            <div className="thermal-section-heading"><h3>1AT Projection</h3><span>same solver as Commit</span></div>
            <PreviewCurve selectedPreview={selectedPreview} skipPreview={skipPreview} config={config} />
            <div className="thermal-projection-pair">
              <article className="skip">
                <b>SKIP / NO IMPULSE</b>
                <span>T {formatThermal(skipPreview.finalState.temperature, 3)}</span>
                <span>V {formatThermal(skipPreview.finalState.drift, 3)}</span>
              </article>
              <article className="selected">
                <b>{action?.label?.toUpperCase()}</b>
                <span>Impulse {formatThermal(selectedImpulse, 2)}</span>
                <span>T {formatThermal(selectedPreview.finalState.temperature, 3)}</span>
                <span>V {formatThermal(selectedPreview.finalState.drift, 3)}</span>
              </article>
            </div>
            <div className="thermal-path-debug">
              <span>Selected path samples: {selectedPath.length}</span>
              <span>Skip samples: {skipPath.length}</span>
              <span>Preview worldAt remains {state.worldAt.toFixed(1)} until Commit.</span>
            </div>
          </section>

          <section className="thermal-action-hand">
            <div className="thermal-hand-heading">
              <div><h2>Thermal Actions</h2><p>All stage-1 cards cost 1AT and only apply an instantaneous Drift impulse.</p></div>
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
                    setLastEvent(`${entry.label} selected. Preview updated; worldAt has not advanced.`)
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
            <div className="thermal-section-heading"><h3>Environment</h3><span>acts on Drift / equilibrium, not S</span></div>
            <div className="thermal-preset-row">
              {ENVIRONMENT_PRESETS.map((preset) => <button type="button" key={preset.id} disabled={Boolean(playback)} onClick={() => applyEnvironmentPreset(preset)}>{preset.label}</button>)}
            </div>
            <RangeField label="Tenv" value={config.environmentTemperature} min={-6} max={6} step={0.1} disabled={Boolean(playback)} onChange={(value) => updateConfigField('environmentTemperature', value)} />
            <RangeField label="kE" value={config.environmentCoupling} min={0} max={1} step={0.01} disabled={Boolean(playback)} onChange={(value) => updateConfigField('environmentCoupling', value)} />
            <RangeField label="cEnvGain" value={config.environmentDampingGain} min={0} max={4} step={0.05} disabled={Boolean(playback)} onChange={(value) => updateConfigField('environmentDampingGain', value)} />
          </section>

          <section className="thermal-card" data-thermal-dynamics>
            <div className="thermal-section-heading"><h3>Dynamics</h3><span>candidate coefficients</span></div>
            <div className="thermal-preset-row">
              {DYNAMICS_PRESETS.map((preset) => <button type="button" key={preset.id} disabled={Boolean(playback)} onClick={() => applyDynamicsPreset(preset)}>{preset.label}</button>)}
            </div>
            <RangeField label="kS" value={config.restoringK} min={0} max={2} step={0.01} disabled={Boolean(playback)} onChange={(value) => updateConfigField('restoringK', value)} />
            <RangeField label="cBase" value={config.baseDamping} min={0} max={3} step={0.01} disabled={Boolean(playback)} onChange={(value) => updateConfigField('baseDamping', value)} />
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
              <div><dt>Next Apex</dt><dd>{formatAt(eventDiagnostics.nextApexAt)}</dd></div>
              <div><dt>Next S crossing</dt><dd>{formatAt(eventDiagnostics.nextSetPointCrossingAt)}</dd></div>
            </dl>
          </section>

          <section className="thermal-card" data-thermal-preview-controls>
            <div className="thermal-section-heading"><h3>Preview / Playback</h3><span>UI time ≠ AT</span></div>
            <div className="thermal-choice-row" role="group" aria-label="Preview Horizon">
              {THERMAL_PREVIEW_HORIZONS.map((horizon) => <button type="button" key={horizon} className={previewHorizon === horizon ? 'selected' : ''} disabled={Boolean(playback)} onClick={() => setPreviewHorizon(horizon)}>{horizon} AT</button>)}
            </div>
            <RangeField label="Playback speed" value={playbackSpeed} min={0.25} max={2.5} step={0.25} disabled={Boolean(playback)} onChange={setPlaybackSpeed} suffix="×" />
            <div className="thermal-session-buttons">
              <button type="button" disabled={Boolean(playback) || history.length === 0} onClick={undo}>Undo 1 step</button>
              <button type="button" disabled={Boolean(playback)} onClick={reset}>Reset Lab</button>
            </div>
          </section>
        </aside>
      </section>
    </main>
  )
}
