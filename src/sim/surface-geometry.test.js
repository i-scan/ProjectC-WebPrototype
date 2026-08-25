import { describe, expect, it } from 'vitest'
import { axialToWorld } from './hex.js'
import { boardBoundaryImpact, mirrorHexDirection, obstacleHexImpact } from './surface-geometry.js'

describe('clipped mirror surface geometry', () => {
  it('uses one fixed side face normal instead of a radial normal', () => {
    const impact = boardBoundaryImpact(axialToWorld({ q: 3, r: -1 }), axialToWorld({ q: 4, r: -1 }), 3)
    expect(impact).toMatchObject({ kind: 'boundary', faceIds: ['+q'] })
    expect(impact.t).toBeCloseTo(0.5, 5)
    expect(mirrorHexDirection('E', impact.normal).direction?.id).toBe('SW')
  })

  it('uses the symmetric corner chamfer to turn edge travel onto the neighboring edge', () => {
    const impact = boardBoundaryImpact(axialToWorld({ q: 3, r: 0 }), axialToWorld({ q: 3, r: 1 }), 3)
    expect(impact).toMatchObject({
      kind: 'boundary-corner-chamfer',
      faceIds: ['+q', '-s'],
      cornerHex: { q: 3, r: 0 },
    })
    expect(impact.t).toBeCloseTo(0.5, 5)
    expect(mirrorHexDirection('SE', impact.normal).direction?.id).toBe('SW')
  })

  it('uses the contacted hex face for authored wall Cells', () => {
    const impact = obstacleHexImpact(
      axialToWorld({ q: 2, r: 0 }),
      axialToWorld({ q: 3, r: 0 }),
      { q: 3, r: 0 },
    )
    expect(impact).toMatchObject({ kind: 'obstacle' })
    expect(impact.t).toBeCloseTo(0.5, 5)
    expect(mirrorHexDirection('E', impact.normal).direction?.id).toBe('W')
  })
})
