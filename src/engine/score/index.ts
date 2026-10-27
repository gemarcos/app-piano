// Owner: engine-score. Public API — pure TypeScript, no DOM. Import the score engine only from here.
//
// Pipeline: analyzeNotes(notes) -> defaultParams(analysis, settings) -> buildScore(notes, params,
// analysis, title) -> scoreToAbc / scoreToMusicXml / scoreToMidi. buildScore never throws and is
// fast enough to run on every filter change (< 30 ms for 3 000 notes).

/** 1 tick = one sixteenth note. */
export {
  TICKS_PER_QUARTER,
  TIME_SIGNATURES,
  DIFFICULTY_LABELS,
  DIFFICULTY_PARAM_LABELS,
  NOTE_VALUES,
  ticksPerMeasureOf,
  beatTicksOf,
  meterParts,
  isTimeSignature,
} from './constants'

/** Tempo (with beat phase), key and meter estimation from raw notes. Must not throw on empty input. */
export { analyzeNotes, emptyAnalysis } from './analysis'

/**
 * defaultParams: initial params for a new transcription, from its analysis and the user's defaults.
 * buildScore: filters, transposes, quantizes, splits hands and simplifies raw notes into a
 * grand-staff Score. Fast (< 30 ms / 3k notes).
 * summarizeScore: denormalized summary for the library item.
 * tickToSeconds / secondsToTick / measureDurationSeconds: score time (tick 0 = 0 s); add
 * score.startSeconds to address the source audio.
 */
export {
  defaultParams,
  buildScore,
  sanitizeParams,
  summarizeScore,
  tickToSeconds,
  secondsToTick,
  secondsPerTick,
  measureDurationSeconds,
} from './build'

/** ABC notation for abcjs (grand staff, L:1/16, correct key-aware accidentals, ties across barlines). */
export { scoreToAbc } from './abc'
export type { AbcOptions } from './abc'

/** MusicXML 4.0 partwise document (one piano part, two staves). */
export { scoreToMusicXml } from './musicxml'

/** Standard MIDI file bytes (one track per hand). */
export { scoreToMidi, MIDI_TRACK_NAMES } from './midi'

/**
 * keyName: "Sol mayor", "Mi menor" (latin/none) or "G mayor", "E menor" (english).
 * transposeKey: transposes a key signature by semitones, choosing the simpler enharmonic spelling.
 * allKeys: all 24 keys (for the key picker), ordered by circle of fifths (majors, then minors).
 */
export { keyName, transposeKey, allKeys, keyFromPc, keyFromFifths, normalizeKey, tonicPc } from './keys'

/**
 * pitchName: "Do4", "Fa#3" (latin) or "C4", "F#3" (english), spelled according to the key when given.
 * spellPitch: { step, alter, octave } for engraving.
 */
export { pitchName, pitchClassName, spellPitch } from './spelling'
export type { SpelledPitch } from './spelling'

/** Notatable pieces of a span inside one measure (used by the Score model; exposed for tests/tools). */
export { splitDuration } from './durations'
