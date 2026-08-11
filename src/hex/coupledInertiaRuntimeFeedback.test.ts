import { describe, expect, it } from 'vitest'
import { getPlayer } from '../game'
import {
  createCoupledInertiaLabState,
  defaultRuntimeTuning,
  injectHit,
  resolveDrive,
  setThermalDebug,
  stepWorld,
} from './coupledInertia'
import { hexAdvance } from './hexTopology'

function neutralBaseline() {
  return setThermalDebug(createCoupledInertiaLabState(), { temperature: 1, drift: 0, setPoint: 1 })
}

function clearDriveLaneState() {
  const state = neutralBaseline()
  const player = getPlayer(state.game)
  state.game.actors = [player]
  for (const cell of state.game.cells) {
    cell.tags = cell.tags.filter((tag) => !['UT4Hard', 'UT4ReflectLeft', 'UT4ReflectRight'].includes(tag))
  }
  return state
}

describe('UT4 runtime feedback contract', () => {
  it('keeps Inject Hit at 0 AT while applying HP, Drift and forced motion, then evolves T on later AT', () => {
    const tuning = defaultRuntimeTuning()
    const before = neutralBaseline()
    const origin = { ...getPlayer(before.game).position }
    const hpBefore = getPlayer(before.game).hp
    const afterHit = injectHit(before, 'push', 'E', tuning)

    expect(afterHit.worldTimeAt).toBe(0)
    expect(afterHit.thermal.temperature).toBe(1)
    expect(afterHit.thermal.drift).toBeGreaterThan(0)
    expect(getPlayer(afterHit.game).hp).toBeLessThan(hpBefore)
    expect(getPlayer(afterHit.game).position).not.toEqual(origin)
    expect(afterHit.spatialByActorId.player.mode).toBe('none')
    expect(afterHit.spatialByActorId.player.level).toBe(0)

    const afterTime = stepWorld(afterHit, 1, tuning)
    expect(afterTime.worldTimeAt).toBe(1)
    expect(afterTime.thermal.temperature).toBeGreaterThan(afterHit.thermal.temperature)
  })

  it('keeps a clear Neutral Drive straight but does not build Movement M', () => {
    const tuning = defaultRuntimeTuning()
    const state = clearDriveLaneState()
    const origin = { ...getPlayer(state.game).position }
    const frames = resolveDrive(state, 'W', tuning)

    expect(frames).toHaveLength(3)
    expect(frames.map((frame) => frame.direction)).toEqual(['W', 'W', 'W'])
    expect(getPlayer(frames[0].state.game).position).toEqual(hexAdvance(origin, 'W', 1))
    expect(getPlayer(frames[1].state.game).position).toEqual(hexAdvance(origin, 'W', 2))
    expect(getPlayer(frames[2].state.game).position).toEqual(hexAdvance(origin, 'W', 3))
    expect(frames.at(-1)!.state.spatialByActorId.player.level).toBe(0)
  })

  it('builds Movement M from actual Hot Drive phases and preserves their selected axis', () => {
    const tuning = defaultRuntimeTuning()
    let state = clearDriveLaneState()
    state = setThermalDebug(state, { temperature: 5, drift: 0, setPoint: 2 })
    const frames = resolveDrive(state, 'W', tuning)
    const movementFrames = frames.filter((frame) => frame.state.spatialByActorId.player.mode === 'movement')

    expect(movementFrames.length).toBeGreaterThan(0)
    expect(movementFrames[0].state.spatialByActorId.player.level).toBeGreaterThan(0)
    expect(movementFrames[0].state.spatialByActorId.player.axis).toBe('W')
  })
})
