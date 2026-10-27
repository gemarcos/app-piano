// Owner: capture. Small browser helpers shared by Home and the capture screens.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

/** Short haptic tick where supported (start/stop recording). */
export function haptic(ms = 10): void {
  try {
    navigator.vibrate?.(ms)
  } catch {
    // vibration unsupported or blocked
  }
}

/** Back in history when there is somewhere to go back to, otherwise replace to `fallback` (deep link, reload). */
export function useGoBack(fallback = '/'): () => void {
  const navigate = useNavigate()
  return useCallback(() => {
    let idx: unknown
    try {
      idx = (window.history.state as { idx?: number } | null)?.idx
    } catch {
      idx = undefined
    }
    if (typeof idx === 'number' && idx > 0) navigate(-1)
    else navigate(fallback, { replace: true })
  }, [navigate, fallback])
}

/** Viewport size in CSS px; the width is capped to the app column (480). */
export function useViewportSize(): { width: number; height: number } {
  const read = () => ({
    width: Math.min(typeof window === 'undefined' ? 390 : window.innerWidth, 480),
    height: typeof window === 'undefined' ? 844 : window.innerHeight,
  })
  const [size, setSize] = useState(read)
  useEffect(() => {
    const onResize = () => setSize(read())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/** Runs `fn` once the browser is idle (or after `timeout` ms). Returns a cancel function. */
export function whenIdle(fn: () => void, timeout = 2500): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn, { timeout })
    return () => w.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(fn, Math.min(timeout, 1200))
  return () => window.clearTimeout(id)
}

/* ---------- The same vinyl across screens (Home -> Record -> Processing) ---------- */

// Under AnimatePresence mode="wait" a screen is gone before the next one mounts, so a shared layoutId cannot
// animate. The leaving screen remembers where its record was; the next one starts its vinyl there (HeroVinyl).
let heroVinyl: { rect: DOMRect; at: number } | null = null
const HERO_MAX_AGE_MS = 2500

/** Remembers the rect of the record inside `root` (a Vinyl or anything containing one); null forgets. */
export function rememberHeroVinyl(root: Element | null): void {
  const record = root?.matches('.ui-vinyl__record') ? root : root?.querySelector('.ui-vinyl__record')
  heroVinyl = record ? { rect: record.getBoundingClientRect(), at: performance.now() } : null
}

/** The remembered rect while it is fresh (read during render: StrictMode reads it twice). */
export function peekHeroVinyl(): DOMRect | null {
  return heroVinyl && performance.now() - heroVinyl.at < HERO_MAX_AGE_MS ? heroVinyl.rect : null
}

export function forgetHeroVinyl(): void {
  heroVinyl = null
}
