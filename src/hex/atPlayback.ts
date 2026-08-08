export const BASE_AT_PLAYBACK_MS = 680
export const MIN_AT_PLAYBACK_RATE = 0.25
export const MAX_AT_PLAYBACK_RATE = 4
export const AT_PLAYBACK_RATE_STEP = 0.25

export type AtPlaybackTiming = {
  manual: boolean
  rate: number
  msPerAt: number
}

export function atPlaybackTiming(rate: number): AtPlaybackTiming {
  const manual = rate <= 0
  const boundedRate = manual
    ? 1
    : Math.min(MAX_AT_PLAYBACK_RATE, Math.max(MIN_AT_PLAYBACK_RATE, rate))
  const msPerAt = Math.round(BASE_AT_PLAYBACK_MS / boundedRate)

  return {
    manual,
    rate: manual ? 0 : boundedRate,
    msPerAt,
  }
}

export function playbackDelayForAt(timing: AtPlaybackTiming, durationAt: number) {
  return Math.max(16, Math.round(timing.msPerAt * Math.max(0, durationAt)))
}

export function formatAtPlaybackRate(timing: AtPlaybackTiming) {
  if (timing.manual) return '单步'
  const rate = Number.isInteger(timing.rate) ? timing.rate.toFixed(0) : timing.rate.toFixed(2)
  return `${rate}× · ${timing.msPerAt} ms/AT`
}
