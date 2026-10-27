// Note velocities from the audio itself (pure, no tfjs). Basic Pitch's "amplitude" is a detection confidence (mean
// frame activation, ~0.3-0.6 for every note) that does not follow loudness: correlation with the true velocity on the
// realistic benchmark is ~0. Here each note's strike strength is the energy its first partials gain right after the
// onset (Goertzel at k * f0, minus what was already ringing just before it, e.g. under the pedal), in dB relative to
// the piece, mapped to 0..1. The input is peak-normalized before transcription, so velocities are relative: the
// loudest notes of a piece land near 0.7 (forte), soft accompaniment around 0.3, never below VELOCITY_FLOOR (score
// filters drop notes under 0.1). Scale fitted on the realistic benchmark (velocity MAE 0.31 -> 0.15).
import type { NoteEvent } from '../../types'

export const VELOCITY_FLOOR = 0.15
/** dB below the piece's loud reference (95th percentile) that map to the floor. */
export const VELOCITY_RANGE_DB = 26
/** Velocity of the loud reference. */
export const VELOCITY_LOUD = 0.7

const PARTIAL_WEIGHTS = [1, 0.8, 0.6, 0.45]

/** Hann-windowed Goertzel power of `samples[from, from + n)` at `hz`. */
function goertzel(samples: Float32Array, from: number, n: number, hz: number, sampleRate: number): number {
  const w = (2 * Math.PI * hz) / sampleRate
  const coeff = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  const end = Math.min(samples.length, from + n)
  const start = Math.max(0, from)
  const len = end - start
  if (len < 16) return 0
  for (let i = start; i < end; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - start)) / (len - 1))
    const s0 = samples[i] * win + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2
  return power / (len * len)
}

/**
 * Strike energy of one note (linear power), partials up to 5 kHz. `maxSeconds` stops the window before the next
 * onset of a neighbouring pitch (fast runs), never shorter than 25 ms.
 */
export function strikeEnergy(
  samples: Float32Array,
  sampleRate: number,
  pitch: number,
  start: number,
  tuningCents = 0,
  maxSeconds = Infinity,
): number {
  const f0 = 440 * 2 ** ((pitch - 69) / 12 + tuningCents / 1200)
  // At least ~5 periods for the frequency resolution of low notes, at most 90 ms (the attack, before the decay).
  const seconds = Math.max(0.025, Math.min(maxSeconds, Math.min(0.09, Math.max(0.035, 5 / f0))))
  const n = Math.round(seconds * sampleRate)
  const onset = Math.round((start + 0.004) * sampleRate)
  const pre = Math.round(Math.min(0.05, n / sampleRate) * sampleRate)
  let gained = 0
  for (let k = 1; k <= PARTIAL_WEIGHTS.length; k++) {
    const hz = k * f0
    if (hz > 5000) break
    const after = goertzel(samples, onset, n, hz, sampleRate)
    const before = goertzel(samples, onset - pre - Math.round(0.008 * sampleRate), pre, hz, sampleRate)
    gained += PARTIAL_WEIGHTS[k - 1] * Math.max(after - before, after * 0.05)
  }
  return gained
}

/**
 * Velocities (0..1) for notes found in `samples` (any rate; note times in seconds of these samples).
 * `tuningCents`: offset of the audio from A440 equal temperament (the transcriber compensates it before inference).
 */
export function estimateVelocities(notes: readonly NoteEvent[], samples: Float32Array, sampleRate: number, tuningCents = 0): number[] {
  if (!notes.length) return []
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].start - notes[b].start)
  const limit = new Array<number>(notes.length).fill(Infinity)
  order.forEach((i, k) => {
    for (let j = k + 1; j < order.length; j++) {
      const other = notes[order[j]]
      const gap = other.start - notes[i].start
      if (gap > 0.09) break
      if (gap > 0.005 && Math.abs(other.pitch - notes[i].pitch) <= 2) {
        limit[i] = gap - 0.005
        break
      }
    }
  })
  const db = notes.map((n, i) => 10 * Math.log10(strikeEnergy(samples, sampleRate, n.pitch, n.start, tuningCents, limit[i]) + 1e-12))
  const sorted = [...db].filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return notes.map(() => 0.6)
  const loud = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
  return db.map((v) => {
    const rel = Math.min(0, v - loud) / VELOCITY_RANGE_DB
    const vel = VELOCITY_LOUD + rel * (VELOCITY_LOUD - VELOCITY_FLOOR)
    return Math.round(Math.min(1, Math.max(VELOCITY_FLOOR, vel)) * 1000) / 1000
  })
}

/** Replaces each note's velocity with the audio-based estimate (keeps everything else). */
export function withVelocities(notes: NoteEvent[], samples: Float32Array, sampleRate: number, tuningCents = 0): NoteEvent[] {
  const v = estimateVelocities(notes, samples, sampleRate, tuningCents)
  return notes.map((n, i) => ({ ...n, velocity: v[i] }))
}
