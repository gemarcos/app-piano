import { describe, expect, it } from 'vitest'
import { foldInto, gatedLevelDb, inSlices, mixVoice, softLimit, type MixSample } from './mixer'

const RATE = 32000

/** A decaying sine "string" (stereo), like a piano sample with its attack at frame 0. */
function sineSample(freq: number, seconds: number, decay = 1.5): MixSample {
  const n = Math.round(seconds * RATE)
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / RATE) * Math.exp(-i / RATE / decay)
    l[i] = v
    r[i] = 0.5 * v
  }
  return { channels: [l, r], offset: 0 }
}

const stereo = (seconds: number) => [new Float32Array(Math.round(seconds * RATE)), new Float32Array(Math.round(seconds * RATE))]

/** Frequency from upward zero crossings (linear interpolation), over [from, to) frames. */
function zeroCrossingHz(x: Float32Array, from: number, to: number): number {
  let first = -1
  let last = -1
  let count = 0
  for (let i = from + 1; i < to; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const t = i - 1 + x[i - 1] / (x[i - 1] - x[i])
      if (first < 0) first = t
      else count++
      last = t
    }
  }
  return (count / (last - first)) * RATE
}

/** Largest jump between neighbouring frames relative to the largest frame-to-frame change elsewhere. */
function maxStep(x: Float32Array, from: number, to: number): number {
  let m = 0
  for (let i = Math.max(1, from); i < to; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]))
  return m
}

describe('mixVoice', () => {
  it('copies the sample exactly at rate 1 and integer start', () => {
    const s = sineSample(440, 0.5)
    const out = stereo(1)
    mixVoice(out, { sample: s, start: 100, rate: 1, gain: 1, release: Infinity, tau: 1 })
    expect(out[0][100]).toBe(s.channels[0][0])
    expect(out[0][100 + 1234]).toBe(s.channels[0][1234])
    expect(out[1][100 + 1234]).toBe(s.channels[1][1234])
    expect(out[0][99]).toBe(0)
  })

  it('shifts pitch with the playback rate (a semitone up stays within 1 cent)', () => {
    const out = stereo(1)
    mixVoice(out, { sample: sineSample(440, 1.2), start: 0, rate: 2 ** (1 / 12), gain: 1, release: Infinity, tau: 1 })
    const hz = zeroCrossingHz(out[0], 0, RATE * 0.8)
    expect(Math.abs(1200 * Math.log2(hz / (440 * 2 ** (1 / 12))))).toBeLessThan(1)
  })

  it('releases with a smooth exponential decay and never cuts hard', () => {
    const out = stereo(1)
    const tau = 0.05 * RATE
    const release = 0.3 * RATE + 0.37
    mixVoice(out, { sample: sineSample(220, 1, 10), start: 0, rate: 1, gain: 0.8, release, tau })
    const x = out[0]
    // No step at the release larger than the waveform's own slope.
    const natural = maxStep(x, 0.2 * RATE, 0.3 * RATE)
    expect(maxStep(x, 0.3 * RATE - 10, 0.3 * RATE + 10)).toBeLessThanOrEqual(natural * 1.01)
    // Peak envelope one tau after the release is ~1/e of the level before it.
    const peak = (a: number, b: number) => {
      let p = 0
      for (let i = Math.round(a); i < Math.round(b); i++) p = Math.max(p, Math.abs(x[i]))
      return p
    }
    const before = peak(release - 0.01 * RATE, release)
    const after = peak(release + tau - 0.005 * RATE, release + tau + 0.005 * RATE)
    expect(after / before).toBeGreaterThan(0.3)
    expect(after / before).toBeLessThan(0.42)
    // It ends after ~9 tau, by then far below audibility.
    let lastNonZero = 0
    for (let i = 0; i < x.length; i++) if (x[i] !== 0) lastNonZero = i
    expect(lastNonZero).toBeLessThan(release + 9.5 * tau)
    expect(Math.abs(x[lastNonZero])).toBeLessThan(1e-3)
  })

  it('stops quietly at the end of the sample (samples end in silence)', () => {
    const s = sineSample(330, 0.2, 0.02)
    const out = stereo(0.5)
    mixVoice(out, { sample: s, start: 0, rate: 1.03, gain: 1, release: Infinity, tau: 1 })
    let lastNonZero = 0
    for (let i = 0; i < out[0].length; i++) if (out[0][i] !== 0) lastNonZero = i
    expect(Math.abs(out[0][lastNonZero])).toBeLessThan(1e-3)
  })

  it('darkens through its one-pole low-pass: highs drop, lows pass, the filter state flows into the release', () => {
    const rms = (x: Float32Array, a: number, b: number) => {
      let s = 0
      for (let i = a; i < b; i++) s += x[i] * x[i]
      return Math.sqrt(s / (b - a))
    }
    const a = 1 - Math.exp((-2 * Math.PI * 1700) / RATE)
    const level = (freq: number, lowpass?: number) => {
      const out = stereo(1)
      mixVoice(out, { sample: sineSample(freq, 1.2, 100), start: 0, rate: 1, gain: 1, release: 0.6 * RATE, tau: 0.05 * RATE, lowpass })
      return { held: rms(out[0], 0.1 * RATE, 0.5 * RATE), out }
    }
    // One-pole at 1.7 kHz: ~ -0.2 dB at 300 Hz, ~ -12 dB at 6 kHz.
    const low = level(300, a).held / level(300).held
    const high = level(6000, a).held / level(6000).held
    expect(20 * Math.log10(low)).toBeGreaterThan(-0.6)
    expect(20 * Math.log10(high)).toBeLessThan(-9)
    expect(20 * Math.log10(high)).toBeGreaterThan(-14)
    // No step where the held part hands over to the release.
    const x = level(300, a).out[0]
    let worst = 0
    for (let i = 0.55 * RATE; i < 0.65 * RATE; i++) worst = Math.max(worst, Math.abs(x[i] - x[i - 1]))
    let natural = 0
    for (let i = 0.3 * RATE; i < 0.4 * RATE; i++) natural = Math.max(natural, Math.abs(x[i] - x[i - 1]))
    expect(worst).toBeLessThanOrEqual(natural * 1.01)
  })

  it('reads 16-bit sample data through its scale', () => {
    const f = sineSample(440, 0.2)
    const i16 = { channels: f.channels.map((c) => Int16Array.from(c, (v) => Math.round(v * 32767))), offset: 0, scale: 1 / 32767 }
    const a = stereo(0.1)
    const b = stereo(0.1)
    mixVoice(a, { sample: f, start: 0, rate: 1, gain: 1, release: Infinity, tau: 1 })
    mixVoice(b, { sample: i16, start: 0, rate: 1, gain: 1, release: Infinity, tau: 1 })
    let err = 0
    for (let i = 0; i < a[0].length; i++) err = Math.max(err, Math.abs(a[0][i] - b[0][i]))
    expect(err).toBeLessThan(1e-4)
  })

  it('adds voices together and ignores frames outside the buffer', () => {
    const s = sineSample(440, 0.5)
    const out = stereo(0.25)
    mixVoice(out, { sample: s, start: 0, rate: 1, gain: 0.5, release: Infinity, tau: 1 })
    mixVoice(out, { sample: s, start: 0, rate: 1, gain: 0.5, release: Infinity, tau: 1 })
    mixVoice(out, { sample: s, start: RATE, rate: 1, gain: 1, release: Infinity, tau: 1 })
    expect(out[0][500]).toBeCloseTo(s.channels[0][500], 6)
  })
})

describe('softLimit', () => {
  it('leaves normal levels alone and bends peaks below 1', () => {
    const x = new Float32Array([0.5, -0.8, 0.89, 1.2, -3, 10])
    softLimit([x])
    expect(x[0]).toBeCloseTo(0.5, 6)
    expect(x[1]).toBeCloseTo(-0.8, 6)
    expect(x[2]).toBeCloseTo(0.89, 6)
    expect(x[3]).toBeGreaterThan(0.89)
    expect(x[3]).toBeLessThan(1)
    // Far over the top: pinned at full scale, never beyond.
    expect(x[4]).toBeGreaterThanOrEqual(-1)
    expect(x[5]).toBeLessThanOrEqual(1)
    expect(x[5]).toBeGreaterThan(x[3])
  })
})

describe('foldInto', () => {
  it('turns a cycle plus its ring-out into a seamless loop', () => {
    // A note struck near the end of a 0.5 s cycle rings 0.3 s past it.
    const cycle = Math.round(0.5 * RATE)
    const src = stereo(0.8)
    mixVoice(src, { sample: sineSample(261.6, 1, 0.4), start: 0.4 * RATE, rate: 1, gain: 0.7, release: 0.55 * RATE, tau: 0.05 * RATE })
    const dst = stereo(0.5)
    foldInto(dst, src, 0)
    expect(dst[0].length).toBe(cycle)
    // The jump across the wrap (last frame -> first frame) is no bigger than the signal's own steps.
    const wrap = Math.abs(dst[0][0] - dst[0][cycle - 1])
    expect(wrap).toBeLessThanOrEqual(maxStep(dst[0], cycle - 2000, cycle) * 1.01)
    // Without the fold the loop would jump from a sounding note to silence.
    expect(Math.abs(src[0][cycle - 1])).toBeGreaterThan(0.05)
    expect(Math.abs(dst[0][0] - src[0][cycle])).toBeLessThan(1e-6)
  })
})

describe('gatedLevelDb', () => {
  it('measures the power of the sounding part and ignores silence', () => {
    const x = new Float32Array(RATE * 4)
    // Sound from 0.8 s to 2.8 s (whole 400 ms blocks), silence around it.
    for (let i = 0.8 * RATE; i < 2.8 * RATE; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE)
    // 0.5 amplitude sine: power 0.125 -> -9.03 dB, whatever the silence around it.
    expect(gatedLevelDb([x, x], RATE)).toBeCloseTo(-9.03, 1)
    expect(gatedLevelDb([new Float32Array(RATE)], RATE)).toBe(-Infinity)
  })
})

describe('inSlices', () => {
  it('processes every item in order', async () => {
    const seen: number[] = []
    await inSlices(Array.from({ length: 100 }, (_, i) => i), (i) => seen.push(i))
    expect(seen).toEqual(Array.from({ length: 100 }, (_, i) => i))
  })
})
