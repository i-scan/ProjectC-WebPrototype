import {
  applyThermalImpulse,
  solveThermalSegment,
  thermalDiagnostics,
} from '../labs/thermal/thermal-clock-model.js'
import {
  applyThermalDeposit,
  buildInertialActionPlan,
  inertialDiagnostics,
  solveInertialSegment,
} from '../labs/thermal/thermal-inertial-model.js'
import {
  cloneThermalProfile,
  resolveThermalAction,
  thermalConfigFromProfile,
  thermalDynamicsMode,
  thermalImpulsesFromProfile,
  thermalInertialConfigFromProfile,
} from './thermal-profile.js'

export const SHARED_THERMAL_RUNTIME = 'shared-thermal-dual-mode-runtime-v2-candidate'

const clampTime = (value, durationAt) => Math.max(0, Math.min(durationAt, Number(value) || 0))

function solveByMode(state, config, dynamicsMode, inertialConfig, durationAt, driveRate = 0) {
  if (dynamicsMode === 'inertial') {
    return solveInertialSegment(state, config, inertialConfig, durationAt, driveRate)
  }
  return solveThermalSegment(state, config, durationAt)
}

function diagnosticsByMode(state, config, dynamicsMode, inertialConfig, driveRate = 0) {
  return dynamicsMode === 'inertial'
    ? inertialDiagnostics(state, config, inertialConfig, driveRate)
    : thermalDiagnostics(state, config)
}

// One shared, exact, queryable timeline for both Thermal Clock and Gameplay.
// Legacy events use { impulse }. Inertial events use:
//   { driveDelta }  -> add/remove sustained Drive from this instant onward
//   { deposit }     -> instant Temperature change without changing Drift
// Config/inertialConfig changes are also piecewise and right-continuous.
export function thermalTimeline({
  state,
  config,
  events = [],
  durationAt = 1,
  dynamicsMode = 'oscillator',
  inertialConfig = null,
} = {}) {
  const duration = Math.max(0, Number(durationAt) || 0)
  const mode = dynamicsMode === 'inertial' ? 'inertial' : 'oscillator'
  const segments = []
  let current = { ...state }
  let currentConfig = { ...config }
  let currentInertial = { ...(inertialConfig ?? { driftHalfLifeAt: 1, recoveryHalfLifeAt: 3 }) }
  let currentDriveRate = 0
  let cursor = 0

  const ordered = events
    .map((event, index) => ({ ...event, __index: index, t: clampTime(event.t, duration) }))
    .sort((a, b) => a.t - b.t || a.__index - b.__index)

  const advanceTo = (nextAt) => {
    if (nextAt <= cursor) return
    segments.push({
      start: cursor,
      end: nextAt,
      state: { ...current },
      config: { ...currentConfig },
      dynamicsMode: mode,
      inertialConfig: { ...currentInertial },
      driveRate: currentDriveRate,
    })
    current = {
      ...solveByMode(current, currentConfig, mode, currentInertial, nextAt - cursor, currentDriveRate),
      worldAt: (state?.worldAt ?? 0) + nextAt,
    }
    cursor = nextAt
  }

  for (const event of ordered) {
    advanceTo(event.t)

    if (mode === 'inertial') {
      if (Number.isFinite(Number(event.deposit)) && Math.abs(Number(event.deposit)) > 0) {
        current = applyThermalDeposit(current, Number(event.deposit), currentConfig)
      }
      if (Number.isFinite(Number(event.driveDelta)) && Math.abs(Number(event.driveDelta)) > 0) {
        currentDriveRate += Number(event.driveDelta)
      }
    } else if (Number.isFinite(Number(event.impulse)) && Math.abs(Number(event.impulse)) > 0) {
      current = applyThermalImpulse(current, Number(event.impulse))
    }

    if (event.config) currentConfig = { ...currentConfig, ...event.config }
    if (event.inertialConfig) currentInertial = { ...currentInertial, ...event.inertialConfig }
  }

  segments.push({
    start: cursor,
    end: duration,
    state: { ...current },
    config: { ...currentConfig },
    dynamicsMode: mode,
    inertialConfig: { ...currentInertial },
    driveRate: currentDriveRate,
  })
  const finalState = solveByMode(current, currentConfig, mode, currentInertial, duration - cursor, currentDriveRate)

  return {
    dynamicsMode: mode,
    inertialConfig: { ...currentInertial },
    segments,
    finalState: { ...finalState, worldAt: (state?.worldAt ?? 0) + duration },
  }
}

export function sampleThermalTimeline(segments, t) {
  const segment = segments.findLast((entry) => entry.start <= t) ?? segments[0]
  if (!segment) return null
  const duration = Math.max(0, Math.min(t, segment.end) - segment.start)
  const solved = solveByMode(
    segment.state,
    segment.config,
    segment.dynamicsMode ?? 'oscillator',
    segment.inertialConfig,
    duration,
    segment.driveRate ?? 0,
  )
  return { ...solved, worldAt: (segment.state.worldAt ?? 0) + duration }
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
  const dynamicsMode = thermalDynamicsMode(profileSnapshot)
  const inertialConfig = thermalInertialConfigFromProfile(profileSnapshot)

  if (dynamicsMode === 'inertial') {
    const plan = buildInertialActionPlan({
      state,
      thermalConfig: config,
      inertialConfig,
      actionId,
      strengths: thermalImpulsesFromProfile(profileSnapshot),
      durationAt,
      horizonAt: durationAt,
      driveDurationAt: durationAt,
    })
    return {
      runtime: SHARED_THERMAL_RUNTIME,
      dynamicsMode,
      inertialConfig,
      profileSnapshot,
      profileId: profileSnapshot.id,
      profileRevision: profileSnapshot.revision,
      action: {
        ...action,
        effectType: 'drive',
        driveRate: plan.driveRate,
      },
      config,
      finalState: plan.finalState,
      diagnostics: inertialDiagnostics(state, config, inertialConfig, plan.driveRate),
    }
  }

  const afterImpulse = applyThermalImpulse(state, action.impulse)
  const solved = solveThermalSegment(afterImpulse, config, durationAt)
  return {
    runtime: SHARED_THERMAL_RUNTIME,
    dynamicsMode,
    inertialConfig,
    profileSnapshot,
    profileId: profileSnapshot.id,
    profileRevision: profileSnapshot.revision,
    action: { ...action, effectType: 'impulse' },
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
  const dynamicsMode = thermalDynamicsMode(profileSnapshot)
  const inertialConfig = thermalInertialConfigFromProfile(profileSnapshot)
  const resolvedImpulse = Number.isFinite(Number(impulse)) ? Number(impulse) : 0

  if (dynamicsMode === 'inertial') {
    const solved = solveInertialSegment(state, config, inertialConfig, durationAt, resolvedImpulse)
    return {
      runtime: SHARED_THERMAL_RUNTIME,
      dynamicsMode,
      inertialConfig,
      profileSnapshot,
      profileId: profileSnapshot.id,
      profileRevision: profileSnapshot.revision,
      action: {
        id: sourceId,
        label: sourceId,
        sign: Math.sign(resolvedImpulse),
        tier: null,
        impulse: resolvedImpulse,
        effectType: 'drive',
        driveRate: resolvedImpulse,
        profileId: profileSnapshot.id,
        profileRevision: profileSnapshot.revision,
      },
      config,
      finalState: {
        ...solved,
        worldAt: Number(state?.worldAt || 0) + durationAt,
      },
      diagnostics: diagnosticsByMode(state, config, dynamicsMode, inertialConfig, resolvedImpulse),
    }
  }

  const afterImpulse = applyThermalImpulse(state, resolvedImpulse)
  const solved = solveThermalSegment(afterImpulse, config, durationAt)
  return {
    runtime: SHARED_THERMAL_RUNTIME,
    dynamicsMode,
    inertialConfig,
    profileSnapshot,
    profileId: profileSnapshot.id,
    profileRevision: profileSnapshot.revision,
    action: {
      id: sourceId,
      label: sourceId,
      sign: Math.sign(resolvedImpulse),
      tier: null,
      impulse: resolvedImpulse,
      effectType: 'impulse',
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
