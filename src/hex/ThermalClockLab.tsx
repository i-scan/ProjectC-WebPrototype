import { useMemo, useState, type ChangeEvent, type CSSProperties } from 'react'
import {
  deriveThermalState,
  formatThermalNumber,
  type ActorThermalState,
  type ThermalActionResolution,
  type ThermalClockAction,
  type ThermalClockExperimentConfig,
  type ThermalClockRuleset,
  type ThermalClockScenario,
  type ThermalSessionState,
} from './thermalClockExperiment'

type ThermalClockLabProps = {
  open: boolean
  embedded?: boolean
  config: ThermalClockExperimentConfig
  rules: ThermalClockRuleset
  scenario: ThermalClockScenario
  session: ThermalSessionState
  selectedAction: ThermalClockAction
  preview: ThermalActionResolution
  history: ThermalActionResolution[]
  resolving: boolean
  onClose?: () => void
  onRulesetChange: (id: string) => void
  onScenarioChange: (id: string) => void
  onStateChange: (patch: Partial<ActorThermalState>) => void
  onActionSelect: (id: string) => void
  onResolve: () => void
  onUndo: () => void
  onRestart: () => void
  onReplay: () => void
}

const PRIMARY_ACTION_IDS = new Set([
  'flow-1at',
  'heat-contact',
  'cool-contact',
  'push-hot',
  'push-cold',
  'stabilize',
])

const embeddedRootStyle = {
  '--lab-border': 'rgba(151, 193, 198, .16)',
  position: 'static',
  inset: 'auto',
  zIndex: 'auto',
  display: 'block',
  minWidth: 0,
  width: '100%',
  maxWidth: '100%',
  minHeight: 0,
  maxHeight: 'none',
  margin: 0,
  padding: 0,
  overflow: 'visible',
  border: 0,
  borderRadius: 0,
  background: 'transparent',
  boxShadow: 'none',
  transform: 'none',
  boxSizing: 'border-box',
} as CSSProperties

function phaseLabel(phaseBeat: number | null): string {
  if (phaseBeat === null) return 'Neutral'
  if (phaseBeat < 1) return 'Hot Apex → Set Point'
  if (phaseBeat < 2) return 'Set Point → Cold Apex'
  if (phaseBeat < 3) return 'Cold Apex → Set Point'
  return 'Set Point → Hot Apex'
}

function sideLabel(side: 'cold' | 'neutral' | 'hot', neutral: boolean): string {
  if (neutral) return 'Neutral'
  if (side === 'hot') return 'Hot'
  if (side === 'cold') return 'Cold'
  return 'Crossing'
}

function eventLabelList(resolution: ThermalActionResolution): string[] {
  const labels: string[] = []
  if (resolution.summary.capture) labels.push('Capture')
  if (resolution.summary.settle) labels.push('Settle')
  if (resolution.summary.crossing) labels.push('Crossing')
  if (resolution.summary.overshoot) labels.push('Overshoot')
  if (resolution.summary.apex) labels.push('Apex')
  return labels
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
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className="thermal-lab-range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))}
      />
      <output>{formatThermalNumber(value)}</output>
    </label>
  )
}

function ActionButton({
  action,
  selected,
  disabled,
  onSelect,
}: {
  action: ThermalClockAction
  selected: boolean
  disabled: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      className={selected ? 'is-selected' : ''}
      onClick={() => onSelect(action.id)}
      title={action.description}
      disabled={disabled}
    >
      <strong>{action.shortLabel}</strong>
      <span>{action.label}</span>
      <small>{action.baseApCost} AP · {action.baseActionTime} AT</small>
    </button>
  )
}

export function ThermalClockLab({
  open,
  embedded = false,
  config,
  rules,
  scenario,
  session,
  selectedAction,
  preview,
  history,
  resolving,
  onClose,
  onRulesetChange,
  onScenarioChange,
  onStateChange,
  onActionSelect,
  onResolve,
  onUndo,
  onRestart,
  onReplay,
}: ThermalClockLabProps) {
  const [copyStatus, setCopyStatus] = useState('')
  const current = deriveThermalState(session.thermal, rules)
  const immediate = deriveThermalState(preview.immediate.thermal, rules)
  const final = deriveThermalState(preview.after.thermal, rules)
  const currentTemperature = session.thermal.setPoint + session.thermal.offset
  const previewLabels = eventLabelList(preview)
  const previewEventSummary = previewLabels.join(' · ') || 'No anchor event'
  const actionSequence = useMemo(
    () => history.map((entry) => entry.actionId),
    [history],
  )
  const baseBeatAt = rules.thermalPeriodAt / 4
  const actionBeatAdvance = baseBeatAt <= 0 ? 0 : selectedAction.baseActionTime / baseBeatAt
  const primaryActions = config.actions.filter((action) => PRIMARY_ACTION_IDS.has(action.id))
  const advancedActions = config.actions.filter((action) => !PRIMARY_ACTION_IDS.has(action.id))

  if (!open) return null

  const copySnapshot = async () => {
    const snapshot = {
      validationId: config.validationId,
      activeStage: config.activeStage,
      rulesetId: config.rulesetId,
      implementationId: config.implementationId,
      rulesetVersion: config.rulesetVersion,
      ruleset: rules,
      scenarioId: scenario.id,
      session,
      selectedActionId: selectedAction.id,
      actionSequence,
      preview,
      history,
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))
      setCopyStatus('已复制')
    } catch {
      setCopyStatus('复制失败')
    }
    window.setTimeout(() => setCopyStatus(''), 1400)
  }

  const rootClassName = [
    embedded ? 'thermal-clock-inline-root' : 'thermal-inertia-lab',
    'thermal-clock-lab',
    embedded ? 'is-embedded' : '',
    resolving ? 'is-resolving' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={rootClassName}
      style={embedded ? embeddedRootStyle : undefined}
      aria-label="VAL-012 Thermal Clock and Action Time Inspector"
    >
      <header className="thermal-lab-header">
        <div>
          <p>VAL-012 · TC1 · Hex6</p>
          <h2>Thermal Clock Inspector</h2>
        </div>
        {!embedded && onClose && (
          <button type="button" className="thermal-lab-close" onClick={onClose} aria-label="关闭测试面板">×</button>
        )}
      </header>

      <section className="thermal-lab-config thermal-clock-setup">
        <label>
          <span>Clock / Ruleset</span>
          <select value={rules.id} disabled={resolving} onChange={(event: ChangeEvent<HTMLSelectElement>) => onRulesetChange(event.target.value)}>
            {config.rulesets.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Scenario</span>
          <select value={scenario.id} disabled={resolving} onChange={(event: ChangeEvent<HTMLSelectElement>) => onScenarioChange(event.target.value)}>
            {config.scenarios.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
            ))}
          </select>
        </label>
        <p>{scenario.description}</p>
      </section>

      <section className="thermal-clock-overview" aria-label="Current thermal clock state">
        <div className="thermal-lab-state-grid">
          <StateValue label="Temperature" value={formatThermalNumber(current.temperature)} emphasis />
          <StateValue label="Drift" value={formatThermalNumber(session.thermal.drift)} emphasis />
          <StateValue label="Phase" value={current.phaseBeat === null ? '—' : current.phaseBeat.toFixed(2)} />
          <StateValue label="World Time" value={`${session.elapsedAt.toFixed(2)} AT`} />
        </div>
        <p className="thermal-clock-state-meta">
          Set Point {formatThermalNumber(session.thermal.setPoint)} · Offset {formatThermalNumber(session.thermal.offset)} · {sideLabel(current.side, current.neutral)} · Period {rules.thermalPeriodAt} AT
        </p>
      </section>

      <section className="thermal-clock-phase-card">
        <div className="thermal-lab-section-heading">
          <div>
            <span>Current Phase</span>
            <strong>{phaseLabel(current.phaseBeat)}</strong>
          </div>
          <small>{rules.thermalPeriodAt} AT / Period</small>
        </div>
        <small className="thermal-clock-period-explanation">
          完整 Period 固定为 4 个等长相位；总 AT 只改变每相位时长。
        </small>
        <div className="thermal-clock-phase-axis" aria-label="Thermal Clock phase">
          {['Hot Apex', '→ Cold', 'Cold Apex', '→ Hot'].map((label, index) => (
            <div key={label} className={current.phaseBeat !== null && Math.floor(current.phaseBeat) === index ? 'is-active' : ''}>
              <i />
              <span>{label}</span>
            </div>
          ))}
          {current.phaseBeat !== null && (
            <b style={{ left: `${Math.min(100, Math.max(0, current.phaseBeat / 4 * 100))}%` }} />
          )}
        </div>
      </section>

      <details className="thermal-lab-manual thermal-clock-advanced-state">
        <summary>状态参数与手动输入</summary>
        <div className="thermal-clock-diagnostic-grid">
          <StateValue label="Set Point" value={formatThermalNumber(session.thermal.setPoint)} />
          <StateValue label="Offset" value={formatThermalNumber(session.thermal.offset)} />
          <StateValue label="Base Beat" value={`${formatThermalNumber(baseBeatAt, 1)} AT`} />
          <StateValue label="Amplitude" value={formatThermalNumber(current.amplitude)} />
          <StateValue label="Next Apex" value={formatThermalNumber(current.projectedApexTemperature)} />
          <StateValue label="Side" value={sideLabel(current.side, current.neutral)} />
        </div>
        <RangeControl
          label="Temperature"
          value={currentTemperature}
          min={config.display.temperatureMin}
          max={config.display.temperatureMax}
          step={0.1}
          onChange={(temperature) => onStateChange({ offset: temperature - session.thermal.setPoint })}
        />
        <RangeControl
          label="Set Point"
          value={session.thermal.setPoint}
          min={config.display.setPointMin}
          max={config.display.setPointMax}
          step={0.25}
          onChange={(setPoint) => onStateChange({ setPoint, offset: currentTemperature - setPoint })}
        />
        <RangeControl
          label="Drift"
          value={session.thermal.drift}
          min={-config.display.driftVisualMax * 1.5}
          max={config.display.driftVisualMax * 1.5}
          step={0.1}
          onChange={(drift) => onStateChange({ drift })}
        />
      </details>

      <section className="thermal-lab-actions">
        <div className="thermal-lab-section-heading">
          <div>
            <span>1 · Select Test Action</span>
            <strong>卡牌、移动和攻击会自动推进；这里用于规则对照</strong>
          </div>
          <small>AP / AT independent</small>
        </div>
        <div className="thermal-lab-action-grid thermal-clock-action-grid">
          {primaryActions.map((action) => (
            <ActionButton
              key={action.id}
              action={action}
              selected={action.id === selectedAction.id}
              disabled={resolving}
              onSelect={onActionSelect}
            />
          ))}
        </div>
        {advancedActions.length > 0 && (
          <details className="thermal-clock-advanced-actions">
            <summary>更多时间与反应测试</summary>
            <div className="thermal-lab-action-grid thermal-clock-action-grid">
              {advancedActions.map((action) => (
                <ActionButton
                  key={action.id}
                  action={action}
                  selected={action.id === selectedAction.id}
                  disabled={resolving}
                  onSelect={onActionSelect}
                />
              ))}
            </div>
          </details>
        )}
      </section>

      <section className={`thermal-lab-preview${resolving ? ' is-resolving' : ''}`} aria-label="Selected action preview">
        <div className="thermal-lab-preview-header">
          <div>
            <span>2 · Preview and Resolve</span>
            <strong>{selectedAction.label}</strong>
          </div>
          <div
            className="thermal-lab-event-list thermal-clock-event-summary"
            title={previewEventSummary}
            aria-label={`Preview events: ${previewEventSummary}`}
            style={{ minHeight: 18, maxHeight: 18, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
          >
            <span className={previewLabels.length === 0 ? 'is-muted' : ''}>{previewEventSummary}</span>
          </div>
        </div>

        <p className="thermal-clock-action-summary">
          {selectedAction.baseApCost} AP · {selectedAction.baseActionTime} AT · 推进 {formatThermalNumber(actionBeatAdvance, 2)} Base Beat
        </p>

        <div className="thermal-clock-preview-steps">
          <div>
            <span>Now</span>
            <b>T {formatThermalNumber(current.temperature)}</b>
            <small>D {formatThermalNumber(session.thermal.drift)}</small>
          </div>
          <i>→</i>
          <div className="is-immediate">
            <span>Immediate</span>
            <b>T {formatThermalNumber(immediate.temperature)}</b>
            <small>D {formatThermalNumber(preview.immediate.thermal.drift)}</small>
          </div>
          <i>→</i>
          <div className="is-final">
            <span>After {selectedAction.baseActionTime} AT</span>
            <b>T {formatThermalNumber(final.temperature)}</b>
            <small>D {formatThermalNumber(preview.after.thermal.drift)}</small>
          </div>
        </div>

        <div className="thermal-lab-equation thermal-clock-result-metrics">
          <span>Immediate ΔT {formatThermalNumber(preview.immediateTrace.offsetDelta)}</span>
          <span>Immediate ΔD {formatThermalNumber(preview.immediateTrace.driftDelta)}</span>
          <span>Next Apex {formatThermalNumber(final.projectedApexTemperature)}</span>
        </div>

        <button type="button" className="thermal-lab-resolve" onClick={onResolve} disabled={resolving}>
          {resolving ? 'Immediate Response → Thermal Clock…' : '执行所选测试动作'}
        </button>
      </section>

      <section className="thermal-lab-toolbar" aria-label="Experiment controls">
        <button type="button" onClick={onUndo} disabled={history.length === 0 || resolving}>Undo</button>
        <button type="button" onClick={onRestart} disabled={resolving}>Restart</button>
        <button type="button" onClick={onReplay} disabled={history.length === 0 || resolving}>Replay</button>
        <button type="button" onClick={copySnapshot}>Copy Snapshot</button>
        {copyStatus && <span>{copyStatus}</span>}
      </section>

      <details className="thermal-lab-log thermal-clock-log">
        <summary>
          <span>3 · Action Log</span>
          <strong>{history.length} resolved</strong>
        </summary>
        <div className="thermal-clock-log-body">
          <small className="thermal-clock-log-version">{config.rulesetVersion}</small>
          {history.length === 0 ? (
            <p className="thermal-lab-empty">打出卡牌、执行移动或攻击，或使用测试动作后，这里会记录即时变化与 AT 推进。</p>
          ) : (
            <ol>
              {[...history].reverse().map((entry, reverseIndex) => {
                const actionNumber = history.length - reverseIndex
                const beforeDerived = deriveThermalState(entry.before.thermal, rules)
                const afterDerived = deriveThermalState(entry.after.thermal, rules)
                const labels = eventLabelList(entry)
                return (
                  <li key={`${actionNumber}-${entry.actionId}`}>
                    <header>
                      <strong>#{actionNumber} {entry.actionLabel}</strong>
                      <span>{labels.join(' · ') || 'Flow'}</span>
                    </header>
                    <code>
                      {entry.before.elapsedAt.toFixed(2)} → {entry.after.elapsedAt.toFixed(2)} AT · T {formatThermalNumber(beforeDerived.temperature)} → {formatThermalNumber(afterDerived.temperature)}
                    </code>
                    <small>
                      Immediate ΔT {formatThermalNumber(entry.immediateTrace.offsetDelta)} · ΔD {formatThermalNumber(entry.immediateTrace.driftDelta)} · {entry.timeline.length} event(s)
                    </small>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </details>
    </div>
  )
}
