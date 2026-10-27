// Owner: engine-score. Score -> Standard MIDI File (one track per hand, piano).
import { Midi } from '@tonejs/midi'
import type { Score } from '../../types'
import { meterParts } from './constants'

export const MIDI_TRACK_NAMES = ['Mano derecha', 'Mano izquierda'] as const

/**
 * Standard MIDI file bytes: tempo, time signature and two piano tracks (program 0) named
 * 'Mano derecha' / 'Mano izquierda'. Tied events become single notes. (No key-signature meta
 * event: @tonejs/midi 2.0 encodes it incorrectly.)
 */
export function scoreToMidi(score: Score): Uint8Array {
  const midi = new Midi()
  const bpm = score.bpm > 0 && Number.isFinite(score.bpm) ? score.bpm : 100
  midi.header.name = score.title ?? ''
  midi.header.setTempo(bpm)
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: meterParts(score.timeSignature) })
  midi.header.update()
  const perTick = midi.header.ppq / 4
  score.staves.forEach((staff, si) => {
    const track = midi.addTrack()
    track.name = MIDI_TRACK_NAMES[si] ?? `Pista ${si + 1}`
    track.channel = si
    track.instrument.number = 0
    const velocity = si === 0 ? 0.8 : 0.7
    // pitch -> [start tick, length] of a note still tied into the next event
    const open = new Map<number, [number, number]>()
    const flush = (pitch: number) => {
      const note = open.get(pitch)
      if (!note) return
      track.addNote({ midi: pitch, ticks: note[0] * perTick, durationTicks: note[1] * perTick, velocity })
      open.delete(pitch)
    }
    for (const measure of staff.measures) {
      for (const ev of measure.events) {
        const at = measure.index * score.ticksPerMeasure + ev.start
        for (const pitch of ev.pitches) {
          const pending = open.get(pitch)
          if (pending && pending[0] + pending[1] === at) pending[1] += ev.duration
          else {
            flush(pitch)
            open.set(pitch, [at, ev.duration])
          }
          if (!ev.tie) flush(pitch)
        }
      }
    }
    for (const pitch of [...open.keys()]) flush(pitch)
  })
  return midi.toArray()
}
