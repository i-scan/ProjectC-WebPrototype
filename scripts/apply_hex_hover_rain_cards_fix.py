from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'Missing expected text for {label}')
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'Expected one match for {label}, got {count}')
    return updated


board_path = Path('src/hex/HexThreeBoard.tsx')
board = board_path.read_text()

board = replace_once(
    board,
    "type BobAnimation = { object: THREE.Object3D; baseY: number; phase: number; amplitude: number; speed: number }\n",
    "type BobAnimation = { object: THREE.Object3D; baseY: number; phase: number; amplitude: number; speed: number }\n"
    "type RainAnimation = {\n"
    "  object: THREE.Mesh\n"
    "  material: THREE.MeshBasicMaterial\n"
    "  topY: number\n"
    "  bottomY: number\n"
    "  phase: number\n"
    "  speed: number\n"
    "}\n",
    'rain animation type',
)

board = replace_once(
    board,
    "const sameCoord = (a?: Coord, b?: Coord) => Boolean(a && b && a.x === b.x && a.y === b.y)\n",
    "const sameCoord = (a?: Coord, b?: Coord) => Boolean(a && b && a.x === b.x && a.y === b.y)\n"
    "const coordKey = (coord: Coord) => `${coord.x},${coord.y}`\n",
    'coordinate key',
)

board = replace_once(
    board,
    "  bob.push({ object: group, baseY: 2.12, phase: Math.random() * Math.PI * 2, amplitude: 0.07, speed: 1.1 })",
    "  const stablePhase = (cell.coord.x * 1.37 + cell.coord.y * 2.11) % (Math.PI * 2)\n"
    "  bob.push({ object: group, baseY: 2.12, phase: stablePhase, amplitude: 0.07, speed: 1.1 })",
    'stable cloud phase',
)

board = replace_once(
    board,
    "      position.y + (effect === 'vapor' ? 0.2 : 0.03),",
    "      effect === 'rain' ? 1.85 + (index % 3) * 0.12 : position.y + (effect === 'vapor' ? 0.2 : 0.03),",
    'rain effect origin',
)
board = replace_once(
    board,
    "      rise: effect === 'rain' ? -0.9 : effect === 'wind' ? 0.1 : 0.65,",
    "      rise: effect === 'rain' ? -1.5 : effect === 'wind' ? 0.1 : 0.65,",
    'rain effect fall distance',
)

board = replace_once(
    board,
    "  const bobRef = useRef<BobAnimation[]>([])\n",
    "  const bobRef = useRef<BobAnimation[]>([])\n"
    "  const rainRef = useRef<RainAnimation[]>([])\n"
    "  const cloudObjectsRef = useRef(new Map<string, THREE.Group>())\n"
    "  const interactionLayerRef = useRef<THREE.Group | null>(null)\n",
    'hex visual refs',
)

board = replace_once(
    board,
    "      for (const item of bobRef.current) {\n"
    "        item.object.position.y = item.baseY + Math.sin(seconds * item.speed + item.phase) * item.amplitude\n"
    "      }\n",
    "      for (const item of bobRef.current) {\n"
    "        item.object.position.y = item.baseY + Math.sin(seconds * item.speed + item.phase) * item.amplitude\n"
    "      }\n"
    "      for (const item of rainRef.current) {\n"
    "        const progress = (seconds * item.speed + item.phase) % 1\n"
    "        item.object.position.y = item.topY - (item.topY - item.bottomY) * progress\n"
    "        item.material.opacity = 0.22 + Math.sin(progress * Math.PI) * 0.55\n"
    "      }\n",
    'rain render loop',
)

board = replace_once(
    board,
    "    bobRef.current = []\n"
    "    moveRef.current = []\n",
    "    bobRef.current = []\n"
    "    rainRef.current = []\n"
    "    cloudObjectsRef.current.clear()\n"
    "    interactionLayerRef.current = null\n"
    "    moveRef.current = []\n",
    'reset visual refs',
)

board = replace_once(
    board,
    "    content.add(floor)\n\n    for (const cell of state.cells) {",
    "    content.add(floor)\n\n"
    "    const interactionLayer = new THREE.Group()\n"
    "    interactionLayer.name = 'hex-interaction-layer'\n"
    "    content.add(interactionLayer)\n"
    "    interactionLayerRef.current = interactionLayer\n\n"
    "    for (const cell of state.cells) {",
    'interaction layer creation',
)

board = regex_once(
    board,
    r"\n      if \(sameCoord\(cell\.coord, selectedCoord\)\) \{[\s\S]*?\n      \}\n      if \(sameCoord\(cell\.coord, hoverCoord\)\) \{[\s\S]*?\n      \}\n      if \(isValidTarget",
    "\n      if (isValidTarget",
    'remove hover-driven scene overlays',
)

board = regex_once(
    board,
    r"      if \(showSky && cell\.skyFill === 'cloud'\) \{[\s\S]*?\n      \}\n      const windDirection",
    "      if (showSky && cell.skyFill === 'cloud') {\n"
    "        const cloud = createCloud(cell, bobRef.current)\n"
    "        cloud.position.x = position.x\n"
    "        cloud.position.z = position.z\n"
    "        content.add(cloud)\n"
    "        cloudObjectsRef.current.set(coordKey(cell.coord), cloud)\n"
    "        const shadow = createHexOverlay(0x24354d, 0.24, 0.12, 0.38)\n"
    "        shadow.position.x = position.x\n"
    "        shadow.position.z = position.z\n"
    "        content.add(shadow)\n"
    "      }\n"
    "      const windDirection",
    'stable cloud creation',
)

board = regex_once(
    board,
    r"      if \(showSky && cell\.intents\.some\(\(intentValue\) => intentValue\.type === 'rain'\)\) \{[\s\S]*?\n      \}\n      if \(showDebug\)",
    "      if (showSky && cell.intents.some((intentValue) => intentValue.type === 'rain')) {\n"
    "        for (let index = 0; index < 7; index += 1) {\n"
    "          const material = new THREE.MeshBasicMaterial({\n"
    "            color: 0x7fdcff,\n"
    "            transparent: true,\n"
    "            opacity: 0.67,\n"
    "            depthWrite: false,\n"
    "          })\n"
    "          const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.34, 5), material)\n"
    "          const topY = 2.02 + (index % 3) * 0.16\n"
    "          const bottomY = 0.16\n"
    "          drop.position.set(\n"
    "            position.x - 0.3 + (index % 4) * 0.19,\n"
    "            topY,\n"
    "            position.z - 0.2 + Math.floor(index / 4) * 0.3,\n"
    "          )\n"
    "          content.add(drop)\n"
    "          rainRef.current.push({\n"
    "            object: drop,\n"
    "            material,\n"
    "            topY,\n"
    "            bottomY,\n"
    "            phase: index / 7,\n"
    "            speed: 0.72 + (index % 2) * 0.12,\n"
    "          })\n"
    "        }\n"
    "      }\n"
    "      if (showDebug)",
    'falling rain animation',
)

board = regex_once(
    board,
    r"\n    const player = getPlayer\(state\)\n    if \([\s\S]*?\n    \}\n\n    for \(const actor of state\.actors\.filter",
    "\n    const player = getPlayer(state)\n\n    for (const actor of state.actors.filter",
    'remove hover path from main scene rebuild',
)

board = replace_once(
    board,
    "  }, [\n"
    "    state,\n"
    "    selectedCoord.x,\n"
    "    selectedCoord.y,\n"
    "    hoverCoord?.x,\n"
    "    hoverCoord?.y,\n"
    "    selection,\n"
    "    targetLayer,\n"
    "    showSky,\n"
    "    showDebug,\n"
    "    event,\n"
    "  ])\n\n"
    "  return <div className=\"hex-board-host\" ref={hostRef} aria-label=\"Three.js Hex6 棋盘\" />",
    "  }, [state, selection, targetLayer, showSky, showDebug, event])\n\n"
    "  useEffect(() => {\n"
    "    const layer = interactionLayerRef.current\n"
    "    if (!layer) return\n\n"
    "    for (const child of [...layer.children]) {\n"
    "      layer.remove(child)\n"
    "      disposeObject(child)\n"
    "    }\n\n"
    "    for (const [key, cloud] of cloudObjectsRef.current) {\n"
    "      const faded = key === coordKey(selectedCoord) || (hoverCoord && key === coordKey(hoverCoord))\n"
    "      cloud.traverse((child) => {\n"
    "        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {\n"
    "          child.material.opacity = faded ? 0.28 : 0.8\n"
    "        }\n"
    "      })\n"
    "    }\n\n"
    "    const selectedPosition = hexWorldPosition(selectedCoord, state)\n"
    "    const selected = createHexOverlay(0xf7d06e, 0.3, 0.14, 0.49)\n"
    "    selected.position.x = selectedPosition.x\n"
    "    selected.position.z = selectedPosition.z\n"
    "    layer.add(selected)\n\n"
    "    if (hoverCoord) {\n"
    "      const hoverPosition = hexWorldPosition(hoverCoord, state)\n"
    "      const hover = createHexOverlay(0xffffff, 0.15, 0.155, 0.45)\n"
    "      hover.position.x = hoverPosition.x\n"
    "      hover.position.z = hoverPosition.z\n"
    "      layer.add(hover)\n\n"
    "      const player = getPlayer(state)\n"
    "      if (selection.kind === 'basic' && selection.action === 'move' && isValidTarget(state, selection, hoverCoord)) {\n"
    "        const path = buildHexPath(state, player.position, hoverCoord, 8, player.id)\n"
    "          .map((coord) => hexWorldPosition(coord, state, 0.18))\n"
    "        const line = new THREE.Line(\n"
    "          new THREE.BufferGeometry().setFromPoints(path),\n"
    "          new THREE.LineDashedMaterial({\n"
    "            color: 0x76e5b0,\n"
    "            dashSize: 0.14,\n"
    "            gapSize: 0.09,\n"
    "            transparent: true,\n"
    "            opacity: 0.9,\n"
    "          }),\n"
    "        )\n"
    "        line.computeLineDistances()\n"
    "        layer.add(line)\n"
    "      }\n"
    "    }\n"
    "  }, [state, selectedCoord.x, selectedCoord.y, hoverCoord?.x, hoverCoord?.y, selection])\n\n"
    "  return <div className=\"hex-board-host\" ref={hostRef} aria-label=\"Three.js Hex6 棋盘\" />",
    'separate interaction effect',
)

board_path.write_text(board)

rules_path = Path('src/hex/hexRules.ts')
rules = rules_path.read_text()

rules = replace_once(
    rules,
    "import {\n  getHexNeighbors,",
    "import { randomizeHexDeck, shuffleCards } from './hexDeck'\nimport {\n  getHexNeighbors,",
    'hex deck import',
)

rules = replace_once(
    rules,
    "export function createHexInitialState(overrides?: Partial<GameConfig>): GameState {\n"
    "  const state = createInitialState(overrides)\n"
    "  state.logs = ['Turn 1：六边格规则验证开始。']",
    "export function createHexInitialState(overrides?: Partial<GameConfig>): GameState {\n"
    "  const state = createInitialState(overrides)\n"
    "  randomizeHexDeck(state)\n"
    "  state.logs = ['Turn 1：六边格规则验证开始；牌库已随机洗牌。']",
    'random Hex6 opening hand',
)

rules = replace_once(
    rules,
    "      state.deck = [...state.discard]\n      state.discard = []",
    "      state.deck = shuffleCards(state.discard)\n      state.discard = []",
    'shuffle recycled discard',
)

rules_path.write_text(rules)
