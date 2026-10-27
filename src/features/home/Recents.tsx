// Owner: capture. "Recientes" on Home: a horizontal row of cover cards (ref-3 "Popular Song" style).
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { getCover } from '../../assets/images'
import { keyName } from '../../engine/score'
import { useSettings } from '../../state/settings'
import type { NoteNaming, ScoreDoc } from '../../types'
import { Cover, SectionHeader, fadeUp, listContainer, listItem, spring, tapScale } from '../../ui'

const CARD = 148

function keyLabel(doc: ScoreDoc, naming: NoteNaming): string {
  try {
    return doc.summary?.key ? keyName(doc.summary.key, naming) : ''
  } catch {
    return ''
  }
}

function RecentCard({ doc, naming, onOpen }: { doc: ScoreDoc; naming: NoteNaming; onOpen: () => void }) {
  const key = keyLabel(doc, naming)
  return (
    <motion.button
      type="button"
      className="home-card"
      onClick={onOpen}
      whileTap={tapScale}
      transition={spring}
      aria-label={key ? `${doc.title}, ${key}` : doc.title}
    >
      <Cover src={getCover(doc.coverId)?.src} seed={doc.id} size={CARD} />
      <span className="home-card__caption" aria-hidden="true">
        <span className="home-card__title">{doc.title}</span>
        {key && <span className="home-card__key">{key}</span>}
      </span>
    </motion.button>
  )
}

/** `docs` is empty while the library loads: the row keeps its height and the cards fade in when they arrive. */
export function Recents({ docs }: { docs: ScoreDoc[] }) {
  const navigate = useNavigate()
  const naming = useSettings((s) => s.noteNaming)
  return (
    <motion.section className="home-recents" aria-label="Recientes" {...fadeUp(0.16, 10)}>
      <SectionHeader title="Recientes" />
      <motion.ul
        key={docs.length ? 'items' : 'loading'}
        className="home-recents__row"
        style={{ minHeight: CARD + 16 }}
        variants={listContainer}
        initial="hidden"
        animate="show"
      >
        {docs.map((doc) => (
          <motion.li key={doc.id} variants={listItem}>
            <RecentCard doc={doc} naming={naming} onOpen={() => navigate('/score/' + doc.id)} />
          </motion.li>
        ))}
      </motion.ul>
    </motion.section>
  )
}
