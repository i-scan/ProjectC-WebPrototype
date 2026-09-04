import { HEX_DIRECTIONS, axialDistance, axialToWorld, directionVector, worldToAxial } from '../../sim/hex.js'

export const TRAJECTORY_RULE = 'val-012-process-steering-ab-v1-candidate'
export const TRAJECTORY_READY_RULE = 'action-complete-ready-v1'
export const TRAJECTORY_STEERING_RULE = 'max-60deg-per-action-v1'
export const TRAJECTORY_DISSIPATION_RULE = 'persistent-start-m-minus-1-v1'
export const TRAJECTORY_CELL_AUTHORITY_RULE = 'ready-cell-center-v1'
export const TRAJECTORY_PATH_RULE = 'cell-center-anchored-steering-curve-v2'
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
const SUBSTEPS_PER_CELL = 8
const PREVIEW_AXIS_STUB = 0.48
const CURVE_TANGENT_SCALE = 0.78
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

function velocityFor(axisId, momentum) {
  if (!axisId || momentum <= 0) return { x: 0, z: 0 }
  const direction = directionVector(axisId)
  const speed = displaySpeed(momentum)
  return { x: direction.x * speed, z: direction.z * speed }
}

function velocityForHeading(heading, momentum) {
  if (!Number.isFinite(heading) || momentum <= 0) return { x: 0, z: 0 }
  const speed = displaySpeed(momentum)
  return { x: Math.cos(heading) * speed, z: Math.sin(heading) * speed }
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
  return {
    position: resolvedPosition,
    velocity: velocityFor(resolvedAxis, m),
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
  const targetAxis = Number.isFinite(targetHeading) ? nearestAxisIdFromAngle(targetHeading) : startAxis
  const initialAxis = startAxis ?? targetAxis ?? 'E'
  const startHeading = axisAngle(initialAxis)
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
    const segmentMidProgress = (index - 0.5) / Math.max(1, travelSteps)
    const desiredHeading = freeM0Direction && Number.isFinite(targetHeading)
      ? targetHeading
      : startHeading + cappedDelta * responseValue(responseCurve, segmentMidProgress)
    // Persistent M must first cash out the Axis it already owns. Steering happens during
    // that first Cell segment and can redirect later Cell choices, but it cannot replace
    // the only M1 Travel with a neighboring sector at Action start.
    const stepAxis = !freeM0Direction && index === 1
      ? initialAxis
      : steeringEnabled
        ? nearestAxisIdFromAngle(desiredHeading)
        : initialAxis
    const next = addStep(current, stepAxis)
    if (axialDistance(next) > boardRadius) break
    current = next
    path.push({ ...current })
    segmentAxes.push(stepAxis)
  }

  return {
    path,
    segmentAxes,
    targetAxis: targetAxis ?? initialAxis,
    startAxis: initialAxis,
    startHeading,
    cappedDelta,
    steeringEnabled,
    finalTravelAxis: segmentAxes.at(-1) ?? initialAxis,
  }
}

function hermitePoint(from, to, fromHeading, toHeading, t) {
  const distance = Math.max(0.001, Math.hypot(to.x - from.x, to.z - from.z))
  const tangentLength = distance * CURVE_TANGENT_SCALE
  const m0 = { x: Math.cos(fromHeading) * tangentLength, z: Math.sin(fromHeading) * tangentLength }
  const m1 = { x: Math.cos(toHeading) * tangentLength, z: Math.sin(toHeading) * tangentLength }
  const t2 = t * t
  const t3 = t2 * t
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2
  const position = {
    x: h00 * from.x + h10 * m0.x + h01 * to.x + h11 * m1.x,
    z: h00 * from.z + h10 * m0.z + h01 * to.z + h11 * m1.z,
  }
  const dh00 = 6 * t2 - 6 * t
  const dh10 = 3 * t2 - 4 * t + 1
  const dh01 = -6 * t2 + 6 * t
  const dh11 = 3 * t2 - 2 * t
  const derivative = {
    x: dh00 * from.x + dh10 * m0.x + dh01 * to.x + dh11 * m1.x,
    z: dh00 * from.z + dh10 * m0.z + dh01 * to.z + dh11 * m1.z,
  }
  return { position, heading: Math.atan2(derivative.z, derivative.x) }
}

function samplesForCenterPath(path, pathResult, movingM, finalM, finalAxis, responseCurve) {
  const segmentCount = Math.max(0, path.length - 1)
  if (segmentCount === 0) {
    const center = axialToWorld(path[0])
    return [
      { t: 0, position: center, velocity: velocityFor(finalAxis, finalM), axisId: finalAxis, momentumLevel: finalM },
      { t: 1, position: { ...center }, velocity: velocityFor(finalAxis, finalM), axisId: finalAxis, momentumLevel: finalM },
    ]
  }

  const headingAtAnchor = (anchorIndex) => {
    if (anchorIndex <= 0) return pathResult.startHeading
    if (anchorIndex >= segmentCount) return finalAxis ? axisAngle(finalAxis) : pathResult.startHeading
    if (!pathResult.steeringEnabled) return pathResult.startHeading
    const progress = anchorIndex / segmentCount
    return pathResult.startHeading + pathResult.cappedDelta * responseValue(responseCurve, progress)
  }

  const samples = []
  samples.push({
    t: 0,
    position: axialToWorld(path[0]),
    velocity: velocityForHeading(headingAtAnchor(0), movingM),
    axisId: pathResult.startAxis,
    momentumLevel: movingM,
    cellCenterAnchor: true,
  })

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const from = axialToWorld(path[segmentIndex])
    const to = axialToWorld(path[segmentIndex + 1])
    const fromHeading = headingAtAnchor(segmentIndex)
    const toHeading = headingAtAnchor(segmentIndex + 1)
    for (let sub = 1; sub <= SUBSTEPS_PER_CELL; sub += 1) {
      const local = sub / SUBSTEPS_PER_CELL
      const global = (segmentIndex + local) / segmentCount
      const atFinalCenter = segmentIndex === segmentCount - 1 && sub === SUBSTEPS_PER_CELL
      const atCellCenter = sub === SUBSTEPS_PER_CELL
      const curve = hermitePoint(from, to, fromHeading, toHeading, local)
      const sampleAxis = atFinalCenter ? finalAxis : nearestAxisIdFromAngle(curve.heading)
      samples.push({
        t: global,
        position: curve.position,
        velocity: atFinalCenter ? velocityFor(finalAxis, finalM) : velocityForHeading(curve.heading, movingM),
        axisId: sampleAxis,
        momentumLevel: atFinalCenter ? finalM : movingM,
        cellCenterAnchor: atCellCenter,
      })
    }
  }
  return samples
}

function previewAxisStubSamples(plan) {
  if (!plan?.valid || !plan.finalState?.axisId || !plan.samples?.length) return plan?.samples ?? []
  const samples = plan.samples.map((sample) => ({
    ...sample,
    position: { ...sample.position },
    velocity: { ...sample.velocity },
  }))
  const center = axialToWorld(plan.finalHex)
  const direction = directionVector(plan.finalState.axisId)
  samples.push({
    t: 1.05,
    position: { x: center.x + direction.x * PREVIEW_AXIS_STUB, z: center.z + direction.z * PREVIEW_AXIS_STUB },
    velocity: { ...plan.finalState.velocity },
    axisId: plan.finalState.axisId,
    momentumLevel: plan.finalM,
    previewAxisStub: true,
  })
  return samples
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

  let requestedTravelSteps = 0
  if (canonicalActionId === 'skip') requestedTravelSteps = startM
  else if (buildM > 0) requestedTravelSteps = Math.max(1, builtM)
  else requestedTravelSteps = startM > 0 ? startM : 1

  const pathResult = buildCenterPath({
    state,
    targetHeading,
    travelSteps: requestedTravelSteps,
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

  if (startM === 0 && profile.needsDirection && Number.isFinite(targetHeading)) {
    finalAxis = nearestAxisIdFromAngle(targetHeading)
  }
  if (canonicalActionId === 'skip' && startM === 0 && !state.axisId) finalAxis = null

  const finalHex = pathResult.path.at(-1)
  const finalPosition = axialToWorld(finalHex)
  const finalState = {
    ...state,
    position: finalPosition,
    velocity: velocityFor(finalAxis, finalM),
    axisId: finalAxis,
    momentumLevel: finalM,
    heading: finalAxis ? axisAngle(finalAxis) : null,
    worldAt: Number(state.worldAt ?? 0) + 1,
  }

  const movingM = Math.max(1, startM, builtM)
  const samples = samplesForCenterPath(pathResult.path, pathResult, movingM, finalM, finalAxis, responseCurve)
  const crossings = pathResult.path.map((hex, index) => ({
    hex: { ...hex },
    sampleIndex: index * SUBSTEPS_PER_CELL,
    t: index / Math.max(1, pathResult.path.length - 1),
  }))

  const targetDeltaDeg = Number.isFinite(targetHeading) && state.axisId
    ? shortestDelta(axisAngle(state.axisId), targetHeading) * RAD
    : null
  const steeringAppliedDeg = pathResult.cappedDelta * RAD
  const reachedBoardEdge = actualSteps < requestedTravelSteps
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
    pathCells: pathResult.path.map((hex) => ({ ...hex })),
    segmentAxes: [...pathResult.segmentAxes],
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
    requestedTravelSteps,
    steeringAppliedDeg,
    targetDeltaDeg,
    zeroMSettlementDeg,
    responseCurve,
    reachedBoardEdge,
    cellAuthorityRule: TRAJECTORY_CELL_AUTHORITY_RULE,
    pathRule: TRAJECTORY_PATH_RULE,
    atCost: 1,
    spatialMode: 'hybrid',
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
    samples: previewAxisStubSamples(controlledPlan),
    actorTrajectories: coastPlan?.valid ? { coastProjection: coastPlan.pathCells } : {},
    previewAxisStub: controlledPlan.finalState?.axisId ?? null,
    coastPreviewAxis: coastPlan?.finalState?.axisId ?? null,
  }
}
