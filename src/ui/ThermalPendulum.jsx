import { useEffect, useMemo, useState } from 'react'
import { playbackElapsedMs } from '../sim/solver.js'
import {
  THERMAL_DISPLAY_MAX,
  THERMAL_DISPLAY_MIN,
  THERMAL_PERIOD_AT,
  formatThermal,
  interpolateThermalVisual,
  normalizeThermalPeriodAt,
  thermalAngleFor,
  thermalDialAngleFor,
  thermalDriftProjectionFor,
  thermalZoneClass,
} from '../sim/thermal.js'

const pivot = { x: 130, y: 28 }
const arcRadius = 88
const driftRadius = 101
const armLength = 72
const clamp01 = (value) => Math.max(0, Math.min(1, value))

function pointOnArc(angle, radius) {
  const radians = angle * Math.PI / 180
  return { x: pivot.x + Math.sin(radians) * radius, y: pivot.y + Math.cos(radians) * radius }
}

function sampledArcPath(startAngle, endAngle, radius = arcRadius) {
  const steps = Math.max(3, Math.ceil(Math.abs(endAngle - startAngle) / 3))
  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps
    const point = pointOnArc(startAngle + (endAngle - startAngle) * progress, radius)
    return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  }).join(' ')
}

function driftArrowHeadPath(angle, direction, radius) {
  const radians = angle * Math.PI / 180
  const directionSign = direction === 'hot' ? 1 : -1
  const tangent = { x: Math.cos(radians) * directionSign, y: -Math.sin(radians) * directionSign }
  const normal = { x: -tangent.y, y: tangent.x }
  const tip = pointOnArc(angle, radius)
  const base = { x: tip.x - tangent.x * 8.5, y: tip.y - tangent.y * 8.5 }
  const left = { x: base.x + normal.x * 4.25, y: base.y + normal.y * 4.25 }
  const right = { x: base.x - normal.x * 4.25, y: base.y - normal.y * 4.25 }
  return `M ${tip.x.toFixed(2)} ${tip.y.toFixed(2)} L ${left.x.toFixed(2)} ${left.y.toFixed(2)} L ${right.x.toFixed(2)} ${right.y.toFixed(2)} Z`
}

export function ThermalPendulum({ thermal, elapsedAt, playback, periodAt = THERMAL_PERIOD_AT }) {
  const [debugOpen, setDebugOpen] = useState(false)
  const [frameNow, setFrameNow] = useState(() => performance.now())
  const cycleAt = normalizeThermalPeriodAt(periodAt)

  useEffect(() => {
    if (!playback) return undefined
    let frame = 0
    const tick = () => {
      setFrameNow(performance.now())
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playback?.id, playback?.pausedAt, playback?.pausedTotal, playback?.durationMs])

  const progress = playback
    ? clamp01(playbackElapsedMs(playback, frameNow) / Math.max(1, playback.durationMs ?? 800))
    : 0
  const displayThermal = playback?.startThermal && playback?.finalThermal
    ? interpolateThermalVisual(playback.startThermal, playback.finalThermal, progress)
    : thermal
  const displayAt = playback
    ? (playback.startWorldAt ?? elapsedAt) + progress
    : elapsedAt

  const zoneValues = useMemo(
    () => Array.from({ length: THERMAL_DISPLAY_MAX - THERMAL_DISPLAY_MIN + 1 }, (_, index) => THERMAL_DISPLAY_MIN + index),
    [],
  )
  const zonePaths = useMemo(() => zoneValues.map((value) => ({
    value,
    className: thermalZoneClass(value),
    path: sampledArcPath(thermalDialAngleFor(value - 0.5, displayThermal.setPoint), thermalDialAngleFor(value + 0.5, displayThermal.setPoint)),
  })), [displayThermal.setPoint, zoneValues])
  const bobAngle = thermalAngleFor(displayThermal.temperature, displayThermal.setPoint)
  const bobPoint = pointOnArc(bobAngle, armLength)
  const bobClass = thermalZoneClass(displayThermal.temperature)
  const drift = thermalDriftProjectionFor(displayThermal.temperature, displayThermal.setPoint, displayThermal.drift)
  const driftIdlePoint = pointOnArc(drift.startAngle, driftRadius)
  const driftPath = Math.abs(drift.displayedAngle) < 0.001 ? '' : sampledArcPath(drift.startAngle, drift.endAngle, driftRadius)
  const driftArrowPath = drift.direction === 'still' ? '' : driftArrowHeadPath(drift.endAngle, drift.direction, driftRadius)

  return (
    <section
      className="thermal-pendulum"
      data-visual-at={displayAt.toFixed(3)}
      data-visual-temperature={displayThermal.temperature.toFixed(4)}
      data-cycle-at={cycleAt}
      data-playback-interpolation="single-at-monotonic"
      aria-label={`热力钟摆，当前温度 ${formatThermal(displayThermal.temperature)}，漂移 ${formatThermal(displayThermal.drift)}`}
    >
      <div className="thermal-pendulum-heading">
        <strong>热力钟摆 · 1 cycle = {cycleAt} AT</strong>
        <button type="button" onClick={() => setDebugOpen((value) => !value)}>{debugOpen ? 'Close Debug' : 'Thermal Debug'}</button>
      </div>
      <div className="thermal-pendulum-dial">
        <svg viewBox="0 0 260 158" role="img" aria-label="thermal pendulum state">
          <g className="thermal-zone-ring">
            {zonePaths.map((zone) => <path key={zone.value} className={`thermal-zone ${zone.className}`} d={zone.path} />)}
          </g>
          {drift.direction === 'still' ? (
            <circle className="thermal-drift-idle" cx={driftIdlePoint.x} cy={driftIdlePoint.y} r="3.4" />
          ) : (
            <g className={`thermal-drift-group is-${drift.direction}${drift.clipped ? ' is-clipped' : ''}`}>
              {driftPath && <path className={`thermal-drift-vector is-${drift.direction}`} d={driftPath} />}
              <path className={`thermal-drift-arrow-head is-${drift.direction}`} d={driftArrowPath} />
            </g>
          )}
          <line className="thermal-setpoint-line" x1={pivot.x} y1={pivot.y + 5} x2={pivot.x} y2={pivot.y + arcRadius - 7} />
          <path className="thermal-setpoint-marker" d={`M ${pivot.x - 5} ${pivot.y + arcRadius - 1} L ${pivot.x + 5} ${pivot.y + arcRadius - 1} L ${pivot.x} ${pivot.y + arcRadius + 7} Z`} />
          <circle className="thermal-pivot-outer" cx={pivot.x} cy={pivot.y} r="6" />
          <circle className="thermal-pivot-inner" cx={pivot.x} cy={pivot.y} r="2.2" />
          <g className="thermal-pendulum-arm">
            <line x1={pivot.x} y1={pivot.y + 4} x2={bobPoint.x} y2={bobPoint.y} />
            <circle className={`thermal-bob ${bobClass}`} cx={bobPoint.x} cy={bobPoint.y} r="10" />
            <circle className="thermal-bob-core" cx={bobPoint.x} cy={bobPoint.y} r="3" />
          </g>
        </svg>
      </div>
      <div className="thermal-pendulum-readout">
        <span>T <b>{formatThermal(displayThermal.temperature)}</b></span>
        <span>Drift <b>{formatThermal(displayThermal.drift)}</b></span>
        <span>Cycle <b>{cycleAt} AT</b></span>
        <span>Half swing <b>{(cycleAt / 2).toFixed(cycleAt % 2 === 0 ? 0 : 1)} AT</b></span>
        <span>World <b>{displayAt.toFixed(2)} AT</b></span>
        <span>Action <b>{playback ? `${Math.round(progress * 100)}%` : 'idle'}</b></span>
      </div>
      {debugOpen && (
        <div className="thermal-pendulum-debug-grid">
          <span>Set Point <b>{formatThermal(displayThermal.setPoint)}</b></span>
          <span>Angle <b>{bobAngle.toFixed(1)}°</b></span>
          <span>Drift Dir <b>{drift.direction}</b></span>
          <span>Cycle <b>{cycleAt} AT</b></span>
        </div>
      )}
    </section>
  )
}
