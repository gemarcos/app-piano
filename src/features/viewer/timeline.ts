// Owner: viewer. Pure helpers for the viewer: who sounds when (per staff), measure navigation,
// loop bounds and small labels. No DOM, unit tested in timeline.test.ts.
import type { Hands, Score, ScoreEvent, Staff } from '../../types'
import { secondsPerTick } from '../../engine/score'

/** One chord or rest of a staff in absolute ticks (tick 0 = start of measure 0). */
export interface TimelineEvent {
  start: number
  end: number
  measure: number
  /** Index of the event inside its measure (matches the abcjs element order). */
  index: number
  pitches: readonly number[]
}

export type StaffTimeline = TimelineEvent[]

/** Events of both staves ([right, left]) in absolute ticks, sorted; each staff tiles the score. */
export function buildTimeline(score: Score): [StaffTimeline, StaffTimeline] {
  return [staffTimeline(score.staves[0], score.ticksPerMeasure), staffTimeline(score.staves[1], score.ticksPerMeasure)]
}

function staffTimeline(staff: Staff, ticksPerMeasure: number): StaffTimeline {
  const out: StaffTimeline = []
  staff.measures.forEach((measure, m) => {
    const base = m * ticksPerMeasure
    measure.events.forEach((ev, index) => {
      const start = base + ev.start
      out.push({ start, end: start + ev.duration, measure: m, index, pitches: ev.pitches })
    })
  })
  return out
}

/** Index of the event sounding at `tick` (start <= tick < end), or -1. Events never overlap. */
export function eventIndexAt(events: readonly TimelineEvent[], tick: number): number {
  let lo = 0
  let hi = events.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const e = events[mid]
    if (tick < e.start) hi = mid - 1
    else if (tick >= e.end) lo = mid + 1
    else return mid
  }
  return -1
}

/* ---------- Score time (seconds at 100 %, tick 0 = 0 s) ---------- */

export function measureSeconds(score: Pick<Score, 'bpm' | 'ticksPerMeasure'>): number {
  return score.ticksPerMeasure * secondsPerTick(score)
}

export function scoreSeconds(score: Pick<Score, 'bpm' | 'ticksPerMeasure' | 'measureCount'>): number {
  return Math.max(1, score.measureCount) * measureSeconds(score)
}

/** Measure index under a score time (clamped to the score). */
export function measureAt(score: Pick<Score, 'bpm' | 'ticksPerMeasure' | 'measureCount'>, seconds: number): number {
  const m = Math.floor(seconds / measureSeconds(score) + 1e-6)
  return Math.min(Math.max(0, score.measureCount - 1), Math.max(0, m))
}

/**
 * Where "previous" goes: the start of the current measure, or the previous measure when the
 * position is already within the first moments of the current one (like a music player).
 */
export function previousMeasureTime(score: Pick<Score, 'bpm' | 'ticksPerMeasure' | 'measureCount'>, seconds: number): number {
  const md = measureSeconds(score)
  const m = measureAt(score, seconds)
  const start = m * md
  const grace = Math.min(0.75, md * 0.25)
  return seconds - start > grace ? start : Math.max(0, (m - 1) * md)
}

/** Start of the next measure, or null at the last one. */
export function nextMeasureTime(score: Pick<Score, 'bpm' | 'ticksPerMeasure' | 'measureCount'>, seconds: number): number | null {
  const m = measureAt(score, seconds) + 1
  return m < score.measureCount ? m * measureSeconds(score) : null
}

/* ---------- Loop ---------- */

export type LoopMode = 'off' | 'all' | 'ab'

/** Inclusive measure range [first, last] of an A-B loop. */
export type MeasureRange = [number, number]

/** Loop bounds in score seconds, or null when nothing loops (off, or A-B without a range). */
export function loopBounds(
  score: Pick<Score, 'bpm' | 'ticksPerMeasure' | 'measureCount'>,
  mode: LoopMode,
  range: MeasureRange | null,
): [number, number] | null {
  if (mode === 'all') return [0, scoreSeconds(score)]
  if (mode !== 'ab' || !range) return null
  const last = Math.max(0, score.measureCount - 1)
  const a = Math.min(last, Math.max(0, Math.min(range[0], range[1])))
  const b = Math.min(last, Math.max(0, Math.max(range[0], range[1])))
  const md = measureSeconds(score)
  return [a * md, (b + 1) * md]
}

/**
 * A-B selection by tapping measures: the first tap picks one measure (a one-bar loop) and waits
 * for the second, which closes the range; the next tap starts a new selection.
 */
export function abTap(range: MeasureRange | null, pending: boolean, measure: number): { range: MeasureRange; pending: boolean } {
  if (!range || !pending) return { range: [measure, measure], pending: true }
  const first = range[0]
  return { range: [Math.min(first, measure), Math.max(first, measure)], pending: false }
}

/** Keeps a stored range inside the score (measure count can shrink when params change). */
export function clampRange(range: MeasureRange | null, measureCount: number): MeasureRange | null {
  if (!range) return null
  const last = Math.max(0, measureCount - 1)
  const a = Math.min(last, Math.max(0, Math.round(Math.min(range[0], range[1]))))
  const b = Math.min(last, Math.max(0, Math.round(Math.max(range[0], range[1]))))
  return [a, b]
}

/* ---------- Scores for layout and playback ---------- */

const restStaff = (staff: Staff, ticksPerMeasure: number): Staff => ({
  ...staff,
  measures: staff.measures.map((m) => ({ index: m.index, events: [{ start: 0, duration: ticksPerMeasure, pitches: [] }] })),
})

/** The score as laid out for one hand: the hidden staff becomes rests (for bars-per-line estimates). */
export function scoreForHands(score: Score, hands: Hands): Score {
  if (hands === 'both') return score
  const [right, left] = score.staves
  return {
    ...score,
    staves: hands === 'right' ? [right, restStaff(left, score.ticksPerMeasure)] : [restStaff(right, score.ticksPerMeasure), left],
  }
}

/**
 * The score with pitches outside the soundfont range removed (events left empty become rests).
 * Returns the same object when nothing is out of range, which is the norm (the engine keeps 21..108).
 */
export function clampPitches(score: Score, range: readonly [number, number]): Score {
  const [lo, hi] = range
  const inRange = (p: number) => p >= lo && p <= hi
  const clean = score.staves.every((s) => s.measures.every((m) => m.events.every((e) => e.pitches.every(inRange))))
  if (clean) return score
  const fix = (ev: ScoreEvent): ScoreEvent => {
    const pitches = ev.pitches.filter(inRange)
    return pitches.length === ev.pitches.length ? ev : { start: ev.start, duration: ev.duration, pitches, ...(pitches.length && ev.tie ? { tie: true } : {}) }
  }
  return {
    ...score,
    staves: score.staves.map((s) => ({ ...s, measures: s.measures.map((m) => ({ index: m.index, events: m.events.map(fix) })) })) as Score['staves'],
  }
}

/**
 * Bars per system for print: the densest count (down to half of `max`) whose last system is not a
 * lonely fragment (empty remainder, or at least half full). 16 bars at max 5 -> 4 per system.
 */
export function balancedPerLine(measureCount: number, max: number): number {
  const top = Math.max(1, Math.floor(max))
  if (measureCount <= top) return top
  for (let p = top; p >= Math.max(1, Math.ceil(top / 2)); p--) {
    const rest = measureCount % p
    if (rest === 0 || rest >= p / 2) return p
  }
  return top
}

/* ---------- Labels ---------- */

const speedFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })

/** 100 -> "1×", 75 -> "0,75×", 150 -> "1,5×". */
export function formatSpeed(percent: number): string {
  return `${speedFormat.format(Math.round(percent) / 100)}×`
}

/** "+2", "0", "−3" (typographic minus). */
export function formatSemitones(value: number): string {
  if (value > 0) return `+${value}`
  if (value < 0) return `−${Math.abs(value)}`
  return '0'
}
