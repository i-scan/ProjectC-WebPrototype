import { describe, expect, it } from 'vitest'
import {
  THERMAL_HALF_PERIOD_AT,
  THERMAL_PERIOD_AT,
  advanceThermal,
  createInitialThermalState,
  interpolateThermalVisual,
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

  it('does not create repeated left-right solver jitter inside one AT', () => {
    const start = { temperature: -2.435, drift: -0.897, setPoint: 1 }
    const temperatures = Array.from({ length: 401 }, (_, index) => (
      sampleThermalTransition(start, 'use', index / 400).temperature
    ))
    expect(directionChanges(temperatures)).toBeLessThanOrEqual(1)
  })

  it('presents one committed AT as a monotonic pendulum segment', () => {
    const start = { temperature: -2.435, drift: -0.897, setPoint: 1 }
    const end = advanceThermal(start, 'use', 1)
    const temperatures = Array.from({ length: 401 }, (_, index) => (
      interpolateThermalVisual(start, end, index / 400).temperature
    ))

    expect(directionChanges(temperatures)).toBe(0)
    expect(temperatures[0]).toBeCloseTo(start.temperature, 10)
    expect(temperatures.at(-1)).toBeCloseTo(end.temperature, 10)
  })

  it('keeps zero-progress playback visually at the committed thermal state', () => {
    const start = { temperature: 1.6, drift: -0.3, setPoint: 1 }
    expect(sampleThermalTransition(start, 'use', 0)).toEqual(start)
    expect(interpolateThermalVisual(start, advanceThermal(start, 'use', 1), 0)).toEqual(start)
  })
})
