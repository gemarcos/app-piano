// Owner: engine-score. Shared constants and meter helpers (pure, no DOM).
import type { Difficulty, TimeSignature } from '../../types'

/**
 * Ticks per quarter note: 12, so straight sixteenths (3 ticks), eighth triplets (4) and sixteenth
 * triplets / sextuplets (2) all fall on whole ticks. (Until 2026-10-27 a tick was a sixteenth.)
 */
export const TICKS_PER_QUARTER = 12
/** One straight sixteenth in ticks. */
export const SIXTEENTH = TICKS_PER_QUARTER / 4

/** Meters offered by the UI. 6/8 is only ever chosen by the user (never auto-detected). */
export const TIME_SIGNATURES: readonly TimeSignature[] = ['4/4', '3/4', '2/4', '6/8']

/** Labels for ScoreStats.difficulty / ScoreSummary.difficulty. */
export const DIFFICULTY_LABELS: Readonly<Record<1 | 2 | 3, string>> = { 1: 'Fácil', 2: 'Media', 3: 'Difícil' }

/** Labels for ScoreParams.difficulty (the simplification mode). */
export const DIFFICULTY_PARAM_LABELS: Readonly<Record<Difficulty, string>> = {
  original: 'Original',
  intermedio: 'Intermedio',
  facil: 'Fácil',
}

/** Notatable straight durations in ticks: 16th, 8th, dotted 8th, quarter, dotted quarter, half, dotted half, whole. */
export const NOTE_VALUES: readonly number[] = [1, 2, 3, 4, 6, 8, 12, 16].map((v) => v * SIXTEENTH)
/** Durations inside a triplet beat, in ticks (sixteenth-triplet units of 2 ticks: 1, 2, 3, 4 or 6 units). */
export const TUPLET_VALUES: readonly number[] = [2, 4, 6, 8, 12]

export function isTimeSignature(value: unknown): value is TimeSignature {
  return value === '4/4' || value === '3/4' || value === '2/4' || value === '6/8'
}

/** Ticks in one measure: 4/4 = 16, 3/4 = 12, 2/4 = 8, 6/8 = 12. */
export function ticksPerMeasureOf(ts: TimeSignature): number {
  switch (ts) {
    case '3/4':
    case '6/8':
      return 12 * SIXTEENTH
    case '2/4':
      return 8 * SIXTEENTH
    default:
      return 16 * SIXTEENTH
  }
}

/** Ticks per felt beat: a quarter in simple meters, a dotted quarter in 6/8. */
export function beatTicksOf(ts: TimeSignature): number {
  return (ts === '6/8' ? 6 : 4) * SIXTEENTH
}

/** [numerator, denominator] of the meter. */
export function meterParts(ts: TimeSignature): [number, number] {
  switch (ts) {
    case '3/4':
      return [3, 4]
    case '2/4':
      return [2, 4]
    case '6/8':
      return [6, 8]
    default:
      return [4, 4]
  }
}
