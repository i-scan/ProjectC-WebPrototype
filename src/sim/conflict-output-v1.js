export * from './conflict-v5.js'

import {
  WALL_TRAVEL_BUDGET_RULE,
  resolveCellConflicts as resolveCellConflictsCore,
} from './conflict-v5.js'
import { CELL_MOTION_TRACE_RULE, CELL_TRAVEL_BUDGET_RULE } from './cell-motion.js'
import { HEX_DIRECTIONS } from './hex.js'

export const CONFLICT_OUTPUT_COMPAT_RULE = 'cell-motion-output-compat-v1'
export const MOTION_TRACE_EVENT_RULE = 'motion-trace-event-v1'

function normalizeNumber(value) {
  if (typeof value !== 'number') return value
  return Object.is(value, -0) || Math.abs(value) < 1e-12 ? 0 : value
}

function normalizePoint(point) {
  return point ? { ...point, q: normalizeNumber(point.q), r: normalizeNumber(point.r) } : point
}

function sameHex(a, b) {
  return Boolean(a && b && a.q === b.q && a.r === b.r)
}

function normalizeTrace(trace = []) {
  return trace.map((entry) => {
    const next = { ...entry }
    for (const key of ['from', 'to', 'attemptedCell', 'pivotCell']) {
      if (next[key]) next[key] = normalizePoint(next[key])
    }
    return next
  })
}

function wallExitCell(event) {
  if (!event?.wallCellPivot || !event.attemptedCell || !event.axisAfter) return event?.to
  const direction = HEX_DIRECTIONS.find((entry) => entry.id === event.axisAfter)
  if (!direction) return event.to
  return {
    q: event.attemptedCell.q + direction.q,
    r: event.attemptedCell.r + direction.r,
  }
}

function compatibleEvent(event, actorTrajectories) {
  const result = { ...event }
  if (result.kind === 'surface-reflection' && result.wallCellPivot && !result.to) result.to = wallExitCell(result)
  if ((result.kind === 'surface-reflection' || result.kind === 'surface-stop' || result.kind === 'wall-crash') && result.wallCellPivot) {
    result.travelBudgetRule = WALL_TRAVEL_BUDGET_RULE
  }
  if (result.kind === 'wall-crash' && result.actorId && result.from) {
    const path = actorTrajectories[result.actorId] ?? []
    result.partial = path.length > 0 && !sameHex(path[0], result.from)
  }
  for (const key of ['cell', 'from', 'to', 'attemptedCell', 'reflectedCell']) {
    if (result[key]) result[key] = normalizePoint(result[key])
  }
  return result
}

function traceEvents(resolved) {
  const events = []
  const playerTrace = normalizeTrace(resolved.motionTrace ?? [])
  if (playerTrace.length) {
    events.push({
      kind: 'motion-trace',
      actorId: 'player',
      rule: MOTION_TRACE_EVENT_RULE,
      motionTraceRule: CELL_MOTION_TRACE_RULE,
      travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
      trace: playerTrace,
    })
  }
  for (const [actorId, rawTrace] of Object.entries(resolved.actorMotionTrace ?? {})) {
    const trace = normalizeTrace(rawTrace)
    if (!trace.length) continue
    events.push({
      kind: 'motion-trace',
      actorId,
      rule: MOTION_TRACE_EVENT_RULE,
      motionTraceRule: CELL_MOTION_TRACE_RULE,
      travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
      trace,
    })
  }
  return events
}

export function resolveCellConflicts(input) {
  const resolved = resolveCellConflictsCore(input)
  const actorTrajectories = Object.fromEntries(Object.entries(resolved.actorTrajectories ?? {}).map(([id, path]) => [
    id,
    path.map(normalizePoint),
  ]))
  return {
    ...resolved,
    conflictEvents: [
      ...(resolved.conflictEvents ?? []).map((event) => compatibleEvent(event, actorTrajectories)),
      ...traceEvents(resolved),
    ],
    motionTrace: normalizeTrace(resolved.motionTrace ?? []),
    actorMotionTrace: Object.fromEntries(Object.entries(resolved.actorMotionTrace ?? {}).map(([id, trace]) => [id, normalizeTrace(trace)])),
    actorTrajectories,
    conflictOutputCompatRule: CONFLICT_OUTPUT_COMPAT_RULE,
  }
}
