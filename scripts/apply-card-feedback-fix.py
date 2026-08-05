from pathlib import Path

path = Path('src/hex/HexPrototype.tsx')
source = path.read_text(encoding='utf-8')

bridge = """  const bridgeCardAction = (
    before: GameState,
    after: GameState,
    card: Card,
  ): boolean => {
    const succeeded = before.hand.includes(card.id) && !after.hand.includes(card.id)
    if (!succeeded) return false
    emitThermalAction({
      source: 'card',
      id: card.id,
      label: `卡牌 · ${card.name}`,
      baseApCost: card.cost,
      actionTime: Math.max(1, card.cost),
      offsetDelta: getPlayer(after).bodyTemperature - getPlayer(before).bodyTemperature,
    })
    return true
  }
"""
replacement = bridge + """
  const resolveCardAttempt = (
    before: GameState,
    after: GameState,
    card: Card,
    fallbackTarget?: Coord,
  ): boolean => {
    const cardPlayed = bridgeCardAction(before, after, card)
    if (!cardPlayed) {
      // Keep the failure log, but do not create undo history or visual playback.
      setState(after)
      return false
    }
    queueTransition(
      before,
      after,
      eventKindForCard(card),
      fallbackTarget,
      captureHistory(before, true),
    )
    return true
  }
"""
if source.count(bridge) != 1:
    raise SystemExit('bridgeCardAction insertion point changed')
source = source.replace(bridge, replacement, 1)

targeted_before = """    if (selection.kind === 'card') {
      const before = state
      const after = playHexCard(before, selection.card.id, coord, targetLayer)
      const thermalAdvanced = bridgeCardAction(before, after, selection.card)
      queueTransition(
        before,
        after,
        eventKindForCard(selection.card),
        coord,
        captureHistory(before, thermalAdvanced),
      )
      setSelection({ kind: 'inspect' })
    }
"""
targeted_after = """    if (selection.kind === 'card') {
      const before = state
      const after = playHexCard(before, selection.card.id, coord, targetLayer)
      const cardPlayed = resolveCardAttempt(before, after, selection.card, coord)
      if (cardPlayed) setSelection({ kind: 'inspect' })
    }
"""
if source.count(targeted_before) != 1:
    raise SystemExit('targeted card handler changed')
source = source.replace(targeted_before, targeted_after, 1)

self_before = """    if (card.target === 'self') {
      const before = state
      const after = playHexCard(before, card.id, undefined, targetLayer)
      const thermalAdvanced = bridgeCardAction(before, after, card)
      queueTransition(
        before,
        after,
        eventKindForCard(card),
        player.position,
        captureHistory(before, thermalAdvanced),
      )
      setSelection({ kind: 'inspect' })
      return
    }
"""
self_after = """    if (card.target === 'self') {
      const before = state
      const after = playHexCard(before, card.id, undefined, targetLayer)
      resolveCardAttempt(before, after, card, player.position)
      setSelection({ kind: 'inspect' })
      return
    }
"""
if source.count(self_before) != 1:
    raise SystemExit('self-target card handler changed')
source = source.replace(self_before, self_after, 1)
path.write_text(source, encoding='utf-8')

Path('src/hex/cardFeedbackStructure.test.mjs').write_text("""import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const prototypePath = fileURLToPath(new URL('./HexPrototype.tsx', import.meta.url))
const source = readFileSync(prototypePath, 'utf8')

describe('card playback feedback boundary', () => {
  it('updates failure logs without queuing playback or undo history', () => {
    const resolverStart = source.indexOf('const resolveCardAttempt = (')
    const resolverEnd = source.indexOf('function planTravel', resolverStart)
    const resolver = source.slice(resolverStart, resolverEnd)
    const failureGuard = resolver.indexOf('if (!cardPlayed)')
    const stateUpdate = resolver.indexOf('setState(after)', failureGuard)
    const earlyReturn = resolver.indexOf('return false', stateUpdate)
    const transition = resolver.indexOf('queueTransition(', earlyReturn)

    expect(resolverStart).toBeGreaterThan(-1)
    expect(failureGuard).toBeGreaterThan(-1)
    expect(stateUpdate).toBeGreaterThan(failureGuard)
    expect(earlyReturn).toBeGreaterThan(stateUpdate)
    expect(transition).toBeGreaterThan(earlyReturn)
    expect(resolver).toContain('captureHistory(before, true)')
  })

  it('keeps targeted cards selected after failure and clears them after success', () => {
    expect(source).toContain('const cardPlayed = resolveCardAttempt(before, after, selection.card, coord)')
    expect(source).toContain("if (cardPlayed) setSelection({ kind: 'inspect' })")
  })
})
""", encoding='utf-8')
