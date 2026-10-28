// Owner: engine-score. Standard MIDI file export, read back with @tonejs/midi.
import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import type { ScoreEvent, TimeSignature } from '../../types'
import { MIDI_TRACK_NAMES, buildScore, keyFromFifths, scoreNotes, scoreToMidi } from './index'
import { knownAnalysis, plainParams, randomNotes, scoreFromMeasures, staffNotes } from './test-helpers'

const ev = (start: number, duration: number, pitches: number[], tie?: boolean): ScoreEvent =>
  tie ? { start, duration, pitches, tie } : { start, duration, pitches }

describe('scoreToMidi', () => {
  it('writes tempo, meter, title and two named piano tracks', () => {
    const score = scoreFromMeasures([[ev(0, 16, [72])]], [[ev(0, 16, [48])]], { bpm: 96, timeSignature: '3/4', title: 'Prueba' })
    const bytes = scoreToMidi(score)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd')
    const midi = new Midi(bytes)
    expect(midi.header.name).toBe('Prueba')
    expect(midi.header.tempos).toHaveLength(1)
    expect(midi.header.tempos[0].bpm).toBeCloseTo(96, 3)
    expect(midi.header.timeSignatures[0].timeSignature).toEqual([3, 4])
    expect(midi.tracks.map((t) => t.name)).toEqual([...MIDI_TRACK_NAMES])
    expect(MIDI_TRACK_NAMES).toEqual(['Mano derecha', 'Mano izquierda'])
    expect(midi.tracks.map((t) => t.instrument.number)).toEqual([0, 0])
    expect(midi.tracks.map((t) => t.channel)).toEqual([0, 1])
  })

  it('merges tied events into single notes', () => {
    const score = scoreFromMeasures(
      [[ev(0, 8, []), ev(8, 8, [60, 64], true)], [ev(0, 4, [60, 64], true), ev(4, 4, [60, 64]), ev(8, 8, [67])]],
      [],
      { bpm: 120 },
    )
    const midi = new Midi(scoreToMidi(score))
    const perTick = midi.header.ppq / 4
    const notes = midi.tracks[0].notes.map((n) => [n.midi, n.ticks / perTick, n.durationTicks / perTick])
    expect(notes).toEqual([
      [60, 8, 16],
      [64, 8, 16],
      [67, 24, 8],
    ])
    expect(midi.tracks[0].notes[0].time).toBeCloseTo(1, 6) // 8 sixteenths at 120 bpm
    expect(midi.duration).toBeCloseTo(4, 6)
  })

  it('round-trips generated scores in every meter', () => {
    const meters: TimeSignature[] = ['4/4', '3/4', '2/4', '6/8']
    meters.forEach((ts, i) => {
      for (const difficulty of ['original', 'intermedio', 'facil'] as const) {
        const a = knownAnalysis({ bpm: 66 + 23 * i, timeSignature: ts, key: keyFromFifths(i * 2 - 3, 'minor') })
        const score = buildScore(randomNotes(300, 50 + i, 30), plainParams(a, { difficulty, maxPolyphony: 4 }), a, 'Ida y vuelta')
        const midi = new Midi(scoreToMidi(score))
        const perTick = midi.header.ppq / 4
        expect(midi.header.tempos[0].bpm).toBeCloseTo(score.bpm, 3)
        expect(midi.header.timeSignatures[0].timeSignature).toEqual(ts.split('/').map(Number))
        for (const s of [0, 1] as const) {
          const back = midi.tracks[s].notes
            .map((n) => ({ pitch: n.midi, start: Math.round((n.ticks / perTick) * 1e6) / 1e6, ticks: Math.round((n.durationTicks / perTick) * 1e6) / 1e6 }))
            .sort((x, y) => x.start - y.start || x.pitch - y.pitch)
          expect(back, `${ts} ${difficulty} staff ${s}`).toEqual(staffNotes(score, s))
          // Velocities are the score's own (7-bit MIDI resolution).
          const want = scoreNotes(score).filter((n) => n.staff === s)
          const got = [...midi.tracks[s].notes].sort((x, y) => x.ticks - y.ticks || x.midi - y.midi)
          expect(got).toHaveLength(want.length)
          got.forEach((n, k) => expect(Math.abs(n.velocity - want[k].velocity)).toBeLessThanOrEqual(1 / 127 + 1e-9))
        }
      }
    })
  })

  it('writes a valid file for an empty score', () => {
    const empty = buildScore([], plainParams(knownAnalysis()), knownAnalysis())
    const midi = new Midi(scoreToMidi(empty))
    expect(midi.tracks).toHaveLength(2)
    expect(midi.tracks.every((t) => t.notes.length === 0)).toBe(true)
  })
})
