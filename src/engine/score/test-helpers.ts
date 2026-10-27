// Owner: engine-score. Deterministic synthetic note streams and score builders for the engine tests
// (not used by the app).
import type { AnalysisResult, KeyMode, KeySignature, NoteEvent, Score, ScoreEvent, ScoreParams, TimeSignature } from '../../types'
import { ticksPerMeasureOf } from './constants'
import { keyFromFifths } from './keys'

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type StreamStyle = 'melody' | 'chords' | 'arpeggio' | 'waltz'

export interface StreamOptions {
  bpm: number
  style: StreamStyle
  bars?: number
  /** Uniform onset jitter, +- milliseconds. */
  jitterMs?: number
  seed?: number
  /** Tonic pitch class (0 = C). */
  tonic?: number
  mode?: KeyMode
  /** Seconds before the first downbeat. */
  lead?: number
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11]

/**
 * A plausible piano texture: I-IV-V-I (major) or i-iv-V-i (harmonic minor) progressions, bass
 * on strong beats, a melody mostly in quarters with some eighths and half notes, metric accents.
 */
export function makeStream(o: StreamOptions): NoteEvent[] {
  const rand = rng(o.seed ?? 1)
  const meter = o.style === 'waltz' ? 3 : 4
  const bars = o.bars ?? 12
  const beat = 60 / o.bpm
  const jitter = (o.jitterMs ?? 0) / 1000
  const tonic = o.tonic ?? 0
  const scale = (o.mode ?? 'major') === 'minor' ? HARMONIC_MINOR : MAJOR
  const lead = o.lead ?? 0.25
  const out: NoteEvent[] = []
  const add = (pitch: number, beatPos: number, beats: number, velocity: number) => {
    const j = (rand() * 2 - 1) * jitter
    out.push({ pitch, start: Math.max(0, lead + beatPos * beat + j), duration: beats * beat * 0.92, velocity })
  }
  // Scale degrees (0-based) of the chord roots: I IV V I.
  const progression = [0, 3, 4, 0]
  const deg = (d: number, octave: number) => {
    const i = ((d % 7) + 7) % 7
    return 12 * (octave + 1) + tonic + scale[i] + 12 * Math.floor(d / 7)
  }
  for (let bar = 0; bar < bars; bar++) {
    const root = progression[bar % progression.length]
    const t0 = bar * meter
    const triad = [root, root + 2, root + 4]
    // Left hand
    if (o.style === 'waltz') {
      add(deg(root, 2), t0, 1, 0.85)
      for (const b of [1, 2]) for (const d of triad) add(deg(d, 3), t0 + b, 0.8, 0.55)
    } else if (o.style === 'chords') {
      for (let b = 0; b < meter; b++) {
        const v = b === 0 ? 0.9 : b === 2 ? 0.78 : 0.68
        add(deg(root, 2), t0 + b, 1, v)
        for (const d of triad) add(deg(d, 3), t0 + b, 1, v - 0.08)
      }
    } else if (o.style === 'arpeggio') {
      const figure = [root, root + 4, root + 7, root + 4]
      for (let e = 0; e < meter * 2; e++) add(deg(figure[e % 4], 2), t0 + e / 2, 0.5, e === 0 ? 0.85 : e % 2 === 0 ? 0.7 : 0.58)
    } else {
      add(deg(root, 2), t0, 2, 0.85)
      add(deg(root + 4, 2), t0 + 2, 2, 0.72)
    }
    // Right hand melody: chord tones on strong beats, stepwise elsewhere.
    let b = 0
    let d = triad[Math.floor(rand() * 3)] + 7
    while (b < meter) {
      const r = rand()
      const strong = b === 0
      let len = r < 0.6 ? 1 : r < 0.85 ? 0.5 : 2
      if (b + len > meter) len = meter - b
      if (len === 0.5) {
        add(deg(d, 4), t0 + b, 0.5, strong ? 0.85 : 0.66)
        d += rand() < 0.5 ? 1 : -1
        add(deg(d, 4), t0 + b + 0.5, 0.5, 0.6)
        b += 1
      } else {
        add(deg(d, 4), t0 + b, len, strong ? 0.88 : 0.72)
        b += len
      }
      d = Math.max(4, Math.min(12, d + (rand() < 0.5 ? 1 : -1) * (rand() < 0.7 ? 1 : 2)))
    }
  }
  // Final tonic chord.
  const tEnd = bars * meter
  add(deg(0, 2), tEnd, meter, 0.85)
  add(deg(0, 4), tEnd, meter, 0.85)
  add(deg(2, 4), tEnd, meter, 0.75)
  add(deg(4, 4), tEnd, meter, 0.75)
  return out.sort((a, b) => a.start - b.start)
}

/** Random raw notes (any pitch 21..108, overlapping, chords, odd timings) for robustness tests. */
export function randomNotes(count: number, seed: number, seconds = 30): NoteEvent[] {
  const rand = rng(seed)
  const out: NoteEvent[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      pitch: 21 + Math.floor(rand() * 88),
      start: rand() * seconds,
      duration: 0.03 + rand() * rand() * 2,
      velocity: 0.05 + rand() * 0.95,
    })
  }
  return out.sort((a, b) => a.start - b.start)
}

/** Analysis with known values (no detection), first downbeat at 0. */
export function knownAnalysis(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    bpm: 120,
    bpmConfidence: 1,
    beatOffset: 0,
    timeSignature: '4/4',
    key: keyFromFifths(0, 'major'),
    keyConfidence: 1,
    ...over,
  }
}

/** Params that keep every note (no filters, no simplification). */
export function plainParams(analysis: AnalysisResult, over: Partial<ScoreParams> = {}): ScoreParams {
  return {
    bpm: analysis.bpm,
    beatOffset: analysis.beatOffset,
    timeSignature: analysis.timeSignature,
    key: null,
    quantize: 16,
    splitPoint: 60,
    difficulty: 'original',
    transpose: 0,
    minVelocity: 0,
    minDuration: 0,
    pitchRange: [21, 108],
    maxPolyphony: 6,
    ...over,
  }
}

/** A note at a position given in sixteenths (ticks) at `bpm`. */
export function tickNote(pitch: number, onTick: number, ticks: number, bpm = 120, velocity = 0.8): NoteEvent {
  const tick = 60 / bpm / 4
  return { pitch, start: onTick * tick, duration: ticks * tick, velocity }
}

/**
 * Builds a Score directly from per-measure events (both staves padded to the same length with
 * whole-measure rests). For writer tests that need exact control over events and ties.
 */
export function scoreFromMeasures(
  right: ScoreEvent[][],
  left: ScoreEvent[][] = [],
  opts: { key?: KeySignature; timeSignature?: TimeSignature; bpm?: number; title?: string } = {},
): Score {
  const ts = opts.timeSignature ?? '4/4'
  const tpm = ticksPerMeasureOf(ts)
  const bpm = opts.bpm ?? 120
  const count = Math.max(1, right.length, left.length)
  const staff = (measures: ScoreEvent[][]) =>
    Array.from({ length: count }, (_, index) => ({
      index,
      events: measures[index]?.length ? measures[index] : [{ start: 0, duration: tpm, pitches: [] }],
    }))
  const notes = [...right, ...left].flat().filter((e) => e.pitches.length > 0)
  const all = notes.flatMap((e) => e.pitches)
  return {
    title: opts.title ?? '',
    bpm,
    timeSignature: ts,
    key: opts.key ?? keyFromFifths(0, 'major'),
    ticksPerMeasure: tpm,
    measureCount: count,
    durationSeconds: (count * tpm * 60) / bpm / 4,
    startSeconds: 0,
    staves: [
      { hand: 'right', clef: 'treble', measures: staff(right) },
      { hand: 'left', clef: 'bass', measures: staff(left) },
    ],
    stats: {
      noteCount: all.length,
      maxPolyphony: Math.max(0, ...notes.map((e) => e.pitches.length)),
      range: all.length ? [Math.min(...all), Math.max(...all)] : null,
      notesPerSecond: 0,
      difficulty: 1,
    },
  }
}

/** One sounding note of a staff after merging ties: absolute start and length in ticks. */
export interface StaffNote {
  pitch: number
  start: number
  ticks: number
}

/** The notes a staff sounds: tied events merged into one note per pitch (the playback oracle). */
export function staffNotes(score: Score, staffIndex: 0 | 1): StaffNote[] {
  const out: StaffNote[] = []
  const open = new Map<number, StaffNote>()
  let prevTie = false
  let prevPitches = new Set<number>()
  for (const m of score.staves[staffIndex].measures) {
    for (const ev of m.events) {
      const at = m.index * score.ticksPerMeasure + ev.start
      const next = new Map<number, StaffNote>()
      for (const p of ev.pitches) {
        const cont = prevTie && prevPitches.has(p) ? open.get(p) : undefined
        if (cont && cont.start + cont.ticks === at) {
          cont.ticks += ev.duration
          next.set(p, cont)
        } else {
          const n = { pitch: p, start: at, ticks: ev.duration }
          out.push(n)
          next.set(p, n)
        }
      }
      open.clear()
      for (const [p, n] of next) open.set(p, n)
      prevTie = ev.pitches.length > 0 && ev.tie === true
      prevPitches = new Set(ev.pitches)
    }
  }
  return out.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}
