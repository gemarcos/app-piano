/**
 * Log-mel front end of Onsets and Frames, derived from Magenta.js (music/src/core/audio_utils.ts and
 * music/src/transcription/audio_utils.ts), which is based on google/web-audio-recognition (librosa-compat).
 *
 * @license
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified by the Pauta authors (2026): rewritten for speed with the same arithmetic (16 kHz input, reflect padding,
 * symmetric 2048-point Hann window, hop 512, |FFT|^2, 229 mel bands from 30 Hz with the same filterbank, 10*log10
 * with a floor 80 dB below each frame's peak). One radix-2 FFT handles two frames, the filterbank is applied as a
 * sparse matrix and the output is one flat Float32Array; resampling happens elsewhere (pure code, no WebAudio).
 */
import { FFT_SIZE, HOP, MEL_BINS, MEL_FMIN, SAMPLE_RATE } from './constants'

const TOP_DB = 80
const AMIN = 1e-10
const BINS = FFT_SIZE / 2 + 1

/** Frames produced for `n` samples (librosa center=True: one frame every HOP samples, plus one). */
export function melFrameCount(n: number): number {
  return n > 0 ? Math.floor(n / HOP) + 1 : 0
}

const hzToMel = (hz: number) => 1125.0 * Math.log(1 + hz / 700.0)
const melToHz = (mel: number) => 700.0 * (Math.exp(mel / 1125.0) - 1)

/** Float32 linspace, as Magenta's linearSpace (its values are float32-rounded). */
function linearSpace(start: number, end: number, count: number): Float32Array {
  const delta = (end - start) / (count - 1)
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = start + delta * i
  return out
}

export interface SparseFilterbank {
  /** First FFT bin of each band. */
  start: Int32Array
  /** Offsets into `weights` (length MEL_BINS + 1). */
  offset: Int32Array
  weights: Float32Array
}

let filterbankCache: SparseFilterbank | null = null

/** Magenta's createMelFilterbank (HTK-style mel scale, 2 / bandwidth normalization), stored sparsely. */
export function melFilterbank(): SparseFilterbank {
  if (filterbankCache) return filterbankCache
  const fftFreqs = linearSpace(0, SAMPLE_RATE / 2, BINS)
  const mels = linearSpace(hzToMel(MEL_FMIN), hzToMel(SAMPLE_RATE / 2), MEL_BINS + 2)
  const melFreqs = mels.map((mel) => melToHz(mel))
  const melDiff = new Float32Array(melFreqs.length - 1)
  for (let i = 0; i < melDiff.length; i++) melDiff[i] = melFreqs[i + 1] - melFreqs[i]
  const ramp = new Float32Array(1)
  const start = new Int32Array(MEL_BINS)
  const offset = new Int32Array(MEL_BINS + 1)
  const all: number[] = []
  for (let i = 0; i < MEL_BINS; i++) {
    const enorm = 2.0 / (melFreqs[2 + i] - melFreqs[i])
    let first = -1
    const row: number[] = []
    for (let j = 0; j < BINS; j++) {
      ramp[0] = melFreqs[i] - fftFreqs[j]
      const lower = -ramp[0] / melDiff[i]
      ramp[0] = melFreqs[i + 2] - fftFreqs[j]
      const upper = ramp[0] / melDiff[i + 1]
      // Float32 storage at each step, like Magenta's Float32Array pipeline.
      const weight = Math.fround(Math.fround(Math.max(0, Math.min(lower, upper))) * enorm)
      if (weight > 0) {
        if (first < 0) first = j
        // Keep interior zeros (none in practice) so the run stays contiguous.
        while (first + row.length < j) row.push(0)
        row.push(weight)
      }
    }
    start[i] = Math.max(0, first)
    offset[i] = all.length
    for (const w of row) all.push(w)
  }
  offset[MEL_BINS] = all.length
  filterbankCache = { start, offset, weights: Float32Array.from(all) }
  return filterbankCache
}

interface FftTables {
  cos: Float64Array
  sin: Float64Array
  rev: Uint32Array
  window: Float64Array
}

let tables: FftTables | null = null

function fftTables(): FftTables {
  if (tables) return tables
  const n = FFT_SIZE
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n)
    sin[k] = Math.sin((2 * Math.PI * k) / n)
  }
  const bits = Math.log2(n)
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  // Magenta's hannWindow is symmetric (denominator length - 1) and stored as float32.
  const window = new Float64Array(n)
  for (let i = 0; i < n; i++) window[i] = Math.fround(0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1))))
  tables = { cos, sin, rev, window }
  return tables
}

/** In-place iterative radix-2 FFT (input already in bit-reversed order). */
function fftInPlace(re: Float64Array, im: Float64Array, t: FftTables) {
  const n = re.length
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const step = n / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const c = t.cos[w]
        const s = t.sin[w]
        const a = i + k
        const b = a + half
        const tr = re[b] * c + im[b] * s
        const ti = im[b] * c - re[b] * s
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
}

/** Reflect-padded sample (numpy 'reflect', as Magenta's padReflect) at padded index `i`. */
function padded(samples: Float32Array, i: number, pad: number): number {
  const n = samples.length
  let j = i - pad
  if (j < 0) j = -j
  if (j >= n) j = 2 * (n - 1) - j
  return j >= 0 && j < n ? samples[j] : 0
}

/**
 * Log-mel spectrogram of 16 kHz mono samples: Float32Array [frames x MEL_BINS] (row-major), frames = melFrameCount(n).
 * Numerically equivalent to Magenta.js preprocessAudio() fed the same 16 kHz signal (float32 rounding apart).
 */
export function logMel(samples: Float32Array): Float32Array {
  const frames = melFrameCount(samples.length)
  const out = new Float32Array(frames * MEL_BINS)
  if (!frames) return out
  const t = fftTables()
  const fb = melFilterbank()
  const n = FFT_SIZE
  const pad = n / 2
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const powA = new Float64Array(BINS)
  const powB = new Float64Array(BINS)
  const safe = samples.length > n

  const load = (frame: number, target: Float64Array) => {
    const base = frame * HOP
    if (safe && base >= pad && base + n - pad <= samples.length) {
      const off = base - pad
      for (let i = 0; i < n; i++) target[t.rev[i]] = samples[off + i] * t.window[i]
    } else {
      for (let i = 0; i < n; i++) target[t.rev[i]] = padded(samples, base + i, pad) * t.window[i]
    }
  }

  const finish = (frame: number, pow: Float64Array) => {
    const row = frame * MEL_BINS
    let peak = -Infinity
    for (let m = 0; m < MEL_BINS; m++) {
      const s = fb.start[m]
      let acc = 0
      for (let o = fb.offset[m], k = s; o < fb.offset[m + 1]; o++, k++) acc += pow[k] * fb.weights[o]
      const db = 10.0 * Math.log10(Math.max(AMIN, Math.fround(acc)))
      out[row + m] = db
      if (out[row + m] > peak) peak = out[row + m]
    }
    const floor = peak - TOP_DB
    for (let m = 0; m < MEL_BINS; m++) if (out[row + m] < floor) out[row + m] = floor
  }

  for (let f = 0; f < frames; f += 2) {
    const pair = f + 1 < frames
    // Two real frames in one complex FFT: frame f in the real part, frame f + 1 in the imaginary part.
    load(f, re)
    if (pair) load(f + 1, im)
    else im.fill(0)
    fftInPlace(re, im, t)
    for (let k = 0; k < BINS; k++) {
      const nk = (n - k) & (n - 1)
      const ar = 0.5 * (re[k] + re[nk])
      const ai = 0.5 * (im[k] - im[nk])
      const br = 0.5 * (im[k] + im[nk])
      const bi = 0.5 * (re[nk] - re[k])
      // Magenta stores the complex STFT and then |X| as float32 before squaring.
      powA[k] = Math.fround(Math.fround(Math.sqrt(Math.fround(ar) ** 2 + Math.fround(ai) ** 2)) ** 2)
      powB[k] = Math.fround(Math.fround(Math.sqrt(Math.fround(br) ** 2 + Math.fround(bi) ** 2)) ** 2)
    }
    finish(f, powA)
    if (pair) finish(f + 1, powB)
  }
  return out
}
