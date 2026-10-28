import { memo } from 'react'
import { motion } from 'motion/react'
import { useReducedMotionPref } from './hooks'
import './Backdrop.css'

/** Slow drifts (seconds per loop). Full transform strings, so motion runs them on the compositor (WAAPI). */
const path = (pts: [number, number][]) => pts.map(([x, y]) => `translate3d(${x}%, ${y}%, 0)`)

const BLOBS = [
  { className: 'ui-backdrop__blob ui-backdrop__blob--1', transform: path([[0, 0], [9, 6], [-4, 10], [0, 0]]), duration: 26 },
  { className: 'ui-backdrop__blob ui-backdrop__blob--2', transform: path([[0, 0], [-10, 8], [-3, -4], [0, 0]]), duration: 32 },
  { className: 'ui-backdrop__blob ui-backdrop__blob--3', transform: path([[0, 0], [7, -7], [-6, -2], [0, 0]]), duration: 38 },
]

/**
 * Ambient layer behind every screen: a soft aurora in the accent family that drifts very slowly, plus a fine
 * film grain. Persistent across route changes (it lives in AppFrame), still under reduced motion.
 */
export const Backdrop = memo(function Backdrop() {
  const reduced = useReducedMotionPref()
  return (
    <div className="ui-backdrop" aria-hidden="true">
      {BLOBS.map((b) => (
        <motion.span
          key={b.className}
          className={b.className}
          animate={{ transform: reduced ? 'translate3d(0%, 0%, 0)' : b.transform }}
          transition={reduced ? { duration: 0 } : { duration: b.duration, ease: 'easeInOut', repeat: Infinity }}
        />
      ))}
      <span className="ui-backdrop__grain" />
    </div>
  )
})
