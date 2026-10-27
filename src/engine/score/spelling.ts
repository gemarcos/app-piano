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
export function spellPitch(midi: Midi, key?: KeySignature | null, context?: SpellingChoice): SpelledPitch {
  const k = normalizeKey(key)
  const m = Math.round(Number.isFinite(midi) ? midi : 60)
  const [li, alter] = context?.get(mod(m, 12)) ?? spellTable(k).byPc[mod(m, 12)]
  const octave = Math.floor((m - alter - NATURAL_PC[li]) / 12) - 1
  return { step: LETTERS[li], alter, octave }
}

/** The same pitch written on the neighbouring letter (dir +1 = letter above, -1 = below), or null. */
function onLetter(midi: number, sp: SpelledPitch, dir: 1 | -1): SpelledPitch | null {
  let li = LETTERS.indexOf(sp.step) + dir
  let octave = sp.octave
  if (li > 6) {
    li = 0
    octave++
  } else if (li < 0) {
    li = 6
    octave--
  }
  const alter = midi - ((octave + 1) * 12 + NATURAL_PC[li])
  return Math.abs(alter) <= 2 ? { step: LETTERS[li], alter, octave } : null
}

/** Staff position (diatonic steps from C-1). */
const position = (sp: SpelledPitch) => sp.octave * 7 + LETTERS.indexOf(sp.step)

/**
 * Spells the pitches of a chord (ascending) like spellPitch, except that the notes always climb the
 * staff: no two share a letter and octave. When the key spelling collides, the cheapest respelling
 * on a neighbouring letter wins (fewest accidental signs): F + F# in C major -> F + Gb,
 * Eb + E -> D# + E, B + B# in D# minor -> B + C.
 */
export function spellChord(pitches: readonly Midi[], key?: KeySignature | null, context?: SpellingChoice): SpelledPitch[] {
  const k = normalizeKey(key)
  const midis = pitches.map((p) => Math.round(Number.isFinite(p) ? p : 60))
  const base = midis.map((m) => spellPitch(m, k, context))
  let climbs = true
  for (let i = 1; i < base.length; i++) if (position(base[i]) <= position(base[i - 1])) climbs = false
  if (climbs) return base
  // Rare: choose among {key spelling, letter above, letter below} per note with a small DP.
  const sig = keySignatureAlters(k.fifths)
  const cost = (sp: SpelledPitch, j: number) => (sp.alter !== sig[LETTERS.indexOf(sp.step)] ? 2 : 0) + Math.abs(sp.alter) + (j > 0 ? 0.5 : 0)
  const cands = midis.map((m, i) => [base[i], onLetter(m, base[i], 1), onLetter(m, base[i], -1)])
  let prev: { total: number; path: SpelledPitch[] }[] = [{ total: 0, path: [] }]
  for (let i = 0; i < midis.length; i++) {
    const next: { total: number; path: SpelledPitch[] }[] = []
    cands[i].forEach((sp, j) => {
      if (!sp) return
      let best: { total: number; path: SpelledPitch[] } | null = null
      for (const s of prev) {
        const last = s.path[s.path.length - 1]
        if (last && position(last) >= position(sp)) continue
        if (!best || s.total < best.total) best = s
      }
      if (best) next.push({ total: best.total + cost(sp, j), path: [...best.path, sp] })
    })
    if (next.length === 0) return base
    prev = next
  }
  return prev.reduce((a, b) => (b.total < a.total ? b : a)).path
}

/** Name without octave ("Fa#", "Sib" / "F#", "Bb"); 'none' behaves like latin. */
export function pitchClassName(midi: Midi, naming: NoteNaming, key?: KeySignature | null, context?: SpellingChoice): string {
  const sp = spellPitch(midi, key, context)
  return letterName(LETTERS.indexOf(sp.step), sp.alter, naming)
}

/** "Do4", "Fa#3" (latin) or "C4", "F#3" (english), spelled according to the key when given. */
export function pitchName(midi: Midi, naming: NoteNaming, key?: KeySignature): string {
  const sp = spellPitch(midi, key)
  return letterName(LETTERS.indexOf(sp.step), sp.alter, naming) + sp.octave
}

/** Spelling of some pitch classes, as [letterIndex, alter], overriding the key's default. */
export type SpellingChoice = ReadonlyMap<number, readonly [number, number]>

/** The spelling of a written chord as a SpellingChoice (tie continuations keep their attack's letters). */
export function choiceOf(pitches: readonly Midi[], spelled: readonly SpelledPitch[]): SpellingChoice {
  const out = new Map<number, readonly [number, number]>()
  spelled.forEach((sp, i) => out.set(mod(Math.round(pitches[i]), 12), [LETTERS.indexOf(sp.step), sp.alter]))
  return out
}

/** Line-of-fifths position of each natural letter (C = 0, G = 1, F = -1 ...). */
const FIFTHS_OF_LETTER = [0, 2, 4, -1, 1, 3, 5]
const lineOfFifths = ([li, alter]: readonly [number, number]) => FIFTHS_OF_LETTER[li] + 7 * alter

/**
 * Harmonic spelling of the chromatic notes of a sounding set (a chord with whatever else sounds at
 * that moment): each chromatic pitch class may take its enharmonic neighbour spelling (G# / Ab);
 * the combination keeping the set tightest on the line of fifths wins when it is clearly tighter
 * (by 2 or more) than the key's default. So the Ab of an F minor chord in C major is Ab, and an
 * augmented C-E-G# keeps its G#. Returns undefined when nothing changes.
 */
export function harmonicSpelling(pitches: Iterable<number>, key?: KeySignature | null): SpellingChoice | undefined {
  const k = normalizeKey(key)
  const table = spellTable(k).byPc
  const sig = keySignatureAlters(k.fifths)
  const pcs = [...new Set([...pitches].map((p) => mod(Math.round(p), 12)))]
  if (pcs.length < 2) return undefined
  const fixed: number[] = []
  const chromatic: { pc: number; options: [number, number][] }[] = []
  for (const pc of pcs) {
    const [li, alter] = table[pc]
    if (alter === sig[li] || Math.abs(alter) !== 1) {
      fixed.push(lineOfFifths([li, alter]))
      continue
    }
    // The neighbour letter: a sharp becomes a flat on the letter above, a flat a sharp below.
    const nli = alter > 0 ? (li + 1) % 7 : (li + 6) % 7
    const nAlter = pc - NATURAL_PC[nli] - 12 * Math.round((pc - NATURAL_PC[nli]) / 12)
    const options: [number, number][] = [[li, alter]]
    if (Math.abs(nAlter) === 1) options.push([nli, nAlter])
    chromatic.push({ pc, options })
  }
  if (chromatic.length === 0 || chromatic.length > 4) return undefined
  const spread = (choice: number[]) => {
    let lo = Infinity
    let hi = -Infinity
    for (const f of fixed) {
      lo = Math.min(lo, f)
      hi = Math.max(hi, f)
    }
    chromatic.forEach((c, i) => {
      const f = lineOfFifths(c.options[choice[i]])
      lo = Math.min(lo, f)
      hi = Math.max(hi, f)
    })
    return hi - lo
  }
  const base = chromatic.map(() => 0)
  let best = base
  let bestSpread = spread(base)
  const baseSpread = bestSpread
  const combos = 1 << chromatic.length
  for (let mask = 1; mask < combos; mask++) {
    const choice = chromatic.map((c, i) => ((mask >> i) & 1 && c.options.length > 1 ? 1 : 0))
    const v = spread(choice)
    if (v < bestSpread) {
      bestSpread = v
      best = choice
    }
  }
  if (baseSpread - bestSpread < 2) return undefined
  const out = new Map<number, readonly [number, number]>()
  chromatic.forEach((c, i) => {
    if (best[i] === 1) out.set(c.pc, c.options[1])
  })
  return out.size ? out : undefined
}

/**
 * Engraving accidentals for one staff: the key signature plus accidentals that last until the end
 * of the bar, per letter and octave (the ABC rule abcjs follows). Call newBar() at every barline.
 */
export class AccidentalState {
  private readonly sig: number[]
  private readonly bar = new Map<number, number>()
  /** Alterations brought into the bar by notes tied over the barline (letter+octave -> alter). */
  private readonly carried = new Map<number, number>()

  constructor(key: KeySignature) {
    this.sig = keySignatureAlters(normalizeKey(key).fifths)
  }

  newBar(): void {
    this.bar.clear()
    this.carried.clear()
  }

  /**
   * Returns the alteration to print for this note (null = none) and updates the bar state.
   * The continuation of a tie prints nothing and leaves the state alone (standard engraving;
   * abcjs also takes a tied note's pitch from the first note of the tie). An accidental carried
   * over the barline by a tie does not apply to later notes of the bar: the same pitch is
   * restated, and the key-signature pitch gets a courtesy accidental.
   */
  visit(sp: SpelledPitch, tieContinuation = false): number | null {
    const li = LETTERS.indexOf(sp.step)
    const id = li * 32 + sp.octave + 8
    if (tieContinuation) {
      if (!this.bar.has(id) && sp.alter !== this.sig[li]) this.carried.set(id, sp.alter)
      return null
    }
    const current = this.bar.has(id) ? this.bar.get(id)! : this.sig[li]
    const courtesy = this.carried.has(id) && this.carried.get(id) !== sp.alter
    this.carried.delete(id)
    if (current === sp.alter && !courtesy) return null
    this.bar.set(id, sp.alter)
    return sp.alter
  }
}
