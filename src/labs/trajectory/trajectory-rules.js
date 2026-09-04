import { HEX_DIRECTIONS, axialDistance, axialToWorld, directionVector, worldToAxial } from '../../sim/hex.js'

export const TRAJECTORY_RULE = 'val-012-process-steering-ab-v1-candidate'
export const TRAJECTORY_READY_RULE = 'action-complete-ready-v1'
export const TRAJECTORY_STEERING_RULE = 'max-60deg-per-action-v1'
export const TRAJECTORY_DISSIPATION_RULE = 'persistent-start-m-minus-1-v1'
export const TRAJECTORY_CELL_AUTHORITY_RULE = 'ready-cell-center-v1'
export const TRAJECTORY_PATH_RULE = 'cell-center-steering-polyline-v1'
export const TRAJECTORY_MIN_RADIUS = 4
export const TRAJECTORY_MAX_RADIUS = 10
export const TRAJECTORY_DEFAULT_RADIUS = 6
export const TRAJECTORY_MAX_STEER_DEG = 60
export const TRAJECTORY_BASE_DISSIPATION = 1
export const TRAJECTORY_ACTION_PROFILES = Object.freeze({
  steer: { id: 'steer', buildM: 0, sustain: false, needsDirection: true },
  skip: { id: 'skip', buildM: 0, sustain: false, needsDirection: false },
  drive: { id: 'drive', buildM: 1, sustain: true, needsDirection: true },
  'heavy-drive': { id: 'heavy-drive', buildM: 2, sustain: true, needsDirection: true },
})

const DEG = Math.PI / 180
const RAD = 180 / Math.PI
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function normalizeAngle(angle) {
  let value = angle
  while (value <= -Math.PI) value += Math.PI * 2
  while (value > Math.PI) value -= Math.PI * 2
  return value
}

function shortestDelta(from, to) {
  return normalizeAngle(to - from)
}

function vectorAngle(vector) {
  return Math.atan2(vector.z ?? 0, vector.x ?? 0)
}

function axisAngle(axisId) {
  return vectorAngle(directionVector(axisId ?? 'E'))
}

function nearestAxisIdFromAngle(angle) {
  const source = { x: Math.cos(angle), z: Math.sin(angle) }
  let bestId = 'E'
  let bestDot = -Infinity
  for (const entry of HEX_DIRECTIONS) {
    const direction = directionVector(entry.id)
    const dot = direction.x * source.x + direction.z * source.z
    if (dot > bestDot) {
      bestDot = dot
      bestId = entry.id
    }
  }
  return bestId
}

function directionEntry(axisId) {
  return HEX_DIRECTIONS.find((entry) => entry.id === axisId) ?? HEX_DIRECTIONS[0]
}

function addStep(hex, axisId) {
  const direction = directionEntry(axisId)
  return { q: hex.q + direction.q, r: hex.r + direction.r }
}

function responseValue(kind, t) {
  if (kind === 'smoothstep') return t * t * (3 - 2 * t)
  if (kind === 'ease-in') return t * t
  if (kind === 'ease-out') return 1 - ((1 - t) * (1 - t))
  return t
}

function displaySpeed(momentum) {
  return Math.max(0.05, momentum)
}

function makeCenterSample(hex, momentum, axisId, t) {
  const position = axialToWorld(hex)
  const direction = directionVector(axisId ?? 'E')
  const speed = displaySpeed(momentum)
  return {
    t,
    hex: { ...hex },
    position,
    velocity: momentum > 0 && axisId ? { x: direction.x * speed, z: direction.z * speed } : { x: 0, z: 0 },
    axisId: axisId ?? null,
    momentumLevel: momentum,
  }
}

function profileFor(actionId) {
  if (actionId === 'coast') return TRAJECTORY_ACTION_PROFILES.skip
  return TRAJECTORY_ACTION_PROFILES[actionId] ?? TRAJECTORY_ACTION_PROFILES.steer
}

export function makeTrajectoryState({ hex = { q: 0, r: 0 }, position = null, axisId = null, momentum = 0, worldAt = 0, heading = null } = {}) {
  const resolvedHex = position ? worldToAxial(position) : { ...hex }
  const resolvedPosition = axialToWorld(resolvedHex)
  const resolvedAxis = axisId ?? (Number.isFinite(heading) ? nearestAxisIdFromAngle(heading) : null)
  const m = clamp(Math.round(momentum), 0, 3)
  const direction = resolvedAxis ? directionVector(resolvedAxis) : { x: 0, z: 0 }
  return {
    position: resolvedPosition,
    velocity: m > 0 && resolvedAxis ? { x: direction.x * m, z: direction.z * m } : { x: 0, z: 0 },
    axisId: resolvedAxis,
    momentumLevel: m,
    heading: resolvedAxis ? axisAngle(resolvedAxis) : null,
    worldAt,
  }
}

export function trajectoryMomentum(state) {
  if (Number.isFinite(state?.momentumLevel)) return clamp(Math.round(state.momentumLevel), 0, 3)
  const speed = Math.hypot(state?.velocity?.x ?? 0, state?.velocity?.z ?? 0)
  if (speed < 0.18) return 0
  if (speed < 1.5) return 1
  if (speed < 2.5) return 2
  return 3
}

export function trajectoryHeading(state) {
  if (state?.axisId) return axisAngle(state.axisId)
  const speed = Math.hypot(state?.velocity?.x ?? 0, state?.velocity?.z ?? 0)
  if (speed > 0.02) return vectorAngle(state.velocity)
  return Number.isFinite(state?.heading) ? state.heading : null
}

export function steeringBearingFromCell(state, selectedHex) {
  const center = axialToWorld(selectedHex)
  const dx = center.x - state.position.x
  const dz = center.z - state.position.z
  if (Math.hypot(dx, dz) < 0.001) return null
  return Math.atan2(dz, dx)
}

export function steeringDeltaDegrees(state, selectedHex) {
  const target = steeringBearingFromCell(state, selectedHex)
  const current = trajectoryHeading(state)
  if (!Number.isFinite(target) || !Number.isFinite(current)) return null
  return shortestDelta(current, target) * RAD
}

export function compatibleStartupMove(state, selectedHex) {
  if (!state?.axisId) return false
  const target = steeringBearingFromCell(state, selectedHex)
  if (!Number.isFinite(target)) return false
  const targetAxis = nearestAxisIdFromAngle(target)
  return Math.abs(shortestDelta(axisAngle(state.axisId), axisAngle(targetAxis)) * RAD) <= TRAJECTORY_MAX_STEER_DEG + 0.001
}

function buildCenterPath({ state, targetHeading, travelSteps, steeringEnabled, responseCurve, boardRadius, freeM0Direction }) {
  const startHex = worldToAxial(state.position)
  const startAxis = state.axisId ?? (Number.isFinite(targetHeading) ? nearestAxisIdFromAngle(targetHeading) : null)
  let targetAxis = Number.isFinite(targetHeading) ? nearestAxisIdFromAngle(targetHeading) : startAxis
  if (!targetAxis) targetAxis = 'E'

  let startHeading = startAxis ? axisAngle(startAxis) : axisAngle(targetAxis)
  let cappedDelta = 0
  if (steeringEnabled && Number.isFinite(targetHeading)) {
    const rawDelta = shortestDelta(startHeading, targetHeading)
    cappedDelta = freeM0Direction
      ? rawDelta
      : clamp(rawDelta, -TRAJECTORY_MAX_STEER_DEG * DEG, TRAJECTORY_MAX_STEER_DEG * DEG)
  }

  const path = [{ ...startHex }]
  const segmentAxes = []
  let current = { ...startHex }
  for (let index = 1; index <= travelSteps; index += 1) {
    const progress = index / Math.max(1, travelSteps)
    const desiredHeading = freeM0Direction
      ? targetHeading
      : startHeading + cappedDelta * responseValue(responseCurve, progress)
    const stepAxis = steeringEnabled && Number.isFinite(desiredHeading)
      ? nearestAxisIdFromAngle(desiredHeading)
      : (startAxis ?? targetAxis)
    const next = addStep(current, stepAxis)
    if (axialDistance(next) > boardRadius) break
    current = next
    path.push({ ...current })
    segmentAxes.push(stepAxis)
  }

  const finalTravelAxis = segmentAxes.at(-1) ?? startAxis ?? targetAxis
  return {
    path,
    segmentAxes,
    targetAxis,
    startAxis,
    cappedDelta,
    finalTravelAxis,
  }
}

export function trajectoryActionPlan({
  state,
  actionId = 'steer',
  selectedHex = null,
  boardRadius = TRAJECTORY_DEFAULT_RADIUS,
  responseCurve = 'linear',
  baseDissipationPerAction = TRAJECTORY_BASE_DISSIPATION,
} = {}) {
  const profile = profileFor(actionId)
  const canonicalActionId = profile.id
  const startM = trajectoryMomentum(state)
  const targetHeading = profile.needsDirection && selectedHex ? steeringBearingFromCell(state, selectedHex) : null
  if (profile.needsDirection && !Number.isFinite(targetHeading)) {
    return { valid: false, reason: 'Hover or click a direction Cell.' }
  }

  const buildM = profile.buildM ?? 0
  const builtM = clamp(startM + buildM, 0, 3)
  const freeM0Direction = startM === 0
  const steeringEnabled = profile.needsDirection

  let travelSteps = 0
  if (canonicalActionId === 'skip') travelSteps = startM
  else if (buildM > 0) travelSteps = Math.max(1, builtM)
  else travelSteps = startM > 0 ? startM : 1

  const pathResult = buildCenterPath({
    state,
    targetHeading,
    travelSteps,
    steeringEnabled,
    responseCurve,
    boardRadius,
    freeM0Direction,
  })

  const actualSteps = Math.max(0, pathResult.path.length - 1)
  let generatedM = 0
  let startupCompatible = false
  let finalM = startM

  if (profile.sustain) {
    finalM = builtM
  } else if (startM === 0) {
    if (canonicalActionId === 'steer') {
      startupCompatible = Boolean(state.axisId) && compatibleStartupMove(state, selectedHex)
      generatedM = startupCompatible ? 1 : 0
      finalM = generatedM
    } else {
      finalM = 0
    }
  } else {
    finalM = Math.max(0, startM - Math.max(0, baseDissipationPerAction))
  }

  let finalAxis = pathResult.finalTravelAxis ?? state.axisId ?? pathResult.targetAxis
  let zeroMSettlementDeg = 0
  if (startM > 0 && finalM === 0 && canonicalActionId === 'steer' && Number.isFinite(targetHeading)) {
    const currentAxisHeading = axisAngle(finalAxis)
    const remaining = shortestDelta(currentAxisHeading, targetHeading)
    if (Math.abs(remaining) > 0.001) {
      const settlement = clamp(remaining, -TRAJECTORY_MAX_STEER_DEG * DEG, TRAJECTORY_MAX_STEER_DEG * DEG)
      finalAxis = nearestAxisIdFromAngle(currentAxisHeading + settlement)
      zeroMSettlementDeg = settlement * RAD
    }
  }

  if (startM === 0 && canonicalActionId === 'steer' && Number.isFinite(targetHeading)) {
    finalAxis = nearestAxisIdFromAngle(targetHeading)
  }
  if (startM === 0 && profile.sustain && Number.isFinite(targetHeading)) {
    finalAxis = nearestAxisIdFromAngle(targetHeading)
  }
  if (canonicalActionId === 'skip' && startM === 0 && !state.axisId) finalAxis = null

  const finalHex = pathResult.path.at(-1)
  const finalPosition = axialToWorld(finalHex)
  const finalDirection = finalAxis ? directionVector(finalAxis) : { x: 0, z: 0 }
  const finalState = {
    ...state,
    position: finalPosition,
    velocity: finalM > 0 && finalAxis ? { x: finalDirection.x * finalM, z: finalDirection.z * finalM } : { x: 0, z: 0 },
    axisId: finalAxis,
    momentumLevel: finalM,
    heading: finalAxis ? axisAngle(finalAxis) : null,
    worldAt: Number(state.worldAt ?? 0) + 1,
  }

  const sampleMomentum = Math.max(startM, builtM, finalM)
  const samples = pathResult.path.map((hex, index) => {
    const axisId = index === 0
      ? (state.axisId ?? pathResult.segmentAxes[0] ?? finalAxis)
      : (pathResult.segmentAxes[index - 1] ?? finalAxis)
    return makeCenterSample(hex, index === pathResult.path.length - 1 ? finalM : sampleMomentum, axisId, index / Math.max(1, pathResult.path.length - 1))
  })
  if (samples.length === 1) {
    samples.push(makeCenterSample(finalHex, finalM, finalAxis, 1))
  } else {
    samples[samples.length - 1] = makeCenterSample(finalHex, finalM, finalAxis, 1)
  }

  const crossings = pathResult.path.map((hex, index) => ({
    hex: { ...hex },
    sampleIndex: index,
    t: index / Math.max(1, pathResult.path.length - 1),
  }))

  const targetDeltaDeg = Number.isFinite(targetHeading) && state.axisId
    ? shortestDelta(axisAngle(state.axisId), targetHeading) * RAD
    : null
  const steeringAppliedDeg = pathResult.cappedDelta * RAD
  const reachedBoardEdge = actualSteps < travelSteps
  const verb = canonicalActionId === 'skip'
    ? 'Skip'
    : canonicalActionId === 'drive'
      ? 'Drive'
      : canonicalActionId === 'heavy-drive'
        ? 'Heavy Drive'
        : (startM > 0 ? 'Steer' : 'Move')
  const summary = `${verb} · ${actualSteps} Cell / 1 AT · M${startM}→M${finalM} · Axis ${state.axisId ?? 'none'}→${finalAxis ?? 'none'}`

  return {
    valid: true,
    kind: canonicalActionId,
    actionId: canonicalActionId,
    samples,
    crossings,
    finalState,
    finalHex,
    beforeM: startM,
    builtM,
    buildM,
    finalM,
    generatedM,
    startupCompatible,
    travelDistance: actualSteps,
    travelSteps: actualSteps,
    requestedTravelSteps: travelSteps,
    steeringAppliedDeg,
    targetDeltaDeg,
    zeroMSettlementDeg,
    responseCurve,
    reachedBoardEdge,
    cellAuthorityRule: TRAJECTORY_CELL_AUTHORITY_RULE,
    pathRule: TRAJECTORY_PATH_RULE,
    preserveCellCenters: true,
    finalAxisIndicator: finalAxis ? { hex: { ...finalHex }, axisId: finalAxis } : null,
    atCost: 1,
    spatialMode: 'discrete',
    destinationDriven: false,
    collisions: [],
    conflictEvents: [],
    actorTrajectories: {},
    actorPlaybackWindows: {},
    actorStates: [],
    summary,
  }
}

export function trajectoryProjectionPair(options = {}) {
  const controlled = trajectoryActionPlan(options)
  const coast = trajectoryActionPlan({ ...options, actionId: 'skip', selectedHex: null })
  return { controlled, coast }
}

export function withCoastProjection(controlledPlan, coastPlan) {
  if (!controlledPlan?.valid) return controlledPlan
  return {
    ...controlledPlan,
    coastPreviewSamples: coastPlan?.valid ? coastPlan.samples : [],
    coastFinalAxisIndicator: coastPlan?.valid ? coastPlan.finalAxisIndicator : null,
  }
}
