import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { GameState } from '../game'
import { hexWorldPosition } from './HexThreeBoard'
import { labSurfaceLabel } from './coupledInertia'

type RendererMode = '2d' | '3d'
type Props = {
  state: GameState
  rendererMode: RendererMode
  cameraResetToken: number
}

type OrbitState = { yaw: number; pitch: number; zoom: number }

const DEFAULT_ORBIT: OrbitState = { yaw: Math.PI * 0.25, pitch: 0.74, zoom: 1 }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function projectedPoint(point: THREE.Vector3, orbit: OrbitState, width: number, height: number) {
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

function glyphFor(label: string) {
  if (label === 'Hard') return '■'
  if (label === 'Reflect L') return '↰'
  return '↱'
}

export function Ut4DiagnosticSurfaceOverlay({ state, rendererMode, cameraResetToken }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const orbitRef = useRef<OrbitState>({ ...DEFAULT_ORBIT })
  const dragRef = useRef({ active: false, pointerId: -1, lastX: 0, lastY: 0 })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    orbitRef.current = { ...DEFAULT_ORBIT }
    setRevision((value) => value + 1)
  }, [cameraResetToken])

  useEffect(() => {
    const overlay = overlayRef.current
    const frame = overlay?.parentElement
    if (!frame) return
    const redraw = () => setRevision((value) => value + 1)
    const observer = new ResizeObserver(redraw)
    observer.observe(frame)

    if (rendererMode !== '3d') {
      const frameId = requestAnimationFrame(redraw)
      return () => {
        cancelAnimationFrame(frameId)
        observer.disconnect()
      }
    }

    let canvas: HTMLCanvasElement | null = null
    let retryFrame = 0
    let cleanupCanvas: (() => void) | undefined

    const attach = () => {
      canvas = frame.querySelector('.hex-board-host canvas')
      if (!canvas) {
        retryFrame = requestAnimationFrame(attach)
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
      cleanupCanvas = () => {
        canvas?.removeEventListener('pointerdown', handleDown)
        canvas?.removeEventListener('pointermove', handleMove)
        canvas?.removeEventListener('pointerup', handleUp)
        canvas?.removeEventListener('pointercancel', handleUp)
        canvas?.removeEventListener('wheel', handleWheel)
      }
      redraw()
    }

    retryFrame = requestAnimationFrame(attach)
    return () => {
      cancelAnimationFrame(retryFrame)
      cleanupCanvas?.()
      observer.disconnect()
    }
  }, [rendererMode])

  const markers = useMemo(() => {
    const overlay = overlayRef.current
    const frame = overlay?.parentElement
    if (!overlay || !frame) return []
    const width = overlay.clientWidth
    const height = overlay.clientHeight
    const frameRect = frame.getBoundingClientRect()

    return state.cells.flatMap((cell) => {
      const label = labSurfaceLabel(state, cell.coord)
      if (!label) return []
      if (rendererMode === '3d') {
        const point = projectedPoint(hexWorldPosition(cell.coord, state, 0.78), orbitRef.current, width, height)
        return [{ key: `${cell.coord.x},${cell.coord.y}`, label, ...point }]
      }
      const cellGroup = frame.querySelector<SVGGElement>(`.hex-travel-cell[data-x="${cell.coord.x}"][data-y="${cell.coord.y}"]`)
      if (!cellGroup) return []
      const rect = cellGroup.getBoundingClientRect()
      return [{
        key: `${cell.coord.x},${cell.coord.y}`,
        label,
        x: rect.left - frameRect.left + rect.width * 0.5,
        y: rect.top - frameRect.top + rect.height * 0.5,
      }]
    })
  }, [rendererMode, revision, state])

  return (
    <div
      ref={overlayRef}
      className="ut4-diagnostic-surface-overlay"
      aria-label="UT4 diagnostic surfaces"
      style={{ position: 'absolute', inset: 0, zIndex: 15, pointerEvents: 'none', overflow: 'hidden' }}
    >
      {markers.map((marker) => (
        <div
          key={marker.key}
          data-surface-label={marker.label}
          style={{
            position: 'absolute',
            left: marker.x,
            top: marker.y,
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 6px',
            border: '1px solid rgba(242, 200, 90, .9)',
            borderRadius: 6,
            background: 'rgba(14, 21, 32, .9)',
            color: '#fff0a8',
            fontSize: 9,
            fontWeight: 700,
            lineHeight: 1,
            boxShadow: '0 0 10px rgba(242, 200, 90, .28)',
            whiteSpace: 'nowrap',
          }}
        >
          <strong aria-hidden="true">{glyphFor(marker.label)}</strong>
          <span>{marker.label}</span>
        </div>
      ))}
    </div>
  )
}
