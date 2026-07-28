import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import {
  actorAt,
  distance,
  getPlayer,
  type BasicAction,
  type Card,
  type Cell,
  type Coord,
  type GameState,
  type GroundFill,
  type Layer,
} from '../game'

export type VisualSelection =
  | { kind: 'inspect' }
  | { kind: 'basic'; action: BasicAction }
  | { kind: 'card'; card: Card }

export type VisualEvent = {
  id: number
  kind: 'move' | 'attack' | 'heat' | 'cool' | 'guard' | 'phase' | 'reset'
  target?: Coord
}

type Props = {
  state: GameState
  selectedCoord: Coord
  selection: VisualSelection
  targetLayer: Layer
  cameraResetToken: number
  showSky: boolean
  showDebug: boolean
  event?: VisualEvent
  onCellClick: (coord: Coord) => void
  onCellHover?: (coord?: Coord) => void
}

type BobAnimation = {
  object: THREE.Object3D
  baseY: number
  phase: number
  amplitude: number
  speed: number
}

type MoveAnimation = {
  object: THREE.Object3D
  from: THREE.Vector3
  to: THREE.Vector3
  startedAt: number
  duration: number
}

type PulseAnimation = {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  startedAt: number
  duration: number
}

type OrbitState = {
  yaw: number
  pitch: number
  distance: number
  zoom: number
}

const DEFAULT_ORBIT: OrbitState = {
  yaw: Math.PI * 0.25,
  pitch: 0.72,
  distance: 18.2,
  zoom: 1,
}

const temperatureColors = [0x3e7bd6, 0x5e9de0, 0x75b8ca, 0xa7a89f, 0xd3a55f, 0xdf7545, 0xef493e]
const actorColors = {
  player: 0x4ba7df,
  hunter: 0xd25463,
  elite: 0x8f62c7,
  npc: 0xd4a05a,
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function worldPosition(coord: Coord, state: GameState, height = 0) {
  return new THREE.Vector3(
    coord.x - (state.config.width - 1) * 0.5,
    height,
    coord.y - (state.config.height - 1) * 0.5,
  )
}

function fillColor(fill: GroundFill) {
  switch (fill) {
    case 'grass': return new THREE.Color(0x4f7748)
    case 'water': return new THREE.Color(0x316a86)
    case 'ice': return new THREE.Color(0xa5d9e7)
    case 'fire': return new THREE.Color(0x8e4937)
    default: return new THREE.Color(0x777b72)
  }
}

function cellColor(cell: Cell) {
  const color = fillColor(cell.groundFill)
  const normalized = clamp(cell.groundTemp, -3, 3) + 3
  const temperatureColor = new THREE.Color(temperatureColors[normalized])
  const strength = cell.groundTemp === 0 ? 0.05 : 0.22 + Math.abs(cell.groundTemp) * 0.1
  return color.lerp(temperatureColor, strength)
}

function createPlaneMaterial(color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

function createOverlay(color: number, opacity: number, height: number, size = 0.82) {
  const geometry = new THREE.PlaneGeometry(size, size)
  geometry.rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(geometry, createPlaneMaterial(color, opacity))
  mesh.position.y = height
  mesh.renderOrder = 8
  return mesh
}

function createCloud(cell: Cell, bobAnimations: BobAnimation[]) {
  const group = new THREE.Group()
  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: cell.skyTemp > 0 ? 0xffdcc3 : cell.skyTemp < 0 ? 0xd7ecff : 0xf1f2ec,
    roughness: 0.92,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  })
  const parts = [
    [-0.22, 0, 0, 0.28],
    [0.08, 0.1, 0, 0.35],
    [0.34, 0, 0.02, 0.25],
    [0.04, -0.02, 0.2, 0.27],
  ] as const
  for (const [x, y, z, radius] of parts) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), cloudMaterial)
    sphere.position.set(x, y, z)
    sphere.castShadow = true
    group.add(sphere)
  }
  bobAnimations.push({
    object: group,
    baseY: 2.15,
    phase: Math.random() * Math.PI * 2,
    amplitude: 0.08,
    speed: 1.1,
  })
  return group
}

function createWindArrow(direction: NonNullable<Cell['wind']>) {
  const group = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: 0xc7ecff, transparent: true, opacity: 0.82 })
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.48, 8), material)
  shaft.rotation.z = Math.PI / 2
  shaft.position.x = 0.05
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.25, 10), material)
  head.rotation.z = -Math.PI / 2
  head.position.x = 0.38
  group.add(shaft, head)
  const rotations = { E: 0, S: -Math.PI / 2, W: Math.PI, N: Math.PI / 2 }
  group.rotation.y = rotations[direction]
  group.position.y = 1.35
  return group
}

function createActorPawn(actor: GameState['actors'][number], billboardGroups: THREE.Group[]) {
  const group = new THREE.Group()
  const primary = new THREE.MeshStandardMaterial({
    color: actorColors[actor.actorType],
    roughness: 0.48,
    metalness: actor.actorType === 'elite' ? 0.32 : 0.05,
  })
  const trim = new THREE.MeshStandardMaterial({
    color: actor.faction === 'enemy' ? 0x4e1720 : 0xe9d6a7,
    roughness: 0.55,
  })

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.12, 20), trim)
  base.position.y = 0.08
  base.castShadow = true
  const bodyScale = actor.actorType === 'elite' ? 1.15 : actor.actorType === 'hunter' ? 0.9 : 1
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * bodyScale, 0.29 * bodyScale, 0.58 * bodyScale, 16),
    primary,
  )
  body.position.y = 0.42
  body.castShadow = true
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2 * bodyScale, 16, 12), primary)
  head.position.y = 0.78 * bodyScale
  head.castShadow = true
  group.add(base, body, head)

  if (actor.actorType === 'player') {
    const sword = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.48, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xe7edf5, metalness: 0.75, roughness: 0.2 }),
    )
    sword.position.set(0.31, 0.53, 0)
    sword.rotation.z = -0.35
    sword.castShadow = true
    group.add(sword)
  }

  if (actor.actorType === 'hunter') {
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 8), primary)
      ear.position.set(0.11 * side, 0.98, 0)
      ear.rotation.z = -0.2 * side
      group.add(ear)
    }
  }

  if (actor.actorType === 'elite') {
    const shield = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.55, 0.44),
      new THREE.MeshStandardMaterial({ color: 0xc49b47, metalness: 0.58, roughness: 0.32 }),
    )
    shield.position.set(-0.34, 0.46, 0)
    shield.castShadow = true
    group.add(shield)
  }

  if (actor.actorType === 'npc') {
    const frost = new THREE.Mesh(
      new THREE.TorusGeometry(0.27, 0.03, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xa9e7ff, transparent: true, opacity: 0.75 }),
    )
    frost.position.y = 0.38
    frost.rotation.x = Math.PI / 2
    group.add(frost)
  }

  const bar = new THREE.Group()
  const barBack = new THREE.Mesh(
    new THREE.PlaneGeometry(0.64, 0.075),
    new THREE.MeshBasicMaterial({ color: 0x261a1d, depthTest: false }),
  )
  const ratio = Math.max(0.01, actor.hp / actor.maxHp)
  const barFill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6 * ratio, 0.045),
    new THREE.MeshBasicMaterial({
      color: actor.faction === 'enemy' ? 0xf0626e : 0x70d58d,
      depthTest: false,
    }),
  )
  barFill.position.x = -0.3 + 0.3 * ratio
  barFill.position.z = 0.002
  bar.add(barBack, barFill)
  bar.position.y = actor.actorType === 'elite' ? 1.25 : 1.08
  bar.renderOrder = 20
  group.add(bar)
  billboardGroups.push(bar)

  if (actor.shield > 0) {
    const shieldRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.41, 0.025, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x7fd7ff, transparent: true, opacity: 0.8 }),
    )
    shieldRing.position.y = 0.42
    shieldRing.rotation.x = Math.PI / 2
    group.add(shieldRing)
  }

  return group
}

function isValidTarget(state: GameState, selection: VisualSelection, coord: Coord) {
  const player = getPlayer(state)
  if (selection.kind === 'inspect') return false
  if (selection.kind === 'basic') {
    if (selection.action === 'move') {
      return distance(player.position, coord) === 1 && !actorAt(state, coord, false)
    }
    return distance(player.position, coord) === 1 && Boolean(actorAt(state, coord, false))
  }
  if (selection.card.target === 'self') return false
  if (distance(player.position, coord) > selection.card.range) return false
  if (selection.card.target === 'actor') return Boolean(actorAt(state, coord))
  return true
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    mesh.geometry?.dispose?.()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
    else material?.dispose?.()
  })
}

export function InteractiveThreeBoard({
  state,
  selectedCoord,
  selection,
  targetLayer,
  cameraResetToken,
  showSky,
  showDebug,
  event,
  onCellClick,
  onCellHover,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null)
  const contentRef = useRef<THREE.Group | null>(null)
  const clickTargetsRef = useRef<THREE.Object3D[]>([])
  const onClickRef = useRef(onCellClick)
  const onHoverRef = useRef(onCellHover)
  const stateRef = useRef(state)
  const bobAnimationsRef = useRef<BobAnimation[]>([])
  const moveAnimationsRef = useRef<MoveAnimation[]>([])
  const pulseAnimationsRef = useRef<PulseAnimation[]>([])
  const billboardsRef = useRef<THREE.Group[]>([])
  const previousActorPositionsRef = useRef(new Map<string, Coord>())
  const hoverRingRef = useRef<THREE.Mesh | null>(null)
  const orbitRef = useRef<OrbitState>({ ...DEFAULT_ORBIT })
  const updateCameraRef = useRef<() => void>(() => undefined)

  onClickRef.current = onCellClick
  onHoverRef.current = onCellHover
  stateRef.current = state

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x101a2a, 0.028)
    const camera = new THREE.OrthographicCamera(-7, 7, 7, -7, 0.1, 80)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.tabIndex = 0
    renderer.domElement.setAttribute('aria-label', '3D board. Drag to orbit, use the wheel to zoom, and press Q/E or A/D to rotate.')
    host.appendChild(renderer.domElement)

    const content = new THREE.Group()
    scene.add(content)
    const ambient = new THREE.HemisphereLight(0xcfe8ff, 0x2b2631, 1.9)
    scene.add(ambient)
    const key = new THREE.DirectionalLight(0xfff0d4, 3.2)
    key.position.set(-7, 14, 8)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = -9
    key.shadow.camera.right = 9
    key.shadow.camera.top = 9
    key.shadow.camera.bottom = -9
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x6bb8ff, 1.2)
    rim.position.set(9, 7, -8)
    scene.add(rim)

    const hoverGeometry = new THREE.RingGeometry(0.37, 0.46, 32)
    hoverGeometry.rotateX(-Math.PI / 2)
    const hoverRing = new THREE.Mesh(
      hoverGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
    )
    hoverRing.visible = false
    hoverRing.position.y = 0.17
    hoverRing.renderOrder = 20
    scene.add(hoverRing)

    rendererRef.current = renderer
    sceneRef.current = scene
    cameraRef.current = camera
    contentRef.current = content
    hoverRingRef.current = hoverRing

    const updateCamera = () => {
      const orbit = orbitRef.current
      const horizontalDistance = Math.cos(orbit.pitch) * orbit.distance
      camera.position.set(
        Math.cos(orbit.yaw) * horizontalDistance,
        Math.sin(orbit.pitch) * orbit.distance,
        Math.sin(orbit.yaw) * horizontalDistance,
      )
      camera.zoom = orbit.zoom
      camera.lookAt(0, 0.35, 0)
      camera.updateProjectionMatrix()
    }
    updateCameraRef.current = updateCamera
    updateCamera()

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const findCoord = (eventValue: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((eventValue.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((eventValue.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(clickTargetsRef.current, false)[0]
      return hit?.object.userData.coord as Coord | undefined
    }

    const drag = {
      active: false,
      pointerId: -1,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      moved: false,
    }

    const updateHover = (eventValue: PointerEvent) => {
      const coord = findCoord(eventValue)
      renderer.domElement.style.cursor = coord ? 'pointer' : 'grab'
      hoverRing.visible = Boolean(coord)
      if (coord) hoverRing.position.copy(worldPosition(coord, stateRef.current, 0.18))
      onHoverRef.current?.(coord)
    }

    const handlePointerDown = (eventValue: PointerEvent) => {
      if (eventValue.button !== 0) return
      renderer.domElement.focus({ preventScroll: true })
      drag.active = true
      drag.pointerId = eventValue.pointerId
      drag.startX = eventValue.clientX
      drag.startY = eventValue.clientY
      drag.lastX = eventValue.clientX
      drag.lastY = eventValue.clientY
      drag.moved = false
      renderer.domElement.setPointerCapture(eventValue.pointerId)
      renderer.domElement.style.cursor = 'grabbing'
    }

    const handlePointerMove = (eventValue: PointerEvent) => {
      if (!drag.active) {
        updateHover(eventValue)
        return
      }
      const dx = eventValue.clientX - drag.lastX
      const dy = eventValue.clientY - drag.lastY
      drag.lastX = eventValue.clientX
      drag.lastY = eventValue.clientY
      if (Math.hypot(eventValue.clientX - drag.startX, eventValue.clientY - drag.startY) > 4) drag.moved = true
      orbitRef.current.yaw -= dx * 0.008
      orbitRef.current.pitch = clamp(orbitRef.current.pitch + dy * 0.006, 0.38, 1.15)
      updateCamera()
      hoverRing.visible = false
      onHoverRef.current?.(undefined)
    }

    const handlePointerUp = (eventValue: PointerEvent) => {
      if (!drag.active || drag.pointerId !== eventValue.pointerId) return
      const wasMoved = drag.moved
      drag.active = false
      renderer.domElement.releasePointerCapture(eventValue.pointerId)
      if (!wasMoved) {
        const coord = findCoord(eventValue)
        if (coord) onClickRef.current(coord)
      }
      updateHover(eventValue)
    }

    const handlePointerLeave = () => {
      if (!drag.active) {
        hoverRing.visible = false
        onHoverRef.current?.(undefined)
      }
    }

    const handleWheel = (eventValue: WheelEvent) => {
      eventValue.preventDefault()
      orbitRef.current.zoom = clamp(orbitRef.current.zoom * Math.exp(-eventValue.deltaY * 0.0012), 0.7, 1.8)
      updateCamera()
    }

    const heldKeys = new Set<string>()
    const handleKeyDown = (eventValue: KeyboardEvent) => {
      const keyValue = eventValue.key.toLowerCase()
      if (['q', 'e', 'a', 'd', 'w', 's'].includes(keyValue)) {
        eventValue.preventDefault()
        heldKeys.add(keyValue)
      }
    }
    const handleKeyUp = (eventValue: KeyboardEvent) => {
      heldKeys.delete(eventValue.key.toLowerCase())
    }
    const handleBlur = () => heldKeys.clear()

    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    renderer.domElement.addEventListener('pointermove', handlePointerMove)
    renderer.domElement.addEventListener('pointerup', handlePointerUp)
    renderer.domElement.addEventListener('pointercancel', handlePointerUp)
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave)
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false })
    renderer.domElement.addEventListener('keydown', handleKeyDown)
    renderer.domElement.addEventListener('keyup', handleKeyUp)
    renderer.domElement.addEventListener('blur', handleBlur)

    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setSize(width, height, false)
      const aspect = width / height
      const verticalSize = 11.8
      camera.left = -verticalSize * aspect * 0.5
      camera.right = verticalSize * aspect * 0.5
      camera.top = verticalSize * 0.5
      camera.bottom = -verticalSize * 0.5
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    let frame = 0
    let elapsed = 0
    let lastFrame = performance.now()
    const animate = (time: number) => {
      frame = requestAnimationFrame(animate)
      const deltaSeconds = Math.min(0.05, (time - lastFrame) / 1000)
      lastFrame = time
      elapsed += deltaSeconds
      const horizontalDirection = Number(heldKeys.has('e') || heldKeys.has('d')) - Number(heldKeys.has('q') || heldKeys.has('a'))
      const verticalDirection = Number(heldKeys.has('s')) - Number(heldKeys.has('w'))
      if (horizontalDirection || verticalDirection) {
        orbitRef.current.yaw += horizontalDirection * deltaSeconds * 1.45
        orbitRef.current.pitch = clamp(orbitRef.current.pitch + verticalDirection * deltaSeconds * 0.7, 0.38, 1.15)
        updateCamera()
      }

      const now = performance.now()
      for (const animation of bobAnimationsRef.current) {
        animation.object.position.y = animation.baseY + Math.sin(elapsed * animation.speed + animation.phase) * animation.amplitude
      }
      moveAnimationsRef.current = moveAnimationsRef.current.filter((animation) => {
        const progress = Math.min(1, (now - animation.startedAt) / animation.duration)
        const eased = 1 - Math.pow(1 - progress, 3)
        animation.object.position.lerpVectors(animation.from, animation.to, eased)
        animation.object.position.y += Math.sin(progress * Math.PI) * 0.24
        return progress < 1
      })
      pulseAnimationsRef.current = pulseAnimationsRef.current.filter((animation) => {
        const progress = Math.min(1, (now - animation.startedAt) / animation.duration)
        animation.mesh.scale.setScalar(0.4 + progress * 1.7)
        animation.material.opacity = 0.8 * (1 - progress)
        if (progress >= 1) {
          animation.mesh.parent?.remove(animation.mesh)
          animation.mesh.geometry.dispose()
          animation.material.dispose()
          return false
        }
        return true
      })
      for (const billboard of billboardsRef.current) billboard.quaternion.copy(camera.quaternion)
      renderer.render(scene, camera)
    }
    frame = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      renderer.domElement.removeEventListener('pointerup', handlePointerUp)
      renderer.domElement.removeEventListener('pointercancel', handlePointerUp)
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
      renderer.domElement.removeEventListener('wheel', handleWheel)
      renderer.domElement.removeEventListener('keydown', handleKeyDown)
      renderer.domElement.removeEventListener('keyup', handleKeyUp)
      renderer.domElement.removeEventListener('blur', handleBlur)
      disposeObject(content)
      hoverGeometry.dispose()
      ;(hoverRing.material as THREE.Material).dispose()
      renderer.dispose()
      renderer.domElement.remove()
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      contentRef.current = null
    }
  }, [])

  useEffect(() => {
    orbitRef.current = { ...DEFAULT_ORBIT }
    updateCameraRef.current()
  }, [cameraResetToken])

  useEffect(() => {
    const content = contentRef.current
    const camera = cameraRef.current
    if (!content || !camera) return

    for (const child of [...content.children]) {
      content.remove(child)
      disposeObject(child)
    }
    clickTargetsRef.current = []
    bobAnimationsRef.current = []
    moveAnimationsRef.current = []
    pulseAnimationsRef.current = []
    billboardsRef.current = []

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(16, 64),
      new THREE.MeshStandardMaterial({ color: 0x17233a, roughness: 0.95, metalness: 0.03 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.82
    ground.receiveShadow = true
    content.add(ground)

    const boardBase = new THREE.Mesh(
      new THREE.BoxGeometry(state.config.width + 0.9, 0.72, state.config.height + 0.9),
      new THREE.MeshStandardMaterial({ color: 0x303a4b, roughness: 0.72, metalness: 0.08 }),
    )
    boardBase.position.y = -0.47
    boardBase.receiveShadow = true
    boardBase.castShadow = true
    content.add(boardBase)

    const selectedGeometry = new THREE.RingGeometry(0.36, 0.47, 32)
    selectedGeometry.rotateX(-Math.PI / 2)
    const selectedRing = new THREE.Mesh(
      selectedGeometry,
      new THREE.MeshBasicMaterial({ color: 0xf7d06e, transparent: true, opacity: 0.9, depthWrite: false }),
    )
    selectedRing.position.copy(worldPosition(selectedCoord, state, 0.19))
    selectedRing.renderOrder = 18
    content.add(selectedRing)
    bobAnimationsRef.current.push({ object: selectedRing, baseY: 0.19, phase: 0, amplitude: 0.025, speed: 4 })

    for (const cell of state.cells) {
      const position = worldPosition(cell.coord, state)
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(0.93, 0.16, 0.93),
        new THREE.MeshStandardMaterial({
          color: cellColor(cell),
          roughness: cell.moisture === 2 ? 0.28 : cell.moisture === 0 ? 0.92 : 0.67,
          metalness: cell.groundFill === 'ice' ? 0.16 : 0.02,
        }),
      )
      tile.position.copy(position)
      tile.position.y = cell.groundFill === 'water' ? -0.03 : 0
      tile.receiveShadow = true
      tile.castShadow = true
      tile.userData.coord = cell.coord
      content.add(tile)
      clickTargetsRef.current.push(tile)

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(tile.geometry),
        new THREE.LineBasicMaterial({
          color: temperatureColors[clamp(cell.groundTemp + 3, 0, 6)],
          transparent: true,
          opacity: 0.55,
        }),
      )
      tile.add(edges)

      if (isValidTarget(state, selection, cell.coord)) {
        const overlayColor = selection.kind === 'basic' && selection.action === 'attack'
          ? 0xf05b68
          : selection.kind === 'card' && selection.card.effect.includes('cool')
            ? 0x57bfff
            : selection.kind === 'card' && (selection.card.effect.includes('heat') || selection.card.effect === 'grip')
              ? 0xff8a45
              : 0x64d7a1
        const height = targetLayer === 'sky' ? 1.62 : 0.11
        const overlay = createOverlay(overlayColor, targetLayer === 'sky' ? 0.22 : 0.34, height)
        overlay.position.x = position.x
        overlay.position.z = position.z
        content.add(overlay)
      }

      if (cell.moisture === 2 && cell.groundFill !== 'water') {
        const puddle = createOverlay(0x6db8d2, 0.24, 0.095, 0.42)
        puddle.position.x = position.x + 0.16
        puddle.position.z = position.z - 0.12
        content.add(puddle)
      }

      if (cell.groundFill === 'water') {
        const water = createOverlay(0x5ec7df, 0.38, 0.075)
        water.position.x = position.x
        water.position.z = position.z
        content.add(water)
      }
      if (cell.groundFill === 'grass') {
        const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x77a64f, roughness: 0.9 })
        for (let index = 0; index < 3; index += 1) {
          const blade = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.28 + index * 0.03, 5), grassMaterial)
          blade.position.set(position.x - 0.22 + index * 0.2, 0.19, position.z + (index % 2 ? 0.15 : -0.12))
          blade.castShadow = true
          content.add(blade)
        }
      }
      if (cell.groundFill === 'ice') {
        const ice = createOverlay(0xc9f4ff, 0.52, 0.1)
        ice.position.x = position.x
        ice.position.z = position.z
        content.add(ice)
      }
      if (cell.groundFill === 'fire') {
        for (let index = 0; index < 3; index += 1) {
          const flame = new THREE.Mesh(
            new THREE.ConeGeometry(0.1, 0.42, 10),
            new THREE.MeshBasicMaterial({ color: index === 1 ? 0xffdf70 : 0xff7040, transparent: true, opacity: 0.86 }),
          )
          flame.position.set(position.x + (index - 1) * 0.16, 0.28, position.z + (index === 1 ? 0.04 : -0.05))
          content.add(flame)
          bobAnimationsRef.current.push({ object: flame, baseY: 0.28, phase: index * 1.7, amplitude: 0.06, speed: 5 + index })
        }
      }

      if (cell.tags.includes('Shelter')) {
        const beacon = new THREE.Group()
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.13, 0.18, 0.48, 12),
          new THREE.MeshStandardMaterial({ color: 0xd7c79b, roughness: 0.75 }),
        )
        pillar.position.y = 0.28
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd56a }))
        glow.position.y = 0.62
        beacon.add(pillar, glow)
        beacon.position.set(position.x, 0.08, position.z)
        content.add(beacon)
      }

      if (showSky && cell.skyFill === 'cloud') {
        const cloud = createCloud(cell, bobAnimationsRef.current)
        cloud.position.x = position.x
        cloud.position.z = position.z
        content.add(cloud)
        const cloudShadow = createOverlay(0x24354d, 0.25, 0.12, 0.64)
        cloudShadow.position.x = position.x
        cloudShadow.position.z = position.z
        content.add(cloudShadow)
      }

      if (showSky && cell.wind) {
        const wind = createWindArrow(cell.wind)
        wind.position.x = position.x
        wind.position.z = position.z
        content.add(wind)
        bobAnimationsRef.current.push({ object: wind, baseY: 1.35, phase: cell.coord.x + cell.coord.y, amplitude: 0.04, speed: 2.2 })
      }

      if (showSky && cell.intents.some((intent) => intent.type === 'rain')) {
        for (let index = 0; index < 5; index += 1) {
          const drop = new THREE.Mesh(
            new THREE.CylinderGeometry(0.012, 0.012, 0.46, 5),
            new THREE.MeshBasicMaterial({ color: 0x7fdcff, transparent: true, opacity: 0.65 }),
          )
          drop.position.set(position.x - 0.3 + index * 0.15, 1.1 + (index % 2) * 0.3, position.z + ((index * 7) % 3 - 1) * 0.12)
          drop.rotation.z = 0.08
          content.add(drop)
          bobAnimationsRef.current.push({ object: drop, baseY: drop.position.y, phase: index, amplitude: 0.32, speed: 3.8 })
        }
      }

      if (showDebug) {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.035 + Math.abs(cell.groundTemp) * 0.012, 8, 6),
          new THREE.MeshBasicMaterial({ color: temperatureColors[cell.groundTemp + 3], depthTest: false }),
        )
        marker.position.set(position.x - 0.34, 0.2, position.z - 0.34)
        marker.renderOrder = 30
        content.add(marker)
      }
    }

    const player = getPlayer(state)
    for (const actor of state.actors.filter((entry) => entry.alive)) {
      const pawn = createActorPawn(actor, billboardsRef.current)
      const target = worldPosition(actor.position, state, 0.1)
      const previous = previousActorPositionsRef.current.get(actor.id)
      if (previous && (previous.x !== actor.position.x || previous.y !== actor.position.y)) {
        const from = worldPosition(previous, state, 0.1)
        pawn.position.copy(from)
        moveAnimationsRef.current.push({ object: pawn, from, to: target, startedAt: performance.now(), duration: 420 })
      } else {
        pawn.position.copy(target)
      }
      previousActorPositionsRef.current.set(actor.id, { ...actor.position })
      content.add(pawn)
      bobAnimationsRef.current.push({ object: pawn, baseY: pawn.position.y, phase: actor.position.x * 0.7 + actor.position.y, amplitude: 0.018, speed: 2 })

      if (actor.faction === 'enemy') {
        const from = worldPosition(actor.position, state, 0.16)
        const dx = Math.sign(player.position.x - actor.position.x)
        const dy = Math.sign(player.position.y - actor.position.y)
        const targetCoord = { x: actor.position.x + dx, y: actor.position.y + (dx === 0 ? dy : 0) }
        const to = worldPosition(targetCoord, state, 0.16)
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([from, to]),
          new THREE.LineDashedMaterial({ color: 0xff6772, transparent: true, opacity: 0.7, dashSize: 0.16, gapSize: 0.1 }),
        )
        line.computeLineDistances()
        content.add(line)
      }
    }

    if (event?.target) {
      const color = event.kind === 'cool'
        ? 0x5cc7ff
        : event.kind === 'heat'
          ? 0xff814b
          : event.kind === 'attack'
            ? 0xff4e5d
            : 0x73e6ac
      const geometry = new THREE.RingGeometry(0.18, 0.28, 32)
      geometry.rotateX(-Math.PI / 2)
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false })
      const pulse = new THREE.Mesh(geometry, material)
      pulse.position.copy(worldPosition(event.target, state, 0.24))
      pulse.renderOrder = 35
      content.add(pulse)
      pulseAnimationsRef.current.push({ mesh: pulse, material, startedAt: performance.now(), duration: 760 })
    }
  }, [state, selectedCoord.x, selectedCoord.y, selection, targetLayer, showSky, showDebug, event])

  return <div className="three-board-host interactive" ref={hostRef} />
}
