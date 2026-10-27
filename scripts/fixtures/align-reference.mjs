#!/usr/bin/env node
// Aligns a reference score (MIDI) with a real performance recording and writes a ground truth for the transcription
// benchmark: notes in recording seconds, beats and downbeats. Rubato-proof: chroma + chroma-onset (DLNCO) features,
// a coarse subsequence DTW (finds the covered section and the transposition: covers and sped-up videos often sound
// a semitone or two away), a fine banded DTW around it, then every onset group is refined on the recording's own
// pitch-specific spectral flux (never on a transcription, so both models are judged fairly).
// Accuracy on the realistic benchmark (reference = its exact truth under a random tempo warp, transposed back):
// onset error median 5 ms, p90 18 ms, 97 % within 50 ms (scripts/fixtures/lib/align.mjs; last 1.5 s excluded).
//
// Usage: node scripts/fixtures/align-reference.mjs --audio <recording> --midi <reference.mid> --out <truth.json>
//          [--name id] [--title text] [--source text] [--from-tick n] [--to-tick n] [--transpose auto|<semitones>]
//          [--no-refine] [--plot <png>]
// Needs ffmpeg. The output follows test/fixtures/real/*.json (notes with hand and register role, beats, downbeats,
// key, meter, pedal) plus "transpose" and an "alignment" block (bars covered, DTW cost, refinement statistics).
// Recordings and references that may not be redistributed belong in test/fixtures/local/ (git-ignored).
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SR, align, chroma, decodeAudio, keyFlux, onsetGroups, pitchEnergy, refineGroups, writePng } from './lib/align.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(ROOT, 'package.json'))
const { Midi } = require('@tonejs/midi')

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const AUDIO = option('--audio', null)
const MIDI_FILE = option('--midi', null)
const OUT = option('--out', null)
if (!AUDIO || !MIDI_FILE || !OUT) {
  console.error('usage: node scripts/fixtures/align-reference.mjs --audio <file> --midi <file.mid> --out <file.json> [options]')
  process.exit(2)
}
/** Refinement settings calibrated on the realistic benchmark (see the header). */
const REFINE = { n: 1024, hop: 64, lag: 3, bias: 0.004, search: 0.06 }

const t0 = Date.now()
const samples = decodeAudio(AUDIO)
const duration = samples.length / SR
// Tuning of the recording with the app's own estimator (Node strips the TypeScript types).
const { estimateTuning } = await import(new URL('../../src/engine/transcribe/tuning.ts', import.meta.url).href)
const tuning = estimateTuning(samples, { sampleRate: SR })
const cents = tuning.confidence >= 0.35 ? tuning.cents : 0

const midi = new Midi(readFileSync(MIDI_FILE))
const ppq = midi.header.ppq
const fromTick = Number(option('--from-tick', 0))
const toTick = Number(option('--to-tick', Infinity))
const notes = []
midi.tracks.forEach((track, ti) => {
  for (const n of track.notes) {
    if (n.ticks < fromTick || n.ticks >= toTick) continue
    const hand = /left|links/i.test(track.name) ? 'left' : /right|rechts/i.test(track.name) ? 'right' : `track${ti}`
    notes.push({ pitch: n.midi, start: n.time, end: n.time + n.duration, ticks: n.ticks, velocity: n.velocity, hand })
  }
})
notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
const pedal = []
let downAt = null
for (const e of midi.tracks.flatMap((t) => t.controlChanges[64] ?? []).sort((a, b) => a.time - b.time)) {
  if (e.value >= 0.5 && downAt === null) downAt = e.time
  else if (e.value < 0.5 && downAt !== null) {
    pedal.push([downAt, e.time])
    downAt = null
  }
}
console.log(`audio ${duration.toFixed(1)} s (tuning ${tuning.cents} cents, confidence ${tuning.confidence.toFixed(2)}); reference ${notes.length} notes`)

const result = align(samples, notes, pedal, { cents, transpose: option('--transpose', 'auto'), log: (line) => console.log(line) })
const { warp, transpose } = result
const tickAt = (seconds) => midi.header.secondsToTicks(seconds)
console.log(`DTW: coarse cost ${result.coarseCost.toFixed(3)}, fine cost ${result.cost.toFixed(3)}; recording covers reference ${warp.from.toFixed(2)}-${warp.to.toFixed(2)} s`)

// Bars from the time-signature map (bar index 0 holds the pickup when the piece starts with one).
const sigs = midi.header.timeSignatures.map((s) => ({ ticks: s.ticks, beats: s.timeSignature[0], unit: s.timeSignature[1] }))
const bars = []
for (let k = 0, tick = 0; tick < midi.durationTicks + ppq * 16; k++) {
  const sig = [...sigs].reverse().find((s) => s.ticks <= tick) ?? { beats: 4, unit: 4 }
  const beatTicks = (ppq * 4) / sig.unit
  bars.push({ index: k, tick, beats: sig.beats, beatTicks, meter: `${sig.beats}/${sig.unit}` })
  tick += sig.beats * beatTicks
}
const barOf = (tick) => [...bars].reverse().find((b) => b.tick <= tick + 1e-6) ?? bars[0]

const inSpan = notes.filter((n) => n.start >= warp.from - 0.05 && n.start <= warp.to + 0.05)
const groups = onsetGroups(inSpan, warp)
const stats = args.includes('--no-refine') ? { refined: 0, corrections: [] } : refineGroups(groups, keyFlux(samples, { ...REFINE, cents }), REFINE)
const abs = stats.corrections.map(Math.abs).sort((a, b) => a - b)
const pct = (q) => (abs.length ? abs[Math.min(abs.length - 1, Math.floor(q * abs.length))] * 1000 : 0)

const scaleAt = (x) => (warp.map(x + 0.25) - warp.map(x - 0.25)) / 0.5
const round3 = (v) => Math.round(v * 1000) / 1000
const notesOut = []
for (const g of groups) {
  for (const n of g.notes) {
    const bar = barOf(n.ticks)
    const pitch = n.pitch + transpose
    notesOut.push({
      pitch,
      start: round3(g.time),
      duration: round3(Math.max(0.03, (n.end - n.start) * Math.max(0.2, Math.min(5, scaleAt(n.start))))),
      velocity: round3(n.velocity),
      hand: n.hand,
      role: pitch < 48 ? 'low' : pitch < 60 ? 'mid-low' : pitch < 72 ? 'mid-high' : 'high',
      bar: bar.index,
      beat: Math.round(((n.ticks - bar.tick) / bar.beatTicks) * 100) / 100,
      refined: g.refined,
    })
  }
}

// Beats and downbeats: reference beat ticks through a map built from the refined onset groups (reference time ->
// recording time, piecewise linear), which is as precise as the notes; the DTW warp covers the ends.
const anchors = groups.filter((g) => g.refined).map((g) => [g.refTime, g.time])
const refinedMap = (x) => {
  if (anchors.length < 2 || x <= anchors[0][0] || x >= anchors[anchors.length - 1][0]) return warp.map(x)
  let lo = 0
  let hi = anchors.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (anchors[mid][0] <= x) lo = mid
    else hi = mid
  }
  const [x0, y0] = anchors[lo]
  const [x1, y1] = anchors[hi]
  // Far from any refined onset (rests, held chords) the DTW warp is the better guide.
  if (x1 - x0 > 2.5) return warp.map(x)
  return y0 + ((x - x0) / Math.max(1e-9, x1 - x0)) * (y1 - y0)
}
const beats = []
const downbeats = []
const firstTick = Math.ceil(tickAt(warp.from))
const lastTick = Math.floor(tickAt(warp.to))
for (const bar of bars) {
  for (let b = 0; b < bar.beats; b++) {
    const tick = bar.tick + b * bar.beatTicks
    if (tick < firstTick || tick > lastTick) continue
    const t = round3(refinedMap(midi.header.ticksToSeconds(tick)))
    if (t < 0 || t > duration) continue
    beats.push(t)
    if (b === 0) downbeats.push(t)
  }
}
const firstBar = barOf(firstTick)
const lastBar = barOf(lastTick)
const markers = (midi.header.meta ?? []).filter((m) => m.type === 'marker')
const firstFull = bars.find((b) => b.tick >= firstTick - ppq / 4) ?? firstBar
// The section marker nearest to the first full bar (a marker inside a cadenza before it is not the section).
const marker = markers.find((m) => Math.abs(m.ticks - firstFull.tick) <= ppq) ?? [...markers].reverse().find((m) => m.ticks <= firstTick + ppq)
const keyAt = [...midi.header.keySignatures].reverse().find((k) => k.ticks <= firstFull.tick) ?? midi.header.keySignatures[0]
/** Key as heard: the reference key at the first full bar moved by `transpose` (common spellings, circle of fifths). */
function soundingKey(key, semitones) {
  if (!key) return null
  const pcs = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }
  const minor = key.scale === 'minor'
  const names = minor ? ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'] : ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
  const pc = (((pcs[key.key] ?? 0) + semitones) % 12 + 12) % 12
  const fifths = ((((pc + (minor ? 3 : 0)) % 12) * 7) % 12 + 12) % 12
  return { tonic: names[pc], mode: minor ? 'minor' : 'major', fifths: fifths > 6 ? fifths - 12 : fifths }
}
const intervals = beats.slice(1).map((t, i) => t - beats[i]).filter((d) => d > 0).sort((a, b) => a - b)
const bpm = intervals.length ? Math.round(60 / intervals[Math.floor(intervals.length / 2)]) : null

const out = {
  name: option('--name', path.basename(AUDIO).replace(/\.[^.]+$/, '')),
  title: option('--title', midi.name || path.basename(MIDI_FILE)),
  condition: 'grabacion-real',
  file: path.basename(AUDIO),
  description: `Real recording aligned to a reference score: reference bars ${firstBar.index}-${lastBar.index}, first full bar ${firstFull.index}${marker ? ` ("${marker.text}")` : ''}, sounding ${transpose >= 0 ? '+' : ''}${transpose} semitones from the score.`,
  source: option('--source', `Reference: ${path.basename(MIDI_FILE)}; aligned by scripts/fixtures/align-reference.mjs`),
  sampleRate: SR,
  duration: round3(duration),
  tuningCents: tuning.cents,
  /** Semitones added to the reference pitches (the recording sounds transposed); `notes` already include it. */
  transpose,
  /** Key as heard at the first full bar (reference key moved by `transpose`), like test/fixtures/real. */
  key: soundingKey(keyAt, transpose),
  /** The written key there, before `transpose`. */
  referenceKey: keyAt ? { tonic: keyAt.key, mode: keyAt.scale } : null,
  timeSignature: firstFull.meter,
  beatsPerBar: firstFull.beats,
  bpm,
  beats,
  downbeats,
  pedal: pedal.filter(([a, b]) => b >= warp.from && a <= warp.to).map(([a, b]) => ({ start: round3(refinedMap(a)), end: round3(refinedMap(b)) })),
  alignment: {
    method: 'chroma + DLNCO features, coarse subsequence DTW (40 ms) + banded DTW (20 ms), onset refinement on pitch-specific spectral flux',
    coarseCost: round3(result.coarseCost),
    fineCost: round3(result.cost),
    reference: {
      startSeconds: round3(warp.from),
      endSeconds: round3(warp.to),
      startTick: firstTick,
      endTick: lastTick,
      startBar: firstBar.index,
      firstFullBar: firstFull.index,
      firstFullBarAt: round3(refinedMap(midi.header.ticksToSeconds(firstFull.tick))),
      endBar: lastBar.index,
      marker: marker?.text ?? null,
    },
    onsetGroups: groups.length,
    refinedGroups: stats.refined,
    correctionMs: { median: Math.round(pct(0.5)), p90: Math.round(pct(0.9)), max: Math.round(pct(1)) },
    bars: bars.filter((b) => b.index >= firstBar.index && b.index <= lastBar.index).map((b) => ({ bar: b.index, meter: b.meter, start: round3(refinedMap(midi.header.ticksToSeconds(b.tick))) })),
  },
  notes: notesOut,
}
writeFileSync(OUT, JSON.stringify(out, null, 1))
console.log(
  `transpose ${transpose >= 0 ? '+' : ''}${transpose}; reference bars ${firstBar.index}-${lastBar.index}, first full bar ${firstFull.index}${marker ? ` "${marker.text}"` : ''} at ${refinedMap(midi.header.ticksToSeconds(firstFull.tick)).toFixed(2)} s; ` +
    `${notesOut.length} notes in ${groups.length} onset groups, ${stats.refined} refined (|correction| median ${pct(0.5).toFixed(0)} ms, p90 ${pct(0.9).toFixed(0)} ms); ` +
    `${beats.length} beats, ${downbeats.length} downbeats, ~${bpm} bpm`,
)
console.log(`written ${OUT} in ${((Date.now() - t0) / 1000).toFixed(1)} s`)

const plot = option('--plot', null)
if (plot) {
  // Recording chroma (top) against the reference chroma at the warped time (bottom).
  const hop = Math.round(SR * 0.04)
  const rec = chroma(pitchEnergy(samples, hop, 4096, cents))
  const W = Math.min(3000, rec.length)
  writePng(plot, W, 12 * 6 * 2 + 4, (x, y) => {
    const i = Math.floor((x * rec.length) / W)
    if (y >= 72 && y < 76) return [255, 255, 255]
    if (y >= 76) {
      // reference: which notes sound at the warped time
      const c = 11 - Math.floor(((y - 76) / 6) % 12)
      const t = i * (hop / SR)
      const on = notesOut.some((n) => (n.pitch + 120) % 12 === c && n.start <= t && n.start + n.duration > t)
      return on ? [40, 40, 200] : [255, 255, 255]
    }
    const c = 11 - Math.floor((y / 6) % 12)
    const g = Math.round(255 * (1 - Math.min(1, rec[i][c])))
    return [g, g, 255]
  })
  console.log(`plot: ${plot}`)
}
