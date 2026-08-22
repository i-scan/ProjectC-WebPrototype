import { describe, expect, it } from 'vitest'
import {
  THERMAL_HALF_PERIOD_AT,
  THERMAL_PERIOD_AT,
  advanceThermal,
  createInitialThermalState,
  sampleThermalTransition,
} from './thermal.js'

describe('thermal AT timing', () => {
  it('defines one full thermal cycle as 8 AT and half swing as 4 AT', () => {
    expect(THERMAL_PERIOD_AT).toBe(8)
    expect(THERMAL_HALF_PERIOD_AT).toBe(4)
  })

  it('samples the same deterministic transition continuously inside one movement AT', () => {
    const start = createInitialThermalState()
    const quarter = sampleThermalTransition(start, 'generate', 0.25)
    const half = sampleThermalTransition(start, 'generate', 0.5)
    const full = sampleThermalTransition(start, 'generate', 1)
    const direct = advanceThermal(start, 'generate', 1)

    expect(quarter).not.toEqual(start)
    expect(half).not.toEqual(quarter)
    expect(full.temperature).toBeCloseTo(direct.temperature, 10)
    expect(full.drift).toBeCloseTo(direct.drift, 10)
  })

  it('keeps zero-progress playback visually at the committed thermal state', () => {
    const start = { temperature: 1.6, drift: -0.3, setPoint: 1 }
    expect(sampleThermalTransition(start, 'use', 0)).toEqual(start)
  })
})
