// Owner: share. The "inbox" the service worker fills when Android shares something with Pauta
// (public/share-target-sw.js writes it, #/shared reads and clears it). Cache Storage, so the files stay Blobs.
// Keep SHARE_CACHE and the key layout in sync with public/share-target-sw.js.
import type { SharePayload } from './intake'

export const SHARE_CACHE = 'pauta-share-v1'
/** Keys end with these paths (absolute URLs under the service worker scope). */
export const META_SUFFIX = '/__share/meta'
/** A share older than this is ignored (it was never opened). */
export const SHARE_MAX_AGE_MS = 15 * 60 * 1000

interface CacheLike {
  match(request: string | Request): Promise<Response | undefined>
  keys(): Promise<readonly Request[]>
}

export interface CacheStorageLike {
  has(name: string): Promise<boolean>
  open(name: string): Promise<CacheLike>
  delete(name: string): Promise<boolean>
}

interface StoredMeta {
  v?: number
  at?: number
  title?: unknown
  text?: unknown
  url?: unknown
  files?: { key?: unknown; name?: unknown; type?: unknown }[]
}

const str = (value: unknown) => (typeof value === 'string' ? value : '')

function defaultStorage(): CacheStorageLike | null {
  try {
    return typeof caches === 'undefined' ? null : (caches as unknown as CacheStorageLike)
  } catch {
    return null // insecure context: no Cache Storage (and no service worker either)
  }
}

/**
 * Reads the last share stored by the service worker and clears the inbox (a share is opened once).
 * Null when there is none, it is stale, or Cache Storage is unavailable. Never throws.
 */
export async function takeSharedPayload(storage: CacheStorageLike | null = defaultStorage(), now = Date.now()): Promise<SharePayload | null> {
  if (!storage) return null
  try {
    if (!(await storage.has(SHARE_CACHE))) return null
    const cache = await storage.open(SHARE_CACHE)
    const keys = await cache.keys()
    const metaKey = keys.find((k) => new URL(k.url).pathname.endsWith(META_SUFFIX))
    const metaResponse = metaKey ? await cache.match(metaKey) : undefined
    if (!metaResponse) return null
    const meta = (await metaResponse.json()) as StoredMeta
    if (typeof meta.at === 'number' && now - meta.at > SHARE_MAX_AGE_MS) return null
    const files: File[] = []
    for (const ref of meta.files ?? []) {
      const key = str(ref.key)
      const response = key ? await cache.match(key) : undefined
      if (!response) continue
      const blob = await response.blob()
      files.push(new File([blob], str(ref.name) || 'archivo', { type: str(ref.type) || blob.type }))
    }
    return { title: str(meta.title), text: str(meta.text), url: str(meta.url), files }
  } catch {
    return null
  } finally {
    await storage.delete(SHARE_CACHE).catch(() => false)
  }
}
