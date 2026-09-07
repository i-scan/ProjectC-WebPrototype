export const THERMAL_CLOCK_RULE = 'thermal-clock-continuous-v0-candidate'
export const THERMAL_CLOCK_SOLVER = 'piecewise-analytic-second-order-v1'
export const THERMAL_CLOCK_AT_RULE = 'global-continuous-at-v1'
export const THERMAL_CLOCK_PREVIEW_RULE = 'preview-commit-shared-solver-v1'
export const THERMAL_CLOCK_GHOST_RULE = 'integer-at-analytic-ghosts-v1'

export const DEFAULT_THERMAL_STATE = Object.freeze({
  worldAt: 0,
  temperature: 1,
  drift: 0,
  setPoint: 1,
})

export const DEFAULT_THERMAL_CONFIG = Object.freeze({
  restoringK: 0.25,
  baseDamping: 0.25,
  environmentTemperature: 1,
  environmentCoupling: 0,
  environmentDampingGain: 1,
  clampMin: -6,
  clampMax: 6,
})

export const DEFAULT_THERMAL_IMPULSES = Object.freeze({ small: 0.4, medium: 0.8, large: 1.6 })
export const THERMAL_PREVIEW_HORIZONS = Object.freeze([4, 8, 12])
export const THERMAL_ACTIONS = Object.freeze([
  { id: 'heat-i', label: 'Heat I', sign: 1, size: 'small' },
  { id: 'heat-ii', label: 'Heat II', sign: 1, size: 'medium' },
  { id: 'heat-iii', label: 'Heat III', sign: 1, size: 'large' },
  { id: 'cool-i', label: 'Cool I', sign: -1, size: 'small' },
  { id: 'cool-ii', label: 'Cool II', sign: -1, size: 'medium' },
  { id: 'cool-iii', label: 'Cool III', sign: -1, size: 'large' },
  { id: 'skip', label: 'Skip', sign: 0, size: 'small' },
])

const EPS = 1e-7
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

export function normalizeThermalState(state = {}) {
  return {
    worldAt: finite(state.worldAt, DEFAULT_THERMAL_STATE.worldAt),
    temperature: finite(state.temperature, DEFAULT_THERMAL_STATE.temperature),
    drift: finite(state.drift, DEFAULT_THERMAL_STATE.drift),
    setPoint: finite(state.setPoint, DEFAULT_THERMAL_STATE.setPoint),
  }
}

export function normalizeThermalConfig(config = {}) {
  let clampMin = finite(config.clampMin, DEFAULT_THERMAL_CONFIG.clampMin)
  let clampMax = finite(config.clampMax, DEFAULT_THERMAL_CONFIG.clampMax)
  if (clampMin > clampMax) [clampMin, clampMax] = [clampMax, clampMin]
  if (Math.abs(clampMax - clampMin) < EPS) clampMax = clampMin + 0.001
  return {
    restoringK: Math.max(0, finite(config.restoringK, DEFAULT_THERMAL_CONFIG.restoringK)),
    baseDamping: Math.max(0, finite(config.baseDamping, DEFAULT_THERMAL_CONFIG.baseDamping)),
    environmentTemperature: finite(config.environmentTemperature, DEFAULT_THERMAL_CONFIG.environmentTemperature),
    environmentCoupling: Math.max(0, finite(config.environmentCoupling, DEFAULT_THERMAL_CONFIG.environmentCoupling)),
    environmentDampingGain: Math.max(0, finite(config.environmentDampingGain, DEFAULT_THERMAL_CONFIG.environmentDampingGain)),
    clampMin,
    clampMax,
  }
}

export function thermalDiagnostics(state, config) {
  const normalizedState = normalizeThermalState(state)
  const normalizedConfig = normalizeThermalConfig(config)
  const K = normalizedConfig.restoringK + normalizedConfig.environmentCoupling
  const cEff = normalizedConfig.baseDamping + normalizedConfig.environmentDampingGain * normalizedConfig.environmentCoupling
  const discriminant = cEff * cEff - 4 * K
  let regime = 'free'
  if (K > EPS) {
    if (discriminant < -EPS) regime = 'underdamped'
    else if (discriminant > EPS) regime = 'overdamped'
    else regime = 'critical'
  } else if (cEff > EPS) {
    regime = 'free-damped'
  }

  const equilibriumTemperature = K > EPS
    ? (normalizedConfig.restoringK * normalizedState.setPoint
      + normalizedConfig.environmentCoupling * normalizedConfig.environmentTemperature) / K
    : null

  const adiabatic = normalizedConfig.environmentCoupling <= EPS
  let dampedPeriodAt = null
  let amplitudeDecayPerCycle = null
  if (regime === 'underdamped') {
    const omegaD = Math.sqrt(Math.max(0, 4 * K - cEff * cEff)) / 2
    dampedPeriodAt = omegaD > EPS ? (Math.PI * 2) / omegaD : null
    amplitudeDecayPerCycle = dampedPeriodAt ? Math.exp(-(cEff / 2) * dampedPeriodAt) : null
  }

  return {
    K,
    cEff,
    discriminant,
    regime,
    equilibriumTemperature,
    adiabatic,
    dampedPeriodAt,
    amplitudeDecayPerCycle,
  }
}

function solvedResult(state, temperature, drift, config) {
  const normalizedConfig = normalizeThermalConfig(config)
  return {
    ...normalizeThermalState(state),
    temperature: clamp(temperature, normalizedConfig.clampMin, normalizedConfig.clampMax),
    drift: Number.isFinite(drift) ? drift : 0,
  }
}

export function solveThermalSegment(inputState, inputConfig, durationAt) {
  const state = normalizeThermalState(inputState)
  const config = normalizeThermalConfig(inputConfig)
  const t = Math.max(0, finite(durationAt, 0))
  if (t <= EPS) return { ...state }

  const diagnostics = thermalDiagnostics(state, config)
  const { K, cEff, discriminant, equilibriumTemperature, regime } = diagnostics

  if (K <= EPS) {
    if (cEff <= EPS) return solvedResult(state, state.temperature + state.drift * t, state.drift, config)
    const decay = Math.exp(-cEff * t)
    const drift = state.drift * decay
    const temperature = state.temperature + state.drift * (1 - decay) / cEff
    return solvedResult(state, temperature, drift, config)
  }

  const x0 = state.temperature - equilibriumTemperature
  const v0 = state.drift
  let x
  let v

  if (regime === 'underdamped') {
    const alpha = cEff / 2
    const omega = Math.sqrt(Math.max(0, 4 * K - cEff * cEff)) / 2
    const a = x0
    const b = (v0 + alpha * x0) / omega
    const phase = omega * t
    const cos = Math.cos(phase)
    const sin = Math.sin(phase)
    const envelope = Math.exp(-alpha * t)
    x = envelope * (a * cos + b * sin)
    v = envelope * ((-alpha * a + omega * b) * cos + (-alpha * b - omega * a) * sin)
  } else if (regime === 'critical') {
    const r = -cEff / 2
    const b = v0 - r * x0
    const envelope = Math.exp(r * t)
    x = envelope * (x0 + b * t)
    v = envelope * (r * (x0 + b * t) + b)
  } else {
    const root = Math.sqrt(Math.max(0, discriminant))
    const r1 = (-cEff + root) / 2
    const r2 = (-cEff - root) / 2
    const denominator = r1 - r2
    if (Math.abs(denominator) <= EPS) {
      const r = -cEff / 2
      const b = v0 - r * x0
      const envelope = Math.exp(r * t)
      x = envelope * (x0 + b * t)
      v = envelope * (r * (x0 + b * t) + b)
    } else {
      const a = (v0 - r2 * x0) / denominator
      const b = x0 - a
      const e1 = Math.exp(r1 * t)
      const e2 = Math.exp(r2 * t)
      x = a * e1 + b * e2
      v = a * r1 * e1 + b * r2 * e2
    }
  }

  return solvedResult(state, equilibriumTemperature + x, v, config)
}

export function sampleThermalSegment(state, config, durationAt, sampleAt) {
  const duration = Math.max(0, finite(durationAt, 0))
  return solveThermalSegment(state, config, clamp(finite(sampleAt, 0), 0, duration))
}

export function applyThermalImpulse(inputState, impulse) {
  const state = normalizeThermalState(inputState)
  return { ...state, drift: state.drift + finite(impulse, 0) }
}

export function actionImpulse(actionId, impulses = DEFAULT_THERMAL_IMPULSES) {
  const action = THERMAL_ACTIONS.find((entry) => entry.id === actionId) ?? THERMAL_ACTIONS.at(-1)
  if (!action || action.sign === 0) return 0
  const magnitude = Math.abs(finite(impulses?.[action.size], DEFAULT_THERMAL_IMPULSES[action.size]))
  return action.sign * magnitude
}

export function solveThermalAction(inputState, inputConfig, actionId, impulses = DEFAULT_THERMAL_IMPULSES, durationAt = 1) {
  const state = normalizeThermalState(inputState)
  const impulse = actionImpulse(actionId, impulses)
  const afterImpulse = applyThermalImpulse(state, impulse)
  const finalState = solveThermalSegment(afterImpulse, inputConfig, durationAt)
  return {
    impulse,
    afterImpulse,
    finalState: { ...finalState, worldAt: state.worldAt + Math.max(0, finite(durationAt, 0)) },
  }
}

export function predictThermalAction({
  state,
  config,
  actionId = 'skip',
  impulses = DEFAULT_THERMAL_IMPULSES,
  durationAt = 1,
  horizonAt = 4,
  pathSamples = 48,
} = {}) {
  const normalizedState = normalizeThermalState(state)
  const normalizedConfig = normalizeThermalConfig(config)
  const impulse = actionImpulse(actionId, impulses)
  const afterImpulse = applyThermalImpulse(normalizedState, impulse)
  const duration = Math.max(0, finite(durationAt, 1))
  const horizon = Math.max(duration, finite(horizonAt, 4))
  const count = Math.max(2, Math.round(pathSamples))
  const path = Array.from({ length: count + 1 }, (_, index) => {
    const at = duration * (index / count)
    return { at, ...solveThermalSegment(afterImpulse, normalizedConfig, at) }
  })
  const ghosts = []
  for (let at = 1; at <= Math.floor(horizon + EPS); at += 1) {
    ghosts.push({ at, ...solveThermalSegment(afterImpulse, normalizedConfig, at) })
  }
  const final = solveThermalSegment(afterImpulse, normalizedConfig, duration)
  return {
    rule: THERMAL_CLOCK_PREVIEW_RULE,
    solver: THERMAL_CLOCK_SOLVER,
    actionId,
    impulse,
    durationAt: duration,
    horizonAt: horizon,
    path,
    ghosts,
    finalState: { ...final, worldAt: normalizedState.worldAt + duration },
    diagnostics: thermalDiagnostics(afterImpulse, normalizedConfig),
  }
}

function firstRootTime(state, config, fn, horizonAt = 12, steps = 240) {
  const horizon = Math.max(0, finite(horizonAt, 12))
  let previousAt = 0
  let previousValue = fn(solveThermalSegment(state, config, 0))
  for (let index = 1; index <= steps; index += 1) {
    const at = horizon * (index / steps)
    const value = fn(solveThermalSegment(state, config, at))
    if (Math.abs(value) <= 1e-5 && at > 1e-4) return at
    if (previousAt > 1e-5 && Math.sign(value) !== Math.sign(previousValue)) {
      let lo = previousAt
      let hi = at
      let flo = previousValue
      for (let iteration = 0; iteration < 28; iteration += 1) {
        const mid = (lo + hi) / 2
        const fmid = fn(solveThermalSegment(state, config, mid))
        if (Math.abs(fmid) <= 1e-7) return mid
        if (Math.sign(fmid) === Math.sign(flo)) {
          lo = mid
          flo = fmid
        } else {
          hi = mid
        }
      }
      return (lo + hi) / 2
    }
    previousAt = at
    previousValue = value
  }
  return null
}

export function thermalEventDiagnostics(state, config, horizonAt = 12) {
  const normalizedState = normalizeThermalState(state)
  const apexAt = firstRootTime(normalizedState, config, (sample) => sample.drift, horizonAt)
  const crossingAt = firstRootTime(normalizedState, config, (sample) => sample.temperature - normalizedState.setPoint, horizonAt)
  return { nextApexAt: apexAt, nextSetPointCrossingAt: crossingAt }
}

export function formatThermal(value, digits = 2) {
  if (!Number.isFinite(value)) return '—'
  const fixed = Number(value).toFixed(digits)
  return Number(value) > 0 ? `+${fixed}` : fixed
}
