import { describe, expect, it } from 'vitest'
import { axialDistance, directionIdBetween } from '../../sim/hex.js'
import { collisionObstaclesFromCells, createCellWorld } from '../../sim/world.js'
import {
  actionPlan,
  localInterventionPlan,
  makeControlWindowState,
  skipPlan,
} from './control-window-v3-rules.js'

describe('Control Window v3 candidate', () => {
  it('lets Heavy Drive establish M2 input and resolve to the default M1 window', () => {
    const fromM0 = makeControlWindowState({ momentum: 0, axisId: 'E' })
    const plan0 = actionPlan({ state: fromM0, actionId: 'heavy-drive', aimAxis: 'E', threshold: 1 })
    expect(plan0.incomingControlM).toBe(2)
    expect(plan0.effectiveM).toBe(2)
    expect(plan0.activeSteps).toBe(1)
    expect(plan0.autoSteps).toBe(1)
    expect(plan0.travelSteps).toBe(2)
    expect(plan0.finalM).toBe(1)

    const fromM1 = makeControlWindowState({ momentum: 1, axisId: 'E' })
    const plan1 = actionPlan({ state: fromM1, actionId: 'heavy-drive', aimAxis: 'E', threshold: 1 })
    expect(plan1.effectiveM).toBe(3)
    expect(plan1.travelSteps).toBe(3)
    expect(plan1.finalM).toBe(1)
  })

  it('uses Skip as a real +1 AT world step without a control input', () => {
    const state = makeControlWindowState({ momentum: 0, axisId: 'E', worldAt: 7 })
    const plan = skipPlan({ state, actors: [], wanderEnabled: false })
    expect(plan.kind).toBe('control-action-skip')
    expect(plan.atCost).toBe(1)
    expect(plan.finalState.worldAt).toBe(8)
    expect(plan.finalM).toBe(0)
    expect(plan.traversedCells).toEqual([{ q: 0, r: 0 }])
  })

  it('lets an enemy wander attempt Strike and knock the player away from the contact Cell', () => {
    const state = makeControlWindowState({ momentum: 0, axisId: 'E', worldAt: 0 })
    const actors = [{
      id: 'enemy-contact',
      label: 'Enemy Contact',
      hex: { q: 1, r: 0 },
      axisId: 'W',
      momentumLevel: 0,
      velocity: { x: 0, z: 0 },
    }]
    const plan = skipPlan({
      state,
      actors,
      boardRadius: 6,
      wanderEnabled: true,
      wanderSeed: 4,
    })
    const enemy = plan.actorStates[0]

    expect(plan.incomingPlayerConflict).toMatchObject({
      sourceActorId: 'enemy-contact',
      targetActorId: 'player',
      impactM: 1,
      resolved: true,
    })
    expect(plan.finalState.worldAt).toBe(1)
    expect(plan.traversedCells.at(-1)).toEqual({ q: -1, r: 0 })
    expect(plan.finalM).toBe(0)
    expect(plan.axisAfter).toBe('W')
    expect(enemy.hex).toEqual({ q: 0, r: 0 })
    expect(plan.conflictEvents.some((entry) => entry.enemyInitiated && entry.targetActorId === 'player')).toBe(true)
  })

  it('keeps wall reflection active in v3 local motion', () => {
    const obstacles = collisionObstaclesFromCells(createCellWorld(6))
    const state = makeControlWindowState({ hex: { q: 2, r: 0 }, momentum: 2, axisId: 'E', worldAt: 3 })
    const plan = localInterventionPlan({ state, targetM: 0, threshold: 1, obstacles, boardRadius: 6 })
    expect(plan.conflictEvents.some((entry) => entry.kind === 'surface-reflection')).toBe(true)
    expect(plan.axisAfter).toBe('W')
    expect(plan.finalState.worldAt).toBe(3)
  })

  it('allows Move to aim outward at the board edge and resolves the reflected Cell in-board', () => {
    const state = makeControlWindowState({ hex: { q: 4, r: 0 }, momentum: 0, axisId: 'E', worldAt: 0 })
    const plan = actionPlan({
      state,
      actionId: 'move',
      aimAxis: 'E',
      threshold: 1,
      boardRadius: 4,
      actors: [],
      obstacles: [],
      wanderEnabled: false,
    })
    const reflection = plan.conflictEvents.find((entry) => entry.kind === 'surface-reflection' && entry.actorId === 'player')

    expect(plan.valid).toBe(true)
    expect(reflection).toMatchObject({ obstacleKind: 'boundary', axisBefore: 'E' })
    expect(reflection.axisAfter).not.toBe('E')
    expect(plan.travelSteps).toBe(1)
    expect(plan.traversedCells.every((hex) => axialDistance(hex) <= 4)).toBe(true)
    expect(directionIdBetween({ q: 4, r: 0 }, plan.traversedCells.at(-1))).toBe(reflection.axisAfter)
    expect(plan.axisAfter).toBe(reflection.axisAfter)
    expect(plan.finalM).toBe(1)
  })

  it('allows Drive to aim outward and previews the full reflected continuation inside the same packet', () => {
    const state = makeControlWindowState({ hex: { q: 4, r: 0 }, momentum: 1, axisId: 'E', worldAt: 0 })
    const plan = actionPlan({
      state,
      actionId: 'drive',
      aimAxis: 'E',
      threshold: 1,
      boardRadius: 4,
      actors: [],
      obstacles: [],
      wanderEnabled: false,
    })
    const reflection = plan.conflictEvents.find((entry) => entry.kind === 'surface-reflection' && entry.actorId === 'player')

    expect(plan.valid).toBe(true)
    expect(reflection).toMatchObject({ obstacleKind: 'boundary', axisBefore: 'E' })
    expect(plan.activeSteps).toBe(1)
    expect(plan.autoSteps).toBe(1)
    expect(plan.travelSteps).toBe(2)
    expect(plan.traversedCells).toHaveLength(3)
    expect(plan.traversedCells.every((hex) => axialDistance(hex) <= 4)).toBe(true)
    expect(directionIdBetween({ q: 4, r: 0 }, plan.traversedCells[1])).toBe(reflection.axisAfter)
    expect(plan.samples.some((sample) => {
      const point = sample.position
      const contact = plan.motionTrace.find((entry) => entry.kind === 'boundary-reflection')?.collision?.position
      return contact && Math.hypot(point.x - contact.x, point.z - contact.z) < 0.0001
    })).toBe(true)
  })
})