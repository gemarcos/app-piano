// Pure helpers shared by the worker and tests: sensitivity -> decoder thresholds, note clean-up.
import type { NoteEvent } from '../../types'
import type { TranscribeOptions } from './index'

/** Basic Pitch output frame rate (22 050 Hz / 256-sample hop). */
export const MODEL_FPS = 22050 / 256
/** Piano range: A0 … C8 (the model's 88 bins). */
export const PIANO_MIN = 21
export const PIANO_MAX = 108

export interface DecoderParams {
  onsetThreshold: number
  frameThreshold: number
  /** outputToNotesPoly drops notes lasting <= this many frames. */
  minNoteFrames: number
  /** Frames a note may stay below frameThreshold before it ends. */
  energyTolerance: number
  inferOnsets: boolean
  melodiaTrick: boolean
  /** Same-pitch onsets closer than this many frames collapse into the strongest one (0 = off). */
  onsetNmsFrames: number
  /** Bass onsets are weaker: their effective onset threshold is lowered by up to this fraction (see bassOnsetScale). */
  bassOnsetBonus: number
}

/**
 * Threshold anchors at sensitivity 0, 0.5 and 1 (linear in between), calibrated with
 * scripts/fixtures/check-transcription.mjs on the synthetic and real-piano fixtures, clean and "room":
 * 0.5 is the best mean F1 (onset 0.70 / frame 0.30); the F1 plateau is flat around it (0.65–0.725 / 0.25–0.325).
 * 0 keeps only confident notes, 1 roughly doubles the note count (soft playing, quiet or distant recordings).
 */
export const ONSET_ANCHORS: [number, number, number] = [0.85, 0.7, 0.45]
export const FRAME_ANCHORS: [number, number, number] = [0.4, 0.3, 0.2]
export const DEFAULT_ENERGY_TOLERANCE = 11
/** ±5 frames (58 ms): faster than any same-key repetition on a piano. */
export const ONSET_NMS_FRAMES = 5
/** Bass bonus: the onset threshold is 15 % lower up to E2 (MIDI 40), easing back to normal at E3 (52). */
export const BASS_ONSET_BONUS = 0.15
export const BASS_FULL_BONUS_MAX = 40
export const BASS_NO_BONUS_MIN = 52

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5
}

/** Piecewise-linear interpolation through anchors at 0, 0.5 and 1. */
export function interpolateAnchors(anchors: readonly [number, number, number], t: number): number {
  const s = clamp01(t)
  return s <= 0.5 ? anchors[0] + (anchors[1] - anchors[0]) * (s / 0.5) : anchors[1] + (anchors[2] - anchors[1]) * ((s - 0.5) / 0.5)
}

/** Minimum duration in frames for outputToNotesPoly (which keeps notes strictly longer than it). */
export function minNoteFrames(minNoteMs: number): number {
  const ms = Number.isFinite(minNoteMs) ? Math.max(0, minNoteMs) : 90
  return Math.max(1, Math.round((ms / 1000) * MODEL_FPS) - 1)
}

/**
 * The "melodia" pass (notes from sustained energy without an onset) stays off at every sensitivity:
 * on piano it mostly adds overtones (mean F1 0.83 -> 0.72 at sensitivity 1 on the fixtures).
 */
export function decoderParams(opts: TranscribeOptions): DecoderParams {
  return {
    onsetThreshold: interpolateAnchors(ONSET_ANCHORS, opts.sensitivity),
    frameThreshold: interpolateAnchors(FRAME_ANCHORS, opts.sensitivity),
    minNoteFrames: minNoteFrames(opts.minNoteMs),
    energyTolerance: DEFAULT_ENERGY_TOLERANCE,
    inferOnsets: true,
    melodiaTrick: false,
    onsetNmsFrames: ONSET_NMS_FRAMES,
    bassOnsetBonus: BASS_ONSET_BONUS,
  }
}

/**
 * Per-bin onset multipliers (88 bins, A0 first) that lower the effective onset threshold of bass notes by `bonus`:
 * full bonus up to BASS_FULL_BONUS_MAX, none from BASS_NO_BONUS_MIN, linear in between.
 * Multiplying an onset by 1 / (1 - b) is the same as comparing it with threshold * (1 - b).
 */
export function bassOnsetScale(bonus: number): Float64Array {
  const b = Number.isFinite(bonus) ? Math.min(0.9, Math.max(0, bonus)) : 0
  const scale = new Float64Array(PIANO_MAX - PIANO_MIN + 1)
  for (let i = 0; i < scale.length; i++) {
    const pitch = PIANO_MIN + i
    const t =
      pitch <= BASS_FULL_BONUS_MAX ? 1 : pitch >= BASS_NO_BONUS_MIN ? 0 : (BASS_NO_BONUS_MIN - pitch) / (BASS_NO_BONUS_MIN - BASS_FULL_BONUS_MAX)
    scale[i] = 1 / (1 - b * t)
  }
  return scale
}

/** Shape of basic-pitch's NoteEventTime. */
export interface TimedNote {
  startTimeSeconds: number
  durationSeconds: number
  pitchMidi: number
  amplitude: number
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** Multiplies note times by `scale` (tuning compensation stretched the audio by 1 / scale), rounded to ms. */
export function scaleNoteTimes(notes: NoteEvent[], scale: number): NoteEvent[] {
  if (!(scale > 0) || Math.abs(scale - 1) < 1e-9) return notes
  return notes.map((n) => ({ ...n, start: round3(n.start * scale), duration: Math.max(0.001, round3(n.duration * scale)) }))
}

/** Piano range only, velocity clamped to 0..1, times rounded to ms, sorted by start then pitch. */
export function finalizeNotes(raw: readonly TimedNote[]): NoteEvent[] {
  const out: NoteEvent[] = []
  for (const n of raw) {
    const pitch = Math.round(n.pitchMidi)
    if (!(pitch >= PIANO_MIN && pitch <= PIANO_MAX)) continue
    if (!Number.isFinite(n.startTimeSeconds) || !(n.durationSeconds > 0)) continue
    out.push({
      pitch,
      start: Math.max(0, round3(n.startTimeSeconds)),
      duration: Math.max(0.001, round3(n.durationSeconds)),
      velocity: Number.isFinite(n.amplitude) ? Math.min(1, Math.max(0, n.amplitude)) : 0,
    })
  }
  out.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  return out
}

/**
 * Piano model (Onsets and Frames) onset threshold at sensitivity 0, 0.5 and 1. On a real recording (the client's
 * Liebestraum No. 3, test/fixtures/local) 0.35 finds far more of the soft and re-struck notes than Magenta's 0.5
 * (F1 at +-50 ms 0.60 -> 0.67, at +-100 ms 0.75 -> 0.80) and costs nothing on the realistic benchmark as long as
 * notes under ~90 ms are dropped (0.937 -> 0.938). 0.6 keeps only confident notes, 0.2 adds the faintest ones.
 * The frame threshold only changes durations (never which notes exist), so it stays at Magenta's 0.5.
 */
export const PIANO_ONSET_ANCHORS: [number, number, number] = [0.6, 0.35, 0.2]
export const PIANO_FRAME_THRESHOLD = 0.5

export interface PianoDecoderParams {
  onsetThreshold: number
  frameThreshold: number
  /** Seconds: shorter notes are dropped. */
  minDuration: number
}

/** Shortest note the piano model keeps (seconds) for a minNoteMs setting: the same value (frames are 32 ms long). */
export function pianoMinDuration(minNoteMs: number): number {
  const ms = Number.isFinite(minNoteMs) ? Math.max(0, minNoteMs) : 90
  return ms / 1000
}

export function pianoDecoderParams(opts: TranscribeOptions): PianoDecoderParams {
  return {
    onsetThreshold: interpolateAnchors(PIANO_ONSET_ANCHORS, opts.sensitivity),
    frameThreshold: PIANO_FRAME_THRESHOLD,
    minDuration: pianoMinDuration(opts.minNoteMs),
  }
}
