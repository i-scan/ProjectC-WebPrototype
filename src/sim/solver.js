import { HEX_DIRECTIONS, axialDistance, axialKey, axialToWorld, isInsideBoard, worldToAxial } from './hex.js'
import { add, angleDeg, clampLength, length, normalize, reflect, scale, sub } from './vector.js'

export const AT_VISUAL_MS = 800
export const SOLVER_STEPS = 120
export const MAX_SPEED = 3.2
export const ACTOR_RADIUS = 0.16
export const BASIC_MOVE_DISTANCE = 1

const CURVE_HANDLE_RATIO = 0.56
const CURVE_HANDLE_MAX = 0.82

export const ACTIONS = [
  {
    id: 'basic-move',
    kind: 'basic',
    label: 'Basic Move',
    short: '基础移动 · 1 AT',
    force: 0,
    aimWindow: null,
    description: '基础行动。Aim Cell 只定义自主移动方向；移动与当前惯性叠加，但不会自动增加、消耗或重置 Momentum。',
  },
  {
    id: 'drive',
    kind: 'impulse',
    label: 'Drive',
    short: '推进冲量',
    force: 0.85,
    aimWindow: null,
    description: '向任意 Aim 方向施加 ΔV 0.85；结果由当前 Velocity + Impulse 直接合成，不做转向合法性检查。',
  },
  {
    id: 'heavy-drive',
    kind: 'impulse',
    label: 'Heavy Drive',
    short: '重推进冲量',
    force: 1.35,
    aimWindow: null,
    description: '向任意 Aim 方向施加更强的 ΔV 1.35；同样先做向量合成，再求解轨迹。',
  },
  {
    id: 'counter',
    kind: 'impulse',
    label: 'Counter Impulse',
    short: '反冲',
    force: 0.9,
    aimWindow: 70,
    description: '专用反冲动作；Aim 需要位于当前速度反方向附近，用于主动减速或反向。',
  },
  {
    id: 'hard-turn',
    kind: 'impulse',
    label: 'Hard Turn',
    short: '精细修正',
    force: 0.75,
    aimWindow: null,
    description: '较小的自由方向冲量，用于比 Drive 更细地修正合成后的 Velocity。',
  },
  {
    id: 'coast',
    kind: 'coast',
    label: 'Coast',
    short: '滑行',
    force: 0,
    aimWindow: 0,
    description: '不施加新力；完整保留当前 Velocity 完成 1 AT。',
  },
]

export const DEFAULT_SOLVER_CONFIG = Object.freeze({
  boardRadius: 7,
  restitution: 0.58,
  boundaryRestitution: 0.42,
  steps: SOLVER_STEPS,
  maxSpeed: MAX_SPEED,
})

const lerp = (a, b, t) => a + (b - a) * t
const smoothstep = (t) => t * t * (3 - 2 * t)

export function momentumLevel(speed) {
  if (speed < 0.18) return 0
  if (speed < 1.2) return 1
  if (speed < 2.2) return 2
  return 3
}

export function createInitialState() {
  return { position: { x: 0, z: 0 }, velocity: { x: 0, z: 0 }, worldAt: 0 }
}

export function actionById(id) {
  return ACTIONS.find((action) => action.id === id) ?? ACTIONS[1]
}

export function combineImpulseVelocity(velocity, aimDirection, force, maxSpeed = MAX_SPEED) {
  const direction = normalize(aimDirection)
  return clampLength(add(velocity, scale(direction, force)), maxSpeed)
}

function aimPolicy(state, action, aimPoint) {
  const speed = length(state.velocity)

  if (action.kind === 'coast') {
    return speed < 0.18
      ? { valid: false, reason: 'Coast requires existing velocity.', direction: { x: 0, z: 0 }, angle: 0 }
      : { valid: true, reason: '', direction: normalize(state.velocity), angle: 0 }
  }

  if (!aimPoint) {
    return { valid: false, reason: 'Hover a board Cell to define Aim direction.', direction: { x: 0, z: 0 }, angle: 0 }
  }

  const aimVector = sub(aimPoint, state.position)
  if (length(aimVector) < 0.001) {
    return { valid: false, reason: 'Choose a different Cell to define Aim direction.', direction: { x: 0, z: 0 }, angle: 0 }
  }
  const direction = normalize(aimVector)

  if (action.id !== 'counter') {
    const angle = speed < 0.18 ? 0 : angleDeg(state.velocity, direction)
    return { valid: true, reason: '', direction, angle }
  }

  if (speed < 0.18) {
    return { valid: false, reason: 'Counter Impulse requires existing velocity.', direction, angle: 180 }
  }
  const reverseReference = scale(state.velocity, -1)
  const angle = angleDeg(reverseReference, direction)
  return angle <= action.aimWindow
    ? { valid: true, reason: '', direction, angle }
    : { valid: false, reason: `Counter Impulse aim is ${angle.toFixed(0)}° outside its reverse ±${action.aimWindow}° window.`, direction, angle }
}

function invalidPlan(state, action, reason, beforeSpeed, spatialMode) {
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
    beforeSpeed,
    afterImpulseSpeed: beforeSpeed,
    finalSpeed: beforeSpeed,
    beforeM: momentumLevel(beforeSpeed),
    finalM: momentumLevel(beforeSpeed),
    curveUsed: false,
    impulse: { x: 0, z: 0 },
  }
}

function actionVectors(state, action, policy, config) {
  if (action.kind === 'basic') {
    const control = scale(policy.direction, BASIC_MOVE_DISTANCE)
    return {
      impulse: { x: 0, z: 0 },
      momentumVelocity: { ...state.velocity },
      travelVector: add(state.velocity, control),
      control,
    }
  }

  if (action.kind === 'coast') {
    return {
      impulse: { x: 0, z: 0 },
      momentumVelocity: { ...state.velocity },
      travelVector: { ...state.velocity },
      control: { x: 0, z: 0 },
    }
  }

  const impulse = scale(policy.direction, action.force)
  const momentumVelocity = combineImpulseVelocity(state.velocity, policy.direction, action.force, config.maxSpeed)
  return {
    impulse,
    momentumVelocity,
    travelVector: { ...momentumVelocity },
    control: { x: 0, z: 0 },
  }
}

function hermitePoint(start, end, startTangent, endTangent, t) {
  const t2 = t * t
  const t3 = t2 * t
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2
  return {
    x: h00 * start.x + h10 * startTangent.x + h01 * end.x + h11 * endTangent.x,
    z: h00 * start.z + h10 * startTangent.z + h01 * end.z + h11 * endTangent.z,
  }
}

function hermiteDerivative(start, end, startTangent, endTangent, t) {
  const t2 = t * t
  const h00 = 6 * t2 - 6 * t
  const h10 = 3 * t2 - 4 * t + 1
  const h01 = -6 * t2 + 6 * t
  const h11 = 3 * t2 - 2 * t
  return {
    x: h00 * start.x + h10 * startTangent.x + h01 * end.x + h11 * endTangent.x,
    z: h00 * start.z + h10 * startTangent.z + h01 * end.z + h11 * endTangent.z,
  }
}

function boundedTangent(directionSource, travelDistance) {
  if (length(directionSource) < 0.001 || travelDistance < 0.001) return { x: 0, z: 0 }
  const handleLength = Math.min(CURVE_HANDLE_MAX, travelDistance * CURVE_HANDLE_RATIO)
  return scale(normalize(directionSource), handleLength)
}

function velocityAlongCurve(derivative, startVelocity, endVelocity, t) {
  const beforeSpeed = length(startVelocity)
  const afterSpeed = length(endVelocity)
  const direction = length(derivative) > 0.001
    ? normalize(derivative)
    : afterSpeed > 0.001
      ? normalize(endVelocity)
      : beforeSpeed > 0.001
        ? normalize(startVelocity)
        : { x: 0, z: 0 }
  const speed = lerp(beforeSpeed, afterSpeed, smoothstep(t))
  return scale(direction, speed)
}

function hybridNominalPath(state, action, vectors) {
  const start = { ...state.position }
  const end = add(start, vectors.travelVector)

  if (action.kind === 'coast') {
    return {
      curveUsed: false,
      pointAt: (t) => add(start, scale(vectors.travelVector, t)),
      motionVelocityAt: () => ({ ...vectors.travelVector }),
      momentumVelocityAt: () => ({ ...vectors.momentumVelocity }),
    }
  }

  if (action.kind === 'basic') {
    const inertiaSpeed = length(state.velocity)
    const travelSpeed = length(vectors.travelVector)
    const startDirection = inertiaSpeed > 0.18 ? state.velocity : vectors.travelVector
    const turnAngle = inertiaSpeed > 0.18 && travelSpeed > 0.18 ? angleDeg(startDirection, vectors.travelVector) : 0
    const curveUsed = turnAngle > 5
    const startTangent = boundedTangent(startDirection, travelSpeed)
    const endTangent = boundedTangent(vectors.travelVector, travelSpeed)
    return {
      curveUsed,
      pointAt: curveUsed
        ? (t) => hermitePoint(start, end, startTangent, endTangent, t)
        : (t) => add(start, scale(vectors.travelVector, t)),
      motionVelocityAt: curveUsed
        ? (t) => hermiteDerivative(start, end, startTangent, endTangent, t)
        : () => ({ ...vectors.travelVector }),
      momentumVelocityAt: () => ({ ...vectors.momentumVelocity }),
    }
  }

  const beforeSpeed = length(state.velocity)
  const afterSpeed = length(vectors.momentumVelocity)
  const turnAngle = beforeSpeed > 0.18 && afterSpeed > 0.18
    ? angleDeg(state.velocity, vectors.momentumVelocity)
    : 0
  const curveUsed = turnAngle > 5
  const travelDistance = length(vectors.travelVector)
  const startTangent = curveUsed
    ? boundedTangent(state.velocity, travelDistance)
    : { ...vectors.momentumVelocity }
  const endTangent = curveUsed
    ? boundedTangent(vectors.momentumVelocity, travelDistance)
    : { ...vectors.momentumVelocity }
  return {
    curveUsed,
    pointAt: curveUsed
      ? (t) => hermitePoint(start, end, startTangent, endTangent, t)
      : (t) => add(start, scale(vectors.travelVector, t)),
    motionVelocityAt: curveUsed
      ? (t) => hermiteDerivative(start, end, startTangent, endTangent, t)
      : () => ({ ...vectors.momentumVelocity }),
    momentumVelocityAt: curveUsed
      ? (t) => velocityAlongCurve(hermiteDerivative(start, end, startTangent, endTangent, t), state.velocity, vectors.momentumVelocity, t)
      : () => ({ ...vectors.momentumVelocity }),
  }
}

function resolveObstacle(candidate, velocity, obstacle, restitution) {
  const center = axialToWorld(obstacle.hex)
  const delta = sub(candidate, center)
  const minDistance = obstacle.radius + ACTOR_RADIUS
  const distance = length(delta)
  if (distance >= minDistance) return null
  const normal = distance > 1e-6 ? scale(delta, 1 / distance) : normalize(scale(velocity, -1))
  const bounce = obstacle.kind === 'reflector' ? Math.min(0.92, restitution + 0.22) : restitution
  return {
    position: add(center, scale(normal, minDistance + 0.002)),
    velocity: reflect(velocity, normal, bounce),
    normal,
    bounce,
    collision: { kind: obstacle.kind, obstacleId: obstacle.id, normal },
  }
}

export function simulateImpulse({ state, actionId, aimPoint, config = DEFAULT_SOLVER_CONFIG, obstacles = [] }) {
  const action = actionById(actionId)
  const policy = aimPolicy(state, action, aimPoint)
  const beforeSpeed = length(state.velocity)
  if (!policy.valid) return invalidPlan(state, action, policy.reason, beforeSpeed, 'hybrid')

  const vectors = actionVectors(state, action, policy, config)
  const afterImpulseSpeed = length(vectors.momentumVelocity)
  const nominal = hybridNominalPath(state, action, vectors)
  let position = { ...state.position }
  let momentumVelocity = { ...vectors.momentumVelocity }
  let ballisticVelocity = null
  const samples = [{ t: 0, position: { ...position }, velocity: { ...state.velocity } }]
  const collisions = []
  const traversed = []
  const traversedKeys = new Set()
  const pushCell = (point) => {
    const hex = worldToAxial(point)
    const key = axialKey(hex)
    if (!traversedKeys.has(key)) {
      traversedKeys.add(key)
      traversed.push(hex)
    }
  }
  pushCell(position)

  const steps = Math.max(24, Math.round(config.steps))
  const dt = 1 / steps
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps
    let candidate
    let motionVelocity
    let sampleVelocity

    if (ballisticVelocity) {
      motionVelocity = { ...ballisticVelocity }
      candidate = add(position, scale(ballisticVelocity, dt))
      sampleVelocity = { ...momentumVelocity }
    } else {
      candidate = nominal.pointAt(t)
      motionVelocity = scale(sub(candidate, position), 1 / dt)
      sampleVelocity = action.kind === 'basic'
        ? { ...momentumVelocity }
        : nominal.momentumVelocityAt(t)
    }

    if (!isInsideBoard(candidate, config.boardRadius)) {
      const inwardNormal = normalize(scale(candidate, -1))
      const collisionVelocity = action.kind === 'basic' ? momentumVelocity : sampleVelocity
      const reflectedMotion = clampLength(reflect(collisionVelocity, inwardNormal, config.boundaryRestitution), config.maxSpeed)
      candidate = { ...position }
      if (action.kind === 'basic') {
        momentumVelocity = length(momentumVelocity) > 0.02 ? reflectedMotion : { x: 0, z: 0 }
        ballisticVelocity = { ...momentumVelocity }
      } else {
        momentumVelocity = { ...reflectedMotion }
        ballisticVelocity = { ...reflectedMotion }
      }
      sampleVelocity = { ...momentumVelocity }
      collisions.push({ t, kind: 'boundary', position: { ...position }, normal: inwardNormal })
    }

    for (const obstacle of obstacles) {
      const collisionVelocity = action.kind === 'basic' ? momentumVelocity : sampleVelocity
      const resolved = resolveObstacle(candidate, collisionVelocity, obstacle, config.restitution)
      if (!resolved) continue
      candidate = resolved.position
      const reflectedVelocity = clampLength(resolved.velocity, config.maxSpeed)
      if (action.kind === 'basic') {
        momentumVelocity = length(momentumVelocity) > 0.02 ? reflectedVelocity : { x: 0, z: 0 }
        ballisticVelocity = { ...momentumVelocity }
      } else {
        momentumVelocity = { ...reflectedVelocity }
        ballisticVelocity = { ...reflectedVelocity }
      }
      sampleVelocity = { ...momentumVelocity }
      collisions.push({ t, position: { ...candidate }, ...resolved.collision })
    }

    position = candidate
    pushCell(position)
    samples.push({ t, position: { ...position }, velocity: { ...sampleVelocity } })
  }

  if (!ballisticVelocity) momentumVelocity = { ...vectors.momentumVelocity }
  const finalSpeed = length(momentumVelocity)
  return {
    valid: true,
    reason: '',
    action,
    actionKind: action.kind,
    spatialMode: 'hybrid',
    aimAngle: policy.angle,
    impulse: vectors.impulse,
    control: vectors.control,
    samples,
    collisions,
    traversedCells: traversed,
    finalState: { position: { ...position }, velocity: { ...momentumVelocity }, worldAt: state.worldAt + 1 },
    beforeSpeed,
    afterImpulseSpeed,
    finalSpeed,
    beforeM: momentumLevel(beforeSpeed),
    finalM: momentumLevel(finalSpeed),
    curveUsed: nominal.curveUsed,
  }
}

function nearestHexDirection(vector) {
  const normalized = normalize(vector)
  let best = HEX_DIRECTIONS[0]
  let bestDot = -Infinity
  for (const direction of HEX_DIRECTIONS) {
    const world = axialToWorld({ q: direction.q, r: direction.r })
    const unit = normalize(world)
    const dot = unit.x * normalized.x + unit.z * normalized.z
    if (dot > bestDot) {
      bestDot = dot
      best = direction
    }
  }
  return best
}

function obstacleAt(obstacles, hex) {
  return obstacles.find((entry) => entry.hex.q === hex.q && entry.hex.r === hex.r) ?? null
}

export function simulateDiscreteImpulse({ state, actionId, aimPoint, config = DEFAULT_SOLVER_CONFIG, obstacles = [] }) {
  const action = actionById(actionId)
  const policy = aimPolicy(state, action, aimPoint)
  const beforeSpeed = length(state.velocity)
  if (!policy.valid) return invalidPlan(state, action, policy.reason, beforeSpeed, 'discrete')

  const vectors = actionVectors(state, action, policy, config)
  const afterImpulseSpeed = length(vectors.momentumVelocity)
  let momentumVelocity = { ...vectors.momentumVelocity }
  let motionVelocity = { ...vectors.travelVector }
  const movementSteps = action.kind === 'basic'
    ? Math.max(1, Math.min(4, Math.round(length(motionVelocity))))
    : momentumLevel(afterImpulseSpeed)

  let cell = worldToAxial(state.position)
  const startPosition = axialToWorld(cell)
  const samples = [{ t: 0, position: startPosition, velocity: { ...state.velocity } }]
  const traversed = [{ ...cell }]
  const collisions = []

  if (movementSteps > 0 && length(motionVelocity) > 0.001) {
    let direction = nearestHexDirection(motionVelocity)
    for (let index = 1; index <= movementSteps; index += 1) {
      let next = { q: cell.q + direction.q, r: cell.r + direction.r }
      let obstacle = obstacleAt(obstacles, next)
      const outOfBounds = axialDistance(next) > config.boardRadius
      if (obstacle || outOfBounds) {
        const bounce = obstacle?.kind === 'reflector'
          ? Math.min(0.92, config.restitution + 0.22)
          : outOfBounds
            ? config.boundaryRestitution
            : config.restitution
        motionVelocity = scale(motionVelocity, -bounce)
        direction = nearestHexDirection(motionVelocity)
        if (action.kind === 'basic') {
          momentumVelocity = length(momentumVelocity) > 0.02
            ? scale(momentumVelocity, -bounce)
            : { x: 0, z: 0 }
        } else {
          momentumVelocity = clampLength(motionVelocity, config.maxSpeed)
        }
        collisions.push({
          t: index / movementSteps,
          kind: outOfBounds ? 'boundary' : obstacle.kind,
          obstacleId: obstacle?.id,
          position: axialToWorld(cell),
          cell: { ...next },
        })
        next = { q: cell.q + direction.q, r: cell.r + direction.r }
        obstacle = obstacleAt(obstacles, next)
        if (axialDistance(next) > config.boardRadius || obstacle) {
          samples.push({ t: index / movementSteps, position: axialToWorld(cell), velocity: { ...momentumVelocity } })
          continue
        }
      }
      cell = next
      traversed.push({ ...cell })
      samples.push({ t: index / movementSteps, position: axialToWorld(cell), velocity: { ...momentumVelocity } })
    }
  }

  const finalSpeed = length(momentumVelocity)
  return {
    valid: true,
    reason: '',
    action,
    actionKind: action.kind,
    spatialMode: 'discrete',
    aimAngle: policy.angle,
    impulse: vectors.impulse,
    control: vectors.control,
    samples,
    collisions,
    traversedCells: traversed,
    finalState: { position: axialToWorld(cell), velocity: { ...momentumVelocity }, worldAt: state.worldAt + 1 },
    beforeSpeed,
    afterImpulseSpeed,
    finalSpeed,
    beforeM: momentumLevel(beforeSpeed),
    finalM: momentumLevel(finalSpeed),
    curveUsed: false,
  }
}

export function simulateSpatial({ spatialMode = 'hybrid', ...input }) {
  return spatialMode === 'discrete' ? simulateDiscreteImpulse(input) : simulateImpulse(input)
}

export function playbackElapsedMs(playback, now = performance.now()) {
  if (!playback) return 0
  const end = playback.pausedAt ?? now
  return Math.max(0, end - playback.startedAt - (playback.pausedTotal ?? 0))
}

export function planSummary(plan) {
  if (!plan.valid) return plan.reason
  const collision = plan.collisions.length > 0
    ? ` · ${plan.collisions.length} collision${plan.collisions.length > 1 ? 's' : ''}`
    : ''
  const space = plan.spatialMode === 'discrete' ? 'Discrete' : 'Hybrid'
  if (plan.actionKind === 'basic') {
    return `${space} · Basic Move · M${plan.beforeM} → M${plan.finalM} persistent · ${plan.traversedCells.length} cells touched${plan.curveUsed ? ' · curved blend' : ''}${collision}`
  }
  return `${space} · ${plan.action.label} · M${plan.beforeM} → M${plan.finalM} · speed ${plan.beforeSpeed.toFixed(2)} → ${plan.finalSpeed.toFixed(2)} · ${plan.traversedCells.length} cells touched${plan.curveUsed ? ' · curved blend' : ''}${collision}`
}
