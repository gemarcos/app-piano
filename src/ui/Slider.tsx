import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { cx } from './cx'
import './Slider.css'

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function fraction(v: number, min: number, max: number) {
  return max > min ? (clamp(v, min, max) - min) / (max - min) : 0
}

/** Native 'change' = the user released the thumb (React's onChange fires on every input). */
function useCommit(ref: RefObject<HTMLInputElement | null>, cb: ((v: number) => void) | undefined) {
  const cbRef = useRef(cb)
  cbRef.current = cb
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onCommit = () => cbRef.current?.(Number(el.value))
    el.addEventListener('change', onCommit)
    return () => el.removeEventListener('change', onCommit)
  }, [ref])
}

export interface SliderProps {
  value: number
  min: number
  max: number
  step?: number
  /** Every movement. */
  onChange: (value: number) => void
  /** Once, when the user releases (pointer up / key change). */
  onChangeEnd?: (value: number) => void
  ariaLabel: string
  /** Text for the value (aria-valuetext and the optional label). */
  format?: (value: number) => string
  /** Shows the formatted value on the right. */
  showValue?: boolean
  disabled?: boolean
  className?: string
}

/** Native range input (keyboard + screen readers) with a custom track, fill and thumb. */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onChangeEnd,
  ariaLabel,
  format,
  showValue = false,
  disabled = false,
  className,
}: SliderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  useCommit(inputRef, onChangeEnd)
  const text = format ? format(value) : String(value)
  return (
    <div
      className={cx('ui-slider', disabled && 'is-disabled', className)}
      style={{ '--p': fraction(value, min, max) } as CSSProperties}
    >
      <div className="ui-slider__control">
        <div className="ui-slider__track">
          <div className="ui-slider__fill" />
        </div>
        <input
          ref={inputRef}
          type="range"
          className="ui-slider__input"
          min={min}
          max={max}
          step={step}
          value={clamp(value, min, max)}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-valuetext={text}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      {showValue && (
        <span className="ui-slider__value tabular" aria-hidden="true">
          {text}
        </span>
      )}
    </div>
  )
}

export interface RangeSliderProps {
  value: [number, number]
  min: number
  max: number
  step?: number
  /** Minimum distance between both thumbs. */
  minGap?: number
  onChange: (value: [number, number]) => void
  onChangeEnd?: (value: [number, number]) => void
  ariaLabel: string
  /** Names of each thumb, appended to ariaLabel. */
  labels?: [string, string]
  format?: (value: number) => string
  disabled?: boolean
  className?: string
}

/** Two-thumb range (e.g. trim start/end). */
export function RangeSlider({
  value,
  min,
  max,
  step = 1,
  minGap = 0,
  onChange,
  onChangeEnd,
  ariaLabel,
  labels = ['inicio', 'fin'],
  format,
  disabled = false,
  className,
}: RangeSliderProps) {
  const lowRef = useRef<HTMLInputElement>(null)
  const highRef = useRef<HTMLInputElement>(null)
  const [a, b] = value
  const valueRef = useRef(value)
  valueRef.current = value
  const commit = onChangeEnd ? () => onChangeEnd(valueRef.current) : undefined
  useCommit(lowRef, commit)
  useCommit(highRef, commit)

  const fmt = (v: number) => (format ? format(v) : String(v))
  const lowOnTop = a > min + (max - min) / 2
  return (
    <div
      className={cx('ui-slider', 'ui-slider--range', disabled && 'is-disabled', className)}
      style={{ '--pa': fraction(a, min, max), '--pb': fraction(b, min, max) } as CSSProperties}
    >
      <div className="ui-slider__control">
        <div className="ui-slider__track">
          <div className="ui-slider__fill" />
        </div>
        <input
          ref={lowRef}
          type="range"
          className="ui-slider__input"
          min={min}
          max={max}
          step={step}
          value={clamp(a, min, max)}
          disabled={disabled}
          aria-label={`${ariaLabel}: ${labels[0]}`}
          aria-valuetext={fmt(a)}
          style={{ zIndex: lowOnTop ? 3 : 2 }}
          onChange={(e) => onChange([Math.min(Number(e.target.value), b - minGap), b])}
        />
        <input
          ref={highRef}
          type="range"
          className="ui-slider__input"
          min={min}
          max={max}
          step={step}
          value={clamp(b, min, max)}
          disabled={disabled}
          aria-label={`${ariaLabel}: ${labels[1]}`}
          aria-valuetext={fmt(b)}
          style={{ zIndex: lowOnTop ? 2 : 3 }}
          onChange={(e) => onChange([a, Math.max(Number(e.target.value), a + minGap)])}
        />
      </div>
    </div>
  )
}
