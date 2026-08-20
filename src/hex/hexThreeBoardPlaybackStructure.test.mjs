import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const boardPath = fileURLToPath(new URL('./HexThreeBoard.tsx', import.meta.url))
const cssPath = fileURLToPath(new URL('./actor-loop-ut6.css', import.meta.url))
const board = readFileSync(boardPath, 'utf8')
const css = readFileSync(cssPath, 'utf8')

describe('HexThreeBoard playback stability', () => {
  it('consumes each PlaybackEvent id only once even when preview props re-render', () => {
    expect(board).toContain('const playedEventIdRef = useRef<number | null>(null)')
    expect(board).toContain('playedEventIdRef.current !== event.id')
    expect(board).toContain('playedEventIdRef.current = event.id')
    expect(board).toContain('host.dataset.playbackStartCount')
  })

  it('uses semantic render keys so equivalent hover previews do not rebuild the Three scene', () => {
    expect(board).toContain("const travelPathRenderKey = travelPath.map(coordKey).join('|')")
    expect(board).toContain('const selectionRenderKey = JSON.stringify')
    expect(board).toContain('route: undefined')
    expect(board).toContain('[state, mode, travelPathRenderKey, travelTarget, travelPreference, selectionRenderKey')
  })

  it('surfaces real HP loss as a short screen impact cue', () => {
    expect(board).toContain('previousActorHpRef')
    expect(board).toContain('actor.hp < previousHp')
    expect(board).toContain('showDamageFeedback(hostRef.current, damageAmount)')
    expect(board).toContain('HIT · -${amount} HP')
    expect(css).toContain('.ut6-actor-loop .hex-board-impact-feedback')
    expect(css).toContain('@keyframes ut6-impact-screen')
  })
})
