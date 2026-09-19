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

// Exact, queryable segments. Impulses at the same instant are applied in stable
// input order; temperature is continuous and drift is right-continuous.
export function thermalTimeline({ state, config, events = [], durationAt = 1 }) {
  const segments = []
  let current = { ...state }
  let currentConfig = { ...config }
  let cursor = 0
  const ordered = events.filter((event) => event.t >= 0 && event.t <= durationAt)
    .slice().sort((a, b) => a.t - b.t)
  for (const event of ordered) {
    if (event.t > cursor) {
      segments.push({ start: cursor, end: event.t, state: { ...current }, config: { ...currentConfig } })
      current = { ...solveThermalSegment(current, currentConfig, event.t - cursor), worldAt: (state.worldAt ?? 0) + event.t }
    }
    current = applyThermalImpulse(current, event.impulse ?? 0)
    if (event.config) currentConfig = { ...currentConfig, ...event.config }
    cursor = event.t
  }
  segments.push({ start: cursor, end: durationAt, state: { ...current }, config: { ...currentConfig } })
  const finalState = solveThermalSegment(current, currentConfig, durationAt - cursor)
  return { segments, finalState: { ...finalState, worldAt: (state.worldAt ?? 0) + durationAt } }
}

export function sampleThermalTimeline(segments, t) {
  const segment = segments.findLast((entry) => entry.start <= t) ?? segments[0]
  const duration = Math.max(0, Math.min(t, segment.end) - segment.start)
  return { ...solveThermalSegment(segment.state, segment.config, duration), worldAt: (segment.state.worldAt ?? 0) + duration }
}

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
