// Owner: engine-score. Notated (engraved) lengths: what a pianist reads, not how long the strings ring.
//
// Transcriptions report how long a note SOUNDS, pedal included, so read literally every note is
// long and tied. An engraver writes instead:
// - each note up to the next note of its voice (under the pedal also no further than the next note
//   of either hand or its beat end: arpeggios shared by the hands become running eighths);
// - held only with real evidence: the held voice of a two-voice staff (voices.ts);
// - one simple value per note (no tie chains, nothing tied across a beat or a barline for an
//   articulated note), and a rest where the hand stops;
// - held notes end on the beat when they end within a sixteenth of it.
// The ringing stays audible: Score.pedals for the damper pedal, and ScoreEvent.sounding for notes
// held without pedal (playback plays them as long as they sounded).
import type { TimeSignature } from '../../types'
import { NOTE_VALUES, SIXTEENTH, TICKS_PER_QUARTER, TUPLET_VALUES, ticksPerMeasureOf } from './constants'
import { isTripletEdge, splitDuration } from './durations'
import type { QNote } from './quantize'

/** One chord of one voice: absolute ticks. */
export interface Segment {
  on: number
  off: number
  pitches: number[]
  vels: number[]
  /** Per pitch: the absolute tick where the note stops sounding without pedal (-1 = as written). */
  sounds: number[]
  /** A held note of a two-voice staff (keeps its length; may be tied). */
  held: boolean
  /** Latest end of a note whose length is the hand's own (QNote.free), else -1. */
  freeEnd: number
}

const round3 = (x: number) => Math.round(x * 1000) / 1000

/** Index of the first value > t in a sorted array. */
function upper(list: readonly number[], t: number): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

const nextAfter = (list: readonly number[], t: number) => {
  const i = upper(list, t)
  return i < list.length ? list[i] : Infinity
}

/**
 * Articulated lengths for the notes of ONE hand (after splitVoices), in place: each note ends by
 * the next onset of its own voice; under the pedal a note that is not held also ends by the next
 * onset of either hand or its beat end, whichever is later.
 */
export function articulate(hand: QNote[], all: readonly QNote[], beatTicks: number): void {
  const onsets = (list: readonly QNote[]) => [...new Set(list.map((n) => n.on))].sort((a, b) => a - b)
  const any = onsets(all)
  const sorted = [...all].sort((a, b) => a.on - b.on)
  const last = any.length ? any[any.length - 1] : -1
  const index = new Map(hand.map((n, i) => [n, i]))
  for (const voice of [1, 2] as const) {
    const notes = hand.filter((n) => n.voice === voice)
    const own = onsets(notes)
    for (const n of notes) {
      // The final chord of the piece keeps its length (written as held, like a closing fermata).
      if (n.on === last) n.held = true
      let limit = nextAfter(own, n.on)
      // A held note ends where its line goes on: a note of the hand at most a tone below an upper
      // held voice (a melody), or at most a tone above a lower one (a tenor or a bass).
      // Nor can a hand hold a key while it plays a note out of its reach: from there on the note
      // rings by the pedal (or the room), not by the finger.
      for (let j = index.get(n)! + 1; j < hand.length && hand[j].on < Math.min(limit, n.off); j++) {
        const m = hand[j]
        if (m.on > n.on && (Math.abs(m.pitch - n.pitch) > HAND_SPAN || (n.held && (voice === 1 ? m.pitch >= n.pitch - 2 : m.pitch <= n.pitch + 2)))) limit = m.on
      }
      if (!n.held && !n.free) {
        const cap = Math.max(nextAfter(any, n.on), (Math.floor(n.on / beatTicks) + 1) * beatTicks)
        if (cap < Math.min(limit, n.off) && !louder(n, sorted, beatTicks)) limit = cap
      }
      if (limit < n.off) n.off = limit
    }
  }
}

/** A melody note clearly louder (1.15x) than the median of the notes sounding with it: its hand holds it. */
function louder(n: QNote, sorted: readonly QNote[], beatTicks: number): boolean {
  let lo = 0
  let hi = sorted.length
  const from = n.on - 4 * beatTicks
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].on < from) lo = mid + 1
    else hi = mid
  }
  const around: number[] = []
  for (let j = lo; j < sorted.length && sorted[j].on < n.off && around.length < 64; j++) {
    const m = sorted[j]
    if (m !== n && m.off > n.on) around.push(m.vel)
  }
  around.sort((a, b) => a - b)
  return around.length > 0 && n.vel >= 1.15 * around[(around.length - 1) >> 1]
}

/**
 * One chord per onset of a voice: duration = min(longest note, next onset - onset). A release gap
 * of at most one grid unit that is shorter than half the inter-onset interval is read as legato
 * (no rest), unless the next chord strikes one of the same keys again or the release is at the
 * barline.
 */
export function chordStream(notes: QNote[], grid: number, measureTicks: number): Segment[] {
  const segs: Segment[] = []
  let i = 0
  while (i < notes.length) {
    const on = notes[i].on
    let j = i
    let off = on
    let held = false
    let freeEnd = -1
    const pitches: number[] = []
    const vels: number[] = []
    const sounds: number[] = []
    while (j < notes.length && notes[j].on === on) {
      pitches.push(notes[j].pitch)
      vels.push(round3(notes[j].vel))
      sounds.push(notes[j].sound ?? -1)
      if (notes[j].off > off) off = notes[j].off
      if (notes[j].held) held = true
      if (notes[j].free) freeEnd = Math.max(freeEnd, notes[j].sound ?? -1)
      j++
    }
    if (j < notes.length) {
      const next = notes[j].on
      const gap = next - off
      // A gap before the same key struck again is articulation (a rest), not legato.
      let again = false
      for (let k = j; k < notes.length && notes[k].on === next && !again; k++) again = pitches.includes(notes[k].pitch)
      // Nor is a release exactly at the barline (the next bar starts with its rest).
      if (gap < 0 || (gap <= grid && gap * 2 < next - on && !again && off % measureTicks !== 0)) off = next
    }
    segs.push({ on, off, pitches, vels, sounds, held, freeEnd })
    i = j
  }
  return segs
}

/**
 * A key struck again in the other voice of the staff cuts the note still sounding there (one key,
 * one string: the score never holds a pitch over its own re-attack).
 */
export function cutUnisons(voices: Segment[][]): void {
  if (voices.length < 2 || !voices[1].length) return
  const onsets = new Map<number, number[]>()
  for (const v of voices) {
    for (const s of v) {
      for (const p of s.pitches) {
        const list = onsets.get(p)
        if (list) list.push(s.on)
        else onsets.set(p, [s.on])
      }
    }
  }
  for (const list of onsets.values()) list.sort((a, b) => a - b)
  for (const v of voices) {
    for (const s of v) {
      s.pitches.forEach((p, k) => {
        const list = onsets.get(p)!
        const i = upper(list, s.on)
        if (i < list.length && list[i] < s.off) s.off = list[i]
        if (i < list.length && s.sounds[k] > list[i]) s.sounds[k] = list[i]
      })
    }
  }
}

/** Quarter beats of a voice holding a note edge off the sixteenth grid (written as tuplets). */
export function tripletBeats(segs: readonly Segment[]): Set<number> {
  const out = new Set<number>()
  for (const s of segs) {
    if (isTripletEdge(s.on)) out.add(Math.floor(s.on / TICKS_PER_QUARTER))
    if (isTripletEdge(s.off)) out.add(Math.floor(s.off / TICKS_PER_QUARTER))
  }
  return out
}

/** Notated pieces of [on, off) across measures (the layout's tuplet-beat cuts included). */
function pieceCount(on: number, off: number, ts: TimeSignature, triplets: Set<number>): number {
  const tpm = ticksPerMeasureOf(ts)
  let n = 0
  let s = on
  while (s < off) {
    let e = Math.min(off, (Math.floor(s / tpm) + 1) * tpm)
    const b = Math.floor(s / TICKS_PER_QUARTER)
    // Tuplet beats are closed groups: a span entering or leaving one is cut at its edges.
    if (triplets.has(b) && (b + 1) * TICKS_PER_QUARTER < e) e = (b + 1) * TICKS_PER_QUARTER
    else for (let k = b + 1; k * TICKS_PER_QUARTER < e; k++) if (triplets.has(k)) {
      e = k * TICKS_PER_QUARTER
      break
    }
    n += splitDuration(s % tpm, e - s, ts).length
    s = e
  }
  return n
}

/** The longest end in (on, off] that writes [on, end) as ONE value; `on + 1 grid step` at least. */
function singleEnd(on: number, off: number, ts: TimeSignature, triplets: Set<number>): number {
  // Inside a tuplet beat only tuplet values; elsewhere only straight ones (no new tuplet edges).
  const values = triplets.has(Math.floor(on / TICKS_PER_QUARTER)) ? TUPLET_VALUES : NOTE_VALUES
  for (let k = values.length - 1; k >= 0; k--) {
    const d = values[k]
    if (d <= off - on && pieceCount(on, on + d, ts, triplets) === 1) return on + d
  }
  return off
}

/**
 * Simple notated values for the chords of ONE voice (sorted, non-overlapping), in place. An
 * articulated chord becomes one value (the longest that fits; a rest fills the rest of the span);
 * a held chord keeps its length, ending on the beat when within a sixteenth of it.
 */
export function simpleValues(segs: Segment[], ts: TimeSignature, beatTicks: number): void {
  const triplets = tripletBeats(segs)
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const next = i + 1 < segs.length ? segs[i + 1].on : Infinity
    // Held: a held voice, or a key that really sounds this long without pedal (its own evidence).
    if (s.held || s.freeEnd >= s.off) {
      const beat = Math.round(s.off / beatTicks) * beatTicks
      if (beat > s.on && beat <= next && Math.abs(beat - s.off) <= SIXTEENTH && pieceCount(s.on, beat, ts, triplets) <= pieceCount(s.on, s.off, ts, triplets)) s.off = beat
      continue
    }
    if (pieceCount(s.on, s.off, ts, triplets) > 1) s.off = singleEnd(s.on, s.off, ts, triplets)
  }
}

/**
 * Marks the notes of ONE hand (raw lengths, sorted by onset) whose length is the hand's own: not
 * under the pedal, and not ringing on with the notes before them (keys of two or more earlier
 * onsets of the hand still sounding: an undetected pedal or a legato blur, not a held voice).
 * Also records each note's sounding end for playback (QNote.sound) where no pedal span holds it.
 */
export function markFree(hand: QNote[], pedalled: (from: number, to: number) => boolean): void {
  // Notes still sounding (onset order), pruned as the scan moves on.
  let active: QNote[] = []
  for (const n of hand) {
    const ped = pedalled(n.on, n.on + 1)
    n.sound = ped ? undefined : n.off
    active = active.filter((e) => e.off > n.on)
    let earlier = 0
    let lastOn = -1
    for (const e of active) if (e.on < n.on && e.on !== lastOn) {
      earlier++
      lastOn = e.on
    }
    n.free = !ped && earlier < 2
    active.push(n)
  }
}

/** Widest interval one hand holds while playing (a tenth). */
const HAND_SPAN = 16
