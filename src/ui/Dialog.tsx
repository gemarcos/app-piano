import { useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from './Button'
import { useModal } from './hooks'
import { ease } from './motion'
import { cx } from './cx'
import './Dialog.css'

interface DialogShellProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  role?: 'dialog' | 'alertdialog'
  labelledBy?: string
  describedBy?: string
  initialFocus?: RefObject<HTMLElement | null>
  /** Sits in the upper part of the screen (leaves room for the keyboard). */
  raised?: boolean
}

function DialogShell(props: DialogShellProps) {
  if (typeof document === 'undefined') return null
  return createPortal(<AnimatePresence>{props.open && <DialogPanel key="ui-dialog" {...props} />}</AnimatePresence>, document.body)
}

const dialogIn = { type: 'spring', stiffness: 420, damping: 32 } as const

function DialogPanel({ onClose, children, role = 'dialog', labelledBy, describedBy, initialFocus, raised }: DialogShellProps) {
  const ref = useRef<HTMLDivElement>(null)
  useModal(ref, { onEscape: onClose, initialFocus })
  return (
    <div className={cx('ui-dialog-root', raised && 'ui-dialog-root--raised')}>
      <motion.div
        className="ui-dialog-scrim"
        aria-hidden="true"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.24, ease } }}
        exit={{ opacity: 0, transition: { duration: 0.2, ease } }}
      />
      <motion.div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className="ui-dialog"
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: dialogIn }}
        exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.16, ease } }}
      >
        {children}
      </motion.div>
    </div>
  )
}

/* ---------------- ConfirmDialog ---------------- */

export interface ConfirmDialogProps {
  open: boolean
  title: ReactNode
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** danger = red confirm button, focus starts on Cancel. */
  tone?: 'danger'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Aceptar',
  cancelLabel = 'Cancelar',
  tone,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const messageId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  return (
    <DialogShell
      open={open}
      onClose={onCancel}
      role="alertdialog"
      labelledBy={titleId}
      describedBy={message != null ? messageId : undefined}
      initialFocus={tone === 'danger' ? cancelRef : confirmRef}
    >
      <h2 id={titleId} className="ui-dialog__title">
        {title}
      </h2>
      {message != null && (
        <p id={messageId} className="ui-dialog__message">
          {message}
        </p>
      )}
      <div className="ui-dialog__actions">
        <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button ref={confirmRef} variant={tone === 'danger' ? 'danger' : 'ink'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </DialogShell>
  )
}

/* ---------------- PromptDialog ---------------- */

export interface PromptDialogProps {
  open: boolean
  title: ReactNode
  initialValue: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Receives the trimmed, non-empty value. */
  onConfirm: (value: string) => void
  onCancel: () => void
  maxLength?: number
}

/** Single text field dialog (rename…). Autofocus + select, Enter submits. */
export function PromptDialog({
  open,
  title,
  initialValue,
  placeholder,
  confirmLabel = 'Guardar',
  cancelLabel = 'Cancelar',
  onConfirm,
  onCancel,
  maxLength,
}: PromptDialogProps) {
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initialValue)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setValue(initialValue)
  }

  const trimmed = value.trim()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (trimmed) onConfirm(trimmed)
  }

  return (
    <DialogShell open={open} onClose={onCancel} labelledBy={titleId} initialFocus={inputRef} raised>
      <form onSubmit={submit} noValidate>
        <h2 id={titleId} className="ui-dialog__title">
          {title}
        </h2>
        <input
          ref={inputRef}
          className="ui-dialog__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-labelledby={titleId}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
        />
        <div className="ui-dialog__actions">
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="submit" disabled={!trimmed}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </DialogShell>
  )
}
