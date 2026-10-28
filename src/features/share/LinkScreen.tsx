// Owner: share. Enlace (/link?url=…): plays a shared YouTube or TikTok video with the platform's OFFICIAL embed
// player while Pauta listens with the microphone (ambient listening, on every device); the take then goes through
// the normal flow (/processing). Nothing is downloaded and the player's audio is never captured or isolated
// (YouTube API developer policies; client decision 2026-10-28 09:05). A saved file is the exact-audio route.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, Link01, LinkBroken01, Microphone01, Stop, Upload01, VideoRecorderOff, WifiOff, XClose } from '@untitled-ui/icons-react'
import { DECODE_ERROR_MESSAGE } from '../../engine/audio'
import { defaultTitle, formatTime } from '../../lib/format'
import { Button, Icon, IconButton, LiveBars, Page, Spinner, TopBar, cx, ease, useToast, useUiSoundsBlocked, type IconComponent } from '../../ui'
import { useGoBack, useViewportSize } from '../capture/util'
import { EmbedFrame } from './EmbedFrame'
import { cleanTitle, parseLink, platformName, type SharedLink } from './links'
import { fetchOEmbed } from './oembed'
import { openMediaFile } from './openMedia'
import type { EmbedError, EmbedPlayer, EmbedState } from './players'
import { useLinkTake, type LevelStore } from './useLinkTake'
import './LinkScreen.css'

type Block = 'not-embeddable' | 'unavailable' | 'unsupported' | 'short' | 'offline' | 'failed'

const NEARBY = 'Reprodúcelo en otro dispositivo cerca y toca Escuchar.'

const BLOCKS: Record<Block, { icon: IconComponent; title: (link: SharedLink) => string; hint: string }> = {
  'not-embeddable': {
    icon: VideoRecorderOff,
    title: (link) => `Este vídeo solo se puede ver en ${platformName(link.platform)}`,
    hint: NEARBY,
  },
  unavailable: {
    icon: VideoRecorderOff,
    title: () => 'Este vídeo no está disponible',
    hint: 'Puede que sea privado o que se haya eliminado.',
  },
  unsupported: {
    icon: LinkBroken01,
    title: (link) => (link.platform === 'other' ? 'Este enlace no es de YouTube ni de TikTok' : 'Este enlace no lleva a un vídeo'),
    hint: 'Reproduce el vídeo cerca y toca Escuchar.',
  },
  short: {
    icon: Link01,
    title: () => 'Este enlace corto de TikTok no se abre aquí',
    hint: 'Guarda el vídeo desde TikTok y ábrelo con Archivo.',
  },
  offline: {
    icon: WifiOff,
    title: () => 'Sin conexión',
    hint: 'El vídeo necesita internet. También puedes reproducirlo cerca y tocar Escuchar.',
  },
  failed: {
    icon: AlertCircle,
    title: () => 'No se pudo cargar el vídeo',
    hint: NEARBY,
  },
}

/** "Toca el vídeo si no empieza" shows when the video has not started this long after the take began. */
const NUDGE_AFTER_MS = 2500

function isOffline(): boolean {
  try {
    return navigator.onLine === false
  } catch {
    return false
  }
}

/** What can be decided without the network. */
function initialBlock(link: SharedLink): Block | null {
  if (link.platform === 'other' || (!link.id && !link.short)) return 'unsupported'
  return isOffline() ? 'offline' : null
}

export function LinkScreen() {
  const [params] = useSearchParams()
  const raw = params.get('url') ?? ''
  const link = useMemo(() => parseLink(raw), [raw])
  if (!link) return <Navigate to="/" replace />
  return <LinkView key={link.url} link={link} />
}

interface VideoInfo {
  title: string
  author: string
  ratio: number | null
}

function LinkView({ link }: { link: SharedLink }) {
  const navigate = useNavigate()
  const goBack = useGoBack('/')
  const toast = useToast()
  const { width, height } = useViewportSize()
  /** The link the player opens (a TikTok short link only once oEmbed resolved its id). */
  const [playable, setPlayable] = useState<SharedLink | null>(link.short ? null : link)
  const [info, setInfo] = useState<VideoInfo | null>(null)
  const [block, setBlock] = useState<Block | null>(() => initialBlock(link))
  const [shown, setShown] = useState(false)
  const [video, setVideo] = useState<EmbedState | null>(null)
  const [nudge, setNudge] = useState(false)
  const [sound, setSound] = useState<{ muted: boolean; volume: number } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [opening, setOpening] = useState(false)
  const player = useRef<EmbedPlayer | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  const infoRef = useRef(info)
  infoRef.current = info

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const take = useLinkTake({
    describe: () => ({ title: infoRef.current?.title || defaultTitle('Enlace'), sourceName: link.url }),
    onStart: () => player.current?.play(),
    onStop: () => player.current?.pause(),
  })

  // oEmbed: title and shape; YouTube also tells whether the video may be embedded; TikTok resolves short links.
  useEffect(() => {
    if (initialBlock(link)) return
    const controller = new AbortController()
    void fetchOEmbed(link, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.status === 'ok') {
        setInfo({ title: cleanTitle(result.title), author: result.author, ratio: result.ratio })
        if (link.short) {
          if (result.id) setPlayable({ ...link, id: result.id, short: false })
          else setBlock('short')
        }
        return
      }
      if (link.short) setBlock('short')
      else if (result.status === 'offline') setBlock('offline')
      else if (link.platform === 'youtube' && (result.status === 'not-embeddable' || result.status === 'unavailable')) setBlock(result.status)
      // 'failed' (throttled, CORS): the player itself decides.
    })
    return () => controller.abort()
  }, [link, attempt])

  const onReady = useCallback(() => setShown(true), [])
  const onState = useCallback((state: EmbedState) => setVideo(state), [])
  const onError = useCallback((error: EmbedError) => setBlock((current) => current ?? error), [])
  const onSound = useCallback((next: { muted: boolean; volume: number }) => setSound(next), [])

  // The take plays the video; if it does not start (mobile autoplay rules), suggest tapping it.
  const recording = take.phase === 'recording'
  // No interface sound may reach the microphone.
  useUiSoundsBlocked(take.phase === 'starting' || recording)
  const hasPlayer = !block && playable !== null
  useEffect(() => {
    if (!recording || !hasPlayer || video === 'playing') {
      setNudge(false)
      return
    }
    const id = window.setTimeout(() => setNudge(true), NUDGE_AFTER_MS)
    return () => window.clearTimeout(id)
  }, [recording, hasPlayer, video])

  // The video ended: so does the take.
  const finish = take.finish
  useEffect(() => {
    if (video === 'ended' && recording) finish()
  }, [video, recording, finish])

  const retry = () => {
    setBlock(initialBlock(link))
    setShown(false)
    setVideo(null)
    setAttempt((n) => n + 1)
  }

  const close = () => {
    take.cancel()
    goBack()
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setOpening(true)
    try {
      await openMediaFile(file)
      if (alive.current) navigate('/import')
    } catch (err) {
      if (alive.current) toast.show((err as Error)?.message || DECODE_ERROR_MESSAGE, { tone: 'danger' })
    } finally {
      if (alive.current) setOpening(false)
    }
  }

  // Card size: the video's shape (oEmbed, else portrait for Shorts/TikTok), within the column and ~40 % of the height.
  const ratio = Math.min(1.8, Math.max(0.5, link.platform === 'tiktok' ? 9 / 16 : (info?.ratio ?? (link.vertical ? 9 / 16 : 16 / 9))))
  const column = Math.min(width, 480) - 40
  const cardW = Math.round(Math.min(column, height * (ratio < 1 ? 0.46 : 0.34) * ratio))
  const cardH = Math.round(cardW / ratio)

  const takeBlocked = take.phase === 'denied' || take.phase === 'error'
  // One quiet line under the title: what the phone does with the sound, or what to fix when nothing arrives.
  const hint = recording
    ? nudge
      ? 'Toca el vídeo si no empieza'
      : take.silent
        ? 'No llega sonido. Sube el volumen del vídeo.'
        : ''
    : hasPlayer && !takeBlocked
      ? 'El vídeo suena por el altavoz: sube el volumen.'
      : ''
  const taking = recording || take.phase === 'stopping'
  const state = block ?? (shown ? 'ready' : 'loading')
  const meta = link.platform === 'other' ? hostOf(link.url) : [platformName(link.platform), info?.author].filter(Boolean).join(' · ')
  const title = !block || block === 'failed' ? info?.title : ''

  return (
    <Page className="share-link">
      <TopBar left={<IconButton icon={XClose} label="Cerrar" onClick={close} />} />
      <div className="share-link__stage" data-platform={link.platform} data-state={state} data-video={video ?? undefined} data-muted={sound ? String(sound.muted) : undefined}>
        <AnimatePresence mode="wait" initial={false}>
          {block ? (
            <BlockCard
              key={'block-' + block}
              block={block}
              link={link}
              onRetry={block === 'failed' || block === 'offline' ? retry : undefined}
            />
          ) : (
            <motion.div
              key="player"
              className="share-player"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1, width: cardW, height: cardH }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.36, ease }}
            >
              {!shown && (
                <div className="share-player__loading">
                  <Spinner size={24} label="Cargando el vídeo" />
                </div>
              )}
              {playable && (
                <EmbedFrame
                  key={attempt}
                  link={playable}
                  playerRef={player}
                  onReady={onReady}
                  onState={onState}
                  onError={onError}
                  onSound={onSound}
                  className={cx('share-player__frame', shown && 'is-shown')}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="share-link__info">
          {title ? <h1 className="share-link__title">{title}</h1> : <h1 className="visually-hidden">Vídeo compartido</h1>}
          {meta && <p className="share-link__meta">{meta}</p>}
          <p className={cx('share-link__nudge', hint && 'is-on')} aria-live="polite">
            {hint}
          </p>
        </div>

        <div className="share-link__live">
          <AnimatePresence mode="wait" initial={false}>
            {takeBlocked ? (
              <motion.div
                key="message"
                className="share-link__message"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.28, ease }}
              >
                <p role="alert">{take.message}</p>
                <Button sound={false} onClick={() => void take.start()}>Reintentar</Button>
              </motion.div>
            ) : taking ? (
              <motion.div key="meter" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.24, ease }}>
                <Meter levels={take.levels} active={recording} elapsed={take.elapsed} max={take.maxSec} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <div className="share-link__controls">
        {taking ? (
          <IconButton
            icon={Stop}
            label="Detener"
            variant="neu"
            size="xl"
            className="share-link__stop"
            disabled={!recording}
            sound={false}
            onClick={take.finish}
          />
        ) : takeBlocked ? null : block === 'short' ? (
          // A TikTok short link that cannot play here: the saved video is the way in.
          <>
            <Button variant="accent" size="lg" icon={Upload01} loading={opening} onClick={() => fileInput.current?.click()}>
              Archivo
            </Button>
            <Button variant="secondary" size="lg" icon={Microphone01} disabled={opening} loading={take.phase === 'starting'} sound={false} onClick={() => void take.start()}>
              Escuchar
            </Button>
          </>
        ) : (
          // Every device: Pauta listens with the microphone while the video plays aloud; a saved file is the exact audio.
          <>
            <Button variant="accent" size="lg" icon={Microphone01} loading={take.phase === 'starting'} disabled={opening} sound={false} onClick={() => void take.start()}>
              Escuchar
            </Button>
            <Button variant="secondary" size="lg" icon={Upload01} loading={opening} disabled={take.phase === 'starting'} onClick={() => fileInput.current?.click()}>
              Archivo
            </Button>
          </>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="audio/*,video/*"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => void onFile(e)}
      />
    </Page>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function BlockCard({ block, link, onRetry }: { block: Block; link: SharedLink; onRetry?: () => void }) {
  const spec = BLOCKS[block]
  return (
    <motion.div
      className="share-block"
      role="status"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.3, ease }}
    >
      <span className="share-block__icon" aria-hidden="true">
        <Icon icon={spec.icon} size={24} />
      </span>
      <p className="share-block__title">{spec.title(link)}</p>
      <p className="share-block__hint">{spec.hint}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="share-block__retry" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </motion.div>
  )
}

function Meter({ levels, active, elapsed, max }: { levels: LevelStore; active: boolean; elapsed: number; max: number }) {
  const level = useSyncExternalStore(levels.subscribe, levels.get, levels.get)
  return (
    <div className="share-meter">
      <LiveBars level={level} active={active} bars={28} height={40} className="share-meter__bars" />
      <p className="share-meter__time" aria-live="off">
        <span className={cx('share-meter__dot', active && 'is-on')} aria-hidden="true" />
        <span className="share-meter__elapsed tabular">{formatTime(elapsed)}</span>
        <span className="share-meter__max tabular">/ {formatTime(max)}</span>
      </p>
    </div>
  )
}
