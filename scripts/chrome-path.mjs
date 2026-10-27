// Locates a Chrome/Chromium binary for puppeteer-core on Linux, Windows and macOS.
// CHROME_PATH (env) always wins.
import { existsSync } from 'node:fs'
import path from 'node:path'

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = {
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    win32: [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  }[process.platform] ?? []
  const found = candidates.find((p) => p && existsSync(p))
  if (!found) {
    throw new Error('No se encontró Chrome. Define CHROME_PATH con la ruta del ejecutable de Chrome.')
  }
  return found
}
