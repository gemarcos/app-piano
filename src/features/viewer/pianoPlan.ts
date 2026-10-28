// Owner: piano-sound. Pure playback planning, no Web Audio (unit tested in pianoPlan.test.ts):
// the notes of a Score in seconds, how loud each one is played, when the dampers stop it (key
// release, sustain pedal lift, re-strike of the same key) and the metronome clicks.
// Times are "score seconds": seconds at 100 % speed from tick 0 of measure 0.
import type { Hands, PedalSpan, Score, TimeSignature } from '../../types'
import { beatTicksOf, scoreNotes, secondsPerTick } from '../../engine/score'

/** A note as written (ties merged), in score seconds. */
export interface PlayNote {
  pitch: number
  start: number
  /** Key release. */
  end: number
  /** Loudness 0..1 from the score (ScoreEvent.velocities; the engine's default when it had none). */
  velocity?: number
  /** 0 = right hand (treble staff), 1 = left hand. */
  staff: 0 | 1
  /** Metric weight of the onset: 1 downbeat, 0.5 other beats, 0 elsewhere. */
  accent: number
}

/** One sounding piano voice. */
export interface Voice {
  pitch: number
  /** Onset, score seconds. */
  start: number
  /** When the damper stops it (key release, pedal lift or re-strike); Infinity = no damper, rings out. */
  release: number
  /** Time constant of the damping at `release`, seconds. */
  tau: number
  /** Dynamic level 0..1 (0.55 = mezzo forte): loudness. */
  dynamic: number
  /** The note's own velocity from the score, when known (picks the tone: how hard the key was struck). */
  velocity?: number
}

/** A metronome click; count-in clicks have negative times (the bar before tick 0). */
export interface Click {
  time: number
  accent: boolean
}

export const PLAY_RANGE: readonly [number, number] = [21, 108]
/** Notes from F#6 up have no dampers on a grand piano: they ring until they fade. */
export const NO_DAMPER_FROM = 90
/** Damping time constant when a sounding key is struck again. */
export const TAU_RESTRIKE = 0.03
/** Shortest note we let sound (a written note is never shorter, but merged ties may be). */
const MIN_NOTE = 0.03
const EPS = 1e-6

/** Damper time constant after a key release: slow in the bass, quick in the treble. */
export function tauKey(pitch: number): number {
  if (pitch <= 21) return 0.22
  if (pitch <= 60) return 0.22 + ((pitch - 21) / 39) * (0.11 - 0.22)
  if (pitch <= 88) return 0.11 + ((pitch - 60) / 28) * (0.065 - 0.11)
  return 0.065
}

/** Damper time constant when the pedal lifts (all dampers fall at once, a little softer). */
export const tauPedal = (pitch: number) => tauKey(pitch) * 1.25

/* ---------------- Score -> notes ---------------- */

/**
 * The notes of `score` (the hands asked for) in score seconds, sorted by onset then pitch: exactly
 * the engine's scoreNotes (both staves, both voices, ties merged, each note with its own start,
 * length and velocity, overlaps allowed), with the metric weight of each onset. Pitches outside the
 * piano are dropped.
 */
export function playNotes(score: Score, hands: Hands = 'both'): PlayNote[] {
  const spt = secondsPerTick(score)
  const tpm = score.ticksPerMeasure
  const beat = beatTicksOf(score.timeSignature)
  const out: PlayNote[] = []
  for (const n of scoreNotes(score)) {
    if ((hands === 'right' && n.staff === 1) || (hands === 'left' && n.staff === 0)) continue
    if (n.pitch < PLAY_RANGE[0] || n.pitch > PLAY_RANGE[1] || !(n.ticks > 0)) continue
    const inBar = ((n.tick % tpm) + tpm) % tpm
    const note: PlayNote = {
      pitch: n.pitch,
      start: n.tick * spt,
      // Notation is articulated; a key that sounded longer without pedal is held that long.
      end: (n.tick + Math.max(n.ticks, n.sounding ?? 0)) * spt,
      staff: n.staff,
      accent: inBar === 0 ? 1 : inBar % beat === 0 ? 0.5 : 0,
    }
    if (Number.isFinite(n.velocity)) note.velocity = Math.min(1, Math.max(0, n.velocity))
    out.push(note)
  }
  return out.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}

/** Damper pedal spans of a score in score seconds (sorted, non-overlapping). */
export function pedalSeconds(score: Pick<Score, 'bpm' | 'pedals'>): [number, number][] {
  const spt = secondsPerTick(score)
  return (score.pedals ?? [])
    .filter((p: PedalSpan) => Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start)
    .map((p): [number, number] => [p.start * spt, p.end * spt])
    .sort((a, b) => a[0] - b[0])
}

/* ---------------- Dynamics ---------------- */

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]

/**
 * Dynamic level per note (0..1, 0.55 = mezzo forte).
 * With velocities from the score: half the velocity itself (transcriptions now give loudness within
 * the piece: soft accompaniment ~0.3, forte ~0.7) and half the piece's own spread mapped around mezzo
 * forte (robust for older items whose velocities were model confidences, and for the demos). Without
 * them, or when they are all the same (the engine's default for scores without velocities), a
 * pianist's default voicing: the melody (top note of the right hand) sings above the accompaniment,
 * inner voices recede, downbeats lean a little.
 */
export function noteDynamics(notes: readonly PlayNote[]): number[] {
  const known = notes.map((n) => n.velocity).filter((v): v is number => v !== undefined)
  if (known.length >= Math.max(1, notes.length * 0.5)) {
    const sorted = [...known].sort((a, b) => a - b)
    const lo = quantile(sorted, 0.1)
    const hi = quantile(sorted, 0.9)
    const med = quantile(sorted, 0.5)
    const spread = hi - lo
    if (spread >= 0.03)
      return notes.map((n) => {
        if (n.velocity === undefined) return 0.56
        const relative = 0.56 + (0.4 * (n.velocity - med)) / spread
        return Math.min(0.97, Math.max(0.15, 0.5 * n.velocity + 0.5 * relative))
      })
  }
  return voicedDynamics(notes)
}

/** The default voicing (see noteDynamics), per onset group of each staff. */
function voicedDynamics(notes: readonly PlayNote[]): number[] {
  const out = new Array<number>(notes.length)
  let i = 0
  while (i < notes.length) {
    let j = i
    while (j < notes.length && notes[j].start - notes[i].start < 1e-4) j++
    for (const staff of [0, 1] as const) {
      const group: number[] = []
      for (let k = i; k < j; k++) if (notes[k].staff === staff) group.push(k)
      if (!group.length) continue
      const pitches = group.map((k) => notes[k].pitch)
      const top = Math.max(...pitches)
      const bottom = Math.min(...pitches)
      for (const k of group) {
        const n = notes[k]
        let d = staff === 0 ? 0.56 : 0.48
        if (staff === 0) d += n.pitch === top ? 0.07 : -0.03
        else d += group.length === 1 || n.pitch === bottom ? 0.02 : -0.04
        out[k] = d + 0.06 * n.accent
      }
    }
    i = j
  }
  return out
}

/* ---------------- Dampers: key, pedal, re-strike ---------------- */

/**
 * The pedal span that catches a key released at time t: start < t <= end, or null. A key released
 * exactly when the pedal goes down is not caught, and at a pedal change (a span ending where the next
 * starts) a key released at the change is damped there: the dampers fall at the change, and the new
 * span only sustains the keys still held (or struck) at that moment.
 */
function pedalAt(pedals: readonly (readonly [number, number])[], t: number): readonly [number, number] | null {
  let lo = 0
  let hi = pedals.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const p = pedals[mid]
    if (t <= p[0] + EPS) hi = mid - 1
    else if (t > p[1] + EPS) lo = mid + 1
    else return p
  }
  return null
}

/**
 * Voices for the notes: a note's dampers act at its key release, or, when the sustain pedal is down
 * then, when the pedal lifts. A key struck again while still sounding damps the earlier strike at the
 * new onset (and when two voices share a key, it stays down until the later of their releases).
 */
export function planVoices(notes: readonly PlayNote[], dynamics: readonly number[], pedals: readonly (readonly [number, number])[] = []): Voice[] {
  interface Work extends Voice {
    keyUp: number
  }
  const voices: Work[] = notes.map((n, i) => ({
    pitch: n.pitch,
    start: n.start,
    keyUp: Math.max(n.end, n.start + MIN_NOTE),
    release: 0,
    tau: 0,
    dynamic: dynamics[i] ?? 0.55,
    velocity: n.velocity,
  }))
  const byPitch = new Map<number, Work[]>()
  for (const v of [...voices].sort((a, b) => a.start - b.start)) {
    const list = byPitch.get(v.pitch)
    if (list) list.push(v)
    else byPitch.set(v.pitch, [v])
  }
  // Two voices on one key: the key stays down until the later release.
  for (const list of byPitch.values())
    for (let k = 1; k < list.length; k++) if (list[k].start < list[k - 1].keyUp - EPS) list[k].keyUp = Math.max(list[k].keyUp, list[k - 1].keyUp)
  for (const v of voices) {
    if (v.pitch >= NO_DAMPER_FROM) {
      v.release = Infinity
      v.tau = 0
      continue
    }
    const span = pedalAt(pedals, v.keyUp)
    v.release = span ? Math.max(v.keyUp, span[1]) : v.keyUp
    v.tau = span ? tauPedal(v.pitch) : tauKey(v.pitch)
  }
  // Re-strikes cut the previous strike of the same key.
  for (const list of byPitch.values())
    for (let k = 1; k < list.length; k++) {
      const prev = list[k - 1]
      if (list[k].start < prev.release - EPS) {
        prev.release = Math.max(prev.start + MIN_NOTE, list[k].start)
        prev.tau = TAU_RESTRIKE
      }
    }
  return voices.map(({ pitch, start, release, tau, dynamic, velocity }) => (velocity === undefined ? { pitch, start, release, tau, dynamic } : { pitch, start, release, tau, dynamic, velocity }))
}

/**
 * The voices of a loop [a, b): notes that start inside it, all released at b at the latest (the
 * pedal lifts and the keys come up at the loop end; their tails wrap into the next pass).
 */
export function loopVoices(voices: readonly Voice[], a: number, b: number): Voice[] {
  const out: Voice[] = []
  for (const v of voices) {
    if (v.start < a - EPS || v.start >= b - EPS) continue
    out.push(v.release > b ? { ...v, release: b, tau: v.pitch >= NO_DAMPER_FROM ? tauKey(88) * 2 : tauKey(v.pitch) } : v)
  }
  return out
}

/* ---------------- Metronome ---------------- */

export function beatsPerMeasure(ts: TimeSignature): number {
  return ts === '3/4' ? 3 : ts === '4/4' ? 4 : 2
}

/** Clicks for the count-in (the bar before 0) and the metronome (every beat of [0, duration)). */
export function metronomeClicks(measureSec: number, ts: TimeSignature, duration: number, opts: { metronome: boolean; countIn: boolean }): Click[] {
  const beats = beatsPerMeasure(ts)
  const beat = measureSec / beats
  const out: Click[] = []
  if (!(beat > 0)) return out
  if (opts.countIn) for (let k = 0; k < beats; k++) out.push({ time: -measureSec + k * beat, accent: k === 0 })
  if (opts.metronome)
    for (let k = 0; k * beat < duration - EPS; k++) out.push({ time: k * beat, accent: k % beats === 0 })
  return out
}

/* ---------------- Identity ---------------- */

/** Short identity of a voice list (changes whenever the music changes). */
export function voicesKey(voices: readonly Voice[]): string {
  let h = 0x811c9dc5
  const mix = (x: number) => {
    const v = Number.isFinite(x) ? Math.round(x * 10000) : 0x7fffffff
    h ^= v & 0xffff
    h = Math.imul(h, 0x01000193)
    h ^= (v >>> 16) & 0xffff
    h = Math.imul(h, 0x01000193)
  }
  for (const v of voices) {
    mix(v.pitch)
    mix(v.start)
    mix(v.release)
    mix(v.tau)
    mix(v.dynamic)
    mix(v.velocity ?? -1)
  }
  return `${voices.length}:${(h >>> 0).toString(16)}`
}

/* ---------------- Synthetic pedal (evidence renders and scores without pedal data) ---------------- */

/**
 * Legato pedalling that follows the bass: the pedal goes down just after each new bass onset (left
 * hand, or the lowest note when one hand plays) and changes at the next one. Used only where the score
 * carries no pedal information.
 */
export function legatoPedals(notes: readonly PlayNote[], end: number): [number, number][] {
  const bassOnsets: number[] = []
  const lh = notes.filter((n) => n.staff === 1)
  const src = lh.length ? lh : notes
  for (const n of src) if (!bassOnsets.length || n.start - bassOnsets[bassOnsets.length - 1] > 0.05) bassOnsets.push(n.start)
  const out: [number, number][] = []
  for (let i = 0; i < bassOnsets.length; i++) {
    const a = bassOnsets[i] + 0.04
    const b = i + 1 < bassOnsets.length ? bassOnsets[i + 1] + 0.04 : end
    if (b - a > 0.1) out.push([a, b])
  }
  return out
}
