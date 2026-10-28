#!/usr/bin/env node
// End-to-end check of "Compartir con Pauta" in headless Chrome (owner: share). Runs on the PRODUCTION build:
// the share target lives in the service worker (public/share-target-sw.js), which only exists in dist/.
//   a) service worker active; the manifest declares share_target (POST multipart, files "media")
//   b) a real multipart form POST to ./share-target with scale.wav -> #/shared -> #/import with the file
//   c) a POST whose text carries a YouTube link -> #/link?url=… shows the official embed (or the not-embeddable message)
//   d) a POST with only a non-media file, and an empty one -> calm toast and Home
//   e) link states that do not depend on luck with the network: embedding disabled (oEmbed 401, mocked),
//      TikTok short link that cannot be resolved (mocked), a site that is neither YouTube nor TikTok
//   f) Home "Enlace" pill -> dialog -> #/link (plain text without a link is refused)
//   g) fake microphone on #/link -> Detener -> Processing -> new item with sourceName = the link (and the oEmbed title)
//   h) no console errors from the app itself (third-party embed noise is reported, not counted)
//   s) a silent microphone on #/link shows the quiet "No llega sonido" hint after ~3 s (phone actions: Escuchar + Archivo)
//   k) computer: the link screen offers the same actions as a phone (Escuchar + Archivo, no tab capture of the
//      embedded player, YouTube API policies) and Escuchar opens the microphone, never getDisplayMedia
//   plus one informational row: a real TikTok short link through TikTok's oEmbed (never fails the run).
// Usage: node scripts/e2e-share.mjs [--url http://localhost:5195/] [--build] [--headful] [--keep] [--verbose]
//                                   [--shots] [--no-checks]
//   Without a server answering at --url it serves dist/ (built first when missing; --build rebuilds) with
//   `node scripts/serve.mjs start <port> --preview` and stops it at the end.
//   --shots also saves docs/screenshots/share-*.png (390x844 @2x, light and dark); --no-checks only takes them.
// Exit code 0 when no check fails. postShare() is exported for scripts/e2e.mjs.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome-path.mjs'
import { FIXTURES, ROOT, answers, chromeArgs, clickByText, currentHash, hashIs, sleep } from './e2e-capture.mjs'

export const SHARE_CACHE = 'pauta-share-v1'
export const YT_ID = 'jNQXAC9IVRw'
export const YT_LINK = `https://www.youtube.com/watch?v=${YT_ID}`
const TRANSCRIBE_TIMEOUT = 120_000

/**
 * Submits a real multipart/form-data POST to ./share-target from the page, like Android's share sheet does
 * (title / text / url, files under "media"), and waits for the navigation the service worker answers.
 */
export async function postShare(page, { file = null, title = '', text = '', url = '' } = {}) {
  await page.evaluate(
    (fields) => {
      document.getElementById('__e2e_share')?.remove()
      const form = document.createElement('form')
      form.id = '__e2e_share'
      form.method = 'POST'
      form.enctype = 'multipart/form-data'
      form.action = new URL('share-target', document.baseURI).href
      form.hidden = true
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = name
        input.value = value
        form.appendChild(input)
      }
      const media = document.createElement('input')
      media.type = 'file'
      media.name = 'media'
      media.id = '__e2e_media'
      form.appendChild(media)
      document.body.appendChild(form)
    },
    { title, text, url },
  )
  if (file) await (await page.$('#__e2e_media')).uploadFile(file)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load', timeout: 30_000 }),
    page.evaluate(() => document.getElementById('__e2e_share').submit()),
  ])
}

/** Waits until a service worker is active and controls the page (reloads once if it only became active). */
export async function serviceWorkerReady(page, timeout = 30_000) {
  const ok = await page.evaluate(async (ms) => {
    if (!('serviceWorker' in navigator)) return false
    return Promise.race([navigator.serviceWorker.ready.then((r) => !!r.active), new Promise((r) => setTimeout(() => r(false), ms))])
  }, timeout)
  if (!ok) return false
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload({ waitUntil: 'load' })
  return page.evaluate(() => !!navigator.serviceWorker.controller)
}

/** The link screen's state: data-platform / data-state / data-video of .share-link__stage. */
export const linkState = (page) =>
  page.$eval('.share-link__stage', (el) => ({ platform: el.dataset.platform, state: el.dataset.state, video: el.dataset.video ?? '', muted: el.dataset.muted ?? '' })).catch(() => null)

/** Waits for the link screen to settle on one of `states`. */
export async function waitLinkState(page, states, timeout = 30_000) {
  await page.waitForFunction((s) => s.includes(document.querySelector('.share-link__stage')?.dataset.state), { timeout, polling: 100 }, states)
  return linkState(page)
}

/** Waits for a toast with exactly this text (an older toast may still be on screen); returns what was shown. */
async function waitToast(page, expected, timeout = 6000) {
  try {
    await page.waitForFunction((t) => [...document.querySelectorAll('.ui-toast')].some((el) => el.textContent?.trim() === t), { timeout, polling: 50 }, expected)
    return expected
  } catch {
    return page.evaluate(() => [...document.querySelectorAll('.ui-toast')].map((el) => el.textContent?.trim()).join(' | ') || '(no toast)')
  }
}

/** The stored item (raw IndexedDB, works on any build). */
function readItem(page, id) {
  return page.evaluate(async (scoreId) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('pauta')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const doc = await new Promise((resolve, reject) => {
      const req = db.transaction('scores', 'readonly').objectStore('scores').get(scoreId)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return doc ? { title: doc.title, source: doc.source, sourceName: doc.sourceName, notes: doc.notes?.length ?? 0, audioId: doc.audioId ?? null } : null
  }, id)
}

/* ---------- run (only when executed directly) ---------- */

async function main() {
  const argv = process.argv.slice(2)
  const option = (name, fallback) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
  }
  const BASE = option('--url', 'http://localhost:5195/').replace(/#.*$/, '').replace(/\/?$/, '/')
  const PORT = Number(new URL(BASE).port || 80)
  const ORIGIN = new URL(BASE).origin
  const HEADFUL = argv.includes('--headful')
  const KEEP = argv.includes('--keep')
  const VERBOSE = argv.includes('--verbose')
  const SHOTS = argv.includes('--shots') || argv.includes('--no-checks')
  const CHECKS = !argv.includes('--no-checks')

  const serve = (cmd) => {
    const args = [path.join(ROOT, 'scripts', 'serve.mjs'), cmd, String(PORT)]
    if (cmd === 'start') args.push('--preview')
    execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })
  }
  let started = false
  if (!(await answers(BASE))) {
    const built = path.join(ROOT, 'dist', 'index.html')
    if (argv.includes('--build') || !existsSync(built)) {
      console.log('Building the app (vite build)...')
      execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: ROOT, stdio: 'inherit' })
    } else console.log(`Using the existing build in dist/ (${statSync(built).mtime.toLocaleString()}); --build rebuilds it.`)
    serve('start')
    started = true
  }

  const WORK = path.join(os.tmpdir(), 'pauta', 'e2e-share', `run-${Date.now()}`)
  mkdirSync(WORK, { recursive: true })
  const notMedia = path.join(WORK, 'notas.txt')
  writeFileSync(notMedia, 'Esto no es audio.\n')

  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: !HEADFUL, userDataDir: path.join(WORK, 'profile'), args: chromeArgs() })
  const problems = []
  const noise = []
  const watch = (page) => {
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      const where = m.location()?.url ?? ''
      const line = `[console.error] ${m.text().slice(0, 240)}${where ? ` @ ${where.slice(0, 120)}` : ''}`
      // Chrome's own CORS / network messages about a third-party URL (TikTok throttling oEmbed) are not app errors.
      const about = /^Access to fetch at '([^']+)'/.exec(m.text())?.[1] ?? ''
      const thirdParty = (where && !where.startsWith(ORIGIN)) || (about && !about.startsWith(ORIGIN))
      ;(thirdParty ? noise : problems).push(line)
    })
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`))
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().startsWith(ORIGIN)) problems.push(`[http ${r.status()}] ${r.url()}`)
    })
  }
  const newPage = async ({ dpr = 1, dark = false, mock = null, on = browser } = {}) => {
    const page = await on.newPage()
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: dpr, isMobile: true, hasTouch: true })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }])
    watch(page)
    if (mock) {
      // Mocks need the requests to skip the service worker.
      await page.setBypassServiceWorker(true)
      await page.setRequestInterception(true)
      page.on('request', (req) => {
        const hit = mock(req.url())
        if (hit) req.respond({ contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, ...hit })
        else req.continue()
      })
    }
    return page
  }
  const linkUrl = (u) => BASE + '#/link?url=' + encodeURIComponent(u)
  const oembed401 = (u) => (u.includes('youtube.com/oembed') ? { status: 401, body: 'Unauthorized' } : null)
  const tiktokFails = (u) => (u.includes('tiktok.com/oembed') ? { status: 400, body: 'Bad Request' } : null)

  const results = []
  const label = (r) => (r.ok === null ? 'SKIP' : r.ok ? 'PASS' : 'FAIL')
  const step = async (id, name, fn) => {
    const t0 = Date.now()
    let row
    try {
      const out = await fn()
      row = out && typeof out === 'object' && 'skip' in out ? { id, name, ok: null, detail: out.skip } : { id, name, ok: true, detail: String(out ?? '') }
    } catch (err) {
      row = { id, name, ok: false, detail: String(err?.message ?? err).split('\n')[0] }
      if (VERBOSE) console.log(err?.stack ?? err)
    }
    row.s = (Date.now() - t0) / 1000
    results.push(row)
    console.log(`${label(row)}  ${id.padEnd(2)} ${name}`)
  }

  const chrome = await browser.version()
  console.log(`\nPauta share e2e  ${BASE}  (${started ? 'production build, vite preview' : 'existing server'}; ${chrome}; ${process.platform})\n`)

  try {
    if (CHECKS) {
      const page = await newPage()
      await step('a', 'Service worker active; manifest has share_target', async () => {
        await page.goto(BASE + '#/', { waitUntil: 'networkidle0', timeout: 60_000 })
        if (!(await serviceWorkerReady(page))) throw new Error('no service worker controls the page (is this the production build?)')
        const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json())
        const st = manifest.share_target
        if (st?.action !== './share-target' || st.method !== 'POST' || st.enctype !== 'multipart/form-data') throw new Error(`share_target ${JSON.stringify(st)}`)
        const files = [].concat(st.params?.files ?? [])
        if (files[0]?.name !== 'media' || !files[0].accept.includes('video/*')) throw new Error(`files ${JSON.stringify(files)}`)
        const sw = await page.evaluate(async () => (await fetch('sw.js')).text())
        if (!sw.includes('share-target-sw.js')) throw new Error('sw.js does not import share-target-sw.js')
        return `controller active; share_target POST multipart (title/text/url + media: ${files[0].accept.length} types); sw.js imports share-target-sw.js`
      })

      await step('b', 'POST share-target with scale.wav -> Import', async () => {
        await postShare(page, { file: path.join(FIXTURES, 'scale.wav') })
        await hashIs(page, /^#\/import$/, 20_000)
        const name = await page.waitForFunction(() => document.querySelector('.cap-import__name')?.textContent ?? null, { timeout: 10_000 }).then((h) => h.jsonValue())
        if (name !== 'scale.wav') throw new Error(`Import shows "${name}"`)
        const left = await page.evaluate((c) => caches.has(c), SHARE_CACHE)
        if (left) throw new Error('the share inbox was not cleared')
        return 'landed on #/import with "scale.wav"; inbox cleared'
      })

      let linkSeen = null
      await step('c', 'POST with a YouTube link in the text -> player screen', async () => {
        await postShare(page, { title: 'Mira "Me at the zoo" en YouTube', text: `https://youtu.be/${YT_ID}?si=e2eShare` })
        await hashIs(page, new RegExp('^#/link\\?url=' + encodeURIComponent(YT_LINK).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), 20_000)
        linkSeen = await waitLinkState(page, ['ready', 'not-embeddable', 'offline', 'failed'], 30_000)
        if (linkSeen.state === 'offline' || linkSeen.state === 'failed') return { skip: `no network here: the screen shows its "${linkSeen.state}" message` }
        const title = await page.$eval('.share-link__title', (el) => el.textContent).catch(() => '')
        const embed = await page.$('.share-player__frame iframe[src*="youtube-nocookie.com/embed/' + YT_ID + '"]')
        if (linkSeen.state === 'ready' && !embed) throw new Error('ready without the youtube-nocookie iframe')
        return `#/link?url=${YT_LINK}; ${linkSeen.state === 'ready' ? `official embed (youtube-nocookie, IFrame API), title "${title}"` : 'not-embeddable message'}`
      })

      await step('d', 'POST with a non-media file / nothing -> toast and Home', async () => {
        await postShare(page, { file: notMedia })
        const t1 = await waitToast(page, 'Este archivo no es de audio ni de vídeo.')
        await hashIs(page, /^#\/$/, 10_000)
        if (t1 !== 'Este archivo no es de audio ni de vídeo.') throw new Error(`toast "${t1}"`)
        await postShare(page, {})
        const t2 = await waitToast(page, 'No se encontró audio, vídeo ni enlace.')
        await hashIs(page, /^#\/$/, 10_000)
        if (t2 !== 'No se encontró audio, vídeo ni enlace.') throw new Error(`toast "${t2}"`)
        return `"${t1}" / "${t2}", both back on Home`
      })

      await step('e', 'Link states: not embeddable, TikTok short link, other site', async () => {
        const out = []
        for (const [url, mock, state, copy] of [
          [`https://youtu.be/${YT_ID}`, oembed401, 'not-embeddable', 'Este vídeo solo se puede ver en YouTube'],
          ['https://vm.tiktok.com/ZGeToSUk4/', tiktokFails, 'short', 'Este enlace corto de TikTok no se abre aquí'],
          ['https://www.instagram.com/reel/Cabc123/', null, 'unsupported', 'Este enlace no es de YouTube ni de TikTok'],
        ]) {
          const p = await newPage({ mock })
          try {
            await p.goto(linkUrl(url), { waitUntil: 'domcontentloaded' })
            await waitLinkState(p, [state], 20_000)
            // The message card mounts once the player card has left (AnimatePresence mode="wait").
            const text = await p.waitForSelector('.share-block__title', { visible: true, timeout: 5000 }).then((h) => h.evaluate((el) => el.textContent))
            if (text !== copy) throw new Error(`${state}: "${text}"`)
            const buttons = await p.$$eval('.share-link__controls button', (bs) => bs.map((b) => b.textContent.trim()))
            if (!buttons.includes('Escuchar')) throw new Error(`${state}: no Escuchar (${buttons.join(', ')})`)
            if (state === 'short' && buttons[0] !== 'Archivo') throw new Error('short link: Archivo is not the first action')
            if (state === 'not-embeddable' && (await p.$('.share-player__frame iframe'))) throw new Error('the embed is still mounted')
            out.push(`${state}: "${text}" + ${buttons.join('/')}`)
          } finally {
            await p.close()
          }
        }
        return out.join('; ')
      })

      await step('f', 'Home "Enlace" pill -> dialog -> player screen', async () => {
        // Background tabs get no animation frames in headless Chrome: route transitions would never finish.
        await page.bringToFront()
        await page.goto(BASE + '#/', { waitUntil: 'networkidle0' })
        await clickByText(page, 'button', 'Enlace')
        await page.waitForSelector('.ui-dialog__input', { visible: true, timeout: 5000 })
        await page.type('.ui-dialog__input', 'hola')
        await clickByText(page, '.ui-dialog button', 'Abrir')
        const refused = await waitToast(page, 'Pega un enlace de YouTube o TikTok.')
        if (refused !== 'Pega un enlace de YouTube o TikTok.') throw new Error(`plain text: toast "${refused}"`)
        if (!(await page.$('.ui-dialog__input'))) throw new Error('the dialog closed on plain text')
        await page.click('.ui-dialog__input', { count: 3 })
        await page.type('.ui-dialog__input', `Mira esto: https://youtu.be/${YT_ID}`)
        await clickByText(page, '.ui-dialog button', 'Abrir')
        await hashIs(page, /^#\/link\?url=/, 10_000)
        const hash = decodeURIComponent((await currentHash(page)).split('url=')[1] ?? '')
        if (hash !== YT_LINK) throw new Error(`opened ${hash}`)
        return `plain text refused ("${refused}"); a pasted text with a link opens #/link?url=${hash}`
      })

      await step('g', 'Fake mic on the player screen -> new item with the link', async () => {
        const seen = await waitLinkState(page, ['ready', 'not-embeddable', 'offline', 'failed'], 30_000)
        const oembedTitle = await page.$eval('.share-link__title', (el) => el.textContent).catch(() => '')
        await clickByText(page, '.share-link__controls button', 'Escuchar')
        await page.waitForSelector('button[aria-label="Detener"]:not([disabled])', { timeout: 15_000 })
        let peak = 0
        const heights = new Set()
        const t0 = Date.now()
        while (Date.now() - t0 < 6500) {
          const h = await page.$$eval('.share-meter__bars .ui-livebars__bar', (bars) => Math.max(0, ...bars.map((b) => Math.round(parseFloat(b.style.height) || 0))))
          peak = Math.max(peak, h)
          heights.add(h)
          await sleep(250)
        }
        const video = (await linkState(page))?.video || 'unknown'
        const timer = await page.$eval('.share-meter__elapsed', (el) => el.textContent)
        await page.click('button[aria-label="Detener"]')
        await hashIs(page, /^#\/processing$/, 15_000)
        await hashIs(page, /^#\/score\/[^/?]+$/, TRANSCRIBE_TIMEOUT)
        const id = decodeURIComponent((await currentHash(page)).split('/').pop())
        const doc = await readItem(page, id)
        if (!doc) throw new Error(`no IndexedDB item ${id}`)
        if (doc.sourceName !== YT_LINK) throw new Error(`sourceName "${doc.sourceName}"`)
        if (doc.source !== 'mic' || !(doc.notes > 0)) throw new Error(`source ${doc.source}, ${doc.notes} notes`)
        const expected = oembedTitle || null
        if (expected ? doc.title !== expected : !/^Enlace /.test(doc.title)) throw new Error(`title "${doc.title}"`)
        if (!(heights.size > 2 && peak > 8)) throw new Error('live bars never moved')
        // Back from the new score returns to the link (Processing was pushed, then replaced by the score).
        await page.goBack()
        await hashIs(page, /^#\/link\?url=/, 10_000)
        return `${seen.state}; video while recording: ${video}; timer ${timer}, bars peak ${peak}px; item "${doc.title}", ${doc.notes} notes, sourceName ${doc.sourceName}; Back returns to the link`
      })

      await step('s', 'Silent microphone on the player screen -> quiet hint', async () => {
        // A separate browser whose fake microphone plays silence.
        const quiet = await puppeteer.launch({ executablePath: chromePath(), headless: !HEADFUL, args: chromeArgs(path.join(FIXTURES, 'silence.wav')) })
        try {
          const p = await quiet.newPage()
          await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
          watch(p)
          await p.goto(linkUrl(YT_LINK), { waitUntil: 'domcontentloaded' })
          await waitLinkState(p, ['ready', 'not-embeddable', 'offline', 'failed'], 30_000)
          const idle = await p.$eval('.share-link__nudge', (el) => el.textContent?.trim() ?? '')
          const buttons = await p.$$eval('.share-link__controls button', (bs) => bs.map((b) => b.textContent.trim()))
          if (buttons.join('/') !== 'Escuchar/Archivo') throw new Error(`phone actions ${buttons.join('/')}`)
          await clickByText(p, '.share-link__controls button', 'Escuchar')
          await p.waitForSelector('button[aria-label="Detener"]:not([disabled])', { timeout: 15_000 })
          const hint = await p
            .waitForFunction(() => {
              const text = document.querySelector('.share-link__nudge')?.textContent ?? ''
              return /No llega sonido/.test(text) ? text : null
            }, { timeout: 8000, polling: 200 })
            .then((h) => h.jsonValue())
          return `phone: ${buttons.join(' + ')}, idle line "${idle}"; silent take -> "${hint}"`
        } finally {
          await quiet.close().catch(() => {})
          await page.bringToFront()
        }
      })

      await step('k', 'Computer: microphone + file only, no capture of the embedded player', async () => {
        // Desktop viewport (no touch): the actions used to differ here ("Grabar el vídeo"); now they are the phone's.
        const p = await browser.newPage()
        try {
          await p.setViewport({ width: 1180, height: 820, deviceScaleFactor: 1 })
          watch(p)
          await p.evaluateOnNewDocument(() => {
            window.__media = { display: 0, user: 0 }
            const md = navigator.mediaDevices
            const display = md.getDisplayMedia?.bind(md)
            const user = md.getUserMedia.bind(md)
            if (display) md.getDisplayMedia = (o) => (window.__media.display++, display(o))
            md.getUserMedia = (o) => (window.__media.user++, user(o))
          })
          await p.bringToFront()
          await p.goto(linkUrl(YT_LINK), { waitUntil: 'domcontentloaded' })
          const seen = await waitLinkState(p, ['ready', 'not-embeddable', 'offline', 'failed'], 30_000)
          const buttons = await p.$$eval('.share-link__controls button', (bs) => bs.map((b) => b.textContent.trim()))
          if (buttons.join('/') !== 'Escuchar/Archivo') throw new Error(`computer actions ${buttons.join('/')}`)
          const idle = await p.$eval('.share-link__nudge', (el) => el.textContent?.trim() ?? '')
          if (seen.state === 'ready' && !/sube el volumen/.test(idle)) throw new Error(`idle line "${idle}"`)
          await clickByText(p, '.share-link__controls button', 'Escuchar')
          await p.waitForSelector('button[aria-label="Detener"]:not([disabled])', { timeout: 15_000 })
          const media = await p.evaluate(() => window.__media)
          if (media.display !== 0 || media.user < 1) throw new Error(`media calls ${JSON.stringify(media)}`)
          await p.click('button[aria-label="Cerrar"]')
          return `${seen.state}; actions ${buttons.join(' + ')}, idle line "${idle}"; Escuchar -> getUserMedia x${media.user}, getDisplayMedia never`
        } finally {
          await p.close().catch(() => {})
          await page.bringToFront()
        }
      })

      await step('t', 'TikTok short link through oEmbed, real network (informational)', async () => {
        const p = await newPage()
        await p.goto(linkUrl('https://vm.tiktok.com/ZGeToSUk4/'), { waitUntil: 'domcontentloaded' })
        const s = await waitLinkState(p, ['ready', 'short', 'offline', 'failed', 'unavailable'], 30_000).catch(() => linkState(p))
        await p.close()
        await page.bringToFront()
        return s?.state === 'short' ? { skip: 'not resolved in the browser (TikTok oEmbed answered without CORS headers / throttled): fallback message shown' } : `state "${s?.state}"`
      })

      await step('h', 'No console errors from the app', async () => {
        if (problems.length) throw new Error(`${problems.length}: ${problems.slice(0, 3).join(' | ')}`)
        return noise.length ? `none (${noise.length} third-party messages from the embeds and mocked requests ignored)` : 'none'
      })
      await page.close()
    }

    if (SHOTS) {
      // A fresh profile, so the previews show a clean library (the demos only), not the items the checks created.
      const fresh = await puppeteer.launch({ executablePath: chromePath(), headless: !HEADFUL, userDataDir: path.join(WORK, 'profile-shots'), args: chromeArgs() })
      try {
        await screenshots({ newPage: (opts = {}) => newPage({ ...opts, on: fresh }), linkUrl, oembed401, tiktokFails, BASE })
      } finally {
        await fresh.close().catch(() => {})
      }
    }
  } finally {
    await browser.close().catch(() => {})
    if (started) serve('stop')
    if (!KEEP) {
      try {
        rmSync(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
      } catch {
        // Chrome may still hold the profile for a moment on Windows
      }
    }
  }

  if (results.length) {
    const width = Math.max(5, ...results.map((r) => r.name.length))
    console.log(`\n    check${' '.repeat(width - 5)}  result   time  detail`)
    for (const r of results) console.log(`${r.id.padEnd(3)} ${r.name.padEnd(width)}  ${label(r)}  ${r.s.toFixed(1).padStart(5)} s  ${r.detail}`)
    const passed = results.filter((r) => r.ok === true).length
    const skipped = results.filter((r) => r.ok === null).length
    const failed = results.length - passed - skipped
    console.log(`\n${passed}/${results.length} PASS${skipped ? `, ${skipped} SKIP` : ''}${failed ? `, ${failed} FAIL` : ''}`)
    if (problems.length) console.log('\napp problems:\n' + problems.join('\n'))
    if (VERBOSE && noise.length) console.log('\nthird-party noise:\n' + noise.join('\n'))
    process.exit(failed === 0 ? 0 : 1)
  }
}

/** docs/screenshots/share-*.png, light and dark (390x844 @2x). */
async function screenshots({ newPage, linkUrl, oembed401, tiktokFails, BASE }) {
  const OUT = path.join(ROOT, 'docs', 'screenshots')
  for (const dark of [false, true]) {
    const sfx = dark ? '-dark' : ''
    const shot = (page, name) => page.screenshot({ path: path.join(OUT, `share-${name}${sfx}.png`) })
    const p = await newPage({ dpr: 2, dark })
    await p.goto(BASE + '#/', { waitUntil: 'networkidle0', timeout: 60_000 })
    await serviceWorkerReady(p)
    await sleep(1600)
    await shot(p, 'home')
    await clickByText(p, 'button', 'Enlace')
    await p.waitForSelector('.ui-dialog__input', { visible: true })
    await p.type('.ui-dialog__input', `https://youtu.be/${YT_ID}`)
    await sleep(600)
    await shot(p, 'enlace')
    await clickByText(p, '.ui-dialog button', 'Abrir')
    await waitLinkState(p, ['ready'], 30_000)
    await sleep(2200)
    await shot(p, 'link-youtube')
    await clickByText(p, '.share-link__controls button', 'Escuchar')
    await p.waitForSelector('button[aria-label="Detener"]:not([disabled])', { timeout: 15_000 })
    await sleep(4300)
    await shot(p, 'link-recording')
    // The embed keeps streaming: leave by hash (same document) and wait for Home rather than for an idle network.
    await p.evaluate(() => {
      location.hash = '#/'
    })
    await p.waitForSelector('[aria-label="Escuchar"]', { timeout: 15_000 })
    await postShare(p, { file: path.join(FIXTURES, 'scale.wav') })
    await hashIs(p, /^#\/import$/, 20_000)
    await sleep(1400)
    await shot(p, 'import')
    await p.close()

    for (const [name, url, mock, state] of [
      ['link-noembed', `https://youtu.be/${YT_ID}`, oembed401, 'not-embeddable'],
      ['link-short', 'https://vm.tiktok.com/ZGeToSUk4/', tiktokFails, 'short'],
      ['link-unsupported', 'https://www.instagram.com/reel/Cabc123/', null, 'unsupported'],
    ]) {
      const m = await newPage({ dpr: 2, dark, mock })
      await m.goto(linkUrl(url), { waitUntil: 'domcontentloaded' })
      await waitLinkState(m, [state], 20_000)
      await sleep(900)
      await shot(m, name)
      await m.close()
    }

    // Computer: the same actions as a phone (Escuchar + Archivo).
    const desk = await newPage({ dark })
    await desk.setViewport({ width: 1100, height: 760, deviceScaleFactor: 1 })
    await desk.goto(linkUrl(YT_LINK), { waitUntil: 'domcontentloaded' })
    await waitLinkState(desk, ['ready'], 30_000)
    await sleep(2200)
    await desk.screenshot({ path: path.join(OUT, `share-link-desktop${sfx}.png`) })
    await desk.close()

    // A silent microphone: after ~3 s the quiet hint says what to do.
    const hush = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: chromeArgs(path.join(FIXTURES, 'silence.wav')) })
    try {
      const q = await hush.newPage()
      await q.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      await q.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }])
      await q.goto(linkUrl(YT_LINK), { waitUntil: 'domcontentloaded' })
      await waitLinkState(q, ['ready'], 30_000)
      await sleep(1200)
      await clickByText(q, '.share-link__controls button', 'Escuchar')
      await q.waitForFunction(() => /No llega sonido/.test(document.querySelector('.share-link__nudge')?.textContent ?? ''), { timeout: 10_000 })
      await sleep(600)
      await shot(q, 'link-silent')
    } finally {
      await hush.close()
    }

    // Microphone permission denied: a separate browser that answers every permission prompt with "deny".
    const denying = await puppeteer.launch({
      executablePath: chromePath(),
      headless: true,
      args: [...chromeArgs().filter((a) => a !== '--use-fake-ui-for-media-stream'), '--deny-permission-prompts'],
    })
    try {
      const d = await denying.newPage()
      await d.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      await d.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }])
      await d.goto(linkUrl(YT_LINK), { waitUntil: 'domcontentloaded' })
      await waitLinkState(d, ['ready', 'not-embeddable', 'offline', 'failed'], 30_000)
      await sleep(1500)
      await clickByText(d, '.share-link__controls button', 'Escuchar')
      await d.waitForSelector('.share-link__message p', { visible: true, timeout: 10_000 })
      await sleep(700)
      await shot(d, 'link-denied')
    } finally {
      await denying.close()
    }
    console.log(`screenshots ${dark ? 'dark' : 'light'}: docs/screenshots/share-{home,enlace,link-youtube,link-recording,import,link-noembed,link-short,link-unsupported,link-desktop,link-silent,link-denied}${sfx}.png`)
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
const selfPath = fileURLToPath(import.meta.url)
const isMain = process.platform === 'win32' ? invokedPath.toLowerCase() === selfPath.toLowerCase() : invokedPath === selfPath
if (isMain) await main()
