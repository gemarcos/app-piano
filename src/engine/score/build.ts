// Owner: engine-score. Raw notes + params -> grand-staff Score.
import type {
  AnalysisResult,
  Difficulty,
  KeySignature,
  Measure,
  NoteEvent,
  Score,
  ScoreEvent,
  ScoreParams,
  ScoreStats,
  ScoreSummary,
  Settings,
  Staff,
  TimeSignature,
} from '../../types'
import { beatTicksOf, isTimeSignature, ticksPerMeasureOf } from './constants'
import { splitDuration } from './durations'
import { normalizeKey, transposeKey } from './keys'
import { quantizeNotes, sortByOnset, type QNote } from './quantize'
import { assignHands, simplify } from './simplify'

const DIFFICULTIES: readonly Difficulty[] = ['original', 'intermedio', 'facil']
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Initial params for a new transcription, from its analysis and the user's defaults. */
export function defaultParams(
  analysis: AnalysisResult,
  settings: Pick<Settings, 'quantize' | 'splitPoint' | 'defaultDifficulty'>,
): ScoreParams {
  return {
    bpm: finite(analysis?.bpm) && analysis.bpm > 0 ? analysis.bpm : 100,
    beatOffset: finite(analysis?.beatOffset) ? analysis.beatOffset : 0,
    timeSignature: isTimeSignature(analysis?.timeSignature) ? analysis.timeSignature : '4/4',
    key: null,
    quantize: settings?.quantize === 8 ? 8 : 16,
    splitPoint: finite(settings?.splitPoint) ? clamp(Math.round(settings.splitPoint), 21, 108) : 60,
    difficulty: DIFFICULTIES.includes(settings?.defaultDifficulty) ? settings.defaultDifficulty : 'original',
    transpose: 0,
    minVelocity: 0.1,
    minDuration: 0.05,
    pitchRange: [21, 108],
    maxPolyphony: 4,
  }
}

/** Params with every field valid (bad values from storage or sliders fall back to safe defaults). */
export function sanitizeParams(params: Partial<ScoreParams> | null | undefined, analysis?: AnalysisResult | null): ScoreParams {
  const p = params ?? {}
  const fallbackBpm = finite(analysis?.bpm) && analysis.bpm > 0 ? analysis.bpm : 100
  const range = Array.isArray(p.pitchRange) && p.pitchRange.length === 2 && p.pitchRange.every(finite)
    ? ([Math.min(...p.pitchRange), Math.max(...p.pitchRange)] as [number, number])
    : ([21, 108] as [number, number])
  return {
    bpm: clamp(finite(p.bpm) && p.bpm > 0 ? p.bpm : fallbackBpm, 20, 400),
    beatOffset: finite(p.beatOffset) ? p.beatOffset : finite(analysis?.beatOffset) ? analysis.beatOffset : 0,
    timeSignature: isTimeSignature(p.timeSignature) ? p.timeSignature : '4/4',
    key: p.key ? normalizeKey(p.key) : null,
    quantize: p.quantize === 8 ? 8 : 16,
    splitPoint: finite(p.splitPoint) ? clamp(Math.round(p.splitPoint), 0, 128) : 60,
    difficulty: p.difficulty && DIFFICULTIES.includes(p.difficulty) ? p.difficulty : 'original',
    transpose: finite(p.transpose) ? clamp(Math.round(p.transpose), -12, 12) : 0,
    minVelocity: finite(p.minVelocity) ? clamp(p.minVelocity, 0, 1) : 0,
    minDuration: finite(p.minDuration) ? Math.max(0, p.minDuration) : 0,
    pitchRange: range,
    maxPolyphony: finite(p.maxPolyphony) ? clamp(Math.round(p.maxPolyphony), 1, 6) : 4,
  }
}

interface Segment {
  on: number
  off: number
  pitches: number[]
}

/**
 * One chord per onset: duration = min(longest note, next onset - onset). A release gap of at most
 * one grid unit that is shorter than half the inter-onset interval is read as legato (no rest).
 */
function chordStream(notes: QNote[], grid: number): Segment[] {
  const segs: Segment[] = []
  let i = 0
  while (i < notes.length) {
    const on = notes[i].on
    let j = i
    let off = on
    const pitches: number[] = []
    while (j < notes.length && notes[j].on === on) {
      pitches.push(notes[j].pitch)
      if (notes[j].off > off) off = notes[j].off
      j++
    }
    if (j < notes.length) {
      const next = notes[j].on
      const gap = next - off
      if (gap < 0 || (gap <= grid && gap * 2 < next - on)) off = next
    }
    segs.push({ on, off, pitches })
    i = j
  }
  return segs
}

function layoutStaff(segs: Segment[], measureCount: number, ts: TimeSignature): Measure[] {
  const tpm = ticksPerMeasureOf(ts)
  const measures: Measure[] = []
  for (let m = 0; m < measureCount; m++) measures.push({ index: m, events: [] })
  const emit = (from: number, to: number, pitches: number[]) => {
    const rest = pitches.length === 0
    let s = from
    while (s < to) {
      const m = Math.floor(s / tpm)
      const ms = m * tpm
      const e = Math.min(to, ms + tpm)
      const pieces = splitDuration(s - ms, e - s, ts, rest)
      let pos = s - ms
      for (let i = 0; i < pieces.length; i++) {
        const ev: ScoreEvent = { start: pos, duration: pieces[i], pitches: rest ? [] : pitches.slice() }
        if (!rest && (i < pieces.length - 1 || e < to)) ev.tie = true
        measures[m].events.push(ev)
        pos += pieces[i]
      }
      s = e
    }
  }
  let cursor = 0
  for (const seg of segs) {
    if (seg.on > cursor) emit(cursor, seg.on, [])
    emit(seg.on, seg.off, seg.pitches)
    cursor = seg.off
  }
  if (cursor < measureCount * tpm) emit(cursor, measureCount * tpm, [])
  for (const m of measures) {
    if (m.events.every((e) => e.pitches.length === 0)) m.events = [{ start: 0, duration: tpm, pitches: [] }]
  }
  return measures
}

interface RatingInput {
  events: number
  seconds: number
  maxPolyphony: number
  span: number
  offbeat16: number
  fifths: number
}

/** 1 = fácil, 2 = media, 3 = difícil, from density, chord size, rhythm, range and key. */
function rateDifficulty(r: RatingInput): 1 | 2 | 3 {
  if (r.events === 0) return 1
  const eps = r.events / Math.max(1, r.seconds)
  let pts = eps < 2.5 ? 0 : eps < 4.5 ? 1 : eps < 7 ? 2 : 3
  pts += r.maxPolyphony >= 5 ? 1.5 : r.maxPolyphony === 4 ? 1 : r.maxPolyphony === 3 ? 0.5 : 0
  pts += r.offbeat16 > 0.25 ? 1 : r.offbeat16 > 0.08 ? 0.5 : 0
  pts += r.span > 36 ? 0.5 : 0
  pts += Math.abs(r.fifths) >= 4 ? 0.5 : 0
  return pts < 1.5 ? 1 : pts < 3 ? 2 : 3
}

function computeStats(staffNotes: Segment[][], seconds: number, key: KeySignature): ScoreStats {
  let noteCount = 0
  let events = 0
  let maxPolyphony = 0
  let lo = Infinity
  let hi = -Infinity
  let offbeat16 = 0
  for (const segs of staffNotes) {
    for (const s of segs) {
      events++
      noteCount += s.pitches.length
      if (s.pitches.length > maxPolyphony) maxPolyphony = s.pitches.length
      if (s.on % 2 !== 0) offbeat16++
      for (const p of s.pitches) {
        if (p < lo) lo = p
        if (p > hi) hi = p
      }
    }
  }
  const range: [number, number] | null = noteCount > 0 ? [lo, hi] : null
  return {
    noteCount,
    maxPolyphony,
    range,
    notesPerSecond: seconds > 0 ? Math.round((noteCount / seconds) * 100) / 100 : 0,
    difficulty: rateDifficulty({
      events,
      seconds,
      maxPolyphony,
      span: range ? range[1] - range[0] : 0,
      offbeat16: events > 0 ? offbeat16 / events : 0,
      fifths: key.fifths,
    }),
  }
}

/** Filters, transposes, quantizes, splits hands and simplifies raw notes into a grand-staff Score. Never throws. */
export function buildScore(notes: NoteEvent[], params: ScoreParams, analysis: AnalysisResult, title = ''): Score {
  const p = sanitizeParams(params, analysis)
  const ts = p.timeSignature
  const tpm = ticksPerMeasureOf(ts)
  const secPerTick = 60 / p.bpm / 4
  let key: KeySignature
  try {
    key = transposeKey(p.key ?? normalizeKey(analysis?.key), p.transpose)
  } catch {
    key = normalizeKey(null)
  }
  let segsR: Segment[] = []
  let segsL: Segment[] = []
  let shiftMeasures = 0
  try {
    const grid = p.difficulty === 'original' && p.quantize === 16 ? 1 : 2
    const q = quantizeNotes(notes, p, grid, tpm)
    shiftMeasures = q.shiftMeasures
    const sorted = sortByOnset(q.notes)
    assignHands(sorted, p.splitPoint)
    const simple = simplify(sorted, { difficulty: p.difficulty, maxPolyphony: p.maxPolyphony, beatTicks: beatTicksOf(ts) })
    segsR = chordStream(simple.filter((n) => n.right), grid)
    segsL = chordStream(simple.filter((n) => !n.right), grid)
  } catch {
    segsR = []
    segsL = []
    shiftMeasures = 0
  }
  const lastEnd = Math.max(segsR.length ? segsR[segsR.length - 1].off : 0, segsL.length ? segsL[segsL.length - 1].off : 0)
  const measureCount = Math.max(1, Math.ceil(lastEnd / tpm))
  const right: Staff = { hand: 'right', clef: 'treble', measures: layoutStaff(segsR, measureCount, ts) }
  const left: Staff = { hand: 'left', clef: 'bass', measures: layoutStaff(segsL, measureCount, ts) }
  const durationSeconds = measureCount * tpm * secPerTick
  return {
    title: typeof title === 'string' ? title : '',
    bpm: p.bpm,
    timeSignature: ts,
    key,
    ticksPerMeasure: tpm,
    measureCount,
    durationSeconds,
    startSeconds: p.beatOffset + shiftMeasures * tpm * secPerTick,
    staves: [right, left],
    stats: computeStats([segsR, segsL], durationSeconds, key),
  }
}

/** Denormalized summary for the library item. */
export function summarizeScore(score: Score): ScoreSummary {
  return {
    key: score.key,
    bpm: score.bpm,
    timeSignature: score.timeSignature,
    difficulty: score.stats.difficulty,
    noteCount: score.stats.noteCount,
    measureCount: score.measureCount,
  }
}

/** Seconds per tick (one sixteenth) at the score tempo. */
export function secondsPerTick(score: Pick<Score, 'bpm'>): number {
  return 60 / (score.bpm > 0 ? score.bpm : 100) / 4
}

/**
 * Seconds from the start of the score (tick 0 of measure 0) to an absolute tick
 * (measureIndex * ticksPerMeasure + event.start). Add `score.startSeconds` for the source audio.
 */
export function tickToSeconds(score: Pick<Score, 'bpm'>, tick: number): number {
  return tick * secondsPerTick(score)
}

/** Inverse of tickToSeconds (fractional ticks). */
export function secondsToTick(score: Pick<Score, 'bpm'>, seconds: number): number {
  return seconds / secondsPerTick(score)
}

/** Duration of one measure in seconds. */
export function measureDurationSeconds(score: Pick<Score, 'bpm' | 'ticksPerMeasure'>): number {
  return score.ticksPerMeasure * secondsPerTick(score)
}
