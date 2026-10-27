import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { motion, useMotionValue, type MotionValue } from 'motion/react'
import { useReducedMotionPref } from './hooks'
import { cx } from './cx'
import './Vinyl.css'

export interface VinylProps {
  /** Width and height of the whole piece (record, plinth and tonearm fit inside), px. */
  size?: number
  spinning?: boolean
  /** normal = 33 1/3 rpm, slow = a calm idle spin (listening / processing). */
  speed?: 'slow' | 'normal'
  /** Content of the center label (an Icon, a short time…). */
  label?: ReactNode
  /** Image for the center label (a cover). */
  labelSrc?: string
  /** hidden (default) = record centered; rest/play = tonearm parked / on the record. */
  tonearm?: 'rest' | 'play' | 'hidden'
  /** 0..1 thin accent ring around the record. */
  progress?: number
  /** Soft neumorphic round base under the record. */
  plinth?: boolean
  onClick?: () => void
  ariaLabel?: string
  className?: string
}

/** Degrees per second. 33 1/3 rpm = 200 deg/s. */
const SPEED = { slow: 72, normal: 200 } as const

/** Continuous rotation with inertia: eases up/down to the target speed, never jumps. */
function useTurntable(rotate: MotionValue<number>, target: number) {
  const state = useRef({ vel: 0, target: 0, raf: 0, last: 0 })

  useEffect(() => {
    const s = state.current
    s.target = target
    if (s.raf || (target === 0 && s.vel === 0)) return
    s.last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.064, Math.max(0, (now - s.last) / 1000))
      s.last = now
      const tau = s.target > s.vel ? 0.5 : 0.85
      s.vel += (s.target - s.vel) * (1 - Math.exp(-dt / tau))
      if (s.target === 0 && s.vel < 1.5) s.vel = 0
      rotate.set((rotate.get() + s.vel * dt) % 360)
      if (s.vel === 0 && s.target === 0) {
        s.raf = 0
        return
      }
      s.raf = requestAnimationFrame(loop)
    }
    s.raf = requestAnimationFrame(loop)
  }, [target, rotate])

  useEffect(() => {
    const s = state.current
    return () => {
      cancelAnimationFrame(s.raf)
      s.raf = 0
    }
  }, [])
}

/* Geometry, in % of the square box. */
const DECK_CENTERED = { cx: 50, cy: 50, r: 50 }
const DECK_WITH_ARM = { cx: 43, cy: 51, r: 42 }
const PIVOT = { x: 87.5, y: 15 }

function armGeometry(deck: typeof DECK_WITH_ARM, recordR: number) {
  const a = (17 * Math.PI) / 180
  const reach = recordR * 0.8
  const sx = deck.cx + reach * Math.cos(a)
  const sy = deck.cy + reach * Math.sin(a)
  const length = Math.hypot(sx - PIVOT.x, sy - PIVOT.y)
  const playDeg = (Math.atan2(PIVOT.x - sx, sy - PIVOT.y) * 180) / Math.PI
  return { length, playDeg }
}

/** The signature turntable record. */
export function Vinyl({
  size = 260,
  spinning = false,
  speed = 'normal',
  label,
  labelSrc,
  tonearm = 'hidden',
  progress,
  plinth = true,
  onClick,
  ariaLabel,
  className,
}: VinylProps) {
  const reduced = useReducedMotionPref()
  const rotate = useMotionValue(0)
  useTurntable(rotate, spinning && !reduced ? SPEED[speed] : 0)

  const withArm = tonearm !== 'hidden'
  const deck = withArm ? DECK_WITH_ARM : DECK_CENTERED
  const recordScale = plinth ? 0.86 : 0.9
  const arm = withArm ? armGeometry(deck, deck.r * recordScale) : null
  const ringR = plinth ? 45 : 47.6
  const ringLen = 2 * Math.PI * ringR
  // Stroke in viewBox units so it renders ~3px (2px on small records).
  const deckPx = (size * deck.r * 2) / 100
  const ringStroke = ((size >= 200 ? 3 : 2) * 100) / deckPx
  const p = progress == null ? null : Math.min(1, Math.max(0, progress))
  const clickable = Boolean(onClick)

  const onKeyDown = clickable
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }
    : undefined

  return (
    <motion.div
      className={cx('ui-vinyl', clickable && 'is-clickable', className)}
      style={{ width: size, height: size }}
      role={clickable ? 'button' : ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={!clickable && !ariaLabel ? true : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
      whileTap={clickable ? { scale: 0.985 } : undefined}
    >
      <div
        className="ui-vinyl__deck"
        style={{ left: `${deck.cx - deck.r}%`, top: `${deck.cy - deck.r}%`, width: `${deck.r * 2}%`, height: `${deck.r * 2}%` }}
      >
        {plinth && (
          <div className="ui-vinyl__plinth">
            <div className="ui-vinyl__well" />
          </div>
        )}
        {p != null && (
          <svg className="ui-vinyl__ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
            <circle className="ui-vinyl__ring-track" cx="50" cy="50" r={ringR} strokeWidth={ringStroke} />
            <circle
              className="ui-vinyl__ring-arc"
              cx="50"
              cy="50"
              r={ringR}
              strokeWidth={ringStroke}
              strokeDasharray={`${ringLen} ${ringLen}`}
              strokeDashoffset={ringLen * (1 - p)}
              transform="rotate(-90 50 50)"
              style={{ opacity: p <= 0.001 ? 0 : 1 }}
            />
          </svg>
        )}
        <div className="ui-vinyl__record" style={{ inset: `${((1 - recordScale) * 50).toFixed(2)}%` }}>
          <motion.div className="ui-vinyl__disc" style={{ rotate }}>
            <div className="ui-vinyl__label">
              {labelSrc ? <img src={labelSrc} alt="" draggable={false} /> : label != null ? label : <DefaultLabel />}
            </div>
          </motion.div>
          <div className="ui-vinyl__sheen" />
          <div className="ui-vinyl__spindle" />
        </div>
      </div>
      {arm && <Tonearm length={arm.length} playDeg={arm.playDeg} playing={tonearm === 'play'} />}
    </motion.div>
  )
}

function DefaultLabel() {
  return (
    <svg className="ui-vinyl__label-art" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle className="ui-vinyl__label-ring" cx="50" cy="50" r="41" />
      <circle className="ui-vinyl__label-ring" cx="50" cy="50" r="24" />
      <path className="ui-vinyl__label-print" d="M 21 46 A 29.5 29.5 0 0 1 46 20.7" />
      <path className="ui-vinyl__label-print is-short" d="M 79.3 56 A 29.5 29.5 0 0 1 68 74" />
      <circle className="ui-vinyl__label-dot" cx="50" cy="14.5" r="3" />
    </svg>
  )
}

function Tonearm({ length, playDeg, playing }: { length: number; playDeg: number; playing: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const metal = `ui-vinyl-metal-${uid}`
  const { x, y } = PIVOT
  const end = y + length
  return (
    <>
      <svg className="ui-vinyl__armbase" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle className="ui-vinyl__plate" cx={x} cy={y} r={8.2} />
        <circle className="ui-vinyl__post" cx={x} cy={end - 14} r={2.1} />
      </svg>
      <motion.div
        className="ui-vinyl__arm"
        style={{ transformOrigin: `${x}% ${y}%` }}
        initial={false}
        animate={{ rotate: playing ? playDeg : 0 }}
        transition={{ duration: 1.1, ease: [0.45, 0, 0.2, 1] }}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={metal} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--metal-hi)' }} />
              <stop offset="0.55" style={{ stopColor: 'var(--metal)' }} />
              <stop offset="1" style={{ stopColor: 'var(--metal-lo)' }} />
            </linearGradient>
          </defs>
          <rect x={x - 3.4} y={y - 12.5} width={6.8} height={8.4} rx={2} fill={`url(#${metal})`} />
          <line className="ui-vinyl__tube" x1={x} y1={y} x2={x} y2={end - 9.5} />
          <line className="ui-vinyl__tube" x1={x} y1={end - 9.5} x2={x - 1.3} y2={end - 6.2} />
          <line className="ui-vinyl__lift" x1={x - 0.4} y1={end - 4.6} x2={x + 2.6} y2={end - 6.4} />
          <rect
            className="ui-vinyl__head"
            x={x - 3.8}
            y={end - 7.2}
            width={4.8}
            height={7.2}
            rx={1.1}
            transform={`rotate(-14 ${x - 1.4} ${end - 3.6})`}
          />
          <circle cx={x} cy={y} r={4.8} fill={`url(#${metal})`} />
          <circle className="ui-vinyl__hub" cx={x} cy={y} r={1.8} />
        </svg>
      </motion.div>
    </>
  )
}
