// Owner: engine-audio. Public API — implement behind these signatures (add exports freely, never break these).
import { decodeMedia, DECODE_ERROR_MESSAGE, renderModelInput, renderMono } from './decode'
import { micSupported, startCapture, tabCaptureSupported } from './recorder'
import { mixToMono, peaksFromChannels } from './samples'

export { encodeWav, encodeWavBytes } from './wav'
export { fileExtension, guessMime, mediaKind } from './media'
export { peakNormalize, rmsToLevel } from './samples'
export { pickRecorderMime } from './recorder'
export { DECODE_ERROR_MESSAGE }

/** Sample rate expected by Basic Pitch. */
export const MODEL_SAMPLE_RATE = 22050

export interface DecodedMedia {
  /** Decoded audio at the device's native rate (stereo or mono). */
  buffer: AudioBuffer
  duration: number
  kind: 'audio' | 'video'
  name: string
  mime: string
}

/**
 * Decodes an audio OR video file (mp3, wav, m4a, ogg, webm, mp4, mov…) into an AudioBuffer.
 * Throws an Error with a short Spanish `message` when the format can't be decoded.
 * `name` defaults to the File's own name (or 'archivo'); `kind` comes from the MIME type, then the extension.
 * Decode failures throw `name: 'DecodeError'` with DECODE_ERROR_MESSAGE.
 */
export async function decodeMediaFile(file: Blob, name?: string): Promise<DecodedMedia> {
  return decodeMedia(file, name)
}

/**
 * Mixes down to mono, resamples to MODEL_SAMPLE_RATE and (optionally) crops to [start, end) seconds.
 * The result is peak-normalized and ready for the transcription model.
 */
export async function toModelInput(buffer: AudioBuffer, range?: { start: number; end: number }): Promise<Float32Array> {
  return renderModelInput(buffer, MODEL_SAMPLE_RATE, range)
}

/**
 * Mono samples of [start, end) seconds at `sampleRate` (default: the buffer's own rate), NOT normalized.
 * Use with encodeWav to store the trimmed audio of an imported file.
 */
export async function toMono(buffer: AudioBuffer, range?: { start: number; end: number }, sampleRate = buffer.sampleRate): Promise<Float32Array> {
  if (sampleRate === buffer.sampleRate) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
    const from = range ? Math.max(0, range.start) * buffer.sampleRate : 0
    const to = range ? Math.max(0, range.end) * buffer.sampleRate : buffer.length
    return mixToMono(channels, from, to)
  }
  return renderMono(buffer, sampleRate, range)
}

/** Peak envelope for waveform drawing: `bins` values in 0..1. */
export function computePeaks(buffer: AudioBuffer, bins: number): Float32Array {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  return peaksFromChannels(channels, bins)
}

export type CaptureMode = 'mic' | 'tab'

export interface RecorderOptions {
  mode: CaptureMode
  /** Called ~30 times per second with the current input level, 0..1 (for live waveform bars). */
  onLevel?: (level: number) => void
  /** Auto-stop after this many seconds (fires onAutoStop; stop() still resolves the blob). */
  maxSeconds?: number
  onAutoStop?: () => void
  /**
   * Tab mode only: offer THIS tab first in Chrome's picker ("Esta pestaña") and allow picking it at all
   * (Chrome hides the current tab by default). For screens that play the media themselves (the share link
   * screen with the official embed). Added by share, 2026-10-27.
   */
  preferCurrentTab?: boolean
}

export interface RecorderHandle {
  /** Stops capture and resolves the recorded audio (webm/ogg/mp4 depending on browser). */
  stop(): Promise<Blob>
  /** Stops capture and discards the audio. */
  cancel(): void
  readonly startedAt: number
}

/**
 * Starts recording from the microphone (echo cancellation / noise suppression / AGC disabled for music)
 * or, with mode 'tab', from tab/system audio via getDisplayMedia (desktop Chrome/Edge).
 * Rejects with an Error whose `name` is 'NotAllowedError' when permission is denied, and a Spanish `message`.
 * Other names: 'NotFoundError' (no microphone), 'NotReadableError' (device busy), 'NotSupportedError',
 * 'NoAudioTrackError' (tab shared without audio). `startedAt` is Date.now() at start.
 * onAutoStop also fires when the user ends tab sharing from the browser UI.
 * stop() rejects with 'AbortError' after cancel() and with 'RecorderError' if the recorder fails mid-take.
 */
export async function startRecording(opts: RecorderOptions): Promise<RecorderHandle> {
  return startCapture(opts)
}

/** True when getUserMedia + MediaRecorder are available. */
export function isMicSupported(): boolean {
  return micSupported()
}

/** True when tab/system audio capture is likely available (desktop, getDisplayMedia present). */
export function isTabCaptureSupported(): boolean {
  return tabCaptureSupported()
}
