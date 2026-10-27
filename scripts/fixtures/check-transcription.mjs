#!/usr/bin/env node
// Runs every fixture through the real pipeline (decodeMediaFile -> toModelInput -> transcribe worker)
// in headless Chrome and prints precision / recall / F1 (exact pitch, onset within 60 ms), runtime and backend.
//
// Usage: node scripts/fixtures/check-transcription.mjs [options]
//   --url <http://localhost:5182>  use a running dev server (default: start one in-process)
//   --sensitivity <0.5>  --min-note-ms <90>   transcription options
//   --gpu               let headless Chrome use the real GPU (default: SwiftShader software WebGL)
//   --backend cpu       force the tfjs CPU backend
//   --sweep             grid-search decoder thresholds on cached activations
//   --sweep-sensitivity F1 of the shipped sensitivity mapping at 0, 0.1 … 1
//   --perf <seconds>    time a long transcription (tiled melody-bass.wav)
//   --mic               record test/fixtures/scale.wav through Chrome's fake microphone (startRecording),
//                       then decode + transcribe the take; also checks cancel() and tab-capture errors
//   --verbose           list missed / extra notes and page logs
// Exits with 1 when scale.wav F1 < 0.9. Regenerate fixtures with scripts/fixtures/make-fixtures.sh.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FIXTURES = ['scale.wav', 'chords.wav', 'melody-bass.wav', 'scale.mp4', 'chords-room.wav', 'melody-bass-room.wav', 'silence.wav']
const CALIBRATION = ['scale.wav', 'chords.wav', 'melody-bass.wav', 'chords-room.wav', 'melody-bass-room.wav']

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const opts = {
  url: option('--url', null),
  sensitivity: Number(option('--sensitivity', 0.5)),
  minNoteMs: Number(option('--min-note-ms', 90)),
  backend: option('--backend', undefined),
  gpu: flag('--gpu'),
  sweep: flag('--sweep'),
  sweepSensitivity: flag('--sweep-sensitivity'),
  perf: option('--perf', null),
  mic: flag('--mic'),
  verbose: flag('--verbose'),
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (v) => (v * 100).toFixed(0).padStart(4) + '%'
const fmt = (v, d = 2) => Number(v).toFixed(d)
const short = (f) => f.replace(/\.wav$/, '')

let server = null
let baseUrl = opts.url
if (!baseUrl) {
  const { createServer } = await import('vite')
  server = await createServer({ root: ROOT, logLevel: 'warn', server: { host: '127.0.0.1', port: 5182, strictPort: false } })
  await server.listen()
  baseUrl = server.resolvedUrls.local[0].replace(/\/$/, '')
}

const chromeArgs = [
  '--no-sandbox',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--enable-unsafe-swiftshader',
]
if (opts.gpu) chromeArgs.push('--enable-gpu', '--use-angle=vulkan')
if (opts.mic) chromeArgs.push(`--use-file-for-fake-audio-capture=${path.join(ROOT, 'test/fixtures/scale.wav')}`)
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 900_000, args: chromeArgs })

let exitCode = 0
try {
  const page = await browser.newPage()
  page.on('console', (m) => {
    const text = m.text()
    if (opts.verbose ? !text.startsWith('[vite]') : /backend|error|fail/i.test(text)) console.log(`  [page ${m.type()}] ${text}`)
  })
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`))
  await page.goto(`${baseUrl}/test/harness/transcribe.html`, { waitUntil: 'load', timeout: 120_000 })

  // Vite may reload the page once while it optimizes tfjs on first use: retry on lost contexts.
  const call = async (fn, ...fnArgs) => {
    for (let attempt = 0; ; attempt++) {
      try {
        await page.waitForFunction(() => window.__ready === true, { timeout: 120_000 })
        return await page.evaluate(fn, ...fnArgs)
      } catch (err) {
        if (attempt < 4 && /context was destroyed|navigat|Target closed|detached/i.test(String(err))) {
          await sleep(2000)
          continue
        }
        throw err
      }
    }
  }

  const runOpts = { sensitivity: opts.sensitivity, minNoteMs: opts.minNoteMs, backend: opts.backend }
  console.log(`\nTranscription check  (sensitivity ${opts.sensitivity}, minNoteMs ${opts.minNoteMs}, ${baseUrl})\n`)
  console.log('fixture               kind   dur(s)  notes truth   prec  recall    F1  bias(ms)  load+infer+notes ms (total)')
  const results = {}
  for (const fixture of FIXTURES) {
    const r = await call((f, o) => window.__run(f, o), fixture, runOpts)
    results[fixture] = r
    const m = r.metrics
    const t = r.timings
    console.log(
      [
        fixture.padEnd(21),
        r.kind.padEnd(5),
        fmt(r.duration).padStart(7),
        String(r.notes.length).padStart(6),
        String(m ? m.truth : '-').padStart(5),
        m ? pct(m.precision).padStart(7) : '      -',
        m ? pct(m.recall).padStart(7) : '      -',
        m ? fmt(m.f1).padStart(6) : '     -',
        m ? fmt(m.onsetBiasMs, 0).padStart(8) : '       -',
        `  ${t.loadMs}+${t.inferenceMs}+${t.notesMs} (${t.transcribeMs})`,
      ].join(' '),
    )
    if (opts.verbose && m) {
      if (m.falseNegatives.length) console.log('    missed:', m.falseNegatives.map((n) => `${n.pitch}@${fmt(n.start)}`).join(' '))
      if (m.falsePositives.length) console.log('    extra: ', m.falsePositives.map((n) => `${n.pitch}@${fmt(n.start)}`).join(' '))
    }
    if (!r.progressMonotonic) console.log('    WARNING: progress went backwards')
  }

  const first = results['scale.wav']
  const scale = first?.metrics
  const video = results['scale.mp4']
  console.log('')
  console.log(`backend: ${first?.backend}${first?.renderer ? ` (${first.renderer})` : ''}`)
  console.log(
    `scale.mp4 decodes: ${video && video.kind === 'video' && Math.abs(video.duration - first.duration) < 0.1 ? 'yes' : 'NO'} ` +
      `(kind ${video?.kind}, ${fmt(video?.duration ?? 0)} s, ${video?.channels} ch @ ${video?.sampleRate} Hz, F1 ${fmt(video?.metrics?.f1 ?? 0)})`,
  )
  console.log(`silence.wav notes: ${results['silence.wav']?.notes.length}`)
  const stages = first?.stages
  if (stages) console.log('progress stages (first..last):', Object.entries(stages).map(([k, [a, b]]) => `${k} ${fmt(a)}..${fmt(b)}`).join(', '))
  if (!scale || scale.f1 < 0.9) {
    console.log(`\nFAIL: scale.wav F1 ${scale ? fmt(scale.f1) : '?'} < 0.90`)
    exitCode = 1
  } else {
    console.log(`\nOK: scale.wav F1 ${fmt(scale.f1)} >= 0.90`)
  }

  if (opts.perf) {
    const seconds = Number(opts.perf)
    const p = await call((f, s, o) => window.__perf(f, s, o), 'melody-bass.wav', seconds, runOpts)
    console.log(
      `\nperf: ${seconds} s of audio -> ${p.notes} notes, ${p.backend}, total ${p.transcribeMs} ms ` +
        `(load ${p.loadMs}, inference ${p.inferenceMs}, notes ${p.decodeMs}) = ${fmt(seconds / (p.transcribeMs / 1000), 1)}x real time`,
    )
  }

  if (opts.mic) {
    const support = await call(() => window.__support())
    const take = await call((s) => window.__record('mic', s), 6.5)
    const scalePitches = [60, 62, 64, 65, 67, 69, 71, 72]
    const found = scalePitches.filter((p) => take.pitches.includes(p))
    console.log(`\nmic: supported ${support.mic}, tab capture supported ${support.tab}`)
    console.log(
      `mic take: ${take.blobType}, ${(take.blobBytes / 1024).toFixed(0)} KiB, kind ${take.kind}, ${fmt(take.duration)} s ` +
        `(auto-stop ${take.autoStopped}, ${take.elapsedMs} ms), level callbacks ${take.levelCount} (~${take.levelRateHz} Hz, ` +
        `max ${fmt(take.levelMax)}, mean ${fmt(take.levelMean)})`,
    )
    console.log(`mic take notes: ${take.pitches.length} [${take.pitches.join(' ')}], scale pitches found ${found.length}/8`)
    console.log(`cancel() then stop(): ${await call(() => window.__recordCancel())}`)
    const tab = await call(() => window.__tabCapture())
    console.log(`tab capture: ${tab.ok ? `recorded ${tab.blobType}, ${tab.blobBytes} bytes` : `${tab.name}: ${tab.message}`}`)
  }

  const show = (row) =>
    (row.params.sensitivity !== undefined ? `s ${fmt(row.params.sensitivity, 1)}  ` : '') +
    `onset ${fmt(row.params.onsetThreshold)} frame ${fmt(row.params.frameThreshold)} mel ${row.params.melodiaTrick ? 'y' : 'n'} tol ${String(row.params.energyTolerance).padStart(2)} | ` +
    CALIBRATION.map((f) => `${short(f)} ${fmt(row.f1[f])}`).join('  ') +
    ` | mean ${fmt(row.meanF1, 3)}`

  if (opts.sweepSensitivity) {
    const grid = { sensitivity: Array.from({ length: 11 }, (_, i) => i / 10), onset: [], frame: [], minNoteMs: [opts.minNoteMs] }
    const rows = await call((f, g) => window.__sweep(f, g), CALIBRATION, grid)
    console.log('\nF1 of the shipped sensitivity mapping:')
    rows.forEach((row) => console.log('  ' + show(row)))
  }

  if (opts.sweep) {
    const range = (a, b, step) => Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => +(a + i * step).toFixed(3))
    const grid = {
      onset: range(0.3, 0.9, 0.05),
      frame: range(0.1, 0.45, 0.05),
      melodia: [true, false],
      energyTolerance: [11],
      minNoteMs: [opts.minNoteMs],
    }
    const rows = await call((f, g) => window.__sweep(f, g), CALIBRATION, grid)
    rows.sort((a, b) => b.meanF1 - a.meanF1)
    console.log(`\nsweep: ${rows.length} combinations, best 15 by mean F1`)
    rows.slice(0, 15).forEach((row) => console.log('  ' + show(row)))
    for (const f of CALIBRATION) {
      const best = [...rows].sort((a, b) => b.f1[f] - a.f1[f])[0]
      console.log(`best for ${short(f).padEnd(16)} ${show(best)}`)
    }
  }
} finally {
  await browser.close()
  if (server) await server.close()
}
process.exit(exitCode)
