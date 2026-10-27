// Owner: capture. Importar (/import): the decoded file, a trimmable waveform, a preview of the selection and
// "Transcribir". Without a file in the capture store (reload, deep link) it goes back to Home.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { MusicNote01, Play, VideoRecorder } from '@untitled-ui/icons-react'
import { computePeaks, type DecodedMedia } from '../../engine/audio'
import { formatTime } from '../../lib/format'
import { BackButton, BottomBar, Button, Card, Icon, IconButton, Page, PauseIcon, TopBar, fadeUp } from '../../ui'
import { normalizeSelection } from './selection'
import { getCapture, useCaptureStore, type CaptureRange } from './store'
import { TrimWaveform } from './TrimWaveform'
import { usePreview } from './usePreview'
import './ImportScreen.css'

const PEAK_BINS = 720

function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url
}

export function ImportScreen() {
  const decoded = useCaptureStore((s) => (s.source === 'file' ? s.decoded : null))
  if (!decoded) return <Navigate to="/" replace />
  return <ImportView decoded={decoded} />
}

function ImportView({ decoded }: { decoded: DecodedMedia }) {
  const navigate = useNavigate()
  const blob = useCaptureStore((s) => s.blob)
  const duration = decoded.duration
  const isVideo = decoded.kind === 'video'
  const [selection, setSelection] = useState<CaptureRange>(() => normalizeSelection(getCapture().range, duration))
  const peaks = useMemo(() => computePeaks(decoded.buffer, PEAK_BINS), [decoded])
  const preview = usePreview(decoded.buffer)
  const videoUrl = useObjectUrl(isVideo ? blob : null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // The video preview shows the frame at the selection start, and plays (muted) along with the preview.
  useEffect(() => {
    const video = videoRef.current
    if (!video || preview.playing) return
    const id = window.setTimeout(() => {
      try {
        video.currentTime = Math.min(selection.start + 0.05, Math.max(0, duration - 0.05))
      } catch {
        // not seekable yet
      }
    }, 120)
    return () => window.clearTimeout(id)
  }, [selection.start, preview.playing, videoUrl, duration])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (preview.playing) {
      try {
        video.currentTime = selection.start
      } catch {
        // not seekable yet
      }
      video.play().catch(() => {})
    } else {
      video.pause()
    }
    // Only follow play/pause; selection changes stop the preview first.
  }, [preview.playing])

  const change = (next: CaptureRange) => {
    if (preview.playing) preview.stop()
    setSelection(next)
  }
  const commit = (next: CaptureRange) => useCaptureStore.getState().setRange(next)

  const toggle = () => (preview.playing ? preview.stop() : preview.play(selection.start, selection.end))

  const transcribe = () => {
    preview.stop()
    useCaptureStore.getState().setRange(selection)
    navigate('/processing')
  }

  const progress = preview.position != null && duration > 0 ? preview.position / duration : undefined

  return (
    <Page className="cap-import">
      <TopBar left={<BackButton fallback="/" />} />
      <div className="cap-import__body">
        <motion.div className="cap-import__file" {...fadeUp(0.04)}>
          {videoUrl ? (
            <div className="cap-import__media cap-import__media--video">
              <video ref={videoRef} src={videoUrl} muted playsInline preload="auto" aria-hidden="true" tabIndex={-1} />
              <span className="cap-import__badge" aria-hidden="true">
                <Icon icon={VideoRecorder} size={16} />
              </span>
            </div>
          ) : (
            <div className="cap-import__media">
              <Icon icon={isVideo ? VideoRecorder : MusicNote01} size={28} />
            </div>
          )}
          <h1 className="cap-import__name">{decoded.name}</h1>
          <p className="cap-import__duration tabular">{formatTime(duration)}</p>
        </motion.div>

        <motion.div className="cap-import__trim" {...fadeUp(0.1)}>
          <Card padding="lg" className="cap-import__card">
            <TrimWaveform
              peaks={peaks}
              duration={duration}
              value={selection}
              onChange={change}
              onCommit={commit}
              progress={progress}
            />
            <p className="cap-import__selection tabular" aria-label={`Selección de ${formatTime(selection.end - selection.start)}`}>
              <span className="cap-import__length">{formatTime(selection.end - selection.start)}</span>
              <span className="cap-import__range" aria-hidden="true">
                {formatTime(selection.start)} – {formatTime(selection.end)}
              </span>
            </p>
          </Card>
          <IconButton
            icon={preview.playing ? PauseIcon : Play}
            label={preview.playing ? 'Pausar' : 'Escuchar la selección'}
            variant="neu"
            size="lg"
            className="cap-import__play"
            onClick={toggle}
          />
        </motion.div>
      </div>
      <BottomBar>
        <Button variant="accent" size="lg" onClick={transcribe}>
          Transcribir
        </Button>
      </BottomBar>
    </Page>
  )
}
