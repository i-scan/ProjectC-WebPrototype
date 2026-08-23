export const THERMAL_PERIOD_AT = 8
export const THERMAL_HALF_PERIOD_AT = THERMAL_PERIOD_AT / 2
export const THERMAL_DISPLAY_MIN = -4
export const THERMAL_DISPLAY_MAX = 4
export const THERMAL_SET_POINT = 1
export const THERMAL_DRIFT_VISUAL_MAX = 3

const DAMPING = 1
const BEHAVIOR_DRIFT_IMPULSE = 0.8
const BALANCING_DRIFT_RETENTION = 0.35
const DAMPING_ALPHA = DAMPING * 0.5
const DAMPED_OMEGA = Math.PI * 2 / THERMAL_PERIOD_AT
const NATURAL_OMEGA_SQUARED = DAMPED_OMEGA * DAMPED_OMEGA + DAMPING_ALPHA * DAMPING_ALPHA

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const lerp = (a, b, t) => a + (b - a) * t
const smoothstep = (t) => t * t * (3 - 2 * t)

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

function analyticThermalAt(initial, durationAt) {
  const duration = Math.max(0, durationAt)
  if (duration <= 0) return { ...initial }

  // Solve x'' + DAMPING*x' + w0^2*x = 0 directly.
  // DAMPED_OMEGA is defined from the visible period, therefore the oscillatory
  // component completes exactly one cycle every THERMAL_PERIOD_AT regardless
  // of browser frame rate or playback sampling frequency.
  const offset0 = initial.temperature - initial.setPoint
  const drift0 = initial.drift
  const a = offset0
  const b = (drift0 + DAMPING_ALPHA * offset0) / DAMPED_OMEGA
  const phase = DAMPED_OMEGA * duration
  const cos = Math.cos(phase)
  const sin = Math.sin(phase)
  const envelope = Math.exp(-DAMPING_ALPHA * duration)
  const bracket = a * cos + b * sin
  const offset = envelope * bracket
  const drift = envelope * (
    (-DAMPING_ALPHA * a + DAMPED_OMEGA * b) * cos
    + (-DAMPING_ALPHA * b - DAMPED_OMEGA * a) * sin
  )

  return settleThermal({
    temperature: clamp(initial.setPoint + offset, -6, 6),
    drift,
    setPoint: initial.setPoint,
  })
}

export function advanceThermal(input, behavior, deltaAt = 1) {
  const duration = Math.max(0, deltaAt)
  if (duration <= 0) return { ...input }
  return analyticThermalAt(applyBehaviorImpulse(input, behavior), duration)
}

export function sampleThermalTransition(input, behavior, progressAt) {
  const progress = clamp(progressAt, 0, 1)
  if (progress <= 0) return { ...input }
  return analyticThermalAt(applyBehaviorImpulse(input, behavior), progress)
}

// Runtime state still uses the analytic thermal solver above. During a visible
// 1 AT action, however, the pendulum should communicate one continuous segment
// of the 8 AT clock rather than visibly reach a solver turning point and swing
// back inside the same action playback. Interpolate only the presentation from
// the committed start state to the already-solved final state.
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

export const THERMAL_MODEL = Object.freeze({
  damping: DAMPING,
  dampedOmega: DAMPED_OMEGA,
  naturalOmegaSquared: NATURAL_OMEGA_SQUARED,
  sampling: 'analytic',
})
