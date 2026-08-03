import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  formatThermalValue,
  thermalDialAngleFor,
  thermalDriftVectorFor,
  thermalSlotFor,
  thermalZoneClass,
  THERMAL_DISPLAY_MAX,
  THERMAL_DISPLAY_MIN,
} from './thermalPendulumModel'
import './thermal-pendulum.css'

type ThermalPendulumPortalProps = {
  enabled: boolean
}

type ThermalZone = {
  value: number
}

const zones: ThermalZone[] = [
  { value: -4 },
  { value: -3 },
  { value: -2 },
  { value: -1 },
  { value: 0 },
  { value: 1 },
  { value: 2 },
  { value: 3 },
  { value: 4 },
]

const pivot = { x: 130, y: 28 }
const arcRadius = 88
const driftRadius = 101
const armLength = 72

function parseTemperature(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number(value.replace(/[＋+]/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function findActorPanelTarget(): HTMLElement | null {
  const bars = document.querySelector<HTMLElement>('.hex-prototype .visual-actor-card .visual-bars')
  return bars?.parentElement ?? null
}

function readActorTemperature(): number | null {
  const rows = document.querySelectorAll<HTMLElement>('.hex-prototype .visual-actor-card .visual-bars > div')
  for (const row of rows) {
    if (row.querySelector('span')?.textContent?.trim() !== '体温') continue
    return parseTemperature(row.querySelector('strong')?.textContent)
  }
  return null
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

function ThermalPendulum() {
  const [observedTemperature, setObservedTemperature] = useState(1)
  const [previewTemperature, setPreviewTemperature] = useState<number | null>(null)
  const [setPoint, setSetPoint] = useState(1)
  const [momentum, setMomentum] = useState(0)
  const previousObservedTemperature = useRef<number | null>(null)

  useEffect(() => {
    const syncTemperature = () => {
      const next = readActorTemperature()
      if (next === null) return
      const previous = previousObservedTemperature.current
      if (previous !== null && previous !== next) setMomentum(next - previous)
      previousObservedTemperature.current = next
      setObservedTemperature(next)
    }

    syncTemperature()
    const observer = new MutationObserver(syncTemperature)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [])

  const rawTemperature = previewTemperature ?? observedTemperature
  const slot = thermalSlotFor(rawTemperature, setPoint)
  const temperature = slot.temperature
  const bobPoint = pointOnArc(slot.angle, armLength)
  const drift = thermalDriftVectorFor(momentum)
  const driftIdlePoint = pointOnArc(0, driftRadius)
  const driftPath = drift.direction === 'still'
    ? ''
    : sampledArcPath(0, drift.angle, driftRadius)
  const isPreviewing = previewTemperature !== null || setPoint !== 1 || drift.direction !== 'still'

  const zonePaths = useMemo(() => zones.map((zone) => ({
    ...zone,
    className: thermalZoneClass(zone.value),
    path: sampledArcPath(
      thermalDialAngleFor(zone.value - 0.5, setPoint),
      thermalDialAngleFor(zone.value + 0.5, setPoint),
    ),
  })), [setPoint])

  return (
    <section
      className="thermal-pendulum"
      aria-label={`热力钟摆，当前体温 ${formatThermalValue(temperature)}，平衡温度 ${formatThermalValue(setPoint)}，Drift ${formatThermalValue(momentum, 2)}`}
    >
      <div className="thermal-pendulum-heading">
        <strong>热力钟摆</strong>
      </div>

      <div className="thermal-pendulum-dial">
        <svg viewBox="0 0 260 140" role="img" aria-label="离散体温钟摆与 Drift 向量">
          <defs>
            <marker id="thermal-drift-arrow-hot" markerWidth="7" markerHeight="7" refX="5.6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
              <path className="thermal-drift-arrow-head is-hot" d="M 0 0 L 6 3.5 L 0 7 Z" />
            </marker>
            <marker id="thermal-drift-arrow-cold" markerWidth="7" markerHeight="7" refX="5.6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
              <path className="thermal-drift-arrow-head is-cold" d="M 0 0 L 6 3.5 L 0 7 Z" />
            </marker>
          </defs>

          <g className="thermal-zone-ring">
            {zonePaths.map((zone) => (
              <path key={zone.value} className={`thermal-zone ${zone.className}`} d={zone.path} />
            ))}
          </g>

          {drift.direction === 'still' ? (
            <circle className="thermal-drift-idle" cx={driftIdlePoint.x} cy={driftIdlePoint.y} r="3.4" />
          ) : (
            <path
              className={`thermal-drift-vector is-${drift.direction}`}
              d={driftPath}
              markerEnd={`url(#thermal-drift-arrow-${drift.direction})`}
            />
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

      <details className={`thermal-pendulum-lab ${isPreviewing ? 'is-previewing' : ''}`}>
        <summary>{isPreviewing ? '参数测试 · Preview' : '参数测试'}</summary>
        <label>
          <span>体温</span>
          <input
            type="range"
            min={THERMAL_DISPLAY_MIN}
            max={THERMAL_DISPLAY_MAX}
            step="1"
            value={temperature}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setPreviewTemperature(Number(event.target.value))}
          />
          <output>{formatThermalValue(temperature)}</output>
        </label>
        <label>
          <span>Set Point</span>
          <input
            type="range"
            min="-3"
            max="3"
            step="1"
            value={setPoint}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSetPoint(Number(event.target.value))}
          />
          <output>{formatThermalValue(setPoint)}</output>
        </label>
        <label>
          <span>动量</span>
          <input
            type="range"
            min="-3"
            max="3"
            step="0.25"
            value={momentum}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setMomentum(Number(event.target.value))}
          />
          <output>{formatThermalValue(momentum, 2)}</output>
        </label>
        <button type="button" onClick={() => {
          setPreviewTemperature(null)
          setSetPoint(1)
          setMomentum(0)
        }}>恢复角色数据</button>
      </details>
    </section>
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
