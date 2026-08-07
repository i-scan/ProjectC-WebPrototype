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

  it('keeps the UT2 action-chain contract visible and machine-verifiable', () => {
    expect(component).toContain('data-ruleset-id={unifiedTimelineConfig.rulesetId}')
    expect(component).toContain('data-implementation-id={unifiedTimelineConfig.implementationId}')
    expect(component).toContain('data-world-time-at={timeline.worldTimeAt}')
    expect(component).toContain('data-chain-open={spatialInertia.chainOpen}')
    expect(component).toContain('data-action-id="drive"')
    expect(component).toContain('data-action-id="rush-strike"')
    expect(component).toContain('CHAIN WINDOW · 世界暂停 · 不限时')
  })
})
