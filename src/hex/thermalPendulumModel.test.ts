import { describe, expect, it } from 'vitest'
import {
  THERMAL_ANGLE_STEP,
  THERMAL_SWING_ANGLE,
  discreteThermalValue,
  formatThermalValue,
  thermalAngleFor,
  thermalDirectionFor,
  thermalVisualRotationFor,
  thermalZoneClass,
} from './thermalPendulumModel'

describe('thermal pendulum model', () => {
  it('keeps the configurable set point at the lowest position', () => {
    expect(thermalAngleFor(1, 1)).toBe(0)
    expect(thermalAngleFor(-2, -2)).toBe(0)
  })

  it('uses the same angle for every adjacent temperature interval', () => {
    for (let value = -4; value < 4; value += 1) {
      expect(thermalAngleFor(value + 1, 1) - thermalAngleFor(value, 1)).toBe(THERMAL_ANGLE_STEP)
      expect(thermalAngleFor(value + 1, -2) - thermalAngleFor(value, -2)).toBe(THERMAL_ANGLE_STEP)
    }
  })

  it('snaps body temperature to discrete tick centers', () => {
    expect(discreteThermalValue(1.49)).toBe(1)
    expect(discreteThermalValue(1.5)).toBe(2)
    expect(thermalAngleFor(1.49, 0)).toBe(THERMAL_ANGLE_STEP)
    expect(thermalAngleFor(1.5, 0)).toBe(THERMAL_ANGLE_STEP * 2)
  })

  it('cannot move beyond the two grey extreme segments', () => {
    expect(discreteThermalValue(-99)).toBe(-4)
    expect(discreteThermalValue(99)).toBe(4)
    expect(thermalAngleFor(-99, 3)).toBe(-THERMAL_SWING_ANGLE)
    expect(thermalAngleFor(99, -3)).toBe(THERMAL_SWING_ANGLE)
  })

  it('inverts CSS rotation so hot renders right and cold renders left', () => {
    expect(thermalVisualRotationFor(2, 0)).toBe(-THERMAL_ANGLE_STEP * 2)
    expect(thermalVisualRotationFor(-2, 0)).toBe(THERMAL_ANGLE_STEP * 2)
    expect(thermalVisualRotationFor(1, 1)).toBe(0)
  })

  it('uses momentum sign only for the visible direction', () => {
    expect(thermalDirectionFor(-0.25)).toBe('cold')
    expect(thermalDirectionFor(0)).toBe('still')
    expect(thermalDirectionFor(1.5)).toBe('hot')
  })

  it('uses one neutral extreme style outside the effective range', () => {
    expect(thermalZoneClass(-4)).toBe('extreme')
    expect(thermalZoneClass(4)).toBe('extreme')
    expect(thermalZoneClass(-1)).toBe('cold-1')
    expect(thermalZoneClass(1)).toBe('hot-1')
    expect(formatThermalValue(1)).toBe('+1')
    expect(formatThermalValue(-1.25, 2)).toBe('-1.25')
  })
})
