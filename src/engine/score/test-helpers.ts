// Owner: engine-score. Deterministic synthetic note streams for the engine tests (not used by the app).
import type { KeyMode, NoteEvent } from '../../types'

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type StreamStyle = 'melody' | 'chords' | 'arpeggio' | 'waltz'

export interface StreamOptions {
  bpm: number
  style: StreamStyle
  bars?: number
  /** Uniform onset jitter, +- milliseconds. */
  jitterMs?: number
  seed?: number
  /** Tonic pitch class (0 = C). */
  tonic?: number
  mode?: KeyMode
  /** Seconds before the first downbeat. */
  lead?: number
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11]

/**
 * A plausible piano texture: I-IV-V-I (major) or i-iv-V-i (harmonic minor) progressions, bass
 * on strong beats, a melody mostly in quarters with some eighths and half notes, metric accents.
 */
export function makeStream(o: StreamOptions): NoteEvent[] {
  const rand = rng(o.seed ?? 1)
  const meter = o.style === 'waltz' ? 3 : 4
  const bars = o.bars ?? 12
  const beat = 60 / o.bpm
  const jitter = (o.jitterMs ?? 0) / 1000
  const tonic = o.tonic ?? 0
  const scale = (o.mode ?? 'major') === 'minor' ? HARMONIC_MINOR : MAJOR
  const lead = o.lead ?? 0.25
  const out: NoteEvent[] = []
  const add = (pitch: number, beatPos: number, beats: number, velocity: number) => {
    const j = (rand() * 2 - 1) * jitter
    out.push({ pitch, start: Math.max(0, lead + beatPos * beat + j), duration: beats * beat * 0.92, velocity })
  }
  // Scale degrees (0-based) of the chord roots: I IV V I.
  const progression = [0, 3, 4, 0]
  const deg = (d: number, octave: number) => {
    const i = ((d % 7) + 7) % 7
    return 12 * (octave + 1) + tonic + scale[i] + 12 * Math.floor(d / 7)
  }
  for (let bar = 0; bar < bars; bar++) {
    const root = progression[bar % progression.length]
    const t0 = bar * meter
    const triad = [root, root + 2, root + 4]
    // Left hand
    if (o.style === 'waltz') {
      add(deg(root, 2), t0, 1, 0.85)
      for (const b of [1, 2]) for (const d of triad) add(deg(d, 3), t0 + b, 0.8, 0.55)
    } else if (o.style === 'chords') {
      for (let b = 0; b < meter; b++) {
        const v = b === 0 ? 0.9 : b === 2 ? 0.78 : 0.68
        add(deg(root, 2), t0 + b, 1, v)
        for (const d of triad) add(deg(d, 3), t0 + b, 1, v - 0.08)
      }
    } else if (o.style === 'arpeggio') {
      const figure = [root, root + 4, root + 7, root + 4]
      for (let e = 0; e < meter * 2; e++) add(deg(figure[e % 4], 2), t0 + e / 2, 0.5, e === 0 ? 0.85 : e % 2 === 0 ? 0.7 : 0.58)
    } else {
      add(deg(root, 2), t0, 2, 0.85)
      add(deg(root + 4, 2), t0 + 2, 2, 0.72)
    }
    // Right hand melody: chord tones on strong beats, stepwise elsewhere.
    let b = 0
    let d = triad[Math.floor(rand() * 3)] + 7
    while (b < meter) {
      const r = rand()
      const strong = b === 0
      let len = r < 0.6 ? 1 : r < 0.85 ? 0.5 : 2
      if (b + len > meter) len = meter - b
      if (len === 0.5) {
        add(deg(d, 4), t0 + b, 0.5, strong ? 0.85 : 0.66)
        d += rand() < 0.5 ? 1 : -1
        add(deg(d, 4), t0 + b + 0.5, 0.5, 0.6)
        b += 1
      } else {
        add(deg(d, 4), t0 + b, len, strong ? 0.88 : 0.72)
        b += len
      }
      d = Math.max(4, Math.min(12, d + (rand() < 0.5 ? 1 : -1) * (rand() < 0.7 ? 1 : 2)))
    }
  }
  // Final tonic chord.
  const tEnd = bars * meter
  add(deg(0, 2), tEnd, meter, 0.85)
  add(deg(0, 4), tEnd, meter, 0.85)
  add(deg(2, 4), tEnd, meter, 0.75)
  add(deg(4, 4), tEnd, meter, 0.75)
  return out.sort((a, b) => a.start - b.start)
}
