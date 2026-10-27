#!/usr/bin/env node
// Realistic transcription benchmark (test/fixtures/real/): public-domain piano pieces + an original ballad rendered with
// a real grand piano (Salamander Grand Piano V3, Yamaha C5, Alexander Holm, CC BY 3.0: 16 velocity layers, sustain
// pedal with sympathetic resonance, damper noise, pedal mechanics), human timing (rubato +-8 %, onset jitter, final
// ritardando), dynamics and voicing, then the conditions piano videos actually arrive in: studio room, concert hall,
// a detuned piano (+40 cents, A = 432 Hz), "TikTok" speed-ups with pitch (1.10x, 1.15x), and a phone loudspeaker
// re-recorded by a phone microphone (band limit ~380 Hz-7.5 kHz, distortion, room, noise, AGC, Opus).
// Each file has an exact ground truth JSON: notes (pitch, onset, key duration, sounding duration, velocity, hand,
// role), sustain-pedal spans, beat times, key and meter.
//
// The samples are NOT in the repo. Download the SFZ+WAV 44.1 kHz 16-bit pack once (freepats.zenvoid.org, "Salamander
// Grand Piano", SalamanderGrandPianoV3+20161209_44khz16bit.tar.xz, ~400 MB), extract it, then:
//   node scripts/fixtures/make-real-fixtures.mjs --samples <folder containing SalamanderGrandPianoV3.sfz> [--only a,b]
// Deterministic (seeded). Needs ffmpeg with the aac, libopus and libx264 encoders.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as dsp from './lib/dsp.mjs'
import { loadSalamander, renderPiano } from './lib/salamander.mjs'
import { PIECES } from './real-pieces.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const SAMPLES = option('--samples', process.env.SALAMANDER_DIR)
const OUT = path.resolve(option('--out', path.join(ROOT, 'test', 'fixtures', 'real')))
const ONLY = option('--only', null)?.split(',')
const SR = 44100
const TMP = path.join(os.tmpdir(), 'pauta-real-fixtures')

/** Benchmark conditions (means are reported per condition by check-transcription.mjs). */
export const REAL_FIXTURES = [
  { name: 'real-ballad', piece: 'ballad', condition: 'estudio', space: 'room', codec: 'aac', kbps: 128 },
  { name: 'real-elise', piece: 'elise', condition: 'estudio', space: 'room', codec: 'aac', kbps: 128 },
  { name: 'real-moonlight', piece: 'moonlight', condition: 'estudio', space: 'room', codec: 'aac', kbps: 128 },
  { name: 'real-mozart', piece: 'mozart', condition: 'estudio', space: 'room', codec: 'aac', kbps: 128 },
  { name: 'real-liebestraum', piece: 'liebestraum', condition: 'sala', space: 'hall', codec: 'aac', kbps: 128 },
  { name: 'real-gymnopedie', piece: 'gymnopedie', condition: 'sala', space: 'hall', codec: 'aac', kbps: 128 },
  { name: 'video-ballad-detuned', piece: 'ballad', condition: 'desafinado', space: 'hall', detune: 40, chain: 'video', codec: 'aac', kbps: 96 },
  { name: 'video-gymnopedie-432', piece: 'gymnopedie', condition: 'desafinado', space: 'room', detune: 1200 * Math.log2(432 / 440), chain: 'video', codec: 'aac', kbps: 96 },
  { name: 'tiktok-elise-115', piece: 'elise', condition: 'acelerado', space: 'room', speed: 1.15, chain: 'video', codec: 'aac', kbps: 96, container: 'mp4' },
  { name: 'tiktok-liebestraum-110', piece: 'liebestraum', condition: 'acelerado', space: 'hall', speed: 1.1, chain: 'video', codec: 'aac', kbps: 96 },
  { name: 'phone-ballad', piece: 'ballad', condition: 'movil', space: 'room', chain: 'phone', codec: 'opus', kbps: 64 },
  { name: 'phone-moonlight-125', piece: 'moonlight', condition: 'movil', space: 'room', speed: 1.25, chain: 'phone', codec: 'opus', kbps: 64 },
]

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const midi = (name) => {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name)
  if (!m) throw new Error(`bad pitch ${name}`)
  return 12 * (Number(m[3]) + 1) + LETTER[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
}
const num = (s) => (s.includes('/') ? Number(s.split('/')[0]) / Number(s.split('/')[1]) : Number(s))

function parseVoice(voice) {
  const events = []
  let beat = 0
  for (const token of voice.notes.split(/\s+/)) {
    if (!token || token === '|') continue
    const m = /^([^:]+):([\d./]+)(?:~([\d./]+))?(?:@([+-]?\d+))?(!)?$/.exec(token)
    if (!m) throw new Error(`bad token ${token}`)
    const beats = num(m[2])
    if (m[1] !== 'r') {
      const vel = m[4] === undefined ? voice.vel : /^[+-]/.test(m[4]) ? voice.vel + Number(m[4]) : Number(m[4])
      events.push({
        beat,
        hold: m[3] !== undefined ? num(m[3]) : beats * (voice.legato ?? 0.92),
        pitches: m[1].split('+').map(midi),
        vel: vel + (m[5] ? 10 : 0),
        hand: voice.hand,
        role: voice.role,
      })
    }
    beat += beats
  }
  return { events, beats: beat }
}

const interp = (points, x) => {
  if (!points?.length) return 0
  if (x <= points[0][0]) return points[0][1]
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]
    const [x1, y1] = points[i]
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
  }
  return points[points.length - 1][1]
}

/** Human performance of a piece: seconds for every beat (rubato + ritardando), notes with jitter and dynamics. */
function perform(piece, seed) {
  const rand = dsp.rng(seed)
  const voices = piece.voices.map(parseVoice)
  const total = Math.max(...voices.map((v) => v.beats), ...piece.pedal.map((p) => p[1]))
  const { depth, period, phase } = piece.rubato
  const bpmAt = (b) => {
    const rit = b < piece.ritardando.from ? 1 : 1 - (1 - piece.ritardando.factor) * Math.min(1, (b - piece.ritardando.from) / Math.max(1, total - piece.ritardando.from))
    return piece.bpm * (1 + depth * Math.sin((2 * Math.PI * b) / period + phase)) * rit
  }
  const STEP = 1 / 96
  const table = [0]
  for (let i = 1; i <= Math.ceil(total / STEP) + 96; i++) {
    const b = (i - 0.5) * STEP
    table.push(table[i - 1] + (60 / bpmAt(b)) * STEP)
  }
  const LEAD = 0.6
  const timeOf = (b) => {
    const f = b / STEP
    const i = Math.min(table.length - 2, Math.max(0, Math.floor(f)))
    return LEAD + table[i] + (table[i + 1] - table[i]) * (f - i)
  }
  const notes = []
  for (const v of voices) {
    for (const e of v.events) {
      const groupJitter = dsp.gauss(rand) * 0.007
      const posInBar = (e.beat - piece.pickup + piece.beatsPerBar * 100) % piece.beatsPerBar
      const accent = Math.abs(posInBar) < 1e-6 ? 6 : Math.abs(posInBar - Math.round(posInBar)) < 1e-6 ? 2 : 0
      for (const pitch of e.pitches) {
        const start = timeOf(e.beat) + groupJitter + (e.pitches.length > 1 ? dsp.gauss(rand) * 0.004 : 0)
        const keyUp = Math.max(start + 0.06, timeOf(e.beat + e.hold) - 0.02)
        const velocity = Math.round(Math.min(124, Math.max(8, e.vel + interp(piece.dynamics, e.beat) + accent + dsp.gauss(rand) * 4)))
        notes.push({ pitch, start, keyUp, velocity, hand: e.hand, role: e.role, beat: e.beat })
      }
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  const pedal = piece.pedal.map(([a, b]) => ({ start: timeOf(a), end: timeOf(b) }))
  const lastBeat = Math.floor(Math.max(...voices.map((v) => v.beats)))
  const beats = Array.from({ length: lastBeat + 1 }, (_, b) => timeOf(b))
  const downbeats = beats.filter((_, b) => b >= piece.pickup && (b - piece.pickup) % piece.beatsPerBar === 0)
  return { notes, pedal, beats, downbeats }
}

const KEYS = {
  major: { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' },
  minor: { '-7': 'Ab', '-6': 'Eb', '-5': 'Bb', '-4': 'F', '-3': 'C', '-2': 'G', '-1': 'D', 0: 'A', 1: 'E', 2: 'B', 3: 'F#', 4: 'C#', 5: 'G#', 6: 'D#', 7: 'A#' },
}
function transposeKey(key, semitones) {
  if (!semitones) return key
  let f = (((key.fifths + 7 * semitones) % 12) + 12) % 12
  if (f > 6) f -= 12
  return { tonic: KEYS[key.mode][f], mode: key.mode, fifths: f }
}

function room(x, space, seed) {
  const ir =
    space === 'hall'
      ? dsp.impulseResponse(SR, { rt60: 2.3, predelay: 0.022, early: [[0.018, 0.4], [0.027, 0.35], [0.041, 0.3], [0.055, 0.25]], brightness: 0.45, seed })
      : dsp.impulseResponse(SR, { rt60: 0.55, predelay: 0.006, early: [[0.007, 0.5], [0.013, 0.35], [0.019, 0.3]], brightness: 0.6, seed })
  return space === 'hall' ? dsp.reverb(x, ir, -3, 2.0, SR) : dsp.reverb(x, ir, -13, 0.6, SR)
}

function ffmpeg(argv, input) {
  return execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...argv], { input, maxBuffer: 1 << 28 })
}
const f32 = (x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength)
const fromF32 = (buf) => new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))

function decodeFile(file) {
  return fromF32(ffmpeg(['-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), 'pipe:1']))
}

/** Phone loudspeaker playing the (AAC) video audio, re-recorded by a phone microphone with AGC. */
function phoneChain(x, seed) {
  mkdirSync(TMP, { recursive: true })
  const tmp = path.join(TMP, `phone-${seed}.m4a`)
  ffmpeg(['-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', 'pipe:0', '-c:a', 'aac', '-b:a', '128k', tmp], f32(x))
  let y = decodeFile(tmp).slice(0, x.length)
  rmSync(tmp, { force: true })
  for (const c of [
    dsp.biquad('highpass', SR, 380, 0.7), dsp.biquad('highpass', SR, 380, 0.7),
    dsp.biquad('peaking', SR, 2800, 1.2, 5), dsp.biquad('peaking', SR, 900, 1.0, -3),
    dsp.biquad('lowpass', SR, 7500, 0.7), dsp.biquad('lowpass', SR, 7500, 0.7),
  ])
    dsp.filter(y, c)
  dsp.normalize(y, 0.9)
  dsp.softClip(y, 1.6)
  const ir = dsp.impulseResponse(SR, { rt60: 0.35, predelay: 0.003, early: [[0.004, 0.6], [0.009, 0.4]], brightness: 0.5, seed: seed + 1 })
  y = dsp.reverb(y, ir, -9, 0.3, SR)
  dsp.filter(y, dsp.biquad('highpass', SR, 90, 0.7))
  const noise = dsp.pinkNoise(y.length, dsp.rng(seed + 2))
  const g = (dsp.rms(y) / dsp.rms(noise)) * 10 ** (-32 / 20)
  for (let i = 0; i < y.length; i++) y[i] += noise[i] * g
  dsp.compress(y, SR, { threshold: -26, ratio: 4, attack: 0.008, release: 0.25, makeup: 8 })
  return dsp.normalize(y, 0.7)
}

function encode(x, spec, file) {
  const input = ['-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', 'pipe:0']
  if (spec.codec === 'opus') {
    ffmpeg(['-y', ...input, '-c:a', 'libopus', '-b:a', `${spec.kbps}k`, '-ar', '48000', file], f32(x))
  } else if (spec.container === 'mp4') {
    ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0x101014:s=180x320:r=10', ...input, '-shortest', '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '45', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', `${spec.kbps}k`, '-movflags', '+faststart', file], f32(x))
  } else {
    ffmpeg(['-y', ...input, '-c:a', 'aac', '-b:a', `${spec.kbps}k`, '-movflags', '+faststart', file], f32(x))
  }
}

/** Delay (ms) of the decoded file against the signal that was encoded, by cross-correlation of the first seconds. */
function codecDelayMs(x, file) {
  const y = decodeFile(file)
  const n = Math.min(x.length, y.length, SR * 4)
  let best = 0
  let bestLag = 0
  for (let lag = -2048; lag <= 2048; lag += 1) {
    let s = 0
    for (let i = 2048; i < n - 2048; i += 3) s += x[i] * y[i + lag]
    if (s > best) {
      best = s
      bestLag = lag
    }
  }
  return (bestLag / SR) * 1000
}

const round = (v, d = 4) => Number(v.toFixed(d))

function main() {
  if (!SAMPLES) {
    console.error('Usage: node scripts/fixtures/make-real-fixtures.mjs --samples <Salamander folder with SalamanderGrandPianoV3.sfz>')
    process.exit(2)
  }
  const bank = loadSalamander(path.resolve(SAMPLES))
  mkdirSync(OUT, { recursive: true })
  const renders = new Map()
  const performances = new Map()
  let totalBytes = 0
  console.log(`Rendering the realistic benchmark into ${OUT}`)
  for (const [index, spec] of REAL_FIXTURES.entries()) {
    if (ONLY && !ONLY.includes(spec.name)) continue
    const piece = PIECES[spec.piece]
    const pieceSeed = 1000 + Object.keys(PIECES).indexOf(spec.piece) * 17
    if (!performances.has(spec.piece)) performances.set(spec.piece, perform(piece, pieceSeed))
    const perf = performances.get(spec.piece)
    const renderKey = `${spec.piece}|${spec.detune ?? 0}`
    if (!renders.has(renderKey)) {
      renders.set(renderKey, renderPiano(bank, perf.notes, perf.pedal, { detuneCents: spec.detune ?? 0, seed: pieceSeed }))
    }
    const rendered = renders.get(renderKey)
    let x = room(Float32Array.from(rendered.mix), spec.space, 300 + index)
    const speed = spec.speed ?? 1
    if (speed !== 1) x = dsp.resample(x, speed)
    if (spec.chain === 'phone') x = phoneChain(x, 500 + index)
    else if (spec.chain === 'video') {
      dsp.normalize(x, 1.4)
      dsp.limit(x, SR, 0.89)
    } else dsp.normalize(x, 0.89)

    const ext = spec.codec === 'opus' ? 'webm' : spec.container === 'mp4' ? 'mp4' : 'm4a'
    const file = path.join(OUT, `${spec.name}.${ext}`)
    encode(x, spec, file)
    const delay = codecDelayMs(x, file)
    const bytes = statSync(file).size
    totalBytes += bytes

    const shift = 12 * Math.log2(speed) + (spec.detune ?? 0) / 100
    const transpose = Math.round(shift)
    const residualCents = round((shift - transpose) * 100, 1)
    const t = (s) => round(s / speed)
    const truth = {
      name: spec.name,
      title: piece.title,
      composer: piece.composer,
      condition: spec.condition,
      file: path.basename(file),
      description: describe(spec),
      source:
        'Rendered by scripts/fixtures/make-real-fixtures.mjs with the Salamander Grand Piano V3 samples (Alexander Holm, CC BY 3.0). ' +
        (spec.piece === 'ballad' ? 'Original composition (CC0).' : 'Public-domain composition.') +
        (spec.piece === 'liebestraum' ? ' Notes read from the typeset edition by RSB/Raimund (IMSLP #111552, CC BY 3.0; Internet Archive imslp-s541-liszt-franz).' : ''),
      sampleRate: spec.codec === 'opus' ? 48000 : SR,
      duration: round(x.length / SR, 3),
      speed,
      detuneCents: round(spec.detune ?? 0, 1),
      transpose,
      residualCents,
      codecDelayMs: round(delay, 1),
      key: transposeKey(piece.key, transpose),
      timeSignature: piece.timeSignature,
      ...(piece.meterNote ? { meterNote: piece.meterNote } : {}),
      beatsPerBar: piece.beatsPerBar,
      pickupBeats: piece.pickup,
      bpm: round(piece.bpm * speed, 2),
      beats: perf.beats.map(t),
      downbeats: perf.downbeats.map(t),
      pedal: perf.pedal.map((p) => ({ start: t(p.start), end: t(p.end) })),
      notes: rendered.notes.map((n) => ({
        pitch: n.pitch + transpose,
        start: t(n.start),
        duration: t(n.keyUp - n.start),
        sounding: t(n.soundingEnd - n.start),
        velocity: round(n.velocity / 127, 3),
        hand: n.hand,
        role: n.role,
      })),
    }
    writeFileSync(path.join(OUT, `${spec.name}.json`), toJson(truth))
    console.log(
      `  ${path.basename(file).padEnd(28)} ${truth.duration.toFixed(2).padStart(6)} s  ${String(truth.notes.length).padStart(3)} notes  ` +
        `${(bytes / 1024).toFixed(0).padStart(4)} KiB  shift ${transpose >= 0 ? '+' : ''}${transpose} st ${residualCents >= 0 ? '+' : ''}${residualCents} c  codec delay ${delay.toFixed(1)} ms`,
    )
  }
  console.log(`total audio ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`)
}

function describe(spec) {
  const parts = ['Salamander grand piano', spec.space === 'hall' ? 'concert hall (RT60 2.3 s)' : 'room (RT60 0.55 s)']
  if (spec.detune) parts.push(`detuned ${spec.detune > 0 ? '+' : ''}${spec.detune.toFixed(1)} cents`)
  if (spec.speed) parts.push(`sped up ${spec.speed}x with pitch`)
  if (spec.chain === 'video') parts.push('loudness-maximized like a video upload')
  if (spec.chain === 'phone') parts.push('AAC video audio played on a phone speaker and re-recorded by a phone microphone (band limit, distortion, room, noise, AGC)')
  parts.push(spec.codec === 'opus' ? `Opus ${spec.kbps} kbps` : `AAC ${spec.kbps} kbps`)
  return parts.join(', ')
}

/** JSON with one note / pedal span per line (readable diffs). */
function toJson(obj) {
  const { notes, pedal, beats, downbeats, ...head } = obj
  const lines = JSON.stringify(head, null, 2).replace(/\n}$/, '').split('\n')
  lines[lines.length - 1] += ','
  lines.push(`  "beats": ${JSON.stringify(beats)},`)
  lines.push(`  "downbeats": ${JSON.stringify(downbeats)},`)
  lines.push(`  "pedal": [\n${pedal.map((p) => `    ${JSON.stringify(p)}`).join(',\n')}\n  ],`)
  lines.push(`  "notes": [\n${notes.map((n) => `    ${JSON.stringify(n)}`).join(',\n')}\n  ]`)
  lines.push('}')
  return lines.join('\n') + '\n'
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
