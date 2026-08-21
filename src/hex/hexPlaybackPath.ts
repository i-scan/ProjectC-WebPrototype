import type { Coord } from '../game'
import type { PlaybackEvent } from '../visual/visualPlayback'

const sameCoord = (a?: Coord, b?: Coord) => Boolean(a && b && a.x === b.x && a.y === b.y)
const cloneCoord = (coord: Coord): Coord => ({ ...coord })

export function eventActorPlaybackPath(
  target: Coord,
  event: PlaybackEvent | undefined,
  actorId: string,
): Coord[] | undefined {
  const path = event?.effect === 'move' && event.actorId === actorId ? event.path : undefined
  if (!path || path.length < 2 || !sameCoord(path.at(-1), target)) return undefined
  return path.map(cloneCoord)
}

export function resolvedActorPlaybackPath(
  previous: Coord,
  target: Coord,
  event: PlaybackEvent | undefined,
  actorId: string,
): Coord[] {
  const eventPath = eventActorPlaybackPath(target, event, actorId)
  if (eventPath && sameCoord(eventPath[0], previous)) return eventPath
  return [cloneCoord(previous), cloneCoord(target)]
}

export function playbackSegmentAt(progress: number, waypointCount: number) {
  const segmentCount = Math.max(1, waypointCount - 1)
  const normalized = Math.max(0, Math.min(1, progress))
  if (normalized >= 1) return { segmentCount, segmentIndex: segmentCount - 1, localProgress: 1 }
  const segmentProgress = normalized * segmentCount
  const segmentIndex = Math.min(segmentCount - 1, Math.floor(segmentProgress))
  return {
    segmentCount,
    segmentIndex,
    localProgress: segmentProgress - segmentIndex,
  }
}
