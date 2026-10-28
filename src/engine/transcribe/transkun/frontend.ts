/**
 * Transkun V2 front end (Yujia Yan, github.com/Yujia-Yan/Transkun, MIT License, Copyright (c) 2021 Yujia Yan),
 * reimplemented for the Pauta app (2026): makeFrame (window 4096, hop 1024, half-window left padding), the
 * per-segment gain normalization of processFramesBatch (mean and unbiased std of the framed samples), the six
 * analysis windows (Hann + five learned Gaussian windows, shipped in frontend.json), an orthonormal real FFT, power,
 * the torchaudio mel matrix (229 bands, sparse in frontend.json) and the log scaling (log(mel + eps) - log eps) / -log eps.
 * Output [T, 229, 6] row-major, the layout of the backbone input. Pure code, no ONNX.
 */

export interface FrontendSpec {
  fs: number
  hop: number
  window: number
  segmentSeconds: number
  hopSeconds: number
  /** Frames per segment (691). */
  frames: number
  /** Output symbols: -64 sustain pedal, -67 soft pedal, then MIDI 21..108. */
  symbols: number[]
  eps: number
  windows: number[][]
  mel: { start: number; w: number[] }[]
}

export interface Frontend {
  spec: FrontendSpec
  windows: Float64Array[]
  melStart: Int32Array
  melOffset: Int32Array
  melWeights: Float64Array
}

export const MELS = 229
export const WINS = 6

export function createFrontend(spec: FrontendSpec): Frontend {
  const melStart = new Int32Array(spec.mel.length)
  const melOffset = new Int32Array(spec.mel.length + 1)
  const all: number[] = []
  spec.mel.forEach((b, i) => {
    melStart[i] = b.start
    melOffset[i] = all.length
    for (const w of b.w) all.push(w)
  })
  melOffset[spec.mel.length] = all.length
  return { spec, windows: spec.windows.map((w) => Float64Array.from(w)), melStart, melOffset, melWeights: Float64Array.from(all) }
}

interface FftTables {
  n: number
  /** Twiddles of every stage, contiguous: stage with half-size h starts at h - 1 (cos, then -sin). */
  cos: Float64Array
  sin: Float64Array
  rev: Uint32Array
}

let fftCache: FftTables | null = null

function tables(n: number): FftTables {
  if (fftCache && fftCache.n === n) return fftCache
  const cos = new Float64Array(n)
  const sin = new Float64Array(n)
  for (let half = 1; half < n; half <<= 1)
    for (let k = 0; k < half; k++) {
      cos[half - 1 + k] = Math.cos((Math.PI * k) / half)
      sin[half - 1 + k] = Math.sin((Math.PI * k) / half)
    }
  const bits = Math.log2(n)
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  fftCache = { n, cos, sin, rev }
  return fftCache
}

/** In-place forward complex FFT of bit-reversed input (radix 2, first two stages without multiplications). */
function fft(re: Float64Array, im: Float64Array, t: FftTables) {
  const n = re.length
  // Stages 1 and 2 together (twiddles 1 and -i).
  for (let i = 0; i < n; i += 4) {
    const r0 = re[i], r1 = re[i + 1], r2 = re[i + 2], r3 = re[i + 3]
    const i0 = im[i], i1 = im[i + 1], i2 = im[i + 2], i3 = im[i + 3]
    const ar = r0 + r1, ai = i0 + i1, br = r0 - r1, bi = i0 - i1
    const cr = r2 + r3, ci = i2 + i3, dr = r2 - r3, di = i2 - i3
    re[i] = ar + cr
    im[i] = ai + ci
    re[i + 2] = ar - cr
    im[i + 2] = ai - ci
    // (dr, di) * (-i) = (di, -dr)
    re[i + 1] = br + di
    im[i + 1] = bi - dr
    re[i + 3] = br - di
    im[i + 3] = bi + dr
  }
  for (let half = 4; half < n; half <<= 1) {
    const len = half << 1
    const off = half - 1
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const c = t.cos[off + k]
        const s = t.sin[off + k]
        const a = i + k
        const b = a + half
        const xr = re[b]
        const xi = im[b]
        const tr = xr * c + xi * s
        const ti = xi * c - xr * s
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
}

/** Raw (un-normalized) spectra of frames shared with the next segment, keyed by their frame index there. */
export type SpectrumCarry = Map<number, Float32Array>

let windowSpectra: { fe: Frontend; spec: Float32Array } | null = null

/** Spectra of the analysis windows themselves (the gain normalization subtracts mean * FFT(window)). */
function windowSpectrum(fe: Frontend): Float32Array {
  if (windowSpectra?.fe === fe) return windowSpectra.spec
  const W = fe.spec.window
  const spec = new Float32Array(WINS * (W / 2 + 1) * 2)
  rawSpectrum(fe, new Float64Array(W).fill(1), spec)
  windowSpectra = { fe, spec }
  return spec
}

const scratch = { re: new Float64Array(0), im: new Float64Array(0) }

/** Complex spectra [WINS][bins][re, im] of one frame of W un-normalized samples. */
function rawSpectrum(fe: Frontend, frame: Float64Array, out: Float32Array) {
  const W = fe.spec.window
  const t = tables(W)
  const bins = W / 2 + 1
  if (scratch.re.length !== W) {
    scratch.re = new Float64Array(W)
    scratch.im = new Float64Array(W)
  }
  const { re, im } = scratch
  // Two windows per complex FFT (one in the real part, one in the imaginary part).
  for (let w = 0; w < WINS; w += 2) {
    const wa = fe.windows[w]
    const wb = fe.windows[w + 1]
    for (let i = 0; i < W; i++) {
      const v = frame[i]
      re[t.rev[i]] = v * wa[i]
      im[t.rev[i]] = v * wb[i]
    }
    fft(re, im, t)
    const oa = w * bins * 2
    const ob = (w + 1) * bins * 2
    for (let k = 0; k < bins; k++) {
      const nk = (W - k) & (W - 1)
      out[oa + 2 * k] = 0.5 * (re[k] + re[nk])
      out[oa + 2 * k + 1] = 0.5 * (im[k] - im[nk])
      out[ob + 2 * k] = 0.5 * (im[k] + im[nk])
      out[ob + 2 * k + 1] = 0.5 * (re[nk] - re[k])
    }
  }
}

/**
 * Features of one segment (exactly segmentSize = ceil(segmentSeconds * fs) mono samples at fs).
 * Returns Float32Array [T * 229 * 6] with T = spec.frames. Consecutive segments overlap by half: pass the previous
 * call's `carry` and the segment shift in frames (`shift`, step / hop) to reuse the spectra of the shared frames (the
 * gain normalization is linear, so it is applied after the FFT); the returned `carry` serves the next segment.
 */
export function segmentFeatures(fe: Frontend, seg: Float32Array, prev?: SpectrumCarry, shift = 0): { features: Float32Array; carry: SpectrumCarry } {
  const { hop, window: W, eps } = fe.spec
  const T = Math.ceil(seg.length / hop) + 1
  const lPad = W / 2
  // Gain normalization over the framed samples (frames overlap, so samples count several times).
  let sum = 0
  let sumSq = 0
  for (let f = 0; f < T; f++) {
    const base = f * hop - lPad
    for (let i = 0; i < W; i++) {
      const j = base + i
      const v = j >= 0 && j < seg.length ? seg[j] : 0
      sum += v
      sumSq += v * v
    }
  }
  const count = T * W
  const mean = sum / count
  const std = Math.sqrt(Math.max(0, (sumSq - count * mean * mean) / (count - 1)))
  const scale = 1 / (std + 1e-8)
  const bins = W / 2 + 1
  const wspec = windowSpectrum(fe)
  // Frames entirely inside the segment are identical in the next one (shifted by `shift`): only those are carried.
  const firstInner = Math.ceil(lPad / hop)
  const lastInner = Math.floor((seg.length - lPad) / hop)
  const carry: SpectrumCarry = new Map()
  const power = new Float64Array(WINS * bins)
  const out = new Float32Array(T * MELS * WINS)
  const gain = (scale * scale) / W // |X|^2 with norm='ortho' is |FFT|^2 / W
  const logEps = Math.log(eps)
  const frame = new Float64Array(W)
  let spec: Float32Array = new Float32Array(WINS * bins * 2)
  let shared = false // `spec` belongs to a carry map: compute the next frame into a fresh buffer
  for (let f = 0; f < T; f++) {
    const inner = f >= firstInner && f <= lastInner
    const reused = inner ? prev?.get(f) : undefined
    if (reused) {
      spec = reused
      shared = true
    } else {
      if (shared) {
        spec = new Float32Array(WINS * bins * 2)
        shared = false
      }
      const base = f * hop - lPad
      for (let i = 0; i < W; i++) {
        const j = base + i
        frame[i] = j >= 0 && j < seg.length ? seg[j] : 0
      }
      rawSpectrum(fe, frame, spec)
    }
    if (shift > 0 && inner && f - shift >= firstInner) {
      carry.set(f - shift, spec)
      shared = true
    }
    for (let q = 0; q < WINS * bins; q++) {
      const re = spec[2 * q] - mean * wspec[2 * q]
      const im = spec[2 * q + 1] - mean * wspec[2 * q + 1]
      power[q] = (re * re + im * im) * gain
    }
    const row = f * MELS * WINS
    for (let m = 0; m < MELS; m++) {
      const s = fe.melStart[m]
      for (let w = 0; w < WINS; w++) {
        const p = w * bins
        let acc = 0
        for (let o = fe.melOffset[m], k = s; o < fe.melOffset[m + 1]; o++, k++) acc += power[p + k] * fe.melWeights[o]
        out[row + m * WINS + w] = (Math.log(acc + eps) - logEps) / -logEps
      }
    }
  }
  return { features: out, carry }
}
