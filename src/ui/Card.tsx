import type { CSSProperties, HTMLAttributes, KeyboardEvent, ReactNode } from 'react'
import { motion } from 'motion/react'
import { spring } from './motion'
import { playUiSound } from './sound'
import { cx } from './cx'
import './Card.css'

/** Pointer handlers that can be forwarded (e.g. the result of useLongPress). */
export type PressHandlers = Pick<
  HTMLAttributes<HTMLElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerLeave' | 'onPointerCancel' | 'onContextMenu' | 'onClickCapture'
>

export interface CardProps extends PressHandlers {
  children?: ReactNode
  /** none 0, sm 12px, md 16px, lg 24px. */
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** Press feedback; implied by onClick. */
  interactive?: boolean
  onClick?: () => void
  /** Frosted translucent surface (over images or the page gradient). */
  glass?: boolean
  ariaLabel?: string
  className?: string
  style?: CSSProperties
}

/** White rounded surface (--r-lg) with a soft shadow. With onClick it is a keyboard-accessible button. */
export function Card({
  children,
  padding = 'md',
  interactive,
  onClick,
  glass = false,
  ariaLabel,
  className,
  style,
  ...press
}: CardProps) {
  const clickable = Boolean(onClick)
  const pressable = clickable || Boolean(interactive)
  const activate = onClick
    ? () => {
        playUiSound('tap')
        onClick()
      }
    : undefined
  const onKeyDown = clickable
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          activate?.()
        }
      }
    : undefined

  return (
    <motion.div
      className={cx('ui-card', `ui-card--pad-${padding}`, glass && 'ui-card--glass', pressable && 'ui-card--interactive', className)}
      onClick={activate}
      onKeyDown={onKeyDown}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={ariaLabel}
      whileHover={pressable ? { y: -2 } : undefined}
      whileTap={pressable ? { scale: 0.98 } : undefined}
      transition={spring}
      style={style}
      {...press}
    >
      {children}
    </motion.div>
  )
}
