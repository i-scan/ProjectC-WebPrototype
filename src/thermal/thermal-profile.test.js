import { describe, expect, it } from 'vitest'
import {
  BASELINE_THERMAL_PROFILE,
  resolveThermalAction,
  thermalConfigFromProfile,
  thermalDynamicsMode,
  thermalInertialConfigFromProfile,
  thermalStateFromProfile,
  withThermalTuning,
} from './thermal-profile.js'
import { resolveThermalImpulseStep, resolveThermalStep } from './thermal-runtime.js'

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
  it('migrates legacy-shaped profiles to Oscillator while preserving Inertial defaults', () => {
    const legacy = structuredClone(BASELINE_THERMAL_PROFILE)
    delete legacy.dynamicsMode
    delete legacy.inertial
    const tuned = withThermalTuning(legacy)
    expect(thermalDynamicsMode(tuned)).toBe('oscillator')
    expect(thermalInertialConfigFromProfile(tuned)).toEqual({ driftHalfLifeAt: 1, recoveryHalfLifeAt: 3 })
  })

  it('publishes Inertial mode and HD / HR through the shared profile', () => {
    const tuned = withThermalTuning(BASELINE_THERMAL_PROFILE, {
      dynamicsMode: 'inertial',
      inertialConfig: { driftHalfLifeAt: 0.75, recoveryHalfLifeAt: 2.5 },
    })
    expect(thermalDynamicsMode(tuned)).toBe('inertial')
    expect(thermalInertialConfigFromProfile(tuned)).toEqual({ driftHalfLifeAt: 0.75, recoveryHalfLifeAt: 2.5 })
  })

  it('resolves semantic Heat through the shared Inertial runtime as sustained Drive', () => {
    const tuned = withThermalTuning(BASELINE_THERMAL_PROFILE, {
      dynamicsMode: 'inertial',
      inertialConfig: { driftHalfLifeAt: 1, recoveryHalfLifeAt: 3 },
    })
    const state = thermalStateFromProfile(tuned)
    const result = resolveThermalStep({ state, profile: tuned, actionId: 'heat-ii', durationAt: 1 })
    expect(result.dynamicsMode).toBe('inertial')
    expect(result.action.effectType).toBe('drive')
    expect(result.action.driveRate).toBeCloseTo(0.8, 10)
    expect(result.finalState.drift).toBeGreaterThan(0)
    expect(result.finalState.temperature).toBeGreaterThan(state.temperature)
  })

  it('resolves an explicit Gameplay Momentum impulse through the same shared solver', () => {
    const state = thermalStateFromProfile(BASELINE_THERMAL_PROFILE)
    const result = resolveThermalImpulseStep({
      state,
      profile: BASELINE_THERMAL_PROFILE,
      impulse: -0.75,
      sourceId: 'active-h-spend',
      environmentId: 'adiabatic',
      durationAt: 1,
    })
    expect(result.action.id).toBe('active-h-spend')
    expect(result.action.impulse).toBeCloseTo(-0.75, 10)
    expect(result.profileRevision).toBe(BASELINE_THERMAL_PROFILE.revision)
    expect(result.finalState.worldAt).toBeCloseTo(1, 10)
  })
})
