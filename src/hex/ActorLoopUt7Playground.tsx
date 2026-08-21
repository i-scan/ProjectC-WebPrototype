import { useMemo, useState } from 'react'
import { actorAt, cellAt, getPlayer, type Coord } from '../game'
import type { PlaybackEvent } from '../visual/visualPlayback'
import { CoupledThermalPendulumPortal } from './CoupledThermalPendulumPortal'
import { HexThreeBoard, type HexBoardSelection } from './HexThreeBoard'
import { HexTravelMap } from './HexTravelMap'
import { Ut5AxisOverlay } from './Ut5AxisOverlay'
import {
  applyPreset,
  axisLabel,
  basicAttackPlan,
  brakePlan,
  createSpatialState,
  createUt7State,
  debugBuildProbePlan,
  defaultUt7Settings,
  downAxis,
  horizontalAxis,
  injectIncomingPlan,
  launchPlan,
  reconfigureUt7State,
  setSelectedActor,
  setSpatialDebug,
  setThermalDebug,
  steeringPlansForTarget,
  thermalDomainFor,
  thermalSideFor,
  ut7Config,
  waitPlan,
  type ActionPlan,
  type MomentumLevel,
  type NaturalBuildStartMode,
  type TurnBias,
  type Ut7Preset,
  type Ut7Settings,
  type Ut7State,
} from './actorLoopUt7'
import { HEX_DIRECTIONS, hexAdvance, type HexDirection } from './hexTopology'
import './hex.css'
import './hex-travel.css'
import './hex-view-mode.css'
import './thermal-clock.css'
import './thermal-pendulum.css'
import './coupled-inertia-lab.css'
import './actor-loop-ut6.css'
import './actor-loop-ut7.css'

type RendererMode = '2d' | '3d'
type PendingAction = 'steer' | 'attack' | 'launch' | null

type BoardPlan = {
  selector: Coord
  plan: ActionPlan
  alternatives?: ActionPlan[]
}

const directions = HEX_DIRECTIONS.map((entry) => entry.direction)
const inspectSelection: HexBoardSelection = { kind: 'inspect' }
const sameCoord = (a?: Coord, b?: Coord) => Boolean(a && b && a.x === b.x && a.y === b.y)
const coordKey = (coord: Coord) => `${coord.x},${coord.y}`

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

function eventForPlan(before: Ut7State, plan: ActionPlan): PlaybackEvent {
  const beforePlayer = getPlayer(before.game)
  const afterPlayer = getPlayer(plan.result.game)
  const changedActor = plan.result.game.actors.find((actor) => {
    const previous = before.game.actors.find((candidate) => candidate.id === actor.id)
    return previous && actor.id !== 'player' && actor.hp < previous.hp
  })
  if (changedActor) {
    const previous = before.game.actors.find((actor) => actor.id === changedActor.id)!
    return {
      id: Date.now(), kind: 'attack', effect: 'attack', sourceActorId: 'player', actorId: changedActor.id,
      target: { ...changedActor.position }, amount: previous.hp - changedActor.hp,
      label: `${plan.label} · -${previous.hp - changedActor.hp} HP`, durationAt: Math.max(0.5, plan.atCost),
    }
  }
  if (!sameCoord(beforePlayer.position, afterPlayer.position)) {
    return {
      id: Date.now(), kind: 'move', effect: 'move', actorId: 'player', target: { ...afterPlayer.position },
      label: `${plan.label} · ${plan.atCost} AT`, durationAt: Math.max(0.5, plan.atCost),
    }
  }
  return {
    id: Date.now(), kind: 'phase', effect: 'phase', actorId: 'player', target: { ...afterPlayer.position },
    label: `${plan.label} · ${plan.atCost} AT`, durationAt: Math.max(0.5, plan.atCost),
  }
}

function axisValue(axis: ReturnType<typeof createSpatialState>['axis']) {
  if (!axis) return 'none'
  if (axis.kind === 'horizontal') return axis.dir
  if (axis.kind === 'down') return 'down'
  return 'none'
}

function selectedAxis(value: string) {
  if (value === 'none') return null
  if (value === 'down') return downAxis()
  return horizontalAxis(value as HexDirection)
}

function actionClass(selected: boolean, valid = true) {
  return `ut2-action-card ut4-action-card ut6-action-card ut7-action-card ${selected ? 'selected-action' : ''} ${valid ? '' : 'ut6-invalid-action'}`
}

function TimelinePreview({ plan }: { plan?: ActionPlan }) {
  if (!plan?.valid || plan.timeline.length === 0) return null
  return (
    <div className="ut7-route-inspector" data-ut7-route-steps={plan.timeline.length}>
      <header><strong>Predicted Path</strong><span>ETA {plan.atCost} AT{plan.branch ? ` · ${plan.branch.toUpperCase()}` : ''}</span></header>
      <div className="ut7-route-rows">
        {plan.timeline.slice(0, 8).map((trace) => (
          <div key={trace.atIndex} className={`behavior-${trace.behavior}`}>
            <b>AT{trace.atIndex}</b>
            <span>M{trace.beforeM}→M{trace.afterM}</span>
            <span>{axisLabel(trace.beforeAxis)}→{axisLabel(trace.afterAxis)}</span>
            <span>{trace.cellSteps.map((step) => `${step.moveDirection}/${axisLabel(step.newAxis).replace('Axis ', '')}`).join(' · ') || 'No Move'}</span>
            <em>{trace.behavior} / {trace.thermalIntent}</em>
          </div>
        ))}
        {plan.timeline.length > 8 && <small>+ {plan.timeline.length - 8} more AT</small>}
      </div>
    </div>
  )
}

export function ActorLoopUt7Playground() {
  const [lab, setLab] = useState(createUt7State)
  const [settings, setSettings] = useState(defaultUt7Settings)
  const [history, setHistory] = useState<Ut7State[]>([])
  const [rendererMode, setRendererMode] = useState<RendererMode>('3d')
  const [pendingAction, setPendingAction] = useState<PendingAction>('steer')
  const [selectedCoord, setSelectedCoord] = useState<Coord>(() => ({ ...getPlayer(lab.game).position }))
  const [hoverCoord, setHoverCoord] = useState<Coord>()
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [event, setEvent] = useState<PlaybackEvent>()
  const [branchTarget, setBranchTarget] = useState<Coord>()
  const [previewOverride, setPreviewOverride] = useState<ActionPlan>()
  const [incomingDirection, setIncomingDirection] = useState<HexDirection>('E')
  const [incomingStrength, setIncomingStrength] = useState<MomentumLevel>(1)

  const player = getPlayer(lab.game)
  const playerSpatial = lab.spatialByActorId.player ?? createSpatialState()
  const selectedActor = lab.game.actors.find((actor) => actor.id === lab.selectedActorId) ?? player
  const selectedSpatial = lab.spatialByActorId[selectedActor.id] ?? createSpatialState()
  const domain = thermalDomainFor(lab.thermal.temperature)
  const side = thermalSideFor(lab.thermal.temperature, lab.thermal.setPoint)
  const momentumByActorId = useMemo(
    () => Object.fromEntries(Object.entries(lab.spatialByActorId).map(([actorId, spatial]) => [actorId, spatial.level])),
    [lab.spatialByActorId],
  )

  const steeringByCoord = useMemo(() => {
    const map = new Map<string, ActionPlan[]>()
    for (const cell of lab.game.cells) {
      if (cell.tags.includes('Void') || sameCoord(cell.coord, player.position) || actorAt(lab.game, cell.coord)) continue
      const plans = steeringPlansForTarget(lab, cell.coord, settings)
      if (plans.length > 0) map.set(coordKey(cell.coord), plans)
    }
    return map
  }, [lab, settings, player.position.x, player.position.y])

  const attackPlans = useMemo<BoardPlan[]>(() => lab.game.actors.flatMap((actor) => {
    if (!actor.alive || actor.id === 'player') return []
    const plan = basicAttackPlan(lab, actor.id, settings)
    return plan.valid ? [{ selector: { ...actor.position }, plan }] : []
  }), [lab, settings])

  const launchPlans = useMemo<BoardPlan[]>(() => directions.flatMap((direction) => {
    const selector = hexAdvance(player.position, direction)
    const plan = launchPlan(lab, direction, settings)
    return plan.valid ? [{ selector, plan }] : []
  }), [lab, settings, player.position.x, player.position.y])

  const steerPlans: BoardPlan[] = [...steeringByCoord.entries()].map(([key, plans]) => {
    const [x, y] = key.split(',').map(Number)
    return { selector: { x, y }, plan: plans[0], alternatives: plans }
  })
  const boardPlans = pendingAction === 'steer' ? steerPlans : pendingAction === 'attack' ? attackPlans : pendingAction === 'launch' ? launchPlans : []
  const hoverPlans = hoverCoord ? steeringByCoord.get(coordKey(hoverCoord)) : undefined
  const selectedBranchPlans = branchTarget ? steeringByCoord.get(coordKey(branchTarget)) : undefined
  const hoveredBoardPlan = boardPlans.find((entry) => hoverCoord && sameCoord(entry.selector, hoverCoord))?.plan
  const preview = previewOverride ?? hoveredBoardPlan ?? (pendingAction === 'steer' ? hoverPlans?.[0] : undefined)
  const previewPath = preview?.path ?? []
  const validCoords = boardPlans.map((entry) => entry.selector)
  const boardSelection: HexBoardSelection = pendingAction
    ? { kind: 'momentum', action: 'drive', validCoords, route: previewPath }
    : inspectSelection

  const brake = useMemo(() => brakePlan(lab, settings), [lab, settings])
  const wait = useMemo(() => waitPlan(lab), [lab])

  const commitPlan = (plan: ActionPlan, keepSelection = false) => {
    setPreviewOverride(undefined)
    setBranchTarget(undefined)
    if (!plan.valid) {
      setPreviewOverride(plan)
      return
    }
    setHistory((current) => [...current, structuredClone(lab)].slice(-120))
    setEvent(eventForPlan(lab, plan))
    setLab(plan.result)
    setSelectedCoord({ ...getPlayer(plan.result.game).position })
    if (!keepSelection) setPendingAction(null)
  }

  const handleBoardClick = (coord: Coord) => {
    setSelectedCoord(coord)
    if (pendingAction === 'steer') {
      const plans = steeringByCoord.get(coordKey(coord))
      if (plans?.length === 2) {
        setBranchTarget({ ...coord })
        setPreviewOverride(plans[0])
        return
      }
      if (plans?.[0]) {
        commitPlan(plans[0], true)
        return
      }
    }
    const boardPlan = boardPlans.find((entry) => sameCoord(entry.selector, coord))
    if (pendingAction && boardPlan) {
      commitPlan(boardPlan.plan, pendingAction === 'attack')
      return
    }
    const actor = actorAt(lab.game, coord)
    if (actor) setLab((current) => setSelectedActor(current, actor.id))
  }

  const reset = () => {
    const next = createUt7State(lab.setup)
    setLab(next)
    setSettings(defaultUt7Settings())
    setHistory([])
    setPendingAction('steer')
    setBranchTarget(undefined)
    setPreviewOverride(undefined)
    setSelectedCoord({ ...getPlayer(next.game).position })
    setHoverCoord(undefined)
    setEvent({ id: Date.now(), kind: 'reset', effect: 'reset', target: getPlayer(next.game).position, label: 'UT7 Reset' })
  }

  const undo = () => {
    const previous = history.at(-1)
    if (!previous) return
    setHistory((current) => current.slice(0, -1))
    setLab(previous)
    setBranchTarget(undefined)
    setPreviewOverride(undefined)
    setSelectedCoord({ ...getPlayer(previous.game).position })
    setEvent({ id: Date.now(), kind: 'reset', effect: 'reset', target: getPlayer(previous.game).position, label: 'Undo Whole Action' })
  }

  const usePreset = (preset: Ut7Preset) => {
    const next = applyPreset(lab, preset)
    setHistory((current) => [...current, structuredClone(lab)].slice(-120))
    setLab(next)
    setBranchTarget(undefined)
    setPreviewOverride(undefined)
    setSelectedCoord({ ...getPlayer(next.game).position })
  }

  const setDebugAxis = (value: string) => {
    const axis = selectedAxis(value)
    setLab((current) => setSpatialDebug(current, selectedActor.id, createSpatialState(
      axis ? selectedSpatial.level : 0,
      axis,
    )))
  }

  const changeRadius = (radius: number) => {
    const next = reconfigureUt7State(lab, { boardRadius: radius })
    setLab(next)
    setHistory([])
    setBranchTarget(undefined)
    setPreviewOverride(undefined)
    setSelectedCoord({ ...getPlayer(next.game).position })
    setHoverCoord(undefined)
    setCameraResetToken((value) => value + 1)
  }

  const toggleEnemies = () => {
    const next = reconfigureUt7State(lab, { spawnEnemies: !lab.setup.spawnEnemies })
    setLab(next)
    setHistory((current) => [...current, structuredClone(lab)].slice(-120))
    setBranchTarget(undefined)
    setPreviewOverride(undefined)
    setSelectedCoord({ ...getPlayer(next.game).position })
  }

  const previewText = preview?.valid
    ? `${preview.label} · ETA ${preview.atCost} AT · ${preview.summary}`
    : lab.logs[0]?.detail ?? '选择任意可达 Target；Axis/M 决定实际路径，不再因方向不匹配禁选。'
  const thermalPercent = clampPercent((lab.thermal.temperature - ut7Config.thermal.temperatureMin) / (ut7Config.thermal.temperatureMax - ut7Config.thermal.temperatureMin) * 100)

  return (
    <>
      <main className="visual-prototype hex-prototype coupled-inertia-lab ut4-hex-layout ut6-actor-loop ut7-actor-loop" data-ruleset="VAL-012-UT7-candidate" data-implementation="inertia-driving-playground-v1">
        <header className="visual-hud ut4-hud">
          <div className="visual-brand"><p className="eyebrow">ProjectC · VAL-012-UT7 · Inertia Driving</p><h1>Target-driven Steering Playground</h1></div>
          <div className="hex-view-switch" role="tablist" aria-label="UT7 renderer"><button className={rendererMode === '2d' ? 'active' : ''} onClick={() => setRendererMode('2d')}>2D</button><button className={rendererMode === '3d' ? 'active' : ''} onClick={() => setRendererMode('3d')}>3D</button></div>
          <div className="visual-turn-strip ut4-header-state">
            <div><span>World Time</span><strong>{lab.worldTimeAt.toFixed(1)} AT</strong></div>
            <div className={`domain-${domain}`}><span>Thermal</span><strong>{side.toUpperCase()} SIDE · T {lab.thermal.temperature.toFixed(1)}</strong></div>
            <div><span>Domain</span><strong>{domain.toUpperCase()}</strong></div>
            <div><span>Momentum</span><strong>M{playerSpatial.level}</strong></div>
            <div><span>Axis</span><strong>{axisLabel(playerSpatial.axis)}</strong></div>
          </div>
        </header>

        <section className="visual-layout ut4-visual-layout">
          <aside className="visual-panel visual-left-panel ut4-left-panel">
            <section className="visual-actor-card ut4-player-card"><div className="visual-portrait hex-portrait">⬡</div><div><p>UT7 Driver</p><h2>{player.name}</h2><div className="visual-bars"><div><span>HP</span><i><b style={{ width: `${player.hp / player.maxHp * 100}%` }} /></i><strong>{player.hp}/{player.maxHp}</strong></div><div><span>Thermal</span><i className="temperature"><b style={{ width: `${thermalPercent}%` }} /></i><strong>{lab.thermal.temperature.toFixed(1)}</strong></div></div></div></section>
            <section className="ut4-state-summary"><div className="visual-section-heading"><h3>Dual Inertia</h3><span>{side} side / {domain} domain</span></div><dl>
              <div><dt>Temperature</dt><dd>{lab.thermal.temperature.toFixed(2)}</dd></div><div><dt>Drift</dt><dd>{lab.thermal.drift.toFixed(2)}</dd></div><div><dt>Set Point</dt><dd>{lab.thermal.setPoint.toFixed(2)}</dd></div><div><dt>Momentum</dt><dd>M{playerSpatial.level}</dd></div><div><dt>Axis</dt><dd>{axisLabel(playerSpatial.axis)}</dd></div><div><dt>Board</dt><dd>R{lab.setup.boardRadius} · Enemies {lab.setup.spawnEnemies ? 'ON' : 'OFF'}</dd></div>
            </dl></section>
            <section className="visual-slice-note ut4-test-guide"><h3>UT7 Grammar</h3><p><b>Use</b> → Spend M → Coldward</p><p><b>Resist</b> → 改变 M / Redirect → Hotward</p><p><b>Generate</b> → M0 建立新惯性 → Hotward</p><p><b>Passive</b> → M 自然消散 → Balancing</p></section>
          </aside>

          <section className="visual-board-column hex-board-column ut4-board-column">
            <div className="hex-comparison-strip ut4-comparison-strip" data-preview-valid={preview?.valid ?? false}><strong>UT7 Steering</strong><span className="ut6-action-preview">{previewText}</span><span>Target ({selectedCoord.x},{selectedCoord.y})</span></div>
            <div className="visual-board-toolbar ut4-board-toolbar"><div className="visual-camera-help"><button onClick={() => setCameraResetToken((value) => value + 1)}>重置视图</button><span>Target 是意图；Preview 显示真实轨迹、ETA、逐格 Move/Axis 与每 AT Thermal Behavior。</span></div><div className="visual-session-controls"><button disabled={history.length === 0} onClick={undo}>Undo</button><button onClick={reset}>Reset</button></div></div>
            <div className={`visual-board-frame ut4-board-frame view-${rendererMode}`}>
              {rendererMode === '2d' ? <HexTravelMap state={lab.game} mode="tactical" path={previewPath} selectedCoord={selectedCoord} hoverCoord={hoverCoord} selection={boardSelection} targetLayer="ground" preference="fastest" event={event} momentumByActorId={momentumByActorId} onCellClick={handleBoardClick} onCellHover={setHoverCoord} /> : <HexThreeBoard state={lab.game} mode="tactical" travelPath={previewPath} selectedCoord={selectedCoord} hoverCoord={hoverCoord} selection={boardSelection} targetLayer="ground" cameraResetToken={cameraResetToken} showSky={false} showDebug={false} event={event} eventDurationMs={560} momentumByActorId={momentumByActorId} onCellClick={handleBoardClick} onCellHover={setHoverCoord} />}
              <Ut5AxisOverlay state={lab.game} spatialByActorId={lab.spatialByActorId} cameraResetToken={cameraResetToken} active={rendererMode === '3d'} showAxisAtZero />
              <TimelinePreview plan={preview} />
              {selectedBranchPlans?.length === 2 && branchTarget && <div className="ut7-branch-choice" data-ut7-branch-choice><span>180° Target · choose route</span>{selectedBranchPlans.map((plan) => <button key={plan.branch} data-ut7-branch={plan.branch} onMouseEnter={() => setPreviewOverride(plan)} onClick={() => commitPlan(plan, true)}>{plan.branch === 'cw' ? 'Clockwise ↻' : 'Counter-clockwise ↺'} · {plan.atCost}AT</button>)}</div>}
              {event && <div className={`visual-event-banner ${event.kind}`}><strong>{event.label ?? 'UT7 action'}</strong></div>}
              {event?.effect === 'attack' && <div key={event.id} className="ut7-hit-impact"><span>HIT</span><strong>-{event.amount ?? 0} HP</strong></div>}
              <div className="visual-board-legend ut4-board-legend"><span><i className="cold" />Cold Side → Down cap M3</span><span><i className="neutral" />Mismatch → cap M1</span><span><i className="hot" />Hot Side → Horizontal cap M3</span></div>
            </div>

            <section className="visual-hand ut4-action-hand ut6-action-hand ut7-action-hand"><div className="visual-hand-heading"><div><h2>Driving Actions</h2><p>基础驾驶先验证 Steering / Breakaway / Passive Stop；Release payoff 暂后置。</p></div><span>{pendingAction ? `Board Target · ${pendingAction}` : 'Actor Ready'}</span></div><div className="ut4-action-card-row ut6-action-card-row ut7-action-card-row">
              <button data-action-id="steer" className={actionClass(pendingAction === 'steer')} onClick={() => { setPreviewOverride(undefined); setBranchTarget(undefined); setPendingAction((current) => current === 'steer' ? null : 'steer') }}><div className="ut2-action-title"><div><b>ETA</b><span>Steer</span></div><em>Basic</em></div><p>选择 Target；每格最多 Redirect 60°。M 越高，转弯半径越大。</p><span className="ut3-card-cta">{pendingAction === 'steer' ? '选择 Target' : 'Drive'}</span></button>
              <button data-action-id="basic-attack" className={actionClass(pendingAction === 'attack')} onClick={() => { setPreviewOverride(undefined); setBranchTarget(undefined); setPendingAction((current) => current === 'attack' ? null : 'attack') }}><div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Basic Attack</span></div><em>Use</em></div><p>Down M → Spend1 → Incoming M1；不是所有攻击都消费 Horizontal M。</p><span className="ut3-card-cta">选择 Actor</span></button>
              <button data-action-id="launch" className={actionClass(pendingAction === 'launch', launchPlans.length > 0)} onClick={() => { setPreviewOverride(undefined); setBranchTarget(undefined); setPendingAction((current) => current === 'launch' ? null : 'launch') }}><div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Launch</span></div><em>Convert</em></div><p>快速绕过 Down Breakaway：Down → Horizontal M-1。</p><span className="ut3-card-cta">选择 Axis</span></button>
              <button data-action-id="brake" className={actionClass(false, brake.valid)} onMouseEnter={() => setPreviewOverride(brake)} onMouseLeave={() => setPreviewOverride(undefined)} onClick={() => commitPlan(brake)}><div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Brake</span></div><em>Convert</em></div><p>Horizontal → Down M-1；与基础 Passive Stop 区分。</p><span className="ut3-card-cta">{brake.valid ? 'Convert' : brake.reason}</span></button>
              <button data-action-id="wait" className={actionClass(false)} onMouseEnter={() => setPreviewOverride(wait)} onMouseLeave={() => setPreviewOverride(undefined)} onClick={() => commitPlan(wait, true)}><div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Wait / Hold</span></div><em>Passive</em></div><p>Horizontal M -1 / AT；Axis 保持；Balancing；归零当 AT 不建 Down。</p><span className="ut3-card-cta">Dissipate</span></button>
            </div></section>

            <details className="ut4-diagnostics"><summary>UT7 Event Log · {lab.logs.length} · Steering / Thermal / Build</summary><div className="ut4-diagnostics-body"><div className="ut4-log-list">{lab.logs.length === 0 && <p className="ut4-empty">先用 M1/M2/M3 East preset，对同一个侧后方 Target 比较转弯半径。</p>}{lab.logs.map((entry) => <article key={entry.id}><header><strong>{entry.timeAt.toFixed(1)} AT · {entry.action}</strong><span>{entry.behavior} / {entry.thermalIntent}</span></header><p>{axisLabel(entry.beforeSpatial.axis)} M{entry.beforeSpatial.level} → {axisLabel(entry.afterSpatial.axis)} M{entry.afterSpatial.level} · T {entry.beforeThermal.temperature.toFixed(2)}→{entry.afterThermal.temperature.toFixed(2)}</p><small>{entry.detail}</small></article>)}</div><div className="ut4-test-strip"><strong>UT7 T1–T15</strong><span>60°/120°/180°</span><span>Breakaway</span><span>Passive</span><span>Side Cap</span><span>Domain Efficiency</span></div></div></details>
          </section>

          <aside className="visual-panel visual-right-panel ut4-debug-panel ut6-debug-panel ut7-debug-panel">
            <section><div className="visual-section-heading"><h3>Steering Presets</h3><span>compare M radius</span></div><div className="ut6-preset-grid ut7-preset-grid">{(['neutral', 'm1-east', 'm2-east', 'm3-east', 'cold-down'] as Ut7Preset[]).map((preset) => <button key={preset} onClick={() => usePreset(preset)}>{preset}</button>)}</div><small className="ut6-note">M1/M2/M3 使用同一规则；差异来自 residual M 对真实位移方向的约束。</small></section>

            <section id="ut7-thermal-debug"><div className="visual-section-heading"><h3>Thermal State</h3><span>{side} side / {domain}</span></div><div className="ut4-quick-row"><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: -4 }))}>T -4</button><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: 1 }))}>T +1</button><button onClick={() => setLab((current) => setThermalDebug(current, { temperature: 4 }))}>T +4</button></div><NumberControl label="Temperature" value={lab.thermal.temperature} min={-6} max={6} step={0.25} onChange={(temperature) => setLab((current) => setThermalDebug(current, { temperature }))} /><NumberControl label="Drift" value={lab.thermal.drift} min={-4} max={4} step={0.25} onChange={(drift) => setLab((current) => setThermalDebug(current, { drift }))} /><NumberControl label="Set Point" value={lab.thermal.setPoint} min={-2} max={2} step={0.25} onChange={(setPoint) => setLab((current) => setThermalDebug(current, { setPoint }))} /></section>

            <section><div className="visual-section-heading"><h3>Spatial / Incoming</h3><span>{selectedActor.name}</span></div><label className="ut4-select-row"><span>Actor</span><select value={selectedActor.id} onChange={(event) => setLab((current) => setSelectedActor(current, event.target.value))}>{lab.game.actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label><label className="ut4-select-row"><span>Momentum</span><select value={selectedSpatial.level} onChange={(event) => { const level = Number(event.target.value) as MomentumLevel; setLab((current) => setSpatialDebug(current, selectedActor.id, createSpatialState(level, level > 0 ? selectedSpatial.axis ?? downAxis() : selectedSpatial.axis))) }}>{[0, 1, 2, 3].map((level) => <option key={level} value={level}>M{level}</option>)}</select></label><label className="ut4-select-row"><span>Axis</span><select value={axisValue(selectedSpatial.axis)} onChange={(event) => setDebugAxis(event.target.value)}><option value="none">None</option><option value="down">Down</option>{directions.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></label><label className="ut4-select-row"><span>Incoming Axis</span><select value={incomingDirection} onChange={(event) => setIncomingDirection(event.target.value as HexDirection)}>{directions.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></label><label className="ut4-select-row"><span>Incoming M</span><select value={incomingStrength} onChange={(event) => setIncomingStrength(Number(event.target.value) as MomentumLevel)}>{[1, 2, 3].map((level) => <option key={level} value={level}>M{level}</option>)}</select></label><button className="ut4-primary" onClick={() => commitPlan(injectIncomingPlan(lab, selectedActor.id, incomingDirection, incomingStrength), true)}>Inject Incoming · 0AT</button><button onClick={() => commitPlan(debugBuildProbePlan(lab, selectedSpatial.axis ?? horizontalAxis('E'), settings), true)}>Debug Compatible Build · 1AT</button></section>

            <section><div className="visual-section-heading"><h3>Experiment Settings</h3><span>candidate values</span></div><label className="ut4-select-row"><span>Natural Start</span><select value={settings.naturalBuildStartMode} onChange={(event) => setSettings((current) => ({ ...current, naturalBuildStartMode: event.target.value as NaturalBuildStartMode }))}><option value="axis-first">Axis First</option><option value="immediate-m1">Immediate M1</option></select></label><label className="ut4-select-row"><span>Launch/Brake Min</span><select value={settings.launchBrakeMinM} onChange={(event) => setSettings((current) => ({ ...current, launchBrakeMinM: Number(event.target.value) as 1 | 2 }))}><option value="1">M1</option><option value="2">M2</option></select></label><div className="ut6-toggle-list"><button className={settings.buildAfterConversionSameAt ? 'active' : ''} onClick={() => setSettings((current) => ({ ...current, buildAfterConversionSameAt: !current.buildAfterConversionSameAt }))}>Conversion same-AT Build · {settings.buildAfterConversionSameAt ? 'ON' : 'OFF'}</button><button className={settings.hotSideBreakawayAssistEnabled ? 'active' : ''} onClick={() => setSettings((current) => ({ ...current, hotSideBreakawayAssistEnabled: !current.hotSideBreakawayAssistEnabled }))}>Hot Side Breakaway Assist · {settings.hotSideBreakawayAssistEnabled ? 'ON' : 'OFF'}</button></div><small className="ut6-note">Normal Build +1；Matching Domain +2。Side 决定 cap，Domain 只决定 efficiency。</small></section>

            <section className="ut7-playground-setup"><div className="visual-section-heading"><h3>Playground Setup</h3><span>world fixture</span></div><NumberControl label="Board Radius" value={lab.setup.boardRadius} min={ut7Config.playground.minimumRadius} max={ut7Config.playground.maximumRadius} step={1} onChange={changeRadius} /><button data-control="spawn-enemies" className={lab.setup.spawnEnemies ? 'active' : ''} onClick={toggleEnemies}>Spawn Enemies · {lab.setup.spawnEnemies ? 'ON' : 'OFF'}</button><small className="ut6-note">Radius 重建 topology 并清 Undo/Preview；Enemy 开关尽量保留 Player T / Drift / M / Axis / World AT。</small></section>
          </aside>
        </section>
      </main>
      <CoupledThermalPendulumPortal enabled temperature={lab.thermal.temperature} setPoint={lab.thermal.setPoint} drift={lab.thermal.drift} elapsedAt={lab.worldTimeAt} thermalPeriodAt={ut7Config.thermal.thermalPeriodAt} onOpenDebug={() => document.getElementById('ut7-thermal-debug')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })} />
    </>
  )
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value))
}
