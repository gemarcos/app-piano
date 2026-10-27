// Owner: engine-score. Tempo, beat phase, meter and key estimation on synthetic streams.
import { describe, expect, it } from 'vitest'
import type { KeyMode, NoteEvent } from '../../types'
import { analyzeNotes, emptyAnalysis, tonicPc } from './index'
import { makeStream, type StreamStyle } from './test-helpers'

const STYLES: StreamStyle[] = ['melody', 'chords', 'arpeggio', 'waltz']

describe('analyzeNotes', () => {
  it('returns the defaults for empty input and never throws', () => {
    expect(analyzeNotes([])).toEqual({
      bpm: 100,
      bpmConfidence: 0,
      beatOffset: 0,
      timeSignature: '4/4',
      key: { tonic: 'C', mode: 'major', fifths: 0 },
      keyConfidence: 0,
    })
    expect(emptyAnalysis()).toEqual(analyzeNotes([]))
    for (const bad of [null, undefined, 'notes', [null, { pitch: Number.NaN }], [{ pitch: 60, start: Infinity, duration: 1, velocity: 1 }]]) {
      expect(() => analyzeNotes(bad as unknown as NoteEvent[])).not.toThrow()
    }
  })

  it('keeps the default tempo but finds phase and key for very short input', () => {
    const a = analyzeNotes([
      { pitch: 69, start: 0.8, duration: 0.5, velocity: 0.8 },
      { pitch: 72, start: 1.2, duration: 0.5, velocity: 0.8 },
      { pitch: 76, start: 1.4, duration: 0.5, velocity: 0.8 },
    ])
    expect(a.bpm).toBe(100)
    expect(a.beatOffset).toBe(0.8)
    expect(a.key.mode).toBe('minor')
  })

  it('finds the tempo within 3 % from 60 to 180 bpm with +-15 ms jitter', () => {
    const misses: string[] = []
    for (const style of STYLES) {
      for (let bpm = 60; bpm <= 180; bpm += 8) {
        for (const seed of [1, 2, 3]) {
          const a = analyzeNotes(makeStream({ bpm, style, jitterMs: 15, seed, bars: 12, tonic: (bpm + seed) % 12 }))
          expect(Number.isInteger(a.bpm)).toBe(true)
          expect(a.bpmConfidence).toBeGreaterThanOrEqual(0)
          expect(a.bpmConfidence).toBeLessThanOrEqual(1)
          if (Math.abs(a.bpm - bpm) / bpm > 0.03) misses.push(`${style} ${bpm} (seed ${seed}) -> ${a.bpm}`)
        }
      }
    }
    expect(misses).toEqual([])
  })

  it('places the first downbeat at the first bar, also after a pickup', () => {
    for (const style of STYLES) {
      for (const bpm of [72, 100, 132, 168]) {
        for (const lead of [0, 0.4, 1.1]) {
          const notes = makeStream({ bpm, style, jitterMs: 10, seed: 5, bars: 10, lead })
          expect(analyzeNotes(notes).beatOffset, `${style} ${bpm} lead ${lead}`).toBeCloseTo(lead, 1)
          // A pickup note one beat before the first downbeat.
          const pickup = [{ pitch: 67, start: lead + 0.6, duration: 60 / bpm, velocity: 0.6 }, ...notes.map((x) => ({ ...x, start: x.start + 0.6 + 60 / bpm }))]
          const a = analyzeNotes(pickup)
          expect(a.beatOffset, `${style} ${bpm} lead ${lead} + pickup`).toBeCloseTo(lead + 0.6 + 60 / bpm, 1)
        }
      }
    }
  })

  it('detects 3/4 only for waltzes (6/8 is never automatic)', () => {
    for (const style of STYLES) {
      for (const bpm of [66, 96, 120, 150]) {
        for (const seed of [1, 7, 11, 12]) {
          const a = analyzeNotes(makeStream({ bpm, style, jitterMs: 15, seed, bars: 12 }))
          expect(a.timeSignature, `${style} ${bpm} seed ${seed}`).toBe(style === 'waltz' ? '3/4' : '4/4')
        }
      }
    }
  })

  it('finds major and minor keys for every tonic', () => {
    const modes: KeyMode[] = ['major', 'minor']
    for (const mode of modes) {
      for (let tonic = 0; tonic < 12; tonic++) {
        for (const style of ['chords', 'melody', 'waltz'] as StreamStyle[]) {
          const a = analyzeNotes(makeStream({ bpm: 96, style, tonic, mode, seed: tonic + 3, bars: 8, jitterMs: 15 }))
          expect(`${tonicPc(a.key)} ${a.key.mode}`, `${style} ${tonic} ${mode}`).toBe(`${tonic} ${mode}`)
          expect(Math.abs(a.key.fifths)).toBeLessThanOrEqual(6)
          expect(a.keyConfidence).toBeGreaterThan(0)
          expect(a.keyConfidence).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('is deterministic and fast', () => {
    const notes = makeStream({ bpm: 118, style: 'arpeggio', bars: 60, jitterMs: 15 })
    const first = analyzeNotes(notes)
    expect(analyzeNotes([...notes].reverse())).toEqual(first)
    const t0 = performance.now()
    analyzeNotes(notes)
    expect(performance.now() - t0).toBeLessThan(100)
  })
})
