import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const prototypePath = fileURLToPath(new URL('./HexPrototype.tsx', import.meta.url))
const source = readFileSync(prototypePath, 'utf8')

describe('card playback feedback boundary', () => {
  it('updates failure logs without queuing card playback or undo history', () => {
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

  it('clears a targeted card selection only after a successful play', () => {
    expect(source).toContain('const cardPlayed = resolveCardAttempt(before, after, selection.card, coord)')
    expect(source).toContain("if (cardPlayed) setSelection({ kind: 'inspect' })")
  })
})
