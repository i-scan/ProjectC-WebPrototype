export const THERMAL_PROFILE_SCHEMA_VERSION = 1
export const THERMAL_PROFILE_STORAGE_KEY = 'projectc.thermal-profile.draft.v1'

const ACTION_ORDER = ['heat-i', 'heat-ii', 'heat-iii', 'cool-i', 'cool-ii', 'cool-iii', 'skip']

export const BASELINE_THERMAL_PROFILE = Object.freeze({
  schemaVersion: THERMAL_PROFILE_SCHEMA_VERSION,
  id: 'thermal-baseline-a',
  label: 'Thermal Baseline A',
  revision: 1,
  solverVersion: 'piecewise-analytic-second-order-v1',
  dynamics: Object.freeze({
    restoringK: 0.25,
    baseDamping: 0.25,
    environmentDampingGain: 1,
    clampMin: -6,
    clampMax: 6,
  }),
  actorDefaults: Object.freeze({
    temperature: 1,
    drift: 0,
    setPoint: 1,
  }),
  impulseTiers: Object.freeze({
    small: 0.4,
    medium: 0.8,
    large: 1.6,
  }),
  actions: Object.freeze({
    'heat-i': Object.freeze({ id: 'heat-i', label: 'Heat I', sign: 1, tier: 'small' }),
    'heat-ii': Object.freeze({ id: 'heat-ii', label: 'Heat II', sign: 1, tier: 'medium' }),
    'heat-iii': Object.freeze({ id: 'heat-iii', label: 'Heat III', sign: 1, tier: 'large' }),
    'cool-i': Object.freeze({ id: 'cool-i', label: 'Cool I', sign: -1, tier: 'small' }),
    'cool-ii': Object.freeze({ id: 'cool-ii', label: 'Cool II', sign: -1, tier: 'medium' }),
    'cool-iii': Object.freeze({ id: 'cool-iii', label: 'Cool III', sign: -1, tier: 'large' }),
    skip: Object.freeze({ id: 'skip', label: 'Skip', sign: 0, tier: 'small' }),
  }),
  environments: Object.freeze({
    adiabatic: Object.freeze({ id: 'adiabatic', label: 'Adiabatic', environmentTemperature: 1, environmentCoupling: 0 }),
    'mild-cold': Object.freeze({ id: 'mild-cold', label: 'Mild Cold', environmentTemperature: -2, environmentCoupling: 0.1 }),
    'strong-cold': Object.freeze({ id: 'strong-cold', label: 'Strong Cold', environmentTemperature: -4, environmentCoupling: 0.3 }),
    'mild-hot': Object.freeze({ id: 'mild-hot', label: 'Mild Hot', environmentTemperature: 3, environmentCoupling: 0.1 }),
    'strong-hot': Object.freeze({ id: 'strong-hot', label: 'Strong Hot', environmentTemperature: 5, environmentCoupling: 0.3 }),
  }),
})

const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback

export function cloneThermalProfile(profile = BASELINE_THERMAL_PROFILE) {
  return JSON.parse(JSON.stringify(profile))
}

export function normalizeThermalProfile(input = BASELINE_THERMAL_PROFILE) {
  const baseline = BASELINE_THERMAL_PROFILE
  const profile = cloneThermalProfile(input)
  const min = numberOr(profile.dynamics?.clampMin, baseline.dynamics.clampMin)
  const max = numberOr(profile.dynamics?.clampMax, baseline.dynamics.clampMax)
  return {
    schemaVersion: THERMAL_PROFILE_SCHEMA_VERSION,
    id: String(profile.id || baseline.id),
    label: String(profile.label || baseline.label),
    revision: Math.max(1, Math.round(numberOr(profile.revision, baseline.revision))),
    solverVersion: String(profile.solverVersion || baseline.solverVersion),
    dynamics: {
      restoringK: Math.max(0, numberOr(profile.dynamics?.restoringK, baseline.dynamics.restoringK)),
      baseDamping: Math.max(0, numberOr(profile.dynamics?.baseDamping, baseline.dynamics.baseDamping)),
      environmentDampingGain: Math.max(0, numberOr(profile.dynamics?.environmentDampingGain, baseline.dynamics.environmentDampingGain)),
      clampMin: Math.min(min, max - 0.001),
      clampMax: Math.max(max, min + 0.001),
    },
    actorDefaults: {
      temperature: numberOr(profile.actorDefaults?.temperature, baseline.actorDefaults.temperature),
      drift: numberOr(profile.actorDefaults?.drift, baseline.actorDefaults.drift),
      setPoint: numberOr(profile.actorDefaults?.setPoint, baseline.actorDefaults.setPoint),
    },
    impulseTiers: {
      small: Math.max(0, numberOr(profile.impulseTiers?.small, baseline.impulseTiers.small)),
      medium: Math.max(0, numberOr(profile.impulseTiers?.medium, baseline.impulseTiers.medium)),
      large: Math.max(0, numberOr(profile.impulseTiers?.large, baseline.impulseTiers.large)),
    },
    actions: cloneThermalProfile(profile.actions || baseline.actions),
    environments: cloneThermalProfile(profile.environments || baseline.environments),
  }
}

export function thermalActionList(profile = BASELINE_THERMAL_PROFILE) {
  const normalized = normalizeThermalProfile(profile)
  return ACTION_ORDER.map((id) => normalized.actions[id]).filter(Boolean)
}

export function thermalImpulsesFromProfile(profile = BASELINE_THERMAL_PROFILE) {
  return { ...normalizeThermalProfile(profile).impulseTiers }
}

export function thermalStateFromProfile(profile = BASELINE_THERMAL_PROFILE, worldAt = 0) {
  const defaults = normalizeThermalProfile(profile).actorDefaults
  return { worldAt, temperature: defaults.temperature, drift: defaults.drift, setPoint: defaults.setPoint }
}

export function thermalEnvironment(profile = BASELINE_THERMAL_PROFILE, environmentId = 'adiabatic') {
  const normalized = normalizeThermalProfile(profile)
  return normalized.environments[environmentId] || normalized.environments.adiabatic
}

export function thermalConfigFromProfile(profile = BASELINE_THERMAL_PROFILE, environmentId = 'adiabatic') {
  const normalized = normalizeThermalProfile(profile)
  const environment = thermalEnvironment(normalized, environmentId)
  return {
    restoringK: normalized.dynamics.restoringK,
    baseDamping: normalized.dynamics.baseDamping,
    environmentTemperature: environment.environmentTemperature,
    environmentCoupling: environment.environmentCoupling,
    environmentDampingGain: normalized.dynamics.environmentDampingGain,
    clampMin: normalized.dynamics.clampMin,
    clampMax: normalized.dynamics.clampMax,
  }
}

export function resolveThermalAction(profile = BASELINE_THERMAL_PROFILE, actionId = 'skip') {
  const normalized = normalizeThermalProfile(profile)
  const action = normalized.actions[actionId] || normalized.actions.skip
  const tierValue = normalized.impulseTiers[action.tier] ?? 0
  return {
    ...action,
    impulse: action.sign === 0 ? 0 : action.sign * tierValue,
    profileId: normalized.id,
    profileRevision: normalized.revision,
  }
}

export function withThermalTuning(profile, { config, impulses } = {}) {
  const normalized = normalizeThermalProfile(profile)
  const next = cloneThermalProfile(normalized)
  if (config) {
    next.dynamics.restoringK = Math.max(0, numberOr(config.restoringK, next.dynamics.restoringK))
    next.dynamics.baseDamping = Math.max(0, numberOr(config.baseDamping, next.dynamics.baseDamping))
    next.dynamics.environmentDampingGain = Math.max(0, numberOr(config.environmentDampingGain, next.dynamics.environmentDampingGain))
    next.dynamics.clampMin = numberOr(config.clampMin, next.dynamics.clampMin)
    next.dynamics.clampMax = numberOr(config.clampMax, next.dynamics.clampMax)
  }
  if (impulses) {
    next.impulseTiers.small = Math.max(0, numberOr(impulses.small, next.impulseTiers.small))
    next.impulseTiers.medium = Math.max(0, numberOr(impulses.medium, next.impulseTiers.medium))
    next.impulseTiers.large = Math.max(0, numberOr(impulses.large, next.impulseTiers.large))
  }
  return normalizeThermalProfile(next)
}
