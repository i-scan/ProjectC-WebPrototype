import { useMemo, useState, type ChangeEvent } from 'react'
import {
  deriveThermalState,
  formatThermalNumber,
  temperatureFor,
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
  const currentTemperature = temperatureFor(session.thermal)
  const previewLabels = eventLabelList(preview)
  const actionSequence = useMemo(
    () => history.map((entry) => entry.actionId),
    [history],
  )
  const baseBeatAt = rules.thermalPeriodAt / 4
  const actionBeatAdvance = baseBeatAt <= 0 ? 0 : selectedAction.baseActionTime / baseBeatAt
  const anchorSchedule = [
    { label: 'Hot Apex', at: 0 },
    { label: 'Set Point → Cold', at: baseBeatAt },
    { label: 'Cold Apex', at: baseBeatAt * 2 },
    { label: 'Set Point → Hot', at: baseBeatAt * 3 },
    { label: 'Hot Apex', at: rules.thermalPeriodAt },
  ]

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

  return (
    <div
      className={`thermal-inertia-lab thermal-clock-lab${embedded ? ' is-embedded' : ''}${resolving ? ' is-resolving' : ''}`}
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

      <section className="thermal-lab-config">
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

      <section className="thermal-lab-state-grid" aria-label="Current thermal clock state">
        <StateValue label="T" value={formatThermalNumber(current.temperature)} emphasis />
        <StateValue label="Set Point" value={formatThermalNumber(session.thermal.setPoint)} />
        <StateValue label="Offset" value={formatThermalNumber(session.thermal.offset)} />
        <StateValue label="Drift" value={formatThermalNumber(session.thermal.drift)} emphasis />
        <StateValue label="Side" value={sideLabel(current.side, current.neutral)} />
        <StateValue label="Phase" value={current.phaseBeat === null ? '—' : current.phaseBeat.toFixed(2)} />
        <StateValue label="Period" value={`${rules.thermalPeriodAt} AT`} />
        <StateValue label="Base Beat" value={`${formatThermalNumber(baseBeatAt, 1)} AT`} />
        <StateValue label="World Time" value={`${session.elapsedAt.toFixed(2)} AT`} />
      </section>

      <section className="thermal-clock-phase-card">
        <div className="thermal-lab-section-heading">
          <div>
            <span>固定四相 · 不是 {rules.thermalPeriodAt} 个相位</span>
            <strong>{phaseLabel(current.phaseBeat)}</strong>
          </div>
          <small>1 Beat = {formatThermalNumber(baseBeatAt, 1)} AT</small>
        </div>
        <p className="thermal-clock-period-explanation">
          一个完整 Period 始终只有四个 Base Beat。Period 改为 8 或 12 AT，只会把同样四相分别拉伸为每 Beat 2 或 3 AT。
        </p>
        <div className="thermal-clock-anchor-schedule" aria-label={`${rules.thermalPeriodAt} AT anchor schedule`}>
          {anchorSchedule.map((anchor, index) => (
            <div key={`${anchor.label}-${index}`}>
              <b>{formatThermalNumber(anchor.at, 1)} AT</b>
              <span>{anchor.label}</span>
            </div>
          ))}
        </div>
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

      <details className="thermal-lab-manual">
        <summary>Advanced State Input</summary>
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
            <span>Debug Actions</span>
            <strong>真实卡牌与基础行动已自动推进；这里保留对照动作</strong>
          </div>
          <small>AP 与 AT 独立</small>
        </div>
        <div className="thermal-lab-action-grid thermal-clock-action-grid">
          {config.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={action.id === selectedAction.id ? 'is-selected' : ''}
              onClick={() => onActionSelect(action.id)}
              title={action.description}
              disabled={resolving}
            >
              <strong>{action.shortLabel}</strong>
              <span>{action.label}</span>
              <small>{action.baseApCost} AP · {action.baseActionTime} AT</small>
            </button>
          ))}
        </div>
      </section>

      <section className={`thermal-lab-preview${resolving ? ' is-resolving' : ''}`} aria-label="Selected action preview">
        <div className="thermal-lab-preview-header">
          <div>
            <span>Immediate + Timeline Preview</span>
            <strong>{selectedAction.label}</strong>
          </div>
          <div className="thermal-lab-event-list">
            {previewLabels.length === 0
              ? <span className="is-muted">No anchor event</span>
              : previewLabels.map((event) => <span key={event}>{event}</span>)}
          </div>
        </div>

        <div className="thermal-clock-action-progress">
          +{formatThermalNumber(selectedAction.baseActionTime, 1)} AT = +{formatThermalNumber(actionBeatAdvance, 2)} Base Beat
        </div>

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

        <div className="thermal-lab-equation thermal-clock-economy">
          <span>AP {selectedAction.baseApCost}</span>
          <span>AT {selectedAction.baseActionTime}</span>
          <span>ΔT {formatThermalNumber(preview.immediateTrace.offsetDelta)}</span>
          <span>ΔD {formatThermalNumber(preview.immediateTrace.driftDelta)}</span>
          <span>Apex {formatThermalNumber(final.projectedApexTemperature)}</span>
        </div>

        {preview.timeline.length > 0 && (
          <ol className="thermal-clock-timeline">
            {preview.timeline.map((event, index) => (
              <li key={`${event.kind}-${event.actionTime}-${index}`}>
                <b>{event.actionTime.toFixed(2)} AT</b>
                <span>{event.label}{event.overshoot ? ' · Overshoot' : ''}</span>
                <small>T {formatThermalNumber(temperatureFor(event.state))} · D {formatThermalNumber(event.state.drift)}</small>
              </li>
            ))}
          </ol>
        )}

        <button type="button" className="thermal-lab-resolve" onClick={onResolve} disabled={resolving}>
          {resolving ? 'Immediate Response → Thermal Clock…' : 'Debug Resolve Action'}
        </button>
      </section>

      <section className="thermal-lab-toolbar" aria-label="Experiment controls">
        <button type="button" onClick={onUndo} disabled={history.length === 0 || resolving}>Undo</button>
        <button type="button" onClick={onRestart} disabled={resolving}>Restart</button>
        <button type="button" onClick={onReplay} disabled={history.length === 0 || resolving}>Replay</button>
        <button type="button" onClick={copySnapshot}>Copy Snapshot</button>
        {copyStatus && <span>{copyStatus}</span>}
      </section>

      <section className="thermal-lab-log">
        <div className="thermal-lab-section-heading">
          <div>
            <span>Action Timeline Log</span>
            <strong>{history.length} resolved</strong>
          </div>
          <small>{config.rulesetVersion}</small>
        </div>
        {history.length === 0 ? (
          <p className="thermal-lab-empty">打出卡牌、执行移动或攻击，或使用 Debug Action 后，日志会记录即时变化、AT 推进与途中锚点。</p>
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
                    Immediate ΔT {formatThermalNumber(entry.immediateTrace.offsetDelta)} · ΔD {formatThermalNumber(entry.immediateTrace.driftDelta)} · {entry.timeline.length} timeline event(s)
                  </small>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}
