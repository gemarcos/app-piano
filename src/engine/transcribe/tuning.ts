// Global tuning estimation and compensation (pure, no tfjs). Piano videos are often detuned (an old piano, A = 432 Hz)
// or sped up with their pitch (TikTok-style 1.1x = +165 cents). Basic Pitch has one output bin per semitone: audio
// that sits 30-45 cents off splits its energy between two bins and most notes are simply not detected (benchmark:
// recall 17-51 %). We estimate the offset from spectral peaks and resample the input so the notes land on semitones.
//
// estimateTuning: Hann-windowed FFT frames, quadratic interpolation of local maxima (60 Hz-1.6 kHz, where piano
// partials are close to harmonic), each peak's deviation from the nearest equal-tempered pitch (A4 = 440 Hz) goes into
// a circular histogram (1-cent bins, weighted by amplitude, smoothed); the mode, refined by a circular mean around it,
// is the offset. Inharmonic upper partials (5th: -14 cents, 7th: -31 cents) are weak and spread out; the fundamental,
// octave and fifth partials agree, so the mode is robust.

export interface TuningEstimate {
  /** Offset of the audio from A4 = 440 Hz equal temperament, cents in [-50, 50). */
  cents: number
  /** 0..1: share of the peak weight within +-12 cents of the estimate (0.25 is noise-like, > 0.5 is clear). */
  confidence: number
  /** Spectral peaks used. */
  peaks: number
}

export interface TuningOptions {
  sampleRate?: number
  /** Analyse at most this many seconds, spread over the whole input (default 90). */
  maxSeconds?: number
  frameSize?: number
}

const TWO_PI = 2 * Math.PI

/** In-place iterative radix-2 complex FFT. */
function fft(re: Float64Array, im: Float64Array, cos: Float64Array, sin: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const step = n / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step]
        const s = sin[k * step]
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

/** Deviation of a frequency from the nearest equal-tempered pitch (A4 = 440 Hz), cents in [-50, 50). */
export function centsDeviation(hz: number): number {
  const c = 1200 * Math.log2(hz / 440)
  return ((((c + 50) % 100) + 100) % 100) - 50
}

export function estimateTuning(samples: Float32Array, options: TuningOptions = {}): TuningEstimate {
  const sr = options.sampleRate ?? 22050
  const n = options.frameSize ?? (sr > 30000 ? 8192 : 4096)
  const hop = n / 2
  const histogram = new Float64Array(100)
  const empty: TuningEstimate = { cents: 0, confidence: 0, peaks: 0 }
  if (samples.length < n) return empty
  const totalFrames = Math.floor((samples.length - n) / hop) + 1
  const maxFrames = Math.max(1, Math.floor(((options.maxSeconds ?? 90) * sr) / hop))
  const stride = Math.max(1, totalFrames / maxFrames)
  const win = new Float64Array(n)
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / n)
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((TWO_PI * k) / n)
    sin[k] = Math.sin((TWO_PI * k) / n)
  }
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const db = new Float64Array(n / 2)
  const kMin = Math.max(3, Math.floor((60 * n) / sr))
  const kMax = Math.min(n / 2 - 3, Math.ceil((1600 * n) / sr))
  let peaks = 0
  const found: { k: number; amp: number }[] = []
  for (let f = 0; f < totalFrames; f += stride) {
    const start = Math.floor(f) * hop
    let energy = 0
    for (let i = 0; i < n; i++) {
      const v = samples[start + i]
      energy += v * v
      re[i] = v * win[i]
      im[i] = 0
    }
    if (energy / n < 1e-7) continue // silence
    fft(re, im, cos, sin)
    let frameMax = -Infinity
    for (let k = 0; k < n / 2; k++) {
      db[k] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-20)
      if (k >= kMin && k <= kMax && db[k] > frameMax) frameMax = db[k]
    }
    found.length = 0
    for (let k = kMin; k <= kMax; k++) {
      const v = db[k]
      if (v < frameMax - 36) continue
      if (!(v > db[k - 1] && v >= db[k + 1] && v > db[k - 2] && v >= db[k + 2])) continue
      found.push({ k, amp: v })
    }
    found.sort((a, b) => b.amp - a.amp)
    for (const { k } of found.slice(0, 24)) {
      const a = db[k - 1]
      const b = db[k]
      const c = db[k + 1]
      const denom = a - 2 * b + c
      const delta = denom < 0 ? (0.5 * (a - c)) / denom : 0
      if (Math.abs(delta) > 0.5) continue
      const hz = ((k + delta) * sr) / n
      const dev = centsDeviation(hz)
      // Linear amplitude, compressed so a few loud partials cannot outvote everything else.
      const weight = Math.pow(10, (b - frameMax) / 40)
      const center = dev + 50
      for (let d = -3; d <= 3; d++) {
        const bin = (((Math.round(center) + d) % 100) + 100) % 100
        histogram[bin] += weight * Math.exp(-(d * d) / 4.5)
      }
      peaks++
    }
  }
  const total = histogram.reduce((s, v) => s + v, 0)
  if (!(total > 0) || peaks < 20) return { ...empty, peaks }
  let best = 0
  for (let i = 1; i < 100; i++) if (histogram[i] > histogram[best]) best = i
  // Circular mean within +-12 cents of the mode.
  let sx = 0
  let sy = 0
  let inside = 0
  for (let d = -12; d <= 12; d++) {
    const bin = (((best + d) % 100) + 100) % 100
    const angle = (TWO_PI * (bin - 50)) / 100
    sx += histogram[bin] * Math.cos(angle)
    sy += histogram[bin] * Math.sin(angle)
    inside += histogram[bin]
  }
  let cents = (Math.atan2(sy, sx) * 100) / TWO_PI
  if (cents >= 50) cents -= 100
  if (cents < -50) cents += 100
  return { cents: Math.round(cents * 10) / 10, confidence: inside / total, peaks }
}

const HALF_TAPS = 12
const PHASES = 256
/** Interpolation tables by cutoff (retune and the piano model's 22.05 -> 16 kHz resampling use different ones). */
const kernelCache = new Map<number, Float32Array>()

function besselI0(x: number): number {
  let sum = 1
  let term = 1
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) ** 2
    sum += term
    if (term < 1e-12 * sum) break
  }
  return sum
}

function kernel(cutoff: number): Float32Array {
  const key = Math.round(cutoff * 1e6) / 1e6
  const cached = kernelCache.get(key)
  if (cached) return cached
  const width = 2 * HALF_TAPS
  const table = new Float32Array((PHASES + 1) * width)
  const beta = 7.5
  const i0 = besselI0(beta)
  for (let p = 0; p <= PHASES; p++) {
    const frac = p / PHASES
    for (let j = 0; j < width; j++) {
      const t = j - (HALF_TAPS - 1) - frac
      const u = t / HALF_TAPS
      const w = Math.abs(u) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - u * u)) / i0
      const s = t === 0 ? 1 : Math.sin(Math.PI * cutoff * t) / (Math.PI * cutoff * t)
      table[p * width + j] = cutoff * s * w
    }
  }
  if (kernelCache.size >= 4) kernelCache.clear()
  kernelCache.set(key, table)
  return table
}

/** Time-scale factor applied by retune(): note times found in the retuned audio are multiplied by it. */
export function retuneFactor(cents: number): number {
  return 2 ** (-cents / 1200)
}

/**
 * Shifts the pitch by -cents (same sample rate) with a band-limited interpolator, which also stretches time by
 * 1 / retuneFactor(cents): a note at t seconds of the result was at t * retuneFactor(cents) in the input.
 */
export function retune(samples: Float32Array, cents: number): Float32Array {
  return resampleBy(samples, retuneFactor(cents))
}

/**
 * Band-limited resampling that reads `step` input samples per output sample (Kaiser-windowed sinc, cutoff at 95 % of
 * the lower Nyquist rate): output sample n is the input at position n * step. 22 050 -> 16 000 Hz is
 * step = 22050 / 16000; multiplying by retuneFactor(cents) also compensates the tuning in the same pass.
 */
export function resampleBy(samples: Float32Array, step: number): Float32Array {
  if (!(step > 0) || Math.abs(step - 1) < 1e-6) return samples.slice()
  const table = kernel(Math.min(1, 1 / step) * 0.95)
  const width = 2 * HALF_TAPS
  const out = new Float32Array(Math.floor(samples.length / step))
  const last = samples.length
  for (let n = 0; n < out.length; n++) {
    const pos = n * step
    const i0 = Math.floor(pos)
    const fp = (pos - i0) * PHASES
    const p = Math.floor(fp)
    const w = fp - p
    const rowA = p * width
    const rowB = rowA + width
    const base = i0 - (HALF_TAPS - 1)
    let acc = 0
    if (base >= 0 && base + width <= last) {
      for (let j = 0; j < width; j++) {
        const ka = table[rowA + j]
        acc += samples[base + j] * (ka + (table[rowB + j] - ka) * w)
      }
    } else {
      for (let j = 0; j < width; j++) {
        const idx = base + j
        if (idx < 0 || idx >= last) continue
        const ka = table[rowA + j]
        acc += samples[idx] * (ka + (table[rowB + j] - ka) * w)
      }
    }
    out[n] = acc
  }
  return out
}

/** Corrections smaller than this are not worth a resample (Basic Pitch is unaffected within +-10 cents). */
export const TUNING_MIN_CENTS = 8
/** Below this confidence the histogram is too flat to trust (noise, non-tonal input). */
export const TUNING_MIN_CONFIDENCE = 0.35

/** Offset to compensate (0 = leave the audio alone). */
export function tuningCorrection(estimate: TuningEstimate): number {
  if (estimate.confidence < TUNING_MIN_CONFIDENCE || Math.abs(estimate.cents) < TUNING_MIN_CENTS) return 0
  return estimate.cents
}
