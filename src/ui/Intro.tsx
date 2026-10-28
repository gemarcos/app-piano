import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useReducedMotionPref } from './hooks'
import { INTRO_FULL_MS, INTRO_SHORT_MS, browserIntroContext, takeIntro, type IntroMode } from './introPolicy'
import { ease } from './motion'
import './Intro.css'

const STAFF = [0, 1, 2, 3, 4]
const WORD = 'Pauta'.split('')

/** Decided once per launch (StrictMode renders twice; a remount must not replay it). */
let launchMode: IntroMode | null = null
let finished = false

function decide(reduced: boolean): IntroMode {
  if (launchMode === null) launchMode = takeIntro(browserIntroContext(reduced))
  return finished ? 'none' : launchMode
}

/**
 * Launch intro: five staff lines draw in, a record rolls onto them and the wordmark rises, then everything
 * opens up into the app (~1.35 s). The app renders and loads underneath meanwhile; a tap or a key skips it.
 * Once per launch, only on the main tabs, shortened to a brief fade under reduced motion (see intro.ts).
 */
export function Intro() {
  const reduced = useReducedMotionPref()
  const [mode] = useState(() => decide(reduced))
  const [open, setOpen] = useState(mode !== 'none')

  useEffect(() => {
    if (mode === 'none') return
    const close = () => {
      finished = true
      setOpen(false)
    }
    const timer = window.setTimeout(close, mode === 'short' ? INTRO_SHORT_MS : INTRO_FULL_MS)
    const onKey = () => close()
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [mode])

  const skip = () => {
    finished = true
    setOpen(false)
  }

  const full = mode === 'full'
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="intro"
          className="ui-intro"
          aria-hidden="true"
          data-mode={mode}
          onPointerDown={skip}
          initial={false}
          exit={{ opacity: 0, transition: { duration: full ? 0.42 : 0.24, ease: [0.4, 0, 0.2, 1] } }}
        >
          <motion.span
            className="ui-intro__glow"
            initial={full ? { opacity: 0, scale: 0.7 } : false}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.9, ease }}
          />
          <motion.div className="ui-intro__stage" exit={full ? { scale: 1.08, y: -6, transition: { duration: 0.42, ease } } : undefined}>
            <div className="ui-intro__mark">
              <svg className="ui-intro__staff" viewBox="0 0 240 72" focusable="false">
                {STAFF.map((i) => (
                  <motion.line
                    key={i}
                    x1={6}
                    x2={234}
                    y1={8 + i * 14}
                    y2={8 + i * 14}
                    initial={full ? { pathLength: 0, opacity: 0 } : false}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 0.55, delay: i * 0.06, ease }}
                  />
                ))}
              </svg>
              <motion.span
                className="ui-intro__disc"
                initial={full ? { x: -150, rotate: -300, opacity: 0, scale: 0.85 } : false}
                animate={{ x: 0, rotate: 0, opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 120, damping: 17, mass: 0.9, delay: 0.22 }}
              >
                <span className="ui-intro__label" />
              </motion.span>
            </div>
            <p className="ui-intro__word">
              {WORD.map((ch, i) => (
                <motion.span
                  key={i}
                  initial={full ? { opacity: 0, y: 14 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.42, delay: 0.48 + i * 0.045, ease }}
                >
                  {ch}
                </motion.span>
              ))}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
