import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Icon, type IconComponent } from './Icon'
import { spring } from './motion'
import { cx } from './cx'
import './Chip.css'

export interface ChipProps {
  children: ReactNode
  selected?: boolean
  onClick?: () => void
  icon?: IconComponent
  disabled?: boolean
  className?: string
}

/** Filter pill. Selected = ink. Exposes aria-pressed. */
export function Chip({ children, selected = false, onClick, icon, disabled = false, className }: ChipProps) {
  return (
    <motion.button
      type="button"
      className={cx('ui-chip', selected && 'is-selected', className)}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      transition={spring}
    >
      {icon && <Icon icon={icon} size={16} />}
      <span className="ui-chip__label">{children}</span>
    </motion.button>
  )
}

export interface ChipRowProps {
  children: ReactNode
  ariaLabel?: string
  className?: string
}

/** Horizontally scrolling row of chips, bleeding into the page gutters with faded edges. */
export function ChipRow({ children, ariaLabel, className }: ChipRowProps) {
  return (
    <div className={cx('ui-chiprow', className)} role="group" aria-label={ariaLabel}>
      <div className="ui-chiprow__inner">{children}</div>
    </div>
  )
}
