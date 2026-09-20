import { HEX_DIRECTIONS, axialDistance, axialKey, directionIdBetween } from '../../sim/hex.js'
import { sampleTimedRecord } from '../../sim/plan-playback.js'
import { thermalConfigFromProfile, cloneThermalProfile } from '../../thermal/thermal-profile.js'
import { thermalTimeline, sampleThermalTimeline } from '../../thermal/thermal-runtime.js'
import {
  actorBoardRecord, actorSpatialState, createMomentumActor, forcedDisplace,
  reachableTargets, resolveGameplayAction, resolveDomainNaturalBuild, resolveThermalEvents,
} from './gameplay-momentum-model.js'
import {
  GAMEPLAY_SPATIAL_AUTHORITY,
  GAMEPLAY_SPATIAL_REFLECTION_RULE,
  gameplayActorToTrajectoryState,
  resolveTrajectoryGameplayAction,
  trajectoryPreviewForGameplay,
  usesTrajectoryRuntime,
} from './gameplay-lab-runtime.js'

export const GAMEPLAY_TIMELINE = 'gameplay-at-plan-p0-candidate'
const clone = (value) => structuredClone(value)
const sameCell = (a, b) => axialKey(a) === axialKey(b)
const cycles = { 'enemy-a': ['move', 'attack', 'brace'], 'enemy-b': ['brace', 'move', 'attack', 'skip'] }
const momentumFields = (actor) => ({ hM: actor.hM, axisId: actor.axisId, downM: actor.downM, downPrepared: actor.downPrepared })
const neighborToward = (from, to) => HEX_DIRECTIONS.map((dir) => ({ q: from.q + dir.q, r: from.r + dir.r }))
  .sort((a, b) => axialDistance(a, to) - axialDistance(b, to))[0]

function mergeTrajectoryUntilEncounter(trajectorySamples, logicalTrack, encounterAt) {
  if (!trajectorySamples?.length || !logicalTrack?.length || !Number.isFinite(encounterAt)) return logicalTrack
  const prefix = trajectorySamples
    .filter((sample) => Number(sample.t ?? 0) < encounterAt)
    .map((sample) => ({ ...sample, actor: sample.actor ? clone(sample.actor) : undefined }))
  const spatialContact = sampleTimedRecord(trajectorySamples, encounterAt)
  const logicalContact = sampleTimedRecord(logicalTrack, encounterAt)
  const contact = spatialContact && logicalContact
    ? {
      ...spatialContact,
      t: encounterAt,
      actor: clone(logicalContact.actor),
    }
    : (logicalContact ?? spatialContact)
  const suffix = logicalTrack
    .filter((sample) => Number(sample.t ?? 0) > encounterAt)
    .map((sample) => clone(sample))
  const merged = [...prefix, ...(contact ? [contact] : []), ...suffix]
  const deduped = []
  for (const sample of merged) {
    const prior = deduped.at(-1)
    if (prior && Math.abs((prior.t ?? 0) - (sample.t ?? 0)) < 1e-8) deduped[deduped.length - 1] = sample
    else deduped.push(sample)
  }
  return deduped
}

// All telegraphs aim at the SAME Ready snapshot, never a player's future result.
export function snapshotGameplayIntents(player, enemies, actionId, targetHex) {
  return [{ actorId: player.id, actionId, targetHex: targetHex ? { ...targetHex } : null },
    ...enemies.filter((actor) => actor.hp > 0).slice().sort((a, b) => a.id.localeCompare(b.id)).map((actor) => ({
      actorId: actor.id, actionId: actor.intent ?? 'skip',
      targetHex: neighborToward(actor.hex, player.hex),
    }))]
}

// Horizontal movement is not re-authored here: Gameplay asks the exact
// Trajectory Lab runtime for Move / Drive / Horizontal Skip. Gameplay-only
// Down / Attack / Launch / Release remain extensions around that authority.
export function buildGameplaySpatialPreview({
  player, enemies = [], worldAt = 0, actionId, targetHex = null, boardRadius = 5,
  obstacles = [], responseCurve = 'linear',
}) {
  const shared = trajectoryPreviewForGameplay({
    actor: player, actionId, targetHex, boardRadius, obstacles, responseCurve, worldAt,
  })
  if (shared) return shared

  const actors = [player, ...enemies].map(createMomentumActor)
  const validation = resolveGameplayAction({
    actor: player,
    actionId,
    targetHex,
    actors: actionId === 'release' ? actors : [actors[0]],
    boardRadius,
  })
  if (!validation.valid || player.hp <= 0) return { valid: false, reason: validation.reason || 'No legal target / actor is down.' }

  const start = createMomentumActor(player)
  const path = validation.path ?? []
  const samples = [{ t: 0, ...actorSpatialState(start, worldAt), actor: clone(start) }]
  if (path.length) {
    path.forEach((hex, index) => {
      const sampleActor = createMomentumActor(validation.actor)
      sampleActor.hex = { ...hex }
      samples.push({
        t: (index + 1) / path.length,
        ...actorSpatialState(sampleActor, worldAt + (index + 1) / path.length),
        actor: sampleActor,
      })
    })
  } else {
    samples.push({ t: 1, ...actorSpatialState(validation.actor, worldAt + 1), actor: clone(validation.actor) })
  }
  return {
    valid: true,
    previewOnly: true,
    samples,
    actorTrajectories: {},
    finalState: { ...actorSpatialState(validation.actor, worldAt + 1), player: clone(validation.actor) },
  }
}

export function buildGameplayATPlan({ player, enemies = [], thermal, profile,
  worldAt = 0, actionId, targetHex = null, environmentId = 'adiabatic',
  boardRadius = 5, obstacles = [], responseCurve = 'linear', thermalConfigOverride = null,
  momentumFactor = 0.8, collisionHeatFactor = 0.8,
  collisionDamage = false, domainNaturalBuild = true,
}) {
  const initialActors = [player, ...enemies].map(createMomentumActor)
  const resolveAction = (actor, nextActionId, nextTargetHex, actorList = initialActors) => {
    const shared = resolveTrajectoryGameplayAction({
      actor,
      actionId: nextActionId,
      targetHex: nextTargetHex,
      boardRadius,
      obstacles,
      responseCurve,
      worldAt,
    })
    if (shared) return shared
    return resolveGameplayAction({
      actor,
      actionId: nextActionId,
      targetHex: nextTargetHex,
      actors: nextActionId === 'release' ? actorList : [actor],
      boardRadius,
    })
  }
  const sharedInput = usesTrajectoryRuntime(player, actionId)
  const inputAction = ['skip', 'brace'].includes(actionId)
    || (sharedInput ? Boolean(targetHex) : reachableTargets(player, actionId, boardRadius, initialActors)
      .some((entry) => targetHex && sameCell(entry.hex, targetHex)))
  const validation = resolveAction(player, actionId, targetHex)
  if (!inputAction || !validation.valid || player.hp <= 0) return { valid: false, reason: validation.reason || 'No legal target / actor is down.' }
  const profileSnapshot = cloneThermalProfile(profile)
  const config = thermalConfigOverride ? { ...thermalConfigOverride } : thermalConfigFromProfile(profileSnapshot, environmentId)
  const intents = snapshotGameplayIntents(player, enemies, actionId, targetHex)
  const intentById = new Map(intents.map((intent) => [intent.actorId, intent]))
  const actors = new Map(initialActors.map((actor) => [actor.id, clone(actor)]))
  const tracks = Object.fromEntries(initialActors.map((actor) => [actor.id, []]))
  const events = []
  const queue = []
  const cancelled = new Set()
  const transacted = new Set()
  const travelled = new Set()
  const hitPairs = new Set()
  const sourceThermalEvents = []
  const emit = (type, t, detail = {}) => {
    // Event payloads are immutable by construction in this resolver. Avoid deep-cloning
    // every event; actor snapshots belong in timed tracks, not duplicated event metadata.
    const event = { id: `event-${events.length}`, type, t, worldAt: worldAt + t, ...detail }
    events.push(event)
    return event
  }
  const record = (id, t, position) => {
    const actor = actors.get(id)
    tracks[id].push({ t, ...actorSpatialState(actor, worldAt + t), actor: clone(actor),
      ...(position ? { position } : {}) })
  }
  const addThermal = (raw, t, sourceId, targetId) => {
    for (const entry of resolveThermalEvents(raw, { momentumFactor, collisionHeatFactor })) {
      const ids = entry.scope === 'both' ? [sourceId, targetId] : [entry.scope === 'target' ? targetId : sourceId]
      for (const actorId of ids.filter(Boolean)) {
        const event = emit('ThermalImpulse', t, { ...entry, actorId })
        if (actorId === player.id) sourceThermalEvents.push(event)
      }
    }
  }
  const plans = new Map()
  for (const intent of intents) {
    const actor = actors.get(intent.actorId)
    // Horizontal Move / Drive / Skip for every Actor uses the same Trajectory
    // runtime. Encounter still resolves against the live shared timeline.
    let result = resolveAction(actor, intent.actionId, intent.targetHex, initialActors)
    if (!result.valid) result = { valid: true, actor, path: [], thermal: [], trace: [{ cause: 'Intent unavailable: Hold' }] }
    if (intent.actionId === 'release') result = { ...result,
      trace: result.trace.filter((event) => event.source === 'Release'),
      thermal: result.thermal.filter((event) => event.scope === 'source') }
    plans.set(actor.id, result)
    if (result.trajectoryPlan) {
      for (const reflection of result.trajectoryPlan.conflictEvents ?? []) {
        const rt = Math.max(0, Math.min(1, Number(reflection.t ?? 0.5)))
        emit('SurfaceReflection', rt, {
          actorId: actor.id,
          hex: reflection.attemptedCell ?? reflection.from ?? result.actor.hex,
          axisId: reflection.axisAfter ?? result.actor.axisId,
          authority: GAMEPLAY_SPATIAL_REFLECTION_RULE,
        })
      }
    }
    record(actor.id, 0)
    record(actor.id, 0.08)
    emit('Declare', 0, { ...intent, hex: actor.hex })
    const path = result.path ?? []
    path.forEach((hex, index) => queue.push({ kind: 'travel', t: 0.08 + 0.64 * (index + 1) / path.length, actorId: actor.id, hex }))
    if (!path.length && !['attack', 'release'].includes(intent.actionId)) {
      queue.push({ kind: 'transaction', t: intent.actionId === 'skip' ? 0.94 : 0.2, actorId: actor.id })
    }
    if (intent.actionId === 'release') queue.push({ kind: 'release', t: 0.28, actorId: actor.id })
  }
  const transaction = (id, t) => {
    if (transacted.has(id)) return
    transacted.add(id)
    const result = plans.get(id)
    Object.assign(actors.get(id), momentumFields(result.actor))
    emit('MomentumTransaction', t, { actorId: id, trace: result.trace, hex: actors.get(id).hex })
    addThermal(result.thermal.filter((entry) => entry.scope === 'source'), t, id)
    record(id, t)
  }
  const attacks = (t, snapshot = [...actors.values()].map(clone)) => {
    if (t < 0 || t > 1) return
    const hits = []
    for (const source of snapshot) {
      const intent = intentById.get(source.id)
      if (intent?.actionId !== 'attack' || source.hp <= 0 || cancelled.has(source.id)) continue
      const direction = directionIdBetween(initialActors.find((actor) => actor.id === source.id).hex, intent.targetHex)
      const target = snapshot.find((actor) => actor.id !== source.id && actor.hp > 0 && axialDistance(source.hex, actor.hex) === 1
        && directionIdBetween(source.hex, actor.hex) === direction)
      if (!target || hitPairs.has(`${source.id}:${target.id}`)) continue
      const reverse = intentById.get(target.id)
      const reverseStart = initialActors.find((actor) => actor.id === target.id)
      const clash = reverse?.actionId === 'attack' && !cancelled.has(target.id)
        && directionIdBetween(reverseStart.hex, reverse.targetHex) === directionIdBetween(target.hex, source.hex)
      hitPairs.add(`${source.id}:${target.id}`)
      if (clash) {
        hitPairs.add(`${target.id}:${source.id}`)
        emit('Clash', t, { actorId: source.id, targetId: target.id, hex: target.hex,
          outcome: 'hook-only-unfrozen' })
      } else hits.push({ source, target, damage: source.id === player.id ? 10 : 8, axisId: direction })
    }
    for (const hit of hits) {
      emit('Encounter', t, { kind: 'Attack', actorId: hit.source.id, targetId: hit.target.id, hex: hit.target.hex })
      actors.get(hit.target.id).hp = Math.max(0, actors.get(hit.target.id).hp - hit.damage)
      emit('AttackPayload', t, { actorId: hit.source.id, targetId: hit.target.id, hex: hit.target.hex, damage: hit.damage, axisId: hit.axisId })
      record(hit.target.id, t)
    }
  }
  const force = (source, target, amount, axisId, t) => {
    const forced = forcedDisplace(target, amount, axisId, [...actors.values()], boardRadius, obstacles)
    const stops = forced.trace.filter((entry) => ['Chained Encounter hook', 'Surface stop'].includes(entry.cause))
    const terminalLoss = stops.reduce((sum, entry) => sum + (entry.amount ?? 0), 0)
    const contactLoss = Math.max(0, forced.dissipatedM - terminalLoss)
    const next = actors.get(target.id)
    if (amount > 0 || forced.gainedIncomingH > 0 || forced.dissipatedM > 0) cancelled.add(target.id)
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].actorId === target.id && ['forced', 'terminal-stop'].includes(queue[index].kind)) queue.splice(index, 1)
    }

    // Contact snapshot: Incoming H exists immediately; Forced Use is applied on
    // the first successful Travel by the shared CellMotion runtime.
    next.downM = forced.actor.downM
    next.downPrepared = forced.actor.downPrepared
    if (forced.gainedIncomingH > 0) {
      next.axisId = axisId
      next.hM = forced.gainedIncomingH
    } else {
      Object.assign(next, momentumFields(forced.actor))
    }

    emit('Collision', t, { actorId: source.id, targetId: target.id, hex: target.hex,
      axisId, incomingH: amount, dissipatedM: contactLoss })
    if (forced.trace.some((entry) => entry.cause === 'Down M resistance')) {
      emit('DownResistance', t, { actorId: target.id, hex: target.hex, trace: forced.trace })
    }
    addThermal(forced.thermal, t, source.id, target.id)
    if (contactLoss > 0) addThermal([{ source: 'Collision dissipatedM', amount: contactLoss,
      polarity: 'hotward', factorKind: 'collision', scope: 'both' }], t, source.id, target.id)
    if (collisionDamage && contactLoss > 0) {
      const damage = contactLoss * 5
      next.hp = Math.max(0, next.hp - damage)
      emit('ImpactPayload', t, { actorId: source.id, targetId: target.id, hex: target.hex, damage })
    }
    record(target.id, t)

    for (const collision of forced.motion?.collisions ?? []) {
      const reflectionAt = t + (0.94 - t) * Math.max(0, Math.min(1, Number(collision.t ?? 0)))
      emit('SurfaceReflection', reflectionAt, {
        actorId: target.id,
        hex: collision.contactCell ?? target.hex,
        axisId: collision.axisAfter ?? axisId,
        authority: GAMEPLAY_SPATIAL_REFLECTION_RULE,
        forced: true,
      })
    }

    const pathStates = forced.pathStates?.length
      ? forced.pathStates
      : forced.path.map((hex) => ({ hex, ...momentumFields(forced.actor) }))
    let firstMoveAt = null
    if (pathStates.length) {
      emit('ForcedMotion', t, { actorId: target.id, hex: target.hex, axisId, path: forced.path,
        reflectionCount: forced.motion?.reflectionCount ?? 0 })
      pathStates.forEach((state, index) => {
        const moveAt = t + (0.94 - t) * (index + 1) / pathStates.length
        if (firstMoveAt === null) firstMoveAt = moveAt
        queue.push({ kind: 'forced', t: moveAt, actorId: target.id, hex: state.hex, start: t,
          momentum: {
            hM: state.hM,
            axisId: state.axisId,
            downM: 0,
            downPrepared: false,
          } })
      })
    } else {
      Object.assign(next, momentumFields(forced.actor))
    }

    for (const entry of stops) {
      queue.push({ kind: 'terminal-stop', t: pathStates.length ? 0.94 : t,
        actorId: target.id, sourceId: source.id, stop: entry, axisId })
    }
    return { moved: pathStates.length > 0, forced, firstMoveAt }
  }

  queue.push({ kind: 'attack-check', t: 0.15 }, { kind: 'attack-check', t: 0.85 })
  while (queue.length) {
    queue.sort((a, b) => a.t - b.t || (a.actorId ?? '').localeCompare(b.actorId ?? ''))
    const step = queue.shift()
    const { t, actorId: id } = step
    if (step.kind === 'attack-check') { attacks(t); continue }
    if (step.kind === 'terminal-stop') {
      const actor = actors.get(id)
      const blocker = step.stop.actorId ? actors.get(step.stop.actorId) : null
      emit(blocker ? 'DeferredEncounter' : 'Collision', t, { actorId: id, targetId: blocker?.id,
        hex: blocker?.hex ?? actor.hex, axisId: step.axisId, dissipatedM: step.stop.amount,
        reason: blocker ? 'chained resolver deferred; terminal stop only' : 'Boundary stop' })
      addThermal([{ source: 'Collision dissipatedM', amount: step.stop.amount,
        polarity: 'hotward', factorKind: 'collision', scope: 'both' }], t, step.sourceId, id)
      if (collisionDamage) {
        const damage = step.stop.amount * 5
        actor.hp = Math.max(0, actor.hp - damage)
        emit('ImpactPayload', t, { actorId: step.sourceId, targetId: id, hex: actor.hex, damage })
      }
      record(id, t)
      continue
    }
    if (cancelled.has(id) && step.kind !== 'forced' && step.kind !== 'settle') continue
    const actor = actors.get(id)
    if (actor.hp <= 0 && step.kind !== 'forced' && step.kind !== 'settle') continue
    if (step.kind === 'transaction') { transaction(id, t); continue }
    if (step.kind === 'release') {
      const intent = intentById.get(id)
      const target = [...actors.values()].find((other) => other.id !== id && other.hp > 0 && sameCell(other.hex, intent.targetHex))
      const amount = actor.downM
      transaction(id, t)
      if (target) {
        emit('Encounter', t, { kind: 'Release', actorId: id, targetId: target.id, hex: target.hex })
        force(clone(actor), clone(target), amount, directionIdBetween(actor.hex, target.hex), t)
      } else emit('Whiff', t, { actorId: id, hex: intent.targetHex })
      continue
    }
    const liveActors = [...actors.values()]
    const occupant = liveActors.find((other) => other.id !== id && other.hp > 0 && sameCell(other.hex, step.hex))
    if (occupant && ['forced', 'settle'].includes(step.kind)) {
      cancelled.add(id)
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (queue[index].actorId === id) queue.splice(index, 1)
      }
      emit('DeferredEncounter', t, { actorId: id, targetId: occupant.id, hex: step.hex,
        reason: 'new blocker on residual trajectory; chained resolution deferred' })
      record(id, t)
      continue
    }
    // Same-time movement must resolve from one snapshot. This covers both
    // actors claiming one empty Cell and actors swapping opposite edges. The
    // latter used to be order-dependent: an M0 actor processed first could
    // cancel an HM3 actor before the HM3 collision was evaluated.
    const competing = queue.find((otherStep) => otherStep.kind === 'travel'
      && Math.abs(otherStep.t - t) < 1e-8
      && otherStep.actorId !== id
      && !cancelled.has(otherStep.actorId))
    const competingActor = competing ? actors.get(competing.actorId) : null
    const sameClaim = Boolean(competing && sameCell(competing.hex, step.hex))
    const edgeSwap = Boolean(competing && competingActor
      && sameCell(competing.hex, actor.hex)
      && sameCell(step.hex, competingActor.hex))

    if (competing && competingActor && (sameClaim || edgeSwap)) {
      const aPower = Math.max(0, actor.hM)
      const bPower = Math.max(0, competingActor.hM)
      cancelled.add(id)
      cancelled.add(competing.actorId)

      if (aPower === bPower) {
        if (aPower > 0) {
          actor.hM = 0
          competingActor.hM = 0
          addThermal([{ source: 'Collision dissipatedM', amount: aPower,
            polarity: 'hotward', factorKind: 'collision', scope: 'both' }], t, id, competing.actorId)
        }
        emit('Encounter', t, {
          kind: edgeSwap ? 'EdgeCrossing' : 'SimultaneousClaim',
          actorId: id,
          targetId: competing.actorId,
          hex: step.hex,
          outcome: 'equal-H-cancel; hold-pre-contact-cells',
          aPower,
          bPower,
        })
        emit('Collision', t, {
          actorId: id,
          targetId: competing.actorId,
          hex: step.hex,
          dissipatedM: aPower,
          crossing: edgeSwap,
        })
        record(id, t)
        record(competing.actorId, t)
        continue
      }

      const winnerIsCurrent = aPower > bPower
      const winner = winnerIsCurrent ? actor : competingActor
      const loser = winnerIsCurrent ? competingActor : actor
      const winnerId = winner.id
      const loserId = loser.id
      const winnerPower = Math.max(aPower, bPower)
      const loserPower = Math.min(aPower, bPower)
      const winnerTargetHex = winnerIsCurrent ? step.hex : competing.hex
      const winnerAxis = directionIdBetween(winner.hex, winnerTargetHex) ?? winner.axisId

      emit('Encounter', t, {
        kind: edgeSwap ? 'EdgeCrossing' : 'SimultaneousClaim',
        actorId: winnerId,
        targetId: loserId,
        hex: winnerTargetHex,
        outcome: 'unequal-H-settlement',
        winnerPower,
        loserPower,
      })
      const settlement = force(clone(winner), clone(loser), winnerPower, winnerAxis, t)
      winner.hM = 0
      winner.axisId = winnerAxis
      emit('MomentumTransfer', t, {
        actorId: winnerId,
        targetId: loserId,
        fromM: winnerPower,
        toM: 0,
        cause: 'Transfer',
        residual: settlement.forced?.gainedIncomingH ?? 0,
      })

      if (settlement.moved) {
        winner.hex = { ...winnerTargetHex }
        travelled.add(winnerId)
        emit('Travel', t, { actorId: winnerId, hex: winner.hex, settlement: true, crossing: edgeSwap })
      }
      record(winnerId, t)
      record(loserId, t)
      continue
    }

    if (occupant) {
      attacks(t)
      cancelled.add(id)
      const impactM = Math.max(0, actor.hM)
      const impactAxis = directionIdBetween(actor.hex, step.hex) ?? actor.axisId
      emit('Encounter', t, { kind: 'Collision', actorId: id, targetId: occupant.id, hex: step.hex,
        incomingH: impactM })
      const settlement = impactM > 0
        ? force(clone(actor), clone(occupant), impactM, impactAxis, t)
        : { moved: false, forced: null, firstMoveAt: null }

      // Strike / settlement transfers the source's current H. A zero-H Contact
      // only blocks this source's Cell entry; it must not cancel the occupant.
      if (impactM > 0) {
        actor.hM = 0
        actor.axisId = impactAxis
        emit('MomentumTransfer', t, {
          actorId: id,
          targetId: occupant.id,
          fromM: impactM,
          toM: 0,
          cause: 'Transfer',
          residual: settlement.forced?.gainedIncomingH ?? 0,
        })
      }

      // The source may claim the contacted Cell as soon as the target completes
      // its first successful Forced Travel; do not wait until the end of the AT.
      if (settlement.moved && step.kind !== 'forced') {
        const settleAt = Math.min(0.98, Math.max(t + 0.001, (settlement.firstMoveAt ?? t) + 0.001))
        queue.push({ kind: 'settle', t: settleAt, actorId: id, hex: step.hex })
      }
      record(id, t)
      continue
    }
    actor.hex = { ...step.hex }
    if (step.kind === 'forced') Object.assign(actor, step.momentum)
    travelled.add(id)
    emit('Travel', t, { actorId: id, hex: actor.hex, forced: step.kind === 'forced' })
    record(id, t)
    if (step.kind === 'travel') transaction(id, t)
    attacks(t)
  }
  const timeline = thermalTimeline({ state: { ...thermal, worldAt }, config, events: sourceThermalEvents })
  const domainName = timeline.finalState.temperature >= 3 ? 'HOT' : timeline.finalState.temperature <= -3 ? 'COLD' : 'NEUTRAL'
  const domain = resolveDomainNaturalBuild(actors.get(player.id), domainName, {
    enabled: domainNaturalBuild,
    spentH: sourceThermalEvents.some((event) => event.source === 'Active H Spend'),
    spentD: sourceThermalEvents.some((event) => event.source === 'Active D Spend / Convert'),
    hadHorizontalTravel: travelled.has(player.id),
    stable: !travelled.has(player.id) && !actors.get(player.id).axisId,
  })
  actors.set(player.id, domain.actor)
  for (const trace of domain.trace) emit('DomainNaturalBuild', 1, { actorId: player.id, ...trace })
  for (const enemy of enemies) {
    const next = actors.get(enemy.id)
    const cycle = cycles[enemy.id] ?? ['move', 'attack', 'skip']
    if (next.hp > 0) { next.intentIndex = (enemy.intentIndex + 1) % cycle.length; next.intent = cycle[next.intentIndex] }
  }
  for (const actor of actors.values()) record(actor.id, 1)
  emit('Ready', 1)
  events.sort((a, b) => a.t - b.t)
  const finalPlayer = actors.get(player.id)
  const finalEnemies = enemies.map((actor) => actors.get(actor.id))
  const actorTrajectories = Object.fromEntries(enemies.map((actor) => [actor.id,
    tracks[actor.id].map((record) => record.actor.hex).filter((hex, index, list) => index === 0 || !sameCell(hex, list[index - 1]))]))
  const playerPlan = plans.get(player.id)
  const firstPlayerEncounterAt = events
    .filter((event) => ['Encounter', 'Collision', 'ForcedMotion', 'DeferredEncounter', 'Clash'].includes(event.type)
      && (event.actorId === player.id || event.targetId === player.id))
    .reduce((first, event) => Math.min(first, event.t), Infinity)
  const playerSamples = playerPlan?.trajectorySamples?.length
    ? (Number.isFinite(firstPlayerEncounterAt)
      ? mergeTrajectoryUntilEncounter(playerPlan.trajectorySamples, tracks[player.id], firstPlayerEncounterAt)
      : playerPlan.trajectorySamples)
    : tracks[player.id]
  const trajectoryConflictEvents = playerPlan?.trajectoryPlan?.conflictEvents ?? []
  return {
    valid: true, contract: GAMEPLAY_TIMELINE, durationAt: 1, intents, events,
    spatialAuthority: GAMEPLAY_SPATIAL_AUTHORITY,
    profileSnapshot, config, thermalSegments: timeline.segments, sourceThermalEvents,
    samples: playerSamples, actorSamples: tracks, actorTrajectories,
    actorPlaybackWindows: Object.fromEntries(enemies.map((actor) => [actor.id, { start: 0.08, end: 0.96 }])),
    playerPlaybackEnd: 1, spatialMode: playerPlan?.trajectoryPlan ? 'hybrid' : 'discrete',
    destinationDriven: !playerPlan?.trajectoryPlan,
    visualCurveAuthoritative: Boolean(playerPlan?.trajectoryPlan),
    conflictEvents: trajectoryConflictEvents,
    traversedCells: playerPlan?.trajectoryPlan?.pathCells ?? tracks[player.id].map((record) => record.actor.hex),
    collisions: [...(playerPlan?.trajectoryPlan?.collisions ?? []), ...events.filter((event) => event.type === 'Collision')],
    finalState: { ...gameplayActorToTrajectoryState(finalPlayer, worldAt + 1), actors: finalEnemies.map(actorBoardRecord),
      player: clone(finalPlayer), enemies: clone(finalEnemies), thermal: timeline.finalState },
    domainTrace: domain.trace,
  }
}

export function sampleGameplayATPlan(plan, t) {
  const time = Math.max(0, Math.min(1, t))
  const spatialPlayer = sampleTimedRecord(plan.samples, time)
  const logicalPlayer = sampleTimedRecord(plan.actorSamples?.player ?? [], time)
  const player = spatialPlayer && logicalPlayer
    ? {
      ...logicalPlayer,
      ...spatialPlayer,
      actor: {
        ...logicalPlayer.actor,
        ...(spatialPlayer.actor ?? {}),
        hp: logicalPlayer.actor?.hp ?? spatialPlayer.actor?.hp,
        downM: logicalPlayer.actor?.downM ?? spatialPlayer.actor?.downM,
        downPrepared: logicalPlayer.actor?.downPrepared ?? spatialPlayer.actor?.downPrepared,
      },
    }
    : spatialPlayer ?? logicalPlayer
  return {
    t: time,
    player,
    actors: Object.fromEntries(Object.entries(plan.actorSamples).map(([id, samples]) => [id, sampleTimedRecord(samples, time)])),
    thermal: sampleThermalTimeline(plan.thermalSegments, time),
    events: plan.events.filter((event) => event.t <= time),
  }
}
