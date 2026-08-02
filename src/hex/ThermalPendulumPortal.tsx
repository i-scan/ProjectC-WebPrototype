import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  formatThermalValue,
  thermalAngleFor,
  thermalDirectionFor,
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
  label?: string
}

const zones: ThermalZone[] = [
  { value: -4 },
  { value: -3, label: '−3' },
  { value: -2, label: '−2' },
  { value: -1, label: '−1' },
  { value: 0, label: '0' },
  { value: 1, label: '+1' },
  { value: 2, label: '+2' },
  { value: 3, label: '+3' },
  { value: 4 },
]

const pivot = { x: 130, y: 23 }
const arcRadius = 91
const armLength = 74

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
  const steps = Math.max(3, Math.ceil(Math.abs(endAngle - startAngle) / 3))
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps
    return pointOnArc(startAngle + (endAngle - startAngle) * progress, arcRadius)
  })
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
}

function DirectionGlyph({ momentum }: { momentum: number }) {
  const direction = thermalDirectionFor(momentum)
  if (direction === 'still') {
    return <circle className="thermal-direction-dot" cx={pivot.x} cy="10" r="2.4" />
  }

  const hot = direction === 'hot'
  const startX = hot ? pivot.x - 8 : pivot.x + 8
  const endX = hot ? pivot.x + 8 : pivot.x - 8
  const arrow = hot
    ? `M ${endX - 4} 6 L ${endX} 10 L ${endX - 4} 14`
    : `M ${endX + 4} 6 L ${endX} 10 L ${endX + 4} 14`

  return (
    <g className={`thermal-direction-glyph is-${direction}`} aria-hidden="true">
      <line x1={startX} y1="10" x2={endX} y2="10" />
      <path d={arrow} />
    </g>
  )
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
  const isPreviewing = previewTemperature !== null || setPoint !== 1 || momentum !== 0

  const zonePaths = useMemo(() => zones.map((zone) => ({
    ...zone,
    className: thermalZoneClass(zone.value),
    path: sampledArcPath(
      thermalAngleFor(zone.value - 0.5, setPoint),
      thermalAngleFor(zone.value + 0.5, setPoint),
    ),
    labelPoint: pointOnArc(thermalAngleFor(zone.value, setPoint), arcRadius + 13),
  })), [setPoint])

  return (
    <section
      className="thermal-pendulum"
      aria-label={`当前体温 ${formatThermalValue(temperature)}，平衡温度 ${formatThermalValue(setPoint)}，动量 ${formatThermalValue(momentum, 2)}`}
    >
      <div className="thermal-pendulum-dial">
        <svg viewBox="0 0 260 126" role="img" aria-label="体温钟摆">
          <g className="thermal-zone-ring">
            {zonePaths.map((zone) => (
              <path key={zone.value} className={`thermal-zone ${zone.className}`} d={zone.path} />
            ))}
          </g>

          <g className="thermal-zone-labels" aria-hidden="true">
            {zonePaths.filter((zone) => zone.label).map((zone) => (
              <text key={zone.value} x={zone.labelPoint.x} y={zone.labelPoint.y}>{zone.label}</text>
            ))}
          </g>

          <DirectionGlyph momentum={momentum} />

          <line className="thermal-setpoint-line" x1={pivot.x} y1={pivot.y + 5} x2={pivot.x} y2={pivot.y + arcRadius - 7} />
          <path className="thermal-setpoint-marker" d={`M ${pivot.x - 5} ${pivot.y + arcRadius - 1} L ${pivot.x + 5} ${pivot.y + arcRadius - 1} L ${pivot.x} ${pivot.y + arcRadius + 7} Z`} />

          <circle className="thermal-pivot-outer" cx={pivot.x} cy={pivot.y} r="6" />
          <circle className="thermal-pivot-inner" cx={pivot.x} cy={pivot.y} r="2.2" />

          <g
            className="thermal-pendulum-arm"
            style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${pivot.x}px ${pivot.y}px` }}
          >
            <line x1={pivot.x} y1={pivot.y + 4} x2={pivot.x} y2={pivot.y + armLength} />
            <circle className={`thermal-bob ${thermalZoneClass(temperature)}`} cx={pivot.x} cy={pivot.y + armLength} r="10" />
            <circle className="thermal-bob-core" cx={pivot.x} cy={pivot.y + armLength} r="3" />
          </g>
        </svg>
      </div>

      <details className={`thermal-pendulum-lab ${isPreviewing ? 'is-previewing' : ''}`}>
        <summary title="钟摆参数测试" aria-label="打开钟摆参数测试"><span aria-hidden="true">•••</span></summary>
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
        }}>恢复</button>
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
