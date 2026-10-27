import { useId } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { BookOpen01, Home02, Settings01 } from '@untitled-ui/icons-react'
import { Icon } from './Icon'
import { ease, softSpring, spring } from './motion'
import { cx } from './cx'
import './TabBar.css'

const TABS = [
  { to: '/', label: 'Inicio', icon: Home02 },
  { to: '/library', label: 'Biblioteca', icon: BookOpen01 },
  { to: '/settings', label: 'Ajustes', icon: Settings01 },
] as const

export interface TabBarProps {
  /** false = slides away (push screens). */
  visible: boolean
  /** Override the active path (defaults to the current location). */
  current?: string
  /** false renders in normal flow (previews). */
  floating?: boolean
}

/** Floating glass pill with the three main destinations. */
export function TabBar({ visible, current, floating = true }: TabBarProps) {
  const location = useLocation()
  const path = current ?? location.pathname
  const indicatorId = `ui-tab-${useId()}`
  return (
    <motion.nav
      aria-label="Principal"
      aria-hidden={!visible || undefined}
      inert={!visible}
      className={cx('ui-tabbar', !floating && 'ui-tabbar--static')}
      initial={false}
      animate={visible ? { y: 0, opacity: 1 } : { y: 110, opacity: 0 }}
      transition={visible ? softSpring : { duration: 0.24, ease }}
    >
      <div className="ui-tabbar__pill">
        {TABS.map((tab) => {
          const active = tab.to === '/' ? path === '/' : path === tab.to || path.startsWith(`${tab.to}/`)
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cx('ui-tabbar__item', active && 'is-active')}
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
            >
              {active && <motion.span layoutId={indicatorId} className="ui-tabbar__indicator" transition={spring} />}
              <Icon icon={tab.icon} size={24} />
            </Link>
          )
        })}
      </div>
    </motion.nav>
  )
}
