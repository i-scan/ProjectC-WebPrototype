import { describe, expect, it } from 'vitest'
import {
  CONTROL_WINDOW_PATH_CONTACT_RULE,
  makeControlWindowState,
  persistentToWindowPlan,
} from './control-window-v3-rules.js'

describe('Control Window same-AT swept Cell Contact', () => {
  it('collides when enemy Wander enters a Cell the player crossed earlier in the same 1 AT packet', () => {
    const state = makeControlWindowState({ hex: { q: 0, r: 0 }, momentum: 3, axisId: 'E', worldAt: 0 })
    const actors = [{
      id: 'crossing-enemy',
      label: 'Crossing Enemy',
      hex: { q: 0, r: 1 },
      axisId: 'NE',
      momentumLevel: 0,
      velocity: { x: 0, z: 0 },
    }]

    const plan = persistentToWindowPlan({
      state,
      threshold: 1,
      actors,
      boardRadius: 6,
      wanderEnabled: true,
      wanderSeed: 6,
    })

    expect(plan.pathContactRule).toBe(CONTROL_WINDOW_PATH_CONTACT_RULE)
    expect(plan.incomingPlayerConflict).toMatchObject({
      sourceActorId: 'crossing-enemy',
      targetActorId: 'player',
      sweptCellContact: true,
      contactCell: { q: 1, r: 0 },
      pathContactRule: CONTROL_WINDOW_PATH_CONTACT_RULE,
    })
    expect(plan.conflictEvents).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'swept-cell-contact',
      cell: { q: 1, r: 0 },
      playerMAtContact: 3,
      playerAxisAtContact: 'E',
    })]))
    expect(plan.actorStates.find((actor) => actor.id === 'crossing-enemy')?.hex).toEqual({ q: 1, r: 0 })
    expect(plan.traversedCells).toContainEqual({ q: 1, r: 0 })
    expect(plan.finalState.position).not.toEqual(state.position)
  })
})
