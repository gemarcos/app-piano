/**
 * Transkun V2 decoding (Yujia Yan, github.com/Yujia-Yan/Transkun, MIT License, Copyright (c) 2021 Yujia Yan),
 * reimplemented for the Pauta app (2026) from transkun/CRF/NeuralSemiCRFInterval.py (viterbiBackward) and
 * transkun/ModelTransformer.py (transcribeFrames, transcribe) plus Data.resolveOverlapping: a semi-Markov Viterbi
 * picks non-overlapping [begin, end] intervals per symbol (each key, the sustain pedal -64 and the soft pedal -67)
 * from the interval score matrix; the heads refine both ends (ContinuousBernoulli mean) and give the velocity; the
 * 16 s segments (8 s hop) are stitched exactly like the official transcribe(). Pure code, no ONNX.
 */

export interface Interval {
  begin: number
  end: number
}

/**
 * Backward Viterbi for one symbol. `S` holds scores [end][begin] (row-major, size T x T) at `offset`; noise scores
 * are zero in Transkun V2. `start` is the forced start position. Ties go to "skip", as torch.max does.
 */
export function viterbiBackward(S: Float32Array, offset: number, T: number, start: number): Interval[] {
  const q = new Float64Array(T)
  const ptr = new Int32Array(T)
  const diag = (i: number) => S[offset + i * T + i]
  const dLast = diag(T - 1)
  q[T - 1] = dLast > 0 ? dLast : 0
  for (let b = T - 2; b >= 0; b--) {
    let best = q[b + 1]
    let sel = -1
    for (let e = b + 1; e < T; e++) {
      const v = q[e] + S[offset + e * T + b]
      if (v > best) {
        best = v
        sel = e - b - 1
      }
    }
    ptr[b] = sel
    const d = diag(b)
    q[b] = best + (d > 0 ? d : 0)
  }
  const out: Interval[] = []
  let j = start
  while (j < T - 1) {
    if (diag(j) > 0) out.push({ begin: j, end: j })
    if (ptr[j] < 0) j += 1
    else {
      const e = ptr[j] + j + 1
      out.push({ begin: j, end: e })
      j = e
    }
  }
  if (dLast > 0) out.push({ begin: T - 1, end: T - 1 })
  return out
}

/** torch.distributions.ContinuousBernoulli(logits).mean, with its Taylor branch near p = 0.5. */
export function cbMean(logit: number): number {
  const p = 1 / (1 + Math.exp(-logit))
  const outside = p <= 0.499 || p > 0.501
  if (!outside) {
    const x = p - 0.5
    return 0.5 + (1 / 3 + (16 / 45) * x * x) * x
  }
  return p / (2 * p - 1) + 1 / (Math.log1p(-p) - Math.log(p))
}

/** One event as transcribeFrames builds it (seconds within the segment until stitched). */
export interface TkEvent {
  symbol: number
  start: number
  end: number
  /** 0..127 (argmax of the velocity head). */
  velocity: number
  hasOnset: boolean
  hasOffset: boolean
}

export interface HeadOutputs {
  /** [N, 128] velocity logits. */
  velocity: Float32Array
  /** [N, 4]: refined onset / offset logits, then onset / offset presence logits. */
  of: Float32Array
}

/**
 * Events of one segment from its decoded intervals (per symbol, in symbol order) and the heads' outputs (one row per
 * interval in the same order). Returns the events (sorted like the original) and, per symbol, the last interval end
 * that has an offset (the next segment's forced start, see stitchSegment).
 */
export function segmentEvents(paths: Interval[][], heads: HeadOutputs, symbols: number[], frameDur: number, lastFrameIdx: number) {
  const events: TkEvent[] = []
  const lastP: number[] = []
  let c = 0
  for (let s = 0; s < symbols.length; s++) {
    let lastEnd = 0
    let curLast = 0
    for (const iv of paths[s]) {
      let best = 0
      for (let v = 1; v < 128; v++) if (heads.velocity[c * 128 + v] > heads.velocity[c * 128 + best]) best = v
      const refine = (logit: number) => Math.min(0.5, Math.max(-0.5, (cbMean(logit) - 0.5) / 0.99))
      let start = (iv.begin + refine(heads.of[c * 4])) * frameDur
      let end = (iv.end + refine(heads.of[c * 4 + 1])) * frameDur
      const hasOnset = iv.begin > 0 || heads.of[c * 4 + 2] > 0
      const hasOffset = iv.end < lastFrameIdx || heads.of[c * 4 + 3] > 0
      start = Math.max(start, lastEnd)
      end = Math.max(end, start + 1e-8)
      lastEnd = end
      events.push({ symbol: symbols[s], start, end, velocity: best, hasOnset, hasOffset })
      if (hasOffset) curLast = iv.end
      c++
    }
    lastP.push(curLast)
  }
  events.sort((a, b) => a.start - b.start || a.end - b.end || a.symbol - b.symbol)
  return { events, lastP }
}

/** Stitches one segment's events (already shifted to absolute seconds) into `byType`, as transcribe() does. */
export function stitchSegment(byType: Map<number, TkEvent[]>, events: TkEvent[]) {
  for (const e of events) {
    let list = byType.get(e.symbol)
    if (!list) byType.set(e.symbol, (list = []))
    const last = list[list.length - 1]
    if (last && e.start < last.end) {
      if (e.hasOnset) list[list.length - 1] = e
      else {
        last.hasOffset = e.hasOffset
        last.end = Math.max(e.end, last.end)
      }
      continue
    }
    if (e.hasOnset) list.push(e)
  }
}

/** Final pass of transcribe(): close the last event of each symbol, drop open ones, resolveOverlapping. */
export function finishEvents(byType: Map<number, TkEvent[]>): TkEvent[] {
  for (const list of byType.values()) if (list.length) list[list.length - 1].hasOffset = true
  const all = [...byType.values()].flat().filter((e) => e.hasOffset)
  all.sort((a, b) => a.start - b.start || a.end - b.end || a.symbol - b.symbol)
  const lastIdx = new Map<number, number>()
  all.forEach((e, i) => {
    const prev = lastIdx.get(e.symbol)
    if (prev !== undefined && all[prev].end > e.start) all[prev].end = e.start
    lastIdx.set(e.symbol, i)
  })
  return all.filter((e) => e.start < e.end)
}
