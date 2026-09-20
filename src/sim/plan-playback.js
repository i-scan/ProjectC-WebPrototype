import { playbackElapsedMs } from './solver.js'

// Shared by Trajectory and Gameplay. Presentation duration never changes AT.
export function playbackFromPlan(plan, id, durationMs, now = performance.now()) {
  return {
    ...plan, id, startedAt: now, pausedAt: null, pausedTotal: 0, durationMs,
    spatialMode: plan.spatialMode ?? 'hybrid',
    destinationDriven: plan.destinationDriven ?? false,
    actorTrajectories: plan.actorTrajectories ?? {},
    actorPlaybackWindows: plan.actorPlaybackWindows ?? {},
    actorStates: plan.actorStates ?? [],
    playerPlaybackEnd: plan.playerPlaybackEnd ?? 1,
  }
}

export function playbackClockSample(playback, now = performance.now()) {
  const durationMs = Math.max(1, Number(playback?.durationMs) || 0)
  const elapsedMs = Math.max(0, playbackElapsedMs(playback, now))
  return {
    elapsedMs,
    durationMs,
    progress: Math.min(1, elapsedMs / durationMs),
    remainingMs: Math.max(0, durationMs - elapsedMs),
  }
}

export function playbackProgress(playback, now = performance.now()) {
  return playbackClockSample(playback, now).progress
}

export function playbackRemainingMs(playback, now = performance.now()) {
  return playbackClockSample(playback, now).remainingMs
}

// Uneven event times are authoritative; never infer time from array index.
// State is right-continuous at an event; only position interpolates between events.
export function sampleTimedRecord(samples, t) {
  if (!samples?.length) return null
  let index = 0
  while (index + 1 < samples.length && samples[index + 1].t <= t) index += 1
  const a = samples[index]
  const b = samples[index + 1]
  if (!b || t <= a.t) return a
  const fraction = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)))
  return {
    ...a,
    position: {
      x: a.position.x + (b.position.x - a.position.x) * fraction,
      z: a.position.z + (b.position.z - a.position.z) * fraction,
    },
  }
}
