import { describe, expect, it } from 'vitest'
import { getPlayer } from '../game'
import { createSpatialState, createUt7State, horizontalAxis, setSpatialDebug } from './actorLoopUt7'
import {
  actionById,
  collisionCourse,
  impulsePlan,
  nearestHexDirection,
  type ImpulseKinematics,
} from './actorLoopImpulseMovement'

const kinematics = (headingDeg: number | null): ImpulseKinematics => ({ headingDeg })

describe('impulse-driven inertia movement', () => {
  it('starts from M0 by applying force instead of selecting an endpoint', () => {
    const state = createUt7State({ spawnEnemies: false })
    const plan = impulsePlan(state, kinematics(null), actionById('drive'), 0)

    expect(plan.valid).toBe(true)
    expect(plan.beforeM).toBe(0)
    expect(plan.afterImpulseM).toBe(1)
    expect(plan.afterM).toBe(1)
    expect(plan.path).toHaveLength(1)
    expect(plan.behavior).toBe('generate')
  })

  it('keeps M2 while coasting and forces the full two-cell displacement', () => {
    const initial = createUt7State({ spawnEnemies: false })
    const state = setSpatialDebug(initial, 'player', createSpatialState(2, horizontalAxis('E')))
    const plan = impulsePlan(state, kinematics(0), actionById('coast'), 0)

    expect(plan.valid).toBe(true)
    expect(plan.beforeM).toBe(2)
    expect(plan.afterM).toBe(2)
    expect(plan.path).toHaveLength(2)
    expect(plan.behavior).toBe('use')
  })

  it('counter impulse reduces persistent M instead of spending one automatically on every move', () => {
    const initial = createUt7State({ spawnEnemies: false })
    const state = setSpatialDebug(initial, 'player', createSpatialState(3, horizontalAxis('E')))
    const plan = impulsePlan(state, kinematics(0), actionById('counter'), 180)

    expect(plan.valid).toBe(true)
    expect(plan.beforeM).toBe(3)
    expect(plan.afterImpulseM).toBe(2)
    expect(plan.afterM).toBe(2)
    expect(plan.path).toHaveLength(2)
    expect(plan.behavior).toBe('resist')
  })

  it('does not pathfind around a hard surface and resolves an impact instead', () => {
    const initial = collisionCourse(createUt7State({ spawnEnemies: false }))
    const state = setSpatialDebug(initial, 'player', createSpatialState(3, horizontalAxis('E')))
    const start = { ...getPlayer(state.game).position }
    const plan = impulsePlan(state, kinematics(0), actionById('coast'), 0)

    expect(plan.valid).toBe(true)
    expect(plan.path).toHaveLength(2)
    expect(plan.collisions).toHaveLength(1)
    expect(plan.collisions[0].kind).toBe('surface')
    expect(plan.collisions[0].label).toBe('UT3Hard')
    expect(plan.afterM).toBeLessThan(3)
    expect(getPlayer(plan.result.game).position).not.toEqual(start)
    expect(plan.behavior).toBe('resist')
  })

  it('rejects aim outside a card control window instead of secretly steering toward a chosen cell', () => {
    const initial = createUt7State({ spawnEnemies: false })
    const state = setSpatialDebug(initial, 'player', createSpatialState(2, horizontalAxis('E')))
    const plan = impulsePlan(state, kinematics(0), actionById('drive'), 150)

    expect(plan.valid).toBe(false)
    expect(plan.reason).toContain('outside ±60°')
  })

  it('maps continuous resolved headings back to the nearest visible Hex Axis', () => {
    expect(nearestHexDirection(0)).toBe('E')
    expect(nearestHexDirection(58)).toBe('SE')
    expect(nearestHexDirection(178)).toBe('W')
  })
})
