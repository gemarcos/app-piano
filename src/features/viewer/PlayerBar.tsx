// Owner: viewer. Floating glass player at the bottom: time and seekable progress, transport
// (previous measure, play/pause, next measure) and quick toggles (metronome, loop, speed, settings).
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ClockStopwatch, Play, Repeat01, SkipBack, SkipForward, Sliders01 } from '@untitled-ui/icons-react'
import { IconButton, PauseIcon, Slider, Spinner, cx, ease, useReducedMotionPref } from '../../ui'
import { formatTime } from '../../lib/format'
import type { PlayerSnapshot } from './player'
import { formatSpeed, type LoopMode } from './timeline'
import './PlayerBar.css'

export interface PlayerBarProps {
  snap: PlayerSnapshot
  /** Percent. Times are shown at this speed (what you will actually hear). */
  speed: number
  metronome: boolean
  metronomeDisabled: boolean
  loop: LoopMode
  disabled: boolean
  onToggle: () => void
  onSeek: (seconds: number) => void
  /** Preview of a position while the progress thumb is dragged (null when released). */
  onScrub: (seconds: number | null) => void
  onPrevious: () => void
  onNext: () => void
  onMetronome: () => void
  onLoop: () => void
  onSpeed: () => void
  onSettings: () => void
}

const LOOP_LABEL: Record<LoopMode, string> = {
  off: 'Bucle desactivado',
  all: 'Bucle: toda la partitura',
  ab: 'Bucle: compases elegidos',
}

export function PlayerBar(props: PlayerBarProps) {
  const { snap, speed, metronome, metronomeDisabled, loop, disabled } = props
  const [scrub, setScrub] = useState<number | null>(null)
  const speedF = speed / 100
  // Nothing to play (no notes left): the empty bar's length means nothing, show 0:00.
  const duration = disabled ? 0 : snap.duration
  const position = scrub ?? snap.position
  const playing = snap.status === 'playing' || snap.status === 'countin'
  const reduced = useReducedMotionPref()
  const loading = snap.status === 'loading'

  const onScrub = (v: number) => {
    setScrub(v)
    props.onScrub(v)
  }
  const onScrubEnd = (v: number) => {
    setScrub(null)
    props.onScrub(null)
    props.onSeek(v)
  }

  return (
    <div className="vw-player-dock">
      <motion.div
        className={cx('vw-player', disabled && 'is-disabled')}
        role="region"
        aria-label="Reproducción"
        data-status={snap.status}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease, delay: 0.12 }}
      >
        <div className="vw-player__progress">
          <span className="vw-player__time tabular">{formatTime(position / speedF)}</span>
          <Slider
            className="vw-player__slider"
            value={Math.min(position, duration)}
            min={0}
            max={Math.max(0.01, duration)}
            step={0.05}
            onChange={onScrub}
            onChangeEnd={onScrubEnd}
            disabled={disabled}
            ariaLabel="Posición"
            format={(v) => `${formatTime(v / speedF)} de ${formatTime(duration / speedF)}`}
          />
          <span className="vw-player__time vw-player__time--total tabular">{formatTime(duration / speedF)}</span>
        </div>

        <div className="vw-player__controls">
          <div className="vw-player__side">
            <IconButton
              icon={ClockStopwatch}
              label="Metrónomo"
              size="sm"
              iconSize={20}
              pressed={metronome}
              active={metronome && !metronomeDisabled}
              disabled={metronomeDisabled || disabled}
              onClick={props.onMetronome}
              className="vw-player__toggle"
            />
            <span className="vw-player__loop">
              <IconButton
                icon={Repeat01}
                label={LOOP_LABEL[loop]}
                size="sm"
                iconSize={20}
                pressed={loop !== 'off'}
                active={loop !== 'off'}
                disabled={disabled}
                onClick={props.onLoop}
                className="vw-player__toggle"
              />
              {loop === 'ab' && (
                <span className="vw-player__badge" aria-hidden="true">
                  A–B
                </span>
              )}
            </span>
          </div>

          <div className="vw-player__transport">
            <IconButton icon={SkipBack} label="Compás anterior" onClick={props.onPrevious} disabled={disabled} iconSize={22} />
            <span className={cx('vw-player__play', loading && 'is-loading')}>
              {/* While it plays, a soft ring breathes out of the button. */}
              <AnimatePresence>
                {playing && !reduced && (
                  <motion.span
                    key="pulse"
                    className="vw-player__pulse"
                    aria-hidden="true"
                    initial={{ opacity: 0, transform: 'scale(1)' }}
                    animate={{ opacity: [0.5, 0], transform: ['scale(1)', 'scale(1.45)'] }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.6, ease: 'easeOut', repeat: Infinity }}
                  />
                )}
              </AnimatePresence>
              <IconButton
                icon={playing ? PauseIcon : Play}
                label={playing || loading ? 'Pausar' : 'Reproducir'}
                variant="accent"
                size="lg"
                iconSize={26}
                onClick={props.onToggle}
                disabled={disabled}
                sound={false}
                className="vw-player__playbtn"
              />
              {loading && (
                <span className="vw-player__spinner">
                  <Spinner size={22} />
                </span>
              )}
            </span>
            <IconButton icon={SkipForward} label="Compás siguiente" onClick={props.onNext} disabled={disabled} iconSize={22} />
          </div>

          <div className="vw-player__side vw-player__side--end">
            <button
              type="button"
              className={cx('vw-player__speed tabular', speed !== 100 && 'is-active')}
              onClick={props.onSpeed}
              disabled={disabled}
              aria-label={`Velocidad ${formatSpeed(speed)}`}
            >
              {formatSpeed(speed)}
            </button>
            <IconButton icon={Sliders01} label="Ajustes de la partitura" size="sm" iconSize={20} onClick={props.onSettings} className="vw-player__toggle" />
          </div>
        </div>
      </motion.div>
    </div>
  )
}
