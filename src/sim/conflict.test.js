import { describe, expect, it } from 'vitest'
import { axialToWorld, directionVector } from './hex.js'
import { momentumLevel, momentumSpeed } from './solver.js'
import { simulateBasicMoveRule } from './spatial-rules.js'
import {
  ACTOR_COLLISION_RESTITUTION,
  STRIKE_RULE,
  createConflictActors,
  exchangeActorMomentum,
  resolveCellConflicts,
} from './conflict.js'

function stateAt(hex, level = 0, axisId = level > 0 ? 'E' : null) {
  const direction = axisId ? directionVector(axisId) : { x: 0, z: 0 }
  const speed = momentumSpeed(level)
  return {
    position: axialToWorld(hex),
    velocity: { x: direction.x * speed, z: direction.z * speed },
    axisId,
    worldAt: 0,
  }
}

function basicPlan(state, landingHex, obstacles = []) {
  return simulateBasicMoveRule({
    spatialMode: 'discrete',
    state,
    aimPoint: axialToWorld(landingHex),
    obstacles,
  })
}

function manualContactPlan({ from = { q: 0, r: 0 }, contact = { q: 1, r: 0 }, level = 3, finalM = 2 } = {}) {
  const delta = { q: contact.q - from.q, r: contact.r - from.r }
  const directionId = delta.q === 1 && delta.r === 0 ? 'E'
    : delta.q === 0 && delta.r === 1 ? 'SE'
      : 'E'
  return {
    valid: true,
    action: { id: 'basic-move', label: 'Basic Move', kind: 'basic' },
    actionKind: 'basic',
    spatialMode: 'discrete',
    samples: [
      { t: 0, position: axialToWorld(from), velocity: velocityForLevel(level, directionId), axisId: directionId },
      { t: 1, position: axialToWorld(contact), velocity: velocityForLevel(finalM, directionId), axisId: directionId },
    ],
    collisions: [],
    traversedCells: [from, contact],
    finalState: {
      position: axialToWorld(contact),
      velocity: velocityForLevel(finalM, directionId),
      axisId: directionId,
      worldAt: 1,
    },
    beforeSpeed: momentumSpeed(level),
    afterImpulseSpeed: momentumSpeed(level),
    finalSpeed: momentumSpeed(finalM),
    beforeM: level,
    finalM,
    axisBefore: directionId,
    axisAfter: directionId,
  }
}

function velocityForLevel(level, axisId = 'E') {
  const direction = directionVector(axisId)
  const speed = momentumSpeed(level)
  return { x: direction.x * speed, z: direction.z * speed }
}

function integerPathAfterStart(path) {
  return path.slice(1).filter((point) => Number.isInteger(point.q) && Number.isInteger(point.r))
}

describe('Spatial Inertia v1 Contact / Forced Move', () => {
  it('keeps the legacy equal-mass helper available only as a comparison utility', () => {
    const exchange = exchangeActorMomentum({
      sourceM: 2,
      targetVelocity: { x: 0, z: 0 },
      directionId: 'E',
    })
    expect(exchange.restitution).toBe(ACTOR_COLLISION_RESTITUTION)
    expect(exchange.sourceAfterM).toBe(1)
    expect(exchange.targetAfterM).toBe(2)
  })

  it('blocks M0 Strike from entering an occupied Cell without inventing Forced Move', () => {
    const state = stateAt({ q: 0, r: 0 }, 0)
    const plan = basicPlan(state, { q: 1, r: 0 })
    const resolved = resolveCellConflicts({
      plan,
      actors: [{ id: 'dummy', label: 'A', hex: { q: 1, r: 0 }, velocity: { x: 0, z: 0 }, axisId: null }],
      obstacles: [],
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({ impactM: 0, resolved: false, contactBehavior: 'Strike' })
    expect(resolved.traversedCells).toEqual([{ q: 0, r: 0 }])
    expect(resolved.actorStates[0].hex).toEqual({ q: 1, r: 0 })
    expect(resolved.finalM).toBe(0)
  })

  it('uses M1 after the first successful M2 Travel and resolves later Contact as direct Strike transfer', () => {
    const state = stateAt({ q: 0, r: 1 }, 2, 'E')
    const plan = basicPlan(state, { q: 2, r: 1 })
    const resolved = resolveCellConflicts({
      plan,
      actors: createConflictActors('chain'),
      obstacles: [],
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({
      targetActorId: 'dummy-a',
      impactM: 1,
      resolved: true,
      contactBehavior: 'Strike',
      resolution: STRIKE_RULE,
      momentumExchange: {
        sourceBeforeM: 1,
        sourceAfterM: 0,
        targetBeforeM: 0,
        targetAfterM: 1,
      },
    })
    expect(resolved.traversedCells.at(-1)).toEqual({ q: 2, r: 1 })
    expect(Object.fromEntries(resolved.actorStates.map((actor) => [actor.id, actor.hex]))).toEqual({
      'dummy-a': { q: 3, r: 1 },
      'dummy-b': { q: 4, r: 1 },
      'dummy-c': { q: 5, r: 1 },
    })
    expect(resolved.actorTrajectories['dummy-a']).toEqual([{ q: 2, r: 1 }, { q: 3, r: 1 }])
    expect(resolved.finalM).toBe(0)
  })

  it('uses direct Strike M2 for a manual adjacent Contact and preserves wall-face geometry on the Forced target', () => {
    const obstacles = [{ id: 'wall', hex: { q: 3, r: 0 }, radius: 0.34, kind: 'hard' }]
    const plan = manualContactPlan({ from: { q: 0, r: 0 }, contact: { q: 1, r: 0 }, level: 2, finalM: 1 })
    const resolved = resolveCellConflicts({
      plan,
      actors: createConflictActors('wall'),
      obstacles,
      boardRadius: 7,
    })

    expect(resolved.cellConflict).toMatchObject({ targetActorId: 'dummy-a', impactM: 2, resolved: true })
    expect(resolved.cellConflict.momentumExchange).toMatchObject({ sourceBeforeM: 2, sourceAfterM: 0, targetAfterM: 2 })
    expect(resolved.finalM).toBe(0)
    expect(resolved.actorTrajectories['dummy-a'][0]).toEqual({ q: 1, r: 0 })
    expect(resolved.actorTrajectories['dummy-a']).toContainEqual({ q: 2, r: 0 })
    expect(resolved.actorTrajectories['dummy-a'].some((point) => !Number.isInteger(point.q) || !Number.isInteger(point.r))).toBe(true)
    expect(integerPathAfterStart(resolved.actorTrajectories['dummy-a'])).not.toContainEqual({ q: 1, r: 0 })
    const bounce = resolved.conflictEvents.find((event) => event.kind === 'surface-reflection' && event.actorId === 'dummy-a')
    expect(bounce).toBeTruthy()
    expect(bounce.axisBefore).toBe('E')
    expect(['NW', 'SW']).toContain(bounce.axisAfter)
    expect(bounce.directMomentumLoss).toBe(false)
  })

  it('records wall contact after Forced Use with no extra wall Momentum loss', () => {
    const plan = manualContactPlan()
    const actors = [{ id: 'dummy', label: 'A', hex: { q: 1, r: 0 }, velocity: { x: 0, z: 0 }, axisId: null }]
    const obstacles = [{ id: 'wall', hex: { q: 4, r: 0 }, radius: 0.34, kind: 'hard' }]
    const resolved = resolveCellConflicts({ plan, actors, obstacles, boardRadius: 7 })

    const bounce = resolved.conflictEvents.find((event) => event.kind === 'surface-reflection')
    expect(bounce).toMatchObject({
      obstacleKind: 'hard',
      axisBefore: 'E',
      beforeM: 2,
      afterM: 2,
      surfaceGeometry: 'clipped-cell-mirror-v2',
      reflectionContinuation: 'contact-ray-step-budget-v3',
      directMomentumLoss: false,
    })
    expect(['NW', 'SW']).toContain(bounce.axisAfter)
    expect(resolved.actorTrajectories.dummy.some((point) => !Number.isInteger(point.q) || !Number.isInteger(point.r))).toBe(true)
    expect(resolved.actorStates[0].momentumLevel).toBe(2)
  })

  it('reflects a Forced target from a side boundary without swapping it behind the player', () => {
    const plan = manualContactPlan({ from: { q: 1, r: -1 }, contact: { q: 2, r: -1 }, level: 3, finalM: 2 })
    const actors = [{ id: 'dummy', label: 'A', hex: { q: 2, r: -1 }, velocity: { x: 0, z: 0 }, axisId: null }]
    const resolved = resolveCellConflicts({ plan, actors, obstacles: [], boardRadius: 3 })

    const bounce = resolved.conflictEvents.find((event) => event.kind === 'surface-reflection')
    expect(bounce).toMatchObject({
      obstacleKind: 'boundary',
      geometryKind: 'boundary',
      axisBefore: 'E',
      axisAfter: 'SW',
      surfaceGeometry: 'clipped-cell-mirror-v2',
      reflectionContinuation: 'contact-ray-step-budget-v3',
      directMomentumLoss: false,
    })
    expect(resolved.actorStates[0].hex).not.toEqual({ q: 1, r: -1 })
    expect(resolved.actorStates[0].hex).not.toEqual({ q: 0, r: -1 })
  })

  it('leaves a no-contact discrete plan unchanged apart from attached actor state', () => {
    const state = stateAt({ q: 0, r: 0 }, 1, 'E')
    const plan = basicPlan(state, { q: 1, r: 0 })
    const actors = createConflictActors('chain')
    const resolved = resolveCellConflicts({ plan, actors, obstacles: [], boardRadius: 7 })

    expect(resolved.cellConflict).toBeUndefined()
    expect(resolved.finalState.position).toEqual(plan.finalState.position)
    expect(resolved.finalM).toBe(plan.finalM)
    expect(resolved.finalState.actors).toHaveLength(3)
    expect(momentumLevel(Math.hypot(resolved.finalState.velocity.x, resolved.finalState.velocity.z))).toBe(plan.finalM)
  })
})
