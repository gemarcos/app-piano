// Owner: capture. Plays a segment of an AudioBuffer with Web Audio (trim preview) and reports the position.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getSettings } from '../../state/settings'

export interface PreviewApi {
  playing: boolean
  /** Seconds into the buffer while playing, null otherwise. */
  position: number | null
  /** Call from a user gesture (creates / resumes the AudioContext). */
  play: (start: number, end: number) => void
  stop: () => void
}

export function usePreview(buffer: AudioBuffer | null): PreviewApi {
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState<number | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const raf = useRef(0)

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current)
    const source = sourceRef.current
    sourceRef.current = null
    if (source) {
      source.onended = null
      try {
        source.stop()
      } catch {
        // already stopped
      }
      source.disconnect()
    }
    setPlaying(false)
    setPosition(null)
  }, [])

  const play = useCallback(
    (start: number, end: number) => {
      if (!buffer || end <= start) return
      stop()
      let ctx = ctxRef.current
      try {
        if (!ctx || ctx.state === 'closed') {
          const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          if (!Ctor) return
          ctx = new Ctor()
          ctxRef.current = ctx
        }
        if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
        const source = ctx.createBufferSource()
        const gain = ctx.createGain()
        gain.gain.value = Math.min(1, Math.max(0.05, getSettings().playbackVolume))
        source.buffer = buffer
        source.connect(gain)
        gain.connect(ctx.destination)
        const t0 = ctx.currentTime
        source.start(t0, start, end - start)
        source.onended = () => {
          if (sourceRef.current === source) stop()
        }
        sourceRef.current = source
        setPlaying(true)
        setPosition(start)
        const audio = ctx
        const tick = () => {
          if (sourceRef.current !== source) return
          setPosition(Math.min(end, start + Math.max(0, audio.currentTime - t0)))
          raf.current = requestAnimationFrame(tick)
        }
        raf.current = requestAnimationFrame(tick)
      } catch {
        stop()
      }
    },
    [buffer, stop],
  )

  useEffect(
    () => () => {
      stop()
      ctxRef.current?.close().catch(() => {})
      ctxRef.current = null
    },
    [stop],
  )

  return { playing, position, play, stop }
}
