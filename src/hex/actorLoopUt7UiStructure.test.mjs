import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

describe('UT7 inertia driving playground structure', () => {
  it('owns the live UT7 ruleset through the Basic Move command playground', async () => {
    const source = await read('./ActorLoopUt7BasicMovePlayground.tsx')
    expect(source).toContain('data-ruleset="VAL-012-UT7-candidate"')
    expect(source).toContain('data-implementation="inertia-driving-basic-move-v2"')
    expect(source).toContain('Basic Move Inertia Playground')
    expect(source).toContain('data-action-id="basic-move"')
    expect(source).toContain('basicMovePlansForTarget')
    expect(source).not.toContain('data-action-id="steer"')
  })

  it('renders one-command Move Resolution instead of ETA navigation', async () => {
    const source = await read('./ActorLoopUt7BasicMovePlayground.tsx')
    expect(source).toContain('Move Resolution')
    expect(source).toContain('1 AT · one command')
    expect(source).toContain('M{trace.beforeM}→M{trace.afterM}')
    expect(source).toContain('trace.cellSteps.map')
    expect(source).toContain('{trace.behavior} / {trace.thermalIntent}')
    expect(source).not.toContain('Predicted Path')
    expect(source).not.toContain('ETA {plan.atCost} AT')
  })

  it('uses ordinary Basic Move board selection so only adjacent cells highlight', async () => {
    const source = await read('./ActorLoopUt7BasicMovePlayground.tsx')
    expect(source).toContain("? { kind: 'basic', action: 'move' }")
    expect(source).toContain('只高亮普通 Basic Move 可选的相邻 Cell')
    expect(source).toContain('点击一次只执行 1 AT')
    expect(source).toContain('不会自动导航到远端')
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
