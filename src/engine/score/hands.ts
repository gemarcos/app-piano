// Owner: engine-score. Which hand plays each note, and the clef of each staff.
//
// 'fixed': pitch >= splitPoint goes right (plus a small chord heuristic): the manual override.
// 'auto' : a beam search over the onsets in time order. Each onset group (one chord) is cut into a
// lower part (left hand) and an upper part (right hand); the cost favours hand spans within an
// octave, small hand movements, no crossing, fast single-note figures (arpeggios, runs) kept in
// one hand, and only gently the split point. So a melody over a high accompaniment (both above
// middle C) still gets two hands, and an arpeggio sweeping across the split stays in its hand.
import type { QNote } from './quantize'

/** Pitch gap (semitones) that separates two clusters of simultaneous notes. */
const CLUSTER_GAP = 7

/**
 * pitch >= splitPoint goes right. Light heuristic: a cluster of simultaneous notes that straddles
 * the split, whose minority-hand notes are all within 2 semitones of it, stays in its majority hand.
 */
export function assignHands(notes: QNote[], splitPoint: number): void {
  for (const n of notes) n.right = n.pitch >= splitPoint
  let g = 0
  while (g < notes.length) {
    let e = g + 1
    while (e < notes.length && notes[e].on === notes[g].on) e++
    if (e - g >= 3) {
      let start = g
      for (let i = g + 1; i <= e; i++) {
        if (i < e && notes[i].pitch - notes[i - 1].pitch <= CLUSTER_GAP) continue
        fixCluster(notes.slice(start, i), splitPoint)
        start = i
      }
    }
    g = e
  }
}

function fixCluster(cluster: QNote[], split: number): void {
  let right = 0
  for (const n of cluster) if (n.right) right++
  const left = cluster.length - right
  if (right === 0 || left === 0 || right === left) return
  const toRight = right > left
  const minority = cluster.filter((n) => n.right !== toRight)
  const near = minority.every((n) => (toRight ? n.pitch >= split - 2 : n.pitch <= split + 1))
  if (near) for (const n of minority) n.right = toRight
}

// ---------------------------------------------------------------- auto

const W_SPAN = 1.5 // per semitone of one hand's chord beyond an octave
const W_STRETCH = 6 // per semitone beyond a tenth plus a bit (15)
const W_FINGERS = 25 // per note beyond five in one hand
const W_MOVE = 0.35 // per semitone of hand movement beyond a fourth, damped by the elapsed time
const MOVE_CAP = 4 // a leap is a leap: beyond this the distance no longer matters (pedalled sweeps)
const W_CROSS = 0.6 // per semitone of crossing the other hand's last notes (capped)
const CROSS_CAP = 4
const W_REGISTER = 0.25 // per semitone beyond +-9 of the split point
const W_LEAN = 0.05 // per semitone on the "wrong" side of the split point (breaks ties)
const W_EXTREME = 1 // right hand below G2 / left hand above C6
const W_SWITCH = 6 // a fast single-note figure continued by the other hand
const W_TIGHT = 3 // a chord cut between notes closer than 3 semitones
const W_STREAM = 6 // per unit of velocity difference with the hand's last notes (melody vs accompaniment)
const BEAM = 6

/** Cost of one hand's part of a chord: span, fingers, movement from its last notes, loudness stream. */
function handCost(
  lo: number,
  hi: number,
  count: number,
  vel: number,
  has: boolean,
  pos: number,
  last: number,
  lastVel: number,
  t: number,
  beatTicks: number,
): number {
  const span = hi - lo
  let c = 0
  if (span > 12) c += (span - 12) * W_SPAN
  if (span > 15) c += (span - 15) * W_STRETCH
  if (count > 5) c += (count - 5) * W_FINGERS
  if (has) {
    const d = Math.abs((lo + hi) / 2 - pos)
    if (d > 4) c += Math.min(MOVE_CAP, (W_MOVE * (d - 4)) / (1 + (0.5 * Math.max(0, t - last)) / beatTicks))
    c += W_STREAM * Math.abs(vel - lastVel)
  }
  return c
}

/** Beam of path states as flat arrays: per hand centre, lowest, highest pitch, onset tick, velocity. */
class Beam {
  size = 0
  readonly cost = new Float64Array(BEAM)
  readonly split = new Int32Array(BEAM)
  readonly hand = Array.from({ length: 2 }, () => ({
    has: new Uint8Array(BEAM),
    pos: new Float64Array(BEAM),
    lo: new Float64Array(BEAM),
    hi: new Float64Array(BEAM),
    t: new Float64Array(BEAM),
    vel: new Float64Array(BEAM),
  }))

  copyHand(h: 0 | 1, to: number, from: Beam, idx: number): void {
    const a = this.hand[h]
    const b = from.hand[h]
    a.has[to] = b.has[idx]
    a.pos[to] = b.pos[idx]
    a.lo[to] = b.lo[idx]
    a.hi[to] = b.hi[idx]
    a.t[to] = b.t[idx]
    a.vel[to] = b.vel[idx]
  }

  setHand(h: 0 | 1, to: number, lo: number, hi: number, t: number, vel: number): void {
    const a = this.hand[h]
    a.has[to] = 1
    a.pos[to] = (lo + hi) / 2
    a.lo[to] = lo
    a.hi[to] = hi
    a.t[to] = t
    a.vel[to] = vel
  }
}

/**
 * Auto hand assignment (sets n.right). `notes` sorted by onset then pitch. `splitPoint` is only a
 * soft centre. Deterministic; about O(onsets x beam x chord size), allocation-free per onset.
 */
export function assignHandsAuto(notes: QNote[], splitPoint: number, beatTicks: number): void {
  // Onset groups as index ranges.
  const starts: number[] = []
  for (let i = 0; i < notes.length; i++) if (i === 0 || notes[i].on !== notes[i - 1].on) starts.push(i)
  const G = starts.length
  if (G === 0) return
  starts.push(notes.length)
  const parents = new Int32Array(G * BEAM)
  const splits = new Int32Array(G * BEAM)
  let cur = new Beam()
  let nxt = new Beam()
  cur.size = 1
  let maxK = 1
  for (let g = 0; g < G; g++) maxK = Math.max(maxK, starts[g + 1] - starts[g])
  const regL = new Float64Array(maxK + 1)
  const regR = new Float64Array(maxK + 1)
  const velSum = new Float64Array(maxK + 1)
  const ps = new Float64Array(maxK)
  const cCost = new Float64Array(BEAM * (maxK + 1))
  const cNode = new Int32Array(BEAM * (maxK + 1))
  const cSplit = new Int32Array(BEAM * (maxK + 1))
  const taken = new Uint8Array(BEAM * (maxK + 1))
  let prevFrom = 0
  let prevTo = 0
  let prevT = -Infinity
  for (let g = 0; g < G; g++) {
    const from = starts[g]
    const k = starts[g + 1] - from
    const t = notes[from].on
    velSum[0] = 0
    for (let i = 0; i < k; i++) {
      ps[i] = notes[from + i].pitch
      velSum[i + 1] = velSum[i] + notes[from + i].vel
    }
    // Register costs of each split, independent of the path: prefix (left) and suffix (right) sums.
    regL[0] = 0
    regR[k] = 0
    for (let i = 0; i < k; i++) {
      const p = ps[i]
      let c = 0
      if (p > splitPoint + 9) c += (p - splitPoint - 9) * W_REGISTER
      if (p >= splitPoint) c += (p - splitPoint + 1) * W_LEAN
      if (p > 84) c += (p - 84) * W_EXTREME
      regL[i + 1] = regL[i] + c
    }
    for (let i = k - 1; i >= 0; i--) {
      const p = ps[i]
      let c = 0
      if (p < splitPoint - 9) c += (splitPoint - 9 - p) * W_REGISTER
      if (p < splitPoint) c += (splitPoint - p) * W_LEAN
      if (p < 43) c += (43 - p) * W_EXTREME
      regR[i] = regR[i + 1] + c
    }
    // A single note right after another onset continues the figure of its nearest note there
    // (up to an octave away: arpeggio figures leap).
    let near = -1
    if (k === 1 && t - prevT <= beatTicks) {
      let best = 13
      for (let i = prevFrom; i < prevTo; i++) {
        const d = Math.abs(notes[i].pitch - ps[0])
        if (d < best) {
          best = d
          near = i - prevFrom
        }
      }
    }
    let nc = 0
    const L = cur.hand[0]
    const R = cur.hand[1]
    for (let ni = 0; ni < cur.size; ni++) {
      // Crossing only counts against notes attacked within the last beat (a held note can be crossed).
      const leftRecent = L.has[ni] === 1 && t - L.t[ni] <= beatTicks
      const rightRecent = R.has[ni] === 1 && t - R.t[ni] <= beatTicks
      const nearRight = near >= 0 ? near >= cur.split[ni] : null
      for (let s = 0; s <= k; s++) {
        let c = cur.cost[ni] + regL[s] + regR[s]
        if (s > 0) c += handCost(ps[0], ps[s - 1], s, velSum[s] / s, L.has[ni] === 1, L.pos[ni], L.t[ni], L.vel[ni], t, beatTicks)
        if (s < k) c += handCost(ps[s], ps[k - 1], k - s, (velSum[k] - velSum[s]) / (k - s), R.has[ni] === 1, R.pos[ni], R.t[ni], R.vel[ni], t, beatTicks)
        // Do not cut tight clusters between the hands.
        if (s > 0 && s < k && ps[s] - ps[s - 1] < 3) c += W_TIGHT
        // Against a hand that plays nothing in this chord (inside the chord the split cannot cross).
        if (s === k && rightRecent) c += Math.min(CROSS_CAP, W_CROSS * Math.max(0, ps[s - 1] - R.lo[ni]))
        if (s === 0 && leftRecent) c += Math.min(CROSS_CAP, W_CROSS * Math.max(0, L.hi[ni] - ps[s]))
        // Fast single-note figures (arpeggios, runs) stay in the hand of the note they continue.
        if (nearRight !== null && nearRight !== (s === 0)) c += W_SWITCH
        cCost[nc] = c
        cNode[nc] = ni
        cSplit[nc] = s
        taken[nc] = 0
        nc++
      }
    }
    // Keep the cheapest few, at most two per split choice, so the beam keeps real alternatives.
    nxt.size = 0
    const perSplit = new Uint8Array(k + 1)
    while (nxt.size < BEAM) {
      let best = -1
      for (let c = 0; c < nc; c++) {
        if (taken[c] || perSplit[cSplit[c]] >= 2) continue
        if (best < 0 || cCost[c] < cCost[best] || (cCost[c] === cCost[best] && (cSplit[c] < cSplit[best] || (cSplit[c] === cSplit[best] && cNode[c] < cNode[best])))) best = c
      }
      if (best < 0) break
      taken[best] = 1
      const s = cSplit[best]
      const ni = cNode[best]
      perSplit[s]++
      const to = nxt.size++
      nxt.cost[to] = cCost[best]
      nxt.split[to] = s
      if (s > 0) nxt.setHand(0, to, ps[0], ps[s - 1], t, velSum[s] / s)
      else nxt.copyHand(0, to, cur, ni)
      if (s < k) nxt.setHand(1, to, ps[s], ps[k - 1], t, (velSum[k] - velSum[s]) / (k - s))
      else nxt.copyHand(1, to, cur, ni)
      parents[g * BEAM + to] = ni
      splits[g * BEAM + to] = s
    }
    const swap = cur
    cur = nxt
    nxt = swap
    prevFrom = from
    prevTo = from + k
    prevT = t
  }
  // Backtrack the cheapest path (index 0 of the last beam).
  let idx = 0
  for (let g = G - 1; g >= 0; g--) {
    const s = splits[g * BEAM + idx]
    for (let i = starts[g]; i < starts[g + 1]; i++) notes[i].right = i - starts[g] >= s
    idx = parents[g * BEAM + idx]
  }
}

// ---------------------------------------------------------------- clefs

/** Diatonic step of each pitch class (sharps on the letter below). */
const STEP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]
const position = (p: number) => (Math.floor(p / 12) - 1) * 7 + STEP[((p % 12) + 12) % 12]
/** Staff limits as diatonic positions: treble E4..F5, bass G2..A3. */
const LIMITS = { treble: [position(64), position(77)], bass: [position(43), position(57)] } as const

/** Ledger lines a pitch needs on a clef. */
export function ledgerLines(pitch: number, clef: 'treble' | 'bass'): number {
  const [bottom, top] = LIMITS[clef]
  const pos = position(pitch)
  if (pos < bottom) return Math.floor((bottom - pos) / 2)
  if (pos > top) return Math.floor((pos - top) / 2)
  return 0
}

/**
 * Clef for a staff: its usual clef unless the other one saves most ledger lines (a left hand that
 * plays above middle C gets the treble clef, a right hand deep in the bass the bass clef).
 */
export function chooseClef(pitches: number[], usual: 'treble' | 'bass'): 'treble' | 'bass' {
  if (pitches.length === 0) return usual
  const other = usual === 'treble' ? 'bass' : 'treble'
  let here = 0
  let there = 0
  for (const p of pitches) {
    here += ledgerLines(p, usual)
    there += ledgerLines(p, other)
  }
  return here >= 0.75 * pitches.length && there <= 0.5 * here ? other : usual
}
