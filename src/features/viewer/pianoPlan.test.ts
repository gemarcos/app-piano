import { describe, expect, it } from 'vitest'
import type { Measure, Score, ScoreEvent, Staff } from '../../types'
import { DEFAULT_VELOCITY, SIXTEENTH } from '../../engine/score'
import {
  NO_DAMPER_FROM,
  TAU_RESTRIKE,
  legatoPedals,
  loopVoices,
  metronomeClicks,
  noteDynamics,
  pedalSeconds,
  planVoices,
  playNotes,
  tauKey,
  tauPedal,
  voicesKey,
  type PlayNote,
} from './pianoPlan'

/** 120 bpm: one tick (sixteenth) = 0.125 s, one 4/4 measure = 2 s. */
const SPT = 0.125

// Positions below are in sixteenths; the Score uses ticks (TICKS_PER_QUARTER = 12).
function ev(start: number, duration: number, pitches: number[], extra: Partial<ScoreEvent> = {}): ScoreEvent {
  return { start: start * SIXTEENTH, duration: duration * SIXTEENTH, pitches, ...extra }
}

function staff(hand: 'right' | 'left', measures: ScoreEvent[][], voice2?: ScoreEvent[][]): Staff {
  const toMeasures = (ms: ScoreEvent[][]): Measure[] => ms.map((events, index) => ({ index, events }))
  const s: Staff = { hand, clef: hand === 'right' ? 'treble' : 'bass', measures: toMeasures(measures) }
  if (voice2) s.voice2 = toMeasures(voice2)
  return s
}

function score(right: Staff, left: Staff, extra: Partial<Score> = {}): Score {
  return {
    title: 't',
    bpm: 120,
    timeSignature: '4/4',
    key: { tonic: 'C', mode: 'major', fifths: 0 },
    ticksPerMeasure: 16 * SIXTEENTH,
    measureCount: right.measures.length,
    durationSeconds: right.measures.length * 2,
    startSeconds: 0,
    staves: [right, left],
    stats: { noteCount: 0, maxPolyphony: 0, range: null, notesPerSecond: 0, difficulty: 1 },
    ...extra,
  }
}

const note = (pitch: number, start: number, end: number, extra: Partial<PlayNote> = {}): PlayNote => ({ pitch, start, end, staff: 0, accent: 0, ...extra })

describe('playNotes', () => {
  const s = score(
    staff('right', [[ev(0, 4, [60]), ev(4, 4, [64, 67], { tie: true }), ev(8, 8, [64, 67])], [ev(0, 16, [72], { velocities: [0.8] })]]),
    staff('left', [[ev(0, 16, [48])], [ev(0, 8, []), ev(8, 8, [43, 120])]]),
  )

  it('converts ticks to seconds, merges ties and keeps both hands', () => {
    const notes = playNotes(s)
    const simple = notes.map((n) => [n.pitch, n.start, n.end, n.staff])
    expect(simple).toEqual([
      [48, 0, 16 * SPT, 1],
      [60, 0, 4 * SPT, 0],
      [64, 4 * SPT, 16 * SPT, 0],
      [67, 4 * SPT, 16 * SPT, 0],
      [72, 2, 4, 0],
      [43, 3, 4, 1],
    ])
  })

  it('drops pitches outside the piano and rests', () => {
    expect(playNotes(s).some((n) => n.pitch === 120)).toBe(false)
  })

  it('reads velocities (the engine default when an event has none) and metric accents', () => {
    const notes = playNotes(s)
    expect(notes.find((n) => n.pitch === 72)?.velocity).toBe(0.8)
    expect(notes.find((n) => n.pitch === 60)?.velocity).toBe(DEFAULT_VELOCITY)
    expect(notes.find((n) => n.pitch === 60)?.accent).toBe(1)
    expect(notes.find((n) => n.pitch === 64)?.accent).toBe(0.5)
  })

  it('holds a key as long as it sounded without pedal (ScoreEvent.sounding), never shorter than written', () => {
    // Written as a quarter (articulated), sounded a whole bar: playback keeps the legato.
    const held = staff('right', [[ev(0, 4, [60], { sounding: [16 * SIXTEENTH] } as Partial<ScoreEvent>), ev(4, 12, [])]])
    const notes = playNotes(score(held, staff('left', [[ev(0, 16, [])]])))
    expect(notes.map((n) => [n.pitch, n.start, n.end])).toEqual([[60, 0, 2]])
  })

  it('filters by hand', () => {
    expect(playNotes(s, 'right').every((n) => n.staff === 0)).toBe(true)
    expect(playNotes(s, 'left').map((n) => n.pitch)).toEqual([48, 43])
  })

  it('plays a second voice of the same staff with its own timing', () => {
    // A held melody note over a moving arpeggio in one hand (voice2 holds the long note).
    const arp = staff('right', [[ev(0, 4, [60]), ev(4, 4, [64]), ev(8, 4, [67]), ev(12, 4, [72])]], [[ev(0, 16, [76])]])
    const notes = playNotes(score(arp, staff('left', [[ev(0, 16, [])]])))
    expect(notes.map((n) => [n.pitch, n.start, n.end])).toEqual([
      [60, 0, 0.5],
      [76, 0, 2],
      [64, 0.5, 1],
      [67, 1, 1.5],
      [72, 1.5, 2],
    ])
  })

  it('converts pedal spans to seconds', () => {
    expect(pedalSeconds({ bpm: 120, pedals: [{ start: 16 * SIXTEENTH, end: 24 * SIXTEENTH }, { start: 0, end: 8 * SIXTEENTH }] })).toEqual([
      [0, 1],
      [2, 3],
    ])
    expect(pedalSeconds({ bpm: 120 })).toEqual([])
  })
})

describe('noteDynamics', () => {
  it('voices the fallback: melody above inner notes, left hand below, downbeats lean', () => {
    const notes = [
      note(48, 0, 1, { staff: 1, accent: 1 }),
      note(64, 0, 1, { accent: 1 }),
      note(72, 0, 1, { accent: 1 }),
      note(74, 0.5, 1, { accent: 0 }),
    ]
    const [bass, inner, top, offbeat] = noteDynamics(notes)
    expect(top).toBeGreaterThan(inner)
    expect(top).toBeGreaterThan(bass)
    expect(top).toBeGreaterThan(offbeat)
    expect(Math.max(bass, inner, top, offbeat)).toBeLessThan(0.75)
    expect(Math.min(bass, inner, top, offbeat)).toBeGreaterThan(0.35)
  })

  it('follows known velocities (loudness) and the piece spread, keeping their order', () => {
    const vs = [0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6]
    const d = noteDynamics(vs.map((v, i) => note(60 + i, i, i + 1, { velocity: v })))
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1])
    // The median note sits halfway between its own velocity and mezzo forte.
    expect(d[3]).toBeCloseTo((0.4 + 0.56) / 2, 2)
    expect(Math.min(...d)).toBeGreaterThanOrEqual(0.15)
    expect(Math.max(...d)).toBeLessThanOrEqual(0.97)
    // Calibrated loudness: a forte melody (0.7) over a soft accompaniment (0.3) stays clearly above it.
    const pair = noteDynamics([0.3, 0.3, 0.3, 0.7, 0.3, 0.7].map((v, i) => note(60 + i, i, i + 1, { velocity: v })))
    expect(pair[3] - pair[0]).toBeGreaterThan(0.3)
  })

  it('voices flat velocities (all at the default) like a score without them', () => {
    const flat = [note(48, 0, 1, { staff: 1, velocity: 0.7 }), note(64, 0, 1, { velocity: 0.7 }), note(72, 0, 1, { velocity: 0.7 })]
    const bare = flat.map(({ velocity: _v, ...n }) => n)
    expect(noteDynamics(flat)).toEqual(noteDynamics(bare))
    const [bass, inner, top] = noteDynamics(flat)
    expect(top).toBeGreaterThan(inner)
    expect(top).toBeGreaterThan(bass)
  })
})

describe('planVoices', () => {
  const dyn = (n: number) => new Array(n).fill(0.55)

  it('releases at the key when there is no pedal', () => {
    const [v] = planVoices([note(60, 0, 1)], dyn(1))
    expect(v.release).toBe(1)
    expect(v.tau).toBeCloseTo(tauKey(60))
  })

  it('keeps a note ringing until the pedal lifts when the pedal holds its end', () => {
    const notes = [note(48, 0, 0.5), note(52, 0.5, 1), note(55, 1, 3.5)]
    const voices = planVoices(notes, dyn(3), [[0.1, 3]])
    expect(voices[0].release).toBe(3)
    expect(voices[1].release).toBe(3)
    expect(voices[0].tau).toBeCloseTo(tauPedal(48))
    // Ends after the pedal lifts: its own key release.
    expect(voices[2].release).toBe(3.5)
    expect(voices[2].tau).toBeCloseTo(tauKey(55))
  })

  it('at a pedal change damps the keys released there and sustains the ones held or struck then', () => {
    // Pedal [0, 2] then changed at 2: [2, 4].
    const pedals: [number, number][] = [
      [0, 2],
      [2, 4],
    ]
    const released = note(60, 0.5, 2) // key up exactly at the change
    const struck = note(64, 2, 3) // struck at the change, key up during the new span
    const held = note(67, 1, 3) // held through the change, key up during the new span
    const early = note(55, 0.2, 1.5) // key up during the first span
    const voices = planVoices([released, struck, held, early], dyn(4), pedals)
    expect(voices[0].release).toBe(2)
    expect(voices[1].release).toBe(4)
    expect(voices[2].release).toBe(4)
    expect(voices[3].release).toBe(2)
  })

  it('does not catch a key released exactly when the pedal goes down', () => {
    const [v] = planVoices([note(60, 0, 1)], dyn(1), [[1, 3]])
    expect(v.release).toBe(1)
    expect(v.tau).toBeCloseTo(tauKey(60))
  })

  it('damps an earlier strike of the same key when it is struck again (under pedal)', () => {
    const voices = planVoices([note(60, 0, 0.4), note(60, 1, 1.4)], dyn(2), [[0, 3]])
    expect(voices[0].release).toBe(1)
    expect(voices[0].tau).toBe(TAU_RESTRIKE)
    expect(voices[1].release).toBe(3)
  })

  it('holds a key shared by two voices until the later release', () => {
    // Voice 1 holds C4 for 2 s; voice 2 strikes C4 again at 0.5 s for 0.25 s.
    const voices = planVoices([note(60, 0, 2), note(60, 0.5, 0.75)], dyn(2))
    expect(voices[0].release).toBe(0.5)
    expect(voices[1].release).toBe(2)
  })

  it('lets the top octave ring (no dampers), still damping re-strikes', () => {
    const voices = planVoices([note(NO_DAMPER_FROM + 2, 0, 0.2), note(NO_DAMPER_FROM + 2, 1, 1.2)], dyn(2))
    expect(voices[0].release).toBe(1)
    expect(voices[1].release).toBe(Infinity)
  })
})

describe('loopVoices', () => {
  it('keeps the notes that start inside the loop and releases them at its end', () => {
    const voices = planVoices([note(60, 0, 1), note(62, 1, 3), note(64, 2.5, 4)], [0.5, 0.5, 0.5])
    const inside = loopVoices(voices, 1, 2)
    expect(inside.map((v) => v.pitch)).toEqual([62])
    expect(inside[0].release).toBe(2)
  })
})

describe('metronomeClicks', () => {
  it('counts in one measure and clicks every beat with an accented downbeat', () => {
    const clicks = metronomeClicks(2, '4/4', 4, { metronome: true, countIn: true })
    expect(clicks.filter((c) => c.time < 0).map((c) => [c.time, c.accent])).toEqual([
      [-2, true],
      [-1.5, false],
      [-1, false],
      [-0.5, false],
    ])
    expect(clicks.filter((c) => c.time >= 0).map((c) => c.time)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
    expect(clicks.filter((c) => c.accent && c.time >= 0).map((c) => c.time)).toEqual([0, 2])
  })

  it('feels 6/8 in two and 3/4 in three', () => {
    expect(metronomeClicks(1.5, '6/8', 1.5, { metronome: true, countIn: false }).map((c) => c.time)).toEqual([0, 0.75])
    expect(metronomeClicks(1.5, '3/4', 1.5, { metronome: true, countIn: false }).length).toBe(3)
    expect(metronomeClicks(2, '4/4', 4, { metronome: false, countIn: false })).toEqual([])
  })
})

describe('voicesKey', () => {
  it('changes with the music and is stable otherwise', () => {
    const a = planVoices([note(60, 0, 1), note(64, 1, 2)], [0.5, 0.5])
    const b = planVoices([note(60, 0, 1), note(64, 1, 2)], [0.5, 0.5])
    const c = planVoices([note(60, 0, 1), note(65, 1, 2)], [0.5, 0.5])
    expect(voicesKey(a)).toBe(voicesKey(b))
    expect(voicesKey(a)).not.toBe(voicesKey(c))
  })
})

describe('legatoPedals', () => {
  it('changes the pedal just after each new bass note', () => {
    const notes = [note(36, 0, 2, { staff: 1 }), note(60, 0, 1), note(43, 2, 4, { staff: 1 }), note(62, 2, 3)]
    expect(legatoPedals(notes, 4)).toEqual([
      [0.04, 2.04],
      [2.04, 4],
    ])
  })
})
