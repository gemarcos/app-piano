// Owner: engine-score. Sustain (damper) pedal inferred from raw notes.
//
// Fingers can hold a chord, or a note or two under a moving line (Bach's held bass and tenor);
// they cannot keep the notes of several earlier onsets ringing in the same register while new
// notes are played there. That is the pedal-down evidence: at an onset, at least three notes from
// at least two earlier onsets, within 19 semitones, still sound 0.2 s later. With the pedal down, the damper lift cuts every ringing note at once, so
// the notes of a pedalled stretch end together; when they end just after a new onset (the new
// harmony), the pedal changed there (legato pedalling). Stretches between changes that show the
// evidence become pedal spans; tick spans are snapped to the beat (or the eighth) grid.
import type { PedalSpan } from '../../types'
import { SIXTEENTH } from './constants'
import { CHORD_WINDOW, type SourceNote } from './quantize'

/** A pedal-down stretch in source seconds. */
export interface PedalSeconds {
  start: number
  end: number
}

/** A note must sound this long past a later onset to count as held over it. */
const HELD_PAST = 0.2
/** Same register: within this many semitones (an octave and a fifth) of the new notes. */
const NEAR = 19
/** Notes still ringing (from at least two earlier onsets) that fingers could not hold. */
const MIN_HELD = 3
/** Ends of notes released together by the damper fall within this window. */
const RELEASE_WINDOW = 0.12
/** A change happens at the onset that comes at most this long before the release. */
const CHANGE_LEAD = 0.6
/** Shortest pedal stretch kept. */
const MIN_SPAN = 0.25

interface Cluster {
  t: number
  lo: number
  hi: number
  /** Index of the first note of the cluster in the sorted note list. */
  first: number
  /** Notes in the cluster, sorted list indices first..first+size-1. */
  size: number
}

/** Pedal-down stretches of a performance (notes in seconds, any order). Never throws. */
export function inferPedalSeconds(source: SourceNote[]): PedalSeconds[] {
  const notes = source.filter((n) => Number.isFinite(n.start) && Number.isFinite(n.end) && n.end > n.start).sort((a, b) => a.start - b.start)
  if (notes.length < 4) return []
  const clusters: Cluster[] = []
  const clusterOf = new Array<number>(notes.length)
  for (let i = 0; i < notes.length; i++) {
    const last = clusters[clusters.length - 1]
    if (last && notes[i].start - last.t <= CHORD_WINDOW) {
      last.lo = Math.min(last.lo, notes[i].pitch)
      last.hi = Math.max(last.hi, notes[i].pitch)
      last.size++
    } else {
      clusters.push({ t: notes[i].start, lo: notes[i].pitch, hi: notes[i].pitch, first: i, size: 1 })
    }
    clusterOf[i] = clusters.length - 1
  }
  // 1. Evidence per cluster, and the notes held over later onsets.
  const evidence = new Array<boolean>(clusters.length).fill(false)
  const held = new Uint8Array(notes.length)
  let anyHeld = false
  const inCluster = (k: Cluster, pitch: number) => {
    for (let n = k.first; n < k.first + k.size; n++) if (notes[n].pitch === pitch) return true
    return false
  }
  let active: number[] = []
  const contributors: number[] = []
  let next = 0
  for (let c = 0; c < clusters.length; c++) {
    const k = clusters[c]
    while (next < notes.length && clusterOf[next] < c) active.push(next++)
    let w = 0
    for (let a = 0; a < active.length; a++) if (notes[active[a]].end >= k.t) active[w++] = active[a]
    active.length = w
    contributors.length = 0
    let first = -1
    let two = false
    for (const a of active) {
      const n = notes[a]
      if (n.end < k.t + HELD_PAST || inCluster(k, n.pitch)) continue
      if (n.pitch < k.lo - NEAR || n.pitch > k.hi + NEAR) continue
      if (first < 0) first = clusterOf[a]
      else if (clusterOf[a] !== first) two = true
      contributors.push(a)
    }
    if (two && contributors.length >= MIN_HELD) {
      evidence[c] = true
      anyHeld = true
      for (const a of contributors) held[a] = 1
    }
  }
  active = []
  if (!anyHeld) return []
  // 2. Releases: ends of held notes from at least two onsets falling together.
  const ends: { t: number; c: number }[] = []
  for (let n = 0; n < notes.length; n++) if (held[n]) ends.push({ t: notes[n].end, c: clusterOf[n] })
  ends.sort((a, b) => a.t - b.t)
  const releases: number[] = []
  let i = 0
  while (i < ends.length) {
    let j = i
    const from = new Set<number>([ends[i].c])
    while (j + 1 < ends.length && ends[j + 1].t - ends[i].t <= RELEASE_WINDOW) from.add(ends[++j].c)
    if (from.size >= 2) releases.push(ends[Math.floor((i + j) / 2)].t)
    i = j + 1
  }
  // 3. Change points: the onset shortly before each release whose notes outlive it (the new harmony,
  //    lowest bass first), or, when no such onset exists, the release itself (a plain lift).
  const clusterEnd = clusters.map((k) => {
    let end = 0
    for (let n = k.first; n < k.first + k.size; n++) end = Math.max(end, notes[n].end)
    return end
  })
  const firstAtOrAfter = (t: number) => {
    let lo = 0
    let hi = clusters.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (clusters[mid].t < t) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const changes: number[] = []
  for (const r of releases) {
    let best = -1
    for (let c = firstAtOrAfter(r - CHANGE_LEAD); c < clusters.length && clusters[c].t <= r + 0.05; c++) {
      if (clusterEnd[c] <= r + HELD_PAST) continue
      if (best < 0 || clusters[c].lo < clusters[best].lo) best = c
    }
    changes.push(best >= 0 ? clusters[best].t : r)
  }
  const bounds = [...new Set(changes)].sort((a, b) => a - b).filter((t, n, arr) => n === 0 || t - arr[n - 1] > 0.15)
  // 4. Stretches between changes that show the evidence.
  let lastEnd = 0
  for (const n of notes) if (n.end > lastEnd) lastEnd = n.end
  const edges = [clusters[0].t, ...bounds.filter((t) => t > clusters[0].t + 0.05), lastEnd]
  const out: PedalSeconds[] = []
  for (let e = 0; e + 1 < edges.length; e++) {
    const a = edges[e]
    const b = edges[e + 1]
    let hits = 0
    let onsets = 0
    let start = Infinity
    for (let c = firstAtOrAfter(a - 1e-6); c < clusters.length && clusters[c].t < b - 1e-6; c++) {
      onsets++
      if (evidence[c]) hits++
      start = Math.min(start, clusters[c].t)
    }
    if (onsets === 0 || hits === 0 || (onsets > 3 && hits < 2)) continue
    // The stretch starts at its first onset; at a change point that is the change itself.
    const s = Math.max(a, Math.min(start, b))
    if (b - s >= MIN_SPAN) out.push({ start: s, end: b })
  }
  return out
}

/**
 * Pedal stretches in seconds -> Score.pedals: absolute ticks through `toTick` (score tick, measure
 * shift included), boundaries snapped to the beat when within a sixteenth of it, else to the
 * eighth; sorted, non-overlapping (a span may end where the next starts: a pedal change), clipped
 * to [0, totalTicks], at least an eighth long.
 */
export function pedalTicks(spans: PedalSeconds[], toTick: (seconds: number) => number, beatTicks: number, totalTicks: number): PedalSpan[] {
  const snap = (x: number) => {
    const beat = Math.round(x / beatTicks) * beatTicks
    return Math.abs(beat - x) <= SIXTEENTH ? beat : Math.round(x / (2 * SIXTEENTH)) * 2 * SIXTEENTH
  }
  const out: PedalSpan[] = []
  for (const s of spans) {
    let start = Math.max(0, snap(toTick(s.start)))
    const end = Math.min(totalTicks, snap(toTick(s.end)))
    const prev = out[out.length - 1]
    if (prev && start < prev.end) start = prev.end
    if (end - start < 2 * SIXTEENTH) continue
    out.push({ start, end })
  }
  return out
}
