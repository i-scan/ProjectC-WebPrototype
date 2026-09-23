import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { playbackFromPlan, playbackProgress, playbackRemainingMs } from '../../sim/plan-playback.js'
import { buildGameplayATPlan, buildGameplaySpatialPreview, GAMEPLAY_TIMELINE, sampleGameplayATPlan } from './gameplay-at-plan.js'
import { ThermalPendulum } from '../thermal/ThermalClockLabV3.jsx'
import { Board3D } from '../../ui/Board3D.jsx'
import { collisionObstaclesFromCells, createCellWorld } from '../../sim/world.js'
import { axialKey } from '../../sim/hex.js'
import { AT_VISUAL_MS } from '../../sim/solver.js'
import { TRAJECTORY_DEFAULT_RADIUS, TRAJECTORY_RULE } from '../trajectory/trajectory-rules.js'
import { THERMAL_CLOCK_SOLVER, formatThermal, thermalDiagnostics } from '../thermal/thermal-clock-model.js'
import { THERMAL_INERTIAL_SOLVER, inertialDiagnostics } from '../thermal/thermal-inertial-model.js'
import {
  thermalConfigFromProfile,
  thermalDynamicsMode,
  thermalEnvironment,
  thermalInertialConfigFromProfile,
  thermalStateFromProfile,
  withThermalTuning,
} from '../../thermal/thermal-profile.js'
import {
  applyLiveThermalProfile,
  getActiveThermalProfile,
  subscribeThermalProfile,
} from '../../thermal/thermal-profile-store.js'
import {
  SHARED_THERMAL_RUNTIME,
} from '../../thermal/thermal-runtime.js'
import {
  GAMEPLAY_ACTIONS_V1,
  GAMEPLAY_V1,
  actorBoardRecord,
  actorSpatialState,
  createDefaultEnemies,
  createMomentumActor,
  isDownSide,
  momentumBand,
  reachableTargets,
} from './gameplay-momentum-model.js'
import {
  GAMEPLAY_SPATIAL_AUTHORITY,
  GAMEPLAY_SPATIAL_PATH_RULE,
  GAMEPLAY_SPATIAL_REFLECTION_RULE,
  gameplayActorToTrajectoryState,
  usesTrajectoryRuntime,
} from './gameplay-lab-runtime.js'

const BOARD_RADIUS = TRAJECTORY_DEFAULT_RADIUS
const EMPTY_REACHABLE = Object.freeze([])
const clone = (value) => JSON.parse(JSON.stringify(value))

function thermalDomain(temperature) {
  if (temperature >= 3) return 'HOT'
  if (temperature <= -3) return 'COLD'
  return 'NEUTRAL'
}

function traceSummary(result, thermalEvents, domainTrace) {
  if (!result?.valid) return result?.reason || 'Select a valid target.'
  const parts = []
  for (const entry of result.trace ?? []) {
    if (entry.from && entry.to) parts.push(`${entry.actorId ? `${entry.actorId}: ` : ''}${entry.from}→${entry.to} · ${entry.cause}`)
    else if (entry.cause) parts.push(entry.actorId ? `${entry.cause}(${entry.actorId})` : entry.cause)
  }
  for (const entry of thermalEvents) {
    if (entry.type === 'ThermalDriveStart') {
      parts.push(`${entry.source}: Drive ${entry.driveRate >= 0 ? '+' : ''}${entry.driveRate.toFixed(2)} [${entry.scope}]`)
    } else if (entry.type === 'ThermalDriveEnd') {
      parts.push(`${entry.source}: Drive End @ ${entry.t.toFixed(2)}AT`)
    } else if (entry.type === 'ThermalDeposit') {
      parts.push(`${entry.source}: Deposit ${entry.deposit >= 0 ? '+' : ''}${entry.deposit.toFixed(2)}T [${entry.scope}]`)
    } else {
      parts.push(`${entry.source}: ${entry.impulse >= 0 ? '+' : ''}${entry.impulse.toFixed(2)}V [${entry.scope}]`)
    }
  }
  for (const entry of domainTrace ?? []) {
    parts.push(entry.suppressed
      ? `Domain ${entry.channel} suppressed · ${entry.reason}`
      : `Domain ${entry.channel} ${entry.fromM}→${entry.toM}`)
  }
  return parts.join(' · ') || '1AT resolved.'
}

export function GameplayLab() {
  const profile = useSyncExternalStore(subscribeThermalProfile, getActiveThermalProfile, getActiveThermalProfile)
  const [thermal, setThermal] = useState(() => thermalStateFromProfile(getActiveThermalProfile()))
  const [previousThermal, setPreviousThermal] = useState(null)
  const [player, setPlayer] = useState(() => createMomentumActor({ id: 'player' }))
  const [enemies, setEnemies] = useState(() => createDefaultEnemies())
  const [worldAt, setWorldAt] = useState(0)
  const [selectedActionId, setSelectedActionId] = useState('move')
  const [environmentId, setEnvironmentId] = useState('adiabatic')
  const [hoverHex, setHoverHex] = useState(null)
  const [selectedHex, setSelectedHex] = useState(null)
  const [viewMode, setViewMode] = useState('isometric')
  const [cameraResetToken, setCameraResetToken] = useState(0)
  const [history, setHistory] = useState([])
  const [lastTrace, setLastTrace] = useState('Gameplay v1 ready · build / spend Momentum and watch Thermal feedback.')
  const [momentumFactor, setMomentumFactor] = useState(0.8)
  const [collisionHeatFactor, setCollisionHeatFactor] = useState(0.8)
  const [collisionDamage, setCollisionDamage] = useState(false)
  const [domainNaturalBuild, setDomainNaturalBuild] = useState(true)
  const [wallsEnabled, setWallsEnabled] = useState(true)
  const [responseCurve, setResponseCurve] = useState('linear')
  const [thermalConfigOverride, setThermalConfigOverride] = useState(null)
  const [atVisualMs, setAtVisualMs] = useState(AT_VISUAL_MS)
  const [playback, setPlayback] = useState(null)
  const [uiProgress, setUiProgress] = useState(0)
  const [fullPreviewEntry, setFullPreviewEntry] = useState(null)
  const [lastPlanningMs, setLastPlanningMs] = useState(0)
  const [lastPlan, setLastPlan] = useState(null)
  const playbackRef = useRef(null)
  const playbackId = useRef(0)
  const ready = !playback

  const cells = useMemo(() => createCellWorld(BOARD_RADIUS), [])
  const obstacles = useMemo(() => wallsEnabled
    ? collisionObstaclesFromCells(cells).filter((entry) => entry.wallAxis)
    : [], [cells, wallsEnabled])
  const actions = GAMEPLAY_ACTIONS_V1
  const selectedAction = actions.find((entry) => entry.id === selectedActionId) ?? actions[0]
  const dynamicsMode = thermalDynamicsMode(profile)
  const inertialConfig = thermalInertialConfigFromProfile(profile)
  const inertialMode = dynamicsMode === 'inertial'
  const thermalAuthority = inertialMode ? THERMAL_INERTIAL_SOLVER : THERMAL_CLOCK_SOLVER
  const environment = thermalEnvironment(profile, environmentId)
  const liveThermalConfig = useMemo(() => thermalConfigFromProfile(profile, environmentId), [profile, environmentId])
  const thermalConfig = thermalConfigOverride ?? liveThermalConfig
  const thermalDerived = inertialMode
    ? inertialDiagnostics(thermal, thermalConfig, inertialConfig)
    : thermalDiagnostics(thermal, thermalConfig)
  const publishDynamicsMode = (nextMode) => {
    if (playbackRef.current || nextMode === dynamicsMode) return false
    applyLiveThermalProfile(withThermalTuning(profile, { dynamicsMode: nextMode }))
    setFullPreviewEntry(null)
    clearAim()
    return true
  }
  const tuneInertial = (key, value) => {
    if (playbackRef.current) return false
    applyLiveThermalProfile(withThermalTuning(profile, {
      inertialConfig: { ...inertialConfig, [key]: Number(value) },
    }))
    setFullPreviewEntry(null)
    clearAim()
    return true
  }
  const tuneThermal = (key, value) => setThermalConfigOverride((current) => ({
    ...(current ?? liveThermalConfig),
    [key]: Number(value),
  }))
  const tuneThermalState = (key, value) => {
    if (playbackRef.current) return
    setThermal((current) => ({ ...current, [key]: Number(value) }))
  }
  const allActors = useMemo(() => [player, ...enemies], [player, enemies])
  const reachable = useMemo(
    () => reachableTargets(player, selectedActionId, BOARD_RADIUS, allActors),
    [player, selectedActionId, allActors],
  )
  const reachableKeys = useMemo(() => new Set(reachable.map((entry) => axialKey(entry.hex))), [reachable])
  const targetHex = hoverHex ?? selectedHex
  const requiresTarget = selectedAction.target !== 'none'
  const trajectoryTargetInput = requiresTarget && usesTrajectoryRuntime(player, selectedActionId)
  const previewContextKey = useMemo(() => JSON.stringify({
    worldAt,
    player: {
      id: player.id, hex: player.hex, hp: player.hp, hM: player.hM, axisId: player.axisId,
      downM: player.downM, downPrepared: player.downPrepared,
    },
    enemies: enemies.map((actor) => ({
      id: actor.id, hex: actor.hex, hp: actor.hp, hM: actor.hM, axisId: actor.axisId,
      downM: actor.downM, downPrepared: actor.downPrepared,
      intent: actor.intent, intentIndex: actor.intentIndex,
    })),
    thermal: {
      temperature: thermal.temperature, drift: thermal.drift, setPoint: thermal.setPoint,
    },
    profile: { id: profile.id, revision: profile.revision },
    environmentId,
    wallsEnabled,
    responseCurve,
    thermalConfig,
    momentumFactor,
    collisionHeatFactor,
    collisionDamage,
    domainNaturalBuild,
  }), [
    worldAt, player, enemies, thermal, profile.id, profile.revision, environmentId,
    wallsEnabled, responseCurve, thermalConfig, momentumFactor, collisionHeatFactor,
    collisionDamage, domainNaturalBuild,
  ])
  const previewKeyFor = (actionId, hex) => hex
    ? `${previewContextKey}|${actionId}:${axialKey(hex)}`
    : `${previewContextKey}|${actionId}:none`
  const planInput = useMemo(() => ({ player, enemies, thermal, profile, worldAt, environmentId,
    boardRadius: BOARD_RADIUS, obstacles, responseCurve, thermalConfigOverride: thermalConfig,
    collisionDamage, momentumFactor, collisionHeatFactor, domainNaturalBuild }),
  [player, enemies, thermal, profile, worldAt, environmentId, obstacles, responseCurve, thermalConfig,
    collisionDamage, momentumFactor, collisionHeatFactor, domainNaturalBuild])
  const previewKey = requiresTarget && targetHex ? previewKeyFor(selectedActionId, targetHex) : null
  const lightPreviewPlan = useMemo(() => previewKey
    ? buildGameplaySpatialPreview({
      player, enemies, worldAt, actionId: selectedActionId, targetHex,
      boardRadius: BOARD_RADIUS, obstacles, responseCurve,
    })
    : null,
  [previewKey, player, enemies, worldAt, selectedActionId, targetHex?.q, targetHex?.r, obstacles, responseCurve])
  const immediateContactPreviewEntry = useMemo(() => {
    if (!previewKey || playbackRef.current || !lightPreviewPlan?.cellConflict) return null
    const started = performance.now()
    const plan = buildGameplayATPlan({ ...planInput, actionId: selectedActionId, targetHex })
    return { plan, planningMs: performance.now() - started }
  }, [previewKey, lightPreviewPlan?.cellConflict, planInput, selectedActionId, targetHex?.q, targetHex?.r])
  const fullPreviewPlan = immediateContactPreviewEntry?.plan
    ?? (fullPreviewEntry?.key === previewKey ? fullPreviewEntry.plan : null)

  useEffect(() => {
    if (immediateContactPreviewEntry) setLastPlanningMs(immediateContactPreviewEntry.planningMs)
  }, [immediateContactPreviewEntry])

  useEffect(() => {
    if (!previewKey || playbackRef.current || lightPreviewPlan?.cellConflict) {
      setFullPreviewEntry(null)
      return undefined
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      const started = performance.now()
      const plan = buildGameplayATPlan({ ...planInput, actionId: selectedActionId, targetHex })
      const planningMs = performance.now() - started
      if (!cancelled) {
        setLastPlanningMs(planningMs)
        setFullPreviewEntry({ key: previewKey, plan })
      }
    }, 70)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [previewKey, planInput, selectedActionId, targetHex?.q, targetHex?.r])

  const previewPlan = fullPreviewPlan ?? lightPreviewPlan
  const shownPlan = playback ?? fullPreviewPlan
  const previewThermalEvents = shownPlan?.sourceThermalEvents ?? []
  const previewSourceImpulse = previewThermalEvents
    .filter((entry) => entry.type === 'ThermalImpulse')
    .reduce((sum, entry) => sum + (entry.impulse ?? 0), 0)
  const previewDriveRate = previewThermalEvents
    .filter((entry) => entry.type === 'ThermalDriveStart')
    .reduce((sum, entry) => sum + (entry.driveRate ?? 0), 0)
  const previewDeposit = previewThermalEvents
    .filter((entry) => entry.type === 'ThermalDeposit')
    .reduce((sum, entry) => sum + (entry.deposit ?? 0), 0)
  const previewThermal = { finalState: shownPlan?.finalState?.thermal ?? thermal }
  const previewDomain = { actor: shownPlan?.finalState?.player ?? player, trace: shownPlan?.domainTrace ?? [] }
  const previewResolution = shownPlan ? { valid: shownPlan.valid, reason: shownPlan.reason,
    trace: shownPlan.events?.filter((entry) => entry.type === 'MomentumTransaction').flatMap((entry) => entry.trace.map((trace) => ({ ...trace, actorId: entry.actorId }))) ?? [] } : null
  const visual = useMemo(() => playback ? sampleGameplayATPlan(playback, uiProgress) : null, [playback, uiProgress])
  const displayThermal = visual?.thermal ?? thermal
  const displayPlayer = visual?.player.actor ?? player
  const displayEnemies = visual ? enemies.map((actor) => visual.actors[actor.id].actor) : enemies
  const displayConfig = playback?.config ?? thermalConfig
  const displayDynamicsMode = playback?.thermalDynamicsMode ?? dynamicsMode
  const displayInertialConfig = playback?.thermalInertialConfig ?? inertialConfig
  const playerSpatial = useMemo(() => gameplayActorToTrajectoryState(player, worldAt), [player, worldAt])
  const boardActors = useMemo(() => enemies.filter((entry) => entry.hp > 0).map(actorBoardRecord), [enemies])
  const axisDisplayOverride = isDownSide(displayPlayer) ? `down-${displayPlayer.downM}` : 'auto'

  const clearAim = () => {
    setHoverHex(null)
    setSelectedHex(null)
  }

  const beginAction = (actionId, hex = null) => {
    if (playbackRef.current) return false
    const actionKey = previewKeyFor(actionId, hex)
    let plan = fullPreviewEntry?.key === actionKey ? fullPreviewEntry.plan : null
    if (!plan) {
      const started = performance.now()
      plan = buildGameplayATPlan({ ...planInput, actionId, targetHex: hex })
      setLastPlanningMs(performance.now() - started)
    }
    if (!plan?.valid) { setLastTrace(plan?.reason || 'No legal target.'); return false }
    const before = {
      player: clone(player),
      enemies: clone(enemies),
      thermal: clone(thermal),
      previousThermal: previousThermal ? clone(previousThermal) : null,
      worldAt,
      lastTrace,
    }
    setHistory((entries) => [...entries, before].slice(-40))
    const next = playbackFromPlan(plan, ++playbackId.current, atVisualMs)
    playbackRef.current = next
    setPlayback(next)
    setUiProgress(0)
    setSelectedActionId(actionId)
    setSelectedHex(hex)
    setHoverHex(null)
    return true
  }

  useEffect(() => {
    if (!playback) return undefined

    // Same contract as Trajectory: renderers sample the frozen playback clock;
    // React only samples it at a low diagnostic rate and never drives simulation.
    const updateUiSample = () => {
      if (playbackRef.current?.id !== playback.id) return
      setUiProgress(playbackProgress(playback))
    }
    updateUiSample()
    const uiTimer = window.setInterval(updateUiSample, 50)

    const commitTimer = window.setTimeout(() => {
      if (playbackRef.current?.id !== playback.id) return
      setUiProgress(1)
      // Only this boundary mutates the authoritative Ready state.
      setPreviousThermal(thermal)
      setPlayer(playback.finalState.player)
      setEnemies(playback.finalState.enemies)
      setThermal(playback.finalState.thermal)
      setWorldAt(playback.finalState.worldAt)
      setLastPlan(playback)
      setLastTrace(playback.events.filter((event) => !['Declare', 'Ready'].includes(event.type))
        .map((event) => {
          let thermalText = ''
          if (event.type === 'ThermalImpulse') thermalText = ` · ${event.source} ${event.impulse >= 0 ? '+' : ''}${event.impulse.toFixed(2)}V`
          if (event.type === 'ThermalDriveStart') thermalText = ` · ${event.source} Drive ${event.driveRate >= 0 ? '+' : ''}${event.driveRate.toFixed(2)}`
          if (event.type === 'ThermalDriveEnd') thermalText = ` · ${event.source} Drive End`
          if (event.type === 'ThermalDeposit') thermalText = ` · ${event.source} Deposit ${event.deposit >= 0 ? '+' : ''}${event.deposit.toFixed(2)}T`
          return `${event.t.toFixed(2)}AT ${event.type}${thermalText}`
        }).join(' · '))
      playbackRef.current = null
      setPlayback(null)
      clearAim()
    }, playbackRemainingMs(playback))

    return () => {
      window.clearInterval(uiTimer)
      window.clearTimeout(commitTimer)
    }
  }, [playback?.id])

  const undo = () => {
    if (playbackRef.current) return
    const previous = history.at(-1)
    if (!previous) return
    setHistory((entries) => entries.slice(0, -1))
    setPlayer(previous.player)
    setEnemies(previous.enemies)
    setThermal(previous.thermal)
    setPreviousThermal(previous.previousThermal)
    setWorldAt(previous.worldAt)
    setLastTrace(previous.lastTrace)
    setLastPlan(null)
    setFullPreviewEntry(null)
    clearAim()
  }

  const reset = () => {
    if (playbackRef.current) return
    setPlayer(createMomentumActor({ id: 'player' }))
    setEnemies(createDefaultEnemies())
    setThermal(thermalStateFromProfile(profile))
    setPreviousThermal(null)
    setWorldAt(0)
    setSelectedActionId('move')
    setEnvironmentId('adiabatic')
    setWallsEnabled(true)
    setResponseCurve('linear')
    setThermalConfigOverride(null)
    setAtVisualMs(AT_VISUAL_MS)
    setHistory([])
    setLastPlan(null)
    setFullPreviewEntry(null)
    setLastTrace(`Reset from ${profile.label} r${profile.revision}.`)
    clearAim()
  }

  const loadDebugScenario = ({
    player: nextPlayer,
    enemies: nextEnemies = [],
    thermal: nextThermal = null,
    worldAt: nextWorldAt = 0,
    selectedActionId: nextActionId = 'move',
  } = {}) => {
    if (playbackRef.current || !nextPlayer) return false
    setPlayer(createMomentumActor(nextPlayer))
    setEnemies(nextEnemies.map(createMomentumActor))
    if (nextThermal) setThermal({ ...nextThermal })
    setWorldAt(Number(nextWorldAt) || 0)
    setSelectedActionId(nextActionId)
    setHistory([])
    setLastPlan(null)
    setFullPreviewEntry(null)
    setLastTrace('Debug scenario loaded for deterministic browser validation.')
    clearAim()
    return true
  }

  useEffect(() => {
    window.__PROJECTC_GAMEPLAY_LAB__ = {
      snapshot: () => ({
        implementation: GAMEPLAY_V1,
        runtime: SHARED_THERMAL_RUNTIME,
        profile: { id: profile.id, revision: profile.revision, dynamicsMode },
        dynamicsMode,
        inertialConfig: clone(inertialConfig),
        selectedActionId,
        player: clone(player),
        momentumBand: momentumBand(player),
        enemies: clone(enemies),
        environmentId,
        spatialAuthority: GAMEPLAY_SPATIAL_AUTHORITY,
        spatialPathRule: GAMEPLAY_SPATIAL_PATH_RULE,
        spatialReflectionRule: GAMEPLAY_SPATIAL_REFLECTION_RULE,
        thermalAuthority,
        wallsEnabled,
        responseCurve,
        thermalConfig: clone(thermalConfig),
        factors: { momentumFactor, collisionHeatFactor, collisionDamage, domainNaturalBuild },
        thermal: clone(thermal),
        predictedThermal: clone(previewThermal.finalState),
        previewThermalEvents: clone(previewThermalEvents),
        worldAt,
        timeline: GAMEPLAY_TIMELINE,
        ready,
        progress: uiProgress,
        visual: visual ? clone(visual) : null,
        previewFinal: fullPreviewPlan?.valid ? clone(fullPreviewPlan.finalState) : null,
        spatialPreviewFinal: previewPlan?.valid ? clone(previewPlan.finalState) : null,
        previewCellConflict: previewPlan?.cellConflict ? clone(previewPlan.cellConflict) : null,
        planningMs: lastPlanningMs,
        playbackFinal: playback ? clone(playback.finalState) : null,
        events: clone((playback ?? previewPlan ?? lastPlan)?.events ?? []),
        historyEntries: history.length,
      }),
      reset,
      loadDebugScenario,
      setWalls: (enabled) => {
        if (playbackRef.current) return false
        setWallsEnabled(Boolean(enabled))
        clearAim()
        return true
      },
      playAction: (actionId, hex = null) => beginAction(actionId, hex),
      setThermalMode: publishDynamicsMode,
      setInertialConfig: (next) => {
        if (playbackRef.current) return false
        applyLiveThermalProfile(withThermalTuning(profile, {
          inertialConfig: { ...inertialConfig, ...next },
        }))
        setFullPreviewEntry(null)
        clearAim()
        return true
      },
    }
    return () => { delete window.__PROJECTC_GAMEPLAY_LAB__ }
  })

  return (
    <main
      className="current-prototype cell-world-prototype gameplay-lab"
      data-implementation={GAMEPLAY_V1}
      data-shared-thermal-runtime={SHARED_THERMAL_RUNTIME}
      data-profile-id={profile.id}
      data-profile-revision={profile.revision}
      data-gameplay-action-id={selectedActionId}
      data-momentum-band={momentumBand(player)}
      data-world-at={worldAt.toFixed(1)}
      data-gameplay-timeline={GAMEPLAY_TIMELINE}
      data-spatial-authority={GAMEPLAY_SPATIAL_AUTHORITY}
      data-spatial-path-rule={GAMEPLAY_SPATIAL_PATH_RULE}
      data-spatial-reflection-rule={GAMEPLAY_SPATIAL_REFLECTION_RULE}
      data-thermal-authority={thermalAuthority}
      data-thermal-dynamics-mode={dynamicsMode}
      data-walls={wallsEnabled ? 'on' : 'off'}
      data-playback-state={ready ? 'ready' : 'playing'}
      data-playback-at={ready ? '0' : uiProgress.toFixed(3)}
    >
      <header className="prototype-header">
        <div className="brand"><p>ProjectC · Gameplay × Momentum × Thermal v1</p><h1>Gameplay Lab</h1></div>
        <div className="headline-state">
          <div><span>{ready ? 'Ready · World Time' : 'Playback · World Time'}</span><strong>{(worldAt + (ready ? 0 : uiProgress)).toFixed(2)} AT</strong></div>
          <div><span>Momentum</span><strong>{momentumBand(displayPlayer)}</strong></div>
          <div className={`thermal-${thermalDomain(displayThermal.temperature).toLowerCase()}`}><span>Thermal</span><strong>{thermalDomain(displayThermal.temperature)} · T {formatThermal(displayThermal.temperature, 2)}</strong></div>
          <div><span>Drift {displayDynamicsMode === 'inertial' ? 'D' : 'V'}</span><strong>{formatThermal(displayThermal.drift, 2)} / AT</strong></div>
          <div><span>Cell</span><strong>{displayPlayer.hex.q},{displayPlayer.hex.r}</strong></div>
        </div>
      </header>

      <section className="lab-grid gameplay-grid">
        <aside className="side-panel left-panel">
          <section className="panel-card actor-card">
            <div className="portrait">⬡</div>
            <div><p>Gameplay Actor</p><h2>Courier</h2><span className="actor-sub">Momentum / Thermal candidate</span></div>
          </section>

          <section className="panel-card actor-vitals">
            <div className="section-heading"><h3>Actor State</h3><span>{momentumBand(displayPlayer)}</span></div>
            <div className="vital-row"><span>HP</span><i><b style={{ width: `${displayPlayer.hp}%` }} /></i><strong>{displayPlayer.hp}/100</strong></div>
            <div className="momentum-state-grid">
              <div><span>Horizontal</span><strong>{displayPlayer.axisId ? `H${displayPlayer.hM} · ${displayPlayer.axisId}` : '—'}</strong></div>
              <div><span>Down</span><strong>{isDownSide(displayPlayer) ? `D${displayPlayer.downM}` : '—'}</strong></div>
            </div>
            <div data-gameplay-thermal-pendulum="shared-runtime-v1">
              <ThermalPendulum state={displayThermal} config={displayConfig} previousState={previousThermal} dynamicsMode={displayDynamicsMode} inertialConfig={displayInertialConfig} className="gameplay-thermal-pendulum" />
            </div>
            <dl className="state-list actor-state-list">
              <div><dt>Temperature</dt><dd>{formatThermal(displayThermal.temperature, 2)}</dd></div>
              <div><dt>Drift {displayDynamicsMode === 'inertial' ? 'D' : 'V'}</dt><dd>{formatThermal(displayThermal.drift, 2)}</dd></div>
              <div><dt>Dynamics</dt><dd>{displayDynamicsMode}</dd></div>
              <div><dt>Set Point</dt><dd>{formatThermal(displayThermal.setPoint, 2)}</dd></div>
              <div><dt>Environment</dt><dd>{environment.label}</dd></div>
            </dl>
          </section>

          <section className="panel-card prediction-card">
            <div className="section-heading"><h3>Predicted Outcome</h3><span>candidate</span></div>
            <p>{previewResolution?.valid
              ? traceSummary(previewResolution, previewThermalEvents, previewDomain.trace)
              : requiresTarget
                ? (trajectoryTargetInput ? 'Select any direction Cell; Trajectory Lab resolves the actual path / reflection.' : (reachable.length ? 'Select a highlighted target / direction.' : 'No legal target for this action in the current Momentum state.'))
                : previewResolution?.reason || 'Ready.'}</p>
            <dl className="state-list compact">
              <div><dt>Ready Momentum</dt><dd>{momentumBand(previewDomain.actor)}</dd></div>
              <div><dt>{inertialMode ? 'Action Thermal' : 'Action ΔV'}</dt><dd>{inertialMode
                ? `Drive ${previewDriveRate >= 0 ? '+' : ''}${previewDriveRate.toFixed(2)} · Deposit ${previewDeposit >= 0 ? '+' : ''}${previewDeposit.toFixed(2)}`
                : `${previewSourceImpulse >= 0 ? '+' : ''}${previewSourceImpulse.toFixed(2)}`}</dd></div>
              <div><dt>Ready T</dt><dd>{formatThermal(previewThermal.finalState.temperature, 2)}</dd></div>
              <div><dt>Ready {inertialMode ? 'D' : 'V'}</dt><dd>{formatThermal(previewThermal.finalState.drift, 2)}</dd></div>
              <div><dt>Target</dt><dd>{targetHex ? axialKey(targetHex) : '—'}</dd></div>
            </dl>
          </section>
        </aside>

        <section className="center-column">
          <div className="board-strip">
            <strong>{selectedAction.label} · 1AT</strong>
            <span>{!ready ? `PLAYING ${uiProgress.toFixed(2)} / 1 AT · input locked` : requiresTarget
              ? (selectedHex ? `Target ${axialKey(selectedHex)} selected` : (trajectoryTargetInput ? 'Choose any direction Cell · Trajectory Lab authority' : (reachable.length ? 'Choose a highlighted target / direction' : 'Current state has no legal target')))
              : selectedAction.short}</span>
          </div>
          <div className="board-toolbar">
            <div className="view-switch">
              <button type="button" className={viewMode === 'isometric' ? 'active' : ''} onClick={() => setViewMode('isometric')}>3D</button>
              <button type="button" className={viewMode === 'top' ? 'active' : ''} onClick={() => setViewMode('top')}>Top</button>
              <button type="button" onClick={() => setCameraResetToken((value) => value + 1)}>Reset View</button>
            </div>
            <div className="session-buttons"><button type="button" disabled={!ready || !history.length} onClick={undo}>Undo</button><button type="button" disabled={!ready} onClick={reset}>Reset</button></div>
          </div>

          <div className="board-frame gameplay-board-frame">
            <Board3D
              cells={cells}
              obstacles={obstacles}
              actors={boardActors}
              reachableCells={ready && !trajectoryTargetInput ? reachable : EMPTY_REACHABLE}
              state={playerSpatial}
              previewPlan={ready ? previewPlan : null}
              playback={playback}
              atVisualMs={atVisualMs}
              axisDisplayOverride={axisDisplayOverride}
              boardRadius={BOARD_RADIUS + 1}
              viewMode={viewMode}
              cameraResetToken={cameraResetToken}
              hoverHex={hoverHex}
              selectedAimHex={selectedHex}
              showWeather={false}
              showThermal
              onHoverHex={(hex) => {
                if (playbackRef.current) return
                if (!hex || !requiresTarget || axialKey(hex) === axialKey(player.hex)) return setHoverHex(null)
                if (!trajectoryTargetInput && !reachableKeys.has(axialKey(hex))) return setHoverHex(null)
                setHoverHex(hex)
              }}
              onClickHex={(hex) => {
                if (playbackRef.current || !hex || !requiresTarget || axialKey(hex) === axialKey(player.hex)) return
                if (!trajectoryTargetInput && !reachableKeys.has(axialKey(hex))) return
                beginAction(selectedActionId, { ...hex })
              }}
            />
            <div className="board-legend">
              <span><i className="terrain" />Move / Drive direction input uses Trajectory Lab cells</span>
              <span><i className="trajectory" />Blue path = Trajectory Lab curve / reflection</span>
              <span><i className="momentum-axis" />Horizontal M / Axis settlement comes from Trajectory runtime</span>
            </div>
          </div>

          <section className="action-hand gameplay-action-hand">
            <div className="hand-heading">
              <div><h2>Gameplay Actions · Momentum v1</h2><p>Move / Drive / horizontal Skip execute the Trajectory Lab runtime unchanged; Gameplay adds Down / Attack / Launch / Release and the M↔T bridge.</p></div>
              <span className="gameplay-ready-label" role="status">{ready ? 'READY · select → hover → click target' : `PLAYING · ${(uiProgress * 100).toFixed(0)}%`}</span>
            </div>
            <div className="action-row gameplay-action-row">
              {actions.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className={`action-card ${entry.id === selectedActionId ? 'selected' : ''} gameplay-action-${entry.id}`}
                  data-gameplay-action-id={entry.id}
                  disabled={!ready || player.hp <= 0}
                  onClick={() => {
                    if (playbackRef.current) return
                    if (entry.target === 'none') beginAction(entry.id)
                    else { setSelectedActionId(entry.id); clearAim() }
                  }}
                >
                  <header><strong>{entry.label}</strong><em>{entry.badge}</em></header>
                  <p>{entry.short}</p>
                  <span>1AT · {entry.target === 'none' ? 'click to play' : entry.target}</span>
                </button>
              ))}
            </div>
          </section>
        </section>

        <aside className="side-panel right-panel gameplay-right-panel">
          <fieldset disabled={!ready} className="panel-card gameplay-controls-card">
            <div className="section-heading"><h3>v1 Experiment Controls</h3><span>LIVE</span></div>
            <label><span>Playback / AT</span><input aria-label="Gameplay AT playback duration" type="range" min="200" max="3000" step="25" value={atVisualMs} onChange={(event) => setAtVisualMs(Number(event.target.value))} /><strong>{(atVisualMs / 1000).toFixed(2)}s</strong></label>
            <div className="gameplay-toggle-row">
              <button type="button" className={wallsEnabled ? 'chosen' : ''} onClick={() => setWallsEnabled((value) => !value)}>Trajectory Walls {wallsEnabled ? 'ON' : 'OFF'}</button>
              <button type="button" onClick={() => setResponseCurve((value) => value === 'linear' ? 'smoothstep' : 'linear')}>Curve {responseCurve}</button>
            </div>
            <div className="gameplay-toggle-row" data-gameplay-thermal-mode="shared-profile-v2">
              <button type="button" className={!inertialMode ? 'chosen' : ''} onClick={() => publishDynamicsMode('oscillator')}>Oscillator</button>
              <button type="button" className={inertialMode ? 'chosen' : ''} onClick={() => publishDynamicsMode('inertial')}>Inertial</button>
            </div>
            {inertialMode && <>
              <label><span>Drift Half-Life HD</span><input aria-label="Gameplay Drift Half-Life" type="range" min="0.25" max="3" step="0.05" value={inertialConfig.driftHalfLifeAt} onChange={(event) => tuneInertial('driftHalfLifeAt', event.target.value)} /><strong>{inertialConfig.driftHalfLifeAt.toFixed(2)} AT</strong></label>
              <label><span>Recovery Half-Life HR</span><input aria-label="Gameplay Recovery Half-Life" type="range" min="0.5" max="8" step="0.1" value={inertialConfig.recoveryHalfLifeAt} onChange={(event) => tuneInertial('recoveryHalfLifeAt', event.target.value)} /><strong>{inertialConfig.recoveryHalfLifeAt.toFixed(2)} AT</strong></label>
            </>}
            <label><span>{inertialMode ? 'M-T Drive Factor' : 'M-T Factor'}</span><input aria-label="M-T Factor" type="range" min="0" max="1.6" step="0.05" value={momentumFactor} onChange={(event) => setMomentumFactor(Number(event.target.value))} /><strong>{momentumFactor.toFixed(2)}</strong></label>
            <label><span>{inertialMode ? 'Collision Deposit' : 'Collision Heat'}</span><input aria-label="Collision Heat Factor" type="range" min="0" max="1.6" step="0.05" value={collisionHeatFactor} onChange={(event) => setCollisionHeatFactor(Number(event.target.value))} /><strong>{collisionHeatFactor.toFixed(2)}</strong></label>
            <div className="gameplay-toggle-row">
              <button type="button" className={collisionDamage ? 'chosen' : ''} onClick={() => setCollisionDamage((value) => !value)}>Collision Damage {collisionDamage ? 'ON' : 'OFF'}</button>
              <button type="button" className={domainNaturalBuild ? 'chosen' : ''} onClick={() => setDomainNaturalBuild((value) => !value)}>Domain Build {domainNaturalBuild ? 'ON' : 'OFF'}</button>
            </div>
          </fieldset>

          <section className="panel-card gameplay-enemy-card">
            <div className="section-heading"><h3>Telegraphed Enemies</h3><span>deterministic</span></div>
            <div className="enemy-intent-list">
              {displayEnemies.map((enemy) => (
                <div key={enemy.id} className={enemy.hp <= 0 ? 'is-dead' : ''}>
                  <strong>{enemy.id}</strong>
                  <span>HP {enemy.hp} · {momentumBand(enemy)}</span>
                  <em>Next: {enemy.intent?.toUpperCase() || 'WAIT'}</em>
                </div>
              ))}
            </div>
          </section>

          <fieldset disabled={!ready} className="panel-card gameplay-environment-card">
            <div className="section-heading"><h3>Environment Context</h3><span>Weather hook</span></div>
            <div className="gameplay-environment-buttons">
              {Object.values(profile.environments).map((entry) => <button type="button" key={entry.id} className={environmentId === entry.id ? 'chosen' : ''} onClick={() => { setEnvironmentId(entry.id); setThermalConfigOverride(null) }}>{entry.label}</button>)}
            </div>
            <dl className="state-list compact">
              <div><dt>Mode</dt><dd>{dynamicsMode}</dd></div>
              <div><dt>Tenv</dt><dd>{thermalConfig.environmentTemperature.toFixed(1)}</dd></div>
              <div><dt>kE</dt><dd>{thermalConfig.environmentCoupling.toFixed(2)}</dd></div>
              <div><dt>{inertialMode ? 'Net Rate' : 'cEff'}</dt><dd>{inertialMode ? formatThermal(thermalDerived.netRate, 3) : thermalDerived.cEff.toFixed(3)}</dd></div>
              <div><dt>Profile</dt><dd>{profile.id} r{profile.revision} · {profile.dynamicsMode}{thermalConfigOverride ? ' · LOCAL ENV' : ' · LIVE'}</dd></div>
            </dl>
            <label><span>Current T</span><input aria-label="Gameplay Thermal current temperature" type="range" min="-6" max="6" step="0.05" value={thermal.temperature} onChange={(event) => tuneThermalState('temperature', event.target.value)} /><strong>{thermal.temperature.toFixed(2)}</strong></label>
            <label><span>Current Drift {inertialMode ? 'D' : 'V'}</span><input aria-label="Gameplay Thermal current drift" type="range" min="-3" max="3" step="0.05" value={thermal.drift} onChange={(event) => tuneThermalState('drift', event.target.value)} /><strong>{thermal.drift.toFixed(2)}</strong></label>
            <label><span>Set Point S</span><input aria-label="Gameplay Thermal setPoint" type="range" min="-4" max="4" step="0.05" value={thermal.setPoint} onChange={(event) => tuneThermalState('setPoint', event.target.value)} /><strong>{thermal.setPoint.toFixed(2)}</strong></label>
            <label><span>{inertialMode ? 'kS · ignored' : 'kS · restoring'}</span><input aria-label="Gameplay Thermal restoringK" type="range" min="0" max="2" step="0.01" value={thermalConfig.restoringK} disabled={inertialMode} onChange={(event) => tuneThermal('restoringK', event.target.value)} /><strong>{thermalConfig.restoringK.toFixed(2)}</strong></label>
            <label><span>{inertialMode ? 'cBase · ignored' : 'cBase · damping'}</span><input aria-label="Gameplay Thermal baseDamping" type="range" min="0" max="3" step="0.01" value={thermalConfig.baseDamping} disabled={inertialMode} onChange={(event) => tuneThermal('baseDamping', event.target.value)} /><strong>{thermalConfig.baseDamping.toFixed(2)}</strong></label>
            <label><span>Tenv</span><input aria-label="Gameplay Thermal environmentTemperature" type="range" min="-6" max="6" step="0.1" value={thermalConfig.environmentTemperature} onChange={(event) => tuneThermal('environmentTemperature', event.target.value)} /><strong>{thermalConfig.environmentTemperature.toFixed(1)}</strong></label>
            <label><span>kE · coupling</span><input aria-label="Gameplay Thermal environmentCoupling" type="range" min="0" max="1" step="0.01" value={thermalConfig.environmentCoupling} onChange={(event) => tuneThermal('environmentCoupling', event.target.value)} /><strong>{thermalConfig.environmentCoupling.toFixed(2)}</strong></label>
            <label><span>{inertialMode ? 'cEnvGain · ignored' : 'cEnvGain'}</span><input aria-label="Gameplay Thermal environmentDampingGain" type="range" min="0" max="4" step="0.05" value={thermalConfig.environmentDampingGain} disabled={inertialMode} onChange={(event) => tuneThermal('environmentDampingGain', event.target.value)} /><strong>{thermalConfig.environmentDampingGain.toFixed(2)}</strong></label>
            <label><span>Clamp Min</span><input aria-label="Gameplay Thermal clampMin" type="range" min="-12" max="0" step="0.5" value={thermalConfig.clampMin} onChange={(event) => tuneThermal('clampMin', Math.min(Number(event.target.value), thermalConfig.clampMax - 0.5))} /><strong>{thermalConfig.clampMin.toFixed(1)}</strong></label>
            <label><span>Clamp Max</span><input aria-label="Gameplay Thermal clampMax" type="range" min="0" max="12" step="0.5" value={thermalConfig.clampMax} onChange={(event) => tuneThermal('clampMax', Math.max(Number(event.target.value), thermalConfig.clampMin + 0.5))} /><strong>{thermalConfig.clampMax.toFixed(1)}</strong></label>
            <div className="gameplay-toggle-row"><button type="button" disabled={!thermalConfigOverride} onClick={() => setThermalConfigOverride(null)}>Use Live Thermal Profile</button></div>
          </fieldset>

          <section className="panel-card" data-gameplay-resolution-trace="momentum-thermal-v1">
            <div className="section-heading"><h3>Resolution Trace</h3><span>cause-aware</span></div>
            <p className="gameplay-resolution-text">{lastTrace}</p>
            <ol className="gameplay-timeline" aria-label="AT event timeline">
              {(playback ?? previewPlan ?? lastPlan)?.events?.map((event) => <li key={event.id} data-event-type={event.type} className={playback && event.t <= uiProgress ? 'is-elapsed' : ''}>
                <time>{event.t.toFixed(2)}</time> {event.type} <small>{event.actorId ?? ''}{event.targetId ? ` → ${event.targetId}` : ''}{event.source ? ` · ${event.source}` : ''}</small>
              </li>)}
            </ol>
            <small>{inertialMode ? 'Inertial: Momentum semantic events create Drive; Collision dissipatedM creates instant Deposit; Drive End follows Intent / Forced Motion lifetime.' : 'Oscillator: Momentum semantic events create Drift impulses; Collision dissipatedM creates Hotward impulse.'} Domain Natural Build and same-AT suppression remain unchanged.</small>
          </section>

          <section className="panel-card gameplay-scope-card">
            <div className="section-heading"><h3>v1 Scope</h3><span>candidate</span></div>
            <ul>
              <li>Horizontal Move / Drive / Skip are Trajectory Lab authoritative</li>
              <li>Wall reflection / Cell path / M settlement use Trajectory runtime unchanged</li>
              <li>Drive / Brace symmetric fast establish</li>
              <li>HM2→DM0 and DM2→HM0 cross-channel candidate</li>
              <li>Launch / Release 1:1</li>
              <li>M ↔ Thermal + Domain Natural Build</li>
              <li>Shared Thermal dual-mode: Oscillator impulse / Inertial Drive + Deposit</li>
              <li>2 deterministic telegraphed enemies</li>
              <li>Deflect / Link / full AI still deferred</li>
              <li>P0: simultaneous contested Cell holds both; full settlement / chained resolution deferred</li>
              <li>Clash is a visible hook, not a frozen damage rule</li>
            </ul>
          </section>
        </aside>
      </section>
    </main>
  )
}
