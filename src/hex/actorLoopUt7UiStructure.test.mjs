import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

describe('UT7 inertia driving playground structure', () => {
  it('owns the live UT7 ruleset through the Basic Move command playground', async () => {
    const source = await read('./ActorLoopUt7BasicMovePlayground.tsx')
    expect(source).toContain('data-ruleset="VAL-012-UT7-candidate"')
    expect(source).toContain('data-implementation="inertia-driving-basic-move-v3"')
    expect(source).toContain('Basic Move Inertia Playground')
    expect(source).toContain('data-action-id="basic-move"')
    expect(source).toContain('basicMovePlansForTarget')
    expect(source).toContain('basicMoveTargetCoords')
    expect(source).not.toContain('data-action-id="steer"')
  })

  it('renders one-command Cell-step resolution instead of multi-AT ETA navigation', async () => {
    const source = await read('./ActorLoopUt7BasicMovePlayground.tsx')
    expect(source).toContain('Move Resolution')
    expect(source).toContain('1 AT · {trace.cellSteps.length} Cell-step')
    expect(source).toContain('M{trace.beforeM}→M{trace.afterM}')
    expect(source).toContain('trace.cellSteps.map')
    expect(source).toContain('axisLabel(step.newAxis)')
    expect(source).toContain('{trace.behavior} / {trace.thermalIntent}')
    expect(source).not.toContain('ETA {plan.atCost} AT')
  })

  it('uses rule-generated validCoords instead of ordinary adjacent Basic Move highlighting', async () => {
    const source = await read('./ActorLoopUt7BasicMovePlayground.tsx')
    expect(source).toContain('const moveValidCoords = movePlans.map')
    expect(source).toContain("? { kind: 'momentum', action: 'drive', validCoords: moveValidCoords, route: previewPath }")
    expect(source).toContain('合法 Steering Intent')
    expect(source).toContain('Horizontal M 可逐格解析最多 2 Cell-step')
    expect(source).not.toContain('只高亮普通 Basic Move 可选的相邻 Cell')
  })

  it('requires explicit turn-side choice for reverse intent without changing command AT', async () => {
    const source = await read('./ActorLoopUt7BasicMovePlayground.tsx')
    expect(source).toContain('data-ut7-branch-choice')
    expect(source).toContain('Clockwise ↻')
    expect(source).toContain('Counter-clockwise ↺')
    expect(source).toContain('· 1AT')
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
