import { describe, expect, it } from 'vitest'
import { getPlayer } from '../game'
import {
  applyIncomingMomentum,
  applyPreset,
  axisLabel,
  basicAttackPlan,
  basicMovePlan,
  brakePlan,
  createActorLoopState,
  createSpatialState,
  defaultActorLoopSettings,
  downAxis,
  drivePlan,
  groundBreakPlan,
  holdGroundPlan,
  horizontalAxis,
  injectIncomingPlan,
  launchPlan,
  raikiriPlan,
  setSpatialDebug,
  setThermalDebug,
  stepWorldPlan,
  type ActorLoopSettings,
} from './actorLoopUt6'
import { hexDistance } from './hexTopology'

function settings(patch: Partial<ActorLoopSettings> = {}): ActorLoopSettings {
  return { ...defaultActorLoopSettings(), ...patch }
}

function playerSpatial(state: ReturnType<typeof createActorLoopState>) {
  return state.spatialByActorId.player
}

function dummy(state: ReturnType<typeof createActorLoopState>, name: string) {
  const actor = state.game.actors.find((candidate) => candidate.name === name)
  if (!actor) throw new Error(`Missing ${name}`)
  return actor
}

describe('VAL-012-UT6 Actor Loop v0', () => {
  it('T1 compares Axis First and Immediate M1 using behavior continuity, not action IDs', () => {
    let immediate = createActorLoopState()
    immediate = basicMovePlan(immediate, 'NW', settings({ naturalBuildStartMode: 'immediate-m1' })).result
    expect(playerSpatial(immediate)).toEqual({ level: 1, axis: horizontalAxis('NW') })

    let continuous = createActorLoopState()
    continuous = basicMovePlan(continuous, 'NW', settings({ naturalBuildStartMode: 'axis-first' })).result
    expect(playerSpatial(continuous)).toEqual({ level: 0, axis: horizontalAxis('NW') })
    continuous = basicMovePlan(continuous, 'NW', settings({ naturalBuildStartMode: 'axis-first' })).result
    expect(playerSpatial(continuous)).toEqual({ level: 1, axis: horizontalAxis('NW') })

    let interrupted = createActorLoopState()
    interrupted = basicMovePlan(interrupted, 'NW', settings({ naturalBuildStartMode: 'axis-first' })).result
    interrupted = stepWorldPlan(interrupted, settings({ naturalBuildStartMode: 'axis-first' })).result
    interrupted = basicMovePlan(interrupted, 'NW', settings({ naturalBuildStartMode: 'axis-first' })).result
    expect(playerSpatial(interrupted)).toEqual({ level: 0, axis: horizontalAxis('NW') })
    expect(interrupted.logs[0].detail).toContain('Axis First')
  })

  it('T2 Basic Move spends M1 for Move2 and cannot refund it in the same AT', () => {
    let state = createActorLoopState()
    state = setThermalDebug(state, { temperature: 4, setPoint: 2, drift: 3 })
    state = setSpatialDebug(state, 'player', createSpatialState(1, horizontalAxis('NW')))
    const plan = basicMovePlan(state, 'NW', settings())
    expect(plan.valid).toBe(true)
    expect(plan.path).toHaveLength(2)
    expect(playerSpatial(plan.result)).toEqual({ level: 0, axis: horizontalAxis('NW') })
    expect(plan.result.logs[0].detail).toContain('Spend 1M')
    expect(plan.result.logs[0].detail).toContain('Same-AT Spend Lock')
  })

  it('T3 Basic Move spends one layer from M2 and leaves M1', () => {
    let state = createActorLoopState()
    state = setSpatialDebug(state, 'player', createSpatialState(2, horizontalAxis('NW')))
    const plan = basicMovePlan(state, 'NW', settings())
    expect(plan.path).toHaveLength(2)
    expect(playerSpatial(plan.result)).toEqual({ level: 1, axis: horizontalAxis('NW') })
  })

  it('Basic Move cannot overwrite an incompatible existing Axis', () => {
    let state = createActorLoopState()
    state = setSpatialDebug(state, 'player', createSpatialState(2, horizontalAxis('E')))
    const plan = basicMovePlan(state, 'NW', settings())
    expect(plan.valid).toBe(false)
    expect(plan.reason).toContain('must be resolved')
  })

  it('T4 Grounded Basic Attack spends Down M1, applies Incoming M1, and does not refund', () => {
    let state = createActorLoopState()
    state = setThermalDebug(state, { temperature: -4, setPoint: -2, drift: -3 })
    state = setSpatialDebug(state, 'player', createSpatialState(1, downAxis()))
    const target = dummy(state, 'Dummy B')
    const before = { ...target.position }
    const plan = basicAttackPlan(state, target.id, settings())
    expect(plan.valid).toBe(true)
    expect(plan.atCost).toBe(1)
    expect(playerSpatial(plan.result)).toEqual({ level: 0, axis: downAxis() })
    const afterTarget = plan.result.game.actors.find((actor) => actor.id === target.id)!
    expect(afterTarget.position).not.toEqual(before)
    expect(plan.result.spatialByActorId[target.id]).toEqual({ level: 1, axis: horizontalAxis('NE') })
    expect(plan.result.logs[0].detail).toContain('Spend 1 Down M')
  })

  it('T5 Grounded Basic Attack spends one Down layer from M2 and leaves Down M1', () => {
    let state = createActorLoopState()
    state = setSpatialDebug(state, 'player', createSpatialState(2, downAxis()))
    const target = dummy(state, 'Dummy B')
    const plan = basicAttackPlan(state, target.id, settings())
    expect(playerSpatial(plan.result)).toEqual({ level: 1, axis: downAxis() })
  })

  it('T6 Same-AT Spend Lock stays frozen even in a matching Thermal Domain', () => {
    let state = createActorLoopState()
    state = setThermalDebug(state, { temperature: -4, setPoint: -2, drift: -3 })
    state = setSpatialDebug(state, 'player', createSpatialState(1, downAxis()))
    const target = dummy(state, 'Dummy B')
    const result = basicAttackPlan(state, target.id, settings()).result
    expect(playerSpatial(result).level).toBe(0)
    expect(result.logs[0].detail).toContain('Spend 1 Down M')
  })

  it('Natural Build caps at M1 in Neutral while matching Cold Domain can grow Down to M3', () => {
    let neutral = createActorLoopState()
    neutral = holdGroundPlan(neutral, settings()).result
    neutral = holdGroundPlan(neutral, settings()).result
    neutral = holdGroundPlan(neutral, settings()).result
    expect(playerSpatial(neutral).level).toBe(1)

    let cold = createActorLoopState()
    cold = setThermalDebug(cold, { temperature: -4, setPoint: -2, drift: -3 })
    cold = holdGroundPlan(cold, settings()).result
    cold = holdGroundPlan(cold, settings()).result
    cold = holdGroundPlan(cold, settings()).result
    expect(playerSpatial(cold)).toEqual({ level: 3, axis: downAxis() })
  })

  it('matching Hot continuous Drive can grow Horizontal M beyond Natural cap', () => {
    let state = createActorLoopState()
    state = setThermalDebug(state, { temperature: 4, setPoint: 2, drift: 3 })
    const plan = drivePlan(state, 'NW', settings({ drivePreservesMomentum: true, driveContinuousTraversal: true }))
    expect(plan.valid).toBe(true)
    expect(plan.atCost).toBe(2)
    expect(playerSpatial(plan.result).level).toBeGreaterThanOrEqual(2)
    expect(axisLabel(playerSpatial(plan.result).axis)).toBe('Axis NW')
  })

  it('T7 Launch / Brake MinM can compare 1 vs 2 without changing the core conversion rule', () => {
    let launchState = createActorLoopState()
    launchState = setSpatialDebug(launchState, 'player', createSpatialState(1, downAxis()))
    expect(launchPlan(launchState, 'NW', settings({ launchBrakeMinM: 2 })).valid).toBe(false)
    const launch = launchPlan(launchState, 'NW', settings({ launchBrakeMinM: 1 }))
    expect(launch.valid).toBe(true)
    expect(launch.path).toHaveLength(1)
    expect(playerSpatial(launch.result)).toEqual({ level: 0, axis: horizontalAxis('NW') })

    let brakeState = createActorLoopState()
    brakeState = setSpatialDebug(brakeState, 'player', createSpatialState(2, horizontalAxis('NW')))
    const brake = brakePlan(brakeState, settings({ launchBrakeMinM: 2 }))
    expect(brake.valid).toBe(true)
    expect(playerSpatial(brake.result)).toEqual({ level: 1, axis: downAxis() })
  })

  it('T8 Conversion same-AT Build remains an explicit A/B independent of Basic Spend Lock', () => {
    let base = createActorLoopState()
    base = setSpatialDebug(base, 'player', createSpatialState(2, downAxis()))
    const off = launchPlan(base, 'NW', settings({ buildAfterConversionSameAt: false })).result
    const on = launchPlan(base, 'NW', settings({ buildAfterConversionSameAt: true })).result
    expect(playerSpatial(off).level).toBe(1)
    expect(playerSpatial(on).level).toBeGreaterThanOrEqual(playerSpatial(off).level)
    expect(off.logs[0].detail).toContain('Conversion Build OFF')
  })

  it('T10 Incoming Momentum follows cancel -> remaining axis -> movement exactly', () => {
    let m0 = createActorLoopState()
    const p0 = { ...getPlayer(m0.game).position }
    const r0 = applyIncomingMomentum(m0, 'player', 'NW', 1)
    expect(r0.moved).toBe(1)
    expect(playerSpatial(r0.state)).toEqual({ level: 1, axis: horizontalAxis('NW') })
    expect(getPlayer(r0.state.game).position).not.toEqual(p0)

    let down1 = createActorLoopState()
    down1 = setSpatialDebug(down1, 'player', createSpatialState(1, downAxis()))
    const r1 = applyIncomingMomentum(down1, 'player', 'NW', 1)
    expect(r1.moved).toBe(0)
    expect(playerSpatial(r1.state)).toEqual({ level: 0, axis: null })

    const r3 = applyIncomingMomentum(down1, 'player', 'NW', 3)
    expect(r3.moved).toBe(2)
    expect(playerSpatial(r3.state)).toEqual({ level: 2, axis: horizontalAxis('NW') })
  })

  it('Incoming Forced Movement checks each Cell and keeps remaining M even when blocked', () => {
    let state = createActorLoopState()
    const actor = dummy(state, 'Dummy D')
    state = injectIncomingPlan(state, actor.id, 'E', 3).result
    expect(state.spatialByActorId[actor.id].level).toBe(3)
    expect(state.logs[0].detail).toContain('blocked during per-cell check')
  })

  it('T11 AT0 changes immediate state but freezes world time, Thermal and Build', () => {
    let state = applyPreset(createActorLoopState(), 'release')
    const release = raikiriPlan(state, settings({ at0Enabled: true }))
    expect(release.valid).toBe(true)
    state = release.result
    const target = state.game.actors.find((actor) => actor.alive && actor.id !== 'player' && hexDistance(getPlayer(state.game).position, actor.position) === 1)!
    const beforeWorld = state.worldTimeAt
    const beforeThermal = { ...state.thermal }
    const first = basicAttackPlan(state, target.id, settings({ at0Enabled: true }))
    expect(first.atCost).toBe(0)
    expect(first.result.worldTimeAt).toBe(beforeWorld)
    expect(first.result.thermal).toEqual(beforeThermal)
    const second = basicAttackPlan(first.result, target.id, settings({ at0Enabled: true }))
    expect(second.atCost).toBe(1)
  })

  it('T12 Thermal Release Direct / Drift / Mixed remain observable A/B modes', () => {
    const base = applyPreset(createActorLoopState(), 'release')
    const direct = raikiriPlan(base, settings({ thermalReleaseMode: 'direct' })).result
    const drift = raikiriPlan(base, settings({ thermalReleaseMode: 'drift' })).result
    const mixed = raikiriPlan(base, settings({ thermalReleaseMode: 'mixed' })).result
    expect(direct.logs[0].detail).toContain('Thermal direct')
    expect(drift.logs[0].detail).toContain('Thermal drift')
    expect(mixed.logs[0].detail).toContain('Thermal mixed')
    expect(direct.thermal.temperature).not.toBe(drift.thermal.temperature)
    expect(mixed.thermal.drift).not.toBe(direct.thermal.drift)
  })

  it('T13 Drive Preserve / Continuous Traversal are experiment settings, not hidden rules', () => {
    let state = createActorLoopState()
    state = setThermalDebug(state, { temperature: 4, setPoint: 2, drift: 3 })
    state = setSpatialDebug(state, 'player', createSpatialState(2, horizontalAxis('NW')))
    const preserve = drivePlan(state, 'NW', settings({ drivePreservesMomentum: true, driveContinuousTraversal: true }))
    const consume = drivePlan(state, 'NW', settings({ drivePreservesMomentum: false, driveContinuousTraversal: false }))
    expect(preserve.summary).toContain('Preserve ON')
    expect(consume.summary).toContain('Preserve OFF')
    expect(playerSpatial(preserve.result).level).toBeGreaterThanOrEqual(playerSpatial(consume.result).level)
  })

  it('T14 Raikiri and Ground Break release high Momentum through different spatial verbs', () => {
    const hot = applyPreset(createActorLoopState(), 'release')
    const raikiri = raikiriPlan(hot, settings())
    expect(raikiri.valid).toBe(true)
    expect(playerSpatial(raikiri.result).level).toBeLessThan(3)
    expect(raikiri.summary).toContain('Release Axis E M3')

    let cold = applyPreset(createActorLoopState(), 'cold-down')
    cold = setSpatialDebug(cold, 'player', createSpatialState(3, downAxis()))
    const before = Object.fromEntries(cold.game.actors.filter((actor) => actor.id !== 'player').map((actor) => [actor.id, { hp: actor.hp, position: { ...actor.position } }]))
    const ground = groundBreakPlan(cold, settings())
    expect(ground.valid).toBe(true)
    expect(playerSpatial(ground.result).level).toBeLessThan(3)
    const changed = ground.result.game.actors.filter((actor) => actor.id !== 'player').filter((actor) => {
      const old = before[actor.id]
      return actor.hp !== old.hp || actor.position.x !== old.position.x || actor.position.y !== old.position.y
    })
    expect(changed.length).toBeGreaterThanOrEqual(2)
  })
})
