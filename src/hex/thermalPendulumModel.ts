export const THERMAL_DISPLAY_MIN = -4
export const THERMAL_DISPLAY_MAX = 4
export const THERMAL_SWING_ANGLE = 72

export type ThermalDirection = 'cold' | 'still' | 'hot'

export function clampThermalDisplay(value: number): number {
  return Math.max(THERMAL_DISPLAY_MIN, Math.min(THERMAL_DISPLAY_MAX, value))
}

/**
 * Maps an absolute body temperature to a pendulum angle while keeping the
 * configurable set point at the physical lowest position (0 degrees).
 * Cold values swing left and hot values swing right.
 */
export function thermalAngleFor(value: number, setPoint: number): number {
  const clampedSetPoint = clampThermalDisplay(setPoint)
  const clampedValue = clampThermalDisplay(value)

  if (clampedValue === clampedSetPoint) return 0
  if (clampedValue < clampedSetPoint) {
    const span = Math.max(0.001, clampedSetPoint - THERMAL_DISPLAY_MIN)
    return -THERMAL_SWING_ANGLE * ((clampedSetPoint - clampedValue) / span)
  }

  const span = Math.max(0.001, THERMAL_DISPLAY_MAX - clampedSetPoint)
  return THERMAL_SWING_ANGLE * ((clampedValue - clampedSetPoint) / span)
}

export function thermalDirectionFor(momentum: number): ThermalDirection {
  if (momentum > 0.001) return 'hot'
  if (momentum < -0.001) return 'cold'
  return 'still'
}

export function formatThermalValue(value: number, digits = 0): string {
  const rounded = Number(value.toFixed(digits))
  return rounded > 0 ? `+${rounded.toFixed(digits)}` : rounded.toFixed(digits)
}

export function thermalZoneClass(value: number): string {
  if (value <= -3.5) return 'extreme-cold'
  if (value <= -2.5) return 'cold-3'
  if (value <= -1.5) return 'cold-2'
  if (value <= -0.5) return 'cold-1'
  if (value < 0.5) return 'neutral'
  if (value < 1.5) return 'hot-1'
  if (value < 2.5) return 'hot-2'
  if (value < 3.5) return 'hot-3'
  return 'extreme-hot'
}
