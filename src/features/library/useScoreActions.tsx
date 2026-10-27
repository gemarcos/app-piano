// Owner: library. Per-item actions: overflow ActionSheet, rename, favourite, duplicate, export, delete.
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen01, Copy01, Download01, Edit02, Heart, Trash01 } from '@untitled-ui/icons-react'
import type { ScoreDoc } from '../../types'
import { deleteScore, duplicateScore, updateScore } from '../../data/db'
import { shareOrDownload } from '../../lib/download'
import { ActionSheet, ConfirmDialog, PromptDialog, useToast, type ActionSheetAction } from '../../ui'
import { EXPORT_FORMATS, exportFile, type ExportFormat } from './exports'

export interface ScoreActions {
  openScore: (doc: ScoreDoc) => void
  openActions: (doc: ScoreDoc) => void
  toggleFavorite: (doc: ScoreDoc) => void
  /** ActionSheet + dialogs; render once inside the screen. */
  overlays: ReactNode
}

const TITLE_MAX = 80

/** `scores` is the live library list: the sheet always shows the item's current state. */
export function useScoreActions(scores: readonly ScoreDoc[] | undefined): ScoreActions {
  const navigate = useNavigate()
  const toast = useToast()
  const [targetId, setTargetId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // Last known version of the target, so closing overlays still have a title after a delete.
  const lastTarget = useRef<ScoreDoc | null>(null)
  const live = targetId ? scores?.find((d) => d.id === targetId) : undefined
  if (live) lastTarget.current = live
  const target = live ?? lastTarget.current

  const openScore = useCallback((doc: ScoreDoc) => navigate('/score/' + doc.id), [navigate])

  const openActions = useCallback((doc: ScoreDoc) => {
    lastTarget.current = doc
    setTargetId(doc.id)
    setSheetOpen(true)
  }, [])

  const toggleFavorite = useCallback(
    (doc: ScoreDoc) => {
      // touch = false: a heart is not an edit (keeps updatedAt and the list order as they are).
      updateScore(doc.id, { favorite: !doc.favorite }, false).catch(() => toast.show('No se pudo guardar', { tone: 'danger' }))
    },
    [toast],
  )

  const duplicate = async (doc: ScoreDoc) => {
    try {
      const copy = await duplicateScore(doc.id)
      if (copy) toast.show('Partitura duplicada', { tone: 'success' })
    } catch {
      toast.show('No se pudo duplicar', { tone: 'danger' })
    }
  }

  const exportAs = async (doc: ScoreDoc, format: ExportFormat, label: string) => {
    try {
      const { blob, fileName } = exportFile(doc, format)
      const result = await shareOrDownload(blob, fileName, doc.title)
      if (result === 'downloaded') toast.show(`${label} descargado`, { tone: 'success' })
      else if (result === 'shared') toast.show('Partitura compartida', { tone: 'success' })
    } catch {
      toast.show('No se pudo exportar', { tone: 'danger' })
    }
  }

  const rename = async (title: string) => {
    setRenameOpen(false)
    if (!target || title === target.title) return
    try {
      await updateScore(target.id, { title: title.slice(0, TITLE_MAX) })
    } catch {
      toast.show('No se pudo renombrar', { tone: 'danger' })
    }
  }

  const remove = async () => {
    setDeleteOpen(false)
    if (!target) return
    try {
      await deleteScore(target.id)
      toast.show('Partitura eliminada')
    } catch {
      toast.show('No se pudo eliminar', { tone: 'danger' })
    }
  }

  const actions: ActionSheetAction[] = target
    ? [
        { key: 'open', label: 'Abrir', icon: BookOpen01, onSelect: () => openScore(target) },
        { key: 'rename', label: 'Renombrar', icon: Edit02, onSelect: () => setRenameOpen(true) },
        {
          key: 'favorite',
          label: target.favorite ? 'Quitar de favoritas' : 'Añadir a favoritas',
          icon: Heart,
          onSelect: () => toggleFavorite(target),
        },
        { key: 'duplicate', label: 'Duplicar', icon: Copy01, onSelect: () => void duplicate(target) },
        ...EXPORT_FORMATS.map(({ format, label }) => ({
          key: format,
          label: `Exportar ${label}`,
          icon: Download01,
          onSelect: () => void exportAs(target, format, label),
        })),
        { key: 'delete', label: 'Eliminar', icon: Trash01, tone: 'danger' as const, onSelect: () => setDeleteOpen(true) },
      ]
    : []

  const overlays = (
    <>
      <ActionSheet open={sheetOpen && target != null} onClose={() => setSheetOpen(false)} title={target?.title} actions={actions} />
      <PromptDialog
        open={renameOpen}
        title="Renombrar"
        initialValue={target?.title ?? ''}
        maxLength={TITLE_MAX}
        onConfirm={(value) => void rename(value)}
        onCancel={() => setRenameOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="¿Eliminar partitura?"
        message="No se puede deshacer."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={() => void remove()}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  )

  return { openScore, openActions, toggleFavorite, overlays }
}
