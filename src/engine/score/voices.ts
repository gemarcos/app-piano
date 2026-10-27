// Owner: engine-score. Two voices per staff where a sustained note overlaps moving notes of the
// same hand (a held melody note over an arpeggio, Bach's held tenor under a sixteenth figure).
//
// A note is "sustained" when it still sounds over at least two later onsets of its hand and is
// clearly longer (1.8x) or louder (1.3x) than the notes it overlaps. Under the pedal every note
// rings, so there only loudness counts (it tells a cantabile melody from its arpeggio); a note
// followed at once by a step in the same line (C6 D6 E6) is a melody moving on, not a held note,
// whatever the pedal makes it ring. Inside the measures those
// notes span, the sustained notes form one voice and the other notes the second; the higher of the
// two (on average) is voice 1 (stems up, Staff.measures), the lower one voice 2 (Staff.voice2).
// Everywhere else the staff keeps a single voice.
import type { QNote } from './quantize'

const LONGER = 1.8
const LOUDER = 1.3
/** Onsets a note must sound over before it counts as held above moving notes. */
const MIN_OVERLAPPED = 2

/** Overlapped notes considered per held note (enough for any texture; the rest are ignored). */
const MAX_OVERLAPPED = 64
const lens = new Float64Array(MAX_OVERLAPPED)
const vels = new Float64Array(MAX_OVERLAPPED)

/** Median of the first n values of a scratch buffer (insertion sort in place: n is small). */
function median(xs: Float64Array, n: number): number {
  for (let i = 1; i < n; i++) {
    const v = xs[i]
    let j = i - 1
    while (j >= 0 && xs[j] > v) {
      xs[j + 1] = xs[j]
      j--
    }
    xs[j + 1] = v
  }
  return xs[(n - 1) >> 1]
}

/**
 * Sets n.voice (1 or 2) for the notes of ONE hand, sorted by onset then pitch. `pedalled(from, to)`
 * tells whether the sustain pedal is down over a tick range.
 */
export function splitVoices(notes: QNote[], measureTicks: number, pedalled: (from: number, to: number) => boolean = () => false): void {
  for (const n of notes) n.voice = 1
  if (notes.length < 3) return
  const sustained = new Uint8Array(notes.length)
  let any = false
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    // Two later onsets (distinct ticks) inside the note need at least three ticks.
    if (n.off - n.on < 3) continue
    let count = 0
    let onsets = 0
    let lastOn = n.on
    let firstOn = -1
    let stepwise = false
    for (let j = i + 1; j < notes.length && notes[j].on < n.off; j++) {
      const m = notes[j]
      if (m.on <= n.on || m.pitch === n.pitch) continue
      if (firstOn < 0) firstOn = m.on
      // The very next onset is a lone step away: the line moves on.
      if (m.on === firstOn) stepwise = Math.abs(m.pitch - n.pitch) <= 2 && (j + 1 >= notes.length || notes[j + 1].on !== m.on) && (j === 0 || notes[j - 1].on !== m.on)
      if (count < MAX_OVERLAPPED) {
        lens[count] = m.off - m.on
        vels[count] = m.vel
        count++
      }
      if (m.on !== lastOn) {
        onsets++
        lastOn = m.on
      }
    }
    if (onsets < MIN_OVERLAPPED || stepwise) continue
    const louder = n.vel >= LOUDER * median(vels, count)
    if (louder || (!pedalled(n.on + 1, lastOn) && n.off - n.on >= LONGER * median(lens, count))) {
      sustained[i] = 1
      any = true
    }
  }
  if (!any) return
  // Measures with two voices: those a sustained note sounds in, grown forward so that no note of a
  // two-voice measure is tied into a single-voice one (one pass: marking only extends forward).
  const marked = new Set<number>()
  const mark = (n: QNote) => {
    for (let m = Math.floor(n.on / measureTicks); m <= Math.floor((n.off - 1) / measureTicks); m++) marked.add(m)
  }
  for (let i = 0; i < notes.length; i++) {
    if (sustained[i] || marked.has(Math.floor(notes[i].on / measureTicks))) mark(notes[i])
  }
  // Contiguous runs of marked measures form regions; in each, the higher role is voice 1.
  const region = new Map<number, number>()
  const sorted = [...marked].sort((a, b) => a - b)
  let id = -1
  sorted.forEach((m, k) => {
    if (k === 0 || m !== sorted[k - 1] + 1) id++
    region.set(m, id)
  })
  const sums = new Float64Array((id + 1) * 4) // per region: held pitch sum, held count, moving sum, moving count
  const regionOf = new Int32Array(notes.length).fill(-1)
  notes.forEach((n, i) => {
    const r = region.get(Math.floor(n.on / measureTicks))
    if (r === undefined) return
    regionOf[i] = r
    const o = r * 4 + (sustained[i] ? 0 : 2)
    sums[o] += n.pitch
    sums[o + 1]++
  })
  notes.forEach((n, i) => {
    const r = regionOf[i]
    if (r < 0) return
    const held = sums[r * 4 + 1]
    const moving = sums[r * 4 + 3]
    if (!held || !moving) return
    const heldUp = sums[r * 4] / held >= sums[r * 4 + 2] / moving
    n.voice = (sustained[i] ? heldUp : !heldUp) ? 1 : 2
  })
}
