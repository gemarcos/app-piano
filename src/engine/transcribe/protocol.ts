// Messages between the transcription client (main thread) and worker.ts. Types only.
import type { NoteEvent } from '../../types'
import type { TranscribeOptions, TranscribeStage } from './index'

export type TranscriberBackend = 'webgl' | 'cpu'

export type WorkerRequest =
  | { type: 'preload'; id: number; modelUrl: string; backend?: TranscriberBackend }
  | {
      type: 'transcribe'
      id: number
      modelUrl: string
      samples: Float32Array
      opts: TranscribeOptions
      /** Test harness only: also return the raw model activations. */
      debugRaw?: boolean
      /** Test harness only: backend to use when the model is first loaded. */
      backend?: TranscriberBackend
    }

/** Model activations, row-major [frames × 88] (debug / calibration). */
export interface RawActivations {
  nFrames: number
  frames: Float32Array
  onsets: Float32Array
}

export interface JobTimings {
  /** Model load + warm-up (0 when it was already loaded). */
  loadMs: number
  inferenceMs: number
  decodeMs: number
}

export type WorkerResponse =
  | { type: 'ready'; id: number; backend: TranscriberBackend; renderer?: string }
  | { type: 'progress'; id: number; fraction: number; stage: TranscribeStage }
  | {
      type: 'result'
      id: number
      notes: NoteEvent[]
      backend: TranscriberBackend
      renderer?: string
      timings: JobTimings
      raw?: RawActivations
    }
  | { type: 'error'; id: number; message: string; detail?: string }
