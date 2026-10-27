// Score-to-performance alignment (used by scripts/fixtures/align-reference.mjs): chroma features of the recording and
// of a feature-domain piano rendering of the reference, a coarse subsequence DTW (finds the covered section and the
// transposition), a fine banded DTW around it, and onset refinement on the recording's pitch-specific spectral flux.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

export const SR = 22050
const GAMMA = 100

export function decodeAudio(file) {
  const res = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${res.stderr}`)
  const buf = res.stdout
  const samples = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  let peak = 0
  for (const v of samples) peak = Math.max(peak, Math.abs(v))
  if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i] /= peak
  return samples
}

function fftTables(n) {
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n)
    sin[k] = Math.sin((2 * Math.PI * k) / n)
  }
  const bits = Math.log2(n)
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  const win = new Float64Array(n)
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  return { cos, sin, rev, win, n }
}

function powerSpectrum(samples, center, t, re, im, out) {
  const { n, rev, win, cos, sin } = t
  const start = center - n / 2
  for (let i = 0; i < n; i++) {
    const j = start + i
    re[rev[i]] = j >= 0 && j < samples.length ? samples[j] * win[i] : 0
    im[rev[i]] = 0
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const step = n / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const a = i + k
        const b = a + half
        const tr = re[b] * cos[w] + im[b] * sin[w]
        const ti = im[b] * cos[w] - re[b] * sin[w]
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
  for (let k = 0; k <= n / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k]
}

/** Log-frequency triangular bands, one per piano key (21..108), tuned by `cents`. */
function pitchBands(n, cents) {
  const bands = []
  for (let p = 21; p <= 108; p++) {
    const f = 440 * 2 ** ((p - 69) / 12 + cents / 1200)
    const kLo = Math.floor((f * 2 ** (-1 / 24) * n) / SR)
    const kHi = Math.ceil((f * 2 ** (1 / 24) * n) / SR)
    const bins = []
    for (let k = Math.max(1, kLo); k <= Math.min(n / 2, kHi); k++) {
      const d = Math.abs(12 * Math.log2((k * SR) / n / f))
      if (d < 0.5) bins.push([k, 1 - 2 * d])
    }
    if (!bins.length) {
      const x = (f * n) / SR
      const k0 = Math.floor(x)
      bins.push([k0, 1 - (x - k0)], [k0 + 1, x - k0])
    }
    bands.push(bins)
  }
  return bands
}

/** Energy per piano key [frames][88], frames centred every `hop` samples (window `n`). */
export function pitchEnergy(samples, hop, n, cents = 0) {
  const t = fftTables(n)
  const bands = pitchBands(n, cents)
  const frames = Math.floor(samples.length / hop) + 1
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const pow = new Float64Array(n / 2 + 1)
  const out = Array.from({ length: frames }, () => new Float64Array(88))
  for (let f = 0; f < frames; f++) {
    powerSpectrum(samples, f * hop, t, re, im, pow)
    const row = out[f]
    for (let p = 0; p < 88; p++) {
      let e = 0
      for (const [k, w] of bands[p]) e += pow[k] * w
      row[p] = e
    }
  }
  return out
}

/** Feature-domain piano rendering of reference notes: energy per key and frame (partials, decay, damper, pedal). */
export function referenceEnergy(notes, pedal, frames, hopSec) {
  const out = Array.from({ length: frames }, () => new Float64Array(88))
  const pedalEnd = (time) => {
    for (const [a, b] of pedal) if (time >= a && time < b) return b
    return time
  }
  for (const note of notes) {
    const amp = Math.max(0.05, note.velocity ?? 0.5) ** 1.5
    const tau = Math.min(5, Math.max(0.25, 3.5 * 2 ** (-(note.pitch - 40) / 18)))
    const release = pedalEnd(note.end)
    const first = Math.max(0, Math.floor(note.start / hopSec))
    const last = Math.min(frames - 1, Math.ceil((release + 0.4) / hopSec))
    for (let k = 1; k <= 8; k++) {
      const key = Math.round(note.pitch + 12 * Math.log2(k)) - 21
      if (key < 0 || key >= 88) continue
      const a2 = (amp * k ** -0.9) ** 2
      for (let f = first; f <= last; f++) {
        const time = f * hopSec - note.start
        if (time < -hopSec) continue
        let env = Math.exp(-Math.max(0, time) / tau)
        if (f * hopSec > release) env *= Math.exp(-(f * hopSec - release) / 0.08)
        out[f][key] += a2 * env * env
      }
    }
  }
  return out
}

/** Log-compressed chroma (CLP-like), L2-normalized; energies scaled by their 99th percentile first. */
export function chroma(energy) {
  const all = []
  for (const row of energy) for (let p = 0; p < 88; p += 7) all.push(row[p])
  all.sort((a, b) => a - b)
  const ref = all[Math.floor(all.length * 0.99)] || 1
  return energy.map((row) => {
    const c = new Float64Array(12)
    for (let p = 0; p < 88; p++) c[(p + 21) % 12] += Math.log1p((GAMMA * row[p]) / ref)
    let norm = 0
    for (const v of c) norm += v * v
    norm = Math.sqrt(norm)
    if (norm < 1e-6) return c.fill(1 / Math.sqrt(12))
    for (let i = 0; i < 12; i++) c[i] /= norm
    return c
  })
}

/**
 * Decaying locally-normalized chroma onset features (DLNCO, after Ewert, Mueller and Grosche 2009): positive log
 * energy changes per key folded to chroma, normalized by the local maximum (+-1.5 s), smeared by a decaying kernel
 * (~200 ms). They make every attack a distinct event, so repeated arpeggios over one harmony still align.
 */
export function onsetChroma(energy, hopSec) {
  const all = []
  for (const row of energy) for (let p = 0; p < 88; p += 7) all.push(row[p])
  all.sort((a, b) => a - b)
  const ref = all[Math.floor(all.length * 0.99)] || 1
  const log = energy.map((row) => row.map((v) => Math.log1p((GAMMA * v) / ref)))
  const raw = log.map((row, t) => {
    const c = new Float64Array(12)
    if (t === 0) return c
    const prev = log[t - 1]
    for (let p = 0; p < 88; p++) c[(p + 21) % 12] += Math.max(0, row[p] - prev[p])
    return c
  })
  const norms = raw.map((c) => Math.sqrt(c.reduce((s, v) => s + v * v, 0)))
  const w = Math.max(1, Math.round(1.5 / hopSec))
  const decay = Math.max(2, Math.round(0.2 / hopSec))
  const kernel = Array.from({ length: decay }, (_, k) => Math.sqrt((decay - k) / decay))
  // Sliding maximum of the onset norm.
  const localMax = norms.map((_, t) => {
    let m = 1e-9
    for (let k = Math.max(0, t - w); k <= Math.min(norms.length - 1, t + w); k++) if (norms[k] > m) m = norms[k]
    return m
  })
  const scaled = raw.map((c, t) => c.map((v) => v / localMax[t]))
  return scaled.map((_, t) => {
    const out = new Float64Array(12)
    for (let k = 0; k < decay && t - k >= 0; k++) for (let i = 0; i < 12; i++) out[i] += kernel[k] * scaled[t - k][i]
    return out
  })
}

const dot12 = (x, y) => {
  let d = 0
  for (let k = 0; k < 12; k++) d += x[k] * y[k]
  return d
}

/**
 * DTW with step sizes (1,1), (1,2), (2,1) (slope 1/2..2); every recording frame costs once. `subsequence`: the
 * reference start and end are free. `band(i)` -> [jMin, jMax] limits the reference frames per recording frame.
 */
export function dtw(a, b, { subsequence = true, band = null, onsetA = null, onsetB = null, onsetWeight = 0 } = {}) {
  const N = a.length
  const M = b.length
  const local = (i, j) => {
    let c = 1 - dot12(a[i], b[j])
    if (onsetWeight && onsetA && onsetB) {
      let d = 0
      const x = onsetA[i]
      const y = onsetB[j]
      for (let k = 0; k < 12; k++) d += (x[k] - y[k]) ** 2
      c += onsetWeight * Math.sqrt(d)
    }
    return c
  }
  const lo = new Int32Array(N)
  const hi = new Int32Array(N)
  for (let i = 0; i < N; i++) {
    const [x, y] = band ? band(i) : [0, M - 1]
    lo[i] = Math.max(0, Math.min(M - 1, x))
    hi[i] = Math.max(lo[i], Math.min(M - 1, y))
  }
  const width = Math.max(...Array.from(hi, (v, i) => v - lo[i] + 1))
  const D = new Float32Array(N * width).fill(Infinity)
  const step = new Uint8Array(N * width)
  const at = (i, j) => (j < lo[i] || j > hi[i] ? Infinity : D[i * width + (j - lo[i])])
  for (let j = lo[0]; j <= hi[0]; j++) D[j - lo[0]] = subsequence || j === 0 ? local(0, j) : Infinity
  for (let i = 1; i < N; i++) {
    for (let j = Math.max(1, lo[i]); j <= hi[i]; j++) {
      const c = local(i, j)
      let best = at(i - 1, j - 1)
      let s = 0
      const v1 = j >= 2 ? at(i - 1, j - 2) : Infinity
      if (v1 < best) {
        best = v1
        s = 1
      }
      if (i >= 2) {
        const v2 = at(i - 2, j - 1) + local(i - 1, j)
        if (v2 < best) {
          best = v2
          s = 2
        }
      }
      D[i * width + (j - lo[i])] = c + best
      step[i * width + (j - lo[i])] = s
    }
  }
  let end = hi[N - 1]
  if (subsequence) for (let j = lo[N - 1]; j <= hi[N - 1]; j++) if (at(N - 1, j) < at(N - 1, end)) end = j
  const path = []
  let i = N - 1
  let j = end
  while (i > 0 && j > 0) {
    path.push([i, j])
    const s = step[i * width + (j - lo[i])]
    if (s === 0) {
      i -= 1
      j -= 1
    } else if (s === 1) {
      i -= 1
      j -= 2
    } else {
      path.push([i - 1, j])
      i -= 2
      j -= 1
    }
  }
  path.push([Math.max(0, i), Math.max(0, j)])
  path.reverse()
  return { path, cost: at(N - 1, end) / N }
}

/** Monotone piecewise-linear map reference seconds -> recording seconds from a DTW path. */
export function warpMap(path, hopSec, refOffsetSec = 0, recHopSec = hopSec) {
  const byRef = new Map()
  for (const [i, j] of path) {
    const list = byRef.get(j) ?? []
    list.push(i)
    byRef.set(j, list)
  }
  const pts = [...byRef.entries()].sort((x, y) => x[0] - y[0]).map(([j, is]) => [refOffsetSec + j * hopSec, (is.reduce((s, v) => s + v, 0) / is.length) * recHopSec])
  const ys = pts.map((p, k) => {
    const win = pts.slice(Math.max(0, k - 2), k + 3).map((q) => q[1]).sort((u, v) => u - v)
    return win[Math.floor(win.length / 2)]
  })
  for (let k = 1; k < ys.length; k++) ys[k] = Math.max(ys[k], ys[k - 1])
  const xs = pts.map((p) => p[0])
  const map = (x) => {
    if (x <= xs[0]) return ys[0] + (x - xs[0])
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1] + (x - xs[xs.length - 1])
    let a = 0
    let b = xs.length - 1
    while (b - a > 1) {
      const mid = (a + b) >> 1
      if (xs[mid] <= x) a = mid
      else b = mid
    }
    const t = (x - xs[a]) / Math.max(1e-9, xs[b] - xs[a])
    return ys[a] + t * (ys[b] - ys[a])
  }
  return { from: xs[0], to: xs[xs.length - 1], map }
}

/** Onset strength per key: positive log-energy change between frames f - lag and f (window `n`, hop `hop`). */
export function keyFlux(samples, { hop = 64, n = 1024, lag = 2, cents = 0 } = {}) {
  const energy = pitchEnergy(samples, hop, n, cents)
  const log = energy.map((row) => row.map((v) => Math.log1p(1e4 * v)))
  return {
    hopSec: hop / SR,
    lag,
    flux: log.map((row, f) => {
      const prev = log[Math.max(0, f - lag)]
      const out = new Float32Array(88)
      for (let p = 0; p < 88; p++) out[p] = Math.max(0, row[p] - prev[p])
      return out
    }),
  }
}

/**
 * Moves each onset group (notes sharing a reference onset) to the strongest clear flux peak of its keys (fundamental,
 * octave, twelfth) within +-search seconds; `bias` (seconds) is added to every refined time (calibrated on the
 * benchmark: the flux of a centred window peaks before the hammer strike). Returns stats.
 */
export function refineGroups(groups, kf, { search = 0.06, bias = 0, ratio = 3, floor = 0.5 } = {}) {
  const radius = Math.round(search / kf.hopSec)
  const corrections = []
  for (const g of groups) {
    const center = Math.round(g.time / kf.hopSec)
    const keys = new Set()
    for (const p of g.pitches)
      for (const k of [1, 2, 3]) {
        const key = Math.round(p + 12 * Math.log2(k)) - 21
        if (key >= 0 && key < 88) keys.add(key)
      }
    let best = -1
    let bestAt = center
    const values = []
    for (let f = center - radius; f <= center + radius; f++) {
      if (f < 1 || f >= kf.flux.length) continue
      let s = 0
      for (const key of keys) s += kf.flux[f][key]
      values.push(s)
      if (s > best) {
        best = s
        bestAt = f
      }
    }
    values.sort((a, b) => a - b)
    const median = values[Math.floor(values.length / 2)] ?? 0
    if (best > 0 && best > ratio * median + floor) {
      const t = bestAt * kf.hopSec + bias
      corrections.push(t - g.time)
      g.time = t
      g.refined = true
    }
  }
  for (let k = 1; k < groups.length; k++) if (groups[k].time < groups[k - 1].time + 0.004) groups[k].time = groups[k - 1].time + 0.004
  return { refined: corrections.length, corrections }
}

/** Groups notes whose reference onsets are within `within` seconds (chords). */
export function onsetGroups(notes, warp, within = 0.03) {
  const groups = []
  for (const n of notes) {
    const g = groups[groups.length - 1]
    if (g && n.start - g.refTime < within) {
      g.notes.push(n)
      g.pitches.push(n.pitch)
    } else groups.push({ refTime: n.start, time: warp.map(n.start), notes: [n], pitches: [n.pitch], refined: false })
  }
  return groups
}

/**
 * Full alignment: transposition search + coarse subsequence DTW (coarseHop) + fine banded DTW (fineHop) over the
 * coarse path +-bandSec. `notes`: { pitch, start, end, velocity 0..1 } in reference seconds; `pedal`: [[a, b]].
 */
export function align(samples, notes, pedal, { cents = 0, transpose = 'auto', coarseMs = 40, fineMs = 20, bandSec = 0.6, onsetWeight = 1, log = () => {} } = {}) {
  const refStart = Math.max(0, Math.min(...notes.map((n) => n.start)) - 1)
  const refEnd = Math.max(...notes.map((n) => n.end)) + 1
  const relPedal = pedal.map(([a, b]) => [a - refStart, b - refStart])
  const refEnergyAt = (hopSec, semitones) => {
    const frames = Math.ceil((refEnd - refStart) / hopSec) + 1
    const rel = notes.map((n) => ({ ...n, pitch: n.pitch + semitones, start: n.start - refStart, end: n.end - refStart }))
    return referenceEnergy(rel, relPedal, frames, hopSec)
  }
  const refChromaAt = (hopSec, semitones) => chroma(refEnergyAt(hopSec, semitones))
  const coarseHop = Math.round((SR * coarseMs) / 1000)
  const recCoarse = chroma(pitchEnergy(samples, coarseHop, 4096, cents))
  let candidates = [Number(transpose)]
  if (transpose === 'auto') {
    const mean = (rows) => rows.reduce((m, r) => m.map((v, k) => v + r[k]), new Array(12).fill(0))
    const base = mean(refChromaAt(coarseHop / SR, 0))
    const rec = mean(recCoarse)
    const score = (r) => {
      let d = 0
      let na = 0
      let nb = 0
      for (let k = 0; k < 12; k++) {
        const x = rec[k]
        const y = base[(k - r + 12) % 12]
        d += x * y
        na += x * x
        nb += y * y
      }
      return d / Math.sqrt(na * nb)
    }
    candidates = Array.from({ length: 12 }, (_, r) => (r > 6 ? r - 12 : r)).sort((a, b) => score(b) - score(a)).slice(0, 3)
  }
  let best = null
  for (const semitones of candidates) {
    const ref = refChromaAt(coarseHop / SR, semitones)
    const r = dtw(recCoarse, ref)
    log(`  transpose ${semitones >= 0 ? '+' : ''}${semitones}: coarse DTW cost ${r.cost.toFixed(3)}`)
    if (!best || r.cost < best.cost) best = { ...r, semitones }
  }
  const coarseSec = coarseHop / SR
  const coarse = warpMap(best.path, coarseSec, refStart, coarseSec)
  // Fine pass: recording frame i may only meet reference frames near the coarse estimate.
  const fineHop = Math.round((SR * fineMs) / 1000)
  const fineSec = fineHop / SR
  const recEnergy = pitchEnergy(samples, fineHop, 4096, cents)
  const refEnergy = refEnergyAt(fineSec, best.semitones)
  const recFine = chroma(recEnergy)
  const refFine = chroma(refEnergy)
  const onsetA = onsetWeight ? onsetChroma(recEnergy, fineSec) : null
  const onsetB = onsetWeight ? onsetChroma(refEnergy, fineSec) : null
  // Inverse of the coarse map: recording seconds -> reference seconds.
  const invPts = []
  for (let x = coarse.from; x <= coarse.to; x += fineSec) invPts.push([coarse.map(x), x])
  const inv = (y) => {
    let a = 0
    let b = invPts.length - 1
    if (y <= invPts[0][0]) return invPts[0][1]
    if (y >= invPts[b][0]) return invPts[b][1]
    while (b - a > 1) {
      const mid = (a + b) >> 1
      if (invPts[mid][0] <= y) a = mid
      else b = mid
    }
    return invPts[a][1]
  }
  const band = Math.round(bandSec / fineSec)
  const fine = dtw(recFine, refFine, {
    subsequence: true,
    onsetA,
    onsetB,
    onsetWeight,
    band: (i) => {
      const j = Math.round((inv(i * fineSec) - refStart) / fineSec)
      return [j - band, j + band]
    },
  })
  const warp = warpMap(fine.path, fineSec, refStart, fineSec)
  return { warp, transpose: best.semitones, coarseCost: best.cost, cost: fine.cost, refStart }
}

/** Minimal RGB PNG writer (diagnostic plots). */
export function writePng(file, width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y)
      const o = y * (width * 3 + 1) + 1 + x * 3
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}
