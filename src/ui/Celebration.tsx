import { useMemo } from 'react'
import { motion } from 'motion/react'
import { useReducedMotionPref } from './hooks'
import './Celebration.css'

export interface CelebrationProps {
  /** Mount it (or change `burstKey`) to fire once. */
  burstKey?: string | number
  /** Diameter of the area the particles fly across, px. */
  size?: number
  className?: string
}

const COUNT = 18

/** Deterministic spread so every burst looks the same (and tests/screenshots are stable). */
function particles(size: number) {
  return Array.from({ length: COUNT }, (_, i) => {
    const angle = (i / COUNT) * Math.PI * 2 + (i % 2 ? 0.17 : -0.11)
    const dist = size * (0.42 + ((i * 37) % 11) / 40)
    return {
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      rotate: ((i * 53) % 120) - 60,
      kind: i % 3 === 0 ? 'note' : 'dot',
      tone: i % 2 ? 'b' : 'a',
      delay: (i % 4) * 0.025,
      scale: 0.7 + ((i * 29) % 7) / 10,
    }
  })
}

/** One-shot burst of dots and note heads from the centre, plus a soft shock ring: "the score is ready". */
export function Celebration({ burstKey, size = 280, className }: CelebrationProps) {
  const reduced = useReducedMotionPref()
  const parts = useMemo(() => particles(size / 2), [size])
  return (
    <div key={burstKey} className={['ui-celebrate', className].filter(Boolean).join(' ')} style={{ width: size, height: size }} aria-hidden="true">
      <motion.span
        className="ui-celebrate__ring"
        initial={{ scale: 0.7, opacity: 0.7 }}
        animate={{ scale: reduced ? 1 : 1.32, opacity: 0 }}
        transition={{ duration: reduced ? 0.6 : 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
      {!reduced &&
        parts.map((p, i) => (
          <motion.span
            key={i}
            className={`ui-celebrate__p ui-celebrate__p--${p.kind} is-${p.tone}`}
            initial={{ x: 0, y: 0, scale: 0, opacity: 0, rotate: 0 }}
            animate={{ x: p.x, y: p.y, scale: [0, p.scale, p.scale * 0.6], opacity: [0, 1, 0], rotate: p.rotate }}
            transition={{ duration: 1.05, delay: p.delay, ease: [0.16, 1, 0.3, 1], times: [0, 0.3, 1] }}
          />
        ))}
    </div>
  )
}
