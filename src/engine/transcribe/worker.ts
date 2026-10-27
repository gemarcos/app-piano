// Transcription worker: the piano model (Onsets and Frames, oaf/) and Basic Pitch, the fast fallback. The ONLY
// module that imports tfjs / basic-pitch (keeps the main bundle lean). One long-lived instance keeps the models
// loaded; jobs run one at a time.
import * as tf from '@tensorflow/tfjs'
import { BasicPitch } from '@spotify/basic-pitch'
import type { NoteEvent, TranscriptionModel } from '../../types'
import type {
  ActiveModel,
  PianoFallback,
  RawActivations,
  TranscriberBackend,
  TranscriptionInfo,
  TuningInfo,
  WorkerRequest,
  WorkerResponse,
} from './protocol'
import { decoderParams, pianoDecoderParams, scaleNoteTimes } from './params'
import { decodeNotes } from './decode'
import { estimateTuning, retune, retuneFactor, tuningCorrection, TUNING_MIN_CONFIDENCE } from './tuning'
import { withVelocities } from './velocity'
import { PianoModel } from './oaf/piano'
import { isModelCached } from './oaf/weights'

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
}

const scope = self as unknown as WorkerScope

const MODEL_ERROR = 'No se pudo cargar el modelo de transcripción.'
const RUN_ERROR = 'No se pudo transcribir el audio.'
/** Basic Pitch input rate. */
const MODEL_SAMPLE_RATE = 22050
/** Samples per model window (2 s at 22 050 Hz minus one hop). */
const MODEL_WINDOW = 43844
/** Shorter inputs (< ~0.1 s) cannot contain a note. */
const MIN_SAMPLES = 2048
const OUTPUTS = ['Identity_1', 'Identity_2', 'Identity'] // frames, onsets, contours
/** Share of the 'loading-model' stage (0..0.1) used by the piano model's download. */
const DOWNLOAD_SHARE = 0.09

interface LoadedModel {
  url: string
  graph: tf.GraphModel
  basicPitch: BasicPitch
}

let backend: TranscriberBackend | null = null
/** WebGL renderer string (diagnostics), when the GPU backend is used. */
let renderer: string | undefined
let loaded: LoadedModel | null = null
let loading: Promise<LoadedModel> | null = null
let queue: Promise<void> = Promise.resolve()
const piano = new PianoModel()

tf.enableProdMode()

// tfjs 3.x PlatformBrowser.setTimeoutCustom evaluates `window`, which throws inside a worker
// (WebGL fence polling then never resolves). Route it to a plain setTimeout.
const platform = tf.env().platform as unknown as { setTimeoutCustom?: (fn: () => void, delay: number) => void } | undefined
if (platform && typeof (globalThis as { window?: unknown }).window === 'undefined') {
  platform.setTimeoutCustom = (fn, delay) => {
    setTimeout(fn, delay)
  }
}

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer)
}

class ModelLoadError extends Error {
  constructor(cause: unknown) {
    super(MODEL_ERROR, { cause })
    this.name = 'ModelLoadError'
  }
}

function webglRenderer(): string | undefined {
  try {
    const gl = (tf.backend() as unknown as { gpgpu?: { gl?: WebGLRenderingContext } }).gpgpu?.gl
    if (!gl) return undefined
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
  } catch {
    return undefined
  }
}

async function selectBackend(preferWebgl: boolean): Promise<TranscriberBackend> {
  renderer = undefined
  if (preferWebgl && typeof OffscreenCanvas !== 'undefined') {
    try {
      if (await tf.setBackend('webgl')) {
        await tf.ready()
        // Half-float GPUs lose too much precision (Basic Pitch's CQT front end, the piano model's LSTM).
        if (tf.env().getBool('WEBGL_RENDER_FLOAT32_CAPABLE')) {
          renderer = webglRenderer()
          return 'webgl'
        }
      }
    } catch {
      /* fall back to cpu */
    }
  }
  await tf.setBackend('cpu')
  await tf.ready()
  return 'cpu'
}

/** Picks the tfjs backend once per worker (both models share it). */
async function ensureBackend(prefer?: TranscriberBackend): Promise<TranscriberBackend> {
  if (!backend) {
    backend = await selectBackend(prefer !== 'cpu')
    console.info(`[Pauta] transcriber backend: ${backend}${renderer ? ` (${renderer})` : ''}`)
  }
  return backend
}

async function warmUp(graph: tf.GraphModel) {
  const input = tf.zeros([1, MODEL_WINDOW, 1])
  const outputs = graph.execute(input, OUTPUTS) as tf.Tensor[]
  try {
    await outputs[0].data()
  } finally {
    tf.dispose([input, ...outputs])
  }
}

/** Listeners for model download progress (0..1) of the load in flight. */
const loadListeners = new Set<(fraction: number) => void>()

function loadModel(url: string, onProgress?: (fraction: number) => void, prefer?: TranscriberBackend): Promise<LoadedModel> {
  if (loaded && loaded.url === url) return Promise.resolve(loaded)
  if (onProgress) loadListeners.add(onProgress)
  if (!loading) {
    loading = (async () => {
      try {
        await ensureBackend(prefer)
        loaded?.graph.dispose()
        loaded = null
        const fetchGraph = () =>
          tf.loadGraphModel(url, { onProgress: (fraction) => loadListeners.forEach((listener) => listener(fraction)) })
        let graph = await fetchGraph()
        try {
          await warmUp(graph)
        } catch (err) {
          if (backend !== 'webgl') throw err
          // The GPU cannot run the model (shader / texture limits): reload it on the CPU (the files are cached by now).
          console.warn('[Pauta] WebGL warm-up failed, using the CPU', err)
          try {
            graph.dispose()
          } catch {
            /* lost context: nothing to free */
          }
          piano.dispose()
          backend = await selectBackend(false)
          graph = await fetchGraph()
          await warmUp(graph)
        }
        loaded = { url, graph, basicPitch: new BasicPitch(Promise.resolve(graph)) }
        return loaded
      } catch (err) {
        throw new ModelLoadError(err)
      }
    })().finally(() => {
      loading = null
      loadListeners.clear()
    })
  }
  return loading
}

async function fallBackToCpu(url: string): Promise<LoadedModel> {
  loaded?.graph.dispose()
  loaded = null
  piano.dispose()
  backend = await selectBackend(false)
  console.info(`[Pauta] transcriber backend: ${backend} (fallback)`)
  return loadModel(url)
}

interface Activations {
  frames: number[][]
  onsets: number[][]
}

async function infer(model: LoadedModel, samples: Float32Array, onProgress: (p: number) => void): Promise<Activations> {
  const frames: number[][] = []
  const onsets: number[][] = []
  // evaluateModel never disposes its intermediate tensors; a scope frees them after each job.
  tf.engine().startScope()
  try {
    await model.basicPitch.evaluateModel(
      samples,
      (f, o) => {
        for (const row of f) frames.push(row)
        for (const row of o) onsets.push(row)
      },
      onProgress,
    )
  } finally {
    tf.engine().endScope()
  }
  return { frames, onsets }
}

function flatten(rows: number[][]): Float32Array {
  const width = rows[0]?.length ?? 0
  const out = new Float32Array(rows.length * width)
  rows.forEach((row, r) => out.set(row, r * width))
  return out
}

type TranscribeRequest = Extract<WorkerRequest, { type: 'transcribe' }>
type Progress = (fraction: number, stage: 'loading-model' | 'analyzing' | 'extracting-notes') => void

interface JobResult {
  notes: NoteEvent[]
  raw?: RawActivations
  loadedAt: number
  inferredAt: number
}

/** Global tuning of the input and the correction to apply (cents), unless the request disables it. */
function measureTuning(req: TranscribeRequest): TuningInfo | undefined {
  if (req.samples.length < MIN_SAMPLES || req.tuning === 'off') return undefined
  const estimate = estimateTuning(req.samples)
  const applied = typeof req.tuning === 'number' ? req.tuning : tuningCorrection(estimate)
  return { cents: estimate.cents, confidence: Math.round(estimate.confidence * 100) / 100, applied }
}

/** Re-posts the latest progress: a chunk can take a while on a slow CPU and the client treats silence as a crash. */
let heartbeat: () => void = () => {}

async function runPiano(req: TranscribeRequest, tuning: TuningInfo | undefined, progress: Progress): Promise<JobResult> {
  const loadedAt = performance.now()
  progress(0.1, 'analyzing')
  let raw: RawActivations | undefined
  const onRaw = req.debugRaw ? (r: RawActivations) => (raw = r) : undefined
  const notes = await piano.transcribe(req.samples, tuning?.applied ?? 0, pianoDecoderParams(req.opts), (p) => progress(0.1 + 0.8 * p, 'analyzing'), onRaw, heartbeat)
  return { notes, raw, loadedAt, inferredAt: performance.now() }
}

async function runBasicPitch(req: TranscribeRequest, tuning: TuningInfo | undefined, progress: Progress): Promise<JobResult & { model: LoadedModel }> {
  const { samples, opts } = req
  let model = await loadModel(req.modelUrl, (fraction) => progress(0.08 * fraction, 'loading-model'), req.backend)
  const loadedAt = performance.now()
  progress(0.1, 'analyzing')

  // Detuned or sped-up audio: move it back onto the semitone grid before inference (see tuning.ts).
  let input = samples
  let timeScale = 1
  if (tuning?.applied) {
    input = retune(samples, tuning.applied)
    timeScale = retuneFactor(tuning.applied)
  }

  let activations: Activations = { frames: [], onsets: [] }
  if (input.length >= MIN_SAMPLES) {
    const onProgress = (p: number) => progress(0.1 + 0.8 * p, 'analyzing')
    try {
      activations = await infer(model, input, onProgress)
    } catch (err) {
      if (backend !== 'webgl') throw err
      // GPU trouble (context loss, texture limits): retry once on the CPU.
      console.warn('[Pauta] WebGL inference failed, retrying on CPU', err)
      model = await fallBackToCpu(req.modelUrl)
      activations = await infer(model, input, onProgress)
    }
  }
  const inferredAt = performance.now()
  progress(0.9, 'extracting-notes')

  const { frames, onsets } = activations
  const raw: RawActivations | undefined = req.debugRaw
    ? { nFrames: frames.length, frames: flatten(frames), onsets: flatten(onsets), timeScale, model: 'fast' }
    : undefined

  // Times back in input seconds, then loudness-based velocities from the (untouched) input samples.
  const decoded = scaleNoteTimes(decodeNotes(frames, onsets, decoderParams(opts)), timeScale)
  const offset = tuning && tuning.confidence >= TUNING_MIN_CONFIDENCE ? tuning.cents : 0
  const notes = withVelocities(decoded, samples, MODEL_SAMPLE_RATE, offset)
  return { notes, raw, loadedAt, inferredAt, model }
}

function memoryInfo() {
  const m = tf.memory() as tf.MemoryInfo & { numBytesInGPUAllocated?: number }
  return { tensors: m.numTensors, bytes: m.numBytes, gpuAllocated: m.numBytesInGPUAllocated }
}

function modelInfo(requested: TranscriptionModel, model: ActiveModel, fallback?: PianoFallback): TranscriptionInfo {
  return { requested, model, backend: backend ?? 'cpu', ...(fallback ? { fallback } : {}) }
}

async function runTranscription(req: TranscribeRequest) {
  const { id } = req
  const requested: TranscriptionModel = req.opts.model ?? 'auto'
  let lastFraction = 0
  const progress: Progress = (fraction, stage) => {
    lastFraction = Math.max(lastFraction, Math.min(1, fraction))
    post({ type: 'progress', id, fraction: lastFraction, stage })
  }

  const t0 = performance.now()
  let stage: 'loading-model' | 'analyzing' | 'extracting-notes' = 'loading-model'
  let lastBeat = 0
  heartbeat = () => {
    const now = performance.now()
    if (now - lastBeat < 2000) return
    lastBeat = now
    post({ type: 'progress', id, fraction: lastFraction, stage })
  }
  const tracked: Progress = (fraction, s) => {
    stage = s
    progress(fraction, s)
  }
  tracked(0, 'loading-model')
  let fallback: PianoFallback | undefined
  let result: JobResult | null = null
  if (requested !== 'fast' && req.samples.length >= MIN_SAMPLES) {
    try {
      await ensureBackend(req.backend)
      const reason = await piano.prepare(requested, req.pianoUrl, renderer, (f) => tracked(DOWNLOAD_SHARE * f, 'loading-model'), heartbeat)
      if (reason) fallback = reason
    } catch (err) {
      console.warn('[Pauta] piano model unavailable', err)
      fallback = 'load-failed'
    }
  }
  const tuning = measureTuning(req)
  if (requested !== 'fast' && !fallback && piano.ready) {
    post({ type: 'model', id, info: modelInfo(requested, 'piano') })
    try {
      result = await runPiano(req, tuning, tracked)
    } catch (err) {
      // Context loss, out of memory...: this job (and later 'auto' jobs) use Basic Pitch.
      console.warn('[Pauta] piano model failed, using Basic Pitch', err)
      piano.markBroken()
      fallback = 'run-failed'
    }
  }
  let ran: ActiveModel = 'piano'
  if (!result) {
    ran = 'fast'
    post({ type: 'model', id, info: modelInfo(requested, 'fast', requested === 'fast' ? undefined : fallback) })
    result = await runBasicPitch(req, tuning, progress)
  }
  progress(0.9, 'extracting-notes')
  const t3 = performance.now()
  progress(1, 'extracting-notes')

  const { notes, raw } = result
  const transfer: Transferable[] = raw ? [raw.frames.buffer, raw.onsets.buffer, ...(raw.velocities ? [raw.velocities.buffer] : [])] : []
  post(
    {
      type: 'result',
      id,
      notes,
      backend: backend ?? 'cpu',
      renderer,
      timings: { loadMs: Math.round(result.loadedAt - t0), inferenceMs: Math.round(result.inferredAt - result.loadedAt), decodeMs: Math.round(t3 - result.inferredAt) },
      raw,
      tuning,
      info: modelInfo(requested, ran, ran === 'fast' && requested !== 'fast' ? fallback : undefined),
      memory: memoryInfo(),
    },
    transfer,
  )
}

/** Preload: the piano model when it is cached and allowed ('auto' / 'piano'), otherwise Basic Pitch. Never downloads the checkpoint. */
async function preload(req: Extract<WorkerRequest, { type: 'preload' }>): Promise<ActiveModel> {
  const requested = req.model ?? 'auto'
  if (requested !== 'fast') {
    await ensureBackend(req.backend)
    if (await isModelCached(req.pianoUrl)) {
      const reason = await piano.prepare(requested, req.pianoUrl, renderer).catch(() => 'load-failed' as const)
      if (!reason) return 'piano'
    }
  }
  await loadModel(req.modelUrl, undefined, req.backend)
  return 'fast'
}

async function handle(req: WorkerRequest) {
  try {
    if (req.type === 'preload') {
      const model = await preload(req)
      post({ type: 'ready', id: req.id, backend: backend ?? 'cpu', renderer, model })
    } else if (req.type === 'transcribe') {
      await runTranscription(req)
    }
  } catch (err) {
    const message = err instanceof ModelLoadError ? MODEL_ERROR : RUN_ERROR
    const cause = err instanceof ModelLoadError ? err.cause : err
    post({ type: 'error', id: req.id, message, detail: cause instanceof Error ? cause.message : String(cause) })
  }
}

scope.onmessage = (event) => {
  const req = event.data
  queue = queue.then(() => handle(req))
}
