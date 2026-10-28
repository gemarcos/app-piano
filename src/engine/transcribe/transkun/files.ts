// Lazy model files for the piano model: downloaded the first time it runs, with byte progress, and kept in a
// versioned Cache Storage entry so later sessions (and offline use) need no network. None of these files is in the
// Workbox precache, so first visits stay light. Worker-side module, no tfjs / ONNX.

/** Bump the suffix whenever the shipped piano model files change: older entries are deleted on the next start. */
export const PIANO_CACHE = 'pauta-piano-transkun-v1'
/** Caches of earlier piano models (Onsets and Frames) and older versions of this one: pruned on start. */
const STALE_PREFIXES = ['pauta-onsets-frames-', 'pauta-piano-transkun-']
const STALL_MS = 30_000

export class ModelDownloadError extends Error {
  readonly offline: boolean
  constructor(message: string, offline: boolean, cause?: unknown) {
    super(message, { cause })
    this.name = 'ModelDownloadError'
    this.offline = offline
  }
}

export interface ModelFile {
  url: string
  /** Expected size in bytes (progress and integrity); 0 = unknown. */
  bytes: number
}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(PIANO_CACHE)
  } catch {
    return null
  }
}

/** Deletes caches of the removed Onsets and Frames model and of older piano model versions (best effort). */
export async function pruneStaleCaches(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return
    for (const key of await caches.keys()) if (key !== PIANO_CACHE && STALE_PREFIXES.some((p) => key.startsWith(p))) await caches.delete(key)
  } catch {
    /* storage unavailable */
  }
}

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

/** True when every file is already cached (no network needed). */
export async function filesCached(files: ModelFile[]): Promise<boolean> {
  const cache = await openCache()
  if (!cache) return false
  try {
    for (const f of files) if (!(await cache.match(f.url))) return false
    return true
  } catch {
    return false
  }
}

/** Loads the files (Cache Storage first, then the network), reporting 0..1 by bytes. Sizes are checked when known. */
export async function loadFiles(files: ModelFile[], onProgress?: (fraction: number) => void): Promise<ArrayBuffer[]> {
  void pruneStaleCaches()
  const cache = await openCache()
  const total = files.reduce((s, f) => s + f.bytes, 0) || 1
  let received = 0
  const report = (bytes: number) => {
    received += bytes
    onProgress?.(Math.min(1, received / total))
  }
  const out: ArrayBuffer[] = []
  for (const f of files) {
    const hit = await cache?.match(f.url).catch(() => undefined)
    let buffer = hit ? await hit.arrayBuffer() : null
    if (buffer && f.bytes && buffer.byteLength !== f.bytes) {
      await cache?.delete(f.url).catch(() => false)
      buffer = null
    }
    if (buffer) report(buffer.byteLength)
    else {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ModelDownloadError('offline', true)
      buffer = await download(f.url, report)
      if (f.bytes && buffer.byteLength !== f.bytes) throw new ModelDownloadError(`${f.url}: ${buffer.byteLength} bytes, expected ${f.bytes}`, false)
      await cache?.put(f.url, new Response(buffer, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {})
    }
    out.push(buffer)
  }
  return out
}

export async function readCachedJson<T>(url: string): Promise<T | null> {
  try {
    const hit = await (await openCache())?.match(url)
    return hit ? ((await hit.json()) as T) : null
  } catch {
    return null
  }
}

export async function writeCachedJson(url: string, value: unknown): Promise<void> {
  try {
    await (await openCache())?.put(url, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }))
  } catch {
    /* storage unavailable */
  }
}
