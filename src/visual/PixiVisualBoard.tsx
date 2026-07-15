import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Point, Text } from 'pixi.js'
import {
  actorAt,
  distance,
  getPlayer,
  type Actor,
  type Cell,
  type Coord,
  type GameState,
  type GroundFill,
  type Layer,
} from '../game'
import type { VisualSelection } from './InteractiveThreeBoard'
import type { PlaybackEvent } from './visualPlayback'

const TILE_WIDTH = 68
const TILE_HEIGHT = 34
const TILE_DEPTH = 10
const temperatureColors = [0x3e7bd6, 0x5e9de0, 0x75b8ca, 0xa7a89f, 0xd3a55f, 0xdf7545, 0xef493e]
const actorColors = {
  player: 0x4ba7df,
  hunter: 0xd25463,
  elite: 0x8f62c7,
  npc: 0xd4a05a,
}

type Props = {
  state: GameState
  selectedCoord: Coord
  hoverCoord?: Coord
  selection: VisualSelection
  targetLayer: Layer
  cameraResetToken: number
  showSky: boolean
  showDebug: boolean
  event?: PlaybackEvent
  onCellClick: (coord: Coord) => void
  onCellHover?: (coord?: Coord) => void
}

type ViewState = {
  x: number
  y: number
  scale: number
}

type BobAnimation = {
  object: Container
  baseY: number
  phase: number
  amplitude: number
  speed: number
}

type FxAnimation = {
  object: Container
  startedAt: number
  duration: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function sameCoord(a?: Coord, b?: Coord) {
  return Boolean(a && b && a.x === b.x && a.y === b.y)
}

function isoPosition(coord: Coord) {
  return {
    x: (coord.x - coord.y) * TILE_WIDTH * 0.5,
    y: (coord.x + coord.y) * TILE_HEIGHT * 0.5,
  }
}

function fillColor(fill: GroundFill) {
  if (fill === 'grass') return 0x4f7748
  if (fill === 'water') return 0x316a86
  if (fill === 'ice') return 0xa5d9e7
  if (fill === 'fire') return 0x8e4937
  return 0x777b72
}

function mixColor(a: number, b: number, amount: number) {
  const mix = (shift: number) => {
    const first = (a >> shift) & 0xff
    const second = (b >> shift) & 0xff
    return Math.round(first + (second - first) * amount)
  }
  return (mix(16) << 16) | (mix(8) << 8) | mix(0)
}

function cellColor(cell: Cell) {
  const normalized = clamp(cell.groundTemp, -3, 3) + 3
  const amount = cell.groundTemp === 0 ? 0.05 : 0.22 + Math.abs(cell.groundTemp) * 0.1
  return mixColor(fillColor(cell.groundFill), temperatureColors[normalized], amount)
}

function darken(color: number, amount: number) {
  return mixColor(color, 0x08101b, amount)
}

function drawDiamond(graphics: Graphics, color: number, alpha = 1, stroke = 0x243447) {
  graphics
    .poly([0, TILE_HEIGHT * 0.5, TILE_WIDTH * 0.5, 0, 0, -TILE_HEIGHT * 0.5, -TILE_WIDTH * 0.5, 0])
    .fill({ color, alpha })
    .stroke({ color: stroke, width: 1, alpha: 0.82 })
}

function createTile(cell: Cell) {
  const group = new Container()
  const color = cellColor(cell)
  const side = new Graphics()
  side
    .poly([-TILE_WIDTH * 0.5, 0, 0, TILE_HEIGHT * 0.5, 0, TILE_HEIGHT * 0.5 + TILE_DEPTH, -TILE_WIDTH * 0.5, TILE_DEPTH])
    .fill({ color: darken(color, 0.38) })
  side
    .poly([TILE_WIDTH * 0.5, 0, 0, TILE_HEIGHT * 0.5, 0, TILE_HEIGHT * 0.5 + TILE_DEPTH, TILE_WIDTH * 0.5, TILE_DEPTH])
    .fill({ color: darken(color, 0.25) })
  const top = new Graphics()
  drawDiamond(top, color, 1, temperatureColors[clamp(cell.groundTemp, -3, 3) + 3])
  group.addChild(side, top)
  return group
}

function addGroundDetails(group: Container, cell: Cell) {
  if (cell.groundFill === 'water') {
    const water = new Graphics()
    water.ellipse(0, 2, 24, 7).fill({ color: 0x67d3e7, alpha: 0.26 })
    water.moveTo(-20, 0).lineTo(8, 7).stroke({ color: 0xa7efff, width: 1.2, alpha: 0.55 })
    group.addChild(water)
  }

  if (cell.groundFill === 'grass') {
    const grass = new Graphics()
    for (let index = 0; index < 4; index += 1) {
      const x = -18 + index * 11
      grass.poly([x - 3, 6, x, -8 - (index % 2) * 4, x + 3, 6]).fill({ color: 0x8dbc57, alpha: 0.9 })
    }
    group.addChild(grass)
  }

  if (cell.groundFill === 'ice') {
    const ice = new Graphics()
    ice.moveTo(-20, -4).lineTo(-5, 5).lineTo(2, -6).lineTo(19, 4).stroke({ color: 0xe2fbff, width: 1.2, alpha: 0.8 })
    group.addChild(ice)
  }

  if (cell.groundFill === 'fire') {
    const fire = new Graphics()
    fire.poly([-12, 7, -5, -15, 1, 5]).fill({ color: 0xff7040, alpha: 0.92 })
    fire.poly([-2, 7, 5, -20, 12, 7]).fill({ color: 0xffcc62, alpha: 0.95 })
    group.addChild(fire)
  }

  if (cell.moisture === 2 && cell.groundFill !== 'water') {
    const moisture = new Graphics().ellipse(14, 7, 10, 4).fill({ color: 0x6fc8df, alpha: 0.24 })
    group.addChild(moisture)
  }

  if (cell.tags.includes('Shelter')) {
    const beacon = new Container()
    const body = new Graphics().rect(-8, -25, 16, 26).fill({ color: 0xd7c79b }).stroke({ color: 0x6e6044, width: 1 })
    const light = new Graphics().circle(0, -30, 6).fill({ color: 0xffdf72, alpha: 0.95 })
    beacon.addChild(body, light)
    beacon.y = -4
    group.addChild(beacon)
  }
}

function makeText(text: string, size = 10, color = 0xffffff, weight: '400' | '600' | '700' = '600') {
  const label = new Text({
    text,
    style: {
      fontFamily: 'Inter, ui-sans-serif, system-ui',
      fontSize: size,
      fill: color,
      fontWeight: weight,
      align: 'center',
    },
  })
  label.anchor.set(0.5)
  return label
}

function createActor(actor: Actor) {
  const group = new Container()
  const shadow = new Graphics().ellipse(0, 4, actor.actorType === 'elite' ? 24 : 19, 8).fill({ color: 0x07101a, alpha: 0.5 })
  const base = new Graphics().ellipse(0, 0, actor.actorType === 'elite' ? 20 : 16, 8).fill({ color: actor.faction === 'enemy' ? 0x4e1720 : 0xe9d6a7 })
  const bodyScale = actor.actorType === 'elite' ? 1.15 : actor.actorType === 'hunter' ? 0.9 : 1
  const body = new Graphics()
    .poly([-12 * bodyScale, -3, -8 * bodyScale, -31 * bodyScale, 8 * bodyScale, -31 * bodyScale, 12 * bodyScale, -3])
    .fill({ color: actorColors[actor.actorType] })
    .stroke({ color: 0xf0e4c7, width: actor.faction === 'enemy' ? 0.7 : 1, alpha: 0.72 })
  const head = new Graphics().circle(0, -38 * bodyScale, 9 * bodyScale).fill({ color: actorColors[actor.actorType] })
  const glyph = makeText(actor.actorType === 'player' ? 'P' : actor.actorType === 'hunter' ? 'H' : actor.actorType === 'elite' ? 'E' : 'N', 9, 0xffffff, '700')
  glyph.y = -38 * bodyScale

  group.addChild(shadow, base, body, head, glyph)

  if (actor.actorType === 'player') {
    const sword = new Graphics().rect(13, -33, 4, 28).fill({ color: 0xe8f1f7 }).stroke({ color: 0x7188a0, width: 1 })
    sword.rotation = -0.25
    group.addChild(sword)
  }

  if (actor.actorType === 'elite') {
    const shield = new Graphics().roundRect(-23, -28, 12, 27, 3).fill({ color: 0xc49b47 }).stroke({ color: 0xf1d37e, width: 1 })
    group.addChild(shield)
  }

  if (actor.actorType === 'npc') {
    const frost = new Graphics().ellipse(0, -15, 21, 10).stroke({ color: 0xa9e7ff, width: 2, alpha: 0.75 })
    group.addChild(frost)
  }

  if (actor.shield > 0) {
    const shieldRing = new Graphics().ellipse(0, -16, 23, 31).stroke({ color: 0x7fd7ff, width: 2, alpha: 0.78 })
    group.addChild(shieldRing)
  }

  const barBack = new Graphics().rect(-22, -58, 44, 5).fill({ color: 0x261a1d, alpha: 0.95 })
  const ratio = clamp(actor.hp / actor.maxHp, 0, 1)
  const barFill = new Graphics().rect(-21, -57, 42 * ratio, 3).fill({ color: actor.faction === 'enemy' ? 0xf0626e : 0x70d58d })
  group.addChild(barBack, barFill)
  return group
}

function isValidTarget(state: GameState, selection: VisualSelection, coord: Coord) {
  const player = getPlayer(state)
  if (selection.kind === 'inspect') return false
  if (selection.kind === 'basic') {
    if (selection.action === 'move') return distance(player.position, coord) === 1 && !actorAt(state, coord, false)
    return distance(player.position, coord) === 1 && Boolean(actorAt(state, coord, false))
  }
  if (selection.card.target === 'self') return false
  if (distance(player.position, coord) > selection.card.range) return false
  if (selection.card.target === 'actor') return Boolean(actorAt(state, coord))
  return true
}

function nextIntentStep(from: Coord, to: Coord) {
  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) && dx !== 0) return { x: from.x + dx, y: from.y }
  return { x: from.x, y: from.y + dy }
}

function intentPath(state: GameState, actor: Actor) {
  const player = getPlayer(state)
  const path: Coord[] = [{ ...actor.position }]
  if (distance(actor.position, player.position) === 1) return [...path, { ...player.position }]
  if (actor.actorType === 'elite' && distance(actor.position, player.position) > 4) return path
  const steps = actor.actorType === 'hunter' ? 2 : 1
  let current = { ...actor.position }
  for (let index = 0; index < steps; index += 1) {
    current = nextIntentStep(current, player.position)
    path.push(current)
    if (distance(current, player.position) <= 1) {
      path.push({ ...player.position })
      break
    }
  }
  return path
}

function drawDashedPath(graphics: Graphics, points: Array<{ x: number; y: number }>, color: number) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]
    const to = points[index + 1]
    const segments = 7
    for (let segment = 0; segment < segments; segment += 2) {
      const start = segment / segments
      const end = Math.min(1, (segment + 1) / segments)
      graphics
        .moveTo(from.x + (to.x - from.x) * start, from.y + (to.y - from.y) * start)
        .lineTo(from.x + (to.x - from.x) * end, from.y + (to.y - from.y) * end)
        .stroke({ color, width: 2, alpha: 0.72 })
    }
  }
}

export function PixiVisualBoard({
  state,
  selectedCoord,
  hoverCoord,
  selection,
  targetLayer,
  cameraResetToken,
  showSky,
  showDebug,
  event,
  onCellClick,
  onCellHover,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const viewportRef = useRef<Container | null>(null)
  const sceneRef = useRef<Container | null>(null)
  const stateRef = useRef(state)
  const clickRef = useRef(onCellClick)
  const hoverRef = useRef(onCellHover)
  const viewStateRef = useRef<ViewState>({ x: 0, y: 0, scale: 1 })
  const fitViewRef = useRef<() => void>(() => undefined)
  const bobAnimationsRef = useRef<BobAnimation[]>([])
  const fxAnimationsRef = useRef<FxAnimation[]>([])

  stateRef.current = state
  clickRef.current = onCellClick
  hoverRef.current = onCellHover

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let observer: ResizeObserver | undefined

    const boot = async () => {
      const app = new Application()
      await app.init({
        resizeTo: host,
        background: 0x101827,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio, 2),
        powerPreference: 'high-performance',
        preference: 'webgl',
      })
      if (disposed) {
        app.destroy(true)
        return
      }

      appRef.current = app
      host.replaceChildren(app.canvas)
      app.canvas.tabIndex = 0
      app.canvas.setAttribute('aria-label', 'PixiJS 2D isometric board. Drag to pan and use the wheel to zoom.')

      const viewport = new Container()
      const scene = new Container()
      viewport.addChild(scene)
      app.stage.addChild(viewport)
      viewportRef.current = viewport
      sceneRef.current = scene

      const applyView = () => {
        const view = viewStateRef.current
        viewport.position.set(view.x, view.y)
        viewport.scale.set(view.scale)
      }

      const fitView = () => {
        const current = stateRef.current
        const boardWidth = (current.config.width + current.config.height) * TILE_WIDTH * 0.5 + 160
        const boardHeight = (current.config.width + current.config.height) * TILE_HEIGHT * 0.5 + 190
        const scale = clamp(Math.min(app.screen.width / boardWidth, app.screen.height / boardHeight) * 0.95, 0.42, 1.45)
        viewStateRef.current = { x: app.screen.width * 0.5, y: Math.max(45, app.screen.height * 0.1), scale }
        applyView()
      }
      fitViewRef.current = fitView
      fitView()
      observer = new ResizeObserver(fitView)
      observer.observe(host)

      const pointerToLocal = (eventValue: PointerEvent) => {
        const rect = app.canvas.getBoundingClientRect()
        const screenPoint = new Point(
          (eventValue.clientX - rect.left) * app.screen.width / Math.max(1, rect.width),
          (eventValue.clientY - rect.top) * app.screen.height / Math.max(1, rect.height),
        )
        return viewport.toLocal(screenPoint)
      }

      const findCoord = (eventValue: PointerEvent) => {
        const local = pointerToLocal(eventValue)
        let closest: Coord | undefined
        let closestDistance = Number.POSITIVE_INFINITY
        for (const cell of stateRef.current.cells) {
          const point = isoPosition(cell.coord)
          const diamondDistance = Math.abs(local.x - point.x) / (TILE_WIDTH * 0.5) + Math.abs(local.y - point.y) / (TILE_HEIGHT * 0.5)
          if (diamondDistance <= 1 && diamondDistance < closestDistance) {
            closest = cell.coord
            closestDistance = diamondDistance
          }
        }
        return closest
      }

      const drag = { active: false, pointerId: -1, lastX: 0, lastY: 0, startX: 0, startY: 0, moved: false }
      const handlePointerDown = (eventValue: PointerEvent) => {
        if (eventValue.button !== 0) return
        app.canvas.focus({ preventScroll: true })
        drag.active = true
        drag.pointerId = eventValue.pointerId
        drag.lastX = eventValue.clientX
        drag.lastY = eventValue.clientY
        drag.startX = eventValue.clientX
        drag.startY = eventValue.clientY
        drag.moved = false
        app.canvas.setPointerCapture(eventValue.pointerId)
        app.canvas.style.cursor = 'grabbing'
      }
      const handlePointerMove = (eventValue: PointerEvent) => {
        if (drag.active) {
          const dx = eventValue.clientX - drag.lastX
          const dy = eventValue.clientY - drag.lastY
          drag.lastX = eventValue.clientX
          drag.lastY = eventValue.clientY
          if (Math.hypot(eventValue.clientX - drag.startX, eventValue.clientY - drag.startY) > 4) drag.moved = true
          viewStateRef.current.x += dx
          viewStateRef.current.y += dy
          applyView()
          hoverRef.current?.(undefined)
          return
        }
        const coord = findCoord(eventValue)
        app.canvas.style.cursor = coord ? 'pointer' : 'grab'
        hoverRef.current?.(coord)
      }
      const handlePointerUp = (eventValue: PointerEvent) => {
        if (!drag.active || drag.pointerId !== eventValue.pointerId) return
        const moved = drag.moved
        drag.active = false
        app.canvas.releasePointerCapture(eventValue.pointerId)
        if (!moved) {
          const coord = findCoord(eventValue)
          if (coord) clickRef.current(coord)
        }
        app.canvas.style.cursor = 'grab'
      }
      const handlePointerLeave = () => {
        if (!drag.active) hoverRef.current?.(undefined)
      }
      const handleWheel = (eventValue: WheelEvent) => {
        eventValue.preventDefault()
        viewStateRef.current.scale = clamp(viewStateRef.current.scale * Math.exp(-eventValue.deltaY * 0.0012), 0.32, 2.25)
        applyView()
      }

      app.canvas.style.cursor = 'grab'
      app.canvas.style.touchAction = 'none'
      app.canvas.addEventListener('pointerdown', handlePointerDown)
      app.canvas.addEventListener('pointermove', handlePointerMove)
      app.canvas.addEventListener('pointerup', handlePointerUp)
      app.canvas.addEventListener('pointercancel', handlePointerUp)
      app.canvas.addEventListener('pointerleave', handlePointerLeave)
      app.canvas.addEventListener('wheel', handleWheel, { passive: false })

      app.ticker.add(() => {
        const now = performance.now()
        const seconds = now * 0.001
        for (const animation of bobAnimationsRef.current) {
          animation.object.y = animation.baseY + Math.sin(seconds * animation.speed + animation.phase) * animation.amplitude
        }
        fxAnimationsRef.current = fxAnimationsRef.current.filter((animation) => {
          const progress = Math.min(1, (now - animation.startedAt) / animation.duration)
          animation.object.scale.set(0.55 + progress * 1.25)
          animation.object.alpha = 1 - progress
          animation.object.y -= 0.18
          if (progress >= 1) {
            animation.object.parent?.removeChild(animation.object)
            animation.object.destroy({ children: true })
            return false
          }
          return true
        })
      })

      return () => {
        app.canvas.removeEventListener('pointerdown', handlePointerDown)
        app.canvas.removeEventListener('pointermove', handlePointerMove)
        app.canvas.removeEventListener('pointerup', handlePointerUp)
        app.canvas.removeEventListener('pointercancel', handlePointerUp)
        app.canvas.removeEventListener('pointerleave', handlePointerLeave)
        app.canvas.removeEventListener('wheel', handleWheel)
      }
    }

    let detach: (() => void) | undefined
    void boot().then((cleanup) => { detach = cleanup })

    return () => {
      disposed = true
      observer?.disconnect()
      detach?.()
      appRef.current?.destroy(true)
      appRef.current = null
      viewportRef.current = null
      sceneRef.current = null
      host.replaceChildren()
    }
  }, [])

  useEffect(() => {
    fitViewRef.current()
  }, [cameraResetToken])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const removed = scene.removeChildren()
    for (const child of removed) child.destroy({ children: true })
    bobAnimationsRef.current = []
    fxAnimationsRef.current = []

    const groundLayer = new Container()
    const telegraphLayer = new Container()
    const actorLayer = new Container({ sortableChildren: true })
    const skyLayer = new Container({ sortableChildren: true })
    const fxLayer = new Container()
    scene.addChild(groundLayer, telegraphLayer, actorLayer, skyLayer, fxLayer)

    for (const cell of state.cells) {
      const position = isoPosition(cell.coord)
      const tile = createTile(cell)
      tile.position.set(position.x, position.y)
      addGroundDetails(tile, cell)
      groundLayer.addChild(tile)

      if (sameCoord(cell.coord, selectedCoord)) {
        const selected = new Graphics()
        drawDiamond(selected, 0xf7d06e, 0.12, 0xf7d06e)
        selected.position.set(position.x, position.y - 1)
        telegraphLayer.addChild(selected)
      }

      if (isValidTarget(state, selection, cell.coord)) {
        const color = selection.kind === 'basic' && selection.action === 'attack'
          ? 0xf05b68
          : selection.kind === 'card' && selection.card.effect.includes('cool')
            ? 0x57bfff
            : selection.kind === 'card' && (selection.card.effect.includes('heat') || selection.card.effect === 'grip')
              ? 0xff8a45
              : 0x64d7a1
        const overlay = new Graphics()
        drawDiamond(overlay, color, targetLayer === 'sky' ? 0.12 : 0.22, color)
        overlay.position.set(position.x, position.y - (targetLayer === 'sky' ? 56 : 2))
        telegraphLayer.addChild(overlay)
      }

      if (showSky && cell.skyFill === 'cloud') {
        const cloud = new Container()
        const shadow = new Graphics().ellipse(0, 64, 25, 9).fill({ color: 0x16243a, alpha: 0.24 })
        const cloudBody = new Graphics()
        cloudBody.circle(-15, 1, 14).fill({ color: cell.skyTemp > 0 ? 0xffdcc3 : cell.skyTemp < 0 ? 0xd7ecff : 0xf1f2ec, alpha: 0.88 })
        cloudBody.circle(3, -7, 18).fill({ color: cell.skyTemp > 0 ? 0xffdcc3 : cell.skyTemp < 0 ? 0xd7ecff : 0xf1f2ec, alpha: 0.9 })
        cloudBody.circle(21, 2, 12).fill({ color: cell.skyTemp > 0 ? 0xffdcc3 : cell.skyTemp < 0 ? 0xd7ecff : 0xf1f2ec, alpha: 0.86 })
        cloud.addChild(shadow, cloudBody)
        cloud.position.set(position.x, position.y - 68)
        cloud.alpha = sameCoord(cell.coord, hoverCoord ?? selectedCoord) ? 0.3 : 0.9
        cloud.zIndex = position.y
        skyLayer.addChild(cloud)
        bobAnimationsRef.current.push({ object: cloud, baseY: cloud.y, phase: cell.coord.x + cell.coord.y * 0.6, amplitude: 3.5, speed: 1.25 })
      }

      if (showSky && cell.wind) {
        const wind = new Container()
        const arrow = new Graphics().moveTo(-18, 0).lineTo(15, 0).stroke({ color: 0xc7ecff, width: 2, alpha: 0.78 })
        arrow.poly([15, -5, 25, 0, 15, 5]).fill({ color: 0xc7ecff, alpha: 0.8 })
        const rotations = { E: 0, S: Math.PI * 0.5, W: Math.PI, N: -Math.PI * 0.5 }
        arrow.rotation = rotations[cell.wind]
        wind.addChild(arrow)
        wind.position.set(position.x, position.y - 44)
        wind.zIndex = position.y + 1
        skyLayer.addChild(wind)
      }

      if (showSky && cell.intents.some((intent) => intent.type === 'rain')) {
        const rain = new Container()
        for (let index = 0; index < 6; index += 1) {
          const drop = new Graphics().rect(-1, 0, 2, 13).fill({ color: 0x83ddff, alpha: 0.65 })
          drop.position.set(-22 + index * 9, 8 + (index % 2) * 7)
          rain.addChild(drop)
        }
        rain.position.set(position.x, position.y - 57)
        rain.zIndex = position.y + 2
        skyLayer.addChild(rain)
      }

      if (showDebug) {
        const debug = makeText(`G${cell.groundTemp} S${cell.skyTemp}`, 8, 0xeef5ff, '600')
        debug.position.set(position.x, position.y + 9)
        telegraphLayer.addChild(debug)
      }
    }

    const player = getPlayer(state)
    if (selection.kind === 'basic' && selection.action === 'move' && hoverCoord && isValidTarget(state, selection, hoverCoord)) {
      const from = isoPosition(player.position)
      const to = isoPosition(hoverCoord)
      const path = new Graphics()
      drawDashedPath(path, [from, to], 0x76e5b0)
      const marker = new Graphics().circle(to.x, to.y - 2, 5).fill({ color: 0x76e5b0, alpha: 0.9 })
      telegraphLayer.addChild(path, marker)
    }

    for (const actor of state.actors.filter((entry) => entry.alive && entry.faction === 'enemy')) {
      const pathCoords = intentPath(state, actor)
      if (pathCoords.length <= 1) continue
      const points = pathCoords.map(isoPosition)
      const path = new Graphics()
      drawDashedPath(path, points, 0xff6572)
      telegraphLayer.addChild(path)
      const target = points[points.length - 1]
      const arrow = new Graphics().poly([target.x, target.y - 7, target.x + 8, target.y, target.x, target.y + 7]).fill({ color: 0xff6572, alpha: 0.86 })
      telegraphLayer.addChild(arrow)
      if (sameCoord(pathCoords[pathCoords.length - 1], player.position)) {
        const danger = new Graphics()
        drawDiamond(danger, 0xff4d5d, 0.15, 0xff6572)
        danger.position.set(target.x, target.y - 1)
        telegraphLayer.addChild(danger)
      }
    }

    for (const actor of state.actors.filter((entry) => entry.alive)) {
      const position = isoPosition(actor.position)
      const pawn = createActor(actor)
      pawn.position.set(position.x, position.y - 4)
      pawn.zIndex = position.y
      actorLayer.addChild(pawn)
      bobAnimationsRef.current.push({ object: pawn, baseY: pawn.y, phase: actor.position.x * 0.7 + actor.position.y, amplitude: 1.2, speed: 2 })
    }

    if (event?.target) {
      const position = isoPosition(event.target)
      const fx = new Container()
      const color = event.kind === 'cool' ? 0x5cc7ff : event.kind === 'heat' ? 0xff814b : event.kind === 'attack' ? 0xff4e5d : event.kind === 'guard' ? 0x73d9ff : 0x73e6ac
      const pulse = new Graphics().ellipse(0, 0, 22, 10).stroke({ color, width: 3, alpha: 0.9 })
      fx.addChild(pulse)
      if (event.kind === 'attack') {
        const slash = new Graphics().moveTo(-20, 12).lineTo(18, -20).stroke({ color: 0xffffff, width: 4, alpha: 0.9 })
        fx.addChild(slash)
      }
      if (event.amount) {
        const label = makeText(`${event.kind === 'attack' ? '-' : '+'}${event.amount}`, 18, color, '700')
        label.y = -30
        fx.addChild(label)
      }
      fx.position.set(position.x, position.y - 12)
      fxLayer.addChild(fx)
      fxAnimationsRef.current.push({ object: fx, startedAt: performance.now(), duration: 720 })
    }
  }, [state, selectedCoord.x, selectedCoord.y, hoverCoord?.x, hoverCoord?.y, selection, targetLayer, showSky, showDebug, event])

  return <div className="pixi-visual-host" ref={hostRef} aria-label="PixiJS 2D visual slice" />
}
