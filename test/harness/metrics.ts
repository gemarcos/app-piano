// Note-level accuracy: exact pitch + onset within a tolerance, one-to-one matching (closest onsets first).

export interface TruthNote {
  pitch: number
  start: number
  duration: number
}

export interface DetectedNote {
  pitch: number
  start: number
  duration: number
  velocity?: number
}

export interface Metrics {
  truth: number
  detected: number
  tp: number
  fp: number
  fn: number
  precision: number
  recall: number
  f1: number
  /** Mean signed onset error of matched notes (detected - truth), ms. */
  onsetBiasMs: number
  /** Mean absolute onset error of matched notes, ms. */
  onsetMaeMs: number
  /** False positives that sit an octave (or two) away from a true note. */
  octaveErrors: number
  falsePositives: DetectedNote[]
  falseNegatives: TruthNote[]
}

export function evaluateNotes(detected: readonly DetectedNote[], truth: readonly TruthNote[], toleranceSec = 0.06): Metrics {
  const pairs: { d: number; t: number; dist: number }[] = []
  detected.forEach((dn, d) => {
    truth.forEach((tn, t) => {
      const dist = Math.abs(dn.start - tn.start)
      if (dn.pitch === tn.pitch && dist <= toleranceSec) pairs.push({ d, t, dist })
    })
  })
  pairs.sort((a, b) => a.dist - b.dist)
  const usedD = new Set<number>()
  const usedT = new Set<number>()
  let bias = 0
  let mae = 0
  for (const p of pairs) {
    if (usedD.has(p.d) || usedT.has(p.t)) continue
    usedD.add(p.d)
    usedT.add(p.t)
    const signed = detected[p.d].start - truth[p.t].start
    bias += signed
    mae += Math.abs(signed)
  }
  const tp = usedD.size
  const falsePositives = detected.filter((_, i) => !usedD.has(i))
  const falseNegatives = truth.filter((_, i) => !usedT.has(i))
  const octaveErrors = falsePositives.filter((fp) =>
    truth.some((tn) => [12, 24, -12, -24].includes(fp.pitch - tn.pitch) && Math.abs(fp.start - tn.start) <= toleranceSec),
  ).length
  const precision = detected.length ? tp / detected.length : truth.length ? 0 : 1
  const recall = truth.length ? tp / truth.length : 1
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  return {
    truth: truth.length,
    detected: detected.length,
    tp,
    fp: detected.length - tp,
    fn: truth.length - tp,
    precision,
    recall,
    f1,
    onsetBiasMs: tp ? (bias / tp) * 1000 : 0,
    onsetMaeMs: tp ? (mae / tp) * 1000 : 0,
    octaveErrors,
    falsePositives,
    falseNegatives,
  }
}
