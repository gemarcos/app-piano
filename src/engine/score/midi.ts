// Owner: engine-score. Score -> Standard MIDI File (one track per hand, piano).
import { Midi } from '@tonejs/midi'
import type { Score } from '../../types'
import { TICKS_PER_QUARTER, meterParts } from './constants'
import { scoreNotes } from './notes'

export const MIDI_TRACK_NAMES = ['Mano derecha', 'Mano izquierda'] as const

/** MIDI controller of the damper (sustain) pedal. */
export const SUSTAIN_CC = 64

/**
 * Standard MIDI file bytes: tempo, time signature and two piano tracks (program 0, channels 0/1)
 * named 'Mano derecha' / 'Mano izquierda', with both voices of each staff, tied events as single
 * notes and the score's note velocities. Score.pedals becomes sustain-pedal control changes (CC64
 * 127 down / 0 up) on both tracks. (No key-signature meta event: @tonejs/midi 2.0 encodes it
 * incorrectly.)
 */
export function scoreToMidi(score: Score): Uint8Array {
  const midi = new Midi()
  const bpm = score.bpm > 0 && Number.isFinite(score.bpm) ? score.bpm : 100
  midi.header.name = score.title ?? ''
  midi.header.setTempo(bpm)
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: meterParts(score.timeSignature) })
  midi.header.update()
  const perTick = midi.header.ppq / TICKS_PER_QUARTER
  const tracks = MIDI_TRACK_NAMES.map((name, si) => {
    const track = midi.addTrack()
    track.name = name
    track.channel = si
    track.instrument.number = 0
    return track
  })
  for (const n of scoreNotes(score)) {
    tracks[n.staff].addNote({ midi: n.pitch, ticks: n.tick * perTick, durationTicks: n.ticks * perTick, velocity: n.velocity })
  }
  for (const span of score.pedals ?? []) {
    if (!(span.end > span.start)) continue
    for (const track of tracks) {
      track.addCC({ number: SUSTAIN_CC, value: 1, ticks: span.start * perTick })
      track.addCC({ number: SUSTAIN_CC, value: 0, ticks: span.end * perTick })
    }
  }
  return midi.toArray()
}
