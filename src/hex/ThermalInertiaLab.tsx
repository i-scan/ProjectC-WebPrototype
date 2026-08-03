import { useMemo, useState, type ChangeEvent } from 'react'
import {
  formatSignedThermal,
  thermalSideFor,
  type ActorThermalState,
  type ThermalExperimentConfig,
  type ThermalFrameResolution,
  type ThermalProjection,
  type ThermalRuleset,
  type ThermalScenario,
  type ThermalTestAction,
} from './thermalInertiaExperiment'

type ThermalInertiaLabProps = {
  open: boolean
  config: ThermalExperimentConfig
  rules: ThermalRuleset
  scenario: ThermalScenario
  state: ActorThermalState
  selectedAction: ThermalTestAction
  preview: ThermalFrameResolution
  currentProjection: ThermalProjection
  history: ThermalFrameResolution[]
  onClose: () => void
  onRulesetChange: (id: string) => void
  onScenarioChange: (id: string) => void
  onStateChange: (patch: Partial<ActorThermalState>) => void
  onActionSelect: (id: string) => void
  onResolve: () => void
  onUndo: () => void
  onRestart: () => void
  onReplay: () => void
}

function eventLabels(resolution: ThermalFrameResolution): string[] {
  const { events } = resolution.trace
  const labels: string[] = []
  if (events.capture) labels.push('Capture')
  if (events.settle) labels.push('Settle')
  if (events.crossing) labels.push('Crossing')
  if (events.overshoot) labels.push('Overshoot')
  if (events.apex) labels.push('Apex')
  if (events.boundaryClipped) labels.push('Boundary')
  return labels
}

function sideLabel(state: ActorThermalState): string {
  const side = thermalSideFor(state.temperature, state.setPoint)
  if (side === 'hot') return 'Hot'
  if (side === 'cold') return 'Cold'
  return state.drift === 0 ? 'Neutral' : 'Crossing'
}

function StateValue({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`thermal-lab-state-value${emphasis ? ' is-emphasis' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function RangeControl({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <label className="thermal-lab-range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step="1"
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))}
      />
      <output>{formatSignedThermal(value)}</output>
    </label>
  )
}

export function ThermalInertiaLab({
  open,
  config,
  rules,
  scenario,
  state,
  selectedAction,
  preview,
  currentProjection,
  history,
  onClose,
  onRulesetChange,
  onScenarioChange,
  onStateChange,
  onActionSelect,
  onResolve,
  onUndo,
  onRestart,
  onReplay,
}: ThermalInertiaLabProps) {
  const [copyStatus, setCopyStatus] = useState('')
  const previewEvents = eventLabels(preview)
  const stateOffset = state.temperature - state.setPoint
  const previewOffset = preview.after.temperature - preview.after.setPoint
  const actionSequence = useMemo(
    () => history.map((entry) => entry.trace.actionId),
    [history],
  )

  if (!open) return null

  const copySnapshot = async () => {
    const snapshot = {
      validationId: config.validationId,
      activeStage: config.activeStage,
      rulesetVersion: config.rulesetVersion,
      rulesetId: rules.id,
      scenarioId: scenario.id,
      state,
      selectedActionId: selectedAction.id,
      actionSequence,
      history: history.map((entry, index) => ({
        frame: index + 1,
        actionId: entry.trace.actionId,
        before: entry.before,
        trace: entry.trace,
        after: entry.after,
        projectedApex: entry.projectedApex.apexState,
      })),
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))
      setCopyStatus('已复制')
    } catch {
      setCopyStatus('复制失败')
    }
    window.setTimeout(() => setCopyStatus(''), 1400)
  }

  return (
    <aside className="thermal-inertia-lab" aria-label="VAL-012 Thermal Inertia Stage 1 Lab">
      <header className="thermal-lab-header">
        <div>
          <p>VAL-012 · Stage 1</p>
          <h2>Thermal Inertia Lab</h2>
        </div>
        <button type="button" className="thermal-lab-close" onClick={onClose} aria-label="关闭测试面板">×</button>
      </header>

      <section className="thermal-lab-config">
        <label>
          <span>Ruleset</span>
          <select value={rules.id} onChange={(event) => onRulesetChange(event.target.value)}>
            {config.rulesets.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Snapshot</span>
          <select value={scenario.id} onChange={(event) => onScenarioChange(event.target.value)}>
            {config.scenarios.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
            ))}
          </select>
        </label>
        <p>{scenario.description}</p>
      </section>

      <section className="thermal-lab-state-grid" aria-label="Current thermal state">
        <StateValue label="T" value={formatSignedThermal(state.temperature)} emphasis />
        <StateValue label="S" value={formatSignedThermal(state.setPoint)} />
        <StateValue label="Offset" value={formatSignedThermal(stateOffset)} />
        <StateValue label="Drift" value={formatSignedThermal(state.drift)} emphasis />
        <StateValue label="Side" value={sideLabel(state)} />
        <StateValue
          label="Apex"
          value={`${formatSignedThermal(currentProjection.apexState.temperature)} / ${currentProjection.steps} step`}
        />
      </section>

      <details className="thermal-lab-manual">
        <summary>Manual State Input</summary>
        <RangeControl
          label="Temperature"
          value={state.temperature}
          min={rules.temperatureMin}
          max={rules.temperatureMax}
          onChange={(temperature) => onStateChange({ temperature, crossingFromSide: null })}
        />
        <RangeControl
          label="Set Point"
          value={state.setPoint}
          min={rules.temperatureMin}
          max={rules.temperatureMax}
          onChange={(setPoint) => onStateChange({ setPoint, crossingFromSide: null })}
        />
        <RangeControl
          label="Drift"
          value={state.drift}
          min={rules.driftMin}
          max={rules.driftMax}
          onChange={(drift) => onStateChange({ drift, crossingFromSide: null })}
        />
      </details>

      <section className="thermal-lab-actions">
        <div className="thermal-lab-section-heading">
          <div>
            <span>Thermal Frame</span>
            <strong>选择动作 → 预览 → 结算</strong>
          </div>
          <small>Impulse → Restore → Drift → T</small>
        </div>
        <div className="thermal-lab-action-grid">
          {config.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={action.id === selectedAction.id ? 'is-selected' : ''}
              onClick={() => onActionSelect(action.id)}
              title={action.description}
            >
              <strong>{action.shortLabel}</strong>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="thermal-lab-preview" aria-label="Selected action preview">
        <div className="thermal-lab-preview-header">
          <div>
            <span>Ghost Resolution</span>
            <strong>{selectedAction.label}</strong>
          </div>
          <div className="thermal-lab-event-list">
            {previewEvents.length === 0
              ? <span className="is-muted">No event</span>
              : previewEvents.map((event) => <span key={event}>{event}</span>)}
          </div>
        </div>
        <div className="thermal-lab-preview-values">
          <span>T {formatSignedThermal(state.temperature)} → <b>{formatSignedThermal(preview.after.temperature)}</b></span>
          <span>D {formatSignedThermal(state.drift)} → <b>{formatSignedThermal(preview.after.drift)}</b></span>
          <span>Offset {formatSignedThermal(stateOffset)} → <b>{formatSignedThermal(previewOffset)}</b></span>
          <span>Apex → <b>{formatSignedThermal(preview.projectedApex.apexState.temperature)}</b></span>
        </div>
        <div className="thermal-lab-equation">
          <span>Impulse {formatSignedThermal(preview.trace.externalImpulse)}</span>
          <span>Restore {formatSignedThermal(preview.trace.restoringForce)}</span>
          <span>Merged D {formatSignedThermal(preview.trace.driftAfterRestoring)}</span>
        </div>
        <button type="button" className="thermal-lab-resolve" onClick={onResolve}>
          Resolve Thermal Frame
        </button>
      </section>

      <section className="thermal-lab-toolbar" aria-label="Experiment controls">
        <button type="button" onClick={onUndo} disabled={history.length === 0}>Undo</button>
        <button type="button" onClick={onRestart}>Restart</button>
        <button type="button" onClick={onReplay} disabled={history.length === 0}>Replay</button>
        <button type="button" onClick={copySnapshot}>Copy Snapshot</button>
        {copyStatus && <span>{copyStatus}</span>}
      </section>

      <section className="thermal-lab-log">
        <div className="thermal-lab-section-heading">
          <div>
            <span>Thermal Frame Log</span>
            <strong>{history.length} resolved</strong>
          </div>
          <small>{config.rulesetVersion}</small>
        </div>
        {history.length === 0 ? (
          <p className="thermal-lab-empty">选择测试动作并结算，记录会显示在这里。</p>
        ) : (
          <ol>
            {[...history].reverse().map((entry, reverseIndex) => {
              const frameNumber = history.length - reverseIndex
              const labels = eventLabels(entry)
              return (
                <li key={`${frameNumber}-${entry.trace.actionId}`}>
                  <header>
                    <strong>#{frameNumber} {entry.trace.actionLabel}</strong>
                    <span>{labels.join(' · ') || 'Step'}</span>
                  </header>
                  <code>
                    T {formatSignedThermal(entry.trace.temperatureBefore)} → {formatSignedThermal(entry.trace.temperatureAfter)} · D {formatSignedThermal(entry.trace.driftBefore)} + I {formatSignedThermal(entry.trace.externalImpulse)} + R {formatSignedThermal(entry.trace.restoringForce)} → {formatSignedThermal(entry.trace.driftAfter)}
                  </code>
                  <small>
                    Offset {formatSignedThermal(entry.trace.offsetBefore)} → {formatSignedThermal(entry.trace.offsetAfter)} · Apex {formatSignedThermal(entry.projectedApex.apexState.temperature)}
                  </small>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </aside>
  )
}
