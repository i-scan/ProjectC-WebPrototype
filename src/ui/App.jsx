import { useEffect, useMemo, useRef, useState } from 'react'
import { Board3D } from './Board3D.jsx'
import { axialKey, axialToWorld, createHexBoard, directionVector, worldToAxial } from '../sim/hex.js'
import {
  ACTIONS,
  AT_VISUAL_MS,
  DEFAULT_OBSTACLES,
  DEFAULT_SOLVER_CONFIG,
  actionById,
  createInitialState,
  momentumLevel,
  planSummary,
  simulateImpulse,
} from '../sim/solver.js'

const BUILD_COMMIT = __BUILD_COMMIT__
const BUILD_BRANCH = __BUILD_BRANCH__

const velocityPresets = [
  { label: 'M0', speed: 0 },
  { label: 'E · M1', speed: 0.85 },
  { label: 'E · M2', speed: 1.7 },
  { label: 'E · M3', speed: 2.65 },
]

function speedOf(velocity) {
  return Math.hypot(velocity.x, velocity.z)
}

function headingOf(velocity) {
  const speed = speedOf(velocity)
  if (speed < 0.02) return null
  return (Math.atan2(velocity.z, velocity.x) * 180 / Math.PI + 360) % 360
}

function sameHex(a, b) {
  return Boolean(a && b && a.q === b.q && a.r === b.r)
}

export function App() {
  const [state, setState] = useState(() => createInitialState())
  const [history, setHistory] = useState([])
  const [actionId, setActionId] = useState('drive')
  const [hoverHex, setHoverHex] = useState(null)
  const [boardRadius, setBoardRadius] = useState(7)
  const [obstaclesEnabled, setObstaclesEnabled] = useState(true)
  const [restitution, setRestitution] = useState(DEFAULT_SOLVER_CONFIG.restitution)
  const [viewMode, setViewMode] = useState('isometric')
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [playback, setPlayback] = useState(null)
  const playbackIdRef = useRef(1)

  const action = actionById(actionId)
  const speed = speedOf(state.velocity)
  const momentum = momentumLevel(speed)
  const heading = headingOf(state.velocity)
  const currentHex = worldToAxial(state.position)
  const cells = useMemo(() => createHexBoard(boardRadius), [boardRadius])
  const obstacles = useMemo(
    () => obstaclesEnabled ? DEFAULT_OBSTACLES.filter((entry) => Math.max(Math.abs(entry.hex.q), Math.abs(entry.hex.r), Math.abs(-entry.hex.q - entry.hex.r)) <= boardRadius) : [],
    [obstaclesEnabled, boardRadius],
  )
  const config = useMemo(() => ({ ...DEFAULT_SOLVER_CONFIG, boardRadius, restitution }), [boardRadius, restitution])
  const aimPoint = hoverHex ? axialToWorld(hoverHex) : null
  const previewPlan = useMemo(() => {
    if (playback) return null
    if (actionId !== 'coast' && !hoverHex) return null
    return simulateImpulse({ state, actionId, aimPoint, config, obstacles })
  }, [state, actionId, hoverHex, config, obstacles, playback])

  const predictedHex = previewPlan?.valid ? worldToAxial(previewPlan.finalState.position) : null
  const isPlaying = Boolean(playback)

  const resolveClick = (hex) => {
    if (isPlaying) return false
    const point = axialToWorld(hex)
    const plan = simulateImpulse({ state, actionId, aimPoint: actionId === 'coast' ? null : point, config, obstacles })
    if (!plan.valid) return false
    if (actionId === 'coast' && !plan.traversedCells.some((entry) => sameHex(entry, hex))) return false
    setHistory((current) => [...current, structuredClone(state)].slice(-80))
    setHoverHex(null)
    setPlayback({
      id: playbackIdRef.current++,
      samples: plan.samples,
      finalState: plan.finalState,
      summary: planSummary(plan),
    })
    return true
  }

  useEffect(() => {
    window.__PROJECTC_PROTOTYPE__ = {
      fireAt(q, r) {
        return resolveClick({ q, r })
      },
      snapshot() {
        return structuredClone(state)
      },
    }
    return () => {
      delete window.__PROJECTC_PROTOTYPE__
    }
  })

  const completePlayback = (finalState) => {
    setState(finalState)
    setPlayback(null)
  }

  const undo = () => {
    if (isPlaying) return
    const previous = history.at(-1)
    if (!previous) return
    setHistory((current) => current.slice(0, -1))
    setState(previous)
    setHoverHex(null)
  }

  const reset = () => {
    if (isPlaying) return
    setState(createInitialState())
    setHistory([])
    setHoverHex(null)
    setPlayback(null)
  }

  const setPreset = (preset) => {
    if (isPlaying) return
    const direction = directionVector('E')
    setState((current) => ({
      ...current,
      velocity: { x: direction.x * preset.speed, z: direction.z * preset.speed },
    }))
    setHoverHex(null)
  }

  const changeRadius = (radius) => {
    if (isPlaying) return
    setBoardRadius(radius)
    setState(createInitialState())
    setHistory([])
    setHoverHex(null)
  }

  return (
    <main
      className="current-prototype"
      data-implementation="continuous-inertia-v1"
      data-playing={isPlaying}
      data-world-at={state.worldAt.toFixed(1)}
      data-logical-x={state.position.x.toFixed(4)}
      data-logical-z={state.position.z.toFixed(4)}
      data-speed={speed.toFixed(4)}
      data-momentum={momentum}
      data-preview-valid={previewPlan?.valid === true}
    >
      <header className="topbar">
        <div className="brand">
          <p>ProjectC · Movement Rebuild</p>
          <h1>Continuous Inertia Playground</h1>
        </div>
        <div className="build-chip" title={BUILD_COMMIT}>{BUILD_BRANCH}@{BUILD_COMMIT.slice(0, 8)}</div>
        <div className="headline-state">
          <div><span>World Time</span><strong>{state.worldAt.toFixed(1)} AT</strong></div>
          <div><span>Momentum</span><strong>M{momentum}</strong></div>
          <div><span>Speed</span><strong>{speed.toFixed(2)}</strong></div>
          <div><span>Cell</span><strong>{currentHex.q},{currentHex.r}</strong></div>
        </div>
      </header>

      <section className="lab-grid">
        <aside className="side-panel left-panel">
          <section className="panel-card actor-card">
            <div className="portrait">⬡</div>
            <div><p>Continuous Actor</p><h2>Courier</h2></div>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Motion State</h3><span>authoritative</span></div>
            <dl className="state-list">
              <div><dt>Position X</dt><dd>{state.position.x.toFixed(3)}</dd></div>
              <div><dt>Position Z</dt><dd>{state.position.z.toFixed(3)}</dd></div>
              <div><dt>Velocity X</dt><dd>{state.velocity.x.toFixed(3)}</dd></div>
              <div><dt>Velocity Z</dt><dd>{state.velocity.z.toFixed(3)}</dd></div>
              <div><dt>Heading</dt><dd>{heading === null ? '—' : `${heading.toFixed(0)}°`}</dd></div>
              <div><dt>Derived M</dt><dd>M{momentum}</dd></div>
            </dl>
          </section>

          <section className="panel-card guide-card">
            <div className="section-heading"><h3>Input Model</h3><span>current</span></div>
            <p><b>Cell 不是目标终点。</b> 它只定义本次冲量的 Aim。</p>
            <p>选 Card → 悬停棋盘看完整 1 AT 连续轨迹 → 点击合法 Cell 立即执行。</p>
            <p>逻辑位置在动画结束前不会提前跳到终点；1 AT 固定播放 {AT_VISUAL_MS}ms。</p>
          </section>

          <section className="panel-card prediction-card">
            <div className="section-heading"><h3>Predicted Outcome</h3><span>{previewPlan?.valid ? 'continuous' : 'waiting aim'}</span></div>
            <p>{previewPlan ? planSummary(previewPlan) : 'Hover a Cell to preview this card.'}</p>
            {previewPlan?.valid && (
              <dl className="state-list compact">
                <div><dt>Final X/Z</dt><dd>{previewPlan.finalState.position.x.toFixed(2)} / {previewPlan.finalState.position.z.toFixed(2)}</dd></div>
                <div><dt>Final Cell</dt><dd>{predictedHex.q},{predictedHex.r}</dd></div>
                <div><dt>Collisions</dt><dd>{previewPlan.collisions.length}</dd></div>
              </dl>
            )}
          </section>
        </aside>

        <section className="center-column">
          <div className="board-strip">
            <strong>Card + Aim → Impulse → Continuous 1 AT Simulation</strong>
            <span>{isPlaying ? `Resolving · ${playback?.summary ?? ''}` : hoverHex ? `Aim Cell ${axialKey(hoverHex)}` : 'Hover board to aim'}</span>
          </div>
          <div className="board-toolbar">
            <div className="view-switch" role="group" aria-label="Camera view">
              <button className={viewMode === 'isometric' ? 'active' : ''} onClick={() => setViewMode('isometric')}>Isometric</button>
              <button className={viewMode === 'top' ? 'active' : ''} onClick={() => setViewMode('top')}>Top</button>
              <button onClick={() => setCameraResetToken((value) => value + 1)}>Reset View</button>
            </div>
            <div className="session-buttons">
              <button disabled={history.length === 0 || isPlaying} onClick={undo}>Undo</button>
              <button disabled={isPlaying} onClick={reset}>Reset</button>
            </div>
          </div>
          <div className={`board-frame ${isPlaying ? 'playing' : ''}`}>
            <Board3D
              cells={cells}
              obstacles={obstacles}
              state={state}
              previewPlan={previewPlan}
              playback={playback}
              boardRadius={boardRadius}
              viewMode={viewMode}
              cameraResetToken={cameraResetToken}
              onHoverHex={isPlaying ? () => {} : setHoverHex}
              onClickHex={resolveClick}
              onPlaybackComplete={completePlayback}
            />
            <div className="board-legend">
              <span><i className="trajectory" />Continuous trajectory</span>
              <span><i className="wall" />Hard collision surface</span>
              <span><i className="velocity" />Velocity vector</span>
            </div>
            {isPlaying && <div className="playback-badge">1 AT · fixed {AT_VISUAL_MS} ms</div>}
          </div>

          <section className="action-hand">
            <div className="hand-heading">
              <div><h2>Motion Cards</h2><p>Hover gives a deterministic preview. Clicking the aimed Cell fires immediately.</p></div>
              <span>{action.label} · F{action.force.toFixed(2)}</span>
            </div>
            <div className="action-row">
              {ACTIONS.map((entry) => (
                <button
                  key={entry.id}
                  className={`action-card ${entry.id === actionId ? 'selected' : ''}`}
                  disabled={isPlaying}
                  onClick={() => { setActionId(entry.id); setHoverHex(null) }}
                >
                  <header><strong>{entry.label}</strong><em>F{entry.force.toFixed(2)}</em></header>
                  <p>{entry.description}</p>
                  <span>{entry.short}</span>
                </button>
              ))}
            </div>
          </section>
        </section>

        <aside className="side-panel right-panel">
          <section className="panel-card">
            <div className="section-heading"><h3>Simulation</h3><span>single model</span></div>
            <dl className="state-list">
              <div><dt>Authority</dt><dd>Position + Velocity</dd></div>
              <div><dt>Solver</dt><dd>{config.steps} substeps / AT</dd></div>
              <div><dt>Playback</dt><dd>{AT_VISUAL_MS} ms / AT</dd></div>
              <div><dt>Cell</dt><dd>derived from Position</dd></div>
            </dl>
            <small>No Discrete / Hybrid gameplay modes. Hex is environment space, not movement rails.</small>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Quick Velocity</h3><span>debug</span></div>
            <div className="quick-grid">
              {velocityPresets.map((preset) => <button key={preset.label} disabled={isPlaying} onClick={() => setPreset(preset)}>{preset.label}</button>)}
            </div>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Collision</h3><span>deterministic</span></div>
            <label className="range-row">
              <span>Restitution</span>
              <input type="range" min="0" max="0.9" step="0.05" value={restitution} disabled={isPlaying} onChange={(event) => setRestitution(Number(event.target.value))} />
              <output>{restitution.toFixed(2)}</output>
            </label>
            <button className={obstaclesEnabled ? 'active wide-button' : 'wide-button'} disabled={isPlaying} onClick={() => setObstaclesEnabled((value) => !value)}>Hard Surfaces {obstaclesEnabled ? 'ON' : 'OFF'}</button>
          </section>

          <section className="panel-card">
            <div className="section-heading"><h3>Board / Session</h3><span>playground</span></div>
            <label className="range-row">
              <span>Board Radius</span>
              <input type="range" min="4" max="10" step="1" value={boardRadius} disabled={isPlaying} onChange={(event) => changeRadius(Number(event.target.value))} />
              <output>{boardRadius}</output>
            </label>
          </section>

          <section className="panel-card scope-card">
            <div className="section-heading"><h3>Validation Scope</h3><span>movement first</span></div>
            <p>当前只验证 Drive / Coast / Counter / Hard Turn / collision 是否形成可学习、可预测的惯性驾驶。</p>
            <p>Thermal、敌人行动、天气和完整卡组在运动模型成立前不接回运行时。</p>
          </section>
        </aside>
      </section>
    </main>
  )
}
