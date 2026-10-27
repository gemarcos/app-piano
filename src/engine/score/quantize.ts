// Owner: engine-score. Raw notes -> filtered, transposed notes on the tick grid.
import type { NoteEvent, ScoreParams } from '../../types'
import type { TimeMap } from './timemap'

/** A note on the tick grid (1 tick = one sixteenth). */
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
const ASYNC_TICKS = 0.3
const ASYNC_SECONDS = 0.08

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
  // 2. Onset ticks per cluster.
  const ticks = new Array<number>(mx.length)
  const ticks16 = mx.map((x) => Math.round(x))
  if (distinct) {
    const slots = distinctSlots(mx)
    if (grid === 1) for (let c = 0; c < mx.length; c++) ticks[c] = slots[c]
    else {
      let prev = -Infinity
      for (let c = 0; c < mx.length; c++) {
        const even = Math.round(mx[c] / grid) * grid
        const next = c + 1 < mx.length ? slots[c + 1] : Infinity
        let t = even > prev && even < next ? even : slots[c]
        if (t <= prev) t = prev + 1
        ticks[c] = t
        prev = t
      }
    }
  } else for (let c = 0; c < mx.length; c++) ticks[c] = Math.round(mx[c] / grid) * grid
  // 3. Notes.
  let minOn = Infinity
  for (let i = 0; i < source.length; i++) {
    const s = source[i]
    const c = merged[clusterOf[i]]
    const on = ticks[c]
    const minLen = on % grid === 0 ? grid : 1
    let off = Math.round(map.toTick(s.end) / grid) * grid
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
