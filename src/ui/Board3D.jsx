import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { AT_VISUAL_MS, momentumLevel, playbackElapsedMs } from '../sim/solver.js'
import { HEX_RADIUS, axialDistance, axialToWorld, directionVector, worldToAxial } from '../sim/hex.js'
import {
  WALL_REFLECTION_PATH_CONTRACT,
  WALL_VISUAL_CONTRACT,
  wallVisualYaw,
} from '../sim/wall-cell-reflection.js'

const TILE_HEIGHT = 0.18
const DEFAULT_CAMERA = { yaw: Math.PI * 0.25, pitch: 0.74, zoom: 1, targetX: 0, targetZ: 0 }
const PLAYER_BLUE = 0x58aed2
const PLAYER_PATH_BLUE = 0x68cce8
const DUMMY_YELLOW = 0xf0c84f
const REACHABLE_CYAN = 0x72ddff
const AXIS_HUD_LENGTH_PX = 30
const AXIS_HUD_STROKE_PX = 2.5
const AXIS_BODY_Y = 0.5
const SVG_NS = 'http://www.w3.org/2000/svg'
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function disposeObject(object) {
  object?.traverse?.((child) => {
    if (child.geometry) child.geometry.dispose()
    const material = child.material
    if (Array.isArray(material)) material.forEach((entry) => entry?.dispose?.())
    else material?.dispose?.()
  })
}

function createPlayerActor() {
  const group = new THREE.Group()
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.31, 0.36, 0.12, 18),
    new THREE.MeshStandardMaterial({ color: 0xeadbb8, roughness: 0.55 }),
  )
  base.position.y = 0.08
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.21, 0.28, 0.58, 14),
    new THREE.MeshStandardMaterial({ color: PLAYER_BLUE, roughness: 0.48, metalness: 0.04 }),
  )
  body.position.y = 0.42
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 14, 10),
    new THREE.MeshStandardMaterial({ color: PLAYER_BLUE, roughness: 0.48 }),
  )
  head.position.y = 0.78
  group.add(base, body, head)

  const momentumDots = []
  for (let index = 0; index < 3; index += 1) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x334151, transparent: true, opacity: 0.52, depthTest: false }),
    )
    dot.position.set((index - 1) * 0.15, 1.08, 0)
    dot.renderOrder = 50
    group.add(dot)
    momentumDots.push(dot)
  }
  group.userData.momentumDots = momentumDots
  group.traverse((child) => { if (child instanceof THREE.Mesh) child.castShadow = true })
  return group
}

function createDummyActor() {
  const group = new THREE.Group()
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.27, 0.31, 0.1, 16),
    new THREE.MeshStandardMaterial({ color: 0x6a5823, roughness: 0.7 }),
  )
  base.position.y = 0.06
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.23, 0.48, 12),
    new THREE.MeshStandardMaterial({ color: DUMMY_YELLOW, emissive: 0x4a3608, emissiveIntensity: 0.22, roughness: 0.48 }),
  )
  body.position.y = 0.34
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 9),
    new THREE.MeshStandardMaterial({ color: 0xffdd70, roughness: 0.52 }),
  )
  head.position.y = 0.67
  group.add(base, body, head)

  const momentumDots = []
  for (let index = 0; index < 3; index += 1) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.052, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x334151, transparent: true, opacity: 0.52, depthTest: false }),
    )
    dot.position.set((index - 1) * 0.14, 0.96, 0)
    dot.renderOrder = 50
    group.add(dot)
    momentumDots.push(dot)
  }
  group.userData.momentumDots = momentumDots
  group.traverse((child) => { if (child instanceof THREE.Mesh) child.castShadow = true })
  return group
}

function updateMomentumDots(actor, level) {
  const dots = actor?.userData?.momentumDots ?? []
  dots.forEach((dot, index) => {
    const active = index < level
    dot.material.color.setHex(active ? 0xcf82e3 : 0x334151)
    dot.material.opacity = active ? 1 : 0.5
  })
}

function nearestAxisId(velocity) {
  const speed = Math.hypot(velocity?.x ?? 0, velocity?.z ?? 0)
  if (speed < 0.001) return null
  const source = { x: velocity.x / speed, z: velocity.z / speed }
  let best = null
  let bestDot = -Infinity
  for (const id of ['E', 'NE', 'NW', 'W', 'SW', 'SE']) {
    const direction = directionVector(id)
    const dot = direction.x * source.x + direction.z * source.z
    if (dot > bestDot) {
      bestDot = dot
      best = id
    }
  }
  return best
}

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag)
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)))
  return element
}

function createActorAxisHud() {
  const svg = svgElement('svg', {
    class: 'actor-axis-hud',
    'aria-label': 'Persistent Actor Axis indicator',
  })
  Object.assign(svg.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '18',
    pointerEvents: 'none', overflow: 'visible',
  })

  const defs = svgElement('defs')
  const marker = svgElement('marker', {
    id: 'projectc-actor-axis-arrow-head', viewBox: '0 0 10 10', refX: '8', refY: '5',
    markerWidth: '4.8', markerHeight: '4.8', orient: 'auto-start-reverse',
  })
  marker.appendChild(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#f2c85a' }))
  defs.appendChild(marker)
  svg.appendChild(defs)

  const targetLayer = svgElement('g', { 'data-axis-hud-kind': 'targets' })
  svg.appendChild(targetLayer)
  const targetEntries = new Map()

  const makeAxisLine = (kind) => {
    const group = svgElement('g', { 'data-axis-hud-kind': kind })
    const line = svgElement('line', {
      stroke: '#f2c85a', 'stroke-width': AXIS_HUD_STROKE_PX, 'stroke-linecap': 'round',
      'marker-end': 'url(#projectc-actor-axis-arrow-head)',
    })
    line.style.filter = 'drop-shadow(0 0 3px rgba(242,200,90,.66))'
    group.appendChild(line)
    svg.appendChild(group)
    group.style.display = 'none'
    return { group, line }
  }

  const ensureTarget = (actorId) => {
    const existing = targetEntries.get(actorId)
    if (existing) return existing
    const group = svgElement('g', {
      'data-target-axis-actor-id': actorId,
      'data-target-m': '0',
      'data-target-axis': 'none',
      'data-target-momentum-dots': '3',
      'data-target-momentum-active': '0',
    })
    const line = svgElement('line', {
      stroke: '#f2c85a', 'stroke-width': AXIS_HUD_STROKE_PX, 'stroke-linecap': 'round',
      'marker-end': 'url(#projectc-actor-axis-arrow-head)',
    })
    line.style.filter = 'drop-shadow(0 0 3px rgba(242,200,90,.66))'
    group.appendChild(line)
    targetLayer.appendChild(group)
    group.style.display = 'none'
    const entry = { group, line }
    targetEntries.set(actorId, entry)
    return entry
  }

  const pruneTargets = (activeIds) => {
    for (const [actorId, entry] of targetEntries) {
      if (activeIds.has(actorId)) continue
      entry.group.remove()
      targetEntries.delete(actorId)
    }
  }

  const horizontal = makeAxisLine('horizontal')
  const down = makeAxisLine('down')
  return {
    svg,
    horizontal: horizontal.group,
    horizontalLine: horizontal.line,
    down: down.group,
    downLine: down.line,
    ensureTarget,
    pruneTargets,
  }
}

function projectedPoint(point, camera, width, height) {
  const projected = point.clone().project(camera)
  return {
    x: (projected.x + 1) * 0.5 * width,
    y: (1 - projected.y) * 0.5 * height,
  }
}

function downOverrideLevel(override) {
  if (!String(override ?? '').startsWith('down-')) return null
  return clamp(Number(String(override).split('-')[1]) || 1, 1, 3)
}

function setScreenArrow(line, source, dx, dy, startOffset = 3) {
  const screenLength = Math.max(1, Math.hypot(dx, dy))
  const ux = dx / screenLength
  const uy = dy / screenLength
  line.setAttribute('x1', (source.x + ux * startOffset).toFixed(2))
  line.setAttribute('y1', (source.y + uy * startOffset).toFixed(2))
  line.setAttribute('x2', (source.x + ux * AXIS_HUD_LENGTH_PX).toFixed(2))
  line.setAttribute('y2', (source.y + uy * AXIS_HUD_LENGTH_PX).toFixed(2))
}

function updateActorAxisHud(hud, camera, width, height, visualState, spatialMode, override) {
  if (!hud || !camera || width < 1 || height < 1) return 'none'
  const downLevel = downOverrideLevel(override)
  const sourceWorld = new THREE.Vector3(visualState.position.x, AXIS_BODY_Y, visualState.position.z)
  const source = projectedPoint(sourceWorld, camera, width, height)

  if (downLevel) {
    hud.horizontal.style.display = 'none'
    hud.down.style.display = ''
    const downWorld = sourceWorld.clone().add(new THREE.Vector3(0, -1, 0))
    const downTarget = projectedPoint(downWorld, camera, width, height)
    let dx = downTarget.x - source.x
    let dy = downTarget.y - source.y
    if (Math.hypot(dx, dy) < 4) {
      dx = 0
      dy = 1
    }
    setScreenArrow(hud.downLine, source, dx, dy)
    return 'down'
  }

  hud.down.style.display = 'none'
  let direction = null
  let directionId = visualState.axisId ?? null
  const speed = Math.hypot(visualState.velocity?.x ?? 0, visualState.velocity?.z ?? 0)
  if (spatialMode === 'hybrid' && speed > 0.02) {
    direction = { x: visualState.velocity.x / speed, z: visualState.velocity.z / speed }
    directionId = 'continuous'
  } else {
    directionId = directionId ?? nearestAxisId(visualState.velocity)
    if (directionId) direction = directionVector(directionId)
  }

  if (!direction) {
    hud.horizontal.style.display = 'none'
    return 'none'
  }

  hud.horizontal.style.display = ''
  const targetWorld = sourceWorld.clone().add(new THREE.Vector3(direction.x, 0, direction.z))
  const target = projectedPoint(targetWorld, camera, width, height)
  setScreenArrow(hud.horizontalLine, source, target.x - source.x, target.y - source.y)
  return directionId
}

function updateTargetAxisHud(hud, camera, width, height, actorId, position, visualY, axisId, level) {
  if (!hud || !camera || width < 1 || height < 1) return 'none'
  const entry = hud.ensureTarget(actorId)
  const normalizedLevel = Math.max(0, Math.round(Number(level) || 0))
  entry.group.dataset.targetM = String(normalizedLevel)
  entry.group.dataset.targetAxis = axisId || 'none'
  entry.group.dataset.targetMomentumActive = String(Math.min(3, normalizedLevel))

  if (!axisId) {
    entry.group.style.display = 'none'
    return 'none'
  }

  entry.group.style.display = ''
  const sourceWorld = new THREE.Vector3(position.x, visualY + 0.34, position.z)
  const source = projectedPoint(sourceWorld, camera, width, height)
  const direction = directionVector(axisId)
  const targetWorld = sourceWorld.clone().add(new THREE.Vector3(direction.x, 0, direction.z))
  const target = projectedPoint(targetWorld, camera, width, height)
  setScreenArrow(entry.line, source, target.x - source.x, target.y - source.y)
  return axisId
}

function sampleRecord(samples, progress) {
  if (!samples?.length) return null
  if (samples.length === 1) return samples[0]
  const normalized = clamp(progress, 0, 1)
  if (normalized >= 1) return samples.at(-1)
  const scaled = normalized * (samples.length - 1)
  const index = Math.min(samples.length - 2, Math.max(0, Math.floor(scaled)))
  const local = scaled - index
  const a = samples[index]
  const b = samples[index + 1]
  return {
    position: {
      x: a.position.x + (b.position.x - a.position.x) * local,
      z: a.position.z + (b.position.z - a.position.z) * local,
    },
    velocity: {
      x: (a.velocity?.x ?? 0) + ((b.velocity?.x ?? 0) - (a.velocity?.x ?? 0)) * local,
      z: (a.velocity?.z ?? 0) + ((b.velocity?.z ?? 0) - (a.velocity?.z ?? 0)) * local,
    },
    axisId: local < 0.5 ? (a.axisId ?? b.axisId ?? null) : (b.axisId ?? a.axisId ?? null),
  }
}

function uniqueWorldPoints(samples = [], y = 0.24) {
  const points = []
  for (const sample of samples) {
    const point = sample.position ?? sample
    if (!point) continue
    const next = new THREE.Vector3(point.x, y, point.z)
    if (!points.length || points.at(-1).distanceTo(next) > 0.002) points.push(next)
  }
  return points
}

function smoothPoints(points) {
  if (points.length <= 2) return points.map((point) => point.clone())
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.42)
  return curve.getPoints(Math.max(28, (points.length - 1) * 18))
}

function playerUsesWallPivot(plan) {
  return Boolean(plan?.collisions?.some((entry) => entry.wallCellPivot))
}

function wallPivotActorIds(events = []) {
  return new Set(events
    .filter((entry) => entry.kind === 'surface-reflection' && entry.wallCellPivot && entry.actorId)
    .map((entry) => entry.actorId))
}

function planPathPoints(plan, y = 0.24) {
  if (!plan?.samples?.length) return []
  const source = uniqueWorldPoints(plan.samples, y)
  if (plan.visualCurveAuthoritative) return source
  if (playerUsesWallPivot(plan)) return source
  const shouldSmooth = plan.destinationDriven || plan.spatialMode === 'discrete' || source.length <= 8
  return shouldSmooth ? smoothPoints(source) : source
}

function trajectoryPathPoints(hexPath = [], y = 0.32, preserveCorners = false) {
  const source = hexPath.map((hex) => {
    const point = axialToWorld(hex)
    return new THREE.Vector3(point.x, y, point.z)
  })
  return preserveCorners ? source : smoothPoints(source)
}

function samplePoint(points, progress) {
  if (!points?.length) return null
  if (points.length === 1) return points[0].clone()
  const normalized = clamp(progress, 0, 1)
  const scaled = normalized * (points.length - 1)
  const index = Math.min(points.length - 2, Math.max(0, Math.floor(scaled)))
  return points[index].clone().lerp(points[index + 1], scaled - index)
}

function createDashedPath(points, color, opacity = 0.98) {
  if (!points || points.length < 2) return null
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineDashedMaterial({
    color, transparent: true, opacity, dashSize: 0.17, gapSize: 0.11, depthTest: false, depthWrite: false,
  })
  const line = new THREE.Line(geometry, material)
  line.computeLineDistances()
  line.renderOrder = 70
  return line
}

function createReachableHighlight() {
  const group = new THREE.Group()
  const fill = new THREE.Mesh(
    new THREE.CylinderGeometry(HEX_RADIUS * 0.88, HEX_RADIUS * 0.88, 0.025, 6),
    new THREE.MeshBasicMaterial({ color: REACHABLE_CYAN, transparent: true, opacity: 0.24, depthTest: false, depthWrite: false }),
  )
  fill.position.y = 0.145
  fill.renderOrder = 60
  group.add(fill)

  const points = Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI * 0.5 - index * Math.PI / 3
    return new THREE.Vector3(Math.cos(angle) * HEX_RADIUS * 0.94, 0.17, Math.sin(angle) * HEX_RADIUS * 0.94)
  })
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0xc4f5ff, transparent: true, opacity: 1, depthTest: false, depthWrite: false }),
  )
  outline.renderOrder = 62
  group.add(outline)
  return group
}

function createRingMarker(color, radius = 0.42) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.035, 8, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.96, depthTest: false, depthWrite: false }),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.2
  ring.renderOrder = 75
  return ring
}


function collisionDebugFxSpecs(events = []) {
  const specs = []
  for (const event of events) {
    if (event?.kind === 'cell-conflict' && event.cell) {
      specs.push({ label: 'CONTACT', color: 0xff9855, hex: event.cell })
    } else if (event?.kind === 'cell-conflict-blocked' && event.cell) {
      specs.push({ label: 'BLOCKED', color: 0xffd86a, hex: event.cell })
    } else if (event?.kind === 'surface-reflection') {
      const hex = event.attemptedCell ?? event.from
      if (hex) specs.push({ label: 'REFLECT', color: 0x62dff2, hex })
    }
  }
  return specs
}

function createDebugFxLabel(text, color) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 72
  const context = canvas.getContext('2d')
  if (!context) return null
  const colorCss = `#${color.toString(16).padStart(6, '0')}`
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = 'rgba(7, 15, 24, 0.82)'
  context.fillRect(30, 8, 196, 54)
  context.strokeStyle = colorCss
  context.lineWidth = 4
  context.strokeRect(30, 8, 196, 54)
  context.fillStyle = '#ffffff'
  context.font = '700 28px system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, 128, 36)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 1, depthTest: false, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.position.y = 1.06
  sprite.scale.set(1.42, 0.4, 1)
  sprite.renderOrder = 96
  sprite.userData.debugFxTexture = texture
  return sprite
}

function createCollisionDebugMarker(spec, index, count) {
  const group = new THREE.Group()
  const center = axialToWorld(spec.hex)
  group.position.set(center.x, 0.02, center.z)

  const discMaterial = new THREE.MeshBasicMaterial({
    color: spec.color, transparent: true, opacity: 0.36, depthTest: false, depthWrite: false,
  })
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(HEX_RADIUS * 0.62, HEX_RADIUS * 0.62, 0.028, 6), discMaterial)
  disc.position.y = 0.18
  disc.renderOrder = 90
  group.add(disc)

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: spec.color, transparent: true, opacity: 0.98, depthTest: false, depthWrite: false,
  })
  const ring = new THREE.Mesh(new THREE.TorusGeometry(HEX_RADIUS * 0.68, 0.045, 8, 32), ringMaterial)
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.24
  ring.renderOrder = 92
  group.add(ring)

  const flashMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.92, depthTest: false, depthWrite: false,
  })
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), flashMaterial)
  flash.position.y = 0.48
  flash.renderOrder = 94
  group.add(flash)

  const label = createDebugFxLabel(spec.label, spec.color)
  if (label) group.add(label)

  group.userData.debugFxCenter = count <= 1 ? 0.5 : 0.3 + (index / Math.max(1, count - 1)) * 0.45
  group.userData.debugFxMaterials = [discMaterial, ringMaterial, flashMaterial, ...(label ? [label.material] : [])]
  group.userData.debugFxBaseOpacities = group.userData.debugFxMaterials.map((material) => material.opacity)
  group.userData.debugFxLabel = spec.label
  group.userData.debugFxHex = { ...spec.hex }
  group.visible = false
  return group
}

function clearCollisionDebugFx(group) {
  if (!group) return
  for (const child of [...group.children]) {
    child.traverse((entry) => entry.userData?.debugFxTexture?.dispose?.())
    group.remove(child)
    disposeObject(child)
  }
}

function updateCollisionDebugFx(group, progress) {
  if (!group) return
  for (const marker of group.children) {
    const center = marker.userData.debugFxCenter ?? 0.5
    const intensity = clamp(1 - Math.abs(progress - center) / 0.18, 0, 1)
    marker.visible = intensity > 0.01
    if (!marker.visible) continue
    marker.scale.setScalar(0.72 + intensity * 0.9)
    const materials = marker.userData.debugFxMaterials ?? []
    const base = marker.userData.debugFxBaseOpacities ?? []
    materials.forEach((material, materialIndex) => {
      material.opacity = (base[materialIndex] ?? 1) * intensity
    })
  }
}

function groundColor(cell, showThermal) {
  const base = cell.tags?.includes('Mountain')
    ? new THREE.Color(0x687782)
    : cell.groundFill === 'grass'
      ? new THREE.Color(0x688f5f)
      : cell.groundFill === 'water'
        ? new THREE.Color(0x4e8faf)
        : cell.groundFill === 'ice'
          ? new THREE.Color(0xa7dce8)
          : cell.groundFill === 'fire'
            ? new THREE.Color(0xc97862)
            : new THREE.Color(0x8f816e)
  if (!showThermal) return base
  if ((cell.groundTemp ?? 0) < 0) return base.lerp(new THREE.Color(0x62a9d8), Math.min(0.34, Math.abs(cell.groundTemp) * 0.08))
  if ((cell.groundTemp ?? 0) > 0) return base.lerp(new THREE.Color(0xe58f61), Math.min(0.34, Math.abs(cell.groundTemp) * 0.08))
  return base
}

function createObstacleMesh(obstacle) {
  const reflector = obstacle.kind === 'reflector'
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(reflector ? 0.65 : 0.76, reflector ? 0.72 : 0.95, reflector ? 0.12 : 0.2),
    new THREE.MeshStandardMaterial({
      color: reflector ? 0x5cbec9 : 0x66727e,
      emissive: reflector ? 0x133f46 : 0x151b22,
      emissiveIntensity: reflector ? 0.35 : 0.15,
      roughness: reflector ? 0.36 : 0.78,
      metalness: reflector ? 0.45 : 0.18,
    }),
  )
  mesh.position.y = reflector ? 0.46 : 0.56
  if (obstacle.wallAxis) {
    mesh.rotation.y = wallVisualYaw(obstacle.wallAxis)
    mesh.userData.wallAxis = obstacle.wallAxis
    mesh.userData.wallYaw = mesh.rotation.y
    mesh.userData.wallVisualContract = WALL_VISUAL_CONTRACT
  }
  mesh.castShadow = true
  return mesh
}

export function Board3D({
  cells,
  obstacles,
  actors = [],
  reachableCells = [],
  state,
  previewPlan,
  playback,
  atVisualMs,
  axisDisplayOverride = 'auto',
  boardRadius,
  viewMode,
  cameraResetToken,
  hoverHex,
  selectedAimHex,
  showWeather,
  showThermal,
  showDebugCollisionFx = false,
  onHoverHex,
  onClickHex,
}) {
  const hostRef = useRef(null)
  const sceneRef = useRef(null)
  const rendererRef = useRef(null)
  const cameraRef = useRef(null)
  const boardGroupRef = useRef(null)
  const interactionRef = useRef(null)
  const playerRef = useRef(null)
  const axisHudRef = useRef(null)
  const dummyGroupRef = useRef(null)
  const dummyObjectsRef = useRef(new Map())
  const previewGroupRef = useRef(null)
  const collisionFxGroupRef = useRef(null)
  const orbitRef = useRef({ ...DEFAULT_CAMERA })
  const stateRef = useRef(state)
  const actorsRef = useRef(actors)
  const playbackRef = useRef(playback)
  const callbacksRef = useRef({ onHoverHex, onClickHex })
  const viewModeRef = useRef(viewMode)
  const atVisualMsRef = useRef(atVisualMs)
  const axisDisplayOverrideRef = useRef(axisDisplayOverride)
  const showDebugCollisionFxRef = useRef(showDebugCollisionFx)
  const playbackCacheRef = useRef({ id: null, playerPoints: [], actorPoints: new Map() })

  stateRef.current = state
  actorsRef.current = actors
  playbackRef.current = playback
  callbacksRef.current = { onHoverHex, onClickHex }
  viewModeRef.current = viewMode
  atVisualMsRef.current = atVisualMs
  axisDisplayOverrideRef.current = axisDisplayOverride
  showDebugCollisionFxRef.current = showDebugCollisionFx

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x16283b)
    scene.fog = new THREE.Fog(0x16283b, 13, 28)
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.touchAction = 'none'
    const axisHud = createActorAxisHud()
    host.replaceChildren(renderer.domElement, axisHud.svg)
    axisHudRef.current = axisHud

    host.dataset.axisStyle = 'actor-body-screen-arrow-v5'
    host.dataset.actorAxisPersistent = 'true'
    host.dataset.targetBodyInertiaHud = 'actor-body-m-axis-v1'
    host.dataset.targetMomentumStyle = 'actor-momentum-dots-v1'
    host.dataset.targetAxisStyle = 'actor-body-screen-arrow-v5'
    host.dataset.axisLengthPx = String(AXIS_HUD_LENGTH_PX)
    host.dataset.axisStrokePx = String(AXIS_HUD_STROKE_PX)
    host.dataset.axisSupportsDown = 'true'
    host.dataset.axisAnchor = 'actor-body'
    host.dataset.axisDownStyle = 'unified-arrow-v1'
    host.dataset.previewStyle = 'blue-dashed-no-arrow-v3'
    host.dataset.previewArrow = 'none'
    host.dataset.previewAuthority = 'cell-target-path-v3'
    host.dataset.reachableHighlight = 'lifted-outline-v3'
    host.dataset.knockbackPreview = 'yellow-dashed-path-v2'
    host.dataset.knockbackPlayback = 'contact-staggered-fast-v3'
    host.dataset.middlePan = 'enabled'
    host.dataset.wallVisualContract = WALL_VISUAL_CONTRACT
    host.dataset.wallReflectionPathContract = WALL_REFLECTION_PATH_CONTRACT
    host.dataset.previewPathMode = 'smooth'
    host.dataset.playbackPathMode = 'smooth'
    host.dataset.collisionDebugFx = showDebugCollisionFxRef.current ? 'on' : 'off'
    host.dataset.collisionDebugFxStyle = showDebugCollisionFxRef.current ? 'logic-event-pulse-v1' : 'off'
    host.dataset.collisionFxEventCount = '0'

    const camera = new THREE.OrthographicCamera(-7, 7, 5, -5, 0.1, 60)
    const boardGroup = new THREE.Group()
    const interaction = new THREE.Group()
    const dummyGroup = new THREE.Group()
    const collisionFxGroup = new THREE.Group()
    const player = createPlayerActor()

    scene.add(new THREE.HemisphereLight(0xcbe4ef, 0x415064, 1.75))
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.85)
    sun.position.set(-6, 11, -5)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    scene.add(sun, boardGroup, interaction, dummyGroup, collisionFxGroup, player)

    sceneRef.current = scene
    rendererRef.current = renderer
    cameraRef.current = camera
    boardGroupRef.current = boardGroup
    interactionRef.current = interaction
    dummyGroupRef.current = dummyGroup
    collisionFxGroupRef.current = collisionFxGroup
    playerRef.current = player

    const updateCamera = () => {
      const orbit = orbitRef.current
      if (viewModeRef.current === 'top') {
        camera.position.set(orbit.targetX, 18, orbit.targetZ + 0.01)
        camera.lookAt(orbit.targetX, 0, orbit.targetZ)
      } else {
        const radius = 17
        const horizontal = Math.cos(orbit.pitch) * radius
        camera.position.set(
          orbit.targetX + Math.sin(orbit.yaw) * horizontal,
          Math.sin(orbit.pitch) * radius,
          orbit.targetZ + Math.cos(orbit.yaw) * horizontal,
        )
        camera.lookAt(orbit.targetX, 0.2, orbit.targetZ)
      }
      camera.zoom = orbit.zoom
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld()
      host.dataset.cameraZoom = camera.zoom.toFixed(4)
      host.dataset.cameraTargetX = orbit.targetX.toFixed(4)
      host.dataset.cameraTargetZ = orbit.targetZ.toFixed(4)
    }

    let viewportWidth = 0
    let viewportHeight = 0
    const applyResize = () => {
      const width = Math.max(1, Math.round(host.clientWidth))
      const height = Math.max(1, Math.round(host.clientHeight))
      if (width === viewportWidth && height === viewportHeight) return
      viewportWidth = width
      viewportHeight = height
      renderer.setSize(width, height, false)
      axisHud.svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
      const size = 6.2
      const aspect = width / height
      camera.left = -size * aspect
      camera.right = size * aspect
      camera.top = size
      camera.bottom = -size
      camera.updateProjectionMatrix()
      host.dataset.viewportWidth = String(width)
      host.dataset.viewportHeight = String(height)
    }
    applyResize()
    updateCamera()
    const observer = new ResizeObserver(applyResize)
    observer.observe(host)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const groundPointAt = (clientX, clientY) => {
      const rect = renderer.domElement.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return null
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const point = new THREE.Vector3()
      return raycaster.ray.intersectPlane(plane, point) ? point : null
    }
    const pickHex = (event) => {
      const point = groundPointAt(event.clientX, event.clientY)
      if (!point) return null
      const hex = worldToAxial({ x: point.x, z: point.z })
      return axialDistance(hex) <= boardRadius ? hex : null
    }

    const drag = { active: false, moved: false, mode: 'rotate', pointerId: -1, startX: 0, startY: 0, x: 0, y: 0 }
    let hoverKey = ''
    const pointerDown = (event) => {
      if ((event.button !== 0 && event.button !== 1) || playbackRef.current) return
      if (event.button === 1) event.preventDefault()
      drag.active = true
      drag.moved = false
      drag.mode = event.button === 1 ? 'pan' : 'rotate'
      drag.pointerId = event.pointerId
      drag.startX = drag.x = event.clientX
      drag.startY = drag.y = event.clientY
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const pointerMove = (event) => {
      if (drag.active) {
        const previousX = drag.x
        const previousY = drag.y
        const dx = event.clientX - previousX
        const dy = event.clientY - previousY
        drag.x = event.clientX
        drag.y = event.clientY
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true

        if (drag.mode === 'pan' && !playbackRef.current) {
          const previousPoint = groundPointAt(previousX, previousY)
          const currentPoint = groundPointAt(event.clientX, event.clientY)
          if (previousPoint && currentPoint) {
            orbitRef.current.targetX += previousPoint.x - currentPoint.x
            orbitRef.current.targetZ += previousPoint.z - currentPoint.z
            updateCamera()
          }
        } else if (viewModeRef.current !== 'top' && !playbackRef.current) {
          orbitRef.current.yaw -= dx * 0.008
          orbitRef.current.pitch = clamp(orbitRef.current.pitch + dy * 0.006, 0.38, 1.22)
          updateCamera()
        }
        return
      }

      if (playbackRef.current) return
      const hex = pickHex(event)
      const key = hex ? `${hex.q},${hex.r}` : ''
      if (key === hoverKey) return
      hoverKey = key
      callbacksRef.current.onHoverHex?.(hex)
    }
    const pointerUp = (event) => {
      if (!drag.active || drag.pointerId !== event.pointerId) return
      const moved = drag.moved
      const mode = drag.mode
      drag.active = false
      renderer.domElement.releasePointerCapture(event.pointerId)
      if (mode === 'rotate' && !moved && !playbackRef.current) {
        const hex = pickHex(event)
        if (hex) callbacksRef.current.onClickHex?.(hex)
      }
    }
    const pointerLeave = () => {
      if (!drag.active && !playbackRef.current) {
        hoverKey = ''
        callbacksRef.current.onHoverHex?.(null)
      }
    }
    const wheel = (event) => {
      event.preventDefault()
      if (playbackRef.current) return
      orbitRef.current.zoom = clamp(orbitRef.current.zoom * Math.exp(-event.deltaY * 0.001), 0.58, 2.15)
      updateCamera()
    }
    const preventMiddleAuxClick = (event) => { if (event.button === 1) event.preventDefault() }

    renderer.domElement.addEventListener('pointerdown', pointerDown)
    renderer.domElement.addEventListener('pointermove', pointerMove)
    renderer.domElement.addEventListener('pointerup', pointerUp)
    renderer.domElement.addEventListener('pointercancel', pointerUp)
    renderer.domElement.addEventListener('pointerleave', pointerLeave)
    renderer.domElement.addEventListener('wheel', wheel, { passive: false })
    renderer.domElement.addEventListener('auxclick', preventMiddleAuxClick)

    let frame = 0
    const render = () => {
      const now = performance.now()
      const activePlayback = playbackRef.current
      let visualState = stateRef.current
      let progress = 0

      if (activePlayback) {
        const durationMs = activePlayback.durationMs ?? atVisualMsRef.current ?? AT_VISUAL_MS
        progress = clamp(playbackElapsedMs(activePlayback, now) / Math.max(1, durationMs), 0, 1)
        if (playbackCacheRef.current.id !== activePlayback.id) {
          const actorPoints = new Map()
          const wallActors = wallPivotActorIds(activePlayback.conflictEvents ?? [])
          for (const [id, path] of Object.entries(activePlayback.actorTrajectories ?? {})) {
            actorPoints.set(id, trajectoryPathPoints(path, 0.32, wallActors.has(id)))
          }
          const wallPolyline = playerUsesWallPivot(activePlayback) || wallActors.size > 0
          host.dataset.playbackPathMode = wallPolyline ? WALL_REFLECTION_PATH_CONTRACT : 'smooth'
          playbackCacheRef.current = {
            id: activePlayback.id,
            playerPoints: planPathPoints(activePlayback, 0.18),
            actorPoints,
          }
          clearCollisionDebugFx(collisionFxGroupRef.current)
          const fxSpecs = showDebugCollisionFxRef.current
            ? collisionDebugFxSpecs(activePlayback.conflictEvents ?? [])
            : []
          fxSpecs.forEach((spec, index) => collisionFxGroupRef.current?.add(createCollisionDebugMarker(spec, index, fxSpecs.length)))
          host.dataset.collisionFxEventCount = String(fxSpecs.length)
        }
        const playerEnd = clamp(activePlayback.playerPlaybackEnd ?? 1, 0.05, 1)
        const playerProgress = clamp(progress / playerEnd, 0, 1)
        const sampled = sampleRecord(activePlayback.samples, playerProgress)
        const pathPosition = samplePoint(playbackCacheRef.current.playerPoints, playerProgress)
        if (sampled) {
          visualState = {
            ...stateRef.current,
            position: pathPosition ? { x: pathPosition.x, z: pathPosition.z } : sampled.position,
            velocity: sampled.velocity,
            axisId: sampled.axisId ?? (playerProgress > 0.65 ? activePlayback.finalState?.axisId : stateRef.current.axisId),
          }
        }
        host.dataset.playbackProgress = progress.toFixed(3)
        host.dataset.playerPlaybackProgress = playerProgress.toFixed(3)
        host.dataset.playerPlaybackEnd = playerEnd.toFixed(3)
        host.dataset.actorPlaybackWindowCount = String(Object.keys(activePlayback.actorPlaybackWindows ?? {}).length)
        host.dataset.playbackId = String(activePlayback.id)
        updateCollisionDebugFx(collisionFxGroupRef.current, progress)
      } else {
        if (playbackCacheRef.current.id !== null) clearCollisionDebugFx(collisionFxGroupRef.current)
      playbackCacheRef.current = { id: null, playerPoints: [], actorPoints: new Map() }
        host.dataset.playbackProgress = '0'
        host.dataset.playerPlaybackProgress = '0'
        host.dataset.playerPlaybackEnd = '1'
        host.dataset.actorPlaybackWindowCount = '0'
        host.dataset.playbackPathMode = 'smooth'
        host.dataset.collisionFxEventCount = '0'
      delete host.dataset.playbackId
      host.dataset.collisionDebugFx = showDebugCollisionFxRef.current ? 'on' : 'off'
      host.dataset.collisionDebugFxStyle = showDebugCollisionFxRef.current ? 'logic-event-pulse-v1' : 'off'
      }

      const playerObject = playerRef.current
      const overrideLevel = downOverrideLevel(axisDisplayOverrideRef.current)
      const actualLevel = momentumLevel(Math.hypot(visualState.velocity?.x ?? 0, visualState.velocity?.z ?? 0))
      if (playerObject) {
        playerObject.position.set(visualState.position.x, 0.1, visualState.position.z)
        updateMomentumDots(playerObject, overrideLevel ?? actualLevel)
      }

      const spatialMode = host.closest('.cell-world-prototype')?.dataset.spatialMode === 'hybrid' ? 'hybrid' : 'discrete'
      const renderedAxis = updateActorAxisHud(
        axisHudRef.current,
        camera,
        viewportWidth,
        viewportHeight,
        visualState,
        spatialMode,
        axisDisplayOverrideRef.current,
      )
      host.dataset.axisDirection = renderedAxis
      host.dataset.axisQuantization = spatialMode === 'discrete' ? 'hex6' : 'continuous'
      host.dataset.axisDisplayOverride = axisDisplayOverrideRef.current
      host.dataset.visualX = visualState.position.x.toFixed(4)
      host.dataset.visualZ = visualState.position.z.toFixed(4)
      host.dataset.visualMomentum = String(overrideLevel ?? actualLevel)
      host.dataset.atVisualMs = String(atVisualMsRef.current)

      const finalActorById = new Map((activePlayback?.finalState?.actors ?? []).map((actor) => [actor.id, actor]))
      const targetHudIds = new Set()
      for (const actor of actorsRef.current) {
        const object = dummyObjectsRef.current.get(actor.id)
        if (!object) continue
        let position = axialToWorld(actor.hex)
        let y = 0.1
        let actorProgress = 0
        if (activePlayback) {
          const points = playbackCacheRef.current.actorPoints.get(actor.id)
          if (points?.length > 1) {
            const window = activePlayback.actorPlaybackWindows?.[actor.id]
            actorProgress = window
              ? clamp((progress - window.start) / Math.max(0.02, window.end - window.start), 0, 1)
              : progress
            const animated = samplePoint(points, actorProgress)
            if (animated) position = { x: animated.x, z: animated.z }
            if (actorProgress > 0 && actorProgress < 1) y += Math.sin(actorProgress * Math.PI) * 0.34
          }
        }
        object.position.set(position.x, y, position.z)

        const finalActor = finalActorById.get(actor.id)
        const displayActor = activePlayback && actorProgress > 0.01 && finalActor ? finalActor : actor
        const displayM = Number.isFinite(displayActor?.momentumLevel)
          ? Math.max(0, Math.round(displayActor.momentumLevel))
          : momentumLevel(Math.hypot(displayActor?.velocity?.x ?? 0, displayActor?.velocity?.z ?? 0))
        const displayAxis = displayActor?.axisId ?? nearestAxisId(displayActor?.velocity)
        updateMomentumDots(object, displayM)
        updateTargetAxisHud(axisHudRef.current, camera, viewportWidth, viewportHeight, actor.id, position, y, displayAxis, displayM)
        targetHudIds.add(actor.id)
      }
      axisHudRef.current?.pruneTargets(targetHudIds)
      host.dataset.targetHudActorCount = String(targetHudIds.size)

      renderer.render(scene, camera)
      frame = requestAnimationFrame(render)
    }
    render()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('pointermove', pointerMove)
      renderer.domElement.removeEventListener('pointerup', pointerUp)
      renderer.domElement.removeEventListener('pointercancel', pointerUp)
      renderer.domElement.removeEventListener('pointerleave', pointerLeave)
      renderer.domElement.removeEventListener('wheel', wheel)
      renderer.domElement.removeEventListener('auxclick', preventMiddleAuxClick)
      disposeObject(boardGroup)
      disposeObject(interaction)
      disposeObject(dummyGroup)
      clearCollisionDebugFx(collisionFxGroup)
      disposeObject(collisionFxGroup)
      disposeObject(player)
      renderer.dispose()
      host.replaceChildren()
    }
  }, [boardRadius])

  useEffect(() => {
    const boardGroup = boardGroupRef.current
    const host = hostRef.current
    if (!boardGroup) return
    for (const child of [...boardGroup.children]) {
      boardGroup.remove(child)
      disposeObject(child)
    }

    const floorSize = (boardRadius * 2 + 3) * 1.08
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorSize * 1.3, floorSize),
      new THREE.MeshStandardMaterial({ color: 0x223b55, roughness: 0.96 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.46
    floor.receiveShadow = true
    boardGroup.add(floor)

    for (const cell of cells) {
      const center = axialToWorld(cell)
      const tile = new THREE.Mesh(
        new THREE.CylinderGeometry(HEX_RADIUS * 0.97, HEX_RADIUS * 0.97, TILE_HEIGHT, 6),
        new THREE.MeshStandardMaterial({
          color: groundColor(cell, showThermal),
          roughness: cell.moisture === 2 ? 0.36 : 0.76,
          metalness: cell.groundFill === 'ice' ? 0.12 : 0.01,
          flatShading: true,
        }),
      )
      tile.position.set(center.x, cell.groundFill === 'water' ? -0.04 : 0, center.z)
      tile.receiveShadow = true
      boardGroup.add(tile)

      const outlinePoints = Array.from({ length: 6 }, (_, index) => {
        const angle = Math.PI * 0.5 - index * Math.PI / 3
        return new THREE.Vector3(Math.cos(angle) * HEX_RADIUS * 0.955, TILE_HEIGHT * 0.5 + 0.006, Math.sin(angle) * HEX_RADIUS * 0.955)
      })
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(outlinePoints),
        new THREE.LineBasicMaterial({ color: 0xb3c8d5, transparent: true, opacity: 0.19, depthWrite: false }),
      )
      tile.add(outline)

      if (cell.groundFill === 'water' || cell.groundFill === 'ice') {
        const overlay = new THREE.Mesh(
          new THREE.CylinderGeometry(HEX_RADIUS * 0.86, HEX_RADIUS * 0.86, 0.012, 6),
          new THREE.MeshBasicMaterial({
            color: cell.groundFill === 'ice' ? 0xc0edf3 : 0x71bdd3,
            transparent: true,
            opacity: cell.groundFill === 'ice' ? 0.4 : 0.28,
            depthWrite: false,
          }),
        )
        overlay.position.set(center.x, 0.105, center.z)
        boardGroup.add(overlay)
      }

      if (cell.tags?.includes('Mountain')) {
        const mountain = new THREE.Mesh(
          new THREE.ConeGeometry(0.34, 0.84, 6),
          new THREE.MeshStandardMaterial({ color: 0x707b84, roughness: 0.92, flatShading: true }),
        )
        mountain.position.set(center.x, 0.48, center.z)
        mountain.castShadow = true
        boardGroup.add(mountain)
      }

      if (showWeather && cell.rain) {
        for (let index = 0; index < 3; index += 1) {
          const drop = new THREE.Mesh(
            new THREE.CylinderGeometry(0.009, 0.009, 0.34, 5),
            new THREE.MeshBasicMaterial({ color: 0x84d7e8, transparent: true, opacity: 0.55 }),
          )
          drop.position.set(center.x - 0.2 + index * 0.18, 0.72 + index * 0.08, center.z)
          boardGroup.add(drop)
        }
      }
    }

    let authoredWall = null
    for (const obstacle of obstacles) {
      const center = axialToWorld(obstacle.hex)
      const mesh = createObstacleMesh(obstacle)
      mesh.position.x = center.x
      mesh.position.z = center.z
      boardGroup.add(mesh)
      if (!authoredWall && obstacle.wallAxis) authoredWall = { obstacle, mesh }
    }
    if (host) {
      host.dataset.hardWallAxis = authoredWall?.obstacle?.wallAxis ?? 'none'
      host.dataset.hardWallYaw = authoredWall ? authoredWall.mesh.rotation.y.toFixed(6) : '0'
    }
  }, [cells, obstacles, boardRadius, showThermal, showWeather])

  useEffect(() => {
    const group = dummyGroupRef.current
    if (!group) return
    for (const child of [...group.children]) {
      group.remove(child)
      disposeObject(child)
    }
    dummyObjectsRef.current = new Map()
    for (const actor of actors) {
      const object = createDummyActor()
      const center = axialToWorld(actor.hex)
      const level = Number.isFinite(actor?.momentumLevel)
        ? Math.max(0, Math.round(actor.momentumLevel))
        : momentumLevel(Math.hypot(actor?.velocity?.x ?? 0, actor?.velocity?.z ?? 0))
      object.position.set(center.x, 0.1, center.z)
      updateMomentumDots(object, level)
      group.add(object)
      dummyObjectsRef.current.set(actor.id, object)
    }
  }, [actors])

  useEffect(() => {
    const scene = sceneRef.current
    const host = hostRef.current
    if (!scene || !host) return
    if (previewGroupRef.current) {
      scene.remove(previewGroupRef.current)
      disposeObject(previewGroupRef.current)
      previewGroupRef.current = null
    }

    host.dataset.previewVisibleLength = '0'
    host.dataset.knockbackPathCount = '0'
    host.dataset.previewPathMode = 'smooth'
    if (!previewPlan?.valid || previewPlan.samples?.length < 2) return

    const group = new THREE.Group()
    const playerPoints = planPathPoints(previewPlan, 0.27)
    const playerPath = createDashedPath(playerPoints, PLAYER_PATH_BLUE)
    if (playerPath) {
      group.add(playerPath)
      let length = 0
      for (let index = 1; index < playerPoints.length; index += 1) length += playerPoints[index - 1].distanceTo(playerPoints[index])
      host.dataset.previewVisibleLength = length.toFixed(3)
    }

    const wallActors = wallPivotActorIds(previewPlan.conflictEvents ?? [])
    const actorPolylineIds = new Set(previewPlan.actorTrajectoryPolylineIds ?? [])
    const wallPolyline = playerUsesWallPivot(previewPlan) || wallActors.size > 0 || actorPolylineIds.size > 0
    host.dataset.previewPathMode = wallPolyline ? WALL_REFLECTION_PATH_CONTRACT : 'smooth'

    let knockbackCount = 0
    for (const [id, path] of Object.entries(previewPlan.actorTrajectories ?? {})) {
      if (!path || path.length < 2) continue
      const points = trajectoryPathPoints(path, 0.34, wallActors.has(id) || actorPolylineIds.has(id))
      const line = createDashedPath(points, DUMMY_YELLOW, 1)
      if (line) {
        group.add(line)
        knockbackCount += 1
      }
    }
    host.dataset.knockbackPathCount = String(knockbackCount)
    scene.add(group)
    previewGroupRef.current = group
  }, [previewPlan])

  useEffect(() => {
    const layer = interactionRef.current
    if (!layer) return
    for (const child of [...layer.children]) {
      layer.remove(child)
      disposeObject(child)
    }

    for (const entry of reachableCells) {
      const hex = entry.hex ?? entry.finalHex ?? entry.targetHex ?? entry
      if (!hex) continue
      const center = axialToWorld(hex)
      const marker = createReachableHighlight()
      marker.position.x = center.x
      marker.position.z = center.z
      layer.add(marker)
    }

    if (selectedAimHex) {
      const center = axialToWorld(selectedAimHex)
      const selected = createRingMarker(0xf2cc68, 0.39)
      selected.position.x = center.x
      selected.position.z = center.z
      layer.add(selected)
    }
    if (hoverHex) {
      const center = axialToWorld(hoverHex)
      const hover = createRingMarker(previewPlan?.valid ? 0xe8fbff : 0xef7878, 0.46)
      hover.position.x = center.x
      hover.position.z = center.z
      layer.add(hover)
    }
  }, [reachableCells, hoverHex?.q, hoverHex?.r, selectedAimHex?.q, selectedAimHex?.r, previewPlan?.valid])

  useEffect(() => {
    const camera = cameraRef.current
    const host = hostRef.current
    if (!camera) return
    orbitRef.current = { ...DEFAULT_CAMERA }
    viewModeRef.current = viewMode
    if (viewMode === 'top') {
      camera.position.set(DEFAULT_CAMERA.targetX, 18, DEFAULT_CAMERA.targetZ + 0.01)
      camera.lookAt(DEFAULT_CAMERA.targetX, 0, DEFAULT_CAMERA.targetZ)
    } else {
      const radius = 17
      const horizontal = Math.cos(DEFAULT_CAMERA.pitch) * radius
      camera.position.set(
        DEFAULT_CAMERA.targetX + Math.sin(DEFAULT_CAMERA.yaw) * horizontal,
        Math.sin(DEFAULT_CAMERA.pitch) * radius,
        DEFAULT_CAMERA.targetZ + Math.cos(DEFAULT_CAMERA.yaw) * horizontal,
      )
      camera.lookAt(DEFAULT_CAMERA.targetX, 0.2, DEFAULT_CAMERA.targetZ)
    }
    camera.zoom = DEFAULT_CAMERA.zoom
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    if (host) {
      host.dataset.cameraZoom = camera.zoom.toFixed(4)
      host.dataset.cameraTargetX = DEFAULT_CAMERA.targetX.toFixed(4)
      host.dataset.cameraTargetZ = DEFAULT_CAMERA.targetZ.toFixed(4)
    }
  }, [viewMode, cameraResetToken])

  return <div className="continuous-board-host cell-world-board" ref={hostRef} aria-label="ProjectC Cell World Hex6 board" />
}
