// Owner: engine-score. Raw notes + params -> grand-staff Score.
import type {
  AnalysisResult,
  Difficulty,
  KeySignature,
  Measure,
  NoteEvent,
  PedalSpan,
  Score,
  ScoreParams,
  ScoreStats,
  ScoreSummary,
  Settings,
  TimeSignature,
} from '../../types'
import { SIXTEENTH, TICKS_PER_QUARTER, beatTicksOf, isTimeSignature, ticksPerMeasureOf } from './constants'
import { splitDuration } from './durations'
import { assignHands, assignHandsAuto, chooseClef } from './hands'
import { normalizeKey, transposeKey } from './keys'
import type { EngineEvent, VoicedStaff } from './notes'
import { inferPedalSeconds, pedalTicks, type PedalSeconds } from './pedal'
import { filterNotes, quantizeNotes, sortByOnset, type QNote, type SourceNote } from './quantize'
import { simplify } from './simplify'
import { createTimeMap } from './timemap'
import { splitVoices } from './voices'
import { articulate, chordStream, cutUnisons, markFree, simpleValues, tripletBeats, type Segment } from './engrave'

const DIFFICULTIES: readonly Difficulty[] = ['original', 'intermedio', 'facil']
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/**
 * How notes are given to the hands. 'auto': follow the music (voices and registers over time, the
 * split point is only a soft centre); 'fixed': pitch >= splitPoint goes right (the manual override,
 * what a user who sets "División de manos" expects). Absent = 'fixed' (items stored before 'auto').
 */
export type SplitMode = 'auto' | 'fixed'

/** ScoreParams plus engine-score's extension (requested as ScoreParams.splitMode in src/types.ts). */
export interface EngineParams extends ScoreParams {
  splitMode?: SplitMode
}

/** Initial params for a new transcription, from its analysis and the user's defaults. */
export function defaultParams(
  analysis: AnalysisResult,
  settings: Pick<Settings, 'quantize' | 'splitPoint' | 'defaultDifficulty'>,
): EngineParams {
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
    splitMode: 'auto',
  }
}

/** Params with every field valid (bad values from storage or sliders fall back to safe defaults). */
export function sanitizeParams(params: Partial<EngineParams> | null | undefined, analysis?: AnalysisResult | null): EngineParams {
  const p = params ?? {}
  const fallbackBpm = finite(analysis?.bpm) && analysis.bpm > 0 ? analysis.bpm : 100
  const range = Array.isArray(p.pitchRange) && p.pitchRange.length === 2 && p.pitchRange.every(finite)
    ? ([Math.min(...p.pitchRange), Math.max(...p.pitchRange)] as [number, number])
    : ([21, 108] as [number, number])
  const out: EngineParams = {
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
  if (p.splitMode === 'auto' || p.splitMode === 'fixed') out.splitMode = p.splitMode
  return out
}

function layoutStaff(segs: Segment[], measureCount: number, ts: TimeSignature): Measure[] {
  const tpm = ticksPerMeasureOf(ts)
  const triplets = tripletBeats(segs)
  const measures: Measure[] = []
  for (let m = 0; m < measureCount; m++) measures.push({ index: m, events: [] })
  const emit = (from: number, to: number, seg: Segment | null) => {
    let s = from
    while (s < to) {
      const m = Math.floor(s / tpm)
      const ms = m * tpm
      let e = Math.min(to, ms + tpm)
      // A triplet beat is a closed tuplet group: nothing crosses its edges.
      for (let b = Math.floor(s / TICKS_PER_QUARTER); b * TICKS_PER_QUARTER < e; b++) {
        const lo = b * TICKS_PER_QUARTER
        const hi = lo + TICKS_PER_QUARTER
        if (!triplets.has(b) && !triplets.has(b - 1)) continue
        if (triplets.has(b) && lo > s && lo < e) e = lo
        else if (triplets.has(b) && hi > s && hi < e) e = hi
        if (e <= hi) break
      }
      const pieces = splitDuration(s - ms, e - s, ts, seg === null)
      let pos = s - ms
      for (let i = 0; i < pieces.length; i++) {
        const ev: EngineEvent = { start: pos, duration: pieces[i], pitches: seg ? seg.pitches.slice() : [] }
        if (seg) {
          ev.velocities = seg.vels.slice()
          // The attack carries how long each key sounds without pedal, when that outlasts the notation.
          if (s === seg.on && i === 0 && seg.sounds.some((t) => t > seg.off)) ev.sounding = seg.sounds.map((t) => Math.max(seg.off, t) - seg.on)
          if (i < pieces.length - 1 || e < to) ev.tie = true
        }
        measures[m].events.push(ev)
        pos += pieces[i]
      }
      s = e
    }
  }
  let cursor = 0
  for (const seg of segs) {
    if (seg.on > cursor) emit(cursor, seg.on, null)
    emit(seg.on, seg.off, seg)
    cursor = seg.off
  }
  if (cursor < measureCount * tpm) emit(cursor, measureCount * tpm, null)
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

/** Stats over both voices of each staff (notes struck together by one hand count as one chord). */
function computeStats(staves: Segment[][][], seconds: number, key: KeySignature): ScoreStats {
  let noteCount = 0
  let events = 0
  let maxPolyphony = 0
  let lo = Infinity
  let hi = -Infinity
  let offbeat16 = 0
  for (const voices of staves) {
    const perOnset = new Map<number, number>()
    for (const segs of voices) {
      for (const s of segs) {
        noteCount += s.pitches.length
        perOnset.set(s.on, (perOnset.get(s.on) ?? 0) + s.pitches.length)
        for (const p of s.pitches) {
          if (p < lo) lo = p
          if (p > hi) hi = p
        }
      }
    }
    for (const [on, count] of perOnset) {
      events++
      if (count > maxPolyphony) maxPolyphony = count
      if (on % (2 * SIXTEENTH) !== 0) offbeat16++
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

/**
 * The pedal depends only on the filtered notes, not on tempo, key, hands or difficulty: the viewer
 * rebuilds the same notes on every param change, so the last result per notes array is kept.
 */
const pedalMemo = new WeakMap<object, { key: string; spans: PedalSeconds[] }>()
function pedalSecondsOf(notes: NoteEvent[], source: SourceNote[], p: ScoreParams): PedalSeconds[] {
  const key = `${p.minVelocity}|${p.minDuration}|${p.pitchRange[0]}|${p.pitchRange[1]}|${p.transpose}|${notes.length}`
  const hit = Array.isArray(notes) ? pedalMemo.get(notes) : undefined
  if (hit && hit.key === key) return hit.spans
  const spans = inferPedalSeconds(source)
  if (Array.isArray(notes)) pedalMemo.set(notes, { key, spans })
  return spans
}

/**
 * Filters, transposes, quantizes, splits hands and voices, and simplifies raw notes into a
 * grand-staff Score, with per-note velocities, the left/right clefs and the inferred sustain
 * pedal. Seconds become ticks through analysis.beatTimes when present (variable tempo), else at
 * the constant params.bpm from params.beatOffset. Never throws.
 */
export function buildScore(notes: NoteEvent[], params: EngineParams, analysis: AnalysisResult, title = ''): Score {
  const p = sanitizeParams(params, analysis)
  const ts = p.timeSignature
  const tpm = ticksPerMeasureOf(ts)
  const beat = beatTicksOf(ts)
  const secPerTick = 60 / p.bpm / TICKS_PER_QUARTER
  const map = createTimeMap(p, analysis)
  let key: KeySignature
  try {
    key = transposeKey(p.key ?? normalizeKey(analysis?.key), p.transpose)
  } catch {
    key = normalizeKey(null)
  }
  // segs[staff][voice]
  let segs: Segment[][][] = [[[], []], [[], []]]
  let clefs: ['treble' | 'bass', 'treble' | 'bass'] = ['treble', 'bass']
  let shiftMeasures = 0
  let pedals: PedalSpan[] = []
  try {
    const source = filterNotes(notes, p)
    const grid = (p.difficulty === 'original' && p.quantize === 16 ? 1 : 2) * SIXTEENTH
    const q = quantizeNotes(source, grid, tpm, map, p.difficulty === 'original')
    shiftMeasures = q.shiftMeasures
    const shiftTicks = shiftMeasures * tpm
    try {
      pedals = pedalTicks(pedalSecondsOf(notes, source, p), (t) => map.toTick(t) - shiftTicks, beat, Infinity)
    } catch {
      pedals = []
    }
    const pedalled = (from: number, to: number) => {
      // Spans are sorted and disjoint: the last span starting at or before `from` decides.
      let lo = 0
      let hi = pedals.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (pedals[mid].start <= from) lo = mid + 1
        else hi = mid
      }
      return lo > 0 && to <= pedals[lo - 1].end
    }
    const sorted = sortByOnset(q.notes)
    if (p.splitMode === 'auto') assignHandsAuto(sorted, p.splitPoint, beat)
    else assignHands(sorted, p.splitPoint)
    const simple = simplify(sorted, { difficulty: p.difficulty, maxPolyphony: p.maxPolyphony, beatTicks: beat, measureTicks: tpm })
    const hands = [simple.filter((n) => n.right), simple.filter((n) => !n.right)]
    if (p.difficulty === 'original') hands.forEach((h, i) => splitVoices(h, tpm, pedalled, i === 0))
    for (const h of hands) markFree(h, pedalled)
    const engrave = p.difficulty !== 'facil'
    if (engrave) for (const h of hands) articulate(h, simple, beat)
    segs = hands.map((h) => [chordStream(h.filter((n) => n.voice !== 2), grid, tpm), chordStream(h.filter((n) => n.voice === 2), grid, tpm)])
    for (const voices of segs) {
      cutUnisons(voices)
      if (engrave) for (const v of voices) simpleValues(v, ts, beat)
    }
    clefs = [chooseClef(hands[0].map((n) => n.pitch), 'treble'), chooseClef(hands[1].map((n) => n.pitch), 'bass')]
  } catch {
    segs = [[[], []], [[], []]]
    clefs = ['treble', 'bass']
    shiftMeasures = 0
    pedals = []
  }
  let lastEnd = 0
  let lastOn = 0
  for (const voices of segs) for (const v of voices) for (const seg of v) {
    lastEnd = Math.max(lastEnd, seg.off)
    lastOn = Math.max(lastOn, seg.on)
  }
  let measureCount = Math.max(1, Math.ceil(lastEnd / tpm))
  // A last measure holding only a tied overhang that the pedal (up to a beat) or rounding (a
  // sixteenth) produced goes: a final chord rung on by the pedal ends at the barline.
  const lastStart = (measureCount - 1) * tpm
  const overhang = lastEnd - lastStart
  const pedalOverhang = overhang <= beat && pedals.some((s) => s.start <= lastStart && s.end >= lastEnd - 1)
  if (measureCount > 1 && lastOn < lastStart && (overhang <= SIXTEENTH || pedalOverhang)) {
    measureCount--
    for (const voices of segs) for (const v of voices) for (const seg of v) seg.off = Math.min(seg.off, lastStart)
  }
  const staves = segs.map((voices, si) => {
    const staff: VoicedStaff = {
      hand: si === 0 ? 'right' : 'left',
      clef: clefs[si],
      measures: layoutStaff(voices[0], measureCount, ts),
    }
    if (voices[1].length) staff.voice2 = layoutStaff(voices[1], measureCount, ts)
    return staff
  }) as [VoicedStaff, VoicedStaff]
  const durationSeconds = measureCount * tpm * secPerTick
  const shiftTicks = shiftMeasures * tpm
  const total = measureCount * tpm
  pedals = pedals.map((s) => ({ start: s.start, end: Math.min(total, s.end) })).filter((s) => s.end - s.start >= 2)
  const score: Score = {
    title: typeof title === 'string' ? title : '',
    bpm: p.bpm,
    timeSignature: ts,
    key,
    ticksPerMeasure: tpm,
    measureCount,
    durationSeconds,
    startSeconds: map.toSeconds(shiftTicks),
    staves,
    stats: computeStats(segs, durationSeconds, key),
  }
  if (pedals.length) score.pedals = pedals
  return score
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

/** Seconds per tick (TICKS_PER_QUARTER per quarter) at the score tempo. */
export function secondsPerTick(score: Pick<Score, 'bpm'>): number {
  return 60 / (score.bpm > 0 ? score.bpm : 100) / TICKS_PER_QUARTER
}

/**
 * Seconds from the start of the score (tick 0 of measure 0) to an absolute tick
 * (measureIndex * ticksPerMeasure + event.start), at the score tempo (playback time). For the
 * source audio use sourceSecondsAt (it follows the beat map of a rubato performance).
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
