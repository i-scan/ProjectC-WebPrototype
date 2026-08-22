import { HEX_DIRECTIONS, axialDistance, axialKey, axialToWorld, isInsideBoard, worldToAxial } from './hex.js'
import { add, angleDeg, clampLength, length, normalize, reflect, scale, sub } from './vector.js'

export const AT_VISUAL_MS = 800
export const SOLVER_STEPS = 120
export const MAX_SPEED = 3.2
export const ACTOR_RADIUS = 0.16

export const ACTIONS = [
  { id: 'drive', label: 'Drive', short: '推进', force: 0.85, aimWindow: 80, description: '沿当前速度附近施加冲量；静止时可向任意 Cell 起步。' },
  { id: 'heavy-drive', label: 'Heavy Drive', short: '重推进', force: 1.35, aimWindow: 65, description: '更强推进冲量，更快建立速度，也更难修正。' },
  { id: 'counter', label: 'Counter Impulse', short: '反冲', force: 0.9, aimWindow: 70, description: '朝当前速度反方向附近施力，用于主动减速或反向。' },
  { id: 'hard-turn', label: 'Hard Turn', short: '急转', force: 0.75, aimWindow: 140, description: '允许更大的偏转角，但单位冲量较低。' },
  { id: 'coast', label: 'Coast', short: '滑行', force: 0, aimWindow: 0, description: '不施加新力；完整保留当前速度完成 1 AT。' },
]

export const DEFAULT_SOLVER_CONFIG = Object.freeze({
  boardRadius: 7,
  restitution: 0.58,
  boundaryRestitution: 0.42,
  steps: SOLVER_STEPS,
  maxSpeed: MAX_SPEED,
})

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
  return ACTIONS.find((action) => action.id === id) ?? ACTIONS[0]
}

function aimPolicy(state, action, aimPoint) {
  const speed = length(state.velocity)
  if (action.id === 'coast') {
    return speed < 0.18
      ? { valid: false, reason: 'Coast requires existing velocity.', direction: { x: 0, z: 0 }, angle: 0 }
      : { valid: true, reason: '', direction: normalize(state.velocity), angle: 0 }
  }
  if (!aimPoint) return { valid: false, reason: 'Hover a board Cell to preview the impulse.', direction: { x: 0, z: 0 }, angle: 0 }
  const aimVector = sub(aimPoint, state.position)
  const direction = normalize(aimVector)
  if (length(direction) < 0.5) return { valid: false, reason: 'Choose a different Cell to define aim.', direction, angle: 0 }
  if (speed < 0.18) {
    if (action.id === 'counter') return { valid: false, reason: 'Counter Impulse requires existing velocity.', direction, angle: 180 }
    return { valid: true, reason: '', direction, angle: 0 }
  }
  const reference = action.id === 'counter' ? scale(state.velocity, -1) : state.velocity
  const angle = angleDeg(reference, direction)
  return angle <= action.aimWindow
    ? { valid: true, reason: '', direction, angle }
    : { valid: false, reason: `${action.label} aim is ${angle.toFixed(0)}° outside its ${action.aimWindow}° steering window.`, direction, angle }
}

function invalidPlan(state, action, reason, beforeSpeed, spatialMode) {
  return {
    valid: false,
    reason,
    action,
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
    collision: { kind: obstacle.kind, obstacleId: obstacle.id, normal },
  }
}

export function simulateImpulse({ state, actionId, aimPoint, config = DEFAULT_SOLVER_CONFIG, obstacles = [] }) {
  const action = actionById(actionId)
  const policy = aimPolicy(state, action, aimPoint)
  const beforeSpeed = length(state.velocity)
  if (!policy.valid) return invalidPlan(state, action, policy.reason, beforeSpeed, 'hybrid')

  const impulse = action.force === 0 ? { x: 0, z: 0 } : scale(policy.direction, action.force)
  let velocity = clampLength(add(state.velocity, impulse), config.maxSpeed)
  const afterImpulseSpeed = length(velocity)
  let position = { ...state.position }
  const samples = [{ t: 0, position: { ...position }, velocity: { ...velocity } }]
  const collisions = []
  const traversed = []
  const traversedKeys = new Set()
  const pushCell = (point) => {
    const hex = worldToAxial(point)
    const key = axialKey(hex)
    if (!traversedKeys.has(key)) { traversedKeys.add(key); traversed.push(hex) }
  }
  pushCell(position)

  const steps = Math.max(24, Math.round(config.steps))
  const dt = 1 / steps
  for (let index = 1; index <= steps; index += 1) {
    let candidate = add(position, scale(velocity, dt))
    if (!isInsideBoard(candidate, config.boardRadius)) {
      const inwardNormal = normalize(scale(candidate, -1))
      velocity = reflect(velocity, inwardNormal, config.boundaryRestitution)
      candidate = { ...position }
      collisions.push({ t: index / steps, kind: 'boundary', position: { ...position }, normal: inwardNormal })
    }
    for (const obstacle of obstacles) {
      const resolved = resolveObstacle(candidate, velocity, obstacle, config.restitution)
      if (!resolved) continue
      candidate = resolved.position
      velocity = resolved.velocity
      collisions.push({ t: index / steps, position: { ...candidate }, ...resolved.collision })
    }
    position = candidate
    pushCell(position)
    samples.push({ t: index / steps, position: { ...position }, velocity: { ...velocity } })
  }

  const finalSpeed = length(velocity)
  return {
    valid: true, reason: '', action, spatialMode: 'hybrid', aimAngle: policy.angle, impulse,
    samples, collisions, traversedCells: traversed,
    finalState: { position: { ...position }, velocity: { ...velocity }, worldAt: state.worldAt + 1 },
    beforeSpeed, afterImpulseSpeed, finalSpeed,
    beforeM: momentumLevel(beforeSpeed), finalM: momentumLevel(finalSpeed),
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
    if (dot > bestDot) { bestDot = dot; best = direction }
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

  const impulse = action.force === 0 ? { x: 0, z: 0 } : scale(policy.direction, action.force)
  let velocity = clampLength(add(state.velocity, impulse), config.maxSpeed)
  const afterImpulseSpeed = length(velocity)
  let movementM = momentumLevel(afterImpulseSpeed)
  if (movementM === 0 && action.force > 0) movementM = 1

  let cell = worldToAxial(state.position)
  let direction = nearestHexDirection(velocity)
  const startPosition = axialToWorld(cell)
  const samples = [{ t: 0, position: startPosition, velocity: { ...velocity } }]
  const traversed = [{ ...cell }]
  const collisions = []
  const totalSteps = Math.max(1, movementM)

  for (let index = 1; index <= totalSteps; index += 1) {
    let next = { q: cell.q + direction.q, r: cell.r + direction.r }
    let obstacle = obstacleAt(obstacles, next)
    const outOfBounds = axialDistance(next) > config.boardRadius
    if (obstacle || outOfBounds) {
      const bounce = obstacle?.kind === 'reflector' ? Math.min(0.92, config.restitution + 0.22) : outOfBounds ? config.boundaryRestitution : config.restitution
      velocity = scale(velocity, -bounce)
      direction = nearestHexDirection(velocity)
      collisions.push({
        t: index / totalSteps,
        kind: outOfBounds ? 'boundary' : obstacle.kind,
        obstacleId: obstacle?.id,
        position: axialToWorld(cell),
        cell: { ...next },
      })
      next = { q: cell.q + direction.q, r: cell.r + direction.r }
      obstacle = obstacleAt(obstacles, next)
      if (axialDistance(next) > config.boardRadius || obstacle) {
        samples.push({ t: index / totalSteps, position: axialToWorld(cell), velocity: { ...velocity } })
        continue
      }
    }
    cell = next
    traversed.push({ ...cell })
    samples.push({ t: index / totalSteps, position: axialToWorld(cell), velocity: { ...velocity } })
  }

  const finalSpeed = length(velocity)
  return {
    valid: true, reason: '', action, spatialMode: 'discrete', aimAngle: policy.angle, impulse,
    samples, collisions, traversedCells: traversed,
    finalState: { position: axialToWorld(cell), velocity: { ...velocity }, worldAt: state.worldAt + 1 },
    beforeSpeed, afterImpulseSpeed, finalSpeed,
    beforeM: momentumLevel(beforeSpeed), finalM: momentumLevel(finalSpeed),
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
  const collision = plan.collisions.length > 0 ? ` · ${plan.collisions.length} collision${plan.collisions.length > 1 ? 's' : ''}` : ''
  const space = plan.spatialMode === 'discrete' ? 'Discrete' : 'Hybrid'
  return `${space} · M${plan.beforeM} → M${plan.finalM} · speed ${plan.beforeSpeed.toFixed(2)} → ${plan.finalSpeed.toFixed(2)} · ${plan.traversedCells.length} cells touched${collision}`
}
