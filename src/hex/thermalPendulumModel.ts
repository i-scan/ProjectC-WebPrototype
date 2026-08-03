export const THERMAL_DISPLAY_MIN = -4
export const THERMAL_DISPLAY_MAX = 4
export const THERMAL_DIAL_MIN = -4.5
export const THERMAL_DIAL_MAX = 4.5
export const THERMAL_ANGLE_STEP = 12
export const THERMAL_SWING_ANGLE = 84
export const THERMAL_DRIFT_MAX = 3
export const THERMAL_DRIFT_ANGLE_PER_UNIT = THERMAL_ANGLE_STEP

export type ThermalDirection = 'cold' | 'still' | 'hot'

export type ThermalSlot = {
  temperature: number
  angle: number
  zoneClass: string
}

export type ThermalDriftVector = {
  direction: ThermalDirection
  magnitude: number
  angle: number
}

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
 * Discrete center angle for one absolute body-temperature slot. Set Point is
 * always at the physical lowest position (0 degrees). Every adjacent absolute
 * temperature occupies the same angular step.
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

/**
 * Single source of truth for the visible bob. Geometry and colour must both be
 * taken from this slot so a Set Point shift cannot mirror one without the other.
 */
export function thermalSlotFor(value: number, setPoint: number): ThermalSlot {
  const temperature = discreteThermalValue(value)
  return {
    temperature,
    angle: thermalAngleFor(temperature, setPoint),
    zoneClass: thermalZoneClass(temperature),
  }
}

export function thermalDirectionFor(momentum: number): ThermalDirection {
  if (momentum > 0.001) return 'hot'
  if (momentum < -0.001) return 'cold'
  return 'still'
}

/**
 * The current prototype treats momentum as the visible drift vector. One unit
 * of drift occupies the same angle as one temperature slot, capped at the
 * current debug range so the vector stays subordinate to the temperature dial.
 */
export function thermalDriftVectorFor(momentum: number): ThermalDriftVector {
  const safeMomentum = Number.isFinite(momentum) ? momentum : 0
  const direction = thermalDirectionFor(safeMomentum)
  const magnitude = direction === 'still'
    ? 0
    : Math.min(Math.abs(safeMomentum), THERMAL_DRIFT_MAX)

  return {
    direction,
    magnitude,
    angle: direction === 'still'
      ? 0
      : Math.sign(safeMomentum) * magnitude * THERMAL_DRIFT_ANGLE_PER_UNIT,
  }
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
