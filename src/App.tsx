import { useEffect, useMemo, useRef, useState } from 'react'
import { actorAt, cellAt, getPlayer, type Coord, type GameState } from './game'
import { HexThreeBoard, type HexBoardSelection } from './hex/HexThreeBoard'
import {
  allDrivePlans,
  applyMomentumInterruption,
  applyUt3ActionPhase,
  createSpatialInertiaState,
  evaluateUt3Action,
  impactForMomentum,
  prepareUt3MomentumScenario,
  rushStrikeTargets,
  spatialAfterUt3Action,
  type MomentumLabPreset,
  type MomentumLevel,
  type SpatialInertiaState,
} from './hex/actionChain'
import { createHexRoomState } from './hex/hexRoom'
import { runHexActorReady, runHexGlobalEnvironment } from './hex/hexRules'
import { HexTravelMap } from './hex/HexTravelMap'
import type { HexDirection } from './hex/hexTopology'
import { atPlaybackTiming, formatAtPlaybackRate, playbackDelayForAt } from './hex/atPlayback'
import type { PlaybackEvent } from './visual/visualPlayback'
import {
  createUnifiedTimeline,
  previewInterveningEvents,
  resolveUnifiedPlayerPhasedAction,
  unifiedTimelineConfig,
  type TimelinePhaseTrace,
  type TimelineState,
} from './hex/unifiedTimeline'
import './hex/hex-travel.css'
import './hex/momentum-lab.css'

const presetGroups: Array<{ label: string; items: Array<{ id: MomentumLabPreset; label: string }> }> = [
  {
    label: 'Carry / Impact',
    items: [
      { id: 'chain', label: 'T1 Drive → Rush' },
      { id: 'm0', label: 'T2 M0 Normal' },
      { id: 'm1', label: 'T3 M1 Push' },
      { id: 'm2', label: 'T4 M2 Launch' },
      { id: 'm3', label: 'T5 M3 Pierce' },
    ],
  },
  {
    label: 'Stability / Steering',
    items: [
      { id: 'normal-hit', label: 'T6 Normal Hit' },
      { id: 'intercept', label: 'T7 Intercept' },
      { id: 'brake', label: 'T11 Brake 180°' },
    ],
  },
  {
    label: 'Environment',
    items: [
      { id: 'hard', label: 'T8 Hard Wall' },
      { id: 'reflect-left', label: 'T9 Reflect Left' },
      { id: 'reflect-right', label: 'T10 Reflect Right' },
    ],
  },
]

const presetTitle = Object.fromEntries(presetGroups.flatMap((group) => group.items.map((item) => [item.id, item.label])))

function createLab(preset: MomentumLabPreset) {
  return prepareUt3MomentumScenario(createHexRoomState(4), preset)
}

function sameCoord(left: Coord, right: Coord) {
  return left.x === right.x && left.y === right.y
}

type LabRenderer = '2d' | '3d'
type LabPlaybackFrame = {
  state: GameState
  timeline: TimelineState
  spatial: SpatialInertiaState
  event: PlaybackEvent
}
type LabPlaybackCompletion = {
  state: GameState
  timeline: TimelineState
  spatial: SpatialInertiaState
  selection: HexBoardSelection
}

export function App() {
  const initial = useMemo(() => createLab('chain'), [])
  const [state, setState] = useState<GameState>(initial.state)
  const [spatial, setSpatial] = useState<SpatialInertiaState>(initial.spatial)
  const [timeline, setTimeline] = useState<TimelineState>(createUnifiedTimeline)
  const [preset, setPreset] = useState<MomentumLabPreset>('chain')
  const [selection, setSelection] = useState<HexBoardSelection>({ kind: 'inspect' })
  const [selectedCoord, setSelectedCoord] = useState<Coord>(() => ({ ...getPlayer(initial.state).position }))
  const [hoverCoord, setHoverCoord] = useState<Coord>()
  const [lastPhases, setLastPhases] = useState<TimelinePhaseTrace[]>([])
  const [rendererMode, setRendererMode] = useState<LabRenderer>('3d')
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const playbackTiming = useMemo(() => atPlaybackTiming(playbackRate), [playbackRate])
  const [playbackFrames, setPlaybackFrames] = useState<LabPlaybackFrame[]>([])
  const playbackCompletionRef = useRef<LabPlaybackCompletion | undefined>(undefined)
  const [lastResult, setLastResult] = useState('选择一个测试预设，或从 T1 开始选择 Drive。')

  const player = getPlayer(state)
  const drivePlans = allDrivePlans(state)
  const rushTargets = rushStrikeTargets(state, spatial)
  const inspectedCoord = hoverCoord ?? selectedCoord
  const inspectedActor = actorAt(state, inspectedCoord)
  const inspectedCell = cellAt(state, inspectedCoord)
  const previewTarget = rushTargets.find((target) => sameCoord(target.actor.position, inspectedCoord)) ?? rushTargets[0]
  const previewAction = selection.kind === 'momentum'
    ? evaluateUt3Action(selection.action, spatial, selection.action === 'drive' ? 'E' : previewTarget?.direction ?? spatial.axis ?? 'E')
    : undefined
  const previewEvents = previewInterveningEvents(timeline, previewAction?.actionTimeAt ?? 0)
  const brakeNeeded = rushTargets.some((target) => target.brakeRequired)
  const currentEvent = playbackFrames[0]?.event
  const playbackActive = playbackFrames.length > 0
  const displayedMomentum = spatial.activeMomentum || spatial.pendingMomentum
  const momentumByActorId = useMemo(() => ({ player: displayedMomentum }), [displayedMomentum])

  const loadPreset = (nextPreset: MomentumLabPreset) => {
    const next = createLab(nextPreset)
    setPreset(nextPreset)
    setState(next.state)
    setSpatial(next.spatial)
    setTimeline(createUnifiedTimeline())
    setSelection({ kind: 'inspect' })
    setSelectedCoord({ ...getPlayer(next.state).position })
    setHoverCoord(undefined)
    setLastPhases([])
    setPlaybackFrames([])
    playbackCompletionRef.current = undefined
    setLastResult(`${presetTitle[nextPreset]} 已加载；选择行动卡后在棋盘上提交。`)
  }

  const chooseAction = (action: 'drive' | 'rush-strike') => {
    if (playbackActive) return
    if (action === 'drive') {
      setSelection({ kind: 'momentum', action, validCoords: drivePlans.filter((plan) => plan.valid).map((plan) => plan.endpoint) })
      setLastResult('Drive 已选择：点击棋盘上的金色落点。')
      return
    }
    const legalTargets = rushTargets.filter((target) => !target.brakeRequired)
    setSelection({ kind: 'momentum', action, validCoords: legalTargets.map((target) => target.actor.position) })
    setLastResult(brakeNeeded && legalTargets.length === 0
      ? '目标位于 Axis 的 180° 反向：Rush 被方向承诺阻止，请先 Brake。'
      : 'Rush Strike 已选择：点击棋盘上的红色目标 Actor。')
  }

  const executeAction = (
    actionId: 'drive' | 'rush-strike' | 'brake',
    direction: HexDirection = spatial.axis ?? 'E',
    targetActorId?: string,
  ) => {
    if (playbackActive) return
    const evaluated = evaluateUt3Action(actionId, spatial, direction)
    if (evaluated.brakeRequired) {
      setLastResult('180° 反向需要先执行 Brake；本次 Rush 未提交。')
      return
    }
    const resolution = resolveUnifiedPlayerPhasedAction(
      state,
      timeline,
      evaluated.phases,
      (value, phase) => applyUt3ActionPhase(value, evaluated, phase, direction, targetActorId),
      {
        resolveActor: (value, actorId) => runHexActorReady(value, actorId),
        resolveEnvironment: (value) => runHexGlobalEnvironment(value),
      },
    )
    resolution.value.phase = 'player'
    resolution.value.phaseQueue = []
    const nextSpatial = spatialAfterUt3Action(evaluated, direction)
    setLastPhases(resolution.phases)
    setLastResult(
      resolution.value.logs.find((log) => log.includes(`[UT3] ${evaluated.definition.label}`))
        ?? resolution.value.logs.find((log) => log.startsWith('[UT3]'))
        ?? `${evaluated.definition.label} 已执行`,
    )
    const frames = resolution.frames.map((frame, index) => {
      const phaseMomentum = actionId === 'drive'
        ? evaluated.phases[index]?.momentumAfter ?? 0
        : actionId === 'rush-strike'
          ? evaluated.activeMomentumStart
          : spatial.activeMomentum || spatial.pendingMomentum
      const frameSpatial = createSpatialInertiaState({ axis: actionId === 'brake' ? spatial.axis : direction, activeMomentum: phaseMomentum })
      const targetActor = targetActorId ? frame.value.actors.find((actor) => actor.id === targetActorId) : undefined
      const target = actionId === 'rush-strike' ? targetActor?.position : getPlayer(frame.value).position
      return {
        state: frame.value,
        timeline: frame.timeline,
        spatial: frameSpatial,
        event: {
          id: Date.now() + index,
          kind: actionId === 'rush-strike' ? 'attack' : 'move',
          effect: actionId === 'rush-strike' ? 'attack' : 'move',
          target,
          actorId: actionId === 'rush-strike' ? targetActorId : 'player',
          sourceActorId: actionId === 'rush-strike' ? 'player' : undefined,
          label: frame.value.logs.find((log) => log.includes(`[UT3] ${evaluated.definition.label}`)) ?? frame.phase.label,
          durationAt: frame.phase.endAt - frame.phase.startAt,
        },
      } satisfies LabPlaybackFrame
    })
    const completionSelection: HexBoardSelection = actionId === 'drive'
      ? { kind: 'momentum', action: 'rush-strike', validCoords: rushStrikeTargets(resolution.value, nextSpatial).filter((target) => !target.brakeRequired).map((target) => target.actor.position) }
      : { kind: 'inspect' }
    playbackCompletionRef.current = { state: resolution.value, timeline: resolution.timeline, spatial: nextSpatial, selection: completionSelection }
    setSelection({ kind: 'inspect' })
    if (frames[0]) {
      setState(frames[0].state)
      setTimeline(frames[0].timeline)
      setSpatial(frames[0].spatial)
      setSelectedCoord({ ...getPlayer(frames[0].state).position })
      setPlaybackFrames(frames)
    }
  }

  useEffect(() => {
    if (playbackFrames.length === 0 || playbackTiming.manual) return
    const current = playbackFrames[0]
    const timer = window.setTimeout(() => {
      if (playbackFrames.length > 1) {
        const next = playbackFrames[1]
        setState(next.state)
        setTimeline(next.timeline)
        setSpatial(next.spatial)
        setSelectedCoord({ ...getPlayer(next.state).position })
        setPlaybackFrames((frames) => frames.slice(1))
        return
      }
      const completion = playbackCompletionRef.current
      if (completion) {
        setState(completion.state)
        setTimeline(completion.timeline)
        setSpatial(completion.spatial)
        setSelection(completion.selection)
        setSelectedCoord({ ...getPlayer(completion.state).position })
      }
      playbackCompletionRef.current = undefined
      setPlaybackFrames([])
    }, playbackDelayForAt(playbackTiming, current.event.durationAt ?? 1))
    return () => window.clearTimeout(timer)
  }, [playbackFrames, playbackTiming])

  const handleBoardClick = (coord: Coord) => {
    setSelectedCoord(coord)
    if (selection.kind !== 'momentum') return
    if (!selection.validCoords.some((target) => sameCoord(target, coord))) return
    if (selection.action === 'drive') {
      const plan = drivePlans.find((candidate) => sameCoord(candidate.endpoint, coord))
      if (plan) executeAction('drive', plan.direction)
      return
    }
    const target = rushTargets.find((candidate) => sameCoord(candidate.actor.position, coord))
    if (target) executeAction('rush-strike', target.direction, target.actor.id)
  }

  const setMomentum = (momentum: MomentumLevel) => {
    setSpatial(momentum === 0
      ? createSpatialInertiaState()
      : createSpatialInertiaState({ axis: 'E', pendingMomentum: momentum, chainOpen: true }))
    setSelection({ kind: 'inspect' })
    setLastResult(`诊断值已设为 Pending M${momentum}${momentum ? ' / Axis E / Chain Open' : '；Axis 与 Chain 已清空'}。`)
  }

  const triggerInterruption = (kind: 'normal-hit' | 'intercept') => {
    const result = applyMomentumInterruption(spatial, kind)
    const next = structuredClone(state)
    const nextPlayer = getPlayer(next)
    nextPlayer.hp = Math.max(1, nextPlayer.hp - 1)
    next.logs.unshift(`[UT3 Lab] ${result.label}`)
    setState(next)
    setSpatial(result.spatial)
    setSelection({ kind: 'inspect' })
    setLastResult(result.label)
  }

  return (
    <main className="momentum-lab" data-ruleset-id={unifiedTimelineConfig.rulesetId} data-implementation-id={unifiedTimelineConfig.implementationId}>
      <header className="momentum-lab__header">
        <div>
          <p>ProjectC · VAL-012-UT3 · candidate experiment</p>
          <h1>惯性实验室</h1>
          <span>旧 Square4 规则表已替换；这里与 Hex6 原型共用预览和执行规则。</span>
        </div>
        <div className="momentum-lab__clock"><span>World Time</span><strong>{timeline.worldTimeAt} AT</strong><small>{spatial.chainOpen ? 'Chain Window · 世界暂停' : 'Player Ready'}</small></div>
      </header>

      <section className="momentum-lab__layout">
        <aside className="momentum-lab__panel momentum-lab__presets">
          <div className="momentum-lab__section-title"><h2>测试预设</h2><span>T1–T11</span></div>
          {presetGroups.map((group) => (
            <section key={group.label}>
              <h3>{group.label}</h3>
              <div className="momentum-lab__preset-grid">
                {group.items.map((item) => <button className={preset === item.id ? 'active' : ''} key={item.id} onClick={() => loadPreset(item.id)}>{item.label}</button>)}
              </div>
            </section>
          ))}
          <section>
            <h3>直接设置 Momentum</h3>
            <div className="momentum-lab__momentum-set">
              {([0, 1, 2, 3] as MomentumLevel[]).map((momentum) => <button className={spatial.pendingMomentum === momentum ? 'active' : ''} key={momentum} onClick={() => setMomentum(momentum)}>M{momentum}</button>)}
            </div>
          </section>
          <section>
            <h3>Stability 事件</h3>
            <div className="momentum-lab__event-buttons">
              <button onClick={() => triggerInterruption('normal-hit')}>Normal Hit · M−1</button>
              <button onClick={() => triggerInterruption('intercept')}>Intercept · M−2</button>
            </div>
          </section>
        </aside>

        <section className="momentum-lab__stage">
          <div className="momentum-lab__preview">
            <div><span>Active / Pending</span><strong>M{spatial.activeMomentum} / M{spatial.pendingMomentum}</strong></div>
            <div><span>Axis</span><strong>{spatial.axis ?? '—'}</strong></div>
            <div><span>Carry</span><strong>{previewAction?.chained ? 'Skip Start' : 'No carry'}</strong></div>
            <div><span>Impact</span><strong>{previewAction?.impact ?? impactForMomentum(spatial.pendingMomentum)}</strong></div>
            <div><span>AT / Ready</span><strong>{previewAction?.actionTimeAt ?? 0} / {timeline.worldTimeAt + (previewAction?.actionTimeAt ?? 0)}</strong></div>
            <div><span>期间事件</span><strong>{previewEvents.length ? previewEvents.map((event) => `${event.timeAt}:${event.sourceId}`).join(' · ') : '无'}</strong></div>
          </div>
          <div className="momentum-lab__board">
            <div className="momentum-lab__view-controls">
              <div>
                <button className={rendererMode === '2d' ? 'active' : ''} onClick={() => setRendererMode('2d')}>2D</button>
                <button className={rendererMode === '3d' ? 'active' : ''} onClick={() => setRendererMode('3d')}>3D</button>
                {rendererMode === '3d' && <button onClick={() => setCameraResetToken((value) => value + 1)}>重置视图</button>}
              </div>
              <label>
                <span>AT 播放 {formatAtPlaybackRate(playbackTiming)}</span>
                <input type="range" min="0.25" max="4" step="0.25" value={playbackRate} onChange={(event) => setPlaybackRate(Number(event.target.value))} />
              </label>
            </div>
            {rendererMode === '2d' ? (
              <HexTravelMap
                state={state}
                mode="tactical"
                path={[]}
                selectedCoord={selectedCoord}
                hoverCoord={hoverCoord}
                selection={selection}
                targetLayer="ground"
                preference="fastest"
                event={currentEvent}
                momentumByActorId={momentumByActorId}
                onCellClick={handleBoardClick}
                onCellHover={setHoverCoord}
              />
            ) : (
              <HexThreeBoard
                state={state}
                mode="tactical"
                selectedCoord={selectedCoord}
                hoverCoord={hoverCoord}
                selection={selection}
                targetLayer="ground"
                cameraResetToken={cameraResetToken}
                showSky
                showDebug={false}
                event={currentEvent}
                eventDurationMs={playbackDelayForAt(playbackTiming, currentEvent?.durationAt ?? 1)}
                momentumByActorId={momentumByActorId}
                onCellClick={handleBoardClick}
                onCellHover={setHoverCoord}
              />
            )}
            {playbackActive && <div className="momentum-lab__phase-cue"><small>AT PHASE</small><strong>{currentEvent?.label}</strong><span>{timeline.worldTimeAt} AT · 剩余 {playbackFrames.length} 段</span></div>}
            {spatial.chainOpen && <div className="momentum-lab__chain"><small>CHAIN WINDOW</small><strong>Pending M{spatial.pendingMomentum} → {spatial.axis}</strong><span>世界时间不推进；选择下一动作。</span></div>}
          </div>
          <div className="momentum-lab__actions">
            <button disabled={playbackActive} className={selection.kind === 'momentum' && selection.action === 'drive' ? 'active' : ''} onClick={() => chooseAction('drive')}>
              <b>2<small> AT</small></b><strong>Drive</strong><span>Step 1 · M1 → Dash 2 · M2</span><em>选择后点击棋盘落点</em>
            </button>
            <button disabled={playbackActive} className={selection.kind === 'momentum' && selection.action === 'rush-strike' ? 'active' : ''} onClick={() => chooseAction('rush-strike')}>
              <b>{rushTargets.some((target) => target.chained) ? 1 : 2}<small> AT</small></b><strong>Rush Strike</strong><span>M0 Normal · M1 Push · M2 Launch · M3 Pierce</span><em>选择后点击棋盘 Actor</em>
            </button>
            {spatial.chainOpen && <button disabled={playbackActive} className={`brake ${brakeNeeded ? 'required' : ''}`} onClick={() => executeAction('brake')}>
              <b>1<small> AT</small></b><strong>Brake</strong><span>Skid Stop · Momentum / Axis 清零</span><em>{brakeNeeded ? '180° 反向必须执行' : '情境制动'}</em>
            </button>}
          </div>
          <div className="momentum-lab__result" role="status"><strong>{lastResult}</strong><span>{lastPhases.length ? lastPhases.map((phase) => `[${phase.startAt}–${phase.endAt}] ${phase.label}`).join(' → ') : '尚未提交动作'}</span></div>
        </section>

        <aside className="momentum-lab__panel momentum-lab__inspector">
          <div className="momentum-lab__section-title"><h2>诊断读数</h2><span>{presetTitle[preset]}</span></div>
          <dl>
            <div><dt>Active Momentum</dt><dd>M{spatial.activeMomentum}</dd></div>
            <div><dt>Pending Momentum</dt><dd>M{spatial.pendingMomentum}</dd></div>
            <div><dt>Axis / Chain</dt><dd>{spatial.axis ?? '—'} / {spatial.chainOpen ? 'Open' : 'Closed'}</dd></div>
            <div><dt>选中对象</dt><dd>{inspectedActor?.name ?? inspectedCell?.tags.find((tag) => tag.startsWith('UT3')) ?? `Cell (${inspectedCoord.x},${inspectedCoord.y})`}</dd></div>
            <div><dt>Surface</dt><dd>{inspectedCell?.tags.includes('UT3Hard') ? 'Hard Wall' : inspectedCell?.tags.includes('UT3ReflectLeft') ? 'Reflect Left' : inspectedCell?.tags.includes('UT3ReflectRight') ? 'Reflect Right' : 'None'}</dd></div>
          </dl>
          <section className="momentum-lab__legend">
            <h3>无需数字也应可辨识</h3>
            <div><i className="normal" /><span><b>M0 Normal</b>基础命中停顿</span></div>
            <div><i className="push" /><span><b>M1 Push</b>水平滑移 1 格</span></div>
            <div><i className="launch" /><span><b>M2 Launch</b>抛物线与落地</span></div>
            <div><i className="pierce" /><span><b>M3 Pierce</b>攻击者穿越落位</span></div>
            <div><i className="stability" /><span><b>Stability</b>受击但继续推进</span></div>
            <div><i className="intercept" /><span><b>Intercept</b>轨迹与 Chain 截断</span></div>
          </section>
          <section className="momentum-lab__logs">
            <h3>最近规则日志</h3>
            {state.logs.slice(0, 8).map((log, index) => <p key={`${index}-${log}`}>{log}</p>)}
          </section>
        </aside>
      </section>
    </main>
  )
}
