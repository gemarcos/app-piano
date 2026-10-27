// Owner: library. Filter + sort sheet: difficulty, key, meter (multi choice) and sort order.
import type { ReactNode } from 'react'
import type { NoteNaming, ScoreDoc } from '../../types'
import { DIFFICULTY_LABELS, keyName } from '../../engine/score'
import { Button, Chip, Sheet } from '../../ui'
import {
  NO_FILTERS,
  SORT_OPTIONS,
  activeFilterCount,
  effectiveFilters,
  keyId,
  presentKeys,
  presentMeters,
  type DifficultyLevel,
} from './filters'
import { useLibraryUi } from './store'
import './FilterSheet.css'

const LEVELS: readonly DifficultyLevel[] = [1, 2, 3]

function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="lib-filter">
      <h3 className="lib-filter__title">{title}</h3>
      <div className="lib-filter__chips" role="group" aria-label={title}>
        {children}
      </div>
    </section>
  )
}

export interface FilterSheetProps {
  open: boolean
  onClose: () => void
  docs: readonly ScoreDoc[]
  naming: NoteNaming
}

export function FilterSheet({ open, onClose, docs, naming }: FilterSheetProps) {
  const filters = useLibraryUi((s) => s.filters)
  const sort = useLibraryUi((s) => s.sort)
  const setFilters = useLibraryUi((s) => s.setFilters)
  const setSort = useLibraryUi((s) => s.setSort)
  const current = effectiveFilters(filters, docs)
  const keys = presentKeys(docs)
  const meters = presentMeters(docs)
  const dirty = activeFilterCount(current) > 0 || sort !== 'recent'

  const reset = () => {
    setFilters(NO_FILTERS)
    setSort('recent')
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filtros"
      className="lib-sheet"
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={reset} disabled={!dirty}>
            Restablecer
          </Button>
          <Button size="lg" onClick={onClose}>
            Listo
          </Button>
        </>
      }
    >
      <Section title="Dificultad">
        {LEVELS.map((level) => (
          <Chip
            key={level}
            selected={current.difficulty.includes(level)}
            onClick={() => setFilters({ ...current, difficulty: toggled(current.difficulty, level) })}
          >
            {DIFFICULTY_LABELS[level]}
          </Chip>
        ))}
      </Section>

      {keys.length > 1 && (
        <Section title="Tonalidad">
          {keys.map((key) => {
            const id = keyId(key)
            return (
              <Chip key={id} selected={current.keys.includes(id)} onClick={() => setFilters({ ...current, keys: toggled(current.keys, id) })}>
                {keyName(key, naming)}
              </Chip>
            )
          })}
        </Section>
      )}

      {meters.length > 1 && (
        <Section title="Compás">
          {meters.map((ts) => (
            <Chip key={ts} selected={current.meters.includes(ts)} onClick={() => setFilters({ ...current, meters: toggled(current.meters, ts) })}>
              <span className="tabular">{ts}</span>
            </Chip>
          ))}
        </Section>
      )}

      <Section title="Ordenar por">
        {SORT_OPTIONS.map((opt) => (
          <Chip key={opt.value} selected={sort === opt.value} onClick={() => setSort(opt.value)}>
            {opt.label}
          </Chip>
        ))}
      </Section>
    </Sheet>
  )
}
