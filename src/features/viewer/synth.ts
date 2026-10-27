// Owner: piano-sound. Piano renderer: turns the planned voices (pianoPlan.ts) into one AudioBuffer.
// Per note: the nearest Salamander sample of the right velocity layer, shifted in pitch (at most a
// semitone, plus its tuning fix), with loudness and brightness (a gentle low-pass inside each layer)
// from the dynamic level; the sample carries the natural decay; the dampers (key release, pedal lift,
// re-strike) end it with a short exponential release, never a hard cut. Pieces are brought to a
// common loudness, metronome and count-in clicks come from the bundled percussion samples, and a soft
// limiter guards the peaks. The room reverb is applied live by the player (reverb.ts).
// Speed, metronome and count-in are baked in (the player re-renders when they change).
import type { TimeSignature } from '../../types'
import { METRONOME_CLICKS, getSoundUrl } from '../../assets/images'
import { loopVoices, metronomeClicks, type Click, type Voice } from './pianoPlan'
import { CLASSIC_RANGE, loadClassic, loadPiano, loadSound, sampleFile, sampleNoteFor, type ClassicSample, type PianoLayer, type PianoSound } from './pianoSamples'
import { TAU_SPAN, foldInto, gatedLevelDb, inSlices, mixVoice, scale, softLimit, type MixSample, type MixVoice } from './mixer'

export interface SynthSpec {
  /** What the piano plays (pianoPlan.planVoices), in score seconds at 100 %. */
  voices: readonly Voice[]
  /** Milliseconds per measure at 100 %. */
  msPerMeasure: number
  timeSignature: TimeSignature
  /** Identity of `voices` (pianoPlan.voicesKey) and the sound: a new key means new music. */
  key: string
  /** Which piano plays: 'grand' (default) or 'classic' (the previous FluidR3 sound). */
  instrument?: PianoSound
}

export interface RenderOptions {
  /** Percent. */
  speed: number
  metronome: boolean
  countIn: boolean
  /** Score seconds at 100 % (the music part of the buffer reaches the end of the last measure). */
  duration: number
}

export interface TuneRender {
  buffer: AudioBuffer
  /** Count-in length in buffer seconds (0 without count-in). */
  introSec: number
  /** speed / 100 */
  speedF: number
  /** Ring-out after the music (release tails), buffer seconds. */
  tailSec: number
  /** Loudness correction applied to the piano, dB (renderLoop reuses it). */
  levelDb: number
}

/** Longest ring-out kept after the last measure (undamped top notes fade by then). */
const MAX_TAIL_SEC = 4
/** Gain staging before the loudness correction. */
const MASTER_DB = -3
/** Common piano loudness (gated, dB): about -18.5 LUFS with the room, like the previous synth. */
const LEVEL_TARGET_DB = -21.5
/** The correction never cuts more than 6 dB or lifts more than 2 dB. */
const LEVEL_RANGE_DB: readonly [number, number] = [-6, 2]
const CLICK_DB = { accent: 4, beat: 1 } as const
/** The classic samples are recorded much quieter than the grand ones (abcjs boosted them x3). */
const CLASSIC_DB = 10

/* ---------------- dynamics -> layer, tone and gain ---------------- */

/**
 * How hard the key was struck, 0..1: the note's own velocity or its dynamic level, whichever is
 * higher. It picks the velocity layer (the tone); the dynamic level sets the loudness.
 */
export function strikeOf(v: Pick<Voice, 'dynamic' | 'velocity'>): number {
  return Math.min(1, Math.max(0, Math.max(v.velocity ?? 0, v.dynamic)))
}

/**
 * Velocity layer of a strike. The ranges follow the instrument's own mapping (its SFZ plays layer 4 up
 * to MIDI velocity 43, layer 9 for 65-72, layer 14 for 105-112), rounded up to the next shipped layer
 * so a note is never duller than the recording at its velocity.
 */
export function layerFor(strike: number): PianoLayer {
  return strike <= 0.34 ? 4 : strike <= 0.57 ? 9 : 14
}

const DYN_POINTS: readonly (readonly [number, number])[] = [
  [0, -13],
  [0.25, -7],
  [0.55, 0],
  [0.85, 6],
  [1, 8.5],
]

/** Loudness of a dynamic level relative to mezzo forte, dB (continuous across the layers). */
export function dynamicDb(dynamic: number): number {
  const d = Math.min(1, Math.max(0, dynamic))
  for (let i = 1; i < DYN_POINTS.length; i++) {
    const [x1, y1] = DYN_POINTS[i]
    const [x0, y0] = DYN_POINTS[i - 1]
    if (d <= x1) return y0 + ((d - x0) / (x1 - x0)) * (y1 - y0)
  }
  return DYN_POINTS[DYN_POINTS.length - 1][1]
}

/** A little lift for the upper register so high melodies sing (the treble is naturally thinner). */
export function registerDb(pitch: number): number {
  return Math.min(4.5, Math.max(0, (pitch - 64) * 0.15))
}

/** Below this strike (pianissimo) the tone softens gently; above it every note keeps its natural brightness. */
const PIANISSIMO = 0.25

/** How much a pianissimo note is softened, 0..1 (0 from PIANISSIMO up). */
export function darkening(strike: number): number {
  const s = Math.min(1, Math.max(0, strike))
  return s >= PIANISSIMO ? 0 : (PIANISSIMO - s) / PIANISSIMO
}

/**
 * One-pole low-pass coefficient for a note (1 = open): only pianissimo notes get one, gliding from
 * open down to about 3.5 kHz (never below 4x the fundamental) for the very softest.
 */
export function lowpassFor(strike: number, pitch: number, rate: number): number {
  const w = darkening(strike)
  if (w < 0.02) return 1
  const f0 = 440 * 2 ** ((pitch - 69) / 12)
  const darkest = Math.max(3500, 4 * f0)
  const open = 20000
  const fc = open * (darkest / open) ** w
  return 1 - Math.exp((-2 * Math.PI * Math.min(fc, rate * 0.45)) / rate)
}

const dbToGain = (db: number) => 10 ** (db / 20)

/** Sample files a voice list needs. */
export function neededSamples(voices: readonly Voice[]): Set<string> {
  const files = new Set<string>()
  for (const v of voices) files.add(sampleFile(sampleNoteFor(v.pitch), layerFor(strikeOf(v))))
  return files
}

/* ---------------- rendering ---------------- */

interface Placement {
  /** Buffer seconds where score time 0 falls. */
  zero: number
  speedF: number
}

interface BankSample extends MixSample {
  /** Buffer rate / output rate (1 when decoded by the same context). */
  rateFix: number
  midi: number
  tune: number
  /** Level fixes of this note and layer (smooth keyboard, layers matched to layer 9), dB. */
  gainDb: number
}

const channelsOf = (b: AudioBuffer): Float32Array[] => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c))

/** Buffer seconds after which every voice is silent. */
function lastSound(voices: readonly Voice[], at: Placement, sampleSeconds: (v: Voice) => number): number {
  let end = 0
  for (const v of voices) {
    const t0 = at.zero + v.start / at.speedF
    const natural = t0 + sampleSeconds(v)
    const damped = Number.isFinite(v.release) ? at.zero + v.release / at.speedF + TAU_SPAN * v.tau : Infinity
    end = Math.max(end, Math.min(natural, damped))
  }
  return end
}

/** The grand piano's voices: Salamander samples by layer, tuning and level fixes, soft-note tone. */
async function grandVoices(ctx: BaseAudioContext, voices: readonly Voice[], at: Placement): Promise<{ mix: MixVoice[]; end: number }> {
  const rate = ctx.sampleRate
  const samples = await loadPiano(ctx, neededSamples(voices))
  // The recorded note and layer actually loaded (a fallback may stand in for a missing file).
  const bank = new Map<string, BankSample>()
  for (const [file, s] of samples)
    bank.set(file, {
      channels: s.data,
      scale: 1 / 32768,
      offset: s.offset * s.sampleRate,
      rateFix: s.sampleRate / rate,
      midi: s.note.midi,
      tune: s.note.tuneCents,
      gainDb: s.note.levelDb - s.note.layerDb[s.layer],
    })
  const sampleOf = (v: Voice) => bank.get(sampleFile(sampleNoteFor(v.pitch), layerFor(strikeOf(v))))
  const rateOf = (v: Voice, s: BankSample) => 2 ** ((v.pitch - s.midi + s.tune / 100) / 12) * s.rateFix
  const mix: MixVoice[] = []
  for (const v of voices) {
    const s = sampleOf(v)
    const t0 = at.zero + v.start / at.speedF
    if (!s || t0 < 0) continue
    mix.push({
      sample: s,
      start: t0 * rate,
      rate: rateOf(v, s),
      gain: dbToGain(MASTER_DB + s.gainDb + dynamicDb(v.dynamic) + registerDb(v.pitch)),
      release: Number.isFinite(v.release) ? (at.zero + v.release / at.speedF) * rate : Infinity,
      tau: Math.max(0.005, v.tau) * rate,
      lowpass: lowpassFor(strikeOf(v), v.pitch, rate),
    })
  }
  const end = lastSound(voices, at, (v) => {
    const s = sampleOf(v)
    return s ? (s.channels[0].length - s.offset) / rateOf(v, s) / rate : 0
  })
  return { mix, end }
}

/**
 * The classic piano's voices: the FluidR3 sample of each key (one layer: loudness from the dynamic
 * level), with the same dampers, pedal and re-strikes as the grand.
 */
async function classicVoices(ctx: BaseAudioContext, voices: readonly Voice[], at: Placement): Promise<{ mix: MixVoice[]; end: number }> {
  const rate = ctx.sampleRate
  const bank = await loadClassic(
    ctx,
    voices.map((v) => v.pitch),
  )
  const sampleOf = (v: Voice) => bank.get(Math.min(CLASSIC_RANGE[1], Math.max(CLASSIC_RANGE[0], Math.round(v.pitch))))
  const rateOf = (v: Voice, s: ClassicSample) => 2 ** ((v.pitch - s.midi) / 12) * (s.sampleRate / rate)
  const mix: MixVoice[] = []
  for (const v of voices) {
    const s = sampleOf(v)
    const t0 = at.zero + v.start / at.speedF
    if (!s || t0 < 0) continue
    mix.push({
      sample: { channels: s.data, scale: 1 / 32768, offset: s.offset * s.sampleRate },
      start: t0 * rate,
      rate: rateOf(v, s),
      gain: dbToGain(MASTER_DB + CLASSIC_DB + dynamicDb(v.dynamic)),
      release: Number.isFinite(v.release) ? (at.zero + v.release / at.speedF) * rate : Infinity,
      tau: Math.max(0.005, v.tau) * rate,
    })
  }
  const end = lastSound(voices, at, (v) => {
    const s = sampleOf(v)
    return s ? (s.data[0].length - s.offset * s.sampleRate) / rateOf(v, s) / rate : 0
  })
  return { mix, end }
}

/**
 * Mixes voices and clicks into a new stereo buffer, up to the last sound (capped at musicEnd +
 * MAX_TAIL_SEC). The piano is brought to a common loudness (LEVEL_TARGET_DB, within LEVEL_RANGE_DB)
 * unless `levelDb` gives the correction to use (loops reuse the tune's, so they match it).
 */
async function renderVoices(
  ctx: BaseAudioContext,
  voices: readonly Voice[],
  clicks: readonly Click[],
  at: Placement,
  musicEnd: number,
  levelDb: number | null,
  instrument: PianoSound = 'grand',
): Promise<{ buffer: AudioBuffer; levelDb: number }> {
  const rate = ctx.sampleRate
  const [piano, accent, beat] = await Promise.all([
    instrument === 'classic' ? classicVoices(ctx, voices, at) : grandVoices(ctx, voices, at),
    clicks.length ? loadSound(ctx, getSoundUrl(METRONOME_CLICKS.accent)) : null,
    clicks.length ? loadSound(ctx, getSoundUrl(METRONOME_CLICKS.beat)) : null,
  ])
  const { mix, end } = piano
  const clickMix: MixVoice[] = []
  for (const c of clicks) {
    const s = c.accent ? accent : beat
    const t0 = at.zero + c.time / at.speedF
    if (!s || t0 < 0) continue
    clickMix.push({
      sample: { channels: channelsOf(s.buffer), offset: s.offset * s.buffer.sampleRate },
      start: t0 * rate,
      rate: s.buffer.sampleRate / rate,
      gain: dbToGain(c.accent ? CLICK_DB.accent : CLICK_DB.beat),
      // Clicks are short: damp the sample's long silent tail quickly.
      release: (t0 + 0.25) * rate,
      tau: 0.03 * rate,
    })
  }

  const seconds = Math.min(musicEnd + MAX_TAIL_SEC, Math.max(musicEnd, end) + 0.05)
  const buffer = ctx.createBuffer(2, Math.max(1, Math.ceil(seconds * rate)), rate)
  const out = channelsOf(buffer)
  await inSlices(mix, (v) => mixVoice(out, v))
  // Pedalled, dense textures add up louder than sparse ones: even the pieces out (clicks excluded).
  let correction = levelDb
  if (correction == null) {
    const level = gatedLevelDb(out, rate)
    correction = Number.isFinite(level) ? Math.min(LEVEL_RANGE_DB[1], Math.max(LEVEL_RANGE_DB[0], LEVEL_TARGET_DB - level)) : 0
  }
  scale(out, dbToGain(correction))
  for (const c of clickMix) mixVoice(out, c)
  softLimit(out)
  return { buffer, levelDb: correction }
}

/** The whole tune: [count-in][music at speed][ring-out]. */
export async function renderTune(ctx: BaseAudioContext, s: SynthSpec, o: RenderOptions): Promise<TuneRender> {
  const speedF = o.speed / 100
  const measureSec = s.msPerMeasure / 1000
  const introSec = o.countIn ? measureSec / speedF : 0
  const clicks = metronomeClicks(measureSec, s.timeSignature, o.duration, o)
  const musicEnd = introSec + o.duration / speedF
  const { buffer, levelDb } = await renderVoices(ctx, s.voices, clicks, { zero: introSec, speedF }, musicEnd, null, s.instrument)
  return { buffer, introSec, speedF, tailSec: Math.max(0, buffer.duration - musicEnd), levelDb }
}

/**
 * The loop [a, b) (score seconds) as a seamless cycle: exactly (b - a) / speed long, the notes that
 * start inside it released at b, and their ring-out folded onto the start, so the end flows into the
 * beginning with no jump (no click) at the wrap. `levelDb`: the tune's loudness correction (so the
 * loop sounds exactly like the tune it hands over from).
 */
export async function renderLoop(
  ctx: BaseAudioContext,
  s: SynthSpec,
  o: RenderOptions,
  loop: readonly [number, number],
  levelDb: number,
): Promise<AudioBuffer> {
  const speedF = o.speed / 100
  const [a, b] = loop
  const measureSec = s.msPerMeasure / 1000
  const clicks = metronomeClicks(measureSec, s.timeSignature, o.duration, { metronome: o.metronome, countIn: false }).filter(
    (c) => c.time >= a - 1e-6 && c.time < b - 1e-6,
  )
  const cycle = (b - a) / speedF
  const { buffer } = await renderVoices(ctx, loopVoices(s.voices, a, b), clicks, { zero: -a / speedF, speedF }, cycle, levelDb, s.instrument)
  return foldCycle(ctx, buffer, 0, Math.round(cycle * ctx.sampleRate))
}

/** Loop over the whole tune, cut from an already rendered tune (its ring-out folded onto the start). */
export function wholeLoop(ctx: BaseAudioContext, r: TuneRender, duration: number): AudioBuffer {
  const rate = r.buffer.sampleRate
  return foldCycle(ctx, r.buffer, Math.round(r.introSec * rate), Math.round((duration / r.speedF) * rate))
}

/** A `length`-frame cycle cut from `src` at `start`, with everything after it folded onto it. */
export function foldCycle(ctx: BaseAudioContext, src: AudioBuffer, start: number, length: number): AudioBuffer {
  const out = ctx.createBuffer(src.numberOfChannels, Math.max(1, length), src.sampleRate)
  const dst = channelsOf(out)
  foldInto(dst, channelsOf(src), start)
  softLimit(dst)
  return out
}
