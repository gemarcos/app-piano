// Owner: library. One library item, as a list row or a grid tile.
import { useState, type CSSProperties } from 'react'
import { DotsVertical, Heart } from '@untitled-ui/icons-react'
import type { NoteNaming, ScoreDoc } from '../../types'
import { getCover } from '../../assets/images'
import { keyName } from '../../engine/score'
import { formatTime } from '../../lib/format'
import { Cover, IconButton, cx, playUiSound, useLongPress } from '../../ui'
import './LibraryItems.css'

/** "Sol mayor" in the user's note naming ('none' reads like Do Re Mi). */
export function keyLabel(doc: ScoreDoc, naming: NoteNaming): string {
  return doc.summary?.key ? keyName(doc.summary.key, naming) : ''
}

/** "Sol mayor · 96 ppm · 1:12" */
export function metaLine(doc: ScoreDoc, naming: NoteNaming): string {
  const parts = [keyLabel(doc, naming)]
  if (doc.summary?.bpm) parts.push(`${Math.round(doc.summary.bpm)} ppm`)
  parts.push(formatTime(doc.durationSec))
  return parts.filter(Boolean).join(' · ')
}

export interface ItemProps {
  doc: ScoreDoc
  naming: NoteNaming
  onOpen: (doc: ScoreDoc) => void
  onMore: (doc: ScoreDoc) => void
  onToggleFavorite: (doc: ScoreDoc) => void
}

/** Heart toggle: outline, or filled in the accent when the item is a favourite (pops when set). */
function FavoriteButton({ doc, onToggle, className }: { doc: ScoreDoc; onToggle: () => void; className?: string }) {
  const [popped, setPopped] = useState(false)
  return (
    <IconButton
      icon={Heart}
      label={doc.favorite ? 'Quitar de favoritas' : 'Añadir a favoritas'}
      pressed={doc.favorite}
      size="sm"
      iconSize={20}
      className={cx('lib-fav', doc.favorite && 'is-fav', doc.favorite && popped && 'is-pop', className)}
      onClick={() => {
        setPopped(!doc.favorite)
        onToggle()
      }}
    />
  )
}

/** 56 px, 48 px on very narrow phones (--lib-cover in LibraryScreen.css; Cover sizes itself inline). */
const ROW_COVER: CSSProperties = { width: 'var(--lib-cover)', height: 'var(--lib-cover)' }

export function ScoreRow({ doc, naming, onOpen, onMore, onToggleFavorite }: ItemProps) {
  const longPress = useLongPress(() => onMore(doc))
  return (
    <div className="lib-row">
      <button type="button" className="lib-row__main" onClick={() => {
        playUiSound('tap')
        onOpen(doc)
      }} {...longPress}>
        <Cover src={getCover(doc.coverId)?.src} seed={doc.id} size={56} className="lib-row__cover" style={ROW_COVER} />
        <span className="lib-row__text">
          <span className="lib-row__title">{doc.title}</span>
          <span className="lib-row__meta tabular">{metaLine(doc, naming)}</span>
        </span>
      </button>
      <FavoriteButton doc={doc} onToggle={() => onToggleFavorite(doc)} />
      <IconButton icon={DotsVertical} label="Más opciones" size="sm" iconSize={20} className="lib-more" onClick={() => onMore(doc)} />
    </div>
  )
}

/** The tile's cover fills the card (Cover sizes itself inline from `size`). */
const TILE_COVER: CSSProperties = { width: '100%', height: '100%', borderRadius: 0 }

export function ScoreTile({ doc, naming, onOpen, onMore, onToggleFavorite }: ItemProps) {
  const longPress = useLongPress(() => onMore(doc))
  const key = keyLabel(doc, naming)
  return (
    <div className="lib-tile">
      <button type="button" className="lib-tile__main" onClick={() => {
        playUiSound('tap')
        onOpen(doc)
      }} {...longPress}>
        <Cover src={getCover(doc.coverId)?.src} seed={doc.id} size={200} className="lib-tile__cover" style={TILE_COVER} />
        <span className="lib-tile__caption">
          <span className="lib-tile__title">{doc.title}</span>
          {key && <span className="lib-tile__meta">{key}</span>}
        </span>
      </button>
      <FavoriteButton doc={doc} onToggle={() => onToggleFavorite(doc)} className="lib-tile__fav" />
      <IconButton icon={DotsVertical} label="Más opciones" size="sm" iconSize={18} className="lib-more lib-tile__more" onClick={() => onMore(doc)} />
    </div>
  )
}

const SKELETON_CHIPS = [72, 96, 116]

/**
 * Placeholder of the loaded layout (search pill, chips, rows or tiles). It fades in after a short delay,
 * so quick loads show nothing; the pulse stops when motion is reduced.
 */
export function LibrarySkeleton({ view }: { view: 'list' | 'grid' }) {
  return (
    <div className="lib-skeleton" aria-hidden="true">
      <span className="lib-skel-block lib-skel-block--search" />
      <span className="lib-skel-chips">
        {SKELETON_CHIPS.map((w) => (
          <span key={w} className="lib-skel-block lib-skel-block--chip" style={{ width: w }} />
        ))}
      </span>
      <span className={cx('lib-skel-items', view === 'grid' ? 'lib-grid' : 'lib-list')}>
        {[0, 1, 2, 3].map((i) =>
          view === 'grid' ? (
            <span key={i} className="lib-skel lib-skel--tile" />
          ) : (
            <span key={i} className="lib-skel-row">
              <span className="lib-skel lib-skel--cover" />
              <span className="lib-skel-row__text">
                <span className="lib-skel lib-skel--line" />
                <span className="lib-skel lib-skel--line lib-skel--short" />
              </span>
            </span>
          ),
        )}
      </span>
    </div>
  )
}
