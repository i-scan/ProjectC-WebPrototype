import { describe, expect, it } from 'vitest'
import {
  getThermalAction,
  getThermalRuleset,
  getThermalScenario,
  projectThermalApex,
  replayThermalActions,
  resolveThermalFrame,
  thermalExperimentConfig,
  thermalSideFor,
  thermalStateEquals,
  type ActorThermalState,
} from './thermalInertiaExperiment'

describe('VAL-012 stage 1 thermal inertia experiment', () => {
  const strict = getThermalRuleset('strict')
  const capture = getThermalRuleset('capture-window')
  const naturalStep = getThermalAction('natural-step')
  const stabilize = getThermalAction('stabilize')

  it('loads a dedicated Hex6 candidate experiment with stable ids', () => {
    expect(thermalExperimentConfig.validationId).toBe('VAL-012')
    expect(thermalExperimentConfig.activeStage).toBe('stage-1-thermal-inertia-natural-oscillation')
    expect(thermalExperimentConfig.topology).toBe('hex6')
    expect(new Set(thermalExperimentConfig.rulesets.map((item) => item.id)).size)
      .toBe(thermalExperimentConfig.rulesets.length)
    expect(new Set(thermalExperimentConfig.actions.map((item) => item.id)).size)
      .toBe(thermalExperimentConfig.actions.length)
    expect(new Set(thermalExperimentConfig.scenarios.map((item) => item.id)).size)
      .toBe(thermalExperimentConfig.scenarios.length)
  })

  it('derives side from Temperature relative to Set Point', () => {
    expect(thermalSideFor(-1, 0)).toBe('cold')
    expect(thermalSideFor(1, 1)).toBe('neutral')
    expect(thermalSideFor(2, 1)).toBe('hot')
  })

  it('uses start-of-step Offset to apply restoring force before movement', () => {
    const result = resolveThermalFrame(
      { temperature: 3, setPoint: 0, drift: 0 },
      naturalStep,
      strict,
    )

    expect(result.trace.offsetBefore).toBe(3)
    expect(result.trace.externalImpulse).toBe(0)
    expect(result.trace.restoringForce).toBe(-1)
    expect(result.trace.driftAfter).toBe(-1)
    expect(result.after.temperature).toBe(2)
  })

  it('forms a deterministic natural oscillation and projects the next apex', () => {
    const initial = getThermalScenario('T1-natural-oscillation').state
    const projection = projectThermalApex(initial, strict)

    expect(projection.reachedApex).toBe(true)
    expect(projection.steps).toBe(6)
    expect(projection.apexState.temperature).toBe(-2)
    expect(projection.apexState.drift).toBe(0)
    expect(projection.path.map((state) => [state.temperature, state.drift])).toEqual([
      [3, 0],
      [2, -1],
      [1, -2],
      [0, -2],
      [-1, -2],
      [-2, -1],
      [-2, 0],
    ])
  })

  it('makes the same Temperature produce different decisions when Drift differs', () => {
    const hotDrift = resolveThermalFrame(
      { temperature: 1, setPoint: 0, drift: 1 },
      getThermalAction('push-hot'),
      strict,
    )
    const coldDrift = resolveThermalFrame(
      { temperature: 1, setPoint: 0, drift: -1 },
      getThermalAction('push-hot'),
      strict,
    )

    expect(hotDrift.after).toMatchObject({ temperature: 2, drift: 1 })
    expect(coldDrift.after).toMatchObject({ temperature: 1, drift: 0 })
    expect(hotDrift.projectedApex.apexState.temperature)
      .not.toBe(coldDrift.projectedApex.apexState.temperature)
  })

  it('keeps strict Settle separate from the optional capture window', () => {
    const initial = getThermalScenario('T3-settle-capture').state
    const strictResult = resolveThermalFrame(initial, stabilize, strict)
    const captureResult = resolveThermalFrame(initial, stabilize, capture)

    expect(strictResult.after).toMatchObject({ temperature: 0, drift: -1 })
    expect(strictResult.trace.events.crossing).toBe(true)
    expect(strictResult.trace.events.settle).toBe(false)
    expect(strictResult.trace.events.capture).toBe(false)

    expect(captureResult.after).toMatchObject({ temperature: 0, drift: 0 })
    expect(captureResult.trace.events.settle).toBe(true)
    expect(captureResult.trace.events.capture).toBe(true)
  })

  it('records crossing first and Overshoot only after leaving Set Point', () => {
    const crossing = resolveThermalFrame(
      { temperature: 1, setPoint: 0, drift: -1 },
      naturalStep,
      strict,
    )
    expect(crossing.after).toMatchObject({
      temperature: 0,
      drift: -2,
      crossingFromSide: 'hot',
    })
    expect(crossing.trace.events.crossing).toBe(true)
    expect(crossing.trace.events.overshoot).toBe(false)

    const overshoot = resolveThermalFrame(crossing.after, naturalStep, strict)
    expect(overshoot.after).toMatchObject({ temperature: -1, drift: -2 })
    expect(overshoot.trace.events.overshoot).toBe(true)
    expect(overshoot.after.crossingFromSide).toBeNull()
  })

  it('does not call a Set Point crossing Neutral unless Drift is also zero', () => {
    const crossing = resolveThermalFrame(
      { temperature: 1, setPoint: 0, drift: -1 },
      naturalStep,
      strict,
    )
    expect(crossing.after.temperature).toBe(crossing.after.setPoint)
    expect(crossing.after.drift).not.toBe(0)
    expect(crossing.trace.events.settle).toBe(false)

    const neutral = resolveThermalFrame(
      { temperature: 0, setPoint: 0, drift: 1 },
      stabilize,
      strict,
    )
    expect(neutral.after).toMatchObject({ temperature: 0, setPoint: 0, drift: 0 })
    expect(neutral.trace.events.settle).toBe(true)
  })

  it('supports a warm-blooded Set Point without treating zero as the center', () => {
    const initial = getThermalScenario('T1-warm-set-point').state
    const result = resolveThermalFrame(initial, naturalStep, strict)

    expect(result.trace.offsetBefore).toBe(-3)
    expect(result.trace.restoringForce).toBe(1)
    expect(result.after).toMatchObject({ temperature: -1, setPoint: 1, drift: 1 })
  })

  it('caps Drift and Temperature at the experiment ruleset boundary', () => {
    const result = resolveThermalFrame(
      { temperature: 4, setPoint: 0, drift: 2 },
      getThermalAction('push-hot'),
      strict,
    )

    expect(result.trace.driftAfterImpulse).toBe(2)
    expect(result.after.temperature).toBe(4)
    expect(result.trace.events.boundaryClipped).toBe(true)
  })

  it('replays a fixed action sequence deterministically', () => {
    const initial: ActorThermalState = { temperature: 3, setPoint: 0, drift: 0 }
    const actionIds = ['natural-step', 'natural-step', 'push-hot', 'stabilize']
    const first = replayThermalActions(initial, actionIds, strict)
    const second = replayThermalActions(initial, actionIds, strict)

    expect(first.map((item) => item.trace)).toEqual(second.map((item) => item.trace))
    expect(thermalStateEquals(first.at(-1)!.after, second.at(-1)!.after)).toBe(true)
  })
})
