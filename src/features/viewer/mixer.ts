// Owner: piano-sound. The sample mixer behind synth.ts, on plain typed arrays (no Web Audio, unit
// tested): each voice reads its sample with 4-point Hermite interpolation at its playback rate, at a
// constant gain until its damper time, then decays exponentially (no hard cut, no click).
// An OfflineAudioContext did the same job ~10x slower (Chrome spends ~6 us per voice per 128-frame
// block), which made long or slowed-down pieces wait seconds; this mixer renders them in a fraction.

/** Sample data: float, or 16-bit integers (half the memory) read through `scale`. */
export type SampleData = Float32Array | Int16Array

/** A decoded sample: its channels (1 or 2) and the frame where playback starts. */
export interface MixSample {
  channels: readonly SampleData[]
  /** Frame to start reading at (just before the hammer). */
  offset: number
  /** Multiplier from stored values to [-1, 1] (1 / 32768 for Int16 data). Default 1. */
  scale?: number
}

export interface MixVoice {
  sample: MixSample
  /** Output frame of the onset (fractional). */
  start: number
  /** Sample frames advanced per output frame (pitch shift). */
  rate: number
  /** Linear gain. */
  gain: number
  /** Output frame where the damper acts (Infinity: plays to the end of the sample). */
  release: number
  /** Damping time constant in output frames. */
  tau: number
  /** One-pole low-pass coefficient (0..1] that darkens the tone of softer notes; 1 or absent = off. */
  lowpass?: number
}

/** Damped voices stop at release + this many time constants (about -70 dB). */
export const TAU_SPAN = 8

/**
 * Adds frames [from, to) of one channel: Hermite-interpolated reads from `pos` stepping `rate`,
 * gain `g` multiplied by `k` after every frame.
 */
function run(src: SampleData, out: Float32Array, from: number, to: number, pos: number, rate: number, g: number, k: number): void {
  for (let n = from; n < to; n++) {
    const i = pos | 0
    const f = pos - i
    const xm = src[i > 0 ? i - 1 : 0]
    const x0 = src[i]
    const x1 = src[i + 1]
    const x2 = src[i + 2]
    out[n] += (((((x2 - xm) * 0.5 + (x0 - x1) * 1.5) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + (x1 - xm) * 0.5) * f + x0) * g
    pos += rate
    g *= k
  }
}

/** The same through a one-pole low-pass (coefficient `a`, state `y`); returns the filter state. */
function runLowpass(src: SampleData, out: Float32Array, from: number, to: number, pos: number, rate: number, g: number, k: number, a: number, y: number): number {
  for (let n = from; n < to; n++) {
    const i = pos | 0
    const f = pos - i
    const xm = src[i > 0 ? i - 1 : 0]
    const x0 = src[i]
    const x1 = src[i + 1]
    const x2 = src[i + 2]
    y += ((((((x2 - xm) * 0.5 + (x0 - x1) * 1.5) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + (x1 - xm) * 0.5) * f + x0) - y) * a
    out[n] += y * g
    pos += rate
    g *= k
  }
  return y
}

/** Mixes one voice into `out` ([left, right]); frames outside `out` are skipped. */
export function mixVoice(out: readonly Float32Array[], v: MixVoice): void {
  const L = v.sample.channels[0]
  const R = v.sample.channels[1] ?? L
  const outL = out[0]
  const outR = out[1] ?? out[0]
  const frames = outL.length
  const n0 = Math.max(0, Math.ceil(v.start))
  if (n0 >= frames || !(v.rate > 0)) return
  const rate = v.rate
  const pos0 = v.sample.offset + (n0 - v.start) * rate
  // Last position we can interpolate (needs i + 2).
  const lastPos = L.length - 3
  if (pos0 > lastPos) return
  let nEnd = Math.min(frames, n0 + Math.floor((lastPos - pos0) / rate) + 1)
  const gain = v.gain * (v.sample.scale ?? 1)
  const damped = Number.isFinite(v.release)
  const tau = Math.max(1, v.tau)
  if (damped) nEnd = Math.min(nEnd, Math.ceil(v.release + TAU_SPAN * tau))
  // Before the damper: constant gain. After it: an exponential decay that starts exactly at the
  // (fractional) release frame.
  const nRel = damped ? Math.min(nEnd, Math.max(n0, Math.ceil(v.release))) : nEnd
  const posRel = pos0 + (nRel - n0) * rate
  const gRel = damped ? gain * Math.exp(-(nRel - v.release) / tau) : 0
  const k = Math.exp(-1 / tau)
  const a = v.lowpass ?? 1
  if (a < 0.999) {
    // Filtered: the state carries over from the held part into the release.
    let yl = 0
    let yr = 0
    if (nRel > n0) {
      yl = runLowpass(L, outL, n0, nRel, pos0, rate, gain, 1, a, yl)
      if (outR !== outL) yr = runLowpass(R, outR, n0, nRel, pos0, rate, gain, 1, a, yr)
    }
    if (nEnd > nRel) {
      runLowpass(L, outL, nRel, nEnd, posRel, rate, gRel, k, a, yl)
      if (outR !== outL) runLowpass(R, outR, nRel, nEnd, posRel, rate, gRel, k, a, yr)
    }
    return
  }
  if (nRel > n0) {
    run(L, outL, n0, nRel, pos0, rate, gain, 1)
    if (outR !== outL) run(R, outR, n0, nRel, pos0, rate, gain, 1)
  }
  if (nEnd > nRel) {
    run(L, outL, nRel, nEnd, posRel, rate, gRel, k)
    if (outR !== outL) run(R, outR, nRel, nEnd, posRel, rate, gRel, k)
  }
}

/**
 * Loudness of a mix in dB: mean power of 400 ms blocks, ignoring silence (below -70 dB) and blocks
 * more than 10 dB under the average (an EBU R128-style gate, without the K-weighting).
 */
export function gatedLevelDb(channels: readonly Float32Array[], sampleRate: number): number {
  const block = Math.max(1, Math.round(0.4 * sampleRate))
  const powers: number[] = []
  for (let s = 0; s + block <= channels[0].length; s += block) {
    let e = 0
    for (const x of channels) for (let i = s; i < s + block; i++) e += x[i] * x[i]
    const p = e / (block * channels.length)
    if (p > 1e-7) powers.push(p)
  }
  if (!powers.length) return -Infinity
  const mean = powers.reduce((a, b) => a + b, 0) / powers.length
  const kept = powers.filter((p) => p > mean * 0.1)
  return 10 * Math.log10(kept.reduce((a, b) => a + b, 0) / kept.length)
}

/** Multiplies every channel by `gain`, in place. */
export function scale(channels: readonly Float32Array[], gain: number): void {
  if (gain === 1) return
  for (const x of channels) for (let i = 0; i < x.length; i++) x[i] *= gain
}

/** Soft limiter: untouched below the knee, peaks bent smoothly toward 1.0 (never a hard clip). */
export function softLimit(channels: readonly Float32Array[], knee = 0.89): void {
  const room = 1 - knee
  for (const x of channels)
    for (let i = 0; i < x.length; i++) {
      const v = x[i]
      const a = v < 0 ? -v : v
      if (a > knee) x[i] = (v < 0 ? -1 : 1) * (knee + room * Math.tanh((a - knee) / room))
    }
}

/**
 * Copies `length` frames from `start` of `src` into `dst` and adds everything after them, wrapped,
 * onto the copy: a seamless cycle whose end flows into its start.
 */
export function foldInto(dst: readonly Float32Array[], src: readonly Float32Array[], start: number): void {
  for (let c = 0; c < dst.length; c++) {
    const to = dst[c]
    const from = src[c] ?? src[0]
    const n = to.length
    to.fill(0)
    for (let i = start, j = 0; i < from.length; i++, j++) {
      if (j === n) j = 0
      to[j] += from[i]
    }
  }
}

/** Float samples as 16-bit integers (the source recordings are 16-bit: nothing audible is lost). */
export function toInt16(x: Float32Array): Int16Array {
  const out = new Int16Array(x.length)
  for (let i = 0; i < x.length; i++) {
    const v = Math.round(x[i] * 32768)
    out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v
  }
  return out
}

/**
 * Runs `work` over the items, yielding to the event loop every ~16 ms so the page stays responsive.
 * Throws 'cancelled' when `isCancelled` turns true at a yield.
 */
export async function inSlices<T>(items: readonly T[], work: (item: T) => void, isCancelled: () => boolean = () => false): Promise<void> {
  let t0 = now()
  for (let i = 0; i < items.length; i++) {
    work(items[i])
    if ((i & 3) === 3 && now() - t0 > 16) {
      await yieldToEventLoop()
      if (isCancelled()) throw new Error('cancelled')
      t0 = now()
    }
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** A macrotask without setTimeout's 4 ms clamp (MessageChannel), falling back to setTimeout. */
function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((resolve) => setTimeout(resolve, 0))
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      ch.port1.close()
      resolve()
    }
    ch.port2.postMessage(0)
  })
}
