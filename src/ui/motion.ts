// Shared motion presets. Import from 'motion/react' for components, from here for values.
import type { Transition, Variants } from 'motion/react'

/** Default ease, same curve as the --ease CSS token. */
export const ease = [0.22, 1, 0.36, 1] as const

/** Presses, toggles, indicators. */
export const spring: Transition = { type: 'spring', stiffness: 420, damping: 34 }

/** Larger surfaces (sheets, dialogs): a touch softer, no visible overshoot. */
export const softSpring: Transition = { type: 'spring', stiffness: 320, damping: 36, mass: 0.9 }

export const durations = { fast: 0.18, base: 0.28, slow: 0.45 } as const

/** whileTap value for buttons and cards. */
export const tapScale = { scale: 0.96 } as const

/**
 * Exiting pages fade with an ease-in: with AnimatePresence mode="wait" the next screen mounts only when
 * the exit ends, and an ease-out fade left the old screen invisible for most of its exit (a blank flash).
 */
const exitFade = [0.4, 0, 1, 1] as const

/**
 * Page transitions. Use with initial="initial" animate="enter" exit="exit".
 * `custom` is the navigation direction: 1 forward, -1 back (provided by App through AnimatePresence).
 */
export const pageVariants: { tab: Variants; push: Variants } = {
  tab: {
    initial: { opacity: 0, y: 14, scale: 0.99 },
    enter: { opacity: 1, y: 0, x: 0, scale: 1, transition: { duration: 0.38, ease } },
    exit: { opacity: 0, y: -6, transition: { duration: 0.16, ease, opacity: { duration: 0.16, ease: exitFade } } },
  },
  push: {
    initial: (dir: number = 1) => ({ opacity: 0, x: 32 * dir }),
    enter: { opacity: 1, x: 0, y: 0, transition: { duration: 0.38, ease } },
    exit: (dir: number = 1) => ({
      opacity: 0,
      x: -18 * dir,
      transition: { duration: 0.18, ease, opacity: { duration: 0.18, ease: exitFade } },
    }),
  },
}

/** Props for a single element that fades up on mount: <motion.div {...fadeUp(0.1)} />. */
export function fadeUp(delay = 0, distance = 12) {
  return {
    initial: { opacity: 0, y: distance },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.42, ease, delay },
  }
}

/** Staggered list: <motion.ul variants={listContainer} initial="hidden" animate="show"> + <motion.li variants={listItem}>. */
export const listContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.03 } },
}

export const listItem: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.42, ease } },
}

/** The i-th block of a screen rising in after the page (use where variants cannot propagate). */
export function reveal(index: number, distance = 14) {
  return {
    initial: { opacity: 0, y: distance },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.46, ease, delay: 0.05 + index * 0.06 },
  }
}

/** A gentle, endless breathing loop (glows, halos). Do not use when motion is reduced. */
export const breathe = { duration: 3.6, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' } as const
