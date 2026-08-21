import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

describe('UT7 inertia driving playground structure', () => {
  it('owns the live UT7 ruleset through final-target Basic Move navigation', async () => {
    const source = await read('./ActorLoopUt7BasicMovePlayground.tsx')
    expect(source).toContain('data-ruleset="VAL-012-UT7-candidate"')
    expect(source).toContain('data-implementation="inertia-driving-navigation-v4"')
    expect(source).toContain('Basic Move Navigation Playground')
    expect(source).toContain('data-action-id="basic-move"')
    expect(source).toContain('basicMoveNavigationPlan')
    expect(source).toContain('basicMoveNavigationTargetCoords')
    expect(source).not.toContain('data-action-id="steer"')
  })

  it('renders the complete multi-AT route while keeping every AT cell-step trace visible', async () => {
    const source = await read('./ActorLoopUt7BasicMovePlayground.tsx')
    expect(source).toContain('Navigation Resolution')
    expect(source).toContain('{plan.atCost} AT · {cellStepCount} Cell-step')
    expect(source).toContain('plan.timeline.map')
    expect(source).toContain('M{trace.beforeM}→M{trace.afterM}')
    expect(source).toContain('trace.cellSteps.map')
    expect(source).toContain('axisLabel(step.newAxis)')
    expect(source).toContain('{trace.behavior} / {trace.thermalIntent}')
  })

  it('selects remote final Target Cells and previews the exact resolved route', async () => {
    const source = await read('./ActorLoopUt7BasicMovePlayground.tsx')
    expect(source).toContain('basicMoveNavigationTargetCoords(lab)')
    expect(source).toContain('basicMoveNavigationPlan(lab, hoverCoord, settings)')
    expect(source).toContain("? { kind: 'momentum', action: 'drive', validCoords: moveValidCoords, route: previewPath }")
    expect(source).toContain('最终目的地')
    expect(source).toContain('连续结算所需的多个 AT')
    expect(source).not.toContain('合法 Steering Intent')
  })

  it('lets the route search resolve reverse steering branches instead of interrupting with a one-AT branch modal', async () => {
    const source = await read('./ActorLoopUt7BasicMovePlayground.tsx')
    expect(source).not.toContain('data-ut7-branch-choice')
    expect(source).not.toContain('Clockwise ↻')
    expect(source).not.toContain('Counter-clockwise ↺')
    expect(source).toContain('1AT inertia edges')
  })

  it('separates passive Wait/Hold from active Brake', async () => {
    const source = await read('./ActorLoopUt7BasicMovePlayground.tsx')
    expect(source).toContain('data-action-id="brake"')
    expect(source).toContain('data-action-id="wait"')
    expect(source).toContain('Horizontal M -1 / AT')
  })

  it('exposes Board Radius and Spawn Enemies while preserving attack hit feedback', async () => {
    const source = await read('./ActorLoopUt7BasicMovePlayground.tsx')
    expect(source).toContain('Playground Setup')
    expect(source).toContain('label="Board Radius"')
    expect(source).toContain('data-control="spawn-enemies"')
    expect(source).toContain('ut7-hit-impact')
    expect(source).toContain('event?.effect === \'attack\'')
  })
})
