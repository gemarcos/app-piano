// Owner: piano-sound. The grand piano: Salamander Grand Piano V3 (Yamaha C5, Alexander Holm, CC BY 3.0),
// 30 notes in minor thirds A0..C8 x 3 velocity layers, trimmed and encoded as 32 kHz stereo MP3 in
// public/soundfonts/salamander/ (precached for offline use). Samples are decoded lazily (only the
// notes and layers a score needs) and cached per sample rate.
import { CLASSIC_PIANO_DIR, getPianoSampleUrl, getSoundUrl } from '../../assets/images'
import { toInt16 } from './mixer'

/** The two piano sounds: 'grand' (Salamander, default) and 'classic' (FluidR3_GM, the previous sound). */
export type PianoSound = 'grand' | 'classic'

const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
/** Keys with a classic sample (A0..Db8). */
export const CLASSIC_RANGE: readonly [number, number] = [21, 109]

/** File of the classic sample of a key ('Db4.mp3'), clamped to its range. */
export function classicFile(midi: number): string {
  const m = Math.min(CLASSIC_RANGE[1], Math.max(CLASSIC_RANGE[0], Math.round(midi)))
  return `${FLAT_NAMES[m % 12]}${Math.floor(m / 12) - 1}.mp3`
}

/** Salamander velocity layers we ship (of its 16): soft, medium, loud. */
export const PIANO_LAYERS = [4, 9, 14] as const
export type PianoLayer = (typeof PIANO_LAYERS)[number]

/**
 * Per recorded note: [midi, file stem, tuning fix (cents), level fix (dB), layer 4 and layer 14 level
 * relative to layer 9 (dB)]. The fixes put every note on a smooth stretch-tuning curve (within a few
 * cents of equal temperament from A2 to F#5, the usual grand-piano stretch outside: about -25 cents at
 * A0 and +40 at C8) and a smooth loudness curve across the keyboard. Measured from the shipped files
 * (FFT partial fit; dominant peak for the top notes; RMS of the first 0.4 s). The Salamander "C8" file
 * actually sounds a C#8, hence its large fix.
 */
const TABLE: readonly (readonly [number, string, number, number, number, number])[] = [
  [21, 'A0', -0.1, 0.5, -4.4, 3.3],
  [24, 'C1', 4.4, 0.3, -2.5, 3.3],
  [27, 'Ds1', 0.3, -1.1, -4.5, 2.7],
  [30, 'Fs1', -2.8, -0.3, -3.9, 3.2],
  [33, 'A1', -4.9, 0.5, -3.0, 4.1],
  [36, 'C2', 0.1, 0.3, -3.6, 4.0],
  [39, 'Ds2', -0.3, -0.7, -2.9, 3.6],
  [42, 'Fs2', -0.4, -1.3, -3.8, 3.9],
  [45, 'A2', -1.9, 1.5, -3.3, 4.9],
  [48, 'C3', 2.7, 0.5, -3.9, 3.6],
  [51, 'Ds3', 0.6, -0.3, -2.7, 3.4],
  [54, 'Fs3', 4.2, 1.7, -4.7, 3.8],
  [57, 'A3', -0.5, 2.5, -5.2, 5.2],
  [60, 'C4', 0.3, -1.3, -4.2, 6.2],
  [63, 'Ds4', 0.0, 0.8, -5.0, 4.0],
  [66, 'Fs4', 3.6, -0.2, -4.9, 5.0],
  [69, 'A4', 0.2, -0.5, -5.9, 5.0],
  [72, 'C5', -2.2, -1.2, -4.0, 5.9],
  [75, 'Ds5', -0.8, 2.7, -3.5, 7.1],
  [78, 'Fs5', -0.9, -2.3, -3.9, 5.5],
  [81, 'A5', -2.3, 1.0, -6.2, 5.5],
  [84, 'C6', -1.7, -0.7, -8.7, 4.6],
  [87, 'Ds6', -1.1, -2.5, -7.3, 5.4],
  [90, 'Fs6', -0.9, 0.5, -6.7, 6.2],
  [93, 'A6', 4.2, -0.6, -6.1, 7.3],
  [96, 'C7', -3.6, 0.6, -7.3, 8.7],
  [99, 'Ds7', 5.1, 2.2, -9.4, 8.3],
  [102, 'Fs7', 2.2, -0.2, -5.8, 5.6],
  [105, 'A7', -3.4, 1.3, -8.7, 8.9],
  [108, 'C8', -57.8, -1.1, -5.4, 7.1],
]

/** MIDI range the piano plays (A0..C8). */
export const PIANO_RANGE: readonly [number, number] = [21, 108]

export interface SampleNote {
  midi: number
  stem: string
  tuneCents: number
  levelDb: number
  /** Level of each layer relative to layer 9, dB. */
  layerDb: Record<PianoLayer, number>
}

export const SAMPLE_NOTES: readonly SampleNote[] = TABLE.map(([midi, stem, tuneCents, levelDb, v4, v14]) => ({
  midi,
  stem,
  tuneCents,
  levelDb,
  layerDb: { 4: v4, 9: 0, 14: v14 },
}))

/** The recorded note that plays `midi` (nearest; samples are at most one semitone away). */
export function sampleNoteFor(midi: number): SampleNote {
  const i = Math.round((Math.min(PIANO_RANGE[1], Math.max(PIANO_RANGE[0], midi)) - 21) / 3)
  return SAMPLE_NOTES[Math.min(SAMPLE_NOTES.length - 1, Math.max(0, i))]
}

export const sampleFile = (note: SampleNote, layer: PianoLayer) => `${note.stem}v${layer}.mp3`

/* ---------- loading ---------- */

/**
 * A decoded sample, kept as 16-bit integers (half the memory of float; the recordings are 16-bit),
 * and where its attack starts (decoders may add a little delay before it).
 */
export interface LoadedSample {
  /** Channels (stereo), values / 32768 = audio. */
  data: Int16Array[]
  sampleRate: number
  /** Seconds into the data where playback starts (2 ms before the hammer). */
  offset: number
  /** The recorded note and layer actually in `data` (a fallback may differ from what was asked). */
  note: SampleNote
  layer: PianoLayer
}

const cache = new Map<string, Promise<LoadedSample>>()
/** Decodes running at once (each one holds a float copy until it is converted). */
const MAX_DECODES = 6
let decoding = 0
const waiting: (() => void)[] = []

async function throttled<T>(job: () => Promise<T>): Promise<T> {
  if (decoding >= MAX_DECODES) await new Promise<void>((resolve) => waiting.push(resolve))
  decoding++
  try {
    return await job()
  } finally {
    decoding--
    waiting.shift()?.()
  }
}

function parseFile(file: string): { note: SampleNote; layer: PianoLayer } | null {
  const m = /^(.*)v(\d+)\.mp3$/.exec(file)
  const note = m ? SAMPLE_NOTES.find((n) => n.stem === m[1]) : undefined
  const layer = m ? (Number(m[2]) as PianoLayer) : undefined
  return note && layer && PIANO_LAYERS.includes(layer) ? { note, layer } : null
}

/** Seconds of the first sample above 2 % of the peak of the first 0.3 s, minus 2 ms. */
export function attackOffset(buffer: AudioBuffer): number {
  const n = Math.min(buffer.length, Math.round(buffer.sampleRate * 0.3))
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
  let peak = 0
  for (const ch of chans) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(ch[i]))
  if (peak <= 0) return 0
  const thr = peak * 0.02
  for (let i = 0; i < n; i++) for (const ch of chans) if (Math.abs(ch[i]) > thr) return Math.max(0, i / buffer.sampleRate - 0.002)
  return 0
}

async function fetchDecode(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const data = await res.arrayBuffer()
  // Promise form, with the callback form as a fallback for old Safari.
  return new Promise<AudioBuffer>((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject)
    if (p && typeof p.then === 'function') p.then(resolve, reject)
  })
}

/** Decodes one file (cached per sample rate: buffers can be shared by contexts with the same rate). */
export function loadSample(ctx: BaseAudioContext, file: string): Promise<LoadedSample> {
  const id = parseFile(file)
  if (!id) return Promise.reject(new Error(`unknown sample ${file}`))
  const url = getPianoSampleUrl(file)
  const key = `${ctx.sampleRate}|${url}`
  let p = cache.get(key)
  if (!p) {
    p = throttled(() => fetchDecode(ctx, url)).then((buffer) => ({
      data: Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => toInt16(buffer.getChannelData(c))),
      sampleRate: buffer.sampleRate,
      offset: attackOffset(buffer),
      ...id,
    }))
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

/**
 * Loads the given (note, layer) pairs. A file that fails falls back to another layer of the same note,
 * then to the neighbouring notes, so one bad file never silences a score. Rejects only when nothing loads.
 */
export async function loadPiano(ctx: BaseAudioContext, wanted: Iterable<string>): Promise<Map<string, LoadedSample>> {
  const keys = [...new Set(wanted)]
  const loaded = new Map<string, LoadedSample>()
  const results = await Promise.allSettled(keys.map((k) => loadSample(ctx, k)))
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') loaded.set(keys[i], r.value)
  })
  if (loaded.size === keys.length) return loaded
  for (const k of keys) {
    if (loaded.has(k)) continue
    const alt = await fallbackFor(ctx, k)
    if (alt) loaded.set(k, alt)
  }
  if (loaded.size === 0 && keys.length) throw new Error('piano samples unavailable')
  return loaded
}

async function fallbackFor(ctx: BaseAudioContext, file: string): Promise<LoadedSample | null> {
  const id = parseFile(file)
  if (!id) return null
  const idx = SAMPLE_NOTES.indexOf(id.note)
  const order = [idx, idx - 1, idx + 1].filter((i) => i >= 0 && i < SAMPLE_NOTES.length)
  for (const i of order)
    for (const layer of [9, 4, 14] as PianoLayer[]) {
      const alt = sampleFile(SAMPLE_NOTES[i], layer)
      if (alt === file) continue
      try {
        return await loadSample(ctx, alt)
      } catch {
        // try the next one
      }
    }
  return null
}

const sounds = new Map<string, Promise<{ buffer: AudioBuffer; offset: number }>>()

/** Decodes any other bundled sound (metronome clicks), cached per sample rate. */
export function loadSound(ctx: BaseAudioContext, url: string): Promise<{ buffer: AudioBuffer; offset: number }> {
  const key = `${ctx.sampleRate}|${url}`
  let p = sounds.get(key)
  if (!p) {
    p = fetchDecode(ctx, url).then((buffer) => ({ buffer, offset: attackOffset(buffer) }))
    p.catch(() => sounds.delete(key))
    sounds.set(key, p)
  }
  return p
}

/** A decoded classic sample (16-bit like the grand ones). */
export interface ClassicSample {
  data: Int16Array[]
  sampleRate: number
  /** Seconds where playback starts (2 ms before the attack). */
  offset: number
  midi: number
}

const classic = new Map<string, Promise<ClassicSample>>()

/** Decodes the classic samples of the given keys (missing files are skipped: those keys stay silent). */
export async function loadClassic(ctx: BaseAudioContext, keys: Iterable<number>): Promise<Map<number, ClassicSample>> {
  const wanted = [...new Set([...keys].map((m) => Math.min(CLASSIC_RANGE[1], Math.max(CLASSIC_RANGE[0], Math.round(m)))))]
  const out = new Map<number, ClassicSample>()
  const results = await Promise.allSettled(
    wanted.map((midi) => {
      const url = getSoundUrl(CLASSIC_PIANO_DIR + classicFile(midi))
      const key = `${ctx.sampleRate}|${url}`
      let p = classic.get(key)
      if (!p) {
        p = throttled(() => fetchDecode(ctx, url)).then((buffer) => {
          const data = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => toInt16(buffer.getChannelData(c)))
          // These renders stop without a fade: end them in silence (30 ms) so a note held to the end never clicks.
          const fade = Math.min(Math.round(buffer.sampleRate * 0.03), data[0].length)
          for (const ch of data) for (let i = 0; i < fade; i++) ch[ch.length - 1 - i] = Math.round(ch[ch.length - 1 - i] * (i / fade))
          return { data, sampleRate: buffer.sampleRate, offset: attackOffset(buffer), midi }
        })
        p.catch(() => classic.delete(key))
        classic.set(key, p)
      }
      return p
    }),
  )
  results.forEach((r) => {
    if (r.status === 'fulfilled') out.set(r.value.midi, r.value)
  })
  if (out.size === 0 && wanted.length) throw new Error('classic piano samples unavailable')
  return out
}

/** Frees the decoded samples (the viewer calls it a while after closing). */
export function releasePianoSamples(): void {
  cache.clear()
  sounds.clear()
  classic.clear()
}
