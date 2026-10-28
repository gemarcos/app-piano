import { describe, expect, it } from 'vitest'
import { cbMean, finishEvents, segmentEvents, stitchSegment, viterbiBackward, type TkEvent } from './decode'
import { createFrontend, MELS, segmentFeatures, WINS, type FrontendSpec } from './frontend'

/** Score matrix [end][begin] for one symbol, everything at `fill` except the given entries. */
function scores(T: number, entries: [end: number, begin: number, value: number][], fill = -1): Float32Array {
  const S = new Float32Array(T * T).fill(fill)
  for (const [e, b, v] of entries) S[e * T + b] = v
  return S
}

describe('viterbiBackward', () => {
  it('finds nothing when every score is negative', () => {
    expect(viterbiBackward(scores(8, []), 0, 8, 0)).toEqual([])
  })

  it('picks the best non-overlapping intervals', () => {
    // [1, 4] (2) beats [1, 2] + [3, 4] (0.5 + 0.5); [4, 6] may start where [1, 4] ends.
    const S = scores(8, [[4, 1, 2], [2, 1, 0.5], [4, 3, 0.5], [6, 4, 1]])
    expect(viterbiBackward(S, 0, 8, 0)).toEqual([{ begin: 1, end: 4 }, { begin: 4, end: 6 }])
  })

  it('keeps single-frame events from positive diagonal scores and honours the forced start', () => {
    const S = scores(8, [[2, 2, 1], [5, 3, 1], [7, 7, 1]])
    expect(viterbiBackward(S, 0, 8, 0)).toEqual([{ begin: 2, end: 2 }, { begin: 3, end: 5 }, { begin: 7, end: 7 }])
    expect(viterbiBackward(S, 0, 8, 4)).toEqual([{ begin: 7, end: 7 }])
  })

  it('reads the symbol at its offset', () => {
    const T = 6
    const S = new Float32Array(2 * T * T).fill(-1)
    S.set(scores(T, [[3, 1, 1]]), T * T)
    expect(viterbiBackward(S, 0, T, 0)).toEqual([])
    expect(viterbiBackward(S, T * T, T, 0)).toEqual([{ begin: 1, end: 3 }])
  })
})

describe('cbMean', () => {
  it('is the ContinuousBernoulli mean, smooth across its Taylor branch', () => {
    expect(cbMean(0)).toBeCloseTo(0.5, 9)
    expect(cbMean(20)).toBeCloseTo(1 - 1 / 20, 4)
    expect(cbMean(-20)).toBeCloseTo(1 / 20, 4)
    const near = Math.log(0.499 / 0.501) // p = 0.499: the branch boundary
    expect(Math.abs(cbMean(near - 1e-6) - cbMean(near + 1e-6))).toBeLessThan(1e-6)
    expect(cbMean(1)).toBeGreaterThan(0.5)
  })
})

describe('segment events and stitching', () => {
  it('builds events with refined times, velocity argmax and presence flags', () => {
    const velocity = new Float32Array(2 * 128)
    velocity[90] = 5
    velocity[128 + 40] = 5
    // Zero logits: no refinement, onset / offset presence decided by position.
    const of = new Float32Array(2 * 4)
    const { events, lastP } = segmentEvents([[{ begin: 2, end: 5 }], [{ begin: 0, end: 10 }]], { velocity, of }, [60, 61], 0.1, 10)
    expect(events).toEqual([
      { symbol: 61, start: 0, end: 1, velocity: 40, hasOnset: false, hasOffset: false },
      { symbol: 60, start: expect.closeTo(0.2, 9), end: expect.closeTo(0.5, 9), velocity: 90, hasOnset: true, hasOffset: true },
    ])
    expect(lastP).toEqual([5, 0])
  })

  it('merges a note held across segments and drops unfinished ones', () => {
    const ev = (start: number, end: number, hasOnset: boolean, hasOffset: boolean): TkEvent => ({ symbol: 60, start, end, velocity: 64, hasOnset, hasOffset })
    const byType = new Map<number, TkEvent[]>()
    stitchSegment(byType, [ev(1, 16, true, false)])
    stitchSegment(byType, [ev(8, 20, false, true), ev(22, 24, true, true)])
    const out = finishEvents(byType)
    expect(out.map((e) => [e.start, e.end])).toEqual([[1, 20], [22, 24]])
  })

  it('resolves overlaps of the same symbol by cutting the earlier note', () => {
    const byType = new Map<number, TkEvent[]>([[60, [{ symbol: 60, start: 0, end: 2, velocity: 1, hasOnset: true, hasOffset: true }]], [62, []]])
    byType.get(60)!.push({ symbol: 60, start: 2.5, end: 3, velocity: 1, hasOnset: true, hasOffset: true })
    expect(finishEvents(byType).map((e) => e.end)).toEqual([2, 3])
  })
})

describe('front end', () => {
  const W = 64
  const hop = 16
  const rand = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5
  const r = rand(7)
  const spec: FrontendSpec = {
    fs: 1000,
    hop,
    window: W,
    segmentSeconds: 0.32,
    hopSeconds: 0.16,
    frames: 21,
    symbols: [60],
    eps: 1e-5,
    windows: Array.from({ length: WINS }, () => Array.from({ length: W }, () => r() + 0.6)),
    mel: Array.from({ length: MELS }, (_, m) => ({ start: m % 30, w: [0.5, 1, 0.25] })),
  }
  const fe = createFrontend(spec)
  const seg = Float32Array.from({ length: 320 }, () => 0.3 * r() + 0.01)

  it('matches a direct DFT with the gain normalization', () => {
    const { features } = segmentFeatures(fe, seg)
    const T = Math.ceil(seg.length / hop) + 1
    expect(features.length).toBe(T * MELS * WINS)
    const framed: number[][] = []
    for (let f = 0; f < T; f++) framed.push(Array.from({ length: W }, (_, i) => seg[f * hop - W / 2 + i] ?? 0))
    const flat = framed.flat()
    const mean = flat.reduce((a, b) => a + b, 0) / flat.length
    const std = Math.sqrt(flat.reduce((a, b) => a + (b - mean) ** 2, 0) / (flat.length - 1))
    for (const f of [0, 7, T - 1])
      for (const w of [0, 3, 5]) {
        const x = framed[f].map((v, i) => ((v - mean) / (std + 1e-8)) * spec.windows[w][i])
        const power = Array.from({ length: W / 2 + 1 }, (_, k) => {
          let re = 0
          let im = 0
          x.forEach((v, n) => {
            re += v * Math.cos((2 * Math.PI * k * n) / W)
            im -= v * Math.sin((2 * Math.PI * k * n) / W)
          })
          return (re * re + im * im) / W
        })
        for (const m of [0, 13, 200]) {
          const b = spec.mel[m]
          const mel = b.w.reduce((acc, wt, o) => acc + wt * power[b.start + o], 0)
          const expected = (Math.log(mel + spec.eps) - Math.log(spec.eps)) / -Math.log(spec.eps)
          expect(features[(f * MELS + m) * WINS + w]).toBeCloseTo(expected, 4)
        }
      }
  })

  it('gives the same features when the shared frames come from the previous segment', () => {
    const shift = 10
    const whole = Float32Array.from({ length: 480 }, () => 0.3 * r())
    const a = whole.slice(0, 320)
    const b = whole.slice(shift * hop, shift * hop + 320)
    const first = segmentFeatures(fe, a, undefined, shift)
    expect(first.carry.size).toBeGreaterThan(0)
    const reused = segmentFeatures(fe, b, first.carry, shift).features
    const direct = segmentFeatures(fe, b).features
    let maxDiff = 0
    for (let i = 0; i < direct.length; i++) maxDiff = Math.max(maxDiff, Math.abs(direct[i] - reused[i]))
    expect(maxDiff).toBeLessThan(1e-5)
  })
})
