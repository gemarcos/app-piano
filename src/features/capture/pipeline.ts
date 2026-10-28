// Owner: capture. Audio -> notes -> score -> library item.
// toModelInput -> transcribe (worker: piano model or Basic Pitch) -> analyzeNotes -> defaultParams -> buildScore -> summarizeScore
// -> optional audio -> createScore. The transcriber is imported ONLY through its index.ts (tfjs stays in the worker chunk).
import { encodeWav, MODEL_SAMPLE_RATE, toModelInput, type DecodedMedia } from '../../engine/audio'
import { getLastTranscriptionInfo, sustainNotes, transcribe } from '../../engine/transcribe'
import { analyzeNotes, buildScore, defaultParams, summarizeScore } from '../../engine/score'
import { createScore, recentCoverIds, saveAudio } from '../../data/db'
import { pickCoverId } from '../../assets/images'
import { defaultTitle } from '../../lib/format'
import { newId } from '../../lib/id'
import type { NoteEvent, ScoreDoc, Settings } from '../../types'
import type { CaptureRange, CaptureSource } from './store'
import { overallProgress, stageFor, titleFromFileName, type PipelineStage } from './selection'

export interface PipelineInput {
  source: CaptureSource
  decoded: DecodedMedia
  /** Seconds of `decoded` to transcribe. Note times end up relative to range.start. */
  range: CaptureRange
  /** The original recording (mic/tab), stored when settings.keepOriginalAudio. */
  blob?: Blob | null
  /** Imported file name (the title is the name without extension). */
  name?: string
  /** Title of the new item (default: the file name without extension, or defaultTitle('Grabación')). */
  title?: string
  /** Stored as sourceName (default: the imported file name; e.g. the shared link of a take). */
  sourceName?: string
  /** transcriptionModel is optional (default 'auto'). */
  settings: Pick<Settings, 'sensitivity' | 'minNoteMs' | 'quantize' | 'splitPoint' | 'defaultDifficulty' | 'keepOriginalAudio'> &
    Partial<Pick<Settings, 'transcriptionModel'>>
}

export type PipelineResult = { status: 'done'; doc: ScoreDoc } | { status: 'empty' }

export interface PipelineJob {
  promise: Promise<PipelineResult>
  /** Aborts (the transcriber worker too, when it is running); the promise rejects with an AbortError. */
  cancel(): void
}

export type PipelineProgress = (progress: number, stage: PipelineStage) => void

export const PREPARE_ERROR_MESSAGE = 'No se pudo preparar el audio.'
export const SAVE_ERROR_MESSAGE = 'No se pudo guardar la partitura.'

function namedError(name: string, message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause })
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

export function isAbortError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError'
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortError()
}

/** Starts the whole pipeline. Progress is monotonic 0..1 with one-word stages. */
export function startPipeline(input: PipelineInput, onProgress?: PipelineProgress): PipelineJob {
  const controller = new AbortController()
  const promise = run(input, controller.signal, onProgress ?? (() => {}))
  promise.catch(() => {}) // callers may cancel and never await
  return { promise, cancel: () => controller.abort() }
}

async function run(input: PipelineInput, signal: AbortSignal, report: PipelineProgress): Promise<PipelineResult> {
  const { decoded, range, settings } = input
  let shown = 0
  const progress = (value: number, stage: PipelineStage) => {
    if (signal.aborted) return
    shown = Math.max(shown, value)
    try {
      report(shown, stage)
    } catch {
      // UI callback errors must not break the job
    }
  }

  progress(0, 'preparing')
  let samples: Float32Array
  try {
    samples = await toModelInput(decoded.buffer, range)
  } catch (err) {
    throw namedError('PipelineError', PREPARE_ERROR_MESSAGE, err)
  }
  throwIfAborted(signal)

  const job = transcribe(samples, { sensitivity: settings.sensitivity, minNoteMs: settings.minNoteMs, model: settings.transcriptionModel }, (fraction, stage) =>
    progress(overallProgress(fraction), stageFor(stage)),
  )
  const abort = () => job.cancel()
  signal.addEventListener('abort', abort, { once: true })
  let notes: NoteEvent[]
  try {
    notes = await job.promise
  } finally {
    signal.removeEventListener('abort', abort)
  }
  throwIfAborted(signal)
  // The piano model gives key-held times and the pedal apart; the score is built on how long each note sounds.
  if (getLastTranscriptionInfo()?.durations === 'key') notes = sustainNotes(notes, (await job.pedal) ?? [])
  progress(overallProgress(1), 'writing')
  if (!notes.length) return { status: 'empty' }

  const fromFile = input.source === 'file'
  const title = input.title?.trim() || (fromFile ? titleFromFileName(input.name || decoded.name) : '') || defaultTitle('Grabación')
  const analysis = analyzeNotes(notes)
  const params = defaultParams(analysis, settings)
  const score = buildScore(notes, params, analysis, title)
  const summary = summarizeScore(score)
  // Everything filtered away by the default params would open an empty score with nothing to reset.
  if (summary.noteCount === 0) return { status: 'empty' }
  throwIfAborted(signal)

  // From here on the item is committed (saving takes a few milliseconds).
  const audioId = settings.keepOriginalAudio ? await storeAudio(input, samples) : undefined
  const id = newId()
  const recentCovers = await recentCoverIds().catch(() => [])
  let doc: ScoreDoc
  try {
    doc = await createScore({
      id,
      title,
      source: input.source,
      sourceName: input.sourceName || (fromFile ? input.name || decoded.name : undefined),
      sourceKind: fromFile ? decoded.kind : 'audio',
      durationSec: Math.max(0, range.end - range.start),
      coverId: pickCoverId(id, recentCovers),
      favorite: false,
      notes,
      analysis,
      params,
      summary,
      audioId,
    })
  } catch (err) {
    throw namedError('SaveError', SAVE_ERROR_MESSAGE, err)
  }
  progress(1, 'done')
  return { status: 'done', doc }
}

/**
 * Audio for "Original" playback: the recording as captured (mic/tab), or the selected segment of a file
 * as 22.05 kHz mono WAV (the model input, which starts at range.start like the note times).
 * A failure here only loses the "Original" sound, never the transcription.
 */
async function storeAudio(input: PipelineInput, samples: Float32Array): Promise<string | undefined> {
  try {
    if (input.source === 'file') return await saveAudio(encodeWav(samples, MODEL_SAMPLE_RATE), 'audio/wav')
    if (input.blob && input.blob.size > 0) return await saveAudio(input.blob, input.blob.type || 'audio/webm')
  } catch (err) {
    console.warn('[Pauta] the original audio was not saved:', err)
  }
  return undefined
}
