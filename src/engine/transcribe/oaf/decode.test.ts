import { describe, expect, it } from 'vitest'
import { FRAME_SECONDS, ONSET_SHIFT_SECONDS, PITCHES } from './constants'
import { decodeActivations, oafVelocity, OAF_VELOCITY_FLOOR } from './decode'
import type { Activations } from './network'

/** Activations with `frames` rows; `set(kind, frame, pitch, value)` fills them. */
function roll(frames: number) {
  const a: Activations = { frames, onset: new Float32Array(frames * PITCHES), frame: new Float32Array(frames * PITCHES), velocity: new Float32Array(frames * PITCHES) }
  const set = (kind: 'onset' | 'frame' | 'velocity', f: number, pitch: number, v: number) => (a[kind][f * PITCHES + (pitch - 21)] = v)
  return { a, set }
}

describe('Onsets and Frames decoder (Magenta pianorollToNoteSequence rule)', () => {
  it('starts a note on an onset and keeps it while the frame stays on', () => {
    const { a, set } = roll(20)
    set('onset', 2, 60, 0.9)
    set('velocity', 2, 60, 70)
    for (let f = 2; f < 8; f++) set('frame', f, 60, 0.8)
    const notes = decodeActivations(a, { onsetShift: 0 })
    expect(notes).toHaveLength(1)
    expect(notes[0].pitch).toBe(60)
    expect(notes[0].start).toBeCloseTo(2 * FRAME_SECONDS, 3)
    expect(notes[0].duration).toBeCloseTo(6 * FRAME_SECONDS, 3)
    expect(notes[0].velocity).toBeCloseTo(0.7, 3)
  })

  it('merges consecutive onset frames and splits on a re-strike after a gap in the onsets', () => {
    const { a, set } = roll(30)
    for (let f = 1; f < 25; f++) set('frame', f, 64, 0.9)
    set('onset', 1, 64, 0.8)
    set('onset', 2, 64, 0.9) // same strike
    set('onset', 12, 64, 0.7) // re-strike while still sounding
    const notes = decodeActivations(a, { onsetShift: 0 })
    expect(notes.map((n) => Math.round(n.start / FRAME_SECONDS))).toEqual([1, 12])
    expect(notes[0].duration).toBeCloseTo(11 * FRAME_SECONDS, 3)
  })

  it('ends notes at the end of the input and ignores frames without an onset', () => {
    const { a, set } = roll(10)
    for (let f = 0; f < 10; f++) set('frame', f, 40, 0.9) // never struck
    set('onset', 6, 100, 0.9)
    for (let f = 6; f < 10; f++) set('frame', f, 100, 0.9) // still sounding when the input ends
    const notes = decodeActivations(a, { onsetShift: 0 })
    expect(notes).toHaveLength(1)
    expect(notes[0].pitch).toBe(100)
    expect(notes[0].duration).toBeCloseTo(4 * FRAME_SECONDS, 3)
  })

  it('applies thresholds, minimum duration, time scale and the onset shift', () => {
    const { a, set } = roll(40)
    set('onset', 4, 50, 0.4) // below 0.5, above 0.3
    set('onset', 20, 52, 0.9)
    for (let f = 4; f < 6; f++) set('frame', f, 50, 0.9)
    for (let f = 20; f < 30; f++) set('frame', f, 52, 0.9)
    expect(decodeActivations(a, { onsetThreshold: 0.5 }).map((n) => n.pitch)).toEqual([52])
    expect(decodeActivations(a, { onsetThreshold: 0.3 }).map((n) => n.pitch)).toEqual([50, 52])
    // the 2-frame note (64 ms) goes with a 90 ms minimum
    expect(decodeActivations(a, { onsetThreshold: 0.3, minDuration: 0.09 }).map((n) => n.pitch)).toEqual([52])
    const [note] = decodeActivations(a, { timeScale: 1.1, onsetShift: ONSET_SHIFT_SECONDS })
    expect(note.start).toBeCloseTo(20 * FRAME_SECONDS * 1.1 + ONSET_SHIFT_SECONDS, 3)
    expect(note.duration).toBeCloseTo(10 * FRAME_SECONDS * 1.1, 3)
  })

  it('maps the 10..90 velocity scale to loudness with the app floor', () => {
    expect(oafVelocity(10)).toBe(OAF_VELOCITY_FLOOR)
    expect(oafVelocity(70)).toBeCloseTo(0.7)
    expect(oafVelocity(90)).toBeCloseTo(0.9)
    expect(oafVelocity(200)).toBe(1)
  })

  it('sorts notes by start then pitch over the whole 88-key range', () => {
    const { a, set } = roll(6)
    set('onset', 1, 108, 0.9)
    set('onset', 1, 21, 0.9)
    set('onset', 0, 70, 0.9)
    expect(decodeActivations(a).map((n) => n.pitch)).toEqual([70, 21, 108])
  })
})
