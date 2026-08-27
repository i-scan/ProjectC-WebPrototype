import { describe, expect, it } from 'vitest'
import { axialToWorld, directionVector } from './hex.js'
import { momentumLevel, momentumSpeed } from './solver.js'
import {
  CURRENT_M_TRAVEL_RULE,
  REFLECTED_ACTOR_CONFLICT_RULE,
  REFLECTED_CONTACT_PLAYBACK_RULE,
  resolveCellConflicts,
} from './conflict.js'

const nsWallAt = (q, r) => ({ id: `wall-${q}-${r}`, hex: { q, r }, kind: 'hard', wallAxis: 'NS', radius: 0.34 })

function velocityFor(axisId, level) {
  const direction = directionVector(axisId)
  const speed = momentumSpeed(level)
  return { x: direction.x * speed, z: direction.z * speed }
}

function manualPlan({ from, contact, axisId = 'SW', level = 3, finalM = 2 }) {
  return {
    valid: true,
    action: { id: 'basic-move', label: 'Basic Move', kind: 'basic' },
    actionKind: 'basic',
    spatialMode: 'discrete',
    samples: [
      { t: 0, position: axialToWorld(from), velocity: velocityFor(axisId, level), axisId },
      { t: 1, position: axialToWorld(contact), velocity: velocityFor(axisId, finalM), axisId },
    ],
    collisions: [],
    traversedCells: [from, contact],
    finalState: {
      position: axialToWorld(contact),
      velocity: velocityFor(axisId, finalM),
      axisId,
      worldAt: 1,
    },
    beforeSpeed: momentumSpeed(level),
    afterImpulseSpeed: momentumSpeed(level),
    finalSpeed: momentumSpeed(finalM),
    beforeM: level,
    finalM,
    axisBefore: axisId,
    axisAfter: axisId,
  }
}

describe('reflected Actor remaining travel', () => {
  it('caps post-contact travel by the reflected source current M instead of the original M3 budget', () => {
    const plan = manualPlan({
      from: { q: 2, r: -2 },
      contact: { q: 1, r: -1 },
      axisId: 'SW',
      level: 3,
      finalM: 2,
    })
    const resolved = resolveCellConflicts({
      plan,
      actors: [
        { id: 'a', label: 'A', hex: { q: 1, r: -1 }, velocity: { x: 0, z: 0 }, axisId: null },
        { id: 'b', label: 'B', hex: { q: 0, r: 1 }, velocity: { x: 0, z: 0 }, axisId: null },
      ],
      obstacles: [nsWallAt(0, 0)],
      boardRadius: 7,
      surfaceRestitution: 0.58,
      boundaryRestitution: 0.42,
    })

    const reflectedTransfers = resolved.conflictEvents.filter((event) => (
      event.kind === 'momentum-transfer'
      && event.sourceActorId === 'a'
      && event.targetActorId === 'b'
      && event.model === REFLECTED_ACTOR_CONFLICT_RULE
    ))
    expect(reflectedTransfers).toHaveLength(1)
    expect(reflectedTransfers[0]).toMatchObject({
      sourceBeforeM: 2,
      sourceAfterM: 1,
      targetAfterM: 2,
      reflectedSource: true,
    })

    const byId = Object.fromEntries(resolved.actorStates.map((actor) => [actor.id, actor]))
    expect(byId.a.hex).toEqual({ q: 0, r: 2 })
    expect(byId.b.hex).toEqual({ q: 0, r: 3 })
    expect(momentumLevel(Math.hypot(byId.a.velocity.x, byId.a.velocity.z))).toBe(1)

    expect(resolved.actorTrajectories.a.at(-1)).toEqual({ q: 0, r: 2 })
    expect(resolved.actorTrajectories.a).not.toContainEqual({ q: 0, r: 3 })
    expect(resolved.actorTrajectories.b).toEqual([
      { q: 0, r: 1 },
      { q: 0, r: 2 },
      { q: 0, r: 3 },
    ])
    expect(resolved.travelBudgetRule).toBe(CURRENT_M_TRAVEL_RULE)
    expect(resolved.reflectedContactPlaybackRule).toBe(REFLECTED_CONTACT_PLAYBACK_RULE)

    const aWindow = resolved.actorPlaybackWindows.a
    const bWindow = resolved.actorPlaybackWindows.b
    expect(aWindow).toBeTruthy()
    expect(bWindow).toBeTruthy()
    expect(bWindow.start - aWindow.start).toBeLessThan(0.08)
    expect(bWindow.start).toBeLessThan(aWindow.end)
  })
})
