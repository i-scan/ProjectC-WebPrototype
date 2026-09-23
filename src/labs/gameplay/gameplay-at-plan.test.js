import { describe, expect, it } from 'vitest'
import { buildGameplayATPlan, buildGameplaySpatialPreview, sampleGameplayATPlan } from './gameplay-at-plan.js'
import { actorSpatialState, createDefaultEnemies, createMomentumActor } from './gameplay-momentum-model.js'
import { BASELINE_THERMAL_PROFILE, thermalConfigFromProfile, thermalStateFromProfile, withThermalTuning } from '../../thermal/thermal-profile.js'
import { thermalTimeline } from '../../thermal/thermal-runtime.js'
import { collisionObstaclesFromCells, createCellWorld } from '../../sim/world.js'
import {
  TRAJECTORY_BASE_DISSIPATION,
  TRAJECTORY_DEFAULT_RADIUS,
  makeTrajectoryState,
  resolveTrajectoryTargetContacts,
  trajectoryActionPlan,
} from '../trajectory/trajectory-rules.js'
import { gameplayActorToTrajectoryTarget } from './gameplay-lab-runtime.js'
import { playbackClockSample, playbackFromPlan, playbackProgress, playbackRemainingMs, sampleTimedRecord } from '../../sim/plan-playback.js'
import { encounterFxSpecs } from '../../ui/encounter-fx.js'

const make = (overrides = {}) => ({ player: createMomentumActor(), enemies: [],
  thermal: thermalStateFromProfile(), profile: BASELINE_THERMAL_PROFILE,
  actionId: 'drive', targetHex: { q: 1, r: 0 }, domainNaturalBuild: false, ...overrides })
const target = (overrides = {}) => createMomentumActor({ id: 'target', hex: { q: 1, r: 0 }, intent: 'attack', ...overrides })
const plan = (overrides) => buildGameplayATPlan(make(overrides))

describe('Gameplay AT plan: a frozen, queryable 1AT', () => {
  it('does not mutate Ready input during preview or sampling', () => {
    const input = make({ enemies: createDefaultEnemies() })
    const before = structuredClone(input)
    const result = buildGameplayATPlan(input)
    for (const t of [0, 0.1, 0.4, 0.72, 1]) sampleGameplayATPlan(result, t)
    expect(input).toEqual(before)
    expect(result.intents[1].targetHex).toEqual({ q: 2, r: 0 })
  })

  it('uses Trajectory visual samples while Thermal impulse still enters at the Gameplay event time', () => {
    const result = plan()
    const firstTravel = result.events.find((event) => event.type === 'Travel')
    const middle = sampleGameplayATPlan(result, 0.4)
    expect(middle.player.position.x).toBeGreaterThan(0)
    expect(middle.player.position.x).toBeLessThan(result.finalState.position.x)
    expect(middle.player.actor.hM).toBe(1)
    expect(middle.thermal.drift).toBe(0)
    const impulses = result.events.filter((event) => event.type === 'ThermalImpulse')
    expect(impulses).toHaveLength(1)
    expect(impulses[0].t).toBe(firstTravel.t)
    expect(sampleGameplayATPlan(result, firstTravel.t).thermal.drift).toBeCloseTo(0.8)
    expect(result.finalState.thermal.temperature).toBeGreaterThan(1)
  })

  it('samples the same final state that Commit will adopt', () => {
    const result = plan({ enemies: createDefaultEnemies(), worldAt: 7 })
    const end = sampleGameplayATPlan(result, 1)
    expect(end.player.actor).toEqual(result.finalState.player)
    expect(end.thermal).toEqual(result.finalState.thermal)
    expect(end.thermal.worldAt).toBe(8)
    for (const enemy of result.finalState.enemies) expect(end.actors[enemy.id].actor).toEqual(enemy)
  })

  it('freezes profile coefficients and remains identical at different playback speeds', () => {
    const input = make({ profile: structuredClone(BASELINE_THERMAL_PROFILE) })
    const result = buildGameplayATPlan(input)
    const expected = structuredClone(result.finalState)
    input.profile.revision += 1
    for (const durationMs of [200, 950, 3000]) {
      const playback = playbackFromPlan(result, 1, durationMs, 100)
      const half = playbackClockSample(playback, 100 + durationMs / 2)
      expect(half.progress).toBe(0.5)
      expect(half.remainingMs).toBe(durationMs / 2)
      expect(playbackProgress(playback, 100 + durationMs * 2)).toBe(1)
      expect(playbackRemainingMs(playback, 100 + durationMs * 2)).toBe(0)
      expect(playback.finalState).toEqual(expected)
    }
    expect(result.profileSnapshot.revision).not.toBe(input.profile.revision)
  })

  it('inherits Horizontal Skip semantics from Trajectory; Down entry remains an explicit Gameplay extension', () => {
    const coast = plan({ player: createMomentumActor({ hM: 1, axisId: 'E' }), actionId: 'skip', targetHex: null })
    expect([coast.finalState.player.hM, coast.finalState.player.axisId, coast.finalState.player.downPrepared]).toEqual([0, 'E', false])
    expect(coast.sourceThermalEvents).toEqual([])

    const hold = plan({ player: coast.finalState.player, actionId: 'skip', targetHex: null })
    expect([hold.finalState.player.hM, hold.finalState.player.axisId, hold.finalState.player.downPrepared]).toEqual([0, 'E', false])

    const brace = plan({ player: hold.finalState.player, actionId: 'brace', targetHex: null })
    expect([brace.finalState.player.hM, brace.finalState.player.axisId, brace.finalState.player.downPrepared, brace.finalState.player.downM])
      .toEqual([0, null, true, 0])
  })

  it('matches Trajectory Lab wall reflection, path and M settlement exactly', () => {
    const boardRadius = TRAJECTORY_DEFAULT_RADIUS
    const obstacles = collisionObstaclesFromCells(createCellWorld(boardRadius)).filter((entry) => entry.wallAxis)
    const player = createMomentumActor({ hex: { q: 2, r: 0 }, hM: 3, axisId: 'E' })
    const targetHex = { q: 3, r: 0 }
    const expected = trajectoryActionPlan({
      state: makeTrajectoryState({ hex: player.hex, axisId: player.axisId, momentum: player.hM, worldAt: 0 }),
      actionId: 'steer',
      selectedHex: targetHex,
      boardRadius,
      obstacles,
      responseCurve: 'linear',
      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,
    })
    const result = plan({ player, targetHex, actionId: 'move', boardRadius, obstacles })

    expect(expected.reflectionCount).toBeGreaterThan(0)
    expect(result.spatialAuthority).toBe(expected.valid ? 'val-012-process-steering-ab-v1-candidate' : '')
    expect(result.finalState.player.hex).toEqual(expected.finalHex)
    expect(result.finalState.player.hM).toBe(expected.finalM)
    expect(result.finalState.player.axisId).toBe(expected.finalState.axisId)
    expect(result.traversedCells).toEqual(expected.pathCells)
    expect(result.conflictEvents).toEqual(expected.conflictEvents)
    expect(result.samples.map((sample) => [sample.t, sample.position, sample.axisId, sample.momentumLevel]))
      .toEqual(expected.samples.map((sample) => [sample.t, sample.position, sample.axisId, sample.momentumLevel]))
  })

  it('uses the exact Thermal Clock config and thermalTimeline for the M→T bridge', () => {
    const config = {
      ...thermalConfigFromProfile(BASELINE_THERMAL_PROFILE, 'adiabatic'),
      restoringK: 0.73,
      baseDamping: 0.41,
      environmentTemperature: -2.2,
      environmentCoupling: 0.27,
      environmentDampingGain: 1.35,
    }
    const input = make({ thermalConfigOverride: config })
    const result = buildGameplayATPlan(input)
    const expected = thermalTimeline({
      state: { ...input.thermal, worldAt: input.thermal.worldAt ?? 0 },
      config,
      events: result.sourceThermalEvents,
    })
    expect(result.config).toEqual(config)
    expect(result.finalState.thermal.temperature).toBeCloseTo(expected.finalState.temperature, 10)
    expect(result.finalState.thermal.drift).toBeCloseTo(expected.finalState.drift, 10)
  })

  it('converts D to H once, never adds a second H Build impulse', () => {
    const result = plan({ player: createMomentumActor({ downM: 2, downPrepared: true }), actionId: 'launch' })
    expect(result.finalState.player.hM).toBe(2)
    expect(result.sourceThermalEvents).toHaveLength(1)
    expect(result.sourceThermalEvents[0]).toMatchObject({ source: 'Active D Spend / Convert', impulse: 1.6, t: 0.2 })
  })

  it('accepts Trajectory direction cells, but keeps Down Basic Move and invalid Release guarded', () => {
    expect(plan({ targetHex: { q: 5, r: 0 } }).valid).toBe(true)
    expect(plan({ player: createMomentumActor({ downM: 1 }), actionId: 'move' }).valid).toBe(false)
    expect(plan({ actionId: 'release' }).valid).toBe(false)
  })

  it('does not change timing when enemy input order changes', () => {
    const enemies = createDefaultEnemies()
    const a = plan({ enemies, actionId: 'skip', targetHex: null })
    const b = plan({ enemies: [...enemies].reverse(), actionId: 'skip', targetHex: null })
    expect(a.intents).toEqual(b.intents)
    const sorted = (result) => result.finalState.enemies.slice().sort((x, y) => x.id.localeCompare(y.id))
    expect(sorted(a)).toEqual(sorted(b))
  })
})

describe('Gameplay Inertial Thermal bridge', () => {
  const inertialProfile = () => withThermalTuning(BASELINE_THERMAL_PROFILE, {
    dynamicsMode: 'inertial',
    inertialConfig: { driftHalfLifeAt: 1, recoveryHalfLifeAt: 3 },
  })

  it('turns Active Momentum thermal semantics into sustained Drive at the real transaction time', () => {
    const result = plan({ profile: inertialProfile() })
    const firstTravel = result.events.find((event) => event.type === 'Travel' && event.actorId === 'player')
    const starts = result.sourceThermalEvents.filter((event) => event.type === 'ThermalDriveStart')
    const ends = result.sourceThermalEvents.filter((event) => event.type === 'ThermalDriveEnd')
    expect(result.thermalDynamicsMode).toBe('inertial')
    expect(starts).toHaveLength(1)
    expect(ends).toHaveLength(1)
    expect(starts[0]).toMatchObject({ source: 'Active H Build', driveRate: 0.8 })
    expect(starts[0].t).toBe(firstTravel.t)
    expect(ends[0].t).toBe(1)
    expect(result.sourceThermalEvents.some((event) => event.type === 'ThermalImpulse')).toBe(false)
    expect(sampleGameplayATPlan(result, starts[0].t - 0.001).thermal.drift).toBeCloseTo(0, 8)
    expect(sampleGameplayATPlan(result, Math.min(0.99, starts[0].t + 0.2)).thermal.drift).toBeGreaterThan(0)
    expect(result.finalState.thermal.drift).toBeGreaterThan(0)
    expect(result.finalState.thermal.temperature).toBeGreaterThan(1)
  })

  it('turns Active D Build into Coldward Drive without changing the Momentum rule', () => {
    const result = plan({
      profile: inertialProfile(),
      player: createMomentumActor(),
      actionId: 'brace',
      targetHex: null,
    })
    expect(result.finalState.player.downM).toBe(1)
    const drive = result.sourceThermalEvents.find((event) => event.type === 'ThermalDriveStart')
    expect(drive).toMatchObject({ source: 'Active D Build', driveRate: -0.8, t: 0.2 })
    expect(result.finalState.thermal.drift).toBeLessThan(0)
    expect(result.finalState.thermal.temperature).toBeLessThan(1)
  })

  it('turns Collision dissipatedM into instant Deposit while D Spend remains a Drive', () => {
    const result = plan({
      profile: inertialProfile(),
      player: createMomentumActor({ downM: 2, downPrepared: true }),
      actionId: 'release',
      targetHex: { q: 1, r: 0 },
      enemies: [target({ hex: { q: 1, r: 0 }, downM: 1, downPrepared: true, intent: 'skip' })],
    })
    const spendDrive = result.sourceThermalEvents.find((event) =>
      event.type === 'ThermalDriveStart' && event.source === 'Active D Spend / Convert')
    const deposit = result.sourceThermalEvents.find((event) =>
      event.type === 'ThermalDeposit' && event.source === 'Collision dissipatedM')
    expect(spendDrive?.driveRate).toBeGreaterThan(0)
    expect(deposit?.deposit).toBeGreaterThan(0)
    expect(result.sourceThermalEvents.some((event) =>
      event.type === 'ThermalDriveStart' && event.source === 'Collision dissipatedM')).toBe(false)
  })

  it('uses the exact shared Inertial thermalTimeline for Gameplay Preview and Commit state', () => {
    const profile = inertialProfile()
    const input = make({ profile, actionId: 'brace', targetHex: null })
    const result = buildGameplayATPlan(input)
    const expected = thermalTimeline({
      state: { ...input.thermal, worldAt: input.thermal.worldAt ?? 0 },
      config: result.config,
      events: result.sourceThermalEvents,
      dynamicsMode: 'inertial',
      inertialConfig: result.thermalInertialConfig,
    })
    expect(result.finalState.thermal.temperature).toBeCloseTo(expected.finalState.temperature, 10)
    expect(result.finalState.thermal.drift).toBeCloseTo(expected.finalState.drift, 10)
    expect(sampleGameplayATPlan(result, 1).thermal).toEqual(result.finalState.thermal)
  })
})

describe('Gameplay light preview contact authority', () => {
  it('exposes Trajectory cellConflict for HM3 into stationary M0 before full Gameplay planning', () => {
    const player = createMomentumActor({ hex: { q: 0, r: 0 }, hM: 3, axisId: 'E' })
    const enemy = target({ hex: { q: 1, r: 0 }, hM: 0, axisId: null, intent: 'skip' })
    const preview = buildGameplaySpatialPreview({
      player,
      enemies: [enemy],
      worldAt: 0,
      actionId: 'move',
      targetHex: { q: 3, r: 0 },
      boardRadius: TRAJECTORY_DEFAULT_RADIUS,
      obstacles: [],
      responseCurve: 'linear',
    })
    expect(preview.valid).toBe(true)
    expect(preview.cellConflict).toMatchObject({
      targetActorId: 'target',
      resolution: 'contact-strike-direct-transfer-v1',
    })
    expect(preview.finalState.player.hex).toEqual({ q: 1, r: 0 })
    expect(preview.finalState.enemies[0].hex.q).toBeGreaterThan(1)
  })
})

describe('Encounter regression: Trajectory contact authority', () => {
  function directContact({ player, enemy, targetHex, obstacles = [] }) {
    const base = trajectoryActionPlan({
      state: makeTrajectoryState({ hex: player.hex, axisId: player.axisId, momentum: player.hM, worldAt: 0 }),
      actionId: 'steer',
      selectedHex: targetHex,
      boardRadius: TRAJECTORY_DEFAULT_RADIUS,
      obstacles,
      responseCurve: 'linear',
      baseDissipationPerAction: TRAJECTORY_BASE_DISSIPATION,
    })
    return resolveTrajectoryTargetContacts(base, {
      actors: [gameplayActorToTrajectoryTarget(enemy)],
      obstacles,
      boardRadius: TRAJECTORY_DEFAULT_RADIUS,
    })
  }

  it('matches Trajectory Strike / Forced Move exactly for HM3 into M0', () => {
    const player = createMomentumActor({ hex: { q: 0, r: 0 }, hM: 3, axisId: 'E' })
    const enemy = target({ hex: { q: 1, r: 0 }, hM: 0, axisId: null, intent: 'skip' })
    const targetHex = { q: 3, r: 0 }
    const expected = directContact({ player, enemy, targetHex })
    const result = plan({ player, enemies: [enemy], actionId: 'move', targetHex })

    expect(expected.cellConflict?.targetActorId).toBe('target')
    expect(result.trajectoryContactAuthority).toBe(true)
    expect(result.finalState.player.hex).toEqual(expected.finalHex)
    expect(result.finalState.player.hM).toBe(expected.finalM)
    expect(result.finalState.player.axisId).toBe(expected.finalState.axisId)
    expect(result.finalState.enemies[0].hex).toEqual(expected.actorStates[0].hex)
    expect(result.finalState.enemies[0].hM).toBe(expected.actorStates[0].momentumLevel)
    expect(result.finalState.enemies[0].axisId).toBe(expected.actorStates[0].axisId)
    expect(result.actorTrajectories.target).toEqual(expected.actorTrajectories.target)
    expect(result.events.some((event) => event.type === 'MomentumTransfer')).toBe(true)
    expect(result.events.some((event) => event.type === 'ForcedMotion')).toBe(true)

    const end = sampleGameplayATPlan(result, 1)
    expect(end.player.actor).toEqual(result.finalState.player)
    expect(end.player.position).toEqual(result.finalState.position)
    expect(end.actors.target.actor).toEqual(result.finalState.enemies[0])
  })

  it('uses the Ready snapshot target state even when that M0 actor has a Move intent', () => {
    const player = createMomentumActor({ hex: { q: 0, r: 0 }, hM: 3, axisId: 'E' })
    const enemy = target({ hex: { q: 3, r: 0 }, hM: 0, axisId: 'W', intent: 'move' })
    const targetHex = { q: 3, r: 0 }
    const expected = directContact({ player, enemy, targetHex })
    const result = plan({ player, enemies: [enemy], actionId: 'move', targetHex })

    expect(result.trajectoryContactAuthority).toBe(true)
    expect(result.finalState.player.hex).toEqual(expected.finalHex)
    expect(result.finalState.player.hM).toBe(expected.finalM)
    expect(result.finalState.enemies[0].hex).toEqual(expected.actorStates[0].hex)
    expect(result.actorTrajectories.target).toEqual(expected.actorTrajectories.target)
    expect(result.events.some((event) => event.outcome === 'hold-both-p0; settlement-tie-break-deferred')).toBe(false)
  })

  it('matches Trajectory forced wall reflection after Actor contact', () => {
    const wall = { id: 'forced-reflect-wall', hex: { q: 4, r: 0 }, kind: 'hard', wallAxis: 'NS' }
    const player = createMomentumActor({ hex: { q: 0, r: 0 }, hM: 3, axisId: 'E' })
    const enemy = target({ hex: { q: 1, r: 0 }, hM: 0, axisId: null, intent: 'skip' })
    const targetHex = { q: 3, r: 0 }
    const expected = directContact({ player, enemy, targetHex, obstacles: [wall] })
    const result = plan({ player, enemies: [enemy], actionId: 'move', targetHex, obstacles: [wall] })

    expect(expected.conflictEvents.some((event) => event.kind === 'surface-reflection' && event.actorId === 'target')).toBe(true)
    expect(result.finalState.enemies[0].hex).toEqual(expected.actorStates[0].hex)
    expect(result.finalState.enemies[0].hM).toBe(expected.actorStates[0].momentumLevel)
    expect(result.finalState.enemies[0].axisId).toBe(expected.actorStates[0].axisId)
    expect(result.actorTrajectories.target).toEqual(expected.actorTrajectories.target)
    expect(result.conflictEvents).toEqual(expected.conflictEvents)
    expect(result.events.some((event) => event.type === 'SurfaceReflection' && event.actorId === 'target')).toBe(true)

    const window = result.actorPlaybackWindows.target
    const mid = sampleGameplayATPlan(result, (window.start + window.end) * 0.5).actors.target
    expect(mid.position).not.toEqual(actorSpatialState(enemy).position)
    const end = sampleGameplayATPlan(result, 1).actors.target
    expect(end.actor).toEqual(result.finalState.enemies[0])
    expect(end.position).toEqual(actorSpatialState(result.finalState.enemies[0], 1).position)
  })
})

describe('Encounter timeline adapter', () => {
  it('reuses Trajectory boundary reflection during Release Forced Motion instead of old terminal dissipation', () => {
    const result = plan({ player: createMomentumActor({ hex: { q: 3, r: 0 }, downM: 3, downPrepared: true }),
      actionId: 'release', targetHex: { q: 4, r: 0 }, enemies: [target({ hex: { q: 4, r: 0 }, intent: 'skip' })] })
    expect(result.events.find((event) => event.type === 'ForcedMotion').t).toBe(0.28)
    expect(result.events.some((event) => event.type === 'SurfaceReflection' && event.actorId === 'target')).toBe(true)
    expect(result.sourceThermalEvents.some((event) => event.source === 'Collision dissipatedM')).toBe(false)
  })

  it('keeps same-AT Domain refund suppression without generating recursive heat', () => {
    const result = plan({ actionId: 'launch', domainNaturalBuild: true,
      player: createMomentumActor({ downM: 2, downPrepared: true }),
      thermal: { temperature: -4, drift: 0, setPoint: -4, worldAt: 0 } })
    expect(result.sourceThermalEvents).toHaveLength(1)
    expect(result.finalState.player.downM).toBe(0)
  })
  it('holds Forced Motion until contact; cancels the target original intent', () => {
    const result = plan({ player: createMomentumActor({ downM: 2, downPrepared: true }),
      actionId: 'release', enemies: [target({ intent: 'move' })] })
    const forced = result.events.find((event) => event.type === 'ForcedMotion')
    expect(forced.t).toBe(0.28)
    expect(sampleGameplayATPlan(result, 0.27).actors.target.actor.hex).toEqual({ q: 1, r: 0 })
    expect(sampleGameplayATPlan(result, 0.5).actors.target.position.x).toBeGreaterThan(1)
    expect(result.finalState.enemies[0].hex).toEqual({ q: 3, r: 0 })
    expect(result.events.filter((event) => event.type === 'Travel' && event.actorId === 'target').every((event) => event.forced)).toBe(true)
  })

  it('does not award Drive build before first successful Travel on blocked contact', () => {
    const result = plan({ enemies: [target({ downM: 3, downPrepared: true, intent: 'brace' })] })
    expect(result.finalState.player.hex).toEqual({ q: 0, r: 0 })
    expect(result.finalState.player.hM).toBe(0)
    expect(result.sourceThermalEvents.some((event) => event.source === 'Active H Build')).toBe(false)
  })

  it('keeps Collision Heat and Damage independently switchable', () => {
    const input = { player: createMomentumActor({ downM: 2, downPrepared: true }), actionId: 'release',
      enemies: [target({ downM: 1, downPrepared: true, intent: 'skip' })] }
    const off = plan(input)
    const on = plan({ ...input, collisionDamage: true })
    expect(on.finalState.enemies[0].hp).toBeLessThan(off.finalState.enemies[0].hp)
    expect(on.finalState.enemies[0].hex).toEqual(off.finalState.enemies[0].hex)
    expect(on.sourceThermalEvents.map((event) => [event.t, event.impulse])).toEqual(off.sourceThermalEvents.map((event) => [event.t, event.impulse]))
    expect(off.events.some((event) => event.type === 'DownResistance')).toBe(true)
  })

  it('reads Attack direction from start snapshot and does not home onto final player cell', () => {
    const result = plan({ targetHex: { q: 0, r: -1 }, enemies: [target()] })
    expect(result.intents[1].targetHex).toEqual({ q: 0, r: 0 })
    const payload = result.events.find((event) => event.type === 'AttackPayload')
    expect(payload.t).toBeLessThan(1)
    expect(sampleGameplayATPlan(result, payload.t - 0.001).player.actor.hp).toBe(100)
    expect(sampleGameplayATPlan(result, payload.t).player.actor.hp).toBe(92)
  })

  it('keeps Clash hook-only, with no invented winner or damage rule', () => {
    const result = plan({ actionId: 'attack', enemies: [target()] })
    expect(result.events.filter((event) => event.type === 'Clash')).toHaveLength(1)
    expect(result.events.filter((event) => event.type === 'AttackPayload')).toHaveLength(0)
    expect(result.finalState.player.hp).toBe(100)
  })

  it('uses event types and exact event times for distinct FX, not card ids', () => {
    const types = ['Collision', 'AttackPayload', 'Clash', 'DownResistance', 'ForcedMotion']
    const specs = encounterFxSpecs(types.map((type, index) => ({ type, t: index / 5, hex: { q: 0, r: 0 } })))
    expect(specs.map((spec) => spec.t)).toEqual([0, 0.2, 0.4, 0.6, 0.8])
    expect(new Set(specs.map((spec) => spec.style)).size).toBe(5)
    expect(encounterFxSpecs([{ type: 'Declare', actionId: 'attack', hex: { q: 0, r: 0 } }])).toEqual([])
  })

  it('samples uneven timestamps, and does not leak future axis/momentum', () => {
    const samples = [{ t: 0, position: { x: 0, z: 0 }, axisId: null },
      { t: 0.8, position: { x: 1, z: 0 }, axisId: 'E' }, { t: 1, position: { x: 1, z: 0 }, axisId: 'E' }]
    expect(sampleTimedRecord(samples, 0.4)).toMatchObject({ position: { x: 0.5, z: 0 }, axisId: null })
    expect(sampleTimedRecord(samples, 0.8).axisId).toBe('E')
  })
})
