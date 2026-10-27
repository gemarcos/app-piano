#!/usr/bin/env node
// Bundle hygiene proof: a throwaway production build with the project's own vite.config.ts and two inputs,
// the app (index.html) and a probe that imports the audio + transcription engines exactly like the capture
// pipeline does. Checks that the Basic Pitch worker is its own chunk and that tfjs / basic-pitch code appears in
// no other chunk. The probe source and the build output live in a temp folder (never dist/).
// Usage: node scripts/fixtures/check-bundle.mjs [--out <dir>]   (default <os tmpdir>/pauta/bundle-check; exit 1 on failure)
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outArg = process.argv.indexOf('--out')
const WORK = outArg > 0 && process.argv[outArg + 1] ? path.resolve(process.argv[outArg + 1]) : path.join(os.tmpdir(), 'pauta', 'bundle-check')
const OUT = path.join(WORK, 'dist')
mkdirSync(WORK, { recursive: true })

const engine = (name) => {
  const rel = path.relative(WORK, path.join(ROOT, 'src', 'engine', name))
  return (path.isAbsolute(rel) ? rel : rel.startsWith('.') ? rel : `./${rel}`).split(path.sep).join('/')
}
const probe = path.join(WORK, 'probe.ts')
writeFileSync(
  probe,
  `import { computePeaks, decodeMediaFile, encodeWav, startRecording, toModelInput, toMono } from '${engine('audio')}'
import { preloadModel, transcribe } from '${engine('transcribe')}'
export async function probe(file: File) {
  void preloadModel()
  const media = await decodeMediaFile(file)
  const samples = await toModelInput(media.buffer)
  const notes = await transcribe(samples, { sensitivity: 0.5, minNoteMs: 90 }).promise
  return { notes, peaks: computePeaks(media.buffer, 200), wav: encodeWav(await toMono(media.buffer, undefined, 22050), 22050), startRecording }
}
;(window as unknown as { __probe: typeof probe }).__probe = probe
`,
)

const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href)
await build({
  configFile: path.join(ROOT, 'vite.config.ts'),
  root: ROOT,
  publicDir: false,
  logLevel: 'warn',
  build: { outDir: OUT, emptyOutDir: true, rolldownOptions: { input: { app: path.join(ROOT, 'index.html'), probe } } },
})

// Code-level identifiers of tfjs / basic-pitch (credit URLs and the model path string are not code).
const MARKERS = ['WEBGL_RENDER_FLOAT32_CAPABLE', 'WEBGL_VERSION', 'setBackend', 'loadGraphModel', 'evaluateModel', 'Identity_2']
const files = []
const walk = (dir) => readdirSync(dir).forEach((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : files.push(path.join(dir, f))))
walk(OUT)
const rows = files
  .filter((f) => /\.(js|html)$/.test(f))
  .sort()
  .map((f) => {
    const src = readFileSync(f, 'utf8')
    const spawns = /new Worker\(new URL\((?:new URL\()?[`"']([^`"']+)[`"']/.exec(src)?.[1]
    return { name: path.relative(OUT, f).split(path.sep).join('/'), kib: statSync(f).size / 1024, found: MARKERS.filter((m) => src.includes(m)), spawns }
  })
console.log(`\nbuild: ${OUT}\nchunk                                       KiB  tfjs/basic-pitch code`)
for (const r of rows) console.log(r.name.padEnd(40), r.kib.toFixed(1).padStart(8), ' ', r.found.length ? r.found.join(', ') : '-', r.spawns ? `  [spawns ${r.spawns}]` : '')
const workers = rows.filter((r) => /(^|\/)worker-[^/]+\.js$/.test(r.name))
const probeChunk = rows.find((r) => /(^|\/)probe-[^/]+\.js$/.test(r.name))
const checks = [
  ['worker emitted as its own chunk', workers.length === 1],
  ['worker chunk holds tfjs + basic-pitch', workers.length === 1 && workers[0].found.length === MARKERS.length],
  ['no other chunk (app, engine client, PWA) contains tfjs / basic-pitch code', rows.filter((r) => !workers.includes(r)).every((r) => !r.found.length)],
  ['the engine client spawns that worker chunk', Boolean(probeChunk?.spawns && workers[0]?.name.endsWith(probeChunk.spawns))],
]
console.log('')
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
process.exit(checks.every(([, ok]) => ok) ? 0 : 1)
