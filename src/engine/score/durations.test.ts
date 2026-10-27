// Owner: engine-score. Splitting spans into notatable, metrically conventional values.
import { describe, expect, it } from 'vitest'
import type { TimeSignature } from '../../types'
import { NOTE_VALUES, TIME_SIGNATURES, splitDuration, ticksPerMeasureOf } from './index'

describe('splitDuration', () => {
  it('keeps single values that show the meter', () => {
    expect(splitDuration(0, 16, '4/4')).toEqual([16])
    expect(splitDuration(0, 12, '4/4')).toEqual([12]) // dotted half from beat 1
    expect(splitDuration(0, 8, '4/4')).toEqual([8])
    expect(splitDuration(8, 8, '4/4')).toEqual([8])
    expect(splitDuration(0, 6, '4/4')).toEqual([6]) // dotted quarter on the beat
    expect(splitDuration(2, 4, '4/4')).toEqual([4]) // eighth syncopation across one beat
    expect(splitDuration(1, 3, '4/4')).toEqual([3])
    expect(splitDuration(0, 12, '3/4')).toEqual([12])
    expect(splitDuration(4, 8, '3/4')).toEqual([8])
    expect(splitDuration(0, 8, '2/4')).toEqual([8])
    expect(splitDuration(0, 12, '6/8')).toEqual([12])
    expect(splitDuration(6, 6, '6/8')).toEqual([6])
    expect(splitDuration(2, 4, '6/8')).toEqual([4])
  })

  it('never crosses the half-bar in 4/4 or the middle of a 6/8 bar', () => {
    expect(splitDuration(4, 8, '4/4')).toEqual([4, 4])
    expect(splitDuration(6, 4, '4/4')).toEqual([2, 2])
    expect(splitDuration(4, 6, '4/4')).toEqual([4, 2])
    expect(splitDuration(4, 12, '4/4')).toEqual([4, 8])
    expect(splitDuration(2, 6, '6/8')).toEqual([4, 2])
    expect(splitDuration(2, 8, '6/8')).toEqual([4, 4])
    expect(splitDuration(4, 4, '6/8')).toEqual([2, 2])
  })

  it('shows the beat for notes starting off the beat', () => {
    expect(splitDuration(1, 4, '4/4')).toEqual([3, 1])
    expect(splitDuration(0, 5, '4/4')).toEqual([4, 1])
    expect(splitDuration(0, 7, '4/4')).toEqual([4, 3])
    expect(splitDuration(0, 10, '4/4')).toEqual([8, 2])
    expect(splitDuration(0, 14, '4/4')).toEqual([8, 6])
    expect(splitDuration(0, 9, '6/8')).toEqual([6, 3])
  })

  it('writes rests by beats (half rests only on beat 1, or beat 3 in 4/4)', () => {
    expect(splitDuration(0, 16, '4/4', true)).toEqual([16])
    expect(splitDuration(0, 12, '4/4', true)).toEqual([8, 4])
    expect(splitDuration(4, 8, '4/4', true)).toEqual([4, 4])
    expect(splitDuration(8, 8, '4/4', true)).toEqual([8])
    expect(splitDuration(2, 4, '4/4', true)).toEqual([2, 2])
    expect(splitDuration(4, 8, '3/4', true)).toEqual([4, 4])
    expect(splitDuration(0, 12, '3/4', true)).toEqual([12])
    expect(splitDuration(0, 8, '2/4', true)).toEqual([8])
    expect(splitDuration(0, 12, '6/8', true)).toEqual([12])
    expect(splitDuration(0, 6, '6/8', true)).toEqual([6])
  })

  it('always tiles the span with notatable values, for every span of every meter', () => {
    const values = new Set(NOTE_VALUES)
    for (const ts of TIME_SIGNATURES as TimeSignature[]) {
      const tpm = ticksPerMeasureOf(ts)
      for (let s = 0; s < tpm; s++) {
        for (let e = s + 1; e <= tpm; e++) {
          for (const rest of [false, true]) {
            const pieces = splitDuration(s, e - s, ts, rest)
            expect(pieces.reduce((a, b) => a + b, 0)).toBe(e - s)
            expect(pieces.every((p) => values.has(p))).toBe(true)
            // A piece longer than the whole bar's half only when it is the dotted half from beat 1
            // or the full measure.
            let pos = s
            for (const p of pieces) {
              const crossesMiddle = ts === '4/4' ? pos < 8 && pos + p > 8 : ts === '6/8' ? pos < 6 && pos + p > 6 : false
              if (crossesMiddle) expect(p === tpm || (!rest && ts === '4/4' && pos === 0 && p === 12)).toBe(true)
              pos += p
            }
          }
        }
      }
    }
  })

  it('clamps out-of-range input instead of throwing', () => {
    expect(splitDuration(-3, 5, '4/4')).toEqual([2])
    expect(splitDuration(12, 40, '4/4')).toEqual([4])
    expect(splitDuration(4, 0, '4/4')).toEqual([])
    expect(splitDuration(Number.NaN, 4, '4/4')).toEqual([])
  })
})
