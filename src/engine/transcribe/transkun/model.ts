/**
 * Transkun V2 piano transcription (Yujia Yan, github.com/Yujia-Yan/Transkun, MIT License, Copyright (c) 2021 Yujia
 * Yan) in the browser for the Pauta app (2026): the backbone + interval scorer and the attribute heads run as ONNX
 * models in onnxruntime-web (WebGPU, or WebAssembly), the front end and the semi-CRF decoding in JS (frontend.ts,
 * decode.ts). This mirrors TransKun.transcribe(): the input is padded by 8 s at both ends, 16 s segments every ~8 s,
 * each segment's Viterbi starts where the previous one left each symbol, events are stitched and overlaps resolved.
 * Worker-only module: it imports onnxruntime-web lazily.
 */
import type * as Ort from 'onnxruntime-web'
import { finishEvents, segmentEvents, stitchSegment, viterbiBackward, type Interval, type TkEvent } from './decode'
import { createFrontend, MELS, segmentFeatures, WINS, type Frontend, type FrontendSpec, type SpectrumCarry } from './frontend'

export type TranskunBackend = 'webgpu' | 'wasm'

export interface TranskunFiles {
  core: ArrayBuffer
  heads: ArrayBuffer
  frontend: FrontendSpec
  /** onnxruntime-web's WebAssembly binary (ort-wasm-simd-threaded.asyncify.wasm), served from our own cache. */
  wasm: ArrayBuffer
}

type OrtModule = typeof Ort

let ortPromise: Promise<OrtModule> | null = null

/** onnxruntime-web (WebGPU build: also runs the WebAssembly backend), loaded on first use. */
export function loadOrt(wasm: ArrayBuffer): Promise<OrtModule> {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-web/webgpu').then((mod) => {
      const ort = mod as unknown as OrtModule
      ort.env.wasm.wasmBinary = wasm
      // No cross-origin isolation in the PWA: a single WebAssembly thread, no proxy worker (we are a worker already).
      ort.env.wasm.numThreads = 1
      ort.env.wasm.proxy = false
      ort.env.logLevel = 'error'
      return ort
    })
    ortPromise.catch(() => (ortPromise = null))
  }
  return ortPromise
}

/** True when this worker can get a WebGPU adapter (not a software fallback adapter). */
export async function webgpuAvailable(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean } } | null> } }).gpu
    if (!gpu) return false
    const adapter = await gpu.requestAdapter()
    return Boolean(adapter) && !(adapter?.isFallbackAdapter || adapter?.info?.isFallbackAdapter)
  } catch {
    return false
  }
}

export interface TranskunResult {
  events: TkEvent[]
  segments: number
  /** Milliseconds per stage, summed over segments (diagnostics). */
  profile: { features: number; core: number; readback: number; viterbi: number; heads: number }
}

export class TranskunModel {
  readonly backend: TranskunBackend
  private ort: OrtModule
  private core: Ort.InferenceSession
  private heads: Ort.InferenceSession
  private fe: Frontend

  private constructor(ort: OrtModule, core: Ort.InferenceSession, heads: Ort.InferenceSession, fe: Frontend, backend: TranskunBackend) {
    this.ort = ort
    this.core = core
    this.heads = heads
    this.fe = fe
    this.backend = backend
  }

  static async create(files: TranskunFiles, backend: TranskunBackend): Promise<TranskunModel> {
    const ort = await loadOrt(files.wasm)
    const options: Ort.InferenceSession.SessionOptions = { executionProviders: [backend], graphOptimizationLevel: 'all' }
    // Keep the outputs on the GPU and download them explicitly (timed separately, released right after).
    if (backend === 'webgpu') options.preferredOutputLocation = { S: 'gpu-buffer', ctx: 'gpu-buffer' }
    const core = await ort.InferenceSession.create(new Uint8Array(files.core), options)
    // The heads are tiny and run on a variable number of intervals: the WebAssembly backend is enough.
    const heads = await ort.InferenceSession.create(new Uint8Array(files.heads), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
    return new TranskunModel(ort, core, heads, createFrontend(files.frontend), backend)
  }

  get sampleRate(): number {
    return this.fe.spec.fs
  }

  async release() {
    await Promise.allSettled([this.core.release(), this.heads.release()])
  }

  /** Dispatches the network on one segment's features (on WebGPU it resolves once the work is queued). */
  private async dispatch(features: Float32Array, profile: TranskunResult['profile']) {
    const T = this.fe.spec.frames
    const input = new this.ort.Tensor('float32', features, [1, T, MELS, WINS])
    const t = performance.now()
    try {
      return await this.core.run({ features: input })
    } finally {
      profile.core += performance.now() - t
      input.dispose?.()
    }
  }

  /** Waits for a dispatched segment and downloads its scores and context. */
  private async download(out: Ort.InferenceSession.OnnxValueMapType, profile: TranskunResult['profile']) {
    const t = performance.now()
    try {
      const S = (await out.S.getData(true)) as Float32Array
      const ctx = (await out.ctx.getData(true)) as Float32Array
      return { S, ctx }
    } finally {
      profile.readback += performance.now() - t
      for (const o of Object.values(out)) o.dispose?.()
    }
  }

  private async runHeads(rowsA: Float32Array, rowsB: Float32Array, n: number) {
    const D = rowsA.length / n
    const a = new this.ort.Tensor('float32', rowsA, [n, D])
    const b = new this.ort.Tensor('float32', rowsB, [n, D])
    const out = await this.heads.run({ a, b })
    const result = { velocity: (out.velocity.data as Float32Array).slice(), of: (out.of.data as Float32Array).slice() }
    for (const t of [a, b, ...Object.values(out)]) t.dispose?.()
    return result
  }

  /**
   * Transcribes mono samples at this.sampleRate (44.1 kHz). Events carry symbols (MIDI 21..108, -64 sustain pedal,
   * -67 soft pedal) and seconds of `x`. `onProgress` gets 0..1 per segment; `onStep` is called between stages.
   */
  async transcribe(x: Float32Array, onProgress?: (fraction: number) => void, onStep?: () => void): Promise<TranskunResult> {
    const { fs, hop, segmentSeconds, hopSeconds, frames: T, symbols } = this.fe.spec
    const padBegin = segmentSeconds - hopSeconds
    const P = Math.ceil(padBegin * fs)
    const n = x.length + 2 * P
    const padded = new Float32Array(n)
    padded.set(x, P)
    const step = Math.ceil((hopSeconds * fs) / hop) * hop
    const size = Math.ceil(segmentSeconds * fs)
    const lastFrameIdx = Math.round(size / hop)
    const frameDur = hop / fs
    let startPos = new Array<number>(symbols.length).fill(Math.floor((padBegin * fs) / hop))
    const byType = new Map<number, TkEvent[]>()
    const total = Math.ceil(n / step)
    const profile = { features: 0, core: 0, readback: 0, viterbi: 0, heads: 0 }
    let carry: SpectrumCarry | undefined
    const features = (k: number) => {
      const t = performance.now()
      const seg = new Float32Array(size)
      seg.set(padded.subarray(k * step, Math.min(k * step + size, n)))
      const res = segmentFeatures(this.fe, seg, carry, step / hop)
      carry = res.carry
      profile.features += performance.now() - t
      return res.features
    }
    // Pipelined: the GPU computes segment k + 1 while this thread decodes segment k and prepares the features of
    // segment k + 2 (the network never depends on the decoding; only each segment's Viterbi start does).
    let out = await this.dispatch(features(0), profile)
    let nextFeatures = total > 1 ? features(1) : null
    for (let k = 0; k < total; k++) {
      onStep?.()
      const { S, ctx } = await this.download(out, profile)
      if (nextFeatures) out = await this.dispatch(nextFeatures, profile)
      nextFeatures = k + 2 < total ? features(k + 2) : null
      const beginTime = (k * step) / fs - padBegin
      const tv = performance.now()
      const paths: Interval[][] = symbols.map((_, s) => viterbiBackward(S, s * T * T, T, startPos[s]))
      const count = paths.reduce((acc, p) => acc + p.length, 0)
      const D = ctx.length / (symbols.length * T)
      const a = new Float32Array(count * D)
      const b = new Float32Array(count * D)
      let r = 0
      paths.forEach((path, s) =>
        path.forEach((iv) => {
          a.set(ctx.subarray((s * T + iv.begin) * D, (s * T + iv.begin + 1) * D), r * D)
          b.set(ctx.subarray((s * T + iv.end) * D, (s * T + iv.end + 1) * D), r * D)
          r++
        }),
      )
      profile.viterbi += performance.now() - tv
      let lastP: number[] = symbols.map(() => 0)
      if (count > 0) {
        const th = performance.now()
        const heads = await this.runHeads(a, b, count)
        profile.heads += performance.now() - th
        const res = segmentEvents(paths, heads, symbols, frameDur, lastFrameIdx)
        for (const e of res.events) {
          e.start = Math.max(e.start + beginTime, 0)
          e.end = Math.max(e.end + beginTime, e.start)
        }
        stitchSegment(byType, res.events)
        lastP = res.lastP
      }
      startPos = lastP.map((p) => Math.max(p - Math.floor(step / hop), 0))
      onProgress?.(Math.min(1, (k + 1) / total))
      onStep?.()
    }
    return { events: finishEvents(byType), segments: total, profile }
  }
}
