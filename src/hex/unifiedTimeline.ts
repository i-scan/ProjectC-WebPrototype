import experimentConfigJson from '../../config/experiments/val-012-momentum-lab.v3.json'

export type TimelineEventType = 'reaction' | 'contact' | 'landing' | 'actor-ready' | 'environment'
export type TimelineActionKind = 'atomic' | 'commit' | 'reaction'

export type ActionPhaseDefinition = {
  id: string
  label: string
  durationAt: 1
  movementSteps?: 1 | 2
  momentumAfter?: 1 | 2 | 3
  attack?: 'basic-melee' | 'momentum-impact'
}

export type ActionDefinition = {
  id: string
  label: string
  actionKind: TimelineActionKind
  baseActionTimeAt: 1 | 2 | 3
  intro?: {
    label: string
    requirements?: string[]
    skipPhaseIdWhenChained?: string
    chainRequirements?: string[]
  }
  phases: ActionPhaseDefinition[]
  outro?: {
    pendingMomentum: 0 | 1 | 2 | 3
    preserveAxis: boolean
    opensChainWindow: boolean
  }
}

export type TimelineEvent = {
  timeAt: number
  priority: number
  stableId: string
  type: TimelineEventType
  sourceId: string
  label: string
}

export type ActorTimelineState = {
  actorId: string
  label: string
  nextReadyAt: number
  actionTimeAt: number
}

export type TimelineState = {
  worldTimeAt: number
  awaitingPlayer: boolean
  actors: Record<string, ActorTimelineState>
  environmentNextReadyAt: number
  eventQueue: TimelineEvent[]
  recentEvents: TimelineEvent[]
}

type UnifiedTimelineConfig = {
  validationId: string
  rulesetId: string
  implementationId: string
  genericActionPoints: boolean
  fixedHand: boolean
  fixedHandActionIds: string[]
  thermalPeriodAt: number
  eventPriority: TimelineEventType[]
  environment: { firstReadyAt: number; intervalAt: number }
  actors: Array<{ id: string; label: string; firstReadyAt: number; actionTimeAt: number }>
  legacyActions: Array<{ id: string; label: string; actionTimeAt: 1 | 2 | 3; actionKind: TimelineActionKind }>
  actions: ActionDefinition[]
}

export type TimelineResolution<T> = {
  value: T
  timeline: TimelineState
  elapsedAt: number
  interveningEvents: TimelineEvent[]
}

export type TimelineResolvers<T> = {
  resolveActor: (value: T, actorId: string) => T
  resolveEnvironment: (value: T) => T
}

export type TimelinePhaseTrace = {
  phaseId: string
  label: string
  startAt: number
  endAt: number
  interveningEvents: TimelineEvent[]
}

export type TimelinePhasedResolution<T> = TimelineResolution<T> & {
  phases: TimelinePhaseTrace[]
}

export const unifiedTimelineConfig = experimentConfigJson as UnifiedTimelineConfig

const priorityOf = (type: TimelineEventType) => {
  const index = unifiedTimelineConfig.eventPriority.indexOf(type)
  return index < 0 ? unifiedTimelineConfig.eventPriority.length : index
}

const sortEvents = (events: TimelineEvent[]) => [...events].sort((left, right) => (
  left.timeAt - right.timeAt
  || left.priority - right.priority
  || left.stableId.localeCompare(right.stableId)
))

const eventForActor = (actor: ActorTimelineState): TimelineEvent => ({
  timeAt: actor.nextReadyAt,
  priority: priorityOf('actor-ready'),
  stableId: `actor:${actor.actorId}`,
  type: 'actor-ready',
  sourceId: actor.actorId,
  label: `${actor.label} Ready`,
})

const environmentEvent = (timeAt: number): TimelineEvent => ({
  timeAt,
  priority: priorityOf('environment'),
  stableId: 'environment:global',
  type: 'environment',
  sourceId: 'environment',
  label: 'Environment Pulse',
})

export function createUnifiedTimeline(): TimelineState {
  const actors = Object.fromEntries(unifiedTimelineConfig.actors.map((actor) => [actor.id, {
    actorId: actor.id,
    label: actor.label,
    nextReadyAt: actor.firstReadyAt,
    actionTimeAt: actor.actionTimeAt,
  }]))
  const eventQueue = sortEvents([
    ...Object.values(actors).filter((actor) => actor.actorId !== 'player').map(eventForActor),
    environmentEvent(unifiedTimelineConfig.environment.firstReadyAt),
  ])
  return {
    worldTimeAt: 0,
    awaitingPlayer: true,
    actors,
    environmentNextReadyAt: unifiedTimelineConfig.environment.firstReadyAt,
    eventQueue,
    recentEvents: [],
  }
}

export function actionTimeFor(actionId: string): 1 | 2 | 3 {
  return unifiedTimelineConfig.actions.find((action) => action.id === actionId)?.baseActionTimeAt
    ?? unifiedTimelineConfig.legacyActions.find((action) => action.id === actionId)?.actionTimeAt
    ?? 1
}

export function actionKindFor(actionId: string): TimelineActionKind {
  return unifiedTimelineConfig.actions.find((action) => action.id === actionId)?.actionKind
    ?? unifiedTimelineConfig.legacyActions.find((action) => action.id === actionId)?.actionKind
    ?? 'atomic'
}

export function actionDefinitionFor(actionId: string): ActionDefinition | undefined {
  return unifiedTimelineConfig.actions.find((action) => action.id === actionId)
}

export function applyUnifiedFixedHand<T extends {
  hand: string[]
  deck: string[]
  discard: string[]
  ap?: number
  reservedAP?: number
}>(value: T): T {
  const next = structuredClone(value)
  next.hand = [...unifiedTimelineConfig.fixedHandActionIds]
  next.deck = []
  next.discard = []
  if (typeof next.ap === 'number') next.ap = 0
  if (typeof next.reservedAP === 'number') next.reservedAP = 0
  return next
}

export function previewInterveningEvents(timeline: TimelineState, actionTimeAt: number): TimelineEvent[] {
  const playerReadyAt = timeline.worldTimeAt + actionTimeAt
  return sortEvents(timeline.eventQueue).filter((event) => event.timeAt <= playerReadyAt)
}

export function resolveUnifiedPlayerAction<T>(
  value: T,
  timelineInput: TimelineState,
  actionTimeAt: number,
  applyImmediate: (value: T) => T,
  resolvers: TimelineResolvers<T>,
): TimelineResolution<T> {
  const timeline = structuredClone(timelineInput)
  const startAt = timeline.worldTimeAt
  const player = timeline.actors.player
  const duration = Math.max(1, Math.min(3, Math.round(actionTimeAt)))
  player.nextReadyAt = startAt + duration
  timeline.awaitingPlayer = false
  timeline.eventQueue = sortEvents([...timeline.eventQueue, eventForActor(player)])

  let nextValue = applyImmediate(value)
  const processed: TimelineEvent[] = []

  while (timeline.eventQueue.length > 0) {
    const [event, ...remaining] = timeline.eventQueue
    timeline.eventQueue = remaining
    timeline.worldTimeAt = event.timeAt
    processed.push(event)

    if (event.type === 'actor-ready' && event.sourceId === 'player') {
      timeline.awaitingPlayer = true
      break
    }

    if (event.type === 'actor-ready') {
      nextValue = resolvers.resolveActor(nextValue, event.sourceId)
      const actor = timeline.actors[event.sourceId]
      if (actor) {
        actor.nextReadyAt = event.timeAt + actor.actionTimeAt
        timeline.eventQueue = sortEvents([...timeline.eventQueue, eventForActor(actor)])
      }
    } else if (event.type === 'environment') {
      nextValue = resolvers.resolveEnvironment(nextValue)
      timeline.environmentNextReadyAt = event.timeAt + unifiedTimelineConfig.environment.intervalAt
      timeline.eventQueue = sortEvents([...timeline.eventQueue, environmentEvent(timeline.environmentNextReadyAt)])
    }
  }

  timeline.recentEvents = [...processed, ...timeline.recentEvents].slice(0, 12)
  return {
    value: nextValue,
    timeline,
    elapsedAt: timeline.worldTimeAt - startAt,
    interveningEvents: processed.filter((event) => event.sourceId !== 'player'),
  }
}

function processTimelineEventsThrough<T>(
  value: T,
  timeline: TimelineState,
  endAt: number,
  resolvers: TimelineResolvers<T>,
): { value: T; events: TimelineEvent[] } {
  let nextValue = value
  const processed: TimelineEvent[] = []

  while (timeline.eventQueue.length > 0 && timeline.eventQueue[0].timeAt <= endAt) {
    const [event, ...remaining] = timeline.eventQueue
    timeline.eventQueue = remaining
    timeline.worldTimeAt = event.timeAt
    processed.push(event)

    if (event.type === 'actor-ready') {
      nextValue = resolvers.resolveActor(nextValue, event.sourceId)
      const actor = timeline.actors[event.sourceId]
      if (actor) {
        actor.nextReadyAt = event.timeAt + actor.actionTimeAt
        timeline.eventQueue = sortEvents([...timeline.eventQueue, eventForActor(actor)])
      }
    } else if (event.type === 'environment') {
      nextValue = resolvers.resolveEnvironment(nextValue)
      timeline.environmentNextReadyAt = event.timeAt + unifiedTimelineConfig.environment.intervalAt
      timeline.eventQueue = sortEvents([...timeline.eventQueue, environmentEvent(timeline.environmentNextReadyAt)])
    }
  }

  timeline.worldTimeAt = endAt
  return { value: nextValue, events: processed }
}

export function resolveUnifiedPlayerPhasedAction<T>(
  value: T,
  timelineInput: TimelineState,
  phases: readonly ActionPhaseDefinition[],
  applyPhase: (value: T, phase: ActionPhaseDefinition, phaseIndex: number) => T,
  resolvers: TimelineResolvers<T>,
): TimelinePhasedResolution<T> {
  if (phases.length === 0) throw new Error('A phased action requires at least one phase.')

  const timeline = structuredClone(timelineInput)
  const startAt = timeline.worldTimeAt
  const player = timeline.actors.player
  const traces: TimelinePhaseTrace[] = []
  const processed: TimelineEvent[] = []
  let nextValue = value
  timeline.awaitingPlayer = false

  phases.forEach((phase, phaseIndex) => {
    const phaseStartAt = timeline.worldTimeAt
    nextValue = applyPhase(nextValue, phase, phaseIndex)
    const phaseEndAt = phaseStartAt + phase.durationAt
    const boundary = processTimelineEventsThrough(nextValue, timeline, phaseEndAt, resolvers)
    nextValue = boundary.value
    processed.push(...boundary.events)
    traces.push({
      phaseId: phase.id,
      label: phase.label,
      startAt: phaseStartAt,
      endAt: phaseEndAt,
      interveningEvents: boundary.events,
    })
  })

  player.nextReadyAt = timeline.worldTimeAt
  timeline.awaitingPlayer = true
  timeline.recentEvents = [...processed, ...timeline.recentEvents].slice(0, 12)

  return {
    value: nextValue,
    timeline,
    elapsedAt: timeline.worldTimeAt - startAt,
    interveningEvents: processed,
    phases: traces,
  }
}

export function nextReadySummary(timeline: TimelineState) {
  return sortEvents(timeline.eventQueue).slice(0, 5)
}
