import { describe, expect, it } from 'vitest'
import { getPlayer } from '../game'
import {
  applyPreset,
  basicAttackPlan,
  createSpatialState,
  createUt7State,
  debugBuildProbePlan,
  defaultUt7Settings,
  downAxis,
  horizontalAxis,
  reconfigureUt7State,
  setSpatialDebug,
  setThermalDebug,
  steeringPlansForTarget,
  waitPlan,
} from './actorLoopUt7'
import { HEX_DIRECTIONS, hexAdvance, type HexDirection } from './hexTopology'

const directionOrder = HEX_DIRECTIONS.map((entry) => entry.direction)
const turnDistance = (a: HexDirection, b: HexDirection) => {
  const delta = Math.abs(directionOrder.indexOf(a) - directionOrder.indexOf(b))
  return Math.min(delta, 6 - delta)
}

function eastTarget(state: ReturnType<typeof createUt7State>, distance: number) {
  return hexAdvance(getPlayer(state.game).position, 'E', distance)
}

describe('VAL-012 UT7 target-driven inertia', () => {
  it('pure same-axis Horizontal Use spends once per AT, moves two cells, and is Coldward', () => {
    const settings = defaultUt7Settings()
    const state = setSpatialDebug(createUt7State({ spawnEnemies: false }), 'player', createSpatialState(2, horizontalAxis('E')))
    const target = eastTarget(state, 4)
    const plan = steeringPlansForTarget(state, target, settings)[0]

    expect(plan.valid).toBe(true)
    expect(plan.timeline[0].beforeM).toBe(2)
    expect(plan.timeline[0].afterM).toBe(1)
    expect(plan.timeline[0].cellSteps).toHaveLength(2)
    expect(plan.timeline[0].cellSteps.every((step) => step.moveDirection === 'E')).toBe(true)
    expect(plan.timeline[0].behavior).toBe('use')
    expect(plan.timeline[0].thermalIntent).toBe('coldward')
  })

  it('redirects no more than 60 degrees per cell-step and classifies the AT as Resist / Hotward', () => {
    const settings = defaultUt7Settings()
    const state = setSpatialDebug(createUt7State({ spawnEnemies: false }), 'player', createSpatialState(2, horizontalAxis('E')))
    const target = hexAdvance(getPlayer(state.game).position, 'NE', 4)
    const plan = steeringPlansForTarget(state, target, settings)[0]

    expect(plan.timeline[0].behavior).toBe('resist')
    expect(plan.timeline[0].thermalIntent).toBe('hotward')
    for (const step of plan.timeline.flatMap((trace) => trace.cellSteps)) {
      if (step.oldAxis?.kind === 'horizontal' && step.newAxis?.kind === 'horizontal') {
        expect(turnDistance(step.oldAxis.dir, step.newAxis.dir)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('M1, M2, and M3 produce different early trajectories toward the same 60-degree target', () => {
    const settings = defaultUt7Settings()
    const base = createUt7State({ spawnEnemies: false })
    const target = hexAdvance(getPlayer(base.game).position, 'NE', 4)
    const firstMoves = ([1, 2, 3] as const).map((level) => {
      const state = setSpatialDebug(base, 'player', createSpatialState(level, horizontalAxis('E')))
      return steeringPlansForTarget(state, target, settings)[0].timeline[0].cellSteps.map((step) => step.moveDirection).join(',')
    })

    expect(new Set(firstMoves).size).toBeGreaterThan(1)
    expect(firstMoves[0]).not.toBe(firstMoves[2])
  })

  it('M1 and M3 remain predictably different for a 120-degree target', () => {
    const settings = defaultUt7Settings()
    const base = createUt7State({ spawnEnemies: false })
    const target = hexAdvance(getPlayer(base.game).position, 'NW', 4)
    const m1 = steeringPlansForTarget(setSpatialDebug(base, 'player', createSpatialState(1, horizontalAxis('E'))), target, settings)[0]
    const m3 = steeringPlansForTarget(setSpatialDebug(base, 'player', createSpatialState(3, horizontalAxis('E'))), target, settings)[0]

    expect(m1.path.slice(0, 2)).not.toEqual(m3.path.slice(0, 2))
    expect(m1.timeline[0].behavior).toBe('resist')
    expect(m3.timeline[0].behavior).toBe('resist')
  })

  it('offers explicit clockwise and counter-clockwise routes for an exact 180-degree target', () => {
    const settings = defaultUt7Settings()
    const state = setSpatialDebug(createUt7State({ spawnEnemies: false }), 'player', createSpatialState(3, horizontalAxis('E')))
    const target = hexAdvance(getPlayer(state.game).position, 'W', 3)
    const plans = steeringPlansForTarget(state, target, settings)

    expect(plans).toHaveLength(2)
    expect(new Set(plans.map((plan) => plan.branch))).toEqual(new Set(['cw', 'ccw']))
    expect(plans[0].path).not.toEqual(plans[1].path)
  })

  it('M0 movement is Generate / Hotward and begins Horizontal inertia', () => {
    const settings = defaultUt7Settings()
    const state = createUt7State({ spawnEnemies: false })
    const plan = steeringPlansForTarget(state, eastTarget(state, 1), settings)[0]

    expect(plan.atCost).toBe(1)
    expect(plan.timeline[0].cellSteps).toHaveLength(1)
    expect(plan.timeline[0].behavior).toBe('generate')
    expect(plan.timeline[0].thermalIntent).toBe('hotward')
    expect(plan.result.spatialByActorId.player.axis).toEqual(horizontalAxis('E'))
    expect(plan.result.spatialByActorId.player.level).toBe(1)
  })

  it('Down M1 breaks away to M0 and moves in the same AT without building Horizontal M', () => {
    const settings = defaultUt7Settings()
    const state = setSpatialDebug(createUt7State({ spawnEnemies: false }), 'player', createSpatialState(1, downAxis()))
    const plan = steeringPlansForTarget(state, eastTarget(state, 1), settings)[0]

    expect(plan.atCost).toBe(1)
    expect(plan.timeline[0].behavior).toBe('resist')
    expect(plan.timeline[0].cellSteps).toHaveLength(1)
    expect(plan.result.spatialByActorId.player.level).toBe(0)
    expect(plan.result.spatialByActorId.player.axis).toEqual(downAxis())
  })

  it('Down M3 consumes extra Breakaway AT before horizontal displacement', () => {
    const settings = defaultUt7Settings()
    const state = setSpatialDebug(createUt7State({ spawnEnemies: false }), 'player', createSpatialState(3, downAxis()))
    const plan = steeringPlansForTarget(state, eastTarget(state, 1), settings)[0]

    expect(plan.atCost).toBe(3)
    expect(plan.timeline[0].cellSteps).toHaveLength(0)
    expect(plan.timeline[1].cellSteps).toHaveLength(0)
    expect(plan.timeline[2].cellSteps).toHaveLength(1)
    expect(plan.timeline.every((trace) => trace.behavior === 'resist')).toBe(true)
  })

  it('Hot-side Breakaway assist is an explicit candidate setting', () => {
    const state = setThermalDebug(
      setSpatialDebug(createUt7State({ spawnEnemies: false }), 'player', createSpatialState(3, downAxis())),
      { temperature: 4, setPoint: 1, drift: 0 },
    )
    const settings = { ...defaultUt7Settings(), hotSideBreakawayAssistEnabled: true }
    const plan = steeringPlansForTarget(state, eastTarget(state, 1), settings)[0]

    expect(plan.atCost).toBe(2)
    expect(plan.timeline[0].afterM).toBe(1)
  })

  it('Horizontal Wait dissipates one M, balances Thermal, and keeps the Horizontal Axis at M0', () => {
    const state = setSpatialDebug(createUt7State({ spawnEnemies: false }), 'player', createSpatialState(1, horizontalAxis('E')))
    const plan = waitPlan(state)

    expect(plan.timeline[0].behavior).toBe('passive-dissipation')
    expect(plan.timeline[0].thermalIntent).toBe('balancing')
    expect(plan.result.spatialByActorId.player.level).toBe(0)
    expect(plan.result.spatialByActorId.player.axis).toEqual(horizontalAxis('E'))
  })

  it('Side controls cap while matching Domain controls build efficiency', () => {
    const settings = defaultUt7Settings()
    let hot = setThermalDebug(createUt7State({ spawnEnemies: false }), { temperature: 4.8, setPoint: 1, drift: 0 })
    hot = setSpatialDebug(hot, 'player', createSpatialState(1, horizontalAxis('E')))
    const hotBuild = debugBuildProbePlan(hot, horizontalAxis('E'), settings)
    expect(hotBuild.result.spatialByActorId.player.level).toBe(3)

    let mismatch = setThermalDebug(createUt7State({ spawnEnemies: false }), { temperature: -4, setPoint: 1, drift: 0 })
    mismatch = setSpatialDebug(mismatch, 'player', createSpatialState(1, horizontalAxis('E')))
    const mismatchBuild = debugBuildProbePlan(mismatch, horizontalAxis('E'), settings)
    expect(mismatchBuild.result.spatialByActorId.player.level).toBe(1)

    let cold = setThermalDebug(createUt7State({ spawnEnemies: false }), { temperature: -6, setPoint: 1, drift: 0 })
    cold = setSpatialDebug(cold, 'player', createSpatialState(1, downAxis()))
    const coldBuild = debugBuildProbePlan(cold, downAxis(), settings)
    expect(coldBuild.result.spatialByActorId.player.level).toBe(3)
  })

  it('does not clamp existing high M when Thermal leaves its matching Side', () => {
    let state = setSpatialDebug(createUt7State({ spawnEnemies: false }), 'player', createSpatialState(3, horizontalAxis('E')))
    state = setThermalDebug(state, { temperature: -4, setPoint: 1 })
    expect(state.spatialByActorId.player).toEqual(createSpatialState(3, horizontalAxis('E')))
  })

  it('Board Radius rebuilds 4..10 and Spawn Enemies toggles while preserving player runtime state', () => {
    let state = createUt7State({ boardRadius: 7, spawnEnemies: true })
    state = setThermalDebug(state, { temperature: 3.5, drift: 1.25 })
    state = setSpatialDebug(state, 'player', createSpatialState(2, horizontalAxis('E')))
    state.worldTimeAt = 6

    const noEnemies = reconfigureUt7State(state, { spawnEnemies: false })
    expect(noEnemies.game.actors).toHaveLength(1)
    expect(noEnemies.thermal).toEqual(state.thermal)
    expect(noEnemies.spatialByActorId.player).toEqual(state.spatialByActorId.player)
    expect(noEnemies.worldTimeAt).toBe(6)

    const radius10 = reconfigureUt7State(noEnemies, { boardRadius: 10 })
    expect(radius10.setup.boardRadius).toBe(10)
    expect(radius10.setup.spawnEnemies).toBe(false)
    expect(radius10.worldTimeAt).toBe(0)

    const radius4 = createUt7State({ boardRadius: 4, spawnEnemies: false })
    expect(radius4.setup.boardRadius).toBe(4)
  })

  it('Grounded Basic Attack still loses HP and spends Down M into Incoming M1', () => {
    const settings = defaultUt7Settings()
    let state = createUt7State({ spawnEnemies: true })
    const player = getPlayer(state.game)
    const target = state.game.actors.find((actor) => actor.id !== 'player')!
    target.position = hexAdvance(player.position, 'E', 1)
    state = setSpatialDebug(state, 'player', createSpatialState(1, downAxis()))
    const beforeHp = target.hp
    const plan = basicAttackPlan(state, target.id, settings)
    const afterTarget = plan.result.game.actors.find((actor) => actor.id === target.id)!

    expect(afterTarget.hp).toBe(beforeHp - 1)
    expect(plan.result.spatialByActorId.player.level).toBe(0)
    expect(plan.timeline[0].behavior).toBe('use')
    expect(plan.timeline[0].thermalIntent).toBe('coldward')
    expect(plan.result.spatialByActorId[target.id]?.level).toBe(1)
  })

  it('presets expose M1/M2/M3 East comparison fixtures without separate tier identities', () => {
    const base = createUt7State({ spawnEnemies: false })
    expect(applyPreset(base, 'm1-east').spatialByActorId.player.level).toBe(1)
    expect(applyPreset(base, 'm2-east').spatialByActorId.player.level).toBe(2)
    expect(applyPreset(base, 'm3-east').spatialByActorId.player.level).toBe(3)
  })
})
