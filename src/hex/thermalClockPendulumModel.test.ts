import { describe, expect, it } from 'vitest'
import {
  thermalClockAngleFor,
  thermalClockDialAngleFor,
  thermalClockDriftProjectionFor,
  thermalClockSlotFor,
} from './thermalClockPendulumModel'

describe('continuous Thermal Clock pendulum mapping', () => {
  it('keeps continuous body temperature inside a display slot', () => {
    expect(thermalClockAngleFor(0.5, 0)).toBe(6)
    expect(thermalClockSlotFor(0.5, 0).temperature).toBe(0.5)
  })

  it('keeps Cold on the left and Hot on the right for a shifted Set Point', () => {
    expect(thermalClockAngleFor(-2, 1)).toBeLessThan(0)
    expect(thermalClockAngleFor(3, 1)).toBeGreaterThan(0)
  })

  it('uses the absolute temperature zone colour while geometry remains continuous', () => {
    expect(thermalClockSlotFor(-1.4, 0).zoneClass).toBe('cold-1')
    expect(thermalClockSlotFor(2.25, 0).zoneClass).toBe('hot-2')
  })

  it('keeps equal-width absolute temperature segments after Set Point shifts', () => {
    expect(thermalClockDialAngleFor(4.5, -3) - thermalClockDialAngleFor(3.5, -3)).toBe(12)
    expect(thermalClockDialAngleFor(-3.5, 2) - thermalClockDialAngleFor(-4.5, 2)).toBe(12)
  })

  it('projects Drift from the current bob and clips it to the visible range', () => {
    const hot = thermalClockDriftProjectionFor(1.5, 0, 2, 3)
    const cold = thermalClockDriftProjectionFor(-1.5, 0, -2, 3)
    const clipped = thermalClockDriftProjectionFor(4, 0, 3, 3)

    expect(hot.direction).toBe('hot')
    expect(hot.endAngle).toBeGreaterThan(hot.startAngle)
    expect(cold.direction).toBe('cold')
    expect(cold.endAngle).toBeLessThan(cold.startAngle)
    expect(clipped.clipped).toBe(true)
    expect(clipped.endAngle).toBe(clipped.startAngle)
  })
})
