import { describe, expect, it } from 'vitest'
import {
  THERMAL_SWING_ANGLE,
  formatThermalValue,
  thermalAngleFor,
  thermalDirectionFor,
  thermalZoneClass,
} from './thermalPendulumModel'

describe('thermal pendulum model', () => {
  it('keeps the configurable set point at the lowest position', () => {
    expect(thermalAngleFor(1, 1)).toBe(0)
    expect(thermalAngleFor(-2, -2)).toBe(0)
  })

  it('maps cold and hot extremes to opposite sides', () => {
    expect(thermalAngleFor(-4, 1)).toBe(-THERMAL_SWING_ANGLE)
    expect(thermalAngleFor(4, 1)).toBe(THERMAL_SWING_ANGLE)
  })

  it('uses momentum sign only for the visible direction', () => {
    expect(thermalDirectionFor(-0.25)).toBe('cold')
    expect(thermalDirectionFor(0)).toBe('still')
    expect(thermalDirectionFor(1.5)).toBe('hot')
  })

  it('keeps discrete thermal zones and signed readouts', () => {
    expect(thermalZoneClass(-4)).toBe('extreme-cold')
    expect(thermalZoneClass(-1)).toBe('cold-1')
    expect(thermalZoneClass(1)).toBe('hot-1')
    expect(thermalZoneClass(4)).toBe('extreme-hot')
    expect(formatThermalValue(1)).toBe('+1')
    expect(formatThermalValue(-1.25, 2)).toBe('-1.25')
  })
})
