import { describe, expect, it } from 'vitest'
import {
  BASELINE_THERMAL_PROFILE,
  resolveThermalAction,
  thermalConfigFromProfile,
  thermalStateFromProfile,
  withThermalTuning,
} from './thermal-profile.js'
import { resolveThermalStep } from './thermal-runtime.js'

describe('shared Thermal Profile', () => {
  it('resolves Heat II and Cool II from one shared medium tier', () => {
    expect(resolveThermalAction(BASELINE_THERMAL_PROFILE, 'heat-ii').impulse).toBeCloseTo(0.8, 10)
    expect(resolveThermalAction(BASELINE_THERMAL_PROFILE, 'cool-ii').impulse).toBeCloseTo(-0.8, 10)
  })

  it('changing the medium tier updates both semantic action ids', () => {
    const tuned = withThermalTuning(BASELINE_THERMAL_PROFILE, {
      impulses: { small: 0.4, medium: 0.65, large: 1.6 },
    })
    expect(resolveThermalAction(tuned, 'heat-ii').impulse).toBeCloseTo(0.65, 10)
    expect(resolveThermalAction(tuned, 'cool-ii').impulse).toBeCloseTo(-0.65, 10)
  })

  it('keeps environment context separate from shared dynamics', () => {
    const adiabatic = thermalConfigFromProfile(BASELINE_THERMAL_PROFILE, 'adiabatic')
    const strongCold = thermalConfigFromProfile(BASELINE_THERMAL_PROFILE, 'strong-cold')
    expect(adiabatic.environmentCoupling).toBe(0)
    expect(strongCold.environmentTemperature).toBe(-4)
    expect(strongCold.environmentCoupling).toBeCloseTo(0.3, 10)
    expect(strongCold.restoringK).toBeCloseTo(adiabatic.restoringK, 10)
  })

  it('records the profile revision and resolved impulse in a gameplay step', () => {
    const tuned = withThermalTuning(BASELINE_THERMAL_PROFILE, {
      config: { restoringK: 0.62, baseDamping: 0.08, environmentDampingGain: 1, clampMin: -6, clampMax: 6 },
      impulses: { small: 0.4, medium: 0.65, large: 1.6 },
    })
    tuned.revision = 7
    const state = thermalStateFromProfile(tuned)
    const result = resolveThermalStep({ state, profile: tuned, actionId: 'heat-ii', environmentId: 'adiabatic', durationAt: 1 })
    expect(result.profileRevision).toBe(7)
    expect(result.action.id).toBe('heat-ii')
    expect(result.action.impulse).toBeCloseTo(0.65, 10)
    expect(result.finalState.worldAt).toBeCloseTo(1, 10)
  })
})
