import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { GameState } from '../game'
import type { MomentumLevel, SpatialInertiaState } from './coupledInertiaUt5'
import { hexWorldPosition } from './HexThreeBoard'
import { hexAdvance, type HexDirection } from './hexTopology'

type Props = {
  state: GameState
  spatialByActorId: Record<string, SpatialInertiaState>
  cameraResetToken: number
  active: boolean
}

type OrbitState = { yaw: number; pitch: number; zoom: number }
type Projected = { x: number; y: number }
type HorizontalMarker = {
  actorId: string
  kind: 'horizontal'
  axis: HexDirection
  level: MomentumLevel
  source: Projected
  x1: number
  y1: number
  x2: number
  y2: number
}
type DownMarker = {
  actorId: string
  kind: 'down'
  axis: 'Down'
  level: MomentumLevel
  source: Projected
}
type AxisMarker = HorizontalMarker | DownMarker

const DEFAULT_ORBIT: OrbitState = { yaw: Math.PI * 0.25, pitch: 0.74, zoom: 1 }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function projectedPoint(point: THREE.Vector3, orbit: OrbitState, width: number, height: number): Projected {
  const aspect = width / Math.max(1, height)
  const size = 6.2
  const camera = new THREE.OrthographicCamera(-size * aspect, size * aspect, size, -size, 0.1, 60)
  const radius = 17
  const horizontal = Math.cos(orbit.pitch) * radius
  camera.position.set(
    Math.sin(orbit.yaw) * horizontal,
    Math.sin(orbit.pitch) * radius,
    Math.cos(orbit.yaw) * horizontal,
  )
  camera.lookAt(0, 0.2, 0)
  camera.zoom = orbit.zoom
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  const projected = point.clone().project(camera)
  return {
    x: (projected.x + 1) * 0.5 * width,
    y: (1 - projected.y) * 0.5 * height,
  }
}

function horizontalVector(
  state: GameState,
  actorPosition: { x: number; y: number },
  direction: HexDirection,
  orbit: OrbitState,
  width: number,
  height: number,
) {
  const sourceWorld = hexWorldPosition(actorPosition, state, 1.25)
  const targetWorld = hexWorldPosition(hexAdvance(actorPosition, direction), state, 1.25)
  const source = projectedPoint(sourceWorld, orbit, width, height)
  const target = projectedPoint(targetWorld, orbit, width, height)
  const dx = target.x - source.x
  const dy = target.y - source.y
  const length = Math.max(1, Math.hypot(dx, dy))
  const ux = dx / length
  const uy = dy / length
  const arrowLength = Math.min(46, length * 0.72)
  return {
    x1: source.x + ux * 8,
    y1: source.y + uy * 8,
    x2: source.x + ux * arrowLength,
    y2: source.y + uy * arrowLength,
  }
}

export function Ut5AxisOverlay({ state, spatialByActorId, cameraResetToken, active }: Props) {
  const overlayRef = useRef<SVGSVGElement>(null)
  const orbitRef = useRef<OrbitState>({ ...DEFAULT_ORBIT })
  const dragRef = useRef({ active: false, pointerId: -1, lastX: 0, lastY: 0 })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    orbitRef.current = { ...DEFAULT_ORBIT }
    setRevision((value) => value + 1)
  }, [cameraResetToken])

  useEffect(() => {
    if (!active) return
    const overlay = overlayRef.current
    const frame = overlay?.parentElement
    if (!frame) return
    let canvas: HTMLCanvasElement | null = null
    let frameId = 0
    let observer: ResizeObserver | undefined
    let detach: (() => void) | undefined
    const redraw = () => setRevision((value) => value + 1)

    const tryAttach = () => {
      canvas = frame.querySelector('.hex-board-host canvas')
      if (!canvas) {
        frameId = requestAnimationFrame(tryAttach)
        return
      }
      const handleDown = (event: PointerEvent) => {
        if (event.button !== 0) return
        dragRef.current = { active: true, pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY }
      }
      const handleMove = (event: PointerEvent) => {
        const drag = dragRef.current
        if (!drag.active || drag.pointerId !== event.pointerId) return
        const dx = event.clientX - drag.lastX
        const dy = event.clientY - drag.lastY
        drag.lastX = event.clientX
        drag.lastY = event.clientY
        orbitRef.current.yaw -= dx * 0.008
        orbitRef.current.pitch = clamp(orbitRef.current.pitch + dy * 0.006, 0.38, 1.22)
        redraw()
      }
      const handleUp = (event: PointerEvent) => {
        if (dragRef.current.pointerId === event.pointerId) dragRef.current.active = false
      }
      const handleWheel = (event: WheelEvent) => {
        orbitRef.current.zoom = clamp(orbitRef.current.zoom * Math.exp(-event.deltaY * 0.001), 0.58, 2.15)
        redraw()
      }
      canvas.addEventListener('pointerdown', handleDown)
      canvas.addEventListener('pointermove', handleMove)
      canvas.addEventListener('pointerup', handleUp)
      canvas.addEventListener('pointercancel', handleUp)
      canvas.addEventListener('wheel', handleWheel)
      observer = new ResizeObserver(redraw)
      observer.observe(frame)
      redraw()
      detach = () => {
        canvas?.removeEventListener('pointerdown', handleDown)
        canvas?.removeEventListener('pointermove', handleMove)
        canvas?.removeEventListener('pointerup', handleUp)
        canvas?.removeEventListener('pointercancel', handleUp)
        canvas?.removeEventListener('wheel', handleWheel)
        observer?.disconnect()
      }
    }
    frameId = requestAnimationFrame(tryAttach)
    return () => {
      cancelAnimationFrame(frameId)
      detach?.()
      observer?.disconnect()
    }
  }, [active])

  const markers = useMemo<AxisMarker[]>(() => {
    if (!active) return []
    const overlay = overlayRef.current
    const width = overlay?.clientWidth ?? 0
    const height = overlay?.clientHeight ?? 0
    if (width <= 0 || height <= 0) return []
    const result: AxisMarker[] = []
    for (const actor of state.actors) {
      if (!actor.alive) continue
      const spatial = spatialByActorId[actor.id]
      if (!spatial?.axis || spatial.level <= 0) continue
      const source = projectedPoint(hexWorldPosition(actor.position, state, 1.25), orbitRef.current, width, height)
      if (spatial.axis.kind === 'horizontal') {
        result.push({
          actorId: actor.id,
          kind: 'horizontal',
          axis: spatial.axis.dir,
          level: spatial.level,
          source,
          ...horizontalVector(state, actor.position, spatial.axis.dir, orbitRef.current, width, height),
        })
      } else if (spatial.axis.kind === 'down') {
        result.push({ actorId: actor.id, kind: 'down', axis: 'Down', level: spatial.level, source })
      }
    }
    return result
  }, [active, revision, spatialByActorId, state])

  if (!active) return null
  return (
    <svg
      ref={overlayRef}
      className="ut5-axis-overlay"
      aria-label="UT5 actor Momentum Axis overlay"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 16, pointerEvents: 'none', overflow: 'visible' }}
    >
      <defs>
        <marker id="ut5-axis-arrow-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#f2c85a" />
        </marker>
      </defs>
      {markers.map((marker) => marker.kind === 'horizontal' ? (
        <g key={marker.actorId} data-actor-id={marker.actorId} data-axis={marker.axis} data-momentum={marker.level}>
          <line x1={marker.x1} y1={marker.y1} x2={marker.x2} y2={marker.y2} stroke="#f2c85a" strokeWidth="3" strokeLinecap="round" markerEnd="url(#ut5-axis-arrow-head)" style={{ filter: 'drop-shadow(0 0 4px rgba(242, 200, 90, .78))' }} />
          <text x={marker.x2 + 5} y={marker.y2 - 4} fill="#fff0a8" fontSize="10" fontWeight="700" style={{ paintOrder: 'stroke', stroke: '#111923', strokeWidth: 3, strokeLinejoin: 'round' }}>{marker.axis} · M{marker.level}</text>
        </g>
      ) : (
        <g key={marker.actorId} data-actor-id={marker.actorId} data-axis="Down" data-momentum={marker.level}>
          <circle cx={marker.source.x} cy={marker.source.y + 10} r="9" fill="rgba(90,190,235,.12)" stroke="#7ed8ff" strokeWidth="2" />
          <path d={`M ${marker.source.x} ${marker.source.y + 4} L ${marker.source.x} ${marker.source.y + 15} M ${marker.source.x - 4} ${marker.source.y + 11} L ${marker.source.x} ${marker.source.y + 15} L ${marker.source.x + 4} ${marker.source.y + 11}`} fill="none" stroke="#7ed8ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <text x={marker.source.x + 12} y={marker.source.y + 14} fill="#bdeeff" fontSize="9" fontWeight="700" style={{ paintOrder: 'stroke', stroke: '#111923', strokeWidth: 3, strokeLinejoin: 'round' }}>Down · M{marker.level}</text>
        </g>
      ))}
    </svg>
  )
}
