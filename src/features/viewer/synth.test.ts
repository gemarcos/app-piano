import { describe, expect, it } from 'vitest'
import { darkening, dynamicDb, layerFor, lowpassFor, neededSamples, registerDb, strikeOf } from './synth'
import { SAMPLE_NOTES, classicFile, sampleFile, sampleNoteFor } from './pianoSamples'

describe('dynamics to sound', () => {
  it('maps the dynamic level to loudness smoothly and monotonically (mezzo forte = 0 dB)', () => {
    expect(dynamicDb(0.55)).toBeCloseTo(0, 6)
    let prev = -Infinity
    for (let d = 0; d <= 1.0001; d += 0.01) {
      const db = dynamicDb(d)
      expect(db).toBeGreaterThan(prev)
      if (prev > -Infinity) expect(db - prev).toBeLessThan(0.35)
      prev = db
    }
  })

  it('picks the layer from how hard the key is struck, never duller than the recording at that velocity', () => {
    expect(layerFor(0.2)).toBe(4)
    expect(layerFor(0.34)).toBe(4)
    expect(layerFor(0.35)).toBe(9)
    expect(layerFor(0.57)).toBe(9)
    expect(layerFor(0.58)).toBe(14)
    expect(layerFor(0.9)).toBe(14)
    // The strike is the higher of the note's velocity and its dynamic level.
    expect(strikeOf({ dynamic: 0.5, velocity: 0.7 })).toBe(0.7)
    expect(strikeOf({ dynamic: 0.6 })).toBe(0.6)
  })

  it('keeps mezzo and forte notes at their natural brightness; only pianissimo softens', () => {
    expect(darkening(0.25)).toBe(0)
    expect(darkening(0.6)).toBe(0)
    expect(darkening(0.1)).toBeGreaterThan(0)
    expect(lowpassFor(0.55, 60, 32000)).toBe(1)
    expect(lowpassFor(0.9, 60, 32000)).toBe(1)
    expect(lowpassFor(0.1, 60, 32000)).toBeLessThan(1)
    expect(lowpassFor(0.05, 60, 32000)).toBeLessThan(lowpassFor(0.2, 60, 32000))
  })

  it('lifts the upper register a little, never more than 4.5 dB', () => {
    expect(registerDb(60)).toBe(0)
    expect(registerDb(84)).toBeGreaterThan(2)
    expect(registerDb(108)).toBe(4.5)
  })
})

describe('samples', () => {
  it('plays every piano key from a recorded note at most one semitone away', () => {
    for (let m = 21; m <= 108; m++) expect(Math.abs(sampleNoteFor(m).midi - m)).toBeLessThanOrEqual(1)
    expect(SAMPLE_NOTES).toHaveLength(30)
  })

  it('names the classic samples by key with flat names, within A0..Db8', () => {
    expect(classicFile(60)).toBe('C4.mp3')
    expect(classicFile(61)).toBe('Db4.mp3')
    expect(classicFile(21)).toBe('A0.mp3')
    expect(classicFile(70)).toBe('Bb4.mp3')
    expect(classicFile(112)).toBe('Db8.mp3')
  })

  it('asks only for the files a score needs', () => {
    const files = neededSamples([
      { pitch: 60, start: 0, release: 1, tau: 0.1, dynamic: 0.55 },
      { pitch: 61, start: 1, release: 2, tau: 0.1, dynamic: 0.5 },
      { pitch: 61, start: 2, release: 3, tau: 0.1, dynamic: 0.2 },
    ])
    expect([...files].sort()).toEqual([sampleFile(sampleNoteFor(60), 4), sampleFile(sampleNoteFor(60), 9)].sort())
  })
})
