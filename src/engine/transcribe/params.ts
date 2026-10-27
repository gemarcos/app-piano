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
}

/**
 * Threshold anchors at sensitivity 0, 0.5 and 1 (linear in between).
 * The 0.5 point is the best mean F1 on test/fixtures, clean and "room" variants
 * (scripts/fixtures/check-transcription.mjs --sweep); higher sensitivity lowers both thresholds.
 */
export const ONSET_ANCHORS: [number, number, number] = [0.9, 0.75, 0.35]
export const FRAME_ANCHORS: [number, number, number] = [0.35, 0.25, 0.15]
export const DEFAULT_ENERGY_TOLERANCE = 11
/**
 * Above this sensitivity, the "melodia" pass also adds notes found from sustained energy without a clear
 * onset (soft or legato playing). Below it, that pass mostly adds overtones, so it stays off.
 */
export const MELODIA_FROM_SENSITIVITY = 0.8

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

export function decoderParams(opts: TranscribeOptions): DecoderParams {
  return {
    onsetThreshold: interpolateAnchors(ONSET_ANCHORS, opts.sensitivity),
    frameThreshold: interpolateAnchors(FRAME_ANCHORS, opts.sensitivity),
    minNoteFrames: minNoteFrames(opts.minNoteMs),
    energyTolerance: DEFAULT_ENERGY_TOLERANCE,
    inferOnsets: true,
    melodiaTrick: clamp01(opts.sensitivity) > MELODIA_FROM_SENSITIVITY,
  }
}

/** Shape of basic-pitch's NoteEventTime. */
export interface TimedNote {
  startTimeSeconds: number
  durationSeconds: number
  pitchMidi: number
  amplitude: number
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

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
