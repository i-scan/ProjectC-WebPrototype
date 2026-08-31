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

export const CONTROL_WINDOW_RULE = 'control-window-motion-commitment-v3-candidate'
export const CONTROL_WINDOW_COMPOSITION = 'hex-lookup-control-v1'
export const CONTROL_WINDOW_TIMEBASE = 'window-internal-motion-zero-at-v1'
export const CONTROL_WINDOW_COLLISION_RULE = 'control-window-bidirectional-strike-v2'
export const CONTROL_WINDOW_WANDER_RULE = 'two-actor-wander-contact-v2'
export const CONTROL_WINDOW_DEFAULT_THRESHOLD = 1
export const CONTROL_WINDOW_MAX_M = 3
export const CONTROL_WINDOW_MIN_RADIUS = 4
export const CONTROL_WINDOW_MAX_RADIUS = 10

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
    const score = direction.x * source.x + direction.z * source.z
    if (score > bestDot) {
      bestDot = score
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
  return clampM(state?.momentumLevel ?? 0)
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

export function controlWindowChoices(momentum) {
  const m = clampM(momentum)
  return Array.from({ length: m + 1 }, (_, index) => m - index)
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
    const ratio = index / Math.max(1, timeline.length - 1)
    const level = clampActorM(Math.round(startM + (finalM - startM) * ratio))
    const axisId = record.axisId ?? fallbackAxis ?? null
    return {
      t: ratio,
      position: { ...record.position },
      velocity: velocityFor(axisId, level),
      axisId,
      momentumLevel: Math.min(3, level),
    }
  })
}

function appendSamples(target, addition) {
  for (const sample of addition) {
    const previous = target.at(-1)
    if (!previous || Math.hypot(previous.position.x - sample.position.x, previous.position.z - sample.position.z) > 0.001) {
      target.push({ ...sample, position: { ...sample.position }, velocity: { ...sample.velocity } })
    }
  }
}

function normalizeSampleTimes(samples) {
  if (!samples.length) return samples
  return samples.map((sample, index) => ({ ...sample, t: index / Math.max(1, samples.length - 1) }))
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
  const initialPlayerHex = worldToAxial(state.position)
  const actorStates = actors.map(cloneActor)
  const actorById = new Map(actorStates.map((actor) => [actor.id, actor]))
  const occupancy = new Map(actorStates.map((actor) => [axialKey(actor.hex), actor.id]))
  const actorTrajectories = Object.fromEntries(actorStates.map((actor) => [actor.id, [cloneHex(actor.hex)]]))
  const actorPlaybackWindows = {}
  const conflictEvents = []
  const struckActorIds = new Set()
  let playerConflict = null
  let incomingPlayerConflict = null
  let logicalM = clampActorM(startM)
  let playerAxis = axisId ?? state.axisId ?? null
  let playerHex = cloneHex(initialPlayerHex)
  let entryIndex = 0
  const playerSamples = []

  const noteActorMotion = (actorId, motion, hit = true) => {
    mergeTrajectory(actorTrajectories[actorId], trajectoryFromTimeline(motion?.timeline ?? []))
    if ((actorTrajectories[actorId]?.length ?? 0) > 1) {
      actorPlaybackWindows[actorId] = hit ? { start: 0.44, end: 0.9 } : { start: 0.08, end: 0.58 }
    }
    appendSurfaceEvents(actorId, motion, conflictEvents)
  }

  const forceActor = (actorId, incomingM, incomingAxis, reservedPlayerHex, depth = 0) => {
    const actor = actorById.get(actorId)
    const power = clampActorM(incomingM)
    if (!actor || power <= 0 || depth > actorStates.length + 5) return { vacated: false, motion: null, composition: null }

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
        if (reservedPlayerHex && !sameHex(from, to) && sameHex(to, reservedPlayerHex)) {
          return { allowed: false, stop: true, momentum: Math.min(3, actorM), reason: 'reserved-player-cell' }
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
            kind: transferM > 0 ? 'cell-conflict' : 'cell-conflict-blocked',
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
          const child = forceActor(occupantId, composition.momentum, composition.axisId, reservedPlayerHex, depth + 1)
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

  const receivePlayerStrike = (targetActorId, incomingM, incomingAxis, reservedPlayerHex) => {
    const target = actorById.get(targetActorId)
    if (!target) return { vacated: false, composition: null, motion: null }
    const targetBeforeM = actorMomentum(target)
    const composition = composeIncomingMomentum({ target, incomingM, incomingAxis, mode: HEX_LOOKUP_COMPOSITION })
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
      ? forceActor(targetActorId, composition.momentum, composition.axisId, reservedPlayerHex, 0)
      : { vacated: false, motion: null }
    return { ...forced, composition, targetBeforeM }
  }

  const primaryMotion = runCellMotion({
    startHex: initialPlayerHex,
    initialAxisId: playerAxis,
    initialMomentum: Math.min(3, logicalM),
    travelBudget,
    authoredPathCells: [],
    obstacles,
    boardRadius,
    capRemainingByMomentum: true,
    reflectionMomentum: ({ momentum }) => ({ momentum, restitution: null }),
    onEnterCell: ({ from, to, axisId: entryAxis }) => {
      const targetActorId = occupancy.get(axialKey(to))
      if (targetActorId) {
        const impactM = logicalM
        const attempted = receivePlayerStrike(targetActorId, impactM, entryAxis, from)
        const targetStillHere = occupancy.get(axialKey(to)) === targetActorId
        logicalM = 0
        const resolved = impactM > 0 && attempted.vacated && !targetStillHere
        playerConflict = {
          sourceActorId: 'player',
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
        return resolved
          ? { allowed: true, stop: true, momentum: 0, reason: 'strike-contact-stop' }
          : { allowed: false, stop: true, momentum: 0, reason: 'target-did-not-vacate' }
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

  if (primaryMotion.stopReason === 'surface-stop') logicalM = 0
  playerHex = cloneHex(primaryMotion.finalHex)
  playerAxis = primaryMotion.axisAfter ?? playerAxis
  appendSamples(playerSamples, samplesFromMotion(primaryMotion, startM, logicalM, playerAxis))
  appendSurfaceEvents('player', primaryMotion, conflictEvents)

  const forcePlayer = (incomingM, incomingAxis) => {
    const power = clampActorM(incomingM)
    const start = cloneHex(playerHex)
    if (power <= 0 || !incomingAxis) {
      logicalM = power
      playerAxis = incomingAxis ?? playerAxis
      return { vacated: false, motion: null, startHex: start }
    }

    let forcedM = power
    let forcedUseResolved = false
    const motion = runCellMotion({
      startHex: start,
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
          forcedM = Math.max(0, forcedM - 1)
          forcedUseResolved = true
        }
        const targetActorId = occupancy.get(axialKey(to))
        if (targetActorId) {
          const impactM = forcedM
          const attempted = receivePlayerStrike(targetActorId, impactM, entryAxis, from)
          const targetStillHere = occupancy.get(axialKey(to)) === targetActorId
          forcedM = 0
          const resolved = impactM > 0 && attempted.vacated && !targetStillHere
          conflictEvents.push({
            kind: resolved ? 'cell-conflict' : 'cell-conflict-blocked',
            sourceActorId: 'player',
            targetActorId,
            impactM,
            power: attempted.composition?.momentum ?? 0,
            cell: cloneHex(to),
            chained: true,
            contactBehavior: 'Strike',
            causedByIncomingPlayerKnockback: true,
          })
          return resolved
            ? { allowed: true, stop: true, momentum: 0, reason: 'forced-player-chain-stop' }
            : { allowed: false, stop: true, momentum: 0, reason: 'forced-player-chain-blocked' }
        }
        return { allowed: true, momentum: Math.min(3, forcedM) }
      },
    })

    if (motion.stopReason === 'surface-stop') forcedM = 0
    playerHex = cloneHex(motion.finalHex)
    playerAxis = motion.axisAfter ?? incomingAxis
    logicalM = forcedM
    appendSamples(playerSamples, samplesFromMotion(motion, power, forcedM, playerAxis))
    appendSurfaceEvents('player', motion, conflictEvents)
    return { vacated: !sameHex(start, playerHex), motion, startHex: start }
  }

  let nextWanderSeed = Number.isFinite(wanderSeed) ? Math.floor(wanderSeed) >>> 0 : 1
  const advanceSeed = () => {
    nextWanderSeed = (Math.imul(nextWanderSeed, 1664525) + 1013904223) >>> 0
    return nextWanderSeed
  }

  if (atCost > 0 && wanderEnabled) {
    for (let actorIndex = 0; actorIndex < actorStates.length; actorIndex += 1) {
      const actor = actorStates[actorIndex]
      if (struckActorIds.has(actor.id)) continue
      const start = cloneHex(actor.hex)
      const offset = (advanceSeed() + actorIndex * 3) % HEX_DIRECTIONS.length
      let chosen = null

      for (let index = 0; index < HEX_DIRECTIONS.length; index += 1) {
        const direction = HEX_DIRECTIONS[(offset + index) % HEX_DIRECTIONS.length]
        const candidate = { q: start.q + direction.q, r: start.r + direction.r }
        if (axialDistance(candidate) > boardRadius) continue
        if (obstacleAt(obstacles, candidate)) continue
        const occupantId = occupancy.get(axialKey(candidate))
        if (occupantId && occupantId !== actor.id) continue
        chosen = { candidate, direction }
        break
      }
      if (!chosen) continue

      if (sameHex(chosen.candidate, playerHex)) {
        const incomingM = 1
        const playerBeforeM = logicalM
        const playerBeforeAxis = playerAxis
        const composition = composeIncomingMomentum({
          target: { momentumLevel: playerBeforeM, axisId: playerBeforeAxis },
          incomingM,
          incomingAxis: chosen.direction.id,
          mode: HEX_LOOKUP_COMPOSITION,
        })
        conflictEvents.push({
          kind: 'momentum-transfer',
          sourceActorId: actor.id,
          targetActorId: 'player',
          sourceBeforeM: incomingM,
          sourceAfterM: 0,
          targetBeforeM: playerBeforeM,
          targetAfterM: composition.momentum,
          directionId: chosen.direction.id,
          model: CONTROL_WINDOW_COLLISION_RULE,
          composition,
          enemyInitiated: true,
        })

        logicalM = composition.momentum
        playerAxis = composition.axisId ?? playerAxis
        const forced = forcePlayer(composition.momentum, composition.axisId)
        const resolved = composition.momentum > 0 && forced.vacated
        incomingPlayerConflict = {
          sourceActorId: actor.id,
          targetActorId: 'player',
          impactM: incomingM,
          playerBeforeM,
          playerAfterM: logicalM,
          resolved,
          directionId: chosen.direction.id,
          composition,
        }
        conflictEvents.push({
          kind: resolved ? 'cell-conflict' : 'cell-conflict-blocked',
          sourceActorId: actor.id,
          targetActorId: 'player',
          impactM: incomingM,
          power: composition.momentum,
          cell: cloneHex(chosen.candidate),
          chained: false,
          contactBehavior: 'Strike',
          enemyInitiated: true,
        })

        actor.axisId = chosen.direction.id
        actor.momentumLevel = 0
        actor.velocity = { x: 0, z: 0 }
        if (resolved) {
          occupancy.delete(axialKey(start))
          occupancy.set(axialKey(forced.startHex), actor.id)
          actor.hex = cloneHex(forced.startHex)
          mergeTrajectory(actorTrajectories[actor.id], [start, cloneHex(forced.startHex)])
          actorPlaybackWindows[actor.id] = { start: 0.08, end: 0.42 }
        }
        continue
      }

      occupancy.delete(axialKey(start))
      occupancy.set(axialKey(chosen.candidate), actor.id)
      actor.hex = cloneHex(chosen.candidate)
      actor.axisId = chosen.direction.id
      actor.momentumLevel = 0
      actor.velocity = { x: 0, z: 0 }
      mergeTrajectory(actorTrajectories[actor.id], [start, cloneHex(chosen.candidate)])
      actorPlaybackWindows[actor.id] = { start: 0.08, end: 0.58 }
    }
  }

  const finalState = makeControlWindowState({
    hex: playerHex,
    axisId: playerAxis,
    momentum: logicalM,
    worldAt: state.worldAt + atCost,
  })
  finalState.actors = actorStates.map(cloneActor)

  const traversedCells = normalizeSampleTimes(playerSamples).map((sample) => worldToAxial(sample.position))
  const uniqueTraversed = []
  for (const hex of traversedCells.length ? traversedCells : [initialPlayerHex]) {
    const previous = uniqueTraversed.at(-1)
    if (!previous || !sameHex(previous, hex)) uniqueTraversed.push(cloneHex(hex))
  }

  let resolvedSummary = summary
  if (primaryMotion.collisions?.length) resolvedSummary += ` · Wall reflection ${primaryMotion.reflectionCount || 0}`
  if (playerConflict) resolvedSummary += ` · Strike ${playerConflict.targetActorId} @ M${playerConflict.impactM}`
  if (incomingPlayerConflict) resolvedSummary += ` · ${incomingPlayerConflict.sourceActorId} struck player @ M1`

  return {
    valid: true,
    kind,
    samples: normalizeSampleTimes(playerSamples),
    traversedCells: uniqueTraversed,
    motionTrace: primaryMotion.trace ?? [],
    collisions: conflictEvents.filter((entry) => entry.kind === 'surface-reflection'),
    finalState,
    beforeM: stateMomentum(state),
    finalM: clampM(logicalM),
    axisBefore: state.axisId ?? null,
    axisAfter: playerAxis,
    atCost,
    destinationDriven: true,
    spatialMode: 'discrete',
    actorStates: actorStates.map(cloneActor),
    actorTrajectories,
    actorPlaybackWindows,
    playerPlaybackEnd: 1,
    conflictEvents,
    cellConflict: playerConflict ?? incomingPlayerConflict,
    incomingPlayerConflict,
    summary: resolvedSummary,
    controlWindowRule: CONTROL_WINDOW_RULE,
    collisionRule: CONTROL_WINDOW_COLLISION_RULE,
    wanderRule: CONTROL_WINDOW_WANDER_RULE,
    wanderSeedAfter: nextWanderSeed,
    threshold: clampM(threshold),
    actionId,
    effectiveM,
    travelSteps: Math.max(0, uniqueTraversed.length - 1),
    ...extra,
  }
}

function noMotionWindowPlan({ state, actors, wanderSeed, threshold }) {
  const currentHex = worldToAxial(state.position)
  const finalState = makeControlWindowState({
    hex: currentHex,
    axisId: state.axisId,
    momentum: stateMomentum(state),
    worldAt: state.worldAt,
  })
  finalState.actors = actors.map(cloneActor)
  return {
    valid: true,
    kind: 'already-in-window',
    samples: [{ t: 0, position: { ...state.position }, velocity: { ...state.velocity }, axisId: state.axisId, momentumLevel: stateMomentum(state) }],
    traversedCells: [cloneHex(currentHex)],
    collisions: [],
    finalState,
    beforeM: stateMomentum(state),
    finalM: stateMomentum(state),
    axisBefore: state.axisId ?? null,
    axisAfter: state.axisId ?? null,
    atCost: 0,
    actorStates: actors.map(cloneActor),
    actorTrajectories: Object.fromEntries(actors.map((actor) => [actor.id, [cloneHex(actor.hex)]])),
    actorPlaybackWindows: {},
    conflictEvents: [],
    summary: `Already inside Control Window · M${stateMomentum(state)}`,
    threshold: clampM(threshold),
    wanderSeedAfter: wanderSeed,
    controlWindowRule: CONTROL_WINDOW_RULE,
  }
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
  if (steps === 0) return noMotionWindowPlan({ state, actors, wanderSeed, threshold })

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
  if (steps === 0) return noMotionWindowPlan({ state, actors, wanderSeed, threshold: beforeM })

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

export function skipPlan({
  state,
  threshold = CONTROL_WINDOW_DEFAULT_THRESHOLD,
  obstacles = [],
  actors = [],
  boardRadius = 6,
  wanderEnabled = true,
  wanderSeed = 1,
}) {
  const beforeM = stateMomentum(state)
  return resolveMotionPacket({
    state,
    startM: beforeM,
    axisId: state.axisId,
    travelBudget: beforeM,
    atCost: 1,
    kind: 'control-action-skip',
    summary: beforeM > 0
      ? `Skip · no control input · passive M${beforeM} → M0 max / 1 AT`
      : 'Skip · wait in place / 1 AT',
    decayMode: 'persistent',
    threshold,
    actionId: 'skip',
    effectiveM: beforeM,
    obstacles,
    actors,
    boardRadius,
    wanderEnabled,
    wanderSeed,
    extra: { actionProfile: 'skip-world-step-passive-motion-v1', activeSteps: 0, autoSteps: beforeM },
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
  if (actionId === 'skip') {
    return skipPlan({ state, threshold, obstacles, actors, boardRadius, wanderEnabled, wanderSeed })
  }
  if (!['move', 'drive', 'heavy-drive'].includes(actionId)) {
    return { valid: false, reason: `Unknown Control Window action: ${actionId}` }
  }
  if (!HEX_DIRECTIONS.some((entry) => entry.id === aimAxis)) return { valid: false, reason: 'Choose a Hex direction.' }

  const beforeM = stateMomentum(state)
  const axisBefore = state.axisId ?? null
  const incomingM = actionId === 'heavy-drive' ? 2 : 1
  const composition = hexLookupControl({ existingM: beforeM, existingAxis: axisBefore, incomingM, incomingAxis: aimAxis })
  const effectiveM = composition.momentum
  const axisAfter = composition.axisId ?? aimAxis
  const alignedM0Move = actionId === 'move' && beforeM === 0 && axisBefore && axisBefore === aimAxis
  const activeSteps = effectiveM > 0 ? 1 : 0
  const activeConsumesM = actionId === 'move' && !alignedM0Move
  const afterActiveM = Math.max(0, effectiveM - (activeSteps > 0 && activeConsumesM ? 1 : 0))
  const autoSteps = Math.max(0, afterActiveM - clampM(threshold))
  const travelBudget = activeSteps + autoSteps
  const predictedFinalM = Math.max(0, afterActiveM - autoSteps)
  const label = actionId === 'heavy-drive' ? 'Heavy Drive' : actionId === 'drive' ? 'Drive' : 'Move'
  const profile = actionId === 'heavy-drive'
    ? 'heavy-drive-m2-input-active1-preserve-then-auto-v1'
    : actionId === 'drive'
      ? 'drive-active1-preserve-m-then-auto-to-window-v2'
      : 'move-active1-use1-then-auto-to-window-v2'

  return resolveMotionPacket({
    state,
    startM: effectiveM,
    axisId: axisAfter,
    travelBudget,
    atCost: 1,
    kind: `control-action-${actionId}`,
    summary: `${label} · Hex Lookup M${beforeM}+M${incomingM} → effective M${effectiveM} · active ${activeSteps} + auto ${autoSteps} · predicted M${predictedFinalM} · 1 AT`,
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
      incomingControlM: incomingM,
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
