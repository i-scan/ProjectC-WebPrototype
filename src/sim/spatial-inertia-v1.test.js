import { describe, expect, it } from 'vitest'
import { axialToWorld, directionVector } from './hex.js'
import { momentumSpeed } from './solver.js'
import {
  DRIVE_BUILD_RULE,
  SPATIAL_INERTIA_RULE,
  simulateBasicMoveRule,
  simulateDriveRule,
} from './spatial-rules.js'
import {
  HEX_LOOKUP_COMPOSITION,
  TRUE_VECTOR_COMPOSITION,
  composeIncomingMomentum,
  resolveCellConflicts,
} from './conflict.js'

function stateAt(hex, level = 0, axisId = level > 0 ? 'E' : null) {
  const direction = axisId ? directionVector(axisId) : { x: 0, z: 0 }
  const speed = momentumSpeed(Math.min(3, level))
  return {
    position: axialToWorld(hex),
    velocity: axisId ? { x: direction.x * speed, z: direction.z * speed } : { x: 0, z: 0 },
    axisId,
    worldAt: 0,
  }
}

function actor(id, hex, level = 0, axisId = null) {
  const direction = axisId ? directionVector(axisId) : { x: 0, z: 0 }
  const speed = momentumSpeed(Math.min(3, level))
  return {
    id,
    label: id,
    hex,
    axisId,
    momentumLevel: level,
    velocity: axisId ? { x: direction.x * speed, z: direction.z * speed } : { x: 0, z: 0 },
  }
}

function basic(state, landing, obstacles = []) {
  return simulateBasicMoveRule({
    spatialMode: 'discrete',
    state,
    aimPoint: axialToWorld(landing),
    obstacles,
  })
}

function drive(state, landing, obstacles = []) {
  return simulateDriveRule({
    spatialMode: 'discrete',
    state,
    aimPoint: axialToWorld(landing),
    obstacles,
  })
}

describe('VAL-012 Spatial Inertia v1', () => {
  it('uses the canonical M0/M1/M2/M3 initiative travel scale and low-M startup rules', () => {
    const m0Free = basic(stateAt({ q: 0, r: 0 }, 0, null), { q: 1, r: 0 })
    expect(m0Free.valid).toBe(true)
    expect(m0Free.traversedCells).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }])
    expect(m0Free.finalM).toBe(0)
    expect(m0Free.axisAfter).toBe('E')

    const m0Axis = basic(stateAt({ q: 0, r: 0 }, 0, 'E'), { q: 1, r: 0 })
    expect(m0Axis.finalM).toBe(1)
    expect(m0Axis.actionTransaction).toMatchObject({ fromM: 0, toM: 1, cause: 'Generate' })

    const m1 = basic(stateAt({ q: 0, r: 0 }, 1, 'E'), { q: 1, r: 0 })
    expect(m1.traversedCells).toHaveLength(2)
    expect(m1.finalM).toBe(2)
    expect(m1.actionTransaction).toMatchObject({ fromM: 1, toM: 2, cause: 'Generate' })

    const m2 = basic(stateAt({ q: 0, r: 0 }, 2, 'E'), { q: 2, r: 0 })
    expect(m2.traversedCells).toHaveLength(3)
    expect(m2.finalM).toBe(1)
    expect(m2.actionTransaction).toMatchObject({ fromM: 2, toM: 1, cause: 'Use' })

    const m3 = basic(stateAt({ q: 0, r: 0 }, 3, 'E'), { q: 3, r: 0 })
    expect(m3.traversedCells).toHaveLength(4)
    expect(m3.finalM).toBe(2)
    expect(m3.actionTransaction).toMatchObject({ fromM: 3, toM: 2, cause: 'Use' })
    expect(m3.spatialInertiaRule).toBe(SPATIAL_INERTIA_RULE)
  })

  it('keeps M1 ±60 as Redirect and makes ±120 a real Travel2 Resist drift', () => {
    const state = stateAt({ q: 0, r: 0 }, 1, 'E')
    const redirect = basic(state, { q: 1, r: -1 })
    expect(redirect.traversedCells).toEqual([{ q: 0, r: 0 }, { q: 1, r: -1 }])
    expect(redirect.finalM).toBe(1)
    expect(redirect.axisAfter).toBe('NE')
    expect(redirect.actionTransaction.cause).toBe('Redirect')

    const drift = basic(state, { q: 0, r: -1 })
    expect(drift.traversedCells).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
    ])
    expect(drift.finalM).toBe(0)
    expect(drift.axisAfter).toBe('NW')
    expect(drift.actionTransaction).toMatchObject({ fromM: 1, toM: 0, cause: 'Resist' })
  })

  it('does not let Basic naturally build M2 to M3, while Drive is an explicit build candidate without retroactive extra travel', () => {
    const state = stateAt({ q: 0, r: 0 }, 2, 'E')
    const basicPlan = basic(state, { q: 2, r: 0 })
    expect(basicPlan.finalM).toBe(1)

    const drivePlan = drive(state, { q: 2, r: 0 })
    expect(drivePlan.valid).toBe(true)
    expect(drivePlan.traversedCells).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }])
    expect(drivePlan.finalM).toBe(3)
    expect(drivePlan.actionTransaction).toMatchObject({ fromM: 2, toM: 3, cause: 'Generate', prototypeCandidate: true })
    expect(drivePlan.driveBuildRule).toBe(DRIVE_BUILD_RULE)
  })

  it('treats Wall as Axis Redirect only and lets a pre-travel wall cancel Generate instead of charging an extra M', () => {
    const wall = [{ id: 'wall', hex: { q: 0, r: 0 }, kind: 'hard', wallAxis: 'NS' }]

    const m0 = basic(stateAt({ q: -1, r: 0 }, 0, 'E'), { q: 0, r: 0 }, wall)
    expect(m0.valid).toBe(false)

    const m1 = basic(stateAt({ q: -1, r: 0 }, 1, 'E'), { q: 0, r: 0 }, wall)
    expect(m1.valid).toBe(true)
    expect(m1.finalM).toBe(1)
    expect(m1.actionTransaction).toMatchObject({ fromM: 1, toM: 1, cause: 'Redirect', preemptedBuild: true })
    expect(m1.collisions[0]).toMatchObject({ beforeM: 1, afterM: 1, wallCellPivot: true })

    const m2 = basic(stateAt({ q: -1, r: 0 }, 2, 'E'), { q: 0, r: 0 }, wall)
    expect(m2.valid).toBe(true)
    expect(m2.finalM).toBe(1)
    expect(m2.collisions[0]).toMatchObject({ beforeM: 2, afterM: 2, wallCellPivot: true })
    expect(m2.actionTransaction).toMatchObject({ fromM: 2, toM: 1, cause: 'Use' })
  })

  it('uses pre-transaction M for adjacent Strike but post-first-Travel M for a later Strike', () => {
    const state = stateAt({ q: 0, r: 0 }, 3, 'E')

    const adjacentPlan = basic(state, { q: 3, r: 0 })
    const adjacent = resolveCellConflicts({
      plan: adjacentPlan,
      actors: [actor('A', { q: 1, r: 0 })],
      obstacles: [],
      boardRadius: 7,
    })
    expect(adjacent.cellConflict).toMatchObject({ targetActorId: 'A', impactM: 3, contactBehavior: 'Strike', resolved: true })
    expect(adjacent.actionTransaction.status).toBe('preempted-by-strike')
    expect(adjacent.finalM).toBe(0)

    const laterPlan = basic(state, { q: 3, r: 0 })
    const later = resolveCellConflicts({
      plan: laterPlan,
      actors: [actor('A', { q: 2, r: 0 })],
      obstacles: [],
      boardRadius: 7,
    })
    expect(later.cellConflict).toMatchObject({ targetActorId: 'A', impactM: 2, contactBehavior: 'Strike', resolved: true })
    expect(later.finalM).toBe(0)
  })

  it('derives knockback chain decay from Forced Use instead of a chain-decay special case', () => {
    const state = stateAt({ q: 0, r: 0 }, 3, 'E')
    const plan = basic(state, { q: 3, r: 0 })
    const resolved = resolveCellConflicts({
      plan,
      actors: [
        actor('A', { q: 1, r: 0 }),
        actor('B', { q: 2, r: 0 }),
        actor('C', { q: 3, r: 0 }),
      ],
      obstacles: [],
      boardRadius: 7,
    })

    const forcedUse = resolved.conflictEvents
      .filter((event) => event.kind === 'momentum-event' && event.cause === 'Forced Use')
      .map((event) => [event.fromM, event.toM])
    expect(forcedUse).toEqual([[3, 2], [2, 1], [1, 0]])

    const chainedTransfers = resolved.conflictEvents
      .filter((event) => event.kind === 'momentum-transfer' && event.chained)
      .map((event) => event.sourceBeforeM)
    expect(chainedTransfers).toEqual([2, 1])
    expect(resolved.conflictEvents.some((event) => event.model === 'chain-decay-prototype')).toBe(false)
  })

  it('keeps Existing + Incoming as an explicit A/B and can represent transient M4', () => {
    const target = actor('A', { q: 0, r: 0 }, 3, 'E')
    const vector = composeIncomingMomentum({ target, incomingM: 1, incomingAxis: 'E', mode: TRUE_VECTOR_COMPOSITION })
    const lookup = composeIncomingMomentum({ target, incomingM: 1, incomingAxis: 'NE', mode: HEX_LOOKUP_COMPOSITION })

    expect(vector).toMatchObject({ momentum: 4, axisId: 'E', mode: TRUE_VECTOR_COMPOSITION })
    expect(lookup.mode).toBe(HEX_LOOKUP_COMPOSITION)
    expect(lookup.lookupRule).toContain('prototype-candidate')
  })

  it('applies Down M 1:1 cancellation before Horizontal Forced Move', () => {
    const target = actor('A', { q: 0, r: 0 }, 2, 'Down')
    const result = composeIncomingMomentum({ target, incomingM: 3, incomingAxis: 'E' })
    expect(result).toMatchObject({ beforeM: 2, incomingM: 3, cancelled: 2, momentum: 1, axisId: 'E' })
  })
})
