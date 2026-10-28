// Owner: library. Biblioteca: search, quick filters, filter/sort sheet, the index of works, item actions.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { FilterLines, Microphone01 } from '@untitled-ui/icons-react'
import { useAllScores } from '../../data/db'
import { isDemoSeedSettled, seedDemosOnce } from '../../data/seed'
import { useSettings } from '../../state/settings'
import { Button, Chip, ChipRow, EmptyState, IconButton, Page, SearchField, TopBar, ease } from '../../ui'
import { QUICK_FILTERS, activeFilterCount, applyFilters, effectiveFilters, sortDocs } from './filters'
import { FilterSheet } from './FilterSheet'
import { LibrarySkeleton, ScoreRow } from './LibraryItems'
import { useLibraryUi } from './store'
import { useScoreActions } from './useScoreActions'
import './LibraryScreen.css'

/**
 * Items animate themselves (variant propagation does not cross AnimatePresence): staggered rise on
 * entry by position, fade + slight shrink on exit while the others close the gap (popLayout).
 */
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { duration: 0.36, ease, delay: 0.02 + Math.min(i, 10) * 0.04 } }),
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.18, ease } },
}

/** False until the first-run demo seeding has finished, so a fresh library never flashes "empty". */
function useDemoSeed(): boolean {
  const [settled, setSettled] = useState(isDemoSeedSettled)
  useEffect(() => {
    if (settled) return
    let alive = true
    void seedDemosOnce().then(() => {
      if (alive) setSettled(true)
    })
    return () => {
      alive = false
    }
  }, [settled])
  return settled
}

/** react-router's id of the current history entry (null for the very first one). */
function historyEntry(): string | null {
  try {
    const key = (window.history.state as { key?: unknown } | null)?.key
    return typeof key === 'string' ? key : null
  } catch {
    return null
  }
}

/**
 * Coming back to the same history entry (back from the viewer) returns to the same place in the list;
 * arriving through the tab bar (a new entry) starts at the top. useNavigationType() cannot tell them
 * apart here: inside <Routes location> it always reports POP.
 */
function useScrollMemory(ready: boolean) {
  const [saved] = useState(() => useLibraryUi.getState().scroll)
  // This screen's own entry (by unmount time the history already points at the next screen).
  const [entry] = useState(historyEntry)
  const restored = useRef(false)
  // Layout cleanup: runs before the list leaves the DOM (a passive cleanup would read the next screen's scroll).
  useLayoutEffect(() => () => useLibraryUi.getState().setScroll({ y: window.scrollY, entry }), [entry])
  useLayoutEffect(() => {
    if (!ready || restored.current) return
    restored.current = true
    if (saved.y > 0 && saved.entry === entry) window.scrollTo(0, saved.y)
  }, [ready, saved, entry])
}

export function LibraryScreen() {
  const navigate = useNavigate()
  const scores = useAllScores()
  const seeded = useDemoSeed()
  const naming = useSettings((s) => s.noteNaming)
  const query = useLibraryUi((s) => s.query)
  const quick = useLibraryUi((s) => s.quick)
  const filters = useLibraryUi((s) => s.filters)
  const sort = useLibraryUi((s) => s.sort)
  const { setQuery, setQuick, clearFilters } = useLibraryUi.getState()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const actions = useScoreActions(scores)

  const loading = scores === undefined || !seeded
  const all = useMemo(() => scores ?? [], [scores])
  const current = useMemo(() => effectiveFilters(filters, all), [filters, all])
  const visible = useMemo(() => sortDocs(applyFilters(all, { query, quick, filters: current }), sort), [all, query, quick, current, sort])
  const empty = !loading && all.length === 0
  const filtered = activeFilterCount(current) > 0
  useScrollMemory(!loading)

  const itemProps = { naming, onOpen: actions.openScore, onMore: actions.openActions, onToggleFavorite: actions.toggleFavorite }

  return (
    <Page variant="tab" tabBar className="lib-page">
      <TopBar
        large
        title="Biblioteca"
        right={
          !loading && !empty ? (
            <span className="lib-filterbtn">
              <IconButton icon={FilterLines} label={filtered ? 'Filtros (activos)' : 'Filtros'} onClick={() => setFiltersOpen(true)} />
              {filtered && <span className="lib-filterbtn__dot" aria-hidden="true" />}
            </span>
          ) : undefined
        }
      />

      {loading ? (
        <LibrarySkeleton />
      ) : empty ? (
        <EmptyState
          className="lib-empty"
          title="Aún no hay partituras"
          description="Toca el disco en Inicio para escuchar una canción, o abre un archivo."
          action={{ label: 'Escuchar', icon: Microphone01, onClick: () => navigate('/') }}
        />
      ) : (
        <>
          <div className="lib-search">
            <SearchField value={query} onChange={setQuery} placeholder="Buscar" />
          </div>
          <ChipRow ariaLabel="Mostrar" className="lib-chips">
            {QUICK_FILTERS.map((f) => (
              <Chip key={f.value} selected={quick === f.value} onClick={() => setQuick(f.value)}>
                {f.label}
              </Chip>
            ))}
          </ChipRow>

          {visible.length === 0 ? (
            <EmptyState
              className="lib-noresults"
              title="Sin resultados"
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Borrar filtros
                </Button>
              }
            />
          ) : (
            <ul className="lib-list" aria-label="Partituras">
              <AnimatePresence mode="popLayout">
                {visible.map((doc, i) => (
                  <motion.li
                    key={doc.id}
                    layout="position"
                    custom={i}
                    variants={itemVariants}
                    initial="hidden"
                    animate="show"
                    exit="exit"
                    className="lib-item"
                  >
                    <ScoreRow doc={doc} {...itemProps} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </>
      )}

      <FilterSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} docs={all} naming={naming} />
      {actions.overlays}
    </Page>
  )
}
