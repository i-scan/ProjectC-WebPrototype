import { describe, expect, it } from 'vitest'
import {
  collectNaturalEvents,
  getThermalClockRuleset,
  getThermalClockScenario,
  stateFromScenario,
} from './thermalClockExperiment'

describe('Thermal Clock period partition', () => {
  const scenario = getThermalClockScenario('T0-hot-apex')

  it('places four Base Beat anchors every 2 AT in an 8 AT period', () => {
    const rules = getThermalClockRuleset('baseline-strict')
    const initial = stateFromScenario(scenario, rules)
    expect(collectNaturalEvents(initial, 8, rules).map((event) => event.actionTime))
      .toEqual([2, 4, 6, 8])
  })

  it('keeps the same four Base Beats but spaces them every 3 AT in a 12 AT period', () => {
    const rules = getThermalClockRuleset('slow-strict')
    const initial = stateFromScenario(scenario, rules)
    expect(collectNaturalEvents(initial, 12, rules).map((event) => event.actionTime))
      .toEqual([3, 6, 9, 12])
  })
})
