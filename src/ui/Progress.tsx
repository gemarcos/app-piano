import { useEffect, useId, type ReactNode } from 'react'
import { motion, useSpring, useTransform } from 'motion/react'
import { cx } from './cx'
import './Progress.css'

export interface ProgressRingProps {
  /** 0..1 */
  value: number
  size?: number
  stroke?: number
  /** Centered content (time, percentage, a vinyl…). */
  children?: ReactNode
  /** Spinning arc when the duration is unknown. */
  indeterminate?: boolean
  ariaLabel?: string
  /** Soft halo under the arc and a glowing head at its end (default true). */
  glow?: boolean
  className?: string
}

/** Thin accent-gradient ring with round caps, a soft halo and a glowing head. */
export function ProgressRing({
  value,
  size = 280,
  stroke = 4,
  children,
  indeterminate = false,
  ariaLabel = 'Progreso',
  glow = true,
  className,
}: ProgressRingProps) {
  const gradientId = `ui-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const r = (size - stroke) / 2 - 0.5
  const c = 2 * Math.PI * r
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  const center = size / 2
  const shown = indeterminate || v > 0.001
  // One spring drives the arc and its head, so they can never drift apart.
  const eased = useSpring(v, { stiffness: 110, damping: 22, restDelta: 0.0005 })
  useEffect(() => {
    eased.set(indeterminate ? 0.28 : v)
  }, [eased, v, indeterminate])
  const offset = useTransform(eased, (x) => c * (1 - x))
  const headX = useTransform(eased, (x) => center + r * Math.cos(2 * Math.PI * x))
  const headY = useTransform(eased, (x) => center + r * Math.sin(2 * Math.PI * x))
  return (
    <div
      className={cx('ui-ring', indeterminate && 'is-indeterminate', className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(v * 100)}
    >
      <svg className="ui-ring__svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
            <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
          </linearGradient>
        </defs>
        <circle className="ui-ring__track" cx={center} cy={center} r={r} strokeWidth={stroke} />
        {glow && (
          <motion.circle
            className="ui-ring__halo"
            cx={center}
            cy={center}
            r={r}
            strokeWidth={stroke * 4}
            strokeDasharray={c}
            stroke={`url(#${gradientId})`}
            style={{ strokeDashoffset: offset, opacity: shown ? undefined : 0 }}
          />
        )}
        <motion.circle
          className="ui-ring__arc"
          cx={center}
          cy={center}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={c}
          stroke={`url(#${gradientId})`}
          style={{ strokeDashoffset: offset, opacity: shown ? 1 : 0 }}
        />
        {glow && !indeterminate && (
          <g className="ui-ring__head" style={{ opacity: shown ? 1 : 0 }}>
            <motion.circle cx={headX} cy={headY} r={stroke * 2.2} className="ui-ring__head-glow" />
            <motion.circle cx={headX} cy={headY} r={stroke * 0.95} className="ui-ring__head-dot" />
          </g>
        )}
      </svg>
      {children != null && <div className="ui-ring__content">{children}</div>}
    </div>
  )
}

export interface SpinnerProps {
  size?: number
  /** When set, the spinner is announced (role="status"); otherwise it is decorative. */
  label?: string
  className?: string
}

/** Small loading arc in currentColor. */
export function Spinner({ size = 20, label, className }: SpinnerProps) {
  return (
    <svg
      className={cx('ui-spinner', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" opacity="0.18" />
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="56.55"
        strokeDashoffset="40"
      />
    </svg>
  )
}
