// Owner: engine-score. The notes a Score sounds, for playback renderers and exporters.
import type { Measure, Score, ScoreEvent, Staff, TimeSignature } from '../../types'
import { beatTicksOf } from './constants'
import { splitDuration } from './durations'
import { normalizeKey } from './keys'
import { harmonicSpelling, type SpellingChoice } from './spelling'

/** Loudness used when a ScoreEvent has no velocities (scores built before velocities existed). */
export const DEFAULT_VELOCITY = 0.7

/** A Staff as built by engine-score: an optional second voice beside `measures` (requested for types.ts). */
export interface VoicedStaff extends Staff {
  /**
   * Second voice of the staff (stems down; the main voice in `measures` then has stems up). Same
   * length as `measures`; every measure tiles [0, ticksPerMeasure) and holds only rests where the
   * staff has a single voice. Rests of this voice are not drawn. Absent = one voice.
   */
  voice2?: Measure[]
}

/** A ScoreEvent as built by engine-score (requested for types.ts as ScoreEvent.sounding). */
export interface EngineEvent extends ScoreEvent {
  /**
   * Attack events only, parallel to pitches: ticks from this attack that each key keeps sounding
   * without the pedal, when that outlasts the written (tied) length. Notation is articulated (a
   * pianist's reading); playback plays the note this long so legato and held notes still sound held.
   * Absent = as written (then Score.pedals alone adds the ringing).
   */
  sounding?: number[]
}

/** The voices of a staff: [measures] or [measures, voice2]. */
export function staffVoices(staff: Staff): Measure[][] {
  const v2 = (staff as VoicedStaff).voice2
  return Array.isArray(v2) && v2.length ? [staff.measures, v2] : [staff.measures]
}

/** One sounding note: ties merged, absolute ticks. */
export interface PlayedNote {
  pitch: number
  /** Absolute tick of the attack (measure.index * ticksPerMeasure + event.start). */
  tick: number
  /** Length in ticks, tied continuations included. */
  ticks: number
  /** 0..1, from ScoreEvent.velocities (DEFAULT_VELOCITY when absent). */
  velocity: number
  /** 0 = right hand / upper staff, 1 = left hand / lower staff. */
  staff: 0 | 1
  /** 1 = main voice (Staff.measures), 2 = second voice (Staff.voice2). */
  voice: 1 | 2
  /**
   * Ticks the key sounds from the attack without pedal, when longer than `ticks` (the written
   * length): playback should hold the note this long (EngineEvent.sounding). Absent = `ticks`.
   */
  sounding?: number
}

/**
 * Every note the score sounds, both staves and both voices, with ties merged into one note and
 * its attack velocity; sorted by tick, then pitch. This is what a playback renderer schedules
 * (add Score.pedals for the damper), and what the MIDI export writes.
 */
export function scoreNotes(score: Score): PlayedNote[] {
  const out: PlayedNote[] = []
  score.staves.forEach((staff, si) => {
    staffVoices(staff).forEach((measures, vi) => {
      let open = new Map<number, PlayedNote>()
      let prevTie = false
      for (const m of measures) {
        for (const ev of m.events as ScoreEvent[]) {
          const at = m.index * score.ticksPerMeasure + ev.start
          const next = new Map<number, PlayedNote>()
          ev.pitches.forEach((p, k) => {
            const cont = prevTie ? open.get(p) : undefined
            if (cont && cont.tick + cont.ticks === at) {
              cont.ticks += ev.duration
              next.set(p, cont)
              return
            }
            const v = ev.velocities?.[k]
            const n: PlayedNote = {
              pitch: p,
              tick: at,
              ticks: ev.duration,
              velocity: typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_VELOCITY,
              staff: si as 0 | 1,
              voice: (vi + 1) as 1 | 2,
            }
            const sounding = (ev as EngineEvent).sounding?.[k]
            if (typeof sounding === 'number' && Number.isFinite(sounding) && sounding > 0) n.sounding = sounding
            out.push(n)
            next.set(p, n)
          })
          open = next
          prevTie = ev.pitches.length > 0 && ev.tie === true
        }
      }
    })
  })
  for (const n of out) if (n.sounding !== undefined && n.sounding <= n.ticks) delete n.sounding
  return out.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch || a.staff - b.staff)
}

/**
 * Ticks of silence a pickup (anacrusis) removes from measure 0: the start of the first note there
 * (any staff or voice) when it is at least a beat late and the score has more than one measure;
 * else 0. Absolute ticks are unchanged: measure 0 still spans [0, ticksPerMeasure) in the Score.
 */
export function pickupTicks(score: Score): number {
  const tpm = score.ticksPerMeasure
  if (!(score.measureCount >= 2)) return 0
  let lead = tpm
  for (const staff of score.staves) {
    for (const measures of staffVoices(staff)) {
      for (const ev of measures[0]?.events ?? []) {
        if (ev.pitches.length) {
          lead = Math.min(lead, ev.start)
          break
        }
      }
    }
  }
  return lead >= beatTicksOf(score.timeSignature) && lead < tpm ? lead : 0
}

/** Events of a measure without its first `lead` ticks (only rests are cut; they are re-split). */
export function trimLead(events: readonly ScoreEvent[], lead: number, ts: TimeSignature): ScoreEvent[] {
  if (lead <= 0) return events.slice()
  const out: ScoreEvent[] = []
  for (const ev of events) {
    const end = ev.start + ev.duration
    if (end <= lead) continue
    if (ev.start < lead) {
      let pos = lead
      for (const d of splitDuration(lead, end - lead, ts, true)) {
        out.push({ start: pos, duration: d, pitches: [] })
        pos += d
      }
      continue
    }
    out.push(ev)
  }
  return out
}

/**
 * Harmonic spelling per onset of a score: for each absolute tick where notes start, the spelling
 * choice for the chromatic notes sounding then (all staves and voices, held notes included), or
 * undefined. Writers pass it to spellChord / pitchClassName so a chord is spelled as a chord.
 */
export function spellingContext(score: Score): (tick: number) => SpellingChoice | undefined {
  const key = normalizeKey(score.key)
  const notes = scoreNotes(score)
  const out = new Map<number, SpellingChoice>()
  // The choice depends only on the set of sounding pitch classes: cache it per 12-bit mask.
  const byMask = new Map<number, SpellingChoice | undefined>()
  const active: PlayedNote[] = []
  let i = 0
  while (i < notes.length) {
    const t = notes[i].tick
    let w = 0
    for (let k = 0; k < active.length; k++) if (active[k].tick + active[k].ticks > t) active[w++] = active[k]
    active.length = w
    while (i < notes.length && notes[i].tick === t) active.push(notes[i++])
    let mask = 0
    for (const n of active) mask |= 1 << (((n.pitch % 12) + 12) % 12)
    let choice = byMask.get(mask)
    if (!byMask.has(mask)) {
      const pcs: number[] = []
      for (let pc = 0; pc < 12; pc++) if (mask & (1 << pc)) pcs.push(pc)
      choice = harmonicSpelling(pcs, key)
      byMask.set(mask, choice)
    }
    if (choice) out.set(t, choice)
  }
  return (tick) => out.get(tick)
}
