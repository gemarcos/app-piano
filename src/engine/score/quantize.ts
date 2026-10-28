// Owner: engine-score. Raw notes -> filtered, transposed notes on the tick grid.
import type { NoteEvent, ScoreParams } from '../../types'
import { SIXTEENTH, TICKS_PER_QUARTER } from './constants'
import type { TimeMap } from './timemap'

/** A note on the tick grid (TICKS_PER_QUARTER = 12). */
export interface QNote {
  pitch: number
  /** Onset tick, snapped, relative to the score's tick 0. */
  on: number
  /** End tick (exclusive), snapped; always > on. */
  off: number
  vel: number
  /** Onset snapped to the sixteenth grid (used to resolve runs collapsed by a coarser grid). */
  on16: number
  right: boolean
  /** 1 = main voice of its staff, 2 = second voice (see voices.ts). */
  voice: 1 | 2
  /** Source onset cluster: notes struck together in the audio share it. */
  cluster: number
  /** Held by the hand over later notes (voices.ts): keeps its length under the pedal. */
  held?: boolean
  /** End tick of the sound without pedal, before notation shortens it (absent under the pedal). */
  sound?: number
  /** Neither pedalled nor ringing with other notes of its hand: its length is the hand's own (engrave.ts). */
  free?: boolean
}

export interface Quantized {
  notes: QNote[]
  /** Whole measures subtracted so that the first note lands in measure 0 (may be negative). */
  shiftMeasures: number
}

/** A filtered, transposed source note in seconds. */
export interface SourceNote {
  pitch: number
  start: number
  end: number
  vel: number
}

/** Safety cap against corrupt input (a 3-minute piece at 200 bpm is ~150 measures). */
export const MAX_MEASURES = 2000
/** Notes starting within this time of a cluster's first note are struck together (one chord). */
export const CHORD_WINDOW = 0.035
/** Clusters this close (in sixteenths, and within ASYNC_SECONDS) are one chord played unevenly. */
const ASYNC_TICKS = 0.9
const ASYNC_SECONDS = 0.08
/** A triplet onset sits at least this far (seconds) off the sixteenth grid. */
const TRIPLET_OFF_SECONDS = 0.03

/** Velocity / duration / range filters and transposition (folded by octaves into 21..108). */
export function filterNotes(notes: NoteEvent[], p: ScoreParams): SourceNote[] {
  const out: SourceNote[] = []
  if (!Array.isArray(notes)) return out
  const [lo, hi] = p.pitchRange
  for (const n of notes) {
    if (!n || !Number.isFinite(n.start) || !Number.isFinite(n.pitch)) continue
    const duration = Number.isFinite(n.duration) ? Math.max(0, n.duration) : 0
    const vel = Number.isFinite(n.velocity) ? n.velocity : 1
    if (vel < p.minVelocity || duration < p.minDuration) continue
    const raw = Math.round(n.pitch)
    if (raw < lo || raw > hi) continue
    let pitch = raw + p.transpose
    while (pitch > 108) pitch -= 12
    while (pitch < 21) pitch += 12
    out.push({ pitch, start: n.start, end: n.start + duration, vel: Math.max(0, Math.min(1, vel)) })
  }
  return out.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}

/**
 * Strictly increasing integers closest to y (least squares): isotonic regression of y[i] - i (pool
 * adjacent violators), rounded, plus i. Well separated values simply round; values crowding into
 * the same slot are spread over neighbouring slots around their mean, keeping their order.
 */
export function distinctSlots(y: number[]): number[] {
  const vals: number[] = []
  const wts: number[] = []
  for (let i = 0; i < y.length; i++) {
    let v = y[i] - i
    let w = 1
    while (vals.length && vals[vals.length - 1] > v) {
      const pw = wts.pop()!
      v = (vals.pop()! * pw + v * w) / (pw + w)
      w += pw
    }
    vals.push(v)
    wts.push(w)
  }
  const out = new Array<number>(y.length)
  let i = 0
  for (let b = 0; b < vals.length; b++) {
    const r = Math.round(vals[b])
    for (let k = 0; k < wts[b]; k++, i++) out[i] = r + i
  }
  return out
}

/**
 * Converts seconds to ticks through `map` and snaps onsets and ends to `grid` ticks. Notes struck
 * together (CHORD_WINDOW, or a slightly uneven chord) form one onset; with `distinct` (difficulty
 * 'original') different onsets never share a tick: crowded onsets fall back to the sixteenth grid
 * and, if still crowded, are spread over neighbouring sixteenths in order, so fast arpeggios and
 * runs keep every note instead of collapsing into a chord. Without it (simplified modes) onsets
 * collapse onto the grid as before. Finally shifts by whole measures so the first note is in
 * measure 0.
 */
export function quantizeNotes(
  source: SourceNote[],
  grid: number,
  ticksPerMeasure: number,
  map: TimeMap,
  distinct: boolean,
): Quantized {
  const out: QNote[] = []
  if (source.length === 0) return { notes: out, shiftMeasures: 0 }
  // 1. Onset clusters in source time.
  const clusterOf = new Array<number>(source.length)
  const starts: number[] = []
  const xs: number[] = []
  let first = 0
  let count = 0
  let sumX = 0
  const close = () => {
    xs.push(sumX / count)
    starts.push(source[first].start)
  }
  for (let i = 0; i < source.length; i++) {
    const x = map.toTick(source[i].start)
    if (i > 0 && source[i].start - source[first].start > CHORD_WINDOW) {
      close()
      first = i
      count = 0
      sumX = 0
    }
    clusterOf[i] = xs.length
    count++
    sumX += x
  }
  close()
  // Uneven chords (e.g. a melody note leading its chord by 50 ms) are one onset.
  const merged = new Array<number>(xs.length)
  const mx: number[] = []
  for (let c = 0; c < xs.length; c++) {
    const m = mx.length - 1
    if (m >= 0 && xs[c] - mx[m] < ASYNC_TICKS && starts[c] - starts[c - 1] < ASYNC_SECONDS) merged[c] = m
    else {
      merged[c] = mx.length
      mx.push(xs[c])
    }
  }
  // 2. Onset ticks per cluster. 'original': each quarter beat takes a straight grid or, when its
  //    onsets clearly sit on thirds (triplets, sextuplets), a triplet grid; distinct onsets never
  //    share a tick (spread over the beat's grid points in order).
  const ticks = new Array<number>(mx.length)
  const ticks16 = mx.map((x) => Math.round(x / SIXTEENTH) * SIXTEENTH)
  const beat = TICKS_PER_QUARTER
  const triple = new Set<number>()
  if (distinct) {
    const fineStep = SIXTEENTH
    const tripStep = 2
    // Per beat: total snapping error on the straight and on the triplet grid.
    const errs = new Map<number, { d: number; t: number; off: number; n: number }>()
    const secPerTick = new Map<number, number>()
    for (const x of mx) {
      const b = Math.floor((x + tripStep / 2) / beat)
      const d = Math.abs(x - Math.round(x / fineStep) * fineStep)
      const t = Math.abs(x - Math.round(x / tripStep) * tripStep)
      const e = errs.get(b) ?? { d: 0, t: 0, off: 0, n: 0 }
      let sp = secPerTick.get(b)
      if (sp === undefined) {
        sp = Math.max(0, (map.toSeconds((b + 1) * beat) - map.toSeconds(b * beat)) / beat)
        secPerTick.set(b, sp)
      }
      e.d += d
      e.t += t
      e.n++
      // Clearly off the straight grid and on a triplet point (1/3 or 2/3 of an eighth step), off by
      // more than a performer's timing noise: at fast tempi sixteenths and triplets are only a few
      // tens of milliseconds apart, and rubato alone would read as triplets.
      if (d > fineStep * 0.3 && t < tripStep * 0.3 && d * sp > TRIPLET_OFF_SECONDS) e.off++
      errs.set(b, e)
    }
    // A beat with three onsets or more, two of them clearly on thirds, and a much better fit: a
    // triplet or sextuplet beat. (Absolute fits too: rubato can push eighths towards thirds.)
    for (const [b, e] of errs) if (e.n >= 3 && e.off >= 2 && e.t < 0.5 * e.d && e.t / e.n <= 0.35 && e.d / e.n >= 0.6) triple.add(b)
    const stepOf = (b: number, coarse: boolean) => (triple.has(b) ? (coarse && grid > SIXTEENTH ? 4 : tripStep) : coarse ? grid : fineStep)
    // The fine grid points (sixteenths, or sixteenth triplets in triplet beats) as one sorted list.
    let lo = Infinity
    let hi = -Infinity
    for (const x of mx) {
      if (x < lo) lo = x
      if (x > hi) hi = x
    }
    const b0 = Math.floor(lo / beat) - 1
    const b1 = Math.floor(hi / beat) + 2
    const points: number[] = []
    for (let b = b0; b < b1; b++) for (let t = b * beat; t < (b + 1) * beat; t += stepOf(b, false)) points.push(t)
    const indexOf = (x: number) => {
      let lo = 0
      let hi = points.length - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (points[mid] <= x) lo = mid
        else hi = mid
      }
      return lo + (x - points[lo]) / (points[hi] - points[lo])
    }
    const slots = distinctSlots(mx.map(indexOf)).map((i) => points[Math.max(0, Math.min(points.length - 1, i))])
    let prev = -Infinity
    for (let c = 0; c < mx.length; c++) {
      const b = Math.floor(slots[c] / beat)
      const step = stepOf(b, true)
      const coarse = Math.round(mx[c] / step) * step
      const next = c + 1 < mx.length ? slots[c + 1] : Infinity
      let t = step !== stepOf(b, false) && coarse > prev && coarse < next ? coarse : slots[c]
      if (t <= prev) {
        const k = Math.floor(indexOf(prev)) + 1
        t = k < points.length ? points[k] : prev + 2
        if (t <= prev) t = prev + 2
      }
      ticks[c] = t
      prev = t
    }
    // Every onset on the grid of the beat it landed in (straight or triplet), still increasing.
    const fineAt = (t: number) => (triple.has(Math.floor(t / beat)) ? tripStep : fineStep)
    const nextPoint = (t: number) => {
      const b = Math.floor(t / beat)
      const st = fineAt(t)
      const cand = (Math.floor(t / st) + 1) * st
      return Math.min(cand, (b + 1) * beat)
    }
    prev = -Infinity
    for (let c = 0; c < mx.length; c++) {
      let t = ticks[c]
      const st = fineAt(t)
      if (t % st !== 0) t = Math.round(t / st) * st
      if (Math.floor(t / beat) !== Math.floor(ticks[c] / beat) || t % fineAt(t) !== 0) t = Math.floor(ticks[c] / beat) * beat
      while (t <= prev) t = nextPoint(t)
      ticks[c] = t
      prev = t
    }
  } else for (let c = 0; c < mx.length; c++) ticks[c] = Math.round(mx[c] / grid) * grid
  // Grid step at a tick (for note ends): the triplet grid in triplet beats.
  const endStep = (x: number) => {
    const b = Math.floor((x + 1) / beat)
    return triple.has(b) ? (grid > SIXTEENTH ? 4 : 2) : grid
  }
  // 3. Notes.
  let minOn = Infinity
  for (let i = 0; i < source.length; i++) {
    const s = source[i]
    const c = merged[clusterOf[i]]
    const on = ticks[c]
    const xEnd = map.toTick(s.end)
    const step = endStep(xEnd)
    const onStep = triple.has(Math.floor(on / beat)) ? (grid > SIXTEENTH ? 4 : 2) : grid
    const fine = triple.has(Math.floor(on / beat)) ? 2 : SIXTEENTH
    const minLen = on % onStep === 0 ? onStep : fine
    let off = Math.round(xEnd / step) * step
    if (off < on + minLen) off = on + minLen
    out.push({ pitch: s.pitch, on, off, vel: s.vel, on16: distinct ? on : ticks16[c], right: false, voice: 1, cluster: c })
    if (on < minOn) minOn = on
  }
  const shiftMeasures = Math.floor(minOn / ticksPerMeasure)
  const shift = shiftMeasures * ticksPerMeasure
  const limit = MAX_MEASURES * ticksPerMeasure
  const kept: QNote[] = []
  for (const q of out) {
    q.on -= shift
    q.off -= shift
    q.on16 -= shift
    if (q.on >= limit) continue
    if (q.off > limit) q.off = limit
    kept.push(q)
  }
  return { notes: dedupe(kept), shiftMeasures }
}

/** Same pitch + onset: keep the longest (and loudest velocity). Same-pitch overlaps are cut. */
function dedupe(notes: QNote[]): QNote[] {
  notes.sort((a, b) => a.pitch - b.pitch || a.on - b.on || b.off - a.off)
  const out: QNote[] = []
  for (const n of notes) {
    const last = out.length > 0 ? out[out.length - 1] : undefined
    if (last && last.pitch === n.pitch) {
      if (last.on === n.on) {
        if (n.vel > last.vel) last.vel = n.vel
        continue
      }
      if (last.off > n.on) last.off = n.on
    }
    out.push(n)
  }
  return out
}

/** Sorts by onset then pitch (ascending). */
export function sortByOnset(notes: QNote[]): QNote[] {
  return notes.sort((a, b) => a.on - b.on || a.pitch - b.pitch)
}

/** Calls fn for each run of notes sharing an onset (notes must be sorted by onset). */
export function forEachOnsetGroup(notes: QNote[], fn: (group: QNote[], on: number) => void): void {
  let i = 0
  while (i < notes.length) {
    let j = i + 1
    while (j < notes.length && notes[j].on === notes[i].on) j++
    fn(notes.slice(i, j), notes[i].on)
    i = j
  }
}
