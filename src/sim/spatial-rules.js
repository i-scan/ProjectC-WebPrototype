import { HEX_DIRECTIONS, axialDistance, axialToWorld, worldToAxial } from './hex.js'
import {
  DEFAULT_SOLVER_CONFIG,
  actionById,
  momentumLevel,
  momentumSpeed,
  simulateSpatial,
} from './solver.js'
import { length, normalize, scale } from './vector.js'

const sameHex = (a, b) => Boolean(a && b && a.q === b.q && a.r === b.r)
const cloneHex = (hex) => ({ q: hex.q, r: hex.r })
const VALID_AXIS = new Set(HEX_DIRECTIONS.map((entry) => entry.id))

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

function signedDirectionDelta(fromIndex, toIndex) {
  let delta = toIndex - fromIndex
  while (delta > 3) delta -= 6
  while (delta < -3) delta += 6
  return delta
}

function redirectDirectionIndex(fromIndex, toIndex) {
  const delta = signedDirectionDelta(fromIndex, toIndex)
  if (Math.abs(delta) === 3) return null
  if (delta === 0) return fromIndex
  return (fromIndex + Math.sign(delta) + 6) % 6
}

function velocityForDirection(directionIndex, level) {
  if (level <= 0 || directionIndex == null || directionIndex < 0) return { x: 0, z: 0 }
  const direction = HEX_DIRECTIONS[directionIndex]
  return scale(normalize(axialToWorld({ q: direction.q, r: direction.r })), momentumSpeed(level))
}

function obstacleAt(obstacles, hex) {
  return obstacles.find((entry) => sameHex(entry.hex, hex)) ?? null
}

export function axisIdFromState(state) {
  if (VALID_AXIS.has(state?.axisId)) return state.axisId
  const index = directionIndexFromVector(state?.velocity ?? { x: 0, z: 0 })
  return index >= 0 ? HEX_DIRECTIONS[index].id : null
}

export function momentumRange(level) {
  const normalized = Math.max(0, Math.min(3, Math.round(level)))
  if (normalized >= 3) return 3
  if (normalized >= 2) return 2
  return 1
}

function invalidBasicPlan(state, action, spatialMode, reason) {
  const speed = length(state.velocity)
  const m = momentumLevel(speed)
  return {
    valid: false,
    reason,
    action,
    actionKind: action.kind,
    spatialMode,
    samples: [{ t: 0, position: { ...state.position }, velocity: { ...state.velocity } }],
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
    basicRule: 'invalid',
  }
}

export function simulateBasicMoveRule({
  state,
  aimPoint,
  spatialMode = 'discrete',
  config = DEFAULT_SOLVER_CONFIG,
  obstacles = [],
}) {
  const action = actionById('basic-move')
  const beforeSpeed = length(state.velocity)
  const beforeM = momentumLevel(beforeSpeed)
  const startCell = worldToAxial(state.position)

  if (!aimPoint) return invalidBasicPlan(state, action, spatialMode, 'Hover an adjacent Cell to define Basic Move intent.')
  const aimCell = worldToAxial(aimPoint)
  if (axialDistance(startCell, aimCell) !== 1) {
    return invalidBasicPlan(state, action, spatialMode, 'Basic Move Aim Cell must be adjacent.')
  }

  const aimDelta = { q: aimCell.q - startCell.q, r: aimCell.r - startCell.r }
  const aimDirectionIndex = directionIndexFromHexDelta(aimDelta)
  if (aimDirectionIndex < 0) return invalidBasicPlan(state, action, spatialMode, 'Basic Move Aim Cell must be adjacent.')

  const storedAxisId = axisIdFromState(state)
  const storedAxisIndex = storedAxisId ? HEX_DIRECTIONS.findIndex((entry) => entry.id === storedAxisId) : -1

  // M0 has no inertial steering constraint. A first move establishes Axis without
  // creating Momentum; repeating the same Axis on the next Basic Move begins the
  // natural M build. Changing direction at M0 simply re-establishes Axis and stays M0.
  if (beforeM === 0) {
    const sameAxis = storedAxisIndex === aimDirectionIndex && storedAxisIndex >= 0
    const finalM = sameAxis ? 1 : 0
    const next = cloneHex(aimCell)
    const obstacle = obstacleAt(obstacles, next)
    const outOfBounds = axialDistance(next) > config.boardRadius
    const blocked = Boolean(obstacle || outOfBounds)
    const finalCell = blocked ? startCell : next
    const finalAxisIndex = aimDirectionIndex
    const finalVelocity = blocked ? { x: 0, z: 0 } : velocityForDirection(finalAxisIndex, finalM)
    const collisions = blocked ? [{
      t: 1,
      kind: outOfBounds ? 'boundary' : obstacle.kind,
      obstacleId: obstacle?.id,
      position: axialToWorld(startCell),
      cell: cloneHex(next),
    }] : []
    const finalAxisId = blocked ? storedAxisId : HEX_DIRECTIONS[finalAxisIndex].id
    return {
      valid: true,
      reason: '',
      action,
      actionKind: action.kind,
      spatialMode,
      aimAngle: 0,
      impulse: { x: 0, z: 0 },
      control: normalize({ x: aimPoint.x - state.position.x, z: aimPoint.z - state.position.z }),
      samples: [
        { t: 0, position: axialToWorld(startCell), velocity: { ...state.velocity } },
        { t: 1, position: axialToWorld(finalCell), velocity: { ...finalVelocity } },
      ],
      collisions,
      traversedCells: blocked ? [cloneHex(startCell)] : [cloneHex(startCell), cloneHex(finalCell)],
      finalState: {
        ...state,
        position: axialToWorld(finalCell),
        velocity: finalVelocity,
        axisId: finalAxisId,
        worldAt: state.worldAt + 1,
      },
      beforeSpeed,
      afterImpulseSpeed: beforeSpeed,
      finalSpeed: length(finalVelocity),
      beforeM,
      finalM: blocked ? 0 : finalM,
      range: 1,
      curveUsed: false,
      axisBefore: storedAxisId,
      axisAfter: finalAxisId,
      basicRule: sameAxis ? 'same-axis-build' : 'establish-axis',
      turnRadius: 0,
    }
  }

  const incomingAxisIndex = storedAxisIndex >= 0 ? storedAxisIndex : directionIndexFromVector(state.velocity)
  if (incomingAxisIndex < 0) return invalidBasicPlan(state, action, spatialMode, 'Momentum requires a Horizontal Axis.')

  const directionDelta = signedDirectionDelta(incomingAxisIndex, aimDirectionIndex)
  if (Math.abs(directionDelta) === 3) {
    return invalidBasicPlan(
      state,
      action,
      spatialMode,
      'Opposite Basic Move intent is outside the steering envelope while M > 0. Brake to M0 or use an explicit turn action.',
    )
  }

  const sameAxis = directionDelta === 0
  const finalMTarget = sameAxis ? Math.min(3, beforeM + 1) : Math.max(0, beforeM - 1)
  const movementSteps = momentumRange(beforeM)
  let axisIndex = incomingAxisIndex
  let cell = cloneHex(startCell)
  let blocked = false
  const samples = [{ t: 0, position: axialToWorld(cell), velocity: { ...state.velocity } }]
  const traversedCells = [cloneHex(cell)]
  const collisions = []

  for (let step = 1; step <= movementSteps; step += 1) {
    const oldAxisIndex = axisIndex
    const redirected = sameAxis ? oldAxisIndex : redirectDirectionIndex(oldAxisIndex, aimDirectionIndex)
    if (redirected == null) {
      blocked = true
      break
    }
    const newAxisIndex = redirected
    // Steering while Momentum remains uses the incoming tangent for this Cell-step;
    // when the action spends down to M0, the redirected Axis immediately owns motion.
    const actualDirectionIndex = sameAxis
      ? oldAxisIndex
      : finalMTarget > 0
        ? oldAxisIndex
        : newAxisIndex
    const direction = HEX_DIRECTIONS[actualDirectionIndex]
    const next = { q: cell.q + direction.q, r: cell.r + direction.r }
    const obstacle = obstacleAt(obstacles, next)
    const outOfBounds = axialDistance(next) > config.boardRadius

    axisIndex = newAxisIndex
    if (obstacle || outOfBounds) {
      blocked = true
      collisions.push({
        t: step / movementSteps,
        kind: outOfBounds ? 'boundary' : obstacle.kind,
        obstacleId: obstacle?.id,
        position: axialToWorld(cell),
        cell: cloneHex(next),
      })
      break
    }

    cell = next
    traversedCells.push(cloneHex(cell))
    samples.push({
      t: step / movementSteps,
      position: axialToWorld(cell),
      velocity: velocityForDirection(axisIndex, finalMTarget),
    })
  }

  const finalM = blocked ? 0 : finalMTarget
  const finalVelocity = velocityForDirection(axisIndex, finalM)
  const axisAfter = HEX_DIRECTIONS[axisIndex]?.id ?? storedAxisId
  if (samples.length === 1 || samples.at(-1).t < 1) {
    samples.push({ t: 1, position: axialToWorld(cell), velocity: { ...finalVelocity } })
  } else {
    samples[samples.length - 1] = { ...samples.at(-1), velocity: { ...finalVelocity } }
  }

  return {
    valid: true,
    reason: '',
    action,
    actionKind: action.kind,
    spatialMode,
    aimAngle: Math.abs(directionDelta) * 60,
    impulse: { x: 0, z: 0 },
    control: normalize({ x: aimPoint.x - state.position.x, z: aimPoint.z - state.position.z }),
    samples,
    collisions,
    traversedCells,
    finalState: {
      ...state,
      position: axialToWorld(cell),
      velocity: finalVelocity,
      axisId: axisAfter,
      worldAt: state.worldAt + 1,
    },
    beforeSpeed,
    afterImpulseSpeed: beforeSpeed,
    finalSpeed: length(finalVelocity),
    beforeM,
    finalM,
    range: movementSteps,
    curveUsed: false,
    axisBefore: storedAxisId,
    axisAfter,
    basicRule: sameAxis ? 'same-axis-build' : 'steer-spend',
    turnRadius: beforeM,
  }
}

export function simulatePrototypeSpatial(input) {
  if (input.actionId === 'basic-move') return simulateBasicMoveRule(input)
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

export function basicMoveReachability({
  state,
  spatialMode = 'discrete',
  config = DEFAULT_SOLVER_CONFIG,
  obstacles = [],
}) {
  const start = worldToAxial(state.position)
  const results = []
  for (const direction of HEX_DIRECTIONS) {
    const aimHex = { q: start.q + direction.q, r: start.r + direction.r }
    const plan = simulateBasicMoveRule({
      state,
      aimPoint: axialToWorld(aimHex),
      spatialMode,
      config,
      obstacles,
    })
    if (!plan.valid) continue
    results.push({
      aimId: direction.id,
      aimHex,
      finalHex: worldToAxial(plan.finalState.position),
      range: plan.range,
      finalM: plan.finalM,
      axisAfter: plan.axisAfter,
      rule: plan.basicRule,
    })
  }
  return results
}
