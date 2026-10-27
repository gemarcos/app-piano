import type { CSSProperties, MouseEventHandler, ReactNode, Ref } from 'react'
import { motion } from 'motion/react'
import { Icon, type IconComponent } from './Icon'
import { Spinner } from './Progress'
import { spring, tapScale } from './motion'
import { cx } from './cx'
import './Button.css'

export type ButtonVariant = 'ink' | 'accent' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps {
  children?: ReactNode
  /** ink = black pill (main action), accent = the one primary action on a screen. */
  variant?: ButtonVariant
  /** sm 36px, md 44px, lg 56px tall. */
  size?: ButtonSize
  icon?: IconComponent
  iconRight?: IconComponent
  full?: boolean
  loading?: boolean
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
  type?: 'button' | 'submit' | 'reset'
  ariaLabel?: string
  autoFocus?: boolean
  className?: string
  style?: CSSProperties
  ref?: Ref<HTMLButtonElement>
}

const BTN_ICON: Record<ButtonSize, number> = { sm: 16, md: 20, lg: 20 }

/** Pill button. */
export function Button({
  children,
  variant = 'ink',
  size = 'md',
  icon,
  iconRight,
  full = false,
  loading = false,
  disabled = false,
  onClick,
  type = 'button',
  ariaLabel,
  autoFocus,
  className,
  style,
  ref,
}: ButtonProps) {
  const inert = disabled || loading
  const iconSize = BTN_ICON[size]
  return (
    <motion.button
      ref={ref}
      type={type}
      className={cx('ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, full && 'ui-btn--full', loading && 'is-loading', className)}
      onClick={onClick}
      disabled={inert}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      whileTap={inert ? undefined : tapScale}
      transition={spring}
      style={style}
    >
      <span className="ui-btn__content">
        {icon && <Icon icon={icon} size={iconSize} />}
        {children != null && children !== false && <span className="ui-btn__label">{children}</span>}
        {iconRight && <Icon icon={iconRight} size={iconSize} />}
      </span>
      {loading && (
        <span className="ui-btn__spinner">
          <Spinner size={iconSize} />
        </span>
      )}
    </motion.button>
  )
}

export type IconButtonVariant = 'ghost' | 'surface' | 'neu' | 'ink' | 'accent'
export type IconButtonSize = 'sm' | 'md' | 'lg' | 'xl'

export interface IconButtonProps {
  icon: IconComponent
  /** Spanish aria-label (required: the button has no visible text). */
  label: string
  onClick?: MouseEventHandler<HTMLButtonElement>
  /** ghost (default), surface = white disc, neu = neumorphic hardware control, ink, accent. */
  variant?: IconButtonVariant
  /** sm 36px, md 44px, lg 56px, xl 76px. */
  size?: IconButtonSize
  /** Visual "on" state (accent tint / pressed-in for neu). */
  active?: boolean
  /** Sets aria-pressed (use for toggles such as favorite, metronome). */
  pressed?: boolean
  /** Spinner in place of the icon; the button is inert meanwhile. */
  loading?: boolean
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  /** Override the icon size (defaults: 20 / 24 / 24 / 28). */
  iconSize?: number
  className?: string
  style?: CSSProperties
  ref?: Ref<HTMLButtonElement>
}

const ICON_BTN_ICON: Record<IconButtonSize, number> = { sm: 20, md: 24, lg: 24, xl: 28 }

/** Round icon-only button. */
export function IconButton({
  icon,
  label,
  onClick,
  variant = 'ghost',
  size = 'md',
  active = false,
  pressed,
  loading = false,
  disabled = false,
  type = 'button',
  iconSize,
  className,
  style,
  ref,
}: IconButtonProps) {
  const inert = disabled || loading
  const glyph = iconSize ?? ICON_BTN_ICON[size]
  return (
    <motion.button
      ref={ref}
      type={type}
      className={cx('ui-iconbtn', `ui-iconbtn--${variant}`, `ui-iconbtn--${size}`, active && 'is-active', loading && 'is-loading', className)}
      onClick={onClick}
      disabled={inert}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      whileTap={inert ? undefined : { scale: variant === 'neu' ? 0.97 : 0.92 }}
      transition={spring}
      style={style}
    >
      <Icon icon={icon} size={glyph} />
      {loading && (
        <span className="ui-iconbtn__spinner">
          <Spinner size={Math.max(16, glyph - 4)} />
        </span>
      )}
    </motion.button>
  )
}
