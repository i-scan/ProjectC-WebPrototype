import { describe, expect, it } from 'vitest'
import {
  collectNaturalEvents,
  deriveThermalState,
  getThermalClockAction,
  getThermalClockRuleset,
  getThermalClockScenario,
  replayThermalClockActions,
  resolveThermalAction,
  sessionFromScenario,
  stateFromScenario,
  temperatureFor,
  thermalClockExperimentConfig,
  thermalStateEquals,
  type ThermalClockAction,
  type ThermalSessionState,
} from './thermalClockExperiment'

describe('VAL-012 TC1 continuous Thermal Clock', () => {
  const baseline = getThermalClockRuleset('baseline-strict')
  const capture = getThermalClockRuleset('baseline-capture')

  it('loads a separate Hex6 continuous ruleset without replacing TD1', () => {
    expect(thermalClockExperimentConfig.validationId).toBe('VAL-012')
    expect(thermalClockExperimentConfig.rulesetId).toBe('VAL-012-TC1')
    expect(thermalClockExperimentConfig.implementationId).toBe('thermal-clock-continuous-v1')
    expect(thermalClockExperimentConfig.activeStage).toBe('stage-1-thermal-clock-action-time')
    expect(thermalClockExperimentConfig.topology).toBe('hex6')
    expect(new Set(thermalClockExperimentConfig.rulesets.map((item) => item.id)).size)
      .toBe(thermalClockExperimentConfig.rulesets.length)
    expect(new Set(thermalClockExperimentConfig.actions.map((item) => item.id)).size)
      .toBe(thermalClockExperimentConfig.actions.length)
    expect(new Set(thermalClockExperimentConfig.scenarios.map((item) => item.id)).size)
      .toBe(thermalClockExperimentConfig.scenarios.length)
  })

  it('uses the fixed four-phase clock over one 8 AT period', () => {
    const scenario = getThermalClockScenario('T0-hot-apex')
    const initial = stateFromScenario(scenario, baseline)
    const events = collectNaturalEvents(initial, baseline.thermalPeriodAt, baseline)

    expect(events.map((event) => event.kind)).toEqual([
      'set-point-to-cold',
      'cold-apex',
      'set-point-to-hot',
      'hot-apex',
    ])
    expect(events.map((event) => event.actionTime)).toEqual([
      2,
      4,
      6,
      8,
    ])
    expect(events[0].overshoot).toBe(true)
    expect(events.at(-1)?.overshoot).toBe(false)
  })

  it('keeps Period independent from amplitude', () => {
    const small = stateFromScenario({
      id: 'small',
      label: 'Small',
      group: 'test',
      description: '',
      setPoint: 0,
      amplitude: 1,
      phaseBeat: 0.35,
    }, baseline)
    const large = stateFromScenario({
      id: 'large',
      label: 'Large',
      group: 'test',
      description: '',
      setPoint: 0,
      amplitude: 3.5,
      phaseBeat: 0.35,
    }, baseline)

    const smallTimes = collectNaturalEvents(small, 8, baseline).map((event) => event.actionTime)
    const largeTimes = collectNaturalEvents(large, 8, baseline).map((event) => event.actionTime)
    expect(smallTimes).toEqual(largeTimes)
  })

  it('projects the strictly future opposite-side apex from a current apex', () => {
    const session = sessionFromScenario(getThermalClockScenario('T0-hot-apex'), baseline)
    const derived = deriveThermalState(session.thermal, baseline)

    expect(derived.temperature).toBeCloseTo(3)
    expect(derived.projectedApexTemperature).toBeCloseTo(-3)
    expect(derived.projectedApexInAt).toBeCloseTo(4)
  })

  it('applies direct heat and Drift impulse immediately before advancing AT', () => {
    const session = sessionFromScenario(getThermalClockScenario('T1-hot-returning'), baseline)
    const heat = resolveThermalAction(session, getThermalClockAction('heat-contact'), baseline)
    const drift = resolveThermalAction(session, getThermalClockAction('push-hot'), baseline)

    expect(temperatureFor(heat.immediate.thermal) - temperatureFor(session.thermal)).toBeCloseTo(0.75)
    expect(heat.immediate.elapsedAt).toBe(session.elapsedAt)
    expect(heat.after.elapsedAt).toBeCloseTo(session.elapsedAt + 1)
    expect(drift.immediate.thermal.drift - session.thermal.drift).toBeCloseTo(0.8)
    expect(drift.after.elapsedAt).toBeCloseTo(session.elapsedAt + 1)
  })

  it('keeps AP and AT semantically independent', () => {
    const session = sessionFromScenario(getThermalClockScenario('T1-hot-returning'), baseline)
    const zeroAp = getThermalClockAction('zero-ap-active')
    const reaction = getThermalClockAction('settle-reaction')

    expect(zeroAp.baseApCost).toBe(0)
    expect(zeroAp.baseActionTime).toBe(1)
    expect(resolveThermalAction(session, zeroAp, baseline).after.elapsedAt).toBeCloseTo(1)

    expect(reaction.baseApCost).toBe(0)
    expect(reaction.baseActionTime).toBe(0)
    expect(resolveThermalAction(session, reaction, baseline).after.elapsedAt).toBeCloseTo(0)
  })

  it('offers Strict Settle at a Set Point decision anchor', () => {
    const crossing = sessionFromScenario(getThermalClockScenario('T4-settle-opportunity'), baseline)
    const resolution = resolveThermalAction(crossing, getThermalClockAction('settle-reaction'), baseline)
    const derived = deriveThermalState(resolution.after.thermal, baseline)

    expect(resolution.immediateTrace.settled).toBe(true)
    expect(resolution.summary.settle).toBe(true)
    expect(resolution.summary.capture).toBe(false)
    expect(derived.neutral).toBe(true)
    expect(resolution.after.elapsedAt).toBe(crossing.elapsedAt)
  })

  it('keeps gameplay Capture Window optional and separate from technical epsilon', () => {
    const nearSettle: ThermalSessionState = {
      thermal: { setPoint: 0, offset: 0, drift: 0.15 },
      elapsedAt: 0,
    }
    const captureProbe: ThermalClockAction = {
      id: 'capture-probe',
      label: 'Capture Probe',
      shortLabel: 'Capture',
      kind: 'impulse',
      baseApCost: 0,
      baseActionTime: 0,
      allowCapture: true,
      description: '',
    }

    const strictResult = resolveThermalAction(nearSettle, captureProbe, baseline)
    const captureResult = resolveThermalAction(nearSettle, captureProbe, capture)
    expect(strictResult.summary.settle).toBe(false)
    expect(captureResult.summary.settle).toBe(true)
    expect(captureResult.summary.capture).toBe(true)
  })

  it('detects Crossing and Overshoot inside long actions', () => {
    const session = sessionFromScenario(getThermalClockScenario('T5-long-crossing'), baseline)
    const result = resolveThermalAction(session, getThermalClockAction('long-impact'), baseline)

    expect(result.after.elapsedAt).toBeCloseTo(3)
    expect(result.summary.crossing).toBe(true)
    expect(result.summary.overshoot).toBe(true)
    expect(result.timeline.some((event) => event.kind === 'action-event')).toBe(true)
  })

  it('preserves Overshoot detection when an action event lands exactly on Crossing', () => {
    const session = sessionFromScenario(getThermalClockScenario('T1-hot-returning'), baseline)
    const boundaryEventAction: ThermalClockAction = {
      id: 'boundary-event',
      label: 'Boundary Event',
      shortLabel: 'Boundary',
      kind: 'impulse',
      baseApCost: 2,
      baseActionTime: 2,
      timelineEvents: [{
        id: 'at-crossing',
        label: 'At Crossing',
        timeRatio: 0.5,
      }],
      description: '',
    }

    const result = resolveThermalAction(session, boundaryEventAction, baseline)
    const crossing = result.timeline.find((event) => event.kind === 'set-point-to-cold')
    expect(crossing?.actionTime).toBeCloseTo(1)
    expect(crossing?.overshoot).toBe(true)
    expect(result.summary.overshoot).toBe(true)
  })

  it('keeps a warm Set Point as the oscillator center', () => {
    const session = sessionFromScenario(getThermalClockScenario('T1-warm-set-point'), baseline)
    const derived = deriveThermalState(session.thermal, baseline)

    expect(session.thermal.setPoint).toBe(1)
    expect(derived.temperature).not.toBeCloseTo(session.thermal.offset)
    expect(derived.temperature).toBeCloseTo(1 + session.thermal.offset)
  })

  it('keeps Neutral settled until an immediate event disturbs it', () => {
    const neutral = sessionFromScenario(getThermalClockScenario('T0-neutral'), baseline)
    const flow = resolveThermalAction(neutral, getThermalClockAction('flow-2at'), baseline)
    const heated = resolveThermalAction(neutral, getThermalClockAction('heat-contact'), baseline)

    expect(deriveThermalState(flow.after.thermal, baseline).neutral).toBe(true)
    expect(flow.after.elapsedAt).toBeCloseTo(2)
    expect(deriveThermalState(heated.immediate.thermal, baseline).neutral).toBe(false)
  })

  it('replays the same action timeline deterministically', () => {
    const initial = sessionFromScenario(getThermalClockScenario('T1-hot-returning'), baseline)
    const actions = ['heat-contact', 'flow-1at', 'push-cold', 'long-impact']
    const first = replayThermalClockActions(initial, actions, baseline)
    const second = replayThermalClockActions(initial, actions, baseline)

    expect(first.map((entry) => entry.timeline)).toEqual(second.map((entry) => entry.timeline))
    expect(thermalStateEquals(first.at(-1)!.after.thermal, second.at(-1)!.after.thermal)).toBe(true)
    expect(first.at(-1)!.after.elapsedAt).toBe(second.at(-1)!.after.elapsedAt)
  })
})
