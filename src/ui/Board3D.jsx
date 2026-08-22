import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { AT_VISUAL_MS, momentumLevel, playbackElapsedMs } from '../sim/solver.js'
import { HEX_RADIUS, axialDistance, axialToWorld, directionVector, worldToAxial } from '../sim/hex.js'

const TILE_HEIGHT = 0.18
const AXIS_HUD_LENGTH_PX = 42
const AXIS_HUD_STROKE_PX = 2.5
const PREVIEW_MAX_LENGTH = 1.55
const PREVIEW_DASH_LENGTH = 0.18
const PREVIEW_GAP_LENGTH = 0.10
const PREVIEW_RADIUS = 0.022
const PREVIEW_STEPS = 32
const DEFAULT_CAMERA = { yaw: Math.PI * 0.25, pitch: 0.74, zoom: 1 }
const TEMP_COLORS = [0x527ee0, 0x66a9df, 0x68c6c8, 0xa9bd95, 0xe3c45a, 0xe5945e, 0xe36c60]
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const SVG_NS = 'http://www.w3.org/2000/svg'

function disposeObject(object) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line)) return
    child.geometry?.dispose()
    const material = child.material
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
    else material?.dispose()
  })
}

function createActor() {
  const group = new THREE.Group()
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.36, 0.12, 18),
    new THREE.MeshStandardMaterial({ color: 0xeadbb8, roughness: 0.55 }),
  )
  base.position.y = 0.08
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.21, 0.28, 0.58, 14),
    new THREE.MeshStandardMaterial({ color: 0x58aed2, roughness: 0.48, metalness: 0.04 }),
  )
  body.position.y = 0.42
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0x58aed2, roughness: 0.48 }),
  )
  head.position.y = 0.78
  const sword = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.48, 0.09),
    new THREE.MeshStandardMaterial({ color: 0xe8edf1, metalness: 0.75, roughness: 0.2 }),
  )
  sword.position.set(0.3, 0.53, 0)
  sword.rotation.z = -0.35
  group.add(base, body, head, sword)

  const momentumDots = []
  for (let index = 0; index < 3; index += 1) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x334151, transparent: true, opacity: 0.55 }),
    )
    dot.position.set((index - 1) * 0.15, 1.08, 0)
    dot.renderOrder = 28
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
    if (!(dot.material instanceof THREE.MeshBasicMaterial)) return
    const active = index < level
    dot.material.color.setHex(active ? 0xcf82e3 : 0x334151)
    dot.material.opacity = active ? 1 : 0.5
  })
}

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag)
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)))
  return element
}

function createAxisHud() {
  const svg = svgElement('svg', {
    class: 'legacy-axis-hud',
    'aria-label': 'Legacy Spatial Axis indicator',
  })
  Object.assign(svg.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    zIndex: '18',
    pointerEvents: 'none',
    overflow: 'visible',
  })

  const defs = svgElement('defs')
  const marker = svgElement('marker', {
    id: 'projectc-axis-arrow-head',
    viewBox: '0 0 10 10',
    refX: '8',
    refY: '5',
    markerWidth: '5.2',
    markerHeight: '5.2',
    orient: 'auto-start-reverse',
  })
  marker.appendChild(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#f2c85a' }))
  defs.appendChild(marker)
  svg.appendChild(defs)

  const horizontal = svgElement('g', { 'data-axis-hud-kind': 'horizontal' })
  const horizontalLine = svgElement('line', {
    stroke: '#f2c85a',
    'stroke-width': AXIS_HUD_STROKE_PX,
    'stroke-linecap': 'round',
    'marker-end': 'url(#projectc-axis-arrow-head)',
  })
  horizontalLine.style.filter = 'drop-shadow(0 0 3px rgba(242,200,90,.66))'
  horizontal.appendChild(horizontalLine)
  svg.appendChild(horizontal)

  const down = svgElement('g', { 'data-axis-hud-kind': 'down' })
  down.appendChild(svgElement('circle', {
    cx: '0', cy: '10', r: '9',
    fill: 'rgba(90,190,235,.12)', stroke: '#7ed8ff', 'stroke-width': '2',
  }))
  down.appendChild(svgElement('path', {
    d: 'M 0 4 L 0 15 M -4 11 L 0 15 L 4 11',
    fill: 'none', stroke: '#7ed8ff', 'stroke-width': '2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }))
  const downText = svgElement('text', {
    x: '12', y: '14', fill: '#bdeeff', 'font-size': '9', 'font-weight': '700',
  })
  downText.style.paintOrder = 'stroke'
  downText.style.stroke = '#111923'
  downText.style.strokeWidth = '3px'
  down.appendChild(downText)
  svg.appendChild(down)

  const m0 = svgElement('g', { 'data-axis-hud-kind': 'm0' })
  m0.appendChild(svgElement('circle', {
    cx: '0', cy: '7', r: '6.5', fill: 'rgba(194,207,220,.08)',
    stroke: '#aebcc9', 'stroke-width': '1.8',
  }))
  const m0Text = svgElement('text', {
    x: '10', y: '10', fill: '#c8d2dc', 'font-size': '9', 'font-weight': '700',
  })
  m0Text.textContent = 'M0'
  m0Text.style.paintOrder = 'stroke'
  m0Text.style.stroke = '#111923'
  m0Text.style.strokeWidth = '3px'
  m0.appendChild(m0Text)
  svg.appendChild(m0)

  horizontal.style.display = 'none'
  down.style.display = 'none'
  m0.style.display = 'none'
  return { svg, horizontal, horizontalLine, down, downText, m0 }
}

function projectedPoint(point, camera, width, height) {
  const projected = point.clone().project(camera)
  return {
    x: (projected.x + 1) * 0.5 * width,
    y: (1 - projected.y) * 0.5 * height,
  }
}

function axisDisplayFor(override, level) {
  if (override === 'm0') return { kind: 'm0', level: 0 }
  if (override?.startsWith('down-')) {
    return { kind: 'down', level: clamp(Number(override.split('-')[1]) || 1, 1, 3) }
  }
  return level > 0 ? { kind: 'horizontal', level } : { kind: 'm0', level: 0 }
}

function updateAxisHud(hud, camera, width, height, visualState, display) {
  hud.horizontal.style.display = display.kind === 'horizontal' ? '' : 'none'
  hud.down.style.display = display.kind === 'down' ? '' : 'none'
  hud.m0.style.display = display.kind === 'm0' ? '' : 'none'

  const sourceWorld = new THREE.Vector3(visualState.position.x, 1.22, visualState.position.z)
  const source = projectedPoint(sourceWorld, camera, width, height)

  if (display.kind === 'horizontal') {
    const speed = Math.hypot(visualState.velocity.x, visualState.velocity.z)
    if (speed < 0.02) {
      hud.horizontal.style.display = 'none'
      hud.m0.style.display = ''
      hud.m0.setAttribute('transform', `translate(${source.x.toFixed(2)} ${source.y.toFixed(2)})`)
      return 'm0'
    }
    const direction = { x: visualState.velocity.x / speed, z: visualState.velocity.z / speed }
    const targetWorld = sourceWorld.clone().add(new THREE.Vector3(direction.x, 0, direction.z))
    const target = projectedPoint(targetWorld, camera, width, height)
    const dx = target.x - source.x
    const dy = target.y - source.y
    const screenLength = Math.max(1, Math.hypot(dx, dy))
    const ux = dx / screenLength
    const uy = dy / screenLength
    const startOffset = 8
    hud.horizontalLine.setAttribute('x1', (source.x + ux * startOffset).toFixed(2))
    hud.horizontalLine.setAttribute('y1', (source.y + uy * startOffset).toFixed(2))
    hud.horizontalLine.setAttribute('x2', (source.x + ux * AXIS_HUD_LENGTH_PX).toFixed(2))
    hud.horizontalLine.setAttribute('y2', (source.y + uy * AXIS_HUD_LENGTH_PX).toFixed(2))
    return 'horizontal'
  }

  if (display.kind === 'down') {
    hud.down.setAttribute('transform', `translate(${source.x.toFixed(2)} ${source.y.toFixed(2)})`)
    hud.downText.textContent = `Down · M${display.level}`
    return 'down'
  }

  hud.m0.setAttribute('transform', `translate(${source.x.toFixed(2)} ${source.y.toFixed(2)})`)
  return 'm0'
}

function sampleAt(samples, progress) {
  if (!samples?.length) return null
  const normalized = clamp(progress, 0, 1)
  if (normalized >= 1) return samples.at(-1)
  const scaled = normalized * (samples.length - 1)
  const index = Math.min(samples.length - 2, Math.floor(scaled))
  const local = scaled - index
  const a = samples[index]
  const b = samples[index + 1]
  return {
    position: {
      x: a.position.x + (b.position.x - a.position.x) * local,
      z: a.position.z + (b.position.z - a.position.z) * local,
    },
    velocity: {
      x: a.velocity.x + (b.velocity.x - a.velocity.x) * local,
      z: a.velocity.z + (b.velocity.z - a.velocity.z) * local,
    },
  }
}

function cellColor(cell, showThermal) {
  const base = cell.tags.includes('Mountain')
    ? new THREE.Color(0x69747f)
    : cell.groundFill === 'grass'
      ? new THREE.Color(0x6e9b64)
      : cell.groundFill === 'water'
        ? new THREE.Color(0x5595b9)
        : cell.groundFill === 'ice'
          ? new THREE.Color(0xa7dce8)
          : cell.groundFill === 'fire'
            ? new THREE.Color(0xc97862)
            : new THREE.Color(0x998b72)
  if (!showThermal) return base
  const normalized = clamp(cell.groundTemp, -3, 3) + 3
  return base.lerp(
    new THREE.Color(TEMP_COLORS[normalized]),
    cell.groundTemp === 0 ? 0.05 : 0.20 + Math.abs(cell.groundTemp) * 0.09,
  )
}

function createHexOverlay(color, opacity, height, radius = HEX_RADIUS * 0.86) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.018, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  )
  mesh.position.y = height
  mesh.renderOrder = 30
  return mesh
}

function createTargetReticle(color, height) {
  const group = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.98, depthWrite: false, depthTest: false })
  const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x172434, transparent: true, opacity: 0.76, depthWrite: false, depthTest: false })
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

function createMountain(cell) {
  const group = new THREE.Group()
  const ridge = cell.tags.includes('Ridge')
  const rock = new THREE.MeshStandardMaterial({ color: ridge ? 0x626f7a : 0x75828c, roughness: 0.94, metalness: 0.02, flatShading: true })
  const snow = new THREE.MeshStandardMaterial({ color: 0xd8e4e6, roughness: 0.86, flatShading: true })
  const seed = Math.abs(cell.q * 17 + cell.r * 31) % 7
  const peaks = ridge
    ? [[-0.16, -0.08, 0.3, 0.74], [0.15, 0.1, 0.25, 0.62]]
    : [[-0.08, 0, 0.34, 0.88], [0.21, 0.1, 0.22, 0.52]]
  for (const [x, z, radius, height] of peaks) {
    const peak = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 6), rock)
    peak.position.set(x + (seed - 3) * 0.008, height * 0.5 + 0.1, z)
    peak.rotation.y = seed * 0.21
    peak.castShadow = true
    group.add(peak)
    const cap = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.48, height * 0.28, 6), snow)
    cap.position.set(peak.position.x, peak.position.y + height * 0.36, z)
    cap.rotation.y = peak.rotation.y
    cap.castShadow = true
    group.add(cap)
  }
  return group
}

function createCloud(cell, bobAnimations) {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({
    color: cell.skyTemp > 0 ? 0xffd9bf : cell.skyTemp < 0 ? 0xd4ebff : 0xefefe3,
    roughness: 0.92,
    transparent: true,
    opacity: 0.84,
    depthWrite: false,
  })
  for (const [x, y, z, radius] of [[-0.22, 0, 0, 0.25], [0.05, 0.1, 0, 0.34], [0.3, 0, 0.02, 0.24], [0, -0.02, 0.2, 0.26]]) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material)
    sphere.position.set(x, y, z)
    sphere.castShadow = true
    group.add(sphere)
  }
  group.position.y = 2.12
  bobAnimations.push({ object: group, baseY: 2.12, phase: cell.q * 1.37 + cell.r * 2.11, amplitude: 0.07, speed: 1.1 })
  return group
}

function createWindArrow(directionId) {
  const group = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: 0xa8e3f2, transparent: true, opacity: 0.88 })
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.48, 7), material)
  shaft.rotation.z = Math.PI / 2
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 8), material)
  head.rotation.z = -Math.PI / 2
  head.position.x = 0.34
  group.add(shaft, head)
  const direction = directionVector(directionId)
  group.rotation.y = -Math.atan2(direction.z, direction.x)
  group.position.y = 1.35
  return group
}

function createMomentumSurface(cell) {
  const group = new THREE.Group()
  const hard = cell.tags.includes('UT3Hard')
  const left = cell.tags.includes('UT3ReflectLeft')
  const color = hard ? 0x717e8a : left ? 0x55c4ce : 0xe7a84f
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(hard ? 0.78 : 0.62, hard ? 1.05 : 0.78, hard ? 0.2 : 0.12),
    new THREE.MeshStandardMaterial({
      color,
      emissive: hard ? 0x17202a : left ? 0x17444a : 0x4c351b,
      emissiveIntensity: 0.44,
      metalness: hard ? 0.35 : 0.55,
      roughness: hard ? 0.72 : 0.32,
      transparent: !hard,
      opacity: hard ? 1 : 0.84,
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

function firstPathDirection(samples) {
  for (let index = 1; index < samples.length; index += 1) {
    const dx = samples[index].position.x - samples[index - 1].position.x
    const dz = samples[index].position.z - samples[index - 1].position.z
    const distance = Math.hypot(dx, dz)
    if (distance > 0.001) return { x: dx / distance, z: dz / distance }
  }
  return null
}

function lastPathDirection(samples) {
  for (let index = samples.length - 1; index > 0; index -= 1) {
    const dx = samples[index].position.x - samples[index - 1].position.x
    const dz = samples[index].position.z - samples[index - 1].position.z
    const distance = Math.hypot(dx, dz)
    if (distance > 0.001) return { x: dx / distance, z: dz / distance }
  }
  return null
}

function shortestAngleDelta(from, to) {
  let delta = to - from
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

function smoothStep(value) {
  return value * value * (3 - 2 * value)
}

function steeringGuideSamples(state, plan) {
  if (!plan?.samples?.length) return []
  const pathStart = firstPathDirection(plan.samples)
  const pathEnd = lastPathDirection(plan.samples) ?? pathStart
  const stateSpeed = Math.hypot(state.velocity.x, state.velocity.z)
  const startDirection = stateSpeed > 0.02
    ? { x: state.velocity.x / stateSpeed, z: state.velocity.z / stateSpeed }
    : pathStart
  const endDirection = pathEnd ?? startDirection
  if (!startDirection || !endDirection) return plan.samples

  const startAngle = Math.atan2(startDirection.z, startDirection.x)
  const endAngle = Math.atan2(endDirection.z, endDirection.x)
  const delta = shortestAngleDelta(startAngle, endAngle)
  const stepDistance = PREVIEW_MAX_LENGTH / (PREVIEW_STEPS - 1)
  const samples = [{ position: { ...state.position } }]
  let position = { ...state.position }
  for (let index = 1; index < PREVIEW_STEPS; index += 1) {
    const progress = index / (PREVIEW_STEPS - 1)
    const angle = startAngle + delta * smoothStep(progress)
    position = {
      x: position.x + Math.cos(angle) * stepDistance,
      z: position.z + Math.sin(angle) * stepDistance,
    }
    samples.push({ position })
  }
  return samples
}

function polylineData(samples) {
  const points = samples.map((sample) => new THREE.Vector3(sample.position.x, 0.22, sample.position.z))
  const cumulative = [0]
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative.at(-1) + points[index].distanceTo(points[index - 1]))
  }
  return { points, cumulative, total: cumulative.at(-1) ?? 0 }
}

function pointAtDistance(points, cumulative, distance) {
  if (!points.length) return new THREE.Vector3()
  if (distance <= 0) return points[0].clone()
  const total = cumulative.at(-1) ?? 0
  if (distance >= total) return points.at(-1).clone()
  let index = 1
  while (index < cumulative.length && cumulative[index] < distance) index += 1
  const previousDistance = cumulative[index - 1]
  const segmentDistance = Math.max(1e-6, cumulative[index] - previousDistance)
  const local = (distance - previousDistance) / segmentDistance
  return points[index - 1].clone().lerp(points[index], local)
}

function createDashedPreview(samples, color) {
  const group = new THREE.Group()
  const { points, cumulative, total } = polylineData(samples)
  const visibleLength = Math.min(total, PREVIEW_MAX_LENGTH)
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.94, depthTest: false, depthWrite: false })
  const yAxis = new THREE.Vector3(0, 1, 0)

  for (let startDistance = 0; startDistance < visibleLength; startDistance += PREVIEW_DASH_LENGTH + PREVIEW_GAP_LENGTH) {
    const endDistance = Math.min(visibleLength, startDistance + PREVIEW_DASH_LENGTH)
    if (endDistance - startDistance < 0.025) break
    const start = pointAtDistance(points, cumulative, startDistance)
    const end = pointAtDistance(points, cumulative, endDistance)
    const direction = end.clone().sub(start)
    const dashLength = direction.length()
    if (dashLength < 0.01) continue
    const dash = new THREE.Mesh(
      new THREE.CylinderGeometry(PREVIEW_RADIUS, PREVIEW_RADIUS, dashLength, 8),
      material.clone(),
    )
    dash.position.copy(start).add(end).multiplyScalar(0.5)
    dash.quaternion.setFromUnitVectors(yAxis, direction.normalize())
    dash.renderOrder = 44
    group.add(dash)
  }
  group.userData.visibleLength = visibleLength
  return group
}

export function Board3D({
  cells,
  obstacles,
  state,
  previewPlan,
  playback,
  atVisualMs,
  axisIndicatorPreview = 'auto',
  boardRadius,
  viewMode,
  cameraResetToken,
  hoverHex,
  selectedAimHex,
  showWeather,
  showThermal,
  onHoverHex,
  onClickHex,
}) {
  const hostRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const boardGroupRef = useRef(null)
  const interactionRef = useRef(null)
  const actorRef = useRef(null)
  const previewRef = useRef(null)
  const axisHudRef = useRef(null)
  const orbitRef = useRef({ ...DEFAULT_CAMERA })
  const stateRef = useRef(state)
  const playbackRef = useRef(playback)
  const atVisualMsRef = useRef(atVisualMs)
  const axisIndicatorPreviewRef = useRef(axisIndicatorPreview)
  const viewModeRef = useRef(viewMode)
  const callbacksRef = useRef({ onHoverHex, onClickHex })
  const bobRef = useRef([])
  const rainRef = useRef([])

  stateRef.current = state
  playbackRef.current = playback
  atVisualMsRef.current = atVisualMs
  axisIndicatorPreviewRef.current = axisIndicatorPreview
  viewModeRef.current = viewMode
  callbacksRef.current = { onHoverHex, onClickHex }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x16283b)
    scene.fog = new THREE.Fog(0x16283b, 12, 27)
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    const axisHud = createAxisHud()
    axisHudRef.current = axisHud
    host.style.position = 'relative'
    host.replaceChildren(renderer.domElement, axisHud.svg)
    renderer.domElement.style.touchAction = 'none'
    host.dataset.axisStyle = 'legacy-hud'
    host.dataset.axisStrokePx = AXIS_HUD_STROKE_PX.toFixed(1)
    host.dataset.axisSupportsDown = 'true'
    host.dataset.axisShowsM0 = 'true'
    host.dataset.previewStyle = 'short-dashed-heading-curve'
    host.dataset.previewLengthMax = PREVIEW_MAX_LENGTH.toFixed(2)

    const camera = new THREE.OrthographicCamera(-7, 7, 5, -5, 0.1, 60)
    scene.add(new THREE.HemisphereLight(0xcbe4ef, 0x415064, 1.8))
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.9)
    sun.position.set(-6, 11, -5)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    scene.add(sun)

    const boardGroup = new THREE.Group()
    const interaction = new THREE.Group()
    const actor = createActor()
    scene.add(boardGroup, interaction, actor)
    sceneRef.current = scene
    cameraRef.current = camera
    boardGroupRef.current = boardGroup
    interactionRef.current = interaction
    actorRef.current = actor

    const updateCamera = () => {
      const orbit = orbitRef.current
      if (viewModeRef.current === 'top') {
        camera.position.set(0, 18, 0.01)
        camera.lookAt(0, 0, 0)
      } else {
        const radius = 17
        const horizontal = Math.cos(orbit.pitch) * radius
        camera.position.set(
          Math.sin(orbit.yaw) * horizontal,
          Math.sin(orbit.pitch) * radius,
          Math.cos(orbit.yaw) * horizontal,
        )
        camera.lookAt(0, 0.2, 0)
      }
      camera.zoom = orbit.zoom
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld()
      host.dataset.cameraZoom = camera.zoom.toFixed(4)
    }

    let viewportWidth = 0
    let viewportHeight = 0
    let pendingResize = null
    const applyResize = (nextWidth, nextHeight) => {
      const width = Math.max(1, Math.round(nextWidth))
      const height = Math.max(1, Math.round(nextHeight))
      if (Math.abs(width - viewportWidth) < 2 && Math.abs(height - viewportHeight) < 2) return
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
      camera.updateMatrixWorld()
      host.dataset.viewportWidth = String(width)
      host.dataset.viewportHeight = String(height)
    }
    const resize = () => {
      const next = { width: host.clientWidth, height: host.clientHeight }
      if (playbackRef.current) {
        pendingResize = next
        return
      }
      applyResize(next.width, next.height)
    }
    applyResize(host.clientWidth, host.clientHeight)
    updateCamera()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const hit = new THREE.Vector3()
    let hoverKey = ''
    const pickHex = (event) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      if (!raycaster.ray.intersectPlane(plane, hit)) return null
      const hex = worldToAxial({ x: hit.x, z: hit.z })
      return axialDistance(hex) <= boardRadius ? hex : null
    }

    const drag = { active: false, moved: false, pointerId: -1, startX: 0, startY: 0, x: 0, y: 0 }
    const pointerDown = (event) => {
      if (event.button !== 0 || playbackRef.current) return
      drag.active = true
      drag.moved = false
      drag.pointerId = event.pointerId
      drag.startX = drag.x = event.clientX
      drag.startY = drag.y = event.clientY
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const pointerMove = (event) => {
      if (drag.active) {
        const dx = event.clientX - drag.x
        const dy = event.clientY - drag.y
        drag.x = event.clientX
        drag.y = event.clientY
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true
        if (viewModeRef.current !== 'top' && !playbackRef.current) {
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
      drag.active = false
      renderer.domElement.releasePointerCapture(event.pointerId)
      if (!moved && !playbackRef.current) {
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

    renderer.domElement.addEventListener('pointerdown', pointerDown)
    renderer.domElement.addEventListener('pointermove', pointerMove)
    renderer.domElement.addEventListener('pointerup', pointerUp)
    renderer.domElement.addEventListener('pointercancel', pointerUp)
    renderer.domElement.addEventListener('pointerleave', pointerLeave)
    renderer.domElement.addEventListener('wheel', wheel, { passive: false })

    let frame = 0
    const render = () => {
      const now = performance.now()
      const seconds = now * 0.001
      for (const item of bobRef.current) item.object.position.y = item.baseY + Math.sin(seconds * item.speed + item.phase) * item.amplitude
      for (const item of rainRef.current) {
        const progress = (seconds * item.speed + item.phase) % 1
        item.object.position.y = item.topY - (item.topY - item.bottomY) * progress
        item.material.opacity = 0.22 + Math.sin(progress * Math.PI) * 0.55
      }

      let visualState = stateRef.current
      const activePlayback = playbackRef.current
      if (activePlayback) {
        const durationMs = activePlayback.durationMs ?? atVisualMsRef.current ?? AT_VISUAL_MS
        const progress = clamp(playbackElapsedMs(activePlayback, now) / Math.max(1, durationMs), 0, 1)
        const sampled = sampleAt(activePlayback.samples, progress)
        if (sampled) visualState = { ...stateRef.current, position: sampled.position, velocity: sampled.velocity }
        host.dataset.playbackProgress = progress.toFixed(3)
        host.dataset.playbackId = String(activePlayback.id)
        host.dataset.playbackDurationMs = String(durationMs)
      } else {
        host.dataset.playbackProgress = '0'
        delete host.dataset.playbackId
        delete host.dataset.playbackDurationMs
        if (pendingResize) {
          const next = pendingResize
          pendingResize = null
          applyResize(next.width, next.height)
        }
      }

      const actorObject = actorRef.current
      const speed = Math.hypot(visualState.velocity.x, visualState.velocity.z)
      const actualLevel = momentumLevel(speed)
      const axisDisplay = axisDisplayFor(axisIndicatorPreviewRef.current, actualLevel)
      if (actorObject) {
        actorObject.position.set(visualState.position.x, 0.1, visualState.position.z)
        updateMomentumDots(actorObject, axisDisplay.level)
      }

      const renderedAxis = updateAxisHud(axisHud, camera, viewportWidth, viewportHeight, visualState, axisDisplay)
      host.dataset.axisState = renderedAxis
      host.dataset.axisDisplayLevel = String(axisDisplay.level)
      host.dataset.visualX = visualState.position.x.toFixed(4)
      host.dataset.visualZ = visualState.position.z.toFixed(4)
      host.dataset.visualMomentum = String(actualLevel)
      host.dataset.cameraZoom = camera.zoom.toFixed(4)
      host.dataset.atVisualMs = String(atVisualMsRef.current)
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
      disposeObject(boardGroup)
      disposeObject(interaction)
      disposeObject(actor)
      renderer.dispose()
      host.replaceChildren()
    }
  }, [])

  useEffect(() => {
    const boardGroup = boardGroupRef.current
    if (!boardGroup) return
    for (const child of [...boardGroup.children]) {
      boardGroup.remove(child)
      disposeObject(child)
    }
    bobRef.current = []
    rainRef.current = []

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
          color: cellColor(cell, showThermal),
          roughness: cell.moisture === 2 ? 0.34 : cell.moisture === 0 ? 0.86 : 0.64,
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
        new THREE.LineBasicMaterial({
          color: TEMP_COLORS[clamp(cell.groundTemp, -3, 3) + 3],
          transparent: true,
          opacity: showThermal ? 0.38 : 0.18,
          depthWrite: false,
        }),
      )
      tile.add(outline)

      if (cell.groundFill === 'grass') {
        const material = new THREE.MeshStandardMaterial({ color: 0x8eb65f, roughness: 0.9 })
        for (let index = 0; index < 3; index += 1) {
          const blade = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.27 + index * 0.03, 5), material)
          blade.position.set(center.x - 0.2 + index * 0.19, 0.19, center.z + (index % 2 ? 0.13 : -0.1))
          blade.castShadow = true
          boardGroup.add(blade)
        }
      }
      if (cell.groundFill === 'water') {
        const water = createHexOverlay(0x71bdd3, 0.42, 0.058, HEX_RADIUS * 0.86)
        water.position.x = center.x
        water.position.z = center.z
        boardGroup.add(water)
      }
      if (cell.groundFill === 'ice') {
        const ice = createHexOverlay(0xc1eaf0, 0.54, 0.105, HEX_RADIUS * 0.87)
        ice.position.x = center.x
        ice.position.z = center.z
        boardGroup.add(ice)
      }
      if (cell.groundFill === 'fire') {
        for (let index = 0; index < 3; index += 1) {
          const flame = new THREE.Mesh(
            new THREE.ConeGeometry(0.1, 0.42, 9),
            new THREE.MeshBasicMaterial({ color: index === 1 ? 0xf4cf62 : 0xee7f5d, transparent: true, opacity: 0.9 }),
          )
          flame.position.set(center.x + (index - 1) * 0.16, 0.29, center.z + (index === 1 ? 0.04 : -0.05))
          boardGroup.add(flame)
          bobRef.current.push({ object: flame, baseY: 0.29, phase: index * 1.7, amplitude: 0.06, speed: 5 + index })
        }
      }
      if (cell.moisture === 2 && cell.groundFill !== 'water') {
        const puddle = createHexOverlay(0x67acc3, 0.24, 0.11, 0.27)
        puddle.position.set(center.x + 0.13, 0.11, center.z - 0.1)
        boardGroup.add(puddle)
      }
      if (cell.tags.includes('Mountain')) {
        const mountain = createMountain(cell)
        mountain.position.set(center.x, 0.08, center.z)
        boardGroup.add(mountain)
      }
      if (cell.tags.includes('Shelter')) {
        const beacon = new THREE.Group()
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.48, 12), new THREE.MeshStandardMaterial({ color: 0xd8bf88, roughness: 0.75 }))
        pillar.position.y = 0.28
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshBasicMaterial({ color: 0xf4cf62 }))
        glow.position.y = 0.62
        beacon.add(pillar, glow)
        beacon.position.set(center.x, 0.08, center.z)
        boardGroup.add(beacon)
      }
      if (cell.tags.some((tag) => tag.startsWith('UT3'))) {
        const surface = createMomentumSurface(cell)
        surface.position.set(center.x, 0.05, center.z)
        boardGroup.add(surface)
      }

      if (showWeather && cell.skyFill === 'cloud') {
        const cloud = createCloud(cell, bobRef.current)
        cloud.position.x = center.x
        cloud.position.z = center.z
        boardGroup.add(cloud)
        const shadow = createHexOverlay(0x3b5a76, 0.18, 0.12, 0.38)
        shadow.position.x = center.x
        shadow.position.z = center.z
        boardGroup.add(shadow)
      }
      if (showWeather && cell.wind) {
        const wind = createWindArrow(cell.wind)
        wind.position.x = center.x
        wind.position.z = center.z
        boardGroup.add(wind)
        bobRef.current.push({ object: wind, baseY: 1.35, phase: cell.q + cell.r, amplitude: 0.04, speed: 2.2 })
      }
      if (showWeather && cell.rain) {
        for (let index = 0; index < 7; index += 1) {
          const material = new THREE.MeshBasicMaterial({ color: 0x79d1e5, transparent: true, opacity: 0.68, depthWrite: false })
          const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.34, 5), material)
          const topY = 2.02 + (index % 3) * 0.16
          const bottomY = 0.16
          drop.position.set(center.x - 0.3 + (index % 4) * 0.19, topY, center.z - 0.2 + Math.floor(index / 4) * 0.3)
          boardGroup.add(drop)
          rainRef.current.push({ object: drop, material, topY, bottomY, phase: index / 7, speed: 0.72 + (index % 2) * 0.12 })
        }
      }
    }
  }, [cells, obstacles, boardRadius, showWeather, showThermal])

  useEffect(() => {
    const scene = sceneRef.current
    const host = hostRef.current
    if (!scene || !host) return
    if (previewRef.current) {
      scene.remove(previewRef.current)
      disposeObject(previewRef.current)
      previewRef.current = null
    }
    host.dataset.previewVisibleLength = '0'
    host.dataset.previewTurnDeg = '0'
    if (!previewPlan?.valid || previewPlan.samples.length < 2) return

    const guideSamples = steeringGuideSamples(state, previewPlan)
    const first = firstPathDirection(guideSamples)
    const last = lastPathDirection(guideSamples)
    if (first && last) {
      const startAngle = Math.atan2(first.z, first.x)
      const endAngle = Math.atan2(last.z, last.x)
      host.dataset.previewTurnDeg = (shortestAngleDelta(startAngle, endAngle) * 180 / Math.PI).toFixed(1)
    }

    const color = previewPlan.collisions.length
      ? 0xef8c59
      : previewPlan.spatialMode === 'discrete'
        ? 0xf0c84f
        : 0x65cce2
    const preview = createDashedPreview(guideSamples, color)
    scene.add(preview)
    previewRef.current = preview
    host.dataset.previewVisibleLength = Number(preview.userData.visibleLength ?? 0).toFixed(3)
  }, [previewPlan, state.position.x, state.position.z, state.velocity.x, state.velocity.z])

  useEffect(() => {
    const layer = interactionRef.current
    if (!layer) return
    for (const child of [...layer.children]) {
      layer.remove(child)
      disposeObject(child)
    }
    if (selectedAimHex) {
      const center = axialToWorld(selectedAimHex)
      const selected = createHexOverlay(0xf2cc68, 0.24, 0.14)
      selected.position.x = center.x
      selected.position.z = center.z
      layer.add(selected)
    }
    if (hoverHex) {
      const center = axialToWorld(hoverHex)
      const reticle = createTargetReticle(previewPlan?.valid ? 0xf0c84f : 0xed7373, 0.18)
      reticle.position.x = center.x
      reticle.position.z = center.z
      layer.add(reticle)
    }
  }, [hoverHex?.q, hoverHex?.r, selectedAimHex?.q, selectedAimHex?.r, previewPlan?.valid])

  useEffect(() => {
    const camera = cameraRef.current
    const host = hostRef.current
    if (!camera) return
    orbitRef.current = { ...DEFAULT_CAMERA }
    viewModeRef.current = viewMode
    if (viewMode === 'top') {
      camera.position.set(0, 18, 0.01)
      camera.lookAt(0, 0, 0)
    } else {
      const radius = 17
      const horizontal = Math.cos(DEFAULT_CAMERA.pitch) * radius
      camera.position.set(
        Math.sin(DEFAULT_CAMERA.yaw) * horizontal,
        Math.sin(DEFAULT_CAMERA.pitch) * radius,
        Math.cos(DEFAULT_CAMERA.yaw) * horizontal,
      )
      camera.lookAt(0, 0.2, 0)
    }
    camera.zoom = DEFAULT_CAMERA.zoom
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    if (host) host.dataset.cameraZoom = camera.zoom.toFixed(4)
  }, [viewMode, cameraResetToken])

  return <div className="continuous-board-host cell-world-board" ref={hostRef} aria-label="ProjectC Cell World Hex6 board" />
}
