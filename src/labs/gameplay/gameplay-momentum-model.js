import {
  HEX_DIRECTIONS,
  axialDistance,
  axialKey,
  axialToWorld,
  directionIdBetween,
  directionVector,
} from '../../sim/hex.js'

export const GAMEPLAY_V1 = 'gameplay-momentum-thermal-v1-candidate'
export const MAX_HORIZONTAL_M = 3
export const MAX_DOWN_M = 3

const SPEED_BY_M = [0, 0.85, 1.7, 2.65]
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const cloneHex = (hex) => ({ q: hex.q, r: hex.r })

export const GAMEPLAY_ACTIONS_V1 = Object.freeze([
  { id: 'move', label: 'Move', badge: 'MOVE', target: 'direction', short: 'Initiative Move · real H / Axis rules' },
  { id: 'drive', label: 'Drive', badge: 'H+', target: 'direction', short: 'Active Horizontal Build · bypass H0 setup from No Axis' },
  { id: 'attack', label: 'Attack', badge: 'ATK', target: 'direction', short: 'Directional Active Intent · no target-cell claim at H0' },
  { id: 'brace', label: 'Brace', badge: 'D+', target: 'none', short: 'Active Down Build · bypass D0 setup from No Axis' },
  { id: 'launch', label: 'Launch', badge: 'D→H', target: 'direction', short: 'Convert all Down M to self Horizontal M · 1:1' },
  { id: 'release', label: 'Release', badge: 'D→OUT', target: 'actor', short: 'Convert all Down M to outgoing Horizontal M · 1:1' },
  { id: 'skip', label: 'Skip / Stay', badge: 'SKIP', target: 'none', short: 'Natural settle: H → No Axis → D' },
])

export function createMomentumActor({
  id = 'player',
  hex = { q: 0, r: 0 },
  hp = 100,
  hM = 0,
  axisId = null,
  downM = 0,
  downPrepared = false,
  intent = null,
  intentIndex = 0,
} = {}) {
  return {
    id,
    hex: cloneHex(hex),
    hp,
    hM: clamp(Math.round(hM), 0, MAX_HORIZONTAL_M),
    axisId: axisId || null,
    downM: clamp(Math.round(downM), 0, MAX_DOWN_M),
    downPrepared: Boolean(downPrepared),
    intent,
    intentIndex,
  }
}

export function momentumBand(actor) {
  if (actor.hM > 0) return `HM${actor.hM}`
  if (actor.axisId) return 'HM0'
  if (actor.downPrepared || actor.downM > 0) return `DM${actor.downM}`
  return 'NO AXIS'
}

export function isDownSide(actor) {
  return Boolean(actor.downPrepared || actor.downM > 0)
}

export function isHorizontalSide(actor) {
  return Boolean(actor.axisId || actor.hM > 0)
}

export function actorSpatialState(actor, worldAt = 0) {
  const direction = actor.axisId ? directionVector(actor.axisId) : { x: 0, z: 0 }
  const speed = SPEED_BY_M[clamp(actor.hM, 0, MAX_HORIZONTAL_M)] ?? 0
  return {
    position: axialToWorld(actor.hex),
    velocity: { x: direction.x * speed, z: direction.z * speed },
    axisId: actor.axisId,
    worldAt,
  }
}

export function actorBoardRecord(actor) {
  return {
    id: actor.id,
    hex: cloneHex(actor.hex),
    momentumLevel: actor.hM,
    axisId: actor.axisId,
    downM: actor.downM,
    hp: actor.hp,
    intent: actor.intent,
  }
}

function directionIndex(id) {
  return HEX_DIRECTIONS.findIndex((entry) => entry.id === id)
}

function signedTurn(fromId, toId) {
  const from = directionIndex(fromId)
  const to = directionIndex(toId)
  if (from < 0 || to < 0) return 0
  let delta = to - from
  while (delta > 3) delta -= 6
  while (delta < -3) delta += 6
  return delta
}

function stepHex(hex, axisId) {
  const direction = HEX_DIRECTIONS.find((entry) => entry.id === axisId)
  if (!direction) return cloneHex(hex)
  return { q: hex.q + direction.q, r: hex.r + direction.r }
}

function inside(hex, radius) {
  return axialDistance(hex) <= radius
}

function directionToward(from, to) {
  let best = HEX_DIRECTIONS[0]
  let bestDistance = Infinity
  for (const direction of HEX_DIRECTIONS) {
    const candidate = { q: from.q + direction.q, r: from.r + direction.r }
    const distance = axialDistance(candidate, to)
    if (distance < bestDistance) {
      bestDistance = distance
      best = direction
    }
  }
  return best.id
}

function pathStraight(start, axisId, distance, radius) {
  const path = []
  let cursor = cloneHex(start)
  for (let index = 0; index < distance; index += 1) {
    const next = stepHex(cursor, axisId)
    if (!inside(next, radius)) break
    path.push(next)
    cursor = next
  }
  return path
}

function pathSteered(start, currentAxis, aimAxis, distance, radius) {
  if (!currentAxis || distance <= 0) return pathStraight(start, aimAxis, Math.max(1, distance), radius)
  const turn = signedTurn(currentAxis, aimAxis)
  if (Math.abs(turn) === 3) return []
  const path = []
  let cursor = cloneHex(start)
  let axisIndex = directionIndex(currentAxis)
  const targetIndex = directionIndex(aimAxis)
  for (let index = 0; index < distance; index += 1) {
    if (index > 0 || distance === 1) {
      let delta = targetIndex - axisIndex
      while (delta > 3) delta -= 6
      while (delta < -3) delta += 6
      if (delta !== 0) axisIndex = (axisIndex + Math.sign(delta) + 6) % 6
    }
    const nextAxis = HEX_DIRECTIONS[axisIndex].id
    const next = stepHex(cursor, nextAxis)
    if (!inside(next, radius)) break
    path.push(next)
    cursor = next
  }
  return path
}

export function reachableTargets(actor, actionId, boardRadius = 5, actors = []) {
  if (actor.hp <= 0 || (['launch', 'release'].includes(actionId) && (!isDownSide(actor) || actor.downM <= 0))) return []
  const occupied = new Set(actors.filter((entry) => entry.id !== actor.id).map((entry) => axialKey(entry.hex)))
  if (actionId === 'brace' || actionId === 'skip') return []
  if (actionId === 'release') {
    return actors
      .filter((entry) => entry.id !== actor.id && entry.hp > 0 && axialDistance(actor.hex, entry.hex) === 1)
      .map((entry) => ({ hex: cloneHex(entry.hex), rule: 'release-adjacent-actor-v1', actorId: entry.id }))
  }
  if (actionId === 'attack') {
    return HEX_DIRECTIONS
      .map((direction) => ({ q: actor.hex.q + direction.q, r: actor.hex.r + direction.r }))
      .filter((hex) => inside(hex, boardRadius))
      .map((hex) => ({ hex, rule: 'attack-direction-v1' }))
  }
  if (actionId === 'drive' || actionId === 'launch') {
    return HEX_DIRECTIONS
      .map((direction) => ({ q: actor.hex.q + direction.q, r: actor.hex.r + direction.r }))
      .filter((hex) => inside(hex, boardRadius))
      .map((hex) => ({ hex, rule: `${actionId}-axis-v1` }))
  }
  if (actionId !== 'move' || isDownSide(actor)) return []

  const candidates = []
  for (const aim of HEX_DIRECTIONS) {
    let path
    if (!actor.axisId) {
      path = pathStraight(actor.hex, aim.id, 1, boardRadius)
    } else if (actor.hM === 0) {
      path = pathStraight(actor.hex, aim.id, 1, boardRadius)
    } else if (actor.hM === 1 && Math.abs(signedTurn(actor.axisId, aim.id)) === 2) {
      path = pathSteered(actor.hex, actor.axisId, aim.id, 2, boardRadius)
    } else if (actor.hM === 1) {
      path = pathStraight(actor.hex, aim.id, 1, boardRadius)
    } else {
      path = pathSteered(actor.hex, actor.axisId, aim.id, actor.hM, boardRadius)
    }
    if (!path.length) continue
    const landing = path.at(-1)
    candidates.push({
      hex: landing,
      aimAxisId: aim.id,
      path,
      rule: 'spatial-inertia-v1',
      occupied: occupied.has(axialKey(landing)),
    })
  }
  const unique = new Map()
  for (const entry of candidates) unique.set(axialKey(entry.hex), entry)
  return [...unique.values()]
}

function thermalEvent(source, amount, polarity, factorKind = 'momentum', scope = 'source') {
  return {
    source,
    amount,
    polarity,
    factorKind,
    scope,
  }
}

function transitionEvent(source, from, to, cause, deltaM = 0) {
  return { source, from, to, cause, deltaM }
}

function cleanHorizontal(actor) {
  actor.hM = 0
  actor.axisId = null
}

function cleanDown(actor) {
  actor.downM = 0
  actor.downPrepared = false
}

function applySkip(actor, boardRadius) {
  const next = createMomentumActor(actor)
  const trace = []
  const thermal = []
  const path = []

  if (next.hM > 0 && next.axisId) {
    path.push(...pathStraight(next.hex, next.axisId, next.hM, boardRadius))
    if (path.length) next.hex = cloneHex(path.at(-1))
    const from = next.hM
    next.hM = Math.max(0, next.hM - 1)
    trace.push(transitionEvent('Skip', `HM${from}`, `HM${next.hM}`, 'Passive Dissipation', -1))
    return { actor: next, path, trace, thermal }
  }

  if (next.axisId) {
    next.axisId = null
    trace.push(transitionEvent('Skip', 'HM0', 'NO AXIS', 'Axis Dissipation', 0))
    return { actor: next, path, trace, thermal }
  }

  if (!next.downPrepared && next.downM === 0) {
    next.downPrepared = true
    trace.push(transitionEvent('Skip', 'NO AXIS', 'DM0', 'Down Preparation', 0))
    return { actor: next, path, trace, thermal }
  }

  const before = next.downM
  next.downPrepared = true
  next.downM = Math.min(MAX_DOWN_M, next.downM + 1)
  trace.push(transitionEvent('Skip', `DM${before}`, `DM${next.downM}`, 'Passive Down Build', next.downM - before))
  return { actor: next, path, trace, thermal }
}

function applyBrace(actor) {
  const next = createMomentumActor(actor)
  const trace = []
  const thermal = []

  if (isHorizontalSide(next)) {
    const spent = next.hM
    const from = momentumBand(next)
    cleanHorizontal(next)
    next.downPrepared = true
    next.downM = 0
    trace.push(transitionEvent('Brace', from, 'DM0', 'Cross-channel Reset / Establish', -spent))
    if (spent > 0) thermal.push(thermalEvent('Active H Spend', spent, 'coldward'))
    return { actor: next, path: [], trace, thermal }
  }

  const before = next.downM
  next.downPrepared = true
  next.downM = Math.min(MAX_DOWN_M, Math.max(1, next.downM + 1))
  const gain = next.downM - before
  trace.push(transitionEvent('Brace', before > 0 || actor.downPrepared ? `DM${before}` : 'NO AXIS', `DM${next.downM}`, 'Active D Build', gain))
  if (gain > 0) thermal.push(thermalEvent('Active D Build', gain, 'coldward'))
  return { actor: next, path: [], trace, thermal }
}

function applyDrive(actor, axisId, boardRadius) {
  const next = createMomentumActor(actor)
  const trace = []
  const thermal = []
  const path = pathStraight(next.hex, axisId, 1, boardRadius)
  if (path.length) next.hex = cloneHex(path.at(-1))

  if (isDownSide(next)) {
    const spent = next.downM
    const from = momentumBand(next)
    cleanDown(next)
    next.hM = 0
    next.axisId = axisId
    trace.push(transitionEvent('Drive', from, 'HM0', 'Cross-channel Reset / Establish', -spent))
    if (spent > 0) thermal.push(thermalEvent('Active D Spend / Convert', spent, 'hotward'))
    return { actor: next, path, trace, thermal }
  }

  const before = next.hM
  next.axisId = axisId
  next.hM = Math.min(MAX_HORIZONTAL_M, Math.max(1, next.hM + 1))
  const gain = next.hM - before
  trace.push(transitionEvent('Drive', before > 0 || actor.axisId ? `HM${before}` : 'NO AXIS', `HM${next.hM}`, 'Active H Build', gain))
  if (gain > 0) thermal.push(thermalEvent('Active H Build', gain, 'hotward'))
  return { actor: next, path, trace, thermal }
}

function applyLaunch(actor, axisId) {
  const next = createMomentumActor(actor)
  const trace = []
  const thermal = []
  if (!isDownSide(next) || next.downM <= 0) return { valid: false, reason: 'Launch requires DM1+.', actor: next, path: [], trace, thermal }
  const amount = next.downM
  const from = momentumBand(next)
  cleanDown(next)
  next.hM = Math.min(MAX_HORIZONTAL_M, amount)
  next.axisId = axisId
  trace.push(transitionEvent('Launch', from, `HM${next.hM}`, 'Active D Spend / Convert', -amount))
  thermal.push(thermalEvent('Active D Spend / Convert', amount, 'hotward'))
  return { valid: true, actor: next, path: [], trace, thermal, spentDown: amount }
}

function applyMove(actor, target, boardRadius) {
  if (isDownSide(actor)) {
    return { valid: false, reason: 'Basic Move is locked on the Down side in v1; use Drive or Launch to establish Horizontal Axis.', actor: createMomentumActor(actor), path: [], trace: [], thermal: [] }
  }
  const next = createMomentumActor(actor)
  const targetKey = axialKey(target)
  const reachable = reachableTargets(next, 'move', boardRadius)
  const chosen = reachable.find((entry) => axialKey(entry.hex) === targetKey)
  if (!chosen) return { valid: false, reason: 'Target is outside the current inertia envelope.', actor: next, path: [], trace: [], thermal: [] }

  const trace = []
  const thermal = []
  const beforeBand = momentumBand(next)
  const aimAxis = chosen.aimAxisId || directionIdBetween(next.hex, chosen.path?.[0] ?? target)
  const turn = next.axisId ? signedTurn(next.axisId, aimAxis) : 0

  if (!next.axisId) {
    next.axisId = aimAxis
    next.hM = 0
    trace.push(transitionEvent('Move', 'NO AXIS', 'HM0', 'Establish Axis', 0))
  } else if (next.hM === 0) {
    if (aimAxis === next.axisId) {
      next.hM = 1
      trace.push(transitionEvent('Move', beforeBand, 'HM1', 'Active H Build', 1))
      thermal.push(thermalEvent('Active H Build', 1, 'hotward'))
    } else {
      next.axisId = aimAxis
      trace.push(transitionEvent('Move', beforeBand, 'HM0', 'Redirect', 0))
    }
  } else if (next.hM === 1) {
    if (turn === 0) {
      next.hM = 2
      trace.push(transitionEvent('Move', 'HM1', 'HM2', 'Active H Build', 1))
      thermal.push(thermalEvent('Active H Build', 1, 'hotward'))
    } else if (Math.abs(turn) === 1) {
      next.axisId = aimAxis
      trace.push(transitionEvent('Move', 'HM1', 'HM1', 'Redirect', 0))
    } else {
      next.hM = 0
      next.axisId = aimAxis
      trace.push(transitionEvent('Move', 'HM1', 'HM0', 'Resist', -1))
      thermal.push(thermalEvent('Active H Spend', 1, 'coldward'))
    }
  } else {
    const before = next.hM
    next.hM = Math.max(0, next.hM - 1)
    next.axisId = aimAxis
    const cause = turn === 0 ? 'Use' : Math.abs(turn) === 1 ? 'Redirect' : 'Resist'
    trace.push(transitionEvent('Move', `HM${before}`, `HM${next.hM}`, cause, -1))
    thermal.push(thermalEvent('Active H Spend', 1, 'coldward'))
  }

  next.hex = cloneHex(chosen.hex)
  return { valid: true, actor: next, path: chosen.path ?? [cloneHex(chosen.hex)], trace, thermal }
}

function applyAttack(actor, target) {
  const next = createMomentumActor(actor)
  const axisId = directionIdBetween(next.hex, target)
  if (!axisId) return { valid: false, reason: 'Attack requires an adjacent direction.', actor: next, path: [], trace: [], thermal: [] }
  return {
    valid: true,
    actor: next,
    path: [],
    trace: [{ source: 'Attack', cause: 'Active Intent', axisId, hM: next.hM }],
    thermal: [],
    attackAxisId: axisId,
  }
}

function findActorAt(actors, hex, ignoreId = null) {
  return actors.find((entry) => entry.id !== ignoreId && axialKey(entry.hex) === axialKey(hex)) ?? null
}

export function forcedDisplace(target, incomingH, axisId, actors, boardRadius) {
  const next = createMomentumActor(target)
  const trace = []
  const thermal = []
  let remaining = Math.max(0, incomingH)
  let dissipatedM = 0

  if (next.downPrepared || next.downM > 0) {
    const absorbed = Math.min(next.downM, remaining)
    if (absorbed > 0) {
      next.downM -= absorbed
      remaining -= absorbed
      dissipatedM += absorbed
      next.downPrepared = true
      trace.push({ source: 'Encounter', cause: 'Down M resistance', amount: absorbed })
    }
  }

  if (remaining > 0 && next.hM > 0 && next.axisId) {
    const incomingIndex = directionIndex(axisId)
    const existingIndex = directionIndex(next.axisId)
    const opposite = incomingIndex >= 0 && existingIndex >= 0 && Math.abs(signedTurn(axisId, next.axisId)) === 3
    if (opposite) {
      const cancelled = Math.min(remaining, next.hM)
      remaining -= cancelled
      next.hM -= cancelled
      dissipatedM += cancelled
      trace.push({ source: 'Encounter', cause: 'Opposed H cancellation', amount: cancelled })
    }
  }

  const gained = remaining
  if (gained > 0) thermal.push(thermalEvent('Incoming H', gained, 'hotward', 'momentum', 'target'))

  const path = []
  if (remaining > 0) {
    let cursor = cloneHex(next.hex)
    for (let step = 0; step < remaining; step += 1) {
      const candidate = stepHex(cursor, axisId)
      if (!inside(candidate, boardRadius)) {
        dissipatedM += Math.max(1, remaining - step)
        trace.push({ source: 'Encounter', cause: 'Boundary stop', amount: remaining - step })
        break
      }
      const blocker = findActorAt(actors, candidate, next.id)
      if (blocker) {
        dissipatedM += Math.max(1, remaining - step)
        trace.push({ source: 'Encounter', cause: 'Chained Encounter hook', actorId: blocker.id, amount: remaining - step })
        break
      }
      path.push(candidate)
      cursor = candidate
    }
    if (path.length) next.hex = cloneHex(path.at(-1))
    next.axisId = axisId
    next.hM = Math.max(0, remaining - (path.length > 0 ? 1 : 0))
    cleanDown(next)
  }

  return { actor: next, path, trace, thermal, dissipatedM, gainedIncomingH: gained }
}

export function resolveGameplayAction({
  actor,
  actionId,
  targetHex = null,
  actors = [],
  boardRadius = 5,
  collisionDamage = false,
} = {}) {
  const original = createMomentumActor(actor)
  let result

  if (actionId === 'skip') result = { valid: true, ...applySkip(original, boardRadius) }
  else if (actionId === 'brace') result = { valid: true, ...applyBrace(original) }
  else if (actionId === 'drive') {
    const axisId = targetHex ? directionIdBetween(original.hex, targetHex) : null
    result = axisId ? { valid: true, ...applyDrive(original, axisId, boardRadius) } : { valid: false, reason: 'Drive requires an adjacent Axis target.', actor: original, path: [], trace: [], thermal: [] }
  } else if (actionId === 'move') result = targetHex ? applyMove(original, targetHex, boardRadius) : { valid: false, reason: 'Move requires a highlighted landing Cell.', actor: original, path: [], trace: [], thermal: [] }
  else if (actionId === 'attack') result = targetHex ? applyAttack(original, targetHex) : { valid: false, reason: 'Attack requires a direction.', actor: original, path: [], trace: [], thermal: [] }
  else if (actionId === 'launch') {
    const axisId = targetHex ? directionIdBetween(original.hex, targetHex) : null
    result = axisId ? applyLaunch(original, axisId) : { valid: false, reason: 'Launch requires an adjacent Axis target.', actor: original, path: [], trace: [], thermal: [] }
  } else if (actionId === 'release') {
    const target = targetHex ? findActorAt(actors, targetHex, original.id) : null
    if (!target || axialDistance(original.hex, target.hex) !== 1) {
      result = { valid: false, reason: 'Release requires an adjacent Actor target.', actor: original, path: [], trace: [], thermal: [] }
    } else if (!isDownSide(original) || original.downM <= 0) {
      result = { valid: false, reason: 'Release requires DM1+.', actor: original, path: [], trace: [], thermal: [] }
    } else {
      const amount = original.downM
      const axisId = directionIdBetween(original.hex, target.hex)
      const nextSource = createMomentumActor(original)
      cleanDown(nextSource)
      const forced = forcedDisplace(target, amount, axisId, actors, boardRadius)
      result = {
        valid: true,
        actor: nextSource,
        path: [],
        trace: [transitionEvent('Release', momentumBand(original), 'NO AXIS', 'Active D Spend / Convert', -amount), ...forced.trace],
        thermal: [thermalEvent('Active D Spend / Convert', amount, 'hotward'), ...forced.thermal],
        targetUpdate: forced.actor,
        targetPath: forced.path,
        dissipatedM: forced.dissipatedM,
      }
    }
  } else {
    result = { valid: false, reason: `Unknown action: ${actionId}`, actor: original, path: [], trace: [], thermal: [] }
  }

  if (!result.valid) return result

  const contactHexes = result.path ?? []
  let targetUpdate = result.targetUpdate
  let dissipatedM = result.dissipatedM ?? 0
  let impactDamage = 0
  if (!targetUpdate && contactHexes.length) {
    const firstContactIndex = contactHexes.findIndex((hex) => findActorAt(actors, hex, original.id))
    if (firstContactIndex >= 0) {
      const contactHex = contactHexes[firstContactIndex]
      const target = findActorAt(actors, contactHex, original.id)
      const incoming = Math.max(0, original.hM)
      const axisId = result.actor.axisId || original.axisId || directionIdBetween(original.hex, contactHex)
      const forced = forcedDisplace(target, incoming, axisId, actors, boardRadius)
      targetUpdate = forced.actor
      dissipatedM += forced.dissipatedM
      result.trace.push({ source: 'Encounter', cause: 'Collision Snapshot', actorId: target.id, incomingH: incoming })
      result.targetPath = forced.path
      result.trace.push(...forced.trace)
      result.thermal.push(...forced.thermal)
      const vacated = axialKey(forced.actor.hex) !== axialKey(target.hex)
      result.actor.hex = vacated ? cloneHex(contactHex) : cloneHex(contactHexes[Math.max(0, firstContactIndex - 1)] ?? original.hex)
      result.path = contactHexes.slice(0, firstContactIndex + (vacated ? 1 : 0))
      if (collisionDamage && dissipatedM > 0) {
        impactDamage = dissipatedM * 5
        targetUpdate.hp = Math.max(0, targetUpdate.hp - impactDamage)
      }
    }
  }

  if (actionId === 'attack' && targetHex) {
    const target = findActorAt(actors, targetHex, original.id)
    if (target) {
      const attacked = targetUpdate && targetUpdate.id === target.id ? targetUpdate : createMomentumActor(target)
      attacked.hp = Math.max(0, attacked.hp - 10)
      targetUpdate = attacked
      result.trace.push({ source: 'Attack', cause: 'Attack Payload', actorId: target.id, damage: 10 })
    } else {
      result.trace.push({ source: 'Attack', cause: 'Whiff', axisId: result.attackAxisId })
    }
  }

  if (dissipatedM > 0) result.thermal.push(thermalEvent('Collision dissipatedM', dissipatedM, 'hotward', 'collision', 'both'))

  return {
    ...result,
    targetUpdate,
    dissipatedM,
    impactDamage,
  }
}

export function resolveThermalEvents(events = [], {
  momentumFactor = 0.8,
  collisionHeatFactor = 0.8,
} = {}) {
  return events.map((event) => {
    const factor = event.factorKind === 'collision' ? collisionHeatFactor : momentumFactor
    const sign = event.polarity === 'coldward' ? -1 : event.polarity === 'hotward' ? 1 : 0
    return {
      ...event,
      factor,
      impulse: sign * event.amount * factor,
    }
  })
}

export function resolveDomainNaturalBuild(actor, thermalDomain, {
  enabled = true,
  spentH = false,
  spentD = false,
  hadHorizontalTravel = false,
  stable = true,
} = {}) {
  const next = createMomentumActor(actor)
  const trace = []
  if (!enabled) return { actor: next, trace }

  if (thermalDomain === 'HOT' && next.axisId && hadHorizontalTravel) {
    if (spentH) {
      trace.push({ source: 'Domain Natural Build', channel: 'H', suppressed: true, reason: 'same-AT no-refund' })
    } else if (next.hM < MAX_HORIZONTAL_M) {
      const before = next.hM
      next.hM += 1
      trace.push({ source: 'Domain Natural Build', channel: 'H', fromM: before, toM: next.hM, suppressed: false })
    }
  }

  if (thermalDomain === 'COLD' && stable && !next.axisId) {
    if (spentD) {
      trace.push({ source: 'Domain Natural Build', channel: 'D', suppressed: true, reason: 'same-AT no-refund' })
    } else {
      next.downPrepared = true
      if (next.downM < MAX_DOWN_M) {
        const before = next.downM
        next.downM += 1
        trace.push({ source: 'Domain Natural Build', channel: 'D', fromM: before, toM: next.downM, suppressed: false })
      }
    }
  }

  return { actor: next, trace }
}

export function createDefaultEnemies() {
  return [
    createMomentumActor({ id: 'enemy-a', hex: { q: 3, r: 0 }, hp: 40, axisId: 'W', intent: 'move' }),
    createMomentumActor({ id: 'enemy-b', hex: { q: -2, r: 2 }, hp: 40, intent: 'brace' }),
  ]
}

const ENEMY_CYCLES = Object.freeze({
  'enemy-a': ['move', 'attack', 'brace'],
  'enemy-b': ['brace', 'move', 'attack', 'skip'],
})

export function advanceTelegraphedEnemies(enemies, player, boardRadius = 5) {
  const nextEnemies = enemies.map((entry) => createMomentumActor(entry))
  const trace = []
  let nextPlayer = createMomentumActor(player)

  for (let index = 0; index < nextEnemies.length; index += 1) {
    const enemy = nextEnemies[index]
    if (enemy.hp <= 0) continue
    const cycle = ENEMY_CYCLES[enemy.id] ?? ['move', 'attack', 'skip']
    const actionId = enemy.intent || cycle[enemy.intentIndex % cycle.length]
    const distance = axialDistance(enemy.hex, nextPlayer.hex)

    if (actionId === 'attack' && distance === 1) {
      nextPlayer.hp = Math.max(0, nextPlayer.hp - 8)
      trace.push({ source: enemy.id, cause: 'Enemy Attack', damage: 8 })
    } else if (actionId === 'brace') {
      const resolved = applyBrace(enemy)
      nextEnemies[index] = resolved.actor
      trace.push(...resolved.trace.map((event) => ({ ...event, source: enemy.id })))
    } else if (actionId === 'move' && distance > 1) {
      const axisId = directionToward(enemy.hex, nextPlayer.hex)
      const nextHex = stepHex(enemy.hex, axisId)
      if (inside(nextHex, boardRadius) && !findActorAt(nextEnemies, nextHex, enemy.id) && axialKey(nextHex) !== axialKey(nextPlayer.hex)) {
        enemy.hex = nextHex
        enemy.axisId = axisId
        trace.push({ source: enemy.id, cause: 'Enemy Move', axisId })
      }
    }

    const updated = nextEnemies[index]
    updated.intentIndex = (updated.intentIndex + 1) % cycle.length
    updated.intent = cycle[updated.intentIndex]
  }

  return { enemies: nextEnemies, player: nextPlayer, trace }
}
