import { useMemo, useState } from 'react'
import { getPlayer, type Coord } from '../game'
import {
  axisLabel,
  createSpatialState,
  createUt7State,
  defaultUt7Settings,
  horizontalAxis,
  reconfigureUt7State,
  setSpatialDebug,
  setThermalDebug,
  type MomentumLevel,
  type Ut7State,
} from './actorLoopUt7'
import {
  continuousInertiaPath,
  fieldShapeDiagnostics,
  inertiaFieldMovePlan,
  inertiaReachableTargetCoords,
  normalizedCellCenter,
  reachableFieldProfile,
  type NormalizedHexPoint,
} from './actorLoopUt7ReachableField'
import { HEX_DIRECTIONS, type HexDirection } from './hexTopology'
import { InertiaFieldBoard, type InertiaFieldPlayback } from './InertiaFieldBoard'
import './inertia-field-ab.css'

type SpatialMode = 'discrete' | 'hybrid'
type HistoryEntry = { state: Ut7State; actorPoint: NormalizedHexPoint }

const sameCoord = (a?: Coord, b?: Coord) => Boolean(a && b && a.x === b.x && a.y === b.y)
const directions = HEX_DIRECTIONS.map((entry) => entry.direction)

export function ActorLoopReachabilityABPlayground() {
  const [lab, setLab] = useState(() => createUt7State({ spawnEnemies: false }))
  const [settings] = useState(defaultUt7Settings)
  const [mode, setMode] = useState<SpatialMode>('discrete')
  const [axisDirection, setAxisDirection] = useState<HexDirection>('E')
  const [selectedCoord, setSelectedCoord] = useState<Coord>(() => ({ ...getPlayer(lab.game).position }))
  const [hoverCoord, setHoverCoord] = useState<Coord>()
  const [actorPoint, setActorPoint] = useState<NormalizedHexPoint>(() => normalizedCellCenter(getPlayer(lab.game).position))
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [playback, setPlayback] = useState<InertiaFieldPlayback>()

  const player = getPlayer(lab.game)
  const spatial = lab.spatialByActorId.player ?? createSpatialState()
  const validCoords = useMemo(() => inertiaReachableTargetCoords(lab, settings), [lab, settings])
  const diagnostics = useMemo(() => fieldShapeDiagnostics(lab, settings), [lab, settings])
  const hoverPlan = useMemo(() => {
    if (!hoverCoord || !validCoords.some((coord) => sameCoord(coord, hoverCoord))) return undefined
    return inertiaFieldMovePlan(lab, hoverCoord, settings)
  }, [lab, settings, hoverCoord, validCoords])

  const previewPoints = useMemo(() => {
    if (!hoverCoord || !hoverPlan?.valid) return []
    if (mode === 'hybrid') return continuousInertiaPath(lab, hoverCoord, settings, actorPoint)
    return [normalizedCellCenter(player.position), ...hoverPlan.path.map(normalizedCellCenter)]
  }, [lab, settings, hoverCoord, hoverPlan, mode, actorPoint, player.position.x, player.position.y])

  const commitMove = (target: Coord) => {
    const plan = inertiaFieldMovePlan(lab, target, settings)
    if (!plan.valid) return
    const start = mode === 'hybrid' ? actorPoint : normalizedCellCenter(player.position)
    const points = mode === 'hybrid'
      ? continuousInertiaPath(lab, target, settings, start)
      : [start, ...plan.path.map(normalizedCellCenter)]
    if (points.length < 2) return

    setHistory((current) => [...current, { state: structuredClone(lab), actorPoint: { ...actorPoint } }].slice(-80))
    setLab(plan.result)
    setSelectedCoord({ ...target })
    setActorPoint(mode === 'hybrid' ? { ...points.at(-1)! } : normalizedCellCenter(target))
    setPlayback({ id: Date.now(), points: points.map((point) => ({ ...point })), mode })
  }

  const handleBoardClick = (coord: Coord) => {
    setSelectedCoord({ ...coord })
    if (validCoords.some((candidate) => sameCoord(candidate, coord))) commitMove(coord)
  }

  const switchMode = (next: SpatialMode) => {
    if (next === mode) return
    setMode(next)
    setActorPoint(normalizedCellCenter(player.position))
    setPlayback(undefined)
    setHoverCoord(undefined)
  }

  const setMomentumPreset = (level: MomentumLevel) => {
    setHistory((current) => [...current, { state: structuredClone(lab), actorPoint: { ...actorPoint } }].slice(-80))
    const next = setSpatialDebug(
      lab,
      'player',
      createSpatialState(level, level > 0 ? horizontalAxis(axisDirection) : null),
    )
    setLab(next)
    setSelectedCoord({ ...getPlayer(next.game).position })
    setActorPoint(normalizedCellCenter(getPlayer(next.game).position))
    setPlayback(undefined)
    setHoverCoord(undefined)
  }

  const setAxis = (direction: HexDirection) => {
    setAxisDirection(direction)
    if (spatial.level <= 0) return
    const next = setSpatialDebug(lab, 'player', createSpatialState(spatial.level, horizontalAxis(direction)))
    setLab(next)
    setActorPoint(normalizedCellCenter(getPlayer(next.game).position))
    setPlayback(undefined)
    setHoverCoord(undefined)
  }

  const changeRadius = (radius: number) => {
    const next = reconfigureUt7State(lab, { boardRadius: radius, spawnEnemies: false })
    setLab(next)
    setHistory([])
    setSelectedCoord({ ...getPlayer(next.game).position })
    setActorPoint(normalizedCellCenter(getPlayer(next.game).position))
    setPlayback(undefined)
    setHoverCoord(undefined)
  }

  const undo = () => {
    const previous = history.at(-1)
    if (!previous) return
    setHistory((current) => current.slice(0, -1))
    setLab(previous.state)
    setSelectedCoord({ ...getPlayer(previous.state.game).position })
    setActorPoint({ ...previous.actorPoint })
    setPlayback(undefined)
    setHoverCoord(undefined)
  }

  const reset = () => {
    const next = createUt7State({ boardRadius: lab.setup.boardRadius, spawnEnemies: false })
    setLab(next)
    setHistory([])
    setSelectedCoord({ ...getPlayer(next.game).position })
    setActorPoint(normalizedCellCenter(getPlayer(next.game).position))
    setPlayback(undefined)
    setHoverCoord(undefined)
  }

  const profile = reachableFieldProfile(lab)
  const previewText = hoverPlan?.valid
    ? `${hoverPlan.summary} · ${mode === 'hybrid' ? 'continuous curve / free endpoint inside Cell' : 'Cell-center stepped path'}`
    : 'Hover a highlighted Target Cell to compare reachability and path expression.'

  return (
    <main
      className="inertia-field-ab"
      data-ruleset="VAL-012-UT7-candidate"
      data-implementation="inertia-reachable-field-ab-v1"
      data-spatial-mode={mode}
      data-target-count={validCoords.length}
      data-max-distance={diagnostics.maxDistance}
    >
      <header className="ifab-header">
        <div>
          <p>ProjectC · Basic Move spatial experiment</p>
          <h1>Inertia Reachable Field A/B</h1>
          <span>同一 Target Cell 集合与 1 AT 结算；只切换离散路径 / Hybrid 连续路径。</span>
        </div>
        <div className="ifab-mode-switch" role="tablist" aria-label="Spatial movement model">
          <button className={mode === 'discrete' ? 'active' : ''} onClick={() => switchMode('discrete')}>A · Discrete Field</button>
          <button className={mode === 'hybrid' ? 'active' : ''} onClick={() => switchMode('hybrid')}>B · Hybrid Spatial</button>
        </div>
        <div className="ifab-state-strip">
          <div><span>World</span><strong>{lab.worldTimeAt.toFixed(1)} AT</strong></div>
          <div><span>Momentum</span><strong>M{spatial.level}</strong></div>
          <div><span>Axis</span><strong>{axisLabel(spatial.axis)}</strong></div>
          <div><span>Field</span><strong>{validCoords.length} targets / R{diagnostics.maxDistance}</strong></div>
        </div>
      </header>

      <section className="ifab-layout">
        <aside className="ifab-panel ifab-left">
          <section>
            <h2>Reachable Field</h2>
            <strong className="ifab-profile">{profile}</strong>
            <p>M0：周围一圈。M1：近似 3×3，但正后方关闭。M2 / M3：沿 Axis 逐渐拉长的水滴形。</p>
          </section>
          <section>
            <h3>Comparison rule</h3>
            <p><b>A</b>：Actor 仍沿 Cell center → Cell center 的离散路径运动。</p>
            <p><b>B</b>：目标仍是同一个 Cell，但 Actor 沿连续曲线运动，并停在 Cell 内的实际落点，不吸附中心。</p>
          </section>
          <section className="ifab-readout">
            <div><span>Selected Cell</span><strong>({selectedCoord.x},{selectedCoord.y})</strong></div>
            <div><span>Board</span><strong>{lab.game.cells.filter((cell) => !cell.tags.includes('Void')).length} Cells</strong></div>
            <div><span>Thermal</span><strong>T {lab.thermal.temperature.toFixed(2)}</strong></div>
          </section>
        </aside>

        <section className="ifab-stage">
          <div className="ifab-preview"><strong>{mode === 'hybrid' ? 'Hybrid Spatial' : 'Discrete Field'}</strong><span>{previewText}</span></div>
          <InertiaFieldBoard
            state={lab}
            validCoords={validCoords}
            selectedCoord={selectedCoord}
            hoverCoord={hoverCoord}
            previewPoints={previewPoints}
            actorPoint={actorPoint}
            axis={spatial.axis}
            playback={playback}
            mode={mode}
            onCellClick={handleBoardClick}
            onCellHover={setHoverCoord}
          />
          <div className="ifab-stage-footer">
            <span>紫 / 蓝区域 = 当前 Basic Move 可达 Cell</span>
            <span>{mode === 'hybrid' ? '蓝线 = 连续轨迹；终点保留 Cell 内偏移' : '金线 = Cell-center 离散路径'}</span>
          </div>
        </section>

        <aside className="ifab-panel ifab-right">
          <section>
            <div className="ifab-section-heading"><h2>Momentum</h2><span>shape presets</span></div>
            <div className="ifab-preset-grid">
              {([0, 1, 2, 3] as MomentumLevel[]).map((level) => (
                <button key={level} className={spatial.level === level ? 'active' : ''} onClick={() => setMomentumPreset(level)}>M{level}</button>
              ))}
            </div>
          </section>
          <section>
            <label className="ifab-row"><span>Axis</span><select value={axisDirection} onChange={(event) => setAxis(event.target.value as HexDirection)}>{directions.map((direction) => <option key={direction}>{direction}</option>)}</select></label>
            <label className="ifab-row"><span>Board Radius</span><input data-testid="ifab-radius" type="range" min="4" max="10" step="1" value={lab.setup.boardRadius} onChange={(event) => changeRadius(Number(event.target.value))} /><strong>R{lab.setup.boardRadius}</strong></label>
          </section>
          <section className="ifab-actions">
            <button disabled={history.length === 0} onClick={undo}>Undo</button>
            <button onClick={reset}>Reset</button>
          </section>
          <details>
            <summary>Thermal debug</summary>
            <div className="ifab-thermal-grid">
              <button onClick={() => setLab((current) => setThermalDebug(current, { temperature: -4 }))}>T -4</button>
              <button onClick={() => setLab((current) => setThermalDebug(current, { temperature: 0 }))}>T 0</button>
              <button onClick={() => setLab((current) => setThermalDebug(current, { temperature: 4 }))}>T +4</button>
            </div>
          </details>
          <section className="ifab-note">
            <h3>Prototype scope</h3>
            <p>Attack / Launch / Brake / Wait / Incoming / 旧 UT5/UT6 面板暂时从当前测试入口移除。历史代码仍保留，不参与本轮判断。</p>
          </section>
        </aside>
      </section>
    </main>
  )
}
