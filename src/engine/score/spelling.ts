// Owner: engine-score. Key-aware pitch spelling and note names.
import type { KeySignature, Midi, NoteNaming } from '../../types'
import {
  LETTERS,
  NATURAL_PC,
  keySignatureAlters,
  letterName,
  mod,
  normalizeKey,
  tonicLetterIndex,
  tonicPc,
  type Letter,
} from './keys'

export interface SpelledPitch {
  step: Letter
  /** -2..2 (only the raised leading tone of G#/D# minor needs a double sharp). */
  alter: number
  /** Scientific octave of the written letter (C4 = middle C; B#3 sounds as C4). */
  octave: number
}

// Chromatic pitch-class spellings as [letterIndex, alter].
const SHARP_TABLE: [number, number][] = [
  [0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0],
]
const FLAT_TABLE: [number, number][] = [
  [0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0],
]
// C major / A minor: C#, Eb, F#, G#, Bb.
const NEUTRAL_TABLE: [number, number][] = [
  [0, 0], [0, 1], [1, 0], [2, -1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [6, -1], [6, 0],
]

interface SpellTable {
  /** [letterIndex, alter] for each pitch class. */
  byPc: [number, number][]
}

const tableCache = new Map<string, SpellTable>()

function spellTable(key: KeySignature): SpellTable {
  const id = `${key.fifths}${key.mode}`
  const cached = tableCache.get(id)
  if (cached) return cached
  const sig = keySignatureAlters(key.fifths)
  const chromatic = key.fifths > 0 ? SHARP_TABLE : key.fifths < 0 ? FLAT_TABLE : NEUTRAL_TABLE
  const byPc: [number, number][] = chromatic.map(([l, a]) => [l, a])
  if (key.mode === 'minor') {
    // Raised 6th and 7th degrees (melodic / harmonic minor) are spelled on their own letters.
    const tl = tonicLetterIndex(key.fifths, key.mode)
    const tpc = tonicPc(key)
    for (const [degree, semis] of [[5, 9], [6, 11]] as const) {
      const li = (tl + degree) % 7
      byPc[mod(tpc + semis, 12)] = [li, sig[li] + 1]
    }
  }
  // Diatonic notes always follow the key signature (E#, B#, Cb, Fb included).
  for (let li = 0; li < 7; li++) byPc[mod(NATURAL_PC[li] + sig[li], 12)] = [li, sig[li]]
  const table = { byPc }
  tableCache.set(id, table)
  return table
}

/**
 * Spells a MIDI pitch in a key: diatonic notes by the key signature, raised 6th/7th in minor keys,
 * other chromatic notes with sharps in sharp keys and flats in flat keys (C major: C# Eb F# G# Bb).
 */
export function spellPitch(midi: Midi, key?: KeySignature | null): SpelledPitch {
  const k = normalizeKey(key)
  const m = Math.round(Number.isFinite(midi) ? midi : 60)
  const [li, alter] = spellTable(k).byPc[mod(m, 12)]
  const octave = Math.floor((m - alter - NATURAL_PC[li]) / 12) - 1
  return { step: LETTERS[li], alter, octave }
}

/** Name without octave ("Fa#", "Sib" / "F#", "Bb"); 'none' behaves like latin. */
export function pitchClassName(midi: Midi, naming: NoteNaming, key?: KeySignature | null): string {
  const sp = spellPitch(midi, key)
  return letterName(LETTERS.indexOf(sp.step), sp.alter, naming)
}

/** "Do4", "Fa#3" (latin) or "C4", "F#3" (english), spelled according to the key when given. */
export function pitchName(midi: Midi, naming: NoteNaming, key?: KeySignature): string {
  const sp = spellPitch(midi, key)
  return letterName(LETTERS.indexOf(sp.step), sp.alter, naming) + sp.octave
}

/**
 * Engraving accidentals for one staff: the key signature plus accidentals that last until the end
 * of the bar, per letter and octave. Call newBar() at every barline.
 */
export class AccidentalState {
  private readonly sig: number[]
  private readonly bar = new Map<number, number>()

  constructor(key: KeySignature) {
    this.sig = keySignatureAlters(normalizeKey(key).fifths)
  }

  newBar(): void {
    this.bar.clear()
  }

  /**
   * Returns the alteration to print for this note (null = none) and updates the bar state.
   * A note tied over the barline prints nothing and leaves the state alone (standard engraving;
   * abcjs also takes a tied note's pitch from the first note of the tie).
   */
  visit(sp: SpelledPitch, tiedOverBarline = false): number | null {
    if (tiedOverBarline) return null
    const li = LETTERS.indexOf(sp.step)
    const id = li * 32 + sp.octave + 8
    const current = this.bar.has(id) ? this.bar.get(id)! : this.sig[li]
    if (current === sp.alter) return null
    this.bar.set(id, sp.alter)
    return sp.alter
  }
}
