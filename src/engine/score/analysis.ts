// Owner: engine-score. Tempo, beat phase, downbeat, meter and key estimation from raw notes.
//
// Beat offset convention: `beatOffset` is the first downbeat at or after the first onset (minus a
// quarter-beat tolerance, so a slightly early first note still counts as "on" the downbeat). Notes
// before it (a pickup) get negative ticks in buildScore, which then shifts the score by whole
// measures: the pickup lands at the end of a leading measure that starts with rests.
import type { AnalysisResult, NoteEvent, TimeSignature } from '../../types'
import { keyFromFifths, mod } from './keys'
import { estimateKey } from './keyfinder'
import { MAX_BPM, MIN_BPM, chooseTempo, fitGrid, periodicity, refineTempo, type Onset } from './tempo'

/** Notes starting within this window form one onset (a chord). */
const CHORD_WINDOW = 0.03

export function emptyAnalysis(): AnalysisResult {
  return {
    bpm: 100,
    bpmConfidence: 0,
    beatOffset: 0,
    timeSignature: '4/4',
    key: keyFromFifths(0, 'major'),
    keyConfidence: 0,
  }
}

/** Tempo (with beat phase), key and meter estimation from raw notes. Never throws. */
export function analyzeNotes(notes: NoteEvent[]): AnalysisResult {
  try {
    return analyze(cleanNotes(notes))
  } catch {
    return emptyAnalysis()
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const round2 = (x: number) => Math.round(x * 100) / 100
const round3 = (x: number) => Math.round(x * 1000) / 1000

function cleanNotes(notes: NoteEvent[]): NoteEvent[] {
  if (!Array.isArray(notes)) return []
  const out: NoteEvent[] = []
  for (const n of notes) {
    if (!n || !Number.isFinite(n.start) || !Number.isFinite(n.pitch)) continue
    out.push({
      pitch: Math.round(n.pitch),
      start: n.start,
      duration: Number.isFinite(n.duration) ? Math.max(0, n.duration) : 0,
      velocity: Number.isFinite(n.velocity) ? clamp(n.velocity, 0, 1) : 0.7,
    })
  }
  return out.sort((a, b) => a.start - b.start)
}

function percentile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]
}

function analyze(notes: NoteEvent[]): AnalysisResult {
  if (notes.length === 0) return emptyAnalysis()
  const { key, keyConfidence } = estimateKey(notes)
  const pitches = notes.map((n) => n.pitch).sort((a, b) => a - b)
  const onsets = buildOnsets(notes, percentile(pitches, 0.1), percentile(pitches, 0.9))
  const span = onsets[onsets.length - 1].t - onsets[0].t
  if (onsets.length < 4 || span < 1) {
    return { ...emptyAnalysis(), beatOffset: round3(Math.max(0, onsets[0].t)), key, keyConfidence }
  }

  // 1. Periodicity peak, 2. octave / ratio choice, 3. precise integer tempo and its phase.
  const peak = periodicity(onsets, span)
  const choice = chooseTempo(onsets, peak.best)
  const bpm = clamp(Math.round(refineTempo(onsets, choice.bpm, 0.015)), MIN_BPM, MAX_BPM)
  const grid = fitGrid(onsets, bpm)
  const period = 60 / bpm

  // 4. Meter and downbeat from beat accents (bass notes, long notes, loud chords).
  const accents = beatAccents(onsets, grid.phase, period, percentile(pitches, 0.1))
  const timeSignature = chooseMeter(accents.values)
  const perBar = timeSignature === '3/4' ? 3 : 4
  const downbeat = chooseDownbeat(accents.values, perBar)
  let k = Math.ceil((onsets[0].t - period / 4 - grid.phase) / period)
  while (mod(k - accents.firstIndex - downbeat, perBar) !== 0) k++

  const countFactor = 1 - Math.exp(-onsets.length / 12)
  const bpmConfidence = clamp(grid.fit * (0.4 + 0.6 * peak.salience) * countFactor, 0, 1)
  return {
    bpm,
    bpmConfidence: round2(bpmConfidence),
    beatOffset: round3(grid.phase + k * period),
    timeSignature,
    key,
    keyConfidence,
  }
}

/** Merges chord notes (within 30 ms) into weighted onsets. */
function buildOnsets(notes: NoteEvent[], low: number, high: number): Onset[] {
  const out: Onset[] = []
  const height = (p: number) => 0.35 + 0.65 * clamp((p - low) / Math.max(1, high - low), 0, 1)
  let i = 0
  while (i < notes.length) {
    const t0 = notes[i].start
    let j = i
    let sumV = 0
    let maxV = 0
    let sumT = 0
    let sumM = 0
    let maxM = 0
    let lowest = Infinity
    let dur = 0
    while (j < notes.length && notes[j].start - t0 <= CHORD_WINDOW) {
      const n = notes[j]
      const v = Math.max(0.05, n.velocity)
      const m = v * height(n.pitch)
      sumV += v
      sumT += v * n.start
      maxV = Math.max(maxV, v)
      sumM += m
      maxM = Math.max(maxM, m)
      lowest = Math.min(lowest, n.pitch)
      dur = Math.max(dur, n.duration)
      j++
    }
    out.push({
      t: sumT / sumV,
      w: Math.min(maxV + 0.25 * (sumV - maxV), 2 * maxV),
      m: Math.min(maxM + 0.3 * (sumM - maxM), 2 * maxM),
      low: lowest,
      dur,
    })
    i = j
  }
  return out
}

interface BeatAccents {
  values: number[]
  /** Beat index (relative to the phase) of values[0]. */
  firstIndex: number
}

/** Accent per beat slot: onset strength boosted by bass notes (near the lowest pitches) and long notes. */
function beatAccents(onsets: Onset[], phase: number, period: number, bassRef: number): BeatAccents {
  const firstIndex = Math.round((onsets[0].t - phase) / period)
  const lastIndex = Math.round((onsets[onsets.length - 1].t - phase) / period)
  const values = new Array<number>(Math.max(1, lastIndex - firstIndex + 1)).fill(0)
  const tol = period * 0.2
  for (const o of onsets) {
    const k = Math.round((o.t - phase) / period)
    if (Math.abs(o.t - (phase + k * period)) > tol) continue
    const bass = clamp(1 - (o.low - bassRef) / 7, 0, 1)
    const long = clamp(o.dur / (2 * period), 0, 1)
    values[k - firstIndex] += o.w * (1 + bass + 0.5 * long)
  }
  return { values, firstIndex }
}

/** Mean accent of the strongest residue class mod m, relative to the overall mean (>= 1). */
function contrast(values: number[], m: number): number {
  const sums = new Array<number>(m).fill(0)
  const counts = new Array<number>(m).fill(0)
  let total = 0
  for (let k = 0; k < values.length; k++) {
    sums[k % m] += values[k]
    counts[k % m]++
    total += values[k]
  }
  const mean = total / values.length
  if (mean <= 0) return 1
  let best = 0
  for (let j = 0; j < m; j++) if (counts[j] > 0) best = Math.max(best, sums[j] / counts[j])
  return best / mean
}

/** 4/4 unless a 3-beat accent periodicity clearly wins (needs about 6 bars). */
function chooseMeter(values: number[]): TimeSignature {
  if (values.length < 18) return '4/4'
  const c3 = contrast(values, 3) - 1
  const c2 = contrast(values, 2) - 1
  const c4 = contrast(values, 4) - 1
  return c3 > 0.15 && c3 > 1.5 * Math.max(c2, c4, 0.02) ? '3/4' : '4/4'
}

/** Residue (beat index mod perBar, counted from the first onset's beat) of the downbeat. */
function chooseDownbeat(values: number[], perBar: number): number {
  const sums = new Array<number>(perBar).fill(0)
  const counts = new Array<number>(perBar).fill(0)
  let total = 0
  for (let k = 0; k < values.length; k++) {
    sums[k % perBar] += values[k]
    counts[k % perBar]++
    total += values[k]
  }
  const mean = (j: number) => sums[j] / Math.max(1, counts[j])
  // Mild preference for a piece starting on a downbeat.
  const bonus = (0.15 * total) / Math.max(1, values.length)
  let best = 0
  for (let j = 1; j < perBar; j++) if (counts[j] > 0 && mean(j) > mean(best) + (best === 0 ? bonus : 0)) best = j
  return best
}
