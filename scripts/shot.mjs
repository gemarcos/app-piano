#!/usr/bin/env node
// Screenshot helper (mobile viewport, headless Chrome).
// Usage: node scripts/shot.mjs <url> <out.png> [--dark] [--width 390] [--height 844] [--wait 800] [--full]
//        [--eval "js to run before the shot"] [--click "css selector"] [--fake-audio path.wav]
// Prints console messages and page errors so you can spot runtime problems.
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome-path.mjs'

const [url, out, ...rest] = process.argv.slice(2)
if (!url || !out) {
  console.error('usage: node scripts/shot.mjs <url> <out.png> [--dark] [--width N] [--height N] [--wait ms] [--full] [--eval js] [--click sel] [--fake-audio wav]')
  process.exit(1)
}

const opts = { dark: false, width: 390, height: 844, wait: 800, full: false, eval: null, click: [], fakeAudio: null }
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]
  if (a === '--dark') opts.dark = true
  else if (a === '--full') opts.full = true
  else if (a === '--width') opts.width = Number(rest[++i])
  else if (a === '--height') opts.height = Number(rest[++i])
  else if (a === '--wait') opts.wait = Number(rest[++i])
  else if (a === '--eval') opts.eval = rest[++i]
  else if (a === '--click') opts.click.push(rest[++i])
  else if (a === '--fake-audio') opts.fakeAudio = rest[++i]
}

const args = [
  '--no-sandbox',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--enable-unsafe-swiftshader',
]
if (opts.fakeAudio) args.push(`--use-file-for-fake-audio-capture=${opts.fakeAudio}`)

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: opts.width, height: opts.height, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: opts.dark ? 'dark' : 'light' }])
  page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`))
  page.on('requestfailed', (r) => console.log(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`))
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 })
  if (opts.eval) await page.evaluate(opts.eval)
  for (const sel of opts.click) {
    await page.waitForSelector(sel, { timeout: 10_000 })
    await page.click(sel)
    await new Promise((r) => setTimeout(r, 400))
  }
  await new Promise((r) => setTimeout(r, opts.wait))
  await page.screenshot({ path: out, fullPage: opts.full })
  console.log(`saved ${out}`)
} finally {
  await browser.close()
}
