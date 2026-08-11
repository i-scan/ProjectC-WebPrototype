import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const labPath = fileURLToPath(new URL('./CoupledInertiaLab.tsx', import.meta.url))
const overlayPath = fileURLToPath(new URL('./Ut4MovementAxisOverlay.tsx', import.meta.url))
const configPath = fileURLToPath(new URL('../../config/experiments/val-012-coupled-inertia-lab.v4.json', import.meta.url))
const lab = readFileSync(labPath, 'utf8')
const overlay = readFileSync(overlayPath, 'utf8')
const config = JSON.parse(readFileSync(configPath, 'utf8'))

describe('UT4 inertia lab UI contract', () => {
  it('starts and resets from the neutral thermal baseline', () => {
    expect(lab).toContain('function createBaselineLabState()')
    expect(lab).toContain('temperature: 1')
    expect(lab).toContain('drift: 0')
    expect(lab).toContain('setPoint: 1')
    expect(lab).toContain('useState(createBaselineLabState)')
    expect(lab).toContain('const next = createBaselineLabState()')
    expect(config.thermal.damping).toBe(1)
  })

  it('uses quarter-step controls for the primary thermal state', () => {
    expect(lab).toMatch(/label="Temperature"[^\n]*step=\{0\.25\}/)
    expect(lab).toMatch(/label="Drift"[^\n]*step=\{0\.25\}/)
    expect(lab).toMatch(/label="Set Point"[^\n]*step=\{0\.25\}/)
    expect(lab).toContain('Ambient Force')
    expect(lab).toContain('持续外部热力推力')
  })

  it('keeps Basic Move selected and routes Drive through board candidates', () => {
    expect(lab).toContain("type PendingBoardAction = 'move' | 'drive' | 'weapon' | 'heavy' | null")
    expect(lab).toContain("pendingBoardAction === 'move'")
    expect(lab).toContain("? { kind: 'basic', action: 'move' }")
    expect(lab).toContain("pendingBoardAction === 'drive'")
    expect(lab).toContain("{ kind: 'momentum', action: 'drive', validCoords: driveTargets.map((target) => target.coord) }")
    expect(lab).toContain("const target = driveTargets.find((candidate) => sameCoord(candidate.coord, coord))")
    expect(lab).not.toContain('ut4-card-direction-grid')
    expect(lab).toContain('每次点击执行 1 AT，并保持该卡选中')
  })

  it('renders movement-axis arrows as a UT4-only actor overlay', () => {
    expect(lab).toContain('<Ut4MovementAxisOverlay')
    expect(overlay).toContain('UT4 Movement Axis actor overlay')
    expect(overlay).toContain("spatial?.mode !== 'movement' || !spatial.axis")
    expect(overlay).toContain('data-axis={arrow.direction}')
    expect(overlay).toContain('markerEnd="url(#ut4-axis-arrow-head)"')
  })
})
