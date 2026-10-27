// Browser harness for the audio + transcription pipeline (served by the Vite dev server).
// Open /test/harness/transcribe.html?fixture=scale.wav (results on window.__result), or drive it with
// scripts/fixtures/check-transcription.mjs through window.__run / __sweep / __perf / __raw.
// Test-only: it imports the decoder (basic-pitch) on the page for offline sweeps; the app never does.
import {
  decodeMediaFile,
  isMicSupported,
  isTabCaptureSupported,
  MODEL_SAMPLE_RATE,
  startRecording,
  toModelInput,
  type CaptureMode,
} from '../../src/engine/audio'
import { startTranscription, type TranscribeDetails, type TranscriberBackend, type TranscribeStage } from '../../src/engine/transcribe'
import type { RawActivations } from '../../src/engine/transcribe/protocol'
import { decodeNotes } from '../../src/engine/transcribe/decode'
import { decoderParams, type DecoderParams } from '../../src/engine/transcribe/params'
import type { NoteEvent } from '../../src/types'
import { evaluateDetailed, evaluateNotes, type DetailedMetrics, type Metrics, type TruthNote } from './metrics'

const FIXTURES = '/test/fixtures/'

export interface RunOptions {
  sensitivity?: number
  minNoteMs?: number
  /** Keep the raw activations in the page (for __sweep). */
  raw?: boolean
  /** Backend for the first model load of the worker (later runs reuse it). */
  backend?: TranscriberBackend
  /** Onset tolerance in seconds (default 0.06; the realistic benchmark under real/ uses 0.05). */
  tolerance?: number
  /** Tuning compensation: 'auto' (default, as shipped), 'off', or a forced correction in cents. */
  tuning?: 'auto' | 'off' | number
}

export interface RunResult {
  fixture: string
  kind: 'audio' | 'video'
  mime: string
  duration: number
  sampleRate: number
  channels: number
  modelSamples: number
  modelPeak: number
  notes: NoteEvent[]
  backend: string
  renderer?: string
  timings: { fetchMs: number; decodeMs: number; resampleMs: number; transcribeMs: number; loadMs: number; inferenceMs: number; notesMs: number }
  stages: Partial<Record<TranscribeStage, [number, number]>>
  progressMonotonic: boolean
  metrics: Metrics | null
  /** Error breakdown (realistic benchmark only). */
  detailed?: DetailedMetrics
  /** Ground-truth metadata of the realistic benchmark. */
  info?: { condition?: string; transpose?: number; residualCents?: number; description?: string }
  tuning?: { cents: number; confidence: number; applied: number }
}

interface Truth {
  name: string
  bpm: number
  notes: TruthNote[]
  condition?: string
  transpose?: number
  residualCents?: number
  description?: string
}

const rawStore = new Map<string, { raw: RawActivations; frames: number[][]; onsets: number[][] }>()

const scaled = (notes: NoteEvent[], scale: number) =>
  scale === 1 ? notes : notes.map((n) => ({ ...n, start: n.start * scale, duration: n.duration * scale }))
const truthStore = new Map<string, Truth | null>()

function truthName(fixture: string): string {
  return fixture.replace(/\.[^.]+$/, '') + '.json'
}

async function loadTruth(fixture: string): Promise<Truth | null> {
  const key = truthName(fixture)
  if (!truthStore.has(key)) {
    const res = await fetch(FIXTURES + key)
    truthStore.set(key, res.ok && res.headers.get('content-type')?.includes('json') ? ((await res.json()) as Truth) : null)
  }
  return truthStore.get(key) ?? null
}

function toRows(flat: Float32Array, nFrames: number): number[][] {
  const width = nFrames ? flat.length / nFrames : 0
  return Array.from({ length: nFrames }, (_, r) => Array.from(flat.subarray(r * width, (r + 1) * width)))
}

async function prepare(fixture: string) {
  const t0 = performance.now()
  const res = await fetch(FIXTURES + fixture)
  if (!res.ok) throw new Error(`fixture not found: ${fixture}`)
  const blob = await res.blob()
  const t1 = performance.now()
  const media = await decodeMediaFile(blob, fixture)
  const t2 = performance.now()
  const samples = await toModelInput(media.buffer)
  const t3 = performance.now()
  return { media, samples, fetchMs: t1 - t0, decodeMs: t2 - t1, resampleMs: t3 - t2 }
}

async function transcribeSamples(
  samples: Float32Array,
  sensitivity: number,
  minNoteMs: number,
  debugRaw: boolean,
  backend?: TranscriberBackend,
  tuning?: 'auto' | 'off' | number,
) {
  const stages: Partial<Record<TranscribeStage, [number, number]>> = {}
  let last = -1
  let monotonic = true
  let details: TranscribeDetails | null = null
  const t0 = performance.now()
  const job = startTranscription(
    samples,
    { sensitivity, minNoteMs },
    (fraction, stage) => {
      if (fraction < last) monotonic = false
      last = fraction
      const seen = stages[stage]
      stages[stage] = seen ? [seen[0], fraction] : [fraction, fraction]
    },
    { debugRaw, backend, tuning, onDetails: (d) => (details = d) },
  )
  const notes = await job.promise
  const transcribeMs = performance.now() - t0
  return { notes, stages, monotonic, transcribeMs, details: details as TranscribeDetails | null }
}

async function run(fixture: string, options: RunOptions = {}): Promise<RunResult> {
  const sensitivity = options.sensitivity ?? 0.5
  const minNoteMs = options.minNoteMs ?? 90
  const { media, samples, fetchMs, decodeMs, resampleMs } = await prepare(fixture)
  let peak = 0
  for (const v of samples) peak = Math.max(peak, Math.abs(v))
  const t = await transcribeSamples(samples, sensitivity, minNoteMs, Boolean(options.raw), options.backend, options.tuning)
  if (t.details?.raw) {
    const raw = t.details.raw
    rawStore.set(fixture, { raw, frames: toRows(raw.frames, raw.nFrames), onsets: toRows(raw.onsets, raw.nFrames) })
  }
  const truth = await loadTruth(fixture)
  const realBenchmark = fixture.startsWith('real/')
  const tolerance = options.tolerance ?? (realBenchmark ? 0.05 : 0.06)
  const result: RunResult = {
    fixture,
    kind: media.kind,
    mime: media.mime,
    duration: media.duration,
    sampleRate: media.buffer.sampleRate,
    channels: media.buffer.numberOfChannels,
    modelSamples: samples.length,
    modelPeak: peak,
    notes: t.notes,
    backend: t.details?.backend ?? 'unknown',
    renderer: t.details?.renderer,
    timings: {
      fetchMs: Math.round(fetchMs),
      decodeMs: Math.round(decodeMs),
      resampleMs: Math.round(resampleMs),
      transcribeMs: Math.round(t.transcribeMs),
      loadMs: t.details?.timings.loadMs ?? -1,
      inferenceMs: t.details?.timings.inferenceMs ?? -1,
      notesMs: t.details?.timings.decodeMs ?? -1,
    },
    stages: t.stages,
    progressMonotonic: t.monotonic,
    metrics: truth ? evaluateNotes(t.notes, truth.notes, tolerance) : null,
    tuning: t.details?.tuning,
  }
  if (truth && realBenchmark) {
    const detailed = evaluateDetailed(t.notes, truth.notes, tolerance)
    result.detailed = { ...detailed, falsePositives: detailed.falsePositives.slice(0, 40), falseNegatives: detailed.falseNegatives.slice(0, 40) }
    result.info = { condition: truth.condition, transpose: truth.transpose, residualCents: truth.residualCents, description: truth.description }
  }
  return result
}

export interface SweepGrid {
  /** When set, sweeps the shipped sensitivity mapping instead of raw thresholds. */
  sensitivity?: number[]
  onset: number[]
  frame: number[]
  melodia?: boolean[]
  energyTolerance?: number[]
  inferOnsets?: boolean[]
  minNoteMs?: number[]
}

export interface SweepRow {
  params: DecoderParams & { minNoteMs: number; sensitivity?: number }
  /** Duration errors (realistic benchmark only, see metrics.ts). */
  durationErrors?: Record<string, number>
  f1: Record<string, number>
  precision: Record<string, number>
  recall: Record<string, number>
  meanF1: number
}

/** Decodes cached activations with every parameter combination (the model runs once per fixture). */
async function sweep(fixtures: string[], grid: SweepGrid): Promise<SweepRow[]> {
  for (const f of fixtures) if (!rawStore.has(f)) await run(f, { raw: true })
  const truths = await Promise.all(fixtures.map(loadTruth))
  const rows: SweepRow[] = []
  const score = (params: SweepRow['params']) => {
    const row: SweepRow = { params, f1: {}, precision: {}, recall: {}, meanF1: 0 }
    fixtures.forEach((f, i) => {
      const cached = rawStore.get(f)!
      const notes = scaled(decodeNotes(cached.frames, cached.onsets, params), cached.raw.timeScale ?? 1)
      const m = evaluateNotes(notes, truths[i]?.notes ?? [], f.startsWith('real/') ? 0.05 : 0.06)
      if (f.startsWith('real/')) (row.durationErrors ??= {})[f] = evaluateDetailed(notes, truths[i]?.notes ?? []).breakdown.durationErrors
      row.f1[f] = m.f1
      row.precision[f] = m.precision
      row.recall[f] = m.recall
    })
    row.meanF1 = fixtures.reduce((sum, f) => sum + row.f1[f], 0) / fixtures.length
    rows.push(row)
  }
  if (grid.sensitivity) {
    for (const sensitivity of grid.sensitivity)
      for (const minNoteMs of grid.minNoteMs ?? [90]) score({ ...decoderParams({ sensitivity, minNoteMs }), minNoteMs, sensitivity })
    return rows
  }
  for (const onsetThreshold of grid.onset)
    for (const frameThreshold of grid.frame)
      for (const melodiaTrick of grid.melodia ?? [true])
        for (const energyTolerance of grid.energyTolerance ?? [11])
          for (const inferOnsets of grid.inferOnsets ?? [true])
            for (const minNoteMs of grid.minNoteMs ?? [90]) {
              const base = decoderParams({ sensitivity: 0.5, minNoteMs })
              score({ ...base, onsetThreshold, frameThreshold, melodiaTrick, energyTolerance, inferOnsets, minNoteMs })
            }
  return rows
}

/** Cached activations of a fixture run with { raw: true }, as base64 Float32 rows [frames x 88] (calibration dumps). */
function rawDump(fixture: string) {
  const cached = rawStore.get(fixture)
  if (!cached) return null
  const b64 = (a: Float32Array) => {
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  }
  return { nFrames: cached.raw.nFrames, frames: b64(cached.raw.frames), onsets: b64(cached.raw.onsets) }
}

/** Times a transcription of `seconds` of audio built by tiling a fixture. */
async function perf(fixture: string, seconds: number, options: RunOptions = {}) {
  const { samples } = await prepare(fixture)
  const total = Math.round(seconds * MODEL_SAMPLE_RATE)
  const tiled = new Float32Array(total)
  for (let i = 0; i < total; i += samples.length) tiled.set(samples.subarray(0, Math.min(samples.length, total - i)), i)
  const t = await transcribeSamples(tiled, options.sensitivity ?? 0.5, options.minNoteMs ?? 90, false, options.backend)
  return {
    seconds,
    notes: t.notes.length,
    backend: t.details?.backend,
    renderer: t.details?.renderer,
    transcribeMs: Math.round(t.transcribeMs),
    ...t.details?.timings,
    progressMonotonic: t.monotonic,
  }
}

/** Records `seconds` (auto-stop) from the (fake) microphone, then decodes and transcribes the recording. */
async function record(mode: CaptureMode, seconds: number) {
  const levels: number[] = []
  let autoStopped = false
  let autoStop: () => void = () => {}
  const autoStopFired = new Promise<void>((resolve) => (autoStop = resolve))
  const t0 = performance.now()
  const handle = await startRecording({
    mode,
    maxSeconds: seconds,
    onLevel: (level) => levels.push(level),
    onAutoStop: () => {
      autoStopped = true
      autoStop()
    },
  })
  await autoStopFired
  const blob = await handle.stop()
  const elapsed = performance.now() - t0
  const media = await decodeMediaFile(blob)
  const samples = await toModelInput(media.buffer)
  const notes = await startTranscription(samples, { sensitivity: 0.5, minNoteMs: 90 }).promise
  return {
    blobType: blob.type,
    blobBytes: blob.size,
    kind: media.kind,
    name: media.name,
    duration: media.duration,
    elapsedMs: Math.round(elapsed),
    autoStopped,
    levelCount: levels.length,
    levelRateHz: Math.round(levels.length / (elapsed / 1000)),
    levelMax: Math.max(0, ...levels),
    levelMean: levels.reduce((a, b) => a + b, 0) / Math.max(1, levels.length),
    pitches: notes.map((n) => n.pitch),
  }
}

/** cancel() discards the take: a later stop() must reject with AbortError. */
async function recordCancel() {
  const handle = await startRecording({ mode: 'mic' })
  await new Promise((r) => setTimeout(r, 500))
  handle.cancel()
  try {
    await handle.stop()
    return 'resolved'
  } catch (err) {
    return (err as Error).name
  }
}

/** Starts a tab capture, records ~1 s and stops (headless Chrome auto-accepts the picker). */
async function tabCapture() {
  try {
    const handle = await startRecording({ mode: 'tab' })
    await new Promise((r) => setTimeout(r, 1000))
    const blob = await handle.stop()
    return { ok: true, blobType: blob.type, blobBytes: blob.size }
  } catch (err) {
    return { ok: false, name: (err as Error).name, message: (err as Error).message }
  }
}

declare global {
  interface Window {
    __record?: typeof record
    __recordCancel?: typeof recordCancel
    __tabCapture?: typeof tabCapture
    __support?: () => { mic: boolean; tab: boolean }
    __ready?: boolean
    __result?: RunResult
    __error?: string
    __run?: typeof run
    __sweep?: typeof sweep
    __perf?: typeof perf
    __raw?: typeof rawDump
  }
}

window.__run = run
window.__sweep = sweep
window.__perf = perf
window.__raw = rawDump
window.__record = record
window.__recordCancel = recordCancel
window.__tabCapture = tabCapture
window.__support = () => ({ mic: isMicSupported(), tab: isTabCaptureSupported() })

const out = document.getElementById('out')
const params = new URLSearchParams(location.search)
const fixture = params.get('fixture')
if (fixture) {
  const backend = params.get('backend') === 'cpu' ? 'cpu' : undefined
  run(fixture, { sensitivity: Number(params.get('sensitivity') ?? 0.5), minNoteMs: Number(params.get('minNoteMs') ?? 90), backend })
    .then((result) => {
      window.__result = result
      const m = result.metrics
      if (out) {
        out.textContent = [
          `${result.fixture} (${result.kind}, ${result.duration.toFixed(2)} s)`,
          `backend ${result.backend}, ${result.timings.transcribeMs} ms`,
          `${result.notes.length} notes` + (m ? `, P ${m.precision.toFixed(2)} R ${m.recall.toFixed(2)} F1 ${m.f1.toFixed(2)}` : ''),
        ].join('\n')
      }
    })
    .catch((err: Error) => {
      window.__error = err.message
      if (out) out.textContent = `error: ${err.message}`
    })
} else if (out) {
  out.textContent = 'ready'
}
window.__ready = true
