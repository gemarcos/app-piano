/** Shared domain types. Extend by adding fields; never rename or remove. */

/** MIDI note number (A0 = 21 … middle C = 60 … C8 = 108). */
export type Midi = number

/** One note detected by the transcription model, in seconds of the source audio. */
export interface NoteEvent {
  pitch: Midi
  start: number
  duration: number
  /** Model amplitude, 0..1. */
  velocity: number
}

export type TimeSignature = '2/4' | '3/4' | '4/4' | '6/8'
/** Quantization grid: 8 = eighth notes, 16 = sixteenth notes. */
export type QuantizeGrid = 8 | 16
export type Difficulty = 'original' | 'intermedio' | 'facil'
export type Hands = 'both' | 'right' | 'left'
/** How note names are shown: none, Latin solfège (Do Re Mi) or English letters (C D E). */
export type NoteNaming = 'none' | 'latin' | 'english'
export type KeyMode = 'major' | 'minor'

export interface KeySignature {
  /** Tonic spelled with English letters and accidental: 'C', 'F#', 'Bb'. */
  tonic: string
  mode: KeyMode
  /** Circle-of-fifths position: -7 (7 flats) … +7 (7 sharps). */
  fifths: number
}

/** Automatic analysis of a raw transcription. */
export interface AnalysisResult {
  /** Quarter-note tempo. */
  bpm: number
  bpmConfidence: number
  /** Seconds in the source audio where the first downbeat falls. */
  beatOffset: number
  timeSignature: TimeSignature
  key: KeySignature
  keyConfidence: number
  /** Optional beat map: seconds in the source audio of each beat (variable tempo). Absent = constant bpm from beatOffset. */
  beatTimes?: number[]
}

/** Everything that turns NoteEvent[] into notation. Stored per score, editable in the viewer. */
export interface ScoreParams {
  bpm: number
  beatOffset: number
  timeSignature: TimeSignature
  /** null = use the analysed key (automatic). */
  key: KeySignature | null
  quantize: QuantizeGrid
  /** Notes with pitch >= splitPoint go to the right hand (treble staff). */
  splitPoint: Midi
  difficulty: Difficulty
  /** Semitones, -12..12. */
  transpose: number
  /** Filters applied to raw notes before quantization. */
  minVelocity: number
  /** Seconds. */
  minDuration: number
  pitchRange: [Midi, Midi]
  /** Max simultaneous notes per hand, 1..6. */
  maxPolyphony: number
  /** Hand separation: 'auto' follows the music (splitPoint is only a soft centre); 'fixed' or absent = pitch >= splitPoint goes right. */
  splitMode?: 'auto' | 'fixed'
}

/* ---------- Notation model (output of engine/score) ---------- */

/** A chord (or rest when pitches is empty). Times in ticks (TICKS_PER_QUARTER = 12: a sixteenth is 3 ticks, a sixteenth triplet 2). */
export interface ScoreEvent {
  /** Ticks from the start of its measure. */
  start: number
  duration: number
  pitches: Midi[]
  /** Loudness 0..1 per pitch (same order as `pitches`), from the raw notes. Absent = unknown (play at a default). */
  velocities?: number[]
  /** Ticks each key sounds without pedal, per pitch, when longer than the written (articulated) duration. Absent = the written duration. */
  sounding?: number[]
  /** All pitches are tied into the next event of the same staff. */
  tie?: boolean
}

export interface Measure {
  index: number
  events: ScoreEvent[]
}

export interface Staff {
  hand: 'right' | 'left'
  clef: 'treble' | 'bass'
  /** First (upper) voice: tiles every measure; the viewer's timeline follows it. */
  measures: Measure[]
  /** Optional second (lower) voice on the same staff, same length as `measures`; its rests are invisible. */
  voice2?: Measure[]
}

export interface ScoreStats {
  noteCount: number
  maxPolyphony: number
  range: [Midi, Midi] | null
  notesPerSecond: number
  /** 1 = fácil, 2 = media, 3 = difícil. */
  difficulty: 1 | 2 | 3
}

export interface Score {
  title: string
  bpm: number
  timeSignature: TimeSignature
  /** Key after transposition. */
  key: KeySignature
  ticksPerMeasure: number
  measureCount: number
  durationSeconds: number
  /** Seconds in the source audio where tick 0 of measure 0 falls (for syncing the original audio). */
  startSeconds: number
  /** [right hand / treble, left hand / bass] — both always present, possibly with only rests. */
  staves: [Staff, Staff]
  stats: ScoreStats
  /** Sustain (damper) pedal spans inferred from the audio, in absolute ticks, sorted and non-overlapping. Absent = no pedal. */
  pedals?: PedalSpan[]
}

/** Damper pedal held down from `start` to `end` (absolute ticks: measure.index * ticksPerMeasure + event start). */
export interface PedalSpan {
  start: number
  end: number
}

/** Denormalized summary stored on each library item (for listing, filtering and sorting). */
export interface ScoreSummary {
  key: KeySignature
  bpm: number
  timeSignature: TimeSignature
  difficulty: 1 | 2 | 3
  noteCount: number
  measureCount: number
}

/* ---------- Library ---------- */

export type ScoreSource = 'mic' | 'tab' | 'file' | 'demo' | 'import'

export interface ScoreDoc {
  id: string
  title: string
  composer?: string
  createdAt: number
  updatedAt: number
  openedAt?: number
  source: ScoreSource
  /** Original file name, when imported. */
  sourceName?: string
  sourceKind?: 'audio' | 'video'
  /** Seconds of transcribed audio. */
  durationSec: number
  /** Image id from src/assets/images.ts. */
  coverId: string
  favorite: boolean
  /** Raw transcription; the viewer rebuilds the score from these. */
  notes: NoteEvent[]
  analysis: AnalysisResult
  params: ScoreParams
  summary: ScoreSummary
  /** Reference into the audio table (original recording / trimmed file audio). */
  audioId?: string
}

export interface AudioDoc {
  id: string
  blob: Blob
  mime: string
  createdAt: number
}

/* ---------- Settings ---------- */

export type ThemePreference = 'system' | 'light' | 'dark'

export interface Settings {
  theme: ThemePreference
  reduceMotion: boolean
  noteNaming: NoteNaming
  /** Transcription sensitivity 0..1 (higher = more notes detected). */
  sensitivity: number
  /** Shortest note kept by the model, in milliseconds. */
  minNoteMs: number
  quantize: QuantizeGrid
  splitPoint: Midi
  defaultDifficulty: Difficulty
  /** Maximum microphone / tab recording length, seconds. */
  maxRecordSec: number
  /** Keep the original audio with each transcription (enables "Original" playback). */
  keepOriginalAudio: boolean
  metronome: boolean
  countIn: boolean
  followScore: boolean
  /** 0..1 */
  playbackVolume: number
  /** Play the sustain pedal inferred from the audio (and show its marks in the score). */
  sustainPedal: boolean
  /** Transcription model: 'auto' = piano model (Transkun, WebGPU) when the device can run it, else 'fast' (Basic Pitch). */
  transcriptionModel: TranscriptionModel
  /** Viewer playback timbre: 'grand' (Salamander grand piano) or 'classic' (the FluidR3 piano of the first version). */
  pianoSound: 'grand' | 'classic'
  /** Interface sound effects (synthesized taps, toggles, chimes). Never while recording or playing a score. */
  uiSounds: boolean
}

export type TranscriptionModel = 'auto' | 'piano' | 'fast'
