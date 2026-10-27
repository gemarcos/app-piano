// Offline sampler for the Salamander Grand Piano V3 (Alexander Holm, Yamaha C5, CC BY 3.0): 16 velocity layers sampled
// in minor thirds, natural decay, dampers (none from F#6 up), sustain pedal with sympathetic resonance, damper release
// noise and pedal mechanics. Only the 16-bit SFZ distribution is read (SalamanderGrandPianoV3.sfz + 44.1khz16bit/).
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { biquad, convolve, filter, gauss, readWavMono, resample, rms, rng } from './dsp.mjs'

const NO_DAMPER_FROM = 89 // F#6 and above ring until they decay (SFZ group "Notes without dampers")
const MAX_SAMPLE_SECONDS = 9

function parseSfz(text) {
  const regions = []
  let group = {}
  let current = null
  const flush = () => {
    if (current) regions.push({ ...group, ...current })
    current = null
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim()
    if (!line) continue
    const tokens = line.match(/<\w+>|[\w#]+=[^=]+?(?=\s+[\w#]+=|\s*<|$)/g) ?? []
    for (const tok of tokens) {
      if (tok === '<group>') {
        flush()
        group = {}
        current = null
        var target = group
      } else if (tok === '<region>') {
        flush()
        current = {}
        target = current
      } else if (tok.startsWith('<')) {
        flush()
        target = {}
      } else {
        const i = tok.indexOf('=')
        if (target) target[tok.slice(0, i)] = tok.slice(i + 1).trim()
      }
    }
  }
  flush()
  return regions
}

export function loadSalamander(dir) {
  const sfz = path.join(dir, 'SalamanderGrandPianoV3.sfz')
  if (!existsSync(sfz)) throw new Error(`Salamander SFZ not found in ${dir}`)
  const regions = parseSfz(readFileSync(sfz, 'utf8'))
  const file = (s) => path.join(dir, s.replace(/\\/g, '/'))
  const notes = regions
    .filter((r) => r.sample && !r.trigger && /^44\.1khz16bit\\[A-G]#?\d+v\d+\.wav$/.test(r.sample))
    .map((r) => ({
      file: file(r.sample),
      lokey: Number(r.lokey),
      hikey: Number(r.hikey),
      lovel: Number(r.lovel ?? 1),
      hivel: Number(r.hivel ?? 127),
      center: Number(r.pitch_keycenter ?? 60),
      veltrack: Number(r.amp_veltrack ?? 100),
    }))
  const release = new Map()
  for (const r of regions) {
    const m = /\\rel(\d+)\.wav$/.exec(r.sample ?? '')
    if (m) release.set(Number(r.lokey), { file: file(r.sample), volume: Number(r.volume ?? -37) })
  }
  const pedal = {
    down: regions.filter((r) => /pedalD\d\.wav$/.test(r.sample ?? '')).map((r) => ({ file: file(r.sample), volume: Number(r.volume ?? -20) })),
    up: regions.filter((r) => /pedalU\d\.wav$/.test(r.sample ?? '')).map((r) => ({ file: file(r.sample), volume: Number(r.volume ?? -19) })),
  }
  if (notes.length < 400) throw new Error(`unexpected SFZ: ${notes.length} note regions`)
  return { dir, notes, release, pedal, cache: new Map(), shifted: new Map() }
}

function loadSample(bank, file) {
  if (bank.cache.has(file)) return bank.cache.get(file)
  const { samples, sr } = readWavMono(file)
  if (sr !== 44100) throw new Error(`expected 44.1 kHz samples: ${file}`)
  let p = 0
  const head = Math.min(samples.length, sr / 2)
  for (let i = 0; i < head; i++) p = Math.max(p, Math.abs(samples[i]))
  let attack = 0
  while (attack < head && Math.abs(samples[attack]) < 0.03 * p) attack++
  attack = Math.max(0, attack - 44)
  const out = samples.subarray(attack, Math.min(samples.length, attack + MAX_SAMPLE_SECONDS * sr))
  bank.cache.set(file, out)
  return out
}

function region(bank, pitch, vel) {
  const v = Math.max(1, Math.min(127, Math.round(vel)))
  const r = bank.notes.find((n) => pitch >= n.lokey && pitch <= n.hikey && v >= n.lovel && v <= n.hivel)
  if (!r) throw new Error(`no Salamander region for pitch ${pitch} vel ${v}`)
  return r
}

/** Pitch-shifted copy of a sample (cached), plus the time its envelope needs to fall 40 dB below its peak. */
function shiftedSample(bank, file, ratio) {
  const key = `${file}|${ratio.toFixed(7)}`
  if (bank.shifted.has(key)) return bank.shifted.get(key)
  const src = loadSample(bank, file)
  const out = Math.abs(ratio - 1) < 1e-9 ? Float32Array.from(src) : resample(src, ratio, Math.floor(src.length / ratio))
  const block = 441
  let peakEnv = 0
  const env = []
  for (let i = 0; i + block <= out.length; i += block) {
    const e = rms(out, i, i + block)
    env.push(e)
    peakEnv = Math.max(peakEnv, e)
  }
  let audible = env.length
  for (let k = env.length - 1; k >= 0; k--) if (env[k] > peakEnv * 0.01) { audible = k + 1; break }
  const entry = { samples: out, audibleSeconds: (audible * block) / 44100 }
  bank.shifted.set(key, entry)
  return entry
}

function damperTau(pitch) {
  return pitch < 40 ? 0.34 : pitch < 52 ? 0.22 : pitch < 64 ? 0.15 : pitch < 76 ? 0.11 : 0.085
}

function pedalAt(pedal, t) {
  return pedal.find((p) => t >= p.start && t < p.end)
}

/**
 * Renders notes [{ pitch, start, keyUp, velocity (1..127) }] with damper-pedal spans [{ start, end }] (seconds).
 * Returns the mono mix at 44.1 kHz and, per note, when the string stops sounding (`soundingEnd`: damper / pedal lift,
 * re-strike, or the natural decay to -40 dB, whichever comes first).
 */
export function renderPiano(bank, input, pedal, { detuneCents = 0, tail = 2.5, resonanceDb = -24, seed = 7 } = {}) {
  const sr = 44100
  const notes = input.map((n, i) => ({ ...n, index: i })).sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  const end = Math.max(...notes.map((n) => n.keyUp), ...pedal.map((p) => p.end))
  const mix = new Float32Array(Math.ceil((end + tail) * sr))
  const rand = rng(seed)
  const result = new Array(input.length)
  for (const [k, n] of notes.entries()) {
    const r = region(bank, n.pitch, n.velocity)
    const ratio = 2 ** ((n.pitch - r.center) / 12 + detuneCents / 1200)
    const { samples, audibleSeconds } = shiftedSample(bank, r.file, ratio)
    const v = n.velocity / 127
    const gain = 1 - (r.veltrack / 100) * (1 - v * v)
    let damper = Infinity
    if (n.pitch < NO_DAMPER_FROM) {
      const held = pedalAt(pedal, n.keyUp)
      damper = held ? held.end : n.keyUp
    }
    let restrike = false
    const next = notes.slice(k + 1).find((m) => m.pitch === n.pitch)
    if (next && next.start < damper) {
      damper = next.start
      restrike = true
    }
    const naturalEnd = n.start + Math.min(audibleSeconds, samples.length / sr)
    const soundingEnd = Math.min(damper, naturalEnd)
    result[n.index] = { ...input[n.index], soundingEnd }
    const at = Math.round(n.start * sr)
    const tau = (restrike ? 0.012 : damperTau(n.pitch)) * sr
    const damperIdx = Number.isFinite(damper) ? Math.round((damper - n.start) * sr) : Infinity
    const last = Math.min(samples.length, mix.length - at, Number.isFinite(damperIdx) ? damperIdx + Math.round(7 * tau) : Infinity)
    for (let i = 0; i < last; i++) {
      const env = i < damperIdx ? 1 : Math.exp(-(i - damperIdx) / tau)
      mix[at + i] += samples[i] * gain * env
    }
    // Damper noise when the felt lands on the string (quiet; skipped for re-strikes).
    const rel = bank.release.get(n.pitch)
    if (rel && Number.isFinite(damper) && !restrike) {
      const noise = loadSample(bank, rel.file)
      const g = 10 ** (rel.volume / 20) * (1 - 0.82 * (1 - v * v))
      const from = Math.round(damper * sr)
      for (let i = 0; i < noise.length && from + i < mix.length; i++) mix[from + i] += noise[i] * g
    }
  }
  // Pedal mechanics (thumps on press and lift).
  pedal.forEach((p, i) => {
    for (const [list, t] of [[bank.pedal.down, p.start], [bank.pedal.up, p.end]]) {
      if (!list.length) continue
      const s = list[(i + Math.floor(rand() * 2)) % list.length]
      const x = loadSample(bank, s.file)
      const g = 10 ** (s.volume / 20) * 0.8
      const from = Math.round(t * sr)
      for (let j = 0; j < x.length && from + j < mix.length; j++) mix[from + j] += x[j] * g
    }
  })
  // Sympathetic resonance of the undamped strings while the pedal is down: a long, dark, diffuse decay of the mix,
  // damped quickly when the pedal lifts.
  if (pedal.length && resonanceDb > -90) {
    const gate = new Float32Array(mix.length)
    let g = 0
    const aOn = Math.exp(-1 / (0.03 * sr))
    const aOff = Math.exp(-1 / (0.07 * sr))
    for (let i = 0; i < mix.length; i++) {
      const target = pedalAt(pedal, i / sr) ? 1 : 0
      g = target > g ? aOn * g + (1 - aOn) * target : aOff * g + (1 - aOff) * target
      gate[i] = g
    }
    const len = Math.round(3.2 * sr)
    const ir = new Float32Array(len)
    for (let i = 0; i < len; i++) ir[i] = gauss(rand) * Math.exp((-6.9 * i) / (3.2 * sr))
    filter(ir, biquad('highpass', sr, 180, 0.7))
    filter(ir, biquad('lowpass', sr, 3500, 0.7))
    const fed = mix.map((x, i) => x * gate[i])
    const res = convolve(fed, ir, 0)
    const scale = (rms(mix) / Math.max(1e-9, rms(res))) * 10 ** (resonanceDb / 20)
    for (let i = 0; i < mix.length; i++) mix[i] += res[i] * scale * gate[i]
  }
  return { mix, sr, notes: result }
}
