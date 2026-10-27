// Owner: piano-sound. A soft concert-room reverb for the piano: a generated (not recorded) stereo
// impulse response: a few early reflections, then a decorrelated noise tail that decays
// exponentially and darkens over time, with the low end thinned so the bass stays clear.
// Deterministic (seeded), so every render of a score is identical.

export const ROOM = {
  /** Impulse response length, seconds. */
  seconds: 2.2,
  /** Time to decay by 60 dB, seconds. */
  rt60: 1.7,
  predelay: 0.012,
  /** Wet level relative to the dry piano (the impulse response has unit energy). */
  wetDb: -14,
} as const

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The impulse response samples for one channel (unnormalized). */
export function roomChannel(sampleRate: number, seed: number): Float32Array<ArrayBuffer> {
  const n = Math.round(ROOM.seconds * sampleRate)
  const out = new Float32Array(n)
  const rand = mulberry32(seed)
  const pre = Math.round(ROOM.predelay * sampleRate)
  // Early reflections (8-80 ms after the pre-delay).
  for (let k = 0; k < 14; k++) {
    const t = 0.008 + rand() * 0.072
    const i = pre + Math.round(t * sampleRate)
    if (i < n) out[i] += (rand() < 0.5 ? -1 : 1) * (0.25 + 0.5 * rand()) * Math.exp(-t / 0.06)
  }
  // Late tail: noise with an exponential decay that builds up over the first 60 ms.
  const decay = 6.907755 / ROOM.rt60
  let lp = 0
  let hpIn = 0
  let hpOut = 0
  const hpA = Math.exp((-2 * Math.PI * 160) / sampleRate)
  for (let i = pre; i < n; i++) {
    const t = (i - pre) / sampleRate
    const env = Math.exp(-decay * t) * Math.min(1, t / 0.06) * 0.35
    const x = (rand() * 2 - 1) * env
    // Darkens over time: low-pass cutoff glides from ~9 kHz to ~2 kHz.
    const fc = 2000 + 7000 * Math.exp(-t / 0.45)
    const a = 1 - Math.exp((-2 * Math.PI * Math.min(fc, sampleRate * 0.45)) / sampleRate)
    lp += a * (x - lp)
    out[i] += lp
  }
  // Thin the low end (one-pole high-pass ~160 Hz) so the bass does not boom.
  for (let i = 0; i < n; i++) {
    const x = out[i]
    hpOut = hpA * (hpOut + x - hpIn)
    hpIn = x
    out[i] = hpOut
  }
  // Fade the last 5 % to exact silence.
  const fade = Math.round(n * 0.05)
  for (let i = n - fade; i < n; i++) out[i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i - (n - fade))) / fade)
  return out
}

const cache = new Map<number, Float32Array<ArrayBuffer>[]>()

/**
 * Connects `from` to the destination through the room: the dry signal plus the reverb at ROOM.wetDb.
 * Returns the nodes it created (to disconnect them).
 */
export function connectRoom(ctx: BaseAudioContext, from: AudioNode, to: AudioNode = ctx.destination): AudioNode[] {
  const conv = ctx.createConvolver()
  conv.normalize = false
  conv.buffer = roomImpulse(ctx)
  const wet = ctx.createGain()
  wet.gain.value = 10 ** (ROOM.wetDb / 20)
  from.connect(to)
  from.connect(conv).connect(wet).connect(to)
  return [conv, wet]
}

/** A rendered (dry) buffer with the room applied, rendered offline (used for previews and checks). */
export async function withRoom(buffer: AudioBuffer): Promise<AudioBuffer> {
  const octx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length + Math.round(ROOM.seconds * buffer.sampleRate), buffer.sampleRate)
  const src = octx.createBufferSource()
  src.buffer = buffer
  connectRoom(octx, src)
  src.start()
  return octx.startRendering()
}

/** Stereo impulse response normalized to unit energy per channel (cached per sample rate). */
export function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  let chans = cache.get(ctx.sampleRate)
  if (!chans) {
    chans = [roomChannel(ctx.sampleRate, 0x5eed1), roomChannel(ctx.sampleRate, 0x5eed2)]
    for (const ch of chans) {
      let e = 0
      for (let i = 0; i < ch.length; i++) e += ch[i] * ch[i]
      const g = 1 / Math.sqrt(e || 1)
      for (let i = 0; i < ch.length; i++) ch[i] *= g
    }
    cache.set(ctx.sampleRate, chans)
  }
  const buf = ctx.createBuffer(2, chans[0].length, ctx.sampleRate)
  chans.forEach((ch, c) => buf.copyToChannel(ch, c))
  return buf
}
