// Owner: engine-score. Raw notes -> filtered, transposed, grid-snapped notes in ticks.
import type { NoteEvent, ScoreParams } from '../../types'

/** A note on the tick grid (1 tick = one sixteenth). */
export interface QNote {
  pitch: number
  /** Onset tick, snapped to the active grid, relative to the score's tick 0. */
  on: number
  /** End tick (exclusive), snapped; always > on. */
  off: number
  vel: number
  /** Onset snapped to the sixteenth grid (used to resolve runs collapsed by a coarser grid). */
  on16: number
  right: boolean
}

export interface Quantized {
  notes: QNote[]
  /** Whole measures subtracted so that the first note lands in measure 0 (may be negative). */
  shiftMeasures: number
}

/** Safety cap against corrupt input (a 3-minute piece at 200 bpm is ~150 measures). */
export const MAX_MEASURES = 2000

/**
 * Applies the velocity / duration / range filters, transposes (folding by octaves into 21..108 so
 * the pitch class stays in the key), converts seconds to ticks and snaps onsets and ends to `grid`
 * ticks (minimum one grid unit). Finally shifts by whole measures so the first note is in measure 0.
 */
export function quantizeNotes(notes: NoteEvent[], p: ScoreParams, grid: number, ticksPerMeasure: number): Quantized {
  const secPerTick = 60 / p.bpm / 4
  const [lo, hi] = p.pitchRange
  const out: QNote[] = []
  let minOn = Infinity
  if (!Array.isArray(notes)) return { notes: out, shiftMeasures: 0 }
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
    const t0 = (n.start - p.beatOffset) / secPerTick
    const t1 = (n.start + duration - p.beatOffset) / secPerTick
    const on = Math.round(t0 / grid) * grid
    let off = Math.round(t1 / grid) * grid
    if (off < on + grid) off = on + grid
    out.push({ pitch, on, off, vel: Math.max(0, Math.min(1, vel)), on16: Math.round(t0), right: false })
    if (on < minOn) minOn = on
  }
  if (out.length === 0) return { notes: out, shiftMeasures: 0 }
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
