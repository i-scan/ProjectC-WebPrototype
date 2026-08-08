import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const lab = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./momentum-lab.css', import.meta.url), 'utf8')

describe('UT3 Momentum diagnostic scene structure', () => {
  it('replaces the historical Rules Lab with all T1-T11 diagnostic presets', () => {
    expect(lab).toContain('Momentum 规则实验场景')
    for (const marker of ['T1 Drive → Rush', 'T2 M0 Normal', 'T3 M1 Push', 'T4 M2 Launch', 'T5 M3 Pierce', 'T6 Normal Hit', 'T7 Intercept', 'T8 Hard Wall', 'T9 Reflect Left', 'T10 Reflect Right', 'T11 Brake 180°']) {
      expect(lab).toContain(marker)
    }
    expect(lab).not.toContain('Rules Lab v0')
    expect(lab).not.toContain('移动 · 1 AP')
  })

  it('shares UT3 preview and execution helpers with the Hex prototype', () => {
    expect(lab).toContain('evaluateUt3Action')
    expect(lab).toContain('applyUt3ActionPhase')
    expect(lab).toContain('spatialAfterUt3Action')
    expect(lab).toContain("kind: 'momentum'")
    expect(lab).toContain('validCoords')
  })

  it('keeps the experimental board responsive and exposes rule-result styling', () => {
    expect(css).toContain('.momentum-lab__board .valid-target.drive')
    expect(css).toContain('.momentum-lab__board .valid-target.rush')
    expect(css).toContain('@media (max-width: 1180px)')
    expect(css).toContain('@media (max-width: 760px)')
  })
})
