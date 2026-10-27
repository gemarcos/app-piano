import { isValidElement, type ReactNode } from 'react'
import { Button } from './Button'
import type { IconComponent } from './Icon'
import { cx } from './cx'
import './EmptyState.css'

export interface EmptyStateAction {
  label: string
  onClick: () => void
  icon?: IconComponent
}

export interface EmptyStateProps {
  /** Image URL (rounded photo) or any node (an Icon, a Cover, a Vinyl…). */
  image?: string | ReactNode
  /** One short line. */
  title: ReactNode
  /** A Button element, or {label, onClick, icon?} for the default ink button. */
  action?: ReactNode | EmptyStateAction
  className?: string
}

function isActionObject(a: unknown): a is EmptyStateAction {
  return typeof a === 'object' && a !== null && !isValidElement(a) && 'label' in a && 'onClick' in a
}

/** Calm centered empty state: optional image, one line, one action. */
export function EmptyState({ image, title, action, className }: EmptyStateProps) {
  return (
    <div className={cx('ui-empty', className)}>
      {typeof image === 'string' ? (
        <img className="ui-empty__img" src={image} alt="" loading="lazy" decoding="async" draggable={false} />
      ) : image != null ? (
        <div className="ui-empty__art">{image}</div>
      ) : null}
      <p className="ui-empty__title">{title}</p>
      {action != null && (
        <div className="ui-empty__action">
          {isActionObject(action) ? (
            <Button icon={action.icon} onClick={action.onClick}>
              {action.label}
            </Button>
          ) : (
            action
          )}
        </div>
      )}
    </div>
  )
}
