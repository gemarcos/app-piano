// Owner: engine-score. Tempo estimation: periodicity (comb-filtered autocorrelation of onsets),
// octave choice (which grid explains the onsets and their accents), fine tempo and beat phase.
import { mod } from './keys'

export const MIN_BPM = 50
export const MAX_BPM = 200
const FRAME_RATE = 100
const PRIOR_CENTER = 110
/** Prior width in octaves (mild). */
const PRIOR_SIGMA = 1.5

export interface Onset {
  t: number
  /** Onset strength: loudest note plus a bonus for chord size. */
  w: number
  /** Register-weighted strength (melody notes carry the pulse more than accompaniment). */
  m: number
  /** Lowest pitch of the cluster. */
  low: number
  /** Longest duration in the cluster (seconds). */
  dur: number
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
export const tempoPrior = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / PRIOR_CENTER) / PRIOR_SIGMA) ** 2)

export interface Periodicity {
  best: number
  /** 0..1, how much the best periodicity stands out from the rest of the curve. */
  salience: number
}

/** Comb filter over the onset autocorrelation (100 Hz lag grid, 50-200 bpm) times the tempo prior. */
export function periodicity(onsets: Onset[], span: number): Periodicity {
  const maxLag = (4 * 60) / MIN_BPM + 0.1
  const n = Math.ceil(maxLag * FRAME_RATE) + 2
  const hist = new Float64Array(n)
  for (let i = 0; i < onsets.length; i++) {
    const a = onsets[i]
    for (let j = i + 1; j < onsets.length; j++) {
      const d = onsets[j].t - a.t
      if (d > maxLag) break
      const x = d * FRAME_RATE
      const k = Math.floor(x)
      const f = x - k
      const ww = a.w * onsets[j].w
      hist[k] += ww * (1 - f)
      hist[k + 1] += ww * f
    }
  }
  // Unbiased (overlap-normalized) autocorrelation, smoothed to absorb timing jitter.
  const total = span + 0.5
  for (let k = 0; k < n; k++) hist[k] /= Math.max(total - k / FRAME_RATE, total * 0.3)
  const ac = gaussianSmooth(hist, 2)
  let base = 0
  for (let k = 20; k < n; k++) base += ac[k]
  base /= Math.max(1, n - 20)
  const r = (lag: number) => {
    const k = Math.floor(lag)
    if (k < 0 || k + 1 >= n) return 0
    const f = lag - k
    return ac[k] * (1 - f) + ac[k + 1] * f - base
  }
  let best = 100
  let bestScore = -Infinity
  const scores: number[] = []
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.25) {
    const lag = (60 * FRAME_RATE) / bpm
    const comb = r(lag) + 0.75 * r(2 * lag) + 0.5 * r(3 * lag) + 0.35 * r(4 * lag)
    const s = Math.max(0, comb) * tempoPrior(bpm)
    scores.push(s)
    if (s > bestScore) {
      bestScore = s
      best = bpm
    }
  }
  const sorted = [...scores].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const salience = bestScore > 0 ? clamp((bestScore - median) / bestScore, 0, 1) : 0
  return { best, salience }
}

function gaussianSmooth(x: Float64Array, sigma: number): Float64Array {
  const radius = Math.ceil(sigma * 3)
  const kernel: number[] = []
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-0.5 * (i / sigma) ** 2)
    kernel.push(v)
    sum += v
  }
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) {
    let acc = 0
    for (let k = -radius; k <= radius; k++) {
      const j = i + k
      if (j >= 0 && j < x.length) acc += x[j] * kernel[k + radius]
    }
    out[i] = acc / sum
  }
  return out
}

/**
 * Fine tempo: maximizes the phase coherence of the onsets at the beat and eighth levels
 * (a Fourier magnitude of the onset train) within +-range around `bpm`.
 */
export function refineTempo(onsets: Onset[], bpm: number, range: number, steps = 48): number {
  const coherence = (b: number) => {
    const f = (2 * Math.PI * b) / 60
    let c1 = 0
    let s1 = 0
    let c2 = 0
    let s2 = 0
    for (const o of onsets) {
      const c = Math.cos(f * o.t)
      const s = Math.sin(f * o.t)
      c1 += o.w * c
      s1 += o.w * s
      c2 += o.w * (c * c - s * s)
      s2 += o.w * 2 * c * s
    }
    return Math.hypot(c1, s1) + 0.5 * Math.hypot(c2, s2)
  }
  const step = (2 * range * bpm) / steps
  let bestI = 0
  const values: number[] = []
  for (let i = 0; i <= steps; i++) {
    values.push(coherence(bpm * (1 - range) + i * step))
    if (values[i] > values[bestI]) bestI = i
  }
  let best = bpm * (1 - range) + bestI * step
  if (bestI > 0 && bestI < steps) {
    const [y0, y1, y2] = [values[bestI - 1], values[bestI], values[bestI + 1]]
    const den = y0 - 2 * y1 + y2
    if (den < 0) best += ((0.5 * (y0 - y2)) / den) * step
  }
  return best
}

export interface GridFit {
  /** Seconds of the first beat grid line (0..period). */
  phase: number
  /** Share of onset weight explained by the 16th-note grid (0..1). */
  fit: number
}

const LEVEL_VALUE = [1, 0.2, 0.55, 0.2]

/** Best beat phase for a tempo (onsets on beats > eighths > sixteenths) and the grid fit. */
export function fitGrid(onsets: Onset[], bpm: number): GridFit {
  const period = 60 / bpm
  const sixteenth = period / 4
  const align = (phase: number, explainOnly: boolean) => {
    let acc = 0
    for (const o of onsets) {
      const pos = (o.t - phase) / sixteenth
      const n16 = Math.round(pos)
      const err = Math.abs(pos - n16) * sixteenth
      acc += o.w * Math.exp(-((err / 0.025) ** 2)) * (explainOnly ? 1 : LEVEL_VALUE[mod(n16, 4)])
    }
    return acc
  }
  let phase = 0
  let best = -Infinity
  const steps = 32
  for (let i = 0; i < steps; i++) {
    const v = align((i / steps) * period, false)
    if (v > best) {
      best = v
      phase = (i / steps) * period
    }
  }
  const coarse = phase
  for (let i = -4; i <= 4; i++) {
    const ph = coarse + (i / (steps * 4)) * period
    const v = align(ph, false)
    if (v > best) {
      best = v
      phase = ph
    }
  }
  let total = 0
  for (const o of onsets) total += o.w
  return { phase: mod(phase, period), fit: total > 0 ? align(phase, true) / total : 0 }
}

export interface LevelRatios {
  /** Even vs odd beats (>= 1). */
  alt: number
  /** Strongest vs weakest beat class mod 3 (>= 1): exposes a grid three times too fast. */
  alt3: number
  /** Beats vs eighth off-beats. */
  sub: number
  /** Share of beat slots (first to last onset) without any onset. */
  empty: number
}

/**
 * Accent ratios of a beat grid, with register-weighted strengths. Note that sub(c) is alt(2c):
 * one ratio decides between a tempo and its double.
 */
export function levelRatios(onsets: Onset[], bpm: number, phase: number): LevelRatios {
  const period = 60 / bpm
  const tol = Math.min(0.06, period / 8)
  const par = [0, 0]
  const tri = [0, 0, 0]
  let off = 0
  const hit = new Set<number>()
  for (const o of onsets) {
    const u = (o.t - phase) / period
    const k = Math.round(u)
    if (Math.abs(u - k) * period <= tol) {
      par[mod(k, 2)] += o.m
      tri[mod(k, 3)] += o.m
      hit.add(k)
      continue
    }
    const h = Math.round(u * 2)
    if (mod(h, 2) === 1 && (Math.abs(u * 2 - h) * period) / 2 <= tol) off += o.m
  }
  const total = par[0] + par[1] + off
  const eps = 1e-6 + 0.02 * total
  const first = Math.round((onsets[0].t - phase) / period)
  const slots = Math.round((onsets[onsets.length - 1].t - phase) / period) - first + 1
  return {
    alt: Math.max(...par) / Math.max(Math.min(...par), eps),
    alt3: Math.max(...tri) / Math.max(Math.min(...tri), eps),
    sub: (par[0] + par[1]) / Math.max(off, eps),
    empty: slots > 0 ? Math.max(0, 1 - hit.size / slots) : 1,
  }
}

/** Off-beats nearly as strong as beats: the beat is probably twice as fast. */
const SUB_FREE = 1.8
/** Beats alternating strong / weak this much: the beat is probably half as fast. */
const ALT_FREE = 1.6
/** One strong beat in three: the grid is probably three times too fast. */
const ALT3_FREE = 3

export interface TempoChoice {
  bpm: number
  fit: number
}

/**
 * Chooses among simple ratios of the periodicity peak: prior x grid fit x accent plausibility.
 * A grid is penalized for strong-weak alternation (or one strong beat in three) only when the
 * slower alternative is in range, and for off-beats as strong as its beats only when the faster
 * one is. Fewer empty beats break the remaining ties.
 */
export function chooseTempo(onsets: Onset[], peak: number): TempoChoice {
  let best: TempoChoice = { bpm: peak, fit: 0 }
  let bestScore = -Infinity
  const inRange = (b: number) => b >= MIN_BPM - 0.5 && b <= MAX_BPM + 0.5
  for (const r of [1, 2, 0.5, 3, 1 / 3, 1.5, 2 / 3]) {
    const raw = peak * r
    if (!inRange(raw)) continue
    const bpm = refineTempo(onsets, raw, 0.03, 32)
    const grid = fitGrid(onsets, bpm)
    const { alt, alt3, sub, empty } = levelRatios(onsets, bpm, grid.phase)
    let a = 1
    if (inRange(bpm / 2)) a = Math.min(a, (ALT_FREE / alt) ** 3)
    if (inRange(bpm / 3)) a = Math.min(a, (ALT3_FREE / alt3) ** 3)
    const s = inRange(bpm * 2) ? Math.min(1, (sub / SUB_FREE) ** 1.5) : 1
    const score = tempoPrior(bpm) * grid.fit * a * s * (1 - 0.5 * empty)
    if (score > bestScore) {
      bestScore = score
      best = { bpm, fit: grid.fit }
    }
  }
  return best
}
