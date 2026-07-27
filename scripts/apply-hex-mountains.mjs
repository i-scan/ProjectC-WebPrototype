import fs from 'node:fs'

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing patch target: ${label}`)
  return source.replace(before, after)
}

// Rules: shared terrain blocking, obstacle-aware A*, and line-of-sight.
const rulesPath = 'src/hex/hexRules.ts'
let rules = fs.readFileSync(rulesPath, 'utf8')
rules = replaceOnce(
  rules,
  "import { randomizeHexDeck, shuffleCards } from './hexDeck'\n",
  "import { randomizeHexDeck, shuffleCards } from './hexDeck'\nimport { hasHexLineOfSight, isTerrainBlocked } from './hexTerrain'\n",
  'terrain rules import',
)
rules = replaceOnce(
  rules,
  `function isBlocked(state: GameState, coord: Coord, movingActorId?: string): boolean {\n  const cell = cellAt(state, coord)\n  if (!cell || cell.tags.includes('Blocked') || cell.tags.includes('Void')) return true\n  return state.actors.some((actor) => actor.alive && actor.id !== movingActorId && sameCoord(actor.position, coord))\n}\n\nexport function hexStepToward(state: GameState, from: Coord, to: Coord, movingActorId: string): Coord {\n  const currentDistance = hexDistance(from, to)\n  return getHexNeighbors(from)\n    .map((entry, order) => ({\n      ...entry,\n      order,\n      distance: hexDistance(entry.coord, to),\n    }))\n    .filter((entry) =>\n      entry.distance < currentDistance &&\n      isHexInside(state, entry.coord) &&\n      !isBlocked(state, entry.coord, movingActorId),\n    )\n    .sort((a, b) => a.distance - b.distance || a.order - b.order)[0]?.coord ?? from\n}\n\nexport function buildHexPath(state: GameState, from: Coord, to: Coord, maxSteps: number, movingActorId = ''): Coord[] {\n  const path: Coord[] = [{ ...from }]\n  let current = { ...from }\n  for (let index = 0; index < maxSteps && hexDistance(current, to) > 0; index += 1) {\n    const next = hexStepToward(state, current, to, movingActorId)\n    if (sameCoord(next, current)) break\n    path.push(next)\n    current = next\n  }\n  return path\n}\n`,
  `function isBlocked(state: GameState, coord: Coord, movingActorId?: string): boolean {\n  const cell = cellAt(state, coord)\n  if (isTerrainBlocked(cell)) return true\n  return state.actors.some((actor) => actor.alive && actor.id !== movingActorId && sameCoord(actor.position, coord))\n}\n\nexport function findHexActorPath(\n  state: GameState,\n  from: Coord,\n  to: Coord,\n  movingActorId = '',\n): Coord[] {\n  if (sameCoord(from, to)) return [{ ...from }]\n  if (!isHexInside(state, to) || isTerrainBlocked(cellAt(state, to))) return []\n\n  const open = new Set<string>([keyOf(from)])\n  const coords = new Map<string, Coord>([[keyOf(from), { ...from }]])\n  const cameFrom = new Map<string, string>()\n  const gScore = new Map<string, number>([[keyOf(from), 0]])\n  const fScore = new Map<string, number>([[keyOf(from), hexDistance(from, to)]])\n\n  while (open.size > 0) {\n    let currentKey = ''\n    let currentScore = Number.POSITIVE_INFINITY\n    for (const candidate of open) {\n      const score = fScore.get(candidate) ?? Number.POSITIVE_INFINITY\n      if (score < currentScore) {\n        currentKey = candidate\n        currentScore = score\n      }\n    }\n\n    const current = coords.get(currentKey)\n    if (!current) break\n    if (sameCoord(current, to)) {\n      const path: Coord[] = [{ ...current }]\n      let cursor = currentKey\n      while (cameFrom.has(cursor)) {\n        cursor = cameFrom.get(cursor)!\n        const coord = coords.get(cursor)\n        if (coord) path.push({ ...coord })\n      }\n      return path.reverse()\n    }\n\n    open.delete(currentKey)\n    for (const neighborEntry of getHexNeighbors(current)) {\n      const neighbor = neighborEntry.coord\n      if (!isHexInside(state, neighbor) || isTerrainBlocked(cellAt(state, neighbor))) continue\n      const occupied = state.actors.some((actor) =>\n        actor.alive &&\n        actor.id !== movingActorId &&\n        sameCoord(actor.position, neighbor),\n      )\n      if (occupied && !sameCoord(neighbor, to)) continue\n\n      const neighborKey = keyOf(neighbor)\n      coords.set(neighborKey, { ...neighbor })\n      const tentative = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + 1\n      if (tentative >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) continue\n      cameFrom.set(neighborKey, currentKey)\n      gScore.set(neighborKey, tentative)\n      fScore.set(neighborKey, tentative + hexDistance(neighbor, to))\n      open.add(neighborKey)\n    }\n  }\n\n  return []\n}\n\nexport function hexStepToward(state: GameState, from: Coord, to: Coord, movingActorId: string): Coord {\n  return findHexActorPath(state, from, to, movingActorId)[1] ?? from\n}\n\nexport function buildHexPath(state: GameState, from: Coord, to: Coord, maxSteps: number, movingActorId = ''): Coord[] {\n  const path = findHexActorPath(state, from, to, movingActorId)\n  return path.length > 0 ? path.slice(0, Math.max(0, maxSteps) + 1) : [{ ...from }]\n}\n`,
  'obstacle-aware actor pathfinding',
)
rules = replaceOnce(
  rules,
  "      if (!isHexStraightLine(player.position, targetActor.position)) return fail('穿刺要求目标位于六边格三条主轴之一。')\n      applyDamage(next, targetActor, 1, card.name, true)\n",
  "      if (!isHexStraightLine(player.position, targetActor.position)) return fail('穿刺要求目标位于六边格三条主轴之一。')\n      if (!hasHexLineOfSight(next, player.position, targetActor.position)) return fail('穿刺路径被山体阻挡。')\n      applyDamage(next, targetActor, 1, card.name, true)\n",
  'pierce mountain line of sight',
)
fs.writeFileSync(rulesPath, rules)

// World map: existing ridge becomes mountain collision and a few isolated peaks are added.
const travelPath = 'src/hex/hexTravel.ts'
let travel = fs.readFileSync(travelPath, 'utf8')
travel = replaceOnce(
  travel,
  "} from './hexRules'\n",
  "} from './hexRules'\nimport { markMountain } from './hexTerrain'\n",
  'world mountain import',
)
travel = replaceOnce(
  travel,
  "      cell.tags.push('Blocked', 'Ridge')\n",
  "      cell.tags.push('Mountain', 'Blocked', 'BlocksSight', 'Ridge')\n",
  'world ridge terrain tags',
)
travel = replaceOnce(
  travel,
  "  cellAt(state, { x: 4, y: 5 })?.tags.push('Resource')\n",
  "  for (const coord of [{ x: 4, y: 7 }, { x: 10, y: 6 }, { x: 12, y: 7 }]) {\n    markMountain(state, coord, 'peak')\n  }\n\n  cellAt(state, { x: 4, y: 5 })?.tags.push('Resource')\n",
  'world isolated peaks',
)
fs.writeFileSync(travelPath, travel)

// Three.js: terrain-aware targeting and low-poly mountains.
const boardPath = 'src/hex/HexThreeBoard.tsx'
let board = fs.readFileSync(boardPath, 'utf8')
board = replaceOnce(
  board,
  "import { buildHexPath, getHexWind, hexDistance, type HexDirection } from './hexRules'\n",
  "import { buildHexPath, getHexWind, hexDistance, type HexDirection } from './hexRules'\nimport { hasHexLineOfSight, isMountainCell } from './hexTerrain'\n",
  'board terrain import',
)
board = replaceOnce(
  board,
  "function fillColor(cell: Cell) {\n  const base = cell.groundFill === 'grass'\n",
  "function fillColor(cell: Cell) {\n  if (isMountainCell(cell)) return new THREE.Color(0x4f555d)\n  const base = cell.groundFill === 'grass'\n",
  'mountain tile color',
)
board = replaceOnce(
  board,
  "function createActorPawn(actor: Actor, billboards: THREE.Group[]) {\n",
  `function createMountain(cell: Cell) {\n  const group = new THREE.Group()\n  const ridge = cell.tags.includes('Ridge')\n  const rock = new THREE.MeshStandardMaterial({\n    color: ridge ? 0x555c64 : 0x626a73,\n    roughness: 0.94,\n    metalness: 0.02,\n    flatShading: true,\n  })\n  const snow = new THREE.MeshStandardMaterial({\n    color: 0xc9d3d8,\n    roughness: 0.86,\n    flatShading: true,\n  })\n  const stable = (cell.coord.x * 17 + cell.coord.y * 31) % 7\n  const peaks = ridge\n    ? [[-0.16, 0.42, -0.08, 0.3, 0.74], [0.15, 0.36, 0.1, 0.25, 0.62]]\n    : [[-0.08, 0.48, 0, 0.34, 0.88], [0.21, 0.3, 0.1, 0.22, 0.52]]\n  for (const [x, y, z, radius, height] of peaks) {\n    const peak = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 6), rock)\n    peak.position.set(x + (stable - 3) * 0.008, y, z)\n    peak.rotation.y = stable * 0.21\n    peak.castShadow = true\n    peak.receiveShadow = true\n    group.add(peak)\n\n    const cap = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.48, height * 0.28, 6), snow)\n    cap.position.set(peak.position.x, y + height * 0.36, z)\n    cap.rotation.y = peak.rotation.y\n    cap.castShadow = true\n    group.add(cap)\n  }\n  group.position.y = 0.12\n  return group\n}\n\nfunction createActorPawn(actor: Actor, billboards: THREE.Group[]) {\n`,
  'low poly mountain mesh',
)
board = replaceOnce(
  board,
  "  if (selection.card.target === 'actor') return Boolean(actorAt(state, coord))\n  return true\n",
  "  if (selection.card.target === 'actor') {\n    if (!actorAt(state, coord)) return false\n    if (selection.card.range > 1 && !hasHexLineOfSight(state, player.position, coord)) return false\n  }\n  return true\n",
  'board line of sight target filtering',
)
board = replaceOnce(
  board,
  "      content.add(tile)\n\n      if (isValidTarget(state, selection, cell.coord)) {\n",
  "      content.add(tile)\n\n      if (isMountainCell(cell)) {\n        const mountain = createMountain(cell)\n        mountain.position.x = position.x\n        mountain.position.z = position.z\n        content.add(mountain)\n      }\n\n      if (isValidTarget(state, selection, cell.coord)) {\n",
  'mountain render in cell loop',
)
fs.writeFileSync(boardPath, board)

// UI: expose mountain count and legend.
const prototypePath = 'src/hex/HexPrototype.tsx'
let prototype = fs.readFileSync(prototypePath, 'utf8')
prototype = replaceOnce(
  prototype,
  "} from './hexRoom'\n",
  "} from './hexRoom'\nimport { countMountainCells } from './hexTerrain'\n",
  'prototype mountain import',
)
prototype = replaceOnce(
  prototype,
  "import './hex-room.css'\n",
  "import './hex-room.css'\nimport './hex-mountain.css'\n",
  'mountain css import',
)
prototype = replaceOnce(
  prototype,
  "  const activeCellCount = activeScenarioCells(state).length\n",
  "  const activeCellCount = activeScenarioCells(state).length\n  const mountainCellCount = countMountainCells(state)\n",
  'mountain count state',
)
prototype = replaceOnce(
  prototype,
  "                  <div><span>理论 Cell</span><strong>{roomCellCount(roomRadius)}</strong></div>\n",
  "                  <div><span>山体碰撞</span><strong>{mountainCellCount}</strong></div>\n",
  'room mountain metric',
)
prototype = replaceOnce(
  prototype,
  "              ? `${activeCellCount} 个有效 Cell；用同一套卡牌、Actor 和环境规则比较房间尺寸。`\n",
  "              ? `${activeCellCount} 个有效 Cell、${mountainCellCount} 个山体；比较隘口、侧翼和视线。`\n",
  'room mountain comparison text',
)
prototype = replaceOnce(
  prototype,
  "<span><i className=\"cloud\" />Ground / Sky 连续共享</span></div>\n",
  "<span><i className=\"cloud\" />Ground / Sky 连续共享</span><span className=\"hex-collision-legend\"><i />山体：阻挡移动 / 击退 / 直线</span></div>\n",
  'mountain board legend',
)
fs.writeFileSync(prototypePath, prototype)
