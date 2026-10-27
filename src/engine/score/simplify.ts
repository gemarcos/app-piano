// Owner: engine-score. Difficulty modes and polyphony cap on grid-snapped notes (hands: hands.ts).
import type { Difficulty } from '../../types'
import { forEachOnsetGroup, sortByOnset, type QNote } from './quantize'

/** Keeps outer voices first (top for the right hand when only one fits), then the loudest. */
export function capGroup(group: QNote[], cap: number, right: boolean): QNote[] {
  if (group.length <= cap) return group
  const byPitch = [...group].sort((a, b) => a.pitch - b.pitch)
  const low = byPitch[0]
  const high = byPitch[byPitch.length - 1]
  if (cap <= 1) return [right ? high : low]
  const inner = byPitch.slice(1, -1).sort((a, b) => b.vel - a.vel || b.pitch - a.pitch)
  return [low, ...inner.slice(0, cap - 2), high].sort((a, b) => a.pitch - b.pitch)
}

/**
 * Applies the per-hand polyphony cap at every onset. Input sorted by onset then pitch; output sorted
 * by onset, and by pitch within each hand.
 */
export function capPolyphony(notes: QNote[], cap: number): QNote[] {
  const out: QNote[] = []
  let i = 0
  while (i < notes.length) {
    let j = i + 1
    let right = notes[i].right ? 1 : 0
    while (j < notes.length && notes[j].on === notes[i].on) right += notes[j++].right ? 1 : 0
    const left = j - i - right
    if (left <= cap && right <= cap) for (let k = i; k < j; k++) out.push(notes[k])
    else {
      const group = notes.slice(i, j)
      out.push(...capGroup(group.filter((n) => !n.right), cap, false), ...capGroup(group.filter((n) => n.right), cap, true))
    }
    i = j
  }
  return out
}

/** Intermedio: runs collapsed by the 8th grid keep their loudest note; ghost notes in big chords go. */
function simplifyIntermedio(notes: QNote[]): QNote[] {
  const out: QNote[] = []
  const handle = (group: QNote[]) => {
    if (group.length === 0) return
    let keep = group
    const sources = new Set(group.map((n) => n.on16))
    if (sources.size > 1) {
      let bestSrc = group[0].on16
      let bestScore = -Infinity
      for (const src of sources) {
        let maxVel = 0
        for (const n of group) if (n.on16 === src) maxVel = Math.max(maxVel, n.vel)
        const score = maxVel + (src === group[0].on ? 0.001 : 0)
        if (score > bestScore) {
          bestScore = score
          bestSrc = src
        }
      }
      keep = group.filter((n) => n.on16 === bestSrc)
    }
    if (keep.length >= 3) {
      const maxVel = Math.max(...keep.map((n) => n.vel))
      keep = keep.filter((n) => n.vel >= 0.45 * maxVel)
    }
    out.push(...keep)
  }
  forEachOnsetGroup(notes, (group) => {
    handle(group.filter((n) => !n.right))
    handle(group.filter((n) => n.right))
  })
  return sortByOnset(out)
}

/** Fácil, right hand: skyline melody (top note per onset; inner notes under a held top note go). */
function skyline(notes: QNote[]): QNote[] {
  const out: QNote[] = []
  let current: QNote | undefined
  forEachOnsetGroup(notes, (group) => {
    const top = group[group.length - 1]
    if (current && current.off > top.on && top.pitch < current.pitch && current.off >= top.off) return
    out.push(top)
    current = top
  })
  return out
}

/**
 * Fácil, left hand: lowest note per beat, held until the next bass note (repeats inside a bar merge
 * into one longer note; a new bar restrikes it). Across an empty stretch it is held to the end of
 * its bar, or longer while it still sounds, so long silences in the bass stay rests.
 */
function bassLine(notes: QNote[], beatTicks: number, measureTicks: number): QNote[] {
  const beatsPerBar = Math.max(1, Math.round(measureTicks / beatTicks))
  const lowest = new Map<number, QNote>()
  for (const n of notes) {
    const beat = Math.floor(n.on / beatTicks)
    const prev = lowest.get(beat)
    if (!prev || n.pitch < prev.pitch || (n.pitch === prev.pitch && n.vel > prev.vel)) lowest.set(beat, n)
  }
  const beats = [...lowest.keys()].sort((a, b) => a - b)
  const out: QNote[] = []
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i]
    const src = lowest.get(beat)!
    const nextBeat = i + 1 < beats.length ? beats[i + 1] : Infinity
    const soundsUntil = Math.ceil(src.off / beatTicks)
    const barEnd = (Math.floor(beat / beatsPerBar) + 1) * beatsPerBar
    const endBeat = Math.min(nextBeat, Math.max(beat + 1, soundsUntil, barEnd))
    const last = out.length > 0 ? out[out.length - 1] : undefined
    const sameBar = last !== undefined && Math.floor(last.on / measureTicks) === Math.floor((beat * beatTicks) / measureTicks)
    if (last && sameBar && last.pitch === src.pitch && last.off === beat * beatTicks) {
      last.off = endBeat * beatTicks
      continue
    }
    out.push({ ...src, on: beat * beatTicks, on16: beat * beatTicks, off: endBeat * beatTicks, right: false })
  }
  return out
}

export interface SimplifyOptions {
  difficulty: Difficulty
  maxPolyphony: number
  beatTicks: number
  measureTicks: number
}

/** Difficulty transforms + polyphony cap. Input: hands assigned, sorted by onset. */
export function simplify(notes: QNote[], opts: SimplifyOptions): QNote[] {
  const cap = Math.max(1, Math.min(6, Math.round(opts.maxPolyphony)))
  if (opts.difficulty === 'intermedio') return capPolyphony(simplifyIntermedio(notes), Math.min(cap, 3))
  if (opts.difficulty === 'facil') {
    const right = skyline(notes.filter((n) => n.right))
    const left = bassLine(notes.filter((n) => !n.right), opts.beatTicks, opts.measureTicks)
    return sortByOnset([...left, ...right])
  }
  return capPolyphony(notes, cap)
}
