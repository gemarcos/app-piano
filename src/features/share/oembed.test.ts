import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseLink, type SharedLink } from './links'
import { classifyStatus, fetchOEmbed, oEmbedUrl, parseOEmbed } from './oembed'
import { tiktokPlayerUrl } from './players'

const yt = parseLink('https://youtu.be/jNQXAC9IVRw?si=x') as SharedLink
const tt = parseLink('https://www.tiktok.com/@scout2015/video/6718335390845095173') as SharedLink
const ttShort = parseLink('https://vm.tiktok.com/ZGeToSUk4/') as SharedLink

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('oEmbed', () => {
  it('asks the official endpoints', () => {
    expect(oEmbedUrl(yt)).toBe('https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DjNQXAC9IVRw')
    expect(oEmbedUrl(tt)).toBe('https://www.tiktok.com/oembed?url=' + encodeURIComponent('https://www.tiktok.com/@scout2015/video/6718335390845095173'))
    expect(oEmbedUrl(ttShort)).toBe('https://www.tiktok.com/oembed?url=https%3A%2F%2Fvm.tiktok.com%2FZGeToSUk4%2F')
    expect(oEmbedUrl(parseLink('https://example.com/x')!)).toBeNull()
  })

  it('classifies failures: 401/403 = embedding disabled, 400/404 = unavailable, the rest = failed', () => {
    expect(classifyStatus(401)).toBe('not-embeddable')
    expect(classifyStatus(403)).toBe('not-embeddable')
    expect(classifyStatus(400)).toBe('unavailable')
    expect(classifyStatus(404)).toBe('unavailable')
    expect(classifyStatus(429)).toBe('failed')
    expect(classifyStatus(500)).toBe('failed')
  })

  it('reads title, author and shape (YouTube reports the real aspect ratio)', () => {
    const r = parseOEmbed(yt, { title: 'Me at the zoo', author_name: 'jawed', width: 200, height: 150 })
    expect(r).toEqual({ status: 'ok', title: 'Me at the zoo', author: 'jawed', ratio: 200 / 150, id: 'jNQXAC9IVRw' })
    expect(parseOEmbed(yt, null)).toEqual({ status: 'failed' })
  })

  it('resolves the TikTok post id from embed_product_id or the player html', () => {
    expect(parseOEmbed(ttShort, { embed_product_id: '6718335390845095173', width: '325', height: '578' })).toMatchObject({
      status: 'ok',
      id: '6718335390845095173',
    })
    const html = '<iframe src="https://www.tiktok.com/player/v1/6718335390845095173?embed_from=oembed"></iframe>'
    expect(parseOEmbed(ttShort, { html })).toMatchObject({ id: '6718335390845095173' })
    expect(parseOEmbed(ttShort, { html: '<blockquote data-video-id="7401981735623331105"></blockquote>' })).toMatchObject({ id: '7401981735623331105' })
    expect(parseOEmbed(ttShort, { title: 'x' })).toMatchObject({ status: 'ok', id: null })
  })

  it('fetches without credentials and maps the answers', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.credentials).toBe('omit')
      return new Response(JSON.stringify({ title: 'Vídeo', author_name: 'canal', width: 200, height: 113 }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchOEmbed(yt)).toMatchObject({ status: 'ok', title: 'Vídeo', author: 'canal' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })))
    expect(await fetchOEmbed(yt)).toEqual({ status: 'not-embeddable' })

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await fetchOEmbed(tt)).toEqual({ status: 'failed' })
  })

  it('treats an abort as failed and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))))))
    const controller = new AbortController()
    const pending = fetchOEmbed(yt, controller.signal)
    controller.abort()
    expect(await pending).toEqual({ status: 'failed' })
  })
})

describe('TikTok player', () => {
  it('uses the official Embed Player with controls and no autoplay', () => {
    const url = new URL(tiktokPlayerUrl('6718335390845095173'))
    expect(url.origin + url.pathname).toBe('https://www.tiktok.com/player/v1/6718335390845095173')
    expect(url.searchParams.get('controls')).toBe('1')
    expect(url.searchParams.get('autoplay')).toBe('0')
    expect(url.searchParams.get('rel')).toBe('0')
  })
})
