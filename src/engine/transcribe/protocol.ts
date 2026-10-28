// Messages between the transcription client (main thread) and worker.ts. Types only.
import type { NoteEvent, TranscriptionModel } from '../../types'
import type { TranscribeOptions, TranscribeStage } from './index'

/** 'webgl' / 'cpu': Basic Pitch (tfjs); 'webgpu' / 'wasm': the piano model (onnxruntime-web). */
export type TranscriberBackend = 'webgl' | 'cpu' | 'webgpu' | 'wasm'

/** Model that produced a transcription: 'piano' = Transkun V2, 'fast' = Basic Pitch. */
export type ActiveModel = 'piano' | 'fast'

/** Why the piano model was not used although it was requested ('auto' or 'piano'). */
/**
 * Why Basic Pitch ran although the piano model was requested: no usable WebGPU, no WebGL2 for the speed check, a GPU
 * predicted too slow ('auto' only), model files unavailable offline, loading or running failed, or the piano model
 * found no notes at all (not a piano, e.g. synthetic tones or another instrument).
 */
export type PianoFallback = 'no-webgpu' | 'no-webgl2' | 'slow' | 'offline' | 'load-failed' | 'run-failed' | 'no-notes'

export interface TranscriptionInfo {
  /** What the caller asked for (TranscribeOptions.model, default 'auto'). */
  requested: TranscriptionModel
  /** What ran. */
  model: ActiveModel
  backend: TranscriberBackend
  /**
   * What NoteEvent.duration means: 'key' = key-held time (the piano model regresses the key release; the sustain pedal
   * comes separately, see TranscribeJob.pedal), 'sounding' = until the note stops sounding (Basic Pitch).
   */
  durations: 'key' | 'sounding'
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
      /** Folder of the piano model files (Transkun, ends with '/'). */
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
  /** Which model produced them (Basic Pitch only, 86.13 fps). */
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
      /** Sustain-pedal spans in seconds of the samples ([] when the model has none). */
      pedal: { start: number; end: number }[]
      /** tfjs memory after the job (diagnostics): live tensors, their bytes, GPU textures allocated (pool included). */
      memory?: { tensors: number; bytes: number; gpuAllocated?: number }
    }
  | { type: 'error'; id: number; message: string; detail?: string }
