import experimentConfigJson from '../../config/experiments/val-012-thermal-clock-continuous.v1.json'

const TAU = Math.PI * 2
const QUARTER_TURN = Math.PI / 2
const MIN_PERIOD_AT = 0.001

export type ThermalSide = 'cold' | 'neutral' | 'hot'
export type ThermalDirection = 'cold' | 'still' | 'hot'
export type ThermalAnchorKind = 'hot-apex' | 'set-point-to-cold' | 'cold-apex' | 'set-point-to-hot'
export type ThermalTimelineEventKind = ThermalAnchorKind | 'action-event' | 'settle' | 'capture'

export type ActorThermalState = {
  setPoint: number
  offset: number
  drift: number
}

export type ThermalSessionState = {
  thermal: ActorThermalState
  elapsedAt: number
}

export type ThermalDisplayConfig = {
  temperatureMin: number
  temperatureMax: number
  setPointMin: number
  setPointMax: number
  driftVisualMax: number
}

export type ThermalClockRuleset = {
  id: string
  label: string
  thermalPeriodAt: number
  positionEpsilon: number
  settleEpsilon: number
  captureThreshold: number
}

export type ThermalActionEvent = {
  id: string
  label: string
  timeRatio: number
  offsetDelta?: number
  driftDelta?: number
}

export type ThermalActionKind = 'impulse' | 'stabilize'

export type ThermalClockAction = {
  id: string
  label: string
  shortLabel: string
  kind: ThermalActionKind
  baseApCost: number
  baseActionTime: number
  immediateOffsetDelta?: number
  immediateDriftDelta?: number
  stabilizeStrength?: number
  cancelDrift?: boolean
  allowCapture?: boolean
  timelineEvents?: ThermalActionEvent[]
  description: string
}

export type ThermalClockScenario = {
  id: string
  label: string
  group: string
  description: string
  setPoint: number
  amplitude: number
  phaseBeat: number
}

export type ThermalClockExperimentConfig = {
  schemaVersion: string
  rulesetVersion: string
  updatedAt: string
  status: string
  validationId: string
  activeStage: string
  topology: 'hex6'
  rulesetId: string
  implementationId: string
  designReference: string
  defaultRulesetId: string
  defaultScenarioId: string
  defaultActionId: string
  display: ThermalDisplayConfig
  rulesets: ThermalClockRuleset[]
  actions: ThermalClockAction[]
  scenarios: ThermalClockScenario[]
}

export type ThermalDerivedState = {
  temperature: number
  side: ThermalSide
  direction: ThermalDirection
  neutral: boolean
  amplitude: number
  phaseRadians: number | null
  phaseBeat: number | null
  projectedApexTemperature: number
  projectedApexOffset: number
  projectedApexInAt: number
}

export type ThermalTimelineEvent = {
  kind: ThermalTimelineEventKind
  label: string
  elapsedAt: number
  actionTime: number
  state: ActorThermalState
  overshoot: boolean
  sourceEventId?: string
}

export type ThermalImmediateTrace = {
  offsetDelta: number
  driftDelta: number
  stabilized: number
  captured: boolean
  settled: boolean
}

export type ThermalActionSummary = {
  crossing: boolean
  overshoot: boolean
  apex: boolean
  settle: boolean
  capture: boolean
}

export type ThermalActionResolution = {
  actionId: string
  actionLabel: string
  before: ThermalSessionState
  immediate: ThermalSessionState
  after: ThermalSessionState
  immediateTrace: ThermalImmediateTrace
  timeline: ThermalTimelineEvent[]
  summary: ThermalActionSummary
}

export const thermalClockExperimentConfig = experimentConfigJson as ThermalClockExperimentConfig

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function normalizeAngle(value: number): number {
  const wrapped = value % TAU
  return wrapped < 0 ? wrapped + TAU : wrapped
}

function safePeriod(rules: ThermalClockRuleset): number {
  return Math.max(MIN_PERIOD_AT, finiteOr(rules.thermalPeriodAt, 8))
}

export function angularFrequencyFor(rules: ThermalClockRuleset): number {
  return TAU / safePeriod(rules)
}

export function getThermalClockRuleset(id: string): ThermalClockRuleset {
  return thermalClockExperimentConfig.rulesets.find((item) => item.id === id)
    ?? thermalClockExperimentConfig.rulesets[0]
}

export function getThermalClockAction(id: string): ThermalClockAction {
  return thermalClockExperimentConfig.actions.find((item) => item.id === id)
    ?? thermalClockExperimentConfig.actions[0]
}

export function getThermalClockScenario(id: string): ThermalClockScenario {
  return thermalClockExperimentConfig.scenarios.find((item) => item.id === id)
    ?? thermalClockExperimentConfig.scenarios[0]
}

export function normalizeThermalState(
  rawState: ActorThermalState,
  rules: ThermalClockRuleset,
): ActorThermalState {
  const display = thermalClockExperimentConfig.display
  const setPoint = clamp(
    finiteOr(rawState.setPoint, 0),
    display.setPointMin,
    display.setPointMax,
  )
  let offset = finiteOr(rawState.offset, 0)
  let drift = finiteOr(rawState.drift, 0)

  if (Math.abs(offset) <= rules.positionEpsilon) offset = 0
  if (Math.abs(drift) <= rules.settleEpsilon) drift = 0

  return { setPoint, offset, drift }
}

export function stateFromScenario(
  scenario: ThermalClockScenario,
  rules: ThermalClockRuleset,
): ActorThermalState {
  const amplitude = Math.max(0, finiteOr(scenario.amplitude, 0))
  if (amplitude <= rules.positionEpsilon) {
    return normalizeThermalState({ setPoint: scenario.setPoint, offset: 0, drift: 0 }, rules)
  }

  const phase = finiteOr(scenario.phaseBeat, 0) * QUARTER_TURN
  const omega = angularFrequencyFor(rules)
  return normalizeThermalState({
    setPoint: scenario.setPoint,
    offset: amplitude * Math.cos(phase),
    drift: -amplitude * omega * Math.sin(phase),
  }, rules)
}

export function sessionFromScenario(
  scenario: ThermalClockScenario,
  rules: ThermalClockRuleset,
): ThermalSessionState {
  return {
    thermal: stateFromScenario(scenario, rules),
    elapsedAt: 0,
  }
}

export function temperatureFor(state: ActorThermalState): number {
  return state.setPoint + state.offset
}

export function thermalSideFor(state: ActorThermalState, rules: ThermalClockRuleset): ThermalSide {
  if (state.offset > rules.positionEpsilon) return 'hot'
  if (state.offset < -rules.positionEpsilon) return 'cold'
  return 'neutral'
}

export function thermalDirectionFor(state: ActorThermalState, rules: ThermalClockRuleset): ThermalDirection {
  if (state.drift > rules.settleEpsilon) return 'hot'
  if (state.drift < -rules.settleEpsilon) return 'cold'
  return 'still'
}

export function amplitudeFor(state: ActorThermalState, rules: ThermalClockRuleset): number {
  const omega = angularFrequencyFor(rules)
  return Math.hypot(state.offset, state.drift / omega)
}

export function phaseRadiansFor(state: ActorThermalState, rules: ThermalClockRuleset): number | null {
  const amplitude = amplitudeFor(state, rules)
  if (amplitude <= Math.max(rules.positionEpsilon, rules.settleEpsilon)) return null
  const omega = angularFrequencyFor(rules)
  return normalizeAngle(Math.atan2(-state.drift / omega, state.offset))
}

export function phaseBeatFor(state: ActorThermalState, rules: ThermalClockRuleset): number | null {
  const phase = phaseRadiansFor(state, rules)
  return phase === null ? null : phase / QUARTER_TURN
}

export function isNeutralState(state: ActorThermalState, rules: ThermalClockRuleset): boolean {
  return Math.abs(state.offset) <= rules.positionEpsilon
    && Math.abs(state.drift) <= rules.settleEpsilon
}

export function projectedApexFor(
  state: ActorThermalState,
  rules: ThermalClockRuleset,
): { offset: number; temperature: number; inAt: number } {
  const amplitude = amplitudeFor(state, rules)
  const phase = phaseRadiansFor(state, rules)
  if (phase === null || amplitude <= rules.positionEpsilon) {
    return { offset: 0, temperature: state.setPoint, inAt: 0 }
  }

  const omega = angularFrequencyFor(rules)
  // Project the first strictly future apex. At an apex, the useful forecast is
  // the opposite-side apex rather than the anchor currently occupied.
  const apexIndex = Math.floor((phase + 1e-10) / Math.PI) + 1
  const apexPhase = apexIndex * Math.PI
  const deltaPhase = Math.max(0, apexPhase - phase)
  const offset = Math.cos(apexPhase) >= 0 ? amplitude : -amplitude
  return {
    offset,
    temperature: state.setPoint + offset,
    inAt: deltaPhase / omega,
  }
}

export function deriveThermalState(
  state: ActorThermalState,
  rules: ThermalClockRuleset,
): ThermalDerivedState {
  const normalized = normalizeThermalState(state, rules)
  const projectedApex = projectedApexFor(normalized, rules)
  const phaseRadians = phaseRadiansFor(normalized, rules)
  return {
    temperature: temperatureFor(normalized),
    side: thermalSideFor(normalized, rules),
    direction: thermalDirectionFor(normalized, rules),
    neutral: isNeutralState(normalized, rules),
    amplitude: amplitudeFor(normalized, rules),
    phaseRadians,
    phaseBeat: phaseRadians === null ? null : phaseRadians / QUARTER_TURN,
    projectedApexTemperature: projectedApex.temperature,
    projectedApexOffset: projectedApex.offset,
    projectedApexInAt: projectedApex.inAt,
  }
}

export function advanceThermalState(
  rawState: ActorThermalState,
  deltaAt: number,
  rules: ThermalClockRuleset,
): ActorThermalState {
  const state = normalizeThermalState(rawState, rules)
  const duration = Math.max(0, finiteOr(deltaAt, 0))
  if (duration === 0 || isNeutralState(state, rules)) return state

  const omega = angularFrequencyFor(rules)
  const angle = omega * duration
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return normalizeThermalState({
    setPoint: state.setPoint,
    offset: state.offset * cosine + (state.drift / omega) * sine,
    drift: -state.offset * omega * sine + state.drift * cosine,
  }, rules)
}

function anchorKindFor(index: number): ThermalAnchorKind {
  const normalized = ((index % 4) + 4) % 4
  if (normalized === 0) return 'hot-apex'
  if (normalized === 1) return 'set-point-to-cold'
  if (normalized === 2) return 'cold-apex'
  return 'set-point-to-hot'
}

function anchorLabel(kind: ThermalAnchorKind): string {
  if (kind === 'hot-apex') return 'Hot Apex'
  if (kind === 'cold-apex') return 'Cold Apex'
  if (kind === 'set-point-to-cold') return 'Set Point → Cold'
  return 'Set Point → Hot'
}

export function collectNaturalEvents(
  rawState: ActorThermalState,
  durationAt: number,
  rules: ThermalClockRuleset,
  actionTimeOffset = 0,
  elapsedAtOffset = 0,
): ThermalTimelineEvent[] {
  const state = normalizeThermalState(rawState, rules)
  const duration = Math.max(0, finiteOr(durationAt, 0))
  const phase = phaseRadiansFor(state, rules)
  if (duration <= 0 || phase === null) return []

  const omega = angularFrequencyFor(rules)
  const endPhase = phase + omega * duration
  const phaseEpsilon = 1e-9
  const firstAnchor = Math.floor((phase + phaseEpsilon) / QUARTER_TURN) + 1
  const lastAnchor = Math.floor((endPhase + phaseEpsilon) / QUARTER_TURN)
  const events: ThermalTimelineEvent[] = []

  for (let anchorIndex = firstAnchor; anchorIndex <= lastAnchor; anchorIndex += 1) {
    const anchorPhase = anchorIndex * QUARTER_TURN
    const localAt = (anchorPhase - phase) / omega
    if (localAt <= 1e-9 || localAt > duration + 1e-9) continue

    const kind = anchorKindFor(anchorIndex)
    const anchorState = advanceThermalState(state, localAt, rules)
    const isCrossing = kind === 'set-point-to-cold' || kind === 'set-point-to-hot'
    events.push({
      kind,
      label: anchorLabel(kind),
      elapsedAt: elapsedAtOffset + localAt,
      actionTime: actionTimeOffset + localAt,
      state: anchorState,
      overshoot: isCrossing && localAt < duration - 1e-9,
    })
  }

  return events
}

function applyStateDelta(
  rawState: ActorThermalState,
  offsetDelta: number,
  driftDelta: number,
  rules: ThermalClockRuleset,
): ActorThermalState {
  const state = normalizeThermalState(rawState, rules)
  return normalizeThermalState({
    setPoint: state.setPoint,
    offset: state.offset + finiteOr(offsetDelta, 0),
    drift: state.drift + finiteOr(driftDelta, 0),
  }, rules)
}

function settleState(
  rawState: ActorThermalState,
  rules: ThermalClockRuleset,
  allowCapture: boolean,
): { state: ActorThermalState; settled: boolean; captured: boolean } {
  const state = normalizeThermalState(rawState, rules)
  const atSetPoint = Math.abs(state.offset) <= rules.positionEpsilon
  const strict = atSetPoint && Math.abs(state.drift) <= rules.settleEpsilon
  const captured = !strict
    && allowCapture
    && rules.captureThreshold > 0
    && atSetPoint
    && Math.abs(state.drift) <= rules.captureThreshold

  if (!strict && !captured) return { state, settled: false, captured: false }
  return {
    state: { setPoint: state.setPoint, offset: 0, drift: 0 },
    settled: true,
    captured,
  }
}

function immediateDriftDeltaFor(
  state: ActorThermalState,
  action: ThermalClockAction,
): { driftDelta: number; stabilized: number } {
  const direct = finiteOr(action.immediateDriftDelta ?? 0, 0)
  if (action.kind !== 'stabilize' || state.drift === 0) {
    return { driftDelta: direct, stabilized: 0 }
  }

  const stabilized = action.cancelDrift
    ? Math.abs(state.drift)
    : Math.min(Math.abs(state.drift), Math.max(0, finiteOr(action.stabilizeStrength ?? 0, 0)))
  const stabilizeDelta = -Math.sign(state.drift) * stabilized
  return { driftDelta: direct + stabilizeDelta, stabilized }
}

function markCrossingAtBoundaryAsOvershoot(
  timeline: ThermalTimelineEvent[],
  actionTime: number,
  state: ActorThermalState,
  futureDuration: number,
  rules: ThermalClockRuleset,
): void {
  if (futureDuration <= 1e-9 || Math.abs(state.offset) > rules.positionEpsilon) return
  const crossing = [...timeline].reverse().find((event) => (
    Math.abs(event.actionTime - actionTime) <= 1e-9
    && (event.kind === 'set-point-to-cold' || event.kind === 'set-point-to-hot')
  ))
  if (!crossing) return

  const continuesAcross = crossing.kind === 'set-point-to-cold'
    ? state.drift < -rules.settleEpsilon
    : state.drift > rules.settleEpsilon
  if (continuesAcross) crossing.overshoot = true
}

export function resolveThermalAction(
  rawSession: ThermalSessionState,
  action: ThermalClockAction,
  rules: ThermalClockRuleset,
): ThermalActionResolution {
  const before: ThermalSessionState = {
    thermal: normalizeThermalState(rawSession.thermal, rules),
    elapsedAt: Math.max(0, finiteOr(rawSession.elapsedAt, 0)),
  }
  const actionTime = Math.max(0, finiteOr(action.baseActionTime, 0))
  const immediateOffsetDelta = finiteOr(action.immediateOffsetDelta ?? 0, 0)
  const immediateDrift = immediateDriftDeltaFor(before.thermal, action)
  let immediateState = applyStateDelta(
    before.thermal,
    immediateOffsetDelta,
    immediateDrift.driftDelta,
    rules,
  )

  const zeroTimeEvents = (action.timelineEvents ?? [])
    .filter((event) => finiteOr(event.timeRatio, 0) <= 0)
  let zeroTimeOffsetDelta = 0
  let zeroTimeDriftDelta = 0
  for (const event of zeroTimeEvents) {
    zeroTimeOffsetDelta += finiteOr(event.offsetDelta ?? 0, 0)
    zeroTimeDriftDelta += finiteOr(event.driftDelta ?? 0, 0)
  }
  if (zeroTimeOffsetDelta !== 0 || zeroTimeDriftDelta !== 0) {
    immediateState = applyStateDelta(
      immediateState,
      zeroTimeOffsetDelta,
      zeroTimeDriftDelta,
      rules,
    )
  }

  const immediateSettle = settleState(immediateState, rules, Boolean(action.allowCapture))
  immediateState = immediateSettle.state
  const immediate: ThermalSessionState = {
    thermal: immediateState,
    elapsedAt: before.elapsedAt,
  }

  const timeline: ThermalTimelineEvent[] = []
  if (immediateSettle.settled) {
    timeline.push({
      kind: immediateSettle.captured ? 'capture' : 'settle',
      label: immediateSettle.captured ? 'Capture → Neutral' : 'Settle → Neutral',
      elapsedAt: before.elapsedAt,
      actionTime: 0,
      state: immediateState,
      overshoot: false,
    })
  }

  const timedEvents = (action.timelineEvents ?? [])
    .filter((event) => event.timeRatio > 0)
    .map((event) => ({
      ...event,
      at: clamp(finiteOr(event.timeRatio, 0), 0, 1) * actionTime,
    }))
    .sort((left, right) => left.at - right.at)

  let currentState = immediateState
  let currentActionAt = 0

  for (const event of timedEvents) {
    const segmentDuration = Math.max(0, event.at - currentActionAt)
    timeline.push(...collectNaturalEvents(
      currentState,
      segmentDuration,
      rules,
      currentActionAt,
      before.elapsedAt + currentActionAt,
    ))
    currentState = advanceThermalState(currentState, segmentDuration, rules)
    currentActionAt = event.at

    currentState = applyStateDelta(
      currentState,
      finiteOr(event.offsetDelta ?? 0, 0),
      finiteOr(event.driftDelta ?? 0, 0),
      rules,
    )
    const eventSettle = settleState(currentState, rules, Boolean(action.allowCapture))
    currentState = eventSettle.state
    timeline.push({
      kind: 'action-event',
      label: event.label,
      elapsedAt: before.elapsedAt + currentActionAt,
      actionTime: currentActionAt,
      state: currentState,
      overshoot: false,
      sourceEventId: event.id,
    })
    if (eventSettle.settled) {
      timeline.push({
        kind: eventSettle.captured ? 'capture' : 'settle',
        label: eventSettle.captured ? 'Capture → Neutral' : 'Settle → Neutral',
        elapsedAt: before.elapsedAt + currentActionAt,
        actionTime: currentActionAt,
        state: currentState,
        overshoot: false,
      })
    }
    markCrossingAtBoundaryAsOvershoot(
      timeline,
      currentActionAt,
      currentState,
      actionTime - currentActionAt,
      rules,
    )
  }

  const remainingDuration = Math.max(0, actionTime - currentActionAt)
  timeline.push(...collectNaturalEvents(
    currentState,
    remainingDuration,
    rules,
    currentActionAt,
    before.elapsedAt + currentActionAt,
  ))
  currentState = advanceThermalState(currentState, remainingDuration, rules)

  const finalSettle = settleState(currentState, rules, Boolean(action.allowCapture))
  currentState = finalSettle.state
  if (finalSettle.settled && !timeline.some((event) => (
    (event.kind === 'settle' || event.kind === 'capture')
    && Math.abs(event.actionTime - actionTime) <= 1e-9
  ))) {
    timeline.push({
      kind: finalSettle.captured ? 'capture' : 'settle',
      label: finalSettle.captured ? 'Capture → Neutral' : 'Settle → Neutral',
      elapsedAt: before.elapsedAt + actionTime,
      actionTime,
      state: currentState,
      overshoot: false,
    })
  }

  const after: ThermalSessionState = {
    thermal: currentState,
    elapsedAt: before.elapsedAt + actionTime,
  }
  const crossingEvents = timeline.filter((event) => (
    event.kind === 'set-point-to-cold' || event.kind === 'set-point-to-hot'
  ))
  const settleEvents = timeline.filter((event) => event.kind === 'settle' || event.kind === 'capture')

  return {
    actionId: action.id,
    actionLabel: action.label,
    before,
    immediate,
    after,
    immediateTrace: {
      offsetDelta: immediateOffsetDelta + zeroTimeOffsetDelta,
      driftDelta: immediateDrift.driftDelta + zeroTimeDriftDelta,
      stabilized: immediateDrift.stabilized,
      captured: immediateSettle.captured,
      settled: immediateSettle.settled,
    },
    timeline,
    summary: {
      crossing: crossingEvents.length > 0,
      overshoot: crossingEvents.some((event) => event.overshoot),
      apex: timeline.some((event) => event.kind === 'hot-apex' || event.kind === 'cold-apex'),
      settle: settleEvents.length > 0,
      capture: settleEvents.some((event) => event.kind === 'capture'),
    },
  }
}

export function replayThermalClockActions(
  initialSession: ThermalSessionState,
  actionIds: string[],
  rules: ThermalClockRuleset,
): ThermalActionResolution[] {
  const history: ThermalActionResolution[] = []
  let session: ThermalSessionState = {
    thermal: normalizeThermalState(initialSession.thermal, rules),
    elapsedAt: Math.max(0, finiteOr(initialSession.elapsedAt, 0)),
  }

  for (const actionId of actionIds) {
    const resolution = resolveThermalAction(session, getThermalClockAction(actionId), rules)
    history.push(resolution)
    session = resolution.after
  }

  return history
}

export function thermalStateEquals(
  left: ActorThermalState,
  right: ActorThermalState,
  epsilon = 1e-6,
): boolean {
  return Math.abs(left.setPoint - right.setPoint) <= epsilon
    && Math.abs(left.offset - right.offset) <= epsilon
    && Math.abs(left.drift - right.drift) <= epsilon
}

export function formatThermalNumber(value: number, digits = 2): string {
  const safe = Math.abs(value) < 10 ** (-digits) ? 0 : value
  return safe > 0 ? `+${safe.toFixed(digits)}` : safe.toFixed(digits)
}
