import { describe, expect, it } from 'vitest'
import { getPlayer } from '../game'
import {
  actorLoopConfig,
  basicAttackPlan,
  createActorLoopState,
  defaultActorLoopSettings,
} from './actorLoopUt6'
import { hexDistance } from './hexTopology'

describe('UT6 attack damage feedback contract', () => {
  it('Basic Attack always applies its configured HP damage before optional Momentum effects', () => {
    const state = createActorLoopState()
    const player = getPlayer(state.game)
    const target = state.game.actors.find((actor) =>
      actor.alive && actor.id !== player.id && hexDistance(player.position, actor.position) === 1,
    )
    if (!target) throw new Error('Expected an adjacent UT6 attack fixture')

    const beforeHp = target.hp
    const plan = basicAttackPlan(state, target.id, defaultActorLoopSettings())
    const afterTarget = plan.result.game.actors.find((actor) => actor.id === target.id)

    expect(plan.valid).toBe(true)
    expect(afterTarget?.hp).toBe(beforeHp - actorLoopConfig.weapon.basicDamage)
    expect(plan.result.logs[0].detail).toContain(`Damage ${actorLoopConfig.weapon.basicDamage}`)
  })
})
