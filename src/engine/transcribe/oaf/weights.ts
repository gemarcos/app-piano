// Onsets and Frames checkpoint (public/models/onsets-frames/): downloaded lazily the first time the piano model runs,
// with byte progress, and kept in Cache Storage so it also works offline. It is NOT in the Workbox precache (first
// visits stay light); Basic Pitch is, so transcription always works offline. Worker-side module (imports tfjs).
import * as tf from '@tensorflow/tfjs'

/** Bump the suffix whenever the checkpoint files change: older caches are deleted on the next load. */
export const OAF_CACHE = 'pauta-onsets-frames-v1'
const CACHE_PREFIX = 'pauta-onsets-frames-'
const MANIFEST = 'weights_manifest.json'
/** A stalled download (no bytes for this long) is abandoned. */
const STALL_MS = 30_000

interface ManifestGroup {
  paths: string[]
  weights: tf.io.WeightsManifestEntry[]
}

export class ModelDownloadError extends Error {
  /** True when the network is unreachable (offline before the first download). */
  readonly offline: boolean
  constructor(message: string, offline: boolean, cause?: unknown) {
    super(message, { cause })
    this.name = 'ModelDownloadError'
    this.offline = offline
  }
}

const BYTES: Record<string, number> = { float32: 4, int32: 4, uint8: 1, uint16: 2, float16: 2, bool: 1 }

/** Bytes of the weight data described by a manifest group (quantized sizes included). */
export function manifestBytes(weights: tf.io.WeightsManifestEntry[]): number {
  let total = 0
  for (const w of weights) {
    const count = w.shape.reduce((a, b) => a * b, 1)
    total += count * BYTES[w.quantization?.dtype ?? w.dtype]
  }
  return total
}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(OAF_CACHE)
  } catch {
    return null
  }
}

/** Removes caches left by older checkpoint versions (best effort). */
async function pruneOldCaches() {
  try {
    if (typeof caches === 'undefined') return
    for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX) && key !== OAF_CACHE) await caches.delete(key)
  } catch {
    /* storage unavailable */
  }
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** Fetches `url` fully, reporting received bytes. Network failures become ModelDownloadError. */
async function download(url: string, onBytes: (bytes: number) => void): Promise<ArrayBuffer> {
  const controller = new AbortController()
  let timer = setTimeout(() => controller.abort(), STALL_MS)
  const alive = () => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), STALL_MS)
  }
  try {
    let res: Response
    try {
      res = await fetch(url, { signal: controller.signal, cache: 'no-cache' })
    } catch (err) {
      throw new ModelDownloadError('model download failed', true, err)
    }
    if (!res.ok) throw new ModelDownloadError(`model download failed: HTTP ${res.status}`, false)
    if (!res.body) {
      const buffer = await res.arrayBuffer()
      onBytes(buffer.byteLength)
      return buffer
    }
    const reader = res.body.getReader()
    const parts: Uint8Array[] = []
    let size = 0
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (err) {
        throw new ModelDownloadError('model download interrupted', true, err)
      }
      if (chunk.done) break
      alive()
      parts.push(chunk.value)
      size += chunk.value.byteLength
      onBytes(chunk.value.byteLength)
    }
    const out = new Uint8Array(size)
    let offset = 0
    for (const p of parts) {
      out.set(p, offset)
      offset += p.byteLength
    }
    return out.buffer
  } finally {
    clearTimeout(timer)
  }
}

async function readManifest(base: string, cache: Cache | null): Promise<ManifestGroup> {
  const url = new URL(MANIFEST, base).href
  const cached = await cache?.match(url).catch(() => undefined)
  const text = cached ? await cached.text() : new TextDecoder().decode(await download(url, () => {}))
  const parsed = JSON.parse(text) as ManifestGroup[]
  const group = parsed[0]
  if (!group?.paths?.length || !group.weights?.length) throw new Error('invalid weights manifest')
  return group
}

/** True when the manifest and every shard are already in Cache Storage (no network needed). */
export async function isModelCached(base: string): Promise<boolean> {
  const cache = await openCache()
  if (!cache) return false
  try {
    const manifest = await cache.match(new URL(MANIFEST, base).href)
    if (!manifest) return false
    const group = (JSON.parse(await manifest.text()) as ManifestGroup[])[0]
    for (const path of group.paths) if (!(await cache.match(new URL(path, base).href))) return false
    return true
  } catch {
    return false
  }
}

async function fetchAll(base: string, cache: Cache | null, onProgress?: (fraction: number) => void) {
  const group = await readManifest(base, cache)
  const expected = manifestBytes(group.weights)
  let received = 0
  const report = (bytes: number) => {
    received += bytes
    onProgress?.(Math.min(1, received / expected))
  }
  const buffers: ArrayBuffer[] = []
  for (const path of group.paths) {
    const url = new URL(path, base).href
    const hit = await cache?.match(url).catch(() => undefined)
    if (hit) {
      const buffer = await hit.arrayBuffer()
      report(buffer.byteLength)
      buffers.push(buffer)
      continue
    }
    if (isOffline()) throw new ModelDownloadError('offline', true)
    const buffer = await download(url, report)
    buffers.push(buffer)
    await cache?.put(url, new Response(buffer, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {})
  }
  const total = buffers.reduce((s, b) => s + b.byteLength, 0)
  if (total !== expected) throw new Error(`weights: ${total} bytes, manifest expects ${expected}`)
  const joined = new Uint8Array(total)
  let offset = 0
  for (const b of buffers) {
    joined.set(new Uint8Array(b), offset)
    offset += b.byteLength
  }
  // The manifest goes in last: its presence means "complete" for isModelCached.
  await cache
    ?.put(new URL(MANIFEST, base).href, new Response(JSON.stringify([group]), { headers: { 'Content-Type': 'application/json' } }))
    .catch(() => {})
  return { group, buffer: joined.buffer }
}

/**
 * Loads the checkpoint (Cache Storage first, then the network) and decodes it into float32 tensors.
 * `onProgress` gets 0..1 by bytes. A damaged cache is dropped and downloaded again once.
 */
export async function loadCheckpoint(base: string, onProgress?: (fraction: number) => void): Promise<tf.NamedTensorMap> {
  void pruneOldCaches()
  const cache = await openCache()
  try {
    const { group, buffer } = await fetchAll(base, cache, onProgress)
    return tf.io.decodeWeights(buffer, group.weights)
  } catch (err) {
    if (err instanceof ModelDownloadError || !cache) throw err
    // Corrupt or partial cache entries: start over from the network.
    await caches.delete(OAF_CACHE).catch(() => false)
    const fresh = await openCache()
    const { group, buffer } = await fetchAll(base, fresh, onProgress)
    return tf.io.decodeWeights(buffer, group.weights)
  }
}

/** Small JSON values stored next to the checkpoint (the speed verdict of this device). */
export async function readCachedJson<T>(base: string, name: string): Promise<T | null> {
  try {
    const hit = await (await openCache())?.match(new URL(name, base).href)
    return hit ? ((await hit.json()) as T) : null
  } catch {
    return null
  }
}

export async function writeCachedJson(base: string, name: string, value: unknown): Promise<void> {
  try {
    await (await openCache())?.put(new URL(name, base).href, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }))
  } catch {
    /* storage unavailable: the verdict lives only in memory */
  }
}
