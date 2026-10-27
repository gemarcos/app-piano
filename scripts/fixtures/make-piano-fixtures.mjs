#!/usr/bin/env node
// Renders REAL-piano fixtures from the offline FluidR3_GM piano samples in public/soundfonts (Node + ffmpeg, no sox,
// runs on Windows). The sox "pluck" fixtures (make-fixtures.sh) are a clean synthetic baseline; these use recorded
// piano notes (natural decay, inharmonic partials, hammer noise) with dynamics, damper releases, pedal overlaps, repeated
// notes, octaves and fast runs, so the threshold calibration also holds for real piano audio.
// Samples: FluidR3_GM by Frank Wen, rendered by midi-js-soundfonts (CC BY 3.0, see docs/CREDITS.md). Original material.
//
// Usage: node scripts/fixtures/make-piano-fixtures.mjs
// Output: test/fixtures/piano-{melody,chords,arpeggio}.{wav,json} + piano-{chords,arpeggio}-room.{wav,json}
//         (22 050 Hz mono 16-bit; the app resamples to 22 050 Hz anyway). Deterministic (seeded noise).
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SAMPLES = path.join(ROOT, 'public', 'soundfonts', 'acoustic_grand_piano-mp3')
const OUT = path.join(ROOT, 'test', 'fixtures')
const SR = 22050
const LEAD = 0.5 // silence before the first note, seconds
const TAIL = 0.8 // after the last note ends
const RELEASE_TAU = 0.05 // damper: exp(-t / tau) after the note ends
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** 'C4' / 'F#3' / 'Bb2' -> MIDI (C4 = 60). */
const midi = (name) => {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name)
  if (!m) throw new Error(`bad note ${name}`)
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
}

const sampleCache = new Map()
/** Mono samples of one piano note at SR, starting at its attack. */
function pianoSample(pitch) {
  if (sampleCache.has(pitch)) return sampleCache.get(pitch)
  const file = path.join(SAMPLES, `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}.mp3`)
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 26 })
  const x = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  let peak = 0
  for (const v of x) peak = Math.max(peak, Math.abs(v))
  const attack = Math.max(0, x.findIndex((v) => Math.abs(v) > peak * 0.05) - Math.round(0.001 * SR))
  const out = x.subarray(attack)
  sampleCache.set(pitch, out)
  return out
}

/** Deterministic PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * voices: [{ notes: [[pitchName | pitchName[] | null(rest), beats, holdBeats?]...], vel: [min, max], legato }]
 * holdBeats overrides how long the key (or pedal) holds the note; default = beats * legato.
 */
function render(name, bpm, voices, seed) {
  const rand = rng(seed)
  const spb = 60 / bpm
  const truth = []
  for (const voice of voices) {
    let beat = 0
    for (const [what, beats, hold] of voice.notes) {
      if (what) {
        const pitches = Array.isArray(what) ? what : [what]
        const onBeat = Math.abs(beat - Math.round(beat)) < 1e-6
        const base = voice.vel[0] + (voice.vel[1] - voice.vel[0]) * (onBeat ? 0.6 + 0.4 * rand() : 0.6 * rand())
        for (const p of pitches) {
          const velocity = Math.min(1, Math.max(0.2, base + (rand() - 0.5) * 0.06))
          truth.push({ pitch: midi(p), start: LEAD + beat * spb, duration: (hold ?? beats * (voice.legato ?? 0.92)) * spb, velocity })
        }
      }
      beat += beats
    }
  }
  truth.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  const end = Math.max(...truth.map((n) => n.start + n.duration))
  const out = new Float32Array(Math.ceil((end + TAIL) * SR))
  for (const n of truth) {
    const s = pianoSample(n.pitch)
    const gain = n.velocity * n.velocity
    const at = Math.round(n.start * SR)
    const held = Math.round(n.duration * SR)
    const last = Math.min(s.length, held + Math.round(6 * RELEASE_TAU * SR), out.length - at)
    for (let i = 0; i < last; i++) {
      const env = i < held ? 1 : Math.exp(-(i - held) / (RELEASE_TAU * SR))
      out[at + i] += s[i] * gain * env
    }
  }
  normalize(out, 0.89)
  write(name, bpm, out, truth)
  return { out, truth, bpm }
}

function normalize(x, target) {
  let peak = 0
  for (const v of x) peak = Math.max(peak, Math.abs(v))
  if (peak > 0) for (let i = 0; i < x.length; i++) x[i] *= target / peak
}

const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)

/** Phone-in-a-room: 120 Hz high-pass, small-room reverb (Schroeder), 6 kHz low-pass, pink noise at ~25 dB SNR. */
function room(name, { out, truth, bpm }, seed) {
  const x = Float32Array.from(out)
  onePole(x, 120, 'high')
  const wet = schroeder(x)
  for (let i = 0; i < x.length; i++) x[i] = x[i] + 0.45 * wet[i]
  onePole(x, 6000, 'low')
  onePole(x, 6000, 'low')
  const noise = pink(x.length, rng(seed))
  const gain = (rms(x) / rms(noise)) * 10 ** (-25 / 20)
  for (let i = 0; i < x.length; i++) x[i] += noise[i] * gain
  normalize(x, 0.89)
  write(name, bpm, x, truth)
}

function onePole(x, hz, kind) {
  const a = Math.exp((-2 * Math.PI * hz) / SR)
  let y = 0
  for (let i = 0; i < x.length; i++) {
    y = (1 - a) * x[i] + a * y
    x[i] = kind === 'low' ? y : x[i] - y
  }
}

function schroeder(x) {
  const combs = [1116, 1188, 1277, 1356].map((d) => Math.round((d * SR) / 44100))
  const wet = new Float32Array(x.length)
  for (const d of combs) {
    const buf = new Float32Array(d)
    let j = 0
    let lp = 0
    for (let i = 0; i < x.length; i++) {
      const y = buf[j]
      lp = 0.75 * y + 0.25 * lp // damping
      buf[j] = x[i] + 0.8 * lp
      wet[i] += y / combs.length
      j = (j + 1) % d
    }
  }
  for (const d of [556, 441].map((v) => Math.round((v * SR) / 44100))) {
    const buf = new Float32Array(d)
    let j = 0
    for (let i = 0; i < wet.length; i++) {
      const b = buf[j]
      const y = -wet[i] + b
      buf[j] = wet[i] + 0.5 * b
      wet[i] = y
      j = (j + 1) % d
    }
  }
  return wet
}

/** Pink-ish noise (Paul Kellet's economy filter). */
function pink(n, rand) {
  const out = new Float32Array(n)
  let b0 = 0
  let b1 = 0
  let b2 = 0
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1
    b0 = 0.99765 * b0 + w * 0.099046
    b1 = 0.963 * b1 + w * 0.2965164
    b2 = 0.57 * b2 + w * 1.0526913
    out[i] = b0 + b1 + b2 + w * 0.1848
  }
  return out
}

function write(name, bpm, samples, truth) {
  const bytes = Buffer.alloc(44 + samples.length * 2)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(36 + samples.length * 2, 4)
  bytes.write('WAVEfmt ', 8, 'ascii')
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(SR, 24)
  bytes.writeUInt32LE(SR * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36, 'ascii')
  bytes.writeUInt32LE(samples.length * 2, 40)
  samples.forEach((v, i) => bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2))
  writeFileSync(path.join(OUT, `${name}.wav`), bytes)
  const lines = truth.map(
    (n) => `    { "pitch": ${n.pitch}, "start": ${n.start.toFixed(4)}, "duration": ${n.duration.toFixed(4)}, "velocity": ${n.velocity.toFixed(2)} }`,
  )
  const json = [
    '{',
    `  "name": "${name}",`,
    `  "bpm": ${bpm},`,
    `  "duration": ${(samples.length / SR).toFixed(3)},`,
    '  "source": "FluidR3_GM piano samples (Frank Wen, CC BY 3.0) via midi-js-soundfonts",',
    '  "notes": [',
    lines.join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n')
  writeFileSync(path.join(OUT, `${name}.json`), json)
  console.log(`  ${name}.wav  ${(samples.length / SR).toFixed(2)} s, ${truth.length} notes`)
}

const q = (n, beats, hold) => [n, beats, hold]
const seq = (names, beats) => names.split(' ').map((n) => [n === '-' ? null : n, beats])
const chord = (names) => names.split(' ')

console.log(`Rendering piano fixtures in ${OUT}`)

// 1. Melody (right hand alone), 104 BPM: leaps, repeated notes, dotted rhythms, a sixteenth run, soft and loud notes.
render('piano-melody', 104, [
  {
    vel: [0.45, 0.95],
    legato: 0.9,
    notes: [
      ...seq('C5', 1), ...seq('G4 A4', 0.5), ...seq('B4 C5', 1),
      ...seq('D5 D5', 0.5), ...seq('E5', 1), ...seq('D5 C5', 0.5), ...seq('B4', 1),
      ...seq('A4 B4 C5 D5 E5 D5 C5 B4', 0.25), q('A4', 1.5), ...seq('G4', 0.5),
      ...seq('G4 G4 A4 B4', 0.5), ...seq('C5', 2),
      q('E5', 1.5), ...seq('D5', 0.5), ...seq('C5 A4', 1),
      ...seq('G4 E4 G4 C5', 0.5), ...seq('B4 G5', 1),
      q('C5', 3),
    ],
  },
], 11)

// 2. Block chords, 84 BPM: left-hand octaves under repeated right-hand triads (real octave doublings must survive).
const rh = (c, n, beats = 1) => Array.from({ length: n }, () => [chord(c), beats])
const chords = render('piano-chords', 84, [
  { vel: [0.55, 0.85], legato: 0.85, notes: [...rh('E4 G4 C5', 4), ...rh('E4 A4 C5', 4), ...rh('F4 A4 C5', 4), ...rh('D4 G4 B4', 2), ...rh('D4 F4 B4', 2), [chord('C4 E4 G4 C5'), 2, 1.9]] },
  { vel: [0.6, 0.8], legato: 0.95, notes: [[chord('C2 C3'), 2], [chord('C2 C3'), 2], [chord('A1 A2'), 2], [chord('A1 A2'), 2], [chord('F1 F2'), 2], [chord('F1 F2'), 2], [chord('G1 G2'), 4], [chord('C2 C3'), 2, 1.9]] },
], 22)

// 3. Melody over a pedalled Alberti bass, 96 BPM: overlapping sustained notes (pedal change every half bar).
const alberti = (a, b, c) => {
  const notes = []
  for (let half = 0; half < 2; half++) [a, c, b, c].forEach((n, i) => notes.push([n, 0.5, 2 - i * 0.5 - 0.05]))
  return notes
}
const arpeggio = render('piano-arpeggio', 96, [
  {
    vel: [0.65, 0.95],
    legato: 0.95,
    notes: [
      ...seq('E5 D5', 1), ...seq('C5', 2),
      ...seq('D5 E5 F5 D5', 1),
      q('C5', 1.5), ...seq('B4', 0.5), ...seq('A4', 2),
      ...seq('A4 C5', 1), ...seq('F5', 2),
      ...seq('B4 C5 D5 B4', 0.5), ...seq('G4', 2),
      [chord('E4 G4 C5'), 4, 3.6],
    ],
  },
  {
    vel: [0.4, 0.6],
    notes: [...alberti('C3', 'E3', 'G3'), ...alberti('B2', 'D3', 'G3'), ...alberti('A2', 'C3', 'E3'), ...alberti('F2', 'A2', 'C3'), ...alberti('G2', 'B2', 'D3'), [chord('C2 C3'), 4, 3.6]],
  },
], 33)

room('piano-chords-room', chords, 44)
room('piano-arpeggio-room', arpeggio, 55)
