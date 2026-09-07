import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THERMAL_CONFIG,
  DEFAULT_THERMAL_IMPULSES,
  applyThermalImpulse,
  predictThermalAction,
  sampleThermalSegment,
  solveThermalAction,
  solveThermalSegment,
  thermalDiagnostics,
} from './thermal-clock-model.js'

const closeState = (actual, expected, digits = 8) => {
  expect(actual.temperature).toBeCloseTo(expected.temperature, digits)
  expect(actual.drift).toBeCloseTo(expected.drift, digits)
}

describe('Thermal Clock Lab analytic model', () => {
  it('keeps adiabatic rest fixed at Set Point', () => {
    const state = { worldAt: 0, temperature: 1, drift: 0, setPoint: 1 }
    const result = solveThermalSegment(state, DEFAULT_THERMAL_CONFIG, 8)
    closeState(result, state)
  })

  it('applies Drift impulse instantly without changing Temperature', () => {
    const state = { worldAt: 2, temperature: 1.4, drift: -0.2, setPoint: 1 }
    const result = applyThermalImpulse(state, 0.8)
    expect(result.temperature).toBe(state.temperature)
    expect(result.drift).toBeCloseTo(0.6, 10)
    expect(result.worldAt).toBe(2)
  })

  it('uses the same solver result for Preview and committed 1AT action', () => {
    const state = { worldAt: 3, temperature: 1, drift: 0.25, setPoint: 1 }
    const preview = predictThermalAction({
      state,
      config: DEFAULT_THERMAL_CONFIG,
      actionId: 'heat-ii',
      impulses: DEFAULT_THERMAL_IMPULSES,
      horizonAt: 4,
    })
    const committed = solveThermalAction(state, DEFAULT_THERMAL_CONFIG, 'heat-ii', DEFAULT_THERMAL_IMPULSES, 1)
    closeState(preview.finalState, committed.finalState)
    expect(preview.finalState.worldAt).toBe(4)
    expect(state.worldAt).toBe(3)
  })

  it('matches sample at duration with direct segment final', () => {
    const state = { worldAt: 0, temperature: -0.6, drift: 1.2, setPoint: 1 }
    const direct = solveThermalSegment(state, DEFAULT_THERMAL_CONFIG, 2.4)
    const sampled = sampleThermalSegment(state, DEFAULT_THERMAL_CONFIG, 2.4, 2.4)
    closeState(sampled, direct)
  })

  it('supports underdamped, critical and overdamped branches without NaN', () => {
    const state = { worldAt: 0, temperature: 2, drift: -0.4, setPoint: 1 }
    const configs = [
      { ...DEFAULT_THERMAL_CONFIG, restoringK: 0.25, baseDamping: 0.25 },
      { ...DEFAULT_THERMAL_CONFIG, restoringK: 0.25, baseDamping: 1.0 },
      { ...DEFAULT_THERMAL_CONFIG, restoringK: 0.25, baseDamping: 1.5 },
    ]
    expect(configs.map((config) => thermalDiagnostics(state, config).regime)).toEqual(['underdamped', 'critical', 'overdamped'])
    for (const config of configs) {
      const result = solveThermalSegment(state, config, 5)
      expect(Number.isFinite(result.temperature)).toBe(true)
      expect(Number.isFinite(result.drift)).toBe(true)
    }
  })

  it('ignores Environment Temperature when kE is zero', () => {
    const state = { worldAt: 0, temperature: 1.4, drift: 0.5, setPoint: 1 }
    const cold = solveThermalSegment(state, { ...DEFAULT_THERMAL_CONFIG, environmentTemperature: -6, environmentCoupling: 0 }, 3)
    const hot = solveThermalSegment(state, { ...DEFAULT_THERMAL_CONFIG, environmentTemperature: 6, environmentCoupling: 0 }, 3)
    closeState(cold, hot)
  })

  it('is segment-composable when parameters stay constant', () => {
    const state = { worldAt: 0, temperature: 2.2, drift: -0.8, setPoint: 1 }
    const config = { ...DEFAULT_THERMAL_CONFIG, environmentTemperature: -2, environmentCoupling: 0.2, environmentDampingGain: 1.4 }
    const whole = solveThermalSegment(state, config, 2.5)
    const first = solveThermalSegment(state, config, 0.9)
    const split = solveThermalSegment(first, config, 1.6)
    closeState(split, whole, 7)
  })

  it('supports deterministic piecewise mid-segment impulse', () => {
    const state = { worldAt: 0, temperature: 1.2, drift: -0.3, setPoint: 1 }
    const config = { ...DEFAULT_THERMAL_CONFIG, environmentTemperature: -3, environmentCoupling: 0.15 }
    const beforeImpulse = solveThermalSegment(state, config, 0.35)
    const afterImpulse = applyThermalImpulse(beforeImpulse, 1.6)
    const resultA = solveThermalSegment(afterImpulse, config, 0.65)
    const resultB = solveThermalSegment(applyThermalImpulse(solveThermalSegment(state, config, 0.35), 1.6), config, 0.65)
    closeState(resultA, resultB)
  })

  it('mirrors Heat and Cool around S for symmetric adiabatic initial state', () => {
    const state = { worldAt: 0, temperature: 1, drift: 0, setPoint: 1 }
    const heat = solveThermalAction(state, DEFAULT_THERMAL_CONFIG, 'heat-ii').finalState
    const cool = solveThermalAction(state, DEFAULT_THERMAL_CONFIG, 'cool-ii').finalState
    expect(heat.temperature - state.setPoint).toBeCloseTo(-(cool.temperature - state.setPoint), 8)
    expect(heat.drift).toBeCloseTo(-cool.drift, 8)
  })

  it('handles K=0 pure damping and constant-velocity limits', () => {
    const state = { worldAt: 0, temperature: 0, drift: 1, setPoint: 1 }
    const damped = solveThermalSegment(state, {
      ...DEFAULT_THERMAL_CONFIG,
      restoringK: 0,
      environmentCoupling: 0,
      baseDamping: 0.5,
    }, 2)
    const free = solveThermalSegment(state, {
      ...DEFAULT_THERMAL_CONFIG,
      restoringK: 0,
      environmentCoupling: 0,
      baseDamping: 0,
    }, 2)
    expect(Number.isFinite(damped.temperature)).toBe(true)
    expect(Number.isFinite(damped.drift)).toBe(true)
    expect(free.temperature).toBeCloseTo(2, 8)
    expect(free.drift).toBeCloseTo(1, 8)
  })
})
