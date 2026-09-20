import { describe, expect, it } from 'vitest'
import { buildGameplayATPlan, sampleGameplayATPlan } from './gameplay-at-plan.js'
import { createDefaultEnemies, createMomentumActor } from './gameplay-momentum-model.js'
import { BASELINE_THERMAL_PROFILE, thermalStateFromProfile } from '../../thermal/thermal-profile.js'
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

  it('moves during the AT without reading finalState or pre-applying HM / heat', () => {
    const result = plan()
    const firstTravel = result.events.find((event) => event.type === 'Travel')
    const middle = sampleGameplayATPlan(result, 0.4)
    expect(middle.player.position.x).toBeGreaterThan(0)
    expect(middle.player.position.x).toBeLessThan(result.finalState.position.x)
    expect(middle.player.actor.hM).toBe(0)
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

  it('preserves the Skip chain and once-per-AT semantics', () => {
    let player = createMomentumActor({ hM: 1, axisId: 'E' })
    const bands = []
    for (let index = 0; index < 6; index += 1) {
      const result = plan({ player, actionId: 'skip', targetHex: null })
      player = result.finalState.player
      bands.push([player.hM, player.axisId, player.downPrepared, player.downM])
      expect(result.sourceThermalEvents).toEqual([])
      expect(result.events.filter((event) => event.type === 'MomentumTransaction')).toHaveLength(1)
    }
    expect(bands).toEqual([[0, 'E', false, 0], [0, null, false, 0], [0, null, true, 0],
      [0, null, true, 1], [0, null, true, 2], [0, null, true, 3]])
  })

  it('converts D to H once, never adds a second H Build impulse', () => {
    const result = plan({ player: createMomentumActor({ downM: 2, downPrepared: true }), actionId: 'launch' })
    expect(result.finalState.player.hM).toBe(2)
    expect(result.sourceThermalEvents).toHaveLength(1)
    expect(result.sourceThermalEvents[0]).toMatchObject({ source: 'Active D Spend / Convert', impulse: 1.6, t: 0.2 })
  })

  it('rejects invalid targets and Down Basic Move without spending an AT', () => {
    expect(plan({ targetHex: { q: 5, r: 0 } }).valid).toBe(false)
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

describe('Encounter timeline adapter', () => {
  it('applies boundary dissipation heat at the terminal contact, not at the initial Release', () => {
    const result = plan({ player: createMomentumActor({ hex: { q: 3, r: 0 }, downM: 3, downPrepared: true }),
      actionId: 'release', targetHex: { q: 4, r: 0 }, enemies: [target({ hex: { q: 4, r: 0 }, intent: 'skip' })] })
    const heat = result.sourceThermalEvents.find((event) => event.source === 'Collision dissipatedM')
    expect(heat.t).toBe(0.94)
    expect(result.events.find((event) => event.type === 'ForcedMotion').t).toBe(0.28)
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
