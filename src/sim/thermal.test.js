import { describe, expect, it } from 'vitest'
import {
  THERMAL_HALF_PERIOD_AT,
  THERMAL_PERIOD_AT,
  advanceThermal,
  createInitialThermalState,
  sampleThermalTransition,
} from './thermal.js'

function directionChanges(values, epsilon = 1e-7) {
  const signs = []
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1]
    if (Math.abs(delta) <= epsilon) continue
    signs.push(Math.sign(delta))
  }
  let changes = 0
  for (let index = 1; index < signs.length; index += 1) {
    if (signs[index] !== signs[index - 1]) changes += 1
  }
  return changes
}

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

  it('does not create repeated left-right pendulum jitter inside one AT', () => {
    // This state exposed the old ceil(progress * substeps) resampling artifact:
    // adjacent frames could flip thermal direction many times inside one AT.
    const start = { temperature: -2.435, drift: -0.897, setPoint: 1 }
    const temperatures = Array.from({ length: 401 }, (_, index) => (
      sampleThermalTransition(start, 'use', index / 400).temperature
    ))

    // An 8 AT oscillator may legitimately cross one turning point during a
    // particular AT, but it cannot visibly oscillate back and forth repeatedly.
    expect(directionChanges(temperatures)).toBeLessThanOrEqual(1)
  })

  it('keeps zero-progress playback visually at the committed thermal state', () => {
    const start = { temperature: 1.6, drift: -0.3, setPoint: 1 }
    expect(sampleThermalTransition(start, 'use', 0)).toEqual(start)
  })
})
