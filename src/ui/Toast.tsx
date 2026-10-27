import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, CheckCircle } from '@untitled-ui/icons-react'
import { Icon } from './Icon'
import { ease } from './motion'
import { cx } from './cx'
import './Toast.css'

export type ToastTone = 'neutral' | 'success' | 'danger'

export interface ToastOptions {
  tone?: ToastTone
  /** ms, default 2600. */
  duration?: number
}

export interface ToastApi {
  show: (message: string, opts?: ToastOptions) => void
}

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

const ToastContext = createContext<ToastApi>({ show: () => {} })

const TOAST_ICON = { success: CheckCircle, danger: AlertCircle } as const

/** Provides useToast(). Renders one small pill at the top; a new toast replaces the current one. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null)
  const timer = useRef<number | null>(null)
  const nextId = useRef(0)

  const clearTimer = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  const dismiss = useCallback(() => {
    clearTimer()
    setToast(null)
  }, [clearTimer])

  const show = useCallback(
    (message: string, opts?: ToastOptions) => {
      clearTimer()
      const item: ToastItem = { id: ++nextId.current, message, tone: opts?.tone ?? 'neutral' }
      setToast(item)
      timer.current = window.setTimeout(() => {
        timer.current = null
        setToast((cur) => (cur?.id === item.id ? null : cur))
      }, opts?.duration ?? 2600)
    },
    [clearTimer],
  )

  useEffect(() => clearTimer, [clearTimer])

  const api = useMemo<ToastApi>(() => ({ show }), [show])
  const icon = toast && toast.tone !== 'neutral' ? TOAST_ICON[toast.tone] : null

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="ui-toast-region" role="status" aria-live="polite" aria-atomic="true">
            <AnimatePresence initial={false} mode="popLayout">
              {toast && (
                <motion.div
                  key={toast.id}
                  className={cx('ui-toast', `ui-toast--${toast.tone}`)}
                  onClick={dismiss}
                  initial={{ opacity: 0, y: -18, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 420, damping: 30 } }}
                  exit={{ opacity: 0, y: -12, scale: 0.97, transition: { duration: 0.2, ease } }}
                >
                  {icon && <Icon icon={icon} size={20} />}
                  <span className="ui-toast__text">{toast.message}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  )
}

/** const toast = useToast(); toast.show('Guardado', { tone: 'success' }) */
export function useToast(): ToastApi {
  return useContext(ToastContext)
}
