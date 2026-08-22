import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { AT_VISUAL_MS } from '../sim/solver.js'
import { HEX_RADIUS, axialDistance, axialToWorld, worldToAxial } from '../sim/hex.js'

const TILE_HEIGHT = 0.13
const DEFAULT_CAMERA = { yaw: Math.PI * 0.25, pitch: 0.78, zoom: 1 }
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
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.27, 0.1, 18),
    new THREE.MeshStandardMaterial({ color: 0xd9b46d, roughness: 0.52 }),
  )
  base.position.y = 0.07
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.2, 0.48, 14),
    new THREE.MeshStandardMaterial({ color: 0x55a8df, roughness: 0.42, metalness: 0.08 }),
  )
  body.position.y = 0.34
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x8ccdf2, roughness: 0.38 }),
  )
  head.position.y = 0.68
  const heading = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.28, 10),
    new THREE.MeshStandardMaterial({ color: 0xf6e6a8, emissive: 0x302913, emissiveIntensity: 0.45 }),
  )
  heading.rotation.z = -Math.PI / 2
  heading.position.set(0.27, 0.42, 0)
  group.add(base, body, head, heading)
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) child.castShadow = true
  })
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

export function Board3D({
  cells,
  obstacles,
  state,
  previewPlan,
  playback,
  boardRadius,
  viewMode,
  cameraResetToken,
  onHoverHex,
  onClickHex,
}) {
  const hostRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const boardGroupRef = useRef(null)
  const actorRef = useRef(null)
  const previewRef = useRef(null)
  const velocityArrowRef = useRef(null)
  const orbitRef = useRef({ ...DEFAULT_CAMERA })
  const stateRef = useRef(state)
  const playbackRef = useRef(playback)
  const viewModeRef = useRef(viewMode)
  const callbacksRef = useRef({ onHoverHex, onClickHex })

  stateRef.current = state
  playbackRef.current = playback
  viewModeRef.current = viewMode
  callbacksRef.current = { onHoverHex, onClickHex }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x101827)
    scene.fog = new THREE.Fog(0x101827, 12, 26)

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.replaceChildren(renderer.domElement)
    renderer.domElement.style.touchAction = 'none'

    const camera = new THREE.OrthographicCamera(-7, 7, 5, -5, 0.1, 60)
    scene.add(new THREE.HemisphereLight(0xb7d9ff, 0x28313d, 1.7))
    const sun = new THREE.DirectionalLight(0xffe7c0, 2.1)
    sun.position.set(-6, 11, -5)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    scene.add(sun)

    const boardGroup = new THREE.Group()
    const actor = createActor()
    const velocityArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.9, 0), 0.8, 0xc978ff, 0.16, 0.08)
    scene.add(boardGroup, actor, velocityArrow)

    sceneRef.current = scene
    cameraRef.current = camera
    boardGroupRef.current = boardGroup
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
    resize()
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
      if (event.button !== 0) return
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
        if (viewModeRef.current !== 'top') {
          orbitRef.current.yaw -= dx * 0.008
          orbitRef.current.pitch = clamp(orbitRef.current.pitch + dy * 0.006, 0.38, 1.22)
          updateCamera()
        }
        return
      }
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
      if (!moved) {
        const hex = pickHex(event)
        if (hex) callbacksRef.current.onClickHex?.(hex)
      }
    }
    const pointerLeave = () => {
      if (!drag.active) {
        hoverKey = ''
        callbacksRef.current.onHoverHex?.(null)
      }
    }
    const wheel = (event) => {
      event.preventDefault()
      orbitRef.current.zoom = clamp(orbitRef.current.zoom * Math.exp(-event.deltaY * 0.001), 0.62, 2.2)
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
      let visualState = stateRef.current
      const activePlayback = playbackRef.current
      if (activePlayback) {
        const progress = clamp((now - activePlayback.startedAt) / AT_VISUAL_MS, 0, 1)
        const sampled = sampleAt(activePlayback.samples, progress)
        if (sampled) visualState = { ...stateRef.current, position: sampled.position, velocity: sampled.velocity }
        host.dataset.playbackProgress = progress.toFixed(3)
        host.dataset.playbackId = String(activePlayback.id)
      } else {
        host.dataset.playbackProgress = '0'
        delete host.dataset.playbackId
      }

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
        if (speed > 0.02) {
          arrow.visible = true
          arrow.setDirection(new THREE.Vector3(visualState.velocity.x / speed, 0, visualState.velocity.z / speed))
          arrow.setLength(Math.min(1.6, 0.45 + speed * 0.32), 0.16, 0.08)
        } else arrow.visible = false
      }
      host.dataset.visualX = visualState.position.x.toFixed(4)
      host.dataset.visualZ = visualState.position.z.toFixed(4)
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

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(boardRadius + 2.4, 64),
      new THREE.MeshStandardMaterial({ color: 0x17233a, roughness: 0.97 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.18
    floor.receiveShadow = true
    boardGroup.add(floor)

    const obstacleKeys = new Set(obstacles.map((entry) => `${entry.hex.q},${entry.hex.r}`))
    for (const cell of cells) {
      const center = axialToWorld(cell)
      const ring = Math.max(Math.abs(cell.q), Math.abs(cell.r), Math.abs(-cell.q - cell.r))
      const baseColor = obstacleKeys.has(`${cell.q},${cell.r}`) ? 0x575f69 : ring % 2 === 0 ? 0x596c61 : 0x516259
      const tile = new THREE.Mesh(
        new THREE.CylinderGeometry(HEX_RADIUS * 0.96, HEX_RADIUS * 0.96, TILE_HEIGHT, 6),
        new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.76, flatShading: true }),
      )
      tile.position.set(center.x, 0, center.z)
      tile.receiveShadow = true
      boardGroup.add(tile)
    }

    for (const obstacle of obstacles) {
      const center = axialToWorld(obstacle.hex)
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.54, 0.86, 0.18),
        new THREE.MeshStandardMaterial({ color: 0x7c8793, emissive: 0x131a22, emissiveIntensity: 0.55, metalness: 0.28, roughness: 0.62 }),
      )
      wall.position.set(center.x, 0.47, center.z)
      wall.castShadow = true
      boardGroup.add(wall)
    }
  }, [cells, obstacles, boardRadius])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (previewRef.current) {
      scene.remove(previewRef.current)
      disposeObject(previewRef.current)
      previewRef.current = null
    }
    if (!previewPlan?.valid || previewPlan.samples.length < 2) return
    const points = previewPlan.samples.map((sample) => new THREE.Vector3(sample.position.x, 0.22, sample.position.z))
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: previewPlan.collisions.length ? 0xffa45b : 0x65d8ff, transparent: true, opacity: 0.92 }),
    )
    line.renderOrder = 20
    scene.add(line)
    previewRef.current = line
  }, [previewPlan])

  useEffect(() => {
    const camera = cameraRef.current
    if (!camera) return
    orbitRef.current = { ...DEFAULT_CAMERA }
    viewModeRef.current = viewMode
    if (viewMode === 'top') {
      camera.position.set(0, 18, 0.01)
      camera.lookAt(0, 0, 0)
    } else {
      const radius = 16
      const horizontal = Math.cos(DEFAULT_CAMERA.pitch) * radius
      camera.position.set(Math.sin(DEFAULT_CAMERA.yaw) * horizontal, Math.sin(DEFAULT_CAMERA.pitch) * radius, Math.cos(DEFAULT_CAMERA.yaw) * horizontal)
      camera.lookAt(0, 0.2, 0)
    }
    camera.zoom = DEFAULT_CAMERA.zoom
    camera.updateProjectionMatrix()
  }, [viewMode, cameraResetToken])

  return <div className="continuous-board-host" ref={hostRef} aria-label="Continuous Hex6 inertia board" />
}
