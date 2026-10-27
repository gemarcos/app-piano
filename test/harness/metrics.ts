// Note-level accuracy: exact pitch + onset within a tolerance, one-to-one matching (closest onsets first),
// plus an error breakdown for the realistic benchmark (test/fixtures/real).

export interface TruthNote {
  pitch: number
  start: number
  duration: number
  /** Seconds until the string stops sounding (damper or pedal lift, re-strike or natural decay). */
  sounding?: number
  /** 0..1 (MIDI velocity / 127). */
  velocity?: number
  hand?: string
  role?: string
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

/** Where the errors come from (each false positive / negative is counted in exactly one class). */
export interface Breakdown {
  /** False negatives: nothing explains them. */
  missed: number
  /** False negatives whose onset falls inside an earlier detected note of the same pitch (re-strikes merged). */
  merged: number
  /** False positives an octave, a twelfth or two octaves away from a true onset (harmonic ghosts, octave errors). */
  octave: number
  /** False positives one semitone away from a true onset (tuning / pitch errors). */
  semitone: number
  /** False positives of a pitch that is still sounding in the truth (re-triggered or fragmented notes). */
  repeat: number
  /** Other false positives. */
  extra: number
  /** Matched notes whose offset is off by more than max(100 ms, 30 % of the sounding duration). */
  durationErrors: number
  /** ... of which too long (phantom tails) / too short. */
  tooLong: number
  tooShort: number
  /** Pearson correlation between detected and true velocities of matched notes (NaN without velocities). */
  velocityCorr: number
  /** Mean absolute velocity error after the best linear fit (scale-free loudness agreement). */
  velocityFitMae: number
  /** Recall per truth role (melody, arpeggio, accompaniment, bass, inner) and for soft notes (velocity < 0.35). */
  recallByRole: Record<string, { truth: number; tp: number }>
  soft: { truth: number; tp: number }
}

export type DetailedMetrics = Metrics & { breakdown: Breakdown }

function match(detected: readonly DetectedNote[], truth: readonly TruthNote[], toleranceSec: number) {
  const pairs: { d: number; t: number; dist: number }[] = []
  detected.forEach((dn, d) => {
    truth.forEach((tn, t) => {
      const dist = Math.abs(dn.start - tn.start)
      if (dn.pitch === tn.pitch && dist <= toleranceSec) pairs.push({ d, t, dist })
    })
  })
  pairs.sort((a, b) => a.dist - b.dist)
  const dToT = new Map<number, number>()
  const tToD = new Map<number, number>()
  for (const p of pairs) {
    if (dToT.has(p.d) || tToD.has(p.t)) continue
    dToT.set(p.d, p.t)
    tToD.set(p.t, p.d)
  }
  return { dToT, tToD }
}

export function evaluateNotes(detected: readonly DetectedNote[], truth: readonly TruthNote[], toleranceSec = 0.06): Metrics {
  const { dToT } = match(detected, truth, toleranceSec)
  let bias = 0
  let mae = 0
  for (const [d, t] of dToT) {
    const signed = detected[d].start - truth[t].start
    bias += signed
    mae += Math.abs(signed)
  }
  const tp = dToT.size
  const matchedT = new Set(dToT.values())
  const falsePositives = detected.filter((_, i) => !dToT.has(i))
  const falseNegatives = truth.filter((_, i) => !matchedT.has(i))
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

function pearson(a: number[], b: number[]): number {
  const n = a.length
  if (n < 3) return Number.NaN
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb)
    saa += (a[i] - ma) ** 2
    sbb += (b[i] - mb) ** 2
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : Number.NaN
}

/** evaluateNotes + the error breakdown (default tolerance 50 ms, the realistic benchmark's criterion). */
export function evaluateDetailed(detected: readonly DetectedNote[], truth: readonly TruthNote[], toleranceSec = 0.05): DetailedMetrics {
  const base = evaluateNotes(detected, truth, toleranceSec)
  const { dToT, tToD } = match(detected, truth, toleranceSec)
  const near = (fp: DetectedNote, intervals: number[]) =>
    truth.some((tn) => intervals.includes(fp.pitch - tn.pitch) && Math.abs(fp.start - tn.start) <= toleranceSec)
  const soundingEnd = (tn: TruthNote) => tn.start + (tn.sounding ?? tn.duration)
  const b: Breakdown = {
    missed: 0, merged: 0, octave: 0, semitone: 0, repeat: 0, extra: 0, durationErrors: 0, tooLong: 0, tooShort: 0,
    velocityCorr: Number.NaN, velocityFitMae: Number.NaN, recallByRole: {}, soft: { truth: 0, tp: 0 },
  }
  detected.forEach((dn, d) => {
    if (dToT.has(d)) return
    if (near(dn, [12, 24, 19, -12, -24])) b.octave++
    else if (near(dn, [1, -1])) b.semitone++
    else if (truth.some((tn) => tn.pitch === dn.pitch && dn.start > tn.start && dn.start < soundingEnd(tn))) b.repeat++
    else b.extra++
  })
  truth.forEach((tn, t) => {
    const role = tn.role ?? 'note'
    const entry = (b.recallByRole[role] ??= { truth: 0, tp: 0 })
    entry.truth++
    const soft = (tn.velocity ?? 1) < 0.35
    if (soft) b.soft.truth++
    if (tToD.has(t)) {
      entry.tp++
      if (soft) b.soft.tp++
      return
    }
    const covered = detected.some((dn) => dn.pitch === tn.pitch && dn.start < tn.start - toleranceSec && dn.start + dn.duration > tn.start + 0.02)
    if (covered) b.merged++
    else b.missed++
  })
  const vd: number[] = []
  const vt: number[] = []
  for (const [d, t] of dToT) {
    const dn = detected[d]
    const tn = truth[t]
    const trueDur = tn.sounding ?? tn.duration
    const err = dn.start + dn.duration - (tn.start + trueDur)
    if (Math.abs(err) > Math.max(0.1, 0.3 * trueDur)) {
      b.durationErrors++
      if (err > 0) b.tooLong++
      else b.tooShort++
    }
    if (dn.velocity !== undefined && tn.velocity !== undefined) {
      vd.push(dn.velocity)
      vt.push(tn.velocity)
    }
  }
  b.velocityCorr = pearson(vd, vt)
  if (vd.length >= 3) {
    const n = vd.length
    const mx = vd.reduce((s, v) => s + v, 0) / n
    const my = vt.reduce((s, v) => s + v, 0) / n
    let sxy = 0
    let sxx = 0
    for (let i = 0; i < n; i++) {
      sxy += (vd[i] - mx) * (vt[i] - my)
      sxx += (vd[i] - mx) ** 2
    }
    const slope = sxx > 0 ? sxy / sxx : 0
    b.velocityFitMae = vd.reduce((s, v, i) => s + Math.abs(my + slope * (v - mx) - vt[i]), 0) / n
  }
  return { ...base, breakdown: b }
}
