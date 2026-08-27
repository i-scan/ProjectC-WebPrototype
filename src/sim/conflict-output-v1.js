export * from './conflict-v4.js'

import {
  WALL_TRAVEL_BUDGET_RULE,
  resolveCellConflicts as resolveCellConflictsCore,
} from './conflict-v4.js'
import { HEX_DIRECTIONS } from './hex.js'

export const CONFLICT_OUTPUT_COMPAT_RULE = 'cell-motion-output-compat-v1'

function normalizeNumber(value) {
  if (typeof value !== 'number') return value
  return Object.is(value, -0) || Math.abs(value) < 1e-12 ? 0 : value
}

function normalizePoint(point) {
  return point ? { ...point, q: normalizeNumber(point.q), r: normalizeNumber(point.r) } : point
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

function compatibleEvent(event) {
  const result = { ...event }
  if (result.kind === 'surface-reflection' && result.wallCellPivot && !result.to) result.to = wallExitCell(result)
  if ((result.kind === 'surface-reflection' || result.kind === 'surface-stop' || result.kind === 'wall-crash') && result.wallCellPivot) {
    // Keep the old public event marker while the authoritative distance engine
    // is now identified independently by motionTraceRule/travelBudgetRule on
    // the CellMotionTrace itself.
    result.travelBudgetRule = WALL_TRAVEL_BUDGET_RULE
  }
  for (const key of ['cell', 'from', 'to', 'attemptedCell', 'reflectedCell']) {
    if (result[key]) result[key] = normalizePoint(result[key])
  }
  return result
}

export function resolveCellConflicts(input) {
  const resolved = resolveCellConflictsCore(input)
  const actorTrajectories = Object.fromEntries(Object.entries(resolved.actorTrajectories ?? {}).map(([id, path]) => [
    id,
    path.map(normalizePoint),
  ]))
  return {
    ...resolved,
    conflictEvents: (resolved.conflictEvents ?? []).map(compatibleEvent),
    actorTrajectories,
    conflictOutputCompatRule: CONFLICT_OUTPUT_COMPAT_RULE,
  }
}
