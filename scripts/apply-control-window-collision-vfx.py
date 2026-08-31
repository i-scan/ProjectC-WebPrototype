from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'{label} anchor missing')
    return text.replace(old, new, 1)


board_path = Path('src/ui/Board3D.jsx')
board = board_path.read_text()

helpers = r'''
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

'''
board = replace_once(
    board,
    'function groundColor(cell, showThermal) {',
    helpers + 'function groundColor(cell, showThermal) {',
    'debug fx helpers',
)
board = replace_once(
    board,
    '  showWeather,\n  showThermal,\n  onHoverHex,',
    '  showWeather,\n  showThermal,\n  showDebugCollisionFx = false,\n  onHoverHex,',
    'Board3D debug prop',
)
board = replace_once(
    board,
    '  const previewGroupRef = useRef(null)\n  const orbitRef = useRef({ ...DEFAULT_CAMERA })',
    '  const previewGroupRef = useRef(null)\n  const collisionFxGroupRef = useRef(null)\n  const orbitRef = useRef({ ...DEFAULT_CAMERA })',
    'collision fx group ref',
)
board = replace_once(
    board,
    '  const axisDisplayOverrideRef = useRef(axisDisplayOverride)\n  const playbackCacheRef = useRef({ id: null, playerPoints: [], actorPoints: new Map() })',
    '  const axisDisplayOverrideRef = useRef(axisDisplayOverride)\n  const showDebugCollisionFxRef = useRef(showDebugCollisionFx)\n  const playbackCacheRef = useRef({ id: null, playerPoints: [], actorPoints: new Map() })',
    'collision fx enabled ref',
)
board = replace_once(
    board,
    '  axisDisplayOverrideRef.current = axisDisplayOverride\n\n  useEffect(() => {',
    '  axisDisplayOverrideRef.current = axisDisplayOverride\n  showDebugCollisionFxRef.current = showDebugCollisionFx\n\n  useEffect(() => {',
    'collision fx enabled current',
)
board = replace_once(
    board,
    '    const dummyGroup = new THREE.Group()\n    const player = createPlayerActor()',
    '    const dummyGroup = new THREE.Group()\n    const collisionFxGroup = new THREE.Group()\n    const player = createPlayerActor()',
    'collision fx scene group',
)
board = replace_once(
    board,
    '    scene.add(sun, boardGroup, interaction, dummyGroup, player)',
    '    scene.add(sun, boardGroup, interaction, dummyGroup, collisionFxGroup, player)',
    'collision fx scene add',
)
board = replace_once(
    board,
    '    dummyGroupRef.current = dummyGroup\n    playerRef.current = player',
    '    dummyGroupRef.current = dummyGroup\n    collisionFxGroupRef.current = collisionFxGroup\n    playerRef.current = player',
    'collision fx scene ref',
)
board = replace_once(
    board,
    '''          playbackCacheRef.current = {
            id: activePlayback.id,
            playerPoints: planPathPoints(activePlayback, 0.18),
            actorPoints,
          }
        }
''',
    '''          playbackCacheRef.current = {
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
''',
    'collision fx playback creation',
)
board = replace_once(
    board,
    "      host.dataset.playbackId = String(activePlayback.id)\n    } else {\n      playbackCacheRef.current = { id: null, playerPoints: [], actorPoints: new Map() }",
    "      host.dataset.playbackId = String(activePlayback.id)\n      updateCollisionDebugFx(collisionFxGroupRef.current, progress)\n    } else {\n      if (playbackCacheRef.current.id !== null) clearCollisionDebugFx(collisionFxGroupRef.current)\n      playbackCacheRef.current = { id: null, playerPoints: [], actorPoints: new Map() }",
    'collision fx render update',
)
board = replace_once(
    board,
    "      host.dataset.playbackPathMode = 'smooth'\n      delete host.dataset.playbackId\n    }",
    "      host.dataset.playbackPathMode = 'smooth'\n      host.dataset.collisionFxEventCount = '0'\n      delete host.dataset.playbackId\n    }\n    host.dataset.collisionDebugFx = showDebugCollisionFxRef.current ? 'on' : 'off'\n    host.dataset.collisionDebugFxStyle = showDebugCollisionFxRef.current ? 'logic-event-pulse-v1' : 'off'",
    'collision fx datasets',
)
board = replace_once(
    board,
    '      disposeObject(dummyGroup)\n      disposeObject(player)',
    '      disposeObject(dummyGroup)\n      clearCollisionDebugFx(collisionFxGroup)\n      disposeObject(collisionFxGroup)\n      disposeObject(player)',
    'collision fx cleanup',
)
board_path.write_text(board)

lab_path = Path('src/labs/control-window/ControlWindowLabV3.jsx')
lab = lab_path.read_text()
lab = replace_once(
    lab,
    '      data-cw-board-radius={boardRadius}\n    >',
    '      data-cw-board-radius={boardRadius}\n      data-cw-collision-vfx="logic-event-pulse-v1"\n    >',
    'lab collision fx marker',
)
lab = replace_once(
    lab,
    '              showThermal={false}\n              onHoverHex={(hex) => {',
    '              showThermal={false}\n              showDebugCollisionFx\n              onHoverHex={(hex) => {',
    'lab Board3D collision fx prop',
)
lab = replace_once(
    lab,
    '            <p className="actor-sub">Bidirectional Contact, Skip, Heavy Drive and variable board size live only in this lab candidate. Spatial Inertia v1 authority is untouched.</p>',
    '            <p className="actor-sub">Bidirectional Contact, Skip, Heavy Drive, variable board size and logic-driven collision debug VFX live only in this lab candidate. Spatial Inertia v1 authority is untouched.</p>',
    'lab isolation copy',
)
lab_path.write_text(lab)

verify_path = Path('scripts/verify-control-window-lab.mjs')
verify = verify_path.read_text()
verify = replace_once(
    verify,
    "  assert(dom.includes('bidirectional collision candidate'), 'Player knockback candidate marker missing')",
    "  assert(dom.includes('bidirectional collision candidate'), 'Player knockback candidate marker missing')\n  assert(dom.includes('data-cw-collision-vfx=\\\"logic-event-pulse-v1\\\"'), 'Control Window collision VFX marker missing')\n  assert(dom.includes('data-collision-debug-fx=\\\"on\\\"'), 'Board3D collision debug VFX was not enabled for Control Window Lab')",
    'browser collision fx checks',
)
verify_path.write_text(verify)
