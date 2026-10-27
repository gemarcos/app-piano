// Owner: viewer. Score viewer ('/score/:id'): the score on paper, a floating player, a settings
// sheet (playback, notation, filters) that rebuilds the score live, and the overflow actions.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DotsHorizontal, Heart } from '@untitled-ui/icons-react'
import type { ScoreDoc } from '../../types'
import { getAudio, updateScore, useScoreDoc } from '../../data/db'
import { useSettings } from '../../state/settings'
import { keyName, secondsToTick, sourceSecondsAt, tickAtSourceSeconds, tickToSeconds } from '../../engine/score'
import { BackButton, Button, EmptyState, IconButton, Page, TopBar, cx, useReducedMotionPref, useToast } from '../../ui'
import { useLiveScore, useDebounced } from './useLiveScore'
import { useViewState } from './viewState'
import type { PlayerSpec } from './player'
import { useScorePlayer } from './usePlayer'
import { noteDynamics, pedalSeconds, planVoices, playNotes, voicesKey } from './pianoPlan'
import { setPianoSound, usePianoSound } from './pianoSound'
import { ScorePaper, type PaperHandle } from './ScorePaper'
import { PlayerBar } from './PlayerBar'
import { SettingsSheet, type SheetTab } from './SettingsSheet'
import { ViewerActions } from './ViewerActions'
import { printScore } from './exports'
import {
  abTap,
  clampRange,
  loopBounds,
  measureSeconds,
  nextMeasureTime,
  previousMeasureTime,
  scoreSeconds,
  type LoopMode,
} from './timeline'
import './Viewer.css'

export function ViewerScreen() {
  const { id = '' } = useParams()
  const doc = useScoreDoc(id)
  // A deleted item keeps its last view while the screen leaves.
  const last = useRef<ScoreDoc | null>(null)
  if (doc) last.current = doc
  const shown = doc === null && last.current?.id === id ? last.current : doc

  if (shown === undefined) return <ViewerLoading />
  if (shown === null) return <ViewerMissing />
  return <Viewer key={shown.id} doc={shown} />
}

function ViewerLoading() {
  return (
    <Page className="vw-page" padded={false}>
      <TopBar left={<BackButton fallback="/library" />} />
      <div className="vw-body" aria-hidden="true">
        <div className="vw-paper-skeleton" />
      </div>
    </Page>
  )
}

function ViewerMissing() {
  const navigate = useNavigate()
  return (
    <Page>
      <TopBar left={<BackButton fallback="/library" />} />
      <EmptyState title="No encontramos esta partitura" action={{ label: 'Ir a la biblioteca', onClick: () => navigate('/library', { replace: true }) }} />
    </Page>
  )
}

/** The stored recording behind "Original" playback, if any. */
function useOriginalBlob(audioId: string | undefined): Blob | null {
  const [blob, setBlob] = useState<Blob | null>(null)
  useEffect(() => {
    if (!audioId) return
    let alive = true
    getAudio(audioId)
      .then((a) => alive && setBlob(a?.blob ?? null))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [audioId])
  return audioId ? blob : null
}

const LOOP_CYCLE: Record<LoopMode, LoopMode> = { off: 'all', all: 'ab', ab: 'off' }

function Viewer({ doc }: { doc: ScoreDoc }) {
  const toast = useToast()
  const reduced = useReducedMotionPref()
  const naming = useSettings((s) => s.noteNaming)
  const metronome = useSettings((s) => s.metronome)
  const countIn = useSettings((s) => s.countIn)
  const followScore = useSettings((s) => s.followScore)
  const volume = useSettings((s) => s.playbackVolume)
  const sustainPedal = useSettings((s) => s.sustainPedal)
  const pianoSound = usePianoSound()
  const setSetting = useSettings((s) => s.set)

  const [view, setView] = useViewState(doc.id)
  const { params, patch, reset, resetFilters, score, analysis } = useLiveScore(doc)
  const zoom = useDebounced(view.zoom, 140)
  const blob = useOriginalBlob(doc.audioId)
  const hasNotes = score.stats.noteCount > 0
  const loopRange = clampRange(view.loopRange, score.measureCount)
  const [abPending, setAbPending] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetTab, setSheetTab] = useState<SheetTab>('play')
  const [actionsOpen, setActionsOpen] = useState(false)

  useEffect(() => {
    updateScore(doc.id, { openedAt: Date.now() }, false).catch(() => {})
  }, [doc.id])

  /* ---------- playback ---------- */

  // What the piano plays: every note of the shown hands with its own timing and loudness, the dampers
  // driven by the key releases and (when Pedal is on) the sustain pedal inferred from the audio.
  const play = useMemo(() => {
    if (!hasNotes) return null
    const notes = playNotes(score, view.hands)
    if (!notes.length) return null
    const voices = planVoices(notes, noteDynamics(notes), sustainPedal ? pedalSeconds(score) : [])
    return { voices, key: voicesKey(voices) }
  }, [score, view.hands, hasNotes, sustainPedal])
  const loopA = loopRange?.[0]
  const loopB = loopRange?.[1]
  const loop = useMemo(
    () => loopBounds(score, view.loop, loopA === undefined || loopB === undefined ? null : [loopA, loopB]),
    [score, view.loop, loopA, loopB],
  )
  const spec = useMemo<PlayerSpec>(
    () => ({
      synth: play
        ? {
            voices: play.voices,
            key: `${play.key}|${pianoSound}`,
            instrument: pianoSound,
            msPerMeasure: measureSeconds(score) * 1000,
            timeSignature: score.timeSignature,
          }
        : null,
      duration: scoreSeconds(score),
      speed: view.speed,
      metronome,
      countIn,
      volume,
      loop,
      sound: view.sound === 'original' && blob ? 'original' : 'piano',
      // Score time <-> recording time through the analysis beat map (rubato stays in sync).
      original: blob
        ? {
            blob,
            toSource: (seconds: number) => sourceSecondsAt(score, secondsToTick(score, seconds), analysis),
            fromSource: (seconds: number) => tickToSeconds(score, tickAtSourceSeconds(score, seconds, analysis)),
          }
        : null,
    }),
    [play, pianoSound, score, view.speed, metronome, countIn, volume, loop, view.sound, blob, analysis],
  )

  const paperRef = useRef<PaperHandle>(null)
  const scoreRef = useRef(score)
  scoreRef.current = score
  const paramsRef = useRef(params)
  paramsRef.current = params
  const followRef = useRef(followScore)
  followRef.current = followScore
  const playerRef = useRef<{ playing: boolean } | null>(null)

  const onFrame = useCallback((position: number, cursor: boolean) => {
    const tick = cursor ? secondsToTick(scoreRef.current, position) : null
    paperRef.current?.setCursor(tick, followRef.current && !!playerRef.current?.playing)
  }, [])
  const onError = useCallback((message: string) => toast.show(message, { tone: 'danger' }), [toast])
  const [player, snap] = useScorePlayer(spec, onFrame, onError)
  playerRef.current = player

  const seekTo = useCallback((seconds: number) => player.seek(seconds), [player])
  const previous = () => seekTo(previousMeasureTime(score, player.getSnapshot().position))
  const next = () => {
    const t = nextMeasureTime(score, player.getSnapshot().position)
    if (t != null) seekTo(t)
  }

  const setLoopMode = (mode: LoopMode) => {
    setView({ loop: mode })
    if (mode === 'ab') {
      setAbPending(false)
      if (!view.loopRange) toast.show('Toca el primer y el último compás')
    }
  }

  const onTap = (tick: number, measure: number) => {
    if (view.loop === 'ab') {
      const sel = abTap(loopRange, abPending, measure)
      setView({ loopRange: sel.range })
      setAbPending(sel.pending)
      seekTo(Math.min(sel.range[0], sel.range[1]) * measureSeconds(score))
      return
    }
    seekTo(tickToSeconds(score, tick))
  }

  const onScrub = (seconds: number | null) => {
    if (seconds == null) return
    paperRef.current?.setCursor(secondsToTick(score, seconds), followScore)
  }

  const openSheet = (tab?: SheetTab) => {
    if (tab) setSheetTab(tab)
    setSheetOpen(true)
  }

  // Desktop niceties: space plays, arrows move by measure (not while typing or in a dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
      if (document.documentElement.classList.contains('ui-scroll-locked')) return
      const el = e.target as HTMLElement | null
      if (el && el.closest('input, select, textarea, button, [role="slider"], [role="spinbutton"], [contenteditable="true"]')) return
      if (e.key === ' ') {
        e.preventDefault()
        player.toggle()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seekTo(previousMeasureTime(scoreRef.current, player.getSnapshot().position))
      } else if (e.key === 'ArrowRight') {
        const t = nextMeasureTime(scoreRef.current, player.getSnapshot().position)
        if (t != null) {
          e.preventDefault()
          seekTo(t)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player, seekTo])

  const viewport = useCallback(() => {
    const top = document.querySelector('.vw-topbar')?.getBoundingClientRect().bottom ?? 0
    const bottom = document.querySelector('.vw-player')?.getBoundingClientRect().top ?? window.innerHeight
    return { top: Math.max(0, top), bottom: Math.min(window.innerHeight, bottom) }
  }, [])

  const meta = `${keyName(score.key, naming)} · ${score.timeSignature} · ${Math.round(score.bpm)} ppm`
  const original = view.sound === 'original' && !!blob

  const empty = hasNotes ? undefined : (
    <div className="vw-empty">
      <p className="vw-empty__text">{doc.notes.length ? 'No quedan notas con estos filtros' : 'Esta partitura no tiene notas'}</p>
      {doc.notes.length > 0 && (
        <Button variant="secondary" size="sm" onClick={resetFilters}>
          Restablecer filtros
        </Button>
      )}
    </div>
  )

  return (
    <Page className="vw-page" padded={false}>
      <TopBar
        sticky
        className="vw-topbar"
        left={<BackButton fallback="/library" />}
        title={doc.title}
        subtitle={
          <button type="button" className="vw-meta tabular" onClick={() => openSheet('score')} aria-label={`${meta}. Ajustes de la partitura`}>
            {meta}
          </button>
        }
        right={
          <>
            <IconButton
              icon={Heart}
              label={doc.favorite ? 'Quitar de favoritas' : 'Añadir a favoritas'}
              pressed={doc.favorite}
              className={cx('vw-fav', doc.favorite && 'is-fav')}
              onClick={() => updateScore(doc.id, { favorite: !doc.favorite }, false).catch(() => {})}
            />
            <IconButton icon={DotsHorizontal} label="Más opciones" onClick={() => setActionsOpen(true)} />
          </>
        }
      />

      <div className="vw-body">
        <ScorePaper
          ref={paperRef}
          score={score}
          hands={view.hands}
          naming={naming}
          pedalMarks={sustainPedal}
          zoom={zoom}
          band={view.loop === 'ab' ? loopRange : null}
          onTap={onTap}
          viewport={viewport}
          reducedMotion={reduced}
          empty={empty}
        />
      </div>

      <PlayerBar
        snap={snap}
        speed={view.speed}
        metronome={metronome}
        metronomeDisabled={original}
        loop={view.loop}
        disabled={!hasNotes}
        onToggle={() => player.toggle()}
        onSeek={seekTo}
        onScrub={onScrub}
        onPrevious={previous}
        onNext={next}
        onMetronome={() => setSetting('metronome', !metronome)}
        onLoop={() => setLoopMode(LOOP_CYCLE[view.loop])}
        onSpeed={() => openSheet('play')}
        onSettings={() => openSheet()}
      />

      <SettingsSheet
        open={sheetOpen}
        tab={sheetTab}
        onTab={setSheetTab}
        onClose={() => setSheetOpen(false)}
        playback={{
          view,
          setView,
          settings: { metronome, countIn, followScore, sustainPedal },
          setSetting,
          hasOriginal: !!blob,
          onLoopMode: setLoopMode,
          pianoSound,
          onPianoSound: setPianoSound,
        }}
        notation={{ view, setView, naming, setSetting, params, patch, analysis, score }}
        filters={{
          params,
          patch,
          naming,
          onReset: () => {
            reset()
            toast.show('Partitura restablecida')
          },
        }}
      />

      <ViewerActions
        doc={doc}
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        onStop={() => player.pause()}
        getParams={() => paramsRef.current}
        onPrint={() => printScore(scoreRef.current, { title: doc.title, composer: doc.composer, hands: view.hands, naming, pedalMarks: sustainPedal })}
      />
    </Page>
  )
}
