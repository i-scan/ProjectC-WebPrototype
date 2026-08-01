import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  THERMAL_DISPLAY_MAX,
  THERMAL_DISPLAY_MIN,
  formatThermalValue,
  thermalAngleFor,
  thermalDirectionFor,
  thermalZoneClass,
} from './thermalPendulumModel'
import './thermal-pendulum.css'

type ThermalPendulumPortalProps = {
  enabled: boolean
}

type ThermalZone = {
  value: number
  label: string
}

const zones: ThermalZone[] = [
  { value: -4, label: '极' },
  { value: -3, label: '−3' },
  { value: -2, label: '−2' },
  { value: -1, label: '−1' },
  { value: 0, label: '0' },
  { value: 1, label: '+1' },
  { value: 2, label: '+2' },
  { value: 3, label: '+3' },
  { value: 4, label: '极' },
]

const pivot = { x: 130, y: 26 }
const arcRadius = 92
const armLength = 77

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

function sampledArcPath(startAngle: number, endAngle: number): string {
  const steps = Math.max(3, Math.ceil(Math.abs(endAngle - startAngle) / 4))
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps
    return pointOnArc(startAngle + (endAngle - startAngle) * progress, arcRadius)
  })
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
}

function directionLabel(momentum: number) {
  const direction = thermalDirectionFor(momentum)
  if (direction === 'hot') return { icon: '→', label: '向热侧' }
  if (direction === 'cold') return { icon: '←', label: '向冷侧' }
  return { icon: '•', label: '静止' }
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

  const temperature = previewTemperature ?? observedTemperature
  const angle = thermalAngleFor(temperature, setPoint)
  const direction = directionLabel(momentum)
  const isPreviewing = previewTemperature !== null || setPoint !== 1

  const zonePaths = useMemo(() => zones.map((zone) => {
    const startValue = Math.max(THERMAL_DISPLAY_MIN, zone.value - 0.5)
    const endValue = Math.min(THERMAL_DISPLAY_MAX, zone.value + 0.5)
    return {
      ...zone,
      className: thermalZoneClass(zone.value),
      path: sampledArcPath(thermalAngleFor(startValue, setPoint), thermalAngleFor(endValue, setPoint)),
      labelPoint: pointOnArc(thermalAngleFor(zone.value, setPoint), arcRadius + 18),
    }
  }), [setPoint])

  return (
    <section className="thermal-pendulum" aria-label={`热力钟摆，当前体温 ${formatThermalValue(temperature)}，Set Point ${formatThermalValue(setPoint)}，动量 ${formatThermalValue(momentum, 2)}`}>
      <div className="thermal-pendulum-heading">
        <div>
          <span>THERMAL PENDULUM</span>
          <strong>热力钟摆</strong>
        </div>
        <div className={`thermal-direction is-${thermalDirectionFor(momentum)}`}>
          <b>{direction.icon}</b>
          <span>{direction.label}</span>
        </div>
      </div>

      <div className="thermal-pendulum-dial">
        <svg viewBox="0 0 260 142" role="img" aria-label="体温分区与摆锤位置">
          <g className="thermal-zone-ring">
            {zonePaths.map((zone) => (
              <path key={zone.value} className={`thermal-zone ${zone.className}`} d={zone.path} />
            ))}
          </g>

          <g className="thermal-zone-labels" aria-hidden="true">
            {zonePaths.map((zone) => (
              <text key={zone.value} x={zone.labelPoint.x} y={zone.labelPoint.y}>{zone.label}</text>
            ))}
          </g>

          <line className="thermal-setpoint-line" x1={pivot.x} y1={pivot.y + 6} x2={pivot.x} y2={pivot.y + arcRadius - 8} />
          <path className="thermal-setpoint-marker" d={`M ${pivot.x - 6} ${pivot.y + arcRadius - 2} L ${pivot.x + 6} ${pivot.y + arcRadius - 2} L ${pivot.x} ${pivot.y + arcRadius + 8} Z`} />
          <text className="thermal-setpoint-caption" x={pivot.x + 24} y={pivot.y + arcRadius + 7}>SET {formatThermalValue(setPoint)}</text>

          <circle className="thermal-pivot-outer" cx={pivot.x} cy={pivot.y} r="8" />
          <circle className="thermal-pivot-inner" cx={pivot.x} cy={pivot.y} r="3" />

          <g
            className="thermal-pendulum-arm"
            style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${pivot.x}px ${pivot.y}px` }}
          >
            <line x1={pivot.x} y1={pivot.y + 5} x2={pivot.x} y2={pivot.y + armLength} />
            <circle className={`thermal-bob ${thermalZoneClass(temperature)}`} cx={pivot.x} cy={pivot.y + armLength} r="13" />
            <circle className="thermal-bob-core" cx={pivot.x} cy={pivot.y + armLength} r="4" />
          </g>
        </svg>
      </div>

      <div className="thermal-readout" aria-live="polite">
        <div><span>当前位置</span><strong>{formatThermalValue(temperature)}</strong></div>
        <div><span>Set Point</span><strong>{formatThermalValue(setPoint)}</strong></div>
        <div><span>精确动量</span><strong>{formatThermalValue(momentum, 2)}</strong></div>
      </div>
      <p className="thermal-prototype-note">摆锤位置跟随体温；动量目前只负责方向显示，尚不参与回合演算。</p>

      <details className="thermal-pendulum-lab">
        <summary>{isPreviewing ? 'UI 参数测试 · Preview' : 'UI 参数测试'}</summary>
        <label>
          <span>体温</span>
          <input
            type="range"
            min={THERMAL_DISPLAY_MIN}
            max={THERMAL_DISPLAY_MAX}
            step="1"
            value={temperature}
            onChange={(event) => setPreviewTemperature(Number(event.target.value))}
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
            onChange={(event) => setSetPoint(Number(event.target.value))}
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
            onChange={(event) => setMomentum(Number(event.target.value))}
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
