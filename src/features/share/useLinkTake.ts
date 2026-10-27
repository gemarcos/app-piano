// Owner: share. The take of the link screen: the microphone (or, on a computer, tab capture) records while the
// official player plays, then the decoded audio goes through the normal capture flow (/processing).
// Same guarantees as RecordScreen: one take at a time, every exit releases the microphone, auto-stop at the
// settings maximum, takes under MIN_RECORDING_SEC are refused.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { decodeMediaFile, startRecording, type CaptureMode, type RecorderHandle } from '../../engine/audio'
import { getSettings, useSettings } from '../../state/settings'
import { useToast } from '../../ui'
import { MIN_RECORDING_SEC } from '../capture/selection'
import { useCaptureStore, type CaptureMeta } from '../capture/store'
import { haptic } from '../capture/util'

export type TakePhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'denied' | 'error'

/** Tiny external store for the ~30 Hz input level, so only the bars re-render. */
export function createLevelStore() {
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

export type LevelStore = ReturnType<typeof createLevelStore>

function recordingName(mime: string): string {
  if (mime.includes('mp4')) return 'grabacion.m4a'
  if (mime.includes('ogg')) return 'grabacion.ogg'
  return 'grabacion.webm'
}

interface TakeOptions {
  /** Library details of the take, read when it stops (the oEmbed title may arrive late). */
  describe: () => CaptureMeta
  /** Recording has started (play the video). */
  onStart?: () => void
  /** Recording stopped or was discarded (pause the video). */
  onStop?: () => void
}

export function useLinkTake({ describe, onStart, onStop }: TakeOptions) {
  const navigate = useNavigate()
  const toast = useToast()
  const maxSec = useSettings((s) => (Number.isFinite(s.maxRecordSec) && s.maxRecordSec >= 5 ? s.maxRecordSec : 90))
  const levels = useMemo(createLevelStore, [])
  const [phase, setPhase] = useState<TakePhase>('idle')
  const [mode, setMode] = useState<CaptureMode>('mic')
  const [message, setMessage] = useState('')
  const [elapsed, setElapsed] = useState(0)

  const alive = useRef(false)
  const handle = useRef<RecorderHandle | null>(null)
  const takeMode = useRef<CaptureMode>('mic')
  const starting = useRef(false)
  const stopping = useRef(false)
  const callbacks = useRef({ describe, onStart, onStop })
  callbacks.current = { describe, onStart, onStop }
  const finishRef = useRef<() => void>(() => {})

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      handle.current?.cancel()
      handle.current = null
    }
  }, [])

  /** Must run inside the tap: tab capture needs the user gesture. */
  const start = useCallback(
    async (next: CaptureMode) => {
      if (starting.current || stopping.current || handle.current) return
      starting.current = true
      takeMode.current = next
      setMode(next)
      setPhase('starting')
      setMessage('')
      setElapsed(0)
      levels.set(0)
      try {
        const take = await startRecording({ mode: next, maxSeconds: maxSec, onLevel: levels.set, onAutoStop: () => finishRef.current() })
        if (!alive.current) {
          take.cancel()
          return
        }
        handle.current = take
        setPhase('recording')
        haptic()
        callbacks.current.onStart?.()
      } catch (err) {
        if (!alive.current) return
        const e = err as Error
        setMessage(e.message || (next === 'tab' ? 'No se pudo capturar la pestaña.' : 'No se pudo usar el micrófono.'))
        setPhase(e.name === 'NotAllowedError' ? 'denied' : 'error')
      } finally {
        starting.current = false
      }
    },
    [maxSec, levels],
  )

  const finish = useCallback(async () => {
    const take = handle.current
    if (!take || stopping.current) return
    handle.current = null
    haptic()
    levels.set(0)
    callbacks.current.onStop?.()
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
      const meta = { ...callbacks.current.describe(), retryBack: true }
      useCaptureStore.getState().setRecording(takeMode.current, decoded, getSettings().keepOriginalAudio ? blob : null, meta)
      // Pushed (not replaced): cancelling Processing, or Back from the new score, returns to this link.
      navigate('/processing')
    } catch (err) {
      if (!alive.current) return
      setMessage((err as Error).message || 'La grabación se interrumpió.')
      setPhase('error')
    } finally {
      stopping.current = false
    }
  }, [levels, navigate, toast])
  finishRef.current = () => void finish()

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

  /** Discards the take in progress (closing the screen). */
  const cancel = useCallback(() => {
    if (!handle.current) return
    handle.current.cancel()
    handle.current = null
    callbacks.current.onStop?.()
  }, [])

  const stop = useCallback(() => void finishRef.current(), [])

  return { phase, mode, message, elapsed, maxSec, levels, start, finish: stop, cancel }
}
