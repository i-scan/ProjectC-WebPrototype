import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  getThermalAction,
  getThermalRuleset,
  getThermalScenario,
  normalizeThermalState,
  projectThermalApex,
  replayThermalActions,
  resolveThermalFrame,
  thermalExperimentConfig,
  thermalStateEquals,
  type ActorThermalState,
  type ThermalFrameResolution,
} from './thermalInertiaExperiment'
import { ThermalInertiaLab } from './ThermalInertiaLab'
import {
  formatThermalValue,
  thermalAngleFor,
  thermalDialAngleFor,
  thermalDriftProjectionFor,
  thermalSlotFor,
  thermalZoneClass,
} from './thermalPendulumModel'
import './thermal-pendulum.css'

type ThermalPendulumPortalProps = {
  enabled: boolean
}

const pivot = { x: 130, y: 28 }
const arcRadius = 88
const driftRadius = 101
const previewDriftRadius = 110
const apexRadius = 116
const previewApexRadius = 123
const armLength = 72

function findActorPanelTarget(): HTMLElement | null {
  const bars = document.querySelector<HTMLElement>('.hex-prototype .visual-actor-card .visual-bars')
  return bars?.parentElement ?? null
}

function syncActorTemperatureDisplay(temperature: number) {
  const rows = document.querySelectorAll<HTMLElement>('.hex-prototype .visual-actor-card .visual-bars > div')
  for (const row of rows) {
    if (row.querySelector('span')?.textContent?.trim() !== '体温') continue
    const value = row.querySelector<HTMLElement>('strong')
    if (value) value.textContent = formatThermalValue(temperature)
    return
  }
}

function pointOnArc(angle: number, radius: number) {
  const radians = angle * Math.PI / 180
  return {
    x: pivot.x + Math.sin(radians) * radius,
    y: pivot.y + Math.cos(radians) * radius,
  }
}

function sampledArcPath(startAngle: number, endAngle: number, radius = arcRadius): string {
  const steps = Math.max(3, Math.ceil(Math.abs(endAngle - startAngle) / 3))
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps
    return pointOnArc(startAngle + (endAngle - startAngle) * progress, radius)
  })
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
}

function driftArrowHeadPath(
  angle: number,
  direction: 'cold' | 'hot',
  radius: number,
  scale = 1,
): string {
  const radians = angle * Math.PI / 180
  const directionSign = direction === 'hot' ? 1 : -1
  const tangent = {
    x: Math.cos(radians) * directionSign,
    y: -Math.sin(radians) * directionSign,
  }
  const normal = { x: -tangent.y, y: tangent.x }
  const tip = pointOnArc(angle, radius)
  const arrowLength = 8.5 * scale
  const halfWidth = 4.25 * scale
  const base = {
    x: tip.x - tangent.x * arrowLength,
    y: tip.y - tangent.y * arrowLength,
  }
  const left = {
    x: base.x + normal.x * halfWidth,
    y: base.y + normal.y * halfWidth,
  }
  const right = {
    x: base.x - normal.x * halfWidth,
    y: base.y - normal.y * halfWidth,
  }

  return [
    `M ${tip.x.toFixed(2)} ${tip.y.toFixed(2)}`,
    `L ${left.x.toFixed(2)} ${left.y.toFixed(2)}`,
    `L ${right.x.toFixed(2)} ${right.y.toFixed(2)}`,
    'Z',
  ].join(' ')
}

function diamondPath(point: { x: number; y: number }, size: number): string {
  return [
    `M ${point.x.toFixed(2)} ${(point.y - size).toFixed(2)}`,
    `L ${(point.x + size).toFixed(2)} ${point.y.toFixed(2)}`,
    `L ${point.x.toFixed(2)} ${(point.y + size).toFixed(2)}`,
    `L ${(point.x - size).toFixed(2)} ${point.y.toFixed(2)}`,
    'Z',
  ].join(' ')
}

function ThermalPendulum() {
  const initialRules = getThermalRuleset(thermalExperimentConfig.defaultRulesetId)
  const initialScenario = getThermalScenario(thermalExperimentConfig.defaultScenarioId)
  const [rulesetId, setRulesetId] = useState(initialRules.id)
  const [scenarioId, setScenarioId] = useState(initialScenario.id)
  const [thermalState, setThermalState] = useState<ActorThermalState>(() => (
    normalizeThermalState(initialScenario.state, initialRules)
  ))
  const [selectedActionId, setSelectedActionId] = useState('natural-step')
  const [history, setHistory] = useState<ThermalFrameResolution[]>([])
  const [labOpen, setLabOpen] = useState(true)

  const rules = getThermalRuleset(rulesetId)
  const scenario = getThermalScenario(scenarioId)
  const selectedAction = getThermalAction(selectedActionId)
  const currentProjection = useMemo(
    () => projectThermalApex(thermalState, rules),
    [thermalState, rules],
  )
  const preview = useMemo(
    () => resolveThermalFrame(thermalState, selectedAction, rules),
    [thermalState, selectedAction, rules],
  )

  useEffect(() => {
    syncActorTemperatureDisplay(thermalState.temperature)
  }, [thermalState.temperature])

  const zoneValues = useMemo(() => Array.from(
    { length: rules.temperatureMax - rules.temperatureMin + 1 },
    (_, index) => rules.temperatureMin + index,
  ), [rules])
  const zonePaths = useMemo(() => zoneValues.map((value) => ({
    value,
    className: thermalZoneClass(value),
    path: sampledArcPath(
      thermalDialAngleFor(value - 0.5, thermalState.setPoint),
      thermalDialAngleFor(value + 0.5, thermalState.setPoint),
    ),
  })), [thermalState.setPoint, zoneValues])

  const slot = thermalSlotFor(thermalState.temperature, thermalState.setPoint)
  const bobPoint = pointOnArc(slot.angle, armLength)
  const drift = thermalDriftProjectionFor(
    thermalState.temperature,
    thermalState.setPoint,
    thermalState.drift,
  )
  const driftIdlePoint = pointOnArc(drift.startAngle, driftRadius)
  const driftPath = Math.abs(drift.displayedAngle) < 0.001
    ? ''
    : sampledArcPath(drift.startAngle, drift.endAngle, driftRadius)
  const driftArrowPath = drift.direction === 'still'
    ? ''
    : driftArrowHeadPath(drift.endAngle, drift.direction, driftRadius)

  const previewSlot = thermalSlotFor(preview.after.temperature, preview.after.setPoint)
  const previewBobPoint = pointOnArc(previewSlot.angle, armLength)
  const previewDrift = thermalDriftProjectionFor(
    preview.after.temperature,
    preview.after.setPoint,
    preview.after.drift,
  )
  const previewDriftIdlePoint = pointOnArc(previewDrift.startAngle, previewDriftRadius)
  const previewDriftPath = Math.abs(previewDrift.displayedAngle) < 0.001
    ? ''
    : sampledArcPath(previewDrift.startAngle, previewDrift.endAngle, previewDriftRadius)
  const previewDriftArrowPath = previewDrift.direction === 'still'
    ? ''
    : driftArrowHeadPath(previewDrift.endAngle, previewDrift.direction, previewDriftRadius, .82)
  const hasGhostChange = !thermalStateEquals(thermalState, preview.after)

  const apexAngle = thermalAngleFor(
    currentProjection.apexState.temperature,
    thermalState.setPoint,
  )
  const currentApexPoint = pointOnArc(apexAngle, apexRadius)
  const previewApexAngle = thermalAngleFor(
    preview.projectedApex.apexState.temperature,
    preview.after.setPoint,
  )
  const previewApexPoint = pointOnArc(previewApexAngle, previewApexRadius)

  const resolveSelectedFrame = () => {
    setHistory((current) => [...current, preview])
    setThermalState(preview.after)
  }

  const undoFrame = () => {
    setHistory((current) => {
      const previous = current.at(-1)
      if (!previous) return current
      setThermalState(previous.before)
      return current.slice(0, -1)
    })
  }

  const restartScenario = () => {
    setThermalState(normalizeThermalState(scenario.state, rules))
    setHistory([])
  }

  const replayHistory = () => {
    const actionIds = history.map((entry) => entry.trace.actionId)
    const initialState = normalizeThermalState(scenario.state, rules)
    const replayed = replayThermalActions(initialState, actionIds, rules)
    setHistory(replayed)
    setThermalState(replayed.at(-1)?.after ?? initialState)
  }

  const changeRuleset = (nextRulesetId: string) => {
    const nextRules = getThermalRuleset(nextRulesetId)
    setRulesetId(nextRules.id)
    setThermalState(normalizeThermalState(scenario.state, nextRules))
    setHistory([])
  }

  const changeScenario = (nextScenarioId: string) => {
    const nextScenario = getThermalScenario(nextScenarioId)
    setScenarioId(nextScenario.id)
    setThermalState(normalizeThermalState(nextScenario.state, rules))
    setHistory([])
  }

  const changeManualState = (patch: Partial<ActorThermalState>) => {
    setThermalState((current) => normalizeThermalState({ ...current, ...patch }, rules))
    setHistory([])
  }

  return (
    <>
      <section
        className="thermal-pendulum"
        aria-label={`热力钟摆，当前体温 ${formatThermalValue(thermalState.temperature)}，平衡温度 ${formatThermalValue(thermalState.setPoint)}，Drift ${formatThermalValue(thermalState.drift)}，Projected Apex ${formatThermalValue(currentProjection.apexState.temperature)}`}
      >
        <div className="thermal-pendulum-heading">
          <strong>热力钟摆</strong>
          <button type="button" onClick={() => setLabOpen(true)}>Stage 1 Lab</button>
        </div>

        <div className="thermal-pendulum-dial">
          <svg viewBox="0 0 260 158" role="img" aria-label="Thermal Inertia current state, ghost preview and projected apex">
            <g className="thermal-zone-ring">
              {zonePaths.map((zone) => (
                <path key={zone.value} className={`thermal-zone ${zone.className}`} d={zone.path} />
              ))}
            </g>

            <path
              className="thermal-apex-marker"
              d={diamondPath(currentApexPoint, 4.2)}
              aria-label={`Projected Apex ${formatThermalValue(currentProjection.apexState.temperature)}`}
            />
            <path
              className="thermal-ghost-apex-marker"
              d={diamondPath(previewApexPoint, 3.5)}
              aria-label={`Ghost Apex ${formatThermalValue(preview.projectedApex.apexState.temperature)}`}
            />

            {drift.direction === 'still' ? (
              <circle className="thermal-drift-idle" cx={driftIdlePoint.x} cy={driftIdlePoint.y} r="3.4" />
            ) : (
              <g className={`thermal-drift-group is-${drift.direction}${drift.clipped ? ' is-clipped' : ''}`}>
                {driftPath && <path className={`thermal-drift-vector is-${drift.direction}`} d={driftPath} />}
                <path className={`thermal-drift-arrow-head is-${drift.direction}`} d={driftArrowPath} />
              </g>
            )}

            {hasGhostChange && (
              <g className="thermal-ghost-preview">
                {previewDrift.direction === 'still' ? (
                  <circle className="thermal-ghost-drift-idle" cx={previewDriftIdlePoint.x} cy={previewDriftIdlePoint.y} r="3" />
                ) : (
                  <g className={`thermal-ghost-drift-group is-${previewDrift.direction}`}>
                    {previewDriftPath && <path className={`thermal-ghost-drift-vector is-${previewDrift.direction}`} d={previewDriftPath} />}
                    <path className={`thermal-ghost-drift-arrow is-${previewDrift.direction}`} d={previewDriftArrowPath} />
                  </g>
                )}
                <line className="thermal-ghost-arm" x1={pivot.x} y1={pivot.y + 4} x2={previewBobPoint.x} y2={previewBobPoint.y} />
                <circle className="thermal-ghost-bob" cx={previewBobPoint.x} cy={previewBobPoint.y} r="10" />
              </g>
            )}

            <line className="thermal-setpoint-line" x1={pivot.x} y1={pivot.y + 5} x2={pivot.x} y2={pivot.y + arcRadius - 7} />
            <path className="thermal-setpoint-marker" d={`M ${pivot.x - 5} ${pivot.y + arcRadius - 1} L ${pivot.x + 5} ${pivot.y + arcRadius - 1} L ${pivot.x} ${pivot.y + arcRadius + 7} Z`} />

            <circle className="thermal-pivot-outer" cx={pivot.x} cy={pivot.y} r="6" />
            <circle className="thermal-pivot-inner" cx={pivot.x} cy={pivot.y} r="2.2" />

            <g className="thermal-pendulum-arm">
              <line x1={pivot.x} y1={pivot.y + 4} x2={bobPoint.x} y2={bobPoint.y} />
              <circle className={`thermal-bob ${slot.zoneClass}`} cx={bobPoint.x} cy={bobPoint.y} r="10" />
              <circle className="thermal-bob-core" cx={bobPoint.x} cy={bobPoint.y} r="3" />
            </g>
          </svg>
        </div>

        <details className="thermal-pendulum-lab">
          <summary>Stage 1 Debug</summary>
          <div className="thermal-pendulum-debug-grid">
            <span>T <b>{formatThermalValue(thermalState.temperature)}</b></span>
            <span>S <b>{formatThermalValue(thermalState.setPoint)}</b></span>
            <span>Offset <b>{formatThermalValue(thermalState.temperature - thermalState.setPoint)}</b></span>
            <span>Drift <b>{formatThermalValue(thermalState.drift)}</b></span>
            <span>Apex <b>{formatThermalValue(currentProjection.apexState.temperature)}</b></span>
            <span>Frame <b>{history.length}</b></span>
          </div>
          <button type="button" onClick={() => setLabOpen(true)}>打开 Thermal Inertia Lab</button>
        </details>
      </section>

      {createPortal(
        <ThermalInertiaLab
          open={labOpen}
          config={thermalExperimentConfig}
          rules={rules}
          scenario={scenario}
          state={thermalState}
          selectedAction={selectedAction}
          preview={preview}
          currentProjection={currentProjection}
          history={history}
          onClose={() => setLabOpen(false)}
          onRulesetChange={changeRuleset}
          onScenarioChange={changeScenario}
          onStateChange={changeManualState}
          onActionSelect={setSelectedActionId}
          onResolve={resolveSelectedFrame}
          onUndo={undoFrame}
          onRestart={restartScenario}
          onReplay={replayHistory}
        />,
        document.body,
      )}
    </>
  )
}

export function ThermalPendulumPortal({ enabled }: ThermalPendulumPortalProps) {
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!enabled) {
      setTarget(null)
      return undefined
    }

    const syncTarget = () => {
      const next = findActorPanelTarget()
      setTarget((current) => current === next ? current : next)
    }

    syncTarget()
    const observer = new MutationObserver(syncTarget)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [enabled])

  if (!enabled || !target) return null
  return createPortal(<ThermalPendulum />, target)
}
