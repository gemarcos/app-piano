// Owner: engine-score. Key estimation: pitch-class histogram (duration x velocity) correlated with
// Temperley (Kostka-Payne) key profiles, best of 24.
import type { AnalysisResult, KeyMode, NoteEvent } from '../../types'
import { keyFromFifths, keyFromPc, mod } from './keys'

const MAJOR_PROFILE = [0.748, 0.06, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057, 0.4]
const MINOR_PROFILE = [0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133, 0.33]

function pearson(a: number[], b: number[]): number {
  const n = a.length
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Best of 24 keys; confidence grows with the margin over the runner-up and the best correlation. */
export function estimateKey(notes: NoteEvent[]): Pick<AnalysisResult, 'key' | 'keyConfidence'> {
  const hist = new Array<number>(12).fill(0)
  for (const n of notes) hist[mod(n.pitch, 12)] += clamp(n.duration, 0.05, 2) * Math.max(0.05, n.velocity)
  if (hist.every((v) => v === hist[0])) return { key: keyFromFifths(0, 'major'), keyConfidence: 0 }
  const scored: { pc: number; mode: KeyMode; r: number }[] = []
  for (let pc = 0; pc < 12; pc++) {
    const rotated = hist.map((_, i) => hist[(i + pc) % 12])
    scored.push({ pc, mode: 'major', r: pearson(rotated, MAJOR_PROFILE) })
    scored.push({ pc, mode: 'minor', r: pearson(rotated, MINOR_PROFILE) })
  }
  scored.sort((a, b) => b.r - a.r)
  const [first, second] = scored
  const confidence = clamp((first.r - second.r) / 0.15, 0, 1) * clamp(first.r / 0.6, 0, 1)
  return { key: keyFromPc(first.pc, first.mode), keyConfidence: Math.round(confidence * 100) / 100 }
}
