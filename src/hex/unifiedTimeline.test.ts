import { describe, expect, it } from 'vitest'
import {
  actionTimeFor,
  applyUnifiedFixedHand,
  createUnifiedTimeline,
  previewInterveningEvents,
  resolveUnifiedPlayerAction,
  unifiedTimelineConfig,
} from './unifiedTimeline'

describe('VAL-012 UT1 unified AT timeline', () => {
  it('declares AT as the only action-time resource for the Hex6 experiment', () => {
    expect(unifiedTimelineConfig.rulesetId).toBe('VAL-012-UT1')
    expect(unifiedTimelineConfig.genericActionPoints).toBe(false)
    expect(unifiedTimelineConfig.fixedHand).toBe(true)
    expect(unifiedTimelineConfig.thermalPeriodAt).toBe(8)
    expect(new Set(unifiedTimelineConfig.actions.map((action) => action.id)).size)
      .toBe(unifiedTimelineConfig.actions.length)
    expect(unifiedTimelineConfig.actions.every((action) => [1, 2, 3].includes(action.actionTimeAt))).toBe(true)
  })

  it('previews every actor and environment event before the player is ready', () => {
    const timeline = createUnifiedTimeline()
    expect(previewInterveningEvents(timeline, actionTimeFor('hot-strike')).map((event) => event.sourceId))
      .toEqual(['hunter', 'elite', 'npc', 'environment'])
  })

  it('resolves one atomic action and processes the shared queue until player ready', () => {
    const timeline = createUnifiedTimeline()
    const result = resolveUnifiedPlayerAction(
      ['player:impact'],
      timeline,
      3,
      (value) => value,
      {
        resolveActor: (value, actorId) => [...value, `actor:${actorId}`],
        resolveEnvironment: (value) => [...value, 'environment'],
      },
    )

    expect(result.timeline.worldTimeAt).toBe(3)
    expect(result.timeline.awaitingPlayer).toBe(true)
    expect(result.value).toEqual([
      'player:impact',
      'actor:hunter',
      'actor:elite',
      'actor:npc',
      'environment',
      'actor:hunter',
    ])
    expect(result.interveningEvents.map((event) => event.timeAt)).toEqual([1, 2, 2, 2, 3])
  })

  it('uses stable actor IDs to break equal-time actor-ready ties', () => {
    const timeline = createUnifiedTimeline()
    const atTwo = previewInterveningEvents(timeline, 2).filter((event) => event.timeAt === 2)
    expect(atTwo.map((event) => event.stableId)).toEqual([
      'actor:elite',
      'actor:npc',
      'environment:global',
    ])
  })

  it('replaces draw and discard state with one deterministic fixed hand', () => {
    const state = applyUnifiedFixedHand({ hand: ['random'], deck: ['other'], discard: ['spent'], ap: 3, reservedAP: 1 })
    expect(state.hand).toEqual(['heat-cell', 'guard', 'temper', 'push-strike', 'pierce'])
    expect(state.deck).toEqual([])
    expect(state.discard).toEqual([])
    expect(state.ap).toBe(0)
    expect(state.reservedAP).toBe(0)
  })
})
