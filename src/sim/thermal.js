export const THERMAL_PERIOD_AT = 8
export const THERMAL_HALF_PERIOD_AT = THERMAL_PERIOD_AT / 2
export const THERMAL_PERIOD_OPTIONS = Object.freeze([4, 6, 8, 10, 12])
export const THERMAL_DISPLAY_MIN = -4
export const THERMAL_DISPLAY_MAX = 4
export const THERMAL_SET_POINT = 1
export const THERMAL_DRIFT_VISUAL_MAX = 3

const DAMPING = 1
const BEHAVIOR_DRIFT_IMPULSE = 0.8
const BALANCING_DRIFT_RETENTION = 0.35
const DAMPING_ALPHA = DAMPING * 0.5

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const lerp = (a, b, t) => a + (b - a) * t
const smoothstep = (t) => t * t * (3 - 2 * t)

export function normalizeThermalPeriodAt(value) {
  if (!Number.isFinite(value)) return THERMAL_PERIOD_AT
  return clamp(value, 2, 24)
}

function oscillatorFor(periodAt = THERMAL_PERIOD_AT) {
  const period = normalizeThermalPeriodAt(periodAt)
  const dampedOmega = Math.PI * 2 / period
  return {
    period,
    dampedOmega,
    naturalOmegaSquared: dampedOmega * dampedOmega + DAMPING_ALPHA * DAMPING_ALPHA,
  }
}

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

function applyBehaviorImpulse(input, behavior) {
  const next = { ...input }
  if (behavior === 'generate' || behavior === 'resist') next.drift += BEHAVIOR_DRIFT_IMPULSE
  else if (behavior === 'use') next.drift -= BEHAVIOR_DRIFT_IMPULSE
  else if (behavior === 'passive-dissipation') next.drift *= BALANCING_DRIFT_RETENTION
  return next
}

function settleThermal(next) {
  if (Math.abs(next.temperature - next.setPoint) <= 0.025 && Math.abs(next.drift) <= 0.025) {
    next.temperature = next.setPoint
    next.drift = 0
  }
  return next
}

function analyticThermalAt(initial, durationAt, periodAt = THERMAL_PERIOD_AT) {
  const duration = Math.max(0, durationAt)
  if (duration <= 0) return { ...initial }

  // Solve x'' + DAMPING*x' + w0^2*x = 0 directly. The oscillatory period is
  // supplied by the prototype control rather than being hard-wired to 8 AT.
  const oscillator = oscillatorFor(periodAt)
  const offset0 = initial.temperature - initial.setPoint
  const drift0 = initial.drift
  const a = offset0
  const b = (drift0 + DAMPING_ALPHA * offset0) / oscillator.dampedOmega
  const phase = oscillator.dampedOmega * duration
  const cos = Math.cos(phase)
  const sin = Math.sin(phase)
  const envelope = Math.exp(-DAMPING_ALPHA * duration)
  const bracket = a * cos + b * sin
  const offset = envelope * bracket
  const drift = envelope * (
    (-DAMPING_ALPHA * a + oscillator.dampedOmega * b) * cos
    + (-DAMPING_ALPHA * b - oscillator.dampedOmega * a) * sin
  )

  return settleThermal({
    temperature: clamp(initial.setPoint + offset, -6, 6),
    drift,
    setPoint: initial.setPoint,
  })
}

export function advanceThermal(input, behavior, deltaAt = 1, periodAt = THERMAL_PERIOD_AT) {
  const duration = Math.max(0, deltaAt)
  if (duration <= 0) return { ...input }
  return analyticThermalAt(applyBehaviorImpulse(input, behavior), duration, periodAt)
}

export function sampleThermalTransition(input, behavior, progressAt, periodAt = THERMAL_PERIOD_AT) {
  const progress = clamp(progressAt, 0, 1)
  if (progress <= 0) return { ...input }
  return analyticThermalAt(applyBehaviorImpulse(input, behavior), progress, periodAt)
}

// Runtime state still uses the analytic thermal solver above. During a visible
// 1 AT action, however, the pendulum communicates one continuous segment of the
// selected Thermal clock rather than visibly reversing inside the same playback.
export function interpolateThermalVisual(start, end, progressAt) {
  const progress = smoothstep(clamp(progressAt, 0, 1))
  return {
    temperature: lerp(start.temperature, end.temperature, progress),
    drift: lerp(start.drift, end.drift, progress),
    setPoint: lerp(start.setPoint, end.setPoint, progress),
  }
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

const defaultOscillator = oscillatorFor(THERMAL_PERIOD_AT)
export const THERMAL_MODEL = Object.freeze({
  damping: DAMPING,
  dampedOmega: defaultOscillator.dampedOmega,
  naturalOmegaSquared: defaultOscillator.naturalOmegaSquared,
  sampling: 'analytic',
  configurablePeriod: true,
})
