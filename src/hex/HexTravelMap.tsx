import { useMemo } from 'react'
import { actorAt, cellAt, getPlayer, type Cell, type Coord, type GameState, type Layer } from '../game'
import type { HexBoardSelection } from './HexThreeBoard'
import { buildHexPath, hexDistance } from './hexRules'
import { isVoidCell } from './hexRoom'
import { hasHexLineOfSight, isMountainCell } from './hexTerrain'
import { hexWorldOffset } from './hexTopology'
import { travelCellRisk, type HexMode, type TravelPreference } from './hexTravel'

const RADIUS = 18
const keyOf = (coord: Coord) => `${coord.x},${coord.y}`
const sameCoord = (a?: Coord, b?: Coord) => Boolean(a && b && a.x === b.x && a.y === b.y)

export type HexTravelMapProps = {
  state: GameState
  mode: HexMode
  path: Coord[]
  selectedCoord: Coord
  hoverCoord?: Coord
  selection: HexBoardSelection
  targetLayer: Layer
  preference: TravelPreference
  onCellClick: (coord: Coord) => void
  onCellHover?: (coord?: Coord) => void
}

function hexCenter(coord: Coord) {
  const offset = hexWorldOffset(coord, RADIUS)
  return { x: offset.x, y: offset.z }
}

function polygonPoints(coord: Coord) {
  const center = hexCenter(coord)
  return Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI * 0.5 - index * Math.PI / 3
    return `${center.x + Math.cos(angle) * RADIUS},${center.y + Math.sin(angle) * RADIUS}`
  }).join(' ')
}

function cellFill(cell: Cell) {
  if (isMountainCell(cell)) return '#4b5058'
  if (cell.tags.includes('Blocked')) return '#2d3440'
  if (cell.groundFill === 'fire') return '#a95036'
  if (cell.groundFill === 'water') return '#327892'
  if (cell.groundFill === 'ice') return '#a6dce8'
  if (cell.groundFill === 'grass') return '#4e7950'
  if (cell.groundTemp >= 2) return '#9a6944'
  if (cell.groundTemp <= -1) return '#587b94'
  return '#657467'
}

function landmarkLabel(cell: Cell) {
  if (cell.tags.includes('UT3Hard')) return '■'
  if (cell.tags.includes('UT3ReflectLeft')) return '↰'
  if (cell.tags.includes('UT3ReflectRight')) return '↱'
  if (cell.tags.includes('Shelter')) return 'S'
  if (cell.tags.includes('Objective')) return 'O'
  if (cell.tags.includes('Resource')) return 'R'
  if (cell.tags.includes('NarrowPass')) return '!'
  if (cell.tags.includes('SafePass')) return 'A'
  if (cell.tags.includes('Watchtower')) return 'T'
  return ''
}

function isValidTacticalTarget(state: GameState, selection: HexBoardSelection, coord: Coord) {
  const cell = cellAt(state, coord)
  if (!cell || isVoidCell(cell) || cell.tags.includes('Blocked')) return false
  const player = getPlayer(state)
  if (selection.kind === 'inspect') return false
  if (selection.kind === 'momentum') return selection.validCoords.some((target) => sameCoord(target, coord))
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

function MountainGlyph({ center, ridge }: { center: { x: number; y: number }; ridge: boolean }) {
  const mainPeak = `M ${center.x - 11} ${center.y + 8} L ${center.x - 2} ${center.y - 9} L ${center.x + 8} ${center.y + 8} Z`
  const sidePeak = `M ${center.x - 2} ${center.y + 8} L ${center.x + 6} ${center.y - 3} L ${center.x + 13} ${center.y + 8} Z`
  return (
    <g className={`hex-travel-mountain ${ridge ? 'ridge' : 'peak'}`} aria-hidden="true">
      <path d={mainPeak} />
      <path d={sidePeak} />
      <path className="snow" d={`M ${center.x - 5} ${center.y - 3} L ${center.x - 2} ${center.y - 9} L ${center.x + 2} ${center.y - 2} L ${center.x} ${center.y} Z`} />
    </g>
  )
}

export function HexTravelMap(props: HexTravelMapProps) {
  const {
    state,
    mode,
    path,
    selectedCoord,
    hoverCoord,
    selection,
    targetLayer,
    preference,
    onCellClick,
    onCellHover,
  } = props
  const player = getPlayer(state)
  const visibleCells = useMemo(() => state.cells.filter((cell) => !isVoidCell(cell)), [state.cells])
  const pathKeys = useMemo(() => new Set(path.map(keyOf)), [path])
  const positions = useMemo(() => visibleCells.map((cell) => hexCenter(cell.coord)), [visibleCells])
  const bounds = useMemo(() => {
    const xs = positions.map((position) => position.x)
    const ys = positions.map((position) => position.y)
    return {
      minX: Math.min(...xs) - RADIUS * 1.4,
      minY: Math.min(...ys) - RADIUS * 1.4,
      width: Math.max(...xs) - Math.min(...xs) + RADIUS * 2.8,
      height: Math.max(...ys) - Math.min(...ys) + RADIUS * 2.8,
    }
  }, [positions])
  const pathPoints = path.map((coord) => {
    const center = hexCenter(coord)
    return `${center.x},${center.y}`
  }).join(' ')

  return (
    <div className={`hex-travel-map-host mode-${mode}`}>
      <svg viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Hex6 ${mode === 'travel' ? '旅行' : '战术'}二维地图`}>
        <g className="hex-travel-cells">
          {visibleCells.map((cell) => {
            const center = hexCenter(cell.coord)
            const selected = sameCoord(cell.coord, selectedCoord)
            const hovered = sameCoord(cell.coord, hoverCoord)
            const onPath = pathKeys.has(keyOf(cell.coord))
            const fogDistance = hexDistance(player.position, cell.coord)
            const risk = travelCellRisk(cell)
            const label = landmarkLabel(cell)
            const mountain = isMountainCell(cell)
            const validTarget = mode === 'tactical' && isValidTacticalTarget(state, selection, cell.coord)
            const targetKind = selection.kind === 'momentum'
              ? selection.action === 'drive' ? 'drive' : 'rush'
              : selection.kind === 'basic'
              ? selection.action
              : selection.kind === 'card'
                ? selection.card.effect.includes('cool') ? 'cool' : selection.card.effect.includes('heat') || selection.card.effect === 'grip' ? 'heat' : 'card'
                : 'inspect'
            return (
              <g
                key={keyOf(cell.coord)}
                data-x={cell.coord.x}
                data-y={cell.coord.y}
                className={`hex-travel-cell ${mountain ? 'mountain' : ''} ${cell.tags.includes('RoomEdge') ? 'room-edge' : ''} ${selected ? 'selected' : ''} ${hovered ? 'hovered' : ''} ${onPath ? 'path' : ''} ${risk > 0 ? 'risky' : ''} ${validTarget ? `valid-target ${targetKind} layer-${targetLayer}` : ''}`}
                onClick={() => onCellClick(cell.coord)}
                onMouseEnter={() => onCellHover?.(cell.coord)}
                onMouseLeave={() => onCellHover?.(undefined)}
              >
                <polygon points={polygonPoints(cell.coord)} fill={cellFill(cell)} opacity={mode === 'travel' && fogDistance > 5 ? 0.48 : 0.96} />
                {mountain && <MountainGlyph center={center} ridge={cell.tags.includes('Ridge')} />}
                {!mountain && cell.skyFill === 'cloud' && <circle cx={center.x + 7} cy={center.y - 7} r="5" className="hex-travel-cloud" />}
                {!mountain && cell.intents.some((intent) => intent.type === 'rain') && <path d={`M ${center.x - 7} ${center.y - 4} l -3 7 M ${center.x} ${center.y - 4} l -3 7 M ${center.x + 7} ${center.y - 4} l -3 7`} className="hex-travel-rain" />}
                {label && <text x={center.x} y={center.y + 5} className="hex-travel-landmark">{label}</text>}
              </g>
            )
          })}
        </g>

        {path.length > 1 && (
          <g className={`hex-travel-path ${preference} ${mode === 'tactical' ? 'planned' : ''}`}>
            <polyline points={pathPoints} />
            {path.slice(1).map((coord, index) => {
              const center = hexCenter(coord)
              return <circle key={`${keyOf(coord)}-${index}`} cx={center.x} cy={center.y} r={index === path.length - 2 ? 5 : 2.8} />
            })}
          </g>
        )}

        {mode === 'tactical' && (
          <g className="hex-2d-intents">
            {state.actors.filter((actor) => actor.alive && actor.faction === 'enemy').map((actor) => {
              const steps = actor.actorType === 'hunter' ? 2 : 1
              const intentPath = buildHexPath(state, actor.position, player.position, steps, actor.id)
              if (intentPath.length <= 1) return null
              const intentPoints = intentPath.map((coord) => {
                const center = hexCenter(coord)
                return `${center.x},${center.y}`
              }).join(' ')
              return <polyline key={actor.id} points={intentPoints} />
            })}
          </g>
        )}

        <g className="hex-travel-actors">
          {state.actors.filter((actor) => actor.alive).map((actor) => {
            const center = hexCenter(actor.position)
            return (
              <g key={actor.id} className={`hex-travel-actor ${actor.faction}`}>
                <circle cx={center.x} cy={center.y} r={actor.actorType === 'elite' ? 8 : 6} />
                <text x={center.x} y={center.y + 3}>{actor.actorType === 'player' ? 'P' : actor.actorType === 'elite' ? 'E' : actor.actorType === 'npc' ? 'N' : 'H'}</text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
