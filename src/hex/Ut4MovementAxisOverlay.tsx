import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { GameState } from '../game'
import type { SpatialInertiaState } from './coupledInertia'
import { hexWorldPosition } from './HexThreeBoard'
import { hexAdvance, type HexDirection } from './hexTopology'

type Props = {
  state: GameState
  spatialByActorId: Record<string, SpatialInertiaState>
  cameraResetToken: number
  active: boolean
}

type OrbitState = { yaw: number; pitch: number; zoom: number }

const DEFAULT_ORBIT: OrbitState = { yaw: Math.PI * 0.25, pitch: 0.74, zoom: 1 }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function projectedPoint(
  point: THREE.Vector3,
  orbit: OrbitState,
  width: number,
  height: number,
) {
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

function axisVector(
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
  return {
    x1: source.x + ux * 8,
    y1: source.y + uy * 8,
    x2: source.x + ux * Math.min(46, length * 0.72),
    y2: source.y + uy * Math.min(46, length * 0.72),
  }
}

export function Ut4MovementAxisOverlay({ state, spatialByActorId, cameraResetToken, active }: Props) {
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

    const redraw = () => setRevision((value) => value + 1)
    const attach = () => {
      canvas = frame.querySelector('.hex-board-host canvas')
      if (!canvas) {
        frameId = requestAnimationFrame(attach)
        return
      }

      const handleDown = (event: PointerEvent) => {
        if (event.button !== 0) return
        dragRef.current = {
          active: true,
          pointerId: event.pointerId,
          lastX: event.clientX,
          lastY: event.clientY,
        }
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
        if (dragRef.current.pointerId !== event.pointerId) return
        dragRef.current.active = false
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

      return () => {
        canvas?.removeEventListener('pointerdown', handleDown)
        canvas?.removeEventListener('pointermove', handleMove)
        canvas?.removeEventListener('pointerup', handleUp)
        canvas?.removeEventListener('pointercancel', handleUp)
        canvas?.removeEventListener('wheel', handleWheel)
        observer?.disconnect()
      }
    }

    let cleanup: (() => void) | undefined
    const start = () => {
      const result = attach()
      if (typeof result === 'function') cleanup = result
    }
    frameId = requestAnimationFrame(start)

    return () => {
      cancelAnimationFrame(frameId)
      cleanup?.()
      observer?.disconnect()
    }
  }, [active])

  const arrows = useMemo(() => {
    if (!active) return []
    const overlay = overlayRef.current
    const width = overlay?.clientWidth ?? 0
    const height = overlay?.clientHeight ?? 0
    if (width <= 0 || height <= 0) return []

    return state.actors.flatMap((actor) => {
      if (!actor.alive) return []
      const spatial = spatialByActorId[actor.id]
      if (spatial?.mode !== 'movement' || !spatial.axis) return []
      return [{
        actorId: actor.id,
        actorName: actor.name,
        direction: spatial.axis,
        ...axisVector(state, actor.position, spatial.axis, orbitRef.current, width, height),
      }]
    })
  }, [active, revision, spatialByActorId, state])

  if (!active) return null

  return (
    <svg
      ref={overlayRef}
      className="ut4-movement-axis-overlay"
      aria-label="UT4 Movement Axis actor overlay"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 16, pointerEvents: 'none', overflow: 'visible' }}
    >
      <defs>
        <marker id="ut4-axis-arrow-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#f2c85a" />
        </marker>
      </defs>
      {arrows.map((arrow) => (
        <g key={arrow.actorId} data-actor-id={arrow.actorId} data-axis={arrow.direction}>
          <line
            x1={arrow.x1}
            y1={arrow.y1}
            x2={arrow.x2}
            y2={arrow.y2}
            stroke="#f2c85a"
            strokeWidth="3"
            strokeLinecap="round"
            markerEnd="url(#ut4-axis-arrow-head)"
            style={{ filter: 'drop-shadow(0 0 4px rgba(242, 200, 90, .78))' }}
          />
          <text
            x={arrow.x2 + 5}
            y={arrow.y2 - 4}
            fill="#fff0a8"
            fontSize="10"
            fontWeight="700"
            style={{ paintOrder: 'stroke', stroke: '#111923', strokeWidth: 3, strokeLinejoin: 'round' }}
          >
            {arrow.direction}
          </text>
        </g>
      ))}
    </svg>
  )
}
