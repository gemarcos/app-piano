// Owner: library. Search, quick filters, sheet filters and sort of the library list.
import { describe, expect, it } from 'vitest'
import type { KeySignature, ScoreDoc, ScoreSource, TimeSignature } from '../../types'
import {
  NO_FILTERS,
  activeFilterCount,
  applyFilters,
  effectiveFilters,
  keyId,
  matchesQuery,
  normalizeText,
  presentKeys,
  presentMeters,
  sortDocs,
} from './filters'

const G: KeySignature = { tonic: 'G', mode: 'major', fifths: 1 }
const C: KeySignature = { tonic: 'C', mode: 'major', fifths: 0 }
const Am: KeySignature = { tonic: 'A', mode: 'minor', fifths: 0 }
const Eb: KeySignature = { tonic: 'Eb', mode: 'major', fifths: -3 }

let n = 0
function doc(over: Partial<ScoreDoc> & { key?: KeySignature; ts?: TimeSignature; difficulty?: 1 | 2 | 3 } = {}): ScoreDoc {
  n++
  const { key = C, ts = '4/4', difficulty = 1, ...rest } = over
  return {
    id: `id-${n}`,
    title: `Pieza ${n}`,
    createdAt: n * 1000,
    updatedAt: n * 1000,
    source: 'mic' as ScoreSource,
    durationSec: 30,
    coverId: '',
    favorite: false,
    notes: [],
    analysis: { bpm: 100, bpmConfidence: 1, beatOffset: 0, timeSignature: ts, key, keyConfidence: 1 },
    params: {} as ScoreDoc['params'],
    summary: { key, bpm: 100, timeSignature: ts, difficulty, noteCount: 10, measureCount: 4 },
    ...rest,
  }
}

describe('search', () => {
  it('normalizes case, accents and spaces', () => {
    expect(normalizeText('  Oda a la  ALEGRÍA ')).toBe('oda a la alegria')
    expect(normalizeText('Pequeña canción')).toBe('pequena cancion')
  })

  it('matches every word in the title or the composer, accent-insensitive', () => {
    const oda = { title: 'Oda a la alegría', composer: 'L. van Beethoven' }
    expect(matchesQuery(oda, '')).toBe(true)
    expect(matchesQuery(oda, '   ')).toBe(true)
    expect(matchesQuery(oda, 'alegria')).toBe(true)
    expect(matchesQuery(oda, 'ALEGRÍA')).toBe(true)
    expect(matchesQuery(oda, 'beethoven oda')).toBe(true)
    expect(matchesQuery(oda, 'oda bach')).toBe(false)
    expect(matchesQuery({ title: 'Grabación 27 oct' }, 'grabacion')).toBe(true)
    expect(matchesQuery({ title: 'Grabación 27 oct' }, 'bach')).toBe(false)
  })
})

describe('quick filters', () => {
  const items = [
    doc({ source: 'mic', favorite: true }),
    doc({ source: 'tab' }),
    doc({ source: 'file' }),
    doc({ source: 'demo', favorite: true }),
    doc({ source: 'import' }),
  ]
  const count = (quick: Parameters<typeof applyFilters>[1]['quick']) => applyFilters(items, { query: '', quick, filters: NO_FILTERS }).length

  it('Todas, Favoritas, Grabaciones (mic + tab), Archivos, Ejemplos', () => {
    expect(count('all')).toBe(5)
    expect(count('favorites')).toBe(2)
    expect(count('recordings')).toBe(2)
    expect(count('files')).toBe(1)
    expect(count('demos')).toBe(1)
  })
})

describe('sheet filters', () => {
  const items = [
    doc({ key: G, ts: '3/4', difficulty: 1 }),
    doc({ key: G, ts: '4/4', difficulty: 2 }),
    doc({ key: C, ts: '4/4', difficulty: 3 }),
    doc({ key: Am, ts: '6/8', difficulty: 2 }),
    doc({ key: Eb, ts: '4/4', difficulty: 1 }),
  ]

  it('lists the keys present (majors then minors, by fifths) and the meters present', () => {
    expect(presentKeys(items).map(keyId)).toEqual(['major:-3', 'major:0', 'major:1', 'minor:0'])
    expect(presentMeters(items)).toEqual(['4/4', '3/4', '6/8'])
  })

  it('combines groups with AND and values within a group with OR', () => {
    const run = (filters: typeof NO_FILTERS) => applyFilters(items, { query: '', quick: 'all', filters }).map((d) => d.summary.difficulty)
    expect(run({ ...NO_FILTERS, difficulty: [2] })).toHaveLength(2)
    expect(run({ ...NO_FILTERS, difficulty: [1, 3] })).toHaveLength(3)
    expect(run({ ...NO_FILTERS, keys: [keyId(G)] })).toHaveLength(2)
    expect(run({ ...NO_FILTERS, keys: [keyId(G)], meters: ['4/4'] })).toEqual([2])
    expect(run({ difficulty: [3], keys: [keyId(G)], meters: [] })).toEqual([])
  })

  it('drops selected keys and meters that no item has anymore', () => {
    const filters = { difficulty: [2 as const], keys: [keyId(G), 'minor:5'], meters: ['2/4' as const, '3/4' as const] }
    expect(effectiveFilters(filters, items)).toEqual({ difficulty: [2], keys: [keyId(G)], meters: ['3/4'] })
    expect(activeFilterCount(effectiveFilters(filters, items))).toBe(3)
    expect(activeFilterCount(effectiveFilters({ ...NO_FILTERS, keys: ['minor:5'] }, items))).toBe(0)
  })
})

describe('sort', () => {
  const a = doc({ title: 'Zeta', createdAt: 3000, durationSec: 50, difficulty: 2, openedAt: 10 })
  const b = doc({ title: 'alfa', createdAt: 1000, durationSec: 20, difficulty: 3 })
  const c = doc({ title: 'Ábaco 10', createdAt: 2000, durationSec: 20, difficulty: 1, openedAt: 99 })
  const d = doc({ title: 'Ábaco 9', createdAt: 2000, durationSec: 90, difficulty: 1 })
  const items = [a, b, c, d]
  const titles = (sort: Parameters<typeof sortDocs>[1]) => sortDocs(items, sort).map((x) => x.title)

  it('Recientes: newest first by creation, ties by title', () => {
    expect(titles('recent')).toEqual(['Zeta', 'Ábaco 9', 'Ábaco 10', 'alfa'])
  })

  it('Abiertas recientemente: last opened first, then never-opened newest first', () => {
    expect(titles('opened')).toEqual(['Ábaco 10', 'Zeta', 'Ábaco 9', 'alfa'])
  })

  it('Título A-Z: Spanish collation, accents and case ignored, numbers in order', () => {
    expect(titles('title')).toEqual(['Ábaco 9', 'Ábaco 10', 'alfa', 'Zeta'])
  })

  it('Duración: shortest first; Dificultad: easiest first', () => {
    expect(titles('duration')).toEqual(['Ábaco 10', 'alfa', 'Zeta', 'Ábaco 9'])
    expect(titles('difficulty')).toEqual(['Ábaco 9', 'Ábaco 10', 'Zeta', 'alfa'])
  })

  it('does not mutate its input', () => {
    const copy = [...items]
    sortDocs(items, 'title')
    expect(items).toEqual(copy)
  })
})
