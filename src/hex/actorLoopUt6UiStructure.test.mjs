import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const mainPath = fileURLToPath(new URL('../main.tsx', import.meta.url))
const labPath = fileURLToPath(new URL('./ActorLoopPlayground.tsx', import.meta.url))
const rulesPath = fileURLToPath(new URL('./actorLoopUt6.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../config/experiments/val-012-actor-loop-v0.v6.json', import.meta.url))
const main = readFileSync(mainPath, 'utf8')
const lab = readFileSync(labPath, 'utf8')
const rules = readFileSync(rulesPath, 'utf8')
const config = JSON.parse(readFileSync(configPath, 'utf8'))

describe('UT6 Actor Loop playground structure', () => {
  it('remains reproducible as historical source while the impulse-driving lab owns #hex-prototype', () => {
    expect(main).toContain("import { ImpulseInertiaPlayground } from './hex/ImpulseInertiaPlayground'")
    expect(main).toContain("{view === 'impulse' && <ImpulseInertiaPlayground />}")
    expect(main).not.toContain("<ActorLoopPlayground />")
    expect(main).not.toContain("#hex-ut6")
    expect(lab).toContain('VAL-012-UT6-candidate')
    expect(config.rulesetVersion).toBe('VAL-012-UT6-candidate')
    expect(config.implementationId).toBe('actor-loop-playground-v0')
  })

  it('presents the producer-reviewed seven-action candidate set without reviving generic chain grammar', () => {
    for (const action of ['Basic Move', 'Basic Attack', 'Launch', 'Brake', 'Drive', 'Raikiri', 'Ground Break']) {
      expect(lab).toContain(action)
    }
    expect(lab).toContain('不使用通用 Chain Window')
    expect(lab).not.toContain('Intro → Core → Outro')
    expect(rules).not.toContain('Chain Window')
    expect(rules).not.toContain('Link Token')
    expect(rules).not.toContain('Pending Momentum')
  })

  it('keeps Basic Action Spend and same-AT no-refund frozen rather than exposing Sustain as a selectable A/B', () => {
    expect(config.momentum.basicMoveSpendEnabled).toBe(true)
    expect(config.momentum.basicAttackDownSpendEnabled).toBe(true)
    expect(config.momentum.rebuildSpentMomentumSameAt).toBe(false)
    expect(rules).toContain('Same-AT Spend Lock: no refund Build')
    expect(lab).toContain('Basic Move / Attack 的 Spend 与 same-AT no-refund 已冻结，不再提供 Sustain A/B。')
    expect(lab).not.toContain('Consume vs Sustain')
    expect(lab).not.toContain('Sustain · ON')
    expect(lab).not.toContain('Sustain · OFF')
  })

  it('keeps open questions as explicit Actor Loop A/B controls', () => {
    expect(lab).toContain('Natural Start')
    expect(lab).toContain('Launch/Brake Min')
    expect(lab).toContain('Conversion same-AT Build')
    expect(lab).toContain('Drive Preserve')
    expect(lab).toContain('Drive Continuous')
    expect(lab).toContain('AT0 ·')
    expect(lab).toContain('Thermal Release')
    expect(config.momentum.momentumProtectionEnabled).toBe(false)
  })

  it('keeps Hold Ground clearly scoped as a playground behavior sample, not a finalized formal card', () => {
    expect(lab).toContain('Hold Ground 仅是 Playground 的 Grounded-compatible 行为样板，不等于已确定正式 Card。')
    expect(lab).toContain('data-action-id="ground-break"')
    expect(lab).not.toContain('data-action-id="hold-ground"')
  })

  it('supports deterministic preview, whole-action undo, presets, incoming injection and a causality log', () => {
    expect(lab).toContain('const preview = previewOverride ?? hoveredPlan ?? boardPlans[0]?.plan')
    expect(lab).toContain('commitPlan(boardPlan.plan')
    expect(lab).toContain('Undo Whole Action')
    expect(lab).toContain('Presets / Loop Control')
    expect(lab).toContain('Inject Incoming · 0 AT')
    expect(lab).toContain('Event Log')
    expect(lab).toContain('Build / Spend / Convert / Incoming / Thermal Evolution')
  })
})
