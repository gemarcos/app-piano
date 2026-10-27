// Messages between the transcription client (main thread) and worker.ts. Types only.
import type { NoteEvent, TranscriptionModel } from '../../types'
import type { TranscribeOptions, TranscribeStage } from './index'

export type TranscriberBackend = 'webgl' | 'cpu'

/** Model that produced a transcription: 'piano' = Onsets and Frames, 'fast' = Basic Pitch. */
export type ActiveModel = 'piano' | 'fast'

/** Why the piano model was not used although it was requested ('auto' or 'piano'). */
export type PianoFallback = 'no-webgl2' | 'slow' | 'offline' | 'load-failed' | 'run-failed'

export interface TranscriptionInfo {
  /** What the caller asked for (TranscribeOptions.model, default 'auto'). */
  requested: TranscriptionModel
  /** What ran. */
  model: ActiveModel
  backend: TranscriberBackend
  /** Set when the piano model was requested but Basic Pitch ran instead. */
  fallback?: PianoFallback
}

export type WorkerRequest =
  | { type: 'preload'; id: number; modelUrl: string; pianoUrl: string; model?: TranscriptionModel; backend?: TranscriberBackend }
  | {
      type: 'transcribe'
      id: number
      /** Basic Pitch model.json. */
      modelUrl: string
      /** Folder of the Onsets and Frames checkpoint (ends with '/'). */
      pianoUrl: string
      samples: Float32Array
      opts: TranscribeOptions
      /** Test harness only: also return the raw model activations. */
      debugRaw?: boolean
      /** Test harness only: backend to use when the model is first loaded. */
      backend?: TranscriberBackend
      /** Test harness only: 'off' disables tuning compensation, a number forces that correction (cents). */
      tuning?: 'auto' | 'off' | number
    }

/** Model activations, row-major [frames × 88] (debug / calibration). */
export interface RawActivations {
  nFrames: number
  frames: Float32Array
  onsets: Float32Array
  /** Onsets and Frames only: velocity head (Magenta's 10..90 scale). */
  velocities?: Float32Array
  /** Which model produced them (frame rate: Basic Pitch 86.13 fps, Onsets and Frames 31.25 fps). */
  model?: ActiveModel
  /** Multiply decoded note times by this to get input seconds (tuning compensation stretches the audio). */
  timeScale: number
}

/** Global tuning found in the input and the correction that was applied before inference (cents). */
export interface TuningInfo {
  cents: number
  confidence: number
  applied: number
}

export interface JobTimings {
  /** Model load + warm-up (0 when it was already loaded). */
  loadMs: number
  inferenceMs: number
  decodeMs: number
}

export type WorkerResponse =
  | { type: 'ready'; id: number; backend: TranscriberBackend; renderer?: string; model?: ActiveModel }
  | { type: 'progress'; id: number; fraction: number; stage: TranscribeStage }
  /** The model chosen for a job, posted before inference (and again if it falls back during inference). */
  | { type: 'model'; id: number; info: TranscriptionInfo }
  | {
      type: 'result'
      id: number
      notes: NoteEvent[]
      backend: TranscriberBackend
      renderer?: string
      timings: JobTimings
      raw?: RawActivations
      tuning?: TuningInfo
      info: TranscriptionInfo
      /** tfjs memory after the job (diagnostics): live tensors, their bytes, GPU textures allocated (pool included). */
      memory?: { tensors: number; bytes: number; gpuAllocated?: number }
    }
  | { type: 'error'; id: number; message: string; detail?: string }
