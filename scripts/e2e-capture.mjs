#!/usr/bin/env node
// End-to-end check of the capture flow in headless Chrome (owner: capture).
//   a) Home file input <- test/fixtures/scale.wav and scale.mp4 -> Import -> Transcribir -> Processing -> /score/:id
//   b) fake microphone (melody-bass.wav) -> record ~6 s -> stop -> Processing -> /score/:id
//   plus: a too-short take is refused, cancelling Processing returns to Import without saving, a reload on
//   /import goes back to Home, and no console errors appear. Each new item is read back from IndexedDB.
// Usage: node scripts/e2e-capture.mjs [--url http://localhost:5185/] [--preview] [--headful]
//   Without a server answering at --url it starts one on that port with scripts/serve.mjs (dev server, or the
//   production build in dist/ with --preview) and stops it at the end. Exit code 1 when any check fails.
// The flows are also exported (importFlow, micFlow, tooShort, cancelProcessing, readScore...) so that
// scripts/e2e.mjs runs them inside its full-app session; call setBase(url) first.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome-path.mjs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const FIXTURES = path.join(ROOT, 'test', 'fixtures')
const TRANSCRIBE_TIMEOUT = 120_000

const normalizeBase = (url) => url.replace(/#.*$/, '').replace(/\/?$/, '/')
let BASE = 'http://localhost:5185/'
/** Base URL of the app under test (the flows navigate to BASE + '#/…'). */
export function setBase(url) {
  BASE = normalizeBase(url)
}

/** Chrome flags shared by the e2e scripts: fake media devices (the fake mic plays `fakeAudio`), autoplay. */
export function chromeArgs(fakeAudio = path.join(FIXTURES, 'melody-bass.wav')) {
  return [
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${fakeAudio}`,
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
  ]
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A PCM WAV fixture repeated to at least `seconds` (written to the OS temp folder), for slow-enough jobs. */
export function loopWav(fixture, seconds) {
  const src = readFileSync(path.join(FIXTURES, fixture))
  let offset = 12
  let fmt = null
  let data = null
  while (offset + 8 <= src.length) {
    const id = src.toString('ascii', offset, offset + 4)
    const size = src.readUInt32LE(offset + 4)
    if (id === 'fmt ') fmt = src.subarray(offset + 8, offset + 8 + size)
    if (id === 'data') data = src.subarray(offset + 8, offset + 8 + size)
    offset += 8 + size + (size % 2)
  }
  if (!fmt || !data) throw new Error(`${fixture} is not a PCM WAV`)
  const byteRate = fmt.readUInt32LE(8)
  const copies = Math.max(1, Math.ceil((seconds * byteRate) / data.length))
  const body = Buffer.concat(Array.from({ length: copies }, () => data))
  const header = Buffer.alloc(20)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(4 + 8 + fmt.length + 8 + body.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(fmt.length, 16)
  const dataHeader = Buffer.alloc(8)
  dataHeader.write('data', 0, 'ascii')
  dataHeader.writeUInt32LE(body.length, 4)
  const dir = path.join(os.tmpdir(), 'pauta', 'e2e-capture')
  mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `${path.basename(fixture, '.wav')}-${seconds}s.wav`)
  writeFileSync(out, Buffer.concat([header, fmt, dataHeader, body]))
  return out
}

export async function answers(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

/* ---------- page helpers ---------- */

export const hashIs = (page, pattern, timeout = 15_000) =>
  page.waitForFunction((src) => new RegExp(src).test(location.hash), { timeout, polling: 100 }, pattern.source)

export const currentHash = (page) => page.evaluate(() => location.hash)

export async function clickByText(page, selector, text, timeout = 15_000) {
  const handle = await page.waitForFunction(
    (sel, label) => [...document.querySelectorAll(sel)].find((el) => el.textContent?.trim() === label && !el.disabled) ?? null,
    { timeout, polling: 100 },
    selector,
    text,
  )
  await handle.asElement().click()
}

/** Raw IndexedDB read (works against the dev server and the production build alike). */
export function readScore(page, id) {
  return page.evaluate(async (scoreId) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('pauta')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const get = (store, key) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    const count = (store) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).count()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    const doc = scoreId ? await get('scores', scoreId) : null
    const audio = doc?.audioId ? await get('audio', doc.audioId) : null
    const total = await count('scores')
    db.close()
    if (!doc) return { total, doc: null }
    return {
      total,
      doc: {
        title: doc.title,
        source: doc.source,
        sourceKind: doc.sourceKind,
        notes: doc.notes?.length ?? 0,
        durationSec: Math.round(doc.durationSec * 100) / 100,
        key: doc.summary?.key ? `${doc.summary.key.tonic} ${doc.summary.key.mode}` : null,
        bpm: doc.summary?.bpm,
        noteCount: doc.summary?.noteCount,
        coverId: doc.coverId,
        audio: audio ? { mime: audio.mime, bytes: audio.blob?.size ?? 0 } : null,
      },
    }
  }, id)
}

export async function openHome(page) {
  await page.goto(BASE + '#/', { waitUntil: 'networkidle0', timeout: 60_000 })
  await page.waitForSelector('[aria-label="Escuchar"]', { timeout: 15_000 })
}

/** Home file input -> Import -> Transcribir -> Processing -> viewer; returns a summary of the stored item. */
export async function importFlow(page, fixture, expect) {
  await openHome(page)
  const input = await page.waitForSelector('input[type=file]')
  await input.uploadFile(path.join(FIXTURES, fixture))
  await hashIs(page, /^#\/import$/, 20_000)
  const shown = await page.waitForFunction(() => document.querySelector('.cap-import__name')?.textContent ?? null, { timeout: 10_000 })
  const name = await shown.jsonValue()
  if (name !== fixture) throw new Error(`Import shows "${name}" instead of "${fixture}"`)
  if (expect.video && !(await page.$('.cap-import__media--video video'))) throw new Error('no video preview')
  await clickByText(page, 'button', 'Transcribir')
  await hashIs(page, /^#\/processing$/)
  await hashIs(page, /^#\/score\/[^/?]+$/, TRANSCRIBE_TIMEOUT)
  const id = decodeURIComponent((await currentHash(page)).split('/').pop())
  const { doc } = await readScore(page, id)
  if (!doc) throw new Error(`no IndexedDB item ${id}`)
  if (!(doc.notes > 0)) throw new Error('item without notes')
  if (doc.source !== 'file' || doc.sourceKind !== (expect.video ? 'video' : 'audio')) throw new Error(`source ${doc.source}/${doc.sourceKind}`)
  if (doc.title !== fixture.replace(/\.[^.]+$/, '')) throw new Error(`title "${doc.title}"`)
  if (!doc.audio || doc.audio.mime !== 'audio/wav' || doc.audio.bytes < 1000) throw new Error('trimmed audio not stored')
  return `${id.slice(0, 8)}: ${doc.notes} notes, ${doc.key}, ${doc.bpm} ppm, ${doc.durationSec} s, audio ${(doc.audio.bytes / 1024).toFixed(0)} KB`
}

export async function micFlow(page, seconds) {
  await openHome(page)
  await page.click('[aria-label="Escuchar"]')
  await hashIs(page, /^#\/listen\?mode=mic$/)
  await page.waitForSelector('button[aria-label="Detener"]:not([disabled])', { timeout: 15_000 })
  const level = await sampleLevels(page, seconds * 1000)
  const timer = await page.$eval('.cap-record__elapsed', (el) => el.textContent)
  await page.click('button[aria-label="Detener"]')
  await hashIs(page, /^#\/processing$/, 15_000)
  await hashIs(page, /^#\/score\/[^/?]+$/, TRANSCRIBE_TIMEOUT)
  const id = decodeURIComponent((await currentHash(page)).split('/').pop())
  const { doc } = await readScore(page, id)
  if (!doc) throw new Error(`no IndexedDB item ${id}`)
  if (!(doc.notes > 0)) throw new Error('item without notes')
  if (doc.source !== 'mic') throw new Error(`source ${doc.source}`)
  if (!doc.audio || doc.audio.bytes < 1000) throw new Error('recording not stored')
  if (!level.moved) throw new Error('live bars never moved')
  return `${id.slice(0, 8)}: timer ${timer}, ${doc.notes} notes, ${doc.key}, ${doc.bpm} ppm, ${doc.durationSec} s, ${doc.audio.mime} ${(doc.audio.bytes / 1024).toFixed(0)} KB, bars peak ${level.peak}px`
}

/** Watches the live bars while recording: their heights must change with the input. */
async function sampleLevels(page, ms) {
  const start = Date.now()
  let peak = 0
  const seen = new Set()
  while (Date.now() - start < ms) {
    const heights = await page.$$eval('.cap-record__bars .ui-livebars__bar', (bars) => bars.map((b) => Math.round(parseFloat(b.style.height) || 0)))
    const max = Math.max(0, ...heights)
    peak = Math.max(peak, max)
    seen.add(max)
    await sleep(250)
  }
  return { moved: seen.size > 2 && peak > 8, peak }
}

export async function tooShort(page) {
  await openHome(page)
  await page.click('[aria-label="Escuchar"]')
  await page.waitForSelector('button[aria-label="Detener"]:not([disabled])', { timeout: 15_000 })
  await sleep(700)
  await page.click('button[aria-label="Detener"]')
  await page.waitForFunction(() => document.querySelector('.ui-toast')?.textContent?.includes('Grabación demasiado corta'), { timeout: 5000 })
  await page.waitForSelector('button[aria-label="Grabar"]', { timeout: 5000 })
  if ((await currentHash(page)) !== '#/listen?mode=mic') throw new Error('left the record screen')
  // Record again from the idle state, then leave with the close button (the take is discarded).
  await page.click('button[aria-label="Grabar"]')
  await page.waitForSelector('button[aria-label="Detener"]:not([disabled])', { timeout: 15_000 })
  await page.click('button[aria-label="Cerrar"]')
  await hashIs(page, /^#\/$/)
  return 'toast shown, idle state offers "Grabar", close discards the take'
}

export async function cancelProcessing(page) {
  const before = (await readScore(page, null)).total
  await openHome(page)
  const input = await page.waitForSelector('input[type=file]')
  // ~110 s is taken whole and keeps the transcriber busy for a few seconds even on a fast GPU.
  await input.uploadFile(loopWav('melody-bass.wav', 110))
  await hashIs(page, /^#\/import$/, 20_000)
  await clickByText(page, 'button', 'Transcribir')
  await hashIs(page, /^#\/processing$/)
  const cancel = await page.waitForSelector('button[aria-label="Cancelar"]', { timeout: 10_000 })
  await page.waitForFunction(() => /[1-9]\d?\s%/.test(document.querySelector('.cap-proc__percent')?.textContent ?? ''), { timeout: 30_000 })
  await cancel.click()
  await hashIs(page, /^#\/import$/)
  await sleep(1500)
  const after = (await readScore(page, null)).total
  if (after !== before) throw new Error(`items ${before} -> ${after}`)
  // A reload loses the decoded file: Import must send the user Home.
  await page.reload({ waitUntil: 'networkidle0' })
  await hashIs(page, /^#\/$/, 10_000)
  return `no item saved (${after} items), reload on /import -> Home`
}

/* ---------- run (only when executed directly, not when imported by scripts/e2e.mjs) ---------- */

async function main() {
  const argv = process.argv.slice(2)
  const option = (name, fallback) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
  }
  setBase(option('--url', 'http://localhost:5185/'))
  const PREVIEW = argv.includes('--preview')
  const HEADFUL = argv.includes('--headful')
  const PORT = Number(new URL(BASE).port || 80)

  const serve = (cmd) => {
    const args = [path.join(ROOT, 'scripts', 'serve.mjs'), cmd, String(PORT)]
    if (cmd === 'start' && PREVIEW) args.push('--preview')
    execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })
  }

  let started = false
  if (!(await answers(BASE))) {
    serve('start')
    started = true
  }

  const errors = []
  const results = []
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: !HEADFUL, args: chromeArgs() })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[console] ${m.text()}`)
    })
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

    const step = async (name, fn) => {
      const t0 = Date.now()
      try {
        const detail = await fn()
        results.push({ name, ok: true, s: (Date.now() - t0) / 1000, detail })
      } catch (err) {
        results.push({ name, ok: false, s: (Date.now() - t0) / 1000, detail: String(err?.message ?? err).split('\n')[0] })
      }
      process.stdout.write(`${results.at(-1).ok ? 'PASS' : 'FAIL'}  ${name}\n`)
    }

    await step('import scale.wav -> score', () => importFlow(page, 'scale.wav', { video: false }))
    await step('import scale.mp4 (video) -> score', () => importFlow(page, 'scale.mp4', { video: true }))
    await step('fake mic, record 6 s -> score', () => micFlow(page, 6.5))
    await step('too-short take is refused', () => tooShort(page))
    await step('cancel processing, reload on /import', () => cancelProcessing(page))
    await step('no console errors', async () => {
      if (errors.length) throw new Error(`${errors.length}: ${errors.slice(0, 3).join(' | ')}`)
      return 'none'
    })
  } finally {
    await browser.close()
    if (started) serve('stop')
  }

  console.log(`\ncapture e2e  ${BASE}${PREVIEW ? ' (production build)' : ''}`)
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(40)} ${r.s.toFixed(1).padStart(5)} s  ${r.detail}`)
  if (errors.length) console.log('\nconsole errors:\n' + errors.join('\n'))
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
const selfPath = fileURLToPath(import.meta.url)
const isMain = process.platform === 'win32' ? invokedPath.toLowerCase() === selfPath.toLowerCase() : invokedPath === selfPath
if (isMain) await main()
