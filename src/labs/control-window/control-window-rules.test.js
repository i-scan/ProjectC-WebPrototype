import { describe, expect, it } from 'vitest'
import { collisionObstaclesFromCells, createCellWorld } from '../../sim/world.js'
import {
  actionPlan,
  controlWindowChoices,
  createControlWindowEnemies,
  hexLookupControl,
  localInterventionPlan,
  makeControlWindowState,
  persistentToWindowPlan,
} from './control-window-rules.js'

describe('Control Window rule candidate', () => {
  it('uses Hex Lookup for the control vector', () => {
    const result = hexLookupControl({ existingM: 1, existingAxis: 'E', incomingM: 1, incomingAxis: 'E' })
    expect(result).toMatchObject({ momentum: 2, axisId: 'E', angleSteps: 0 })
  })

  it('lets Drive establish M from M0 before Control Window resolution', () => {
    const state = makeControlWindowState({ momentum: 0, axisId: 'E' })
    const drive = actionPlan({ state, actionId: 'drive', aimAxis: 'E', threshold: 1 })

    expect(drive.effectiveM).toBe(1)
    expect(drive.activeSteps).toBe(1)
    expect(drive.autoSteps).toBe(0)
    expect(drive.travelSteps).toBe(1)
    expect(drive.finalM).toBe(1)
    expect(drive.finalState.worldAt).toBe(1)
  })

  it('keeps Move and Drive in one M framework while Drive preserves M on its active Cell', () => {
    const state = makeControlWindowState({ momentum: 1, axisId: 'E' })
    const move = actionPlan({ state, actionId: 'move', aimAxis: 'E', threshold: 1 })
    const drive = actionPlan({ state, actionId: 'drive', aimAxis: 'E', threshold: 1 })

    expect(move.effectiveM).toBe(2)
    expect(move.activeSteps).toBe(1)
    expect(move.autoSteps).toBe(0)
    expect(move.travelSteps).toBe(1)
    expect(move.finalM).toBe(1)

    expect(drive.effectiveM).toBe(2)
    expect(drive.activeSteps).toBe(1)
    expect(drive.autoSteps).toBe(1)
    expect(drive.travelSteps).toBe(2)
    expect(drive.finalM).toBe(1)
    expect(drive.atCost).toBe(1)
  })

  it('compresses M3 to the default M1 Control Window into one world AT', () => {
    const state = makeControlWindowState({ momentum: 3, axisId: 'E', worldAt: 4 })
    const plan = persistentToWindowPlan({ state, threshold: 1 })
    expect(plan.traversedCells).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }])
    expect(plan.finalM).toBe(1)
    expect(plan.finalState.worldAt).toBe(5)
  })

  it('lets stronger M2 Control stop M3 after one cell and choose later intervention points for +0 AT', () => {
    const state = makeControlWindowState({ momentum: 3, axisId: 'E', worldAt: 2 })
    const toWindow = persistentToWindowPlan({ state, threshold: 2 })
    expect(toWindow.finalM).toBe(2)
    expect(toWindow.traversedCells).toHaveLength(2)
    expect(toWindow.finalState.worldAt).toBe(3)
    expect(controlWindowChoices(2)).toEqual([2, 1, 0])

    const toM1 = localInterventionPlan({ state: toWindow.finalState, targetM: 1, threshold: 2 })
    expect(toM1.traversedCells).toHaveLength(2)
    expect(toM1.finalM).toBe(1)
    expect(toM1.finalState.worldAt).toBe(3)

    const toM0 = localInterventionPlan({ state: toWindow.finalState, targetM: 0, threshold: 2 })
    expect(toM0.traversedCells).toHaveLength(3)
    expect(toM0.finalM).toBe(0)
    expect(toM0.finalState.worldAt).toBe(3)
  })

  it('preserves the established-axis bootstrap for an aligned M0 Move', () => {
    const state = makeControlWindowState({ momentum: 0, axisId: 'E' })
    const plan = actionPlan({ state, actionId: 'move', aimAxis: 'E', threshold: 1 })
    expect(plan.travelSteps).toBe(1)
    expect(plan.finalM).toBe(1)
    expect(plan.axisAfter).toBe('E')
  })

  it('routes Control Window motion through authored wall reflection geometry', () => {
    const obstacles = collisionObstaclesFromCells(createCellWorld(6))
    const state = makeControlWindowState({ hex: { q: 2, r: 0 }, momentum: 2, axisId: 'E', worldAt: 3 })
    const plan = localInterventionPlan({ state, targetM: 0, threshold: 1, obstacles, boardRadius: 6 })

    expect(plan.collisions.length).toBeGreaterThan(0)
    expect(plan.collisions[0].wallCellPivot).toBe(true)
    expect(plan.axisAfter).toBe('W')
    expect(plan.finalM).toBe(0)
    expect(plan.finalState.worldAt).toBe(3)
  })

  it('transfers unresolved M into Strike and Forced Move on target contact', () => {
    const state = makeControlWindowState({ momentum: 2, axisId: 'E' })
    const actors = [{
      id: 'target-test',
      label: 'Target Test',
      hex: { q: 1, r: 0 },
      axisId: null,
      momentumLevel: 0,
      velocity: { x: 0, z: 0 },
    }]
    const plan = localInterventionPlan({ state, targetM: 0, threshold: 1, actors, boardRadius: 6 })
    const target = plan.actorStates.find((actor) => actor.id === 'target-test')

    expect(plan.cellConflict).toMatchObject({ targetActorId: 'target-test', impactM: 2, resolved: true })
    expect(plan.finalM).toBe(0)
    expect(plan.traversedCells.at(-1)).toEqual({ q: 1, r: 0 })
    expect(target.hex).not.toEqual({ q: 1, r: 0 })
    expect(target.momentumLevel).toBe(1)
  })

  it('moves two wandering targets only when World Time advances', () => {
    const actors = createControlWindowEnemies()
    const state = makeControlWindowState({ momentum: 3, axisId: 'W' })
    const plan = persistentToWindowPlan({
      state,
      threshold: 1,
      actors,
      boardRadius: 6,
      wanderEnabled: true,
      wanderSeed: 17,
    })

    expect(plan.finalState.worldAt).toBe(1)
    expect(plan.actorStates).toHaveLength(2)
    expect(plan.actorStates.some((actor, index) => !Object.is(actor.hex.q, actors[index].hex.q) || !Object.is(actor.hex.r, actors[index].hex.r))).toBe(true)

    const local = localInterventionPlan({
      state: makeControlWindowState({ momentum: 2, axisId: 'W', worldAt: 1 }),
      targetM: 1,
      actors,
      boardRadius: 6,
      wanderSeed: 17,
    })
    expect(local.finalState.worldAt).toBe(1)
    expect(local.actorStates.map((actor) => actor.hex)).toEqual(actors.map((actor) => actor.hex))
  })
})
