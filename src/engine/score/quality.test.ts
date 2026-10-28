// Owner: engine-score. Quality phase: velocities, sustain pedal, two voices, adaptive hands, clefs,
// arpeggios, tempo octave, rubato beat tracking, pickups and harmonic spelling, on synthetic
// "real performance" textures (pedal-long notes, rubato, uneven velocities).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Midi } from '@tonejs/midi'
import abcjs from 'abcjs'
import { describe, expect, it } from 'vitest'
import type { AnalysisResult, NoteEvent, Score } from '../../types'
import {
  analyzeNotes,
  buildScore,
  defaultParams,
  keyFromFifths,
  normalizeKey,
  pickupTicks,
  scoreNotes,
  scoreToAbc,
  scoreToMidi,
  scoreToMusicXml,
  sourceSecondsAt,
  staffVoices,
  tickAtSourceSeconds,
  tickToSeconds,
  tonicPc,
  SIXTEENTH,
  TICKS_PER_QUARTER,
  type EngineParams,
} from './index'
import { beatPositions } from './beats'
import { balladStyle, liebestraumStyle, sextupletBallad, type Performance } from './performances'
import { knownAnalysis, plainParams, staffNotes, tickNote } from './test-helpers'

const settings = { quantize: 16 as const, splitPoint: 60, defaultDifficulty: 'original' as const }
const n = (pitch: number, on: number, ticks: number, velocity = 0.8) => tickNote(pitch, on, ticks, 120, velocity)
const a120 = knownAnalysis()
const build = (notes: NoteEvent[], over: Partial<EngineParams> = {}, a: AnalysisResult = a120) => buildScore(notes, { ...plainParams(a), ...over }, a)

/** abcjs playback per staff (one track per voice in V: order; the pedal voice must be silent). */
function abcjsStaves(abc: string): { warnings: string[]; staves: Map<string, { pitch: number; start: number; ticks: number }[]> } {
  const [tune] = abcjs.parseOnly(abc)
  const warnings = (tune as unknown as { warnings?: string[] }).warnings ?? []
  const audio = (tune as unknown as { setUpAudio(o: object): { tracks: { cmd: string; pitch: number; start: number; duration: number }[][] } }).setUpAudio({})
  const ids = [...abc.matchAll(/^V:(\S+)/gm)].map((m) => m[1])
  const staves = new Map<string, { pitch: number; start: number; ticks: number }[]>()
  audio.tracks.forEach((track, i) => {
    const notes = track.filter((e) => e.cmd === 'note').map((e) => ({ pitch: e.pitch, start: Math.round((Math.round(e.start * 48) / 3) * 1e6) / 1e6, ticks: Math.round((Math.round(e.duration * 48) / 3) * 1e6) / 1e6 }))
    const id = ids[i]
    if (id === 'PED') {
      expect(notes).toEqual([])
      return
    }
    const staff = id.slice(0, 2)
    staves.set(staff, [...(staves.get(staff) ?? []), ...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch))
  })
  return { warnings, staves }
}

/** Analysis with the performance's true tempo, meter, downbeat and beat map. */
function trueAnalysis(perf: Performance): AnalysisResult {
  return { ...knownAnalysis(), bpm: perf.bpm, timeSignature: perf.timeSignature, beatOffset: perf.downbeat, beatTimes: perf.beats }
}

/** Truth notes found at their exact tick and pitch in the score (score tick = truth tick + offset). */
function found(score: Score, perf: Performance, offset: number, roles?: string[]): { hit: number; total: number } {
  const played = new Set(scoreNotes(score).map((x) => `${x.pitch}@${x.tick / SIXTEENTH}`))
  const wanted = perf.truth.filter((t) => Number.isInteger(t.tick) && (!roles || roles.includes(t.role)))
  return { hit: wanted.filter((t) => played.has(`${t.pitch}@${t.tick + offset}`)).length, total: wanted.length }
}

describe('velocities', () => {
  it('ride on every note event, parallel to pitches; merged duplicates keep the loudest', () => {
    const score = build([n(60, 0, 4, 0.3), n(64, 0, 4, 0.9), n(60, 0, 2, 0.6), n(72, 12, 8, 0.45)])
    const [first] = score.staves[0].measures[0].events
    expect(first).toMatchObject({ pitches: [60, 64], velocities: [0.6, 0.9] })
    const tied = score.staves[0].measures[0].events.at(-1)!
    expect(tied).toMatchObject({ pitches: [72], velocities: [0.45], tie: true })
    expect(score.staves[0].measures[1].events[0]).toMatchObject({ pitches: [72], velocities: [0.45] })
    for (const m of score.staves[0].measures) for (const e of m.events) if (!e.pitches.length) expect(e.velocities).toBeUndefined()
  })

  it('scoreNotes merges ties and keeps the attack velocity of both voices and staves', () => {
    const score = build([n(72, 12, 8, 0.45), n(48, 0, 16, 0.7)])
    expect(scoreNotes(score)).toEqual([
      { pitch: 48, tick: 0, ticks: 48, velocity: 0.7, staff: 1, voice: 1 },
      { pitch: 72, tick: 36, ticks: 24, velocity: 0.45, staff: 0, voice: 1 },
    ])
  })
})

describe('sustain pedal', () => {
  // Bars of rising arpeggio eighths, every note ringing to just after the next downbeat.
  const pedalled = (bars: number, pedal = true): NoteEvent[] => {
    const out: NoteEvent[] = []
    const roots = [48, 53, 55, 48]
    for (let b = 0; b < bars; b++) {
      const r = roots[b % 4]
      const figure = [r, r + 7, r + 12, r + 16, r + 19, r + 24, r + 19, r + 16]
      figure.forEach((p, i) => {
        const start = (b * 16 + i * 2) * 0.125
        const end = pedal ? (b + 1) * 2 + 0.1 : start + 0.24
        out.push({ pitch: p, start, duration: end - start, velocity: 0.6 })
      })
    }
    return out
  }

  it('finds one span per bar, changing at each downbeat, in a pedalled stream', () => {
    const score = build(pedalled(4))
    expect(score.pedals).toEqual([
      { start: 0, end: 48 },
      { start: 48, end: 96 },
      { start: 96, end: 144 },
      { start: 144, end: 192 },
    ])
  })

  it('finds no pedal in legato, two-voice or block-chord playing', () => {
    expect(build(pedalled(4, false)).pedals).toBeUndefined()
    // A held melody note over a moving inner line (fingers hold it), then held block chords.
    const twoVoices = [n(76, 0, 16), n(64, 0, 4), n(65, 4, 4), n(67, 8, 4), n(65, 12, 4), n(48, 16, 16), n(52, 16, 16), n(55, 16, 16), n(72, 32, 16)]
    expect(build(twoVoices).pedals).toBeUndefined()
  })

  it('writes pedal marks on an invisible ABC voice only on request, which abcjs parses and keeps silent', () => {
    // Pedal throughout: one "con Ped." where it starts (no Ped./* pair per span).
    const score = build(pedalled(4))
    expect(scoreToAbc(score)).not.toContain('PED')
    for (const noteNaming of ['none', 'latin'] as const) {
      const abc = scoreToAbc(score, { pedalMarks: true, noteNaming })
      expect(abc).toContain('%%score {RH | (LH PED)}')
      expect(abc).toContain('V:PED clef=bass')
      const ped = abc.split(String.fromCharCode(10)).filter((l) => l.startsWith('[V:PED]')).join(' ')
      expect(ped.match(/"_con Ped\."/g)).toHaveLength(1)
      expect(ped).not.toContain('"_*')
      if (noteNaming === 'latin') expect(ped).toContain('"_ ""_con Ped."')
      const { warnings, staves } = abcjsStaves(abc)
      expect(warnings).toEqual([])
      expect(staves.get('RH')).toEqual(staffNotes(score, 0))
      expect(staves.get('LH')).toEqual(staffNotes(score, 1))
    }
    expect(scoreToAbc(score, { pedalMarks: true, hands: 'right' })).toContain('%%score (RH PED)')
    // Local pedalling (one bar of four): a Ped. / * pair for that span.
    const local = [...pedalled(1), ...pedalled(4, false).filter((x) => x.start >= 2)]
    const ls = build(local)
    expect(ls.pedals).toEqual([{ start: 0, end: 48 }])
    const ped = scoreToAbc(ls, { pedalMarks: true }).split(String.fromCharCode(10)).filter((l) => l.startsWith('[V:PED]')).join(' ')
    expect(ped).toContain('"_Ped."')
    expect(ped).toContain('"_*"')
    expect(ped).not.toContain('con Ped.')
  })

  it('notates pedalled notes as played: arpeggio notes to the next note, no ties', () => {
    const score = build(pedalled(4))
    const events = score.staves.flatMap((s) => staffVoices(s).flatMap((v) => v.flatMap((m) => m.events)))
    expect(events.some((e) => e.tie)).toBe(false)
    for (const x of scoreNotes(score)) expect(x.ticks).toBeLessThanOrEqual(TICKS_PER_QUARTER)
    expect(score.pedals).toHaveLength(4)
  })

  it('exports MusicXML pedal directions and MIDI sustain (CC64) on both hands', () => {
    const score = build(pedalled(2))
    const xml = scoreToMusicXml(score)
    expect(xml.match(/<pedal type="start" line="no" sign="yes"\/>/g)).toHaveLength(2)
    expect(xml.match(/<pedal type="stop" line="no" sign="yes"\/>/g)).toHaveLength(2)
    expect(xml).toContain('<sound damper-pedal="yes"/>')
    const midi = new Midi(scoreToMidi(score))
    const perTick = midi.header.ppq / 4
    for (const track of midi.tracks) {
      const cc = (track.controlChanges[64] ?? []).map((c) => [Math.round(c.ticks / perTick), c.value])
      expect(cc).toEqual([
        [0, 1],
        [16, 0],
        [16, 1],
        [32, 0],
      ])
    }
  })
})

describe('arpeggios and fast runs', () => {
  it('keeps every note of an arpeggio faster than the grid (no stacking, no polyphony cut)', () => {
    // 100 bpm (16th = 150 ms): a run of 12 notes 70 ms apart, then a chord.
    const run: NoteEvent[] = Array.from({ length: 12 }, (_, i) => ({ pitch: 48 + 3 * i, start: 0.6 + i * 0.07, duration: 0.6, velocity: 0.5 }))
    const a = knownAnalysis({ bpm: 100 })
    for (const quantize of [16, 8] as const) {
      const score = buildScore(run, { ...plainParams(a, { quantize, maxPolyphony: 2 }) }, a)
      const played = scoreNotes(score)
      expect(played.map((x) => x.pitch).sort((x, y) => x - y)).toEqual(run.map((x) => x.pitch))
      // Distinct onsets stay distinct, in order.
      const ticks = played.map((x) => x.tick)
      expect(new Set(ticks).size).toBe(run.length)
    }
  })

  it('still reads slightly uneven chords (hands 40 ms apart) as one chord', () => {
    const chord = [60, 64, 67].map((p, i) => ({ pitch: p, start: 1 + i * 0.012, duration: 0.5, velocity: 0.7 }))
    const score = build([...chord, { pitch: 48, start: 1.04, duration: 0.5, velocity: 0.7 }])
    expect(new Set(scoreNotes(score).map((x) => x.tick)).size).toBe(1)
  })
})

describe('two voices per staff', () => {
  // Bach-like: a held tenor note under a sixteenth figure in the same hand, unpedalled.
  const held = [n(64, 1, 7, 0.6), ...[67, 72, 76, 67, 72, 76].map((p, i) => n(p, 2 + i, 1, 0.7)), n(48, 0, 8)]

  it('gives a held note its own voice and keeps the figure whole', () => {
    const score = build(held)
    const right = score.staves[0]
    expect(staffVoices(right)).toHaveLength(2)
    expect(staffNotes(score, 0, 1).map((x) => x.pitch)).toEqual([67, 72, 76, 67, 72, 76])
    expect(staffNotes(score, 0, 2)).toEqual([{ pitch: 64, start: 1, ticks: 7 }])
    const abc = scoreToAbc(score, { noteNaming: 'latin' })
    expect(abc).toContain('%%score {(RH RH2) | LH}')
    expect(abc).toContain('V:RH2 clef=treble')
    const { warnings, staves } = abcjsStaves(abc)
    expect(warnings).toEqual([])
    expect(staves.get('RH')).toEqual(staffNotes(score, 0))
    expect(scoreToMusicXml(score)).toContain('<voice>2</voice>')
  })

  it('keeps one voice for simple textures and for a pedalled melody moving on by step', () => {
    expect(staffVoices(build([n(60, 0, 4), n(62, 4, 4), n(64, 8, 8), n(48, 0, 16)]).staves[0])).toHaveLength(1)
    // C6 rung on by the pedal under D6 E6 (one line), with a pedalled accompaniment below.
    const notes: NoteEvent[] = [
      { pitch: 84, start: 0, duration: 2.1, velocity: 0.65 },
      { pitch: 86, start: 1.5, duration: 0.6, velocity: 0.65 },
      { pitch: 88, start: 1.75, duration: 0.35, velocity: 0.65 },
      ...[48, 55, 60, 64].map((p, i) => ({ pitch: p, start: i * 0.25, duration: 2.1 - i * 0.25, velocity: 0.45 })),
    ]
    const score = build(notes, { splitPoint: 72 })
    expect(staffVoices(score.staves[0])).toHaveLength(1)
    expect(staffNotes(score, 0)).toEqual([
      { pitch: 84, start: 0, ticks: 12 },
      { pitch: 86, start: 12, ticks: 2 },
      { pitch: 88, start: 14, ticks: 2 },
    ])
  })
})

describe('hands and clefs', () => {
  it('auto: a melody over a high accompaniment gets two hands, the left in treble clef', () => {
    const perf = balladStyle({ rubato: 0 })
    const a = trueAnalysis(perf)
    const score = buildScore(perf.notes, defaultParams(a, settings), a)
    expect(score.staves.map((s) => s.clef)).toEqual(['treble', 'treble'])
    const left = new Set(staffNotes(score, 1).map((x) => `${x.pitch}@${x.start}`))
    const accomp = perf.truth.filter((t) => t.role !== 'melody')
    expect(accomp.every((t) => left.has(`${t.pitch}@${t.tick + 16}`))).toBe(true)
    expect(staffNotes(score, 1).length).toBe(accomp.length)
    expect(scoreToAbc(score)).toContain('V:LH clef=treble')
    expect(scoreToMusicXml(score)).toContain('<clef number="2"><sign>G</sign><line>2</line></clef>')
  })

  it('fixed (manual split point): pitch >= splitPoint goes right, whatever the texture', () => {
    const perf = balladStyle({ rubato: 0 })
    const a = trueAnalysis(perf)
    const score = buildScore(perf.notes, { ...defaultParams(a, settings), splitMode: 'fixed' }, a)
    expect(staffNotes(score, 1)).toEqual([])
    const high = buildScore(perf.notes, { ...defaultParams(a, settings), splitMode: 'fixed', splitPoint: 78 }, a)
    expect(staffNotes(high, 1).every((x) => x.pitch < 78)).toBe(true)
    expect(staffNotes(high, 0).every((x) => x.pitch >= 78)).toBe(true)
  })

  it('keeps an ordinary left hand in bass clef and treats stored params without splitMode as fixed', () => {
    const score = build([n(48, 0, 4), n(55, 4, 4), n(52, 8, 4), n(55, 12, 4), n(72, 0, 16)], { splitMode: 'auto' })
    expect(score.staves.map((s) => s.clef)).toEqual(['treble', 'bass'])
    const legacy = build([n(58, 0, 4), n(62, 0, 4)])
    expect(staffNotes(legacy, 0).map((x) => x.pitch)).toEqual([62])
  })
})

describe('Liebestraum No. 3 style (arpeggios around a middle-register melody, pedal, rubato)', () => {
  for (const rubato of [0, 0.08]) {
    it(`analyses and writes every note, the melody as one line (rubato ${rubato * 100} %)`, () => {
      const perf = liebestraumStyle({ rubato, seed: 3 })
      const a = analyzeNotes(perf.notes)
      expect(a.timeSignature).toBe('3/4')
      expect(Math.abs(a.bpm - perf.bpm) / perf.bpm).toBeLessThan(0.1)
      expect(Math.abs(a.beatOffset - perf.downbeat)).toBeLessThan(0.08)
      if (rubato > 0) expect(a.beatTimes?.length).toBeGreaterThan(20)
      const score = buildScore(perf.notes, defaultParams(a, settings), a)
      // Every note is written, once: the arpeggios in the left hand, the melody alone on top as one
      // line of dotted halves. Exact ticks everywhere but the last bar, where the final ritardando
      // (25 % slower) may move a note by one sixteenth.
      const last = 7 * 12
      expect(scoreNotes(score)).toHaveLength(perf.truth.length)
      const exact = perf.truth.filter((t) => t.tick < last)
      const body = { ...perf, truth: exact }
      const all = found(score, body, 0)
      expect(all.hit).toBe(all.total)
      const left = staffNotes(score, 1)
      for (const t of perf.truth.filter((x) => x.role !== 'melody')) {
        expect(left.some((x) => x.pitch === t.pitch && Math.abs(x.start - t.tick) <= (t.tick < last ? 0 : 2)), `${t.pitch}@${t.tick}`).toBe(true)
      }
      const melody = staffNotes(score, 0)
      expect(melody.map((x) => x.pitch)).toEqual(perf.truth.filter((t) => t.role === 'melody').map((t) => t.pitch))
      expect(melody.map((x) => x.start)).toEqual(perf.truth.filter((t) => t.role === 'melody').map((t) => t.tick))
      expect(melody.slice(0, -1).every((x) => x.ticks === 12)).toBe(true)
      expect(score.pedals?.length).toBe(8)
    })
  }
})

describe('slow ballad (tempo octave, pickup, borrowed chord)', () => {
  it('reads about 70 bpm, not double, also with rubato', () => {
    for (const rubato of [0, 0.04, 0.08]) {
      for (const seed of [1, 2, 3]) {
        const perf = balladStyle({ rubato, seed })
        const a = analyzeNotes(perf.notes)
        expect(Math.abs(a.bpm - 70) / 70, `rubato ${rubato} seed ${seed}: ${a.bpm}`).toBeLessThan(0.1)
        expect(a.timeSignature).toBe('4/4')
        expect(Math.abs(a.beatOffset - perf.downbeat), `downbeat rubato ${rubato} seed ${seed}`).toBeLessThan(0.08)
        expect(a.key).toEqual(keyFromFifths(0, 'major'))
      }
    }
  })

  it('writes the triplet pickup as a short first bar on request, spells the Fm6 chord with Ab', () => {
    const perf = balladStyle({ rubato: 0 })
    const a = analyzeNotes(perf.notes)
    const score = buildScore(perf.notes, defaultParams(a, settings), a)
    const all = found(score, perf, 16)
    expect(all.hit).toBe(all.total)
    expect(pickupTicks(score)).toBe(12 * SIXTEENTH)
    const abc = scoreToAbc(score, { pickup: true, noteNaming: 'latin' })
    const firstBar = abc.split('\n').find((l) => l.startsWith('[V:RH]'))!.split('|')[0]
    expect(firstBar).not.toContain('z')
    const { warnings, staves } = abcjsStaves(abc)
    expect(warnings).toEqual([])
    // abcjs starts at the pickup: everything sounds 12 ticks earlier than in the Score.
    expect(staves.get('RH')).toEqual(staffNotes(score, 0).map((x) => ({ ...x, start: Math.round((x.start - 12) * 1e6) / 1e6 })))
    // Fm6/C bar: C4 + Ab4 in the left hand, Ab5 in the melody, never G#.
    expect(abc).toContain('_A')
    expect(abc).toContain('"_Lab"')
    expect(abc).not.toMatch(/\^G/)
    expect(scoreToMusicXml(score)).toContain('<measure number="0" implicit="yes">')
  })
})

describe('harmonic spelling', () => {
  const C = keyFromFifths(0, 'major')
  const rh = (chords: number[][]) => {
    const a = knownAnalysis({ key: C })
    const score = buildScore(chords.flatMap((ps, i) => ps.map((p) => n(p, i * 4, 4))), plainParams(a), a)
    return scoreToAbc(score, { hands: 'right' }).split('\n').find((l) => l.startsWith('[V:RH]'))!
  }
  it('spells chromatic notes as chord tones', () => {
    expect(rh([[65, 68, 72]])).toContain('[F_Ac]') // F minor: Ab
    expect(rh([[60, 64, 68]])).toContain('[CE^G]') // augmented C: G#
    expect(rh([[64, 68, 71]])).toContain('[E^GB]') // E major: G#
    expect(rh([[63, 67, 70]])).toContain('[_EG_B]') // Eb major: Eb, Bb
  })
})

describe('beat map and Original sync', () => {
  it('maps score ticks to source seconds through the beat map, and back', () => {
    const perf = liebestraumStyle({ rubato: 0.08, seed: 2 })
    const a = analyzeNotes(perf.notes)
    const score = buildScore(perf.notes, defaultParams(a, settings), a)
    for (const t of perf.truth.filter((x) => x.role === 'melody')) {
      const seconds = sourceSecondsAt(score, t.tick * SIXTEENTH, a)
      const attack = perf.notes.filter((x) => x.pitch === t.pitch).reduce((best, x) => (Math.abs(x.start - seconds) < Math.abs(best - seconds) ? x.start : best), Infinity)
      expect(Math.abs(seconds - attack)).toBeLessThan(0.05)
      expect(tickAtSourceSeconds(score, seconds, a)).toBeCloseTo(t.tick * SIXTEENTH, 6)
    }
  })

  it('equals startSeconds + tickToSeconds without a beat map', () => {
    const a = knownAnalysis({ beatOffset: 0.5 })
    const score = buildScore([n(72, 4, 4), n(74, 8, 4)].map((x) => ({ ...x, start: x.start + 0.5 })), plainParams(a), a)
    for (const tick of [0, 3, 17.5]) expect(sourceSecondsAt(score, tick, a)).toBeCloseTo(score.startSeconds + tickToSeconds(score, tick), 9)
    expect(sourceSecondsAt(score, 4 * SIXTEENTH, null)).toBeCloseTo(score.startSeconds + 0.5, 9)
  })

  it('a straight beat map writes the same score as the constant tempo', () => {
    const notes = [n(60, 0, 4), n(64, 4, 2), n(67, 6, 2), n(72, 8, 8), n(48, 0, 16)]
    const a = knownAnalysis()
    const straight = { ...a, beatTimes: Array.from({ length: 12 }, (_, i) => i * 0.5) }
    expect(buildScore(notes, plainParams(straight), straight).staves).toEqual(buildScore(notes, plainParams(a), a).staves)
  })
})

// Audio-accuracy's realistic fixtures (Salamander grand renders with pedal, rubato, room, codecs,
// phone re-recordings, speed changes), read-only. Their ground-truth notes with sounding (pedalled)
// lengths stand in for an ideal transcription; this checks the score side on real textures.
const REAL = path.join(process.cwd(), 'test', 'fixtures', 'real')
const realFixtures = existsSync(REAL) ? readdirSync(REAL).filter((f) => f.endsWith('.json')) : []
describe.skipIf(realFixtures.length === 0)('real piano fixtures (ground truth as an ideal transcription)', () => {
  // Steady triplet eighths (Moonlight) sped up 1.25x still read at the triplet level: no triplets in the tick model.
  const skip = new Set(['phone-moonlight-125.json'])
  for (const file of realFixtures.filter((f) => !skip.has(f))) {
    it(file.replace('.json', ''), () => {
      const d = JSON.parse(readFileSync(path.join(REAL, file), 'utf8'))
      const notes: NoteEvent[] = d.notes.map((x: { pitch: number; start: number; sounding?: number; duration: number; velocity: number }) => ({
        pitch: x.pitch,
        start: x.start,
        duration: x.sounding ?? x.duration,
        velocity: x.velocity,
      }))
      const a = analyzeNotes(notes)
      // The fixture's bpm, beats and key already describe the sped-up / transposed audio.
      const bpm = d.bpm
      expect(Math.abs(a.bpm - bpm) / bpm, `tempo ${a.bpm} vs ${bpm}`).toBeLessThan(0.05)
      expect(a.timeSignature).toBe(d.timeSignature === '6/4' ? '3/4' : d.timeSignature)
      const firstDownbeat = d.pickupBeats ? d.downbeats[0] : d.beats[0]
      expect(Math.abs(a.beatOffset - firstDownbeat), 'downbeat').toBeLessThan(0.06)
      const key = normalizeKey({ tonic: d.key.tonic, mode: d.key.mode, fifths: NaN })
      expect([tonicPc(a.key), a.key.mode]).toEqual([tonicPc(key), key.mode])
      const score = buildScore(notes, defaultParams(a, settings), a)
      // Notes on the sixteenth grid of the written beats sit at exactly that tick (one constant offset).
      const truthTick = beatPositions(notes.map((x) => x.start), d.beats).map((u) => u * 4)
      const played = scoreNotes(score)
      const onGrid = notes.map((x, i) => ({ ...x, tick: truthTick[i] })).filter((x) => Math.abs(x.tick - Math.round(x.tick)) < 0.05)
      const offsets = new Map<number, number>()
      for (const x of onGrid) for (const p of played) if (p.pitch === x.pitch) offsets.set(p.tick / SIXTEENTH - Math.round(x.tick), (offsets.get(p.tick / SIXTEENTH - Math.round(x.tick)) ?? 0) + 1)
      const offset = [...offsets.entries()].sort((p, q) => q[1] - p[1])[0][0]
      const set = new Set(played.map((p) => `${p.pitch}@${p.tick / SIXTEENTH}`))
      const exact = onGrid.filter((x) => set.has(`${x.pitch}@${Math.round(x.tick) + offset}`)).length
      expect(exact / onGrid.length, `${exact}/${onGrid.length} notes at their written tick`).toBeGreaterThanOrEqual(0.94)
      expect(played.length).toBe(new Set(notes.map((x) => `${x.pitch}@${x.start.toFixed(3)}`)).size)
      // Inferred pedal: precise where it says the pedal is down.
      if (score.pedals?.length) {
        const truthPed: [number, number][] = (d.pedal ?? []).map((p: { start: number; end: number }) => [p.start, p.end])
        const spans = score.pedals.map((s) => [sourceSecondsAt(score, s.start, a), sourceSecondsAt(score, s.end, a)])
        const inside = spans.reduce((sum, [s, e]) => sum + truthPed.reduce((t, [ps, pe]) => t + Math.max(0, Math.min(e, pe) - Math.max(s, ps)), 0), 0)
        const total = spans.reduce((sum, [s, e]) => sum + (e - s), 0)
        expect(inside / total, 'pedal precision').toBeGreaterThan(0.7)
      }
    })
  }
})

describe('sixteenth-note sextuplet arpeggios under a held melody (Eb major, pedal)', () => {
  it('finds the key, writes every note once, pedal throughout as one mark, few ties', () => {
    const perf = sextupletBallad({ seed: 2 })
    const a = analyzeNotes(perf.notes)
    expect(a.key).toEqual(keyFromFifths(-3, 'major'))
    const score = buildScore(perf.notes, defaultParams(a, settings), a)
    expect(scoreNotes(score)).toHaveLength(perf.truth.length)
    const abc = scoreToAbc(score, { pedalMarks: true })
    expect(abc.match(/"_con Ped\./g)).toHaveLength(1)
    const events = score.staves.flatMap((s) => staffVoices(s).flatMap((v) => v.flatMap((m) => m.events)))
    expect(events.filter((e) => e.tie).length / scoreNotes(score).length).toBeLessThan(0.15)
  })
  it('reads 60 bpm 4/4 and writes each beat as a sixteenth sextuplet, in every format', () => {
    for (const seed of [1, 2, 3]) {
      const perf = sextupletBallad({ seed })
      const a = analyzeNotes(perf.notes)
      expect(Math.abs(a.bpm - 60) / 60, `seed ${seed}: ${a.bpm}`).toBeLessThan(0.08)
      expect(a.timeSignature).toBe('4/4')
      expect(Math.abs(a.beatOffset - perf.downbeat)).toBeLessThan(0.08)
      const score = buildScore(perf.notes, defaultParams(a, settings), a)
      // Every note at its exact sextuplet position (truth ticks are in sixteenths: 4/6 apart).
      const played = [...staffNotes(score, 0), ...staffNotes(score, 1)].map((x) => `${x.pitch}@${x.start}`)
      const r = (x: number) => Math.round(x * 1e6) / 1e6
      // (The last bar slows down by up to 25 %: exact positions are checked before it.)
      expect(played).toHaveLength(perf.truth.length)
      for (const t of perf.truth.filter((x) => x.tick < 48)) expect(played, `${t.pitch}@${t.tick}`).toContain(`${t.pitch}@${r(t.tick)}`)
      const abc = scoreToAbc(score)
      expect(abc.match(/\(6:4:6/g)?.length).toBeGreaterThanOrEqual(12)
      const { warnings, staves } = abcjsStaves(abc)
      expect(warnings).toEqual([])
      expect(staves.get('LH')).toEqual(staffNotes(score, 1))
      const xml = scoreToMusicXml(score)
      expect(xml).toContain('<divisions>12</divisions>')
      expect(xml).toContain('<time-modification><actual-notes>6</actual-notes><normal-notes>4</normal-notes></time-modification>')
      const midi = new Midi(scoreToMidi(score))
      const perTick = midi.header.ppq / TICKS_PER_QUARTER
      expect(midi.tracks[1].notes.map((x) => x.ticks / perTick).every((t) => Number.isInteger(Math.round(t * 1e6) / 1e6))).toBe(true)
    }
  })
})

describe('readable durations (notated as played, not as they ring)', () => {
  const events = (score: Score) => score.staves.flatMap((s) => staffVoices(s).flatMap((v) => v.flatMap((m) => m.events)))

  it('writes pedalled notes off the beat as one value each: no ties across a beat or a barline', () => {
    // A pedalled arpeggio of eighths on the off-beat sixteenths: each note rings to the next
    // downbeat. Read literally (or cut at the next note of either hand) it is tied over each beat.
    const notes: NoteEvent[] = []
    const roots = [48, 53, 55, 48]
    for (let b = 0; b < 4; b++) {
      const r = roots[b]
      for (const [i, p] of [r, r + 7, r + 12, r + 16, r + 19, r + 24, r + 19, r + 16].entries()) {
        const start = (b * 16 + i * 2 + 1) * 0.125
        notes.push({ pitch: p, start, duration: (b + 1) * 2 + 0.2 - start, velocity: 0.6 })
      }
    }
    const score = build(notes)
    expect(score.pedals?.length).toBeGreaterThan(0)
    expect(events(score).filter((e) => e.tie)).toEqual([])
    const all = [...staffNotes(score, 0), ...staffNotes(score, 1)]
    expect(all).toHaveLength(32)
    // A sixteenth before each beat (then a rest), not a sixteenth tied to a sixteenth.
    for (const x of all.filter((x) => x.start % 4 === 3)) expect(x.ticks).toBe(1)
  })

  it('gives a melody note held over a lower figure in the right hand its own voice, even under the pedal', () => {
    // Two bars: a louder melody note per bar over a rising figure in the same hand, all pedalled.
    const notes: NoteEvent[] = []
    for (let b = 0; b < 2; b++) {
      const end = (b + 1) * 2 + 0.05
      notes.push({ pitch: 84, start: b * 2, duration: end - b * 2, velocity: 0.8 })
      notes.push({ pitch: 36, start: b * 2, duration: end - b * 2, velocity: 0.6 })
      for (const [k, p] of [72, 76, 79, 76, 72, 76, 79].entries()) {
        const start = b * 2 + (k + 1) * 0.25
        notes.push({ pitch: p, start, duration: end - start, velocity: 0.55 })
      }
    }
    const score = build(notes, { splitPoint: 60 })
    expect(staffVoices(score.staves[0])).toHaveLength(2)
    expect(staffNotes(score, 0, 1)).toEqual([
      { pitch: 84, start: 0, ticks: 16 },
      { pitch: 84, start: 16, ticks: 16 },
    ])
    // The figure is written as running eighths.
    for (const x of staffNotes(score, 0, 2)) expect(x.ticks).toBe(2)
    expect(events(score).filter((e) => e.tie)).toEqual([])
  })

  it('ends a held note where the hand leaves to play out of its reach', () => {
    // An unpedalled B3 held under two later notes of the left hand, the first a twelfth below.
    const score = build([n(59, 0, 16, 0.8), n(38, 4, 2, 0.6), n(45, 8, 2, 0.6), n(43, 12, 2, 0.6), n(72, 0, 16)])
    const b3 = staffNotes(score, 1).find((x) => x.pitch === 59)!
    expect(b3.ticks).toBeLessThanOrEqual(4)
    // ...but playback still lets it ring as long as it sounded.
    expect(scoreNotes(score).find((x) => x.pitch === 59)?.sounding).toBe(16 * SIXTEENTH)
  })

  it('reads evenly played sixteenths at a fast tempo with timing noise as straight sixteenths (no tuplets)', () => {
    const bpm = 165
    const six = 60 / bpm / 4
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2
    const notes: NoteEvent[] = Array.from({ length: 64 }, (_, i) => ({ pitch: 60 + ((i * 5) % 12), start: 0.5 + i * six + 0.025 * rnd(), duration: six * 0.9, velocity: i % 4 === 0 ? 0.8 : 0.6 }))
    const a = analyzeNotes(notes)
    const score = buildScore(notes, defaultParams(a, settings), a)
    expect(events(score).filter((e) => e.start % SIXTEENTH !== 0 || e.duration % SIXTEENTH !== 0)).toEqual([])
  })
})
