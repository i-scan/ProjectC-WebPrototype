import { useEffect, useMemo, useState } from 'react'

export type RendererKind = 'dom' | 'pixi' | 'three'
export type LoadLevel = 'low' | 'medium' | 'high'

export type BenchmarkProfile = {
  label: string
  side: number
  tiles: number
  particles: number
  actors: number
  updateRatio: number
}

export const BENCHMARK_PROFILES: Record<LoadLevel, BenchmarkProfile> = {
  low: {
    label: '轻载',
    side: 20,
    tiles: 400,
    particles: 200,
    actors: 24,
    updateRatio: 0.1,
  },
  medium: {
    label: '中载',
    side: 40,
    tiles: 1600,
    particles: 1000,
    actors: 64,
    updateRatio: 0.35,
  },
  high: {
    label: '重载',
    side: 64,
    tiles: 4096,
    particles: 3000,
    actors: 160,
    updateRatio: 1,
  },
}

export type FrameStats = {
  fps: number
  averageMs: number
  p95Ms: number
  longFramePercent: number
  sampleCount: number
}

export const EMPTY_STATS: FrameStats = {
  fps: 0,
  averageMs: 0,
  p95Ms: 0,
  longFramePercent: 0,
  sampleCount: 0,
}

export function useFrameStats(active: boolean, resetKey: string) {
  const [stats, setStats] = useState<FrameStats>(EMPTY_STATS)

  useEffect(() => {
    setStats(EMPTY_STATS)
    if (!active) return

    let animationFrame = 0
    let lastTime = performance.now()
    let reportTime = lastTime
    let samples: number[] = []

    const tick = (time: number) => {
      const delta = time - lastTime
      lastTime = time
      if (delta > 0 && delta < 1000) samples.push(delta)

      if (time - reportTime >= 750 && samples.length > 0) {
        const ordered = [...samples].sort((a, b) => a - b)
        const total = samples.reduce((sum, value) => sum + value, 0)
        const averageMs = total / samples.length
        const p95Index = Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))
        const longFrames = samples.filter((value) => value > 33.34).length

        setStats({
          fps: 1000 / averageMs,
          averageMs,
          p95Ms: ordered[p95Index],
          longFramePercent: (longFrames / samples.length) * 100,
          sampleCount: samples.length,
        })

        samples = []
        reportTime = time
      }

      animationFrame = requestAnimationFrame(tick)
    }

    animationFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrame)
  }, [active, resetKey])

  return stats
}

export function useDeviceSummary() {
  return useMemo(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    let gpu = '浏览器未公开'
    let api = '不可用'

    if (gl) {
      api = gl instanceof WebGL2RenderingContext ? 'WebGL 2' : 'WebGL 1'
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
      if (debugInfo) {
        gpu = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      }
    }

    return {
      gpu,
      api,
      dpr: window.devicePixelRatio,
      cores: navigator.hardwareConcurrency || 0,
      viewport: `${window.innerWidth} × ${window.innerHeight}`,
    }
  }, [])
}

export function temperatureColor(index: number, time = 0) {
  const wave = Math.sin(index * 0.37 + time * 0.0015)
  if (wave < -0.65) return 0x3b82f6
  if (wave < -0.2) return 0x67c6d4
  if (wave < 0.25) return 0xc8b879
  if (wave < 0.7) return 0xe68a3f
  return 0xd94a3f
}
