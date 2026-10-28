// Owner: engine-score. buildScore: filters, transposition, quantization, hands, difficulty, layout.
import { describe, expect, it } from 'vitest'
import type { Difficulty, Measure, NoteEvent, Score, ScoreEvent, ScoreParams, TimeSignature } from '../../types'
import {
  NOTE_VALUES,
  TUPLET_VALUES,
  analyzeNotes,
  buildScore,
  defaultParams,
  keyFromFifths,
  measureDurationSeconds,
  sanitizeParams,
  secondsPerTick,
  scoreNotes,
  secondsToTick,
  staffVoices,
  summarizeScore,
  tickToSeconds,
} from './index'
import { knownAnalysis, plainParams, randomNotes, staffNotes, tickNote } from './test-helpers'

const analysis = knownAnalysis() // 120 bpm: one tick (sixteenth) = 0.125 s
const build = (notes: NoteEvent[], over: Partial<ScoreParams> = {}, a = analysis) => buildScore(notes, plainParams(a, over), a)
const n = (pitch: number, on: number, ticks: number, velocity = 0.8) => tickNote(pitch, on, ticks, 120, velocity)

/** Every event of a staff with its absolute tick. */
function events(score: Score, staff: 0 | 1): (ScoreEvent & { at: number })[] {
  return score.staves[staff].measures.flatMap((m) => m.events.map((e) => ({ ...e, at: m.index * score.ticksPerMeasure + e.start })))
}

/** Structural invariants every Score must satisfy. */
function expectWellFormed(score: Score, maxPolyphony = 6): void {
  const values = new Set([...NOTE_VALUES, ...TUPLET_VALUES])
  expect(score.measureCount).toBeGreaterThanOrEqual(1)
  for (const [si, staff] of score.staves.entries()) {
    expect(staff.hand).toBe(si === 0 ? 'right' : 'left')
    expect(['treble', 'bass']).toContain(staff.clef)
    for (const [vi, measures] of staffVoices(staff).entries()) checkVoice(score, staff, si as 0 | 1, vi, measures, maxPolyphony, values)
  }
  // The last measure holds music in some voice (trailing empty measures are trimmed).
  if (score.stats.noteCount > 0) {
    const last = score.measureCount - 1
    expect(score.staves.some((s) => staffVoices(s).some((v) => v[last].events.some((e) => e.pitches.length > 0)))).toBe(true)
  }
}

/** One voice of a staff: measures tile exactly, notatable values, sorted pitches, consistent ties. */
function checkVoice(score: Score, staff: Score['staves'][number], si: 0 | 1, vi: number, measures: Measure[], maxPolyphony: number, values: Set<number>): void {
  {
    expect(measures).toHaveLength(score.measureCount)
    measures.forEach((m, i) => {
      expect(m.index).toBe(i)
      let pos = 0
      for (const e of m.events) {
        expect(e.start).toBe(pos)
        expect(values.has(e.duration)).toBe(true)
        if (e.pitches.length === 0) expect(e.tie).toBeFalsy()
        expect(e.pitches.length).toBeLessThanOrEqual(maxPolyphony)
        expect([...e.pitches].sort((a, b) => a - b)).toEqual(e.pitches)
        for (const p of e.pitches) expect(p >= 21 && p <= 108).toBe(true)
        pos += e.duration
      }
      expect(pos).toBe(score.ticksPerMeasure)
    })
    const evs = measures.flatMap((m) => m.events.map((e) => ({ ...e, at: m.index * score.ticksPerMeasure + e.start })))
    evs.forEach((e, i) => {
      if (e.pitches.length) expect(e.velocities, `staff ${si} voice ${vi + 1}: velocities parallel to pitches`).toHaveLength(e.pitches.length)
      if (!e.tie) return
      const next = evs[i + 1]
      expect(next, 'a tie needs a following event').toBeDefined()
      expect(next.at).toBe(e.at + e.duration)
      expect(next.pitches).toEqual(e.pitches)
    })
    void staff
  }
}

describe('defaultParams / sanitizeParams', () => {
  it('takes tempo, phase and meter from the analysis and the rest from the settings', () => {
    const a = knownAnalysis({ bpm: 96, beatOffset: 0.42, timeSignature: '3/4', key: keyFromFifths(2, 'major') })
    expect(defaultParams(a, { quantize: 8, splitPoint: 55, defaultDifficulty: 'facil' })).toEqual({
      bpm: 96,
      beatOffset: 0.42,
      timeSignature: '3/4',
      key: null,
      quantize: 8,
      splitPoint: 55,
      difficulty: 'facil',
      transpose: 0,
      minVelocity: 0.1,
      minDuration: 0.05,
      pitchRange: [21, 108],
      maxPolyphony: 10,
      splitMode: 'auto',
    })
  })

  it('falls back to safe values', () => {
    const p = defaultParams(null as never, null as never)
    expect(p).toMatchObject({ bpm: 100, beatOffset: 0, timeSignature: '4/4', quantize: 16, splitPoint: 60, difficulty: 'original' })
    const s = sanitizeParams({ bpm: -3, timeSignature: '5/4' as TimeSignature, quantize: 3 as never, transpose: 40, maxPolyphony: 0, pitchRange: [90, 30], minVelocity: 7 })
    expect(s).toMatchObject({ bpm: 100, timeSignature: '4/4', quantize: 16, transpose: 12, maxPolyphony: 1, pitchRange: [30, 90], minVelocity: 1 })
    expect(sanitizeParams(undefined, knownAnalysis({ bpm: 87, beatOffset: 1.5 }))).toMatchObject({ bpm: 87, beatOffset: 1.5 })
  })
})

describe('buildScore basics', () => {
  it('turns empty input into one measure of rests on both staves', () => {
    const score = build([])
    expect(score.measureCount).toBe(1)
    for (const staff of score.staves) expect(staff.measures[0].events).toEqual([{ start: 0, duration: 48, pitches: [] }])
    expect(score.stats).toEqual({ noteCount: 0, maxPolyphony: 0, range: null, notesPerSecond: 0, difficulty: 1 })
    expect(score.durationSeconds).toBe(2)
    expect(score.startSeconds).toBe(0)
    expectWellFormed(score)
  })

  it('never throws on garbage', () => {
    const garbage = [
      null,
      { pitch: Number.NaN, start: 0, duration: 1, velocity: 1 },
      { pitch: 60, start: Number.POSITIVE_INFINITY, duration: 1, velocity: 1 },
      { pitch: 60, start: 0.5, duration: -2, velocity: Number.NaN },
      { pitch: 200, start: 1, duration: 1, velocity: 1 },
      { pitch: 64, start: 1e9, duration: 1e9, velocity: 1 },
    ] as unknown as NoteEvent[]
    expect(() => buildScore(garbage, plainParams(analysis), analysis)).not.toThrow()
    expect(() => buildScore(null as never, null as never, null as never)).not.toThrow()
    expect(() => buildScore('x' as never, { bpm: 0 } as never, {} as never)).not.toThrow()
    expectWellFormed(buildScore(garbage, plainParams(analysis), analysis))
    expectWellFormed(buildScore(null as never, null as never, null as never))
  })

  it('writes a simple melody exactly', () => {
    const score = build([n(60, 0, 4), n(62, 4, 4), n(64, 8, 8), n(67, 16, 16)])
    expect(score.measureCount).toBe(2)
    expect(score.staves[0].measures[0].events).toEqual([
      { start: 0, duration: 12, pitches: [60], velocities: [0.8] },
      { start: 12, duration: 12, pitches: [62], velocities: [0.8] },
      { start: 24, duration: 24, pitches: [64], velocities: [0.8] },
    ])
    expect(score.staves[0].measures[1].events).toEqual([{ start: 0, duration: 48, pitches: [67], velocities: [0.8] }])
    expect(score.staves[1].measures.every((m) => m.events.length === 1 && m.events[0].pitches.length === 0)).toBe(true)
    expect(score.stats.noteCount).toBe(4)
    expect(score.stats.range).toEqual([60, 67])
  })

  it('fills gaps with rests by beats', () => {
    const score = build([n(72, 0, 4), n(74, 12, 4)])
    expect(score.staves[0].measures[0].events).toEqual([
      { start: 0, duration: 12, pitches: [72], velocities: [0.8] },
      { start: 12, duration: 12, pitches: [] },
      { start: 24, duration: 12, pitches: [] },
      { start: 36, duration: 12, pitches: [74], velocities: [0.8] },
    ])
  })

  it('reads a short release gap as legato and a long one as a rest', () => {
    const legato = build([n(72, 0, 3), n(74, 4, 4)])
    expect(legato.staves[0].measures[0].events[0]).toEqual({ start: 0, duration: 12, pitches: [72], velocities: [0.8] })
    const detached = build([n(72, 0, 1), n(74, 4, 4)])
    expect(detached.staves[0].measures[0].events.slice(0, 2)).toEqual([
      { start: 0, duration: 3, pitches: [72], velocities: [0.8] },
      { start: 3, duration: 9, pitches: [] },
    ])
  })

  it('cuts a held note at the next onset of the same staff (one chord stream per staff)', () => {
    const score = build([n(60, 0, 16), n(64, 4, 4)])
    expect(score.staves[0].measures[0].events.slice(0, 2)).toEqual([
      { start: 0, duration: 12, pitches: [60], velocities: [0.8], sounding: [48] },
      { start: 12, duration: 12, pitches: [64], velocities: [0.8] },
    ])
    // Written up to the next note, but playback holds the key as long as it sounded (no pedal).
    expect(scoreNotes(score).map((x) => [x.pitch, x.tick, x.ticks, x.sounding])).toEqual([
      [60, 0, 12, 48],
      [64, 12, 12, undefined],
    ])
  })
})

describe('ties', () => {
  it('ties notes over the barline', () => {
    const score = build([n(72, 12, 8)])
    expect(score.staves[0].measures[0].events.at(-1)).toEqual({ start: 36, duration: 12, pitches: [72], velocities: [0.8], tie: true })
    expect(score.staves[0].measures[1].events).toEqual([
      { start: 0, duration: 12, pitches: [72], velocities: [0.8] },
      { start: 12, duration: 12, pitches: [] },
      { start: 24, duration: 24, pitches: [] },
    ])
    expect(score.stats.noteCount).toBe(1)
    expect(staffNotes(score, 0)).toEqual([{ pitch: 72, start: 12, ticks: 8 }])
  })

  it('ties chords over the half-bar and across several measures', () => {
    const score = build([n(60, 6, 4), n(64, 6, 4), n(67, 6, 4), n(48, 0, 40)])
    expect(score.staves[0].measures[0].events).toEqual([
      { start: 0, duration: 12, pitches: [] },
      { start: 12, duration: 6, pitches: [] },
      { start: 18, duration: 6, pitches: [60, 64, 67], velocities: [0.8, 0.8, 0.8], tie: true },
      { start: 24, duration: 6, pitches: [60, 64, 67], velocities: [0.8, 0.8, 0.8] },
      { start: 30, duration: 6, pitches: [] },
      { start: 36, duration: 12, pitches: [] },
    ])
    expect(staffNotes(score, 1)).toEqual([{ pitch: 48, start: 0, ticks: 40 }])
    expect(score.measureCount).toBe(3)
    expectWellFormed(score)
  })
})

describe('filters and transposition', () => {
  it('drops quiet, short and out-of-range notes', () => {
    const notes = [n(60, 0, 4, 0.05), n(62, 4, 4), { ...n(64, 8, 4), duration: 0.03 }, n(30, 12, 4), n(100, 12, 4)]
    const score = build(notes, { minVelocity: 0.1, minDuration: 0.05, pitchRange: [36, 96] })
    expect(staffNotes(score, 0).map((x) => x.pitch)).toEqual([62])
    expect(staffNotes(score, 1)).toEqual([])
  })

  it('transposes notes and the key', () => {
    const a = knownAnalysis({ key: keyFromFifths(0, 'major') })
    const score = build([n(60, 0, 4), n(64, 0, 4), n(67, 0, 4)], { transpose: 2 }, a)
    expect(score.staves[0].measures[0].events[0].pitches).toEqual([62, 66, 69])
    expect(score.key).toEqual(keyFromFifths(2, 'major'))
    expect(build([n(60, 0, 4)], { transpose: -2 }, knownAnalysis({ key: keyFromFifths(1, 'major') })).key.tonic).toBe('F')
  })

  it('uses params.key when set (instead of the analysed key) and transposes it', () => {
    const a = knownAnalysis({ key: keyFromFifths(3, 'major') })
    expect(build([n(60, 0, 4)], { key: keyFromFifths(-1, 'major') }, a).key.tonic).toBe('F')
    expect(build([n(60, 0, 4)], { key: keyFromFifths(-1, 'major'), transpose: 2 }, a).key.tonic).toBe('G')
  })

  it('folds transposed pitches back into the piano range by octaves', () => {
    const up = build([n(107, 0, 4)], { transpose: 5 })
    expect(staffNotes(up, 0)[0].pitch).toBe(100)
    const down = build([n(22, 0, 4)], { transpose: -5 })
    expect(staffNotes(down, 1)[0].pitch).toBe(29)
  })

  it('filters by the raw (untransposed) range', () => {
    const score = build([n(50, 0, 4), n(70, 0, 4)], { pitchRange: [48, 72], transpose: 12 })
    expect(staffNotes(score, 0).map((x) => x.pitch)).toEqual([62, 82])
  })
})

describe('quantization', () => {
  it('snaps onsets and ends to the sixteenth grid relative to beatOffset', () => {
    const a = knownAnalysis({ beatOffset: 0.3 })
    // 0.3 + 4.1 ticks and 0.3 + 7.9 ticks
    const score = buildScore([{ pitch: 72, start: 0.3 + 4.1 * 0.125, duration: 3.8 * 0.125, velocity: 0.8 }], plainParams(a), a)
    expect(staffNotes(score, 0)).toEqual([{ pitch: 72, start: 4, ticks: 4 }])
  })

  it('uses the eighth grid with quantize 8', () => {
    const score = build([n(72, 1, 1), n(74, 5, 3), n(76, 11, 1)], { quantize: 8 })
    for (const e of events(score, 0)) expect(e.at % 2).toBe(0)
    expect(staffNotes(score, 0).map((x) => x.start)).toEqual([2, 6, 12])
  })

  it('merges duplicates (keeping the longest) and cuts same-pitch overlaps', () => {
    const dup = build([n(72, 0, 2), n(72, 0, 8, 0.4)])
    expect(staffNotes(dup, 0)).toEqual([{ pitch: 72, start: 0, ticks: 8 }])
    const overlap = build([n(72, 0, 8), n(72, 4, 4)])
    expect(staffNotes(overlap, 0)).toEqual([
      { pitch: 72, start: 0, ticks: 4 },
      { pitch: 72, start: 4, ticks: 4 },
    ])
  })

  it('shifts by whole measures so the first note lands in measure 0', () => {
    const a = knownAnalysis({ beatOffset: 0.5 })
    const score = buildScore([{ pitch: 72, start: 10, duration: 0.5, velocity: 0.8 }], plainParams(a), a)
    expect(score.measureCount).toBe(1)
    expect(staffNotes(score, 0)).toEqual([{ pitch: 72, start: 12, ticks: 4 }])
    expect(score.startSeconds).toBeCloseTo(8.5, 9)
    expect(score.startSeconds + tickToSeconds(score, 36)).toBeCloseTo(10, 9)
  })

  it('puts a pickup at the end of a leading measure', () => {
    const a = knownAnalysis({ beatOffset: 2 })
    const score = buildScore([{ pitch: 67, start: 1.5, duration: 0.5, velocity: 0.8 }, { pitch: 72, start: 2, duration: 2, velocity: 0.8 }], plainParams(a), a)
    expect(score.startSeconds).toBeCloseTo(0, 9)
    expect(staffNotes(score, 0)).toEqual([
      { pitch: 67, start: 12, ticks: 4 },
      { pitch: 72, start: 16, ticks: 16 },
    ])
  })
})

describe('hands', () => {
  it('splits at splitPoint (pitch >= splitPoint goes right)', () => {
    const score = build([n(59, 0, 4), n(60, 4, 4)])
    expect(staffNotes(score, 0).map((x) => x.pitch)).toEqual([60])
    expect(staffNotes(score, 1).map((x) => x.pitch)).toEqual([59])
    const high = build([n(59, 0, 4), n(60, 4, 4)], { splitPoint: 64 })
    expect(staffNotes(high, 1).map((x) => x.pitch)).toEqual([59, 60])
  })

  it('keeps a chord that straddles the split by up to 2 semitones in its majority hand', () => {
    const chord = (ps: number[], on: number) => ps.map((p) => n(p, on, 4))
    const score = build([...chord([58, 62, 65], 0), ...chord([55, 62, 65], 4), ...chord([55, 57, 61], 8), ...chord([55, 57, 62], 12), n(36, 0, 4)])
    expect(events(score, 0).filter((e) => e.pitches.length).map((e) => e.pitches)).toEqual([[58, 62, 65], [62, 65], [62]])
    expect(events(score, 1).filter((e) => e.pitches.length).map((e) => e.pitches)).toEqual([[36], [55], [55, 57, 61], [55, 57]])
  })
})

describe('polyphony and difficulty', () => {
  const chord = (ps: number[], on: number, vels: number[] = []) => ps.map((p, i) => n(p, on, 4, vels[i] ?? 0.8))

  it('caps polyphony per hand keeping the outer voices, then the loudest', () => {
    const notes = [...chord([64, 67, 72, 76], 0, [0.8, 0.9, 0.5, 0.8]), ...chord([36, 43, 48, 52], 0)]
    expect(build(notes, { maxPolyphony: 2 }).staves[0].measures[0].events[0].pitches).toEqual([64, 76])
    expect(build(notes, { maxPolyphony: 3 }).staves[0].measures[0].events[0].pitches).toEqual([64, 67, 76])
    expect(build(notes, { maxPolyphony: 1 }).staves[0].measures[0].events[0].pitches).toEqual([76])
    expect(build(notes, { maxPolyphony: 1 }).staves[1].measures[0].events[0].pitches).toEqual([36])
  })

  it('intermedio: eighth grid, at most 3 notes per hand, ghost notes of big chords dropped', () => {
    const score = build([...chord([64, 67, 72], 0, [0.9, 0.3, 0.9]), n(72, 5, 1, 0.5), n(74, 6, 2, 0.9)], { difficulty: 'intermedio' })
    expect(events(score, 0).filter((e) => e.pitches.length).map((e) => [e.at, e.pitches])).toEqual([
      [0, [64, 72]],
      [18, [74]],
    ])
    for (const seed of [1, 2, 3]) {
      const dense = build(randomNotes(500, seed, 20), { difficulty: 'intermedio' })
      expectWellFormed(dense, 3)
      for (const s of [0, 1] as const) for (const e of events(dense, s)) if (e.pitches.length && !e.tie) expect(e.at % 6).toBe(0)
    }
  })

  it('facil: right-hand skyline and a monophonic bass on the beats', () => {
    const notes = [...chord([64, 67, 72], 0), n(76, 4, 2), n(74, 6, 2), ...chord([48, 52, 55], 0), n(43, 9, 2), n(45, 12, 4)]
    const score = build(notes, { difficulty: 'facil' })
    expect(staffNotes(score, 0)).toEqual([
      { pitch: 72, start: 0, ticks: 4 },
      { pitch: 76, start: 4, ticks: 2 },
      { pitch: 74, start: 6, ticks: 2 },
    ])
    expect(staffNotes(score, 1)).toEqual([
      { pitch: 48, start: 0, ticks: 8 },
      { pitch: 43, start: 8, ticks: 4 },
      { pitch: 45, start: 12, ticks: 4 },
    ])
    // Repeated bass notes merge inside a bar and are restruck in the next one; long silences stay rests.
    const repeated = build([n(48, 0, 2), n(48, 4, 2), n(48, 8, 2), n(48, 16, 2), n(43, 64, 4)], { difficulty: 'facil' })
    expect(staffNotes(repeated, 1)).toEqual([
      { pitch: 48, start: 0, ticks: 16 },
      { pitch: 48, start: 16, ticks: 16 },
      { pitch: 43, start: 64, ticks: 16 },
    ])
    for (const seed of [4, 5]) {
      const easy = build(randomNotes(400, seed, 20), { difficulty: 'facil' })
      expectWellFormed(easy, 1)
      for (const e of events(easy, 1)) if (e.pitches.length) expect(e.at % 12).toBe(0)
      for (const e of events(easy, 0)) if (e.pitches.length) expect(e.at % 6).toBe(0)
    }
  })

  it('rates difficulty from density, chords and rhythm', () => {
    const easy = build([n(60, 0, 8), n(64, 8, 8), n(67, 16, 16)])
    expect(easy.stats.difficulty).toBe(1)
    const hard = build(randomNotes(600, 9, 20), { maxPolyphony: 6 })
    expect(hard.stats.difficulty).toBe(3)
    expect(build(randomNotes(600, 9, 20), { difficulty: 'facil' }).stats.difficulty).toBeLessThan(hard.stats.difficulty)
  })
})

describe('layout invariants', () => {
  const meters: TimeSignature[] = ['4/4', '3/4', '2/4', '6/8']
  const modes: Difficulty[] = ['original', 'intermedio', 'facil']

  it('produces equal, fully tiled staves for random input in every meter and mode', () => {
    let seed = 100
    for (const ts of meters) {
      for (const difficulty of modes) {
        for (const quantize of [8, 16] as const) {
          const a = knownAnalysis({ bpm: 70 + (seed % 90), timeSignature: ts, beatOffset: (seed % 7) * 0.13 })
          const score = buildScore(randomNotes(250, seed++, 25), plainParams(a, { difficulty, quantize, maxPolyphony: 4, splitPoint: 55 + (seed % 12) }), a)
          expect(score.staves[0].measures.length).toBe(score.staves[1].measures.length)
          expectWellFormed(score, difficulty === 'facil' ? 1 : difficulty === 'intermedio' ? 3 : 4)
          expect(score.timeSignature).toBe(ts)
          expect(score.durationSeconds).toBeCloseTo(score.measureCount * measureDurationSeconds(score), 9)
        }
      }
    }
  })

  it('keeps every note (no filters, no simplification) at its quantized position', () => {
    const notes = randomNotes(300, 7, 20).map((x) => ({ ...x, start: Math.round(x.start / 0.125) * 0.125, duration: Math.max(1, Math.round(x.duration / 0.125)) * 0.125 }))
    const score = build(notes, { maxPolyphony: 6 })
    const keys = new Set(notes.map((x) => `${x.pitch}@${Math.round(x.start / 0.125)}`))
    const shift = Math.floor(Math.min(...notes.map((x) => Math.round(x.start / 0.125))) / 16) * 16
    const found = new Set([...staffNotes(score, 0), ...staffNotes(score, 1)].map((x) => `${x.pitch}@${x.start + shift}`))
    // A chord stream may drop a pitch only when the hand already holds 6 notes at that onset.
    const missing = [...keys].filter((k) => !found.has(k))
    expect(missing.length).toBeLessThanOrEqual(keys.size * 0.01)
  })
})

describe('time helpers and summary', () => {
  it('converts ticks and seconds at the score tempo', () => {
    const score = build([n(60, 0, 4)])
    expect(secondsPerTick(score)).toBeCloseTo(0.125 / 3, 12)
    expect(tickToSeconds(score, 12)).toBeCloseTo(0.5, 12)
    expect(secondsToTick(score, 1)).toBeCloseTo(24, 9)
    expect(measureDurationSeconds(score)).toBe(2)
    expect(measureDurationSeconds({ bpm: 90, ticksPerMeasure: 36 })).toBeCloseTo(2, 9)
    expect(secondsPerTick({ bpm: 0 })).toBeCloseTo(0.05, 9)
  })

  it('summarizes the score for the library', () => {
    const notes = [n(60, 0, 4), n(64, 0, 4), n(48, 4, 12)]
    const score = buildScore(notes, plainParams(analysis, { transpose: 2 }), analysis, 'Prueba')
    expect(score.title).toBe('Prueba')
    expect(summarizeScore(score)).toEqual({
      key: score.key,
      bpm: 120,
      timeSignature: '4/4',
      difficulty: score.stats.difficulty,
      noteCount: 3,
      measureCount: 1,
    })
  })

  it('builds an analysed stream end to end', () => {
    const notes = randomNotes(200, 3, 15)
    const a = analyzeNotes(notes)
    const score = buildScore(notes, defaultParams(a, { quantize: 16, splitPoint: 60, defaultDifficulty: 'original' }), a)
    expectWellFormed(score, 4)
  })
})

describe('performance', () => {
  it('builds 3 000 notes in under 30 ms after warm-up', () => {
    const notes = randomNotes(3000, 42, 180)
    const a = knownAnalysis({ bpm: 112 })
    for (const difficulty of ['original', 'intermedio', 'facil'] as const) {
      const params = plainParams(a, { difficulty, maxPolyphony: 4 })
      for (let i = 0; i < 3; i++) buildScore(notes, params, a)
      const times: number[] = []
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now()
        buildScore(notes, params, a)
        times.push(performance.now() - t0)
      }
      times.sort((x, y) => x - y)
      expect(times[3], `${difficulty}: median ${times[3].toFixed(1)} ms`).toBeLessThan(30)
    }
  })
})
