// Owner: viewer. Settings sheet of the viewer, with Reproducción / Partitura / Filtros tabs.
// The scrim is lighter than usual so the score can be seen re-rendering behind the sheet.
import { AnimatePresence, motion } from 'motion/react'
import { Segmented, Sheet, ease, type SegmentedOption } from '../../ui'
import { FiltersPanel, NotationPanel, PlaybackPanel, type FiltersPanelProps, type NotationPanelProps, type PlaybackPanelProps } from './SettingsPanels'
import './SettingsSheet.css'

export type SheetTab = 'play' | 'score' | 'filters'

const TABS: SegmentedOption<SheetTab>[] = [
  { value: 'play', label: 'Reproducción' },
  { value: 'score', label: 'Partitura' },
  { value: 'filters', label: 'Filtros' },
]

export interface SettingsSheetProps {
  open: boolean
  tab: SheetTab
  onTab: (tab: SheetTab) => void
  onClose: () => void
  playback: PlaybackPanelProps
  notation: NotationPanelProps
  filters: FiltersPanelProps
}

export function SettingsSheet({ open, tab, onTab, onClose, playback, notation, filters }: SettingsSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Ajustes" className="vw-sheet">
      <div className="vw-sheet__tabs">
        <Segmented full options={TABS} value={tab} onChange={onTab} ariaLabel="Sección de ajustes" />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          className="vw-sheet__panel"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease } }}
          exit={{ opacity: 0, transition: { duration: 0.12, ease } }}
        >
          {tab === 'play' && <PlaybackPanel {...playback} />}
          {tab === 'score' && <NotationPanel {...notation} />}
          {tab === 'filters' && <FiltersPanel {...filters} />}
        </motion.div>
      </AnimatePresence>
    </Sheet>
  )
}
