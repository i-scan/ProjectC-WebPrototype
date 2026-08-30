import {
  HEX_DIRECTIONS,
  axialDistance,
  axialKey,
  axialToWorld,
  directionVector,
  worldToAxial,
  worldToAxialFraction,
} from '../../sim/hex.js'
import { runCellMotion } from '../../sim/cell-motion.js'
import { composeIncomingMomentum, HEX_LOOKUP_COMPOSITION } from '../../sim/conflict.js'
import { momentumSpeed } from '../../sim/solver.js'

export const CONTROL_WINDOW_RULE = 'control-window-motion-commitment-v2-candidate'
export const CONTROL_WINDOW_COMPOSITION = 'hex-lookup-control-v1'
export const CONTROL_WINDOW_TIMEBASE = 'window-internal-motion-zero-at-v1'
export const CONTROL_WINDOW_COLLISION_RULE = 'control-window-strike-forced-move-v1'
export const CONTROL_WINDOW_WANDER_RULE = 'two-actor-deterministic-wander-v1'
export const CONTROL_WINDOW_DEFAULT_THRESHOLD = 1
export const CONTROL_WINDOW_MAX_M = 3

const clampM = (value) => Math.max(0, Math.min(CONTROL_WINDOW_MAX_M, Math.round(Number(value) || 0)))
const clampActorM = (value) => Math.max(0, Math.min(4, Math.round(Number(value) || 0)))
const cloneHex = (hex) => ({ q: hex.q, r: hex.r })
const sameHex = (a, b) => Boolean(a && b && a.q === b.q && a.r === b.r)

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

function speedForM(level) {
  const m = clampActorM(level)
  return m <= 3 ? momentumSpeed(m) : momentumSpeed(3) + 0.9
}

function velocityFor(axisId, momentum) {
  const m = clampActorM(momentum)
  if (!axisId || m <= 0) return { x: 0, z: 0 }
  const direction = directionVector(axisId)
  const speed = speedForM(m)
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

function actorMomentum(actor) {
  return clampActorM(actor?.momentumLevel ?? 0)
}

function cloneActor(actor) {
  const momentum = actorMomentum(actor)
  return {
    ...actor,
    hex: cloneHex(actor.hex),
    axisId: actor.axisId ?? null,
    momentumLevel: momentum,
    velocity: velocityFor(actor.axisId, momentum),
  }
}

export function createControlWindowEnemies() {
  return [
    {
      id: 'cw-wanderer-a',
      label: 'Wanderer A',
      hex: { q: 2, r: -1 },
      axisId: 'SW',
      momentumLevel: 0,
      velocity: { x: 0, z: 0 },
    },
    {
      id: 'cw-wanderer-b',
      label: 'Wanderer B',
      hex: { q: -2, r: 2 },
      axisId: 'NE',
      momentumLevel: 0,
      velocity: { x: 0, z: 0 },
    },
  ]
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

function fractionalHex(point) {
  const value = worldToAxialFraction(point)
  const snap = (number) => Math.abs(number - Math.round(number)) < 1e-6 ? Math.round(number) : number
  return { q: snap(value.q), r: snap(value.r) }
}

function mergeTrajectory(target, addition) {
  for (const point of addition) {
    const previous = target.at(-1)
    if (!previous || Math.abs(previous.q - point.q) > 1e-6 || Math.abs(previous.r - point.r) > 1e-6) target.push({ ...point })
  }
}

function trajectoryFromTimeline(timeline = []) {
  const result = []
  for (const record of timeline) {
    if (!record?.position) continue
    const point = fractionalHex(record.position)
    const previous = result.at(-1)
    if (!previous || Math.abs(previous.q - point.q) > 1e-6 || Math.abs(previous.r - point.r) > 1e-6) result.push(point)
  }
  return result
}

function samplesFromMotion(motion, startM, finalM, fallbackAxis) {
  const timeline = motion?.timeline?.length
    ? motion.timeline
    : [{ position: axialToWorld(motion?.startHex ?? { q: 0, r: 0 }), axisId: fallbackAxis }]
  return timeline.map((record, index) => {
    const t = index / Math.max(1, timeline.length - 1)
    const level = clampM(Math.round(startM + (finalM - startM) * t))
    const axisId = record.axisId ?? fallbackAxis ?? null
    return {
      t,
      position: { ...record.position },
      velocity: velocityFor(axisId, level),
      axisId,
      momentumLevel: level,
    }
  })
}

function obstacleAt(obstacles, hex) {
  return obstacles.find((entry) => sameHex(entry.hex, hex)) ?? null
}

function appendSurfaceEvents(actorId, motion, conflictEvents) {
  for (const collision of motion?.collisions ?? []) {
    conflictEvents.push({
      kind: 'surface-reflection',
      actorId,
      obstacleId: collision.obstacleId ?? null,
      obstacleKind: collision.kind,
      from: collision.from ? cloneHex(collision.from) : null,
      attemptedCell: collision.attemptedCell ? cloneHex(collision.attemptedCell) : null,
      axisBefore: collision.axisBefore,
      axisAfter: collision.axisAfter,
      beforeM: collision.beforeM,
      afterM: collision.afterM,
      wallCellPivot: Boolean(collision.wallCellPivot),
      wallCellTravelCost: collision.wallCellTravelCost ?? 0,
      wallAxis: collision.wallAxis ?? null,
    })
  }
}

function resolveMotionPacket({
  state,
  startM,
  axisId,
  travelBudget,
  atCost,
  kind,
  summary,
  decayMode,
  threshold,
  actionId = null,
  effectiveM = null,
  obstacles = [],
  actors = [],
  boardRadius = 6,
  wanderEnabled = false,
  wanderSeed = 1,
  extra = {},
}) {
  const startHex = worldToAxial(state.position)
  const actorStates = actors.map(cloneActor)
  const actorById = new Map(actorStates.map((actor) => [actor.id, actor]))
  const occupancy = new Map(actorStates.map((actor) => [axialKey(actor.hex), actor.id]))
  const actorTrajectories = Object.fromEntries(actorStates.map((actor) => [actor.id, [cloneHex(actor.hex)]]))
  const actorPlaybackWindows = {}
  const conflictEvents = []
  const struckActorIds = new Set()
  let playerConflict = null
  let logicalM = clampActorM(startM)
  let entryIndex = 0

  const noteActorMotion = (actorId, motion, hit = true) => {
    mergeTrajectory(actorTrajectories[actorId], trajectoryFromTimeline(motion?.timeline ?? []))
    const moved = (actorTrajectories[actorId]?.length ?? 0) > 1
    if (moved) actorPlaybackWindows[actorId] = hit ? { start: 0.46, end: 0.9 } : { start: 0.08, end: 0.58 }
    appendSurfaceEvents(actorId, motion, conflictEvents)
  }

  const forceActor = (actorId, incomingM, incomingAxis, depth = 0) => {
    const actor = actorById.get(actorId)
    const power = clampActorM(incomingM)
    if (!actor || power <= 0 || depth > actorStates.length + 4) return { vacated: false, motion: null }

    struckActorIds.add(actorId)
    const actorStart = cloneHex(actor.hex)
    let actorM = power
    let forcedUseResolved = false
    actor.axisId = incomingAxis
    actor.momentumLevel = power
    actor.velocity = velocityFor(incomingAxis, power)

    const motion = runCellMotion({
      startHex: actorStart,
      initialAxisId: incomingAxis,
      initialMomentum: Math.min(3, power),
      travelBudget: power,
      authoredPathCells: [],
      obstacles,
      boardRadius,
      capRemainingByMomentum: true,
      reflectionMomentum: ({ momentum }) => ({ momentum, restitution: null }),
      onEnterCell: ({ from, to, axisId: entryAxis }) => {
        if (!forcedUseResolved) {
          actorM = Math.max(0, actorM - 1)
          forcedUseResolved = true
        }

        if (!sameHex(from, to) && sameHex(to, startHex)) {
          return { allowed: false, stop: true, momentum: Math.min(3, actorM), reason: 'reserved-player-start' }
        }

        const occupantId = occupancy.get(axialKey(to))
        if (occupantId && occupantId !== actorId) {
          const target = actorById.get(occupantId)
          const transferM = actorM
          const composition = composeIncomingMomentum({
            target,
            incomingM: transferM,
            incomingAxis: entryAxis,
            mode: HEX_LOOKUP_COMPOSITION,
          })
          conflictEvents.push({
            kind: 'cell-conflict',
            sourceActorId: actorId,
            targetActorId: occupantId,
            impactM: transferM,
            power: composition.momentum,
            cell: cloneHex(to),
            chained: true,
            contactBehavior: 'Strike',
          })
          actorM = 0
          if (transferM <= 0 || composition.momentum <= 0) {
            return { allowed: false, stop: true, momentum: 0, reason: 'chain-no-transfer' }
          }

          target.axisId = composition.axisId
          target.momentumLevel = composition.momentum
          target.velocity = velocityFor(composition.axisId, composition.momentum)
          const child = forceActor(occupantId, composition.momentum, composition.axisId, depth + 1)
          const targetStillHere = occupancy.get(axialKey(to)) === occupantId
          if (!child.vacated || targetStillHere) {
            return { allowed: false, stop: true, momentum: 0, reason: 'chain-target-blocked' }
          }

          occupancy.delete(axialKey(from))
          occupancy.set(axialKey(to), actorId)
          return { allowed: true, stop: true, momentum: 0, reason: 'chain-contact-stop' }
        }

        if (!sameHex(from, to)) {
          occupancy.delete(axialKey(from))
          occupancy.set(axialKey(to), actorId)
        }
        return { allowed: true, momentum: Math.min(3, actorM) }
      },
    })

    if (motion.stopReason === 'surface-stop') actorM = 0
    actor.hex = cloneHex(motion.finalHex)
    actor.axisId = motion.axisAfter ?? incomingAxis
    actor.momentumLevel = actorM
    actor.velocity = velocityFor(actor.axisId, actorM)
    noteActorMotion(actorId, motion, true)
    return { vacated: !sameHex(actorStart, actor.hex), motion }
  }

  const receiveStrike = (targetActorId, incomingM, incomingAxis) => {
    const target = actorById.get(targetActorId)
    if (!target) return { vacated: false, composition: null, motion: null }
    const targetBeforeM = actorMomentum(target)
    const composition = composeIncomingMomentum({
      target,
      incomingM,
      incomingAxis,
      mode: HEX_LOOKUP_COMPOSITION,
    })
    conflictEvents.push({
      kind: 'momentum-transfer',
      sourceActorId: 'player',
      targetActorId,
      sourceBeforeM: incomingM,
      sourceAfterM: 0,
      targetBeforeM,
      targetAfterM: composition.momentum,
      directionId: incomingAxis,
      model: CONTROL_WINDOW_COLLISION_RULE,
      composition,
    })
    target.axisId = composition.axisId
    target.momentumLevel = composition.momentum
    target.velocity = velocityFor(composition.axisId, composition.momentum)
    const forced = composition.momentum > 0 && composition.axisId
      ? forceActor(targetActorId, composition.momentum, composition.axisId, 0)
      : { vacated: false, motion: null }
    return { ...forced, composition, targetBeforeM }
  }

  const motion = runCellMotion({
    startHex,
    initialAxisId: axisId,
    initialMomentum: Math.min(3, logicalM),
    travelBudget,
    authoredPathCells: [],
    obstacles,
    boardRadius,
    capRemainingByMomentum: true,
    reflectionMomentum: ({ momentum }) => ({ momentum, restitution: null }),
    onEnterCell: ({ to, axisId: entryAxis }) => {
      const targetActorId = occupancy.get(axialKey(to))
      if (targetActorId) {
        const impactM = logicalM
        const attempted = receiveStrike(targetActorId, impactM, entryAxis)
        const targetStillHere = occupancy.get(axialKey(to)) === targetActorId
        logicalM = 0
        const resolved = impactM > 0 && attempted.vacated && !targetStillHere
        playerConflict = {
          targetActorId,
          impactM,
          resolved,
          directionId: entryAxis,
          composition: attempted.composition,
        }
        conflictEvents.unshift({
          kind: resolved ? 'cell-conflict' : 'cell-conflict-blocked',
          sourceActorId: 'player',
          targetActorId,
          impactM,
          power: attempted.composition?.momentum ?? 0,
          cell: cloneHex(to),
          chained: false,
          contactBehavior: 'Strike',
        })
        if (resolved) return { allowed: true, stop: true, momentum: 0, reason: 'strike-contact-stop' }
        return { allowed: false, stop: true, momentum: 0, reason: 'target-did-not-vacate' }
      }

      if (decayMode === 'action') {
        if (entryIndex === 0) {
          const consume = actionId === 'move' && !extra.alignedM0Move ? 1 : 0
          logicalM = Math.max(0, logicalM - consume)
        } else {
          logicalM = Math.max(0, logicalM - 1)
        }
      } else {
        logicalM = Math.max(0, logicalM - 1)
      }
      entryIndex += 1
      return { allowed: true, momentum: Math.min(3, logicalM) }
    },
  })

  if (motion.stopReason === 'surface-stop') logicalM = 0
  const finalAxis = motion.axisAfter ?? axisId ?? state.axisId ?? null
  const finalHex = cloneHex(motion.finalHex)

  let nextWanderSeed = Number.isFinite(wanderSeed) ? Math.floor(wanderSeed) >>> 0 : 1
  const advanceSeed = () => {
    nextWanderSeed = (Math.imul(nextWanderSeed, 1664525) + 1013904223) >>> 0
    return nextWanderSeed
  }

  if (atCost > 0 && wanderEnabled) {
    const playerFinalKey = axialKey(finalHex)
    actorStates.forEach((actor, actorIndex) => {
      if (struckActorIds.has(actor.id)) return
      const start = cloneHex(actor.hex)
      const offset = (advanceSeed() + actorIndex * 3) % HEX_DIRECTIONS.length
      let chosen = null
      for (let index = 0; index < HEX_DIRECTIONS.length; index += 1) {
        const direction = HEX_DIRECTIONS[(offset + index) % HEX_DIRECTIONS.length]
        const candidate = { q: start.q + direction.q, r: start.r + direction.r }
        if (axialDistance(candidate) > boardRadius) continue
        if (obstacleAt(obstacles, candidate)) continue
        if (axialKey(candidate) === playerFinalKey) continue
        const occupantId = occupancy.get(axialKey(candidate))
        if (occupantId && occupantId !== actor.id) continue
        chosen = { candidate, direction }
        break
      }
      if (!chosen) return
      occupancy.delete(axialKey(start))
      occupancy.set(axialKey(chosen.candidate), actor.id)
      actor.hex = cloneHex(chosen.candidate)
      actor.axisId = chosen.direction.id
      actor.momentumLevel = 0
      actor.velocity = { x: 0, z: 0 }
      mergeTrajectory(actorTrajectories[actor.id], [start, cloneHex(chosen.candidate)])
      actorPlaybackWindows[actor.id] = { start: 0.08, end: 0.58 }
    })
  }

  const finalState = makeControlWindowState({
    hex: finalHex,
    axisId: finalAxis,
    momentum: logicalM,
    worldAt: state.worldAt + atCost,
  })
  finalState.actors = actorStates.map(cloneActor)

  const samples = samplesFromMotion(motion, startM, logicalM, finalAxis)
  const traversedCells = [cloneHex(startHex), ...(motion.actualPath ?? []).map(cloneHex)]
  let resolvedSummary = summary
  if (motion.collisions?.length) resolvedSummary += ` · Wall reflection ${motion.reflectionCount || 0}`
  if (playerConflict) resolvedSummary += ` · Strike ${playerConflict.targetActorId} @ M${playerConflict.impactM}`

  return {
    valid: true,
    kind,
    samples,
    traversedCells,
    motionTrace: motion.trace ?? [],
    collisions: motion.collisions ?? [],
    finalState,
    beforeM: stateMomentum(state),
    finalM: clampM(logicalM),
    axisBefore: state.axisId ?? null,
    axisAfter: finalAxis,
    atCost,
    destinationDriven: true,
    spatialMode: 'discrete',
    actorStates: actorStates.map(cloneActor),
    actorTrajectories,
    actorPlaybackWindows,
    playerPlaybackEnd: playerConflict?.resolved ? 0.52 : 1,
    conflictEvents,
    cellConflict: playerConflict,
    summary: resolvedSummary,
    controlWindowRule: CONTROL_WINDOW_RULE,
    collisionRule: CONTROL_WINDOW_COLLISION_RULE,
    wanderRule: CONTROL_WINDOW_WANDER_RULE,
    wanderSeedAfter: nextWanderSeed,
    threshold: clampM(threshold),
    actionId,
    effectiveM,
    travelSteps: Math.max(0, traversedCells.length - 1),
    ...extra,
  }
}

export function controlWindowChoices(momentum) {
  const m = stateMomentum({ momentumLevel: momentum })
  return Array.from({ length: m + 1 }, (_, index) => m - index)
}

export function persistentToWindowPlan({
  state,
  threshold = CONTROL_WINDOW_DEFAULT_THRESHOLD,
  obstacles = [],
  actors = [],
  boardRadius = 6,
  wanderEnabled = false,
  wanderSeed = 1,
}) {
  const beforeM = stateMomentum(state)
  const targetM = Math.min(beforeM, clampM(threshold))
  const steps = Math.max(0, beforeM - targetM)
  if (steps === 0) {
    const currentHex = worldToAxial(state.position)
    const finalState = makeControlWindowState({ hex: currentHex, axisId: state.axisId, momentum: beforeM, worldAt: state.worldAt })
    finalState.actors = actors.map(cloneActor)
    return {
      valid: true,
      kind: 'persistent-to-window',
      samples: [{ t: 0, position: { ...state.position }, velocity: { ...state.velocity }, axisId: state.axisId }],
      traversedCells: [cloneHex(currentHex)],
      collisions: [],
      finalState,
      beforeM,
      finalM: beforeM,
      axisBefore: state.axisId ?? null,
      axisAfter: state.axisId ?? null,
      atCost: 0,
      actorStates: actors.map(cloneActor),
      actorTrajectories: Object.fromEntries(actors.map((actor) => [actor.id, [cloneHex(actor.hex)]])),
      actorPlaybackWindows: {},
      conflictEvents: [],
      summary: `Already inside Control Window · M${beforeM}`,
      threshold: clampM(threshold),
      wanderSeedAfter: wanderSeed,
      controlWindowRule: CONTROL_WINDOW_RULE,
    }
  }

  return resolveMotionPacket({
    state,
    startM: beforeM,
    axisId: state.axisId,
    travelBudget: steps,
    atCost: 1,
    kind: 'persistent-to-window',
    summary: `Persistent Motion · M${beforeM} → target M${targetM} · ${steps} Cell max / 1 AT`,
    decayMode: 'persistent',
    threshold,
    obstacles,
    actors,
    boardRadius,
    wanderEnabled,
    wanderSeed,
    extra: { localWindowMotion: false },
  })
}

export function localInterventionPlan({
  state,
  targetM,
  threshold = CONTROL_WINDOW_DEFAULT_THRESHOLD,
  obstacles = [],
  actors = [],
  boardRadius = 6,
  wanderSeed = 1,
}) {
  const beforeM = stateMomentum(state)
  const normalizedTarget = Math.max(0, Math.min(beforeM, clampM(targetM)))
  const steps = beforeM - normalizedTarget
  if (steps === 0) {
    return persistentToWindowPlan({ state, threshold: beforeM, obstacles, actors, boardRadius, wanderEnabled: false, wanderSeed })
  }
  return resolveMotionPacket({
    state,
    startM: beforeM,
    axisId: state.axisId,
    travelBudget: steps,
    atCost: 0,
    kind: 'window-local-motion',
    summary: `Window-local Motion · M${beforeM} → target M${normalizedTarget} · ${steps} Cell max · +0 AT`,
    decayMode: 'persistent',
    threshold,
    obstacles,
    actors,
    boardRadius,
    wanderEnabled: false,
    wanderSeed,
    extra: { localWindowMotion: true, timebaseRule: CONTROL_WINDOW_TIMEBASE, requestedTargetM: normalizedTarget },
  })
}

export function actionPlan({
  state,
  actionId,
  aimAxis,
  threshold = CONTROL_WINDOW_DEFAULT_THRESHOLD,
  obstacles = [],
  actors = [],
  boardRadius = 6,
  wanderEnabled = false,
  wanderSeed = 1,
}) {
  const beforeM = stateMomentum(state)
  const axisBefore = state.axisId ?? null
  if (!['move', 'drive'].includes(actionId)) return { valid: false, reason: `Unknown Control Window action: ${actionId}` }
  if (!HEX_DIRECTIONS.some((entry) => entry.id === aimAxis)) return { valid: false, reason: 'Choose a Hex direction.' }

  const composition = hexLookupControl({
    existingM: beforeM,
    existingAxis: axisBefore,
    incomingM: 1,
    incomingAxis: aimAxis,
  })
  const effectiveM = composition.momentum
  const axisAfter = composition.axisId ?? aimAxis
  const alignedM0Move = actionId === 'move' && beforeM === 0 && axisBefore && axisBefore === aimAxis

  const activeSteps = effectiveM > 0 ? 1 : 0
  const activeConsumesM = actionId === 'move' && !alignedM0Move
  const afterActiveM = Math.max(0, effectiveM - (activeSteps > 0 && activeConsumesM ? 1 : 0))
  const autoSteps = Math.max(0, afterActiveM - clampM(threshold))
  const travelBudget = activeSteps + autoSteps
  const predictedFinalM = Math.max(0, afterActiveM - autoSteps)
  const label = actionId === 'drive' ? 'Drive' : 'Move'
  const profile = actionId === 'drive'
    ? 'drive-active1-preserve-m-then-auto-to-window-v2'
    : 'move-active1-use1-then-auto-to-window-v2'

  return resolveMotionPacket({
    state,
    startM: effectiveM,
    axisId: axisAfter,
    travelBudget,
    atCost: 1,
    kind: `control-action-${actionId}`,
    summary: `${label} · Hex Lookup M${beforeM}+M1 → effective M${effectiveM} · active ${activeSteps} + auto ${autoSteps} · predicted M${predictedFinalM} · 1 AT`,
    decayMode: 'action',
    threshold,
    actionId,
    effectiveM,
    obstacles,
    actors,
    boardRadius,
    wanderEnabled,
    wanderSeed,
    extra: {
      composition,
      compositionRule: CONTROL_WINDOW_COMPOSITION,
      actionProfile: profile,
      alignedM0Move,
      activeSteps,
      activeConsumesM,
      afterActiveM,
      autoSteps,
      predictedFinalM,
    },
  })
}

export function phaseForState(state, threshold = CONTROL_WINDOW_DEFAULT_THRESHOLD) {
  const m = stateMomentum(state)
  if (m <= clampM(threshold)) return m === 0 ? 'ready' : 'control-window'
  return 'persistent'
}
