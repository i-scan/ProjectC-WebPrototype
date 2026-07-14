import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { BenchmarkProfile } from './benchmark'
import { temperatureColor } from './benchmark'

type Props = {
  profile: BenchmarkProfile
  running: boolean
}

export function PixiBenchmark({ profile, running }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let app: Application | null = null
    let observer: ResizeObserver | null = null

    const boot = async () => {
      const nextApp = new Application()
      await nextApp.init({
        resizeTo: host,
        background: 0x101827,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio, 2),
        powerPreference: 'high-performance',
        preference: 'webgl',
      })

      if (disposed) {
        nextApp.destroy(true)
        return
      }

      app = nextApp
      host.replaceChildren(nextApp.canvas)

      const board = new Container()
      const weather = new Container()
      const actors = new Container()
      nextApp.stage.addChild(board, actors, weather)

      const tileGraphic = new Graphics()
        .poly([0, 14, 28, 0, 56, 14, 28, 28])
        .fill({ color: 0xffffff })
        .stroke({ color: 0x243447, width: 1 })
      const tileTexture = nextApp.renderer.generateTexture(tileGraphic)
      tileGraphic.destroy()

      const actorGraphic = new Graphics()
        .circle(8, 8, 7)
        .fill({ color: 0xffffff })
        .stroke({ color: 0xe8edf5, width: 1 })
      const actorTexture = nextApp.renderer.generateTexture(actorGraphic)
      actorGraphic.destroy()

      const particleGraphic = new Graphics().circle(2, 2, 2).fill({ color: 0xffffff })
      const particleTexture = nextApp.renderer.generateTexture(particleGraphic)
      particleGraphic.destroy()

      const tileSprites: Sprite[] = []
      const actorSprites: Sprite[] = []
      const particleSprites: Sprite[] = []

      for (let index = 0; index < profile.tiles; index += 1) {
        const x = index % profile.side
        const y = Math.floor(index / profile.side)
        const sprite = new Sprite(tileTexture)
        sprite.anchor.set(0.5)
        sprite.x = (x - y) * 28
        sprite.y = (x + y) * 14
        sprite.tint = temperatureColor(index)
        tileSprites.push(sprite)
        board.addChild(sprite)
      }

      for (let index = 0; index < profile.actors; index += 1) {
        const x = (index * 17) % profile.side
        const y = (index * 31) % profile.side
        const sprite = new Sprite(actorTexture)
        sprite.anchor.set(0.5, 1)
        sprite.x = (x - y) * 28
        sprite.y = (x + y) * 14 - 4
        sprite.tint = index % 4 === 0 ? 0x55a5d9 : index % 3 === 0 ? 0xc55b67 : 0xe7b45c
        actorSprites.push(sprite)
        actors.addChild(sprite)
      }

      for (let index = 0; index < profile.particles; index += 1) {
        const sprite = new Sprite(particleTexture)
        sprite.anchor.set(0.5)
        sprite.alpha = 0.2 + (index % 5) * 0.12
        sprite.tint = index % 4 === 0 ? 0xbfdff8 : 0xe7f3ff
        particleSprites.push(sprite)
        weather.addChild(sprite)
      }

      const fitScene = () => {
        const width = Math.max(1, nextApp.screen.width)
        const height = Math.max(1, nextApp.screen.height)
        const boardWidth = profile.side * 56
        const boardHeight = profile.side * 28
        const scale = Math.min(width / boardWidth, height / boardHeight) * 0.83
        const originX = width * 0.5
        const originY = Math.max(30, height * 0.08)

        board.scale.set(scale)
        actors.scale.set(scale)
        board.position.set(originX, originY)
        actors.position.set(originX, originY)
      }

      fitScene()
      observer = new ResizeObserver(fitScene)
      observer.observe(host)

      let frame = 0
      const tick = () => {
        const time = performance.now()
        const updateCount = Math.max(1, Math.floor(tileSprites.length * profile.updateRatio))

        for (let offset = 0; offset < updateCount; offset += 1) {
          const index = (offset + frame * 13) % tileSprites.length
          tileSprites[index].tint = temperatureColor(index, time)
        }

        actorSprites.forEach((sprite, index) => {
          sprite.scale.y = 1 + Math.sin(time * 0.004 + index) * 0.08
        })

        const width = nextApp.screen.width
        const height = nextApp.screen.height
        particleSprites.forEach((sprite, index) => {
          sprite.x = (index * 37 + time * (0.015 + (index % 5) * 0.004)) % Math.max(width, 1)
          sprite.y = (index * 53 + Math.sin(time * 0.001 + index) * 42 + height) % Math.max(height, 1)
        })

        frame += 1
      }

      if (running) nextApp.ticker.add(tick)
      else nextApp.render()
    }

    void boot()

    return () => {
      disposed = true
      observer?.disconnect()
      if (app) {
        app.destroy(true)
      }
      host.replaceChildren()
    }
  }, [profile, running])

  return (
    <div className="benchmark-stage pixi-benchmark">
      <div className="canvas-host" ref={hostRef} />
      <div className="benchmark-caption">
        PixiJS WebGL：批量 Sprite 绘制等轴测地块、Actor 与天气粒子。
      </div>
    </div>
  )
}
