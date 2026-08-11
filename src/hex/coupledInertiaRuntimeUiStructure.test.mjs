import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const labPath = fileURLToPath(new URL('./CoupledInertiaLab.tsx', import.meta.url))
const surfacePath = fileURLToPath(new URL('./Ut4DiagnosticSurfaceOverlay.tsx', import.meta.url))
const lab = readFileSync(labPath, 'utf8')
const surface = readFileSync(surfacePath, 'utf8')

describe('UT4 runtime lab UI contract', () => {
  it('keeps damage visible with Nobody Dies enabled by default', () => {
    expect(lab).toContain('const LAB_MAX_HP = 12')
    expect(lab).toContain('const [nobodyDies, setNobodyDies] = useState(true)')
    expect(lab).toContain('data-control="nobody-dies"')
    expect(lab).toContain('Nobody Dies:')
    expect(lab).toContain('HP refill')
  })

  it('explains debug-write versus runtime-evolution semantics in the lab itself', () => {
    expect(lab).toContain('Debug 只直接构造数值')
    expect(lab).toContain('Inject Hit 是同一 timeAt 的 0 AT 事件')
    expect(lab).toContain('Forced Motion 不等于 Movement Inertia')
    expect(lab).toContain('完整保持 T ≥ +3')
  })

  it('renders the UT4 Hard and Reflect rules that were previously invisible', () => {
    expect(lab).toContain('<Ut4DiagnosticSurfaceOverlay')
    expect(surface).toContain('labSurfaceLabel')
    expect(surface).toContain('data-surface-label={marker.label}')
    expect(surface).toContain("if (label === 'Hard') return '■'")
    expect(surface).toContain("if (label === 'Reflect L') return '↰'")
  })
})
