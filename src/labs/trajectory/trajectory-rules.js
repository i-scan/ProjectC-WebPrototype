import { axialDistance, axialToWorld, directionVector, worldToAxial } from '../../sim/hex.js'

export const TRAJECTORY_RULE = 'val-012-process-steering-ab-v1-candidate'
export const TRAJECTORY_READY_RULE = 'action-complete-ready-v1'
export const TRAJECTORY_STEERING_RULE = 'max-60deg-per-action-v1'
export const TRAJECTORY_DISSIPATION_RULE = 'persistent-start-m-minus-1-v1'
export const TRAJECTORY_MIN_RADIUS = 4
export const TRAJECTORY_MAX_RADIUS = 10
export const TRAJECTORY_DEFAULT_RADIUS = 6
export const TRAJECTORY_DEFAULT_SAMPLES = 120
export const TRAJECTORY_MAX_STEER_DEG = 60
export const TRAJECTORY_BASE_DISSIPATION = 1

const DIRECTION_IDS = ['E', 'NE', 'NW', 'W', 'SW', 'SE']
const DEG = Math.PI / 180
const RAD = 180 / Math.PI

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const lerp = (a, b, t) => a + (b - a) * t

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

function angleVector(angle) {
  return { x: Math.cos(angle), z: Math.sin(angle) }
}

function axisAngle(axisId) {
  return vectorAngle(directionVector(axisId ?? 'E'))
}

function nearestAxisIdFromAngle(angle) {
  const vector = angleVector(angle)
  let bestId = 'E'
  let bestDot = -Infinity
  for (const id of DIRECTION_IDS) {
    const direction = directionVector(id)
    const dot = direction.x * vector.x + direction.z * vector.z
    if (dot > bestDot) {
      bestDot = dot
      bestId = id
    }
  }
  return bestId
}

function responseValue(kind, t) {
  if (kind === 'ease-in') return t * t
  if (kind === 'ease-out') return 1 - ((1 - t) * (1 - t))
  if (kind === 'smoothstep') return t * t * (3 - 2 * t)
  return t
}

function displaySpeed(momentum) {
  if (momentum <= 0) return 0.05
  return momentum
}

function makeSample(position, momentum, heading, t) {
  const speed = displaySpeed(momentum)
  return {
    t,
    position: { x: position.x, z: position.z },
    velocity: { x: Math.cos(heading) * speed, z: Math.sin(heading) * speed },
    axisId: nearestAxisIdFromAngle(heading),
  }
}

function crossingTrace(samples, boardRadius) {
  const crossings = []
  let previousKey = null
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]
    const hex = worldToAxial(sample.position)
    if (axialDistance(hex) > boardRadius) break
    const key = `${hex.q},${hex.r}`
    if (key === previousKey) continue
    crossings.push({ hex, sampleIndex: index, t: sample.t })
    previousKey = key
  }
  return crossings
}

function trimAtBoard(samples, boardRadius) {
  const result = []
  for (const sample of samples) {
    const hex = worldToAxial(sample.position)
    if (axialDistance(hex) > boardRadius) break
    result.push(sample)
  }
  return result.length ? result : [samples[0]]
}

export function makeTrajectoryState({ hex = { q: 0, r: 0 }, position = null, axisId = null, momentum = 0, worldAt = 0, heading = null } = {}) {
  const resolvedPosition = position ? { ...position } : axialToWorld(hex)
  const resolvedHeading = Number.isFinite(heading) ? heading : (axisId ? axisAngle(axisId) : null)
  const velocity = momentum > 0 && Number.isFinite(resolvedHeading)
    ? { x: Math.cos(resolvedHeading) * momentum, z: Math.sin(resolvedHeading) * momentum }
    : { x: 0, z: 0 }
  return {
    position: resolvedPosition,
    velocity,
    axisId: axisId ?? (Number.isFinite(resolvedHeading) ? nearestAxisIdFromAngle(resolvedHeading) : null),
    momentumLevel: clamp(Math.round(momentum), 0, 3),
    heading: resolvedHeading,
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
  const speed = Math.hypot(state?.velocity?.x ?? 0, state?.velocity?.z ?? 0)
  if (speed > 0.02) return vectorAngle(state.velocity)
  if (Number.isFinite(state?.heading)) return state.heading
  return state?.axisId ? axisAngle(state.axisId) : null
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
  const current = trajectoryHeading(state)
  const target = steeringBearingFromCell(state, selectedHex)
  if (!Number.isFinite(current) || !Number.isFinite(target)) return false
  return Math.abs(shortestDelta(current, target) * RAD) <= TRAJECTORY_MAX_STEER_DEG + 0.001
}

function simulatePath({ state, actionId, targetHeading, boardRadius, responseCurve, solverSamples }) {
  const startM = trajectoryMomentum(state)
  const startHeading = trajectoryHeading(state)
  const activeMove = actionId === 'steer'
  const hasPersistentMotion = startM > 0
  const shouldTravel = hasPersistentMotion || (startM === 0 && activeMove)
  const distance = hasPersistentMotion ? startM : (activeMove ? 1 : 0)

  let initialHeading = startHeading
  if (!Number.isFinite(initialHeading)) initialHeading = Number.isFinite(targetHeading) ? targetHeading : 0

  let steeringDelta = 0
  if (activeMove && Number.isFinite(targetHeading)) {
    const rawDelta = shortestDelta(initialHeading, targetHeading)
    steeringDelta = startM === 0
      ? rawDelta
      : clamp(rawDelta, -TRAJECTORY_MAX_STEER_DEG * DEG, TRAJECTORY_MAX_STEER_DEG * DEG)
  }

  const steps = Math.max(16, Math.round(solverSamples || TRAJECTORY_DEFAULT_SAMPLES))
  const samples = []
  const position = { ...state.position }
  samples.push(makeSample(position, startM, initialHeading, 0))

  if (shouldTravel && distance > 0) {
    const segment = distance / steps
    for (let index = 1; index <= steps; index += 1) {
      const t0 = (index - 1) / steps
      const t1 = index / steps
      const responseMid = responseValue(responseCurve, (t0 + t1) * 0.5)
      const heading = initialHeading + steeringDelta * responseMid
      position.x += Math.cos(heading) * segment
      position.z += Math.sin(heading) * segment
      const sampleHeading = initialHeading + steeringDelta * responseValue(responseCurve, t1)
      samples.push(makeSample(position, startM, sampleHeading, t1))
    }
  } else {
    samples.push(makeSample(position, 0, initialHeading, 1))
  }

  return {
    samples: trimAtBoard(samples, boardRadius),
    initialHeading,
    targetHeading,
    steeringDelta,
    travelDistance: distance,
  }
}

export function trajectoryActionPlan({
  state,
  actionId = 'steer',
  selectedHex = null,
  boardRadius = TRAJECTORY_DEFAULT_RADIUS,
  responseCurve = 'linear',
  solverSamples = TRAJECTORY_DEFAULT_SAMPLES,
  baseDissipationPerAction = TRAJECTORY_BASE_DISSIPATION,
} = {}) {
  const startM = trajectoryMomentum(state)
  const startHeading = trajectoryHeading(state)
  const targetHeading = actionId === 'steer' && selectedHex ? steeringBearingFromCell(state, selectedHex) : null

  if (actionId === 'steer' && !Number.isFinite(targetHeading)) {
    return { valid: false, reason: 'Select a direction Cell to define Blue Steering.' }
  }

  const simulated = simulatePath({ state, actionId, targetHeading, boardRadius, responseCurve, solverSamples })
  const samples = simulated.samples
  const last = samples.at(-1)
  const reachedBoardEdge = samples.length < Math.max(2, Math.round(solverSamples || TRAJECTORY_DEFAULT_SAMPLES) + 1) && simulated.travelDistance > 0
  let endHeading = Number.isFinite(last?.velocity?.x) && Math.hypot(last.velocity.x, last.velocity.z) > 0.001
    ? vectorAngle(last.velocity)
    : simulated.initialHeading

  let generatedM = 0
  let finalM = startM
  let startupCompatible = false

  if (startM === 0) {
    if (actionId === 'steer') {
      startupCompatible = Boolean(state.axisId) && compatibleStartupMove(state, selectedHex)
      generatedM = startupCompatible ? 1 : 0
      finalM = generatedM
      endHeading = targetHeading
    } else {
      finalM = 0
    }
  } else {
    finalM = Math.max(0, startM - Math.max(0, baseDissipationPerAction))
  }

  let zeroMSettlementDeg = 0
  if (startM > 0 && finalM === 0 && actionId === 'steer' && Number.isFinite(targetHeading)) {
    const remaining = shortestDelta(endHeading, targetHeading)
    const settlement = clamp(remaining, -TRAJECTORY_MAX_STEER_DEG * DEG, TRAJECTORY_MAX_STEER_DEG * DEG)
    endHeading = normalizeAngle(endHeading + settlement)
    zeroMSettlementDeg = settlement * RAD
  }

  const finalAxis = nearestAxisIdFromAngle(endHeading)
  const finalVelocity = finalM > 0
    ? { x: Math.cos(endHeading) * finalM, z: Math.sin(endHeading) * finalM }
    : { x: 0, z: 0 }
  const finalState = {
    ...state,
    position: { ...last.position },
    velocity: finalVelocity,
    axisId: actionId === 'coast' && startM === 0 && !state.axisId ? null : finalAxis,
    momentumLevel: finalM,
    heading: endHeading,
    worldAt: Number(state.worldAt ?? 0) + 1,
  }
  const crossings = crossingTrace(samples, boardRadius)
  const finalHex = worldToAxial(finalState.position)
  const steeringAppliedDeg = simulated.steeringDelta * RAD
  const targetDeltaDeg = Number.isFinite(targetHeading) && Number.isFinite(startHeading)
    ? shortestDelta(startHeading, targetHeading) * RAD
    : null

  const verb = actionId === 'coast' ? (startM > 0 ? 'Coast' : 'Wait') : (startM > 0 ? 'Steer' : 'Move')
  const summary = `${verb} · ${simulated.travelDistance.toFixed(1)} Cell-band / 1 AT · M${startM}→M${finalM} · Axis ${state.axisId ?? 'none'}→${finalState.axisId ?? 'none'}`

  return {
    valid: true,
    kind: actionId,
    actionId,
    samples,
    crossings,
    finalState,
    finalHex,
    beforeM: startM,
    finalM,
    generatedM,
    startupCompatible,
    travelDistance: simulated.travelDistance,
    steeringAppliedDeg,
    targetDeltaDeg,
    zeroMSettlementDeg,
    responseCurve,
    reachedBoardEdge,
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
  const coast = trajectoryActionPlan({ ...options, actionId: 'coast', selectedHex: null })
  return { controlled, coast }
}

export function coastHexPath(plan) {
  return (plan?.crossings ?? []).map((entry) => ({ ...entry.hex }))
}

export function withCoastProjection(controlledPlan, coastPlan) {
  if (!controlledPlan?.valid) return controlledPlan
  return {
    ...controlledPlan,
    actorTrajectories: coastPlan?.valid ? { coastProjection: coastHexPath(coastPlan) } : {},
  }
}
