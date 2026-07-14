import { useEffect, useMemo, useRef } from 'react'
import type { BenchmarkProfile } from './benchmark'

const DOM_COLORS = ['#3b82f6', '#67c6d4', '#c8b879', '#e68a3f', '#d94a3f']

type Props = {
  profile: BenchmarkProfile
  running: boolean
}

export function DomBenchmark({ profile, running }: Props) {
  const sceneRef = useRef<HTMLDivElement>(null)
  const tiles = useMemo(() => Array.from({ length: profile.tiles }, (_, index) => index), [profile.tiles])
  const particles = useMemo(
    () => Array.from({ length: profile.particles }, (_, index) => index),
    [profile.particles],
  )
  const actors = useMemo(() => Array.from({ length: profile.actors }, (_, index) => index), [profile.actors])

  useEffect(() => {
    if (!running || !sceneRef.current) return

    const scene = sceneRef.current
    const tileElements = Array.from(scene.querySelectorAll<HTMLElement>('[data-dom-tile]'))
    const particleElements = Array.from(scene.querySelectorAll<HTMLElement>('[data-dom-particle]'))
    const actorElements = Array.from(scene.querySelectorAll<HTMLElement>('[data-dom-actor]'))
    const updateCount = Math.max(1, Math.floor(tileElements.length * profile.updateRatio))
    let frame = 0
    let animationFrame = 0

    const animate = (time: number) => {
      for (let offset = 0; offset < updateCount; offset += 1) {
        const index = (offset + frame * 13) % tileElements.length
        const tile = tileElements[index]
        const wave = Math.sin(index * 0.37 + time * 0.0015)
        const colorIndex = Math.max(0, Math.min(4, Math.floor((wave + 1) * 2.5)))
        tile.style.backgroundColor = DOM_COLORS[colorIndex]
        tile.style.filter = wave > 0.72 ? 'brightness(1.24)' : 'none'
      }

      particleElements.forEach((particle, index) => {
        const x = (index * 37 + time * (0.008 + (index % 5) * 0.002)) % 100
        const y = (index * 53 + Math.sin(time * 0.001 + index) * 18 + 100) % 100
        particle.style.transform = `translate3d(${x}%, ${y}%, 0)`
      })

      actorElements.forEach((actor, index) => {
        const bob = Math.sin(time * 0.004 + index) * 3
        actor.style.transform = `translateY(${bob}px)`
      })

      frame += 1
      animationFrame = requestAnimationFrame(animate)
    }

    animationFrame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrame)
  }, [profile, running])

  return (
    <div className="benchmark-stage dom-benchmark" ref={sceneRef}>
      <div
        className="dom-benchmark__board"
        style={{ gridTemplateColumns: `repeat(${profile.side}, minmax(0, 1fr))` }}
      >
        {tiles.map((index) => (
          <div
            className="dom-benchmark__tile"
            data-dom-tile
            key={index}
            style={{ backgroundColor: DOM_COLORS[index % DOM_COLORS.length] }}
          />
        ))}
      </div>
      <div className="dom-benchmark__actors" aria-hidden="true">
        {actors.map((index) => (
          <span
            className="dom-benchmark__actor"
            data-dom-actor
            key={index}
            style={{
              left: `${8 + ((index * 29) % 84)}%`,
              top: `${12 + ((index * 47) % 70)}%`,
            }}
          />
        ))}
      </div>
      <div className="dom-benchmark__weather" aria-hidden="true">
        {particles.map((index) => (
          <span
            className="dom-benchmark__particle"
            data-dom-particle
            key={index}
            style={{ left: `${index % 100}%`, top: `${(index * 17) % 100}%` }}
          />
        ))}
      </div>
      <div className="benchmark-caption">
        CSS Grid + 独立 DOM 节点；每帧直接更新部分地块、全部天气节点与 Actor。
      </div>
    </div>
  )
}
