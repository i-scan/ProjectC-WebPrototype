import { axialDistance, axialKey, createHexBoard } from './hex.js'

const terrainPalette = ['grass', 'grass', 'grass', 'stone', 'water', 'ice']

function hash(q, r, salt = 0) {
  const value = Math.sin((q * 127.1 + r * 311.7 + salt * 74.7) * 0.0174533) * 43758.5453
  return value - Math.floor(value)
}

function isSpawnSafe(q, r) {
  return axialDistance({ q, r }) <= 1
}

function terrainFor(q, r, radius) {
  if (isSpawnSafe(q, r)) return 'grass'
  const distance = axialDistance({ q, r })
  const noise = hash(q, r, 3)
  if (q === 2 && r === -2) return 'fire'
  if (q <= -Math.max(2, Math.floor(radius * 0.45)) && noise > 0.38) return 'ice'
  if (r >= Math.max(2, Math.floor(radius * 0.45)) && noise > 0.32) return 'water'
  if (distance >= radius - 1 && noise > 0.48) return 'stone'
  return terrainPalette[Math.floor(hash(q, r, 1) * terrainPalette.length)] ?? 'grass'
}

function tagsFor(q, r, terrain) {
  const tags = []
  if (!isSpawnSafe(q, r) && terrain === 'stone' && hash(q, r, 7) > 0.58) tags.push('Mountain')
  if (q === -1 && r === 2) tags.push('Shelter')
  if (q === 3 && r === 0) tags.push('UT3Hard')
  if (q === 2 && r === -2) tags.push('UT3ReflectLeft')
  if (q === 1 && r === 3) tags.push('UT3ReflectRight')
  return tags
}

export function createCellWorld(radius = 7) {
  return createHexBoard(radius).map(({ q, r }) => {
    const terrain = terrainFor(q, r, radius)
    const spawnSafe = isSpawnSafe(q, r)
    const moisture = spawnSafe ? 0 : terrain === 'water' ? 2 : hash(q, r, 5) > 0.73 ? 2 : hash(q, r, 9) > 0.45 ? 1 : 0
    const groundTemp = spawnSafe ? 0 : terrain === 'fire' ? 3 : terrain === 'ice' ? -3 : Math.round((hash(q, r, 11) - 0.5) * 4)
    const skyNoise = hash(q, r, 13)
    const skyFill = spawnSafe ? 'clear' : skyNoise > 0.7 ? 'cloud' : 'clear'
    const rain = !spawnSafe && skyFill === 'cloud' && moisture > 0 && hash(q, r, 15) > 0.58
    const wind = ['E', 'NE', 'NW', 'W', 'SW', 'SE'][Math.floor(hash(q, r, 17) * 6)]
    return {
      q,
      r,
      key: axialKey({ q, r }),
      groundFill: terrain,
      groundTemp,
      moisture,
      skyFill,
      skyTemp: Math.max(-2, Math.min(2, groundTemp + (hash(q, r, 19) > 0.5 ? 1 : 0))),
      rain,
      wind,
      tags: tagsFor(q, r, terrain),
    }
  })
}

export function cellAt(cells, hex) {
  if (!hex) return null
  const key = axialKey(hex)
  return cells.find((cell) => cell.key === key) ?? null
}

export function collisionObstaclesFromCells(cells) {
  return cells
    .filter((cell) => cell.tags.some((tag) => ['UT3Hard', 'UT3ReflectLeft', 'UT3ReflectRight', 'Mountain'].includes(tag)))
    .map((cell) => ({
      id: `${cell.tags.find((tag) => tag.startsWith('UT3')) ?? 'mountain'}-${cell.key}`,
      hex: { q: cell.q, r: cell.r },
      radius: cell.tags.includes('Mountain') ? 0.42 : 0.34,
      kind: cell.tags.includes('UT3ReflectLeft') || cell.tags.includes('UT3ReflectRight') ? 'reflector' : 'hard',
    }))
}
