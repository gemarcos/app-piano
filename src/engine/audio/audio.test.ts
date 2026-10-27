import { describe, expect, it } from 'vitest'
import { encodeWav, encodeWavBytes, WAV_HEADER_BYTES } from './wav'
import { clampRange, mixToMono, peakNormalize, peaksFromChannels, rms, rmsToLevel } from './samples'
import { fileExtension, guessMime, mediaKind } from './media'
import { captureError, pickRecorderMime, RECORDER_MIME_CANDIDATES } from './recorder'

const ascii = (view: DataView, offset: number, length: number) =>
  String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)))

describe('encodeWav', () => {
  it('writes a 16-bit PCM mono RIFF header', () => {
    const samples = new Float32Array(1000)
    const view = new DataView(encodeWavBytes(samples, 22050))
    expect(view.byteLength).toBe(WAV_HEADER_BYTES + 2000)
    expect(ascii(view, 0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + 2000)
    expect(ascii(view, 8, 4)).toBe('WAVE')
    expect(ascii(view, 12, 4)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(22050)
    expect(view.getUint32(28, true)).toBe(44100) // byte rate
    expect(view.getUint16(32, true)).toBe(2) // block align
    expect(view.getUint16(34, true)).toBe(16)
    expect(ascii(view, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(2000)
  })

  it('converts, clips and sanitizes samples', () => {
    const view = new DataView(encodeWavBytes(new Float32Array([0, 1, -1, 0.5, 2, -3, Number.NaN]), 44100))
    const at = (i: number) => view.getInt16(WAV_HEADER_BYTES + i * 2, true)
    expect([at(0), at(1), at(2), at(3), at(4), at(5), at(6)]).toEqual([0, 32767, -32768, 16384, 32767, -32768, 0])
  })

  it('returns an audio/wav Blob of the right size', async () => {
    const blob = encodeWav(new Float32Array(10), 48000)
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(WAV_HEADER_BYTES + 20)
    const view = new DataView(await blob.arrayBuffer())
    expect(view.getUint32(24, true)).toBe(48000)
  })
})

describe('peaksFromChannels', () => {
  it('returns `bins` values normalized to the loudest bin', () => {
    const left = new Float32Array(1000)
    left[100] = 0.5
    left[900] = -0.25
    const peaks = peaksFromChannels([left], 10)
    expect(peaks.length).toBe(10)
    expect(peaks[1]).toBeCloseTo(1)
    expect(peaks[9]).toBeCloseTo(0.5)
    expect(peaks[5]).toBe(0)
  })

  it('takes the max across channels', () => {
    const a = new Float32Array(100)
    const b = new Float32Array(100)
    a[10] = 0.2
    b[60] = -0.8
    const peaks = peaksFromChannels([a, b], 2)
    expect(peaks[0]).toBeCloseTo(0.25)
    expect(peaks[1]).toBeCloseTo(1)
  })

  it('handles silence, empty input and more bins than samples', () => {
    expect(Array.from(peaksFromChannels([new Float32Array(50)], 5))).toEqual([0, 0, 0, 0, 0])
    expect(peaksFromChannels([], 4).length).toBe(4)
    expect(peaksFromChannels([new Float32Array(0)], 4).length).toBe(4)
    expect(peaksFromChannels([new Float32Array([0.1, 0.2])], 0).length).toBe(0)
    const tiny = peaksFromChannels([new Float32Array([0.5, 1])], 4)
    expect(tiny.length).toBe(4)
    expect(Math.max(...tiny)).toBeCloseTo(1)
  })

  it('stays within 0..1 on long inputs (strided reads)', () => {
    const long = new Float32Array(2_000_000).map((_, i) => Math.sin(i / 50) * 0.3)
    const peaks = peaksFromChannels([long], 100)
    expect(peaks.every((v) => v >= 0 && v <= 1)).toBe(true)
    expect(Math.max(...peaks)).toBeCloseTo(1)
    expect(Math.min(...peaks)).toBeGreaterThan(0.9)
  })
})

describe('sample helpers', () => {
  it('peakNormalize scales to the target and leaves silence alone', () => {
    const x = new Float32Array([0.1, -0.2, 0.05])
    const gain = peakNormalize(x, 0.95)
    expect(gain).toBeCloseTo(4.75)
    expect(x[1]).toBeCloseTo(-0.95)
    const silent = new Float32Array(4)
    expect(peakNormalize(silent)).toBe(1)
    expect(Array.from(silent)).toEqual([0, 0, 0, 0])
  })

  it('rmsToLevel maps dBFS to a clamped perceptual 0..1', () => {
    expect(rmsToLevel(0)).toBe(0)
    expect(rmsToLevel(Number.NaN)).toBe(0)
    expect(rmsToLevel(1e-4)).toBe(0) // -80 dB
    expect(rmsToLevel(1)).toBe(1)
    expect(rmsToLevel(10 ** (-33 / 20))).toBeCloseTo(0.5)
    expect(rmsToLevel(0.1)).toBeGreaterThan(rmsToLevel(0.01))
  })

  it('rms of a block', () => {
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1)
    expect(rms([])).toBe(0)
  })

  it('mixToMono averages channels and crops', () => {
    const mono = mixToMono([new Float32Array([1, 1, 1, 1]), new Float32Array([0, 1, -1, 0])], 1, 3)
    expect(Array.from(mono)).toEqual([1, 0])
    expect(mixToMono([new Float32Array([0.5, 0.5])]).length).toBe(2)
    expect(mixToMono([new Float32Array(3)], 5, 9).length).toBe(0)
  })

  it('clampRange keeps ranges inside the media', () => {
    expect(clampRange(undefined, 10)).toEqual({ start: 0, end: 10 })
    expect(clampRange({ start: -1, end: 4 }, 10)).toEqual({ start: 0, end: 4 })
    expect(clampRange({ start: 8, end: 20 }, 10)).toEqual({ start: 8, end: 10 })
    expect(clampRange({ start: 6, end: 2 }, 10)).toEqual({ start: 6, end: 6 })
    expect(clampRange({ start: Number.NaN, end: Number.NaN }, 3)).toEqual({ start: 0, end: 3 })
  })
})

describe('media kind', () => {
  it('prefers the MIME type, then the extension', () => {
    expect(mediaKind('video/mp4', 'x.m4a')).toBe('video')
    expect(mediaKind('audio/mp4', 'x.mp4')).toBe('audio')
    expect(mediaKind('audio/webm;codecs=opus', 'grabacion')).toBe('audio')
    expect(mediaKind('', 'clip.MOV')).toBe('video')
    expect(mediaKind('application/octet-stream', 'clip.webm')).toBe('video')
    expect(mediaKind('', 'tema.mp3')).toBe('audio')
    expect(mediaKind('', 'sin-extension')).toBe('audio')
  })

  it('guesses MIME types and extensions', () => {
    expect(fileExtension('Carpeta/Mi.Tema.FLAC')).toBe('flac')
    expect(fileExtension('.oculto')).toBe('')
    expect(guessMime('a.mp3')).toBe('audio/mpeg')
    expect(guessMime('a.m4a')).toBe('audio/mp4')
    expect(guessMime('a.mov')).toBe('video/quicktime')
    expect(guessMime('a.xyz')).toBe('application/octet-stream')
  })
})

describe('recorder helpers', () => {
  it('picks the first supported MIME type', () => {
    expect(pickRecorderMime((m) => m === 'audio/mp4')).toBe('audio/mp4')
    expect(pickRecorderMime(() => true)).toBe(RECORDER_MIME_CANDIDATES[0])
    expect(pickRecorderMime(() => false)).toBe('')
    expect(
      pickRecorderMime((m) => {
        if (m.startsWith('audio/webm')) throw new Error('boom')
        return m === 'audio/ogg'
      }),
    ).toBe('audio/ogg')
  })

  it('maps capture errors to Spanish messages and keeps NotAllowedError', () => {
    const denied = captureError({ name: 'NotAllowedError' }, 'mic')
    expect(denied.name).toBe('NotAllowedError')
    expect(denied.message).toMatch(/micrófono/)
    expect(captureError({ name: 'SecurityError' }, 'tab').name).toBe('NotAllowedError')
    expect(captureError({ name: 'NotFoundError' }, 'mic').message).toMatch(/micrófono/)
    expect(captureError({ name: 'NotReadableError' }, 'mic').name).toBe('NotReadableError')
    expect(captureError(new Error('x'), 'tab').message).toMatch(/pestaña/)
  })
})
