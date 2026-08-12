import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
const lab = readFileSync(new URL('./Ut5InertiaLab.tsx', import.meta.url), 'utf8')
const oldLab = readFileSync(new URL('./CoupledInertiaLab.tsx', import.meta.url), 'utf8')
const rules = readFileSync(new URL('./coupledInertiaUt5.ts', import.meta.url), 'utf8')
const config = readFileSync(new URL('../../config/experiments/val-012-axis-inertia-lab.v5.json', import.meta.url), 'utf8')

describe('UT5 unified axis inertia sandbox structure', () => {
  it('routes the live inertia lab entry to UT5 while retaining UT4 only as historical code', () => {
    expect(main).toContain("import { Ut5InertiaLab } from './hex/Ut5InertiaLab'")
    expect(main).toContain("{view === 'rules' && <Ut5InertiaLab />}")
    expect(main).not.toContain("<CoupledInertiaLab />")
    expect(oldLab).toContain('VAL-012-UT4')
  })

  it('keeps primary playtest controls in a Hex6-shaped hierarchy', () => {
    for (const marker of [
      'VAL-012-UT5',
      'axis-inertia-sandbox-v1',
      'visual-layout ut4-visual-layout',
      'visual-hand ut4-action-hand',
      'Player Actions',
      'Hold Position',
      'Heavy Release',
      'Inject 0 AT',
      'Hit + Resolve 1 AT',
      '+1 AT',
      '+4 AT',
      'Auto Run',
      'Thermal Debug',
      'Spatial Debug',
      'Reaction A/B',
      'Action / Event Log',
      'Queue Contest',
      'CoupledThermalPendulumPortal',
    ]) expect(lab).toContain(marker)
  })

  it('uses one M + Axis world state and removes live Mode / Anchor semantics', () => {
    expect(rules).toContain('export type SpatialInertiaState = {')
    expect(rules).toContain("{ kind: 'horizontal'; dir: HexDirection }")
    expect(rules).toContain("{ kind: 'down' }")
    expect(rules).not.toContain('SpatialInertiaMode')
    expect(rules).not.toContain('anchorCellId')
    expect(rules).not.toContain('reconcileSpatialWithTemperature')
    expect(lab).not.toContain('Anchor Cell')
  })

  it('keeps thresholds and tunable values in the UT5 experiment config', () => {
    const parsed = JSON.parse(config)
    expect(parsed.rulesetVersion).toBe('VAL-012-UT5')
    expect(parsed.implementationId).toBe('axis-inertia-sandbox-v1')
    expect(parsed.thermal.hotDomainThreshold).toBe(3)
    expect(parsed.thermal.coldDomainThreshold).toBe(-3)
    expect(parsed.spatial.momentumExchangeCap).toBeTypeOf('number')
    expect(parsed.spatial.driveIntroExchangeCap).toBeTypeOf('number')
  })

  it('keeps attack and occupancy as separate rule paths', () => {
    expect(rules).toContain('export function defaultWeaponAction')
    expect(rules).toContain('export function basicMove')
    expect(rules).toContain('function contestCell')
    expect(rules).toContain('Attack ≠ Occupancy')
  })
})
