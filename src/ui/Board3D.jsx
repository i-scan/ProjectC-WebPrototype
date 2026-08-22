import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { AT_VISUAL_MS, playbackElapsedMs } from '../sim/solver.js'
import { HEX_RADIUS, axialDistance, axialToWorld, directionVector, worldToAxial } from '../sim/hex.js'

const TILE_HEIGHT = 0.15
const DEFAULT_CAMERA = { yaw: Math.PI * 0.25, pitch: 0.76, zoom: 1 }
const TEMP_COLORS = [0x3e7bd6, 0x5e9de0, 0x75b8ca, 0xa7a89f, 0xd3a55f, 0xdf7545, 0xef493e]
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

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
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.27, 0.1, 18), new THREE.MeshStandardMaterial({ color: 0xd9b46d, roughness: 0.52 }))
  base.position.y = 0.07
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.48, 14), new THREE.MeshStandardMaterial({ color: 0x55a8df, roughness: 0.42, metalness: 0.08 }))
  body.position.y = 0.34
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), new THREE.MeshStandardMaterial({ color: 0x8ccdf2, roughness: 0.38 }))
  head.position.y = 0.68
  const heading = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 10), new THREE.MeshStandardMaterial({ color: 0xf6e6a8, emissive: 0x302913, emissiveIntensity: 0.45 }))
  heading.rotation.z = -Math.PI / 2
  heading.position.set(0.27, 0.42, 0)
  group.add(base, body, head, heading)
  group.traverse((child) => { if (child instanceof THREE.Mesh) child.castShadow = true })
  return group
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
    position: { x: a.position.x + (b.position.x - a.position.x) * local, z: a.position.z + (b.position.z - a.position.z) * local },
    velocity: { x: a.velocity.x + (b.velocity.x - a.velocity.x) * local, z: a.velocity.z + (b.velocity.z - a.velocity.z) * local },
  }
}

function cellColor(cell, showThermal) {
  const base = cell.groundFill === 'grass' ? new THREE.Color(0x4f7748)
    : cell.groundFill === 'water' ? new THREE.Color(0x316a86)
      : cell.groundFill === 'ice' ? new THREE.Color(0xa5d9e7)
        : cell.groundFill === 'fire' ? new THREE.Color(0x8e4937)
          : new THREE.Color(0x676d6b)
  if (!showThermal) return base
  const normalized = clamp(cell.groundTemp, -3, 3) + 3
  return base.lerp(new THREE.Color(TEMP_COLORS[normalized]), cell.groundTemp === 0 ? 0.05 : 0.25 + Math.abs(cell.groundTemp) * 0.08)
}

function createHexOverlay(color, opacity, height, radius = HEX_RADIUS * 0.82) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.018, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))
  mesh.position.y = height
  mesh.renderOrder = 30
  return mesh
}

function createMountain(cell) {
  const group = new THREE.Group()
  const rock = new THREE.MeshStandardMaterial({ color: 0x5d646d, roughness: 0.94, flatShading: true })
  const snow = new THREE.MeshStandardMaterial({ color: 0xc9d3d8, roughness: 0.86, flatShading: true })
  const seed = Math.abs(cell.q * 17 + cell.r * 31) % 7
  for (const [x, z, radius, height] of [[-0.1, -0.05, 0.3, 0.78], [0.18, 0.12, 0.21, 0.52]]) {
    const peak = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 6), rock)
    peak.position.set(x + (seed - 3) * 0.006, height * 0.5 + 0.08, z)
    peak.rotation.y = seed * 0.21
    peak.castShadow = true
    group.add(peak)
    const cap = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.46, height * 0.25, 6), snow)
    cap.position.set(peak.position.x, peak.position.y + height * 0.34, z)
    cap.rotation.y = peak.rotation.y
    group.add(cap)
  }
  return group
}

function createCloud(cell, bobAnimations) {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ color: cell.skyTemp > 0 ? 0xffdcc3 : cell.skyTemp < 0 ? 0xd7ecff : 0xf1f2ec, roughness: 0.92, transparent: true, opacity: 0.78, depthWrite: false })
  for (const [x, y, z, radius] of [[-0.2, 0, 0, 0.23], [0.05, 0.08, 0, 0.31], [0.27, 0, 0.02, 0.22], [0, -0.01, 0.18, 0.24]]) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material)
    sphere.position.set(x, y, z)
    group.add(sphere)
  }
  group.position.y = 2.05
  bobAnimations.push({ object: group, baseY: 2.05, phase: cell.q * 1.37 + cell.r * 2.11, amplitude: 0.065, speed: 1.05 })
  return group
}

function createWindArrow(directionId) {
  const group = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: 0xc7ecff, transparent: true, opacity: 0.8 })
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 7), material)
  shaft.rotation.z = Math.PI / 2
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.17, 7), material)
  head.rotation.z = -Math.PI / 2
  head.position.x = 0.28
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
  const color = hard ? 0x707985 : left ? 0x43c7d7 : 0xeea74a
  const wall = new THREE.Mesh(new THREE.BoxGeometry(hard ? 0.78 : 0.62, hard ? 1.05 : 0.78, hard ? 0.2 : 0.12), new THREE.MeshStandardMaterial({ color, emissive: hard ? 0x111820 : left ? 0x0a4d59 : 0x5c3107, emissiveIntensity: 0.55, metalness: hard ? 0.35 : 0.62, roughness: hard ? 0.72 : 0.28, transparent: !hard, opacity: hard ? 1 : 0.88 }))
  wall.position.y = hard ? 0.55 : 0.42
  wall.castShadow = true
  group.add(wall)
  return group
}

export function Board3D({
  cells,
  obstacles,
  state,
  previewPlan,
  playback,
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
  const velocityArrowRef = useRef(null)
  const orbitRef = useRef({ ...DEFAULT_CAMERA })
  const stateRef = useRef(state)
  const playbackRef = useRef(playback)
  const viewModeRef = useRef(viewMode)
  const callbacksRef = useRef({ onHoverHex, onClickHex })
  const bobRef = useRef([])
  const rainRef = useRef([])

  stateRef.current = state
  playbackRef.current = playback
  viewModeRef.current = viewMode
  callbacksRef.current = { onHoverHex, onClickHex }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x101827)
    scene.fog = new THREE.Fog(0x101827, 12, 27)
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.replaceChildren(renderer.domElement)
    renderer.domElement.style.touchAction = 'none'

    const camera = new THREE.OrthographicCamera(-7, 7, 5, -5, 0.1, 60)
    scene.add(new THREE.HemisphereLight(0xb7d9ff, 0x28313d, 1.7))
    const sun = new THREE.DirectionalLight(0xffe7c0, 2.05)
    sun.position.set(-6, 11, -5)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    scene.add(sun)

    const boardGroup = new THREE.Group()
    const interaction = new THREE.Group()
    const actor = createActor()
    const velocityArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.9, 0), 0.8, 0xc978ff, 0.16, 0.08)
    scene.add(boardGroup, interaction, actor, velocityArrow)
    sceneRef.current = scene
    cameraRef.current = camera
    boardGroupRef.current = boardGroup
    interactionRef.current = interaction
    actorRef.current = actor
    velocityArrowRef.current = velocityArrow

    const updateCamera = () => {
      const orbit = orbitRef.current
      if (viewModeRef.current === 'top') {
        camera.position.set(0, 18, 0.01)
        camera.lookAt(0, 0, 0)
      } else {
        const radius = 16
        const horizontal = Math.cos(orbit.pitch) * radius
        camera.position.set(Math.sin(orbit.yaw) * horizontal, Math.sin(orbit.pitch) * radius, Math.cos(orbit.yaw) * horizontal)
        camera.lookAt(0, 0.2, 0)
      }
      camera.zoom = orbit.zoom
      camera.updateProjectionMatrix()
    }
    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setSize(width, height, false)
      const size = 5.35
      const aspect = width / height
      camera.left = -size * aspect
      camera.right = size * aspect
      camera.top = size
      camera.bottom = -size
      camera.updateProjectionMatrix()
    }
    resize(); updateCamera()
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
      if (event.button !== 0) return
      drag.active = true; drag.moved = false; drag.pointerId = event.pointerId
      drag.startX = drag.x = event.clientX; drag.startY = drag.y = event.clientY
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const pointerMove = (event) => {
      if (drag.active) {
        const dx = event.clientX - drag.x; const dy = event.clientY - drag.y
        drag.x = event.clientX; drag.y = event.clientY
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true
        if (viewModeRef.current !== 'top') {
          orbitRef.current.yaw -= dx * 0.008
          orbitRef.current.pitch = clamp(orbitRef.current.pitch + dy * 0.006, 0.38, 1.22)
          updateCamera()
        }
        return
      }
      const hex = pickHex(event); const key = hex ? `${hex.q},${hex.r}` : ''
      if (key === hoverKey) return
      hoverKey = key; callbacksRef.current.onHoverHex?.(hex)
    }
    const pointerUp = (event) => {
      if (!drag.active || drag.pointerId !== event.pointerId) return
      const moved = drag.moved; drag.active = false
      renderer.domElement.releasePointerCapture(event.pointerId)
      if (!moved) { const hex = pickHex(event); if (hex) callbacksRef.current.onClickHex?.(hex) }
    }
    const pointerLeave = () => { if (!drag.active) { hoverKey = ''; callbacksRef.current.onHoverHex?.(null) } }
    const wheel = (event) => { event.preventDefault(); orbitRef.current.zoom = clamp(orbitRef.current.zoom * Math.exp(-event.deltaY * 0.001), 0.62, 2.2); updateCamera() }
    renderer.domElement.addEventListener('pointerdown', pointerDown)
    renderer.domElement.addEventListener('pointermove', pointerMove)
    renderer.domElement.addEventListener('pointerup', pointerUp)
    renderer.domElement.addEventListener('pointercancel', pointerUp)
    renderer.domElement.addEventListener('pointerleave', pointerLeave)
    renderer.domElement.addEventListener('wheel', wheel, { passive: false })

    let frame = 0
    const render = () => {
      const now = performance.now(); const seconds = now * 0.001
      for (const item of bobRef.current) item.object.position.y = item.baseY + Math.sin(seconds * item.speed + item.phase) * item.amplitude
      for (const item of rainRef.current) {
        const progress = (seconds * item.speed + item.phase) % 1
        item.object.position.y = item.topY - (item.topY - item.bottomY) * progress
        item.material.opacity = 0.22 + Math.sin(progress * Math.PI) * 0.55
      }
      let visualState = stateRef.current
      const activePlayback = playbackRef.current
      if (activePlayback) {
        const progress = clamp(playbackElapsedMs(activePlayback, now) / AT_VISUAL_MS, 0, 1)
        const sampled = sampleAt(activePlayback.samples, progress)
        if (sampled) visualState = { ...stateRef.current, position: sampled.position, velocity: sampled.velocity }
        host.dataset.playbackProgress = progress.toFixed(3)
        host.dataset.playbackId = String(activePlayback.id)
      } else { host.dataset.playbackProgress = '0'; delete host.dataset.playbackId }
      const actorObject = actorRef.current
      if (actorObject) {
        actorObject.position.set(visualState.position.x, 0.1, visualState.position.z)
        const speed = Math.hypot(visualState.velocity.x, visualState.velocity.z)
        if (speed > 0.02) actorObject.rotation.y = -Math.atan2(visualState.velocity.z, visualState.velocity.x)
      }
      const arrow = velocityArrowRef.current
      if (arrow) {
        const speed = Math.hypot(visualState.velocity.x, visualState.velocity.z)
        arrow.position.set(visualState.position.x, 0.92, visualState.position.z)
        if (speed > 0.02) { arrow.visible = true; arrow.setDirection(new THREE.Vector3(visualState.velocity.x / speed, 0, visualState.velocity.z / speed)); arrow.setLength(Math.min(1.6, 0.45 + speed * 0.32), 0.16, 0.08) }
        else arrow.visible = false
      }
      host.dataset.visualX = visualState.position.x.toFixed(4)
      host.dataset.visualZ = visualState.position.z.toFixed(4)
      renderer.render(scene, camera)
      frame = requestAnimationFrame(render)
    }
    render()

    return () => {
      cancelAnimationFrame(frame); observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('pointermove', pointerMove)
      renderer.domElement.removeEventListener('pointerup', pointerUp)
      renderer.domElement.removeEventListener('pointercancel', pointerUp)
      renderer.domElement.removeEventListener('pointerleave', pointerLeave)
      renderer.domElement.removeEventListener('wheel', wheel)
      disposeObject(boardGroup); disposeObject(interaction); disposeObject(actor); renderer.dispose(); host.replaceChildren()
    }
  }, [])

  useEffect(() => {
    const boardGroup = boardGroupRef.current
    if (!boardGroup) return
    for (const child of [...boardGroup.children]) { boardGroup.remove(child); disposeObject(child) }
    bobRef.current = []; rainRef.current = []
    const floor = new THREE.Mesh(new THREE.CircleGeometry(boardRadius + 2.6, 64), new THREE.MeshStandardMaterial({ color: 0x17233a, roughness: 0.97 }))
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.2; floor.receiveShadow = true; boardGroup.add(floor)

    for (const cell of cells) {
      const center = axialToWorld(cell)
      const tile = new THREE.Mesh(new THREE.CylinderGeometry(HEX_RADIUS * 0.97, HEX_RADIUS * 0.97, TILE_HEIGHT, 6), new THREE.MeshStandardMaterial({ color: cellColor(cell, showThermal), roughness: cell.moisture === 2 ? 0.32 : cell.moisture === 0 ? 0.9 : 0.66, metalness: cell.groundFill === 'ice' ? 0.16 : 0.02, flatShading: true }))
      tile.position.set(center.x, cell.groundFill === 'water' ? -0.04 : 0, center.z); tile.receiveShadow = true; boardGroup.add(tile)
      const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 6 }, (_, index) => { const angle = Math.PI * 0.5 - index * Math.PI / 3; return new THREE.Vector3(Math.cos(angle) * HEX_RADIUS * 0.94, TILE_HEIGHT * 0.5 + 0.008, Math.sin(angle) * HEX_RADIUS * 0.94) })), new THREE.LineBasicMaterial({ color: TEMP_COLORS[clamp(cell.groundTemp, -3, 3) + 3], transparent: true, opacity: showThermal ? 0.42 : 0.18, depthWrite: false }))
      tile.add(outline)

      if (cell.groundFill === 'grass') {
        const material = new THREE.MeshStandardMaterial({ color: 0x77a64f, roughness: 0.9 })
        for (let index = 0; index < 3; index += 1) { const blade = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.24 + index * 0.02, 5), material); blade.position.set(center.x - 0.18 + index * 0.17, 0.18, center.z + (index % 2 ? 0.12 : -0.08)); boardGroup.add(blade) }
      }
      if (cell.groundFill === 'water') { const overlay = createHexOverlay(0x5ec7df, 0.38, 0.06, HEX_RADIUS * 0.86); overlay.position.x = center.x; overlay.position.z = center.z; boardGroup.add(overlay) }
      if (cell.groundFill === 'ice') { const overlay = createHexOverlay(0xc9f4ff, 0.5, 0.09, HEX_RADIUS * 0.87); overlay.position.x = center.x; overlay.position.z = center.z; boardGroup.add(overlay) }
      if (cell.groundFill === 'fire') {
        for (let index = 0; index < 3; index += 1) { const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.38, 9), new THREE.MeshBasicMaterial({ color: index === 1 ? 0xffdf70 : 0xff7040, transparent: true, opacity: 0.88 })); flame.position.set(center.x + (index - 1) * 0.14, 0.28, center.z + (index === 1 ? 0.04 : -0.05)); boardGroup.add(flame); bobRef.current.push({ object: flame, baseY: 0.28, phase: index * 1.7, amplitude: 0.055, speed: 5 + index }) }
      }
      if (cell.moisture === 2 && cell.groundFill !== 'water') { const puddle = createHexOverlay(0x6db8d2, 0.18, 0.1, 0.26); puddle.position.set(center.x + 0.12, 0.1, center.z - 0.09); boardGroup.add(puddle) }
      if (cell.tags.includes('Mountain')) { const mountain = createMountain(cell); mountain.position.set(center.x, 0.08, center.z); boardGroup.add(mountain) }
      if (cell.tags.includes('Shelter')) {
        const beacon = new THREE.Group(); const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.46, 12), new THREE.MeshStandardMaterial({ color: 0xd7c79b, roughness: 0.75 })); pillar.position.y = 0.28; const glow = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd56a })); glow.position.y = 0.6; beacon.add(pillar, glow); beacon.position.set(center.x, 0.08, center.z); boardGroup.add(beacon)
      }
      if (cell.tags.some((tag) => tag.startsWith('UT3'))) { const surface = createMomentumSurface(cell); surface.position.set(center.x, 0.05, center.z); boardGroup.add(surface) }

      if (showWeather && cell.skyFill === 'cloud') { const cloud = createCloud(cell, bobRef.current); cloud.position.x = center.x; cloud.position.z = center.z; boardGroup.add(cloud); const shadow = createHexOverlay(0x24354d, 0.2, 0.11, 0.36); shadow.position.x = center.x; shadow.position.z = center.z; boardGroup.add(shadow) }
      if (showWeather && cell.wind) { const wind = createWindArrow(cell.wind); wind.position.x = center.x; wind.position.z = center.z; boardGroup.add(wind); bobRef.current.push({ object: wind, baseY: 1.35, phase: cell.q + cell.r, amplitude: 0.035, speed: 2.2 }) }
      if (showWeather && cell.rain) {
        for (let index = 0; index < 6; index += 1) { const material = new THREE.MeshBasicMaterial({ color: 0x7fdcff, transparent: true, opacity: 0.64, depthWrite: false }); const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 5), material); const topY = 1.95 + (index % 3) * 0.15; const bottomY = 0.15; drop.position.set(center.x - 0.27 + (index % 3) * 0.2, topY, center.z - 0.18 + Math.floor(index / 3) * 0.3); boardGroup.add(drop); rainRef.current.push({ object: drop, material, topY, bottomY, phase: index / 6, speed: 0.72 + (index % 2) * 0.12 }) }
      }
    }
  }, [cells, obstacles, boardRadius, showWeather, showThermal])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (previewRef.current) { scene.remove(previewRef.current); disposeObject(previewRef.current); previewRef.current = null }
    if (!previewPlan?.valid || previewPlan.samples.length < 2) return
    const points = previewPlan.samples.map((sample) => new THREE.Vector3(sample.position.x, 0.2, sample.position.z))
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: previewPlan.collisions.length ? 0xffa45b : previewPlan.spatialMode === 'discrete' ? 0xf2c85a : 0x65d8ff, transparent: true, opacity: 0.94 }))
    line.renderOrder = 40; scene.add(line); previewRef.current = line
  }, [previewPlan])

  useEffect(() => {
    const layer = interactionRef.current
    if (!layer) return
    for (const child of [...layer.children]) { layer.remove(child); disposeObject(child) }
    if (selectedAimHex) { const center = axialToWorld(selectedAimHex); const selected = createHexOverlay(0xf7d06e, 0.26, 0.14); selected.position.x = center.x; selected.position.z = center.z; layer.add(selected) }
    if (hoverHex) { const center = axialToWorld(hoverHex); const hover = createHexOverlay(previewPlan?.valid ? 0xffffff : 0xff6f6f, 0.2, 0.16, HEX_RADIUS * 0.78); hover.position.x = center.x; hover.position.z = center.z; layer.add(hover) }
  }, [hoverHex?.q, hoverHex?.r, selectedAimHex?.q, selectedAimHex?.r, previewPlan?.valid])

  useEffect(() => {
    const camera = cameraRef.current
    if (!camera) return
    orbitRef.current = { ...DEFAULT_CAMERA }; viewModeRef.current = viewMode
    if (viewMode === 'top') { camera.position.set(0, 18, 0.01); camera.lookAt(0, 0, 0) }
    else { const radius = 16; const horizontal = Math.cos(DEFAULT_CAMERA.pitch) * radius; camera.position.set(Math.sin(DEFAULT_CAMERA.yaw) * horizontal, Math.sin(DEFAULT_CAMERA.pitch) * radius, Math.cos(DEFAULT_CAMERA.yaw) * horizontal); camera.lookAt(0, 0.2, 0) }
    camera.zoom = DEFAULT_CAMERA.zoom; camera.updateProjectionMatrix()
  }, [viewMode, cameraResetToken])

  return <div className="continuous-board-host cell-world-board" ref={hostRef} aria-label="ProjectC Cell World Hex6 board" />
}
