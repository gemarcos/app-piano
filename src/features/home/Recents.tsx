// Owner: capture. "Recientes" on Home: the last pieces as a short list (title, key, length), like an index of works.
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { keyName } from '../../engine/score'
import { formatTime } from '../../lib/format'
import { useSettings } from '../../state/settings'
import type { NoteNaming, ScoreDoc } from '../../types'
import { SectionHeader, fadeUp, playUiSound } from '../../ui'

/** Rows kept on Home; the rest live in Biblioteca. */
export const RECENT_ROWS = 3

function keyLabel(doc: ScoreDoc, naming: NoteNaming): string {
  try {
    return doc.summary?.key ? keyName(doc.summary.key, naming) : ''
  } catch {
    return ''
  }
}

/** `docs` is empty while the library loads: the list keeps its height and the rows fade in when they arrive. */
export function Recents({ docs }: { docs: ScoreDoc[] }) {
  const navigate = useNavigate()
  const naming = useSettings((s) => s.noteNaming)
  return (
    <motion.section className="home-recents" aria-label="Recientes" {...fadeUp(0.16, 6)}>
      <SectionHeader title="Recientes" action={{ label: 'Ver todo', onClick: () => navigate('/library') }} />
      <ul className="home-recents__list" style={{ minHeight: RECENT_ROWS * 57 }}>
        {docs.slice(0, RECENT_ROWS).map((doc) => {
          const meta = [keyLabel(doc, naming), doc.durationSec ? formatTime(doc.durationSec) : ''].filter(Boolean).join(' · ')
          return (
            <li key={doc.id}>
              <button
                type="button"
                className="home-recent"
                onClick={() => {
                  playUiSound('tap')
                  navigate('/score/' + doc.id)
                }}
              >
                <span className="home-recent__title">{doc.title}</span>
                {meta && <span className="home-recent__meta">{meta}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </motion.section>
  )
}
