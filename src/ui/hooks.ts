import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useSettings } from '../state/settings'

/* ---------------- Reduced motion ---------------- */

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeMedia(query: string, cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(query)
  mq.addEventListener?.('change', cb)
  return () => mq.removeEventListener?.('change', cb)
}

function matches(query: string): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  } catch {
    return false
  }
}

/** True when the user asked for less motion: OS preference or settings.reduceMotion. */
export function useReducedMotionPref(): boolean {
  const fromSettings = useSettings((s) => s.reduceMotion)
  const fromOs = useSyncExternalStore(
    (cb) => subscribeMedia(REDUCED_QUERY, cb),
    () => matches(REDUCED_QUERY),
    () => false,
  )
  return fromSettings || fromOs
}

/* ---------------- Long press ---------------- */

export interface LongPressHandlers {
  onPointerDown: (e: ReactPointerEvent) => void
  onPointerMove: (e: ReactPointerEvent) => void
  onPointerUp: () => void
  onPointerLeave: () => void
  onPointerCancel: () => void
  onContextMenu: (e: ReactMouseEvent) => void
  onClickCapture: (e: ReactMouseEvent) => void
}

/**
 * Long press (touch/mouse hold, or right click) on any element: spread the result on it.
 * The click that follows a long press is swallowed, so the same element can also have onClick.
 */
export function useLongPress(callback: () => void, ms = 500): LongPressHandlers {
  const cbRef = useRef(callback)
  cbRef.current = callback
  const timer = useRef<number | null>(null)
  const fired = useRef(false)
  const origin = useRef<{ x: number; y: number } | null>(null)

  const clear = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }, [])

  const fire = useCallback(() => {
    fired.current = true
    clear()
    try {
      navigator.vibrate?.(8)
    } catch {
      // vibration unsupported
    }
    cbRef.current()
  }, [clear])

  useEffect(() => clear, [clear])

  return useMemo<LongPressHandlers>(
    () => ({
      onPointerDown: (e) => {
        fired.current = false
        if (e.button !== 0) return
        origin.current = { x: e.clientX, y: e.clientY }
        if (timer.current != null) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(fire, ms)
      },
      onPointerMove: (e) => {
        const o = origin.current
        if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 10) clear()
      },
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu: (e) => {
        e.preventDefault()
        if (!fired.current) fire()
      },
      onClickCapture: (e) => {
        if (fired.current) {
          fired.current = false
          e.preventDefault()
          e.stopPropagation()
        }
      },
    }),
    [clear, fire, ms],
  )
}

/* ---------------- Overlays (sheets, dialogs) ---------------- */

let scrollLocks = 0

function lockScroll() {
  scrollLocks++
  if (scrollLocks === 1) document.documentElement.classList.add('ui-scroll-locked')
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1)
  if (scrollLocks === 0) document.documentElement.classList.remove('ui-scroll-locked')
}

const overlayStack: symbol[] = []

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal behaviour for a mounted overlay: body scroll lock, Escape (topmost overlay only),
 * focus moved inside on mount, Tab kept inside, focus restored on unmount.
 */
export function useModal(
  ref: RefObject<HTMLElement | null>,
  { onEscape, initialFocus }: { onEscape?: () => void; initialFocus?: RefObject<HTMLElement | null> } = {},
) {
  const escRef = useRef(onEscape)
  escRef.current = onEscape

  useEffect(() => {
    const token = Symbol('overlay')
    overlayStack.push(token)
    const previous = document.activeElement as HTMLElement | null
    lockScroll()

    const focusTimer = window.requestAnimationFrame(() => {
      const target = initialFocus?.current ?? ref.current
      target?.focus({ preventScroll: true })
    })

    const onKey = (e: KeyboardEvent) => {
      if (overlayStack[overlayStack.length - 1] !== token) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        escRef.current?.()
        return
      }
      if (e.key !== 'Tab' || !ref.current) return
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
      if (items.length === 0) {
        e.preventDefault()
        ref.current.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === ref.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      window.cancelAnimationFrame(focusTimer)
      document.removeEventListener('keydown', onKey)
      const i = overlayStack.indexOf(token)
      if (i >= 0) overlayStack.splice(i, 1)
      unlockScroll()
      if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true })
    }
    // Runs once per mounted overlay (refs are stable).
  }, [])
}

/* ---------------- Theme-aware helpers ---------------- */

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Increments whenever the effective theme may have changed (OS scheme or <html data-theme>). */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1)
    const unsubscribe = subscribeMedia(DARK_QUERY, bump)
    const observer = new MutationObserver(bump)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      unsubscribe()
      observer.disconnect()
    }
  }, [])
  return version
}

/** Resolves CSS colors (e.g. 'var(--accent)') to concrete values usable in canvas. */
export function resolveColors(el: Element, values: string[]): string[] {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  el.appendChild(probe)
  const out = values.map((v) => {
    probe.style.color = ''
    probe.style.color = v
    return getComputedStyle(probe).color || 'currentColor'
  })
  probe.remove()
  return out
}

/** Width of an element in CSS px, kept up to date with ResizeObserver. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (typeof w === 'number') setWidth(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}
