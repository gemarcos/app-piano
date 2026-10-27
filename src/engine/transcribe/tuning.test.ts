import { describe, expect, it } from 'vitest'
import { scaleNoteTimes } from './params'
import { centsDeviation, estimateTuning, retune, retuneFactor, TUNING_MIN_CENTS, tuningCorrection } from './tuning'

const SR = 22050

/** Piano-ish chord progression: harmonic partials with 1/k amplitudes and an exponential decay, detuned by `cents`. */
function pianoLike(cents: number, seconds = 4, seed = 1): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR))
  const chords = [
    [48, 60, 64, 67, 72],
    [43, 59, 62, 67, 74],
    [45, 57, 60, 64, 76],
    [41, 57, 60, 65, 72],
  ]
  let rand = seed
  const next = () => ((rand = (rand * 16807) % 2147483647) / 2147483647)
  const chordLen = out.length / chords.length
  chords.forEach((chord, c) => {
    for (const pitch of chord) {
      const f0 = 440 * 2 ** ((pitch - 69) / 12 + cents / 1200)
      const amp = 0.08 + 0.05 * next()
      for (let k = 1; k <= 6; k++) {
        const f = f0 * k
        if (f > SR / 2.2) break
        const phase = next() * 2 * Math.PI
        for (let i = 0; i < chordLen; i++) {
          const t = i / SR
          out[Math.round(c * chordLen) + i] += ((amp / k) * Math.exp(-t * (1 + k * 0.6)) * Math.sin(2 * Math.PI * f * t + phase))
        }
      }
    }
  })
  return out
}

/** Dominant frequency by counting zero crossings of a pure tone. */
function toneHz(x: Float32Array): number {
  let crossings = 0
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++
  return (crossings * SR) / x.length
}

describe('centsDeviation', () => {
  it('measures the offset from the nearest A440 equal-tempered pitch, wrapped to [-50, 50)', () => {
    expect(centsDeviation(440)).toBeCloseTo(0, 6)
    expect(centsDeviation(261.6256)).toBeCloseTo(0, 2) // C4
    expect(centsDeviation(440 * 2 ** (30 / 1200))).toBeCloseTo(30, 4)
    expect(centsDeviation(440 * 2 ** (70 / 1200))).toBeCloseTo(-30, 4)
    expect(centsDeviation(432)).toBeCloseTo(-31.77, 1)
  })
})

describe('estimateTuning', () => {
  it('finds the offset of detuned piano-like chords within a few cents', () => {
    for (const cents of [0, 35, -25, 42, -40]) {
      const est = estimateTuning(pianoLike(cents))
      expect(Math.abs(est.cents - cents)).toBeLessThan(4)
      expect(est.confidence).toBeGreaterThan(0.5)
    }
  })

  it('reports nothing usable for silence and low confidence for noise', () => {
    expect(estimateTuning(new Float32Array(SR * 2))).toMatchObject({ cents: 0, confidence: 0 })
    let seed = 7
    const noise = Float32Array.from({ length: SR * 3 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5)
    expect(tuningCorrection(estimateTuning(noise))).toBe(0)
    expect(estimateTuning(new Float32Array(100))).toMatchObject({ cents: 0, confidence: 0, peaks: 0 })
  })

  it('only corrects clear offsets of at least TUNING_MIN_CENTS', () => {
    expect(tuningCorrection({ cents: TUNING_MIN_CENTS - 1, confidence: 0.9, peaks: 500 })).toBe(0)
    expect(tuningCorrection({ cents: -30, confidence: 0.2, peaks: 500 })).toBe(0)
    expect(tuningCorrection({ cents: -30, confidence: 0.7, peaks: 500 })).toBe(-30)
  })
})

describe('retune', () => {
  it('moves a detuned tone back onto the semitone grid and stretches time by 1 / retuneFactor', () => {
    const detuned = 440 * 2 ** (40 / 1200)
    const x = Float32Array.from({ length: SR * 2 }, (_, i) => Math.sin((2 * Math.PI * detuned * i) / SR))
    const y = retune(x, 40)
    expect(toneHz(y.subarray(200, y.length - 200))).toBeCloseTo(440, 0)
    expect(y.length).toBe(Math.floor(x.length / retuneFactor(40)))
    expect(retune(x, 0)).not.toBe(x)
    expect(retune(x, 0)).toEqual(x)
  })

  it('round-trips note times through scaleNoteTimes', () => {
    const factor = retuneFactor(-35)
    expect(factor).toBeGreaterThan(1) // flat audio is sped up to raise its pitch
    const inRetuned = [{ pitch: 60, start: 10 / factor, duration: 1 / factor, velocity: 0.5 }]
    const back = scaleNoteTimes(inRetuned, factor)
    expect(back[0].start).toBeCloseTo(10, 3)
    expect(back[0].duration).toBeCloseTo(1, 3)
    expect(scaleNoteTimes(inRetuned, 1)).toBe(inRetuned)
  })
})

describe('resampleBy (piano model input: 22.05 -> 16 kHz, tuning compensated in the same pass)', () => {
  it('keeps the frequency of a tone and the expected length', async () => {
    const { resampleBy } = await import('./tuning')
    const n = 22050
    const tone = new Float32Array(n)
    for (let i = 0; i < n; i++) tone[i] = Math.sin((2 * Math.PI * 440 * i) / 22050)
    const out = resampleBy(tone, 22050 / 16000)
    expect(out.length).toBe(Math.floor(n / (22050 / 16000)))
    // Zero crossings over the middle second-fraction: 440 Hz at 16 kHz.
    let crossings = 0
    for (let i = 1001; i < 15001; i++) if (out[i - 1] < 0 !== out[i] < 0) crossings++
    expect(crossings / 2 / (14000 / 16000)).toBeCloseTo(440, -1)
    // A +40 cent recording: the combined step lowers it to 440 Hz.
    const sharp = new Float32Array(n)
    const f = 440 * 2 ** (40 / 1200)
    for (let i = 0; i < n; i++) sharp[i] = Math.sin((2 * Math.PI * f * i) / 22050)
    const fixed = resampleBy(sharp, (22050 / 16000) * 2 ** (-40 / 1200))
    let c2 = 0
    for (let i = 1001; i < 15001; i++) if (fixed[i - 1] < 0 !== fixed[i] < 0) c2++
    expect(c2 / 2 / (14000 / 16000)).toBeCloseTo(440, -1)
  })

  it('returns a copy for a unit step', async () => {
    const { resampleBy } = await import('./tuning')
    const x = new Float32Array([1, 2, 3])
    const y = resampleBy(x, 1)
    expect(Array.from(y)).toEqual([1, 2, 3])
    expect(y).not.toBe(x)
  })
})
