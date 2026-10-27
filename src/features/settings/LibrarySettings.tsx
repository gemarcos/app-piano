// Owner: settings. "Biblioteca" group of Ajustes: backup export/import, demo restore, storage, wipe.
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Download01, RefreshCcw01, Upload01 } from '@untitled-ui/icons-react'
import { clearLibrary, db, exportBackup, importBackup, storageEstimate } from '../../data/db'
import { restoreDemos } from '../../data/seed'
import { shareOrDownload } from '../../lib/download'
import { formatBytes } from '../../lib/format'
import { ConfirmDialog, Icon, ListRow, SettingsGroup, Spinner, useToast, type IconComponent } from '../../ui'

type Task = 'export' | 'import' | 'restore' | 'clear'

/** "2026-10-27" in local time (backup file names). */
function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`
}

export function LibrarySettings() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [task, setTask] = useState<Task | null>(null)
  const busy = useRef(false)
  const [confirmClear, setConfirmClear] = useState(false)
  /** undefined while measuring, null when the browser cannot tell. */
  const [usage, setUsage] = useState<number | null | undefined>(undefined)

  const refreshUsage = useCallback(async () => {
    const estimate = await storageEstimate()
    setUsage(estimate ? estimate.usage : null)
  }, [])

  useEffect(() => {
    void refreshUsage()
  }, [refreshUsage])

  /** Runs one library task at a time (rows ignore taps while another one is running). */
  const run = useCallback(
    async (name: Task, work: () => Promise<void>) => {
      if (busy.current) return
      busy.current = true
      setTask(name)
      try {
        await work()
      } finally {
        busy.current = false
        setTask(null)
        void refreshUsage()
      }
    },
    [refreshUsage],
  )

  const onExport = () =>
    run('export', async () => {
      try {
        if ((await db.scores.count()) === 0) {
          toast.show('La biblioteca está vacía')
          return
        }
        const blob = await exportBackup()
        const result = await shareOrDownload(blob, `pauta-copia-${localDate()}.json`, 'Copia de Pauta')
        if (result === 'downloaded') toast.show('Copia descargada', { tone: 'success' })
        else if (result === 'shared') toast.show('Copia compartida', { tone: 'success' })
      } catch {
        toast.show('No se pudo exportar la copia', { tone: 'danger' })
      }
    })

  const onImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    const file = input.files?.[0]
    input.value = '' // the same file can be picked again
    if (!file) return
    void run('import', async () => {
      try {
        const n = await importBackup(file)
        toast.show(count(n, 'partitura importada', 'partituras importadas'), { tone: n > 0 ? 'success' : 'neutral' })
      } catch (err) {
        const notABackup = err instanceof SyntaxError || (err instanceof Error && err.message.includes('Pauta'))
        toast.show(notABackup ? 'El archivo no es una copia de Pauta' : 'No se pudo importar la copia', { tone: 'danger' })
      }
    })
  }

  const onRestore = () =>
    run('restore', async () => {
      try {
        const n = await restoreDemos()
        if (n > 0) toast.show(count(n, 'ejemplo restaurado', 'ejemplos restaurados'), { tone: 'success' })
        else toast.show('Los ejemplos ya están en la biblioteca')
      } catch {
        toast.show('No se pudieron restaurar los ejemplos', { tone: 'danger' })
      }
    })

  const onClear = () => {
    setConfirmClear(false)
    void run('clear', async () => {
      try {
        await clearLibrary()
        toast.show('Biblioteca borrada')
      } catch {
        toast.show('No se pudo borrar la biblioteca', { tone: 'danger' })
      }
    })
  }

  const actionIcon = (name: Task, icon: IconComponent) =>
    task === name ? <Spinner size={18} label="En curso" /> : <Icon icon={icon} size={20} className="set-action-icon" />

  return (
    <>
      <SettingsGroup title="Biblioteca">
        <ListRow title="Exportar copia" trailing={actionIcon('export', Download01)} onClick={onExport} />
        <ListRow title="Importar copia" trailing={actionIcon('import', Upload01)} onClick={() => !busy.current && fileRef.current?.click()} />
        <ListRow title="Restaurar ejemplos" trailing={actionIcon('restore', RefreshCcw01)} onClick={onRestore} />
        {usage !== null && (
          <ListRow
            title="Espacio usado"
            trailing={
              <AnimatePresence initial={false}>
                {usage !== undefined && (
                  <motion.span key="usage" className="tabular" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    {formatBytes(usage)}
                  </motion.span>
                )}
              </AnimatePresence>
            }
          />
        )}
        <ListRow
          title="Borrar biblioteca"
          tone="danger"
          trailing={task === 'clear' ? <Spinner size={18} label="Borrando" /> : undefined}
          onClick={() => !busy.current && setConfirmClear(true)}
        />
      </SettingsGroup>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onImportFile}
      />

      <ConfirmDialog
        open={confirmClear}
        title="¿Borrar la biblioteca?"
        message={
          <>
            Se eliminarán todas las partituras.
            <br />
            No se puede deshacer.
          </>
        }
        confirmLabel="Borrar"
        tone="danger"
        onConfirm={onClear}
        onCancel={() => setConfirmClear(false)}
      />
    </>
  )
}
