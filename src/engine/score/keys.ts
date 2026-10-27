// Owner: engine-score. Key signatures: circle of fifths, naming, transposition.
import type { KeyMode, KeySignature, NoteNaming } from '../../types'

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'

export const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
/** Pitch class of each natural letter. */
export const NATURAL_PC: readonly number[] = [0, 2, 4, 5, 7, 9, 11]
const LATIN: readonly string[] = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si']
/** Letter indices in the order sharps / flats are added to a key signature. */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6] // F C G D A E B
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3] // B E A D G C F

export const mod = (n: number, m: number): number => ((n % m) + m) % m

/** Alteration (-1, 0, +1) that the key signature applies to each letter (index 0 = C). */
export function keySignatureAlters(fifths: number): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0]
  const n = Math.min(7, Math.abs(fifths))
  for (let i = 0; i < n; i++) {
    if (fifths > 0) out[SHARP_ORDER[i]] = 1
    else out[FLAT_ORDER[i]] = -1
  }
  return out
}

/** Letter index of the tonic of a key with this many fifths. */
export function tonicLetterIndex(fifths: number, mode: KeyMode): number {
  return mod((mode === 'minor' ? 5 : 0) + 4 * fifths, 7)
}

/** Pitch class (0 = C) of the tonic. */
export function tonicPc(key: KeySignature): number {
  const k = normalizeKey(key)
  return mod((k.mode === 'minor' ? 9 : 0) + 7 * k.fifths, 12)
}

export function accidentalText(alter: number): string {
  if (alter > 0) return '#'.repeat(alter)
  if (alter < 0) return 'b'.repeat(-alter)
  return ''
}

/** Builds the KeySignature for a circle-of-fifths position (-7..7). */
export function keyFromFifths(fifths: number, mode: KeyMode): KeySignature {
  const f = Math.max(-7, Math.min(7, Math.round(Number.isFinite(fifths) ? fifths : 0)))
  const li = tonicLetterIndex(f, mode)
  const alter = keySignatureAlters(f)[li]
  return { tonic: LETTERS[li] + accidentalText(alter), mode, fifths: f }
}

/**
 * Key with the given tonic pitch class, spelled with the fewest accidentals.
 * The only ties are 6 sharps vs 6 flats: `prefer` decides; by default F# major and Eb minor.
 */
export function keyFromPc(pc: number, mode: KeyMode, prefer?: 'sharp' | 'flat'): KeySignature {
  const base = mode === 'minor' ? 9 : 0
  // 7 is its own inverse mod 12, so fifths = 7 * (pc - base) (mod 12).
  const r = mod(7 * (pc - base), 12) // 0..11
  const a = r // sharps side
  const b = r - 12 // flats side
  let fifths: number
  if (Math.abs(a) < Math.abs(b)) fifths = a
  else if (Math.abs(b) < Math.abs(a)) fifths = b
  else fifths = (prefer ?? (mode === 'minor' ? 'flat' : 'sharp')) === 'sharp' ? a : b
  return keyFromFifths(fifths, mode)
}

/** Parses 'F#', 'Bb', 'c' ... into a pitch class, or null. */
function parseTonic(tonic: unknown): number | null {
  if (typeof tonic !== 'string') return null
  const m = /^\s*([A-Ga-g])([#b]{0,2})\s*$/.exec(tonic)
  if (!m) return null
  const li = LETTERS.indexOf(m[1].toUpperCase() as Letter)
  let alter = 0
  for (const ch of m[2]) alter += ch === '#' ? 1 : -1
  return mod(NATURAL_PC[li] + alter, 12)
}

/**
 * Sanitizes a key coming from storage or user input. `fifths` + `mode` are authoritative; the tonic
 * string is only used when `fifths` is missing. Falls back to C major.
 */
export function normalizeKey(key: KeySignature | null | undefined): KeySignature {
  if (!key || typeof key !== 'object') return keyFromFifths(0, 'major')
  const mode: KeyMode = key.mode === 'minor' ? 'minor' : 'major'
  if (typeof key.fifths === 'number' && Number.isFinite(key.fifths) && Math.abs(key.fifths) <= 7) {
    const k = keyFromFifths(key.fifths, mode)
    if (k.tonic === key.tonic && k.fifths === key.fifths && key.mode === mode) return key
    return k
  }
  const pc = parseTonic(key.tonic)
  return pc === null ? keyFromFifths(0, mode) : keyFromPc(pc, mode)
}

/** Transposes a key signature by semitones, choosing the simpler enharmonic spelling. */
export function transposeKey(key: KeySignature, semitones: number): KeySignature {
  const k = normalizeKey(key)
  const s = mod(Math.round(Number.isFinite(semitones) ? semitones : 0), 12)
  if (s === 0) return { ...k }
  const prefer = k.fifths < 0 ? 'flat' : k.fifths > 0 ? 'sharp' : undefined
  return keyFromPc(mod(tonicPc(k) + s, 12), k.mode, prefer)
}

/**
 * All 24 keys for the key picker, by circle of fifths: majors Db … F# (-5..+6), then minors
 * Eb … G# (-6..+5). Each tonic appears once, with its most common spelling.
 */
export function allKeys(): KeySignature[] {
  const out: KeySignature[] = []
  for (let f = -5; f <= 6; f++) out.push(keyFromFifths(f, 'major'))
  for (let f = -6; f <= 5; f++) out.push(keyFromFifths(f, 'minor'))
  return out
}

/** Note name of a letter + alteration: 'Fa#', 'Sib' (latin) or 'F#', 'Bb' (english). 'none' = latin. */
export function letterName(letterIndex: number, alter: number, naming: NoteNaming): string {
  const base = naming === 'english' ? LETTERS[letterIndex] : LATIN[letterIndex]
  return base + accidentalText(alter)
}

/** "Sol mayor", "Mi menor" (latin/none) or "G mayor", "E menor" (english). */
export function keyName(key: KeySignature, naming: NoteNaming): string {
  const k = normalizeKey(key)
  const li = tonicLetterIndex(k.fifths, k.mode)
  const alter = keySignatureAlters(k.fifths)[li]
  return `${letterName(li, alter, naming)} ${k.mode === 'minor' ? 'menor' : 'mayor'}`
}

/** ABC key field value: 'G', 'Em', 'Bb', 'F#m'. */
export function abcKey(key: KeySignature): string {
  const k = normalizeKey(key)
  return k.tonic + (k.mode === 'minor' ? 'm' : '')
}
