import { getPlayer } from '../game'
import {
  createSpatialInertiaState,
  reconcileSpatialWithTemperature,
  resolveDrive,
  setSpatialDebug,
  type CoupledInertiaLabState,
  type DriveFrame,
  type RuntimeTuning,
  type SpatialInertiaState,
} from './coupledInertia'
import type { HexDirection } from './hexTopology'

function samePlayerCell(left: CoupledInertiaLabState, right: CoupledInertiaLabState) {
  const a = getPlayer(left.game).position
  const b = getPlayer(right.game).position
  return a.x === b.x && a.y === b.y
}

/**
 * UT4 Drive only builds Movement Inertia when a committed phase actually
 * changes the player's Cell. Contact/Clash/Stop phases still consume their AT,
 * but must not mint Movement M merely because a Drive command was committed.
 */
export function resolveDriveRuntime(
  input: CoupledInertiaLabState,
  direction: HexDirection,
  tuning: RuntimeTuning,
): DriveFrame[] {
  const rawFrames = resolveDrive(input, direction, tuning)
  const frames: DriveFrame[] = []
  let previous = structuredClone(input)

  for (const rawFrame of rawFrames) {
    const frame = structuredClone(rawFrame)
    if (samePlayerCell(previous, frame.state)) {
      const previousSpatial = previous.spatialByActorId.player ?? createSpatialInertiaState()
      frame.state.spatialByActorId.player = reconcileSpatialWithTemperature(
        previousSpatial,
        frame.state.thermal.temperature,
      ).spatial
    }
    frames.push(frame)
    previous = structuredClone(frame.state)
  }

  return frames
}

/**
 * The sandbox deliberately allows direct state construction, including None.
 * Keep the UI path explicit instead of feeding a None patch into the legacy
 * helper's recursive normalization branch.
 */
export function setSpatialDebugRuntime(
  input: CoupledInertiaLabState,
  actorId: string,
  patch: Partial<SpatialInertiaState>,
): CoupledInertiaLabState {
  if (patch.mode === 'none') {
    const state = structuredClone(input)
    state.spatialByActorId[actorId] = createSpatialInertiaState()
    return state
  }
  return setSpatialDebug(input, actorId, patch)
}
