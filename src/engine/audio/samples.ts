// Pure sample helpers (no DOM): normalization, peaks, levels, mono mixdown.

/** Scales `samples` in place so the absolute peak equals `target`. Returns the applied gain (1 for silence). */
export function peakNormalize(samples: Float32Array, target = 0.95): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  if (!(peak > 1e-6)) return 1
  const gain = target / peak
  for (let i = 0; i < samples.length; i++) samples[i] *= gain
  return gain
}

/** At most this many samples per channel are inspected per bin (keeps long files fast). */
const MAX_READS_PER_BIN = 1024

/**
 * Peak envelope of one or more equally long channels: `bins` values in 0..1,
 * normalized so the loudest bin is 1 (all zeros for silence).
 */
export function peaksFromChannels(channels: ArrayLike<number>[], bins: number): Float32Array {
  const count = Math.max(0, Math.floor(bins))
  const out = new Float32Array(count)
  const length = channels.length ? Math.min(...channels.map((c) => c.length)) : 0
  if (!count || !length) return out

  let max = 0
  for (let b = 0; b < count; b++) {
    const from = Math.floor((b * length) / count)
    const to = Math.min(length, Math.max(from + 1, Math.floor(((b + 1) * length) / count)))
    const step = Math.max(1, Math.floor((to - from) / MAX_READS_PER_BIN))
    let peak = 0
    for (const channel of channels) {
      for (let i = from; i < to; i += step) {
        const a = Math.abs(channel[i])
        if (a > peak) peak = a
      }
    }
    out[b] = peak
    if (peak > max) max = peak
  }
  if (max > 1e-6) for (let b = 0; b < count; b++) out[b] /= max
  else out.fill(0)
  return out
}

/** Quietest level shown by the meter, dBFS. */
export const LEVEL_FLOOR_DB = -60
/** Level that already reads as full scale, dBFS. */
export const LEVEL_CEIL_DB = -6

/** Perceptual 0..1 level from an RMS amplitude (linear in dB between the floor and the ceiling). */
export function rmsToLevel(rms: number): number {
  if (!(rms > 0)) return 0
  const db = 20 * Math.log10(rms)
  const level = (db - LEVEL_FLOOR_DB) / (LEVEL_CEIL_DB - LEVEL_FLOOR_DB)
  return Math.min(1, Math.max(0, level))
}

/** RMS of a block of samples. */
export function rms(block: ArrayLike<number>): number {
  if (!block.length) return 0
  let sum = 0
  for (let i = 0; i < block.length; i++) sum += block[i] * block[i]
  return Math.sqrt(sum / block.length)
}

/** Averages channels into one, optionally cropped to [from, to) sample indices. */
export function mixToMono(channels: ArrayLike<number>[], from = 0, to?: number): Float32Array {
  const length = channels.length ? Math.min(...channels.map((c) => c.length)) : 0
  const start = Math.max(0, Math.min(length, Math.floor(from)))
  const end = Math.max(start, Math.min(length, Math.floor(to ?? length)))
  const out = new Float32Array(end - start)
  if (!channels.length) return out
  const scale = 1 / channels.length
  for (const channel of channels) {
    for (let i = start; i < end; i++) out[i - start] += channel[i] * scale
  }
  return out
}

/** Clamps an optional [start, end) range (seconds) to [0, duration]. */
export function clampRange(range: { start: number; end: number } | undefined, duration: number): { start: number; end: number } {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0
  const rawStart = Number.isFinite(range?.start) ? (range as { start: number }).start : 0
  const rawEnd = Number.isFinite(range?.end) ? (range as { end: number }).end : total
  const start = Math.min(total, Math.max(0, rawStart))
  const end = Math.min(total, Math.max(start, rawEnd))
  return { start, end }
}
