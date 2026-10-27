// Owner: library. UI state of the library screen. Lives for the session (search, chips, filters and
// sort survive a trip to the viewer and back); only the list/grid choice is remembered across visits.
import { create } from 'zustand'
import { NO_FILTERS, type QuickFilter, type SheetFilters, type SortKey } from './filters'

export type ViewMode = 'list' | 'grid'

const VIEW_KEY = 'pauta.library.view'

function readView(): ViewMode {
  try {
    return globalThis.localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

function writeView(view: ViewMode): void {
  try {
    globalThis.localStorage.setItem(VIEW_KEY, view)
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

interface LibraryUiState {
  query: string
  quick: QuickFilter
  filters: SheetFilters
  sort: SortKey
  view: ViewMode
  /** Window scroll of the list when the screen was left, and the history entry it belonged to. */
  scroll: { y: number; entry: string | null }
  setQuery: (query: string) => void
  setQuick: (quick: QuickFilter) => void
  setFilters: (filters: SheetFilters) => void
  setSort: (sort: SortKey) => void
  setView: (view: ViewMode) => void
  setScroll: (scroll: { y: number; entry: string | null }) => void
  /** Search, chip and sheet filters back to "everything" (sort and view are kept). */
  clearFilters: () => void
}

export const useLibraryUi = create<LibraryUiState>()((set) => ({
  query: '',
  quick: 'all',
  filters: NO_FILTERS,
  sort: 'recent',
  view: readView(),
  scroll: { y: 0, entry: null },
  setQuery: (query) => set({ query }),
  setQuick: (quick) => set({ quick }),
  setFilters: (filters) => set({ filters }),
  setSort: (sort) => set({ sort }),
  setView: (view) => {
    writeView(view)
    set({ view })
  },
  setScroll: (scroll) => set({ scroll }),
  clearFilters: () => set({ query: '', quick: 'all', filters: NO_FILTERS }),
}))
