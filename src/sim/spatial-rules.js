import { HEX_DIRECTIONS, axialDistance, axialKey, axialToWorld, directionVector, worldToAxial } from './hex.js'
import {
  DEFAULT_SOLVER_CONFIG,
  actionById,
  combineImpulseVelocity,
  momentumLevel,
  momentumSpeed,
  simulateSpatial,
} from './solver.js'
import { length, normalize, reflect, scale } from './vector.js'

const sameHex = (a, b) => Boolean(a && b && a.q === b.q && a.r === b.r)
const cloneHex = (hex) => ({ q: hex.q, r: hex.r })
const VALID_AXIS = new Set(HEX_DIRECTIONS.map((entry) => entry.id))
const CURVED_DISCRETE_ACTIONS = new Set(['drive', 'heavy-drive', 'hard-turn'])

// These templates are authored relative to an E Axis and rotated into the
// actor's current Horizontal Axis. `path` is the nominal trajectory before any
// physical surface reflection; `target` is only the authored intent endpoint.
// Reachability exposes the resolved final Cell after collisions/reflections.
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

function directionIndexFromHexDelta(delta) {
  return HEX_DIRECTIONS.findIndex((entry) => entry.q === delta.q && entry.r === delta.r)
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

function directionIdFromCells(from, to) {
  const index = directionIndexFromHexDelta({ q: to.q - from.q, r: to.r - from.r })
  return index >= 0 ? HEX_DIRECTIONS[index].id : null
}

function velocityForAxis(axisId, level) {
  if (!axisId || level <= 0) return { x: 0, z: 0 }
  const index = HEX_DIRECTIONS.findIndex((entry) => entry.id === axisId)
  if (index < 0) return { x: 0, z: 0 }
  return scale(normalize(axialToWorld({ q: HEX_DIRECTIONS[index].q, r: HEX_DIRECTIONS[index].r })), momentumSpeed(level))
}

function obstacleAt(obstacles, hex) {
  return obstacles.find((entry) => sameHex(entry.hex, hex)) ?? null
}

function stepCell(cell, directionId) {
  const direction = HEX_DIRECTIONS.find((entry) => entry.id === directionId)
  return direction ? { q: cell.q + direction.q, r: cell.r + direction.r } : cloneHex(cell)
}

function nearestHexDirection(vector) {
  const index = directionIndexFromVector(vector)
  return index >= 0 ? HEX_DIRECTIONS[index] : null
}

function reflectedHexDirection(current, attempted, incomingAxisId, obstacle, boundary) {
  const incoming = directionVector(incomingAxisId)
  let normal
  if (boundary) {
    const attemptedWorld = axialToWorld(attempted)
    normal = normalize({ x: -attemptedWorld.x, z: -attemptedWorld.z })
  } else {
    const currentWorld = axialToWorld(current)
    const obstacleWorld = axialToWorld(obstacle.hex)
    normal = normalize({ x: currentWorld.x - obstacleWorld.x, z: currentWorld.z - obstacleWorld.z })
  }
  const reflected = reflect(incoming, normal, 1)
  return { direction: nearestHexDirection(reflected), normal, reflected }
}

// Resolve the authored route one Cell-step at a time. Once a wall/boundary is
// touched, the authored steering path yields to physical reflection for the
// remaining Cell-step budget in this AT. Every reflection costs one M. There is
// deliberately NO per-AT bounce cap in this experiment: corner cases may bounce
// repeatedly so we can evaluate the raw physical result before adding a limiter.
function resolveRouteWithPhysicalReflection(route, config, obstacles, motionM) {
  const actualPath = []
  const timelineCells = [cloneHex(route.startHex)]
  const collisions = []
  let current = cloneHex(route.startHex)
  let reflectedMode = false
  let activeAxisId = route.axisBefore ?? directionIdFromCells(route.startHex, route.pathCells[0]) ?? route.axisAfter
  let remainingMotionM = Math.max(0, Math.min(3, Math.round(motionM) || 0))
  let reflectionCount = 0

  for (let step = 0; step < route.pathCells.length; step += 1) {
    const authoredCell = route.pathCells[step]
    const authoredAxisId = directionIdFromCells(current, authoredCell)
    const stepAxisId = reflectedMode ? activeAxisId : (authoredAxisId ?? activeAxisId)
    if (!stepAxisId) break

    const attempted = stepCell(current, stepAxisId)
    const obstacle = obstacleAt(obstacles, attempted)
    const boundary = axialDistance(attempted) > config.boardRadius

    if (obstacle || boundary) {
      const beforeM = remainingMotionM
      const reflection = reflectedHexDirection(current, attempted, stepAxisId, obstacle, boundary)
      const reflectedDirection = reflection.direction
      reflectionCount += 1
      remainingMotionM = Math.max(0, remainingMotionM - 1)
      reflectedMode = true
      if (reflectedDirection) activeAxisId = reflectedDirection.id
      collisions.push({
        t: (step + 1) / Math.max(1, route.pathCells.length),
        kind: boundary ? 'boundary' : obstacle?.kind ?? 'hard',
        obstacleId: obstacle?.id ?? null,
        position: axialToWorld(current),
        cell: cloneHex(attempted),
        attemptedCell: cloneHex(attempted),
        axisBefore: stepAxisId,
        axisAfter: activeAxisId,
        beforeM,
        afterM: remainingMotionM,
        reflection: true,
        normal: reflection.normal,
      })
      timelineCells.push(cloneHex(current))
      if (remainingMotionM <= 0 || !reflectedDirection) break
      continue
    }

    current = cloneHex(attempted)
    actualPath.push(cloneHex(current))
    timelineCells.push(cloneHex(current))
    activeAxisId = stepAxisId
  }

  return {
    finalHex: cloneHex(current),
    actualPath,
    timelineCells,
    collisions,
    reflectionCount,
    reflected: reflectionCount > 0,
    axisAfter: reflectionCount > 0 ? activeAxisId : route.axisAfter,
    remainingMotionM,
  }
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
  }
}

function samplesForResolvedRoute(state, resolved, finalAxisId, finalVelocity) {
  const cells = resolved.timelineCells
  if (cells.length <= 1) {
    return [
      { t: 0, position: { ...state.position }, velocity: { ...state.velocity }, axisId: axisIdFromState(state) },
      { t: 1, position: { ...state.position }, velocity: { ...finalVelocity }, axisId: finalAxisId },
    ]
  }
  return cells.map((cell, index) => {
    const previous = index > 0 ? cells[index - 1] : null
    const stepAxis = previous && !sameHex(previous, cell) ? directionIdFromCells(previous, cell) : null
    const t = index / (cells.length - 1)
    return {
      t,
      position: axialToWorld(cell),
      velocity: index === 0 ? { ...state.velocity } : { ...finalVelocity },
      axisId: index === cells.length - 1 ? finalAxisId : (stepAxis ?? axisIdFromState(state)),
    }
  })
}

function basicOutcomeForRoute(state, route) {
  const beforeM = momentumLevel(length(state.velocity))
  const storedAxisId = axisIdFromState(state)
  let finalM
  let finalAxisId = route.axisAfter
  let basicRule

  if (beforeM === 0) {
    const targetDirection = directionIdFromCells(route.startHex, route.targetHex)
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

function simulateBasicRoute({ state, route, action, spatialMode, config, obstacles }) {
  const outcome = basicOutcomeForRoute(state, route)
  const resolved = resolveRouteWithPhysicalReflection(route, config, obstacles, outcome.beforeM)
  const finalM = Math.max(0, outcome.finalM - resolved.reflectionCount)
  const finalAxisId = resolved.reflected ? resolved.axisAfter : outcome.finalAxisId
  const finalVelocity = velocityForAxis(finalAxisId, finalM)
  const samples = samplesForResolvedRoute(state, resolved, finalAxisId, finalVelocity)
  const intentPoint = axialToWorld(route.targetHex)
  return {
    valid: true,
    reason: '',
    action,
    actionKind: action.kind,
    spatialMode,
    aimAngle: 0,
    impulse: { x: 0, z: 0 },
    control: normalize({ x: intentPoint.x - state.position.x, z: intentPoint.z - state.position.z }),
    samples,
    collisions: resolved.collisions,
    traversedCells: [cloneHex(route.startHex), ...resolved.actualPath.map(cloneHex)],
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
    beforeM: outcome.beforeM,
    finalM,
    range: momentumRange(outcome.beforeM),
    pathCellCount: route.pathCells.length,
    curveUsed: route.pathCells.length > 1 || resolved.reflected,
    axisBefore: outcome.storedAxisId,
    axisAfter: finalAxisId,
    basicRule: outcome.basicRule,
    turnRadius: outcome.beforeM,
    destinationDriven: true,
    landingId: route.id,
    nominalTargetHex: cloneHex(route.targetHex),
    reflectionCount: resolved.reflectionCount,
    playerReflectionRule: 'physical-multi-bounce-v1',
  }
}

function basicCandidateForAim({ state, aimPoint, action, spatialMode, config, obstacles }) {
  if (!aimPoint) return null
  const aimCell = worldToAxial(aimPoint)
  const routes = envelopeForState(state)
  const direct = routes.filter((route) => sameHex(route.targetHex, aimCell))
  const rest = routes.filter((route) => !sameHex(route.targetHex, aimCell))
  for (const route of [...direct, ...rest]) {
    const plan = simulateBasicRoute({ state, route, action, spatialMode, config, obstacles })
    if (sameHex(worldToAxial(plan.finalState.position), aimCell)) return plan
  }
  return null
}

export function simulateBasicMoveRule({
  state,
  aimPoint,
  spatialMode = 'discrete',
  config = DEFAULT_SOLVER_CONFIG,
  obstacles = [],
}) {
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
  const resolved = resolveRouteWithPhysicalReflection(route, config, obstacles, afterImpulseM)
  const finalM = Math.max(0, afterImpulseM - resolved.reflectionCount)
  const finalAxisId = resolved.reflected ? resolved.axisAfter : (route.axisAfter ?? axisIdFromState(state))
  const finalVelocity = velocityForAxis(finalAxisId, finalM)
  const samples = samplesForResolvedRoute(state, resolved, finalAxisId, finalVelocity)
  return {
    valid: true,
    reason: '',
    action,
    actionKind: action.kind,
    spatialMode: 'discrete',
    aimAngle: 0,
    impulse: scale(aimDirection, action.force),
    control: aimDirection,
    samples,
    collisions: resolved.collisions,
    traversedCells: [cloneHex(route.startHex), ...resolved.actualPath.map(cloneHex)],
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
    curveUsed: route.pathCells.length > 1 || beforeM > 0 || resolved.reflected,
    axisBefore: axisIdFromState(state),
    axisAfter: finalAxisId,
    driveRule: 'cell-target-curved-composition',
    destinationDriven: true,
    landingId: route.id,
    nominalTargetHex: cloneHex(route.targetHex),
    reflectionCount: resolved.reflectionCount,
    playerReflectionRule: 'physical-multi-bounce-v1',
  }
}

function driveCandidateForAim({ state, action, aimPoint, config, obstacles }) {
  if (!aimPoint) return null
  const aimCell = worldToAxial(aimPoint)
  const routes = envelopeForState(state)
  const direct = routes.filter((route) => sameHex(route.targetHex, aimCell))
  const rest = routes.filter((route) => !sameHex(route.targetHex, aimCell))
  for (const route of [...direct, ...rest]) {
    const plan = simulateDriveRoute({ state, route, action, config, obstacles })
    if (sameHex(worldToAxial(plan.finalState.position), aimCell)) return plan
  }
  return null
}

function simulateDiscreteCurvedDrive({
  state,
  actionId,
  aimPoint,
  config = DEFAULT_SOLVER_CONFIG,
  obstacles = [],
}) {
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

export function discreteActionReachability({
  state,
  actionId = 'basic-move',
  spatialMode = 'discrete',
  config = DEFAULT_SOLVER_CONFIG,
  obstacles = [],
}) {
  if (!isDestinationDrivenAction(actionId, spatialMode)) return []
  const action = actionById(actionId)
  const results = []
  for (const route of envelopeForState(state)) {
    const plan = actionId === 'basic-move'
      ? simulateBasicRoute({ state, route, action, spatialMode, config, obstacles })
      : simulateDriveRoute({ state, route, action, config, obstacles })
    if (!plan.valid) continue
    const finalHex = worldToAxial(plan.finalState.position)
    results.push({
      id: route.id,
      targetHex: cloneHex(finalHex),
      nominalTargetHex: cloneHex(route.targetHex),
      finalHex: cloneHex(finalHex),
      pathCells: plan.traversedCells.slice(1).map(cloneHex),
      collisions: plan.collisions.map((entry) => ({ ...entry, cell: entry.cell ? cloneHex(entry.cell) : undefined })),
      reflectionCount: plan.reflectionCount ?? 0,
      range: plan.range,
      finalM: plan.finalM,
      axisAfter: plan.axisAfter,
      rule: plan.basicRule ?? plan.driveRule,
      forward: Boolean(route.forward),
    })
  }
  return results
}

export function basicMoveReachability(input) {
  return discreteActionReachability({ ...input, actionId: 'basic-move' })
}

export function reachableKeySet(reachability) {
  return new Set(reachability.map((entry) => axialKey(entry.finalHex ?? entry.targetHex)))
}
