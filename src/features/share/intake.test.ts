import { describe, expect, it } from 'vitest'
import { META_SUFFIX, SHARE_CACHE, SHARE_MAX_AGE_MS, takeSharedPayload, type CacheStorageLike } from './inbox'
import { decideIntake, isMediaFile, payloadFromParams, type SharePayload } from './intake'

const file = (name: string, type: string, size = 16) => new File([new Uint8Array(size)], name, { type })
const payload = (p: Partial<SharePayload>): SharePayload => ({ title: '', text: '', url: '', files: [], ...p })

describe('isMediaFile', () => {
  it('accepts audio and video by MIME type', () => {
    expect(isMediaFile(file('a.mp3', 'audio/mpeg'))).toBe(true)
    expect(isMediaFile(file('VID_20261027.mp4', 'video/mp4'))).toBe(true)
    expect(isMediaFile(file('nota', 'audio/ogg'))).toBe(true)
  })

  it('falls back to the extension when the type is missing or generic', () => {
    expect(isMediaFile(file('grabacion.m4a', ''))).toBe(true)
    expect(isMediaFile(file('clip.MOV', 'application/octet-stream'))).toBe(true)
    expect(isMediaFile(file('documento.pdf', ''))).toBe(false)
    expect(isMediaFile(file('sin-extension', ''))).toBe(false)
  })

  it('rejects other types even with a media-looking name', () => {
    expect(isMediaFile(file('foto.jpg', 'image/jpeg'))).toBe(false)
    expect(isMediaFile(file('falso.mp4', 'text/plain'))).toBe(false)
  })
})

describe('decideIntake', () => {
  it('sends a shared audio or video file to Import, even with a link next to it', () => {
    const video = file('VID_0001.mp4', 'video/mp4')
    expect(decideIntake(payload({ files: [video] }))).toEqual({ kind: 'file', file: video })
    expect(decideIntake(payload({ files: [video], text: 'https://youtu.be/jNQXAC9IVRw' }))).toEqual({ kind: 'file', file: video })
  })

  it('picks the first media file and skips empty or non-media ones', () => {
    const empty = file('vacío.mp3', 'audio/mpeg', 0)
    const image = file('portada.png', 'image/png')
    const audio = file('toma.wav', 'audio/wav')
    expect(decideIntake(payload({ files: [empty, image, audio] }))).toEqual({ kind: 'file', file: audio })
  })

  it('opens a link from text (how YouTube and TikTok share), url or title', () => {
    const fromText = decideIntake(payload({ title: 'Mira "Vals" en YouTube', text: 'https://youtu.be/jNQXAC9IVRw?si=abc' }))
    expect(fromText).toMatchObject({ kind: 'link', link: { platform: 'youtube', id: 'jNQXAC9IVRw' } })
    const fromUrl = decideIntake(payload({ url: 'https://www.tiktok.com/@a/video/7401981735623331105' }))
    expect(fromUrl).toMatchObject({ kind: 'link', link: { platform: 'tiktok', id: '7401981735623331105' } })
    const fromTitle = decideIntake(payload({ title: 'https://vm.tiktok.com/ZGeToSUk4/' }))
    expect(fromTitle).toMatchObject({ kind: 'link', link: { platform: 'tiktok', short: true } })
  })

  it('still opens other links (the player screen explains what to do)', () => {
    expect(decideIntake(payload({ text: 'https://www.instagram.com/reel/abc/' }))).toMatchObject({ kind: 'link', link: { platform: 'other' } })
  })

  it('a non-media file with a link opens the link; alone it is refused', () => {
    const pdf = file('partitura.pdf', 'application/pdf')
    expect(decideIntake(payload({ files: [pdf], text: 'https://youtu.be/jNQXAC9IVRw' }))).toMatchObject({ kind: 'link' })
    expect(decideIntake(payload({ files: [pdf] }))).toEqual({ kind: 'not-media' })
  })

  it('reports errors and empty shares', () => {
    expect(decideIntake(payload({ error: true }))).toEqual({ kind: 'error' })
    expect(decideIntake(payload({ text: 'Hola, qué tal' }))).toEqual({ kind: 'empty' })
    expect(decideIntake(null)).toEqual({ kind: 'empty' })
  })
})

describe('payloadFromParams', () => {
  it('reads ?title=&text=&url= and ?error=1', () => {
    expect(payloadFromParams(new URLSearchParams('text=https%3A%2F%2Fyoutu.be%2FjNQXAC9IVRw'))).toEqual({
      title: '',
      text: 'https://youtu.be/jNQXAC9IVRw',
      url: '',
      files: [],
      error: false,
    })
    expect(payloadFromParams(new URLSearchParams('error=1'))?.error).toBe(true)
    expect(payloadFromParams(new URLSearchParams(''))).toBeNull()
  })
})

/* ---------- inbox (Cache Storage written by public/share-target-sw.js) ---------- */

class FakeCache {
  map = new Map<string, Response>()
  async match(request: string | Request) {
    return this.map.get(typeof request === 'string' ? request : request.url)?.clone()
  }
  async keys() {
    return [...this.map.keys()].map((k) => new Request(k))
  }
  put(key: string, response: Response) {
    this.map.set(key, response)
  }
}

class FakeStorage implements CacheStorageLike {
  caches = new Map<string, FakeCache>()
  async has(name: string) {
    return this.caches.has(name)
  }
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache())
    return this.caches.get(name)!
  }
  async delete(name: string) {
    return this.caches.delete(name)
  }
}

/** What the service worker stores for one share (same layout as public/share-target-sw.js). */
async function storeShare(storage: FakeStorage, scope: string, share: { title?: string; text?: string; url?: string; files?: File[]; at?: number }) {
  const cache = await storage.open(SHARE_CACHE)
  const refs = []
  for (const [i, f] of (share.files ?? []).entries()) {
    const key = new URL(`__share/file-${i}`, scope).href
    cache.put(key, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream' } }))
    refs.push({ key, name: f.name, type: f.type })
  }
  const meta = { v: 1, at: share.at ?? Date.now(), title: share.title ?? '', text: share.text ?? '', url: share.url ?? '', files: refs }
  cache.put(new URL('__share/meta', scope).href, new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }))
}

describe('takeSharedPayload', () => {
  it('returns the shared files and texts once, then the inbox is empty', async () => {
    const storage = new FakeStorage()
    const wav = new File([new Uint8Array([82, 73, 70, 70, 1, 2, 3])], 'scale.wav', { type: 'audio/wav' })
    await storeShare(storage, 'https://pauta.example/app/', { title: 'Toma', text: 'hola', files: [wav] })
    const got = await takeSharedPayload(storage)
    expect(got).toMatchObject({ title: 'Toma', text: 'hola', url: '' })
    expect(got?.files).toHaveLength(1)
    expect(got?.files[0].name).toBe('scale.wav')
    expect(got?.files[0].type).toBe('audio/wav')
    expect(new Uint8Array(await got!.files[0].arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70, 1, 2, 3]))
    expect(await storage.has(SHARE_CACHE)).toBe(false)
    expect(await takeSharedPayload(storage)).toBeNull()
  })

  it('ignores (and clears) a share that was never opened in time', async () => {
    const storage = new FakeStorage()
    const now = Date.now()
    await storeShare(storage, 'https://pauta.example/', { text: 'https://youtu.be/jNQXAC9IVRw', at: now - SHARE_MAX_AGE_MS - 1000 })
    expect(await takeSharedPayload(storage, now)).toBeNull()
    expect(await storage.has(SHARE_CACHE)).toBe(false)
  })

  it('survives a broken inbox and a missing Cache Storage', async () => {
    const storage = new FakeStorage()
    const cache = await storage.open(SHARE_CACHE)
    cache.put('https://pauta.example' + META_SUFFIX, new Response('{not json'))
    expect(await takeSharedPayload(storage)).toBeNull()
    expect(await storage.has(SHARE_CACHE)).toBe(false)
    expect(await takeSharedPayload(null)).toBeNull()
    expect(await takeSharedPayload(new FakeStorage())).toBeNull()
  })

  it('feeds decideIntake end to end', async () => {
    const storage = new FakeStorage()
    await storeShare(storage, 'https://pauta.example/', { text: 'Mira el video de @pianista en TikTok https://vm.tiktok.com/ZMh1234Ab/' })
    expect(decideIntake(await takeSharedPayload(storage))).toMatchObject({ kind: 'link', link: { platform: 'tiktok', short: true, url: 'https://vm.tiktok.com/ZMh1234Ab/' } })
  })
})
