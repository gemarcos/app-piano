/**
 * Constants of the Onsets and Frames piano model, from Magenta.js (music/src/transcription/constants.ts and model.ts).
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
 * Modified by the Pauta authors (2026): collected in one module, plus the app's own chunking and decoding constants.
 */

/** Model input rate. */
export const SAMPLE_RATE = 16000
export const HOP = 512
export const FFT_SIZE = 2048
export const MEL_BINS = 229
export const MEL_FMIN = 30
/** Seconds per model frame (32 ms). */
export const FRAME_SECONDS = HOP / SAMPLE_RATE
export const MIN_PITCH = 21
export const PITCHES = 88
/** Frames each side a frame's CNN output depends on (three 3x3 convolutions): Magenta's RF_PAD. */
export const RF_PAD = 3
/**
 * Frames per chunk (2 s; Magenta's default is 250): the CNN runs on one chunk plus 2 * RF_PAD context frames and the
 * LSTM carries its state across chunks, so the size changes memory and speed, never the result. Measured on WebGL
 * (RTX 2060, 60 s of audio, GPU textures after the job): 250 -> 416 MiB, 60x real time; 128 -> 300 MiB, 71x;
 * 64 -> 238 MiB, 61x. The smallest buffers win for phones; the speed probe also gets shorter (one chunk).
 */
export const CHUNK_FRAMES = 64
export const LSTM_UNITS = 384
/** Magenta's decoder thresholds (a threshold sweep on the realistic benchmark confirms 0.5). */
export const ONSET_THRESHOLD = 0.5
export const FRAME_THRESHOLD = 0.5
/** Constant onset bias of the 32 ms frames, measured on the realistic benchmark (seconds added to every onset). */
export const ONSET_SHIFT_SECONDS = 0.015
