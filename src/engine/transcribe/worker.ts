// Basic Pitch inference worker. The ONLY module that imports tfjs / basic-pitch (keeps the main bundle lean).
// One long-lived instance keeps the model loaded; jobs run one at a time.
import * as tf from '@tensorflow/tfjs'
import { BasicPitch } from '@spotify/basic-pitch'
import type { RawActivations, TranscriberBackend, WorkerRequest, WorkerResponse } from './protocol'
import { decoderParams } from './params'
import { decodeNotes } from './decode'

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
}

const scope = self as unknown as WorkerScope

const MODEL_ERROR = 'No se pudo cargar el modelo de transcripción.'
const RUN_ERROR = 'No se pudo transcribir el audio.'
/** Samples per model window (2 s at 22 050 Hz minus one hop). */
const MODEL_WINDOW = 43844
/** Shorter inputs (< ~0.1 s) cannot contain a note. */
const MIN_SAMPLES = 2048
const OUTPUTS = ['Identity_1', 'Identity_2', 'Identity'] // frames, onsets, contours

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
        // Half-float GPUs lose too much precision in the CQT front end.
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
        if (!backend) {
          backend = await selectBackend(prefer !== 'cpu')
          console.info(`[Pauta] Basic Pitch backend: ${backend}${renderer ? ` (${renderer})` : ''}`)
        }
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
  backend = await selectBackend(false)
  console.info(`[Pauta] Basic Pitch backend: ${backend} (fallback)`)
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

async function runTranscription(req: Extract<WorkerRequest, { type: 'transcribe' }>) {
  const { id, samples, opts } = req
  let lastFraction = 0
  const progress = (fraction: number, stage: 'loading-model' | 'analyzing' | 'extracting-notes') => {
    lastFraction = Math.max(lastFraction, Math.min(1, fraction))
    post({ type: 'progress', id, fraction: lastFraction, stage })
  }

  const t0 = performance.now()
  progress(0, 'loading-model')
  let model = await loadModel(req.modelUrl, (fraction) => progress(0.08 * fraction, 'loading-model'), req.backend)
  const t1 = performance.now()
  progress(0.1, 'analyzing')

  let activations: Activations = { frames: [], onsets: [] }
  if (samples.length >= MIN_SAMPLES) {
    const onProgress = (p: number) => progress(0.1 + 0.8 * p, 'analyzing')
    try {
      activations = await infer(model, samples, onProgress)
    } catch (err) {
      if (backend !== 'webgl') throw err
      // GPU trouble (context loss, texture limits): retry once on the CPU.
      console.warn('[Pauta] WebGL inference failed, retrying on CPU', err)
      model = await fallBackToCpu(req.modelUrl)
      activations = await infer(model, samples, onProgress)
    }
  }
  const t2 = performance.now()
  progress(0.9, 'extracting-notes')

  const { frames, onsets } = activations
  const raw: RawActivations | undefined = req.debugRaw
    ? { nFrames: frames.length, frames: flatten(frames), onsets: flatten(onsets) }
    : undefined

  const notes = decodeNotes(frames, onsets, decoderParams(opts))
  const t3 = performance.now()
  progress(1, 'extracting-notes')

  post(
    {
      type: 'result',
      id,
      notes,
      backend: backend ?? 'cpu',
      renderer,
      timings: { loadMs: Math.round(t1 - t0), inferenceMs: Math.round(t2 - t1), decodeMs: Math.round(t3 - t2) },
      raw,
    },
    raw ? [raw.frames.buffer, raw.onsets.buffer] : [],
  )
}

async function handle(req: WorkerRequest) {
  try {
    if (req.type === 'preload') {
      await loadModel(req.modelUrl, undefined, req.backend)
      post({ type: 'ready', id: req.id, backend: backend ?? 'cpu', renderer })
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
