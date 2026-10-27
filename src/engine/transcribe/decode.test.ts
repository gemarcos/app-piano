// End-to-end decoder behaviour on synthetic activations (basic-pitch's outputToNotesPoly + our onset map).
import { describe, expect, it } from 'vitest'
import { decodeNotes } from './decode'
import { MODEL_WINDOW_FRAMES } from './onsets'
import { decoderParams, MODEL_FPS } from './params'

const BINS = 88
const rows = (n: number, value = 0.02) => Array.from({ length: n }, () => new Array<number>(BINS).fill(value))
const bin = (pitch: number) => pitch - 21
const p = decoderParams({ sensitivity: 0.5, minNoteMs: 90 })

/** Writes a note: onset peak at `start`, frame activation `level` for `length` frames. */
function note(frames: number[][], onsets: number[][], pitch: number, start: number, length: number, onset = 0.9, level = 0.6) {
  onsets[start][bin(pitch)] = onset
  if (start > 0) onsets[start - 1][bin(pitch)] = onset * 0.5
  onsets[start + 1][bin(pitch)] = onset * 0.5
  for (let r = start; r < start + length; r++) frames[r][bin(pitch)] = level
}

describe('decodeNotes', () => {
  it('decodes a clean note with its timing and amplitude', () => {
    const frames = rows(200)
    const onsets = rows(200)
    note(frames, onsets, 60, 50, 60)
    const out = decodeNotes(frames, onsets, p)
    expect(out).toHaveLength(1)
    expect(out[0].pitch).toBe(60)
    expect(out[0].start).toBeCloseTo(50 / MODEL_FPS, 2)
    expect(out[0].duration).toBeCloseTo(60 / MODEL_FPS, 1)
    expect(out[0].velocity).toBeCloseTo(0.6, 2)
  })

  it('keeps a note held across a model window seam as ONE note', () => {
    const n = MODEL_WINDOW_FRAMES * 2 + 20
    const frames = rows(n)
    const onsets = rows(n)
    note(frames, onsets, 64, 100, 120, 0.9, 0.35)
    // The next window sees it much louder: the biggest frame jump of the clip (an onset 0.9 for basic-pitch's inference).
    for (let r = MODEL_WINDOW_FRAMES; r < 220; r++) frames[r][bin(64)] = 0.8
    const out = decodeNotes(frames, onsets, p)
    expect(out.map((x) => x.pitch)).toEqual([64])
    expect(out[0].duration).toBeGreaterThan(100 / MODEL_FPS)
  })

  it('collapses a double-peaked onset into one note at the first, stronger peak', () => {
    const frames = rows(200)
    const onsets = rows(200)
    note(frames, onsets, 40, 60, 80, 0.85)
    onsets[65][bin(40)] = 0.72 // second peak 58 ms later
    const out = decodeNotes(frames, onsets, p)
    expect(out).toHaveLength(1)
    expect(out[0].start).toBeCloseTo(60 / MODEL_FPS, 2)
  })

  it('lowers the onset threshold for bass notes only', () => {
    const frames = rows(200)
    const onsets = rows(200)
    note(frames, onsets, 36, 40, 60, 0.64) // C2: 0.64 > 0.70 * 0.85
    note(frames, onsets, 72, 40, 60, 0.64) // C5: below 0.70
    expect(decodeNotes(frames, onsets, p).map((x) => x.pitch)).toEqual([36])
  })

  it('drops notes shorter than minNoteMs and returns [] for degenerate input', () => {
    const frames = rows(120)
    const onsets = rows(120)
    note(frames, onsets, 67, 20, 6) // 70 ms
    note(frames, onsets, 69, 60, 12) // 139 ms
    expect(decodeNotes(frames, onsets, p).map((x) => x.pitch)).toEqual([69])
    expect(decodeNotes(frames, onsets, decoderParams({ sensitivity: 0.5, minNoteMs: 40 })).map((x) => x.pitch)).toEqual([67, 69])
    expect(decodeNotes([], [], p)).toEqual([])
    expect(decodeNotes(rows(2), rows(2), p)).toEqual([])
    expect(decodeNotes(rows(10), rows(9), p)).toEqual([])
  })
})
