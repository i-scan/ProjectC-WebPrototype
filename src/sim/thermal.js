export const THERMAL_PERIOD_AT = 8
export const THERMAL_HALF_PERIOD_AT = THERMAL_PERIOD_AT / 2
export const THERMAL_DISPLAY_MIN = -4
export const THERMAL_DISPLAY_MAX = 4
export const THERMAL_SET_POINT = 1
export const THERMAL_DRIFT_VISUAL_MAX = 3

const DAMPING = 1
const SUBSTEPS_PER_AT = 24
const BEHAVIOR_DRIFT_IMPULSE = 0.8
const BALANCING_DRIFT_RETENTION = 0.35
const TARGET_DAMPED_OMEGA = Math.PI * 2 / THERMAL_PERIOD_AT
const NATURAL_OMEGA = Math.sqrt(TARGET_DAMPED_OMEGA * TARGET_DAMPED_OMEGA + (DAMPING * 0.5) ** 2)

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export function createInitialThermalState() {
  return { temperature: 1, drift: 0, setPoint: THERMAL_SET_POINT }
}

export function thermalDomainFor(temperature) {
  if (temperature <= -3) return 'COLD'
  if (temperature >= 3) return 'HOT'
  return 'NEUTRAL'
}

export function thermalBehaviorFor({ actionId, beforeSpeed, collisions = 0 }) {
  if (collisions > 0) return 'resist'
  if (actionId === 'coast') return beforeSpeed > 0.18 ? 'use' : 'passive-dissipation'
  if (actionId === 'hard-turn' || actionId === 'counter') return 'resist'
  if (beforeSpeed <= 0.18) return 'generate'
  return 'use'
}

export function advanceThermal(input, behavior, deltaAt = 1) {
  const next = { ...input }
  if (behavior === 'generate' || behavior === 'resist') next.drift += BEHAVIOR_DRIFT_IMPULSE
  else if (behavior === 'use') next.drift -= BEHAVIOR_DRIFT_IMPULSE
  else if (behavior === 'passive-dissipation') next.drift *= BALANCING_DRIFT_RETENTION

  const duration = Math.max(0, deltaAt)
  const substeps = Math.max(1, Math.ceil(duration * SUBSTEPS_PER_AT))
  const dt = duration / substeps
  for (let index = 0; index < substeps; index += 1) {
    const offset = next.temperature - next.setPoint
    const acceleration = -NATURAL_OMEGA * NATURAL_OMEGA * offset - DAMPING * next.drift
    next.drift += acceleration * dt
    next.temperature = clamp(next.temperature + next.drift * dt, -6, 6)
  }
  if (Math.abs(next.temperature - next.setPoint) <= 0.025 && Math.abs(next.drift) <= 0.025) {
    next.temperature = next.setPoint
    next.drift = 0
  }
  return next
}

export function sampleThermalTransition(input, behavior, progressAt) {
  const progress = clamp(progressAt, 0, 1)
  if (progress <= 0) return { ...input }
  return advanceThermal(input, behavior, progress)
}

export function thermalZoneClass(value) {
  const step = Math.round(clamp(value, THERMAL_DISPLAY_MIN, THERMAL_DISPLAY_MAX))
  if (step <= -4 || step >= 4) return 'extreme'
  if (step === -3) return 'cold-3'
  if (step === -2) return 'cold-2'
  if (step === -1) return 'cold-1'
  if (step === 0) return 'neutral'
  if (step === 1) return 'hot-1'
  if (step === 2) return 'hot-2'
  return 'hot-3'
}

export function thermalAngleFor(value, setPoint = THERMAL_SET_POINT) {
  const temperature = clamp(Number.isFinite(value) ? value : setPoint, THERMAL_DISPLAY_MIN, THERMAL_DISPLAY_MAX)
  return clamp((temperature - setPoint) * 12, -84, 84)
}

export function thermalDialAngleFor(value, setPoint = THERMAL_SET_POINT) {
  return (value - setPoint) * 12
}

export function thermalDriftProjectionFor(value, setPoint, drift) {
  const startAngle = thermalAngleFor(value, setPoint)
  const direction = drift > 0.001 ? 'hot' : drift < -0.001 ? 'cold' : 'still'
  const magnitude = direction === 'still' ? 0 : Math.min(1, Math.abs(drift) / THERMAL_DRIFT_VISUAL_MAX)
  const desiredAngle = direction === 'still' ? startAngle : startAngle + Math.sign(drift) * (10 + magnitude * 28)
  const minAngle = thermalAngleFor(THERMAL_DISPLAY_MIN, setPoint)
  const maxAngle = thermalAngleFor(THERMAL_DISPLAY_MAX, setPoint)
  const endAngle = clamp(desiredAngle, minAngle, maxAngle)
  return { direction, magnitude, startAngle, endAngle, displayedAngle: endAngle - startAngle, clipped: Math.abs(endAngle - desiredAngle) > 0.001 }
}

export function formatThermal(value, digits = 1) {
  const rounded = Number(value.toFixed(digits))
  return rounded > 0 ? `+${rounded.toFixed(digits)}` : rounded.toFixed(digits)
}
