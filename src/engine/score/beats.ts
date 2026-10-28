// Owner: engine-score. Beat tracking that follows tempo changes (rubato), and the beat-level
// features the tempo choice is scored with.
//
// trackBeats: dynamic programming over an onset-strength envelope (Ellis, "Beat tracking by
// dynamic programming", 2007): every frame's best chain of beats maximizes the onset strength on
// the beats minus a penalty on the log-ratio of each inter-beat interval to the target period, so
// the beats bend with a performer's rubato without jumping to off-beats.
import { mod } from './keys'
import type { Onset } from './tempo'

const FPS = 100
/**
 * Penalties on each inter-beat interval: LOCAL x (log(interval / previous interval))^2 keeps the
 * tempo continuous (a gradual ritardando or accelerando is cheap), GLOBAL x (log(interval /
 * period))^2 keeps it near the chosen tempo. Swept on 384 steady streams (tempo, meter, downbeat,
 * pickups) and 24 rubato performances: 120 / 15 made no analysis error and put the fewest notes off
 * their written tick (a tracker tied to the global period alone slipped through final ritardandos).
 */
const LOCAL = 120
const GLOBAL = 15

/** Beat times in seconds at about `bpm`, covering the onsets (one beat of margin on both sides). */
export function trackBeats(onsets: Onset[], bpm: number, accent: (o: Onset) => number = (o) => o.w): number[] {
  if (onsets.length < 2 || !(bpm > 0)) return []
  const period = 60 / bpm
  const t0 = onsets[0].t - period
  const t1 = onsets[onsets.length - 1].t + period
  const n = Math.max(2, Math.ceil((t1 - t0) * FPS) + 1)
  const env = new Float64Array(n)
  let mean = 0
  for (const o of onsets) mean += accent(o)
  mean = mean / onsets.length || 1
  for (const o of onsets) {
    const x = (o.t - t0) * FPS
    const c = Math.round(x)
    const w = accent(o) / mean
    for (let d = -3; d <= 3; d++) {
      const i = c + d
      if (i >= 0 && i < n) env[i] += w * Math.exp(-0.5 * ((i - x) / 1.5) ** 2)
    }
  }
  const tau = period * FPS
  const lo = Math.max(1, Math.round(0.7 * tau))
  const hi = Math.max(lo + 1, Math.round(1.45 * tau))
  const pen = new Float64Array(hi + 1)
  for (let d = lo; d <= hi; d++) pen[d] = GLOBAL * Math.log(d / tau) ** 2
  const score = new Float64Array(n)
  const back = new Int32Array(n).fill(-1)
  for (let t = 0; t < n; t++) {
    let best = 0
    let arg = -1
    for (let p = Math.max(0, t - hi); p <= t - lo; p++) {
      const d = t - p
      let v = score[p] - pen[d]
      if (back[p] >= 0) v -= LOCAL * Math.log(d / (p - back[p])) ** 2
      if (v > best) {
        best = v
        arg = p
      }
    }
    score[t] = env[t] + best
    back[t] = arg
  }
  // The chain may end anywhere in the last two periods (a final ritardando ends late or early).
  let end = n - 1
  for (let t = Math.max(0, n - Math.round(2 * tau)); t < n; t++) if (score[t] > score[end]) end = t
  const frames: number[] = []
  for (let t = end; t >= 0 && frames.length <= n; t = back[t]) frames.push(t)
  frames.reverse()
  const beats = frames.map((f) => t0 + f / FPS)
  // Extend with the edge periods so the map covers every onset with a beat of margin.
  if (beats.length >= 2) {
    const first = beats[1] - beats[0]
    while (beats[0] > onsets[0].t - period) beats.unshift(beats[0] - first)
    const last = beats[beats.length - 1] - beats[beats.length - 2]
    while (beats[beats.length - 1] < onsets[onsets.length - 1].t + period) beats.push(beats[beats.length - 1] + last)
  }
  return beats
}

/** Fractional beat index of each time (beats sorted; linear extrapolation outside). */
export function beatPositions(times: number[], beats: number[]): number[] {
  const n = beats.length - 1
  let k = 0
  return times.map((t) => {
    if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0])
    if (t >= beats[n]) return n + (t - beats[n]) / (beats[n] - beats[n - 1])
    while (k > 0 && beats[k] > t) k--
    while (k < n - 1 && beats[k + 1] <= t) k++
    return k + (t - beats[k]) / (beats[k + 1] - beats[k])
  })
}

export interface BeatFeatures {
  /** Share of onset weight on the sixteenth grid of the tracked beats (0..1). */
  fit: number
  /** Even vs odd beats (>= 1). */
  alt: number
  /** Strongest vs weakest beat class mod 3 (>= 1). */
  alt3: number
  /** Beats vs eighth off-beats (register-weighted). */
  sub: number
  /** Share of beats (first to last onset) without an onset. */
  empty: number
  /** Share of upper-line notes lasting four beats or more (a doubled tempo writes long notes over the barline). */
  long: number
}

/**
 * Beat-level features of onsets against a beat map. `upper[i]`: onset i has a note in the upper
 * register (for the melody-length measure). `triplets`: the beat may be divided in sixteenth
 * triplets (only for the reading a sextuplet texture points to).
 */
export function beatFeatures(onsets: Onset[], beats: number[], upper: boolean[], triplets = false): BeatFeatures {
  const pos = beatPositions(
    onsets.map((o) => o.t),
    beats,
  )
  const periodAt = (u: number) => {
    const k = Math.max(0, Math.min(beats.length - 2, Math.floor(u)))
    return beats[k + 1] - beats[k]
  }
  let total = 0
  let onGrid = 0
  const par = [0, 0]
  const tri = [0, 0, 0]
  let off = 0
  const hit = new Set<number>()
  onsets.forEach((o, i) => {
    const u = pos[i]
    const p = periodAt(u)
    total += o.w
    // With `triplets`, sixteenth-triplet positions count as on the grid too (sextuplet beats).
    const err16 = Math.abs(u * 4 - Math.round(u * 4)) * (p / 4)
    const err = triplets ? Math.min(err16, Math.abs(u * 6 - Math.round(u * 6)) * (p / 6)) : err16
    onGrid += o.w * Math.exp(-((err / 0.025) ** 2))
    const tol = Math.min(0.06, p / 8)
    const k = Math.round(u)
    if (Math.abs(u - k) * p <= tol) {
      par[mod(k, 2)] += o.m
      tri[mod(k, 3)] += o.m
      hit.add(k)
      return
    }
    const h = Math.round(u * 2)
    if (mod(h, 2) === 1 && (Math.abs(u * 2 - h) * p) / 2 <= tol) off += o.m
  })
  const all = par[0] + par[1] + off
  const eps = 1e-6 + 0.02 * all
  const first = Math.round(pos[0])
  const last = Math.round(pos[pos.length - 1])
  let filled = 0
  for (const k of hit) if (k >= first && k <= last) filled++
  const slots = last - first + 1
  // Upper-line note lengths in beats (time to the next upper-line onset; phrase gaps ignored).
  let longs = 0
  let count = 0
  let prev = -1
  onsets.forEach((_, i) => {
    if (!upper[i]) return
    if (prev >= 0) {
      const beatsLong = pos[i] - pos[prev]
      if (beatsLong <= 12) {
        count++
        if (beatsLong >= 3.75) longs++
      }
    }
    prev = i
  })
  return {
    fit: total > 0 ? onGrid / total : 0,
    alt: Math.max(...par) / Math.max(Math.min(...par), eps),
    alt3: Math.max(...tri) / Math.max(Math.min(...tri), eps),
    sub: (par[0] + par[1]) / Math.max(off, eps),
    empty: slots > 0 ? Math.max(0, 1 - filled / slots) : 1,
    long: count > 0 ? longs / count : 0,
  }
}

/**
 * How far a beat map is from a constant tempo: RMS and worst residual of a straight-line fit of
 * beat time against beat index, as fractions of the mean period, and the fitted line.
 */
export function tempoDeviation(beats: number[]): { deviation: number; worst: number; slope: number; intercept: number } {
  const n = beats.length
  if (n < 3) return { deviation: 0, worst: 0, slope: n === 2 ? beats[1] - beats[0] : 0.6, intercept: beats[0] ?? 0 }
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += beats[i]
    sxx += i * i
    sxy += i * beats[i]
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  const intercept = (sy - slope * sx) / n
  let rss = 0
  let worst = 0
  for (let i = 0; i < n; i++) {
    const r = beats[i] - (intercept + slope * i)
    rss += r * r
    worst = Math.max(worst, Math.abs(r))
  }
  return { deviation: Math.sqrt(rss / n) / slope, worst: worst / slope, slope, intercept }
}
