import { HEX_DIRECTIONS, axialDistance, axialKey } from '../../sim/hex.js'
import { createMomentumActor } from './gameplay-momentum-model.js'

export const GAMEPLAY_LINK_WINDOW_RULE = 'gameplay-link-window-p0-turn-based-hooks-v1'

export const CONTACT_LINK_ACTIONS = Object.freeze([
  { id: 'continue', label: 'Continue', badge: 'FLOW', short: 'Preserve the resolved state and keep the original intent.' },
  { id: 'strike', label: 'Strike', badge: 'HIT', short: 'Cash the Contact opportunity into immediate payload.' },
  { id: 'brace', label: 'Brace', badge: 'HOLD', short: 'Trade mobility for Down-side stability and hold space.' },
  { id: 'evade', label: 'Evade', badge: 'SHIFT', short: 'Give up the contest and change the spatial relationship.' },
])

const clone = (value) => structuredClone(value)
const sameHex = (a, b) => a?.q === b?.q && a?.r === b?.r
const inside = (hex, radius) => axialDistance(hex) <= radius

function primaryContact(plan, playerId) {
  const encounters = (plan?.events ?? []).filter((event) =>
    event.type === 'Encounter'
    && event.targetId
    && (event.actorId === playerId || event.targetId === playerId))
  return encounters.at(-1) ?? null
}

function rangedTargets(player, enemies, range = 3) {
  return enemies
    .filter((enemy) => enemy.hp > 0 && axialDistance(player.hex, enemy.hex) <= range)
    .sort((a, b) => axialDistance(player.hex, a.hex) - axialDistance(player.hex, b.hex) || a.id.localeCompare(b.id))
}

export function deriveGameplayLinkWindow({
  plan,
  beforePlayer,
  afterPlayer,
  enemies = [],
  primaryActionId,
  boardRadius = 5,
} = {}) {
  if (!plan?.valid || !afterPlayer) return null

  const encounter = primaryContact(plan, afterPlayer.id)
  if (encounter) {
    const targetId = encounter.actorId === afterPlayer.id ? encounter.targetId : encounter.actorId
    const target = enemies.find((enemy) => enemy.id === targetId)
    if (target?.hp > 0) {
      return {
        id: `link-${plan.contract ?? 'gameplay'}-${encounter.id ?? 'contact'}`,
        rule: GAMEPLAY_LINK_WINDOW_RULE,
        hook: {
          id: `hook-${encounter.id ?? 'contact'}`,
          type: 'Contact',
          sourceEventId: encounter.id ?? null,
          actorId: afterPlayer.id,
          targetId,
        },
        primaryActionId,
        boardRadius,
        title: 'Contact Link',
        description: 'Primary result created Contact. Choose one response or Pass. Link actions cost no additional turn in P0.',
        options: CONTACT_LINK_ACTIONS.map((entry) => ({ ...entry, targetId })),
      }
    }
  }

  const moved = beforePlayer && !sameHex(beforePlayer.hex, afterPlayer.hex)
  if (moved && ['move', 'drive'].includes(primaryActionId)) {
    const targets = rangedTargets(afterPlayer, enemies)
    if (targets.length) {
      return {
        id: `link-${plan.contract ?? 'gameplay'}-after-move`,
        rule: GAMEPLAY_LINK_WINDOW_RULE,
        hook: {
          id: `hook-after-move-${axialKey(afterPlayer.hex)}`,
          type: 'AfterMove',
          sourceEventId: null,
          actorId: afterPlayer.id,
          targetId: null,
        },
        primaryActionId,
        boardRadius,
        title: 'AfterMove Link',
        description: 'Movement completed without a Contact decision. Ranged Strike is legal only when a target satisfies the post-move range predicate.',
        options: targets.map((target) => ({
          id: `ranged-strike:${target.id}`,
          label: `Ranged Strike → ${target.id}`,
          badge: 'RNG',
          short: `Range ${axialDistance(afterPlayer.hex, target.hex)} · post-move target predicate satisfied.`,
          targetId: target.id,
        })),
      }
    }
  }

  return null
}

function evadeHex(player, target, enemies, boardRadius) {
  const occupied = new Set(enemies.filter((enemy) => enemy.hp > 0 && enemy.id !== target?.id).map((enemy) => axialKey(enemy.hex)))
  if (target?.hp > 0) occupied.add(axialKey(target.hex))
  const currentDistance = target ? axialDistance(player.hex, target.hex) : 0
  const candidates = HEX_DIRECTIONS
    .map((dir) => ({ q: player.hex.q + dir.q, r: player.hex.r + dir.r }))
    .filter((hex) => inside(hex, boardRadius) && !occupied.has(axialKey(hex)))
    .map((hex) => ({ hex, distance: target ? axialDistance(hex, target.hex) : 0 }))
    .sort((a, b) => b.distance - a.distance || axialKey(a.hex).localeCompare(axialKey(b.hex)))
  return (candidates.find((entry) => entry.distance > currentDistance) ?? candidates[0])?.hex ?? null
}

function trace(stage, summary, detail = {}) {
  return { stage, summary, ...detail }
}

export function resolveGameplayLink({
  window,
  choiceId,
  player,
  enemies = [],
} = {}) {
  if (!window || !choiceId || !player) return { valid: false, reason: 'No active Link Window.' }

  const nextPlayer = createMomentumActor(player)
  const nextEnemies = enemies.map(createMomentumActor)
  const targetId = choiceId.startsWith('ranged-strike:') ? choiceId.split(':')[1] : window.hook?.targetId
  const target = nextEnemies.find((enemy) => enemy.id === targetId)
  const resolution = {
    valid: true,
    rule: GAMEPLAY_LINK_WINDOW_RULE,
    choiceId,
    consumedHook: clone(window.hook),
    player: nextPlayer,
    enemies: nextEnemies,
    trace: [],
    generatedHooks: [],
  }

  if (choiceId === 'continue') {
    resolution.trace.push(
      trace('Payload', 'None · Continue does not invent damage.'),
      trace('Momentum', `Preserve ${nextPlayer.axisId ? `H${nextPlayer.hM} ${nextPlayer.axisId}` : 'current momentum state'}.`),
      trace('Space', 'Preserve the already-resolved spatial result.'),
    )
    resolution.generatedHooks.push({ type: 'Continued', actorId: nextPlayer.id, targetId })
    return resolution
  }

  if (choiceId === 'strike') {
    if (!target?.hp) return { valid: false, reason: 'Contact target is no longer available.' }
    const damage = 10
    target.hp = Math.max(0, target.hp - damage)
    const fromH = nextPlayer.hM
    nextPlayer.hM = Math.max(0, nextPlayer.hM - 1)
    resolution.trace.push(
      trace('Payload', `Strike deals ${damage} payload to ${target.id}.`, { damage, targetId: target.id }),
      trace('Momentum', `Strike commitment spends H ${fromH}→${nextPlayer.hM}.`, { fromH, toH: nextPlayer.hM }),
      trace('Space', 'Hold current Cells; no extra displacement is invented by Strike P0.'),
    )
    resolution.generatedHooks.push({ type: target.hp <= 0 ? 'Kill' : 'Hit', actorId: nextPlayer.id, targetId: target.id })
    return resolution
  }

  if (choiceId === 'brace') {
    const fromH = nextPlayer.hM
    const gain = Math.max(1, fromH)
    nextPlayer.hM = 0
    nextPlayer.axisId = null
    nextPlayer.downPrepared = true
    nextPlayer.downM = Math.min(3, Math.max(nextPlayer.downM, gain))
    resolution.trace.push(
      trace('Payload', 'None · Brace converts the opportunity into stability.'),
      trace('Momentum', `Horizontal H${fromH} → Down D${nextPlayer.downM}.`, { fromH, toD: nextPlayer.downM }),
      trace('Space', 'Hold current Cell. Space follows the Brace momentum settlement.'),
    )
    resolution.generatedHooks.push({ type: 'Braced', actorId: nextPlayer.id, targetId })
    return resolution
  }

  if (choiceId === 'evade') {
    const targetActor = target ?? null
    const destination = evadeHex(nextPlayer, targetActor, nextEnemies, window.boardRadius ?? 5)
    if (!destination) return { valid: false, reason: 'No legal Evade Cell.' }
    const fromH = nextPlayer.hM
    nextPlayer.hM = 0
    nextPlayer.axisId = null
    nextPlayer.hex = { ...destination }
    resolution.trace.push(
      trace('Payload', 'None · Evade gives up the direct contest.'),
      trace('Momentum', `Release horizontal commitment H${fromH}→H0.`, { fromH, toH: 0 }),
      trace('Space', `Reposition to ${axialKey(destination)} after Momentum settles.`, { destination: { ...destination } }),
    )
    resolution.generatedHooks.push({ type: 'Repositioned', actorId: nextPlayer.id, targetId })
    return resolution
  }

  if (choiceId.startsWith('ranged-strike:')) {
    if (!target?.hp) return { valid: false, reason: 'Ranged target is no longer available.' }
    const distance = axialDistance(nextPlayer.hex, target.hex)
    if (distance > 3) return { valid: false, reason: 'Target left Ranged Strike range.' }
    const damage = 8
    target.hp = Math.max(0, target.hp - damage)
    resolution.trace.push(
      trace('Payload', `Ranged Strike deals ${damage} payload to ${target.id}.`, { damage, targetId: target.id }),
      trace('Momentum', 'Preserve current Momentum; ranged follow-up has no P0 momentum tax.'),
      trace('Space', 'No spatial settlement.'),
    )
    resolution.generatedHooks.push({ type: target.hp <= 0 ? 'Kill' : 'Hit', actorId: nextPlayer.id, targetId: target.id })
    return resolution
  }

  return { valid: false, reason: `Unknown Link action: ${choiceId}` }
}
