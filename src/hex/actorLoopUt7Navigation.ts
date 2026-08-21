import { actorAt, cellAt, getPlayer, type Coord } from '../game'
import {
  axisLabel,
  createSpatialState,
  type ActionPlan,
  type SteeringAtTrace,
  type Ut7Settings,
  type Ut7State,
} from './actorLoopUt7'
import { basicMovePlansForTarget, basicMoveTargetCoords } from './actorLoopUt7BasicMove'
import { getHexNeighbors, hexDistance } from './hexTopology'

const clone = <T>(value: T): T => structuredClone(value)
const sameCoord = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y
const keyOf = (coord: Coord) => `${coord.x},${coord.y}`

function traversableForNavigation(state: Ut7State, coord: Coord) {
  const cell = cellAt(state.game, coord)
  if (!cell || cell.tags.some((tag) => tag === 'Void' || tag === 'Blocked' || tag === 'Mountain')) return false
  const occupant = actorAt(state.game, coord)
  return !occupant || occupant.id === 'player'
}

function staticDistanceMap(state: Ut7State, target: Coord) {
  const distances = new Map<string, number>()
  const queue: Coord[] = []
  if (!traversableForNavigation(state, target)) return distances
  distances.set(keyOf(target), 0)
  queue.push(clone(target))

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]
    const distance = distances.get(keyOf(current)) ?? 0
    for (const entry of getHexNeighbors(current)) {
      const next = entry.coord
      const nextKey = keyOf(next)
      if (distances.has(nextKey) || !traversableForNavigation(state, next)) continue
      distances.set(nextKey, distance + 1)
      queue.push(clone(next))
    }
  }
  return distances
}

function thermalBucket(value: number) {
  return Math.round(value * 4) / 4
}

function planningStateKey(state: Ut7State) {
  const player = getPlayer(state.game)
  const spatial = state.spatialByActorId.player ?? createSpatialState()
  const continuity = state.continuityByActorId.player ?? { axis: null, streak: 0 }
  return [
    player.position.x,
    player.position.y,
    spatial.level,
    axisLabel(spatial.axis),
    axisLabel(continuity.axis),
    Math.min(3, continuity.streak),
    thermalBucket(state.thermal.temperature),
    thermalBucket(state.thermal.drift),
  ].join('|')
}

function invalidNavigationPlan(input: Ut7State, target: Coord, reason: string): ActionPlan {
  return {
    id: 'basic-move',
    label: 'Basic Move',
    valid: false,
    reason,
    atCost: 0,
    summary: `Target (${target.x},${target.y}) · ${reason}`,
    path: [],
    timeline: [],
    result: clone(input),
  }
}

type SearchNode = {
  state: Ut7State
  g: number
  h: number
  parent?: SearchNode
  via?: ActionPlan
}

class MinHeap {
  private values: SearchNode[] = []

  get size() { return this.values.length }

  push(node: SearchNode) {
    this.values.push(node)
    let index = this.values.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.compare(this.values[parent], this.values[index]) <= 0) break
      ;[this.values[parent], this.values[index]] = [this.values[index], this.values[parent]]
      index = parent
    }
  }

  pop() {
    if (this.values.length === 0) return undefined
    const first = this.values[0]
    const last = this.values.pop()!
    if (this.values.length > 0) {
      this.values[0] = last
      let index = 0
      while (true) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index
        if (left < this.values.length && this.compare(this.values[left], this.values[smallest]) < 0) smallest = left
        if (right < this.values.length && this.compare(this.values[right], this.values[smallest]) < 0) smallest = right
        if (smallest === index) break
        ;[this.values[index], this.values[smallest]] = [this.values[smallest], this.values[index]]
        index = smallest
      }
    }
    return first
  }

  private compare(left: SearchNode, right: SearchNode) {
    const leftScore = left.g + left.h
    const rightScore = right.g + right.h
    return leftScore - rightScore || left.h - right.h || left.g - right.g
  }
}

function aggregateNavigationPlan(input: Ut7State, target: Coord, goal: SearchNode): ActionPlan {
  const edges: ActionPlan[] = []
  let cursor: SearchNode | undefined = goal
  while (cursor?.via) {
    edges.push(cursor.via)
    cursor = cursor.parent
  }
  edges.reverse()

  const path = edges.flatMap((edge) => edge.path.map(clone))
  const timeline: SteeringAtTrace[] = edges.flatMap((edge, edgeIndex) =>
    edge.timeline.map((trace) => ({ ...clone(trace), atIndex: edgeIndex + 1 })),
  )
  const beforeSpatial = input.spatialByActorId.player ?? createSpatialState()
  const afterSpatial = goal.state.spatialByActorId.player ?? createSpatialState()

  return {
    id: 'basic-move',
    label: 'Basic Move',
    valid: true,
    reason: '',
    atCost: edges.length,
    summary: `Target (${target.x},${target.y}) · ${edges.length} AT · ${path.length} Cell-step${path.length === 1 ? '' : 's'} · ${axisLabel(beforeSpatial.axis)} M${beforeSpatial.level} → ${axisLabel(afterSpatial.axis)} M${afterSpatial.level}`,
    path,
    timeline,
    result: clone(goal.state),
  }
}

/**
 * Resolve one click as a complete route to a final Target Cell.
 *
 * The planner does not bypass inertia. Each graph edge is one ordinary 1 AT
 * Basic Move resolved by actorLoopUt7BasicMove, including M spend, 60°/cell
 * redirects, Down breakaway, thermal settlement, collisions and branch choice.
 * A* only decides which local Steering Intent to issue on each AT.
 */
export function basicMoveNavigationPlan(input: Ut7State, target: Coord, settings: Ut7Settings): ActionPlan {
  const player = getPlayer(input.game)
  if (sameCoord(player.position, target)) return invalidNavigationPlan(input, target, 'Already at target')
  if (!traversableForNavigation(input, target)) return invalidNavigationPlan(input, target, 'Target Cell is blocked or occupied')

  const staticDistances = staticDistanceMap(input, target)
  const startStaticDistance = staticDistances.get(keyOf(player.position))
  if (startStaticDistance === undefined) return invalidNavigationPlan(input, target, 'No terrain route to Target Cell')

  const heuristic = (state: Ut7State) => {
    const position = getPlayer(state.game).position
    const staticDistance = staticDistances.get(keyOf(position)) ?? hexDistance(position, target)
    return Math.ceil(staticDistance / 2)
  }

  const open = new MinHeap()
  const start: SearchNode = { state: clone(input), g: 0, h: heuristic(input) }
  open.push(start)
  const bestCost = new Map<string, number>([[planningStateKey(start.state), 0]])

  // Safety against malformed rules creating an unbounded state graph. This is
  // deliberately an expansion guard, not a gameplay max-AT rule.
  const expansionGuard = Math.max(8192, input.game.cells.length * 128)
  let expansions = 0

  while (open.size > 0 && expansions < expansionGuard) {
    const current = open.pop()!
    const currentKey = planningStateKey(current.state)
    if (current.g > (bestCost.get(currentKey) ?? Number.POSITIVE_INFINITY)) continue
    if (sameCoord(getPlayer(current.state.game).position, target)) return aggregateNavigationPlan(input, target, current)
    expansions += 1

    const intents = basicMoveTargetCoords(current.state, settings)
      .sort((left, right) => {
        const leftDistance = staticDistances.get(keyOf(left)) ?? hexDistance(left, target)
        const rightDistance = staticDistances.get(keyOf(right)) ?? hexDistance(right, target)
        return leftDistance - rightDistance
      })

    for (const intent of intents) {
      const oneAtPlans = basicMovePlansForTarget(current.state, intent, settings)
      for (const oneAt of oneAtPlans) {
        if (!oneAt.valid || oneAt.atCost !== 1) continue
        const nextPosition = getPlayer(oneAt.result.game).position
        if (!staticDistances.has(keyOf(nextPosition))) continue
        const nextG = current.g + 1
        const nextKey = planningStateKey(oneAt.result)
        if (nextG >= (bestCost.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue
        bestCost.set(nextKey, nextG)
        open.push({
          state: oneAt.result,
          g: nextG,
          h: heuristic(oneAt.result),
          parent: current,
          via: oneAt,
        })
      }
    }
  }

  return invalidNavigationPlan(
    input,
    target,
    expansions >= expansionGuard
      ? 'Navigation search exhausted its internal safety guard'
      : 'No inertia-valid route to Target Cell',
  )
}

export function basicMoveNavigationTargetCoords(input: Ut7State): Coord[] {
  const player = getPlayer(input.game)
  const reachable = staticDistanceMap(input, player.position)
  return input.game.cells
    .map((cell) => clone(cell.coord))
    .filter((coord) => !sameCoord(coord, player.position))
    .filter((coord) => reachable.has(keyOf(coord)))
    .filter((coord) => traversableForNavigation(input, coord))
}
