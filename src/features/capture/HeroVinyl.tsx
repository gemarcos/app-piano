// Owner: capture. Makes a vinyl feel like the one on the previous screen (Home -> Record, Record -> Processing):
// it starts where the remembered record was (position and size) and glides into place. Without a remembered
// rect (deep link, file flow) it simply scales in. AnimatePresence mode="wait" never shows both screens at
// once, so a shared layoutId cannot do this.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { animate, motion, useMotionValue } from 'motion/react'
import { ease, useReducedMotionPref } from '../../ui'
import { forgetHeroVinyl, peekHeroVinyl } from './util'

/** The element whose rect is remembered and matched: the record itself (same on every screen). */
export const HERO_ANCHOR = '.ui-vinyl__record'

export function HeroVinyl({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [from] = useState(peekHeroVinyl)
  const reduced = useReducedMotionPref()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const scale = useMotionValue(1)
  const opacity = useMotionValue(1)
  const originX = useMotionValue(0.5)
  const originY = useMotionValue(0.5)

  // Consumed once (after StrictMode's double render, which reads it twice).
  useEffect(() => forgetHeroVinyl(), [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || reduced) return
    x.set(0)
    y.set(0)
    scale.set(1)
    // Motion writes styles on its next frame: measure the untransformed boxes explicitly.
    const previous = el.style.transform
    el.style.transform = 'none'
    const box = el.getBoundingClientRect()
    const target = (el.querySelector(HERO_ANCHOR) ?? el).getBoundingClientRect()
    el.style.transform = previous
    if (from && target.width > 0 && box.width > 0) {
      const cx = target.left + target.width / 2
      const cy = target.top + target.height / 2
      originX.set((cx - box.left) / box.width)
      originY.set((cy - box.top) / box.height)
      // Page resets the scroll right after this effect: aim at the position it will have at scrollY = 0.
      x.set(from.left + from.width / 2 - (cx + window.scrollX))
      y.set(from.top + from.height / 2 - (cy + window.scrollY))
      scale.set(from.width / target.width)
    } else {
      scale.set(0.94)
      opacity.set(0)
    }
    const options = { duration: 0.5, ease }
    const controls = [animate(x, 0, options), animate(y, 0, options), animate(scale, 1, options), animate(opacity, 1, { duration: 0.4, ease })]
    return () => controls.forEach((c) => c.stop())
  }, [from, reduced, x, y, scale, opacity, originX, originY])

  return (
    <motion.div ref={ref} className={className} style={{ x, y, scale, opacity, originX, originY }}>
      {children}
    </motion.div>
  )
}
