// Owner: settings. Theme switching with a short, non-blocking color fade (Ajustes > Tema).
import type { ThemePreference } from '../../types'

const FADE_MS = 340
let fadeTimer: number | undefined

/** Same rule as App's useTheme: 'system' removes data-theme, otherwise it is forced. */
function applyThemeAttribute(theme: ThemePreference) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
}

/**
 * Applies a theme at once. With `animate`, html.set-theme-fade (SettingsScreen.css) makes colors,
 * shadows and the page background cross-fade for ~0.3 s; unlike a view transition it never blocks taps.
 * data-theme is set here in the same task as the class, so the fade starts on this very frame; App's
 * useTheme then sets the same value (idempotent). `save` writes the preference to the settings store.
 */
export function switchTheme(theme: ThemePreference, save: () => void, animate: boolean): void {
  const root = document.documentElement
  if (animate) {
    root.classList.add('set-theme-fade')
    window.clearTimeout(fadeTimer)
    fadeTimer = window.setTimeout(() => root.classList.remove('set-theme-fade'), FADE_MS)
  }
  save()
  applyThemeAttribute(theme)
}
