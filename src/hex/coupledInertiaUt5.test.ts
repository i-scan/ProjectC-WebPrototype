import { describe, expect, it } from 'vitest'
import { getPlayer } from '../game'
import {
  axisLabel,
  basicMove,
  createCoupledInertiaLabState,
  createDrivePlan,
  defaultRuntimeTuning,
  downAxis,
  heavyRelease,
  horizontalAxis,
  injectHit,
  injectHitAndResolveAt,
  resolveMomentumInteraction,
  setReactionSettings,
  setSpatialDebug,
  setThermalDebug,
  stepWorld,
} from './coupledInertiaUt5'
import { hexAdvance } from './hexTopology'

const tuning = defaultRuntimeTuning()

describe('VAL-012-UT5 unified axis inertia', () => {
  it('keeps existing Momentum through Neutral time instead of cross-zero clearing', () => {
    let state = createCoupledInertiaLabState()
    state = setSpatialDebug(state, 'player', { level: 2, axis: horizontalAxis('E') })
    state = stepWorld(state, 1, tuning)
    expect(state.spatialByActorId.player.level).toBe(2)
    expect(axisLabel(state.spatialByActorId.player.axis)).toBe('E')
  })

  it('builds Down M for a complete grounded Cold AT', () => {
    let state = createCoupledInertiaLabState()
    state = setThermalDebug(state, { temperature: -4, drift: 0, setPoint: -2 })
    state = stepWorld(state, 1, tuning)
    expect(state.spatialByActorId.player.level).toBe(1)
    expect(axisLabel(state.spatialByActorId.player.axis)).toBe('Down')
  })

  it('uses one exchange resolver for conflicting axes', () => {
    const current = setSpatialDebug(createCoupledInertiaLabState(), 'player', { level: 2, axis: downAxis() }).spatialByActorId.player
    const weak = resolveMomentumInteraction(current, horizontalAxis('W'), 1, 1)
    expect(weak.state.level).toBe(1)
    expect(axisLabel(weak.state.axis)).toBe('Down')
    const breakthrough = resolveMomentumInteraction(weak.state, horizontalAxis('W'), 2, 1)
    expect(breakthrough.state.level).toBe(1)
    expect(axisLabel(breakthrough.state.axis)).toBe('W')
  })

  it('lets a strong Push move a braced actor without automatically replacing a surviving Down Axis', () => {
    let state = createCoupledInertiaLabState()
    state = setSpatialDebug(state, 'player', { level: 2, axis: downAxis() })
    const before = { ...getPlayer(state.game).position }
    state = injectHit(state, 'heavy', 'E', tuning)
    expect(state.worldTimeAt).toBe(0)
    expect(state.spatialByActorId.player.level).toBe(1)
    expect(axisLabel(state.spatialByActorId.player.axis)).toBe('Down')
    expect(getPlayer(state.game).position).not.toEqual(before)
  })

  it('does not rotate a surviving Horizontal Axis on a side hit', () => {
    let state = createCoupledInertiaLabState()
    state = setSpatialDebug(state, 'player', { level: 2, axis: horizontalAxis('E') })
    state = injectHit(state, 'heavy', 'NE', tuning)
    expect(state.spatialByActorId.player.level).toBe(1)
    expect(axisLabel(state.spatialByActorId.player.axis)).toBe('E')
  })

  it('resolves Hit spatial state before using the new Drift for the same AT thermal evolution', () => {
    let state = createCoupledInertiaLabState()
    state = setSpatialDebug(state, 'player', { level: 2, axis: downAxis() })
    const beforeT = state.thermal.temperature
    state = injectHitAndResolveAt(state, 'heavy', 'E', tuning)
    expect(state.worldTimeAt).toBe(1)
    expect(state.thermal.temperature).not.toBe(beforeT)
    expect(state.logs[0].detail).toContain('Spatial first')
    expect(state.logs[0].detail).toContain('same-AT Thermal Evolution')
  })

  it('gives Drive an explicit Axis at Neutral and never auto redirects around the Hard diagnostic surface', () => {
    const state = createCoupledInertiaLabState()
    const east = createDrivePlan(state, 'E', tuning)
    expect(east.valid).toBe(true)
    expect(east.frames.at(-1)?.state.spatialByActorId.player.level).toBeGreaterThan(0)
    expect(axisLabel(east.frames.at(-1)?.state.spatialByActorId.player.axis ?? null)).toBe('E')

    const west = createDrivePlan(state, 'W', tuning)
    expect(west.valid).toBe(true)
    expect(west.path).toHaveLength(2)
    expect(west.frames.some((frame) => frame.detail.includes('Hard Crash'))).toBe(true)
    expect(west.frames.every((frame) => !frame.detail.includes('Redirect'))).toBe(true)
  })

  it('makes the preview path the exact sequence of committed Drive frame positions', () => {
    const state = createCoupledInertiaLabState()
    const plan = createDrivePlan(state, 'W', tuning)
    const actualPath: Array<{ x: number; y: number }> = []
    let previous = getPlayer(state.game).position
    for (const frame of plan.frames) {
      const current = getPlayer(frame.state.game).position
      if (current.x !== previous.x || current.y !== previous.y) actualPath.push({ ...current })
      previous = current
    }
    expect(plan.path).toEqual(actualPath)
    expect(plan.endpoint).toEqual(getPlayer(plan.frames.at(-1)!.state.game).position)
  })

  it('keeps Reaction Sidestep opt-in and opens an active choice only when enabled with enough M', () => {
    let state = createCoupledInertiaLabState()
    state = setSpatialDebug(state, 'player', { level: 3, axis: horizontalAxis('E') })
    state = injectHit(state, 'push', 'E', tuning)
    expect(state.pendingReaction).toBeUndefined()

    state = createCoupledInertiaLabState()
    state = setReactionSettings(state, { reactionSidestep: true })
    state = setSpatialDebug(state, 'player', { level: 3, axis: horizontalAxis('E') })
    state = injectHit(state, 'push', 'E', tuning)
    expect(state.pendingReaction?.kind).toBe('sidestep')
    expect(state.pendingReaction?.legalCoords.length).toBeGreaterThan(0)
  })

  it('keeps Failed Occupancy Fallback opt-in instead of auto-deflecting', () => {
    let state = createCoupledInertiaLabState()
    const player = getPlayer(state.game)
    const dummy = state.game.actors.find((actor) => actor.name === 'Dummy A')!
    state = setSpatialDebug(state, 'player', { level: 2, axis: horizontalAxis('E') })
    state = setSpatialDebug(state, dummy.id, { level: 3, axis: downAxis() })
    state = basicMove(state, dummy.position, tuning)
    expect(state.pendingReaction).toBeUndefined()
    expect(getPlayer(state.game).position).toEqual(player.position)

    state = createCoupledInertiaLabState()
    const dummy2 = state.game.actors.find((actor) => actor.name === 'Dummy A')!
    state = setReactionSettings(state, { failedOccupancyFallback: true })
    state = setSpatialDebug(state, 'player', { level: 2, axis: horizontalAxis('E') })
    state = setSpatialDebug(state, dummy2.id, { level: 3, axis: downAxis() })
    state = basicMove(state, dummy2.position, tuning)
    expect(state.pendingReaction?.kind).toBe('fallback')
  })

  it('lets Heavy Release read Down M even when Temperature is Neutral', () => {
    let state = createCoupledInertiaLabState()
    const dummy = state.game.actors.find((actor) => actor.name === 'Dummy A')!
    const before = { ...dummy.position }
    state = setThermalDebug(state, { temperature: 1, drift: 0, setPoint: 1 })
    state = setSpatialDebug(state, 'player', { level: 2, axis: downAxis() })
    state = heavyRelease(state, dummy.id, tuning)
    const after = state.game.actors.find((actor) => actor.id === dummy.id)!.position
    expect(after).not.toEqual(before)
  })

  it('Hot free-build grows the same Horizontal Axis during Drive phases', () => {
    let state = createCoupledInertiaLabState()
    state = setThermalDebug(state, { temperature: 4, drift: 0, setPoint: 2 })
    const plan = createDrivePlan(state, 'W', tuning)
    expect(plan.frames[0].state.spatialByActorId.player.level).toBeGreaterThanOrEqual(2)
  })

  it('Drive selectors can be represented by adjacent Axis cells independently from final endpoints', () => {
    const state = createCoupledInertiaLabState()
    const player = getPlayer(state.game)
    const selector = hexAdvance(player.position, 'W')
    const plan = createDrivePlan(state, 'W', tuning)
    expect(selector).not.toEqual(plan.endpoint)
  })
})
