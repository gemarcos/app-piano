// Owner: viewer. Piano rendering: abcjs CreateSynth turns the playback ABC into one AudioBuffer
// (offline soundfont samples; metronome and count-in as abcjs drum tracks that only use the bundled
// percussion samples). Speed is baked in through millisecondsPerMeasure.
import type { SynthOptions } from 'abcjs'
import { getSoundFontUrl, METRONOME_DRUM, SOUNDFONT_VOLUME_MULTIPLIER } from '../../assets/images'
import type { TimeSignature } from '../../types'
import { loadAbcjs } from './abcjs'

export interface SynthSpec {
  /** Playback ABC (no note names, pitches inside the soundfont range). */
  abc: string
  /** Milliseconds per measure at 100 %. */
  msPerMeasure: number
  timeSignature: TimeSignature
}

export interface RenderOptions {
  /** Percent. */
  speed: number
  metronome: boolean
  countIn: boolean
  /** Score seconds at 100 % (the buffer must reach the end of the last measure). */
  duration: number
}

export interface TuneRender {
  buffer: AudioBuffer
  /** Count-in length in buffer seconds (0 without count-in). */
  introSec: number
  /** speed / 100 */
  speedF: number
}

export async function renderTune(ctx: AudioContext, s: SynthSpec, o: RenderOptions): Promise<TuneRender> {
  const abcjs = await loadAbcjs()
  const speedF = o.speed / 100
  const msPerMeasure = s.msPerMeasure / speedF
  const options: SynthOptions = {
    soundFontUrl: getSoundFontUrl(),
    // abcjs boosts FluidR3 x3 only when it loads it from its own CDN; ours is local.
    soundFontVolumeMultiplier: SOUNDFONT_VOLUME_MULTIPLIER,
    program: 0,
  }
  if (o.metronome || o.countIn) {
    options.drum = METRONOME_DRUM[s.timeSignature]
    options.drumBars = 1
  }
  if (o.countIn) {
    options.drumIntro = 1
    // Count-in without metronome: abcjs turns the drum off after the intro bar.
    if (!o.metronome) options.drumOff = true
  }
  const visualObj = abcjs.parseOnly(s.abc)[0]
  const synth = new abcjs.synth.CreateSynth()
  const loading = await synth.init({ audioContext: ctx, visualObj, millisecondsPerMeasure: msPerMeasure, options })
  if (loading?.error?.length) console.warn('[viewer] missing samples', loading.error)
  await synth.prime()
  const raw = synth.getAudioBuffer()
  if (!raw) throw new Error('empty buffer')
  const introSec = o.countIn ? msPerMeasure / 1000 : 0
  // Loops wrap at the end of the last measure: make sure the buffer reaches it.
  const needed = introSec + o.duration / speedF
  let buffer = raw
  if (raw.duration < needed) {
    buffer = ctx.createBuffer(raw.numberOfChannels, Math.ceil(needed * raw.sampleRate) + 1, raw.sampleRate)
    for (let ch = 0; ch < raw.numberOfChannels; ch++) buffer.copyToChannel(raw.getChannelData(ch), ch)
  }
  return { buffer, introSec, speedF }
}
