import type { CSSProperties, ReactNode } from 'react'
import { ChevronRight } from '@untitled-ui/icons-react'
import { Icon, type IconComponent } from './Icon'
import { playUiSound } from './sound'
import type { PressHandlers } from './Card'
import { cx } from './cx'
import './List.css'

export interface ListRowProps extends PressHandlers {
  /** Thumbnail (<Cover size={44} …/>), icon (<Icon …/>) or anything ~40px. */
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** Value text, Toggle, Spinner… (do not combine an interactive trailing with onClick). */
  trailing?: ReactNode
  /** Makes the whole row a button. */
  onClick?: () => void
  /** Shows a chevron (navigation rows). */
  chevron?: boolean
  tone?: 'danger'
  disabled?: boolean
  /** Accessible name override for the row button. */
  ariaLabel?: string
  /** Mark the current/selected row (aria-current). */
  current?: boolean
  /** Let the title and subtitle wrap onto more lines instead of being cut with an ellipsis. */
  wrap?: boolean
  /** Full-width content under the title line (e.g. a Slider). Not for clickable rows. */
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

/** Row with leading media, title/subtitle and trailing content. A <button> when onClick is set. */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  chevron = false,
  tone,
  disabled = false,
  ariaLabel,
  current,
  wrap = false,
  children,
  className,
  style,
  ...press
}: ListRowProps) {
  const classes = cx(
    'ui-row',
    onClick && 'ui-row--button',
    children != null && 'ui-row--stacked',
    tone === 'danger' && 'ui-row--danger',
    wrap && 'ui-row--wrap',
    disabled && 'is-disabled',
    className,
  )
  const content = (
    <>
      {leading != null && <span className="ui-row__leading">{leading}</span>}
      <span className="ui-row__text">
        <span className="ui-row__title">{title}</span>
        {subtitle != null && <span className="ui-row__subtitle">{subtitle}</span>}
      </span>
      {trailing != null && <span className="ui-row__trailing">{trailing}</span>}
      {chevron && <Icon icon={ChevronRight} size={20} className="ui-row__chevron" />}
      {children != null && !onClick && <div className="ui-row__below">{children}</div>}
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        onClick={() => {
          playUiSound('tap')
          onClick()
        }}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-current={current || undefined}
        style={style}
        {...press}
      >
        {content}
      </button>
    )
  }
  return (
    <div className={classes} aria-disabled={disabled || undefined} aria-current={current || undefined} style={style} {...press}>
      {content}
    </div>
  )
}

export interface SettingsGroupProps {
  title?: ReactNode
  children: ReactNode
  /** Small explanatory line under the card. */
  footer?: ReactNode
  className?: string
}

/** Rows between hairlines (no card), with an optional heading above and footnote below. */
export function SettingsGroup({ title, children, footer, className }: SettingsGroupProps) {
  return (
    <section className={cx('ui-group', className)}>
      {title != null && (
        <h3 className="ui-group__title">{title}</h3>
      )}
      <div className="ui-group__card">{children}</div>
      {footer != null && <p className="ui-group__footer">{footer}</p>}
    </section>
  )
}
