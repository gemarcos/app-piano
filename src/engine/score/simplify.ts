// Owner: engine-score. Hand split, difficulty modes and polyphony cap on grid-snapped notes.
import type { Difficulty } from '../../types'
import { forEachOnsetGroup, sortByOnset, type QNote } from './quantize'

/** Pitch gap (semitones) that separates two clusters of simultaneous notes. */
const CLUSTER_GAP = 7

/**
 * pitch >= splitPoint goes right. Light heuristic: a cluster of simultaneous notes that straddles
 * the split, whose minority-hand notes are all within 2 semitones of it, stays in its majority hand.
 */
export function assignHands(notes: QNote[], splitPoint: number): void {
  for (const n of notes) n.right = n.pitch >= splitPoint
  forEachOnsetGroup(notes, (group) => {
    if (group.length < 3) return
    // group is sorted by pitch: split it into clusters separated by wide gaps.
    let start = 0
    for (let i = 1; i <= group.length; i++) {
      if (i < group.length && group[i].pitch - group[i - 1].pitch <= CLUSTER_GAP) continue
      fixCluster(group.slice(start, i), splitPoint)
      start = i
    }
  })
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

/** Applies the per-hand polyphony cap at every onset. Input sorted by onset; output too. */
export function capPolyphony(notes: QNote[], cap: number): QNote[] {
  const out: QNote[] = []
  forEachOnsetGroup(notes, (group) => {
    const r = group.filter((n) => n.right)
    const l = group.filter((n) => !n.right)
    out.push(...capGroup(l, cap, false), ...capGroup(r, cap, true))
  })
  return sortByOnset(out)
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
