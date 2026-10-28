import { useEffect, useId, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react'
import { XClose } from '@untitled-ui/icons-react'
import { Button, IconButton } from './Button'
import { Icon, type IconComponent } from './Icon'
import { useModal } from './hooks'
import { ease } from './motion'
import { playUiSound } from './sound'
import { cx } from './cx'
import './Sheet.css'

export interface SheetProps {
  open: boolean
  onClose: () => void
  /** Header title; also labels the dialog. Shows a close button next to it. */
  title?: ReactNode
  children?: ReactNode
  /** Pinned below the scrollable content (e.g. a full-width Button). */
  footer?: ReactNode
  /** auto = fits content (capped), tall = almost full height. */
  height?: 'auto' | 'tall'
  /** Accessible name when there is no title. */
  ariaLabel?: string
  /** Called after the close animation. */
  onExitComplete?: () => void
  className?: string
}

const sheetIn = { type: 'spring', stiffness: 380, damping: 40, mass: 0.9 } as const
const sheetOut = { duration: 0.26, ease } as const

/** Bottom sheet in a portal: scrim, spring slide-up, drag the handle down to dismiss, Escape closes. */
export function Sheet(props: SheetProps) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence onExitComplete={props.onExitComplete}>{props.open && <SheetPanel key="ui-sheet" {...props} />}</AnimatePresence>,
    document.body,
  )
}

function SheetPanel({ onClose, title, children, footer, height = 'auto', ariaLabel, className }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const controls = useDragControls()
  useModal(panelRef, { onEscape: onClose })

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return
    controls.start(e)
  }
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 650) onClose()
  }

  return (
    <div className="ui-sheet-root">
      <motion.div
        className="ui-sheet-scrim"
        aria-hidden="true"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.28, ease } }}
        exit={{ opacity: 0, transition: { duration: 0.24, ease } }}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        className={cx('ui-sheet', height === 'tall' && 'ui-sheet--tall', className)}
        initial={{ y: '100%' }}
        animate={{ y: 0, transition: sheetIn }}
        exit={{ y: '100%', transition: sheetOut }}
        drag="y"
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.02, bottom: 0.9 }}
        onDragEnd={onDragEnd}
      >
        <div className="ui-sheet__grab" onPointerDown={startDrag}>
          <span className="ui-sheet__handle" />
          {title != null && (
            <div className="ui-sheet__header">
              <h2 id={titleId} className="ui-sheet__title">
                {title}
              </h2>
              <IconButton icon={XClose} label="Cerrar" size="sm" iconSize={18} onClick={onClose} className="ui-sheet__close" />
            </div>
          )}
        </div>
        <div className={cx('ui-sheet__body', footer != null && 'has-footer')}>{children}</div>
        {footer != null && <div className="ui-sheet__footer">{footer}</div>}
        {title == null && (
          <button type="button" className="visually-hidden" onClick={onClose}>
            Cerrar
          </button>
        )}
      </motion.div>
    </div>
  )
}

/* ---------------- ActionSheet ---------------- */

export interface ActionSheetAction {
  key?: string
  label: string
  icon?: IconComponent
  onSelect: () => void
  tone?: 'danger'
  disabled?: boolean
}

export interface ActionSheetProps {
  open: boolean
  onClose: () => void
  /** Small centered caption (e.g. the item name). */
  title?: ReactNode
  actions: ActionSheetAction[]
  cancelLabel?: string
}

/** List of actions in a sheet. Selecting closes the sheet, then runs the action once it has left. */
export function ActionSheet({ open, onClose, title, actions, cancelLabel = 'Cancelar' }: ActionSheetProps) {
  const pending = useRef<(() => void) | null>(null)
  const timer = useRef<number | null>(null)

  const runPending = () => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = null
    const fn = pending.current
    pending.current = null
    fn?.()
  }

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current)
    },
    [],
  )

  const select = (action: ActionSheetAction) => {
    if (action.disabled) return
    pending.current = action.onSelect
    onClose()
    // Fallback in case the exit animation never reports completion.
    timer.current = window.setTimeout(runPending, 420)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      onExitComplete={runPending}
      ariaLabel={typeof title === 'string' ? title : 'Acciones'}
      className="ui-actionsheet"
    >
      {title != null && <p className="ui-actionsheet__title">{title}</p>}
      <div className="ui-actionsheet__list">
        {actions.map((action, i) => (
          <button
            key={action.key ?? `${action.label}-${i}`}
            type="button"
            className={cx('ui-actionsheet__item', action.tone === 'danger' && 'is-danger')}
            disabled={action.disabled}
            onClick={() => {
              playUiSound('tap')
              select(action)
            }}
          >
            {action.icon && <Icon icon={action.icon} size={22} />}
            <span className="ui-actionsheet__label">{action.label}</span>
          </button>
        ))}
      </div>
      <Button variant="secondary" size="lg" full onClick={onClose}>
        {cancelLabel}
      </Button>
    </Sheet>
  )
}
