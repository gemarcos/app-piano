// Decoding and model-input rendering with the Web Audio API.
import type { DecodedMedia } from './index'
import { guessMime, mediaKind } from './media'
import { clampRange, peakNormalize } from './samples'

export const DECODE_ERROR_MESSAGE = 'No se pudo leer el audio de este archivo. Prueba con MP3, WAV, M4A o MP4.'

type AudioContextCtor = typeof AudioContext

function audioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === 'undefined') return undefined
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
}

function decodeError(cause?: unknown): Error {
  const error = new Error(DECODE_ERROR_MESSAGE, cause === undefined ? undefined : { cause })
  error.name = 'DecodeError'
  return error
}

/** decodeAudioData with callback + promise support (older Safari only has callbacks). */
function decodeWith(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const result = ctx.decodeAudioData(data, resolve, reject)
    if (result && typeof result.then === 'function') result.then(resolve, reject)
  })
}

export async function decodeMedia(file: Blob, name?: string): Promise<DecodedMedia> {
  const resolvedName = name ?? (typeof (file as File).name === 'string' && (file as File).name ? (file as File).name : 'archivo')
  const mime = file.type || guessMime(resolvedName)
  const kind = mediaKind(mime, resolvedName)

  let data: ArrayBuffer
  try {
    data = await file.arrayBuffer()
  } catch (err) {
    throw decodeError(err)
  }
  if (!data.byteLength) throw decodeError()

  const Ctor = audioContextCtor()
  let ctx: BaseAudioContext
  try {
    ctx = Ctor ? new Ctor() : new OfflineAudioContext(2, 1, 44100)
  } catch {
    try {
      ctx = new OfflineAudioContext(2, 1, 44100)
    } catch (err) {
      throw decodeError(err)
    }
  }

  try {
    const buffer = await decodeWith(ctx, data)
    if (!buffer || !buffer.length || !(buffer.duration > 0)) throw decodeError()
    return { buffer, duration: buffer.duration, kind, name: resolvedName, mime }
  } catch (err) {
    throw err instanceof Error && err.name === 'DecodeError' ? err : decodeError(err)
  } finally {
    if ('close' in ctx && typeof (ctx as AudioContext).close === 'function') {
      ;(ctx as AudioContext).close().catch(() => {})
    }
  }
}

function render(ctx: OfflineAudioContext): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    ctx.oncomplete = (event) => resolve(event.renderedBuffer)
    const result = ctx.startRendering()
    if (result && typeof result.then === 'function') result.then(resolve, reject)
  })
}

/**
 * Renders `buffer` (any rate / channel count) through an OfflineAudioContext(1, n, rate):
 * the destination downmixes to mono and the source resamples, cropped to `range`.
 */
export async function renderMono(buffer: AudioBuffer, sampleRate: number, range?: { start: number; end: number }): Promise<Float32Array> {
  const { start, end } = clampRange(range, buffer.duration)
  const length = Math.max(1, Math.round((end - start) * sampleRate))
  if (end - start <= 0) return new Float32Array(0)
  const ctx = new OfflineAudioContext(1, length, sampleRate)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start(0, start, end - start)
  const rendered = await render(ctx)
  return new Float32Array(rendered.getChannelData(0))
}

export async function renderModelInput(buffer: AudioBuffer, sampleRate: number, range?: { start: number; end: number }): Promise<Float32Array> {
  const samples = await renderMono(buffer, sampleRate, range)
  peakNormalize(samples, 0.95)
  return samples
}
