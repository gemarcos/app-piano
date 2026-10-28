// Worker side of the piano model (Transkun V2, MIT, via onnxruntime-web): device check, a speed probe that needs no
// download (a short tfjs WebGL workload, calibrated against Transkun on WebGPU), the remembered verdict, the cached
// model files and the transcription itself. Imported only by worker.ts.
import * as tf from '@tensorflow/tfjs'
import type { NoteEvent } from '../../../types'
import type { PianoFallback } from '../protocol'
import { resampleBy } from '../tuning'
import { filesCached, loadFiles, ModelDownloadError, pruneStaleCaches, readCachedJson, writeCachedJson, type ModelFile } from './files'
import type { FrontendSpec } from './frontend'
import { TranskunModel, webgpuAvailable, type TranskunBackend } from './model'

/** Input rate of the transcriber (engine/audio MODEL_SAMPLE_RATE). */
const INPUT_RATE = 22050
/** 'auto' needs at least this many seconds of audio per second of work (predicted by the probe). */
export const MIN_REALTIME_FACTOR = 1
/**
 * Probe calibration, measured in headless Chrome on the reference desktop (RTX 2060, 2026-10-28): the probe takes
 * about PROBE_REF_MS and Transkun on WebGPU runs at about REF_REALTIME x real time (3.0-4.3x on the realistic
 * benchmark, model loaded). Other devices are assumed to scale with their probe time.
 */
export const PROBE_REF_MS = 29
export const REF_REALTIME = 3.5
const VERDICT_FILE = 'device-verdict.json'
const VERDICT_MAX_AGE_MS = 30 * 24 * 3600 * 1000

export interface PianoFiles {
  /** Folder of the model files (ends with '/'). */
  base: string
  /** URL of onnxruntime-web's WebAssembly binary (bundled asset). */
  wasmUrl: string
}

interface Manifest {
  core: { file: string; bytes: number }
  heads: { file: string; bytes: number }
  frontend: { file: string; bytes: number }
  wasmBytes: number
}

interface Verdict {
  renderer: string
  probeMs: number
  realtime: number
  ok: boolean
  at: number
}

export interface PianoTranscription {
  notes: NoteEvent[]
  /** Sustain-pedal spans (symbol -64), seconds of the input. */
  pedal: { start: number; end: number }[]
}

/** Predicted real-time factor of Transkun from a probe time. */
export function predictedRealtime(probeMs: number): number {
  return probeMs > 0 ? (REF_REALTIME * PROBE_REF_MS) / probeMs : Infinity
}

/** A few large matrix products on the tfjs WebGL backend (milliseconds, after one warm-up round). */
async function probe(): Promise<number> {
  const a = tf.randomNormal([512, 512])
  const b = tf.randomNormal([512, 512])
  const round = async () => {
    let x = a
    for (let i = 0; i < 8; i++) {
      const y = tf.matMul(x, b)
      if (x !== a) x.dispose()
      x = y
    }
    await x.data()
    x.dispose()
  }
  try {
    await round()
    const t0 = performance.now()
    await round()
    return performance.now() - t0
  } finally {
    tf.dispose([a, b])
  }
}

function manifestFiles(base: string, m: Manifest, wasmUrl: string): ModelFile[] {
  return [
    { url: new URL(m.core.file, base).href, bytes: m.core.bytes },
    { url: new URL(m.heads.file, base).href, bytes: m.heads.bytes },
    { url: new URL(m.frontend.file, base).href, bytes: m.frontend.bytes },
    { url: wasmUrl, bytes: m.wasmBytes },
  ]
}

export class PianoModel {
  private model: TranskunModel | null = null
  private verdict: Verdict | null = null
  private broken = false
  private manifest: Manifest | null = null
  probeMs: number | null = null

  get ready(): boolean {
    return this.model !== null
  }

  get backend(): TranskunBackend | null {
    return this.model?.backend ?? null
  }

  markBroken() {
    this.broken = true
    void this.model?.release()
    this.model = null
  }

  dispose() {
    void this.model?.release()
    this.model = null
  }

  private async readManifest(base: string): Promise<Manifest> {
    if (this.manifest) return this.manifest
    const url = new URL('manifest.json', base).href
    const cached = await readCachedJson<Manifest>(url)
    if (cached) return (this.manifest = cached)
    let res: Response
    try {
      res = await fetch(url, { cache: 'no-cache' })
    } catch (err) {
      throw new ModelDownloadError('manifest unavailable', true, err)
    }
    if (!res.ok) throw new ModelDownloadError(`manifest: HTTP ${res.status}`, false)
    this.manifest = (await res.json()) as Manifest
    await writeCachedJson(url, this.manifest)
    return this.manifest
  }

  /** True when the model and the runtime are cached (preload may warm it up without network). */
  async cached(files: PianoFiles): Promise<boolean> {
    void pruneStaleCaches()
    const m = await readCachedJson<Manifest>(new URL('manifest.json', files.base).href)
    return m ? filesCached(manifestFiles(files.base, m, files.wasmUrl)) : false
  }

  /**
   * Makes the piano model ready, or says why it cannot run. Both modes need WebGPU: on WebAssembly alone Transkun
   * runs at about 0.27x real time on a desktop CPU (77 s for 21 s of audio), too slow to offer. 'auto' also needs a
   * predicted speed of at least MIN_REALTIME_FACTOR (tfjs probe, remembered per GPU); 'piano' skips the probe.
   * Downloads happen only after those checks; `onProgress` reports bytes (0..1).
   */
  async prepare(mode: 'auto' | 'piano', files: PianoFiles, renderer: string | undefined, onProgress?: (fraction: number) => void): Promise<PianoFallback | null> {
    if (this.model) return null
    void pruneStaleCaches()
    if (!(await webgpuAvailable())) return 'no-webgpu'
    if (mode === 'auto') {
      if (this.broken) return 'run-failed'
      if (tf.getBackend() !== 'webgl') return 'no-webgl2'
      const verdictUrl = new URL(VERDICT_FILE, files.base).href
      const known = this.verdict ?? (await readCachedJson<Verdict>(verdictUrl))
      if (known && known.renderer === (renderer ?? '') && Date.now() - known.at < VERDICT_MAX_AGE_MS) this.verdict = known
      else {
        const ms = await probe()
        this.probeMs = ms
        const realtime = predictedRealtime(ms)
        this.verdict = { renderer: renderer ?? '', probeMs: Math.round(ms * 10) / 10, realtime: Math.round(realtime * 10) / 10, ok: realtime >= MIN_REALTIME_FACTOR, at: Date.now() }
        void writeCachedJson(verdictUrl, this.verdict)
        console.info(`[Pauta] piano model probe: ${this.verdict.probeMs} ms (predicted ${this.verdict.realtime}x real time)`)
      }
      if (!this.verdict.ok) return 'slow'
    }
    let buffers: ArrayBuffer[]
    let manifest: Manifest
    try {
      manifest = await this.readManifest(files.base)
      buffers = await loadFiles(manifestFiles(files.base, manifest, files.wasmUrl), onProgress)
    } catch (err) {
      console.warn('[Pauta] piano model files unavailable', err)
      return err instanceof ModelDownloadError && err.offline ? 'offline' : 'load-failed'
    }
    const [core, heads, frontend, wasm] = buffers
    const spec = JSON.parse(new TextDecoder().decode(frontend)) as FrontendSpec
    try {
      this.model = await TranskunModel.create({ core, heads, frontend: spec, wasm }, 'webgpu')
      return null
    } catch (err) {
      console.warn('[Pauta] piano model: WebGPU session failed', err)
      return 'load-failed'
    }
  }

  /**
   * Transcribes INPUT_RATE mono samples. `tuningCents` is compensated in the same resampling pass that brings the
   * audio to the model's 44.1 kHz; times come back in seconds of `samples`. Durations are key-held times.
   */
  async transcribe(samples: Float32Array, tuningCents: number, minDuration: number, onProgress: (fraction: number) => void, onStep?: () => void): Promise<PianoTranscription> {
    const model = this.model
    if (!model) throw new Error('piano model not ready')
    const timeScale = 2 ** (-tuningCents / 1200)
    const input = resampleBy(samples, (INPUT_RATE / model.sampleRate) * timeScale)
    const { events, segments, profile } = await model.transcribe(input, onProgress, onStep)
    const ms = (v: number) => Math.round(v)
    console.info(`[Pauta] piano model: ${segments} segments on ${model.backend}; features ${ms(profile.features)} ms, network ${ms(profile.core)} + ${ms(profile.readback)} ms, decoding ${ms(profile.viterbi)} ms, heads ${ms(profile.heads)} ms`)
    const round3 = (v: number) => Math.round(v * 1000) / 1000
    const notes: NoteEvent[] = []
    const pedal: { start: number; end: number }[] = []
    for (const e of events) {
      const start = Math.max(0, round3(e.start * timeScale))
      const end = round3(e.end * timeScale)
      if (e.symbol === -64) {
        if (end > start) pedal.push({ start, end })
        continue
      }
      if (e.symbol < 21 || e.symbol > 108) continue
      const duration = Math.max(0.001, round3(end - start))
      if (duration + 1e-9 < minDuration) continue
      notes.push({ pitch: e.symbol, start, duration, velocity: Math.round(Math.min(1, Math.max(0.15, e.velocity / 127)) * 1000) / 1000 })
    }
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
    pedal.sort((a, b) => a.start - b.start)
    return { notes, pedal }
  }
}
