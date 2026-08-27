import { HEX_DIRECTIONS, axialKey, axialToWorld, worldToAxial } from './hex.js'
import {
  DEFAULT_SOLVER_CONFIG,
  actionById,
  combineImpulseVelocity,
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

const sameHex = (a, b) => Boolean(a && b && a.q === b.q && a.r === b.r)
const cloneHex = (hex) => ({ q: hex.q, r: hex.r })
const clonePoint = (point) => ({ x: point.x, z: point.z })
const VALID_AXIS = new Set(HEX_DIRECTIONS.map((entry) => entry.id))
const CURVED_DISCRETE_ACTIONS = new Set(['drive', 'heavy-drive', 'hard-turn'])

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
  return Math.max(1, Math.min(3, Math.round(level) || 1))
}

export function isDestinationDrivenAction(actionId, spatialMode = 'discrete') {
  return actionId === 'basic-move' || (spatialMode === 'discrete' && CURVED_DISCRETE_ACTIONS.has(actionId))
}

function envelopeForState(state) {
  const beforeM = momentumLevel(length(state.velocity))
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

function invalidPlan(state, action, spatialMode, reason) {
  const speed = length(state.velocity)
  const m = momentumLevel(speed)
  return {
    valid: false,
    reason,
    action,
    actionKind: action.kind,
    spatialMode,
    samples: [{ t: 0, position: { ...state.position }, velocity: { ...state.velocity }, axisId: axisIdFromState(state) }],
    collisions: [],
    traversedCells: [worldToAxial(state.position)],
    motionTrace: [],
    finalState: { ...state, position: { ...state.position }, velocity: { ...state.velocity } },
    beforeSpeed: speed,
    afterImpulseSpeed: speed,
    finalSpeed: speed,
    beforeM: m,
    finalM: m,
    curveUsed: false,
    impulse: { x: 0, z: 0 },
    axisBefore: axisIdFromState(state),
    axisAfter: axisIdFromState(state),
    destinationDriven: true,
    motionTraceRule: CELL_MOTION_TRACE_RULE,
    travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
  }
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

function basicOutcomeForRoute(state, route) {
  const beforeM = momentumLevel(length(state.velocity))
  const storedAxisId = axisIdFromState(state)
  let finalM
  let finalAxisId = route.axisAfter
  let basicRule

  if (beforeM === 0) {
    const targetDirection = directionIdBetween(route.startHex, route.targetHex)
    const sameAxis = Boolean(storedAxisId && targetDirection === storedAxisId)
    finalM = sameAxis ? 1 : 0
    finalAxisId = targetDirection ?? route.axisAfter
    basicRule = sameAxis ? 'same-axis-build' : 'establish-axis'
  } else if (route.forward) {
    finalM = beforeM === 1 ? 2 : Math.max(0, beforeM - 1)
    finalAxisId = storedAxisId ?? route.axisAfter
    basicRule = beforeM === 1 ? 'same-axis-build' : 'forward-range-spend'
  } else {
    finalM = Math.max(0, beforeM - 1)
    basicRule = 'steer-spend'
  }
  return { beforeM, storedAxisId, finalM, finalAxisId, basicRule }
}

function resolveRoute(route, config, obstacles, motionM, capRemainingByMomentum = false) {
  return runCellMotion({
    startHex: route.startHex,
    initialAxisId: route.axisBefore ?? directionIdBetween(route.startHex, route.pathCells[0]) ?? route.axisAfter,
    initialMomentum: motionM,
    travelBudget: route.pathCells.length,
    authoredPathCells: route.pathCells,
    obstacles,
    boardRadius: config.boardRadius,
    capRemainingByMomentum,
  })
}

function planCommon({ state, route, action, spatialMode, resolved, beforeM, finalM, finalAxisId, beforeSpeed, afterImpulseSpeed, impulse, control }) {
  const finalVelocity = velocityForAxis(finalAxisId, finalM)
  const samples = samplesForResolvedRoute(state, resolved, finalAxisId, finalVelocity)
  return {
    valid: true,
    reason: '',
    action,
    actionKind: action.kind,
    spatialMode,
    aimAngle: 0,
    impulse,
    control,
    samples,
    collisions: resolved.collisions,
    traversedCells: [cloneHex(route.startHex), ...resolved.actualPath.map(cloneHex)],
    motionTrace: resolved.trace.map((entry) => ({ ...entry })),
    finalState: {
      ...state,
      position: axialToWorld(resolved.finalHex),
      velocity: finalVelocity,
      axisId: finalAxisId,
      worldAt: state.worldAt + 1,
    },
    beforeSpeed,
    afterImpulseSpeed,
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
    playerReflectionRule: 'clipped-mirror-multi-bounce-v2',
    surfaceGeometry: SURFACE_GEOMETRY_RULE,
    reflectionContinuation: resolved.reflectionContinuation,
    reflectedMovedSteps: resolved.spentTravel,
    reflectedMovementBudget: resolved.travelBudget,
    remainingTravel: resolved.remainingTravel,
    motionTraceRule: CELL_MOTION_TRACE_RULE,
    travelBudgetRule: CELL_TRAVEL_BUDGET_RULE,
  }
}

function simulateBasicRoute({ state, route, action, spatialMode, config, obstacles }) {
  const outcome = basicOutcomeForRoute(state, route)
  // Basic Action spend/build produces the current Momentum for this AT before
  // collision/impact resolution. The Cell trace must therefore carry the same
  // current M that the final state and any subsequent Actor impact will use.
  const resolved = resolveRoute(route, config, obstacles, outcome.finalM, true)
  const finalM = resolved.momentumAfter
  const finalAxisId = resolved.reflected ? resolved.axisAfter : outcome.finalAxisId
  const intentPoint = axialToWorld(route.targetHex)
  return {
    ...planCommon({
      state,
      route,
      action,
      spatialMode,
      resolved,
      beforeM: outcome.beforeM,
      finalM,
      finalAxisId,
      beforeSpeed: length(state.velocity),
      afterImpulseSpeed: length(state.velocity),
      impulse: { x: 0, z: 0 },
      control: normalize({ x: intentPoint.x - state.position.x, z: intentPoint.z - state.position.z }),
    }),
    basicRule: outcome.basicRule,
    turnRadius: outcome.beforeM,
  }
}

function chooseCandidateForAim(plans, aimCell) {
  const matches = plans.filter((plan) => sameHex(plan.inputTargetHex, aimCell))
  if (!matches.length) return null
  return matches.find((plan) => plan.forwardIntent) ?? matches[0]
}

function basicCandidateForAim({ state, aimPoint, action, spatialMode, config, obstacles }) {
  if (!aimPoint) return null
  const aimCell = worldToAxial(aimPoint)
  const plans = envelopeForState(state).map((route) => simulateBasicRoute({ state, route, action, spatialMode, config, obstacles }))
  return chooseCandidateForAim(plans, aimCell)
}

export function simulateBasicMoveRule({ state, aimPoint, spatialMode = 'discrete', config = DEFAULT_SOLVER_CONFIG, obstacles = [] }) {
  const action = actionById('basic-move')
  return basicCandidateForAim({ state, aimPoint, action, spatialMode, config, obstacles })
    ?? invalidPlan(state, action, spatialMode, 'Choose one of the highlighted reachable Cells.')
}

function simulateDriveRoute({ state, route, action, config, obstacles }) {
  const beforeSpeed = length(state.velocity)
  const beforeM = momentumLevel(beforeSpeed)
  const nominalAim = axialToWorld(route.targetHex)
  const aimDirection = normalize({ x: nominalAim.x - state.position.x, z: nominalAim.z - state.position.z })
  const combinedVelocity = combineImpulseVelocity(state.velocity, aimDirection, action.force, config.maxSpeed)
  const afterImpulseSpeed = length(combinedVelocity)
  const afterImpulseM = momentumLevel(afterImpulseSpeed)
  const resolved = resolveRoute(route, config, obstacles, afterImpulseM)
  const finalM = Math.max(0, afterImpulseM - resolved.reflectionCount)
  const finalAxisId = resolved.reflected ? resolved.axisAfter : (route.axisAfter ?? axisIdFromState(state))
  return {
    ...planCommon({
      state,
      route,
      action,
      spatialMode: 'discrete',
      resolved,
      beforeM,
      finalM,
      finalAxisId,
      beforeSpeed,
      afterImpulseSpeed,
      impulse: scale(aimDirection, action.force),
      control: aimDirection,
    }),
    curveUsed: route.pathCells.length > 1 || beforeM > 0 || resolved.reflected,
    driveRule: 'cell-target-curved-composition',
  }
}

function driveCandidateForAim({ state, action, aimPoint, config, obstacles }) {
  if (!aimPoint) return null
  const aimCell = worldToAxial(aimPoint)
  const plans = envelopeForState(state).map((route) => simulateDriveRoute({ state, route, action, config, obstacles }))
  return chooseCandidateForAim(plans, aimCell)
}

function simulateDiscreteCurvedDrive({ state, actionId, aimPoint, config = DEFAULT_SOLVER_CONFIG, obstacles = [] }) {
  const action = actionById(actionId)
  return driveCandidateForAim({ state, action, aimPoint, config, obstacles })
    ?? invalidPlan(state, action, 'discrete', 'Choose one of the highlighted reachable Cells.')
}

export function simulatePrototypeSpatial(input) {
  if (input.actionId === 'basic-move') return simulateBasicMoveRule(input)
  if (input.spatialMode === 'discrete' && CURVED_DISCRETE_ACTIONS.has(input.actionId)) {
    return simulateDiscreteCurvedDrive(input)
  }

  const plan = simulateSpatial(input)
  if (!plan?.valid) return plan
  if (input.spatialMode !== 'discrete') return plan

  const axisIndex = directionIndexFromVector(plan.finalState.velocity)
  const axisId = axisIndex >= 0 && momentumLevel(length(plan.finalState.velocity)) > 0
    ? HEX_DIRECTIONS[axisIndex].id
    : axisIdFromState(input.state)
  return {
    ...plan,
    axisBefore: axisIdFromState(input.state),
    axisAfter: axisId,
    finalState: { ...plan.finalState, axisId },
  }
}

export function discreteActionReachability({ state, actionId = 'basic-move', spatialMode = 'discrete', config = DEFAULT_SOLVER_CONFIG, obstacles = [] }) {
  if (!isDestinationDrivenAction(actionId, spatialMode)) return []
  const action = actionById(actionId)
  const results = []
  for (const route of envelopeForState(state)) {
    const plan = actionId === 'basic-move'
      ? simulateBasicRoute({ state, route, action, spatialMode, config, obstacles })
      : simulateDriveRoute({ state, route, action, config, obstacles })
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
      rule: plan.basicRule ?? plan.driveRule,
      forward: Boolean(route.forward),
      reflectionContinuation: plan.reflectionContinuation,
      movedSteps: plan.reflectedMovedSteps,
      movementBudget: plan.reflectedMovementBudget,
      remainingTravel: plan.remainingTravel,
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
