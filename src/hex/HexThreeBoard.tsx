import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { actorAt, cellAt, getPlayer, type Actor, type Cell, type Coord, type GameState, type Layer } from '../game'
import type { VisualSelection } from '../visual/InteractiveThreeBoard'
import type { PlaybackEvent } from '../visual/visualPlayback'
import { buildHexPath, getHexWind, hexDistance, type HexDirection } from './hexRules'
import { hasHexLineOfSight, isMountainCell } from './hexTerrain'
import { hexDirectionOnLine, hexDirectionYaw, hexRay, hexWorldOffset } from './hexTopology'
import type { HexMode, TravelPreference } from './hexTravel'

const HEX_RADIUS = 0.56
const HEX_X = Math.sqrt(3) * HEX_RADIUS
const HEX_Z = HEX_RADIUS * 1.5
const TILE_HEIGHT = 0.18
const temperatureColors = [0x3e7bd6, 0x5e9de0, 0x75b8ca, 0xa7a89f, 0xd3a55f, 0xdf7545, 0xef493e]
const actorColors = { player: 0x4ba7df, hunter: 0xd25463, elite: 0x8f62c7, npc: 0xd4a05a }

export type HexBoardSelection = VisualSelection
  | { kind: 'momentum'; action: 'drive' | 'rush-strike'; validCoords: Coord[]; route?: Coord[] }

type Props = {
  state: GameState
  mode?: HexMode
  travelPath?: Coord[]
  travelTarget?: Coord
  travelPreference?: TravelPreference
  selectedCoord: Coord
  hoverCoord?: Coord
  selection: HexBoardSelection
  targetLayer: Layer
  cameraResetToken: number
  showSky: boolean
  showDebug: boolean
  event?: PlaybackEvent
  eventDurationMs?: number
  momentumByActorId?: Record<string, number>
  onCellClick: (coord: Coord) => void
  onCellHover?: (coord?: Coord) => void
}

type OrbitState = { yaw: number; pitch: number; zoom: number }
type BobAnimation = { object: THREE.Object3D; baseY: number; phase: number; amplitude: number; speed: number }
type RainAnimation = {
  object: THREE.Mesh
  material: THREE.MeshBasicMaterial
  topY: number
  bottomY: number
  phase: number
  speed: number
}
type MoveAnimation = { object: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; startedAt: number; duration: number; arcHeight: number }
type PulseAnimation = {
  object: THREE.Object3D
  material: THREE.MeshBasicMaterial
  startedAt: number
  duration: number
  rise?: number
}
type AttackAnimation = {
  object: THREE.Object3D
  base: THREE.Vector3
  target: THREE.Vector3
  startedAt: number
  duration: number
  victim?: THREE.Object3D
}

const DEFAULT_ORBIT: OrbitState = { yaw: Math.PI * 0.25, pitch: 0.74, zoom: 1 }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const sameCoord = (a?: Coord, b?: Coord) => Boolean(a && b && a.x === b.x && a.y === b.y)
const coordKey = (coord: Coord) => `${coord.x},${coord.y}`

function pointInsideHex(x: number, z: number, radius = HEX_RADIUS) {
  const absX = Math.abs(x)
  const absZ = Math.abs(z)
  const rootThree = Math.sqrt(3)
  return absZ <= radius && absX <= rootThree * radius * 0.5 && rootThree * absZ + absX <= rootThree * radius
}

function rawHexPosition(coord: Coord) {
  return hexWorldOffset(coord, HEX_RADIUS)
}

export function hexWorldPosition(coord: Coord, state: GameState, height = 0) {
  const raw = rawHexPosition(coord)
  const min = rawHexPosition({ x: 0, y: 0 })
  const max = rawHexPosition({ x: state.config.width - 1, y: state.config.height - 1 })
  const extra = state.config.height > 1 ? HEX_X * 0.25 : 0
  return new THREE.Vector3(
    raw.x - (min.x + max.x + extra) * 0.5,
    height,
    raw.z - (min.z + max.z) * 0.5,
  )
}

function fillColor(cell: Cell) {
  if (isMountainCell(cell)) return new THREE.Color(0x4f555d)
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
  return base.lerp(
    new THREE.Color(temperatureColors[normalized]),
    cell.groundTemp === 0 ? 0.05 : 0.24 + Math.abs(cell.groundTemp) * 0.1,
  )
}

function createHexOverlay(color: number, opacity: number, height: number, radius = 0.49) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.018, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  )
  mesh.position.y = height
  mesh.renderOrder = 12
  return mesh
}

function createTargetReticle(color: number, height: number) {
  const group = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.98, depthWrite: false, depthTest: false })
  const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x071018, transparent: true, opacity: 0.92, depthWrite: false, depthTest: false })
  const darkRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.052, 8, 6), darkMaterial)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 8, 6), material)
  darkRing.rotation.x = ring.rotation.x = Math.PI / 2
  group.add(darkRing, ring)
  for (let index = 0; index < 3; index += 1) {
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.18, 3), material)
    const angle = index * Math.PI * 2 / 3
    marker.position.set(Math.cos(angle) * 0.51, 0.025, Math.sin(angle) * 0.51)
    marker.rotation.y = -angle
    group.add(marker)
  }
  group.position.y = height
  group.renderOrder = 34
  return group
}

function createTopOutline(cell: Cell) {
  const radius = HEX_RADIUS * 0.955
  const points = Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI * 0.5 - index * Math.PI / 3
    return new THREE.Vector3(Math.cos(angle) * radius, TILE_HEIGHT * 0.5 + 0.006, Math.sin(angle) * radius)
  })
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: temperatureColors[clamp(cell.groundTemp, -3, 3) + 3],
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    }),
  )
  line.renderOrder = 5
  return line
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
  const parts = [
    [-0.22, 0, 0, 0.25],
    [0.05, 0.1, 0, 0.34],
    [0.3, 0, 0.02, 0.24],
    [0, -0.02, 0.2, 0.26],
  ] as const
  for (const [x, y, z, radius] of parts) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material)
    sphere.position.set(x, y, z)
    sphere.castShadow = true
    group.add(sphere)
  }
  group.position.y = 2.12
  const stablePhase = (cell.coord.x * 1.37 + cell.coord.y * 2.11) % (Math.PI * 2)
  bob.push({ object: group, baseY: 2.12, phase: stablePhase, amplitude: 0.07, speed: 1.1 })
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
  group.rotation.y = hexDirectionYaw(direction)
  group.position.y = 1.35
  return group
}

function createMountain(cell: Cell) {
  const group = new THREE.Group()
  const ridge = cell.tags.includes('Ridge')
  const rock = new THREE.MeshStandardMaterial({
    color: ridge ? 0x555c64 : 0x626a73,
    roughness: 0.94,
    metalness: 0.02,
    flatShading: true,
  })
  const snow = new THREE.MeshStandardMaterial({
    color: 0xc9d3d8,
    roughness: 0.86,
    flatShading: true,
  })
  const stable = (cell.coord.x * 17 + cell.coord.y * 31) % 7
  const peaks = ridge
    ? [[-0.16, 0.42, -0.08, 0.3, 0.74], [0.15, 0.36, 0.1, 0.25, 0.62]]
    : [[-0.08, 0.48, 0, 0.34, 0.88], [0.21, 0.3, 0.1, 0.22, 0.52]]
  for (const [x, y, z, radius, height] of peaks) {
    const peak = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 6), rock)
    peak.position.set(x + (stable - 3) * 0.008, y, z)
    peak.rotation.y = stable * 0.21
    peak.castShadow = true
    peak.receiveShadow = true
    group.add(peak)

    const cap = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.48, height * 0.28, 6), snow)
    cap.position.set(peak.position.x, y + height * 0.36, z)
    cap.rotation.y = peak.rotation.y
    cap.castShadow = true
    group.add(cap)
  }
  group.position.y = 0.12
  return group
}

function createMomentumSurface(cell: Cell) {
  const group = new THREE.Group()
  const hard = cell.tags.includes('UT3Hard')
  const left = cell.tags.includes('UT3ReflectLeft')
  const color = hard ? 0x69717c : left ? 0x43c7d7 : 0xeea74a
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(hard ? 0.78 : 0.62, hard ? 1.05 : 0.78, hard ? 0.2 : 0.12),
    new THREE.MeshStandardMaterial({
      color,
      emissive: hard ? 0x111820 : left ? 0x0a4d59 : 0x5c3107,
      emissiveIntensity: 0.55,
      metalness: hard ? 0.35 : 0.62,
      roughness: hard ? 0.72 : 0.28,
      transparent: !hard,
      opacity: hard ? 1 : 0.82,
    }),
  )
  wall.position.y = hard ? 0.58 : 0.47
  wall.rotation.y = hard ? 0 : left ? -Math.PI / 6 : Math.PI / 6
  wall.castShadow = true
  group.add(wall)
  if (!hard) {
    const chevron = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.035, 7, 20, Math.PI * 1.45),
      new THREE.MeshBasicMaterial({ color: 0xeafcff, transparent: true, opacity: 0.9 }),
    )
    chevron.rotation.x = Math.PI / 2
    chevron.rotation.z = left ? 0.45 : -0.45
    chevron.position.set(0, 0.88, 0.03)
    group.add(chevron)
  }
  return group
}

function createActorPawn(actor: Actor, billboards: THREE.Group[], momentum = 0) {
  const group = new THREE.Group()
  group.userData.actorId = actor.id
  const primary = new THREE.MeshStandardMaterial({
    color: actorColors[actor.actorType],
    roughness: 0.48,
    metalness: actor.actorType === 'elite' ? 0.3 : 0.04,
  })
  const trim = new THREE.MeshStandardMaterial({
    color: actor.faction === 'enemy' ? 0x4e1720 : 0xe9d6a7,
    roughness: 0.55,
  })
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.12, 18), trim)
  base.position.y = 0.08
  const scale = actor.actorType === 'elite' ? 1.15 : actor.actorType === 'hunter' ? 0.9 : 1
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.21 * scale, 0.28 * scale, 0.58 * scale, 14), primary)
  body.position.y = 0.42
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19 * scale, 14, 10), primary)
  head.position.y = 0.78 * scale
  group.add(base, body, head)
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) child.castShadow = true
  })

  if (actor.actorType === 'player') {
    const sword = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.48, 0.09),
      new THREE.MeshStandardMaterial({ color: 0xe7edf5, metalness: 0.75, roughness: 0.2 }),
    )
    sword.position.set(0.3, 0.53, 0)
    sword.rotation.z = -0.35
    group.add(sword)
  }
  if (actor.actorType === 'elite') {
    const shield = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.54, 0.42),
      new THREE.MeshStandardMaterial({ color: 0xc49b47, metalness: 0.55, roughness: 0.34 }),
    )
    shield.position.set(-0.33, 0.46, 0)
    group.add(shield)
  }
  if (actor.actorType === 'npc') {
    const frost = new THREE.Mesh(
      new THREE.TorusGeometry(0.27, 0.03, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xa9e7ff, transparent: true, opacity: 0.76 }),
    )
    frost.position.y = 0.38
    frost.rotation.x = Math.PI / 2
    group.add(frost)
  }
  if (actor.shield > 0) {
    const shieldRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.025, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x7fd7ff, transparent: true, opacity: 0.8 }),
    )
    shieldRing.position.y = 0.42
    shieldRing.rotation.x = Math.PI / 2
    group.add(shieldRing)
  }

  const bar = new THREE.Group()
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(0.64, 0.075),
    new THREE.MeshBasicMaterial({ color: 0x261a1d, depthTest: false }),
  )
  const ratio = Math.max(0.01, actor.hp / actor.maxHp)
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6 * ratio, 0.045),
    new THREE.MeshBasicMaterial({ color: actor.faction === 'enemy' ? 0xf0626e : 0x70d58d, depthTest: false }),
  )
  fill.position.x = -0.3 + 0.3 * ratio
  fill.position.z = 0.002
  bar.add(back, fill)
  const momentumCount = Math.max(0, Math.min(3, Math.floor(momentum)))
  for (let index = 0; index < 3; index += 1) {
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.042, 12),
      new THREE.MeshBasicMaterial({
        color: index < momentumCount ? 0xc978ff : 0x263342,
        transparent: true,
        opacity: index < momentumCount ? 1 : 0.5,
        depthTest: false,
      }),
    )
    dot.position.set((index - 1) * 0.12, 0.14, 0.004)
    dot.renderOrder = 26
    bar.add(dot)
  }
  bar.position.y = actor.actorType === 'elite' ? 1.24 : 1.07
  bar.renderOrder = 24
  group.add(bar)
  billboards.push(bar)
  return group
}

function isValidTarget(state: GameState, selection: HexBoardSelection, coord: Coord) {
  const cell = cellAt(state, coord)
  if (!cell || cell.tags.includes('Blocked') || cell.tags.includes('Void')) return false
  const player = getPlayer(state)
  if (selection.kind === 'inspect') return false
  if (selection.kind === 'momentum') {
    return selection.validCoords.some((target) => sameCoord(target, coord))
  }
  if (selection.kind === 'basic') {
    if (selection.action === 'move') return hexDistance(player.position, coord) === 1 && !actorAt(state, coord)
    return hexDistance(player.position, coord) === 1 && Boolean(actorAt(state, coord, false))
  }
  if (selection.card.target === 'self') return false
  if (hexDistance(player.position, coord) > selection.card.range) return false
  if (selection.card.target === 'actor') {
    if (!actorAt(state, coord)) return false
    if (selection.card.range > 1 && !hasHexLineOfSight(state, player.position, coord)) return false
  }
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
  const color = ['cool', 'freeze', 'rain'].includes(effect)
    ? 0x67ccff
    : ['heat', 'ignite', 'vapor'].includes(effect)
      ? 0xff8249
      : effect === 'attack'
        ? 0xff4e5d
        : 0x73e6ac
  const ringMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.27, 6, 1, Math.PI / 2), ringMaterial)
  ring.rotation.x = -Math.PI / 2
  ring.position.copy(position)
  ring.renderOrder = 38
  content.add(ring)
  pulses.push({ object: ring, material: ringMaterial, startedAt: performance.now(), duration: 760 })

  const particleCount = effect === 'ignite' || effect === 'freeze'
    ? 14
    : effect === 'wind' || effect === 'rain'
      ? 10
      : 7
  for (let index = 0; index < particleCount; index += 1) {
    const geometry = effect === 'cool' || effect === 'freeze'
      ? new THREE.OctahedronGeometry(0.045, 0)
      : effect === 'rain'
        ? new THREE.CylinderGeometry(0.012, 0.012, 0.24, 5)
        : new THREE.SphereGeometry(0.035, 7, 5)
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.86 })
    const particle = new THREE.Mesh(geometry, material)
    const angle = index / particleCount * Math.PI * 2
    particle.position.set(
      position.x + Math.cos(angle) * 0.18,
      effect === 'rain' ? 1.85 + (index % 3) * 0.12 : position.y + (effect === 'vapor' ? 0.2 : 0.03),
      position.z + Math.sin(angle) * 0.18,
    )
    content.add(particle)
    pulses.push({
      object: particle,
      material,
      startedAt: performance.now() + index * 18,
      duration: 820,
      rise: effect === 'rain' ? -1.5 : effect === 'wind' ? 0.1 : 0.65,
    })
  }
}

export function HexThreeBoard({
  state,
  mode = 'tactical',
  travelPath = [],
  travelTarget,
  travelPreference = 'fastest',
  selectedCoord,
  hoverCoord,
  selection,
  targetLayer,
  cameraResetToken,
  showSky,
  showDebug,
  event,
  eventDurationMs = 680,
  momentumByActorId = {},
  onCellClick,
  onCellHover,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null)
  const contentRef = useRef<THREE.Group | null>(null)
  const actorObjectsRef = useRef(new Map<string, THREE.Object3D>())
  const previousActorPositionsRef = useRef(new Map<string, Coord>())
  const onClickRef = useRef(onCellClick)
  const onHoverRef = useRef(onCellHover)
  const stateRef = useRef(state)
  const bobRef = useRef<BobAnimation[]>([])
  const rainRef = useRef<RainAnimation[]>([])
  const cloudObjectsRef = useRef(new Map<string, THREE.Group>())
  const interactionLayerRef = useRef<THREE.Group | null>(null)
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
    cameraRef.current = camera
    contentRef.current = content

    const updateCamera = () => {
      const orbit = orbitRef.current
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
    const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.08)
    const boardPoint = new THREE.Vector3()
    let publishedHover: Coord | undefined

    const publishHover = (coord?: Coord) => {
      if ((!publishedHover && !coord) || sameCoord(publishedHover, coord)) return
      publishedHover = coord ? { ...coord } : undefined
      onHoverRef.current?.(coord)
    }

    const coordFromPointer = (eventValue: PointerEvent, preferred?: Coord) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((eventValue.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((eventValue.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      if (!raycaster.ray.intersectPlane(boardPlane, boardPoint)) return undefined

      const currentState = stateRef.current
      if (preferred) {
        const preferredCenter = hexWorldPosition(preferred, currentState)
        if (pointInsideHex(
          boardPoint.x - preferredCenter.x,
          boardPoint.z - preferredCenter.z,
          HEX_RADIUS * 1.075,
        )) return preferred
      }

      let nearest: Coord | undefined
      let nearestDistance = Number.POSITIVE_INFINITY
      for (const cell of currentState.cells) {
        if (cell.tags.includes('Void')) continue
        const center = hexWorldPosition(cell.coord, currentState)
        const dx = boardPoint.x - center.x
        const dz = boardPoint.z - center.z
        const distanceSquared = dx * dx + dz * dz
        if (distanceSquared < nearestDistance) {
          nearest = cell.coord
          nearestDistance = distanceSquared
        }
      }
      if (!nearest) return undefined
      const center = hexWorldPosition(nearest, currentState)
      return pointInsideHex(
        boardPoint.x - center.x,
        boardPoint.z - center.z,
        HEX_RADIUS * 1.025,
      ) ? nearest : undefined
    }

    const drag = {
      active: false,
      pointerId: -1,
      lastX: 0,
      lastY: 0,
      startX: 0,
      startY: 0,
      moved: false,
    }
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
        publishHover(undefined)
        return
      }
      const coord = coordFromPointer(eventValue, publishedHover)
      renderer.domElement.style.cursor = coord ? 'pointer' : 'grab'
      publishHover(coord)
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
    const handleLeave = () => {
      if (!drag.active) publishHover(undefined)
    }

    renderer.domElement.addEventListener('pointerdown', handleDown)
    renderer.domElement.addEventListener('pointermove', handleMove)
    renderer.domElement.addEventListener('pointerup', handleUp)
    renderer.domElement.addEventListener('pointercancel', handleUp)
    renderer.domElement.addEventListener('pointerleave', handleLeave)
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false })
    renderer.domElement.style.cursor = 'grab'

    let animationFrame = 0
    const render = () => {
      const now = performance.now()
      const seconds = now * 0.001
      for (const item of bobRef.current) {
        item.object.position.y = item.baseY + Math.sin(seconds * item.speed + item.phase) * item.amplitude
      }
      for (const item of rainRef.current) {
        const progress = (seconds * item.speed + item.phase) % 1
        item.object.position.y = item.topY - (item.topY - item.bottomY) * progress
        item.material.opacity = 0.22 + Math.sin(progress * Math.PI) * 0.55
      }
      moveRef.current = moveRef.current.filter((item) => {
        const progress = clamp((now - item.startedAt) / item.duration, 0, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        item.object.position.lerpVectors(item.from, item.to, eased)
        item.object.position.y += Math.sin(progress * Math.PI) * item.arcHeight
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
        item.material.opacity = 1 - progress
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
      renderer.domElement.removeEventListener('pointerleave', handleLeave)
      renderer.domElement.removeEventListener('wheel', handleWheel)
      disposeObject(content)
      renderer.dispose()
      host.replaceChildren()
      rendererRef.current = null
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
    camera.position.set(
      Math.sin(DEFAULT_ORBIT.yaw) * horizontal,
      Math.sin(DEFAULT_ORBIT.pitch) * radius,
      Math.cos(DEFAULT_ORBIT.yaw) * horizontal,
    )
    camera.lookAt(0, 0.2, 0)
    camera.zoom = DEFAULT_ORBIT.zoom
    camera.updateProjectionMatrix()
  }, [cameraResetToken])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    for (const child of [...content.children]) {
      content.remove(child)
      disposeObject(child)
    }
    actorObjectsRef.current.clear()
    bobRef.current = []
    rainRef.current = []
    cloudObjectsRef.current.clear()
    interactionLayerRef.current = null
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

    const interactionLayer = new THREE.Group()
    interactionLayer.name = 'hex-interaction-layer'
    content.add(interactionLayer)
    interactionLayerRef.current = interactionLayer

    for (const cell of state.cells) {
      if (cell.tags.includes('Void')) continue
      const position = hexWorldPosition(cell.coord, state)
      const tile = new THREE.Mesh(
        new THREE.CylinderGeometry(HEX_RADIUS, HEX_RADIUS, TILE_HEIGHT, 6),
        new THREE.MeshStandardMaterial({
          color: fillColor(cell),
          roughness: cell.moisture === 2 ? 0.3 : cell.moisture === 0 ? 0.92 : 0.68,
          metalness: cell.groundFill === 'ice' ? 0.16 : 0.02,
          flatShading: true,
        }),
      )
      tile.position.copy(position)
      tile.position.y = cell.groundFill === 'water' ? -0.04 : 0
      tile.receiveShadow = true
      tile.castShadow = false
      tile.add(createTopOutline(cell))
      content.add(tile)

      if (cell.tags.some((tag) => ['UT3Hard', 'UT3ReflectLeft', 'UT3ReflectRight'].includes(tag))) {
        const surface = createMomentumSurface(cell)
        surface.position.x = position.x
        surface.position.z = position.z
        content.add(surface)
      }

      if (isMountainCell(cell)) {
        const mountain = createMountain(cell)
        mountain.position.x = position.x
        mountain.position.z = position.z
        content.add(mountain)
      }

      if (isValidTarget(state, selection, cell.coord)) {
        const color = selection.kind === 'momentum'
          ? selection.action === 'drive' ? 0xc978ff : 0xd8ff4f
          : selection.kind === 'basic' && selection.action === 'attack'
          ? 0xf05b68
          : selection.kind === 'card' && selection.card.effect.includes('cool')
            ? 0x57bfff
            : selection.kind === 'card' && (selection.card.effect.includes('heat') || selection.card.effect === 'grip')
              ? 0xff8a45
              : 0x64d7a1
        if (selection.kind === 'momentum') {
          const reticle = createTargetReticle(color, targetLayer === 'sky' ? 1.62 : 0.17)
          reticle.position.x = position.x
          reticle.position.z = position.z
          content.add(reticle)
          bobRef.current.push({ object: reticle, baseY: reticle.position.y, phase: cell.coord.x + cell.coord.y, amplitude: 0.06, speed: 4.2 })
        } else {
          const overlay = createHexOverlay(color, targetLayer === 'sky' ? 0.22 : 0.34, targetLayer === 'sky' ? 1.62 : 0.12)
          overlay.position.x = position.x
          overlay.position.z = position.z
          content.add(overlay)
        }
      }

      if (cell.moisture === 2 && cell.groundFill !== 'water') {
        const puddle = createHexOverlay(0x6db8d2, 0.22, 0.11, 0.27)
        puddle.position.set(position.x + 0.13, 0.11, position.z - 0.1)
        content.add(puddle)
      }
      if (cell.groundFill === 'water') {
        const water = createHexOverlay(0x5ec7df, 0.4, 0.058, 0.5)
        water.position.x = position.x
        water.position.z = position.z
        content.add(water)
      }
      if (cell.groundFill === 'grass') {
        const material = new THREE.MeshStandardMaterial({ color: 0x77a64f, roughness: 0.9 })
        for (let index = 0; index < 3; index += 1) {
          const blade = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.27 + index * 0.03, 5), material)
          blade.position.set(
            position.x - 0.2 + index * 0.19,
            0.19,
            position.z + (index % 2 ? 0.13 : -0.1),
          )
          blade.castShadow = true
          content.add(blade)
        }
      }
      if (cell.groundFill === 'ice') {
        const ice = createHexOverlay(0xc9f4ff, 0.52, 0.105, 0.505)
        ice.position.x = position.x
        ice.position.z = position.z
        content.add(ice)
      }
      if (cell.groundFill === 'fire') {
        for (let index = 0; index < 3; index += 1) {
          const flame = new THREE.Mesh(
            new THREE.ConeGeometry(0.1, 0.42, 9),
            new THREE.MeshBasicMaterial({
              color: index === 1 ? 0xffdf70 : 0xff7040,
              transparent: true,
              opacity: 0.88,
            }),
          )
          flame.position.set(
            position.x + (index - 1) * 0.16,
            0.29,
            position.z + (index === 1 ? 0.04 : -0.05),
          )
          content.add(flame)
          bobRef.current.push({ object: flame, baseY: 0.29, phase: index * 1.7, amplitude: 0.06, speed: 5 + index })
        }
      }
      if (cell.tags.includes('Shelter')) {
        const beacon = new THREE.Group()
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.17, 0.48, 12),
          new THREE.MeshStandardMaterial({ color: 0xd7c79b, roughness: 0.75 }),
        )
        pillar.position.y = 0.28
        const glow = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 12, 8),
          new THREE.MeshBasicMaterial({ color: 0xffd56a }),
        )
        glow.position.y = 0.62
        beacon.add(pillar, glow)
        beacon.position.set(position.x, 0.08, position.z)
        content.add(beacon)
      }

      if (showSky && cell.skyFill === 'cloud') {
        const cloud = createCloud(cell, bobRef.current)
        cloud.position.x = position.x
        cloud.position.z = position.z
        content.add(cloud)
        cloudObjectsRef.current.set(coordKey(cell.coord), cloud)
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
        bobRef.current.push({
          object: wind,
          baseY: 1.35,
          phase: cell.coord.x + cell.coord.y,
          amplitude: 0.04,
          speed: 2.2,
        })
      }
      if (showSky && cell.intents.some((intentValue) => intentValue.type === 'rain')) {
        for (let index = 0; index < 7; index += 1) {
          const material = new THREE.MeshBasicMaterial({
            color: 0x7fdcff,
            transparent: true,
            opacity: 0.67,
            depthWrite: false,
          })
          const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.34, 5), material)
          const topY = 2.02 + (index % 3) * 0.16
          const bottomY = 0.16
          drop.position.set(
            position.x - 0.3 + (index % 4) * 0.19,
            topY,
            position.z - 0.2 + Math.floor(index / 4) * 0.3,
          )
          content.add(drop)
          rainRef.current.push({
            object: drop,
            material,
            topY,
            bottomY,
            phase: index / 7,
            speed: 0.72 + (index % 2) * 0.12,
          })
        }
      }
      if (showDebug) {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.04, 8, 6),
          new THREE.MeshBasicMaterial({
            color: temperatureColors[clamp(cell.groundTemp, -3, 3) + 3],
            depthTest: false,
          }),
        )
        marker.position.set(position.x - 0.28, 0.2, position.z - 0.24)
        marker.renderOrder = 30
        content.add(marker)
      }
    }

    const player = getPlayer(state)

    if (travelPath.length > 1) {
      const points = travelPath.map((coord) => hexWorldPosition(coord, state, 0.2))
      const pathMaterial = new THREE.LineDashedMaterial({
        color: travelPreference === 'fastest' ? 0xf4ca62 : 0x69ddb0,
        transparent: true,
        opacity: mode === 'travel' ? 0.92 : 0.3,
        dashSize: 0.2,
        gapSize: 0.09,
      })
      const pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), pathMaterial)
      pathLine.computeLineDistances()
      pathLine.renderOrder = 20
      content.add(pathLine)
    }

    if (travelTarget) {
      const targetPosition = hexWorldPosition(travelTarget, state, 0.23)
      const targetMaterial = new THREE.MeshBasicMaterial({
        color: travelPreference === 'fastest' ? 0xffda72 : 0x76e4b4,
        transparent: true,
        opacity: mode === 'travel' ? 0.92 : 0.45,
        depthWrite: false,
      })
      const targetMarker = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.42, 6), targetMaterial)
      targetMarker.rotation.x = -Math.PI / 2
      targetMarker.position.copy(targetPosition)
      targetMarker.renderOrder = 21
      content.add(targetMarker)
      bobRef.current.push({ object: targetMarker, baseY: targetMarker.position.y, phase: 0, amplitude: 0.035, speed: 3.4 })
    }

    if (mode === 'tactical') for (const actor of state.actors.filter((entry) => entry.alive && entry.faction === 'enemy')) {
      const steps = actor.actorType === 'hunter' ? 2 : 1
      const pathCoords = buildHexPath(state, actor.position, player.position, steps, actor.id)
      if (pathCoords.length <= 1) continue
      const points = pathCoords.map((coord) => hexWorldPosition(coord, state, 0.17))
      if (hexDistance(pathCoords[pathCoords.length - 1], player.position) === 1) {
        points.push(hexWorldPosition(player.position, state, 0.17))
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineDashedMaterial({
          color: 0xff6772,
          transparent: true,
          opacity: 0.74,
          dashSize: 0.15,
          gapSize: 0.1,
        }),
      )
      line.computeLineDistances()
      content.add(line)
    }

    for (const actor of state.actors.filter((entry) => entry.alive)) {
      const pawn = createActorPawn(actor, billboardRef.current, momentumByActorId[actor.id] ?? 0)
      const target = hexWorldPosition(actor.position, state, 0.1)
      const previous = previousActorPositionsRef.current.get(actor.id)
      if (previous && !sameCoord(previous, actor.position)) {
        const from = hexWorldPosition(previous, state, 0.1)
        pawn.position.copy(from)
        const momentumLog = state.logs.find((log) => log.includes('[UT3] Rush Strike'))
          ?? state.logs.find((log) => log.includes('[UT3] Drive'))
          ?? ''
        const isLaunch = momentumLog.includes('Launch') && actor.id !== 'player'
        const isBounce = momentumLog.includes('Bounce') && actor.id !== 'player'
        const isPierce = momentumLog.includes('Pierce') && actor.id === 'player'
        const isPush = momentumLog.includes('Push') && actor.id !== 'player'
        moveRef.current.push({
          object: pawn,
          from,
          to: target,
          startedAt: performance.now(),
          duration: Math.max(120, Math.min(eventDurationMs * 0.84, isPierce ? 280 : isLaunch || isBounce ? 620 : isPush ? 360 : 430)),
          arcHeight: isLaunch ? 0.92 : isBounce ? 0.42 : isPierce ? 0.08 : isPush ? 0.04 : 0.18,
        })
        if (momentumLog.includes('[UT3]')) {
          const trailColor = momentumLog.includes('M3') ? 0xff4b51 : momentumLog.includes('M2') ? 0xffa34d : 0xf1d061
          const trail = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([from.clone().setY(0.22), target.clone().setY(0.22)]),
            new THREE.LineDashedMaterial({
              color: trailColor,
              transparent: true,
              opacity: momentumLog.includes('M3') ? 0.95 : 0.72,
              dashSize: momentumLog.includes('M3') ? 0.28 : 0.16,
              gapSize: 0.08,
            }),
          )
          trail.computeLineDistances()
          trail.renderOrder = 18
          content.add(trail)
        }
      } else {
        pawn.position.copy(target)
      }
      previousActorPositionsRef.current.set(actor.id, { ...actor.position })
      content.add(pawn)
      actorObjectsRef.current.set(actor.id, pawn)
      bobRef.current.push({
        object: pawn,
        baseY: pawn.position.y,
        phase: actor.position.x * 0.7 + actor.position.y,
        amplitude: 0.018,
        speed: 2,
      })
    }

    if (event?.effect === 'attack' && event.sourceActorId && event.actorId) {
      const source = actorObjectsRef.current.get(event.sourceActorId)
      const victim = actorObjectsRef.current.get(event.actorId)
      if (source && victim) {
        attackRef.current.push({
          object: source,
          base: source.position.clone(),
          target: victim.position.clone(),
          victim,
          startedAt: performance.now(),
          duration: 480,
        })
      }
    }
    if (event) addLocalEffect(content, event, state, pulseRef.current)
  }, [state, mode, travelPath, travelTarget, travelPreference, selection, targetLayer, showSky, showDebug, event, eventDurationMs, momentumByActorId])

  useEffect(() => {
    const layer = interactionLayerRef.current
    if (!layer) return

    for (const child of [...layer.children]) {
      layer.remove(child)
      disposeObject(child)
    }

    for (const [key, cloud] of cloudObjectsRef.current) {
      const faded = key === coordKey(selectedCoord) || (hoverCoord && key === coordKey(hoverCoord))
      cloud.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.opacity = faded ? 0.28 : 0.8
        }
      })
    }

    const selectedPosition = hexWorldPosition(selectedCoord, state)
    const selected = createHexOverlay(0xf7d06e, 0.3, 0.14, 0.49)
    selected.position.x = selectedPosition.x
    selected.position.z = selectedPosition.z
    layer.add(selected)

    if (hoverCoord) {
      const hoverPosition = hexWorldPosition(hoverCoord, state)
      const hover = createHexOverlay(0xffffff, 0.15, 0.155, 0.45)
      hover.position.x = hoverPosition.x
      hover.position.z = hoverPosition.z
      layer.add(hover)

      const player = getPlayer(state)
      if (((selection.kind === 'basic' && selection.action === 'move') || selection.kind === 'momentum') && isValidTarget(state, selection, hoverCoord)) {
        const momentumDirection = selection.kind === 'momentum' ? hexDirectionOnLine(player.position, hoverCoord) : null
        const pathCoords = selection.kind === 'momentum' && momentumDirection
          ? [player.position, ...hexRay(player.position, momentumDirection, hexDistance(player.position, hoverCoord))]
          : buildHexPath(state, player.position, hoverCoord, 8, player.id)
        const path = pathCoords.map((coord) => hexWorldPosition(coord, state, 0.18))
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(path),
          new THREE.LineDashedMaterial({
            color: selection.kind === 'momentum' ? 0xf2c85a : 0x76e5b0,
            dashSize: 0.14,
            gapSize: 0.09,
            transparent: true,
            opacity: 0.9,
          }),
        )
        line.computeLineDistances()
        layer.add(line)
      }
    }
  }, [state, selectedCoord.x, selectedCoord.y, hoverCoord?.x, hoverCoord?.y, selection])

  return <div className="hex-board-host" ref={hostRef} aria-label="Three.js Hex6 棋盘" />
}
