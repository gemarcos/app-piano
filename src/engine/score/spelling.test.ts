// Owner: engine-score. Pitch spelling, note names and key signatures in every key.
import { describe, expect, it } from 'vitest'
import type { KeyMode, KeySignature } from '../../types'
import {
  allKeys,
  keyFromFifths,
  keyFromPc,
  keyName,
  normalizeKey,
  pitchClassName,
  pitchName,
  spellChord,
  spellPitch,
  tonicPc,
  transposeKey,
} from './index'
import { NATURAL_PC, keySignatureAlters, LETTERS } from './keys'

const MODES: KeyMode[] = ['major', 'minor']
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11]
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10]
const mod = (n: number, m: number) => ((n % m) + m) % m

function allSignatures(): KeySignature[] {
  const out: KeySignature[] = []
  for (let f = -7; f <= 7; f++) for (const mode of MODES) out.push(keyFromFifths(f, mode))
  return out
}

/** MIDI number written by a spelled pitch. */
const sounding = (sp: { step: string; alter: number; octave: number }) =>
  (sp.octave + 1) * 12 + NATURAL_PC[LETTERS.indexOf(sp.step as never)] + sp.alter

const spelled = (midi: number, key: KeySignature) => {
  const sp = spellPitch(midi, key)
  return sp.step + (sp.alter > 0 ? '#'.repeat(sp.alter) : 'b'.repeat(-sp.alter)) + sp.octave
}

describe('key signatures', () => {
  it('builds the 30 signatures with conventional tonics', () => {
    const majors = allSignatures().filter((k) => k.mode === 'major').map((k) => k.tonic)
    const minors = allSignatures().filter((k) => k.mode === 'minor').map((k) => k.tonic)
    expect(majors).toEqual(['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'])
    expect(minors).toEqual(['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'])
  })

  it('clamps and rounds fifths', () => {
    expect(keyFromFifths(9, 'major').fifths).toBe(7)
    expect(keyFromFifths(-8.6, 'minor').fifths).toBe(-7)
    expect(keyFromFifths(Number.NaN, 'major')).toEqual({ tonic: 'C', mode: 'major', fifths: 0 })
  })

  it('keyFromPc picks the spelling with fewer accidentals (ties: F# major, Eb minor)', () => {
    expect(keyFromPc(1, 'major').tonic).toBe('Db')
    expect(keyFromPc(6, 'major').tonic).toBe('F#')
    expect(keyFromPc(6, 'major', 'flat').tonic).toBe('Gb')
    expect(keyFromPc(3, 'minor').tonic).toBe('Eb')
    expect(keyFromPc(3, 'minor', 'sharp').tonic).toBe('D#')
    expect(keyFromPc(8, 'minor').tonic).toBe('G#')
    expect(keyFromPc(10, 'minor').tonic).toBe('Bb')
    for (let pc = 0; pc < 12; pc++) {
      for (const mode of MODES) {
        const k = keyFromPc(pc, mode)
        expect(tonicPc(k)).toBe(pc)
        expect(Math.abs(k.fifths)).toBeLessThanOrEqual(6)
      }
    }
  })

  it('normalizeKey trusts fifths + mode and repairs bad input', () => {
    expect(normalizeKey(null)).toEqual({ tonic: 'C', mode: 'major', fifths: 0 })
    expect(normalizeKey({ tonic: 'G', mode: 'major', fifths: 2 })).toEqual({ tonic: 'D', mode: 'major', fifths: 2 })
    expect(normalizeKey({ tonic: 'Bb', mode: 'major' } as KeySignature)).toEqual({ tonic: 'Bb', mode: 'major', fifths: -2 })
    expect(normalizeKey({ tonic: 'f#', mode: 'minor', fifths: Number.NaN })).toEqual({ tonic: 'F#', mode: 'minor', fifths: 3 })
    expect(normalizeKey({ tonic: '??', mode: 'dorian', fifths: 40 } as unknown as KeySignature)).toEqual({
      tonic: 'C',
      mode: 'major',
      fifths: 0,
    })
  })

  it('allKeys lists 24 distinct keys by fifths (majors, then minors)', () => {
    const keys = allKeys()
    expect(keys).toHaveLength(24)
    expect(keys.slice(0, 12).every((k) => k.mode === 'major')).toBe(true)
    expect(keys.slice(12).every((k) => k.mode === 'minor')).toBe(true)
    expect(new Set(keys.map((k) => `${tonicPc(k)}${k.mode}`)).size).toBe(24)
    for (let i = 1; i < 12; i++) {
      expect(keys[i].fifths).toBe(keys[i - 1].fifths + 1)
      expect(keys[12 + i].fifths).toBe(keys[11 + i].fifths + 1)
    }
    expect(keys[0].tonic).toBe('Db')
    expect(keys[11].tonic).toBe('F#')
    expect(keys[12].tonic).toBe('Eb')
    expect(keys[23].tonic).toBe('G#')
  })
})

describe('spellPitch', () => {
  it('round-trips every piano key in every key signature', () => {
    for (const key of allSignatures()) {
      for (let midi = 21; midi <= 108; midi++) {
        const sp = spellPitch(midi, key)
        expect(sounding(sp)).toBe(midi)
        expect(Math.abs(sp.alter)).toBeLessThanOrEqual(2)
      }
    }
  })

  it('spells diatonic notes by the key signature (no accidental needed)', () => {
    for (const key of allSignatures()) {
      const sig = keySignatureAlters(key.fifths)
      const tonic = tonicPc(key)
      const steps = key.mode === 'major' ? MAJOR_STEPS : MINOR_STEPS
      const tonicLetter = LETTERS.indexOf(key.tonic[0] as never)
      steps.forEach((semis, degree) => {
        const sp = spellPitch(60 + mod(tonic + semis, 12), key)
        const letter = (tonicLetter + degree) % 7
        expect(sp.step).toBe(LETTERS[letter])
        expect(sp.alter).toBe(sig[letter])
      })
    }
  })

  it('spells chromatic black keys with sharps in sharp keys and flats in flat keys', () => {
    const black = new Set([1, 3, 6, 8, 10])
    for (const key of allSignatures()) {
      // Minor keys: raised 6th / 7th checked below. C major: its own table, checked below.
      if (key.mode === 'minor' || key.fifths === 0) continue
      const sig = keySignatureAlters(key.fifths)
      for (let pc = 0; pc < 12; pc++) {
        const sp = spellPitch(60 + pc, key)
        const li = LETTERS.indexOf(sp.step)
        if (sp.alter === sig[li]) continue // diatonic
        if (!black.has(pc)) expect(sp.alter, `${key.tonic} pc ${pc}`).toBe(0) // white key: a natural
        else if (key.fifths > 0) expect(sp.alter, `${key.tonic} pc ${pc}`).toBe(1)
        else expect(sp.alter, `${key.tonic} pc ${pc}`).toBe(-1)
      }
    }
  })

  it('uses C# Eb F# G# Bb in C major and A minor', () => {
    for (const key of [keyFromFifths(0, 'major'), keyFromFifths(0, 'minor')]) {
      expect([61, 63, 66, 68, 70].map((m) => spelled(m, key))).toEqual(['C#4', 'Eb4', 'F#4', 'G#4', 'Bb4'])
    }
  })

  it('spells the raised 6th and 7th of minor keys on their own letters', () => {
    const cases: [number, string[]][] = [
      [0, ['F#4', 'G#4']], // A minor
      [1, ['C#5', 'D#5']], // E minor
      [-1, ['B4', 'C#5']], // D minor
      [-3, ['A4', 'B4']], // C minor: A natural, B natural
      [5, ['E#5', 'F##5']], // G# minor
      [6, ['B#4', 'C##5']], // D# minor
      [-6, ['C5', 'D5']], // Eb minor
    ]
    for (const [fifths, expected] of cases) {
      const key = keyFromFifths(fifths, 'minor')
      const tonic = tonicPc(key)
      const base = 60 + tonic + (tonic >= 9 ? -12 : 0) // tonic in octave 4
      expect([spelled(base + 9, key), spelled(base + 11, key)], key.tonic + ' minor').toEqual(expected)
    }
  })

  it('writes B#, E#, Cb and Fb in the extreme keys with the right octave', () => {
    const cSharp = keyFromFifths(7, 'major')
    const cFlat = keyFromFifths(-7, 'major')
    expect(spelled(60, cSharp)).toBe('B#3')
    expect(spelled(65, cSharp)).toBe('E#4')
    expect(spelled(59, cFlat)).toBe('Cb4')
    expect(spelled(64, cFlat)).toBe('Fb4')
    expect(spelled(71, cFlat)).toBe('Cb5')
  })

  it('defaults to C major and survives bad input', () => {
    expect(spellPitch(60)).toEqual({ step: 'C', alter: 0, octave: 4 })
    expect(spellPitch(Number.NaN)).toEqual({ step: 'C', alter: 0, octave: 4 })
    expect(spellPitch(21)).toEqual({ step: 'A', alter: 0, octave: 0 })
    expect(spellPitch(108)).toEqual({ step: 'C', alter: 0, octave: 8 })
  })
})

describe('spellChord', () => {
  const names = (pitches: number[], key: KeySignature) => spellChord(pitches, key).map((sp) => spelledOf(sp))
  const spelledOf = (sp: { step: string; alter: number; octave: number }) =>
    sp.step + (sp.alter > 0 ? '#'.repeat(sp.alter) : 'b'.repeat(-sp.alter)) + sp.octave

  it('spells ordinary chords like spellPitch', () => {
    const G = keyFromFifths(1, 'major')
    expect(names([55, 59, 62, 66], G)).toEqual(['G3', 'B3', 'D4', 'F#4'])
    expect(names([], G)).toEqual([])
  })

  it('never puts two notes on the same letter and octave', () => {
    const C = keyFromFifths(0, 'major')
    expect(names([65, 66], C)).toEqual(['F4', 'Gb4'])
    expect(names([63, 64], C)).toEqual(['D#4', 'E4'])
    expect(names([107, 108], keyFromFifths(6, 'minor'))).toEqual(['B7', 'C8'])
    expect(names([67, 68], keyFromFifths(0, 'minor'))).toEqual(['G4', 'Ab4'])
    for (const key of allSignatures()) {
      for (let low = 40; low < 90; low += 1) {
        for (const chord of [[low, low + 1], [low, low + 1, low + 2], [low, low + 1, low + 5, low + 6]]) {
          const sp = spellChord(chord, key)
          const spots = sp.map((s) => s.step + s.octave)
          expect(new Set(spots).size, `${key.tonic} ${key.mode} ${chord}`).toBe(chord.length)
          sp.forEach((s, i) => expect(sounding(s)).toBe(chord[i]))
        }
      }
    }
  })
})

describe('names', () => {
  it('pitchName uses scientific octaves (C4 = 60) in latin and english', () => {
    expect(pitchName(60, 'latin')).toBe('Do4')
    expect(pitchName(60, 'english')).toBe('C4')
    expect(pitchName(61, 'latin')).toBe('Do#4')
    expect(pitchName(70, 'latin')).toBe('Sib4')
    expect(pitchName(70, 'english')).toBe('Bb4')
    expect(pitchName(66, 'latin', keyFromFifths(1, 'major'))).toBe('Fa#4')
    expect(pitchName(66, 'latin', keyFromFifths(-6, 'major'))).toBe('Solb4')
    expect(pitchName(21, 'latin')).toBe('La0')
    expect(pitchName(108, 'english')).toBe('C8')
    expect(pitchName(67, 'none')).toBe(pitchName(67, 'latin'))
  })

  it('pitchClassName drops the octave', () => {
    expect(pitchClassName(54, 'latin', keyFromFifths(1, 'major'))).toBe('Fa#')
    expect(pitchClassName(58, 'english', keyFromFifths(-1, 'major'))).toBe('Bb')
  })

  it('keyName says mayor / menor with latin or english tonics', () => {
    expect(keyName(keyFromFifths(1, 'major'), 'latin')).toBe('Sol mayor')
    expect(keyName(keyFromFifths(1, 'minor'), 'latin')).toBe('Mi menor')
    expect(keyName(keyFromFifths(1, 'major'), 'english')).toBe('G mayor')
    expect(keyName(keyFromFifths(1, 'minor'), 'english')).toBe('E menor')
    expect(keyName(keyFromFifths(-2, 'major'), 'latin')).toBe('Sib mayor')
    expect(keyName(keyFromFifths(3, 'minor'), 'latin')).toBe('Fa# menor')
    expect(keyName(keyFromFifths(-6, 'minor'), 'latin')).toBe('Mib menor')
    expect(keyName(keyFromFifths(7, 'major'), 'english')).toBe('C# mayor')
    expect(keyName(keyFromFifths(4, 'major'), 'none')).toBe('Mi mayor')
  })
})

describe('transposeKey', () => {
  it('moves the tonic and keeps the mode', () => {
    const c = keyFromFifths(0, 'major')
    expect(transposeKey(c, 7)).toEqual(keyFromFifths(1, 'major'))
    expect(transposeKey(c, 2).tonic).toBe('D')
    expect(transposeKey(c, -2).tonic).toBe('Bb')
    expect(transposeKey(keyFromFifths(0, 'minor'), 3)).toEqual({ tonic: 'C', mode: 'minor', fifths: -3 })
    expect(transposeKey(keyFromFifths(-6, 'major'), 2).tonic).toBe('Ab')
  })

  it('picks the enharmonic with fewer accidentals', () => {
    expect(transposeKey(keyFromFifths(0, 'major'), 1).tonic).toBe('Db') // not C#
    expect(transposeKey(keyFromFifths(0, 'major'), -1).tonic).toBe('B') // not Cb
    expect(transposeKey(keyFromFifths(0, 'minor'), 1).tonic).toBe('Bb') // not A#
    expect(transposeKey(keyFromFifths(4, 'major'), 1).tonic).toBe('F')
  })

  it('breaks 6-accidental ties towards the side of the original key', () => {
    expect(transposeKey(keyFromFifths(1, 'major'), -1).tonic).toBe('F#')
    expect(transposeKey(keyFromFifths(-1, 'major'), 1).tonic).toBe('Gb')
    expect(transposeKey(keyFromFifths(1, 'minor'), -1).tonic).toBe('D#')
    expect(transposeKey(keyFromFifths(-4, 'minor'), -2).tonic).toBe('Eb')
  })

  it('is periodic and reversible up to enharmonics', () => {
    for (const key of allSignatures()) {
      expect(tonicPc(transposeKey(key, 12))).toBe(tonicPc(key))
      for (let s = -12; s <= 12; s++) {
        const t = transposeKey(key, s)
        expect(t.mode).toBe(key.mode)
        expect(tonicPc(t)).toBe(mod(tonicPc(key) + s, 12))
        expect(tonicPc(transposeKey(t, -s))).toBe(tonicPc(key))
      }
    }
    expect(transposeKey(keyFromFifths(2, 'major'), Number.NaN)).toEqual(keyFromFifths(2, 'major'))
  })
})
