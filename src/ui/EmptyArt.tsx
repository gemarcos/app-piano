import { motion } from 'motion/react'
import { useReducedMotionPref } from './hooks'
import { ease } from './motion'
import './EmptyArt.css'

export interface EmptyArtProps {
  /** vinyl = nothing here yet, search = no results, score = nothing to show on the staff. */
  kind?: 'vinyl' | 'search' | 'score'
  className?: string
}

const STAFF_Y = [46, 58, 70, 82, 94]

function Note({ x, y, delay, float }: { x: number; y: number; delay: number; float: boolean }) {
  return (
    <motion.g
      className="ui-emptyart__note"
      initial={{ opacity: 0, y: 8 }}
      animate={float ? { opacity: 1, y: [0, -5, 0] } : { opacity: 1, y: 0 }}
      transition={
        float
          ? { opacity: { duration: 0.4, delay }, y: { duration: 3.2, delay, ease: 'easeInOut', repeat: Infinity } }
          : { duration: 0.4, delay, ease }
      }
    >
      <ellipse cx={x} cy={y} rx={6.2} ry={4.6} transform={`rotate(-22 ${x} ${y})`} />
      <line x1={x + 5.4} y1={y - 1.5} x2={x + 5.4} y2={y - 27} />
    </motion.g>
  )
}

/** Generated illustration for empty states (no photo needed): staff lines that draw in, plus a motif. */
export function EmptyArt({ kind = 'vinyl', className }: EmptyArtProps) {
  const reduced = useReducedMotionPref()
  const live = !reduced
  return (
    <div className={['ui-emptyart', className].filter(Boolean).join(' ')} aria-hidden="true">
      <span className="ui-emptyart__glow" />
      <svg viewBox="0 0 220 140" className="ui-emptyart__svg" focusable="false">
        {STAFF_Y.map((y, i) => (
          <motion.line
            key={y}
            className="ui-emptyart__staff"
            x1={10}
            x2={210}
            y1={y}
            y2={y}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.05 + i * 0.05, ease }}
          />
        ))}
        {kind === 'vinyl' && (
          <motion.g
            initial={{ scale: 0.6, opacity: 0, rotate: -90 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 160, damping: 18, delay: 0.2 }}
          >
            <circle className="ui-emptyart__halo" cx={128} cy={70} r={41} />
            <motion.g
              animate={live ? { rotate: 360 } : undefined}
              transition={live ? { duration: 14, ease: 'linear', repeat: Infinity } : undefined}
            >
              <circle className="ui-emptyart__disc" cx={128} cy={70} r={36} />
              <circle className="ui-emptyart__groove" cx={128} cy={70} r={30} />
              <circle className="ui-emptyart__groove" cx={128} cy={70} r={23} />
              <circle className="ui-emptyart__label" cx={128} cy={70} r={13} />
              <circle className="ui-emptyart__mark" cx={128} cy={60.5} r={1.8} />
            </motion.g>
            <circle className="ui-emptyart__spindle" cx={128} cy={70} r={2.6} />
          </motion.g>
        )}
        {kind === 'search' && (
          <motion.g
            className="ui-emptyart__lens"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={live ? { opacity: 1, scale: 1, x: [0, 10, -6, 0], y: [0, -4, 3, 0] } : { opacity: 1, scale: 1 }}
            transition={
              live
                ? { opacity: { duration: 0.4, delay: 0.2 }, scale: { type: 'spring', stiffness: 220, damping: 16, delay: 0.2 }, x: { duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }, y: { duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.6 } }
                : { duration: 0.3 }
            }
          >
            <circle cx={112} cy={66} r={22} />
            <line x1={128} y1={82} x2={142} y2={96} />
          </motion.g>
        )}
        {(kind === 'vinyl' || kind === 'score') && (
          <>
            <Note x={kind === 'vinyl' ? 52 : 70} y={kind === 'vinyl' ? 76 : 82} delay={0.45} float={live} />
            <Note x={kind === 'vinyl' ? 78 : 110} y={kind === 'vinyl' ? 64 : 64} delay={0.6} float={live} />
            {kind === 'score' && <Note x={150} y={76} delay={0.75} float={live} />}
          </>
        )}
      </svg>
    </div>
  )
}
