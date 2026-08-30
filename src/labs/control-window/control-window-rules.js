import { HEX_DIRECTIONS, axialToWorld, directionVector, worldToAxial } from '../../sim/hex.js'
import { momentumSpeed } from '../../sim/solver.js'

export const CONTROL_WINDOW_RULE = 'control-window-motion-commitment-v1-candidate'
export const CONTROL_WINDOW_COMPOSITION = 'hex-lookup-control-v1'
export const CONTROL_WINDOW_TIMEBASE = 'window-internal-motion-zero-at-v1'
export const CONTROL_WINDOW_DEFAULT_THRESHOLD = 1
export const CONTROL_WINDOW_MAX_M = 3

const clampM = (value) => Math.max(0, Math.min(CONTROL_WINDOW_MAX_M, Math.round(Number(value) || 0)))
const cloneHex = (hex) => ({ q: hex.q, r: hex.r })

function directionIndex(axisId) {
  return HEX_DIRECTIONS.findIndex((entry) => entry.id === axisId)
}

function axialAngleSteps(a, b) {
  const ai = directionIndex(a)
  const bi = directionIndex(b)
  if (ai < 0 || bi < 0) return 0
  const raw = Math.abs(ai - bi)
  return Math.min(raw, 6 - raw)
}

function nearestAxis(vector) {
  const magnitude = Math.hypot(vector.x, vector.z)
  if (magnitude < 1e-6) return null
  const source = { x: vector.x / magnitude, z: vector.z / magnitude }
  let best = HEX_DIRECTIONS[0].id
  let bestDot = -Infinity
  for (const entry of HEX_DIRECTIONS) {
    const direction = directionVector(entry.id)
    const dot = direction.x * source.x + direction.z * source.z
    if (dot > bestDot) {
      bestDot = dot
      best = entry.id
    }
  }
  return best
}

function velocityFor(axisId, momentum) {
  const m = clampM(momentum)
  if (!axisId || m <= 0) return { x: 0, z: 0 }
  const direction = directionVector(axisId)
  const speed = momentumSpeed(m)
  return { x: direction.x * speed, z: direction.z * speed }
}

export function makeControlWindowState({ hex = { q: 0, r: 0 }, axisId = 'E', momentum = 0, worldAt = 0 } = {}) {
  const m = clampM(momentum)
  return {
    position: axialToWorld(hex),
    axisId: axisId || null,
    momentumLevel: m,
    velocity: velocityFor(axisId, m),
    worldAt,
  }
}

export function stateMomentum(state) {
  if (Number.isFinite(state?.momentumLevel)) return clampM(state.momentumLevel)
  return 0
}

export function hexLookupControl({ existingM, existingAxis, incomingM = 1, incomingAxis }) {
  const beforeM = clampM(existingM)
  const sourceM = clampM(incomingM)
  if (sourceM <= 0 || !incomingAxis) return { momentum: beforeM, axisId: existingAxis ?? null, angleSteps: 0 }
  if (beforeM <= 0 || !existingAxis) return { momentum: sourceM, axisId: incomingAxis, angleSteps: 0 }

  const steps = axialAngleSteps(existingAxis, incomingAxis)
  let momentum
  if (steps === 0) momentum = beforeM + sourceM
  else if (steps === 1) momentum = Math.max(beforeM, sourceM) + Math.ceil(Math.min(beforeM, sourceM) / 2)
  else if (steps === 2) momentum = Math.max(beforeM, sourceM)
  else momentum = Math.abs(beforeM - sourceM)

  const existing = directionVector(existingAxis)
  const incoming = directionVector(incomingAxis)
  const vector = {
    x: existing.x * beforeM + incoming.x * sourceM,
    z: existing.z * beforeM + incoming.z * sourceM,
  }
  const normalizedM = clampM(momentum)
  return {
    momentum: normalizedM,
    axisId: normalizedM <= 0 ? existingAxis : nearestAxis(vector) ?? (beforeM >= sourceM ? existingAxis : incomingAxis),
    angleSteps: steps,
  }
}

function cellPath(startHex, axisId, steps) {
  const direction = HEX_DIRECTIONS.find((entry) => entry.id === axisId)
  if (!direction || steps <= 0) return [cloneHex(startHex)]
  const path = [cloneHex(startHex)]
  let cell = cloneHex(startHex)
  for (let index = 0; index < steps; index += 1) {
    cell = { q: cell.q + direction.q, r: cell.r + direction.r }
    path.push(cloneHex(cell))
  }
  return path
}

function samplesForPath(path, axisId, startM, endM) {
  const segments = Math.max(1, path.length - 1)
  return path.map((hex, index) => {
    const t = index / segments
    const level = clampM(Math.round(startM + (endM - startM) * t))
    return {
      t,
      position: axialToWorld(hex),
      velocity: velocityFor(axisId, level),
      axisId,
      momentumLevel: level,
    }
  })
}

function planFromPath({ state, path, axisId, finalM, atCost, kind, summary, extra = {} }) {
  const beforeM = stateMomentum(state)
  const finalHex = path.at(-1) ?? worldToAxial(state.position)
  const finalState = makeControlWindowState({
    hex: finalHex,
    axisId,
    momentum: finalM,
    worldAt: state.worldAt + atCost,
  })
  return {
    valid: true,
    kind,
    samples: samplesForPath(path, axisId, beforeM, finalM),
    traversedCells: path.map(cloneHex),
    finalState,
    beforeM,
    finalM: clampM(finalM),
    axisBefore: state.axisId ?? null,
    axisAfter: axisId ?? null,
    atCost,
    destinationDriven: true,
    spatialMode: 'discrete',
    collisions: [],
    actorTrajectories: {},
    actorPlaybackWindows: {},
    playerPlaybackEnd: 1,
    summary,
    controlWindowRule: CONTROL_WINDOW_RULE,
    ...extra,
  }
}

export function controlWindowChoices(momentum) {
  const m = stateMomentum({ momentumLevel: momentum })
  return Array.from({ length: m + 1 }, (_, index) => m - index)
}

export function persistentToWindowPlan({ state, threshold = CONTROL_WINDOW_DEFAULT_THRESHOLD }) {
  const beforeM = stateMomentum(state)
  const targetM = Math.min(beforeM, clampM(threshold))
  const steps = Math.max(0, beforeM - targetM)
  const startHex = worldToAxial(state.position)
  const path = cellPath(startHex, state.axisId, steps)
  return planFromPath({
    state,
    path,
    axisId: state.axisId,
    finalM: targetM,
    atCost: steps > 0 ? 1 : 0,
    kind: 'persistent-to-window',
    summary: steps > 0
      ? `Persistent Motion · M${beforeM} → M${targetM} · ${steps} Cell / 1 AT`
      : `Already inside Control Window · M${beforeM}`,
    extra: { threshold: clampM(threshold), localWindowMotion: false },
  })
}

export function localInterventionPlan({ state, targetM }) {
  const beforeM = stateMomentum(state)
  const normalizedTarget = Math.max(0, Math.min(beforeM, clampM(targetM)))
  const steps = beforeM - normalizedTarget
  const startHex = worldToAxial(state.position)
  const path = cellPath(startHex, state.axisId, steps)
  return planFromPath({
    state,
    path,
    axisId: state.axisId,
    finalM: normalizedTarget,
    atCost: 0,
    kind: 'window-local-motion',
    summary: `Window-local Motion · M${beforeM} → M${normalizedTarget} · ${steps} Cell · +0 AT`,
    extra: { localWindowMotion: true, timebaseRule: CONTROL_WINDOW_TIMEBASE },
  })
}

export function actionPlan({ state, actionId, aimAxis }) {
  const beforeM = stateMomentum(state)
  const axisBefore = state.axisId ?? null
  const startHex = worldToAxial(state.position)
  if (!['move', 'drive'].includes(actionId)) return { valid: false, reason: `Unknown Control Window action: ${actionId}` }
  if (!HEX_DIRECTIONS.some((entry) => entry.id === aimAxis)) return { valid: false, reason: 'Choose a Hex direction.' }

  // Both cards inject the same M1 control vector into the current commitment.
  // Their difference is the card-authored travel profile inside this 1 AT.
  const composition = hexLookupControl({
    existingM: beforeM,
    existingAxis: axisBefore,
    incomingM: 1,
    incomingAxis: aimAxis,
  })
  const effectiveM = composition.momentum
  const axisAfter = composition.axisId ?? aimAxis

  // Preserve the useful pre-v1 bootstrap: after an Axis is already established,
  // an aligned M0 Move can create the first persistent M1 window.
  const alignedM0Move = actionId === 'move' && beforeM === 0 && axisBefore && axisBefore === aimAxis
  const travelSteps = effectiveM <= 0 ? 0 : actionId === 'drive' ? effectiveM : 1
  const finalM = alignedM0Move ? 1 : Math.max(0, effectiveM - 1)
  const path = cellPath(startHex, axisAfter, travelSteps)
  const label = actionId === 'drive' ? 'Drive' : 'Move'

  return planFromPath({
    state,
    path,
    axisId: axisAfter,
    finalM,
    atCost: 1,
    kind: `control-action-${actionId}`,
    summary: `${label} · Hex Lookup M${beforeM}+M1 → effective M${effectiveM} · Travel ${travelSteps} · final M${finalM} · 1 AT`,
    extra: {
      actionId,
      effectiveM,
      travelSteps,
      composition,
      compositionRule: CONTROL_WINDOW_COMPOSITION,
      actionProfile: actionId === 'drive' ? 'drive-travel-by-effective-m-v1' : 'move-fixed-travel1-v1',
      alignedM0Move,
    },
  })
}

export function phaseForState(state, threshold = CONTROL_WINDOW_DEFAULT_THRESHOLD) {
  const m = stateMomentum(state)
  if (m <= clampM(threshold)) return m === 0 ? 'ready' : 'control-window'
  return 'persistent'
}
