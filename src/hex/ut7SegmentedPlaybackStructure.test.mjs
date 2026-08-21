import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

describe('UT7 segmented actor playback structure', () => {
  it('plays Three.js movement through ordered waypoints instead of one start-to-end tween', async () => {
    const source = await read('./HexThreeBoard.tsx')
    expect(source).toContain("resolvedActorPlaybackPath(previous, actor.position, event, actor.id)")
    expect(source).toContain('waypoints: THREE.Vector3[]')
    expect(source).toContain('playbackSegmentAt(progress, item.waypoints.length)')
    expect(source).toContain('item.waypoints[segment.segmentIndex]')
    expect(source).toContain('item.waypoints[segment.segmentIndex + 1]')
    expect(source).not.toContain('item.object.position.lerpVectors(item.from, item.to, eased)')
  })

  it('uses the navigation-resolved route for preview instead of rebuilding a straight intent ray', async () => {
    const board = await read('./HexThreeBoard.tsx')
    const playground = await read('./ActorLoopUt7BasicMovePlayground.tsx')
    expect(board).toContain('selection.route && selection.route.length > 0')
    expect(board).toContain('const pathCoords = routedPath')
    expect(playground).toContain("const previewPath = preview?.valid && preview.path.length ? [{ ...player.position }, ...preview.path.map")
    expect(playground).toContain('basicMoveNavigationPlan(lab, hoverCoord, settings)')
    expect(playground).toContain("path: [{ ...beforePlayer.position }, ...plan.path.map")
  })

  it('animates the 2D actor over the same ordered path', async () => {
    const source = await read('./HexTravelMap.tsx')
    expect(source).toContain('eventActorPlaybackPath(actor.position, event, actor.id)')
    expect(source).toContain('data-playback-segments={playbackSegments}')
    expect(source).toContain('data-playback-path={playbackPath?.map(keyOf).join')
    expect(source).toContain('<animateMotion')
    expect(source).toContain('calcMode="linear"')
  })
})
