// Owner: capture. Escuchar (/listen?mode=mic|tab): records the microphone or a browser tab, then hands the
// decoded take to Processing. Recording starts on mount; every exit path releases the microphone.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Microphone01, Stop, XClose } from '@untitled-ui/icons-react'
import { decodeMediaFile, startRecording, type CaptureMode, type RecorderHandle } from '../../engine/audio'
import { getSettings, useSettings } from '../../state/settings'
import { formatTime } from '../../lib/format'
import { Button, IconButton, LiveBars, Page, TopBar, Vinyl, ease, useToast } from '../../ui'
import { HeroVinyl } from './HeroVinyl'
import { MIN_RECORDING_SEC } from './selection'
import { useCaptureStore } from './store'
import { haptic, rememberHeroVinyl, useGoBack, useViewportSize } from './util'
import './RecordScreen.css'

type Phase = 'starting' | 'recording' | 'stopping' | 'idle' | 'denied' | 'error'

/**
 * The automatic start waits for the entrance (page fade + vinyl glide): opening the microphone creates an
 * AudioContext synchronously, which can block the main thread for ~250 ms and would freeze the transition.
 */
const AUTO_START_DELAY_MS = 520

/** Tiny external store for the ~30 Hz input level, so only the bars re-render. */
function createLevelStore() {
  let value = 0
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next: number) => {
      value = next
      listeners.forEach((l) => l())
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

type LevelStore = ReturnType<typeof createLevelStore>

function LevelBars({ store, active }: { store: LevelStore; active: boolean }) {
  const level = useSyncExternalStore(store.subscribe, store.get, store.get)
  return <LiveBars level={level} active={active} bars={28} height={44} className="cap-record__bars" />
}

function recordingName(mime: string): string {
  if (mime.includes('mp4')) return 'grabacion.m4a'
  if (mime.includes('ogg')) return 'grabacion.ogg'
  return 'grabacion.webm'
}

export function RecordScreen() {
  const [params] = useSearchParams()
  const mode: CaptureMode = params.get('mode') === 'tab' ? 'tab' : 'mic'
  const navigate = useNavigate()
  const goBack = useGoBack('/')
  const toast = useToast()
  const maxSec = useSettings((s) => (Number.isFinite(s.maxRecordSec) && s.maxRecordSec >= 5 ? s.maxRecordSec : 90))
  const { width, height } = useViewportSize()
  const levels = useMemo(createLevelStore, [])

  const [phase, setPhase] = useState<Phase>('starting')
  const [message, setMessage] = useState('')
  const [elapsed, setElapsed] = useState(0)

  const alive = useRef(false)
  const stage = useRef<HTMLDivElement>(null)
  const handle = useRef<RecorderHandle | null>(null)
  const starting = useRef(false)
  const stopping = useRef(false)
  const finishRef = useRef<() => void>(() => {})

  const start = useCallback(async () => {
    if (starting.current || stopping.current || handle.current) return
    starting.current = true
    setPhase('starting')
    setMessage('')
    setElapsed(0)
    levels.set(0)
    try {
      const take = await startRecording({
        mode,
        maxSeconds: maxSec,
        onLevel: levels.set,
        onAutoStop: () => finishRef.current(),
      })
      if (!alive.current) {
        take.cancel()
        return
      }
      handle.current = take
      setPhase('recording')
      haptic()
    } catch (err) {
      if (!alive.current) return
      const e = err as Error
      setMessage(e.message || 'No se pudo usar el micrófono.')
      setPhase(e.name === 'NotAllowedError' ? 'denied' : 'error')
    } finally {
      starting.current = false
    }
  }, [mode, maxSec, levels])

  const finish = useCallback(async () => {
    const take = handle.current
    if (!take || stopping.current) return
    handle.current = null
    haptic()
    levels.set(0)
    if ((Date.now() - take.startedAt) / 1000 < MIN_RECORDING_SEC) {
      take.cancel()
      toast.show('Grabación demasiado corta')
      setPhase('idle')
      return
    }
    stopping.current = true
    setPhase('stopping')
    try {
      const blob = await take.stop()
      if (!alive.current) return
      const decoded = await decodeMediaFile(blob, recordingName(blob.type))
      if (!alive.current) return
      if (decoded.duration < MIN_RECORDING_SEC) {
        toast.show('Grabación demasiado corta')
        setPhase('idle')
        return
      }
      useCaptureStore.getState().setRecording(mode, decoded, getSettings().keepOriginalAudio ? blob : null)
      rememberHeroVinyl(stage.current) // Processing slides this record into its progress ring
      navigate('/processing', { replace: true })
    } catch (err) {
      if (!alive.current) return
      setMessage((err as Error).message || 'La grabación se interrumpió.')
      setPhase('error')
    } finally {
      stopping.current = false
    }
  }, [mode, levels, navigate, toast])
  finishRef.current = () => void finish()

  // Start once after the entrance (the timer also swallows StrictMode's mount-unmount-mount) and always
  // release on unmount.
  useEffect(() => {
    alive.current = true
    const timer = window.setTimeout(() => void start(), AUTO_START_DELAY_MS)
    return () => {
      alive.current = false
      window.clearTimeout(timer)
      handle.current?.cancel()
      handle.current = null
    }
  }, [start])

  useEffect(() => {
    if (phase !== 'recording') return
    const tick = () => {
      const take = handle.current
      if (take) setElapsed(Math.min(maxSec, (Date.now() - take.startedAt) / 1000))
    }
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [phase, maxSec])

  const close = () => {
    handle.current?.cancel()
    handle.current = null
    goBack()
  }

  const recording = phase === 'recording'
  const blocked = phase === 'denied' || phase === 'error'
  const size = Math.round(Math.max(240, Math.min(width - 40, height * 0.42, 360)))

  return (
    <Page variant="tab" className="cap-record">
      <TopBar left={<IconButton icon={XClose} label="Cerrar" onClick={close} />} />
      <div ref={stage} className="cap-record__stage">
        <HeroVinyl className="cap-record__vinyl">
          <Vinyl
            size={size}
            spinning={recording}
            tonearm={recording ? 'play' : 'rest'}
            progress={recording || phase === 'stopping' ? elapsed / maxSec : undefined}
            ariaLabel={recording ? 'Escuchando' : undefined}
          />
        </HeroVinyl>
        <AnimatePresence mode="wait" initial={false}>
          {blocked ? (
            <motion.div
              key="message"
              className="cap-record__message"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease }}
            >
              <p role="alert">{message}</p>
              <Button onClick={() => void start()}>Reintentar</Button>
            </motion.div>
          ) : (
            <motion.div
              key="meter"
              className="cap-record__meter"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24, ease }}
            >
              <LevelBars store={levels} active={recording} />
              <p className="cap-record__time" aria-live="off">
                <span className={recording ? 'cap-record__dot is-on' : 'cap-record__dot'} aria-hidden="true" />
                <span className="cap-record__elapsed tabular">{formatTime(elapsed)}</span>
                <span className="cap-record__max tabular">/ {formatTime(maxSec)}</span>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="cap-record__controls">
        {!blocked && (
          <IconButton
            icon={phase === 'idle' ? Microphone01 : Stop}
            label={phase === 'idle' ? 'Grabar' : 'Detener'}
            variant="neu"
            size="xl"
            className={phase === 'idle' ? 'cap-record__button' : 'cap-record__button is-stop'}
            disabled={phase === 'starting' || phase === 'stopping'}
            onClick={phase === 'idle' ? () => void start() : () => void finish()}
          />
        )}
      </div>
    </Page>
  )
}
