import { HEX_DIRECTIONS, axialDistance, axialKey, axialToWorld, worldToAxial } from './hex.js'
import {
  DEFAULT_SOLVER_CONFIG,
  actionById,
  combineImpulseVelocity,
  momentumLevel,
  momentumSpeed,
  simulateSpatial,
} from './solver.js'
import { length, normalize, scale } from './vector.js'

const sameHex = (a, b) => Boolean(a && b && a.q === b.q && a.r === b.r)
const cloneHex = (hex) => ({ q: hex.q, r: hex.r })
const VALID_AXIS = new Set(HEX_DIRECTIONS.map((entry) => entry.id))
const CURVED_DISCRETE_ACTIONS = new Set(['drive', 'heavy-drive', 'hard-turn'])

// These templates are authored relative to an E Axis and rotated into the
// actor's current Horizontal Axis. `path` contains the Cell centers the visible
// curve must pass through; `target` is the Cell the player clicks.
//
// M1: five adjacent Cells except the reverse Cell. The two 120° landings pass
// through NE / SE respectively.
// M2: five connected landing Cells. The two inner side landings first pass E.
// M3: five connected front Cells. The previous far-left / far-right fringe Cells
// are removed so the envelope is one Cell narrower on each side.
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

function routeLegality(pathCells, config, obstacles) {
  for (const cell of pathCells) {
    const obstacle = obstacleAt(obstacles, cell)
    const boundary = axialDistance(cell) > config.boardRadius
    if (obstacle || boundary) {
      return {
        valid: false,
        reason: boundary ? 'Movement route leaves the board.' : 'Movement route is blocked by terrain.',
        obstacle,
        cell,
      }
    }
  }
  return { valid: true, reason: '' }
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

function samplesForRoute(state, route, finalAxisId, finalVelocity) {
  const cells = [route.startHex, ...route.pathCells]
  return cells.map((cell, index) => {
    const previous = index > 0 ? cells[index - 1] : null
    const stepAxis = previous ? directionIdFromCells(previous, cell) : axisIdFromState(state)
    const t = cells.length <= 1 ? 1 : index / (cells.length - 1)
    return {
      t,
      position: axialToWorld(cell),
      velocity: index === 0 ? { ...state.velocity } : { ...finalVelocity },
      axisId: index === cells.length - 1 ? finalAxisId : (stepAxis ?? axisIdFromState(state)),
    }
  })
}

function findRouteForAim(state, aimPoint) {
  if (!aimPoint) return null
  const aimCell = worldToAxial(aimPoint)
  return envelopeForState(state).find((entry) => sameHex(entry.targetHex, aimCell)) ?? null
}

export function simulateBasicMoveRule({
  state,
  aimPoint,
  spatialMode = 'discrete',
  config = DEFAULT_SOLVER_CONFIG,
  obstacles = [],
}) {
  const action = actionById('basic-move')
  const route = findRouteForAim(state, aimPoint)
  if (!route) return invalidPlan(state, action, spatialMode, 'Choose one of the highlighted reachable Cells.')

  const legality = routeLegality(route.pathCells, config, obstacles)
  if (!legality.valid) return invalidPlan(state, action, spatialMode, legality.reason)

  const beforeSpeed = length(state.velocity)
  const beforeM = momentumLevel(beforeSpeed)
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
    // M1 is still the natural build step because it does not buy extra range.
    // M2 / M3 already receive extra travel distance, so the action pays one M
    // at AT end even when no steering occurs.
    finalM = beforeM === 1 ? 2 : Math.max(0, beforeM - 1)
    finalAxisId = storedAxisId ?? route.axisAfter
    basicRule = beforeM === 1 ? 'same-axis-build' : 'forward-range-spend'
  } else {
    finalM = Math.max(0, beforeM - 1)
    basicRule = 'steer-spend'
  }

  const finalVelocity = velocityForAxis(finalAxisId, finalM)
  const samples = samplesForRoute(state, route, finalAxisId, finalVelocity)
  const finalPosition = axialToWorld(route.targetHex)
  return {
    valid: true,
    reason: '',
    action,
    actionKind: action.kind,
    spatialMode,
    aimAngle: 0,
    impulse: { x: 0, z: 0 },
    control: normalize({ x: aimPoint.x - state.position.x, z: aimPoint.z - state.position.z }),
    samples,
    collisions: [],
    traversedCells: [cloneHex(route.startHex), ...route.pathCells.map(cloneHex)],
    finalState: {
      ...state,
      position: finalPosition,
      velocity: finalVelocity,
      axisId: finalAxisId,
      worldAt: state.worldAt + 1,
    },
    beforeSpeed,
    afterImpulseSpeed: beforeSpeed,
    finalSpeed: length(finalVelocity),
    beforeM,
    finalM,
    range: momentumRange(beforeM),
    pathCellCount: route.pathCells.length,
    curveUsed: route.pathCells.length > 1,
    axisBefore: storedAxisId,
    axisAfter: finalAxisId,
    basicRule,
    turnRadius: beforeM,
    destinationDriven: true,
    landingId: route.id,
  }
}

function simulateDiscreteCurvedDrive({
  state,
  actionId,
  aimPoint,
  config = DEFAULT_SOLVER_CONFIG,
  obstacles = [],
}) {
  const action = actionById(actionId)
  const route = findRouteForAim(state, aimPoint)
  if (!route) return invalidPlan(state, action, 'discrete', 'Choose one of the highlighted reachable Cells.')

  const legality = routeLegality(route.pathCells, config, obstacles)
  if (!legality.valid) return invalidPlan(state, action, 'discrete', legality.reason)

  const beforeSpeed = length(state.velocity)
  const beforeM = momentumLevel(beforeSpeed)
  const aimDirection = normalize({ x: aimPoint.x - state.position.x, z: aimPoint.z - state.position.z })
  const combinedVelocity = combineImpulseVelocity(state.velocity, aimDirection, action.force, config.maxSpeed)
  const afterImpulseSpeed = length(combinedVelocity)
  const finalM = momentumLevel(afterImpulseSpeed)
  const finalAxisId = route.axisAfter ?? axisIdFromState(state)
  const finalVelocity = velocityForAxis(finalAxisId, finalM)
  const samples = samplesForRoute(state, route, finalAxisId, finalVelocity)
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
    collisions: [],
    traversedCells: [cloneHex(route.startHex), ...route.pathCells.map(cloneHex)],
    finalState: {
      ...state,
      position: axialToWorld(route.targetHex),
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
    curveUsed: route.pathCells.length > 1 || beforeM > 0,
    axisBefore: axisIdFromState(state),
    axisAfter: finalAxisId,
    driveRule: 'cell-target-curved-composition',
    destinationDriven: true,
    landingId: route.id,
  }
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
  const results = []
  for (const route of envelopeForState(state)) {
    const legality = routeLegality(route.pathCells, config, obstacles)
    if (!legality.valid) continue
    const aimPoint = axialToWorld(route.targetHex)
    const plan = actionId === 'basic-move'
      ? simulateBasicMoveRule({ state, aimPoint, spatialMode, config, obstacles })
      : simulateDiscreteCurvedDrive({ state, actionId, aimPoint, config, obstacles })
    if (!plan.valid) continue
    results.push({
      id: route.id,
      targetHex: cloneHex(route.targetHex),
      finalHex: worldToAxial(plan.finalState.position),
      pathCells: route.pathCells.map(cloneHex),
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
