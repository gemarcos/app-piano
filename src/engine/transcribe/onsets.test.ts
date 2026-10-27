import { describe, expect, it } from 'vitest'
import { MODEL_WINDOW_FRAMES, prepareOnsets } from './onsets'

const W = 4 // pitch bins in these synthetic activations

/** [n][W] rows filled with `value`. */
const matrix = (n: number, value = 0) => Array.from({ length: n }, () => new Array<number>(W).fill(value))

/** Indices r where column c is a strict local maximum above `threshold` (what basic-pitch's argRelMax + threshold keep). */
function peaks(m: number[][], c: number, threshold: number): number[] {
  const out: number[] = []
  for (let r = 0; r < m.length; r++) {
    const v = m[r][c]
    if (v > threshold && (r === 0 || v > m[r - 1][c]) && (r === m.length - 1 || v > m[r + 1][c])) out.push(r)
  }
  return out
}

describe('prepareOnsets', () => {
  it('adds onsets where frame activations jump, rescaled to the onset maximum', () => {
    const onsets = matrix(20, 0.1)
    onsets[3][1] = 0.8
    const frames = matrix(20, 0.05)
    for (let r = 10; r < 20; r++) frames[r][2] = 0.6 // a note on bin 2 with no onset activation
    const out = prepareOnsets(onsets, frames)
    expect(out[10][2]).toBeCloseTo(0.8) // the largest jump maps to the global onset maximum
    expect(out[11][2]).toBeCloseTo(0.1) // flat again: back to the raw onset value
    expect(peaks(out, 2, 0.5)).toEqual([10])
    expect(prepareOnsets(onsets, frames, { infer: false })[10][2]).toBeCloseTo(0.1)
  })

  it('never infers an onset from a jump across a model window seam', () => {
    const n = MODEL_WINDOW_FRAMES * 2
    const onsets = matrix(n, 0.05)
    onsets[5][0] = 0.9
    const frames = matrix(n, 0.05)
    for (let r = 5; r < n; r++) frames[r][0] = r < MODEL_WINDOW_FRAMES ? 0.4 : 0.7 // sustained note, level jumps at the seam
    for (let r = 100; r < n; r++) frames[r][3] = 0.5 // a real new note inside window 0
    const out = prepareOnsets(onsets, frames)
    expect(peaks(out, 0, 0.3)).toEqual([5])
    expect(out[MODEL_WINDOW_FRAMES][0]).toBeCloseTo(0.05)
    expect(out[MODEL_WINDOW_FRAMES + 1][0]).toBeCloseTo(0.05)
    expect(peaks(out, 3, 0.3)).toEqual([100])
    // basic-pitch's behaviour (no seam handling) would add the spurious onset
    expect(peaks(prepareOnsets(onsets, frames, { windowFrames: 0 }), 0, 0.3)).toContain(MODEL_WINDOW_FRAMES)
  })

  it('keeps only the strongest same-pitch onset within the suppression radius', () => {
    const onsets = matrix(40, 0)
    onsets[10][0] = 0.8 // double-peaked onset of one note (second peak 5 frames later)
    onsets[11][0] = 0.6
    onsets[15][0] = 0.66
    onsets[30][0] = 0.7 // a later repetition, outside the radius
    onsets[10][1] = 0.7 // equal neighbouring peaks: the earlier one wins
    onsets[13][1] = 0.7
    const frames = matrix(40, 0.5)
    const off = prepareOnsets(onsets, frames, { infer: false })
    expect(peaks(off, 0, 0.5)).toEqual([10, 15, 30])
    const on = prepareOnsets(onsets, frames, { infer: false, nmsRadius: 5 })
    expect(peaks(on, 0, 0.5)).toEqual([10, 30])
    expect(peaks(on, 1, 0.5)).toEqual([10])
  })

  it('scales columns (per-pitch thresholds) and breaks exact plateaus toward their first frame', () => {
    const onsets = matrix(10, 0)
    onsets[4][0] = 0.6
    onsets[5][0] = 0.6 // plateau: argRelMax (strict) would pick neither frame
    const out = prepareOnsets(onsets, matrix(10, 0.2), { infer: false, columnScale: [1.5, 1, 1, 1] })
    expect(out[4][0]).toBeCloseTo(0.9)
    expect(peaks(out, 0, 0.5)).toEqual([4])
  })

  it('does not modify its inputs and tolerates empty input', () => {
    const onsets = matrix(12, 0.2)
    const frames = matrix(12, 0)
    frames[6][1] = 0.9
    const copyO = JSON.stringify(onsets)
    const copyF = JSON.stringify(frames)
    prepareOnsets(onsets, frames, { nmsRadius: 3, columnScale: [2, 2, 2, 2] })
    expect(JSON.stringify(onsets)).toBe(copyO)
    expect(JSON.stringify(frames)).toBe(copyF)
    expect(prepareOnsets([], [])).toEqual([])
  })
})
