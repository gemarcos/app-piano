// Owner: capture. Inicio ('/'): calm and almost empty. The vinyl is the hero (tap it to listen); two quiet
// actions bring in a file or a browser tab; "Recientes" appears once the library has items.
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { Monitor02, Upload01 } from '@untitled-ui/icons-react'
import { DECODE_ERROR_MESSAGE, decodeMediaFile, isMicSupported, isTabCaptureSupported } from '../../engine/audio'
import { preloadModel } from '../../engine/transcribe'
import { getSettings } from '../../state/settings'
import { useAllScores } from '../../data/db'
import { DEMOS_SEEDED_KEY } from '../../data/seed'
import type { ScoreDoc } from '../../types'
import { Button, Page, TopBar, Vinyl, ease, fadeUp, useToast } from '../../ui'
import { defaultSelection } from '../capture/selection'
import { useCaptureStore } from '../capture/store'
import { rememberHeroVinyl, useViewportSize, whenIdle } from '../capture/util'
import { LinkPill } from '../share/LinkPill'
import { Recents } from './Recents'
import './HomeScreen.css'

const MAX_RECENTS = 8
/** Larger files are refused before decoding (the whole file is decoded in memory). */
const MAX_FILE_BYTES = 750 * 1024 * 1024
/**
 * Whether Home showed "Recientes" last time. The library loads asynchronously (IndexedDB can take a few
 * hundred ms to open), so this hint picks the final layout from the first frame instead of shrinking the
 * vinyl when the items arrive.
 */
const RECENTS_HINT_KEY = 'pauta.home.recents'

function readRecentsHint(): boolean {
  try {
    const stored = window.localStorage.getItem(RECENTS_HINT_KEY)
    if (stored !== null) return stored === '1'
    // First run on this device: the library is about to seed the demo pieces, so "Recientes" will appear.
    return window.localStorage.getItem(DEMOS_SEEDED_KEY) !== '1'
  } catch {
    return false
  }
}

function writeRecentsHint(value: boolean) {
  try {
    window.localStorage.setItem(RECENTS_HINT_KEY, value ? '1' : '0')
  } catch {
    // storage unavailable: the layout may adjust once when the library loads
  }
}

function lastTouched(doc: ScoreDoc): number {
  return Math.max(doc.openedAt ?? 0, doc.updatedAt ?? 0, doc.createdAt ?? 0)
}

export function HomeScreen() {
  const navigate = useNavigate()
  const toast = useToast()
  const docs = useAllScores()
  const { width, height } = useViewportSize()
  const [tabSupported] = useState(isTabCaptureSupported)
  const [decoding, setDecoding] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const hero = useRef<HTMLDivElement>(null)
  const alive = useRef(false)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Warm the chosen transcriber up while the user decides (idempotent, never rejects, never downloads the piano model).
  useEffect(() => whenIdle(() => void preloadModel(getSettings().transcriptionModel)), [])

  const recents = useMemo(
    () => (docs ?? []).slice().sort((a, b) => lastTouched(b) - lastTouched(a)).slice(0, MAX_RECENTS),
    [docs],
  )
  const [recentsHint] = useState(readRecentsHint)
  const loaded = docs !== undefined
  const hasRecents = loaded ? recents.length > 0 : recentsHint
  useEffect(() => {
    if (loaded) writeRecentsHint(hasRecents)
  }, [loaded, hasRecents])

  const listen = () => {
    if (decoding) return
    if (!isMicSupported()) {
      toast.show('Este navegador no permite grabar audio.', { tone: 'danger' })
      return
    }
    rememberHeroVinyl(hero.current)
    navigate('/listen?mode=mic')
  }

  const listenTab = () => {
    rememberHeroVinyl(null)
    navigate('/listen?mode=tab')
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      toast.show('Este archivo es demasiado grande.', { tone: 'danger' })
      return
    }
    setDecoding(true)
    try {
      const decoded = await decodeMediaFile(file)
      if (!alive.current) return
      useCaptureStore.getState().setFile(file, decoded, defaultSelection(decoded.duration))
      navigate('/import')
    } catch (err) {
      if (alive.current) toast.show((err as Error)?.message || DECODE_ERROR_MESSAGE, { tone: 'danger' })
    } finally {
      if (alive.current) setDecoding(false)
    }
  }

  const size = Math.round(Math.max(200, Math.min(width - 64, height * (hasRecents ? 0.34 : 0.42), 320)))

  return (
    <Page variant="tab" tabBar className="home">
      <TopBar large title="Pauta" className="home-topbar" />
      <section className={hasRecents ? 'home-hero has-recents' : 'home-hero'}>
        <motion.div
          ref={hero}
          className="home-hero__vinyl"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease }}
        >
          <Vinyl size={size} tonearm="rest" onClick={listen} ariaLabel="Escuchar" />
        </motion.div>
        <motion.p className="home-hero__hint" {...fadeUp(0.08, 8)}>
          Toca para escuchar
        </motion.p>
        <motion.div className="home-hero__actions" {...fadeUp(0.14, 8)}>
          <Button variant="secondary" icon={Upload01} loading={decoding} onClick={() => fileInput.current?.click()}>
            Archivo
          </Button>
          <LinkPill disabled={decoding} />
          {tabSupported && (
            <Button variant="secondary" icon={Monitor02} disabled={decoding} onClick={listenTab}>
              Pestaña
            </Button>
          )}
        </motion.div>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,video/*"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => void onFile(e)}
        />
      </section>
      {hasRecents && <Recents docs={loaded ? recents : []} />}
    </Page>
  )
}
