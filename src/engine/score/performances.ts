// Owner: engine-score. Synthetic "real performance" streams for the engine tests and the visual
// harness (not used by the app): textures the client hit in real piano videos, written from scratch
// (no copyrighted material), with what a transcription of a real recording looks like: pedal-long
// durations, rubato, uneven velocities and small timing errors. Each stream comes with its ground
// truth (the written score in ticks) so tests can check every note.
import type { NoteEvent } from '../../types'
import { rng } from './test-helpers'

/** A written note: absolute tick (16ths from the first downbeat; a pickup is negative), role. */
export interface TruthNote {
  pitch: number
  tick: number
  ticks: number
  role: 'melody' | 'accomp' | 'bass'
}

export interface Performance {
  notes: NoteEvent[]
  truth: TruthNote[]
  /** Nominal tempo (quarter = bpm) and meter of the written score. */
  bpm: number
  timeSignature: '3/4' | '4/4'
  /** Source seconds of every beat from the first downbeat (beat 0) on: the true beat map. */
  beats: number[]
  /** Source seconds of the first downbeat. */
  downbeat: number
}

export interface PerformanceOptions {
  seed?: number
  /** Tempo swing, +-fraction (0.08 = +-8 %), over 4-bar phrases, plus a final ritardando. */
  rubato?: number
  /** Hold every note to the next pedal change (each bar), as a pedalled recording transcribes. */
  pedal?: boolean
  /** Timing noise of each onset, +- seconds. */
  jitter?: number
  bpm?: number
}

/** Beat -> seconds for a tempo that swings sinusoidally over phrases and slows at the end. */
function clock(bpm: number, totalBeats: number, rubato: number, phraseBeats: number, lead: number) {
  const step = 1 / 16
  const times: number[] = [0]
  let t = 0
  for (let b = -lead; b < totalBeats + 4; b += step) {
    const swing = 1 + rubato * Math.sin((2 * Math.PI * (b + lead)) / phraseBeats)
    const rit = b > totalBeats - 4 ? 1 - Math.min(0.25, 0.06 * (b - (totalBeats - 4))) : 1
    t += (60 / (bpm * swing * rit)) * step
    times.push(t)
  }
  const start = 0.6
  return (beat: number) => {
    const x = (beat + lead) / step
    const i = Math.max(0, Math.min(times.length - 2, Math.floor(x)))
    return start + times[i] + (x - i) * (times[i + 1] - times[i])
  }
}

function render(
  written: TruthNote[],
  bpm: number,
  timeSignature: '3/4' | '4/4',
  bars: number,
  lead: number,
  opts: PerformanceOptions,
  velocity: (n: TruthNote, rand: () => number) => number,
): Performance {
  const rand = rng(opts.seed ?? 1)
  const perBar = timeSignature === '3/4' ? 3 : 4
  const at = clock(bpm, bars * perBar, opts.rubato ?? 0, 4 * perBar, lead)
  const jitter = opts.jitter ?? 0.012
  const notes: NoteEvent[] = written.map((n) => {
    const beat = n.tick / 4
    const start = at(beat) + (rand() * 2 - 1) * jitter
    let end = at(beat + n.ticks / 4) - 0.02
    if (opts.pedal) {
      // The damper lifts just after the next downbeat: the note rings until then.
      const bar = Math.floor(beat / perBar)
      const change = at((bar + 1) * perBar) + 0.1 + rand() * 0.04
      end = Math.max(end, change)
    }
    return { pitch: n.pitch, start, duration: Math.max(0.05, end - start), velocity: velocity(n, rand) }
  })
  const beats = Array.from({ length: bars * perBar + 1 }, (_, b) => at(b))
  return { notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch), truth: written, bpm, timeSignature, beats, downbeat: at(0) }
}

const P = (name: string): number => {
  const m = /^([A-G])(b|#)?(-?\d)$/.exec(name)
  if (!m) throw new Error(name)
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]]!
  return (Number(m[3]) + 1) * 12 + pc + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
}

/**
 * A slow pop-ballad piano cover texture (C major, 4/4, about 70 bpm): a pickup of three eighth-note
 * triplets high in the treble, a melody in octaves 5-6 (dotted half + two eighths per bar), a left
 * hand ABOVE middle C (eighth-note arpeggios whose last note is held, e.g. C4 G4 D5 E5~), and a
 * borrowed iv chord (a whole-note C4 + Ab4 dyad, Fm6/C). The melody is original.
 */
export function balladStyle(opts: PerformanceOptions = {}): Performance {
  const bpm = opts.bpm ?? 70
  const written: TruthNote[] = []
  // Pickup: three triplet eighths in beat 4 before bar 1 (ticks -4, -2.67, -1.33).
  ;['G5', 'A5', 'B5'].forEach((p, i) => written.push({ pitch: P(p), tick: -4 + (i * 4) / 3, ticks: 4 / 3, role: 'melody' }))
  const harmony: (string[] | 'dyad')[] = [
    ['C4', 'G4', 'D5', 'E5'],
    ['E4', 'A4', 'B4', 'C5'],
    ['F4', 'A4', 'C5', 'E5'],
    'dyad',
    ['C4', 'G4', 'D5', 'E5'],
    ['D4', 'G4', 'A4', 'B4'],
    ['E4', 'A4', 'B4', 'C5'],
    ['C4', 'G4', 'D5', 'E5'],
  ]
  const melody: [string, string, string][] = [
    ['C6', 'D6', 'E6'],
    ['A5', 'G5', 'A5'],
    ['C6', 'B5', 'A5'],
    ['Ab5', 'G5', 'F5'],
    ['G5', 'E6', 'D6'],
    ['D6', 'B5', 'C6'],
    ['C6', 'A5', 'B5'],
    ['C6', '', ''],
  ]
  harmony.forEach((h, bar) => {
    const t0 = bar * 16
    if (h === 'dyad') {
      written.push({ pitch: P('C4'), tick: t0, ticks: 16, role: 'accomp' }, { pitch: P('Ab4'), tick: t0, ticks: 16, role: 'accomp' })
    } else {
      h.forEach((p, i) => written.push({ pitch: P(p), tick: t0 + 2 * i, ticks: i === 3 ? 10 : 2, role: i === 0 ? 'bass' : 'accomp' }))
    }
    const [long, a, b] = melody[bar]
    if (bar === harmony.length - 1) written.push({ pitch: P(long), tick: t0, ticks: 16, role: 'melody' })
    else {
      written.push({ pitch: P(long), tick: t0, ticks: 12, role: 'melody' })
      written.push({ pitch: P(a), tick: t0 + 12, ticks: 2, role: 'melody' }, { pitch: P(b), tick: t0 + 14, ticks: 2, role: 'melody' })
    }
  })
  return render(written, bpm, '4/4', harmony.length, 1, { pedal: true, rubato: 0.04, ...opts }, (n, rand) =>
    n.role === 'melody' ? 0.62 + rand() * 0.1 : 0.38 + rand() * 0.1,
  )
}

/**
 * A Liebestraum No. 3 style texture, written from scratch (Ab major, 6/4 written as 3/4 bars): a
 * cantabile melody in the MIDDLE register (Ab3..F4, one long note per bar, played louder) inside
 * flowing eighth-note arpeggios that sweep from the bass up through and above it (e.g. Ab2 Eb3 C4
 * Ab4 C5 Ab4 around a held Eb4), with heavy pedal (a change every bar) and rubato.
 */
export function liebestraumStyle(opts: PerformanceOptions = {}): Performance {
  const bpm = opts.bpm ?? 108
  const bars: [string, string[]][] = [
    ['C4', ['Ab2', 'Eb3', 'Ab3', 'Eb4', 'Ab4', 'Eb4']],
    ['Eb4', ['Ab2', 'Eb3', 'C4', 'Ab4', 'C5', 'Ab4']],
    ['F4', ['Ab2', 'F3', 'Db4', 'Ab4', 'Db5', 'Ab4']],
    ['Eb4', ['Ab2', 'Eb3', 'C4', 'Ab4', 'C5', 'Ab4']],
    ['Db4', ['Bb2', 'Eb3', 'G3', 'G4', 'Bb4', 'G4']],
    ['Bb3', ['Eb2', 'Bb2', 'G3', 'Db4', 'G4', 'Db4']],
    ['C4', ['Ab2', 'Eb3', 'Ab3', 'Eb4', 'Ab4', 'Eb4']],
    ['Ab3', ['Ab1', 'Eb2', 'C3', 'C4', 'Eb4', 'C4']],
  ]
  const written: TruthNote[] = []
  bars.forEach(([mel, arp], bar) => {
    const t0 = bar * 12
    written.push({ pitch: P(mel), tick: t0, ticks: 12, role: 'melody' })
    arp.forEach((p, i) => written.push({ pitch: P(p), tick: t0 + 2 * i, ticks: 2, role: i === 0 ? 'bass' : 'accomp' }))
  })
  return render(written, bpm, '3/4', bars.length, 0, { pedal: true, rubato: 0.08, ...opts }, (n, rand) =>
    n.role === 'melody' ? 0.74 + rand() * 0.06 : n.role === 'bass' ? 0.5 + rand() * 0.06 : 0.42 + rand() * 0.08,
  )
}

/**
 * A slow 4/4 ballad texture in Eb major (three flats), written from scratch: every beat is a
 * sixteenth-note sextuplet (two sixteenth triplets) arpeggio rising from the bass, under a melody
 * note held by the right hand, with the pedal down throughout. Truth ticks of the sextuplet notes
 * are fractional (4 / 6 of a tick apart): the tick grid has no triplets yet.
 */
export function sextupletBallad(opts: PerformanceOptions = {}): Performance {
  const bpm = opts.bpm ?? 60
  const chords = [
    ['Eb2', 'Bb2', 'Eb3', 'G3', 'Bb3', 'Eb4'],
    ['C2', 'G2', 'C3', 'Eb3', 'G3', 'C4'],
    ['Ab1', 'Eb2', 'Ab2', 'C3', 'Eb3', 'Ab3'],
    ['Bb1', 'F2', 'Bb2', 'D3', 'F3', 'Bb3'],
  ]
  const melody = [['G4', 'Bb4'], ['C5', 'G4'], ['Ab4', 'C5'], ['F4', 'D4']]
  const written: TruthNote[] = []
  chords.forEach((chord, bar) => {
    for (let beat = 0; beat < 4; beat++) {
      chord.forEach((p, i) => written.push({ pitch: P(p), tick: bar * 16 + beat * 4 + (i * 4) / 6, ticks: 4 / 6, role: i === 0 ? 'bass' : 'accomp' }))
    }
    melody[bar].forEach((p, i) => written.push({ pitch: P(p), tick: bar * 16 + i * 8, ticks: 8, role: 'melody' }))
  })
  return render(written, bpm, '4/4', chords.length, 0, { pedal: true, rubato: 0.03, ...opts }, (n, rand) =>
    n.role === 'melody' ? 0.7 + rand() * 0.08 : 0.4 + rand() * 0.1,
  )
}
