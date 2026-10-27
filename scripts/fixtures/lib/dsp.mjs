// Small offline DSP toolkit for the fixture generators (Node, no dependencies): FFT convolution, RBJ biquads,
// windowed-sinc resampling, dynamics, noise, synthetic impulse responses and 16-bit WAV I/O.
import { readFileSync } from 'node:fs'

/** Deterministic PRNG (mulberry32), returns floats in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal sample (Box-Muller) from a uniform generator. */
export function gauss(rand) {
  const u = Math.max(1e-12, rand())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** In-place iterative radix-2 complex FFT (length must be a power of two). */
export function fft(re, im, inverse = false) {
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
    const ang = ((inverse ? 2 : -2) * Math.PI) / len
    const cosT = new Float64Array(half)
    const sinT = new Float64Array(half)
    for (let k = 0; k < half; k++) {
      cosT[k] = Math.cos(ang * k)
      sinT[k] = Math.sin(ang * k)
    }
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const a = i + k
        const b = a + half
        const tr = re[b] * cosT[k] - im[b] * sinT[k]
        const ti = re[b] * sinT[k] + im[b] * cosT[k]
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
  }
}

/** Linear convolution x * h (one large FFT), truncated to x.length + tail samples. */
export function convolve(x, h, tail = h.length) {
  const outLen = x.length + tail
  let n = 1
  while (n < x.length + h.length) n <<= 1
  const ar = new Float64Array(n)
  const ai = new Float64Array(n)
  const br = new Float64Array(n)
  const bi = new Float64Array(n)
  ar.set(x)
  br.set(h)
  fft(ar, ai)
  fft(br, bi)
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i]
    ai[i] = ar[i] * bi[i] + ai[i] * br[i]
    ar[i] = r
  }
  fft(ar, ai, true)
  return Float32Array.from(ar.subarray(0, outLen))
}

/** RBJ cookbook biquad coefficients. type: lowpass | highpass | peaking | lowshelf | highshelf. */
export function biquad(type, sr, freq, q = Math.SQRT1_2, gainDb = 0) {
  const w = (2 * Math.PI * freq) / sr
  const cw = Math.cos(w)
  const sw = Math.sin(w)
  const alpha = sw / (2 * q)
  const A = 10 ** (gainDb / 40)
  let b0, b1, b2, a0, a1, a2
  switch (type) {
    case 'lowpass':
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
      break
    case 'highpass':
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
      break
    case 'peaking':
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
      break
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 - (A - 1) * cw + s); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s)
      a0 = A + 1 + (A - 1) * cw + s; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s
      break
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s)
      a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s
      break
    }
    default:
      throw new Error(`unknown biquad ${type}`)
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/** Applies a biquad in place (direct form I). */
export function filter(x, c) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i]
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    x2 = x1; x1 = x0; y2 = y1; y1 = y0
    x[i] = y0
  }
  return x
}

function besselI0(x) {
  let sum = 1, term = 1
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) ** 2
    sum += term
    if (term < 1e-12 * sum) break
  }
  return sum
}

const SINC_HALF = 24
const SINC_PHASES = 1024
const kernelCache = new Map()
/** Kaiser-windowed sinc table for cutoff `fc` (fraction of the input Nyquist). */
function sincKernel(fc) {
  const key = fc.toFixed(5)
  if (kernelCache.has(key)) return kernelCache.get(key)
  const beta = 8.6
  const width = 2 * SINC_HALF
  const table = new Float64Array((SINC_PHASES + 1) * width)
  const i0b = besselI0(beta)
  for (let p = 0; p <= SINC_PHASES; p++) {
    const frac = p / SINC_PHASES
    for (let k = 0; k < width; k++) {
      const t = k - (SINC_HALF - 1) - frac
      const u = t / SINC_HALF
      const win = Math.abs(u) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - u * u)) / i0b
      const s = t === 0 ? 1 : Math.sin(Math.PI * fc * t) / (Math.PI * fc * t)
      table[p * width + k] = fc * s * win
    }
  }
  kernelCache.set(key, table)
  return table
}

/**
 * Reads `x` at positions start + n * step (n = 0 .. outLength-1) with a band-limited interpolator:
 * step > 1 compresses time (speeds up, raises pitch) and low-passes below the new Nyquist.
 */
export function resample(x, step, outLength = Math.floor(x.length / step), start = 0) {
  const fc = Math.min(1, 1 / step) * 0.96
  const table = sincKernel(fc)
  const width = 2 * SINC_HALF
  const out = new Float32Array(Math.max(0, outLength))
  for (let n = 0; n < out.length; n++) {
    const pos = start + n * step
    const i0 = Math.floor(pos)
    const fp = (pos - i0) * SINC_PHASES
    const p = Math.floor(fp)
    const w = fp - p
    const rowA = p * width
    const rowB = rowA + width
    let acc = 0
    const base = i0 - (SINC_HALF - 1)
    for (let k = 0; k < width; k++) {
      const idx = base + k
      if (idx < 0 || idx >= x.length) continue
      acc += x[idx] * (table[rowA + k] + (table[rowB + k] - table[rowA + k]) * w)
    }
    out[n] = acc
  }
  return out
}

/** Pink-ish noise (Paul Kellet's economy filter), roughly unit RMS. */
export function pinkNoise(n, rand) {
  const out = new Float32Array(n)
  let b0 = 0, b1 = 0, b2 = 0
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1
    b0 = 0.99765 * b0 + w * 0.099046
    b1 = 0.963 * b1 + w * 0.2965164
    b2 = 0.57 * b2 + w * 1.0526913
    out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.35
  }
  return out
}

export function rms(x, from = 0, to = x.length) {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, to - from))
}

export function peak(x) {
  let p = 0
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]))
  return p
}

export function normalize(x, target) {
  const p = peak(x)
  if (p > 0) for (let i = 0; i < x.length; i++) x[i] *= target / p
  return x
}

/**
 * Synthetic room / hall impulse response: a few early reflections plus an exponentially decaying noise tail whose
 * high band decays faster (air and wall absorption). `rt60` seconds, `predelay` seconds.
 */
export function impulseResponse(sr, { rt60, predelay = 0.012, early = [], brightness = 0.5, seed = 1 }) {
  const rand = rng(seed)
  const len = Math.ceil((predelay + rt60 * 1.1) * sr)
  const low = new Float32Array(len)
  const high = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    low[i] = gauss(rand)
    high[i] = gauss(rand)
  }
  filter(low, biquad('lowpass', sr, 2500, 0.7))
  filter(high, biquad('highpass', sr, 2500, 0.7))
  const ir = new Float32Array(len)
  const pre = Math.round(predelay * sr)
  const kLow = 6.9078 / (rt60 * sr)
  const kHigh = 6.9078 / (rt60 * 0.45 * sr)
  const fade = Math.round(0.006 * sr)
  for (let i = pre; i < len; i++) {
    const t = i - pre
    const onset = t < fade ? t / fade : 1
    ir[i] = onset * (low[i] * Math.exp(-kLow * t) + brightness * high[i] * Math.exp(-kHigh * t))
  }
  for (const [delay, gain] of early) {
    const at = Math.round(delay * sr)
    if (at < len) ir[at] += gain * (rand() < 0.5 ? -1 : 1) * 6
  }
  // Unit energy, so the wet level is set by the caller.
  const e = Math.sqrt(ir.reduce((s, v) => s + v * v, 0))
  for (let i = 0; i < len; i++) ir[i] /= e
  return ir
}

/** dry + wet * (x conv ir), wet level in dB relative to the dry RMS; returns a new array including the tail. */
export function reverb(x, ir, wetDb, tailSeconds, sr) {
  const tail = Math.round(tailSeconds * sr)
  const wet = convolve(x, ir, tail)
  const g = (rms(x) / Math.max(1e-9, rms(wet, 0, x.length))) * 10 ** (wetDb / 20)
  const out = new Float32Array(x.length + tail)
  for (let i = 0; i < out.length; i++) out[i] = (i < x.length ? x[i] : 0) + g * wet[i]
  return out
}

/** Feed-forward RMS compressor (dB domain), in place. */
export function compress(x, sr, { threshold = -24, ratio = 3, attack = 0.01, release = 0.2, makeup = 0, knee = 6 }) {
  const aA = Math.exp(-1 / (attack * sr))
  const aR = Math.exp(-1 / (release * sr))
  const aRms = Math.exp(-1 / (0.005 * sr))
  let env = 0
  let gainDb = 0
  for (let i = 0; i < x.length; i++) {
    env = aRms * env + (1 - aRms) * x[i] * x[i]
    const level = 10 * Math.log10(env + 1e-12)
    const over = level - threshold
    let target = 0
    if (over > knee / 2) target = -over * (1 - 1 / ratio)
    else if (over > -knee / 2) target = (-(1 - 1 / ratio) * (over + knee / 2) ** 2) / (2 * knee)
    gainDb = target < gainDb ? aA * gainDb + (1 - aA) * target : aR * gainDb + (1 - aR) * target
    x[i] *= 10 ** ((gainDb + makeup) / 20)
  }
  return x
}

/** Look-ahead peak limiter (ceiling linear), in place. */
export function limit(x, sr, ceiling = 0.89, lookahead = 0.005, release = 0.08) {
  const la = Math.round(lookahead * sr)
  const aR = Math.exp(-1 / (release * sr))
  const out = new Float32Array(x.length)
  let gain = 1
  // Running max over the look-ahead window (simple O(n * la) is fine for short fixtures).
  for (let i = 0; i < x.length; i++) {
    let m = 0
    for (let k = i; k < Math.min(x.length, i + la); k++) m = Math.max(m, Math.abs(x[k]))
    const need = m > ceiling ? ceiling / m : 1
    gain = need < gain ? need : aR * gain + (1 - aR) * need
    out[i] = x[i] * gain
  }
  x.set(out)
  return x
}

/** Soft clipper (small loudspeaker driven hard): tanh with normalized unity small-signal gain. */
export function softClip(x, drive = 1.5) {
  const n = Math.tanh(drive)
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(drive * x[i]) / n
  return x
}

/** Reads a 16-bit PCM WAV (any channel count) into mono Float32 (channel average) + sample rate. */
export function readWavMono(file) {
  const b = readFileSync(file)
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`not a WAV: ${file}`)
  let off = 12
  let fmt = null
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4)
    const size = b.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ') {
      fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), sr: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) }
    } else if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16) throw new Error(`unsupported WAV format in ${file}`)
      const frames = Math.floor(size / (2 * fmt.channels))
      const out = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        let s = 0
        for (let c = 0; c < fmt.channels; c++) s += b.readInt16LE(body + 2 * (i * fmt.channels + c))
        out[i] = s / (32768 * fmt.channels)
      }
      return { samples: out, sr: fmt.sr }
    }
    off = body + size + (size & 1)
  }
  throw new Error(`no data chunk in ${file}`)
}

/** Float32 mono -> 16-bit PCM WAV bytes. */
export function wavBytes(samples, sr) {
  const bytes = Buffer.alloc(44 + samples.length * 2)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(36 + samples.length * 2, 4)
  bytes.write('WAVEfmt ', 8, 'ascii')
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sr, 24)
  bytes.writeUInt32LE(sr * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36, 'ascii')
  bytes.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  return bytes
}
