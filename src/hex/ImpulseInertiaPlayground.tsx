import { useMemo, useState } from 'react'
import { getPlayer, type Coord } from '../game'
import type { PlaybackEvent } from '../visual/visualPlayback'
import {
  axisLabel,
  createSpatialState,
  createUt7State,
  horizontalAxis,
  reconfigureUt7State,
  setSelectedActor,
  setSpatialDebug,
  setThermalDebug,
  thermalDomainFor,
  type MomentumLevel,
  type SpatialAxis,
  type Ut7State,
} from './actorLoopUt7'
import {
  actionById,
  aimAngleToCoord,
  aimCenterForAction,
  collisionCourse,
  defaultImpulseSettings,
  headingForState,
  impulseActionSpecs,
  impulsePlan,
  nearestHexDirection,
  type CollisionMode,
  type ImpulseActionId,
  type ImpulseKinematics,
  type ImpulseSettings,
} from './actorLoopImpulseMovement'
import { HexThreeBoard, type HexBoardSelection } from './HexThreeBoard'
import { HexTravelMap } from './HexTravelMap'
import { InertiaFieldBoard, type InertiaFieldPlayback } from './InertiaFieldBoard'
import { Ut5AxisOverlay } from './Ut5AxisOverlay'
import { HEX_DIRECTIONS, hexDirectionWorldVector, type HexDirection } from './hexTopology'
import { normalizedCellCenter, type NormalizedHexPoint } from './actorLoopUt7ReachableField'
import './hex.css'
import './hex-travel.css'
import './hex-view-mode.css'
import './thermal-clock.css'
import './thermal-pendulum.css'
import './coupled-inertia-lab.css'
import './actor-loop-ut6.css'
import './impulse-inertia.css'

type RendererMode = '2d' | '3d'
type SpatialPlaybackMode = 'discrete' | 'hybrid'
type HistoryEntry = {
  state: Ut7State
  kinematics: ImpulseKinematics
  actorPoint: NormalizedHexPoint
}

const inspectSelection: HexBoardSelection = { kind: 'inspect' }
const directions = HEX_DIRECTIONS.map((entry) => entry.direction)
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const normalizeDeg = (value: number) => ((value % 360) + 360) % 360

function directionAngle(direction: HexDirection) {
  const vector = hexDirectionWorldVector(direction, 1)
  return normalizeDeg(Math.atan2(vector.z, vector.x) * 180 / Math.PI)
}

function selectedAxis(value: string): SpatialAxis | null {
  if (value === 'none') return null
  return horizontalAxis(value as HexDirection)
}

function axisValue(axis: SpatialAxis | null) {
  if (!axis || axis.kind !== 'horizontal') return 'none'
  return axis.dir
}

function domainLabel(domain: ReturnType<typeof thermalDomainFor>) {
  if (domain === 'hot') return 'HOT'
  if (domain === 'cold') return 'COLD'
  return 'NEUTRAL'
}

function NumberControl({ label, value, min, max, step, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className="ut4-range">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <output>{value.toFixed(step < 1 ? 2 : 0)}</output>
    </label>
  )
}

function createInitialLab(radius = 7, spawnEnemies = true) {
  return collisionCourse(createUt7State({ boardRadius: radius, spawnEnemies }))
}

function chaikin(points: NormalizedHexPoint[]) {
  if (points.length < 3) return points.map((point) => ({ ...point }))
  const next: NormalizedHexPoint[] = [{ ...points[0] }]
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]
    const b = points[index + 1]
    next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 })
    next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 })
  }
  next.push({ ...points.at(-1)! })
  return next
}

function hybridPoints(start: NormalizedHexPoint, path: Coord[]) {
  if (path.length === 0) return [start]
  const centers = path.map(normalizedCellCenter)
  const points: NormalizedHexPoint[] = [{ ...start }, ...centers.map((point) => ({ ...point }))]
  if (points.length >= 2) {
    const target = points.at(-1)!
    const previous = points.at(-2)!
    const dx = target.x - previous.x
    const dz = target.z - previous.z
    const length = Math.max(0.001, Math.hypot(dx, dz))
    points[points.length - 1] = {
      x: target.x - dx / length * 0.26,
      z: target.z - dz / length * 0.26,
    }
  }
  return chaikin(chaikin(points))
}

function eventForImpulse(before: Ut7State, after: Ut7State, path: Coord[], label: string): PlaybackEvent {
  return {
    id: Date.now(),
    kind: path.length > 0 ? 'move' : 'phase',
    effect: path.length > 0 ? 'move' : 'phase',
    actorId: path.length > 0 ? 'player' : undefined,
    target: { ...getPlayer(after.game).position },
    path: path.length > 0 ? [{ ...getPlayer(before.game).position }, ...path.map((coord) => ({ ...coord }))] : undefined,
    label,
    durationAt: 1,
  }
}

export function ImpulseInertiaPlayground() {
  const [lab, setLab] = useState(() => createInitialLab())
  const [kinematics, setKinematics] = useState<ImpulseKinematics>({ headingDeg: null })
  const [rendererMode, setRendererMode] = useState<RendererMode>('3d')
  const [spatialMode, setSpatialMode] = useState<SpatialPlaybackMode>('discrete')
  const [actionId, setActionId] = useState<ImpulseActionId>('drive')
  const [aimDeg, setAimDeg] = useState(0)
  const [hoverAimDeg, setHoverAimDeg] = useState<number | null>(null)
  const [selectedCoord, setSelectedCoord] = useState<Coord>(() => ({ ...getPlayer(lab.game).position }))
  const [hoverCoord, setHoverCoord] = useState<Coord>()
  const [settings, setSettings] = useState<ImpulseSettings>(defaultImpulseSettings)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [event, setEvent] = useState<PlaybackEvent>()
  const [actorPoint, setActorPoint] = useState<NormalizedHexPoint>(() => normalizedCellCenter(getPlayer(lab.game).position))
  const [hybridPlayback, setHybridPlayback] = useState<InertiaFieldPlayback>()

  const player = getPlayer(lab.game)
  const playerSpatial = lab.spatialByActorId.player ?? createSpatialState()
  const selectedActor = lab.game.actors.find((actor) => actor.id === lab.selectedActorId) ?? player
  const selectedSpatial = lab.spatialByActorId[selectedActor.id] ?? createSpatialState()
  const domain = thermalDomainFor(lab.thermal.temperature)
  const action = actionById(actionId)
  const effectiveAim = hoverAimDeg ?? aimDeg
  const plan = useMemo(
    () => impulsePlan(lab, kinematics, action, effectiveAim, settings),
    [lab, kinematics.headingDeg, action, effectiveAim, settings],
  )
  const previewPath = plan.valid ? plan.path : []
  const momentumByActorId = useMemo(
    () => Object.fromEntries(Object.entries(lab.spatialByActorId).map(([actorId, spatial]) => [actorId, spatial.level])),
    [lab.spatialByActorId],
  )
  const boardSelection: HexBoardSelection = previewPath.length > 0
    ? { kind: 'momentum', action: 'drive', validCoords: previewPath, route: previewPath }
    : inspectSelection
  const hybridPreviewPoints = useMemo(
    () => spatialMode === 'hybrid' && plan.valid ? hybridPoints(actorPoint, plan.path) : [],
    [spatialMode, actorPoint, plan],
  )

  const pushHistory = () => {
    setHistory((current) => [...current, {
      state: structuredClone(lab),
      kinematics: { ...kinematics },
      actorPoint: { ...actorPoint },
    }].slice(-120))
  }

  const selectAction = (id: ImpulseActionId) => {
    const next = actionById(id)
    setActionId(id)
    setHoverAimDeg(null)
    if (next.id === 'coast') return
    const center = aimCenterForAction(lab, kinematics, next)
    setAimDeg(center)
  }

  const commit = () => {
    if (!plan.valid) return
    pushHistory()
    const before = lab
    const startPoint = spatialMode === 'hybrid' ? actorPoint : normalizedCellCenter(player.position)
    const points = spatialMode === 'hybrid' ? hybridPoints(startPoint, plan.path) : [startPoint, ...plan.path.map(normalizedCellCenter)]
    setLab(plan.result)
    setKinematics({ headingDeg: plan.finalHeadingDeg })
    setSelectedCoord({ ...getPlayer(plan.result.game).position })
    setHoverCoord(undefined)
    setHoverAimDeg(null)
    setEvent(eventForImpulse(before, plan.result, plan.path, `${action.label} · ${plan.summary}`))
    if (points.length > 1) {
      setActorPoint(spatialMode === 'hybrid' ? { ...points.at(-1)! } : normalizedCellCenter(getPlayer(plan.result.game).position))
      setHybridPlayback({ id: Date.now(), points: points.map((point) => ({ ...point })), mode: spatialMode })
    } else {
      setActorPoint(normalizedCellCenter(getPlayer(plan.result.game).position))
      setHybridPlayback(undefined)
    }
  }

  const handleBoardClick = (coord: Coord) => {
    setSelectedCoord({ ...coord })
    const angle = aimAngleToCoord(player.position, coord)
    if (angle !== null && action.id !== 'coast') setAimDeg(angle)
    setHoverAimDeg(null)
  }

  const handleBoardHover = (coord?: Coord) => {
    setHoverCoord(coord)
    if (!coord || action.id === 'coast') {
      setHoverAimDeg(null)
      return
    }
    setHoverAimDeg(aimAngleToCoord(player.position, coord))
  }

  const undo = () => {
    const previous = history.at(-1)
    if (!previous) return
    setHistory((current) => current.slice(0, -1))
    setLab(previous.state)
    setKinematics(previous.kinematics)
    setActorPoint(previous.actorPoint)
    setSelectedCoord({ ...getPlayer(previous.state.game).position })
    setHoverCoord(undefined)
    setHoverAimDeg(null)
    setEvent({ id: Date.now(), kind: 'reset', effect: 'reset', target: getPlayer(previous.state.game).position, label: 'Undo Whole Action' })
    setHybridPlayback(undefined)
  }

  const reset = () => {
    const next = createInitialLab(lab.setup.boardRadius, lab.setup.spawnEnemies)
    setLab(next)
    setKinematics({ headingDeg: null })
    setHistory([])
    setSelectedCoord({ ...getPlayer(next.game).position })
    setAimDeg(0)
    setHoverCoord(undefined)
    setHoverAimDeg(null)
    setActorPoint(normalizedCellCenter(getPlayer(next.game).position))
    setEvent({ id: Date.now(), kind: 'reset', effect: 'reset', target: getPlayer(next.game).position, label: 'Impulse Lab Reset' })
    setHybridPlayback(undefined)
  }

  const setMomentumPreset = (level: MomentumLevel, direction: HexDirection = 'E') => {
    pushHistory()
    const next = setSpatialDebug(lab, 'player', createSpatialState(level, level > 0 ? horizontalAxis(direction) : null))
    setLab(next)
    setKinematics({ headingDeg: level > 0 ? directionAngle(direction) : null })
    setActorPoint(normalizedCellCenter(getPlayer(next.game).position))
    setAimDeg(level > 0 ? directionAngle(direction) : 0)
    setHybridPlayback(undefined)
  }

  const setDebugSpatial = (level: MomentumLevel, axis: SpatialAxis | null) => {
    const next = setSpatialDebug(lab, selectedActor.id, createSpatialState(level, axis))
    setLab(next)
    if (selectedActor.id === 'player') {
      setKinematics({ headingDeg: level > 0 && axis?.kind === 'horizontal' ? directionAngle(axis.dir) : null })
      setActorPoint(normalizedCellCenter(getPlayer(next.game).position))
    }
  }

  const changeRadius = (radius: number) => {
    const next = collisionCourse(reconfigureUt7State(lab, { boardRadius: radius, spawnEnemies: lab.setup.spawnEnemies }))
    setLab(next)
    setHistory([])
    setKinematics({ headingDeg: null })
    setSelectedCoord({ ...getPlayer(next.game).position })
    setActorPoint(normalizedCellCenter(getPlayer(next.game).position))
    setHybridPlayback(undefined)
  }

  const toggleEnemies = () => {
    const next = collisionCourse(reconfigureUt7State(lab, { spawnEnemies: !lab.setup.spawnEnemies }))
    setLab(next)
    setHistory([])
    setKinematics({ headingDeg: null })
    setSelectedCoord({ ...getPlayer(next.game).position })
    setActorPoint(normalizedCellCenter(getPlayer(next.game).position))
    setHybridPlayback(undefined)
  }

  const rebuildCollisionCourse = () => {
    pushHistory()
    const next = collisionCourse(lab)
    setLab(next)
    setActorPoint(normalizedCellCenter(getPlayer(next.game).position))
    setHybridPlayback(undefined)
  }

  const heading = headingForState(lab, kinematics)
  const resolvedAxis = plan.finalHeadingDeg === null ? 'None' : nearestHexDirection(plan.finalHeadingDeg)
  const thermalPercent = clamp((lab.thermal.temperature + 6) / 12 * 100, 0, 100)
  const collisionSummary = plan.collisions.length > 0
    ? plan.collisions.map((entry) => `${entry.label}: M${entry.speedBefore}→M${entry.speedAfter}`).join(' · ')
    : 'No predicted collision'

  return (
    <main
      className="visual-prototype hex-prototype coupled-inertia-lab ut4-hex-layout ut6-actor-loop impulse-inertia-lab"
      data-ruleset="VAL-012-UT7-impulse-candidate"
      data-implementation="impulse-inertia-input-v1"
      data-spatial-mode={spatialMode}
      data-renderer-mode={rendererMode}
      data-preview-valid={plan.valid}
      data-preview-path-length={previewPath.length}
      data-preview-collision-count={plan.collisions.length}
    >
      <header className="visual-hud ut4-hud">
        <div className="visual-brand">
          <p className="eyebrow">ProjectC · Impulse Movement Candidate</p>
          <h1>Inertia Driving Playground</h1>
        </div>
        <div className="hex-view-switch" role="tablist" aria-label="Impulse renderer">
          <button className={rendererMode === '2d' ? 'active' : ''} onClick={() => setRendererMode('2d')}>2D</button>
          <button className={rendererMode === '3d' ? 'active' : ''} onClick={() => setRendererMode('3d')}>3D</button>
        </div>
        <div className="visual-turn-strip ut4-header-state">
          <div><span>World Time</span><strong>{lab.worldTimeAt.toFixed(1)} AT</strong></div>
          <div className={`domain-${domain}`}><span>Thermal</span><strong>{domainLabel(domain)} · T {lab.thermal.temperature.toFixed(1)}</strong></div>
          <div><span>Momentum</span><strong>M{playerSpatial.level}</strong></div>
          <div><span>Axis</span><strong>{axisLabel(playerSpatial.axis)}</strong></div>
          <div><span>Heading</span><strong>{heading === null ? '—' : `${heading.toFixed(0)}°`}</strong></div>
        </div>
      </header>

      <section className="visual-layout ut4-visual-layout">
        <aside className="visual-panel visual-left-panel ut4-left-panel">
          <section className="visual-actor-card ut4-player-card">
            <div className="visual-portrait hex-portrait">⬡</div>
            <div>
              <p>Impulse Actor</p><h2>{player.name}</h2>
              <div className="visual-bars">
                <div><span>HP</span><i><b style={{ width: `${player.hp / player.maxHp * 100}%` }} /></i><strong>{player.hp}/{player.maxHp}</strong></div>
                <div><span>Thermal</span><i className="temperature"><b style={{ width: `${thermalPercent}%` }} /></i><strong>{lab.thermal.temperature.toFixed(1)}</strong></div>
              </div>
            </div>
          </section>
          <section className="ut4-state-summary">
            <div className="visual-section-heading"><h3>World / Motion State</h3><span>{domainLabel(domain)}</span></div>
            <dl>
              <div><dt>Position</dt><dd>({player.position.x},{player.position.y})</dd></div>
              <div><dt>Momentum</dt><dd>M{playerSpatial.level}</dd></div>
              <div><dt>Axis</dt><dd>{axisLabel(playerSpatial.axis)}</dd></div>
              <div><dt>Heading</dt><dd>{heading === null ? '—' : `${heading.toFixed(1)}°`}</dd></div>
              <div><dt>Temperature</dt><dd>{lab.thermal.temperature.toFixed(2)}</dd></div>
              <div><dt>Drift</dt><dd>{lab.thermal.drift.toFixed(2)}</dd></div>
            </dl>
          </section>
          <section className="visual-slice-note ut4-test-guide">
            <h3>Input Model</h3>
            <p><b>不再选择 Target Cell。</b> 玩家选择的是 Card + Force + Aim。</p>
            <p>系统把当前 Velocity 与新 Impulse 相加，再模拟本 AT 的完整位移。</p>
            <p>M 是持续速度状态；Coast 不自动减 M。碰撞不会自动绕路。</p>
          </section>
          <section className="impulse-prediction-card">
            <div className="visual-section-heading"><h3>Predicted Outcome</h3><span>{plan.valid ? 'deterministic' : 'invalid input'}</span></div>
            <p>{plan.valid ? plan.summary : plan.reason}</p>
            <dl>
              <div><dt>Impulse result</dt><dd>M{plan.beforeM} → M{plan.afterImpulseM}</dd></div>
              <div><dt>Displacement</dt><dd>{plan.path.length} Cell</dd></div>
              <div><dt>Final</dt><dd>M{plan.afterM} · {resolvedAxis}</dd></div>
              <div><dt>Thermal</dt><dd>{plan.behavior} / {plan.thermalIntent}</dd></div>
            </dl>
            <small className={plan.collisions.length > 0 ? 'collision-live' : ''}>{collisionSummary}</small>
          </section>
        </aside>

        <section className="visual-board-column hex-board-column ut4-board-column">
          <div className="hex-comparison-strip ut4-comparison-strip">
            <strong>Impulse / Billiards Input</strong>
            <span className="ut6-action-preview">{action.label} · Aim {effectiveAim.toFixed(0)}° · Force {action.force} · {plan.valid ? `${previewPath.length} Cell predicted` : plan.reason}</span>
            <span>Click Cell = Aim only</span>
          </div>
          <div className="visual-board-toolbar ut4-board-toolbar">
            <div className="visual-camera-help">
              <button onClick={() => setCameraResetToken((value) => value + 1)}>重置视图</button>
              <span>悬停/点击 Cell 只改变推杆角度，不指定终点；轨迹与碰撞由系统预演。</span>
            </div>
            <div className="visual-session-controls"><button disabled={history.length === 0} onClick={undo}>Undo</button><button onClick={reset}>Reset</button></div>
          </div>
          <div className={`visual-board-frame ut4-board-frame view-${rendererMode}`}>
            {rendererMode === '2d' ? (
              <HexTravelMap
                state={lab.game}
                mode="tactical"
                path={previewPath}
                selectedCoord={selectedCoord}
                hoverCoord={hoverCoord}
                selection={boardSelection}
                targetLayer="ground"
                preference="fastest"
                event={event}
                momentumByActorId={momentumByActorId}
                onCellClick={handleBoardClick}
                onCellHover={handleBoardHover}
              />
            ) : spatialMode === 'hybrid' ? (
              <InertiaFieldBoard
                state={lab}
                validCoords={previewPath}
                selectedCoord={selectedCoord}
                hoverCoord={hoverCoord}
                previewPoints={hybridPreviewPoints}
                actorPoint={actorPoint}
                axis={playerSpatial.axis}
                playback={hybridPlayback}
                mode="hybrid"
                onCellClick={handleBoardClick}
                onCellHover={handleBoardHover}
              />
            ) : (
              <>
                <HexThreeBoard
                  state={lab.game}
                  mode="tactical"
                  travelPath={previewPath}
                  selectedCoord={selectedCoord}
                  hoverCoord={hoverCoord}
                  selection={boardSelection}
                  targetLayer="ground"
                  cameraResetToken={cameraResetToken}
                  showSky={false}
                  showDebug={false}
                  event={event}
                  eventDurationMs={430}
                  momentumByActorId={momentumByActorId}
                  onCellClick={handleBoardClick}
                  onCellHover={handleBoardHover}
                />
                <Ut5AxisOverlay state={lab.game} spatialByActorId={lab.spatialByActorId} cameraResetToken={cameraResetToken} active showAxisAtZero />
              </>
            )}
            {event && <div className={`visual-event-banner ${event.kind}`}><strong>{event.label ?? 'Impulse resolved'}</strong></div>}
            <div className="visual-board-legend ut4-board-legend">
              <span><i className="cold" />Blue path = predicted simulation</span>
              <span><i className="neutral" />Wall = collision, never auto-route</span>
              <span><i className="hot" />M = persistent speed</span>
            </div>
          </div>

          <section className="visual-hand ut4-action-hand ut6-action-hand impulse-action-hand">
            <div className="visual-hand-heading">
              <div><h2>Motion Cards · Force / Angle Input</h2><p>Card 决定你如何施力；终点不再是玩家输入。</p></div>
              <span>{plan.valid ? 'Preview ready' : 'Adjust aim'}</span>
            </div>
            <div className="ut4-action-card-row ut6-action-card-row impulse-card-row">
              {impulseActionSpecs.map((entry) => (
                <button
                  key={entry.id}
                  data-action-id={entry.id}
                  className={`ut2-action-card ut4-action-card ut6-action-card ${actionId === entry.id ? 'selected-action' : ''}`}
                  onClick={() => selectAction(entry.id)}
                >
                  <div className="ut2-action-title"><div><b>1<small>AT</small></b><span>{entry.label}</span></div><em>F{entry.force}</em></div>
                  <p>{entry.description}</p>
                  <span className="ut3-card-cta">{entry.shortLabel}</span>
                </button>
              ))}
            </div>
            <div className="impulse-commit-row">
              <div><strong>Aim {effectiveAim.toFixed(0)}°</strong><span> → predicted M{plan.afterM} / {previewPath.length} Cell</span></div>
              <button data-testid="impulse-commit" disabled={!plan.valid} onClick={commit}>Apply Impulse · Resolve 1 AT</button>
            </div>
          </section>

          <details className="ut4-diagnostics" open>
            <summary>Event Log · {lab.logs.length} events · Impulse / Collision / Thermal</summary>
            <div className="ut4-diagnostics-body">
              <div className="ut4-log-list">
                {lab.logs.length === 0 && <p className="ut4-empty">从 M0 Drive 开始；比较加速、Coast、反冲、急转和撞墙。</p>}
                {lab.logs.map((entry) => (
                  <article key={entry.id}>
                    <header><strong>{entry.timeAt.toFixed(1)} AT · {entry.action}</strong><span>{axisLabel(entry.beforeSpatial.axis)} M{entry.beforeSpatial.level} → {axisLabel(entry.afterSpatial.axis)} M{entry.afterSpatial.level}</span></header>
                    <p>T {entry.beforeThermal.temperature.toFixed(2)} → {entry.afterThermal.temperature.toFixed(2)} · Drift {entry.beforeThermal.drift.toFixed(2)} → {entry.afterThermal.drift.toFixed(2)}</p>
                    <small>{entry.detail}</small>
                  </article>
                ))}
              </div>
              <div className="ut4-test-strip"><strong>Impulse v1</strong><span>No Target Cell</span><span>Persistent M</span><span>Forced Travel</span><span>Collision</span><span>2D/3D</span><span>Discrete/Hybrid</span></div>
            </div>
          </details>
        </section>

        <aside className="visual-panel visual-right-panel ut4-debug-panel ut6-debug-panel">
          <section>
            <div className="visual-section-heading"><h3>Spatial Playback A/B</h3><span>presentation only</span></div>
            <div className="impulse-ab-switch">
              <button className={spatialMode === 'discrete' ? 'active' : ''} onClick={() => { setSpatialMode('discrete'); setActorPoint(normalizedCellCenter(player.position)); setHybridPlayback(undefined) }}>Discrete</button>
              <button className={spatialMode === 'hybrid' ? 'active' : ''} onClick={() => { setSpatialMode('hybrid'); setActorPoint(normalizedCellCenter(player.position)); setHybridPlayback(undefined) }}>Hybrid</button>
            </div>
            <small>两者共享同一 Impulse simulation。Hybrid 只改变 3D 路径表现，不改变结果。</small>
          </section>

          <section>
            <div className="visual-section-heading"><h3>Aim / Force</h3><span>input</span></div>
            <div className="impulse-direction-grid">
              {directions.map((direction) => <button key={direction} onClick={() => setAimDeg(directionAngle(direction))}>{direction}</button>)}
            </div>
            <NumberControl label="Aim Angle" value={effectiveAim} min={0} max={359} step={1} onChange={(value) => { setHoverAimDeg(null); setAimDeg(value) }} />
            <div className="impulse-aim-window"><span>{action.label}</span><strong>{action.id === 'coast' ? 'Heading locked' : `±${action.aimWindowDeg}° window`}</strong></div>
          </section>

          <section>
            <div className="visual-section-heading"><h3>Quick Motion Presets</h3><span>player</span></div>
            <div className="ut6-preset-grid">
              <button onClick={() => setMomentumPreset(0)}>M0</button>
              <button onClick={() => setMomentumPreset(1)}>E M1</button>
              <button onClick={() => setMomentumPreset(2)}>E M2</button>
              <button onClick={() => setMomentumPreset(3)}>E M3</button>
              <button onClick={rebuildCollisionCourse}>Collision Course</button>
            </div>
          </section>

          <section>
            <div className="visual-section-heading"><h3>Collision</h3><span>{settings.collisionMode}</span></div>
            <div className="impulse-ab-switch">
              {(['bounce', 'stop'] as CollisionMode[]).map((mode) => <button key={mode} className={settings.collisionMode === mode ? 'active' : ''} onClick={() => setSettings((current) => ({ ...current, collisionMode: mode }))}>{mode}</button>)}
            </div>
            <NumberControl label="Hard retention" value={settings.hardRetention} min={0} max={1} step={0.05} onChange={(hardRetention) => setSettings((current) => ({ ...current, hardRetention }))} />
            <NumberControl label="Reflect retention" value={settings.reflectorRetention} min={0} max={1} step={0.05} onChange={(reflectorRetention) => setSettings((current) => ({ ...current, reflectorRetention }))} />
            <NumberControl label="Actor loss" value={settings.actorMomentumLoss} min={0} max={3} step={1} onChange={(actorMomentumLoss) => setSettings((current) => ({ ...current, actorMomentumLoss }))} />
          </section>

          <section id="impulse-thermal-debug">
            <div className="visual-section-heading"><h3>Thermal State</h3><span>{domainLabel(domain)}</span></div>
            <div className="ut4-quick-row"><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: -4 }))}>T -4</button><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: 1 }))}>T +1</button><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: 4 }))}>T +4</button></div>
            <NumberControl label="Temperature" value={lab.thermal.temperature} min={-6} max={6} step={0.25} onChange={(temperature) => setLab((current) => setThermalDebug(current, { temperature }))} />
            <NumberControl label="Drift" value={lab.thermal.drift} min={-4} max={4} step={0.25} onChange={(drift) => setLab((current) => setThermalDebug(current, { drift }))} />
            <NumberControl label="Set Point" value={lab.thermal.setPoint} min={-2} max={2} step={0.25} onChange={(setPoint) => setLab((current) => setThermalDebug(current, { setPoint }))} />
          </section>

          <section>
            <div className="visual-section-heading"><h3>Spatial Debug</h3><span>{selectedActor.name}</span></div>
            <label className="ut4-select-row"><span>Actor</span><select value={selectedActor.id} onChange={(event) => setLab((current) => setSelectedActor(current, event.target.value))}>{lab.game.actors.filter((actor) => actor.alive).map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
            <label className="ut4-select-row"><span>Axis</span><select value={axisValue(selectedSpatial.axis)} onChange={(event) => setDebugSpatial(selectedSpatial.level, selectedAxis(event.target.value))}><option value="none">None</option>{directions.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></label>
            <div className="ut4-quick-row">{([0, 1, 2, 3] as MomentumLevel[]).map((level) => <button key={level} className={selectedSpatial.level === level ? 'active' : ''} onClick={() => setDebugSpatial(level, level > 0 ? (selectedSpatial.axis?.kind === 'horizontal' ? selectedSpatial.axis : horizontalAxis('E')) : null)}>M{level}</button>)}</div>
          </section>

          <section>
            <div className="visual-section-heading"><h3>Board / Session</h3><span>restored lab tools</span></div>
            <NumberControl label="Board Radius" value={lab.setup.boardRadius} min={4} max={10} step={1} onChange={changeRadius} />
            <div className="ut4-quick-row"><button className={lab.setup.spawnEnemies ? 'active' : ''} onClick={toggleEnemies}>Enemies {lab.setup.spawnEnemies ? 'ON' : 'OFF'}</button><button onClick={() => setCameraResetToken((value) => value + 1)}>Reset Camera</button></div>
          </section>
        </aside>
      </section>
    </main>
  )
}
