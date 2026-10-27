import { describe, expect, it } from 'vitest'
import { HOP, MEL_BINS, SAMPLE_RATE } from './constants'
import { logMel, melFilterbank, melFrameCount } from './mel'

/**
 * Straight port of Magenta.js preprocessAudio (core/audio_utils.ts: padReflect, symmetric Hann, naive DFT instead of
 * fft.js, magnitude squared, createMelFilterbank, powerToDb with an 80 dB floor per frame), on short inputs only.
 */
function magentaMel(y: Float32Array): Float32Array[] {
  const nFft = 2048
  const pad = nFft / 2
  const padded = new Float32Array(y.length + 2 * pad)
  padded.set(y, pad)
  for (let i = 0; i < pad; i++) {
    padded[i] = padded[2 * pad - i]
    padded[padded.length - i - 1] = padded[padded.length - 2 * pad + i - 1]
  }
  const win = new Float32Array(nFft)
  for (let i = 0; i < nFft; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (nFft - 1)))
  const frames = Math.floor((padded.length - nFft) / HOP) + 1
  const lin = (a: number, b: number, n: number) => {
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = a + ((b - a) / (n - 1)) * i
    return out
  }
  const hzToMel = (hz: number) => 1125.0 * Math.log(1 + hz / 700.0)
  const melToHz = (mel: number) => 700.0 * (Math.exp(mel / 1125.0) - 1)
  const fftFreqs = lin(0, SAMPLE_RATE / 2, nFft / 2 + 1)
  const melFreqs = lin(hzToMel(30), hzToMel(SAMPLE_RATE / 2), MEL_BINS + 2).map(melToHz)
  const diff = new Float32Array(melFreqs.length - 1).map((_, i) => melFreqs[i + 1] - melFreqs[i])
  const weights = Array.from({ length: MEL_BINS }, (_, i) => {
    const row = new Float32Array(fftFreqs.length)
    for (let j = 0; j < fftFreqs.length; j++) {
      const lower = -Math.fround(melFreqs[i] - fftFreqs[j]) / diff[i]
      const upper = Math.fround(melFreqs[i + 2] - fftFreqs[j]) / diff[i + 1]
      row[j] = Math.max(0, Math.min(lower, upper))
    }
    const enorm = 2.0 / (melFreqs[2 + i] - melFreqs[i])
    return row.map((v) => v * enorm)
  })
  const out: Float32Array[] = []
  for (let f = 0; f < frames; f++) {
    const power = new Float32Array(nFft / 2 + 1)
    for (let k = 0; k <= nFft / 2; k++) {
      let re = 0
      let im = 0
      for (let n = 0; n < nFft; n++) {
        const v = padded[f * HOP + n] * win[n]
        const a = (2 * Math.PI * ((k * n) % nFft)) / nFft
        re += v * Math.cos(a)
        im -= v * Math.sin(a)
      }
      power[k] = Math.fround(Math.sqrt(Math.fround(re) ** 2 + Math.fround(im) ** 2)) ** 2
    }
    const row = new Float32Array(MEL_BINS)
    for (let m = 0; m < MEL_BINS; m++) {
      let acc = 0
      for (let k = 0; k < power.length; k++) acc += Math.fround(power[k] * weights[m][k])
      row[m] = 10 * Math.log10(Math.max(1e-10, acc))
    }
    const peak = row.reduce((a, b) => Math.max(a, b))
    out.push(row.map((v) => Math.max(v, peak - 80)))
  }
  return out
}

function testSignal(n: number): Float32Array {
  const y = new Float32Array(n)
  let seed = 7
  for (let i = 0; i < n; i++) {
    seed = (seed * 16807) % 2147483647
    const t = i / SAMPLE_RATE
    y[i] = 0.5 * Math.sin(2 * Math.PI * 261.63 * t) * Math.exp(-3 * t) + 0.2 * Math.sin(2 * Math.PI * (110 + 900 * t) * t) + 0.01 * (seed / 2147483647 - 0.5)
  }
  return y
}

describe('Onsets and Frames log-mel front end', () => {
  it('counts frames like librosa center=True (one per hop, plus one)', () => {
    expect(melFrameCount(0)).toBe(0)
    expect(melFrameCount(1)).toBe(1)
    expect(melFrameCount(HOP - 1)).toBe(1)
    expect(melFrameCount(HOP)).toBe(2)
    expect(melFrameCount(SAMPLE_RATE)).toBe(32)
  })

  it('builds 229 contiguous triangular bands from 30 Hz up, normalized like Magenta', () => {
    const fb = melFilterbank()
    expect(fb.start.length).toBe(MEL_BINS)
    expect(fb.offset[MEL_BINS]).toBe(fb.weights.length)
    for (let m = 1; m < MEL_BINS; m++) expect(fb.start[m]).toBeGreaterThanOrEqual(fb.start[m - 1])
    expect(fb.start[0]).toBeGreaterThanOrEqual(3) // 30 Hz / 7.8125 Hz per bin
    for (const w of fb.weights) expect(w).toBeGreaterThanOrEqual(0)
  })

  it('matches a direct port of Magenta.js preprocessAudio within float32 rounding', () => {
    const y = testSignal(Math.round(0.3 * SAMPLE_RATE))
    const reference = magentaMel(y)
    const mel = logMel(y)
    expect(mel.length).toBe(reference.length * MEL_BINS)
    let max = 0
    reference.forEach((row, f) => row.forEach((v, m) => (max = Math.max(max, Math.abs(v - mel[f * MEL_BINS + m])))))
    expect(max).toBeLessThan(2e-3)
  }, 120_000)

  it('gives the -100 dB floor for silence and stays finite', () => {
    const mel = logMel(new Float32Array(SAMPLE_RATE / 2))
    for (const v of mel) expect(v).toBeCloseTo(-100, 4)
  })
})
