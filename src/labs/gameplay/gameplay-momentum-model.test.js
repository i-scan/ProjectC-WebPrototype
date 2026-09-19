import { describe, expect, it } from 'vitest'
import {
  createMomentumActor,
  momentumBand,
  reachableTargets,
  resolveDomainNaturalBuild,
  resolveGameplayAction,
  resolveThermalEvents,
} from './gameplay-momentum-model.js'

describe('Gameplay Momentum v1 state chain', () => {
  it('settles HM1 -> HM0(axis) -> No Axis -> DM0 -> DM1 -> DM2 through Skip', () => {
    let actor = createMomentumActor({ hM: 1, axisId: 'E' })

    let result = resolveGameplayAction({ actor, actionId: 'skip', boardRadius: 5 })
    actor = result.actor
    expect(momentumBand(actor)).toBe('HM0')
    expect(actor.hex).toEqual({ q: 1, r: 0 })

    result = resolveGameplayAction({ actor, actionId: 'skip', boardRadius: 5 })
    actor = result.actor
    expect(momentumBand(actor)).toBe('NO AXIS')
    expect(actor.axisId).toBeNull()

    result = resolveGameplayAction({ actor, actionId: 'skip', boardRadius: 5 })
    actor = result.actor
    expect(momentumBand(actor)).toBe('DM0')

    result = resolveGameplayAction({ actor, actionId: 'skip', boardRadius: 5 })
    actor = result.actor
    expect(momentumBand(actor)).toBe('DM1')

    result = resolveGameplayAction({ actor, actionId: 'skip', boardRadius: 5 })
    actor = result.actor
    expect(momentumBand(actor)).toBe('DM2')
  })

  it('Drive and Brace bypass the preparation state from No Axis', () => {
    const neutral = createMomentumActor()
    const drive = resolveGameplayAction({
      actor: neutral,
      actionId: 'drive',
      targetHex: { q: 1, r: 0 },
      boardRadius: 5,
    })
    expect(drive.valid).toBe(true)
    expect(momentumBand(drive.actor)).toBe('HM1')
    expect(drive.thermal).toContainEqual(expect.objectContaining({ source: 'Active H Build', amount: 1, polarity: 'hotward' }))

    const brace = resolveGameplayAction({ actor: neutral, actionId: 'brace', boardRadius: 5 })
    expect(brace.valid).toBe(true)
    expect(momentumBand(brace.actor)).toBe('DM1')
    expect(brace.thermal).toContainEqual(expect.objectContaining({ source: 'Active D Build', amount: 1, polarity: 'coldward' }))
  })

  it('uses the current cross-channel candidate: HM2 Brace -> DM0 and DM2 Drive -> HM0', () => {
    const hm2 = createMomentumActor({ hM: 2, axisId: 'E' })
    const braced = resolveGameplayAction({ actor: hm2, actionId: 'brace', boardRadius: 5 })
    expect(momentumBand(braced.actor)).toBe('DM0')
    expect(braced.thermal).toContainEqual(expect.objectContaining({ source: 'Active H Spend', amount: 2, polarity: 'coldward' }))

    const dm2 = createMomentumActor({ downM: 2, downPrepared: true })
    const driven = resolveGameplayAction({
      actor: dm2,
      actionId: 'drive',
      targetHex: { q: 1, r: 0 },
      boardRadius: 5,
    })
    expect(momentumBand(driven.actor)).toBe('HM0')
    expect(driven.actor.axisId).toBe('E')
    expect(driven.thermal).toContainEqual(expect.objectContaining({ source: 'Active D Spend / Convert', amount: 2, polarity: 'hotward' }))
  })

  it('keeps passive Skip settling separate from active M->Thermal impulses', () => {
    const hm1 = createMomentumActor({ hM: 1, axisId: 'E' })
    const result = resolveGameplayAction({ actor: hm1, actionId: 'skip', boardRadius: 5 })
    expect(result.thermal).toEqual([])
    expect(result.trace.at(-1).cause).toBe('Passive Dissipation')
  })

  it('allows repeated Skip to reach DM3 for validation without exceeding the cap', () => {
    let actor = createMomentumActor({ downPrepared: true, downM: 2 })
    actor = resolveGameplayAction({ actor, actionId: 'skip', boardRadius: 5 }).actor
    expect(momentumBand(actor)).toBe('DM3')
    actor = resolveGameplayAction({ actor, actionId: 'skip', boardRadius: 5 }).actor
    expect(momentumBand(actor)).toBe('DM3')
  })
})

describe('Gameplay Momentum v1 actions and Thermal causes', () => {
  it('uses Basic Move to establish H0 then build H1 on the same Axis', () => {
    let actor = createMomentumActor()
    let targets = reachableTargets(actor, 'move', 5)
    const east = targets.find((entry) => entry.aimAxisId === 'E')
    let result = resolveGameplayAction({ actor, actionId: 'move', targetHex: east.hex, boardRadius: 5 })
    actor = result.actor
    expect(momentumBand(actor)).toBe('HM0')
    expect(result.thermal).toEqual([])

    targets = reachableTargets(actor, 'move', 5)
    const eastAgain = targets.find((entry) => entry.aimAxisId === 'E')
    result = resolveGameplayAction({ actor, actionId: 'move', targetHex: eastAgain.hex, boardRadius: 5 })
    expect(momentumBand(result.actor)).toBe('HM1')
    expect(result.thermal).toContainEqual(expect.objectContaining({ source: 'Active H Build', amount: 1 }))
  })

  it('Launch converts DM2 to self HM2 once and records only Down Convert thermal cause', () => {
    const actor = createMomentumActor({ downPrepared: true, downM: 2 })
    const result = resolveGameplayAction({
      actor,
      actionId: 'launch',
      targetHex: { q: 1, r: 0 },
      boardRadius: 5,
    })
    expect(result.valid).toBe(true)
    expect(momentumBand(result.actor)).toBe('HM2')
    expect(result.thermal).toEqual([
      expect.objectContaining({ source: 'Active D Spend / Convert', amount: 2, polarity: 'hotward' }),
    ])
  })

  it('resolves outgoing Release against Down M and keeps Collision heat distinct', () => {
    const source = createMomentumActor({ id: 'player', downPrepared: true, downM: 2 })
    const target = createMomentumActor({ id: 'enemy', hex: { q: 1, r: 0 }, downPrepared: true, downM: 1 })
    const result = resolveGameplayAction({
      actor: source,
      actionId: 'release',
      targetHex: target.hex,
      actors: [source, target],
      boardRadius: 5,
    })
    expect(result.valid).toBe(true)
    expect(result.targetUpdate.downM).toBe(0)
    expect(result.targetUpdate.hex).toEqual({ q: 2, r: 0 })
    expect(result.dissipatedM).toBe(1)

    const thermal = resolveThermalEvents(result.thermal, { momentumFactor: 0.5, collisionHeatFactor: 0.25 })
    expect(thermal.some((entry) => entry.source === 'Active D Spend / Convert' && entry.impulse === 1)).toBe(true)
    expect(thermal.some((entry) => entry.source === 'Collision dissipatedM' && entry.impulse === 0.25)).toBe(true)
  })

  it('keeps Collision Damage toggle independent from displacement and dissipatedM', () => {
    const player = createMomentumActor({ id: 'player', hM: 2, axisId: 'E' })
    const enemy = createMomentumActor({ id: 'enemy', hex: { q: 2, r: 0 }, hp: 40, downPrepared: true, downM: 1 })
    const landing = reachableTargets(player, 'move', 5, [player, enemy]).find((entry) => entry.hex.q === 2 && entry.hex.r === 0)

    const withoutDamage = resolveGameplayAction({
      actor: player,
      actionId: 'move',
      targetHex: landing.hex,
      actors: [player, enemy],
      boardRadius: 5,
      collisionDamage: false,
    })
    const withDamage = resolveGameplayAction({
      actor: player,
      actionId: 'move',
      targetHex: landing.hex,
      actors: [player, enemy],
      boardRadius: 5,
      collisionDamage: true,
    })

    expect(withoutDamage.dissipatedM).toBe(withDamage.dissipatedM)
    expect(withoutDamage.targetUpdate.hex).toEqual(withDamage.targetUpdate.hex)
    expect(withDamage.targetUpdate.hp).toBeLessThan(withoutDamage.targetUpdate.hp)
  })
})

describe('Thermal Domain Natural Build', () => {
  it('builds H only with Axis + horizontal travel and does not emit Thermal', () => {
    const actor = createMomentumActor({ hM: 1, axisId: 'E' })
    const result = resolveDomainNaturalBuild(actor, 'HOT', { enabled: true, hadHorizontalTravel: true })
    expect(momentumBand(result.actor)).toBe('HM2')
    expect(result.trace.at(-1)).toMatchObject({ channel: 'H', suppressed: false })
  })

  it('suppresses same-AT refund after Spend', () => {
    const actor = createMomentumActor({ hM: 1, axisId: 'E' })
    const result = resolveDomainNaturalBuild(actor, 'HOT', {
      enabled: true,
      hadHorizontalTravel: true,
      spentH: true,
    })
    expect(momentumBand(result.actor)).toBe('HM1')
    expect(result.trace.at(-1)).toMatchObject({ channel: 'H', suppressed: true, reason: 'same-AT no-refund' })
  })

  it('builds Down M in Cold Domain while stable', () => {
    const actor = createMomentumActor({ downPrepared: true, downM: 1 })
    const result = resolveDomainNaturalBuild(actor, 'COLD', { enabled: true, stable: true })
    expect(momentumBand(result.actor)).toBe('DM2')
    expect(result.trace.at(-1)).toMatchObject({ channel: 'D', fromM: 1, toM: 2 })
  })
})
