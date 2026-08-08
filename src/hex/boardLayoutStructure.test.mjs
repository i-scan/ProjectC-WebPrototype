import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./hex.css', import.meta.url), 'utf8')
const component = readFileSync(new URL('./HexPrototype.tsx', import.meta.url), 'utf8')

describe('Hex board layout structure', () => {
  it('reserves a dedicated flexible row with higher specificity than the generic board layout', () => {
    expect(css).toMatch(/\.visual-board-column\.hex-board-column\s*\{[^}]*grid-template-rows:\s*auto auto auto minmax\(0,\s*1fr\) auto;/s)
  })

  it('keeps comparison, time preview, toolbar, board and hand in that source order', () => {
    const markers = [
      'className="hex-comparison-strip"',
      'className="unified-time-preview"',
      'className="visual-board-toolbar"',
      'className={`visual-board-frame hex-board-frame view-${rendererMode}`}',
      'className="visual-hand"',
    ]
    const positions = markers.map((marker) => component.indexOf(marker))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('keeps the UT3 Momentum contract visible and machine-verifiable', () => {
    expect(component).toContain('data-ruleset-id={unifiedTimelineConfig.rulesetId}')
    expect(component).toContain('data-implementation-id={unifiedTimelineConfig.implementationId}')
    expect(component).toContain('data-world-time-at={timeline.worldTimeAt}')
    expect(component).toContain('data-chain-open={spatialInertia.chainOpen}')
    expect(component).toContain('data-action-id="drive"')
    expect(component).toContain('data-action-id="rush-strike"')
    expect(component).toContain("kind: 'momentum'")
    expect(component).toContain("chooseMomentumAction('drive')")
    expect(component).toContain("chooseMomentumAction('rush-strike')")
    expect(component).not.toContain('className="ut2-direction-buttons"')
    expect(component).not.toContain('className="ut2-rush-targets"')
    expect(component).toContain('CHAIN WINDOW · 世界暂停 · 不限时')
  })

  it('uses the global Travel switch and board toolbar instead of duplicate left-panel controls', () => {
    expect(component).not.toContain('>恢复旅行</button>')
    expect(component).not.toContain('>重置镜头</button>')
    expect(component).toContain('>重置视图</button>')
  })

  it('exposes a fine-grained presentation-only AT playback control', () => {
    expect(component).toContain('data-at-playback-control="v1"')
    expect(component).toContain('aria-label="每 AT 播放速度"')
    expect(component).toContain('step={AT_PLAYBACK_RATE_STEP}')
    expect(component).toContain('只改变播放节奏，不改变规则结算与世界时间')
  })
})
