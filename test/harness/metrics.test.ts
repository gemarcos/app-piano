// Error breakdown of the realistic benchmark (check-transcription.mjs): each wrong note lands in exactly one class.
import { describe, expect, it } from 'vitest'
import { evaluateDetailed, evaluateNotes } from './metrics'

const t = (pitch: number, start: number, extra: object = {}) => ({ pitch, start, duration: 0.5, sounding: 1.5, velocity: 0.5, ...extra })
const d = (pitch: number, start: number, duration = 0.5, velocity = 0.5) => ({ pitch, start, duration, velocity })

describe('evaluateDetailed', () => {
  it('classifies extras as octave, semitone, repeat or other and misses as merged or missed', () => {
    const truth = [t(48, 1, { role: 'bass' }), t(64, 2, { role: 'arpeggio' }), t(67, 3, { role: 'melody', velocity: 0.2 }), t(67, 3.5, { role: 'melody' }), t(72, 5)]
    const detected = [
      d(48, 1.01), // hit
      d(60, 1.0), // octave ghost of the bass note
      d(65, 2.0), // a semitone off (and the true 64 is missed)
      d(67, 3.0, 1.2), // hit, swallows the re-strike at 3.5 (merged)
      d(72, 5.4), // re-trigger inside the sounding 72 (repeat); the real 72 onset is missed
      d(90, 6), // other extra
    ]
    const m = evaluateDetailed(detected, truth)
    expect(m.tp).toBe(2)
    expect(m.breakdown).toMatchObject({ octave: 1, semitone: 1, repeat: 1, extra: 1, merged: 1, missed: 2 })
    expect(m.breakdown.recallByRole.melody).toEqual({ truth: 2, tp: 1 })
    expect(m.breakdown.recallByRole.arpeggio).toEqual({ truth: 1, tp: 0 })
    expect(m.breakdown.soft).toEqual({ truth: 1, tp: 1 })
  })

  it('flags phantom tails and measures velocity agreement', () => {
    const truth = [t(60, 1, { velocity: 0.2, sounding: 0.4 }), t(62, 2, { velocity: 0.5, sounding: 0.4 }), t(64, 3, { velocity: 0.8, sounding: 0.4 })]
    const detected = [d(60, 1, 2.0, 0.3), d(62, 2, 0.4, 0.5), d(64, 3, 0.4, 0.7)]
    const m = evaluateDetailed(detected, truth)
    expect(m.breakdown.tooLong).toBe(1)
    expect(m.breakdown.tooShort).toBe(0)
    expect(m.breakdown.velocityCorr).toBeGreaterThan(0.95)
    expect(m.breakdown.velocityFitMae).toBeLessThan(0.05)
  })

  it('uses a 50 ms onset tolerance by default (60 ms for the legacy evaluateNotes)', () => {
    expect(evaluateDetailed([d(60, 1.055)], [t(60, 1)]).tp).toBe(0)
    expect(evaluateNotes([d(60, 1.055)], [t(60, 1)]).tp).toBe(1)
  })
})
