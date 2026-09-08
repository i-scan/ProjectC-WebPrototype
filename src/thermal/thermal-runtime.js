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
