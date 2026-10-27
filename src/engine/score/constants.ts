// Owner: engine-score. Shared constants and meter helpers (pure, no DOM).
import type { Difficulty, TimeSignature } from '../../types'

/** 1 tick = one sixteenth note. */
export const TICKS_PER_QUARTER = 4

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

/** Notatable durations in ticks: 16th, 8th, dotted 8th, quarter, dotted quarter, half, dotted half, whole. */
export const NOTE_VALUES: readonly number[] = [1, 2, 3, 4, 6, 8, 12, 16]

export function isTimeSignature(value: unknown): value is TimeSignature {
  return value === '4/4' || value === '3/4' || value === '2/4' || value === '6/8'
}

/** Ticks in one measure: 4/4 = 16, 3/4 = 12, 2/4 = 8, 6/8 = 12. */
export function ticksPerMeasureOf(ts: TimeSignature): number {
  switch (ts) {
    case '3/4':
    case '6/8':
      return 12
    case '2/4':
      return 8
    default:
      return 16
  }
}

/** Ticks per felt beat: a quarter in simple meters, a dotted quarter in 6/8. */
export function beatTicksOf(ts: TimeSignature): number {
  return ts === '6/8' ? 6 : 4
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
