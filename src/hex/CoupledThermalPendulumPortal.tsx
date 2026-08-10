import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatThermalNumber, thermalClockExperimentConfig } from './thermalClockExperiment'
import {
  thermalClockDialAngleFor,
  thermalClockDriftProjectionFor,
  thermalClockSlotFor,
} from './thermalClockPendulumModel'
import './thermal-pendulum.css'
import './thermal-clock.css'

type CoupledThermalPendulumPortalProps = {
  enabled: boolean
  temperature: number
  setPoint: number
  drift: number
  elapsedAt: number
  thermalPeriodAt: number
  onOpenDebug: () => void
}

const pivot = { x: 130, y: 28 }
const arcRadius = 88
const driftRadius = 101
const armLength = 72

function findActorPanelTarget(): HTMLElement | null {
  const bars = document.querySelector<HTMLElement>('.ut4-hex-layout .visual-actor-card .visual-bars')
  return bars?.parentElement ?? null
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
  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps
    const point = pointOnArc(startAngle + (endAngle - startAngle) * progress, radius)
    return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  }).join(' ')
}

function driftArrowHeadPath(angle: number, direction: 'cold' | 'hot', radius: number): string {
  const radians = angle * Math.PI / 180
  const directionSign = direction === 'hot' ? 1 : -1
  const tangent = {
    x: Math.cos(radians) * directionSign,
    y: -Math.sin(radians) * directionSign,
  }
  const normal = { x: -tangent.y, y: tangent.x }
  const tip = pointOnArc(angle, radius)
  const base = {
    x: tip.x - tangent.x * 8.5,
    y: tip.y - tangent.y * 8.5,
  }
  const left = { x: base.x + normal.x * 4.25, y: base.y + normal.y * 4.25 }
  const right = { x: base.x - normal.x * 4.25, y: base.y - normal.y * 4.25 }
  return `M ${tip.x.toFixed(2)} ${tip.y.toFixed(2)} L ${left.x.toFixed(2)} ${left.y.toFixed(2)} L ${right.x.toFixed(2)} ${right.y.toFixed(2)} Z`
}

function CoupledThermalPendulum({
  temperature,
  setPoint,
  drift,
  elapsedAt,
  thermalPeriodAt,
  onOpenDebug,
}: Omit<CoupledThermalPendulumPortalProps, 'enabled'>) {
  const display = thermalClockExperimentConfig.display
  const zoneValues = useMemo(
    () => Array.from({ length: display.temperatureMax - display.temperatureMin + 1 }, (_, index) => display.temperatureMin + index),
    [display.temperatureMax, display.temperatureMin],
  )
  const zonePaths = useMemo(() => zoneValues.map((value) => ({
    value,
    className: thermalClockSlotFor(value, setPoint).zoneClass,
    path: sampledArcPath(
      thermalClockDialAngleFor(value - 0.5, setPoint),
      thermalClockDialAngleFor(value + 0.5, setPoint),
    ),
  })), [setPoint, zoneValues])

  const currentSlot = thermalClockSlotFor(
    temperature,
    setPoint,
    display.temperatureMin,
    display.temperatureMax,
  )
  const bobPoint = pointOnArc(currentSlot.angle, armLength)
  const driftProjection = thermalClockDriftProjectionFor(
    temperature,
    setPoint,
    drift,
    display.driftVisualMax,
    display.temperatureMin,
    display.temperatureMax,
  )
  const driftIdlePoint = pointOnArc(driftProjection.startAngle, driftRadius)
  const driftPath = Math.abs(driftProjection.displayedAngle) < 0.001
    ? ''
    : sampledArcPath(driftProjection.startAngle, driftProjection.endAngle, driftRadius)
  const driftArrowPath = driftProjection.direction === 'still'
    ? ''
    : driftArrowHeadPath(driftProjection.endAngle, driftProjection.direction, driftRadius)

  return (
    <section
      className="thermal-pendulum thermal-clock-pendulum ut4-controlled-pendulum"
      aria-label={`UT4 热力钟摆，当前温度 ${formatThermalNumber(temperature, 1)}，Set Point ${formatThermalNumber(setPoint, 1)}，Drift ${formatThermalNumber(drift, 1)}，周期 ${thermalPeriodAt} AT`}
    >
      <div className="thermal-pendulum-heading">
        <strong>热力钟摆</strong>
        <button type="button" onClick={onOpenDebug}>UT4 Thermal</button>
      </div>
      <div className="thermal-pendulum-dial">
        <svg viewBox="0 0 260 158" role="img" aria-label="UT4 damped thermal state">
          <g className="thermal-zone-ring">
            {zonePaths.map((zone) => <path key={zone.value} className={`thermal-zone ${zone.className}`} d={zone.path} />)}
          </g>
          {driftProjection.direction === 'still' ? (
            <circle className="thermal-drift-idle" cx={driftIdlePoint.x} cy={driftIdlePoint.y} r="3.4" />
          ) : (
            <g className={`thermal-drift-group is-${driftProjection.direction}${driftProjection.clipped ? ' is-clipped' : ''}`}>
              {driftPath && <path className={`thermal-drift-vector is-${driftProjection.direction}`} d={driftPath} />}
              <path className={`thermal-drift-arrow-head is-${driftProjection.direction}`} d={driftArrowPath} />
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
      <div className="ut4-pendulum-readout">
        <span>T <b>{formatThermalNumber(temperature)}</b></span>
        <span>Drift <b>{formatThermalNumber(drift)}</b></span>
        <span>Period <b>{thermalPeriodAt} AT</b></span>
        <span>World <b>{elapsedAt.toFixed(1)}</b></span>
      </div>
    </section>
  )
}

export function CoupledThermalPendulumPortal(props: CoupledThermalPendulumPortalProps) {
  const [actorTarget, setActorTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!props.enabled) {
      setActorTarget(null)
      return undefined
    }
    const syncTarget = () => {
      const next = findActorPanelTarget()
      setActorTarget((current) => current === next ? current : next)
    }
    syncTarget()
    const observer = new MutationObserver(syncTarget)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [props.enabled])

  if (!props.enabled || !actorTarget) return null
  return createPortal(
    <CoupledThermalPendulum
      temperature={props.temperature}
      setPoint={props.setPoint}
      drift={props.drift}
      elapsedAt={props.elapsedAt}
      thermalPeriodAt={props.thermalPeriodAt}
      onOpenDebug={props.onOpenDebug}
    />,
    actorTarget,
  )
}
