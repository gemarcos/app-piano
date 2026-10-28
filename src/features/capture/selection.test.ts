import { describe, expect, it } from 'vitest'
import {
  applySelectionEdit,
  defaultSelection,
  MAX_SELECTION_SEC,
  MIN_SELECTION_SEC,
  normalizeSelection,
  overallProgress,
  stageFor,
  titleFromFileName,
} from './selection'

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9

describe('defaultSelection', () => {
  it('takes whole songs (up to 5 minutes)', () => {
    expect(defaultSelection(6.104)).toEqual({ start: 0, end: 6.104 })
    expect(defaultSelection(163.1)).toEqual({ start: 0, end: 163.1 })
    expect(defaultSelection(300)).toEqual({ start: 0, end: 300 })
  })
  it('starts longer files with their first 5 minutes', () => {
    expect(defaultSelection(301)).toEqual({ start: 0, end: MAX_SELECTION_SEC })
    expect(defaultSelection(3600)).toEqual({ start: 0, end: MAX_SELECTION_SEC })
  })
  it('survives garbage', () => {
    expect(defaultSelection(NaN)).toEqual({ start: 0, end: 0 })
    expect(defaultSelection(-4)).toEqual({ start: 0, end: 0 })
  })
})

describe('applySelectionEdit', () => {
  const sel = { start: 10, end: 40 }
  it('moves one edge on the 50 ms grid', () => {
    const next = applySelectionEdit(sel, 'start', 12.34, 100)
    expect(close(next.start, 12.35)).toBe(true)
    expect(next.end).toBe(40)
  })
  it('keeps at least the minimum length', () => {
    expect(applySelectionEdit(sel, 'start', 39.5, 100).start).toBe(40 - MIN_SELECTION_SEC)
    expect(applySelectionEdit(sel, 'end', 0, 100).end).toBe(10 + MIN_SELECTION_SEC)
  })
  it('never exceeds the maximum length', () => {
    const wide = applySelectionEdit({ start: 100, end: 120 }, 'end', 900, 1000)
    expect(wide.end - wide.start).toBe(MAX_SELECTION_SEC)
    const left = applySelectionEdit({ start: 500, end: 600 }, 'start', 0, 1000)
    expect(left.end - left.start).toBe(MAX_SELECTION_SEC)
    expect(left.end).toBe(600)
  })
  it('stays inside the file and reaches its exact edges', () => {
    expect(applySelectionEdit(sel, 'start', -5, 100).start).toBe(0)
    expect(applySelectionEdit(sel, 'end', 99.99, 100).end).toBe(100)
    expect(applySelectionEdit({ start: 0, end: 3 }, 'end', 6.1, 6.104).end).toBe(6.104)
  })
  it('moves the whole window keeping its length', () => {
    const moved = applySelectionEdit(sel, 'move', 80, 100)
    expect(moved).toEqual({ start: 70, end: 100 })
    const back = applySelectionEdit(sel, 'move', -3, 100)
    expect(back).toEqual({ start: 0, end: 30 })
  })
  it('takes files shorter than the minimum whole', () => {
    expect(applySelectionEdit({ start: 0, end: 1.5 }, 'start', 1, 1.5)).toEqual({ start: 0, end: 1.5 })
  })
})

describe('normalizeSelection', () => {
  it('repairs out-of-range values', () => {
    expect(normalizeSelection({ start: -2, end: 500 }, 400)).toEqual({ start: 0, end: 300 })
    expect(normalizeSelection({ start: 29.5, end: 29.6 }, 30)).toEqual({ start: 28, end: 30 })
    expect(normalizeSelection({ start: NaN, end: NaN }, 30)).toEqual({ start: 0, end: 30 })
    expect(normalizeSelection(null, 30)).toEqual({ start: 0, end: 30 })
    expect(normalizeSelection(null, 600)).toEqual({ start: 0, end: 300 })
  })
})

describe('titleFromFileName', () => {
  it('drops the extension and the folders', () => {
    expect(titleFromFileName('scale.wav')).toBe('scale')
    expect(titleFromFileName('C:\\musica\\ensayo salón.mp4')).toBe('ensayo salón')
    expect(titleFromFileName('archivo.tar.gz')).toBe('archivo.tar')
    expect(titleFromFileName('.oculto')).toBe('.oculto')
    expect(titleFromFileName('  ')).toBe('')
  })
})

describe('progress', () => {
  it('maps the transcriber range into the pipeline range', () => {
    expect(overallProgress(0)).toBeGreaterThan(0)
    expect(overallProgress(1)).toBeLessThan(1)
    expect(overallProgress(0.5)).toBeGreaterThan(overallProgress(0.4))
    expect(overallProgress(NaN)).toBe(overallProgress(0))
  })
  it('names the stages', () => {
    expect(stageFor('loading-model')).toBe('preparing')
    expect(stageFor('analyzing')).toBe('listening')
    expect(stageFor('extracting-notes')).toBe('writing')
  })
})
