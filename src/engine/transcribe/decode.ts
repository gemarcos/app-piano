// Model activations -> NoteEvent[] (worker + test harness). Imports basic-pitch: never import from the main app.
import { noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'
import type { NoteEvent } from '../../types'
import { type DecoderParams, finalizeNotes } from './params'
import { prepareOnsets } from './onsets'

/** `frames` / `onsets` are [time][88] activation rows; they are not modified. */
export function decodeNotes(frames: number[][], onsets: number[][], p: DecoderParams): NoteEvent[] {
  if (frames.length < 3 || onsets.length !== frames.length) return []
  // Onset inference happens in prepareOnsets (tie-safe), so the library's own pass is disabled.
  const events = outputToNotesPoly(
    frames,
    prepareOnsets(onsets, frames, p.inferOnsets),
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
