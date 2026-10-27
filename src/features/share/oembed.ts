// Owner: share. oEmbed of the shared video: title, author, aspect ratio and whether it may be embedded.
// YouTube answers 401/403 when embedding is disabled; TikTok resolves a post id. Both allow CORS (TikTok
// rate-limits busy clients, and its throttled answers come without CORS headers: treated as 'failed').
import type { SharedLink } from './links'

export type OEmbedResult =
  | { status: 'ok'; title: string; author: string; ratio: number | null; id: string | null }
  | { status: 'not-embeddable' }
  | { status: 'unavailable' }
  | { status: 'offline' }
  | { status: 'failed' }

export function oEmbedUrl(link: SharedLink): string | null {
  if (link.platform === 'youtube' && link.id) {
    return 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + link.id)
  }
  if (link.platform === 'tiktok' && (link.id || link.short)) {
    return 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(link.url)
  }
  return null
}

/** HTTP status of a failed oEmbed request -> what the screen shows. */
export function classifyStatus(status: number): 'not-embeddable' | 'unavailable' | 'failed' {
  if (status === 401 || status === 403) return 'not-embeddable'
  if (status === 400 || status === 404 || status === 410) return 'unavailable'
  return 'failed'
}

const num = (value: unknown): number | null => {
  const n = typeof value === 'string' ? parseFloat(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** TikTok post id from an oEmbed answer (embed_product_id, or the player URL in its html). */
function tiktokId(json: Record<string, unknown>): string | null {
  const direct = typeof json.embed_product_id === 'string' ? json.embed_product_id : ''
  if (/^\d{8,25}$/.test(direct)) return direct
  const html = typeof json.html === 'string' ? json.html : ''
  const m = /player\/v1\/(\d{8,25})|data-video-id="(\d{8,25})"|\/video\/(\d{8,25})/.exec(html)
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null
}

export function parseOEmbed(link: SharedLink, json: unknown): OEmbedResult {
  if (!json || typeof json !== 'object') return { status: 'failed' }
  const data = json as Record<string, unknown>
  const width = num(data.width)
  const height = num(data.height)
  return {
    status: 'ok',
    title: typeof data.title === 'string' ? data.title : '',
    author: typeof data.author_name === 'string' ? data.author_name : '',
    ratio: width && height ? width / height : null,
    id: link.platform === 'tiktok' ? tiktokId(data) : link.id,
  }
}

function offline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false
  } catch {
    return false
  }
}

/** Fetches the oEmbed of a link. Never throws (aborts and timeouts resolve as 'failed'). */
export async function fetchOEmbed(link: SharedLink, signal?: AbortSignal, timeoutMs = 9000): Promise<OEmbedResult> {
  const url = oEmbedUrl(link)
  if (!url) return { status: 'failed' }
  if (offline()) return { status: 'offline' }
  // AbortSignal.any / .timeout are missing in older Safari: combine by hand.
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = setTimeout(abort, timeoutMs)
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const res = await fetch(url, { credentials: 'omit', signal: controller.signal })
    if (!res.ok) return { status: classifyStatus(res.status) }
    return parseOEmbed(link, await res.json())
  } catch {
    return { status: offline() ? 'offline' : 'failed' }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
