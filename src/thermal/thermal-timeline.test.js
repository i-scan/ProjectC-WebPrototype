import { describe, expect, it } from 'vitest'
import { thermalTimeline, sampleThermalTimeline } from './thermal-runtime.js'
import { DEFAULT_THERMAL_CONFIG, solveThermalSegment, applyThermalImpulse } from '../labs/thermal/thermal-clock-model.js'

describe('Shared piecewise Thermal timeline', () => {
  const state = { temperature: 1, drift: 0, setPoint: 1, worldAt: 4 }
  it('inserts a mid-AT impulse without retroactively warming the earlier segment', () => {
    const result = thermalTimeline({ state, config: DEFAULT_THERMAL_CONFIG, events: [{ t: 0.6, impulse: 1 }] })
    expect(sampleThermalTimeline(result.segments, 0.599).drift).toBe(0)
    expect(sampleThermalTimeline(result.segments, 0.6).drift).toBe(1)
    expect(sampleThermalTimeline(result.segments, 0.6).temperature).toBe(1)
    const expected = solveThermalSegment(applyThermalImpulse(state, 1), DEFAULT_THERMAL_CONFIG, 0.4)
    expect(result.finalState.temperature).toBeCloseTo(expected.temperature, 12)
    expect(sampleThermalTimeline(result.segments, 1)).toEqual(result.finalState)
  })
  it.each([0.1, 1, 3])('supports damping %s with multiple same-time impulses and environment change', (baseDamping) => {
    const config = { ...DEFAULT_THERMAL_CONFIG, baseDamping }
    const nextConfig = { ...config, environmentCoupling: 0.3, environmentTemperature: -4 }
    const result = thermalTimeline({ state, config, events: [{ t: 0, impulse: 0.8 },
      { t: 0.35, impulse: 0.4, config: nextConfig }, { t: 0.35, impulse: -0.2 }, { t: 1, impulse: 0.1 }] })
    let expected = solveThermalSegment(applyThermalImpulse(state, 0.8), config, 0.35)
    expected = solveThermalSegment(applyThermalImpulse(expected, 0.2), nextConfig, 0.65)
    expected = applyThermalImpulse(expected, 0.1)
    expect(result.finalState.temperature).toBeCloseTo(expected.temperature, 12)
    expect(result.finalState.drift).toBeCloseTo(expected.drift, 12)
    expect(sampleThermalTimeline(result.segments, 1)).toEqual(result.finalState)
  })
})
