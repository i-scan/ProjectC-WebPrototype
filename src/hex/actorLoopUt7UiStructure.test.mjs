import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

describe('UT7 inertia driving playground structure', () => {
  it('owns the live UT7 ruleset and exposes target-driven Steering', async () => {
    const source = await read('./ActorLoopUt7Playground.tsx')
    expect(source).toContain('data-ruleset="VAL-012-UT7-candidate"')
    expect(source).toContain('data-implementation="inertia-driving-playground-v1"')
    expect(source).toContain('Target-driven Steering Playground')
    expect(source).toContain('data-action-id="steer"')
    expect(source).toContain('steeringPlansForTarget')
  })

  it('renders ETA, per-AT Momentum/Axis, cell move direction and Thermal behavior in preview', async () => {
    const source = await read('./ActorLoopUt7Playground.tsx')
    expect(source).toContain('Predicted Path')
    expect(source).toContain('ETA {plan.atCost} AT')
    expect(source).toContain('M{trace.beforeM}→M{trace.afterM}')
    expect(source).toContain('trace.cellSteps.map')
    expect(source).toContain('{trace.behavior} / {trace.thermalIntent}')
  })

  it('requires explicit branch selection for dual 180-degree routes', async () => {
    const source = await read('./ActorLoopUt7Playground.tsx')
    expect(source).toContain('data-ut7-branch-choice')
    expect(source).toContain('Clockwise ↻')
    expect(source).toContain('Counter-clockwise ↺')
    expect(source).toContain('if (plans?.length === 2)')
  })

  it('separates passive Wait/Hold from active Brake', async () => {
    const source = await read('./ActorLoopUt7Playground.tsx')
    expect(source).toContain('data-action-id="brake"')
    expect(source).toContain('data-action-id="wait"')
    expect(source).toContain('Passive Stop')
    expect(source).toContain('Horizontal M -1 / AT')
  })

  it('exposes Board Radius and Spawn Enemies at the bottom-level Playground Setup', async () => {
    const source = await read('./ActorLoopUt7Playground.tsx')
    expect(source).toContain('Playground Setup')
    expect(source).toContain('label="Board Radius"')
    expect(source).toContain('data-control="spawn-enemies"')
    expect(source).toContain('changeRadius')
    expect(source).toContain('toggleEnemies')
  })

  it('keeps release payoff out of the UT7 primary action row while preserving attack hit feedback', async () => {
    const source = await read('./ActorLoopUt7Playground.tsx')
    expect(source).not.toContain('data-action-id="raikiri"')
    expect(source).not.toContain('data-action-id="ground-break"')
    expect(source).toContain('ut7-hit-impact')
    expect(source).toContain('event?.effect === \'attack\'')
  })
})
