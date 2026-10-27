/**
 * Onset / frame decoder of Onsets and Frames, derived from pianorollToNoteSequence in Magenta.js
 * (music/src/transcription/transcription_utils.ts).
 *
 * @license
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified by the Pauta authors (2026): same rule (a note starts on an onset frame unless the previous frame was also
 * an onset, and lasts while frame or onset stays above threshold), on plain Float32Arrays, producing the app's
 * NoteEvent (seconds of the caller's samples, loudness velocity 0..1) with a minimum duration and an onset shift.
 */
import type { NoteEvent } from '../../../types'
import { FRAME_SECONDS, FRAME_THRESHOLD, MIN_PITCH, ONSET_SHIFT_SECONDS, ONSET_THRESHOLD, PITCHES } from './constants'
import type { Activations } from './network'

export interface DecodeOptions {
  onsetThreshold?: number
  frameThreshold?: number
  /** Notes shorter than this (seconds, after timeScale) are dropped. */
  minDuration?: number
  /** Multiplies model times (tuning compensation stretched the audio by 1 / timeScale). */
  timeScale?: number
  /** Seconds added to every onset (default ONSET_SHIFT_SECONDS). */
  onsetShift?: number
}

/** Lowest velocity reported (the same floor as the Basic Pitch loudness velocities). */
export const OAF_VELOCITY_FLOOR = 0.15

/** Magenta's velocity scale (10..90) -> loudness 0..1 (forte notes land near 0.7, soft accompaniment near 0.3). */
export function oafVelocity(v: number): number {
  return Math.round(Math.min(1, Math.max(OAF_VELOCITY_FLOOR, v / 100)) * 1000) / 1000
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

export function decodeActivations(a: Activations, options: DecodeOptions = {}): NoteEvent[] {
  const onsetThr = options.onsetThreshold ?? ONSET_THRESHOLD
  const frameThr = options.frameThreshold ?? FRAME_THRESHOLD
  const scale = options.timeScale && options.timeScale > 0 ? options.timeScale : 1
  const shift = options.onsetShift ?? ONSET_SHIFT_SECONDS
  const minDuration = Math.max(0, options.minDuration ?? 0)
  const n = a.frames
  const startPlusOne = new Int32Array(PITCHES)
  const startVelocity = new Float32Array(PITCHES)
  let previous = new Uint8Array(PITCHES)
  let current = new Uint8Array(PITCHES)
  const notes: NoteEvent[] = []
  const end = (p: number, f: number) => {
    const first = startPlusOne[p] - 1
    startPlusOne[p] = 0
    const duration = (f - first) * FRAME_SECONDS * scale
    if (duration + 1e-9 < minDuration) return
    notes.push({
      pitch: p + MIN_PITCH,
      start: Math.max(0, round3(first * FRAME_SECONDS * scale + shift)),
      duration: Math.max(0.001, round3(duration)),
      velocity: oafVelocity(startVelocity[p]),
    })
  }
  for (let f = 0; f <= n; f++) {
    for (let p = 0; p < PITCHES; p++) {
      const i = f * PITCHES + p
      const onset = f < n && a.onset[i] > onsetThr
      current[p] = onset ? 1 : 0
      if (onset) {
        if (!startPlusOne[p] || !previous[p]) {
          if (startPlusOne[p]) end(p, f)
          startPlusOne[p] = f + 1
          startVelocity[p] = a.velocity[i]
        }
      } else if (startPlusOne[p] && !(f < n && a.frame[i] > frameThr)) {
        end(p, f)
      }
    }
    const swap = previous
    previous = current
    current = swap
  }
  notes.sort((x, y) => x.start - y.start || x.pitch - y.pitch)
  return notes
}
