import { describe, expect, it } from 'vitest'
import {
  actionPlan,
  controlWindowChoices,
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

  it('keeps Move and Drive in the same M framework but gives them different travel profiles', () => {
    const state = makeControlWindowState({ momentum: 1, axisId: 'E' })
    const move = actionPlan({ state, actionId: 'move', aimAxis: 'E' })
    const drive = actionPlan({ state, actionId: 'drive', aimAxis: 'E' })

    expect(move.effectiveM).toBe(2)
    expect(move.travelSteps).toBe(1)
    expect(move.finalM).toBe(1)
    expect(move.atCost).toBe(1)

    expect(drive.effectiveM).toBe(2)
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

    const toM1 = localInterventionPlan({ state: toWindow.finalState, targetM: 1 })
    expect(toM1.traversedCells).toHaveLength(2)
    expect(toM1.finalM).toBe(1)
    expect(toM1.finalState.worldAt).toBe(3)

    const toM0 = localInterventionPlan({ state: toWindow.finalState, targetM: 0 })
    expect(toM0.traversedCells).toHaveLength(3)
    expect(toM0.finalM).toBe(0)
    expect(toM0.finalState.worldAt).toBe(3)
  })

  it('preserves the established-axis bootstrap for an aligned M0 Move', () => {
    const state = makeControlWindowState({ momentum: 0, axisId: 'E' })
    const plan = actionPlan({ state, actionId: 'move', aimAxis: 'E' })
    expect(plan.travelSteps).toBe(1)
    expect(plan.finalM).toBe(1)
    expect(plan.axisAfter).toBe('E')
  })
})
