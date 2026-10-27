// Owner: capture. Procesando (/processing): runs the pipeline over what the capture store holds, shows real
// progress around a slowly spinning vinyl and opens the new score. Without data (reload) it goes back to Home.
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useSpring, useTransform } from 'motion/react'
import { XClose } from '@untitled-ui/icons-react'
import { getSettings } from '../../state/settings'
import { Button, IconButton, Page, ProgressRing, TopBar, Vinyl, ease } from '../../ui'
import { HeroVinyl } from './HeroVinyl'
import { isAbortError, startPipeline, type PipelineInput, type PipelineJob } from './pipeline'
import { STAGE_LABELS, type PipelineStage } from './selection'
import { getCapture, useCaptureStore } from './store'
import { useGoBack, useViewportSize } from './util'
import './ProcessingScreen.css'

/** Pause on 100 % before opening the score, so the ring visibly completes. */
const SUCCESS_BEAT_MS = 700
const NBSP = ' '

type Input = Omit<PipelineInput, 'settings'>

/** Snapshot of the capture store, taken once: later store changes never redirect a running job. */
function readInput(): Input | null {
  const { source, decoded, range, blob, name } = getCapture()
  if (!source || !decoded || !range || !(range.end > range.start)) return null
  return { source, decoded, range, blob, name }
}

export function ProcessingScreen() {
  const [input] = useState(readInput)
  if (!input) return <Navigate to="/" replace />
  return <ProcessingView input={input} />
}

type Phase = 'running' | 'done' | 'empty' | 'error'

function Percent({ value }: { value: number }) {
  const spring = useSpring(0, { stiffness: 140, damping: 26, restDelta: 0.1 })
  const text = useTransform(spring, (v) => `${Math.round(v)}${NBSP}%`)
  useEffect(() => {
    spring.set(value * 100)
  }, [spring, value])
  return <motion.span className="cap-proc__percent tabular">{text}</motion.span>
}

function ProcessingView({ input }: { input: Input }) {
  const navigate = useNavigate()
  const goBack = useGoBack('/')
  const { width, height } = useViewportSize()
  const [phase, setPhase] = useState<Phase>('running')
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState<PipelineStage>('preparing')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const job = useRef<PipelineJob | null>(null)
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  useEffect(() => {
    let alive = true
    let beat = 0
    setPhase('running')
    setProgress(0)
    setStage('preparing')
    // The timer swallows StrictMode's mount-unmount-mount, so the model never starts twice.
    const timer = window.setTimeout(() => {
      const current = startPipeline({ ...input, settings: getSettings() }, (p, s) => {
        if (!alive) return
        setProgress(p)
        setStage(s)
      })
      job.current = current
      current.promise.then(
        (result) => {
          if (!alive) return
          if (result.status === 'empty') {
            setPhase('empty')
            return
          }
          setPhase('done')
          setProgress(1)
          setStage('done')
          beat = window.setTimeout(() => {
            navigateRef.current('/score/' + result.doc.id, { replace: true })
            // A finished recording is not needed any more; an imported file stays so Back returns to the trim.
            if (input.source !== 'file') useCaptureStore.getState().reset()
          }, SUCCESS_BEAT_MS)
        },
        (err: unknown) => {
          if (!alive || isAbortError(err)) return
          setMessage((err as Error)?.message || 'No se pudo transcribir el audio.')
          setPhase('error')
        },
      )
    }, 0)
    return () => {
      alive = false
      window.clearTimeout(timer)
      window.clearTimeout(beat)
      job.current?.cancel()
      job.current = null
    }
  }, [input, attempt])

  const cancel = () => {
    job.current?.cancel()
    job.current = null
    goBack()
  }

  /** "Reintentar" after no notes: back to where the audio came from (another segment, another take). */
  const retryCapture = () => {
    if (input.source === 'file') goBack()
    else navigate('/listen?mode=' + input.source, { replace: true })
  }

  const busy = phase === 'running' || phase === 'done'
  const ring = Math.round(Math.max(232, Math.min(width - 56, height * 0.4, 320)))

  return (
    <Page variant="tab" className="cap-proc">
      <TopBar left={phase !== 'done' && <IconButton icon={XClose} label="Cancelar" onClick={cancel} />} />
      <div className="cap-proc__stage">
        <ProgressRing value={busy ? progress : 0} size={ring} stroke={4} ariaLabel="Progreso de la transcripción">
          <HeroVinyl className="cap-proc__vinyl">
            <Vinyl size={ring - 40} spinning={phase === 'running'} speed="slow" plinth={false} />
          </HeroVinyl>
        </ProgressRing>
        <AnimatePresence mode="wait" initial={false}>
          {busy ? (
            <motion.div
              key="status"
              className="cap-proc__status"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24, ease }}
            >
              <Percent value={progress} />
              <span className="cap-proc__label" aria-live="polite">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={stage}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.22, ease }}
                  >
                    {STAGE_LABELS[stage]}
                  </motion.span>
                </AnimatePresence>
              </span>
            </motion.div>
          ) : (
            <motion.div
              key={phase}
              className="cap-proc__message"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease }}
            >
              <p role={phase === 'error' ? 'alert' : undefined}>{phase === 'empty' ? 'No se detectaron notas' : message}</p>
              <Button onClick={phase === 'empty' ? retryCapture : () => setAttempt((n) => n + 1)}>Reintentar</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Page>
  )
}
