// Owner: engine-score. Splits a span inside a measure into notatable, metrically conventional values.
import type { TimeSignature } from '../../types'
import { NOTE_VALUES, SIXTEENTH, TICKS_PER_QUARTER, beatTicksOf, ticksPerMeasureOf } from './constants'

/** Straight values in sixteenths (the metric rules below work in sixteenths). */
const VALUE_SET = new Set(NOTE_VALUES.map((v) => v / SIXTEENTH))

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
  const bt = beatTicksOf(ts) / SIXTEENTH
  let n = 0
  for (let b = (Math.floor(s / bt) + 1) * bt; b < e; b += bt) n++
  return n
}

/** Can [s, e) be written as one value (note or rest) without hiding the meter? */
function allowed(s: number, e: number, ts: TimeSignature, rest: boolean): boolean {
  const d = e - s
  if (!VALUE_SET.has(d)) return false
  if (s === 0 && e === ticksPerMeasureOf(ts) / SIXTEENTH) return true
  if (strongCrossed(s, e, ts)) {
    // A dotted half from beat 1 is fine in 4/4 (notes only).
    return !rest && ts === '4/4' && s === 0 && e === 12
  }
  const crossed = beatsInside(s, e, ts)
  if (crossed === 0) return true
  if (rest) return d === 8 && (s === 0 || (ts === '4/4' && s === 8))
  const bt = beatTicksOf(ts) / SIXTEENTH
  if (s % bt === 0) return true
  if (s % 2 === 1) return false
  // Eighth-note syncopation (simple meters): may cross one beat and must end on an eighth.
  return crossed === 1 && e % 2 === 0
}

const cache = new Map<number, number[]>()
const TS_ID: Record<TimeSignature, number> = { '4/4': 0, '3/4': 1, '2/4': 2, '6/8': 3 }

function decompose(s: number, e: number, ts: TimeSignature, rest: boolean): number[] {
  // Numeric key: positions are 0..16, so 32 slots per position are plenty.
  const id = ((TS_ID[ts] * 2 + (rest ? 1 : 0)) * 32 + s) * 32 + e
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

/** Pieces of a span inside one triplet beat (ticks from the beat start): largest aligned triplet values. */
function tupletPieces(s: number, e: number): number[] {
  const out: number[] = []
  let pos = s
  while (pos < e) {
    let d = 2
    for (const v of [12, 8, 6, 4]) {
      if (pos + v <= e && pos % v === 0) {
        d = v
        break
      }
    }
    if (pos + d > e) d = e - pos
    out.push(d)
    pos += d
  }
  return out
}

/** True when a beat holds an edge off the straight sixteenth grid (it is written as a tuplet). */
export function isTripletEdge(t: number): boolean {
  return t % SIXTEENTH !== 0
}

/**
 * Notatable pieces (in ticks, contiguous from `start`) for a note or rest spanning
 * [start, start + duration) inside one measure. Straight spans (on the sixteenth grid) follow the
 * metric rules: whole-measure values are always allowed; nothing crosses the half-bar in 4/4
 * (except a dotted half from beat 1) or the middle of a 6/8 bar; notes starting off the beat show
 * the beat (eighth syncopations across one beat are kept); rests longer than a beat are only half
 * rests on beat 1 (or beat 3 in 4/4). A span with an edge off the sixteenth grid is cut at the
 * quarter beats around that edge, and that triplet beat is filled with triplet values.
 */
export function splitDuration(start: number, duration: number, ts: TimeSignature, rest = false): number[] {
  const tpm = ticksPerMeasureOf(ts)
  const s = Math.max(0, Math.min(tpm, Math.round(start)))
  const e = Math.max(s, Math.min(tpm, Math.round(start + duration)))
  if (!isTripletEdge(s) && !isTripletEdge(e)) return decompose(s / SIXTEENTH, e / SIXTEENTH, ts, rest).map((d) => d * SIXTEENTH)
  const beat = TICKS_PER_QUARTER
  const out: number[] = []
  let pos = s
  while (pos < e) {
    const beatStart = Math.floor(pos / beat) * beat
    const beatEnd = Math.min(e, beatStart + beat)
    if (isTripletEdge(pos) || isTripletEdge(beatEnd)) {
      out.push(...tupletPieces(pos - beatStart, beatEnd - beatStart))
      pos = beatEnd
      continue
    }
    // A straight run of whole beats, up to the beat holding the off-grid end.
    let stop = beatEnd
    while (stop < e && !isTripletEdge(Math.min(e, stop + beat))) stop = Math.min(e, stop + beat)
    out.push(...decompose(pos / SIXTEENTH, stop / SIXTEENTH, ts, rest).map((d) => d * SIXTEENTH))
    pos = stop
  }
  return out
}
