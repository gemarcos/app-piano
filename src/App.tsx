import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { useSettings } from './state/settings'
import { seedDemosOnce } from './data/seed'
import { AppFrame, Intro, TabBar, ToastProvider, installUiSoundUnlock } from './ui'
import { HomeScreen } from './features/home/HomeScreen'
import { RecordScreen } from './features/capture/RecordScreen'
import { ImportScreen } from './features/capture/ImportScreen'
import { ProcessingScreen } from './features/capture/ProcessingScreen'
import { LibraryScreen } from './features/library/LibraryScreen'
import { ViewerScreen } from './features/viewer/ViewerScreen'
import { SettingsScreen } from './features/settings/SettingsScreen'
import { AboutScreen } from './features/settings/AboutScreen'
import { SharedScreen } from './features/share/SharedScreen'
import { LinkScreen } from './features/share/LinkScreen'

const TAB_PATHS = new Set(['/', '/library', '/settings'])

/** DEV-only gallery of every UI kit component (#/__kit). Tree-shaken from production builds. */
const KitGallery = import.meta.env.DEV ? lazy(() => import('./ui/KitGallery')) : null

/** Applies the theme preference to <html data-theme> and keeps the browser theme-color in sync. */
function useTheme() {
  const theme = useSettings((s) => s.theme)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
    const syncThemeColor = () => {
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#F4F1E9')
    }
    syncThemeColor()
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return
    // Following the OS: refresh the browser chrome color when the OS switches light/dark.
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', syncThemeColor)
    return () => query.removeEventListener('change', syncThemeColor)
  }, [theme])
}

function AppRoutes() {
  const location = useLocation()
  const showTabs = TAB_PATHS.has(location.pathname)
  // Page transitions slide forward on PUSH/REPLACE and backward on POP (back button / gesture).
  const direction = useNavigationType() === 'POP' ? -1 : 1
  return (
    <>
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/library" element={<LibraryScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/about" element={<AboutScreen />} />
          <Route path="/listen" element={<RecordScreen />} />
          <Route path="/import" element={<ImportScreen />} />
          <Route path="/processing" element={<ProcessingScreen />} />
          <Route path="/score/:id" element={<ViewerScreen />} />
          <Route path="/shared" element={<SharedScreen />} />
          <Route path="/link" element={<LinkScreen />} />
          {KitGallery && (
            <Route
              path="/__kit"
              element={
                <Suspense fallback={null}>
                  <KitGallery />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<HomeScreen />} />
        </Routes>
      </AnimatePresence>
      <TabBar visible={showTabs} />
    </>
  )
}

export default function App() {
  useTheme()
  const reduceMotion = useSettings((s) => s.reduceMotion)

  useEffect(() => {
    seedDemosOnce().catch(() => {})
    installUiSoundUnlock()
  }, [])

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'} transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
      <HashRouter>
        <ToastProvider>
          <AppFrame>
            <AppRoutes />
          </AppFrame>
          <Intro />
        </ToastProvider>
      </HashRouter>
    </MotionConfig>
  )
}
