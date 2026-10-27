// Microphone / tab-audio capture with MediaRecorder and a live level meter.
import type { CaptureMode, RecorderHandle, RecorderOptions } from './index'
import { rms, rmsToLevel } from './samples'

/** Preferred recording formats, best first. */
export const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/aac',
]

const LEVEL_INTERVAL_MS = 33

const MUSIC_AUDIO: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
}

export function hasMediaRecorder(): boolean {
  return typeof MediaRecorder !== 'undefined'
}

/** Best MediaRecorder MIME type supported here ('' lets the browser choose). */
export function pickRecorderMime(isSupported: (mime: string) => boolean = defaultIsTypeSupported): string {
  for (const mime of RECORDER_MIME_CANDIDATES) {
    try {
      if (isSupported(mime)) return mime
    } catch {
      /* keep looking */
    }
  }
  return ''
}

function defaultIsTypeSupported(mime: string): boolean {
  return hasMediaRecorder() && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mime)
}

/** Phones and tablets (touch-primary), where tab capture is not offered. */
export function isTouchPrimaryDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
  if (uaData?.mobile) return true
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(navigator.userAgent)) return true
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true // iPadOS desktop mode
  try {
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) return true
  } catch {
    /* ignore */
  }
  return false
}

/** Only Chromium engines deliver tab/system audio through getDisplayMedia. */
function isChromium(): boolean {
  if (typeof navigator === 'undefined') return false
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands
  if (brands?.some((b) => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand))) return true
  const ua = navigator.userAgent
  return /Chrome\/|Chromium\/|Edg\//.test(ua) && !/Firefox\//.test(ua)
}

export function micSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' && hasMediaRecorder()
}

export function tabCaptureSupported(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getDisplayMedia !== 'function') return false
  return hasMediaRecorder() && !isTouchPrimaryDevice() && isChromium()
}

function namedError(name: string, message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause })
  error.name = name
  return error
}

/** Maps getUserMedia / getDisplayMedia failures to short Spanish messages (keeps NotAllowedError as name). */
export function captureError(err: unknown, mode: CaptureMode): Error {
  const name = (err as { name?: string } | null)?.name ?? ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return namedError(
        'NotAllowedError',
        mode === 'mic' ? 'Permite el acceso al micrófono para escuchar.' : 'No se compartió ninguna pestaña.',
        err,
      )
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return namedError('NotFoundError', mode === 'mic' ? 'No se encontró ningún micrófono.' : 'No hay nada que compartir.', err)
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return namedError(
        'NotReadableError',
        mode === 'mic' ? 'El micrófono está ocupado por otra aplicación.' : 'No se pudo capturar la pestaña.',
        err,
      )
    default:
      return namedError(name || 'Error', mode === 'mic' ? 'No se pudo usar el micrófono.' : 'No se pudo capturar la pestaña.', err)
  }
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop()
    } catch {
      /* already stopped */
    }
  })
}

async function acquireStream(mode: CaptureMode): Promise<MediaStream> {
  if (mode === 'mic') {
    if (!micSupported()) throw namedError('NotSupportedError', 'Este navegador no permite grabar audio.')
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: MUSIC_AUDIO, video: false })
    } catch (err) {
      throw captureError(err, 'mic')
    }
  }

  if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getDisplayMedia !== 'function' || !hasMediaRecorder()) {
    throw namedError('NotSupportedError', 'Este navegador no permite capturar pestañas.')
  }
  let stream: MediaStream
  try {
    // systemAudio / suppressLocalAudioPlayback are Chromium extensions missing from some DOM typings.
    const options = { video: true, audio: { ...MUSIC_AUDIO, suppressLocalAudioPlayback: false }, systemAudio: 'include' }
    stream = await navigator.mediaDevices.getDisplayMedia(options as DisplayMediaStreamOptions)
  } catch (err) {
    throw captureError(err, 'tab')
  }
  stream.getVideoTracks().forEach((t) => t.stop())
  if (!stream.getAudioTracks().length) {
    stopTracks(stream)
    throw namedError('NoAudioTrackError', 'No se compartió audio. Activa «Compartir audio» al elegir la pestaña.')
  }
  return stream
}

interface LevelMeter {
  stop(): void
}

function startLevelMeter(stream: MediaStream, onLevel: (level: number) => void): LevelMeter | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  let ctx: AudioContext
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0
  // Silent sink: keeps the graph pulled in every engine without playing the input back.
  const sink = ctx.createGain()
  sink.gain.value = 0
  source.connect(analyser)
  analyser.connect(sink)
  sink.connect(ctx.destination)
  ctx.resume().catch(() => {})

  const block = new Float32Array(analyser.fftSize)
  const bytes = new Uint8Array(analyser.fftSize)
  let shown = 0
  const timer = window.setInterval(() => {
    let level: number
    if (typeof analyser.getFloatTimeDomainData === 'function') {
      analyser.getFloatTimeDomainData(block)
      level = rmsToLevel(rms(block))
    } else {
      analyser.getByteTimeDomainData(bytes)
      for (let i = 0; i < bytes.length; i++) block[i] = (bytes[i] - 128) / 128
      level = rmsToLevel(rms(block))
    }
    // Fast attack, soft release: steadier bars.
    shown = level >= shown ? level : shown * 0.75 + level * 0.25
    try {
      onLevel(shown)
    } catch {
      /* UI callback errors must not stop the meter */
    }
  }, LEVEL_INTERVAL_MS)

  return {
    stop() {
      window.clearInterval(timer)
      try {
        source.disconnect()
        analyser.disconnect()
        sink.disconnect()
      } catch {
        /* already disconnected */
      }
      ctx.close().catch(() => {})
    },
  }
}

function abortError(): Error {
  return namedError('AbortError', 'Grabación cancelada.')
}

export async function startCapture(opts: RecorderOptions): Promise<RecorderHandle> {
  const stream = await acquireStream(opts.mode)
  const audioStream = new MediaStream(stream.getAudioTracks())

  const mimeType = pickRecorderMime()
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(audioStream, mimeType ? { mimeType, audioBitsPerSecond: 128_000 } : { audioBitsPerSecond: 128_000 })
  } catch {
    try {
      recorder = new MediaRecorder(audioStream)
    } catch (err) {
      stopTracks(stream)
      throw namedError('NotSupportedError', 'Este navegador no permite grabar audio.', err)
    }
  }

  const chunks: Blob[] = []
  let meter: LevelMeter | null = null
  let timer: number | undefined
  let released = false
  let cancelled = false

  const release = () => {
    if (released) return
    released = true
    window.clearTimeout(timer)
    meter?.stop()
    meter = null
    stopTracks(stream)
    stopTracks(audioStream)
  }

  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0 && !cancelled) chunks.push(event.data)
    }
    recorder.onstop = () => {
      release()
      if (cancelled) reject(abortError())
      else resolve(new Blob(chunks, { type: chunks[0]?.type || recorder.mimeType || mimeType || 'audio/webm' }))
    }
    recorder.onerror = (event) => {
      release()
      reject(namedError('RecorderError', 'La grabación se interrumpió.', (event as Event & { error?: unknown }).error))
    }
  })
  finished.catch(() => {}) // the caller may never await it (cancel)

  const stopCapture = () => {
    window.clearTimeout(timer)
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop()
        return
      } catch {
        /* fall through */
      }
    }
    release()
  }

  let autoStopped = false
  const autoStop = () => {
    if (autoStopped || cancelled || released) return
    autoStopped = true
    stopCapture()
    try {
      opts.onAutoStop?.()
    } catch {
      /* ignore UI errors */
    }
  }

  try {
    recorder.start(1000)
  } catch (err) {
    release()
    throw namedError('NotSupportedError', 'No se pudo empezar a grabar.', err)
  }
  const startedAt = Date.now()

  if (opts.onLevel) meter = startLevelMeter(audioStream, opts.onLevel)
  if (opts.maxSeconds && opts.maxSeconds > 0) timer = window.setTimeout(autoStop, opts.maxSeconds * 1000)
  // The user can end tab sharing from the browser UI.
  audioStream.getAudioTracks().forEach((track) => track.addEventListener('ended', autoStop))

  return {
    startedAt,
    stop() {
      stopCapture()
      return finished
    },
    cancel() {
      if (cancelled) return
      cancelled = true
      chunks.length = 0
      stopCapture()
    },
  }
}
