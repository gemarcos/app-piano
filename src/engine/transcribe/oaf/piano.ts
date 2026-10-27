// Worker side of the piano model (Magenta's Onsets and Frames, vendored in this folder): device check, warm-up and a
// speed probe on a zero-weight copy of the network (shaders compile and the device is timed BEFORE the 15 MB
// download), the checkpoint download / cache, and the transcription itself. Imported only by worker.ts.
import * as tf from '@tensorflow/tfjs'
import type { NoteEvent } from '../../../types'
import { CHUNK_FRAMES, FRAME_SECONDS, SAMPLE_RATE } from './constants'
import { decodeActivations } from './decode'
import { setFusedLstm } from './lstm'
import { logMel, melFrameCount } from './mel'
import { OafNetwork } from './network'
import { loadCheckpoint, ModelDownloadError, readCachedJson, writeCachedJson } from './weights'
import { resampleBy } from '../tuning'
import type { PianoFallback, RawActivations } from '../protocol'

/** 'auto' needs the piano model to run at least this fast (seconds of audio per second of work, probe estimate). */
export const MIN_REALTIME_FACTOR = 1
/** Input rate of the transcriber (engine/audio MODEL_SAMPLE_RATE). */
const INPUT_RATE = 22050
const VERDICT_FILE = 'device-verdict.json'
/** Re-time the device after this long (drivers and browsers change). */
const VERDICT_MAX_AGE_MS = 30 * 24 * 3600 * 1000

interface Verdict {
  renderer: string
  /** Probe: milliseconds for one chunk (CHUNK_FRAMES frames) on the zero-weight network. */
  msPerChunk: number
  realtime: number
  ok: boolean
  at: number
}

export interface PianoDecodeOptions {
  onsetThreshold: number
  frameThreshold: number
  /** Seconds. */
  minDuration: number
}

/** Audio seconds per second of work predicted by a probe of `msPerChunk`. */
export function realtimeFactor(msPerChunk: number): number {
  return msPerChunk > 0 ? (CHUNK_FRAMES * FRAME_SECONDS * 1000) / msPerChunk : Infinity
}

/** Decides from a timing probe whether 'auto' may use the piano model. */
export function probeVerdict(msPerChunk: number): boolean {
  return realtimeFactor(msPerChunk) >= MIN_REALTIME_FACTOR
}

const zeroMel = () => new Float32Array(CHUNK_FRAMES * 229).fill(-100)

export class PianoModel {
  private network: OafNetwork | null = null
  private warmed = false
  private verdict: Verdict | null = null
  private broken = false
  /** Probe result of this session (ms per chunk), for diagnostics. */
  probeMs: number | null = null

  get ready(): boolean {
    return this.network !== null
  }

  /** The piano model failed at run time in this session: 'auto' stops trying it. */
  markBroken() {
    this.broken = true
    this.network?.dispose()
    this.network = null
  }

  dispose() {
    this.network?.dispose()
    this.network = null
  }

  /** Runs the network once on silence; on a WebGL failure retries with the plain (non-fused) LSTM. */
  private async warmUp(net: OafNetwork, onStep?: () => void): Promise<OafNetwork> {
    try {
      await net.run(zeroMel(), CHUNK_FRAMES, { onStep })
      return net
    } catch (err) {
      if (tf.getBackend() !== 'webgl') throw err
      console.warn('[Pauta] piano model: fused LSTM failed, using plain ops', err)
      net.dispose()
      setFusedLstm(false)
      const plain = OafNetwork.skeleton()
      await plain.run(zeroMel(), CHUNK_FRAMES, { onStep })
      return plain
    }
  }

  /**
   * Makes the piano model ready, or says why it cannot run. 'auto' requires WebGL 2 and a probe of at least
   * MIN_REALTIME_FACTOR (remembered per GPU in Cache Storage); 'piano' skips both checks. The checkpoint is
   * downloaded only after those checks; `onProgress` reports its bytes (0..1).
   */
  async prepare(
    mode: 'auto' | 'piano',
    base: string,
    renderer: string | undefined,
    onProgress?: (fraction: number) => void,
    onStep?: () => void,
  ): Promise<PianoFallback | null> {
    if (this.network) return null
    if (mode === 'auto') {
      if (this.broken) return 'run-failed'
      if (tf.getBackend() !== 'webgl' || tf.env().getNumber('WEBGL_VERSION') !== 2) return 'no-webgl2'
      const known = this.verdict ?? (await readCachedJson<Verdict>(base, VERDICT_FILE))
      if (known && known.renderer === (renderer ?? '') && Date.now() - known.at < VERDICT_MAX_AGE_MS) {
        this.verdict = known
        if (!known.ok) return 'slow'
      }
    }
    if (!this.warmed) {
      let skeleton: OafNetwork | null = null
      try {
        skeleton = await this.warmUp(OafNetwork.skeleton(), onStep)
        if (mode === 'auto' && !this.verdict) {
          const t0 = performance.now()
          await skeleton.run(zeroMel(), CHUNK_FRAMES, { onStep })
          const ms = performance.now() - t0
          this.probeMs = ms
          this.verdict = { renderer: renderer ?? '', msPerChunk: Math.round(ms), realtime: Math.round(realtimeFactor(ms) * 10) / 10, ok: probeVerdict(ms), at: Date.now() }
          void writeCachedJson(base, VERDICT_FILE, this.verdict)
          console.info(`[Pauta] piano model probe: ${Math.round(ms)} ms per chunk (${this.verdict.realtime}x real time)`)
          if (!this.verdict.ok) return 'slow'
        }
        this.warmed = true
      } catch (err) {
        console.warn('[Pauta] piano model warm-up failed', err)
        return 'load-failed'
      } finally {
        skeleton?.dispose()
      }
    }
    let weights: tf.NamedTensorMap
    try {
      weights = await loadCheckpoint(base, onProgress)
    } catch (err) {
      console.warn('[Pauta] piano model checkpoint unavailable', err)
      return err instanceof ModelDownloadError && err.offline ? 'offline' : 'load-failed'
    }
    try {
      this.network = new OafNetwork(weights)
      return null
    } catch (err) {
      console.warn('[Pauta] piano model build failed', err)
      return 'load-failed'
    } finally {
      tf.dispose(Object.values(weights))
    }
  }

  /**
   * Transcribes INPUT_RATE mono samples. `tuningCents` is compensated in the same resampling pass that brings the
   * audio to 16 kHz; note times come back in seconds of `samples`. `onProgress` gets 0..1 (per chunk).
   */
  async transcribe(
    samples: Float32Array,
    tuningCents: number,
    decode: PianoDecodeOptions,
    onProgress: (fraction: number) => void,
    onRaw?: (raw: RawActivations) => void,
    onStep?: () => void,
  ): Promise<NoteEvent[]> {
    const network = this.network
    if (!network) throw new Error('piano model not ready')
    const timeScale = 2 ** (-tuningCents / 1200)
    const input = resampleBy(samples, (INPUT_RATE / SAMPLE_RATE) * timeScale)
    const mel = logMel(input)
    const frames = melFrameCount(input.length)
    const activations = await network.run(mel, frames, { onChunk: (done, total) => onProgress(done / total), onStep })
    onRaw?.({ nFrames: frames, frames: activations.frame.slice(), onsets: activations.onset.slice(), velocities: activations.velocity.slice(), model: 'piano', timeScale })
    return decodeActivations(activations, { ...decode, timeScale })
  }
}
