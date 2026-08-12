import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const labPath = fileURLToPath(new URL('./Ut5InertiaLab.tsx', import.meta.url))
const rulesPath = fileURLToPath(new URL('./coupledInertiaUt5.ts', import.meta.url))
const mainPath = fileURLToPath(new URL('../main.tsx', import.meta.url))
const configPath = fileURLToPath(new URL('../../config/experiments/val-012-axis-inertia-lab.v5.json', import.meta.url))
const lab = readFileSync(labPath, 'utf8')
const rules = readFileSync(rulesPath, 'utf8')
const main = readFileSync(mainPath, 'utf8')
const config = JSON.parse(readFileSync(configPath, 'utf8'))

describe('UT5 axis inertia lab contract', () => {
  it('routes the live rules lab to UT5 rather than the historical UT4 sandbox', () => {
    expect(main).toContain("import { Ut5InertiaLab } from './hex/Ut5InertiaLab'")
    expect(main).toContain('惯性实验室 UT5')
    expect(main).toContain("{view === 'rules' && <Ut5InertiaLab />}")
    expect(config.rulesetVersion).toBe('VAL-012-UT5')
    expect(config.implementationId).toBe('axis-inertia-sandbox-v1')
  })

  it('uses one M + Axis state and does not reintroduce UT4 Mode or Anchor semantics', () => {
    expect(rules).toContain("export type SpatialAxis =")
    expect(rules).toContain("{ kind: 'horizontal'; dir: HexDirection }")
    expect(rules).toContain("{ kind: 'down' }")
    expect(rules).toContain('export type SpatialInertiaState = {')
    expect(rules).not.toContain("SpatialInertiaMode")
    expect(rules).not.toContain('anchorCellId')
    expect(rules).not.toContain('reconcileSpatialWithTemperature')
    expect(lab).not.toContain('Mode: Movement / Position')
    expect(lab).not.toContain('Anchor Cell')
  })

  it('exposes the two Hit inspection modes and independent Reaction A/B controls', () => {
    expect(lab).toContain('Inject 0 AT')
    expect(lab).toContain('Hit + Resolve 1 AT')
    expect(lab).toContain('Reaction Sidestep')
    expect(lab).toContain('Failed Fallback')
    expect(rules).toContain('reactionSidestep: false')
    expect(rules).toContain('failedOccupancyFallback: false')
  })

  it('uses immutable DrivePlan preview frames and removes automatic blocked redirects', () => {
    expect(lab).toContain('createDrivePlan(lab, direction, tuning)')
    expect(lab).toContain('const previewPath = previewDrive?.plan.path ?? []')
    expect(lab).toContain('const [first, ...remaining] = candidate.plan.frames')
    expect(rules).toContain('Blocked Crash · no auto redirect')
    expect(rules).not.toContain('Redirect -60°')
    expect(rules).not.toContain('Redirect +60°')
  })

  it('places Nobody Dies as the final direct section in the right sidebar', () => {
    const sidebarStart = lab.indexOf('<aside className="visual-panel visual-right-panel ut4-debug-panel">')
    const nobody = lab.indexOf('data-control="nobody-dies"', sidebarStart)
    const sidebarEnd = lab.indexOf('</aside>', nobody)
    expect(sidebarStart).toBeGreaterThanOrEqual(0)
    expect(nobody).toBeGreaterThan(sidebarStart)
    expect(sidebarEnd).toBeGreaterThan(nobody)
    const afterNobody = lab.slice(nobody, sidebarEnd)
    expect(afterNobody).not.toContain('<section id=')
    expect(afterNobody).not.toContain('<details className="ut4-tuning-details"')
  })
})
