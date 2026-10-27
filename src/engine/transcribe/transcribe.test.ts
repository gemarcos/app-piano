import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  decoderParams,
  finalizeNotes,
  FRAME_ANCHORS,
  interpolateAnchors,
  MELODIA_FROM_SENSITIVITY,
  minNoteFrames,
  MODEL_FPS,
  ONSET_ANCHORS,
} from './params'

describe('sensitivity -> decoder thresholds', () => {
  it('hits the calibrated anchors', () => {
    for (const [s, i] of [
      [0, 0],
      [0.5, 1],
      [1, 2],
    ] as const) {
      const p = decoderParams({ sensitivity: s, minNoteMs: 90 })
      expect(p.onsetThreshold).toBeCloseTo(ONSET_ANCHORS[i])
      expect(p.frameThreshold).toBeCloseTo(FRAME_ANCHORS[i])
    }
  })

  it('lowers both thresholds monotonically as sensitivity rises', () => {
    let prev = decoderParams({ sensitivity: 0, minNoteMs: 90 })
    for (let s = 0.05; s <= 1.0001; s += 0.05) {
      const p = decoderParams({ sensitivity: s, minNoteMs: 90 })
      expect(p.onsetThreshold).toBeLessThan(prev.onsetThreshold)
      expect(p.frameThreshold).toBeLessThan(prev.frameThreshold)
      expect(p.onsetThreshold).toBeGreaterThan(p.frameThreshold)
      prev = p
    }
  })

  it('clamps out-of-range sensitivity and treats NaN as the default', () => {
    expect(decoderParams({ sensitivity: -3, minNoteMs: 90 }).onsetThreshold).toBeCloseTo(ONSET_ANCHORS[0])
    expect(decoderParams({ sensitivity: 7, minNoteMs: 90 }).onsetThreshold).toBeCloseTo(ONSET_ANCHORS[2])
    expect(decoderParams({ sensitivity: Number.NaN, minNoteMs: 90 }).onsetThreshold).toBeCloseTo(ONSET_ANCHORS[1])
    expect(interpolateAnchors([1, 0.5, 0], 0.25)).toBeCloseTo(0.75)
  })

  it('only enables the melodia pass at high sensitivity', () => {
    expect(decoderParams({ sensitivity: 0.5, minNoteMs: 90 }).melodiaTrick).toBe(false)
    expect(decoderParams({ sensitivity: MELODIA_FROM_SENSITIVITY, minNoteMs: 90 }).melodiaTrick).toBe(false)
    expect(decoderParams({ sensitivity: 0.95, minNoteMs: 90 }).melodiaTrick).toBe(true)
  })

  it('converts minNoteMs to model frames (notes must last longer than the result)', () => {
    expect(MODEL_FPS).toBeCloseTo(86.13, 2)
    expect(minNoteFrames(90)).toBe(7) // keeps notes >= 8 frames (93 ms)
    expect(minNoteFrames(58)).toBe(4)
    expect(minNoteFrames(0)).toBe(1)
    expect(minNoteFrames(-5)).toBe(1)
    expect(minNoteFrames(Number.NaN)).toBe(7)
    expect(minNoteFrames(500)).toBeGreaterThan(minNoteFrames(200))
  })
})

describe('finalizeNotes', () => {
  it('keeps the piano range, clamps velocity, rounds times and sorts', () => {
    const notes = finalizeNotes([
      { pitchMidi: 64, startTimeSeconds: 1.23456, durationSeconds: 0.5, amplitude: 1.4 },
      { pitchMidi: 60, startTimeSeconds: 1.23456, durationSeconds: 0.25, amplitude: 0.5 },
      { pitchMidi: 48, startTimeSeconds: 0.1, durationSeconds: 1, amplitude: -0.2 },
      { pitchMidi: 20, startTimeSeconds: 0.2, durationSeconds: 1, amplitude: 0.5 },
      { pitchMidi: 109, startTimeSeconds: 0.2, durationSeconds: 1, amplitude: 0.5 },
      { pitchMidi: 70, startTimeSeconds: Number.NaN, durationSeconds: 1, amplitude: 0.5 },
      { pitchMidi: 70, startTimeSeconds: 2, durationSeconds: 0, amplitude: 0.5 },
      { pitchMidi: 21, startTimeSeconds: -0.004, durationSeconds: 0.2, amplitude: 0.3 },
    ])
    expect(notes).toEqual([
      { pitch: 21, start: 0, duration: 0.2, velocity: 0.3 },
      { pitch: 48, start: 0.1, duration: 1, velocity: 0 },
      { pitch: 60, start: 1.235, duration: 0.25, velocity: 0.5 },
      { pitch: 64, start: 1.235, duration: 0.5, velocity: 1 },
    ])
  })
})

describe('bundle hygiene', () => {
  it('the main-thread client never imports tfjs / basic-pitch (only worker.ts does)', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const imports = source.match(/^\s*import\s[^;]*?from\s+['"][^'"]+['"]/gm) ?? []
    for (const line of imports) {
      expect(line.startsWith('import type') || !/tensorflow|basic-pitch|\.\/decode|\.\/worker/.test(line)).toBe(true)
    }
    expect(source).toContain("new Worker(new URL('./worker.ts', import.meta.url), { type: 'module'")
  })
})
