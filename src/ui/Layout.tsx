import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { motion, usePresenceData } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from '@untitled-ui/icons-react'
import { IconButton } from './Button'
import { useReducedMotionPref } from './hooks'
import { pageVariants } from './motion'
import { Backdrop } from './Backdrop'
import { cx } from './cx'
import './Layout.css'

/* ---------------- AppFrame ---------------- */

/**
 * Centered app column (max --app-max) over the ambient Backdrop. Also mirrors the reduced-motion preference to
 * <html data-reduce-motion>.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const reduced = useReducedMotionPref()
  useEffect(() => {
    document.documentElement.toggleAttribute('data-reduce-motion', reduced)
  }, [reduced])
  return (
    <div className="ui-frame">
      <Backdrop />
      {children}
    </div>
  )
}

/* ---------------- Page ---------------- */

export interface PageProps {
  children: ReactNode
  /** Adds bottom room for the floating tab bar (tab screens). */
  tabBar?: boolean
  /** tab = fade + 12px rise; push = horizontal slide (direction-aware). */
  variant?: 'tab' | 'push'
  /** Side padding of --gutter. */
  padded?: boolean
  /** Keep the scroll position on mount (default: scroll to top). */
  keepScroll?: boolean
  className?: string
  style?: CSSProperties
}

/**
 * Root of every screen: motion element for route transitions (App wraps routes in
 * AnimatePresence mode="wait"), safe-area top padding, flex column of min-height 100dvh.
 */
export function Page({ children, tabBar = false, variant = 'push', padded = true, keepScroll = false, className, style }: PageProps) {
  const presence = usePresenceData() as number | undefined
  const dir = presence === -1 ? -1 : 1

  // Only on mount: a new screen starts at the top.
  useLayoutEffect(() => {
    if (!keepScroll) window.scrollTo(0, 0)
  }, [])

  return (
    <motion.main
      className={cx('ui-page', padded && 'ui-page--padded', tabBar && 'ui-page--tabbar', className)}
      variants={pageVariants[variant]}
      custom={dir}
      initial="initial"
      animate="enter"
      exit="exit"
      style={style}
    >
      {children}
    </motion.main>
  )
}

/* ---------------- TopBar ---------------- */

export interface TopBarProps {
  title?: ReactNode
  subtitle?: ReactNode
  /** Usually <BackButton />. */
  left?: ReactNode
  /** Usually one or two ghost IconButtons. */
  right?: ReactNode
  /** Big bold left-aligned title (tab screens). */
  large?: boolean
  /** Sticks to the top; gets a frosted background once the page scrolls. */
  sticky?: boolean
  className?: string
}

export function TopBar({ title, subtitle, left, right, large = false, sticky = false, className }: TopBarProps) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    if (!sticky) return
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [sticky])

  if (large) {
    return (
      <header className={cx('ui-topbar', 'ui-topbar--large', sticky && 'ui-topbar--sticky', scrolled && 'is-scrolled', className)}>
        {left && <div className="ui-topbar__left">{left}</div>}
        <div className="ui-topbar__heading">
          {title != null && <h1 className="ui-topbar__title">{title}</h1>}
          {subtitle != null && <p className="ui-topbar__subtitle">{subtitle}</p>}
        </div>
        {right && <div className="ui-topbar__right">{right}</div>}
      </header>
    )
  }

  return (
    <header className={cx('ui-topbar', sticky && 'ui-topbar--sticky', scrolled && 'is-scrolled', className)}>
      <div className="ui-topbar__left">{left}</div>
      <div className="ui-topbar__center">
        {title != null && <h1 className="ui-topbar__title">{title}</h1>}
        {subtitle != null && <p className="ui-topbar__subtitle">{subtitle}</p>}
      </div>
      <div className="ui-topbar__right">{right}</div>
    </header>
  )
}

/* ---------------- BackButton ---------------- */

export interface BackButtonProps {
  /** Where to go when there is no history to pop (deep link, fresh tab). */
  fallback?: string
  label?: string
}

export function BackButton({ fallback = '/', label = 'Atrás' }: BackButtonProps) {
  const navigate = useNavigate()
  const goBack = () => {
    let idx: unknown
    try {
      idx = (window.history.state as { idx?: number } | null)?.idx
    } catch {
      idx = undefined
    }
    if (typeof idx === 'number' && idx > 0) navigate(-1)
    else navigate(fallback, { replace: true })
  }
  return <IconButton icon={ChevronLeft} label={label} onClick={goBack} className="ui-back" />
}

/* ---------------- BottomBar ---------------- */

export interface BottomBarProps {
  children: ReactNode
  className?: string
}

/**
 * Bottom actions of a push screen. Sits at the bottom of the viewport (pushed down when content is
 * short, sticky when it scrolls), above the safe area, with a soft fade over the content.
 * Must be the last child of <Page>.
 */
export function BottomBar({ children, className }: BottomBarProps) {
  return <div className={cx('ui-bottombar', className)}>{children}</div>
}

/* ---------------- SectionHeader ---------------- */

export interface SectionHeaderProps {
  title: ReactNode
  action?: { label: string; onClick: () => void }
  className?: string
}

export function SectionHeader({ title, action, className }: SectionHeaderProps) {
  return (
    <div className={cx('ui-section', className)}>
      <h2 className="ui-section__title">{title}</h2>
      {action && (
        <button type="button" className="ui-section__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
