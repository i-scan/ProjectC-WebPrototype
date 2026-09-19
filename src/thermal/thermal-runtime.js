import {
  applyThermalImpulse,
  solveThermalSegment,
  thermalDiagnostics,
} from '../labs/thermal/thermal-clock-model.js'
import {
  cloneThermalProfile,
  resolveThermalAction,
  thermalConfigFromProfile,
} from './thermal-profile.js'

export const SHARED_THERMAL_RUNTIME = 'shared-thermal-profile-runtime-v1-candidate'

export function resolveThermalStep({
  state,
  profile,
  actionId = 'skip',
  environmentId = 'adiabatic',
  durationAt = 1,
} = {}) {
  const profileSnapshot = cloneThermalProfile(profile)
  const action = resolveThermalAction(profileSnapshot, actionId)
  const config = thermalConfigFromProfile(profileSnapshot, environmentId)
  const afterImpulse = applyThermalImpulse(state, action.impulse)
  const solved = solveThermalSegment(afterImpulse, config, durationAt)
  return {
    runtime: SHARED_THERMAL_RUNTIME,
    profileSnapshot,
    profileId: profileSnapshot.id,
    profileRevision: profileSnapshot.revision,
    action,
    config,
    afterImpulse,
    finalState: {
      ...solved,
      worldAt: Number(state?.worldAt || 0) + durationAt,
    },
    diagnostics: thermalDiagnostics(state, config),
  }
}


export function resolveThermalImpulseStep({
  state,
  profile,
  impulse = 0,
  sourceId = 'gameplay-momentum-event',
  environmentId = 'adiabatic',
  durationAt = 1,
} = {}) {
  const profileSnapshot = cloneThermalProfile(profile)
  const config = thermalConfigFromProfile(profileSnapshot, environmentId)
  const resolvedImpulse = Number.isFinite(Number(impulse)) ? Number(impulse) : 0
  const afterImpulse = applyThermalImpulse(state, resolvedImpulse)
  const solved = solveThermalSegment(afterImpulse, config, durationAt)
  return {
    runtime: SHARED_THERMAL_RUNTIME,
    profileSnapshot,
    profileId: profileSnapshot.id,
    profileRevision: profileSnapshot.revision,
    action: {
      id: sourceId,
      label: sourceId,
      sign: Math.sign(resolvedImpulse),
      tier: null,
      impulse: resolvedImpulse,
      profileId: profileSnapshot.id,
      profileRevision: profileSnapshot.revision,
    },
    config,
    afterImpulse,
    finalState: {
      ...solved,
      worldAt: Number(state?.worldAt || 0) + durationAt,
    },
    diagnostics: thermalDiagnostics(state, config),
  }
}
