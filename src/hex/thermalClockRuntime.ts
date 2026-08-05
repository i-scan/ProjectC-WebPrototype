import type { ThermalClockAction } from './thermalClockExperiment'

export type ThermalClockRuntimeSource = 'basic-action' | 'card' | 'travel' | 'system'

export type ThermalClockRuntimeAction = {
  sequence: number
  type: 'action'
  source: ThermalClockRuntimeSource
  id: string
  label: string
  baseApCost: number
  actionTime: number
  offsetDelta?: number
  driftDelta?: number
}

export type ThermalClockRuntimeCommand = {
  sequence: number
  type: 'undo' | 'restart'
}

export type ThermalClockRuntimeSignal = ThermalClockRuntimeAction | ThermalClockRuntimeCommand

export function runtimeActionToThermalClockAction(
  signal: ThermalClockRuntimeAction,
): ThermalClockAction {
  return {
    id: `runtime-${signal.source}-${signal.id}-${signal.sequence}`,
    label: signal.label,
    shortLabel: `${signal.actionTime} AT`,
    kind: 'impulse',
    baseApCost: Math.max(0, signal.baseApCost),
    baseActionTime: Math.max(0, signal.actionTime),
    immediateOffsetDelta: signal.offsetDelta,
    immediateDriftDelta: signal.driftDelta,
    description: `Hex6 runtime bridge from ${signal.source}.`,
  }
}
