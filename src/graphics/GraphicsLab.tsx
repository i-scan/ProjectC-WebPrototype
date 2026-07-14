import { useCallback, useMemo, useState } from 'react'
import { DomBenchmark } from './DomBenchmark'
import { PixiBenchmark } from './PixiBenchmark'
import { ThreeBenchmark } from './ThreeBenchmark'
import {
  BENCHMARK_PROFILES,
  type FrameStats,
  type LoadLevel,
  type RendererKind,
  useDeviceSummary,
  useFrameStats,
} from './benchmark'
import './graphics.css'

const rendererLabels: Record<RendererKind, string> = {
  dom: 'DOM / CSS',
  pixi: 'PixiJS 2D',
  three: 'Three.js 3D',
}

type Snapshot = FrameStats & {
  rendererInfo: string
  load: LoadLevel
}

export function GraphicsLab() {
  const [renderer, setRenderer] = useState<RendererKind>('dom')
  const [load, setLoad] = useState<LoadLevel>('medium')
  const [running, setRunning] = useState(true)
  const [rendererInfo, setRendererInfo] = useState('等待渲染器数据')
  const [snapshots, setSnapshots] = useState<Partial<Record<RendererKind, Snapshot>>>({})
  const profile = BENCHMARK_PROFILES[load]
  const resetKey = `${renderer}:${load}:${running}`
  const stats = useFrameStats(running, resetKey)
  const device = useDeviceSummary()

  const handleRendererInfo = useCallback((value: string) => {
    setRendererInfo(value)
  }, [])

  const currentInfo = useMemo(() => {
    if (renderer === 'dom') return `${profile.tiles + profile.particles + profile.actors} DOM nodes under animation`
    if (renderer === 'pixi') return `${profile.tiles + profile.particles + profile.actors} Pixi display objects`
    return rendererInfo
  }, [profile, renderer, rendererInfo])

  const recordSnapshot = () => {
    setSnapshots((current) => ({
      ...current,
      [renderer]: {
        ...stats,
        rendererInfo: currentInfo,
        load,
      },
    }))
  }

  return (
    <main className="graphics-lab app-shell">
      <header className="graphics-hero">
        <div>
          <p className="eyebrow">ProjectC · Graphics Lab</p>
          <h1>网页棋盘渲染性能实验室</h1>
          <p className="graphics-hero__copy">
            在同一设备上切换 DOM、PixiJS 与 Three.js，比较大量地块、Actor、天气对象和动态属性更新时的帧稳定性。
            这是合成负载参考，不等同于正式游戏性能结论。
          </p>
        </div>
        <div className="graphics-device">
          <strong>{device.api}</strong>
          <span>{device.gpu}</span>
          <span>DPR {device.dpr.toFixed(2)} · CPU threads {device.cores || 'unknown'}</span>
          <span>Viewport {device.viewport}</span>
        </div>
      </header>

      <section className="graphics-toolbar">
        <div className="graphics-control-group">
          <span>渲染方案</span>
          <div className="graphics-segmented">
            {(Object.keys(rendererLabels) as RendererKind[]).map((key) => (
              <button
                className={renderer === key ? 'selected' : ''}
                key={key}
                onClick={() => {
                  setRenderer(key)
                  setRendererInfo('等待渲染器数据')
                }}
              >
                {rendererLabels[key]}
              </button>
            ))}
          </div>
        </div>

        <div className="graphics-control-group">
          <span>负载</span>
          <div className="graphics-segmented">
            {(Object.keys(BENCHMARK_PROFILES) as LoadLevel[]).map((key) => (
              <button className={load === key ? 'selected' : ''} key={key} onClick={() => setLoad(key)}>
                {BENCHMARK_PROFILES[key].label}
              </button>
            ))}
          </div>
        </div>

        <div className="graphics-control-group graphics-control-group--actions">
          <button onClick={() => setRunning((value) => !value)}>{running ? '暂停动画' : '继续动画'}</button>
          <button className="primary" disabled={stats.sampleCount === 0} onClick={recordSnapshot}>
            记录当前结果
          </button>
        </div>
      </section>

      <section className="graphics-summary-grid">
        <Metric label="FPS" value={stats.fps ? stats.fps.toFixed(1) : '—'} />
        <Metric label="平均帧时间" value={stats.averageMs ? `${stats.averageMs.toFixed(2)} ms` : '—'} />
        <Metric label="P95 帧时间" value={stats.p95Ms ? `${stats.p95Ms.toFixed(2)} ms` : '—'} />
        <Metric label="长帧 > 33ms" value={stats.sampleCount ? `${stats.longFramePercent.toFixed(1)}%` : '—'} />
        <Metric label="地块" value={profile.tiles.toLocaleString()} />
        <Metric label="天气 / Actor" value={`${profile.particles.toLocaleString()} / ${profile.actors}`} />
      </section>

      <section className="graphics-workspace">
        <div className="graphics-stage-panel">
          <div className="graphics-stage-heading">
            <div>
              <h2>{rendererLabels[renderer]} · {profile.label}</h2>
              <p>{profile.side} × {profile.side} 棋盘 · 每帧更新约 {Math.round(profile.updateRatio * 100)}% 地块</p>
            </div>
            <span>{currentInfo}</span>
          </div>

          {renderer === 'dom' && <DomBenchmark profile={profile} running={running} />}
          {renderer === 'pixi' && <PixiBenchmark profile={profile} running={running} />}
          {renderer === 'three' && (
            <ThreeBenchmark profile={profile} running={running} onRendererInfo={handleRendererInfo} />
          )}
        </div>

        <aside className="graphics-notes panel">
          <h2>如何比较</h2>
          <ol>
            <li>保持浏览器窗口尺寸不变。</li>
            <li>依次测试三个渲染方案的同一负载。</li>
            <li>等待至少 5 秒，让数据趋于稳定。</li>
            <li>点击“记录当前结果”，再切换下一方案。</li>
            <li>优先看 P95 与长帧比例，而不是只看瞬时 FPS。</li>
          </ol>

          <h3>负载含义</h3>
          <p>
            DOM 测试为每个地块、天气粒子和 Actor 创建独立节点；PixiJS 使用 GPU Sprite；Three.js 使用
            InstancedMesh 和 Points。三者场景含义相似，但内部工作量并不完全等价。
          </p>

          <h3>安全提示</h3>
          <p>重载 DOM 可能让低配设备明显卡顿。出现操作困难时先暂停动画，再切回轻载。</p>
        </aside>
      </section>

      <section className="graphics-comparison panel">
        <div className="section-heading">
          <div>
            <h2>本设备记录</h2>
            <p>每种方案保存最近一次手动记录，刷新页面后清空。</p>
          </div>
          <button onClick={() => setSnapshots({})}>清空记录</button>
        </div>
        <div className="graphics-table-wrap">
          <table className="graphics-table">
            <thead>
              <tr>
                <th>方案</th>
                <th>负载</th>
                <th>FPS</th>
                <th>平均 ms</th>
                <th>P95 ms</th>
                <th>长帧</th>
                <th>渲染信息</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(rendererLabels) as RendererKind[]).map((key) => {
                const snapshot = snapshots[key]
                return (
                  <tr key={key}>
                    <th>{rendererLabels[key]}</th>
                    <td>{snapshot ? BENCHMARK_PROFILES[snapshot.load].label : '—'}</td>
                    <td>{snapshot ? snapshot.fps.toFixed(1) : '—'}</td>
                    <td>{snapshot ? snapshot.averageMs.toFixed(2) : '—'}</td>
                    <td>{snapshot ? snapshot.p95Ms.toFixed(2) : '—'}</td>
                    <td>{snapshot ? `${snapshot.longFramePercent.toFixed(1)}%` : '—'}</td>
                    <td>{snapshot?.rendererInfo ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="graphics-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
