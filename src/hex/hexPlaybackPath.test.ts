import { describe, expect, it } from 'vitest'
import type { PlaybackEvent } from '../visual/visualPlayback'
import { eventActorPlaybackPath, playbackSegmentAt, resolvedActorPlaybackPath } from './hexPlaybackPath'

const moveEvent = (path: { x: number; y: number }[]): PlaybackEvent => ({
  id: 1,
  kind: 'move',
  effect: 'move',
  actorId: 'player',
  target: { ...path.at(-1)! },
  path,
})

describe('segmented actor playback path', () => {
  it('keeps a complete start-to-end rule path for the matching actor', () => {
    const path = [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 3 }]
    const event = moveEvent(path)
    expect(eventActorPlaybackPath({ x: 6, y: 3 }, event, 'player')).toEqual(path)
    expect(resolvedActorPlaybackPath({ x: 4, y: 4 }, { x: 6, y: 3 }, event, 'player')).toEqual(path)
  })

  it('prepends the previous cell when a rule path contains only resolved landing cells', () => {
    const event = moveEvent([{ x: 5, y: 4 }, { x: 6, y: 3 }])
    expect(resolvedActorPlaybackPath({ x: 4, y: 4 }, { x: 6, y: 3 }, event, 'player')).toEqual([
      { x: 4, y: 4 },
      { x: 5, y: 4 },
      { x: 6, y: 3 },
    ])
  })

  it('falls back to direct previous-target playback when event path does not match the actor transition', () => {
    const event = moveEvent([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }])
    expect(resolvedActorPlaybackPath({ x: 4, y: 4 }, { x: 5, y: 4 }, event, 'player')).toEqual([
      { x: 4, y: 4 },
      { x: 5, y: 4 },
    ])
  })

  it('maps normalized animation time into independent cell segments', () => {
    expect(playbackSegmentAt(0, 3)).toEqual({ segmentCount: 2, segmentIndex: 0, localProgress: 0 })
    expect(playbackSegmentAt(0.25, 3)).toEqual({ segmentCount: 2, segmentIndex: 0, localProgress: 0.5 })
    expect(playbackSegmentAt(0.5, 3)).toEqual({ segmentCount: 2, segmentIndex: 1, localProgress: 0 })
    expect(playbackSegmentAt(0.75, 3)).toEqual({ segmentCount: 2, segmentIndex: 1, localProgress: 0.5 })
    expect(playbackSegmentAt(1, 3)).toEqual({ segmentCount: 2, segmentIndex: 1, localProgress: 1 })
  })
})
