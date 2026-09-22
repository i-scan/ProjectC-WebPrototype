import {
  DEFAULT_THERMAL_IMPULSES,
  THERMAL_ACTIONS,
  normalizeThermalConfig,
  normalizeThermalState,
} from './thermal-clock-model.js'

export const THERMAL_INERTIAL_RULE = 'thermal-inertial-relaxation-v1-candidate'
export const THERMAL_INERTIAL_SOLVER = 'piecewise-analytic-inertial-relaxation-v1'
export const THERMAL_INERTIAL_INPUT_RULE = 'sustained-drive-plus-deposit-v1'

export const DEFAULT_INERTIAL_CONFIG = Object.freeze({
  driftHalfLifeAt: 1,
  recoveryHalfLifeAt: 3,
})

export const DRIFT_HALF_LIFE_PRESETS = Object.freeze([0.5, 1, 1.5])
export const RECOVERY_HALF_LIFE_PRESETS = Object.freeze([2, 3, 4])

const EPS = 1e-8
const LN2 = Math.log(2)
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export function normalizeInertialConfig(input = {}) {
  return {
    driftHalfLifeAt: Math.max(0.05, finite(input.driftHalfLifeAt, DEFAULT_INERTIAL_CONFIG.driftHalfLifeAt)),
    recoveryHalfLifeAt: Math.max(0.05, finite(input.recoveryHalfLifeAt, DEFAULT_INERTIAL_CONFIG.recoveryHalfLifeAt)),
  }
}

export function inertialCoefficients(input = {}) {
  const config = normalizeInertialConfig(input)
  return {
    ...config,
    lambdaD: LN2 / config.driftHalfLifeAt,
    kR: LN2 / config.recoveryHalfLifeAt,
  }
}

export function inertialActionDriveRate(actionId, strengths = DEFAULT_THERMAL_IMPULSES) {
  const action = THERMAL_ACTIONS.find((entry) => entry.id === actionId) ?? THERMAL_ACTIONS.at(-1)
  if (!action || action.sign === 0) return 0
  const fallback = DEFAULT_THERMAL_IMPULSES[action.size] ?? 0
  return action.sign * Math.abs(finite(strengths?.[action.size], fallback))
}

export function inertialNetRate(inputState, inputThermalConfig, inputInertialConfig) {
  const state = normalizeThermalState(inputState)
  const thermalConfig = normalizeThermalConfig(inputThermalConfig)
  const { kR } = inertialCoefficients(inputInertialConfig)
  const recovery = kR * (state.setPoint - state.temperature)
  const environmentExchange = thermalConfig.environmentCoupling
    * (thermalConfig.environmentTemperature - state.temperature)
  return {
    drift: state.drift,
    recovery,
    environmentExchange,
    netRate: state.drift + recovery + environmentExchange,
  }
}

export function solveInertialSegment(inputState, inputThermalConfig, inputInertialConfig, durationAt, driveRate = 0) {
  const state = normalizeThermalState(inputState)
  const thermalConfig = normalizeThermalConfig(inputThermalConfig)
  const { lambdaD, kR } = inertialCoefficients(inputInertialConfig)
  const t = Math.max(0, finite(durationAt, 0))
  if (t <= EPS) return { ...state }

  const kE = thermalConfig.environmentCoupling
  const a = kR + kE
  const b = kR * state.setPoint + kE * thermalConfig.environmentTemperature
  const U = finite(driveRate, 0)

  const dInf = Math.abs(lambdaD) > EPS ? U / lambdaD : 0
  const driftOffset = state.drift - dInf
  const eD = Math.exp(-lambdaD * t)
  const drift = dInf + driftOffset * eD

  let temperature
  if (a <= EPS) {
    if (lambdaD <= EPS) {
      temperature = state.temperature + state.drift * t + 0.5 * U * t * t
    } else {
      temperature = state.temperature
        + dInf * t
        + driftOffset * (1 - eD) / lambdaD
    }
  } else {
    const equilibriumWithDrive = (dInf + b) / a
    if (Math.abs(a - lambdaD) <= 1e-7) {
      const eA = Math.exp(-a * t)
      temperature = equilibriumWithDrive
        + eA * ((state.temperature - equilibriumWithDrive) + driftOffset * t)
    } else {
      const q = driftOffset / (a - lambdaD)
      temperature = equilibriumWithDrive
        + (state.temperature - equilibriumWithDrive - q) * Math.exp(-a * t)
        + q * eD
    }
  }

  return {
    ...state,
    temperature: clamp(temperature, thermalConfig.clampMin, thermalConfig.clampMax),
    drift: Number.isFinite(drift) ? drift : 0,
  }
}

export function applyThermalDeposit(inputState, deposit, inputThermalConfig = {}) {
  const state = normalizeThermalState(inputState)
  const thermalConfig = normalizeThermalConfig(inputThermalConfig)
  return {
    ...state,
    temperature: clamp(
      state.temperature + finite(deposit, 0),
      thermalConfig.clampMin,
      thermalConfig.clampMax,
    ),
  }
}

function solveActionTo({
  source,
  thermalConfig,
  inertialConfig,
  driveRate,
  driveDurationAt,
  depositAt,
  deposit,
  durationAt,
}, requestedAt) {
  const targetAt = Math.max(0, finite(requestedAt, 0))
  const actionDuration = Math.max(0, finite(durationAt, 1))
  const actionTarget = Math.min(targetAt, actionDuration)
  const driveEnd = clamp(finite(driveDurationAt, actionDuration), 0, actionDuration)
  const hasDeposit = Math.abs(finite(deposit, 0)) > EPS && Number.isFinite(Number(depositAt))
  const depositTime = hasDeposit ? clamp(finite(depositAt, 0), 0, actionDuration) : null

  let cursor = 0
  let current = normalizeThermalState(source)
  let currentDrive = driveEnd > 0 ? finite(driveRate, 0) : 0
  const events = []
  if (depositTime !== null && depositTime <= actionTarget + EPS) events.push({ t: depositTime, type: 'deposit' })
  if (driveEnd > EPS && driveEnd < actionDuration - EPS && driveEnd <= actionTarget + EPS) events.push({ t: driveEnd, type: 'drive-end' })
  events.sort((a, b) => a.t - b.t || (a.type === 'deposit' ? -1 : 1))

  for (const event of events) {
    if (event.t > cursor + EPS) {
      current = solveInertialSegment(current, thermalConfig, inertialConfig, event.t - cursor, currentDrive)
      cursor = event.t
    }
    if (event.type === 'deposit') current = applyThermalDeposit(current, deposit, thermalConfig)
    if (event.type === 'drive-end') currentDrive = 0
  }

  if (actionTarget > cursor + EPS) {
    current = solveInertialSegment(current, thermalConfig, inertialConfig, actionTarget - cursor, currentDrive)
    cursor = actionTarget
  }

  if (targetAt > actionDuration + EPS) {
    current = solveInertialSegment(current, thermalConfig, inertialConfig, targetAt - actionDuration, 0)
  }

  return { ...current, worldAt: normalizeThermalState(source).worldAt + targetAt }
}

export function buildInertialActionPlan({
  state,
  thermalConfig,
  inertialConfig = DEFAULT_INERTIAL_CONFIG,
  actionId = 'skip',
  strengths = DEFAULT_THERMAL_IMPULSES,
  durationAt = 1,
  horizonAt = 4,
  driveDurationAt = 1,
  depositAt = 0.5,
  deposit = 0,
  samplesPerAt = 32,
} = {}) {
  const source = normalizeThermalState(state)
  const config = normalizeThermalConfig(thermalConfig)
  const inertial = normalizeInertialConfig(inertialConfig)
  const duration = Math.max(0, finite(durationAt, 1))
  const horizon = Math.max(duration, finite(horizonAt, 4))
  const driveRate = inertialActionDriveRate(actionId, strengths)
  const driveDuration = actionId === 'skip'
    ? 0
    : clamp(finite(driveDurationAt, duration), 0, duration)
  const depositValue = finite(deposit, 0)
  const depositTime = clamp(finite(depositAt, duration / 2), 0, duration)

  const definition = {
    source,
    thermalConfig: config,
    inertialConfig: inertial,
    driveRate,
    driveDurationAt: driveDuration,
    depositAt: depositTime,
    deposit: depositValue,
    durationAt: duration,
  }
  const finalState = solveActionTo(definition, duration)
  const count = Math.max(2, Math.round(horizon * Math.max(4, finite(samplesPerAt, 32))))
  const path = Array.from({ length: count + 1 }, (_, index) => {
    const relativeAt = horizon * (index / count)
    const sample = solveActionTo(definition, relativeAt)
    return { ...sample, at: source.worldAt + relativeAt, relativeAt }
  })
  const ghosts = []
  for (let offset = 1; offset <= Math.floor(horizon + EPS); offset += 1) {
    const sample = solveActionTo(definition, offset)
    ghosts.push({ ...sample, at: source.worldAt + offset, offset })
  }

  const events = []
  if (Math.abs(driveRate) > EPS && driveDuration > 0) {
    events.push({ type: 'DriveStart', t: 0, rate: driveRate })
    events.push({ type: 'DriveEnd', t: driveDuration, rate: driveRate })
  }
  if (Math.abs(depositValue) > EPS) events.push({ type: 'Deposit', t: depositTime, amount: depositValue })
  events.sort((a, b) => a.t - b.t)

  return {
    rule: THERMAL_INERTIAL_RULE,
    solver: THERMAL_INERTIAL_SOLVER,
    inputRule: THERMAL_INERTIAL_INPUT_RULE,
    actionId,
    durationAt: duration,
    horizonAt: horizon,
    source,
    thermalConfig: config,
    inertialConfig: inertial,
    driveRate,
    driveDurationAt: driveDuration,
    depositAt: depositTime,
    deposit: depositValue,
    events,
    path,
    ghosts,
    finalState,
    diagnostics: inertialDiagnostics(source, config, inertial, driveRate),
  }
}

export function sampleInertialActionPlan(plan, at) {
  if (!plan) return null
  return solveActionTo({
    source: plan.source,
    thermalConfig: plan.thermalConfig,
    inertialConfig: plan.inertialConfig,
    driveRate: plan.driveRate,
    driveDurationAt: plan.driveDurationAt,
    depositAt: plan.depositAt,
    deposit: plan.deposit,
    durationAt: plan.durationAt,
  }, at)
}

export function inertialDiagnostics(inputState, inputThermalConfig, inputInertialConfig, driveRate = 0) {
  const state = normalizeThermalState(inputState)
  const thermalConfig = normalizeThermalConfig(inputThermalConfig)
  const coefficients = inertialCoefficients(inputInertialConfig)
  const rates = inertialNetRate(state, thermalConfig, inputInertialConfig)
  const kE = thermalConfig.environmentCoupling
  const denominator = coefficients.kR + kE
  const equilibriumTemperature = denominator > EPS
    ? (coefficients.kR * state.setPoint + kE * thermalConfig.environmentTemperature) / denominator
    : null
  return {
    ...coefficients,
    ...rates,
    kE,
    adiabatic: kE <= EPS,
    regime: 'inertial-relaxation',
    equilibriumTemperature,
    driveRate: finite(driveRate, 0),
    environmentDampingIgnored: true,
  }
}

export function nextInertialApexAt({
  state,
  thermalConfig,
  inertialConfig = DEFAULT_INERTIAL_CONFIG,
  driveRate = 0,
  horizonAt = 12,
} = {}) {
  const source = normalizeThermalState(state)
  const horizon = Math.max(0, finite(horizonAt, 12))
  const rateAt = (at) => {
    const sample = solveInertialSegment(source, thermalConfig, inertialConfig, at, driveRate)
    return inertialNetRate(sample, thermalConfig, inertialConfig).netRate
  }

  let previousAt = 0
  let previousRate = rateAt(0)
  for (let index = 1; index <= 240; index += 1) {
    const at = horizon * index / 240
    const rate = rateAt(at)
    if (Math.abs(rate) <= 1e-6 && at > 1e-5) return at
    if (previousAt > 1e-5 && Math.sign(rate) !== Math.sign(previousRate)) {
      let lo = previousAt
      let hi = at
      let loRate = previousRate
      for (let iteration = 0; iteration < 30; iteration += 1) {
        const mid = (lo + hi) / 2
        const midRate = rateAt(mid)
        if (Math.abs(midRate) <= 1e-8) return mid
        if (Math.sign(midRate) === Math.sign(loRate)) {
          lo = mid
          loRate = midRate
        } else {
          hi = mid
        }
      }
      return (lo + hi) / 2
    }
    previousAt = at
    previousRate = rate
  }
  return null
}
