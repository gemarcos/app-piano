// Owner: viewer. Unit tests for the viewer's pure helpers.
import { describe, expect, it } from 'vitest'
import { buildScore } from '../../engine/score'
import { demoAnalysis, demoParams, findDemo } from '../../data/demos'
import type { Score } from '../../types'
import {
  abTap,
  balancedPerLine,
  buildTimeline,
  clampPitches,
  clampRange,
  eventIndexAt,
  formatSemitones,
  formatSpeed,
  loopBounds,
  measureAt,
  measureSeconds,
  nextMeasureTime,
  previousMeasureTime,
  scoreForHands,
  scoreSeconds,
} from './timeline'

const settings = { quantize: 16 as const, splitPoint: 60, defaultDifficulty: 'original' as const }

function demoScore(slug: string): Score {
  const demo = findDemo(slug)!
  return buildScore(demo.notes, { ...demoParams(demo, settings), difficulty: 'original' }, demoAnalysis(demo), demo.title)
}

describe('timeline', () => {
  const score = demoScore('oda-alegria')
  const [right, left] = buildTimeline(score)

  it('tiles every staff from tick 0 to the end without gaps', () => {
    const total = score.measureCount * score.ticksPerMeasure
    for (const staff of [right, left]) {
      expect(staff[0].start).toBe(0)
      for (let i = 1; i < staff.length; i++) expect(staff[i].start).toBe(staff[i - 1].end)
      expect(staff[staff.length - 1].end).toBe(total)
    }
  })

  it('keeps measure and in-measure indices', () => {
    const second = right.filter((e) => e.measure === 1)
    expect(second.map((e) => e.index)).toEqual(second.map((_, i) => i))
    expect(second[0].start).toBe(score.ticksPerMeasure)
  })

  it('finds the event sounding at a tick', () => {
    // Ode: four quarter notes in the first bar of the right hand (B B C D).
    expect(eventIndexAt(right, 0)).toBe(0)
    expect(eventIndexAt(right, 3.99)).toBe(0)
    expect(eventIndexAt(right, 4)).toBe(1)
    expect(right[eventIndexAt(right, 13)].pitches).toEqual([74])
    // Left hand: one whole-note chord in bar 1.
    expect(eventIndexAt(left, 15)).toBe(0)
    expect(eventIndexAt(right, -1)).toBe(-1)
    expect(eventIndexAt(right, score.measureCount * score.ticksPerMeasure)).toBe(-1)
  })
})

describe('measure navigation', () => {
  const score = demoScore('minueto-sol') // 3/4 at 112 bpm
  const md = measureSeconds(score)

  it('computes measure length and score length', () => {
    expect(md).toBeCloseTo((3 * 60) / 112, 6)
    expect(scoreSeconds(score)).toBeCloseTo(16 * md, 6)
  })

  it('finds the measure under a time', () => {
    expect(measureAt(score, 0)).toBe(0)
    expect(measureAt(score, md * 2.5)).toBe(2)
    expect(measureAt(score, md * 3)).toBe(3)
    expect(measureAt(score, 1e6)).toBe(15)
    expect(measureAt(score, -3)).toBe(0)
  })

  it('goes back to the start of the measure, or to the previous one near its start', () => {
    expect(previousMeasureTime(score, md * 2.6)).toBeCloseTo(md * 2, 6)
    expect(previousMeasureTime(score, md * 2 + 0.05)).toBeCloseTo(md, 6)
    expect(previousMeasureTime(score, 0)).toBe(0)
  })

  it('goes forward one measure and stops at the last', () => {
    expect(nextMeasureTime(score, md * 0.2)).toBeCloseTo(md, 6)
    expect(nextMeasureTime(score, md * 14.5)).toBeCloseTo(md * 15, 6)
    expect(nextMeasureTime(score, md * 15.5)).toBeNull()
  })
})

describe('loop', () => {
  const score = demoScore('oda-alegria')
  const md = measureSeconds(score)

  it('returns bounds for each mode', () => {
    expect(loopBounds(score, 'off', [1, 2])).toBeNull()
    expect(loopBounds(score, 'all', null)).toEqual([0, scoreSeconds(score)])
    expect(loopBounds(score, 'ab', null)).toBeNull()
    const ab = loopBounds(score, 'ab', [3, 1])!
    expect(ab[0]).toBeCloseTo(md, 6)
    expect(ab[1]).toBeCloseTo(4 * md, 6)
    const clamped = loopBounds(score, 'ab', [14, 40])!
    expect(clamped[1]).toBeCloseTo(16 * md, 6)
  })

  it('selects A-B ranges by tapping two measures', () => {
    let s = abTap(null, false, 5)
    expect(s).toEqual({ range: [5, 5], pending: true })
    s = abTap(s.range, s.pending, 2)
    expect(s).toEqual({ range: [2, 5], pending: false })
    s = abTap(s.range, s.pending, 9)
    expect(s).toEqual({ range: [9, 9], pending: true })
  })

  it('clamps stored ranges to the score', () => {
    expect(clampRange([12, 30], 16)).toEqual([12, 15])
    expect(clampRange([5, 2], 16)).toEqual([2, 5])
    expect(clampRange(null, 16)).toBeNull()
  })
})

describe('scores for layout and playback', () => {
  const score = demoScore('minueto-sol')

  it('hides one hand as rests for layout', () => {
    expect(scoreForHands(score, 'both')).toBe(score)
    const right = scoreForHands(score, 'right')
    expect(right.staves[0]).toBe(score.staves[0])
    expect(right.staves[1].measures.every((m) => m.events.length === 1 && m.events[0].pitches.length === 0)).toBe(true)
    expect(right.staves[1].measures).toHaveLength(score.measureCount)
  })

  it('leaves in-range scores untouched and drops pitches out of range', () => {
    expect(clampPitches(score, [21, 109])).toBe(score)
    const narrow = clampPitches(score, [60, 109])
    const leftPitches = narrow.staves[1].measures.flatMap((m) => m.events.flatMap((e) => e.pitches))
    expect(leftPitches.every((p) => p >= 60)).toBe(true)
    expect(narrow.staves[1].measures.map((m) => m.events.length)).toEqual(score.staves[1].measures.map((m) => m.events.length))
  })
})

describe('print layout', () => {
  it('avoids a lonely last system', () => {
    expect(balancedPerLine(16, 5)).toBe(4)
    expect(balancedPerLine(16, 4)).toBe(4)
    expect(balancedPerLine(8, 3)).toBe(3)
    expect(balancedPerLine(25, 5)).toBe(5)
    expect(balancedPerLine(9, 2)).toBe(2)
    expect(balancedPerLine(3, 5)).toBe(5)
    expect(balancedPerLine(13, 6)).toBe(5)
  })
})

describe('labels', () => {
  it('formats speed in Spanish', () => {
    expect(formatSpeed(100)).toBe('1×')
    expect(formatSpeed(75)).toBe('0,75×')
    expect(formatSpeed(150)).toBe('1,5×')
  })

  it('formats semitones with a sign', () => {
    expect(formatSemitones(2)).toBe('+2')
    expect(formatSemitones(0)).toBe('0')
    expect(formatSemitones(-3)).toBe('−3')
  })
})
