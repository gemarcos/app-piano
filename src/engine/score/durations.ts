// Owner: engine-score. Splits a span inside a measure into notatable, metrically conventional values.
import type { TimeSignature } from '../../types'
import { NOTE_VALUES, beatTicksOf, ticksPerMeasureOf } from './constants'

const VALUE_SET = new Set(NOTE_VALUES)

/**
 * Metric weight of a position strictly inside a measure: 3 = half-bar (4/4) or compound beat (6/8),
 * 2 = beat, 1 = eighth, 0 = sixteenth.
 */
function level(t: number, ts: TimeSignature): number {
  switch (ts) {
    case '4/4':
      if (t === 8) return 3
      return t % 4 === 0 ? 2 : t % 2 === 0 ? 1 : 0
    case '6/8':
      if (t === 6) return 3
      return t % 2 === 0 ? 1 : 0
    default: // 3/4, 2/4
      return t % 4 === 0 ? 2 : t % 2 === 0 ? 1 : 0
  }
}

/** Positions that a single value may not cross (except a full-measure value). */
function strongCrossed(s: number, e: number, ts: TimeSignature): boolean {
  if (ts === '4/4') return s < 8 && 8 < e
  if (ts === '6/8') return s < 6 && 6 < e
  return false
}

function beatsInside(s: number, e: number, ts: TimeSignature): number {
  const bt = beatTicksOf(ts)
  let n = 0
  for (let b = (Math.floor(s / bt) + 1) * bt; b < e; b += bt) n++
  return n
}

/** Can [s, e) be written as one value (note or rest) without hiding the meter? */
function allowed(s: number, e: number, ts: TimeSignature, rest: boolean): boolean {
  const d = e - s
  if (!VALUE_SET.has(d)) return false
  if (s === 0 && e === ticksPerMeasureOf(ts)) return true
  if (strongCrossed(s, e, ts)) {
    // A dotted half from beat 1 is fine in 4/4 (notes only).
    return !rest && ts === '4/4' && s === 0 && e === 12
  }
  const crossed = beatsInside(s, e, ts)
  if (crossed === 0) return true
  if (rest) return d === 8 && (s === 0 || (ts === '4/4' && s === 8))
  const bt = beatTicksOf(ts)
  if (s % bt === 0) return true
  if (s % 2 === 1) return false
  // Eighth-note syncopation (simple meters): may cross one beat and must end on an eighth.
  return crossed === 1 && e % 2 === 0
}

const cache = new Map<string, number[]>()

function decompose(s: number, e: number, ts: TimeSignature, rest: boolean): number[] {
  const id = `${ts}|${rest ? 1 : 0}|${s}|${e}`
  const hit = cache.get(id)
  if (hit) return hit
  let out: number[]
  if (e - s <= 0) out = []
  else if (allowed(s, e, ts, rest)) out = [e - s]
  else {
    let best = -1
    for (let t = s + 1; t < e; t++) best = Math.max(best, level(t, ts))
    out = []
    for (let t = s + 1; t < e; t++) {
      if (level(t, ts) !== best) continue
      const parts = [...decompose(s, t, ts, rest), ...decompose(t, e, ts, rest)]
      if (out.length === 0 || parts.length < out.length) out = parts
    }
  }
  cache.set(id, out)
  return out
}

/**
 * Notatable pieces (in ticks, contiguous from `start`) for a note or rest spanning
 * [start, start + duration) inside one measure. Rules: whole-measure values are always allowed;
 * nothing crosses the half-bar in 4/4 (except a dotted half from beat 1) or the middle of a 6/8 bar;
 * notes starting off the beat show the beat (eighth syncopations across one beat are kept); rests
 * longer than a beat are only half rests on beat 1 (or beat 3 in 4/4).
 */
export function splitDuration(start: number, duration: number, ts: TimeSignature, rest = false): number[] {
  const tpm = ticksPerMeasureOf(ts)
  const s = Math.max(0, Math.min(tpm, Math.round(start)))
  const e = Math.max(s, Math.min(tpm, Math.round(start + duration)))
  return decompose(s, e, ts, rest)
}
