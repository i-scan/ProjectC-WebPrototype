export const THERMAL_DISPLAY_MIN = -4
export const THERMAL_DISPLAY_MAX = 4
export const THERMAL_DIAL_MIN = -4.5
export const THERMAL_DIAL_MAX = 4.5
export const THERMAL_ANGLE_STEP = 12
export const THERMAL_SWING_ANGLE = 84

export type ThermalDirection = 'cold' | 'still' | 'hot'

export function clampThermalDisplay(value: number): number {
  return Math.max(THERMAL_DISPLAY_MIN, Math.min(THERMAL_DISPLAY_MAX, value))
}

/**
 * Every discrete temperature step occupies the same angular width. The
 * configurable set point remains at the physical lowest position (0 degrees),
 * so the absolute-temperature dial shifts around that point without stretching
 * either side.
 */
export function thermalAngleFor(value: number, setPoint: number): number {
  const clampedSetPoint = clampThermalDisplay(setPoint)
  const dialValue = Math.max(THERMAL_DIAL_MIN, Math.min(THERMAL_DIAL_MAX, value))
  return (dialValue - clampedSetPoint) * THERMAL_ANGLE_STEP
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
  if (value <= -3.5 || value >= 3.5) return 'extreme'
  if (value <= -2.5) return 'cold-3'
  if (value <= -1.5) return 'cold-2'
  if (value <= -0.5) return 'cold-1'
  if (value < 0.5) return 'neutral'
  if (value < 1.5) return 'hot-1'
  if (value < 2.5) return 'hot-2'
  return 'hot-3'
}
