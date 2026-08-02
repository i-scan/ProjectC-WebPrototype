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

export function discreteThermalValue(value: number): number {
  return Math.round(clampThermalDisplay(value))
}

function discreteSetPoint(value: number): number {
  return Math.round(clampThermalDisplay(value))
}

/**
 * The visible bob always lands on the center of a discrete dial segment.
 * Values beyond the supported range clamp to the two grey extreme segments.
 */
export function thermalAngleFor(value: number, setPoint: number): number {
  const thermalStep = discreteThermalValue(value)
  const setPointStep = discreteSetPoint(setPoint)
  const angle = (thermalStep - setPointStep) * THERMAL_ANGLE_STEP
  return Math.max(-THERMAL_SWING_ANGLE, Math.min(THERMAL_SWING_ANGLE, angle))
}

/**
 * Continuous mapping used only to draw zone boundaries. Unlike the bob, zone
 * edges may sit at half-step values so every segment keeps the same width.
 */
export function thermalDialAngleFor(value: number, setPoint: number): number {
  const dialValue = Math.max(THERMAL_DIAL_MIN, Math.min(THERMAL_DIAL_MAX, value))
  const setPointStep = discreteSetPoint(setPoint)
  return (dialValue - setPointStep) * THERMAL_ANGLE_STEP
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
  const step = discreteThermalValue(value)
  if (step <= -4 || step >= 4) return 'extreme'
  if (step === -3) return 'cold-3'
  if (step === -2) return 'cold-2'
  if (step === -1) return 'cold-1'
  if (step === 0) return 'neutral'
  if (step === 1) return 'hot-1'
  if (step === 2) return 'hot-2'
  return 'hot-3'
}
