import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { actorAt, getPlayer, type Actor, type Cell, type Coord, type GameState, type Layer } from '../game'
import type { VisualSelection } from '../visual/InteractiveThreeBoard'
import type { PlaybackEvent } from '../visual/visualPlayback'
import {
  buildHexPath,
  getHexWind,
  hexDistance,
  hexStepToward,
  isHexInside,
  type HexDirection,
} from './hexRules'

const HEX_RADIUS = 0.56
const HEX_X = Math.sqrt(3) * HEX_RADIUS
const HEX_Z = HEX_RADIUS * 1.5
const temperatureColors = [0x3e7bd6, 0x5e9de0, 0x75b8ca, 0xa7a89f, 0xd3a55f, 0xdf7545, 0xef493e]
const actorColors = { player: 0x4ba7df, hunter: 0xd25463, elite: 0x8f62c7, npc: 0xd4a05a }

type Props = {
  state: GameState
  selectedCoord: Coord
  hoverCoord?: Coord
  selection: VisualSelection
  targetLayer: Layer
  cameraResetToken: number
  showSky: boolean
  showDebug: boolean
  event?: PlaybackEvent
  onCellClick: (coord: Coord) => void
  onCellHover?: (coord?: Coord) => void
}

type OrbitState = { yaw: number; pitch: number; zoom: number }
type BobAnimation = { object: THREE.Object3D; baseY: number; phase: number; amplitude: number; speed: number }
type MoveAnimation = { object: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; startedAt: number; duration: number }
type PulseAnimation = { object: THREE.Object3D; material: THREE.Material; startedAt: number; duration: number; rise?: number }
type AttackAnimation = { object: THREE.Object3D; base: THREE.Vector3; target: THREE.Vector3; startedAt: number; duration: number; victim?: THREE.Object3D }

const DEFAULT_ORBIT: OrbitState = { yaw: Math.PI * 0.25, pitch: 0.74, zoom: 1 }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const sameCoord = (a?: Coord, b?: Coord) => Boolean(a && b && a.x === b.x && a.y === b.y)

function rawHexPosition(coord: Coord) {
  return {
    x: (coord.x + 0.5 * (coord.y & 1)) * HEX_X,
    z: coord.y * HEX_Z,
  }
}

export function hexWorldPosition(coord: Coord, state: GameState, height = 0) {
  const raw = rawHexPosition(coord)
  const min = rawHexPosition({ x: 0, y: 0 })
  const max = rawHexPosition({ x: state.config.width - 1, y: state.config.height - 1 })
  const extra = state.config.height > 1 ? HEX_X * 0.25 : 0
  return new THREE.Vector3(raw.x - (min.x + max.x + extra) * 0.5, height, raw.z - (min.z + max.z) * 0.5)
}

function fillColor(cell: Cell) {
  const base = cell.groundFill === 'grass'
    ? new THREE.Color(0x4f7748)
    : cell.groundFill === 'water'
      ? new THREE.Color(0x316a86)
      : cell.groundFill === 'ice'
        ? new THREE.Color(0xa5d9e7)
        : cell.groundFill === 'fire'
          ? new THREE.Color(0x8e4937)
          : new THREE.Color(0x777b72)
  const normalized = clamp(cell.groundTemp, -3, 3) + 3
  return base.lerp(new THREE.Color(temperatureColors[normalized]), cell.groundTemp === 0 ? 0.05 : 0.24 + Math.abs(cell.groundTemp) * 0.1)
}

function createHexOverlay(color: number, opacity: number, height: number, radius = 0.49) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.022, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  )
  mesh.rotation.y = Math.PI / 6
  mesh.position.y = height
  mesh.renderOrder = 12
  return mesh
}

function createCloud(cell: Cell, bob: BobAnimation[]) {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({
    color: cell.skyTemp > 0 ? 0xffdcc3 : cell.skyTemp < 0 ? 0xd7ecff : 0xf1f2ec,
    roughness: 0.92,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  })
  const parts = [[-0.22, 0, 0, 0.25], [0.05, 0.1, 0, 0.34], [0.3, 0, 0.02, 0.24], [0, -0.02, 0.2, 0.26]] as const
  for (const [x, y, z, radius] of parts) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material)
    sphere.position.set(x, y, z)
    sphere.castShadow = true
    group.add(sphere)
  }
  group.position.y = 2.12
  bob.push({ object: group, baseY: 2.12, phase: Math.random() * Math.PI * 2, amplitude: 0.07, speed: 1.1 })
  return group
}

function createWindArrow(direction: HexDirection) {
  const group = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: 0xc7ecff, transparent: true, opacity: 0.86 })
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.48, 7), material)
  shaft.rotation.z = Math.PI / 2
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 8), material)
  head.rotation.z = -Math.PI / 2
  head.position.x = 0.34
  group.add(shaft, head)
  const rotations: Record<HexDirection, number> = { E: 0, NE: Math.PI / 3, NW: 2 * Math.PI / 3, W: Math.PI, SW: -2 * Math.PI / 3, SE: -Math.PI / 3 }
  group.rotation.y = rotations[direction]
  group.position.y = 1.35
  return group
}

function createActorPawn(actor: Actor, billboards: THREE.Group[]) {
  const group = new THREE.Group()
  group.userData.actorId = actor.id
  const primary = new THREE.MeshStandardMaterial({
    color: actorColors[actor.actorType],
    roughness: 0.48,
    metalness: actor.actorType === 'elite' ? 0.3 : 0.04,
  })
  const trim = new THREE.MeshStandardMaterial({ color: actor.faction === 'enemy' ? 0x4e1720 : 0xe9d6a7, roughness: 0.55 })
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.12, 18), trim)
  base.position.y = 0.08
  const scale = actor.actorType === 'elite' ? 1.15 : actor.actorType === 'hunter' ? 0.9 : 1
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.21 * scale, 0.28 * scale, 0.58 * scale, 14), primary)
  body.position.y = 0.42
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19 * scale, 14, 10), primary)
  head.position.y = 0.78 * scale
  group.add(base, body, head)
  group.traverse((child) => { if (child instanceof THREE.Mesh) child.castShadow = true })

  if (actor.actorType === 'player') {
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.48, 0.09), new THREE.MeshStandardMaterial({ color: 0xe7edf5, metalness: 0.75, roughness: 0.2 }))
    sword.position.set(0.3, 0.53, 0)
    sword.rotation.z = -0.35
    group.add(sword)
  }
  if (actor.actorType === 'elite') {
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.54, 0.42), new THREE.MeshStandardMaterial({ color: 0xc49b47, metalness: 0.55, roughness: 0.34 }))
    shield.position.set(-0.33, 0.46, 0)
    group.add(shield)
  }
  if (actor.actorType === 'npc') {
    const frost = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.03, 8, 24), new THREE.MeshBasicMaterial({ color: 0xa9e7ff, transparent: true, opacity: 0.76 }))
    frost.position.y = 0.38
    frost.rotation.x = Math.PI / 2
    group.add(frost)
  }
  if (actor.shield > 0) {
    const shieldRing = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.025, 8, 32), new THREE.MeshBasicMaterial({ color: 0x7fd7ff, transparent: true, opacity: 0.8 }))
    shieldRing.position.y = 0.42
    shieldRing.rotation.x = Math.PI / 2
    group.add(shieldRing)
  }

  const bar = new THREE.Group()
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.075), new THREE.MeshBasicMaterial({ color: 0x261a1d, depthTest: false }))
  const ratio = Math.max(0.01, actor.hp / actor.maxHp)
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.6 * ratio, 0.045), new THREE.MeshBasicMaterial({ color: actor.faction === 'enemy' ? 0xf0626e : 0x70d58d, depthTest: false }))
  fill.position.x = -0.3 + 0.3 * ratio
  fill.position.z = 0.002
  bar.add(back, fill)
  bar.position.y = actor.actorType === 'elite' ? 1.24 : 1.07
  bar.renderOrder = 24
  group.add(bar)
  billboards.push(bar)
  return group
}

function isValidTarget(state: GameState, selection: VisualSelection, coord: Coord) {
  const player = getPlayer(state)
  if (selection.kind === 'inspect') return false
  if (selection.kind === 'basic') {
    if (selection.action === 'move') return hexDistance(player.position, coord) === 1 && !actorAt(state, coord)
    return hexDistance(player.position, coord) === 1 && Boolean(actorAt(state, coord, false))
  }
  if (selection.card.target === 'self') return false
  if (hexDistance(player.position, coord) > selection.card.range) return false
  if (selection.card.target === 'actor') return Boolean(actorAt(state, coord))
  return true
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line)) return
    child.geometry?.dispose()
    const material = child.material
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
    else material?.dispose()
  })
}

function addLocalEffect(
  content: THREE.Group,
  event: PlaybackEvent,
  state: GameState,
  pulses: PulseAnimation[],
) {
  if (!event.target) return
  const position = hexWorldPosition(event.target, state, 0.25)
  const effect = event.effect ?? event.kind
  const color = ['cool', 'freeze', 'rain'].includes(effect) ? 0x67ccff : ['heat', 'ignite', 'vapor'].includes(effect) ? 0xff8249 : effect === 'attack' ? 0xff4e5d : 0x73e6ac
  const ringMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.27, 6), ringMaterial)
  ring.rotation.x = -Math.PI / 2
  ring.rotation.z = Math.PI / 6
  ring.position.copy(position)
  ring.renderOrder = 38
  content.add(ring)
  pulses.push({ object: ring, material: ringMaterial, startedAt: performance.now(), duration: 760 })

  const particleCount = effect === 'ignite' || effect === 'freeze' ? 14 : effect === 'wind' || effect === 'rain' ? 10 : 7
  for (let index = 0; index < particleCount; index += 1) {
    const geometry = effect === 'cool' || effect === 'freeze'
      ? new THREE.OctahedronGeometry(0.045, 0)
      : effect === 'rain'
        ? new THREE.CylinderGeometry(0.012, 0.012, 0.24, 5)
        : new THREE.SphereGeometry(0.035, 7, 5)
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.86 })
    const particle = new THREE.Mesh(geometry, material)
    const angle = index / particleCount * Math.PI * 2
    particle.position.set(position.x + Math.cos(angle) * 0.18, position.y + (effect === 'vapor' ? 0.2 : 0.03), position.z + Math.sin(angle) * 0.18)
    content.add(particle)
    pulses.push({ object: particle, material, startedAt: performance.now() + index * 18, duration: 820, rise: effect === 'rain' ? -0.9 : effect === 'wind' ? 0.1 : 0.65 })
  }
}

export function HexThreeBoard({
  state,
  selectedCoord,
  hoverCoord,
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
  const actorObjectsRef = useRef(new Map<string, THREE.Object3D>())
  const previousActorPositionsRef = useRef(new Map<string, Coord>())
  const onClickRef = useRef(onCellClick)
  const onHoverRef = useRef(onCellHover)
  const stateRef = useRef(state)
  const bobRef = useRef<BobAnimation[]>([])
  const moveRef = useRef<MoveAnimation[]>([])
  const pulseRef = useRef<PulseAnimation[]>([])
  const attackRef = useRef<AttackAnimation[]>([])
  const billboardRef = useRef<THREE.Group[]>([])
  const orbitRef = useRef<OrbitState>({ ...DEFAULT_ORBIT })

  onClickRef.current = onCellClick
  onHoverRef.current = onCellHover
  stateRef.current = state

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x101827)
    scene.fog = new THREE.Fog(0x101827, 14, 27)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.replaceChildren(renderer.domElement)
    renderer.domElement.tabIndex = 0
    renderer.domElement.style.touchAction = 'none'

    const camera = new THREE.OrthographicCamera(-7, 7, 5, -5, 0.1, 60)
    camera.zoom = 1
    scene.add(new THREE.HemisphereLight(0xb9dcff, 0x263040, 1.85))
    const sun = new THREE.DirectionalLight(0xffe7c2, 2.2)
    sun.position.set(-7, 12, -5)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -9
    sun.shadow.camera.right = 9
    sun.shadow.camera.top = 9
    sun.shadow.camera.bottom = -9
    scene.add(sun)
    const content = new THREE.Group()
    scene.add(content)

    rendererRef.current = renderer
    sceneRef.current = scene
    cameraRef.current = camera
    contentRef.current = content

    const updateCamera = () => {
      const orbit = orbitRef.current
      const radius = 17
      const horizontal = Math.cos(orbit.pitch) * radius
      camera.position.set(Math.sin(orbit.yaw) * horizontal, Math.sin(orbit.pitch) * radius, Math.cos(orbit.yaw) * horizontal)
      camera.lookAt(0, 0.2, 0)
      camera.zoom = orbit.zoom
      camera.updateProjectionMatrix()
    }
    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setSize(width, height, false)
      const aspect = width / height
      const size = 6.2
      camera.left = -size * aspect
      camera.right = size * aspect
      camera.top = size
      camera.bottom = -size
      camera.updateProjectionMatrix()
    }
    resize()
    updateCamera()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const coordFromPointer = (eventValue: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((eventValue.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((eventValue.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(clickTargetsRef.current, false)[0]
      return hit?.object.userData.coord as Coord | undefined
    }

    const drag = { active: false, pointerId: -1, lastX: 0, lastY: 0, startX: 0, startY: 0, moved: false }
    const handleDown = (eventValue: PointerEvent) => {
      if (eventValue.button !== 0) return
      renderer.domElement.focus({ preventScroll: true })
      drag.active = true
      drag.pointerId = eventValue.pointerId
      drag.lastX = drag.startX = eventValue.clientX
      drag.lastY = drag.startY = eventValue.clientY
      drag.moved = false
      renderer.domElement.setPointerCapture(eventValue.pointerId)
      renderer.domElement.style.cursor = 'grabbing'
    }
    const handleMove = (eventValue: PointerEvent) => {
      if (drag.active) {
        const dx = eventValue.clientX - drag.lastX
        const dy = eventValue.clientY - drag.lastY
        drag.lastX = eventValue.clientX
        drag.lastY = eventValue.clientY
        if (Math.hypot(eventValue.clientX - drag.startX, eventValue.clientY - drag.startY) > 4) drag.moved = true
        orbitRef.current.yaw -= dx * 0.008
        orbitRef.current.pitch = clamp(orbitRef.current.pitch + dy * 0.006, 0.38, 1.22)
        updateCamera()
        onHoverRef.current?.(undefined)
        return
      }
      const coord = coordFromPointer(eventValue)
      renderer.domElement.style.cursor = coord ? 'pointer' : 'grab'
      onHoverRef.current?.(coord)
    }
    const handleUp = (eventValue: PointerEvent) => {
      if (!drag.active || drag.pointerId !== eventValue.pointerId) return
      const moved = drag.moved
      drag.active = false
      renderer.domElement.releasePointerCapture(eventValue.pointerId)
      renderer.domElement.style.cursor = 'grab'
      if (!moved) {
        const coord = coordFromPointer(eventValue)
        if (coord) onClickRef.current(coord)
      }
    }
    const handleWheel = (eventValue: WheelEvent) => {
      eventValue.preventDefault()
      orbitRef.current.zoom = clamp(orbitRef.current.zoom * Math.exp(-eventValue.deltaY * 0.001), 0.58, 2.15)
      updateCamera()
    }
    renderer.domElement.addEventListener('pointerdown', handleDown)
    renderer.domElement.addEventListener('pointermove', handleMove)
    renderer.domElement.addEventListener('pointerup', handleUp)
    renderer.domElement.addEventListener('pointercancel', handleUp)
    renderer.domElement.addEventListener('pointerleave', () => onHoverRef.current?.(undefined))
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false })
    renderer.domElement.style.cursor = 'grab'

    let animationFrame = 0
    const render = () => {
      const now = performance.now()
      const seconds = now * 0.001
      for (const item of bobRef.current) item.object.position.y = item.baseY + Math.sin(seconds * item.speed + item.phase) * item.amplitude
      moveRef.current = moveRef.current.filter((item) => {
        const progress = clamp((now - item.startedAt) / item.duration, 0, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        item.object.position.lerpVectors(item.from, item.to, eased)
        item.object.position.y += Math.sin(progress * Math.PI) * 0.18
        return progress < 1
      })
      attackRef.current = attackRef.current.filter((item) => {
        const progress = clamp((now - item.startedAt) / item.duration, 0, 1)
        const strike = progress < 0.42 ? progress / 0.42 : 1 - (progress - 0.42) / 0.58
        item.object.position.lerpVectors(item.base, item.target, Math.sin(strike * Math.PI * 0.5) * 0.42)
        if (item.victim) item.victim.rotation.z = Math.sin(progress * Math.PI * 8) * (1 - progress) * 0.08
        return progress < 1
      })
      pulseRef.current = pulseRef.current.filter((item) => {
        const progress = clamp((now - item.startedAt) / item.duration, 0, 1)
        if (progress < 0) return true
        item.object.scale.setScalar(0.5 + progress * 1.6)
        item.object.position.y += (item.rise ?? 0) * 0.018
        if ('opacity' in item.material) (item.material as THREE.MeshBasicMaterial).opacity = 1 - progress
        if (progress >= 1) {
          item.object.parent?.remove(item.object)
          disposeObject(item.object)
          return false
        }
        return true
      })
      for (const billboard of billboardRef.current) billboard.quaternion.copy(camera.quaternion)
      renderer.render(scene, camera)
      animationFrame = requestAnimationFrame(render)
    }
    render()

    return () => {
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', handleDown)
      renderer.domElement.removeEventListener('pointermove', handleMove)
      renderer.domElement.removeEventListener('pointerup', handleUp)
      renderer.domElement.removeEventListener('pointercancel', handleUp)
      renderer.domElement.removeEventListener('wheel', handleWheel)
      disposeObject(content)
      renderer.dispose()
      host.replaceChildren()
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      contentRef.current = null
    }
  }, [])

  useEffect(() => {
    orbitRef.current = { ...DEFAULT_ORBIT }
    const camera = cameraRef.current
    if (!camera) return
    const radius = 17
    const horizontal = Math.cos(DEFAULT_ORBIT.pitch) * radius
    camera.position.set(Math.sin(DEFAULT_ORBIT.yaw) * horizontal, Math.sin(DEFAULT_ORBIT.pitch) * radius, Math.cos(DEFAULT_ORBIT.yaw) * horizontal)
    camera.lookAt(0, 0.2, 0)
    camera.zoom = DEFAULT_ORBIT.zoom
    camera.updateProjectionMatrix()
  }, [cameraResetToken])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const removed = content.children.splice(0)
    for (const child of removed) {
      content.remove(child)
      disposeObject(child)
    }
    clickTargetsRef.current = []
    actorObjectsRef.current.clear()
    bobRef.current = []
    moveRef.current = []
    pulseRef.current = []
    attackRef.current = []
    billboardRef.current = []

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(state.config.width * HEX_X + 4, state.config.height * HEX_Z + 4),
      new THREE.MeshStandardMaterial({ color: 0x17233a, roughness: 0.96 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.46
    floor.receiveShadow = true
    content.add(floor)

    for (const cell of state.cells) {
      const position = hexWorldPosition(cell.coord, state)
      const tile = new THREE.Mesh(
        new THREE.CylinderGeometry(HEX_RADIUS, HEX_RADIUS, 0.18, 6),
        new THREE.MeshStandardMaterial({
          color: fillColor(cell),
          roughness: cell.moisture === 2 ? 0.3 : cell.moisture === 0 ? 0.92 : 0.68,
          metalness: cell.groundFill === 'ice' ? 0.16 : 0.02,
        }),
      )
      tile.rotation.y = Math.PI / 6
      tile.position.copy(position)
      tile.position.y = cell.groundFill === 'water' ? -0.04 : 0
      tile.receiveShadow = true
      tile.castShadow = true
      tile.userData.coord = cell.coord
      content.add(tile)
      clickTargetsRef.current.push(tile)

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(tile.geometry),
        new THREE.LineBasicMaterial({ color: temperatureColors[clamp(cell.groundTemp, -3, 3) + 3], transparent: true, opacity: 0.62 }),
      )
      tile.add(edges)

      if (sameCoord(cell.coord, selectedCoord)) {
        const selected = createHexOverlay(0xf7d06e, 0.3, 0.14, 0.47)
        selected.position.x = position.x
        selected.position.z = position.z
        content.add(selected)
        bobRef.current.push({ object: selected, baseY: 0.14, phase: 0, amplitude: 0.025, speed: 4 })
      }
      if (sameCoord(cell.coord, hoverCoord)) {
        const hover = createHexOverlay(0xffffff, 0.16, 0.16, 0.42)
        hover.position.x = position.x
        hover.position.z = position.z
        content.add(hover)
      }
      if (isValidTarget(state, selection, cell.coord)) {
        const color = selection.kind === 'basic' && selection.action === 'attack'
          ? 0xf05b68
          : selection.kind === 'card' && selection.card.effect.includes('cool')
            ? 0x57bfff
            : selection.kind === 'card' && (selection.card.effect.includes('heat') || selection.card.effect === 'grip')
              ? 0xff8a45
              : 0x64d7a1
        const overlay = createHexOverlay(color, targetLayer === 'sky' ? 0.22 : 0.34, targetLayer === 'sky' ? 1.62 : 0.12)
        overlay.position.x = position.x
        overlay.position.z = position.z
        content.add(overlay)
      }

      if (cell.moisture === 2 && cell.groundFill !== 'water') {
        const puddle = createHexOverlay(0x6db8d2, 0.22, 0.11, 0.27)
        puddle.position.set(position.x + 0.13, 0.11, position.z - 0.1)
        content.add(puddle)
      }
      if (cell.groundFill === 'water') {
        const water = createHexOverlay(0x5ec7df, 0.4, 0.07, 0.48)
        water.position.x = position.x
        water.position.z = position.z
        content.add(water)
      }
      if (cell.groundFill === 'grass') {
        const material = new THREE.MeshStandardMaterial({ color: 0x77a64f, roughness: 0.9 })
        for (let index = 0; index < 3; index += 1) {
          const blade = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.27 + index * 0.03, 5), material)
          blade.position.set(position.x - 0.2 + index * 0.19, 0.19, position.z + (index % 2 ? 0.13 : -0.1))
          blade.castShadow = true
          content.add(blade)
        }
      }
      if (cell.groundFill === 'ice') {
        const ice = createHexOverlay(0xc9f4ff, 0.52, 0.1, 0.49)
        ice.position.x = position.x
        ice.position.z = position.z
        content.add(ice)
      }
      if (cell.groundFill === 'fire') {
        for (let index = 0; index < 3; index += 1) {
          const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.42, 9), new THREE.MeshBasicMaterial({ color: index === 1 ? 0xffdf70 : 0xff7040, transparent: true, opacity: 0.88 }))
          flame.position.set(position.x + (index - 1) * 0.16, 0.29, position.z + (index === 1 ? 0.04 : -0.05))
          content.add(flame)
          bobRef.current.push({ object: flame, baseY: 0.29, phase: index * 1.7, amplitude: 0.06, speed: 5 + index })
        }
      }
      if (cell.tags.includes('Shelter')) {
        const beacon = new THREE.Group()
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.48, 12), new THREE.MeshStandardMaterial({ color: 0xd7c79b, roughness: 0.75 }))
        pillar.position.y = 0.28
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd56a }))
        glow.position.y = 0.62
        beacon.add(pillar, glow)
        beacon.position.set(position.x, 0.08, position.z)
        content.add(beacon)
      }

      if (showSky && cell.skyFill === 'cloud') {
        const cloud = createCloud(cell, bobRef.current)
        cloud.position.x = position.x
        cloud.position.z = position.z
        if (sameCoord(cell.coord, selectedCoord) || sameCoord(cell.coord, hoverCoord)) cloud.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) child.material.opacity = 0.28
        })
        content.add(cloud)
        const shadow = createHexOverlay(0x24354d, 0.24, 0.12, 0.38)
        shadow.position.x = position.x
        shadow.position.z = position.z
        content.add(shadow)
      }
      const windDirection = getHexWind(cell)
      if (showSky && windDirection) {
        const wind = createWindArrow(windDirection)
        wind.position.x = position.x
        wind.position.z = position.z
        content.add(wind)
        bobRef.current.push({ object: wind, baseY: 1.35, phase: cell.coord.x + cell.coord.y, amplitude: 0.04, speed: 2.2 })
      }
      if (showSky && cell.intents.some((intent) => intent.type === 'rain')) {
        for (let index = 0; index < 5; index += 1) {
          const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.43, 5), new THREE.MeshBasicMaterial({ color: 0x7fdcff, transparent: true, opacity: 0.67 }))
          drop.position.set(position.x - 0.28 + index * 0.14, 1.05 + (index % 2) * 0.28, position.z + ((index * 7) % 3 - 1) * 0.11)
          content.add(drop)
          bobRef.current.push({ object: drop, baseY: drop.position.y, phase: index, amplitude: 0.3, speed: 3.8 })
        }
      }
      if (showDebug) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: temperatureColors[clamp(cell.groundTemp, -3, 3) + 3], depthTest: false }))
        marker.position.set(position.x - 0.28, 0.2, position.z - 0.24)
        marker.renderOrder = 30
        content.add(marker)
      }
    }

    const player = getPlayer(state)
    if (selection.kind === 'basic' && selection.action === 'move' && hoverCoord && isValidTarget(state, selection, hoverCoord)) {
      const path = buildHexPath(state, player.position, hoverCoord, 8, player.id).map((coord) => hexWorldPosition(coord, state, 0.18))
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path), new THREE.LineDashedMaterial({ color: 0x76e5b0, dashSize: 0.14, gapSize: 0.09, transparent: true, opacity: 0.9 }))
      line.computeLineDistances()
      content.add(line)
    }

    for (const actor of state.actors.filter((entry) => entry.alive && entry.faction === 'enemy')) {
      const steps = actor.actorType === 'hunter' ? 2 : 1
      const pathCoords = buildHexPath(state, actor.position, player.position, steps, actor.id)
      if (pathCoords.length <= 1) continue
      const points = pathCoords.map((coord) => hexWorldPosition(coord, state, 0.17))
      if (hexDistance(pathCoords[pathCoords.length - 1], player.position) === 1) points.push(hexWorldPosition(player.position, state, 0.17))
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: 0xff6772, transparent: true, opacity: 0.74, dashSize: 0.15, gapSize: 0.1 }))
      line.computeLineDistances()
      content.add(line)
    }

    for (const actor of state.actors.filter((entry) => entry.alive)) {
      const pawn = createActorPawn(actor, billboardRef.current)
      const target = hexWorldPosition(actor.position, state, 0.1)
      const previous = previousActorPositionsRef.current.get(actor.id)
      if (previous && !sameCoord(previous, actor.position)) {
        const from = hexWorldPosition(previous, state, 0.1)
        pawn.position.copy(from)
        moveRef.current.push({ object: pawn, from, to: target, startedAt: performance.now(), duration: 430 })
      } else pawn.position.copy(target)
      previousActorPositionsRef.current.set(actor.id, { ...actor.position })
      content.add(pawn)
      actorObjectsRef.current.set(actor.id, pawn)
      bobRef.current.push({ object: pawn, baseY: pawn.position.y, phase: actor.position.x * 0.7 + actor.position.y, amplitude: 0.018, speed: 2 })
    }

    if (event?.effect === 'attack' && event.sourceActorId && event.actorId) {
      const source = actorObjectsRef.current.get(event.sourceActorId)
      const victim = actorObjectsRef.current.get(event.actorId)
      if (source && victim) attackRef.current.push({ object: source, base: source.position.clone(), target: victim.position.clone(), victim, startedAt: performance.now(), duration: 480 })
    }
    if (event) addLocalEffect(content, event, state, pulseRef.current)
  }, [state, selectedCoord.x, selectedCoord.y, hoverCoord?.x, hoverCoord?.y, selection, targetLayer, showSky, showDebug, event])

  return <div className="hex-board-host" ref={hostRef} aria-label="Three.js 六边格棋盘" />
}
