import { describe, expect, it } from 'vitest'
import { createMomentumActor } from './gameplay-momentum-model.js'
import { deriveGameplayLinkWindow, resolveGameplayLink } from './gameplay-link-window.js'

const planWithContact = {
  valid: true,
  contract: 'fixture',
  events: [{ id: 'event-contact', type: 'Encounter', actorId: 'player', targetId: 'enemy-a', kind: 'Collision' }],
}

describe('Gameplay Link Window P0', () => {
  it('opens Contact links from a resolved Encounter', () => {
    const player = createMomentumActor({ id: 'player', hex: { q: 0, r: 0 }, hM: 2, axisId: 'E' })
    const enemy = createMomentumActor({ id: 'enemy-a', hex: { q: 1, r: 0 }, hp: 40 })
    const window = deriveGameplayLinkWindow({
      plan: planWithContact,
      beforePlayer: player,
      afterPlayer: player,
      enemies: [enemy],
      primaryActionId: 'move',
    })
    expect(window.hook.type).toBe('Contact')
    expect(window.options.map((entry) => entry.id)).toEqual(['continue', 'strike', 'brace', 'evade'])
  })

  it('resolves Brace as Momentum before Space', () => {
    const player = createMomentumActor({ id: 'player', hex: { q: 0, r: 0 }, hM: 2, axisId: 'E' })
    const enemy = createMomentumActor({ id: 'enemy-a', hex: { q: 1, r: 0 }, hp: 40 })
    const window = deriveGameplayLinkWindow({
      plan: planWithContact,
      beforePlayer: player,
      afterPlayer: player,
      enemies: [enemy],
      primaryActionId: 'move',
    })
    const result = resolveGameplayLink({ window, choiceId: 'brace', player, enemies: [enemy] })
    expect(result.valid).toBe(true)
    expect(result.trace.map((entry) => entry.stage)).toEqual(['Payload', 'Momentum', 'Space'])
    expect([result.player.hM, result.player.axisId, result.player.downM, result.player.downPrepared]).toEqual([0, null, 2, true])
    expect(result.player.hex).toEqual({ q: 0, r: 0 })
  })

  it('makes Evade change space only after releasing horizontal commitment', () => {
    const player = createMomentumActor({ id: 'player', hex: { q: 0, r: 0 }, hM: 1, axisId: 'E' })
    const enemy = createMomentumActor({ id: 'enemy-a', hex: { q: 1, r: 0 }, hp: 40 })
    const window = deriveGameplayLinkWindow({
      plan: planWithContact,
      beforePlayer: player,
      afterPlayer: player,
      enemies: [enemy],
      primaryActionId: 'move',
    })
    const result = resolveGameplayLink({ window, choiceId: 'evade', player, enemies: [enemy] })
    expect(result.valid).toBe(true)
    expect(result.trace.map((entry) => entry.stage)).toEqual(['Payload', 'Momentum', 'Space'])
    expect(result.player.hM).toBe(0)
    expect(result.player.hex).not.toEqual({ q: 0, r: 0 })
  })

  it('opens a non-Contact AfterMove Ranged Strike when the post-move predicate is legal', () => {
    const before = createMomentumActor({ id: 'player', hex: { q: 0, r: 0 } })
    const after = createMomentumActor({ id: 'player', hex: { q: 1, r: 0 } })
    const enemy = createMomentumActor({ id: 'enemy-a', hex: { q: 3, r: 0 }, hp: 40 })
    const window = deriveGameplayLinkWindow({
      plan: { valid: true, contract: 'fixture', events: [] },
      beforePlayer: before,
      afterPlayer: after,
      enemies: [enemy],
      primaryActionId: 'move',
    })
    expect(window.hook.type).toBe('AfterMove')
    expect(window.options[0].id).toBe('ranged-strike:enemy-a')
    const result = resolveGameplayLink({ window, choiceId: window.options[0].id, player: after, enemies: [enemy] })
    expect(result.enemies[0].hp).toBe(32)
    expect(result.trace.map((entry) => entry.stage)).toEqual(['Payload', 'Momentum', 'Space'])
  })
})
