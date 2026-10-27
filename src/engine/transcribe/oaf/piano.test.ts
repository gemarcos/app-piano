import { describe, expect, it } from 'vitest'
import { CHUNK_FRAMES, FRAME_SECONDS } from './constants'
import { MIN_REALTIME_FACTOR, probeVerdict, realtimeFactor } from './piano'

describe("piano model speed probe ('auto')", () => {
  it('turns the time of one chunk into a real-time factor', () => {
    const chunkSeconds = CHUNK_FRAMES * FRAME_SECONDS // 8 s of audio
    expect(realtimeFactor(chunkSeconds * 1000)).toBeCloseTo(1)
    expect(realtimeFactor(1000)).toBeCloseTo(chunkSeconds)
    expect(realtimeFactor(0)).toBe(Infinity)
  })

  it('accepts devices at least as fast as real time and refuses slower ones', () => {
    const limit = (CHUNK_FRAMES * FRAME_SECONDS * 1000) / MIN_REALTIME_FACTOR
    expect(probeVerdict(limit * 0.5)).toBe(true)
    expect(probeVerdict(limit)).toBe(true)
    expect(probeVerdict(limit * 1.2)).toBe(false)
  })
})
