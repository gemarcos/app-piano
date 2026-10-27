// Owner: engine-score. ABC output: header, notes, accidentals, ties, names, and abcjs validation.
import abcjs from 'abcjs'
import { describe, expect, it } from 'vitest'
import type { Difficulty, Hands, KeySignature, NoteNaming, Score, ScoreEvent, TimeSignature } from '../../types'
import { buildScore, keyFromFifths, scoreToAbc } from './index'
import { ABC_ANNOTATION_FONT, ABC_ANNOTATION_SIZE } from './abc'
import { knownAnalysis, plainParams, randomNotes, scoreFromMeasures, staffNotes, type StaffNote } from './test-helpers'

const C = keyFromFifths(0, 'major')
const ev = (start: number, duration: number, pitches: number[], tie?: boolean): ScoreEvent =>
  tie ? { start, duration, pitches, tie } : { start, duration, pitches }

/** Body of one voice: every `[V:id]` line joined, without the voice prefix and the final barline. */
function body(abc: string, id: 'RH' | 'LH'): string {
  return abc
    .split('\n')
    .filter((l) => l.startsWith(`[V:${id}]`))
    .map((l) => l.slice(id.length + 4).trim())
    .join(' ')
    .replace(/\s*\|\]?$/, '')
}

interface AbcjsResult {
  warnings: string[]
  voices: StaffNote[][]
}

/** Parses with abcjs and flattens it for playback the way the synth does: sounding notes per voice. */
function viaAbcjs(abc: string): AbcjsResult {
  const [tune] = abcjs.parseOnly(abc)
  const warnings = (tune as unknown as { warnings?: string[] }).warnings ?? []
  const audio = (tune as unknown as { setUpAudio(o: object): { tracks: { cmd: string; pitch: number; start: number; duration: number }[][] } }).setUpAudio({})
  const voices = audio.tracks.map((track) =>
    track
      .filter((e) => e.cmd === 'note')
      .map((e) => ({ pitch: e.pitch, start: Math.round(e.start * 16), ticks: Math.round(e.duration * 16) }))
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch),
  )
  return { warnings, voices }
}

describe('scoreToAbc header', () => {
  const score = scoreFromMeasures([[ev(0, 16, [72])]], [[ev(0, 16, [48])]], { key: keyFromFifths(1, 'major'), bpm: 96 })

  it('writes an abcjs grand staff', () => {
    const abc = scoreToAbc(score)
    expect(abc.split('\n').slice(0, 10)).toEqual([
      'X:1',
      'M:4/4',
      'L:1/16',
      'Q:1/4=96',
      '%%score {RH | LH}',
      'V:RH clef=treble',
      'V:LH clef=bass',
      'K:G',
      '%%MIDI program 0',
      '[V:RH] c16 |]',
    ])
    expect(abc.endsWith('[V:LH] C,16 |]\n')).toBe(true)
  })

  it('names keys the ABC way', () => {
    const k = (fifths: number, mode: 'major' | 'minor') => scoreToAbc({ ...score, key: keyFromFifths(fifths, mode) }).match(/^K:(.*)$/m)![1]
    expect([k(0, 'major'), k(1, 'minor'), k(-2, 'major'), k(3, 'minor'), k(7, 'major'), k(-7, 'major'), k(-7, 'minor')]).toEqual([
      'C',
      'Em',
      'Bb',
      'F#m',
      'C#',
      'Cb',
      'Abm',
    ])
  })

  it('sets the tempo per dotted quarter in 6/8 and can hide the tempo mark', () => {
    const six = scoreFromMeasures([[ev(0, 12, [72])]], [], { timeSignature: '6/8', bpm: 96 })
    expect(scoreToAbc(six)).toContain('M:6/8\nL:1/16\nQ:3/8=64\n')
    expect(scoreToAbc(score, { printTempo: false })).toContain('%%printtempo false\nQ:1/4=96')
  })

  it('adds the title only on request, without breaking the header', () => {
    const titled = { ...score, title: 'Vals "lento"\n100% piano\\' }
    expect(scoreToAbc(titled)).not.toContain('T:')
    const abc = scoreToAbc(titled, { includeTitle: true })
    expect(abc).toContain('T:Vals "lento" 100\\% piano\n')
    const [tune] = abcjs.parseOnly(abc)
    expect(tune.metaText.title).toBe('Vals "lento" 100​％ piano')
  })

  it('emits one voice for a single hand', () => {
    const right = scoreToAbc(score, { hands: 'right' })
    expect(right).not.toContain('%%score')
    expect(right).toContain('V:RH clef=treble')
    expect(right).not.toContain('V:LH')
    const left = scoreToAbc(score, { hands: 'left' })
    expect(left).not.toContain('V:RH')
    expect(body(left, 'LH')).toBe('C,16')
  })

  it('breaks systems every measuresPerLine bars, interleaving the voices', () => {
    const long = scoreFromMeasures(Array.from({ length: 9 }, () => [ev(0, 16, [72])]), [])
    const abc = scoreToAbc(long, { measuresPerLine: 4 })
    const systems = abc.split('\n').filter((l) => l.startsWith('[V:'))
    expect(systems.map((l) => l.slice(0, 6))).toEqual(['[V:RH]', '[V:LH]', '[V:RH]', '[V:LH]', '[V:RH]', '[V:LH]'])
    expect(systems[0]).toBe('[V:RH] c16 | c16 | c16 | c16 |')
    expect(systems[4]).toBe('[V:RH] c16 |]')
    expect(scoreToAbc(long, { measuresPerLine: 2 }).split('\n').filter((l) => l.startsWith('[V:RH]'))).toHaveLength(5)
  })
})

describe('scoreToAbc notes', () => {
  const rh = (events: ScoreEvent[][], key: KeySignature = C, ts: TimeSignature = '4/4') =>
    body(scoreToAbc(scoreFromMeasures(events, [], { key, timeSignature: ts })), 'RH')

  it('writes ABC octaves (C, = C3, C = C4, c = C5, c′ = C6)', () => {
    expect(rh([[ev(0, 4, [48]), ev(4, 4, [60]), ev(8, 4, [72]), ev(12, 4, [84])]])).toBe('C,4 C4 c4 c\'4')
    expect(rh([[ev(0, 8, [21]), ev(8, 8, [108])]])).toBe("A,,,,8 c'''8")
  })

  it('writes chords, rests, lengths and beams by beat', () => {
    expect(rh([[ev(0, 2, [60, 64, 67]), ev(2, 2, [62]), ev(4, 1, [64]), ev(5, 1, [65]), ev(6, 2, []), ev(8, 6, [67]), ev(14, 2, [69])]])).toBe(
      '[CEG]2D2 EF z2 G6A2',
    )
  })

  it('ties with "-" (also across barlines)', () => {
    expect(rh([[ev(0, 8, []), ev(8, 4, []), ev(12, 4, [72], true)], [ev(0, 4, [72]), ev(4, 4, []), ev(8, 8, [])]])).toBe('z8 z4 c4- | c4 z4 z8')
    expect(rh([[ev(0, 6, [60, 64], true), ev(6, 2, [60, 64])]])).toBe('[CE]6-[CE]2')
  })
})

describe('accidentals', () => {
  const rh = (events: ScoreEvent[][], key: KeySignature = C) => body(scoreToAbc(scoreFromMeasures(events, [], { key })), 'RH')

  it('last until the end of the bar and are cancelled with naturals', () => {
    expect(rh([[ev(0, 4, [66]), ev(4, 4, [66]), ev(8, 4, [65]), ev(12, 4, [66])]])).toBe('^F4 F4 =F4 ^F4')
  })

  it('reset at every barline', () => {
    expect(rh([[ev(0, 16, [66])], [ev(0, 16, [66])]])).toBe('^F16 | ^F16')
  })

  it('apply per octave', () => {
    expect(rh([[ev(0, 4, [66]), ev(4, 4, [78]), ev(8, 4, [66]), ev(12, 4, [78])]])).toBe('^F4 ^f4 F4 f4')
  })

  it('follow the key signature', () => {
    const G = keyFromFifths(1, 'major')
    expect(rh([[ev(0, 4, [66]), ev(4, 4, [65]), ev(8, 4, [66]), ev(12, 4, [65])]], G)).toBe('F4 =F4 ^F4 =F4')
    const F = keyFromFifths(-1, 'major')
    expect(rh([[ev(0, 4, [70]), ev(4, 4, [71]), ev(8, 4, [75]), ev(12, 4, [70])]], F)).toBe('B4 =B4 _e4 _B4')
  })

  it('cover chords, double sharps and the extreme keys', () => {
    expect(rh([[ev(0, 4, [60, 64, 68]), ev(4, 4, [68]), ev(8, 8, [70])]])).toBe('[CE^G]4 G4 _B8')
    expect(rh([[ev(0, 8, [67]), ev(8, 8, [68])]], keyFromFifths(5, 'minor'))).toBe('^^F8 G8')
    expect(rh([[ev(0, 8, [60]), ev(8, 8, [65])]], keyFromFifths(7, 'major'))).toBe('B,8 E8')
    expect(rh([[ev(0, 8, [59]), ev(8, 8, [64])]], keyFromFifths(-7, 'major'))).toBe('C8 F8')
  })

  it('are not repeated on tied notes, are restated after a tie over the barline, with a courtesy natural', () => {
    expect(rh([[ev(0, 8, []), ev(8, 8, [66], true)], [ev(0, 8, [66]), ev(8, 8, [66])]])).toBe('z8 ^F8- | F8 ^F8')
    expect(rh([[ev(0, 8, []), ev(8, 8, [66], true)], [ev(0, 8, [66]), ev(8, 8, [65])]])).toBe('z8 ^F8- | F8 =F8')
    // A tie carried over the barline and split again at the half-bar prints nothing on either piece.
    expect(rh([[ev(0, 8, []), ev(8, 8, [66], true)], [ev(0, 8, [66], true), ev(8, 4, [66]), ev(12, 4, [])]])).toBe('z8 ^F8- | F8- F4 z4')
  })
})

describe('note names', () => {
  const score = scoreFromMeasures(
    [[ev(0, 4, [66]), ev(4, 4, [60, 64, 67]), ev(8, 4, [60, 64, 67, 72]), ev(12, 4, [72], true)], [ev(0, 16, [72])]],
    [[ev(0, 16, [43, 50])]],
    { key: keyFromFifths(1, 'major') },
  )

  it('annotates under the notes in latin or english, highest name first', () => {
    expect(body(scoreToAbc(score, { noteNaming: 'latin' }), 'RH')).toBe('"_Fa#"F4 "_Sol""_Mi""_Do"[CEG]4 "_Do""_Do"[CEGc]4 "_Do"c4- | c16')
    expect(body(scoreToAbc(score, { noteNaming: 'english' }), 'LH')).toBe('"_D""_G"[G,,D,]16 | z16')
    expect(body(scoreToAbc(score), 'RH')).toBe('F4 [CEG]4 [CEGc]4 c4- | c16')
  })

  it('names only the first new note of a beat in fast runs, unless nameEveryNote', () => {
    const fast = scoreFromMeasures([
      [
        ev(0, 1, [60]), ev(1, 1, [62]), ev(2, 1, [64]), ev(3, 1, [65]), // 4 sixteenths: first only
        ev(4, 2, [67]), ev(6, 2, [69]), // 2 eighths: both
        ev(8, 1, [71], true), ev(9, 1, [71]), ev(10, 1, [72]), ev(11, 1, [74]), // 3 new notes (the tie continues one)
        ev(12, 4, [76]),
      ],
    ])
    expect(body(scoreToAbc(fast, { noteNaming: 'latin' }), 'RH')).toBe('"_Do"CDEF "_Sol"G2"_La"A2 "_Si"B-Bcd "_Mi"e4')
    expect(body(scoreToAbc(fast, { noteNaming: 'latin', nameEveryNote: true }), 'RH')).toBe(
      '"_Do"C"_Re"D"_Mi"E"_Fa"F "_Sol"G2"_La"A2 "_Si"B-B"_Do"c"_Re"d "_Mi"e4',
    )
    // 6/8: three eighths per dotted-quarter beat keep their names, sixteenths do not.
    const six = scoreFromMeasures(
      [[ev(0, 2, [64]), ev(2, 2, [66]), ev(4, 2, [67]), ev(6, 1, [71]), ev(7, 1, [69]), ev(8, 1, [67]), ev(9, 1, [66]), ev(10, 2, [64])]],
      [],
      { timeSignature: '6/8', key: keyFromFifths(1, 'minor') },
    )
    expect(body(scoreToAbc(six, { noteNaming: 'latin' }), 'RH')).toBe('"_Mi"E2"_Fa#"F2"_Sol"G2 "_Si"BAGFE2')
    // Any sixteenth onset makes the beat dense: dotted rhythms and rest + two sixteenths keep one name.
    const dotted = scoreFromMeasures([[ev(0, 3, [60]), ev(3, 1, [62]), ev(4, 2, []), ev(6, 1, [64]), ev(7, 1, [65]), ev(8, 8, [67])]])
    expect(body(scoreToAbc(dotted, { noteNaming: 'latin' }), 'RH')).toBe('"_Do"C3D z2 "_Mi"EF "_Sol"G8')
    // A beat that starts with the continuation of a tie names its first new note.
    const tied = scoreFromMeasures([[ev(0, 12, []), ev(12, 4, [72], true)], [ev(0, 1, [72]), ev(1, 1, [74]), ev(2, 1, [76]), ev(3, 1, [77]), ev(4, 12, [79])]])
    expect(body(scoreToAbc(tied, { noteNaming: 'english' }), 'RH')).toBe('z12 "_C"c4- | c"_D"def "_G"g12')
  })

  it('uses a small annotation font (about 2/3 of the abcjs default) only with names', () => {
    expect(scoreToAbc(score)).not.toContain('%%annotationfont')
    const abc = scoreToAbc(score, { noteNaming: 'latin' })
    expect(abc).toContain(`%%annotationfont "${ABC_ANNOTATION_FONT}" ${ABC_ANNOTATION_SIZE}\n`)
    expect(abc.indexOf('%%annotationfont')).toBeLessThan(abc.indexOf('K:'))
    const [tune] = abcjs.parseOnly(abc)
    const font = (tune as unknown as { formatting: { annotationfont: { face: string; size: number } } }).formatting.annotationfont
    expect(font).toMatchObject({ face: ABC_ANNOTATION_FONT, size: 8 })
    expect(font.size / 12).toBeGreaterThanOrEqual(0.6)
    expect(font.size / 12).toBeLessThanOrEqual(0.7)
    const custom = scoreToAbc(score, { noteNaming: 'latin', annotationSize: 7.5, annotationFont: 'Georgia, "serif"' })
    expect(custom).toContain('%%annotationfont "Georgia, serif" 7.5\n')
  })
})

describe('abcjs validation', () => {
  const keys = Array.from({ length: 15 }, (_, i) => i - 7).flatMap((f) => [keyFromFifths(f, 'major'), keyFromFifths(f, 'minor')])
  const meters: TimeSignature[] = ['4/4', '3/4', '2/4', '6/8']
  const modes: Difficulty[] = ['original', 'intermedio', 'facil']
  const namings: NoteNaming[] = ['none', 'latin', 'english']
  const handsList: Hands[] = ['both', 'right', 'left']

  function generated(i: number): Score {
    const key = keys[i % keys.length]
    const ts = meters[i % meters.length]
    const a = knownAnalysis({ bpm: 60 + ((i * 37) % 120), timeSignature: ts, key, beatOffset: (i % 5) * 0.17 })
    const params = plainParams(a, {
      difficulty: modes[i % 3],
      quantize: i % 4 === 3 ? 8 : 16,
      maxPolyphony: 1 + (i % 6),
      splitPoint: 52 + (i % 17),
      transpose: (i % 25) - 12,
    })
    return buildScore(randomNotes(40 + ((i * 13) % 160), 1000 + i, 6 + (i % 20)), params, a, `Prueba ${i}`)
  }

  it('parses every generated score without warnings and plays exactly the score notes', () => {
    let checked = 0
    for (let i = 0; i < 90; i++) {
      const score = generated(i)
      const expected = [staffNotes(score, 0), staffNotes(score, 1)]
      const hands = handsList[i % 3]
      const naming = namings[Math.floor(i / 3) % 3]
      const abc = scoreToAbc(score, { hands, noteNaming: naming, measuresPerLine: 1 + (i % 5), includeTitle: i % 2 === 0 })
      const { warnings, voices } = viaAbcjs(abc)
      expect(warnings, `score ${i}`).toEqual([])
      const wanted = hands === 'both' ? expected : hands === 'right' ? [expected[0]] : [expected[1]]
      expect(voices.length, `score ${i}`).toBe(wanted.length)
      wanted.forEach((notes, v) => expect(voices[v], `score ${i} voice ${v}`).toEqual(notes))
      checked += wanted.flat().length
    }
    expect(checked).toBeGreaterThan(2000)
  })

  it('handles dense accidentals and ties in every key', () => {
    for (const [i, key] of keys.entries()) {
      // Chromatic runs with repeated pitches, octave jumps and notes tied over barlines.
      const right: ScoreEvent[][] = []
      const left: ScoreEvent[][] = []
      for (let m = 0; m < 4; m++) {
        const base = 60 + ((i + m) % 12)
        right.push([ev(0, 2, [base]), ev(2, 2, [base + 1]), ev(4, 2, [base]), ev(6, 2, [base + 13]), ev(8, 4, [base + 1, base + 6]), ev(12, 4, [base + 2], m < 3)])
        left.push([ev(0, 2, [base - 24]), ev(2, 2, [base - 23]), ev(4, 4, [base - 22, base - 17]), ev(8, 8, [base - 23], m < 3)])
        if (m > 0) {
          // The tied note continues at the start of the next bar.
          const prev = right[m - 1].at(-1)!.pitches
          right[m][0] = ev(0, 2, prev)
          left[m][0] = ev(0, 2, left[m - 1].at(-1)!.pitches)
        }
      }
      const score = scoreFromMeasures(right, left, { key })
      for (const naming of namings) {
        const { warnings, voices } = viaAbcjs(scoreToAbc(score, { noteNaming: naming }))
        expect(warnings, key.tonic + key.mode).toEqual([])
        expect(voices[0], `${key.tonic} ${key.mode} RH`).toEqual(staffNotes(score, 0))
        expect(voices[1], `${key.tonic} ${key.mode} LH`).toEqual(staffNotes(score, 1))
      }
    }
  })

  it('accepts an empty score', () => {
    const empty = buildScore([], plainParams(knownAnalysis()), knownAnalysis())
    const { warnings, voices } = viaAbcjs(scoreToAbc(empty, { noteNaming: 'latin' }))
    expect(warnings).toEqual([])
    expect(voices.flat()).toEqual([])
  })
})
