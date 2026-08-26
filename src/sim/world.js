import { axialDistance, axialKey, createHexBoard } from './hex.js'

const sameHex = (a, b) => a.q === b.q && a.r === b.r

function featureCells(radius) {
  const inner = Math.max(1, radius - 2)
  return {
    shelter: { q: -radius, r: 0 },
    fire: { q: -inner, r: inner },
    rainCloud: { q: Math.max(1, radius - 1), r: -Math.max(1, radius - 1) },
    hard: { q: 3, r: 0 },
    reflectLeft: { q: 3, r: -3 },
    reflectRight: { q: 0, r: 3 },
    westPeak: { q: -Math.max(1, radius - 1), r: 0 },
  }
}

function isCentralTestLane(q, r) {
  return axialDistance({ q, r }) <= 3
}

export function createCellWorld(radius = 7) {
  const features = featureCells(radius)
  return createHexBoard(radius).map(({ q, r }) => {
    const distance = axialDistance({ q, r })
    const northBand = r < 0 && distance >= Math.max(1, radius - 2)
    const southWestWater = r > 0 && q <= 0 && distance >= Math.max(1, radius - 2)
    const eastHeat = q > 0 && distance >= Math.max(1, radius - 1)

    let groundFill = 'stone'
    let groundTemp = 0
    let moisture = 1
    let skyFill = 'clear'
    let rain = false
    let wind = null
    const tags = ['Room']

    if (distance === radius) tags.push('RoomEdge')

    if (northBand) {
      groundFill = 'grass'
      moisture = 2
      groundTemp = -1
      if ((q + r) % 3 === 0) skyFill = 'cloud'
    }

    if (southWestWater) {
      groundFill = 'water'
      moisture = 2
      groundTemp = 0
    }

    if (eastHeat) groundTemp = 1

    if (sameHex({ q, r }, features.fire)) {
      groundFill = 'fire'
      groundTemp = 2
      moisture = 0
      tags.push('WeatherHazard')
    }

    if (sameHex({ q, r }, features.rainCloud)) {
      skyFill = 'cloud'
      rain = true
    }

    if (sameHex({ q, r }, features.shelter)) tags.push('Shelter')
    if (sameHex({ q, r }, features.hard)) tags.push('UT3Hard')
    if (sameHex({ q, r }, features.reflectLeft)) tags.push('UT3ReflectLeft')
    if (sameHex({ q, r }, features.reflectRight)) tags.push('UT3ReflectRight')

    // Reintroduce the old room's distant ridge/peak silhouette without putting
    // random blockers through the central impulse-test lane.
    if (!isCentralTestLane(q, r)) {
      const ridgeNW = q <= 0 && r < 0 && q + r === -Math.max(2, Math.floor(radius * 0.7))
      const ridgeSE = q >= 0 && r > 0 && q + r === Math.max(2, Math.floor(radius * 0.7))
      if ((ridgeNW || ridgeSE) && distance >= radius - 1) tags.push('Mountain', 'Ridge')
      if (sameHex({ q, r }, features.westPeak)) tags.push('Mountain', 'Peak')
    }

    return {
      q,
      r,
      key: axialKey({ q, r }),
      groundFill,
      groundTemp,
      moisture,
      skyFill,
      skyTemp: skyFill === 'cloud' && groundTemp < 0 ? -1 : groundTemp > 0 ? 1 : 0,
      rain,
      wind,
      tags,
    }
  })
}

export function cellAt(cells, hex) {
  if (!hex) return null
  const key = axialKey(hex)
  return cells.find((cell) => cell.key === key) ?? null
}

export function collisionObstaclesFromCells(cells) {
  const obstacles = cells
    .filter((cell) => cell.tags.some((tag) => ['UT3Hard', 'UT3ReflectLeft', 'UT3ReflectRight', 'Mountain'].includes(tag)))
    .map((cell) => {
      const reflector = cell.tags.includes('UT3ReflectLeft') || cell.tags.includes('UT3ReflectRight')
      return {
        id: `${cell.tags.find((tag) => tag.startsWith('UT3')) ?? 'mountain'}-${cell.key}`,
        hex: { q: cell.q, r: cell.r },
        radius: cell.tags.includes('Mountain') ? 0.42 : 0.34,
        kind: reflector ? 'reflector' : 'hard',
        // The authored hard wall is N-S. Both visible cyan reflector walls are
        // E-W: their BoxGeometry long edge is local/world X, so they must use
        // the same wall-cell pivot solver instead of falling back to the old
        // generic obstacle-surface path.
        wallAxis: cell.tags.includes('UT3Hard') ? 'NS' : reflector ? 'EW' : undefined,
      }
    })

  // Board3D's legacy wall-visibility probe records the first authored wall.
  // Preserve the N-S Hard Wall as that stable probe while still routing both
  // E-W reflector walls through their own wallAxis/pivot geometry.
  return obstacles.sort((a, b) => {
    const priority = (entry) => entry.id.startsWith('UT3Hard-') ? 0 : entry.wallAxis === 'EW' ? 1 : 2
    return priority(a) - priority(b)
  })
}
