import experimentConfigJson from '../../config/experiments/val-012-stage-1-thermal-inertia.v0.json'

export type ThermalSide = 'cold' | 'neutral' | 'hot'
export type ThermalCrossingSide = Exclude<ThermalSide, 'neutral'>

export type ActorThermalState = {
  temperature: number
  setPoint: number
  drift: number
  crossingFromSide?: ThermalCrossingSide | null
}

export type ThermalRuleset = {
  id: string
  label: string
  temperatureMin: number
  temperatureMax: number
  driftMin: number
  driftMax: number
  restoringForce: number
  captureWindow: boolean
  projectionMaxSteps: number
}

export type ThermalActionKind = 'impulse' | 'stabilize'

export type ThermalTestAction = {
  id: string
  label: string
  shortLabel: string
  kind: ThermalActionKind
  thermalImpulse?: number
  stabilizeStrength?: number
  capture?: boolean
  description: string
}

export type ThermalScenario = {
  id: string
  label: string
  group: string
  description: string
  state: ActorThermalState
}

export type ThermalExperimentConfig = {
  schemaVersion: string
  rulesetVersion: string
  updatedAt: string
  status: string
  validationId: string
  activeStage: string
  topology: 'hex6'
  designReference: string
  defaultRulesetId: string
  defaultScenarioId: string
  rulesets: ThermalRuleset[]
  actions: ThermalTestAction[]
  scenarios: ThermalScenario[]
}

export type ThermalStepEvents = {
  arrivedAtSetPoint: boolean
  crossing: boolean
  settle: boolean
  overshoot: boolean
  apex: boolean
  capture: boolean
  boundaryClipped: boolean
}

export type ThermalStepTrace = {
  actionId: string
  actionLabel: string
  offsetBefore: number
  offsetAfter: number
  driftBefore: number
  externalImpulse: number
  restoringForce: number
  driftAfterImpulse: number
  driftAfterRestoring: number
  driftAfter: number
  temperatureBefore: number
  temperatureAfter: number
  moved: number
  events: ThermalStepEvents
}

export type ThermalProjection = {
  apexState: ActorThermalState
  path: ActorThermalState[]
  steps: number
  reachedApex: boolean
}

export type ThermalFrameResolution = {
  before: ActorThermalState
  after: ActorThermalState
  trace: ThermalStepTrace
  projectedApex: ThermalProjection
}

export const thermalExperimentConfig = experimentConfigJson as ThermalExperimentConfig

const NATURAL_ACTION: ThermalTestAction = {
  id: 'natural-projection-step',
  label: 'Natural Projection Step',
  shortLabel: 'Projection',
  kind: 'impulse',
  thermalImpulse: 0,
  description: 'Internal no-impulse step used only for deterministic projection.',
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function integerOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.round(value) : fallback
}

export function thermalSideFor(temperature: number, setPoint: number): ThermalSide {
  if (temperature > setPoint) return 'hot'
  if (temperature < setPoint) return 'cold'
  return 'neutral'
}

export function normalizeThermalState(
  state: ActorThermalState,
  rules: ThermalRuleset,
): ActorThermalState {
  const setPoint = clamp(
    integerOr(state.setPoint, 0),
    rules.temperatureMin,
    rules.temperatureMax,
  )
  const temperature = clamp(
    integerOr(state.temperature, setPoint),
    rules.temperatureMin,
    rules.temperatureMax,
  )
  const drift = clamp(
    integerOr(state.drift, 0),
    rules.driftMin,
    rules.driftMax,
  )
  const crossingFromSide = state.crossingFromSide === 'cold' || state.crossingFromSide === 'hot'
    ? state.crossingFromSide
    : null

  return { temperature, setPoint, drift, crossingFromSide }
}

export function getThermalRuleset(id: string): ThermalRuleset {
  return thermalExperimentConfig.rulesets.find((ruleset) => ruleset.id === id)
    ?? thermalExperimentConfig.rulesets[0]
}

export function getThermalAction(id: string): ThermalTestAction {
  return thermalExperimentConfig.actions.find((action) => action.id === id)
    ?? thermalExperimentConfig.actions[0]
}

export function getThermalScenario(id: string): ThermalScenario {
  return thermalExperimentConfig.scenarios.find((scenario) => scenario.id === id)
    ?? thermalExperimentConfig.scenarios[0]
}

export function externalThermalImpulseFor(
  state: ActorThermalState,
  action: ThermalTestAction,
): number {
  if (action.kind === 'stabilize') {
    if (state.drift === 0) return 0
    const strength = Math.max(0, action.stabilizeStrength ?? 1)
    return -Math.sign(state.drift) * strength
  }

  return typeof action.thermalImpulse === 'number' && Number.isFinite(action.thermalImpulse)
    ? action.thermalImpulse
    : 0
}

function advanceThermalState(
  rawState: ActorThermalState,
  action: ThermalTestAction,
  rules: ThermalRuleset,
): { after: ActorThermalState; trace: ThermalStepTrace } {
  const before = normalizeThermalState(rawState, rules)
  const offsetBefore = before.temperature - before.setPoint
  const externalImpulse = externalThermalImpulseFor(before, action)
  const restoringForce = offsetBefore === 0
    ? 0
    : -Math.sign(offsetBefore) * rules.restoringForce

  const driftAfterImpulse = clamp(
    before.drift + externalImpulse,
    rules.driftMin,
    rules.driftMax,
  )
  const driftAfterRestoring = clamp(
    driftAfterImpulse + restoringForce,
    rules.driftMin,
    rules.driftMax,
  )

  const requestedMove = driftAfterRestoring === 0 ? 0 : Math.sign(driftAfterRestoring)
  const requestedTemperature = before.temperature + requestedMove
  const temperatureAfter = clamp(
    requestedTemperature,
    rules.temperatureMin,
    rules.temperatureMax,
  )
  const boundaryClipped = requestedTemperature !== temperatureAfter
  const arrivedAtSetPoint = before.temperature !== before.setPoint
    && temperatureAfter === before.setPoint

  const capture = rules.captureWindow
    && Boolean(action.capture)
    && arrivedAtSetPoint
    && Math.abs(driftAfterRestoring) === 1
  const driftAfter = capture ? 0 : driftAfterRestoring
  const settle = temperatureAfter === before.setPoint && driftAfter === 0

  const beforeSide = thermalSideFor(before.temperature, before.setPoint)
  const afterSide = thermalSideFor(temperatureAfter, before.setPoint)
  const crossing = arrivedAtSetPoint && driftAfter !== 0
  const overshoot = beforeSide === 'neutral'
    && afterSide !== 'neutral'
    && before.crossingFromSide !== null
    && before.crossingFromSide !== undefined
    && afterSide !== before.crossingFromSide

  let crossingFromSide: ThermalCrossingSide | null = before.crossingFromSide ?? null
  if (crossing) {
    crossingFromSide = beforeSide === 'neutral' ? crossingFromSide : beforeSide
  } else if (settle || (beforeSide === 'neutral' && afterSide !== 'neutral')) {
    crossingFromSide = null
  }

  const after: ActorThermalState = {
    temperature: temperatureAfter,
    setPoint: before.setPoint,
    drift: driftAfter,
    crossingFromSide,
  }

  const trace: ThermalStepTrace = {
    actionId: action.id,
    actionLabel: action.label,
    offsetBefore,
    offsetAfter: after.temperature - after.setPoint,
    driftBefore: before.drift,
    externalImpulse,
    restoringForce,
    driftAfterImpulse,
    driftAfterRestoring,
    driftAfter,
    temperatureBefore: before.temperature,
    temperatureAfter: after.temperature,
    moved: after.temperature - before.temperature,
    events: {
      arrivedAtSetPoint,
      crossing,
      settle,
      overshoot,
      apex: before.drift !== 0 && driftAfter === 0,
      capture,
      boundaryClipped,
    },
  }

  return { after, trace }
}

export function projectThermalApex(
  rawState: ActorThermalState,
  rules: ThermalRuleset,
): ThermalProjection {
  const initial = normalizeThermalState(rawState, rules)
  if (initial.temperature === initial.setPoint && initial.drift === 0) {
    return { apexState: initial, path: [initial], steps: 0, reachedApex: true }
  }

  const path: ActorThermalState[] = [initial]
  let current = initial

  for (let step = 1; step <= rules.projectionMaxSteps; step += 1) {
    const { after } = advanceThermalState(current, NATURAL_ACTION, rules)
    path.push(after)
    current = after

    if (current.drift === 0) {
      return { apexState: current, path, steps: step, reachedApex: true }
    }
  }

  return {
    apexState: current,
    path,
    steps: rules.projectionMaxSteps,
    reachedApex: false,
  }
}

export function resolveThermalFrame(
  rawState: ActorThermalState,
  action: ThermalTestAction,
  rules: ThermalRuleset,
): ThermalFrameResolution {
  const before = normalizeThermalState(rawState, rules)
  const { after, trace } = advanceThermalState(before, action, rules)
  return {
    before,
    after,
    trace,
    projectedApex: projectThermalApex(after, rules),
  }
}

export function replayThermalActions(
  initialState: ActorThermalState,
  actionIds: string[],
  rules: ThermalRuleset,
): ThermalFrameResolution[] {
  const resolutions: ThermalFrameResolution[] = []
  let state = normalizeThermalState(initialState, rules)

  for (const actionId of actionIds) {
    const resolution = resolveThermalFrame(state, getThermalAction(actionId), rules)
    resolutions.push(resolution)
    state = resolution.after
  }

  return resolutions
}

export function thermalStateEquals(
  left: ActorThermalState,
  right: ActorThermalState,
): boolean {
  return left.temperature === right.temperature
    && left.setPoint === right.setPoint
    && left.drift === right.drift
    && (left.crossingFromSide ?? null) === (right.crossingFromSide ?? null)
}

export function formatSignedThermal(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}
