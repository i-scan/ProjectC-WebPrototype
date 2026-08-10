import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
const lab = readFileSync(new URL('./CoupledInertiaLab.tsx', import.meta.url), 'utf8')
const pendulum = readFileSync(new URL('./CoupledThermalPendulumPortal.tsx', import.meta.url), 'utf8')
const rules = readFileSync(new URL('./coupledInertia.ts', import.meta.url), 'utf8')
const config = readFileSync(new URL('../../config/experiments/val-012-coupled-inertia-lab.v4.json', import.meta.url), 'utf8')

describe('UT4 coupled inertia sandbox structure', () => {
  it('routes the inertia lab entry to the UT4 sandbox', () => {
    expect(main).toContain("import { CoupledInertiaLab } from './hex/CoupledInertiaLab'")
    expect(main).toContain("{view === 'rules' && <CoupledInertiaLab />}")
  })

  it('keeps primary playtest controls in a Hex6-shaped hierarchy', () => {
    for (const marker of [
      'VAL-012-UT4',
      'coupled-inertia-sandbox-v1',
      'visual-layout ut4-visual-layout',
      'visual-hand ut4-action-hand',
      'Player Actions',
      'Hold Position',
      'Heavy Release',
      '受击 / Hit Player',
      '+1 AT',
      '+4 AT',
      'Auto Run',
      'Thermal Debug',
      'Spatial Debug',
      'Action / Event Log',
      'Queue Dummy Move',
      'CoupledThermalPendulumPortal',
    ]) expect(lab).toContain(marker)
  })

  it('removes the duplicate bottom Thermal state editor from UT4', () => {
    expect(lab).not.toContain('<ThermalClockLab')
    expect(lab).not.toContain('ut4-lower-layout')
    expect(lab).not.toContain('正式 Thermal Clock')
    expect(pendulum).toContain('UT4 Thermal')
    expect(pendulum).toContain('ut4-controlled-pendulum')
  })

  it('keeps thresholds and tunable values in the UT4 experiment config', () => {
    const parsed = JSON.parse(config)
    expect(parsed.rulesetVersion).toBe('VAL-012-UT4')
    expect(parsed.implementationId).toBe('coupled-inertia-sandbox-v1')
    expect(parsed.thermal.hotDomainThreshold).toBe(3)
    expect(parsed.thermal.coldDomainThreshold).toBe(-3)
    expect(parsed.thermal.damping).toBeTypeOf('number')
    expect(parsed.thermalInputs.hitHotwardDrift ?? parsed.thermalInputs.normalHitHotwardDrift).toBeTypeOf('number')
  })

  it('keeps attack and occupancy as separate rule paths', () => {
    expect(rules).toContain('export function defaultWeaponAction')
    expect(rules).toContain('export function basicMove')
    expect(rules).toContain('function contestCell')
    expect(rules).toContain('no Cell Contest')
  })
})
