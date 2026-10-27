// Owner: share. Finds and classifies the links people share with Pauta (YouTube, TikTok). Pure: no DOM, no network.
// Nothing here downloads media: a link only ever opens the platform's official embed player.

export type LinkPlatform = 'youtube' | 'tiktok' | 'other'

export interface SharedLink {
  platform: LinkPlatform
  /** YouTube video id (11 characters) or TikTok post id (digits); null when the link carries none. */
  id: string | null
  /** TikTok short link (vm.tiktok.com, vt.tiktok.com, tiktok.com/t/…): the id is only known once resolved. */
  short: boolean
  /** Portrait video (YouTube Shorts, TikTok). */
  vertical: boolean
  /** Start time in seconds (YouTube `t=` / `start=`), when the link has one. */
  start?: number
  /** Clean link without tracking parameters: kept as the item's sourceName and used in /link?url=. */
  url: string
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const TIKTOK_ID = /^\d{8,25}$/

/** Characters allowed in a URL (RFC 3986, %, and letters of any script). Spaces, quotes, «» or emoji end it. */
const URL_CHARS = '[\\p{L}\\p{N}\\-._~:/?#\\[\\]@!$&()*+,;=%]'
const WITH_SCHEME = new RegExp(`\\bhttps?://${URL_CHARS}+`, 'giu')
/** Links written without a scheme, only for the platforms Pauta knows ("youtu.be/…", "www.tiktok.com/…"). */
const BARE = new RegExp(
  `(?:^|[^\\p{L}\\p{N}.@/])((?:[a-z]+\\.)?(?:youtube\\.com|youtu\\.be|youtube-nocookie\\.com|tiktok\\.com)/${URL_CHARS}*)`,
  'giu',
)
/** Punctuation that ends a sentence rather than the link. */
const TRAILING = '.,;:!?]}*'

/** Drops sentence punctuation after a link; a ")" stays only when it closes a "(" inside the link itself. */
function trimTrailing(candidate: string): string {
  let out = candidate
  while (out.length) {
    const last = out[out.length - 1]
    if (last === ')') {
      const opens = out.split('(').length - 1
      const closes = out.split(')').length - 1
      if (opens >= closes) break
    } else if (!TRAILING.includes(last)) break
    out = out.slice(0, -1)
  }
  return out
}

/** Every link in a piece of shared text, in order (scheme-less YouTube/TikTok links get https://). */
export function findLinks(text: string | null | undefined): string[] {
  if (!text) return []
  const found: { at: number; url: string }[] = []
  for (const m of text.matchAll(WITH_SCHEME)) found.push({ at: m.index ?? 0, url: trimTrailing(m[0]) })
  for (const m of text.matchAll(BARE)) {
    const at = (m.index ?? 0) + m[0].indexOf(m[1])
    // Already part of a link with a scheme.
    if (found.some((f) => at >= f.at && at < f.at + f.url.length)) continue
    found.push({ at, url: 'https://' + trimTrailing(m[1]) })
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.url)
}

/** "90", "90s", "1m30s", "1h2m3s" -> seconds. */
export function parseStartTime(value: string | null): number | undefined {
  if (!value) return undefined
  const v = value.trim().toLowerCase()
  if (/^\d+(\.\d+)?s?$/.test(v)) {
    const s = Math.floor(parseFloat(v))
    return s > 0 ? s : undefined
  }
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v)
  if (!m || !(m[1] || m[2] || m[3])) return undefined
  const s = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  return s > 0 ? s : undefined
}

function toUrl(raw: string): URL | null {
  const text = raw.trim()
  if (!text) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : 'https://' + text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function isYouTubeHost(host: string): boolean {
  return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')
}

function isTikTokHost(host: string): boolean {
  return host === 'tiktok.com' || host.endsWith('.tiktok.com')
}

function youtube(url: URL, host: string): SharedLink | null {
  const parts = url.pathname.split('/').filter(Boolean)
  let id: string | null = null
  let vertical = false
  if (host === 'youtu.be') id = parts[0] ?? null
  else if (parts[0] === 'watch') id = url.searchParams.get('v')
  else if (parts[0] === 'shorts') {
    id = parts[1] ?? null
    vertical = true
  } else if (['embed', 'live', 'v', 'e'].includes(parts[0] ?? '')) id = parts[1] ?? null
  else if (parts[0] === 'attribution_link') {
    // /attribution_link?u=/watch%3Fv%3DID%26feature%3Dshare
    const inner = toUrl('https://www.youtube.com' + (url.searchParams.get('u') ?? ''))
    return inner ? youtube(inner, 'youtube.com') : null
  }
  if (!id || !YOUTUBE_ID.test(id)) return { platform: 'youtube', id: null, short: false, vertical: false, url: url.href }
  const start = parseStartTime(url.searchParams.get('t') ?? url.searchParams.get('start'))
  const canonical = vertical ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ''}`
  return { platform: 'youtube', id, short: false, vertical, start, url: canonical }
}

function tiktok(url: URL, host: string): SharedLink {
  const parts = url.pathname.split('/').filter(Boolean)
  const clean = `https://${url.hostname.toLowerCase()}${url.pathname}`
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com' || (parts[0] === 't' && parts[1])) {
    return { platform: 'tiktok', id: null, short: true, vertical: true, url: clean.endsWith('/') ? clean : clean + '/' }
  }
  let id: string | null = null
  let user: string | null = null
  if (parts[0]?.startsWith('@') && (parts[1] === 'video' || parts[1] === 'photo')) {
    user = parts[0]
    id = parts[2] ?? null
  } else if (parts[0] === 'video') id = parts[1] ?? null
  else if (parts[0] === 'embed') id = (parts[1] === 'v2' ? parts[2] : parts[1]) ?? null
  else if (parts[0] === 'player' && parts[1] === 'v1') id = parts[2] ?? null
  else if (parts[0] === 'v') id = (parts[1] ?? '').replace(/\.html$/, '')
  if (!id || !TIKTOK_ID.test(id)) return { platform: 'tiktok', id: null, short: false, vertical: true, url: clean }
  const canonical = user ? `https://www.tiktok.com/${user}/video/${id}` : `https://www.tiktok.com/embed/v2/${id}`
  return { platform: 'tiktok', id, short: false, vertical: true, url: canonical }
}

/** Classifies one link. null when it is not a web link at all. */
export function parseLink(raw: string | null | undefined): SharedLink | null {
  const url = toUrl(raw ?? '')
  if (!url || !url.hostname.includes('.')) return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (isYouTubeHost(host)) return youtube(url, host) ?? { platform: 'youtube', id: null, short: false, vertical: false, url: url.href }
  if (isTikTokHost(host)) return tiktok(url, host)
  return { platform: 'other', id: null, short: false, vertical: false, url: url.href }
}

/** A video Pauta can open in its player screen (YouTube or TikTok, with an id or as a TikTok short link). */
export function isPlayable(link: SharedLink): boolean {
  return link.platform !== 'other' && (link.id !== null || link.short)
}

/**
 * The best link in what was shared: fields are searched in order (Android puts links in `text`; `url` is rare;
 * `title` sometimes repeats them). Playable YouTube/TikTok links win over any other web link.
 */
export function pickLink(...fields: (string | null | undefined)[]): SharedLink | null {
  const links = fields.flatMap((f) => findLinks(f)).map(parseLink).filter((l): l is SharedLink => l !== null)
  return links.find(isPlayable) ?? links.find((l) => l.platform !== 'other') ?? links[0] ?? null
}

/** Route of the link screen for a link. */
export function linkPath(link: SharedLink | string): string {
  return '/link?url=' + encodeURIComponent(typeof link === 'string' ? link : link.url)
}

export function platformName(platform: LinkPlatform): string {
  return platform === 'youtube' ? 'YouTube' : platform === 'tiktok' ? 'TikTok' : ''
}

/**
 * Library title from a video title: no emoji or pictographs (the app never shows them), no trailing hashtags
 * (TikTok captions), single spaces, at most 90 characters. '' when nothing is left.
 */
export function cleanTitle(title: string | null | undefined): string {
  if (!title) return ''
  let t = title
    .normalize('NFC')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}︎️‍⃣]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  t = t.replace(/(?:\s*#[\p{L}\p{N}_]+)+\s*$/u, '').trim()
  t = t.replace(/^[\s\-–—|·:,.]+|[\s\-–—|·:,]+$/g, '').trim()
  if (t.length > 90) t = t.slice(0, 89).replace(/\s+\S*$/, '') + '…'
  return t
}
