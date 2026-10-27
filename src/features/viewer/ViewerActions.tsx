// Owner: viewer. Overflow menu of the viewer: rename, exports, share, duplicate and delete.
// Toast wording matches the library's (same actions, same messages).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy01, Edit02, File06, FileCode01, MusicNote02, Printer, Share07, Trash01 } from '@untitled-ui/icons-react'
import type { ScoreDoc, ScoreParams } from '../../types'
import { deleteScore, duplicateScore, updateScore } from '../../data/db'
import { ActionSheet, ConfirmDialog, PromptDialog, useToast, type ActionSheetAction } from '../../ui'
import { FORMAT_LABEL, shareExport, type ExportFormat } from './exports'
import { forgetViewState } from './viewState'

export interface ViewerActionsProps {
  doc: ScoreDoc
  open: boolean
  onClose: () => void
  /** Stops playback before leaving or printing. */
  onStop: () => void
  onPrint: () => Promise<void>
  /** Params as they are now in the viewer (the exports follow what is on screen). */
  getParams: () => ScoreParams
}

export function ViewerActions({ doc, open, onClose, onStop, onPrint, getParams }: ViewerActionsProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const share = async (format: ExportFormat) => {
    try {
      const result = await shareExport(doc, getParams(), format)
      if (result === 'downloaded') toast.show(`${FORMAT_LABEL[format]} descargado`, { tone: 'success' })
      else if (result === 'shared') toast.show('Partitura compartida', { tone: 'success' })
    } catch (err) {
      console.warn('[viewer] export', err)
      toast.show('No se pudo exportar', { tone: 'danger' })
    }
  }

  const actions: ActionSheetAction[] = [
    { key: 'rename', label: 'Renombrar', icon: Edit02, onSelect: () => setRenaming(true) },
    {
      key: 'pdf',
      label: 'Exportar PDF',
      icon: Printer,
      onSelect: () => {
        onStop()
        onPrint().catch(() => toast.show('No se pudo exportar', { tone: 'danger' }))
      },
    },
    { key: 'xml', label: 'Exportar MusicXML', icon: FileCode01, onSelect: () => void share('musicxml') },
    { key: 'midi', label: 'Exportar MIDI', icon: MusicNote02, onSelect: () => void share('midi') },
    { key: 'abc', label: 'Exportar ABC', icon: File06, onSelect: () => void share('abc') },
    { key: 'share', label: 'Compartir', icon: Share07, onSelect: () => void share('musicxml') },
    {
      key: 'dup',
      label: 'Duplicar',
      icon: Copy01,
      onSelect: () => {
        duplicateScore(doc.id)
          .then((copy) => toast.show(copy ? 'Partitura duplicada' : 'No se pudo duplicar', { tone: copy ? 'success' : 'danger' }))
          .catch(() => toast.show('No se pudo duplicar', { tone: 'danger' }))
      },
    },
    { key: 'delete', label: 'Eliminar', icon: Trash01, tone: 'danger', onSelect: () => setDeleting(true) },
  ]

  const confirmDelete = () => {
    setDeleting(false)
    onStop()
    const id = doc.id
    forgetViewState(id)
    // Leave first, so the screen never shows a missing item while it fades out.
    navigate('/library', { replace: true })
    deleteScore(id)
      .then(() => toast.show('Partitura eliminada'))
      .catch(() => toast.show('No se pudo eliminar', { tone: 'danger' }))
  }

  return (
    <>
      <ActionSheet open={open} onClose={onClose} title={doc.title} actions={actions} />
      <PromptDialog
        open={renaming}
        title="Renombrar"
        initialValue={doc.title}
        maxLength={80}
        onConfirm={(value) => {
          setRenaming(false)
          if (value !== doc.title) updateScore(doc.id, { title: value }).catch(() => toast.show('No se pudo renombrar', { tone: 'danger' }))
        }}
        onCancel={() => setRenaming(false)}
      />
      <ConfirmDialog
        open={deleting}
        title="¿Eliminar partitura?"
        message="No se puede deshacer."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(false)}
      />
    </>
  )
}
