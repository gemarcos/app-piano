// Model activations -> NoteEvent[] (worker + test harness). Imports basic-pitch: never import from the main app.
import { noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'
import type { NoteEvent } from '../../types'
import { bassOnsetScale, type DecoderParams, finalizeNotes } from './params'
import { prepareOnsets } from './onsets'

/** `frames` / `onsets` are [time][88] activation rows; they are not modified. */
export function decodeNotes(frames: number[][], onsets: number[][], p: DecoderParams): NoteEvent[] {
  if (frames.length < 3 || onsets.length !== frames.length) return []
  // Onset inference, de-duplication and the bass bonus happen in prepareOnsets, so the library's own pass is disabled.
  const prepared = prepareOnsets(onsets, frames, {
    infer: p.inferOnsets,
    nmsRadius: p.onsetNmsFrames,
    columnScale: p.bassOnsetBonus > 0 ? bassOnsetScale(p.bassOnsetBonus) : undefined,
  })
  // With null frequency limits outputToNotesPoly only reads `frames` (its energy bookkeeping works on a copy).
  const events = outputToNotesPoly(
    frames,
    prepared,
    p.onsetThreshold,
    p.frameThreshold,
    p.minNoteFrames,
    false,
    null, // the 88 output bins already are the piano range
    null,
    p.melodiaTrick,
    p.energyTolerance,
  )
  return finalizeNotes(noteFramesToTime(events))
}
