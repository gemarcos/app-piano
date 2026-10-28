// Owner: engine-audio / piano-model. Key-held notes (piano model) -> sounding notes, as the score engine expects.
//
// Transkun reports how long each key was held and the damper pedal apart. The score engine (pedal inference,
// articulation, playback) is built on sounding durations, as Basic Pitch hears them: a note keeps ringing after its
// key is released while the pedal is down, until the pedal comes up or the same key is struck again, and even a very
// short touch rings for a moment before the damper stops it.
import type { NoteEvent } from '../../types'
import type { PedalSpan } from './index'

/** Even a very short touch sounds this long before the damper stops the string (seconds). */
export const MIN_SOUNDING = 0.12
/** A struck piano string is no longer heard this long after the attack, whatever the pedal does (seconds). */
export const MAX_SOUNDING = 4

/** Notes lengthened by the pedal (and to a short minimum), never past the next strike of the same key. Never throws. */
export function sustainNotes(notes: NoteEvent[], pedal: PedalSpan[]): NoteEvent[] {
  const spans = pedal.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start).sort((a, b) => a.start - b.start)
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].start - notes[b].start)
  const nextStrike = new Array<number>(notes.length).fill(Infinity)
  const lastByPitch = new Map<number, number>()
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]
    const later = lastByPitch.get(notes[i].pitch)
    if (later !== undefined) nextStrike[i] = notes[later].start
    lastByPitch.set(notes[i].pitch, i)
  }
  /** End of the pedal span holding time t down (t itself when the pedal is up). */
  const releaseAfter = (t: number) => {
    let lo = 0
    let hi = spans.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (spans[mid].start <= t) lo = mid + 1
      else hi = mid
    }
    const s = spans[lo - 1]
    return s && t < s.end ? s.end : t
  }
  return notes.map((n, i) => {
    const keyUp = n.start + Math.max(0, n.duration)
    const end = Math.min(Math.max(releaseAfter(keyUp), n.start + MIN_SOUNDING), nextStrike[i], n.start + Math.max(MAX_SOUNDING, n.duration))
    const duration = Math.max(n.duration, end - n.start)
    return duration === n.duration ? n : { ...n, duration }
  })
}
