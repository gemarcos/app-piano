// Owner: engine-score. Source seconds <-> score ticks, at a constant tempo or through a beat map.
//
// Without a beat map: tick = (t - beatOffset) * 4 * bpm / 60, as always. With analysis.beatTimes (a
// tracked, possibly rubato beat map in source seconds) the position in analysis beats p(t) is
// interpolated between beats and scaled by params.bpm / analysis.bpm, so a user who halves or
// doubles "Tempo base" still gets half or twice as many score beats per tracked beat.
import type { AnalysisResult, Score } from '../../types'

export interface TimeMap {
  /** Fractional ticks (one sixteenth = 1) from the downbeat at params.beatOffset. */
  toTick(seconds: number): number
  /** Inverse of toTick. */
  toSeconds(tick: number): number
  /** True when analysis.beatTimes drives the conversion (variable tempo). */
  warped: boolean
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** A usable beat map: at least 4 finite, strictly increasing beat times. */
export function validBeatTimes(beats: unknown): beats is number[] {
  if (!Array.isArray(beats) || beats.length < 4) return false
  for (let i = 0; i < beats.length; i++) {
    if (!finite(beats[i])) return false
    if (i > 0 && !(beats[i] > beats[i - 1])) return false
  }
  return true
}

/** Mean of the first / last `n` beat periods (edge tempo for extrapolation). */
function edgePeriod(b: number[], fromEnd: boolean, n = 4): number {
  const k = Math.min(n, b.length - 1)
  return fromEnd ? (b[b.length - 1] - b[b.length - 1 - k]) / k : (b[k] - b[0]) / k
}

/** Position in beats (fractional index into the beat map) at time t. */
function beatPosition(b: number[], first: number, last: number, t: number): number {
  if (t <= b[0]) return (t - b[0]) / first
  const n = b.length - 1
  if (t >= b[n]) return n + (t - b[n]) / last
  let lo = 0
  let hi = n
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (b[mid] <= t) lo = mid
    else hi = mid
  }
  return lo + (t - b[lo]) / (b[lo + 1] - b[lo])
}

/** Inverse of beatPosition. */
function beatTime(b: number[], first: number, last: number, pos: number): number {
  const n = b.length - 1
  if (pos <= 0) return b[0] + pos * first
  if (pos >= n) return b[n] + (pos - n) * last
  const k = Math.floor(pos)
  return b[k] + (pos - k) * (b[k + 1] - b[k])
}

/**
 * Time map for `bpm` / `beatOffset` (usually the sanitized ScoreParams) and an analysis. The beat
 * map is used when the analysis has valid beatTimes and a positive bpm; otherwise the tempo is
 * constant.
 */
export function createTimeMap(p: { bpm: number; beatOffset: number }, analysis?: Pick<AnalysisResult, 'bpm' | 'beatTimes'> | null): TimeMap {
  const bpm = finite(p?.bpm) && p.bpm > 0 ? p.bpm : 100
  const offset = finite(p?.beatOffset) ? p.beatOffset : 0
  const beats = analysis?.beatTimes
  const ref = analysis?.bpm
  if (validBeatTimes(beats) && finite(ref) && ref > 0) {
    const first = edgePeriod(beats, false)
    const last = edgePeriod(beats, true)
    const zero = beatPosition(beats, first, last, offset)
    const ticksPerBeat = (4 * bpm) / ref
    return {
      warped: true,
      toTick: (t) => (beatPosition(beats, first, last, t) - zero) * ticksPerBeat,
      toSeconds: (tick) => beatTime(beats, first, last, zero + tick / ticksPerBeat),
    }
  }
  const perTick = 60 / bpm / 4
  return {
    warped: false,
    toTick: (t) => (t - offset) / perTick,
    toSeconds: (tick) => offset + tick * perTick,
  }
}

/** Time map of a built score: tick 0 = score.startSeconds (the measure shift is already included). */
function scoreMap(score: Pick<Score, 'bpm' | 'startSeconds'>, analysis?: Pick<AnalysisResult, 'bpm' | 'beatTimes'> | null): TimeMap {
  return createTimeMap({ bpm: score.bpm, beatOffset: finite(score.startSeconds) ? score.startSeconds : 0 }, analysis)
}

/**
 * Seconds in the source audio of an absolute score tick (measure.index * ticksPerMeasure +
 * event.start), following the analysis beat map when there is one ('Original' playback sync).
 * Without beatTimes it equals score.startSeconds + tickToSeconds(score, tick).
 */
export function sourceSecondsAt(score: Pick<Score, 'bpm' | 'startSeconds'>, tick: number, analysis?: Pick<AnalysisResult, 'bpm' | 'beatTimes'> | null): number {
  return scoreMap(score, analysis).toSeconds(finite(tick) ? tick : 0)
}

/** Inverse of sourceSecondsAt: the (fractional) score tick sounding at a source-audio time. */
export function tickAtSourceSeconds(score: Pick<Score, 'bpm' | 'startSeconds'>, seconds: number, analysis?: Pick<AnalysisResult, 'bpm' | 'beatTimes'> | null): number {
  return scoreMap(score, analysis).toTick(finite(seconds) ? seconds : 0)
}
