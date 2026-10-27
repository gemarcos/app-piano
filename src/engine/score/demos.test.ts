// Owner: engine-score. The three public-domain demos: accurate data and clean notation.
import abcjs from 'abcjs'
import { describe, expect, it } from 'vitest'
import type { Score } from '../../types'
import { DEMO_ID_PREFIX, demoAnalysis, demoParams, demoPieces, findDemo, parsePitch, voice } from '../../data/demos'
import { analyzeNotes, buildScore, keyName, scoreToAbc, suggestMeasuresPerLine } from './index'
import { staffNotes } from './test-helpers'

const settings = { quantize: 16 as const, splitPoint: 60, defaultDifficulty: 'original' as const }
const scoreOf = (slug: string, over: Partial<ReturnType<typeof demoParams>> = {}): Score => {
  const demo = findDemo(slug)!
  return buildScore(demo.notes, { ...demoParams(demo, settings), ...over }, demoAnalysis(demo), demo.title)
}
const ticksOf = (seconds: number, bpm: number) => Math.round((seconds * bpm * 4) / 60)

describe('demo data', () => {
  it('lists the three pieces with stable ids', () => {
    expect(demoPieces.map((d) => d.slug)).toEqual(['oda-alegria', 'minueto-sol', 'preludio-do'])
    expect(demoPieces.map((d) => `${d.title} - ${d.composer}`)).toEqual([
      'Oda a la alegría - L. van Beethoven',
      'Minueto en Sol mayor - C. Petzold',
      'Preludio en Do mayor - J. S. Bach',
    ])
    expect(findDemo(DEMO_ID_PREFIX + 'minueto-sol')?.slug).toBe('minueto-sol')
    expect(findDemo('preludio-do')?.bpm).toBe(66)
    expect(findDemo('demo-nada')).toBeUndefined()
  })

  it('has well-formed notes: piano range, velocities 0.6-0.9, first downbeat at 0', () => {
    for (const demo of demoPieces) {
      expect(demo.notes.length).toBeGreaterThan(40)
      expect(Math.min(...demo.notes.map((n) => n.start))).toBe(0)
      for (const n of demo.notes) {
        expect(Number.isInteger(n.pitch) && n.pitch >= 21 && n.pitch <= 108).toBe(true)
        expect(n.velocity).toBeGreaterThanOrEqual(0.6)
        expect(n.velocity).toBeLessThanOrEqual(0.9)
        expect(n.duration).toBeGreaterThan(0)
        // Exact rhythm: every onset and length is a whole number of sixteenths.
        const t = (n.start * demo.bpm * 4) / 60
        expect(Math.abs(t - Math.round(t))).toBeLessThan(1e-4)
      }
      for (let i = 1; i < demo.notes.length; i++) expect(demo.notes[i].start).toBeGreaterThanOrEqual(demo.notes[i - 1].start)
    }
  })

  it('parses the compact notation', () => {
    expect([parsePitch('C4'), parsePitch('F#4'), parsePitch('Bb3'), parsePitch('A0')]).toEqual([60, 66, 58, 21])
    expect(() => parsePitch('H2')).toThrow()
    const v = voice('G3+B3:8 r:4 A3:4 | B3:12', { bpm: 60, timeSignature: '3/4' })
    expect(v.map((n) => [n.pitch, n.start, n.duration])).toEqual([
      [55, 0, 2],
      [59, 0, 2],
      [57, 3, 1],
      [59, 4, 3],
    ])
  })
})

describe('demo notation', () => {
  const expected = {
    'oda-alegria': { bars: 16, ts: '4/4', key: 'Sol mayor', bpm: 100 },
    'minueto-sol': { bars: 16, ts: '3/4', key: 'Sol mayor', bpm: 112 },
    'preludio-do': { bars: 8, ts: '4/4', key: 'Do mayor', bpm: 66 },
  } as const

  it('builds the expected measures, meter, key and tempo', () => {
    for (const demo of demoPieces) {
      const score = scoreOf(demo.slug)
      const want = expected[demo.slug as keyof typeof expected]
      expect(score.measureCount, demo.slug).toBe(want.bars)
      expect(score.timeSignature).toBe(want.ts)
      expect(keyName(score.key, 'latin')).toBe(want.key)
      expect(score.bpm).toBe(want.bpm)
      expect(score.startSeconds).toBe(0)
      expect(score.title).toBe(demo.title)
    }
  })

  it('keeps every note at its onset, on the staff of its written hand', () => {
    for (const demo of demoPieces) {
      const score = scoreOf(demo.slug)
      const split = demo.splitPoint ?? settings.splitPoint
      const onsets = (notes: { pitch: number; start: number }[]) => notes.map((n) => `${n.pitch}@${n.start}`).sort()
      const raw = demo.notes.map((n) => ({ pitch: n.pitch, start: ticksOf(n.start, demo.bpm) }))
      expect(onsets(staffNotes(score, 0)), `${demo.slug} RH`).toEqual(onsets(raw.filter((n) => n.pitch >= split)))
      expect(onsets(staffNotes(score, 1)), `${demo.slug} LH`).toEqual(onsets(raw.filter((n) => n.pitch < split)))
      expect(score.stats.noteCount).toBe(demo.notes.length)
    }
  })

  it('writes the Ode and the Minuet with their exact rhythms (no ties, nothing cut)', () => {
    for (const slug of ['oda-alegria', 'minueto-sol']) {
      const demo = findDemo(slug)!
      const score = scoreOf(slug)
      const events = score.staves.flatMap((s) => s.measures.flatMap((m) => m.events))
      expect(events.some((e) => e.tie)).toBe(false)
      expect(events.some((e) => e.duration === 1 || e.duration === 3)).toBe(false) // no sixteenths
      const written = demo.notes.map((n) => `${n.pitch}@${ticksOf(n.start, demo.bpm)}+${ticksOf(n.duration, demo.bpm)}`).sort()
      const notated = [...staffNotes(score, 0), ...staffNotes(score, 1)].map((n) => `${n.pitch}@${n.start}+${n.ticks}`).sort()
      expect(notated, slug).toEqual(written)
    }
  })

  it('writes the Prelude as half-note basses under a sixteenth figure', () => {
    const score = scoreOf('preludio-do')
    for (const m of score.staves[1].measures.slice(0, 7)) expect(m.events.map((e) => e.duration)).toEqual([8, 8])
    for (const m of score.staves[0].measures) {
      const notes = m.events.filter((e) => e.pitches.length > 0)
      expect(notes.every((e) => e.duration === 1 && e.pitches.length === 1)).toBe(true)
    }
    // Bar 8 as written: eighth rest + E G C E G C in the right hand, B3 + C4 in the left.
    expect(score.staves[0].measures[7].events.map((e) => (e.pitches.length ? e.pitches[0] : 'z'))).toEqual(['z', 64, 67, 72, 64, 67, 72, 'z', 64, 67, 72, 64, 67, 72])
    expect(score.staves[1].measures[7].events.map((e) => [e.pitches[0], e.duration])).toEqual([
      [59, 1],
      [60, 3],
      [60, 4],
      [59, 1],
      [60, 3],
      [60, 4],
    ])
  })

  it('names every note of the Ode and Minuet, and one note per beat in the Prelude runs', () => {
    const namesPerBar = (slug: string, voice: 'RH' | 'LH') =>
      scoreToAbc(scoreOf(slug), { noteNaming: 'latin', measuresPerLine: 1 })
        .split('\n')
        .filter((l) => l.startsWith(`[V:${voice}]`))
        .map((l) => (l.match(/"_/g) ?? []).length)
    const noteEventsPerBar = (slug: string, staff: 0 | 1) =>
      scoreOf(slug).staves[staff].measures.map((m) => m.events.filter((e) => e.pitches.length > 0).length)
    for (const slug of ['oda-alegria', 'minueto-sol']) {
      // Chords stack one name per note, so count names per chord note in the left hand.
      expect(namesPerBar(slug, 'RH'), slug).toEqual(noteEventsPerBar(slug, 0))
    }
    expect(namesPerBar('preludio-do', 'RH')).toEqual([4, 4, 4, 4, 4, 4, 4, 4])
    expect(namesPerBar('preludio-do', 'LH').slice(0, 7)).toEqual([2, 2, 2, 2, 2, 2, 2])
  })

  it('suggests one bar per line for the Prelude on a phone and two for the others', () => {
    const per = (slug: string, width: number, noteNames = true) => suggestMeasuresPerLine(scoreOf(slug), width, { noteNames })
    expect([per('oda-alegria', 330), per('minueto-sol', 330), per('preludio-do', 330)]).toEqual([2, 2, 1])
    expect(per('oda-alegria', 440)).toBe(3)
    expect(per('oda-alegria', 330, false)).toBe(3)
    expect(suggestMeasuresPerLine(scoreOf('oda-alegria'), 330, { noteNames: true, zoom: 1.6 })).toBe(1)
    expect(suggestMeasuresPerLine(buildScore([], demoParams(demoPieces[0], settings), demoAnalysis(demoPieces[0])), 330)).toBe(8)
  })

  it('renders through abcjs without warnings, with and without note names', () => {
    for (const demo of demoPieces) {
      for (const noteNaming of ['none', 'latin', 'english'] as const) {
        for (const hands of ['both', 'right', 'left'] as const) {
          const [tune] = abcjs.parseOnly(scoreToAbc(scoreOf(demo.slug), { noteNaming, hands, measuresPerLine: 2 }))
          expect((tune as unknown as { warnings?: string[] }).warnings ?? [], `${demo.slug} ${noteNaming} ${hands}`).toEqual([])
        }
      }
    }
  })

  it('simplifies cleanly in every difficulty and survives transposition', () => {
    for (const demo of demoPieces) {
      const full = scoreOf(demo.slug)
      for (const difficulty of ['intermedio', 'facil'] as const) {
        const easy = scoreOf(demo.slug, { difficulty })
        expect(easy.measureCount).toBe(full.measureCount)
        expect(easy.stats.noteCount).toBeLessThanOrEqual(full.stats.noteCount)
        expect(easy.stats.difficulty).toBeLessThanOrEqual(full.stats.difficulty)
      }
      for (const transpose of [-12, -5, 2, 7, 12]) {
        const moved = scoreOf(demo.slug, { transpose })
        expect(moved.stats.noteCount).toBe(full.stats.noteCount)
        const [tune] = abcjs.parseOnly(scoreToAbc(moved, { noteNaming: 'latin' }))
        expect((tune as unknown as { warnings?: string[] }).warnings ?? []).toEqual([])
      }
    }
  })
})

describe('demo analysis', () => {
  it('recovers tempo, meter and key of the Ode and the Minuet, and the key of the Prelude', () => {
    const ode = analyzeNotes(findDemo('oda-alegria')!.notes)
    expect([ode.bpm, ode.timeSignature, keyName(ode.key, 'latin'), ode.beatOffset]).toEqual([100, '4/4', 'Sol mayor', 0])
    const minuet = analyzeNotes(findDemo('minueto-sol')!.notes)
    expect([minuet.bpm, minuet.timeSignature, keyName(minuet.key, 'latin'), minuet.beatOffset]).toEqual([112, '3/4', 'Sol mayor', 0])
    const prelude = analyzeNotes(findDemo('preludio-do')!.notes)
    expect(keyName(prelude.key, 'latin')).toBe('Do mayor')
  })

  it('demoAnalysis pins the known values', () => {
    for (const demo of demoPieces) {
      const a = demoAnalysis(demo)
      expect(a).toMatchObject({ bpm: demo.bpm, bpmConfidence: 1, beatOffset: 0, timeSignature: demo.timeSignature, keyConfidence: 1 })
      expect(a.key).toEqual(demo.key)
      expect(demoParams(demo, settings).splitPoint).toBe(demo.splitPoint)
    }
  })
})
