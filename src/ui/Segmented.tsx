import { useId, useRef, type KeyboardEvent } from 'react'
import { motion } from 'motion/react'
import { Icon, type IconComponent } from './Icon'
import { spring } from './motion'
import { playUiSound } from './sound'
import { cx } from './cx'
import './Segmented.css'

export interface SegmentedOption<T extends string | number> {
  value: T
  label?: string
  icon?: IconComponent
  /** Required when the option has no label (icon only). */
  ariaLabel?: string
}

export interface SegmentedProps<T extends string | number> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** sm 32px, md 40px tall. */
  size?: 'sm' | 'md'
  /** Stretch to the container width with equal segments. */
  full?: boolean
  ariaLabel?: string
  className?: string
}

/** Segmented control (radio group) with a sliding pill indicator. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = 'md',
  full = false,
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  const id = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const index = options.findIndex((o) => o.value === value)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = options.length
    if (n === 0) return
    const from = index < 0 ? 0 : index
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (from + 1) % n
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (from - 1 + n) % n
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    if (next < 0) return
    e.preventDefault()
    playUiSound('select')
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx('ui-seg', `ui-seg--${size}`, full && 'ui-seg--full', className)}
      onKeyDown={onKeyDown}
    >
      {options.map((option, i) => {
        const selected = i === index
        return (
          <button
            key={String(option.value)}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.ariaLabel}
            tabIndex={selected || (index < 0 && i === 0) ? 0 : -1}
            className={cx('ui-seg__item', selected && 'is-selected', !option.label && 'is-icon')}
            onClick={() => {
              if (!selected) playUiSound('select')
              onChange(option.value)
            }}
          >
            {selected && <motion.span layoutId={`ui-seg-${id}`} className="ui-seg__thumb" transition={spring} />}
            <span className="ui-seg__content">
              {option.icon && <Icon icon={option.icon} size={size === 'sm' ? 16 : 20} />}
              {option.label && <span className="ui-seg__label">{option.label}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
