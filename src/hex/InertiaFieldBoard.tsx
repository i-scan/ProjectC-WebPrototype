import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { getPlayer, type Coord } from '../game'
import type { SpatialAxis, Ut7State } from './actorLoopUt7'
import { hexDirectionWorldVector, hexWorldOffset } from './hexTopology'
import type { NormalizedHexPoint } from './actorLoopUt7ReachableField'

const HEX_RADIUS = 0.56
const TILE_HEIGHT = 0.14
const ROOT_THREE = Math.sqrt(3)

export type InertiaFieldPlayback = {
  id: number
  points: NormalizedHexPoint[]
  mode: 'discrete' | 'hybrid'
}

type Props = {
  state: Ut7State
  validCoords: Coord[]
  selectedCoord: Coord
  hoverCoord?: Coord
  previewPoints: NormalizedHexPoint[]
  actorPoint: NormalizedHexPoint
  axis: SpatialAxis | null
  playback?: InertiaFieldPlayback
  mode: 'discrete' | 'hybrid'
  onCellClick: (coord: Coord) => void
  onCellHover: (coord?: Coord) => void
}

type MoveAnimation = {
  points: THREE.Vector3[]
  startedAt: number
  duration: number
}

const keyOf = (coord: Coord) => `${coord.x},${coord.y}`

function normalizedCenter(state: Ut7State) {
  const min = hexWorldOffset({ x: 0, y: 0 }, 1)
  const max = hexWorldOffset({ x: state.game.config.width - 1, y: state.game.config.height - 1 }, 1)
  const extra = state.game.config.height > 1 ? ROOT_THREE * 0.25 : 0
  return { x: (min.x + max.x + extra) * 0.5, z: (min.z + max.z) * 0.5 }
}

function worldPoint(point: NormalizedHexPoint, state: Ut7State, y = 0) {
  const center = normalizedCenter(state)
  return new THREE.Vector3(
    (point.x - center.x) * HEX_RADIUS,
    y,
    (point.z - center.z) * HEX_RADIUS,
  )
}

function cellPoint(coord: Coord) {
  return hexWorldOffset(coord, 1)
}

function tileColor(state: Ut7State, coord: Coord) {
  const cell = state.game.cells.find((candidate) => candidate.coord.x === coord.x && candidate.coord.y === coord.y)
  if (!cell) return 0x263243
  if (cell.tags.some((tag) => tag === 'Blocked' || tag === 'Mountain')) return 0x3d4650
  if (cell.groundFill === 'water') return 0x315f79
  if (cell.groundFill === 'ice') return 0x8fc7d7
  if (cell.groundFill === 'grass') return 0x466747
  if (cell.groundFill === 'fire') return 0x7f4438
  return 0x59616a
}

function disposeGroup(group: THREE.Group) {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return
    object.geometry?.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) material?.dispose()
  })
  group.clear()
}

function createActor(color: number) {
  const group = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.18, 0.24, 5, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.08 }),
  )
  body.position.y = 0.28
  body.castShadow = true
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.27, 0.025, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xd7f0ff, transparent: true, opacity: 0.9 }),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.08
  group.add(body, ring)
  return group
}

function lineFor(points: THREE.Vector3[], color: number, opacity = 0.9) {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  )
  line.renderOrder = 30
  return line
}

export function InertiaFieldBoard({
  state,
  validCoords,
  selectedCoord,
  hoverCoord,
  previewPoints,
  actorPoint,
  axis,
  playback,
  mode,
  onCellClick,
  onCellHover,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const staticGroupRef = useRef<THREE.Group | null>(null)
  const overlayGroupRef = useRef<THREE.Group | null>(null)
  const pathGroupRef = useRef<THREE.Group | null>(null)
  const actorRef = useRef<THREE.Group | null>(null)
  const axisRef = useRef<THREE.Line | null>(null)
  const cellMeshesRef = useRef<THREE.Mesh[]>([])
  const moveRef = useRef<MoveAnimation | null>(null)
  const stateRef = useRef(state)
  const modeRef = useRef(mode)
  const onClickRef = useRef(onCellClick)
  const onHoverRef = useRef(onCellHover)
  const playedIdRef = useRef<number | null>(null)
  const zoomRef = useRef(1)

  stateRef.current = state
  modeRef.current = mode
  onClickRef.current = onCellClick
  onHoverRef.current = onCellHover

  const validKey = useMemo(() => validCoords.map(keyOf).sort().join('|'), [validCoords])
  const previewKey = useMemo(() => previewPoints.map((point) => `${point.x.toFixed(3)},${point.z.toFixed(3)}`).join('|'), [previewPoints])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    host.replaceChildren(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x101722)
    scene.fog = new THREE.Fog(0x101722, 13, 25)

    const camera = new THREE.OrthographicCamera(-7, 7, 5, -5, 0.1, 60)
    camera.position.set(8.6, 10.5, 10.8)
    camera.lookAt(0, 0, 0)

    scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x243040, 2.1))
    const sun = new THREE.DirectionalLight(0xfff0d2, 2.7)
    sun.position.set(6, 10, 5)
    sun.castShadow = true
    scene.add(sun)

    const staticGroup = new THREE.Group()
    const overlayGroup = new THREE.Group()
    const pathGroup = new THREE.Group()
    scene.add(staticGroup, overlayGroup, pathGroup)

    const actor = createActor(0x58baf2)
    scene.add(actor)

    rendererRef.current = renderer
    cameraRef.current = camera
    sceneRef.current = scene
    staticGroupRef.current = staticGroup
    overlayGroupRef.current = overlayGroup
    pathGroupRef.current = pathGroup
    actorRef.current = actor

    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setSize(width, height, false)
      const aspect = width / height
      const radius = Math.max(4.4, stateRef.current.setup.boardRadius * 0.86)
      camera.left = -radius * aspect / zoomRef.current
      camera.right = radius * aspect / zoomRef.current
      camera.top = radius / zoomRef.current
      camera.bottom = -radius / zoomRef.current
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const pointerCoord = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(cellMeshesRef.current, false)[0]
      return hit?.object.userData.coord as Coord | undefined
    }
    const move = (event: PointerEvent) => onHoverRef.current(pointerCoord(event))
    const leave = () => onHoverRef.current(undefined)
    const click = (event: PointerEvent) => {
      const coord = pointerCoord(event)
      if (coord) onClickRef.current(coord)
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomRef.current = Math.max(0.65, Math.min(2.2, zoomRef.current * Math.exp(-event.deltaY * 0.001)))
      resize()
    }
    renderer.domElement.addEventListener('pointermove', move)
    renderer.domElement.addEventListener('pointerleave', leave)
    renderer.domElement.addEventListener('click', click)
    renderer.domElement.addEventListener('wheel', wheel, { passive: false })

    let frame = 0
    const render = () => {
      const animation = moveRef.current
      if (animation && actorRef.current) {
        const now = performance.now()
        const progress = Math.max(0, Math.min(1, (now - animation.startedAt) / animation.duration))
        const segmentCount = Math.max(1, animation.points.length - 1)
        const scaled = progress * segmentCount
        const segmentIndex = Math.min(segmentCount - 1, Math.floor(scaled))
        const local = scaled - segmentIndex
        const activeMode = modeRef.current
        const eased = activeMode === 'discrete' ? 1 - Math.pow(1 - local, 3) : local * local * (3 - 2 * local)
        const from = animation.points[segmentIndex]
        const to = animation.points[segmentIndex + 1] ?? from
        actorRef.current.position.lerpVectors(from, to, eased)
        host.dataset.playbackMode = activeMode
        host.dataset.playbackProgress = progress.toFixed(3)
        if (progress >= 1) moveRef.current = null
      }
      renderer.render(scene, camera)
      frame = requestAnimationFrame(render)
    }
    render()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointermove', move)
      renderer.domElement.removeEventListener('pointerleave', leave)
      renderer.domElement.removeEventListener('click', click)
      renderer.domElement.removeEventListener('wheel', wheel)
      disposeGroup(staticGroup)
      disposeGroup(overlayGroup)
      disposeGroup(pathGroup)
      renderer.dispose()
      rendererRef.current = null
      cameraRef.current = null
      sceneRef.current = null
      staticGroupRef.current = null
      overlayGroupRef.current = null
      pathGroupRef.current = null
      actorRef.current = null
      host.replaceChildren()
    }
  }, [])

  useEffect(() => {
    const group = staticGroupRef.current
    if (!group) return
    disposeGroup(group)
    cellMeshesRef.current = []

    for (const cell of state.game.cells) {
      if (cell.tags.includes('Void')) continue
      const point = worldPoint(cellPoint(cell.coord), state)
      const blocked = cell.tags.some((tag) => tag === 'Blocked' || tag === 'Mountain')
      const tile = new THREE.Mesh(
        new THREE.CylinderGeometry(HEX_RADIUS * 0.96, HEX_RADIUS * 0.96, blocked ? 0.28 : TILE_HEIGHT, 6),
        new THREE.MeshStandardMaterial({
          color: tileColor(state, cell.coord),
          roughness: 0.86,
          metalness: 0.02,
          transparent: true,
          opacity: 0.96,
        }),
      )
      tile.position.copy(point)
      tile.position.y = blocked ? 0.07 : 0
      tile.receiveShadow = true
      tile.userData.coord = { ...cell.coord }
      cellMeshesRef.current.push(tile)
      group.add(tile)
    }

    for (const actor of state.game.actors.filter((entry) => entry.alive && entry.id !== 'player')) {
      const pawn = createActor(actor.faction === 'enemy' ? 0xd65d6a : 0xd7a556)
      pawn.scale.setScalar(0.82)
      pawn.position.copy(worldPoint(cellPoint(actor.position), state, 0.02))
      group.add(pawn)
    }

    const camera = cameraRef.current
    const host = hostRef.current
    if (camera && host) {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      const aspect = width / height
      const radius = Math.max(4.4, state.setup.boardRadius * 0.86)
      camera.left = -radius * aspect / zoomRef.current
      camera.right = radius * aspect / zoomRef.current
      camera.top = radius / zoomRef.current
      camera.bottom = -radius / zoomRef.current
      camera.updateProjectionMatrix()
    }
  }, [state])

  useEffect(() => {
    const group = overlayGroupRef.current
    if (!group) return
    disposeGroup(group)
    const valid = new Set(validCoords.map(keyOf))

    for (const coord of validCoords) {
      const target = new THREE.Mesh(
        new THREE.CylinderGeometry(HEX_RADIUS * 0.79, HEX_RADIUS * 0.79, 0.018, 6),
        new THREE.MeshBasicMaterial({
          color: mode === 'hybrid' ? 0x6ad8ff : 0xd58aff,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
        }),
      )
      target.position.copy(worldPoint(cellPoint(coord), state, 0.16))
      target.renderOrder = 20
      group.add(target)
    }

    const addRing = (coord: Coord, color: number, radius: number) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.72, radius, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.copy(worldPoint(cellPoint(coord), state, 0.19))
      ring.renderOrder = 24
      group.add(ring)
    }
    addRing(selectedCoord, 0xffd46a, 0.34)
    if (hoverCoord) addRing(hoverCoord, valid.has(keyOf(hoverCoord)) ? 0xffffff : 0x8491a3, 0.28)
  }, [state, validKey, selectedCoord.x, selectedCoord.y, hoverCoord?.x, hoverCoord?.y, mode])

  useEffect(() => {
    const group = pathGroupRef.current
    if (!group) return
    disposeGroup(group)
    if (previewPoints.length < 2) return
    const points = previewPoints.map((point) => worldPoint(point, state, 0.23))
    group.add(lineFor(points, mode === 'hybrid' ? 0x70ddff : 0xf0bd69, 0.98))
  }, [state, previewKey, mode])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !actorRef.current) return
    if (!moveRef.current) actorRef.current.position.copy(worldPoint(actorPoint, state, 0.08))

    if (axisRef.current) {
      scene.remove(axisRef.current)
      axisRef.current.geometry.dispose()
      ;(axisRef.current.material as THREE.Material).dispose()
      axisRef.current = null
    }
    if (axis?.kind === 'horizontal') {
      const vector = hexDirectionWorldVector(axis.dir, 1)
      const length = Math.hypot(vector.x, vector.z)
      const start = worldPoint(actorPoint, state, 0.46)
      const end = start.clone().add(new THREE.Vector3(vector.x / length * 0.92, 0, vector.z / length * 0.92))
      const line = lineFor([start, end], 0xff7f62, 1)
      scene.add(line)
      axisRef.current = line
    }
  }, [state, actorPoint.x, actorPoint.z, axis])

  useEffect(() => {
    if (!playback || playback.points.length < 2 || playback.id === playedIdRef.current) return
    playedIdRef.current = playback.id
    const points = playback.points.map((point) => worldPoint(point, state, 0.08))
    if (actorRef.current) actorRef.current.position.copy(points[0])
    moveRef.current = {
      points,
      startedAt: performance.now(),
      duration: Math.max(420, Math.min(1450, 360 + points.length * (playback.mode === 'hybrid' ? 42 : 105))),
    }
    const host = hostRef.current
    if (host) {
      host.dataset.playbackId = String(playback.id)
      host.dataset.playbackPoints = String(playback.points.length)
      host.dataset.playbackMode = playback.mode
    }
  }, [playback?.id, state])

  return <div className="inertia-field-board" ref={hostRef} data-mode={mode} aria-label="Inertia reachable field comparison board" />
}
