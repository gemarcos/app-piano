import type { ReactNode } from 'react'
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
  className?: string
}

/** Thin accent ring with round caps. */
export function ProgressRing({
  value,
  size = 280,
  stroke = 4,
  children,
  indeterminate = false,
  ariaLabel = 'Progreso',
  className,
}: ProgressRingProps) {
  const r = (size - stroke) / 2 - 0.5
  const c = 2 * Math.PI * r
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  const center = size / 2
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
        <circle className="ui-ring__track" cx={center} cy={center} r={r} strokeWidth={stroke} />
        <circle
          className="ui-ring__arc"
          cx={center}
          cy={center}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={indeterminate ? c * 0.72 : c * (1 - v)}
          style={{ opacity: !indeterminate && v <= 0.001 ? 0 : 1 }}
        />
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
