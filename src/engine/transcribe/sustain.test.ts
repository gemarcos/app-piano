import { describe, expect, it } from 'vitest'
import { MAX_SOUNDING, MIN_SOUNDING, sustainNotes } from './sustain'

const note = (pitch: number, start: number, duration: number) => ({ pitch, start, duration, velocity: 0.6 })

describe('sustainNotes', () => {
  it('rings a released key until the pedal comes up', () => {
    const [n] = sustainNotes([note(60, 1, 0.1)], [{ start: 0.5, end: 2.5 }])
    expect(n.duration).toBeCloseTo(1.5)
  })

  it('stops at the next strike of the same key', () => {
    const out = sustainNotes([note(60, 1, 0.1), note(60, 1.6, 0.1), note(64, 1.2, 0.1)], [{ start: 0.5, end: 3 }])
    expect(out[0].duration).toBeCloseTo(0.6)
    expect(out[1].duration).toBeCloseTo(1.4)
    expect(out[2].duration).toBeCloseTo(1.8)
  })

  it('keeps key-held notes without pedal, lifting very short touches to a short minimum', () => {
    const out = sustainNotes([note(60, 0, 0.5), note(62, 1, 0.03)], [])
    expect(out[0].duration).toBe(0.5)
    expect(out[1].duration).toBeCloseTo(MIN_SOUNDING)
  })

  it('ignores a pedal that went down after the key came up', () => {
    const [n] = sustainNotes([note(60, 0, 0.3)], [{ start: 0.5, end: 2 }])
    expect(n.duration).toBe(0.3)
  })

  it('caps the ringing to what a string can sustain', () => {
    const [n] = sustainNotes([note(40, 0, 0.2)], [{ start: 0, end: 20 }])
    expect(n.duration).toBe(MAX_SOUNDING)
  })

  it('never shortens a note and keeps the input order', () => {
    const notes = [note(67, 2, 6), note(60, 0, 0.2)]
    const out = sustainNotes(notes, [{ start: 0, end: 1 }])
    expect(out.map((n) => n.pitch)).toEqual([67, 60])
    expect(out[0].duration).toBe(6)
    expect(out[1].duration).toBeCloseTo(1)
  })
})
