// Owner: library. Pure search / filter / sort logic of the library list (no React, no DOM).
import type { KeySignature, ScoreDoc, TimeSignature } from '../../types'
import { TIME_SIGNATURES } from '../../engine/score'

/** Chip filters above the list (single choice). */
export type QuickFilter = 'all' | 'favorites' | 'recordings' | 'files' | 'demos'

export const QUICK_FILTERS: readonly { value: QuickFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'favorites', label: 'Favoritas' },
  { value: 'recordings', label: 'Grabaciones' },
  { value: 'files', label: 'Archivos' },
  { value: 'demos', label: 'Ejemplos' },
]

export type SortKey = 'recent' | 'opened' | 'title' | 'duration' | 'difficulty'

export const SORT_OPTIONS: readonly { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Recientes' },
  { value: 'opened', label: 'Abiertas recientemente' },
  { value: 'title', label: 'Título A-Z' },
  { value: 'duration', label: 'Duración' },
  { value: 'difficulty', label: 'Dificultad' },
]

export type DifficultyLevel = 1 | 2 | 3

/** Filters of the filter sheet (multi choice; an empty list means "any"). */
export interface SheetFilters {
  difficulty: DifficultyLevel[]
  /** keyId() values. */
  keys: string[]
  meters: TimeSignature[]
}

export const NO_FILTERS: SheetFilters = { difficulty: [], keys: [], meters: [] }

/** Lowercase, without accents or repeated spaces: "Oda a la Alegría " -> "oda a la alegria". */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every word of the query appears in the title or the composer (accent and case insensitive). */
export function matchesQuery(doc: Pick<ScoreDoc, 'title' | 'composer'>, query: string): boolean {
  const words = normalizeText(query).split(' ').filter(Boolean)
  if (words.length === 0) return true
  const haystack = normalizeText(`${doc.title} ${doc.composer ?? ''}`)
  return words.every((w) => haystack.includes(w))
}

export function matchesQuick(doc: Pick<ScoreDoc, 'favorite' | 'source'>, quick: QuickFilter): boolean {
  switch (quick) {
    case 'favorites':
      return doc.favorite
    case 'recordings':
      return doc.source === 'mic' || doc.source === 'tab'
    case 'files':
      return doc.source === 'file'
    case 'demos':
      return doc.source === 'demo'
    default:
      return true
  }
}

/** Stable id of a key for filtering: 'major:1' (Sol mayor), 'minor:-3' (Do menor). */
export function keyId(key: Pick<KeySignature, 'mode' | 'fifths'>): string {
  return `${key.mode}:${key.fifths}`
}

/** Distinct keys in the library: majors then minors, each by circle of fifths. */
export function presentKeys(docs: readonly ScoreDoc[]): KeySignature[] {
  const byId = new Map<string, KeySignature>()
  for (const d of docs) {
    const key = d.summary?.key
    if (key && !byId.has(keyId(key))) byId.set(keyId(key), key)
  }
  return [...byId.values()].sort((a, b) => (a.mode === b.mode ? a.fifths - b.fifths : a.mode === 'major' ? -1 : 1))
}

/** Distinct meters in the library, in TIME_SIGNATURES order. */
export function presentMeters(docs: readonly ScoreDoc[]): TimeSignature[] {
  const seen = new Set(docs.map((d) => d.summary?.timeSignature))
  return TIME_SIGNATURES.filter((ts) => seen.has(ts))
}

/**
 * Drops selected keys and meters that no item has anymore (e.g. after a delete), so a filter can never
 * hide everything while its chip is gone from the sheet.
 */
export function effectiveFilters(filters: SheetFilters, docs: readonly ScoreDoc[]): SheetFilters {
  const keys = new Set(presentKeys(docs).map(keyId))
  const meters = new Set(presentMeters(docs))
  return {
    difficulty: filters.difficulty,
    keys: filters.keys.filter((k) => keys.has(k)),
    meters: filters.meters.filter((m) => meters.has(m)),
  }
}

/** Number of sheet filter groups in use (drives the dot on the filter button). */
export function activeFilterCount(filters: SheetFilters): number {
  return (filters.difficulty.length > 0 ? 1 : 0) + (filters.keys.length > 0 ? 1 : 0) + (filters.meters.length > 0 ? 1 : 0)
}

export function matchesSheet(doc: ScoreDoc, filters: SheetFilters): boolean {
  const s = doc.summary
  if (filters.difficulty.length > 0 && !(s && filters.difficulty.includes(s.difficulty))) return false
  if (filters.keys.length > 0 && !(s?.key && filters.keys.includes(keyId(s.key)))) return false
  if (filters.meters.length > 0 && !(s && filters.meters.includes(s.timeSignature))) return false
  return true
}

export interface LibraryQuery {
  query: string
  quick: QuickFilter
  filters: SheetFilters
}

export function applyFilters(docs: readonly ScoreDoc[], { query, quick, filters }: LibraryQuery): ScoreDoc[] {
  return docs.filter((d) => matchesQuick(d, quick) && matchesSheet(d, filters) && matchesQuery(d, query))
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

const byTitle = (a: ScoreDoc, b: ScoreDoc) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id)
const byNewest = (a: ScoreDoc, b: ScoreDoc) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || byTitle(a, b)

/**
 * recent: newest first (createdAt, so editing or favouriting never reorders the list); opened: last opened
 * first, never-opened items after them (newest first); title: A-Z (Spanish collation, numbers in order);
 * duration: shortest first; difficulty: easiest first. Returns a new array.
 */
export function sortDocs(docs: readonly ScoreDoc[], sort: SortKey): ScoreDoc[] {
  const out = [...docs]
  switch (sort) {
    case 'opened':
      return out.sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0) || byNewest(a, b))
    case 'title':
      return out.sort(byTitle)
    case 'duration':
      return out.sort((a, b) => (a.durationSec ?? 0) - (b.durationSec ?? 0) || byTitle(a, b))
    case 'difficulty':
      return out.sort((a, b) => (a.summary?.difficulty ?? 0) - (b.summary?.difficulty ?? 0) || byTitle(a, b))
    default:
      return out.sort(byNewest)
  }
}
