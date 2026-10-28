// When the launch intro plays: once per launch (module state, so a reload is a new launch, a navigation is not),
// only when the app opens on a main tab (a shared file or link, or a score, opens straight away), never for
// automated browsers (tests) unless forced, and shortened under reduced motion.

export type IntroMode = 'full' | 'short' | 'none'

export interface IntroContext {
  /** Already played in this launch. */
  played: boolean
  /** Settings.reduceMotion or prefers-reduced-motion. */
  reduced: boolean
  /** Route the app opened on (HashRouter path, e.g. '/', '/library', '/score/abc'). */
  path: string
  /** navigator.webdriver: automated test browsers skip the intro so their taps reach the app. */
  automated?: boolean
  /** localStorage 'pauta.intro' = 'always' (previews, videos). */
  forced?: boolean
}

/** Main tabs: the only places where an intro does not stand between the user and what they opened. */
const INTRO_PATHS = new Set(['/', '/library', '/settings'])

/** Full intro length (the app is usable underneath and a tap skips it). */
export const INTRO_FULL_MS = 1350
/** Reduced motion: a brief cross-fade of the mark. */
export const INTRO_SHORT_MS = 380

export function introMode({ played, reduced, path, automated = false, forced = false }: IntroContext): IntroMode {
  if (played) return 'none'
  if (!forced && (automated || !INTRO_PATHS.has(path || '/'))) return 'none'
  return reduced ? 'short' : 'full'
}

let played = false

/** Decides once and records it: every later call in this launch returns 'none'. */
export function takeIntro(ctx: Omit<IntroContext, 'played'>): IntroMode {
  const mode = introMode({ ...ctx, played })
  played = true
  return mode
}

/** Tests only. */
export function resetIntroForTests(): void {
  played = false
}

/** The path inside the hash ('#/library?x=1' -> '/library'). */
export function pathFromHash(hash: string): string {
  const raw = hash.replace(/^#/, '') || '/'
  const path = raw.split(/[?#]/)[0] || '/'
  return path.startsWith('/') ? path : '/' + path
}

/** Reads the browser context for takeIntro (safe outside a browser). */
export function browserIntroContext(reduced: boolean): Omit<IntroContext, 'played'> {
  let forced = false
  let automated = false
  let path = '/'
  try {
    forced = window.localStorage.getItem('pauta.intro') === 'always'
  } catch {
    // storage blocked
  }
  try {
    automated = navigator.webdriver === true
    path = pathFromHash(window.location.hash)
  } catch {
    // not a browser
  }
  return { reduced, path, automated, forced }
}
