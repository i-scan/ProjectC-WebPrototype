import { HEX_DIRECTIONS, axialKey, axialToWorld, worldToAxial } from './hex.js'
import {
  DEFAULT_SOLVER_CONFIG,
  actionById,
  momentumLevel,
  momentumSpeed,
  simulateSpatial,
} from './solver.js'
import { length, normalize, scale } from './vector.js'
import { SURFACE_GEOMETRY_RULE } from './surface-geometry.js'
import {
  CELL_MOTION_TRACE_RULE,
  CELL_TRAVEL_BUDGET_RULE,
  directionIdBetween,
  runCellMotion,
} from './cell-motion.js'

export const SPATIAL_INERTIA_RULE = 'val-012-spatial-inertia-v1-candidate'
export const INITIATIVE_TRANSACTION_RULE = 'first-successful-travel-transaction-v1'
export const DRIVE_BUILD_RULE = 'drive-build-inertia-prototype-candidate-v1'

const sameHex = (a, b) => Boolean(a && b && a.q === b.q && a.r === b.r)
const cloneHex = (hex) => ({ q: hex.q, r: hex.r })
const clonePoint = (point) => ({ x: point.x, z: point.z })
const VALID_AXIS = new Set(HEX_DIRECTIONS.map((entry) => entry.id))
const V1_DESTINATION_ACTIONS = new Set(['basic-move', 'drive'])

// Preserve the landing-cell control language that tested well in the pre-v1
// prototype. These are reachability templates, not separate movement physics.
const ENVELOPE_BY_M = Object.freeze({
  0: Object.freeze([
    { id: 'e', target: { q: 1, r: 0 }, path: [{ q: 1, r: 0 }], terminal: 0, forward: true },
    { id: 'ne', target: { q: 1, r: -1 }, path: [{ q: 1, r: -1 }], terminal: 1 },
    { id: 'nw', target: { q: 0, r: -1 }, path: [{ q: 0, r: -1 }], terminal: 2 },
    { id: 'w', target: { q: -1, r: 0 }, path: [{ q: -1, r: 0 }], terminal: 3 },
    { id: 'sw', target: { q: -1, r: 1 }, path: [{ q: -1, r: 1 }], terminal: 4 },
    { id: 'se', target: { q: 0, r: 1 }, path: [{ q: 0, r: 1 }], terminal: 5 },
  ]),
  1: Object.freeze([
    // M1 ±120° is intentionally real Travel2 even though default M1 Move=1.
    { id: 'nw', target: { q: 0, r: -1 }, path: [{ q: 1, r: -1 }, { q: 0, r: -1 }], terminal: 2 },
    { id: 'ne', target: { q: 1, r: -1 }, path: [{ q: 1, r: -1 }], terminal: 1 },
    { id: 'e', target: { q: 1, r: 0 }, path: [{ q: 1, r: 0 }], terminal: 0, forward: true },
    { id: 'se', target: { q: 0, r: 1 }, path: [{ q: 0, r: 1 }], terminal: 5 },
    { id: 'sw', target: { q: -1, r: 1 }, path: [{ q: 0, r: 1 }, { q: -1, r: 1 }], terminal: 4 },
  ]),
  2: Object.freeze([
    { id: 'inner-ne', target: { q: 1, r: -1 }, path: [{ q: 1, r: 0 }, { q: 1, r: -1 }], terminal: 2 },
    { id: 'outer-ne', target: { q: 2, r: -1 }, path: [{ q: 1, r: 0 }, { q: 2, r: -1 }], terminal: 1 },
    { id: 'e', target: { q: 2, r: 0 }, path: [{ q: 1, r: 0 }, { q: 2, r: 0 }], terminal: 0, forward: true },
    { id: 'outer-se', target: { q: 1, r: 1 }, path: [{ q: 1, r: 0 }, { q: 1, r: 1 }], terminal: 5 },
    { id: 'inner-se', target: { q: 0, r: 1 }, path: [{ q: 1, r: 0 }, { q: 0, r: 1 }], terminal: 4 },
  ]),
  3: Object.freeze([
    { id: 'far-ne', target: { q: 3, r: -2 }, path: [{ q: 1, r: 0 }, { q: 2, r: -1 }, { q: 3, r: -2 }], terminal: 1 },
    { id: 'connector-ne', target: { q: 3, r: -1 }, path: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: -1 }], terminal: 1 },
    { id: 'e', target: { q: 3, r: 0 }, path: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }], terminal: 0, forward: true },
    { id: 'connector-se', target: { q: 2, r: 1 }, path: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 2, r: 1 }], terminal: 5 },
    { id: 'far-se', target: { q: 1, r: 2 }, path: [{ q: 1, r: 0 }, { q: 1, r: 1 }, { q: 1, r: 2 }], terminal: 5 },
  ]),
})

function rotateAxial60(hex) {
  return { q: hex.q + hex.r, r: -hex.q }
}

function rotateAxial(hex, turns) {
  let result = cloneHex(hex)
  const normalized = ((turns % 6) + 6) % 6
  for (let index = 0; index < normalized; index += 1) result = rotateAxial60(result)
  return result
}

function addHex(a, b) {
  return { q: a.q + b.q, r: a.r + b.r }
}

function directionIndexFromVector(vector) {
  const magnitude = length(vector)
  if (magnitude < 0.001) return -1
  const source = normalize(vector)
  let bestIndex = 0
  let bestDot = -Infinity
  HEX_DIRECTIONS.forEach((direction, index) => {
    const unit = normalize(axialToWorld({ q: direction.q, r: direction.r }))
    const dot = unit.x * source.x + unit.z * source.z
    if (dot > bestDot) {
      bestDot = dot
      bestIndex = index
    }
  })
  return bestIndex
}

function velocityForAxis(axisId, level) {
  if (!axisId || level <= 0) return { x: 0, z: 0 }
  const index = HEX_DIRECTIONS.findIndex((entry) => entry.id === axisId)
  if (index < 0) return { x: 0, z: 0 }
  return scale(normalize(axialToWorld({ q: HEX_DIRECTIONS[index].q, r: HEX_DIRECTIONS[index].r })), momentumSpeed(level))
}

export function axisIdFromState(state) {
  if (VALID_AXIS.has(state?.axisId)) return state.axisId
  const index = directionIndexFromVector(state?.velocity ?? { x: 0, z: 0 })
  return index >= 0 ? HEX_DIRECTIONS[index].id : null
}

export function momentumRange(level) {
  const m = Math.max(0, Math.min(3, Math.round(Number(level) || 0)))
  return m <= 1 ? 1 : m
}

export function isDestinationDrivenAction(actionId, spatialMode = 'discrete') {
  return V1_DESTINATION_ACTIONS.has(actionId) && spatialMode === 'discrete'
}

function stateMomentum(state) {
  return Math.max(0, Math.min(3, momentumLevel(length(state?.velocity ?? { x: 0, z: 0 }))))
}

function signedRelativeTerminal(value) {
  let result = Number(value) || 0
  while (result > 3) result -= 6
  while (result < -3) result += 6
  return result
}

function causeForRelativeTerminal(relativeTerminal) {
  const delta = Math.abs(signedRelativeTerminal(relativeTerminal))
  if (delta === 0) return 'Use'
  if (delta === 1) return 'Redirect'
  return 'Resist'
}

function envelopeForState(state) {
  const beforeM = stateMomentum(state)
  const storedAxisId = axisIdFromState(state)
  const storedAxisIndex = storedAxisId ? HEX_DIRECTIONS.findIndex((entry) => entry.id === storedAxisId) : 0
  const start = worldToAxial(state.position)
  const templates = ENVELOPE_BY_M[beforeM] ?? ENVELOPE_BY_M[3]

  return templates.map((template) => {
    const targetOffset = rotateAxial(template.target, storedAxisIndex)
    const targetHex = addHex(start, targetOffset)
    const pathCells = template.path.map((offset) => addHex(start, rotateAxial(offset, storedAxisIndex)))
    const terminalIndex = (storedAxisIndex + template.terminal) % 6
    return {
      ...template,
      beforeM,
      startHex: start,
      targetHex,
      pathCells,
      axisBefore: storedAxisId,
      axisAfter: HEX_DIRECTIONS[terminalIndex].id,
      relativeTerminal: template.terminal,
    }
  })
}

function invalidPlan(state, action, spatialMode, reason, extra = {}) {
  const m = stateMomentum(state)
  const axisId = axisIdFromState(state)
  return {
    valid: false,
    reason,
    action,
    actionKind: action.kind,
    spatialMode,
    samples: [{ t: 0, position: { ...state.position }, velocity: { ...state.velocity }, axisId }],
    collisions: [],
    traversedCells: [worldToAxial(state.position)],
    motionTrace: [],
    momentumEvents: [],
    finalState: { ...state, position: { ...state.position }, velocity: { ...state.velocity }, axisId },
    beforeSpeed: length(state.velocity),
    afterImpulseSpeed: length(state.velocity),
    finalSpeed: length(state.velocity),
    beforeM: m,
    finalM: m,
    axisBefore: axisId,
    axisAfter: axisId,
    curveUsed: false,
    impulse: { x: 0, z: 0 },
    destinationDriven: true,
    spatialInertiaRule: SPATIAL_INERTIA_RULE,
    initiativeTransactionRule: INITIATIVE_TRANSACTION_RULE,
    motionTraceRule: CELL_MOTION_TRACE_RULE,
    travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
    ...extra,
  }
}

function transactionForRoute(state, route, actionId) {
  const beforeM = stateMomentum(state)
  const axisBefore = axisIdFromState(state)

  if (actionId === 'drive') {
    return {
      rule: DRIVE_BUILD_RULE,
      actionId,
      fromM: beforeM,
      toM: Math.min(3, beforeM + 1),
      cause: 'Generate',
      behavior: 'Build Inertia',
      status: 'pending',
      prototypeCandidate: true,
    }
  }

  if (beforeM === 0) {
    if (!axisBefore) {
      return {
        rule: INITIATIVE_TRANSACTION_RULE,
        actionId,
        fromM: 0,
        toM: 0,
        cause: 'Establish Axis',
        behavior: 'Establish Axis',
        status: 'pending',
      }
    }
    if (route.forward) {
      return {
        rule: INITIATIVE_TRANSACTION_RULE,
        actionId,
        fromM: 0,
        toM: 1,
        cause: 'Generate',
        behavior: 'Generate',
        status: 'pending',
      }
    }
    return {
      rule: INITIATIVE_TRANSACTION_RULE,
      actionId,
      fromM: 0,
      toM: 0,
      cause: 'Redirect',
      behavior: 'Redirect',
      status: 'pending',
    }
  }

  if (beforeM === 1) {
    if (route.forward) {
      return {
        rule: INITIATIVE_TRANSACTION_RULE,
        actionId,
        fromM: 1,
        toM: 2,
        cause: 'Generate',
        behavior: 'Generate',
        status: 'pending',
      }
    }
    const cause = causeForRelativeTerminal(route.relativeTerminal)
    return {
      rule: INITIATIVE_TRANSACTION_RULE,
      actionId,
      fromM: 1,
      toM: cause === 'Resist' ? 0 : 1,
      cause,
      behavior: cause,
      status: 'pending',
    }
  }

  const cause = causeForRelativeTerminal(route.relativeTerminal)
  return {
    rule: INITIATIVE_TRANSACTION_RULE,
    actionId,
    fromM: beforeM,
    toM: Math.max(0, beforeM - 1),
    cause,
    behavior: cause,
    status: 'pending',
  }
}

function firstSuccessfulTravelIndex(trace) {
  return trace.findIndex((event) => (event.cost ?? 0) > 0 && event.allowed !== false)
}

function surfacePreemptsBuild(trace, travelIndex) {
  if (travelIndex < 0) return false
  for (let index = 0; index <= travelIndex; index += 1) {
    const event = trace[index]
    if (event?.collision || event?.context?.collision || event?.kind === 'boundary-reflection' || event?.kind === 'wall-cell-step') return true
  }
  return false
}

function committedTransactionForMotion(transaction, trace) {
  const travelIndex = firstSuccessfulTravelIndex(trace)
  if (travelIndex < 0) return { ...transaction, status: 'unresolved', travelIndex: -1 }

  if (transaction.cause === 'Generate' && surfacePreemptsBuild(trace, travelIndex)) {
    return {
      ...transaction,
      toM: transaction.fromM,
      cause: 'Redirect',
      behavior: 'Redirect',
      status: 'committed',
      travelIndex,
      preemptedBuild: true,
    }
  }

  return { ...transaction, status: 'committed', travelIndex }
}

function decorateTraceWithTransaction(trace, transaction) {
  let currentM = transaction.fromM
  let applied = false
  return trace.map((raw, index) => {
    const entry = { ...raw, momentumBefore: currentM, momentumAfter: currentM }
    if (!applied && transaction.status === 'committed' && index === transaction.travelIndex) {
      entry.momentumBefore = currentM
      currentM = transaction.toM
      entry.momentumAfter = currentM
      entry.actionTransaction = { ...transaction }
      applied = true
    } else if (applied) {
      entry.momentumBefore = currentM
      entry.momentumAfter = currentM
    }
    return entry
  })
}

function samplesForResolvedRoute(state, resolved, finalAxisId, finalVelocity) {
  const timeline = resolved.timeline
  if (timeline.length <= 1) {
    return [
      { t: 0, position: { ...state.position }, velocity: { ...state.velocity }, axisId: axisIdFromState(state) },
      { t: 1, position: { ...state.position }, velocity: { ...finalVelocity }, axisId: finalAxisId },
    ]
  }
  return timeline.map((record, index) => ({
    t: index / (timeline.length - 1),
    position: clonePoint(record.position),
    velocity: index === 0 ? { ...state.velocity } : { ...finalVelocity },
    axisId: index === timeline.length - 1 ? finalAxisId : (record.axisId ?? axisIdFromState(state)),
    collision: Boolean(record.collision),
    reflectionGuide: Boolean(record.reflectionGuide),
  }))
}

function resolveInitiativeRoute(route, config, obstacles, beforeM) {
  return runCellMotion({
    startHex: route.startHex,
    initialAxisId: route.axisBefore ?? directionIdBetween(route.startHex, route.pathCells[0]) ?? route.axisAfter,
    initialMomentum: beforeM,
    travelBudget: route.pathCells.length,
    authoredPathCells: route.pathCells,
    obstacles,
    boardRadius: config.boardRadius,
    capRemainingByMomentum: false,
    // Spatial Inertia v1: surface redirects Axis; it is not an extra M tax.
    reflectionMomentum: ({ momentum }) => ({ momentum, restitution: null }),
  })
}

function simulateInitiativeRoute({ state, route, action, spatialMode, config, obstacles }) {
  const beforeM = stateMomentum(state)
  const resolved = resolveInitiativeRoute(route, config, obstacles, beforeM)

  // M0 initiative cannot submit a wall/boundary reflection as movement.
  if (beforeM === 0 && resolved.collisions.length > 0) {
    return invalidPlan(state, action, spatialMode, 'M0 cannot initiate a Wall / Surface reflection.', {
      landingId: route.id,
      nominalTargetHex: cloneHex(route.targetHex),
    })
  }

  const pending = transactionForRoute(state, route, action.id)
  const transaction = committedTransactionForMotion(pending, resolved.trace)
  const finalM = transaction.status === 'committed' ? transaction.toM : beforeM
  const finalAxisId = resolved.reflected ? resolved.axisAfter : route.axisAfter
  const finalVelocity = velocityForAxis(finalAxisId, finalM)
  const motionTrace = decorateTraceWithTransaction(resolved.trace, transaction)
  const samples = samplesForResolvedRoute(state, resolved, finalAxisId, finalVelocity)
  const momentumEvents = transaction.status === 'committed' && transaction.fromM !== transaction.toM
    ? [{ fromM: transaction.fromM, toM: transaction.toM, cause: transaction.cause, source: 'initiative-action' }]
    : []
  const intentPoint = axialToWorld(route.targetHex)

  return {
    valid: true,
    reason: '',
    action,
    actionKind: action.kind,
    movementMode: 'Initiative',
    spatialMode,
    aimAngle: 0,
    impulse: { x: 0, z: 0 },
    control: normalize({ x: intentPoint.x - state.position.x, z: intentPoint.z - state.position.z }),
    samples,
    collisions: resolved.collisions,
    traversedCells: [cloneHex(route.startHex), ...resolved.actualPath.map(cloneHex)],
    motionTrace,
    momentumEvents,
    actionTransaction: transaction,
    finalState: {
      ...state,
      position: axialToWorld(resolved.finalHex),
      velocity: finalVelocity,
      axisId: finalAxisId,
      worldAt: state.worldAt + 1,
    },
    beforeSpeed: length(state.velocity),
    afterImpulseSpeed: length(state.velocity),
    finalSpeed: length(finalVelocity),
    beforeM,
    finalM,
    range: momentumRange(beforeM),
    pathCellCount: route.pathCells.length,
    curveUsed: route.pathCells.length > 1 || resolved.reflected,
    axisBefore: axisIdFromState(state),
    axisAfter: finalAxisId,
    destinationDriven: true,
    landingId: route.id,
    nominalTargetHex: cloneHex(route.targetHex),
    inputTargetHex: cloneHex(resolved.inputHex ?? route.targetHex),
    reflectionCount: resolved.reflectionCount,
    forwardIntent: Boolean(route.forward),
    relativeTerminal: route.relativeTerminal,
    surfaceGeometry: SURFACE_GEOMETRY_RULE,
    reflectionContinuation: resolved.reflectionContinuation,
    reflectedMovedSteps: resolved.spentTravel,
    reflectedMovementBudget: resolved.travelBudget,
    remainingTravel: resolved.remainingTravel,
    spatialInertiaRule: SPATIAL_INERTIA_RULE,
    initiativeTransactionRule: INITIATIVE_TRANSACTION_RULE,
    driveBuildRule: action.id === 'drive' ? DRIVE_BUILD_RULE : null,
    motionTraceRule: CELL_MOTION_TRACE_RULE,
    travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
  }
}

function chooseCandidateForAim(plans, aimCell) {
  const matches = plans.filter((plan) => plan.valid && sameHex(plan.inputTargetHex, aimCell))
  if (!matches.length) return null
  return matches.find((plan) => plan.forwardIntent) ?? matches[0]
}

function candidateForAim({ state, action, aimPoint, spatialMode, config, obstacles }) {
  if (!aimPoint) return null
  const aimCell = worldToAxial(aimPoint)
  const plans = envelopeForState(state).map((route) => simulateInitiativeRoute({ state, route, action, spatialMode, config, obstacles }))
  return chooseCandidateForAim(plans, aimCell)
}

export function simulateBasicMoveRule({ state, aimPoint, spatialMode = 'discrete', config = DEFAULT_SOLVER_CONFIG, obstacles = [] }) {
  const action = actionById('basic-move')
  return candidateForAim({ state, action, aimPoint, spatialMode, config, obstacles })
    ?? invalidPlan(state, action, spatialMode, 'Choose one of the highlighted reachable Cells.')
}

export function simulateDriveRule({ state, aimPoint, spatialMode = 'discrete', config = DEFAULT_SOLVER_CONFIG, obstacles = [] }) {
  const action = actionById('drive')
  return candidateForAim({ state, action, aimPoint, spatialMode, config, obstacles })
    ?? invalidPlan(state, action, spatialMode, 'Choose one of the highlighted reachable Cells.', { driveBuildRule: DRIVE_BUILD_RULE })
}

export function simulatePrototypeSpatial(input) {
  if (input.spatialMode === 'discrete' && input.actionId === 'basic-move') return simulateBasicMoveRule(input)
  if (input.spatialMode === 'discrete' && input.actionId === 'drive') return simulateDriveRule(input)

  // Actions whose Spatial Inertia v1 semantics are not frozen yet remain on
  // the legacy solver instead of silently inventing Heavy Drive / Hard Turn rules.
  const plan = simulateSpatial(input)
  if (!plan?.valid) return plan
  if (input.spatialMode !== 'discrete') return { ...plan, spatialInertiaRule: 'legacy-hybrid-presentation' }

  const axisIndex = directionIndexFromVector(plan.finalState.velocity)
  const axisId = axisIndex >= 0 && momentumLevel(length(plan.finalState.velocity)) > 0
    ? HEX_DIRECTIONS[axisIndex].id
    : axisIdFromState(input.state)
  return {
    ...plan,
    axisBefore: axisIdFromState(input.state),
    axisAfter: axisId,
    finalState: { ...plan.finalState, axisId },
    spatialInertiaRule: 'legacy-action-not-yet-migrated',
  }
}

export function discreteActionReachability({ state, actionId = 'basic-move', spatialMode = 'discrete', config = DEFAULT_SOLVER_CONFIG, obstacles = [] }) {
  if (!isDestinationDrivenAction(actionId, spatialMode)) return []
  const action = actionById(actionId)
  const results = []
  for (const route of envelopeForState(state)) {
    const plan = simulateInitiativeRoute({ state, route, action, spatialMode, config, obstacles })
    if (!plan.valid) continue
    const inputHex = cloneHex(plan.inputTargetHex ?? route.targetHex)
    const resolvedFinalHex = worldToAxial(plan.finalState.position)
    results.push({
      id: route.id,
      targetHex: cloneHex(inputHex),
      finalHex: cloneHex(inputHex),
      resolvedFinalHex: cloneHex(resolvedFinalHex),
      nominalTargetHex: cloneHex(route.targetHex),
      pathCells: plan.traversedCells.slice(1).map(cloneHex),
      motionTrace: plan.motionTrace.map((entry) => ({ ...entry })),
      collisions: plan.collisions.map((entry) => ({
        ...entry,
        cell: entry.cell ? cloneHex(entry.cell) : undefined,
        contactCell: entry.contactCell ? cloneHex(entry.contactCell) : undefined,
        attemptedCell: entry.attemptedCell ? cloneHex(entry.attemptedCell) : undefined,
      })),
      reflectionCount: plan.reflectionCount ?? 0,
      range: plan.range,
      finalM: plan.finalM,
      axisAfter: plan.axisAfter,
      rule: plan.actionTransaction?.cause ?? plan.actionTransaction?.behavior ?? SPATIAL_INERTIA_RULE,
      forward: Boolean(route.forward),
      reflectionContinuation: plan.reflectionContinuation,
      movedSteps: plan.reflectedMovedSteps,
      movementBudget: plan.reflectedMovementBudget,
      remainingTravel: plan.remainingTravel,
      actionTransaction: plan.actionTransaction ? { ...plan.actionTransaction } : null,
      spatialInertiaRule: SPATIAL_INERTIA_RULE,
      motionTraceRule: CELL_MOTION_TRACE_RULE,
      travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
    })
  }
  return results
}

export function basicMoveReachability(input) {
  return discreteActionReachability({ ...input, actionId: 'basic-move' })
}

export function reachableKeySet(reachability) {
  return new Set(reachability.map((entry) => axialKey(entry.targetHex ?? entry.finalHex)))
}
