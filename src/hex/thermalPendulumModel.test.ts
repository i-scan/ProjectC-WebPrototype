import { describe, expect, it } from 'vitest'
import {
  THERMAL_ANGLE_STEP,
  THERMAL_SWING_ANGLE,
  discreteThermalValue,
  formatThermalValue,
  thermalAngleFor,
  thermalDialAngleFor,
  thermalDirectionFor,
  thermalSlotFor,
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

  it('uses one slot for both dial position and bob colour', () => {
    for (let setPoint = -3; setPoint <= 3; setPoint += 1) {
      for (let temperature = -4; temperature <= 4; temperature += 1) {
        const slot = thermalSlotFor(temperature, setPoint)
        expect(slot.temperature).toBe(temperature)
        expect(slot.angle).toBe(thermalDialAngleFor(temperature, setPoint))
        expect(slot.zoneClass).toBe(thermalZoneClass(temperature))
      }
    }
  })

  it('preserves asymmetric reachable slots when set point is not zero', () => {
    const warmSetPointColdExtreme = thermalSlotFor(-4, 2)
    const warmSetPointHotExtreme = thermalSlotFor(4, 2)
    expect(warmSetPointColdExtreme.angle).toBe(-THERMAL_ANGLE_STEP * 6)
    expect(warmSetPointHotExtreme.angle).toBe(THERMAL_ANGLE_STEP * 2)

    const coldSetPointColdExtreme = thermalSlotFor(-4, -2)
    const coldSetPointHotExtreme = thermalSlotFor(4, -2)
    expect(coldSetPointColdExtreme.angle).toBe(-THERMAL_ANGLE_STEP * 2)
    expect(coldSetPointHotExtreme.angle).toBe(THERMAL_ANGLE_STEP * 6)
  })

  it('keeps cold slots left and hot slots right of the set point', () => {
    expect(thermalSlotFor(-2, 1).angle).toBeLessThan(0)
    expect(thermalSlotFor(2, 1).angle).toBeGreaterThan(0)
    expect(thermalSlotFor(-2, 1).zoneClass).toBe('cold-2')
    expect(thermalSlotFor(2, 1).zoneClass).toBe('hot-2')
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
