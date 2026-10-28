// Owner: library. UI state of the library screen. Lives for the session (search, chips, filters and
// sort survive a trip to the viewer and back).
import { create } from 'zustand'
import { NO_FILTERS, type QuickFilter, type SheetFilters, type SortKey } from './filters'

interface LibraryUiState {
  query: string
  quick: QuickFilter
  filters: SheetFilters
  sort: SortKey
  /** Window scroll of the list when the screen was left, and the history entry it belonged to. */
  scroll: { y: number; entry: string | null }
  setQuery: (query: string) => void
  setQuick: (quick: QuickFilter) => void
  setFilters: (filters: SheetFilters) => void
  setSort: (sort: SortKey) => void
  setScroll: (scroll: { y: number; entry: string | null }) => void
  /** Search, chip and sheet filters back to "everything" (sort is kept). */
  clearFilters: () => void
}

export const useLibraryUi = create<LibraryUiState>()((set) => ({
  query: '',
  quick: 'all',
  filters: NO_FILTERS,
  sort: 'recent',
  scroll: { y: 0, entry: null },
  setQuery: (query) => set({ query }),
  setQuick: (quick) => set({ quick }),
  setFilters: (filters) => set({ filters }),
  setSort: (sort) => set({ sort }),
  setScroll: (scroll) => set({ scroll }),
  clearFilters: () => set({ query: '', quick: 'all', filters: NO_FILTERS }),
}))
