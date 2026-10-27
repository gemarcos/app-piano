#!/usr/bin/env node
// Full end-to-end check of Pauta in headless Chrome (owner: integration). Windows, Linux and macOS.
//   a) Home loads with no console / page errors and the tab bar goes Inicio -> Biblioteca -> Ajustes -> Inicio
//   b) the Library shows exactly the 3 demos on first load and after a reload
//   c) each demo opens with notes in the SVG; play -> 'playing' and the highlight moves within 3 s; pause holds;
//      settings sheet: transpose +2 changes the key label and re-renders; hands 'Derecha' -> one staff
//   c+) viewer exports: MusicXML, MIDI and ABC downloads, PDF through the print dialog
//   d) Home file input <- test/fixtures/scale.wav, then scale.mp4 -> Import -> Transcribir -> viewer with notes
//   e) fake microphone (melody-bass.wav) -> record ~6 s -> stop -> viewer with notes
//   f) Settings: dark theme applies app-wide; 'Exportar copia' downloads a JSON backup of the whole library
//   j) "Compartir con Pauta": a multipart POST to ./share-target with scale.wav reaches Import, and a shared text
//      with a YouTube link opens the player screen (/link) (production build only: the service worker handles it;
//      the full share suite is scripts/e2e-share.mjs)
//   plus the capture edge cases of scripts/e2e-capture.mjs (too-short take, cancel during processing), an offline
//   check (service worker active -> server stopped -> reload, play a demo, transcribe scale.wav) and a final check
//   that the run produced no console errors, page errors or failed requests.
// Usage: node scripts/e2e.mjs [--url http://localhost:5189/] [--dev] [--build] [--headful] [--keep] [--only a,b,c1] [--verbose]
//   Default: serves the production build (dist/, `vite preview` through scripts/serve.mjs) on port 5189 and
//   stops it at the end; dist/ is built first when missing (--build forces a fresh build). With --url, a server
//   already answering there is used as is (dev or preview). --dev serves the dev server instead of dist/.
//   Every run uses a fresh Chrome profile and download folder under <os tmpdir>/pauta/e2e/ (--keep keeps them).
//   --only runs a subset of the checks by id (a, b, c, c1, d, e, f, g, j, i, h); later checks assume the earlier ones ran.
// Exit code 0 when no check fails (the offline check is skipped against a dev server), 1 otherwise.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome-path.mjs'
import {
  ROOT,
  answers,
  cancelProcessing,
  chromeArgs,
  clickByText,
  currentHash,
  hashIs,
  importFlow,
  micFlow,
  readScore,
  setBase,
  sleep,
  tooShort,
  FIXTURES,
} from './e2e-capture.mjs'
import { YT_ID, YT_LINK, postShare, serviceWorkerReady, waitLinkState } from './e2e-share.mjs'

const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const URL_ARG = option('--url', null)
const DEV = argv.includes('--dev')
const FORCE_BUILD = argv.includes('--build')
const HEADFUL = argv.includes('--headful')
const KEEP = argv.includes('--keep')
const VERBOSE = argv.includes('--verbose')
const ONLY = option('--only', null)?.split(',').map((s) => s.trim()).filter(Boolean) ?? null
const BASE = (URL_ARG ?? 'http://localhost:5189/').replace(/#.*$/, '').replace(/\/?$/, '/')
const PORT = Number(new URL(BASE).port || 80)
setBase(BASE)

const DEMOS = [
  { id: 'demo-oda-alegria', title: 'Oda a la alegría', key: ['Sol mayor', 'La mayor'] },
  { id: 'demo-minueto-sol', title: 'Minueto en Sol mayor', key: ['Sol mayor', 'La mayor'] },
  { id: 'demo-preludio-do', title: 'Preludio en Do mayor', key: ['Do mayor', 'Re mayor'] },
]

/* ---------- server ---------- */

function vite(...args) {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), ...args], { cwd: ROOT, stdio: 'inherit' })
}

function serve(cmd) {
  const args = [path.join(ROOT, 'scripts', 'serve.mjs'), cmd, String(PORT)]
  if (cmd === 'start' && !DEV) args.push('--preview')
  execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })
}

let started = false
let mode = 'existing server'
if (!(await answers(BASE))) {
  if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
    console.error(`Nothing answers at ${BASE}`)
    process.exit(1)
  }
  if (!DEV) {
    const built = path.join(ROOT, 'dist', 'index.html')
    if (FORCE_BUILD || !existsSync(built)) {
      console.log('Building the app (vite build)...')
      vite('build')
    } else {
      console.log(`Using the existing build in dist/ (${statSync(built).mtime.toLocaleString()}); --build rebuilds it.`)
    }
  }
  serve('start')
  started = true
  mode = DEV ? 'dev server' : 'production build, vite preview'
}

/* ---------- browser ---------- */

const WORK = path.join(os.tmpdir(), 'pauta', 'e2e', `run-${Date.now()}`)
const PROFILE = path.join(WORK, 'profile')
const DOWNLOADS = path.join(WORK, 'downloads')
mkdirSync(PROFILE, { recursive: true })
mkdirSync(DOWNLOADS, { recursive: true })

let browser
try {
  browser = await puppeteer.launch({ executablePath: chromePath(), headless: !HEADFUL, userDataDir: PROFILE, args: chromeArgs() })
} catch (err) {
  if (started) serve('stop')
  throw err
}
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
const cdp = await page.createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true })

const problems = []
const origin = new URL(BASE).origin
page.on('console', (m) => {
  // The source URL tells the app's own errors from a third-party embed's (see the share link check).
  const where = m.location()?.url
  if (m.type() === 'error') problems.push(`[console.error] ${m.text()}${where ? ` @ ${where}` : ''}`)
})
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`))
page.on('requestfailed', (r) => {
  const reason = r.failure()?.errorText ?? ''
  // Aborted requests are normal (media range requests, superseded fetches, navigations).
  if (!reason.includes('ERR_ABORTED')) problems.push(`[requestfailed] ${r.url()} ${reason}`)
})
page.on('response', (r) => {
  if (r.status() >= 400 && r.url().startsWith(origin)) problems.push(`[http ${r.status()}] ${r.url()}`)
})

/* ---------- helpers ---------- */

const $count = (sel) => page.$$eval(sel, (els) => els.length)
const text = (sel) => page.$eval(sel, (el) => el.textContent?.trim() ?? '').catch(() => '')

/** Current page title (TopBar), whichever screen is mounted. */
const waitTitle = (title, timeout = 15_000) =>
  page.waitForFunction((t) => document.querySelector('main.ui-page .ui-topbar__title')?.textContent?.trim() === t, { timeout, polling: 100 }, title)

async function goHash(hash) {
  await page.evaluate((h) => {
    location.hash = h
  }, hash)
  await hashIs(page, new RegExp('^' + hash.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '$'))
}

async function libraryItems() {
  await page.waitForSelector('ul[aria-label="Partituras"] > li.lib-item', { timeout: 20_000 })
  await sleep(700) // seeding and list entrance settle
  return page.$$eval('ul[aria-label="Partituras"] > li.lib-item', (items) =>
    items.map((li) => li.querySelector('.lib-row__title, .lib-tile__title')?.textContent?.trim() ?? ''),
  )
}

/** Ids of every item in IndexedDB (raw read, works on dev and prod builds). */
function storedIds() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('pauta')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const ids = await new Promise((resolve, reject) => {
      const req = db.transaction('scores', 'readonly').objectStore('scores').getAllKeys()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return ids
  })
}

/** Waits for the viewer's score SVG and returns how many note groups it drew. */
async function viewerNotes(timeout = 30_000) {
  await page.waitForFunction(() => document.querySelectorAll('.vw-paper svg .abcjs-note').length > 0, { timeout, polling: 150 })
  return $count('.vw-paper svg .abcjs-note')
}

/** Ids of the notes lit by the cursor, e.g. "3.0.2|3.1.0" (measure.voice.index). */
const litNotes = () =>
  page.$$eval('.vw-paper .vw-on', (els) =>
    els
      .map((el) => /abcjs-mm(\d+)\s+abcjs-v(\d+)\s+abcjs-n(\d+)/.exec(el.getAttribute('class') ?? '')?.slice(1).join('.') ?? '?')
      .sort()
      .join('|'),
  )

const status = () => page.$eval('.vw-player', (el) => el.getAttribute('data-status')).catch(() => null)
const position = () => page.$eval('.vw-player__slider input', (el) => Number(el.value)).catch(() => NaN)
const keyLabel = async () => (await text('.vw-meta')).split(' · ')[0]
/** Accidentals in the first key signature (every system repeats it on both staves). */
const keySignaturePaths = () => page.evaluate(() => document.querySelector('.vw-paper .abcjs-key-signature')?.querySelectorAll('path').length ?? 0)
const rhStaves = () => $count('.vw-paper .abcjs-staff-wrapper.abcjs-l0 .abcjs-staff')

/** Waits until an overlay panel (sheet, action sheet) has finished sliding in: same position on 3 polls in a row. */
async function settled(selector, timeout = 5000) {
  await page.waitForSelector(selector, { visible: true, timeout })
  const t0 = Date.now()
  let last = null
  let same = 0
  while (Date.now() - t0 < timeout) {
    const top = await page.$eval(selector, (el) => Math.round(el.getBoundingClientRect().top)).catch(() => null)
    same = top !== null && top === last ? same + 1 : 0
    if (same >= 2 && top < (await page.evaluate(() => innerHeight))) return
    last = top
    await sleep(80)
  }
  throw new Error(`${selector} never settled`)
}

async function clickSegment(group, label) {
  await clickByText(page, `[role="radiogroup"][aria-label="${group}"] [role="radio"]`, label)
}

async function stepper(group, which, times) {
  for (let i = 0; i < times; i++) {
    await page.click(`[role="group"][aria-label="${group}"] button[aria-label="${which}"]`)
    await sleep(180)
  }
}

/**
 * Taps a library row by its title. The list animates (entrance, layout), so the row is looked up again
 * and the tap retried when the element is momentarily not hittable.
 */
async function clickRow(title) {
  let last
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await page.waitForFunction(
      (t) => [...document.querySelectorAll('.lib-row__main')].find((b) => b.querySelector('.lib-row__title')?.textContent?.trim() === t) ?? null,
      { timeout: 10_000, polling: 100 },
      title,
    )
    try {
      await row.asElement().click()
      return
    } catch (err) {
      last = err
      await sleep(300)
    }
  }
  throw last
}

async function openViewerFromLibrary(title) {
  await goHash('#/library')
  await libraryItems()
  await clickRow(title)
  await hashIs(page, /^#\/score\/[^/?]+$/)
  return viewerNotes()
}

/**
 * Viewer transport: play (the first tap creates the AudioContext, renders the buffer and starts), the
 * highlighted notes must change within 3 s, then pause must hold the position. Returns ms to the first move.
 */
async function playThenPause() {
  await page.click('.vw-player__playbtn')
  await page.waitForFunction(() => document.querySelector('.vw-player')?.getAttribute('data-status') === 'playing', { timeout: 30_000, polling: 50 })
  const t0 = Date.now()
  let first = ''
  let moved = 0
  while (Date.now() - t0 < 3000) {
    const lit = await litNotes()
    if (lit && !first) first = lit
    else if (lit && first && lit !== first) {
      moved = Date.now() - t0
      break
    }
    await sleep(60)
  }
  if (!first) throw new Error('no highlighted note while playing')
  if (!moved) throw new Error('the highlight did not move within 3 s')

  await page.click('.vw-player__playbtn')
  await page.waitForFunction(() => document.querySelector('.vw-player')?.getAttribute('data-status') === 'paused', { timeout: 5000, polling: 50 })
  const p1 = await position()
  await sleep(700)
  const p2 = await position()
  if (!(Math.abs(p2 - p1) < 0.06)) throw new Error(`paused position moved ${p1} -> ${p2}`)
  return moved
}

/** One demo through the viewer: render, play, highlight, pause, transpose, hands. */
async function demoInViewer(demo) {
  const notes = await openViewerFromLibrary(demo.title)
  const id = decodeURIComponent((await currentHash(page)).split('/').pop())
  if (id !== demo.id) throw new Error(`opened ${id}`)

  const moved = await playThenPause()

  // Settings sheet, Partitura tab: transpose +2 and hands.
  await page.click('button[aria-label="Ajustes de la partitura"]')
  await settled('.vw-sheet')
  await clickByText(page, '.vw-sheet__tabs [role="radio"]', 'Partitura')
  await page.waitForSelector('[role="group"][aria-label="Transponer"]', { visible: true, timeout: 5000 })
  const keyBefore = await keyLabel()
  const sigBefore = await keySignaturePaths()
  if (keyBefore !== demo.key[0]) throw new Error(`key label "${keyBefore}", expected "${demo.key[0]}"`)
  await stepper('Transponer', 'Aumentar', 2)
  await page
    .waitForFunction((k) => document.querySelector('.vw-meta')?.textContent?.startsWith(k), { timeout: 5000, polling: 100 }, demo.key[1])
    .catch(async () => {
      throw new Error(`after +2 the key label reads "${await keyLabel()}", expected "${demo.key[1]}"`)
    })
  const sigNow = () => document.querySelector('.vw-paper .abcjs-key-signature')?.querySelectorAll('path').length ?? 0
  await page.waitForFunction(`(${sigNow})() === ${sigBefore + 2}`, { timeout: 5000, polling: 100 }).catch(async () => {
    throw new Error(`key signature ${sigBefore} -> ${await keySignaturePaths()} sharps (no re-render?)`)
  })
  await stepper('Transponer', 'Disminuir', 2)
  await page.waitForFunction((k) => document.querySelector('.vw-meta')?.textContent?.startsWith(k), { timeout: 5000, polling: 100 }, demo.key[0])

  const before = await rhStaves()
  await clickSegment('Manos', 'Derecha')
  await page.waitForFunction(() => document.querySelectorAll('.vw-paper .abcjs-staff-wrapper.abcjs-l0 .abcjs-staff').length === 1, { timeout: 5000, polling: 100 }).catch(async () => {
    throw new Error(`hands Derecha: ${await rhStaves()} staves in the first system`)
  })
  await clickSegment('Manos', 'Ambas')
  await page.waitForFunction(() => document.querySelectorAll('.vw-paper .abcjs-staff-wrapper.abcjs-l0 .abcjs-staff').length === 2, { timeout: 5000, polling: 100 })

  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.vw-sheet'), { timeout: 5000, polling: 100 })
  return `${notes} notes; playing, highlight moved after ${(moved / 1000).toFixed(1)} s; pause holds; ${keyBefore} -> ${demo.key[1]} (${sigBefore} -> ${sigBefore + 2} sharps); Derecha: 1 staff (was ${before})`
}

/** Files that appeared in the download folder (finished downloads only). */
function downloads() {
  return readdirSync(DOWNLOADS).filter((f) => !f.endsWith('.crdownload') && !f.endsWith('.tmp'))
}

async function waitDownload(pattern, before, timeout = 10_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const fresh = downloads().filter((f) => !before.includes(f) && pattern.test(f))
    if (fresh.length) {
      const file = path.join(DOWNLOADS, fresh[0])
      await sleep(200)
      return { name: fresh[0], file, bytes: statSync(file).size }
    }
    await sleep(150)
  }
  throw new Error(`no download matching ${pattern}`)
}

async function viewerAction(label) {
  await page.click('button[aria-label="Más opciones"]')
  await settled('.ui-actionsheet')
  await clickByText(page, '.ui-actionsheet__item', label)
  await page.waitForFunction(() => !document.querySelector('.ui-actionsheet'), { timeout: 5000, polling: 100 })
}

async function viewerExports() {
  await openViewerFromLibrary(DEMOS[0].title)
  const out = []
  for (const [label, pattern] of [
    ['Exportar MusicXML', /\.musicxml$/],
    ['Exportar MIDI', /\.mid$/],
    ['Exportar ABC', /\.abc$/],
  ]) {
    const before = downloads()
    await viewerAction(label)
    const file = await waitDownload(pattern, before)
    if (file.bytes < 100) throw new Error(`${file.name} is only ${file.bytes} B`)
    out.push(`${path.extname(file.name)} ${(file.bytes / 1024).toFixed(1)} KB`)
  }
  const abc = readFileSync(path.join(DOWNLOADS, downloads().find((f) => f.endsWith('.abc'))), 'utf8')
  if (!/^T:Oda a la alegr/m.test(abc)) throw new Error('the ABC file lacks its title')
  // c1 transposed +2 and back: the stored score must still be in G (a stale debounced save once kept +1).
  const key = /^K:(\S+)/m.exec(abc)?.[1]
  if (key !== 'G') throw new Error(`the ABC file is in ${key}, expected G (params saved after transposing back?)`)
  // Headless Chrome cannot show the print dialog: count the call and the systems laid out for it.
  await page.evaluate(() => {
    window.__printed = []
    window.print = () => window.__printed.push(document.querySelectorAll('.vw-print svg').length)
  })
  await viewerAction('Exportar PDF')
  const printed = await page.waitForFunction(() => window.__printed?.length ? window.__printed[0] : null, { timeout: 10_000, polling: 100 })
  const systems = await printed.jsonValue()
  if (!(systems > 0)) throw new Error('print sheet without systems')
  out.push(`PDF print with ${systems} systems`)
  return out.join(', ')
}

/** After a capture flow: the viewer shows the new item with notes. */
async function withViewer(flow) {
  const detail = await flow()
  const notes = await viewerNotes()
  return `${detail}; viewer draws ${notes} notes`
}

async function settingsTheme() {
  await goHash('#/settings')
  await waitTitle('Ajustes')
  await clickSegment('Tema', 'Oscuro')
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', { timeout: 3000, polling: 50 })
  await sleep(500) // the theme fade ends
  const dark = await page.evaluate(() => ({
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    body: getComputedStyle(document.body).backgroundColor,
    meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
  }))
  if (dark.bg !== '#0f1015') throw new Error(`--bg is ${dark.bg} in dark mode`)
  // The rest of the app follows.
  await page.click('nav[aria-label="Principal"] a[aria-label="Biblioteca"]')
  await waitTitle('Biblioteca')
  const elsewhere = await page.evaluate(() => getComputedStyle(document.querySelector('.ui-topbar__title')).color)
  if (elsewhere !== 'rgb(242, 243, 247)') throw new Error(`library title color ${elsewhere} in dark mode`)
  await page.click('nav[aria-label="Principal"] a[aria-label="Ajustes"]')
  await waitTitle('Ajustes')
  await clickSegment('Tema', 'Sistema')
  await page.waitForFunction(() => !document.documentElement.dataset.theme, { timeout: 3000, polling: 50 })
  await sleep(500)
  const light = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())
  if (light !== '#eeeef5') throw new Error(`--bg is ${light} back on Sistema (light OS)`)
  return `data-theme=dark, --bg ${dark.bg}, theme-color ${dark.meta}, body ${dark.body}; library follows; Sistema -> light`
}

async function settingsBackup() {
  await goHash('#/settings')
  await waitTitle('Ajustes')
  const before = downloads()
  await clickByText(page, 'button.ui-row .ui-row__title', 'Exportar copia')
  const file = await waitDownload(/^pauta-copia-\d{4}-\d{2}-\d{2}\.json$/, before)
  const data = JSON.parse(readFileSync(file.file, 'utf8'))
  const { total } = await readScore(page, null)
  if (data.format !== 'pauta-backup') throw new Error(`format ${data.format}`)
  if (!Array.isArray(data.scores) || data.scores.length !== total) throw new Error(`${data.scores?.length} items in the backup, ${total} in the library`)
  const toast = await page.waitForFunction(() => document.querySelector('.ui-toast')?.textContent ?? null, { timeout: 5000 }).then((h) => h.jsonValue())
  return `${file.name}, ${(file.bytes / 1024).toFixed(0)} KB, ${data.scores.length} items (= library); toast "${toast}"`
}

/**
 * "Compartir con Pauta", file: a real multipart POST to ./share-target (what Android's share sheet sends) is answered
 * by the service worker, which keeps the file and opens #/shared; the app takes it straight to Import.
 */
async function shareFile() {
  if (DEV) return { skip: 'the dev server has no service worker (the share target lives there)' }
  if (!(await serviceWorkerReady(page))) throw new Error('no active service worker controls the page')
  await postShare(page, { file: path.join(FIXTURES, 'scale.wav') })
  await hashIs(page, /^#\/import$/, 20_000)
  const name = await page.waitForFunction(() => document.querySelector('.cap-import__name')?.textContent ?? null, { timeout: 10_000 }).then((h) => h.jsonValue())
  if (name !== 'scale.wav') throw new Error(`Import shows "${name}"`)
  return 'multipart POST to ./share-target -> service worker -> #/shared -> #/import with "scale.wav"'
}

/**
 * "Compartir con Pauta", link: YouTube shares a text with the link; the app opens the player screen with the
 * official embed. The embed is third-party: its network or console noise is reported here, not by the final check.
 */
async function shareLink() {
  if (DEV) return { skip: 'the dev server has no service worker (the share target lives there)' }
  const start = problems.length
  let ignored = 0
  try {
    await postShare(page, { title: 'Mira "Me at the zoo" en YouTube', text: `https://youtu.be/${YT_ID}?si=e2e` })
    await hashIs(page, /^#\/link\?url=/, 20_000)
    const opened = decodeURIComponent((await currentHash(page)).split('url=')[1] ?? '')
    if (opened !== YT_LINK) throw new Error(`opened ${opened}`)
    const seen = await waitLinkState(page, ['ready', 'not-embeddable', 'offline', 'failed'], 30_000)
    const what = seen.state === 'ready' ? 'official embed on screen' : seen.state === 'not-embeddable' ? 'not-embeddable message' : `"${seen.state}" message (network)`
    return `#/link?url=${opened}: ${what}`
  } finally {
    // Leave, and wait until the screen (and the embed iframe) is really gone: the page exit animation keeps it
    // mounted for a moment, and its late requests would land in the next check.
    await goHash('#/').catch(() => {})
    await page.waitForFunction(() => !document.querySelector('.share-link__stage iframe'), { timeout: 5000, polling: 50 }).catch(() => {})
    await sleep(800)
    const added = problems.splice(start)
    const ours = added.filter((p) => p.startsWith('[pageerror]') || p.includes(` @ ${origin}`) || p.startsWith(`[requestfailed] ${origin}`) || (p.startsWith('[http') && p.includes(origin)))
    ignored = added.length - ours.length
    problems.push(...ours)
    if (ignored) console.log(`     (${ignored} third-party messages from the embed ignored)`)
  }
}

/** Problems logged while the app ran offline: reported by the offline check, not by the final one. */
let offlineWindow = null

/**
 * Offline after the first load: once the service worker is active, the preview server is stopped (or, with an
 * external --url, the page is put offline), then the app reloads from the cache, opens and plays a demo, and
 * transcribes scale.wav (model, worker, abcjs and soundfont all precached).
 */
async function offline() {
  const active = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator) || !(await navigator.serviceWorker.getRegistration())) return false
    return Promise.race([
      navigator.serviceWorker.ready.then((r) => !!r.active && !!navigator.serviceWorker.controller),
      new Promise((r) => setTimeout(() => r(false), 15_000)),
    ])
  })
  if (!active) {
    if (DEV) return { skip: 'the dev server has no service worker' }
    throw new Error('no active service worker controls the page')
  }
  const start = problems.length
  if (started) serve('stop')
  else await page.setOfflineMode(true)
  try {
    await page.reload({ waitUntil: 'load', timeout: 30_000 })
    await goHash('#/library')
    const items = await libraryItems()
    const notes = await openViewerFromLibrary(DEMOS[1].title)
    const moved = await playThenPause()
    const imported = await withViewer(() => importFlow(page, 'scale.wav', { video: false }))
    // Only the service worker's own update check may fail while offline.
    const unexpected = problems.slice(start).filter((p) => !/\/sw\.js\b|ServiceWorker/i.test(p))
    if (unexpected.length) throw new Error(`${unexpected.length} offline problems: ${unexpected.slice(0, 2).join(' | ')}`)
    return `${started ? 'server stopped' : 'page offline'}; ${items.length} items; ${DEMOS[1].title}: ${notes} notes, plays (highlight after ${(moved / 1000).toFixed(1)} s); scale.wav -> ${imported.split(': ')[1]}`
  } finally {
    offlineWindow = [start, problems.length]
    if (!started) await page.setOfflineMode(false).catch(() => {})
  }
}

/* ---------- run ---------- */

const results = []
const label = (row) => (row.ok === null ? 'SKIP' : row.ok ? 'PASS' : 'FAIL')
async function step(id, name, fn) {
  if (ONLY && !ONLY.some((o) => id === o || id.startsWith(o))) return
  const t0 = Date.now()
  let row
  try {
    const out = await fn()
    row = out && typeof out === 'object' && 'skip' in out ? { id, name, ok: null, detail: `skipped: ${out.skip}` } : { id, name, ok: true, detail: String(out ?? '') }
  } catch (err) {
    row = { id, name, ok: false, detail: String(err?.message ?? err).split('\n')[0] }
    if (VERBOSE) console.log(err?.stack ?? err)
  }
  row.s = (Date.now() - t0) / 1000
  results.push(row)
  console.log(`${label(row)}  ${id.padEnd(3)} ${name}`)
}

const chrome = await browser.version()
console.log(`\nPauta e2e  ${BASE}  (${mode}; ${chrome}; ${process.platform})\n`)

try {
  await step('a', 'Home loads; tab bar Inicio / Biblioteca / Ajustes', async () => {
    await page.goto(BASE + '#/', { waitUntil: 'networkidle0', timeout: 60_000 })
    await page.waitForSelector('[aria-label="Escuchar"]', { timeout: 15_000 })
    await sleep(1500)
    const atLoad = problems.length
    if (atLoad) throw new Error(`${atLoad} errors on load: ${problems[0]}`)
    for (const [tab, hash, title] of [
      ['Biblioteca', /^#\/library$/, 'Biblioteca'],
      ['Ajustes', /^#\/settings$/, 'Ajustes'],
      ['Inicio', /^#\/$/, 'Pauta'],
    ]) {
      await page.click(`nav[aria-label="Principal"] a[aria-label="${tab}"]`)
      await hashIs(page, hash)
      await waitTitle(title)
      const current = await page.$eval('nav[aria-label="Principal"] a[aria-current="page"]', (a) => a.getAttribute('aria-label'))
      if (current !== tab) throw new Error(`tab bar marks "${current}" on ${tab}`)
    }
    await page.waitForSelector('[aria-label="Escuchar"]', { timeout: 5000 })
    return '0 console/page errors on load; Biblioteca, Ajustes and Inicio open with the right tab marked'
  })

  await step('b', 'Library: exactly the 3 demos, also after a reload', async () => {
    await goHash('#/library')
    const first = await libraryItems()
    const ids = (await storedIds()).sort()
    await page.reload({ waitUntil: 'networkidle0' })
    await waitTitle('Biblioteca')
    const second = await libraryItems()
    const idsAfter = (await storedIds()).sort()
    const expected = DEMOS.map((d) => d.id).sort()
    if (first.length !== 3 || second.length !== 3) throw new Error(`${first.length} items, then ${second.length} after the reload`)
    if (ids.join() !== expected.join() || idsAfter.join() !== expected.join()) throw new Error(`stored ids ${ids.join(', ')}`)
    return `${first.join(' / ')}; 3 after reload; IndexedDB holds the 3 demo ids`
  })

  for (const [i, demo] of DEMOS.entries()) {
    await step(`c${i + 1}`, `Viewer: ${demo.title}`, () => demoInViewer(demo))
  }
  await step('c4', 'Viewer exports: MusicXML, MIDI, ABC, PDF', viewerExports)

  await step('d1', 'Import scale.wav -> viewer with notes', () => withViewer(() => importFlow(page, 'scale.wav', { video: false })))
  await step('d2', 'Import scale.mp4 (video) -> viewer with notes', () => withViewer(() => importFlow(page, 'scale.mp4', { video: true })))
  await step('e', 'Fake mic, record 6 s -> viewer with notes', () => withViewer(() => micFlow(page, 6.5)))

  await step('f1', 'Settings: dark theme applies app-wide', settingsTheme)
  await step('f2', 'Settings: backup export downloads a JSON', settingsBackup)

  await step('g1', 'Capture: a too-short take is refused', () => tooShort(page))
  await step('g2', 'Capture: cancel during processing saves nothing', () => cancelProcessing(page))

  await step('j1', 'Share target: a POSTed audio file opens Import', shareFile)
  await step('j2', 'Share target: a shared YouTube link opens the player', shareLink)

  await step('i', 'Offline after the first load: library, playback, transcription', offline)

  await step('h', 'No console errors, page errors or failed requests', async () => {
    const online = offlineWindow ? [...problems.slice(0, offlineWindow[0]), ...problems.slice(offlineWindow[1])] : problems
    if (online.length) throw new Error(`${online.length}: ${online.slice(0, 3).join(' | ')}`)
    return offlineWindow ? 'none while online (the offline check reports its own)' : 'none in the whole run'
  })
} finally {
  await browser.close().catch(() => {})
  if (started) serve('stop')
  if (!KEEP) {
    try {
      rmSync(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } catch {
      // Chrome may still hold the profile for a moment on Windows; the OS temp cleaner takes it.
    }
  }
}

/* ---------- table ---------- */

const width = Math.max(5, ...results.map((r) => r.name.length))
console.log(`\n     check${' '.repeat(width - 5)}  result   time  detail`)
for (const r of results) {
  console.log(`${r.id.padEnd(4)} ${r.name.padEnd(width)}  ${label(r)}  ${r.s.toFixed(1).padStart(5)} s  ${r.detail}`)
}
const passed = results.filter((r) => r.ok === true).length
const skipped = results.filter((r) => r.ok === null).length
const failed = results.length - passed - skipped
console.log(`\n${passed}/${results.length} PASS${skipped ? `, ${skipped} SKIP` : ''}${failed ? `, ${failed} FAIL` : ''}`)
if (problems.length) console.log('\nconsole / page / network problems:\n' + problems.join('\n'))
if (KEEP) console.log(`\nprofile and downloads kept in ${WORK}`)
process.exit(failed === 0 ? 0 : 1)
