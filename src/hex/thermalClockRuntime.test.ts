import { describe, expect, it } from 'vitest'
import { runtimeActionToThermalClockAction } from './thermalClockRuntime'

describe('Hex6 Thermal Clock runtime bridge', () => {
  it('keeps AP, AT and immediate body-temperature change separate', () => {
    const action = runtimeActionToThermalClockAction({
      sequence: 4,
      type: 'action',
      source: 'card',
      id: 'grip',
      label: '卡牌 · 紧握',
      baseApCost: 1,
      actionTime: 1,
      offsetDelta: -1,
    })

    expect(action.baseApCost).toBe(1)
    expect(action.baseActionTime).toBe(1)
    expect(action.immediateOffsetDelta).toBe(-1)
    expect(action.immediateDriftDelta).toBeUndefined()
  })

  it('does not force an AP and AT equality in the bridge', () => {
    const action = runtimeActionToThermalClockAction({
      sequence: 7,
      type: 'action',
      source: 'card',
      id: 'quick-drive',
      label: 'Quick Drive',
      baseApCost: 2,
      actionTime: 1,
    })

    expect(action.baseApCost).toBe(2)
    expect(action.baseActionTime).toBe(1)
  })
})
