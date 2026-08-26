import { describe, expect, it } from 'vitest'
import { axialToWorld } from './hex.js'
import {
  MIRROR_QUANTIZATION_RULE,
  OBSTACLE_SURFACE_RULE,
  boardBoundaryImpact,
  firstSurfaceImpact,
  mirrorHexDirection,
  mirrorStepOptions,
  obstacleBoxImpact,
} from './surface-geometry.js'

const hardWall = {
  id: 'wall',
  hex: { q: 3, r: 0 },
  kind: 'hard',
  shape: 'box',
  sizeX: 0.76,
  sizeZ: 0.20,
  rotation: 0,
}

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

  it('hits the rendered hard-wall end cap instead of the Hex Cell entry edge', () => {
    const impact = obstacleBoxImpact(
      axialToWorld({ q: 2, r: 0 }),
      axialToWorld({ q: 3, r: 0 }),
      hardWall,
    )
    expect(impact).toMatchObject({
      kind: 'obstacle-box-face',
      faceIds: ['x-'],
      footprintRule: OBSTACLE_SURFACE_RULE,
    })
    expect(impact.t).toBeCloseTo(0.62, 5)
    expect(impact.point.x).toBeCloseTo(2.62, 5)
    expect(impact.point.z).toBeCloseTo(0, 5)
    expect(impact.normal.x).toBeCloseTo(-1, 5)
    expect(impact.normal.z).toBeCloseTo(0, 5)
    expect(mirrorHexDirection('E', impact.normal).direction?.id).toBe('W')
  })

  it('uses the wall face actually hit by an oblique NE ray and turns the first reflected Cell to SE immediately', () => {
    const fromHex = { q: 2, r: 1 }
    const impact = firstSurfaceImpact({
      fromWorld: axialToWorld(fromHex),
      toWorld: axialToWorld(hardWall.hex),
      boardRadius: 7,
      obstacle: hardWall,
    })

    expect(impact).toMatchObject({
      surface: 'obstacle',
      kind: 'obstacle-box-face',
      faceIds: ['z+'],
      footprintRule: OBSTACLE_SURFACE_RULE,
    })
    expect(impact.point.z).toBeCloseTo(0.1, 5)
    expect(impact.normal.x).toBeCloseTo(0, 5)
    expect(impact.normal.z).toBeCloseTo(1, 5)
    expect(mirrorHexDirection('NE', impact.normal).direction?.id).toBe('SE')

    const options = mirrorStepOptions('NE', impact, fromHex)
    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({
      direction: { id: 'SE' },
      footprintRule: OBSTACLE_SURFACE_RULE,
      quantizationRule: MIRROR_QUANTIZATION_RULE,
    })
    expect(options[0].reflected.x).toBeGreaterThan(0)
    expect(options[0].reflected.z).toBeGreaterThan(0)
  })
})
