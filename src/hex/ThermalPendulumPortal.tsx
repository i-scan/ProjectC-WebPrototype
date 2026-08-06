import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  deriveThermalState,
  formatThermalNumber,
  getThermalClockAction,
  getThermalClockRuleset,
  getThermalClockScenario,
  normalizeThermalState,
  replayThermalClockActions,
  resolveThermalAction,
  sessionFromScenario,
  temperatureFor,
  thermalClockExperimentConfig,
  thermalStateEquals,
  type ActorThermalState,
  type ThermalActionResolution,
  type ThermalSessionState,
} from './thermalClockExperiment'
import { ThermalClockLab } from './ThermalClockLab'
import {
  runtimeActionToThermalClockAction,
  type ThermalClockRuntimeSignal,
} from './thermalClockRuntime'
import {
  thermalClockAngleFor,
  thermalClockDialAngleFor,
  thermalClockDriftProjectionFor,
  thermalClockSlotFor,
} from './thermalClockPendulumModel'
import './thermal-pendulum.css'
import './thermal-clock.css'

type ThermalPendulumPortalProps = {
  enabled: boolean
  inspectorActive: boolean
  runtimeSignal?: ThermalClockRuntimeSignal
  onOpenInspector: () => void
  onTemperatureChange?: (temperature: number) => void
}

type ThermalPendulumProps = {
  inspectorTarget: HTMLElement | null
  inspectorActive: boolean
  runtimeSignal?: ThermalClockRuntimeSignal
  onOpenInspector: () => void
  onTemperatureChange?: (temperature: number) => void
}

const pivot = { x: 130, y: 28 }
const arcRadius = 88
const driftRadius = 101
const previewDriftRadius = 110
const armLength = 72
const previewEventRadius = 118

function findActorPanelTarget(): HTMLElement | null {
  const bars = document.querySelector<HTMLElement>('.hex-prototype .visual-actor-card .visual-bars')
  return bars?.parentElement ?? null
}

function findInspectorTarget(): HTMLElement | null {
  return document.getElementById('thermal-clock-inspector-slot')
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
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')
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

function phaseIndex(phaseBeat: number | null): number | null {
  if (phaseBeat === null) return null
  return Math.min(3, Math.max(0, Math.floor(phaseBeat)))
}

function ThermalPendulum({
  inspectorTarget,
  inspectorActive,
  runtimeSignal,
  onOpenInspector,
  onTemperatureChange,
}: ThermalPendulumProps) {
  const initialRules = getThermalClockRuleset(thermalClockExperimentConfig.defaultRulesetId)
  const initialScenario = getThermalClockScenario(thermalClockExperimentConfig.defaultScenarioId)
  const initialAction = getThermalClockAction(thermalClockExperimentConfig.defaultActionId)

  const [rulesetId, setRulesetId] = useState(initialRules.id)
  const [scenarioId, setScenarioId] = useState(initialScenario.id)
  const [session, setSession] = useState<ThermalSessionState>(() => (
    sessionFromScenario(initialScenario, initialRules)
  ))
  const [selectedActionId, setSelectedActionId] = useState(initialAction.id)
  const [history, setHistory] = useState<ThermalActionResolution[]>([])
  const [activeResolution, setActiveResolution] = useState<ThermalActionResolution | null>(null)
  const resolveTimerRef = useRef<number | null>(null)
  const activeResolutionRef = useRef<ThermalActionResolution | null>(null)
  const sessionRef = useRef(session)
  const lastRuntimeSequenceRef = useRef(0)

  const rules = getThermalClockRuleset(rulesetId)
  const scenario = getThermalClockScenario(scenarioId)
  const selectedAction = getThermalClockAction(selectedActionId)
  const preview = useMemo(
    () => resolveThermalAction(session, selectedAction, rules),
    [session, selectedAction, rules],
  )
  const visibleSession = activeResolution?.immediate ?? session
  const visibleDerived = deriveThermalState(visibleSession.thermal, rules)
  const previewDerived = deriveThermalState(preview.after.thermal, rules)
  const resolving = activeResolution !== null

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    activeResolutionRef.current = activeResolution
  }, [activeResolution])

  useEffect(() => {
    onTemperatureChange?.(visibleDerived.temperature)
  }, [visibleDerived.temperature, onTemperatureChange])

  useEffect(() => () => {
    if (resolveTimerRef.current !== null) window.clearTimeout(resolveTimerRef.current)
  }, [])

  const clearResolutionTimer = () => {
    if (resolveTimerRef.current !== null) {
      window.clearTimeout(resolveTimerRef.current)
      resolveTimerRef.current = null
    }
  }

  const commitResolution = (resolution: ThermalActionResolution) => {
    setHistory((current) => [...current, resolution])
    setSession(resolution.after)
    sessionRef.current = resolution.after
    setActiveResolution(null)
    activeResolutionRef.current = null
  }

  const flushPendingResolution = () => {
    clearResolutionTimer()
    const pending = activeResolutionRef.current
    if (pending) commitResolution(pending)
  }

  const cancelPendingResolution = () => {
    clearResolutionTimer()
    setActiveResolution(null)
    activeResolutionRef.current = null
  }

  const beginResolution = (resolution: ThermalActionResolution, delay: number) => {
    clearResolutionTimer()
    setActiveResolution(resolution)
    activeResolutionRef.current = resolution
    resolveTimerRef.current = window.setTimeout(() => {
      commitResolution(resolution)
      resolveTimerRef.current = null
    }, delay)
  }

  useEffect(() => {
    if (!runtimeSignal || runtimeSignal.sequence <= lastRuntimeSequenceRef.current) return
    lastRuntimeSequenceRef.current = runtimeSignal.sequence

    if (runtimeSignal.type === 'restart') {
      cancelPendingResolution()
      const resetSession = sessionFromScenario(scenario, rules)
      setSession(resetSession)
      sessionRef.current = resetSession
      setHistory([])
      return
    }

    if (runtimeSignal.type === 'undo') {
      const pending = activeResolutionRef.current
      cancelPendingResolution()
      if (pending) {
        setSession(pending.before)
        sessionRef.current = pending.before
        return
      }
      setHistory((current) => {
        const previous = current.at(-1)
        if (!previous) return current
        setSession(previous.before)
        sessionRef.current = previous.before
        return current.slice(0, -1)
      })
      return
    }

    if (runtimeSignal.type !== 'action') return

    flushPendingResolution()
    const runtimeAction = runtimeActionToThermalClockAction(runtimeSignal)
    const resolution = resolveThermalAction(sessionRef.current, runtimeAction, rules)
    beginResolution(resolution, 220)
  }, [runtimeSignal])

  const zoneValues = useMemo(() => Array.from(
    {
      length: thermalClockExperimentConfig.display.temperatureMax
        - thermalClockExperimentConfig.display.temperatureMin + 1,
    },
    (_, index) => thermalClockExperimentConfig.display.temperatureMin + index,
  ), [])
  const zonePaths = useMemo(() => zoneValues.map((value) => ({
    value,
    className: thermalClockSlotFor(value, visibleSession.thermal.setPoint).zoneClass,
    path: sampledArcPath(
      thermalClockDialAngleFor(value - 0.5, visibleSession.thermal.setPoint),
      thermalClockDialAngleFor(value + 0.5, visibleSession.thermal.setPoint),
    ),
  })), [visibleSession.thermal.setPoint, zoneValues])

  const currentSlot = thermalClockSlotFor(
    visibleDerived.temperature,
    visibleSession.thermal.setPoint,
    thermalClockExperimentConfig.display.temperatureMin,
    thermalClockExperimentConfig.display.temperatureMax,
  )
  const bobPoint = pointOnArc(currentSlot.angle, armLength)
  const drift = thermalClockDriftProjectionFor(
    visibleDerived.temperature,
    visibleSession.thermal.setPoint,
    visibleSession.thermal.drift,
    thermalClockExperimentConfig.display.driftVisualMax,
    thermalClockExperimentConfig.display.temperatureMin,
    thermalClockExperimentConfig.display.temperatureMax,
  )
  const driftIdlePoint = pointOnArc(drift.startAngle, driftRadius)
  const driftPath = Math.abs(drift.displayedAngle) < 0.001
    ? ''
    : sampledArcPath(drift.startAngle, drift.endAngle, driftRadius)
  const driftArrowPath = drift.direction === 'still'
    ? ''
    : driftArrowHeadPath(drift.endAngle, drift.direction, driftRadius)

  const showGhost = inspectorActive && !resolving && (
    !thermalStateEquals(session.thermal, preview.after.thermal)
    || Math.abs(session.elapsedAt - preview.after.elapsedAt) > 1e-6
  )
  const previewSlot = thermalClockSlotFor(
    previewDerived.temperature,
    preview.after.thermal.setPoint,
    thermalClockExperimentConfig.display.temperatureMin,
    thermalClockExperimentConfig.display.temperatureMax,
  )
  const previewBobPoint = pointOnArc(previewSlot.angle, armLength)
  const previewDrift = thermalClockDriftProjectionFor(
    previewDerived.temperature,
    preview.after.thermal.setPoint,
    preview.after.thermal.drift,
    thermalClockExperimentConfig.display.driftVisualMax,
    thermalClockExperimentConfig.display.temperatureMin,
    thermalClockExperimentConfig.display.temperatureMax,
  )
  const previewDriftIdlePoint = pointOnArc(previewDrift.startAngle, previewDriftRadius)
  const previewDriftPath = Math.abs(previewDrift.displayedAngle) < 0.001
    ? ''
    : sampledArcPath(previewDrift.startAngle, previewDrift.endAngle, previewDriftRadius)
  const previewDriftArrowPath = previewDrift.direction === 'still'
    ? ''
    : driftArrowHeadPath(previewDrift.endAngle, previewDrift.direction, previewDriftRadius, 0.82)
  const previewEventPoints = showGhost
    ? preview.timeline.map((event) => ({
      event,
      point: pointOnArc(
        thermalClockAngleFor(
          temperatureFor(event.state),
          event.state.setPoint,
          thermalClockExperimentConfig.display.temperatureMin,
          thermalClockExperimentConfig.display.temperatureMax,
        ),
        previewEventRadius,
      ),
    }))
    : []

  const resolveSelectedAction = () => {
    if (resolving) return
    const animationDelay = Math.min(680, 280 + selectedAction.baseActionTime * 90)
    beginResolution(preview, animationDelay)
  }

  const undoAction = () => {
    const pending = activeResolutionRef.current
    cancelPendingResolution()
    if (pending) {
      setSession(pending.before)
      sessionRef.current = pending.before
      return
    }
    setHistory((current) => {
      const previous = current.at(-1)
      if (!previous) return current
      setSession(previous.before)
      sessionRef.current = previous.before
      return current.slice(0, -1)
    })
  }

  const restartScenario = () => {
    cancelPendingResolution()
    const resetSession = sessionFromScenario(scenario, rules)
    setSession(resetSession)
    sessionRef.current = resetSession
    setHistory([])
  }

  const replayHistory = () => {
    cancelPendingResolution()
    const actionIds = history
      .map((entry) => entry.actionId)
      .filter((actionId) => thermalClockExperimentConfig.actions.some((action) => action.id === actionId))
    const initialSession = sessionFromScenario(scenario, rules)
    const replayed = replayThermalClockActions(initialSession, actionIds, rules)
    setHistory(replayed)
    const replayedSession = replayed.at(-1)?.after ?? initialSession
    setSession(replayedSession)
    sessionRef.current = replayedSession
  }

  const changeRuleset = (nextRulesetId: string) => {
    cancelPendingResolution()
    const nextRules = getThermalClockRuleset(nextRulesetId)
    const resetSession = sessionFromScenario(scenario, nextRules)
    setRulesetId(nextRules.id)
    setSession(resetSession)
    sessionRef.current = resetSession
    setHistory([])
  }

  const changeScenario = (nextScenarioId: string) => {
    cancelPendingResolution()
    const nextScenario = getThermalClockScenario(nextScenarioId)
    const resetSession = sessionFromScenario(nextScenario, rules)
    setScenarioId(nextScenario.id)
    setSession(resetSession)
    sessionRef.current = resetSession
    setHistory([])
  }

  const changeManualState = (patch: Partial<ActorThermalState>) => {
    cancelPendingResolution()
    setSession((current) => {
      const next = {
        ...current,
        thermal: normalizeThermalState({ ...current.thermal, ...patch }, rules),
      }
      sessionRef.current = next
      return next
    })
    setHistory([])
  }

  const currentPhaseIndex = phaseIndex(visibleDerived.phaseBeat)
  const phaseProgress = visibleDerived.phaseBeat === null
    ? 0
    : Math.min(100, Math.max(0, visibleDerived.phaseBeat / 4 * 100))

  return (
    <>
      <section
        className={`thermal-pendulum thermal-clock-pendulum${resolving ? ' is-resolving' : ''}`}
        aria-label={`热力钟摆，当前体温 ${formatThermalNumber(visibleDerived.temperature, 1)}，Set Point ${formatThermalNumber(visibleSession.thermal.setPoint, 1)}，Drift ${formatThermalNumber(visibleSession.thermal.drift, 1)}，周期 ${rules.thermalPeriodAt} AT`}
      >
        <div className="thermal-pendulum-heading">
          <strong>热力钟摆</strong>
          <button type="button" onClick={onOpenInspector}>UT1 Thermal</button>
        </div>

        <div className="thermal-pendulum-dial">
          <svg viewBox="0 0 260 158" role="img" aria-label="Continuous Thermal Clock current state and selected action preview">
            <g className="thermal-zone-ring">
              {zonePaths.map((zone) => (
                <path key={zone.value} className={`thermal-zone ${zone.className}`} d={zone.path} />
              ))}
            </g>

            {drift.direction === 'still' ? (
              <circle className="thermal-drift-idle" cx={driftIdlePoint.x} cy={driftIdlePoint.y} r="3.4" />
            ) : (
              <g className={`thermal-drift-group is-${drift.direction}${drift.clipped ? ' is-clipped' : ''}`}>
                {driftPath && <path className={`thermal-drift-vector is-${drift.direction}`} d={driftPath} />}
                <path className={`thermal-drift-arrow-head is-${drift.direction}`} d={driftArrowPath} />
              </g>
            )}

            {showGhost && (
              <g className="thermal-ghost-preview">
                {previewEventPoints.map(({ event, point }, index) => (
                  <circle
                    key={`${event.kind}-${event.actionTime}-${index}`}
                    className={`thermal-clock-event-marker is-${event.kind}${event.overshoot ? ' is-overshoot' : ''}`}
                    cx={point.x}
                    cy={point.y}
                    r={event.kind === 'action-event' ? 3.2 : 2.5}
                  />
                ))}
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
              <circle className={`thermal-bob ${currentSlot.zoneClass}`} cx={bobPoint.x} cy={bobPoint.y} r="10" />
              <circle className="thermal-bob-core" cx={bobPoint.x} cy={bobPoint.y} r="3" />
            </g>
          </svg>
        </div>

        <div className="thermal-clock-mini-phase" aria-label={`Thermal Clock phase ${visibleDerived.phaseBeat === null ? 'Neutral' : visibleDerived.phaseBeat.toFixed(2)}`}>
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className={currentPhaseIndex === index ? 'is-active' : ''} />
          ))}
          {visibleDerived.phaseBeat !== null && <b style={{ left: `${phaseProgress}%` }} />}
        </div>

        <details className="thermal-pendulum-lab">
          <summary>TC1 Debug</summary>
          <div className="thermal-pendulum-debug-grid thermal-clock-debug-grid">
            <span>T <b>{formatThermalNumber(visibleDerived.temperature)}</b></span>
            <span>S <b>{formatThermalNumber(visibleSession.thermal.setPoint)}</b></span>
            <span>Offset <b>{formatThermalNumber(visibleSession.thermal.offset)}</b></span>
            <span>Drift <b>{formatThermalNumber(visibleSession.thermal.drift)}</b></span>
            <span>Phase <b>{visibleDerived.phaseBeat === null ? '—' : visibleDerived.phaseBeat.toFixed(2)}</b></span>
            <span>Period <b>{rules.thermalPeriodAt} AT</b></span>
            <span>World <b>{visibleSession.elapsedAt.toFixed(2)} AT</b></span>
            <span>Apex <b>{formatThermalNumber(visibleDerived.projectedApexTemperature)}</b></span>
            <span>Actions <b>{history.length}</b></span>
          </div>
          <button type="button" onClick={onOpenInspector}>打开 Thermal Clock Inspector</button>
        </details>
      </section>

      {inspectorTarget && createPortal(
        <ThermalClockLab
          open
          embedded
          config={thermalClockExperimentConfig}
          rules={rules}
          scenario={scenario}
          session={session}
          selectedAction={selectedAction}
          preview={preview}
          history={history}
          resolving={resolving}
          onRulesetChange={changeRuleset}
          onScenarioChange={changeScenario}
          onStateChange={changeManualState}
          onActionSelect={setSelectedActionId}
          onResolve={resolveSelectedAction}
          onUndo={undoAction}
          onRestart={restartScenario}
          onReplay={replayHistory}
        />,
        inspectorTarget,
      )}
    </>
  )
}

export function ThermalPendulumPortal({
  enabled,
  inspectorActive,
  runtimeSignal,
  onOpenInspector,
  onTemperatureChange,
}: ThermalPendulumPortalProps) {
  const [actorTarget, setActorTarget] = useState<HTMLElement | null>(null)
  const [inspectorTarget, setInspectorTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!enabled) {
      setActorTarget(null)
      setInspectorTarget(null)
      return undefined
    }

    const syncTargets = () => {
      const nextActor = findActorPanelTarget()
      const nextInspector = findInspectorTarget()
      setActorTarget((current) => current === nextActor ? current : nextActor)
      setInspectorTarget((current) => current === nextInspector ? current : nextInspector)
    }

    syncTargets()
    const observer = new MutationObserver(syncTargets)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [enabled])

  if (!enabled || !actorTarget) return null
  return createPortal(
    <ThermalPendulum
      inspectorTarget={inspectorTarget}
      inspectorActive={inspectorActive}
      runtimeSignal={runtimeSignal}
      onOpenInspector={onOpenInspector}
      onTemperatureChange={onTemperatureChange}
    />,
    actorTarget,
  )
}
