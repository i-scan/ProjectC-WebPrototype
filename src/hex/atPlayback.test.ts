import { describe, expect, it } from 'vitest'
import {
  AT_PLAYBACK_RATE_STEP,
  atPlaybackTiming,
  BASE_AT_PLAYBACK_MS,
  formatAtPlaybackRate,
  MAX_AT_PLAYBACK_RATE,
  MIN_AT_PLAYBACK_RATE,
  playbackDelayForAt,
} from './atPlayback'

describe('AT playback timing', () => {
  it('uses a 680 ms baseline and quarter-step automatic range', () => {
    expect(BASE_AT_PLAYBACK_MS).toBe(680)
    expect(MIN_AT_PLAYBACK_RATE).toBe(0.25)
    expect(MAX_AT_PLAYBACK_RATE).toBe(4)
    expect(AT_PLAYBACK_RATE_STEP).toBe(0.25)
  })

  it.each([
    [0.25, 2720],
    [0.5, 1360],
    [1, 680],
    [1.25, 544],
    [2, 340],
    [4, 170],
  ])('maps %sx playback to %sms per AT', (rate, expectedMs) => {
    const timing = atPlaybackTiming(rate)
    expect(timing.manual).toBe(false)
    expect(timing.msPerAt).toBe(expectedMs)
  })

  it('keeps zero as manual travel while retaining baseline cue playback', () => {
    const timing = atPlaybackTiming(0)
    expect(timing).toMatchObject({ manual: true, rate: 0, msPerAt: 680 })
    expect(formatAtPlaybackRate(timing)).toBe('单步')
  })

  it('converts each cue share from AT to wall-clock playback time', () => {
    const timing = atPlaybackTiming(1)
    expect(playbackDelayForAt(timing, 2)).toBe(1360)
    expect(playbackDelayForAt(timing, 0.5)).toBe(340)
    expect(playbackDelayForAt(atPlaybackTiming(4), 0.05)).toBe(16)
  })

  it('formats the rate together with its concrete AT duration', () => {
    expect(formatAtPlaybackRate(atPlaybackTiming(1))).toBe('1× · 680 ms/AT')
    expect(formatAtPlaybackRate(atPlaybackTiming(1.25))).toBe('1.25× · 544 ms/AT')
  })
})
