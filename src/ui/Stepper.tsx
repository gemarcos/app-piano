import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { motion } from 'motion/react'
import { Minus, Plus } from '@untitled-ui/icons-react'
import { Icon, type IconComponent } from './Icon'
import { spring } from './motion'
import { playUiSound } from './sound'
import { cx } from './cx'
import './Stepper.css'

function decimalsOf(step: number): number {
  const s = String(step)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

export interface StepperProps {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  format?: (value: number) => string
  ariaLabel: string
  disabled?: boolean
  className?: string
}

/** − value + with press-and-hold repeat. The value is a spinbutton (arrow keys, Home/End). */
export function Stepper({ value, min, max, step = 1, onChange, format, ariaLabel, disabled = false, className }: StepperProps) {
  const current = useRef(value)
  current.current = value
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const decimals = decimalsOf(step)

  const setTo = useCallback(
    (target: number) => {
      const next = Number(Math.min(max, Math.max(min, target)).toFixed(decimals))
      if (next === current.current) return false
      current.current = next
      changeRef.current(next)
      return true
    },
    [min, max, decimals],
  )

  const nudge = useCallback((dir: 1 | -1) => setTo(current.current + dir * step), [setTo, step])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    let handled = true
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') nudge(1)
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') nudge(-1)
    else if (e.key === 'PageUp') setTo(current.current + step * 10)
    else if (e.key === 'PageDown') setTo(current.current - step * 10)
    else if (e.key === 'Home') setTo(min)
    else if (e.key === 'End') setTo(max)
    else handled = false
    if (handled) e.preventDefault()
  }

  const text = format ? format(value) : String(value)
  return (
    <div className={cx('ui-stepper', disabled && 'is-disabled', className)} role="group" aria-label={ariaLabel}>
      <StepButton icon={Minus} label="Disminuir" disabled={disabled || value <= min} onStep={() => nudge(-1)} />
      <div
        className="ui-stepper__value tabular"
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={text}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
      >
        {text}
      </div>
      <StepButton icon={Plus} label="Aumentar" disabled={disabled || value >= max} onStep={() => nudge(1)} />
    </div>
  )
}

function StepButton({ icon, label, disabled, onStep }: { icon: IconComponent; label: string; disabled: boolean; onStep: () => boolean }) {
  const stepRef = useRef(() => {
    const moved = onStep()
    if (moved) playUiSound('select')
    return moved
  })
  stepRef.current = () => {
    const moved = onStep()
    if (moved) playUiSound('select')
    return moved
  }
  const timer = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  useEffect(() => stop, [stop])
  useEffect(() => {
    if (disabled) stop()
  }, [disabled, stop])

  const start = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || disabled) return
    stop()
    stepRef.current()
    let count = 0
    const tick = () => {
      count++
      if (!stepRef.current()) {
        stop()
        return
      }
      timer.current = window.setTimeout(tick, count > 8 ? 45 : 95)
    }
    timer.current = window.setTimeout(tick, 420)
  }

  return (
    <motion.button
      type="button"
      className="ui-stepper__btn"
      aria-label={label}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      // Pointer presses are handled on pointerdown; detail === 0 means keyboard activation.
      onClick={(e) => {
        if (e.detail === 0) stepRef.current()
      }}
      whileTap={disabled ? undefined : { scale: 0.88 }}
      transition={spring}
    >
      <Icon icon={icon} size={20} />
    </motion.button>
  )
}
