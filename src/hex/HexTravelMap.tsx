import { useMemo } from 'react'
import { getPlayer, type Cell, type Coord, type GameState } from '../game'
import { hexDistance, hexWorldOffset } from './hexTopology'
import { travelCellRisk, type TravelPreference } from './hexTravel'

const RADIUS = 18
const keyOf = (coord: Coord) => `${coord.x},${coord.y}`
const sameCoord = (a?: Coord, b?: Coord) => Boolean(a && b && a.x === b.x && a.y === b.y)

export type HexTravelMapProps = {
  state: GameState
  path: Coord[]
  selectedCoord: Coord
  hoverCoord?: Coord
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
  if (cell.tags.includes('Shelter')) return 'S'
  if (cell.tags.includes('Objective')) return 'O'
  if (cell.tags.includes('Resource')) return 'R'
  if (cell.tags.includes('NarrowPass')) return '!'
  if (cell.tags.includes('SafePass')) return 'A'
  if (cell.tags.includes('Watchtower')) return 'T'
  return ''
}

export function HexTravelMap(props: HexTravelMapProps) {
  const { state, path, selectedCoord, hoverCoord, preference, onCellClick, onCellHover } = props
  const player = getPlayer(state)
  const pathKeys = useMemo(() => new Set(path.map(keyOf)), [path])
  const positions = useMemo(() => state.cells.map((cell) => hexCenter(cell.coord)), [state.cells])
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
    <div className="hex-travel-map-host">
      <svg viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="连续 Hex6 旅行地图">
        <g className="hex-travel-cells">
          {state.cells.map((cell) => {
            const center = hexCenter(cell.coord)
            const selected = sameCoord(cell.coord, selectedCoord)
            const hovered = sameCoord(cell.coord, hoverCoord)
            const onPath = pathKeys.has(keyOf(cell.coord))
            const fogDistance = hexDistance(player.position, cell.coord)
            const risk = travelCellRisk(cell)
            const label = landmarkLabel(cell)
            return (
              <g key={keyOf(cell.coord)} className={`hex-travel-cell ${selected ? 'selected' : ''} ${hovered ? 'hovered' : ''} ${onPath ? 'path' : ''} ${risk > 0 ? 'risky' : ''}`} onClick={() => onCellClick(cell.coord)} onMouseEnter={() => onCellHover?.(cell.coord)} onMouseLeave={() => onCellHover?.(undefined)}>
                <polygon points={polygonPoints(cell.coord)} fill={cellFill(cell)} opacity={fogDistance > 5 ? 0.48 : 0.96} />
                {cell.skyFill === 'cloud' && <circle cx={center.x + 7} cy={center.y - 7} r="5" className="hex-travel-cloud" />}
                {cell.intents.some((intent) => intent.type === 'rain') && <path d={`M ${center.x - 7} ${center.y - 4} l -3 7 M ${center.x} ${center.y - 4} l -3 7 M ${center.x + 7} ${center.y - 4} l -3 7`} className="hex-travel-rain" />}
                {label && <text x={center.x} y={center.y + 5} className="hex-travel-landmark">{label}</text>}
              </g>
            )
          })}
        </g>
        {path.length > 1 && <g className={`hex-travel-path ${preference}`}><polyline points={pathPoints} />{path.slice(1).map((coord, index) => { const center = hexCenter(coord); return <circle key={`${keyOf(coord)}-${index}`} cx={center.x} cy={center.y} r={index === path.length - 2 ? 5 : 2.8} /> })}</g>}
        <g className="hex-travel-actors">
          {state.actors.filter((actor) => actor.alive).map((actor) => {
            const center = hexCenter(actor.position)
            return <g key={actor.id} className={`hex-travel-actor ${actor.faction}`}><circle cx={center.x} cy={center.y} r={actor.actorType === 'elite' ? 8 : 6} /><text x={center.x} y={center.y + 3}>{actor.actorType === 'player' ? 'P' : actor.actorType === 'elite' ? 'E' : actor.actorType === 'npc' ? 'N' : 'H'}</text></g>
          })}
        </g>
      </svg>
    </div>
  )
}
