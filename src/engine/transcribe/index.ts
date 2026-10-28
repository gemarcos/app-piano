// Owner: engine-audio / piano-model. Public API — transcription in a Web Worker: the piano model (Transkun V2 via
// onnxruntime-web, src/engine/transcribe/transkun/) with Basic Pitch as the fast fallback.
// This file must never import tfjs / basic-pitch (only worker.ts does), so the main bundle stays lean.
import type { NoteEvent, TranscriptionModel } from '../../types'
import type { RawActivations, TranscriberBackend, TranscriptionInfo, TuningInfo, WorkerRequest, WorkerResponse } from './protocol'

export type { ActiveModel, PianoFallback, TranscriberBackend, TranscriptionInfo, TuningInfo } from './protocol'
export { sustainNotes } from './sustain'

export interface TranscribeOptions {
  /**
   * 0..1, higher = more notes (maps to onset/frame thresholds, see params.ts). 0.5 is the calibrated default
   * (best F1 on the fixtures); 0 keeps only confident notes, 1 roughly doubles the note count.
   */
  sensitivity: number
  /** Shortest note to keep, milliseconds (90 by default; 60–110 is the sweet spot, the settings slider allows 40–250). */
  minNoteMs: number
  /**
   * Settings.transcriptionModel. 'auto' (default): the piano model when the device can run it (WebGL 2 and a speed
   * probe of at least real time; its ~16 MB checkpoint downloads on first use, then works offline), else Basic Pitch.
   * 'piano' forces the piano model (Basic Pitch only if it fails); 'fast' always uses Basic Pitch.
   */
  model?: TranscriptionModel
}

/** Calibrated defaults (the same values as DEFAULT_SETTINGS.sensitivity / minNoteMs). */
export const DEFAULT_TRANSCRIBE_OPTIONS: Readonly<TranscribeOptions> = { sensitivity: 0.5, minNoteMs: 90 }

export type TranscribeStage = 'loading-model' | 'analyzing' | 'extracting-notes'

export interface TranscribeJob {
  promise: Promise<NoteEvent[]>
  /** Aborts the job (terminates the worker); the promise rejects with an AbortError. */
  cancel(): void
  /**
   * Which model transcribes this job: resolves as soon as the worker has chosen (before inference; a later fallback
   * during inference is reported by getLastTranscriptionInfo() and TranscribeDetails). Never rejects: it stays
   * pending when the job fails or is cancelled before a model was chosen.
   */
  model?: Promise<TranscriptionInfo>
  /**
   * Sustain-pedal spans, {start, end} in seconds of the samples, sorted by start: from the piano model (Transkun's
   * pedal events); [] for Basic Pitch, which has no pedal. Resolves with the notes. Never rejects: it stays pending
   * when the job fails or is cancelled. Pair it with info.durations === 'key' (notes are key-held times).
   */
  pedal?: Promise<PedalSpan[]>
}

export interface PedalSpan {
  start: number
  end: number
}

const START_ERROR = 'No se pudo iniciar la transcripción en este navegador.'
const CRASH_ERROR = 'La transcripción se detuvo de forma inesperada. Inténtalo de nuevo.'

interface PendingJob {
  kind: 'transcribe' | 'preload'
  resolve(value: unknown): void
  reject(error: Error): void
  onProgress?: (fraction: number, stage: TranscribeStage) => void
  /** Test harness hook (raw activations + timings). */
  onDetails?: (details: TranscribeDetails) => void
  onModel?: (info: TranscriptionInfo) => void
  onPedal?: (pedal: PedalSpan[]) => void
}

export interface TranscribeDetails {
  backend: TranscriberBackend
  renderer?: string
  timings: { loadMs: number; inferenceMs: number; decodeMs: number }
  raw?: RawActivations
  /** Tuning offset detected in the input and the correction applied before inference. */
  tuning?: TuningInfo
  /** Model that produced the notes (and why the piano model was skipped, if it was). */
  info?: TranscriptionInfo
  /** Sustain-pedal spans (seconds; [] for Basic Pitch). */
  pedal?: PedalSpan[]
  /** tfjs memory after the job (diagnostics). */
  memory?: { tensors: number; bytes: number; gpuAllocated?: number }
}

let worker: Worker | null = null
let preloadPromise: Promise<void> | null = null
let backend: TranscriberBackend | null = null
let modelReady = false
let lastInfo: TranscriptionInfo | null = null
let nextId = 1
const jobs = new Map<number, PendingJob>()

/** A worker silent for this long while jobs are pending is treated as crashed (stuck GPU read, OOM…). */
const STALL_MS = 90_000
const WATCHDOG_TICK_MS = 5_000
let lastActivity = 0
let lastTick = 0
let watchdog: ReturnType<typeof setInterval> | undefined

function touch() {
  lastActivity = Date.now()
}

function startWatchdog() {
  if (watchdog !== undefined) return
  lastTick = Date.now()
  watchdog = setInterval(() => {
    const now = Date.now()
    // Long gaps between ticks mean the page was frozen or throttled: restart the clock instead of judging.
    if (now - lastTick > 3 * WATCHDOG_TICK_MS) lastActivity = now
    lastTick = now
    if (!jobs.size) stopWatchdog()
    else if (now - lastActivity > STALL_MS) shutdown(namedError('TranscriptionError', CRASH_ERROR))
  }, WATCHDOG_TICK_MS)
}

function stopWatchdog() {
  if (watchdog !== undefined) clearInterval(watchdog)
  watchdog = undefined
}

/** Model URLs resolved against the document (base is './', so worker-relative URLs would break). */
function modelUrl(): string {
  return new URL('models/basic-pitch/model.json', document.baseURI).href
}

/** Folder of the piano model files (public/models/transkun/; lazily downloaded, not precached). */
function pianoUrl(): string {
  return new URL('models/transkun/', document.baseURI).href
}

function namedError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

function abortError(): Error {
  try {
    return new DOMException('Transcripción cancelada.', 'AbortError')
  } catch {
    return namedError('AbortError', 'Transcripción cancelada.')
  }
}

/** Terminates the worker and settles every in-flight job (preloads resolve, transcriptions reject). */
function shutdown(error: Error) {
  const current = worker
  worker = null
  preloadPromise = null
  modelReady = false
  if (current) {
    current.onmessage = null
    current.onerror = null
    current.terminate()
  }
  const pending = [...jobs.values()]
  jobs.clear()
  stopWatchdog()
  for (const job of pending) {
    if (job.kind === 'preload') job.resolve(undefined)
    else job.reject(error)
  }
}

function handleMessage(msg: WorkerResponse) {
  touch()
  const job = jobs.get(msg.id)
  if (msg.type === 'ready') {
    backend = msg.backend
    modelReady = true
  }
  if (!job) return
  switch (msg.type) {
    case 'progress':
      try {
        job.onProgress?.(msg.fraction, msg.stage)
      } catch {
        /* UI callback errors must not break the job */
      }
      break
    case 'ready':
      jobs.delete(msg.id)
      job.resolve(undefined)
      break
    case 'model':
      lastInfo = msg.info
      job.onModel?.(msg.info)
      break
    case 'result':
      backend = msg.backend
      modelReady = true
      lastInfo = msg.info
      jobs.delete(msg.id)
      job.onModel?.(msg.info)
      job.onDetails?.({ backend: msg.backend, renderer: msg.renderer, timings: msg.timings, raw: msg.raw, tuning: msg.tuning, info: msg.info, pedal: msg.pedal, memory: msg.memory })
      job.onPedal?.(msg.pedal)
      job.resolve(msg.notes)
      break
    case 'error':
      jobs.delete(msg.id)
      if (msg.detail) console.warn('[Pauta] transcription error:', msg.detail)
      if (job.kind === 'preload') job.resolve(undefined)
      else job.reject(namedError('TranscriptionError', msg.message))
      break
  }
}

function getWorker(): Worker {
  if (worker) return worker
  const created = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'pauta-transcriber' })
  created.onmessage = (event: MessageEvent<WorkerResponse>) => handleMessage(event.data)
  created.onerror = (event) => {
    event.preventDefault()
    shutdown(namedError('TranscriptionError', modelReady ? CRASH_ERROR : START_ERROR))
  }
  worker = created
  return created
}

function send(id: number, job: PendingJob, request: WorkerRequest) {
  jobs.set(id, job)
  try {
    getWorker().postMessage(request)
    touch()
    startWatchdog()
  } catch {
    jobs.delete(id)
    if (job.kind === 'preload') job.resolve(undefined)
    else job.reject(namedError('TranscriptionError', START_ERROR))
  }
}

/** Internal entry point shared by transcribe() and the test harness. */
export function startTranscription(
  samples: Float32Array,
  opts: TranscribeOptions,
  onProgress?: (fraction: number, stage: TranscribeStage) => void,
  extra?: {
    debugRaw?: boolean
    backend?: TranscriberBackend
    tuning?: 'auto' | 'off' | number
    onDetails?: (details: TranscribeDetails) => void
  },
): TranscribeJob {
  const id = nextId++
  let settled = false
  let chosen: ((info: TranscriptionInfo) => void) | null = null
  const model = new Promise<TranscriptionInfo>((resolve) => (chosen = resolve))
  let pedalDone: ((pedal: PedalSpan[]) => void) | null = null
  const pedal = new Promise<PedalSpan[]>((resolve) => (pedalDone = resolve))
  const promise = new Promise<NoteEvent[]>((resolve, reject) => {
    send(
      id,
      {
        kind: 'transcribe',
        resolve: (value) => {
          settled = true
          resolve(value as NoteEvent[])
        },
        reject: (error) => {
          settled = true
          reject(error)
        },
        onProgress,
        onDetails: extra?.onDetails,
        onModel: (info) => chosen?.(info),
        onPedal: (spans) => pedalDone?.(spans),
      },
      {
        type: 'transcribe',
        id,
        modelUrl: modelUrl(),
        pianoUrl: pianoUrl(),
        samples,
        opts,
        debugRaw: extra?.debugRaw,
        backend: extra?.backend,
        tuning: extra?.tuning,
      },
    )
  })
  return {
    promise,
    model,
    pedal,
    cancel() {
      if (settled || !jobs.has(id)) return
      shutdown(abortError())
    },
  }
}

/**
 * Transcribes mono MODEL_SAMPLE_RATE samples (see engine/audio toModelInput) into note events with the model chosen
 * by opts.model (default 'auto': the piano model when the device can run it, otherwise Basic Pitch).
 * `onProgress` receives monotonic 0..1 overall progress and the current stage:
 * 'loading-model' 0–0.1 (model download/warm-up; instant once preloaded), 'analyzing' 0.1–0.9, 'extracting-notes' 0.9–1.
 * Resolves NoteEvent[] sorted by start (piano range, velocity 0..1); [] when nothing was detected.
 * Rejects with a short Spanish message (`name: 'TranscriptionError'`), or an AbortError after cancel().
 * cancel() terminates the shared worker, so any other job in flight is aborted too (the next call recreates it).
 * The samples are copied to the worker (not transferred): the caller may keep using them.
 */
export function transcribe(
  samples: Float32Array,
  opts: TranscribeOptions,
  onProgress?: (fraction: number, stage: TranscribeStage) => void,
): TranscribeJob {
  return startTranscription(samples, opts, onProgress)
}

/**
 * Warms up the worker and loads a model in the background (call when the Home screen mounts, with
 * Settings.transcriptionModel): the piano model when its checkpoint is already cached (and 'auto' allows it on this
 * device), otherwise Basic Pitch. It never downloads the piano checkpoint (that happens on first use).
 * Idempotent. Never rejects: on failure it resolves and transcribe() reports the error later.
 */
export function preloadModel(model: TranscriptionModel = 'auto'): Promise<void> {
  if (modelReady && worker) return Promise.resolve()
  if (preloadPromise) return preloadPromise
  const id = nextId++
  const promise = new Promise<void>((resolve) => {
    send(id, { kind: 'preload', resolve: () => resolve(), reject: () => resolve() }, { type: 'preload', id, modelUrl: modelUrl(), pianoUrl: pianoUrl(), model })
  })
  preloadPromise = promise
  promise.then(() => {
    if (preloadPromise === promise && !modelReady) preloadPromise = null
  })
  return promise
}

/** Backend used by the worker ('webgl' | 'cpu'), or null before the model has loaded. */
export function getTranscriberBackend(): TranscriberBackend | null {
  return backend
}

/** Model, backend and fallback reason of the latest transcription (null before the first one). */
export function getLastTranscriptionInfo(): TranscriptionInfo | null {
  return lastInfo
}

/** True once the worker has the model loaded and warmed up. */
export function isModelReady(): boolean {
  return modelReady && worker !== null
}

/** Terminates the worker (frees the model memory). It is recreated lazily on the next call. */
export function disposeTranscriber(): void {
  shutdown(abortError())
}
