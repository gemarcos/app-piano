import { describe, expect, it } from 'vitest'
import { cleanTitle, findLinks, isPlayable, linkPath, parseLink, parseStartTime, pickLink } from './links'

const ID = 'jNQXAC9IVRw'
const WATCH = `https://www.youtube.com/watch?v=${ID}`
const TT_ID = '7401981735623331105'

describe('parseLink: YouTube', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}`],
    [`http://www.youtube.com/watch?v=${ID}`],
    [`https://m.youtube.com/watch?v=${ID}&feature=share`],
    [`https://music.youtube.com/watch?v=${ID}&si=AbCdEfGh12345`],
    [`https://www.youtube.com/watch?app=desktop&v=${ID}`],
    [`https://www.youtube.com/watch?v=${ID}&list=PL0123456789abcdef&index=3`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=Zx9-AbCdEf_12345`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube-nocookie.com/embed/${ID}?rel=0`],
    [`https://www.youtube.com/live/${ID}?si=abc`],
    [`https://www.youtube.com/v/${ID}`],
    [`youtube.com/watch?v=${ID}`],
    [`www.youtube.com/watch?v=${ID}`],
    [`youtu.be/${ID}`],
    [`https://www.youtube.com/attribution_link?a=xyz&u=%2Fwatch%3Fv%3D${ID}%26feature%3Dshare`],
  ])('%s -> video id', (url) => {
    const link = parseLink(url)
    expect(link).toMatchObject({ platform: 'youtube', id: ID, short: false, vertical: false, url: WATCH })
    expect(isPlayable(link!)).toBe(true)
  })

  it('reads Shorts as portrait videos and keeps their own canonical link', () => {
    for (const url of [`https://www.youtube.com/shorts/${ID}`, `https://youtube.com/shorts/${ID}?si=Q1w2e3r4t5y6`, `https://m.youtube.com/shorts/${ID}`]) {
      expect(parseLink(url)).toMatchObject({ platform: 'youtube', id: ID, vertical: true, url: `https://www.youtube.com/shorts/${ID}` })
    }
  })

  it('keeps the start time of the link (t= / start=)', () => {
    expect(parseLink(`https://youtu.be/${ID}?t=42`)).toMatchObject({ start: 42, url: `${WATCH}&t=42s` })
    expect(parseLink(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)).toMatchObject({ start: 90 })
    expect(parseLink(`https://www.youtube.com/embed/${ID}?start=75`)).toMatchObject({ start: 75 })
    expect(parseLink(`https://youtu.be/${ID}?t=0`)?.start).toBeUndefined()
  })

  it('recognises YouTube links without a single video as not playable', () => {
    for (const url of [
      'https://www.youtube.com/@canal',
      'https://www.youtube.com/playlist?list=PL0123456789abcdef',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/',
      'https://youtu.be/',
    ]) {
      const link = parseLink(url)
      expect(link?.platform).toBe('youtube')
      expect(link?.id).toBeNull()
      expect(isPlayable(link!)).toBe(false)
    }
  })
})

describe('parseLink: TikTok', () => {
  it.each([
    [`https://www.tiktok.com/@pianista.ejemplo/video/${TT_ID}`, `https://www.tiktok.com/@pianista.ejemplo/video/${TT_ID}`],
    [`https://www.tiktok.com/@pianista_99/video/${TT_ID}?is_from_webapp=1&sender_device=pc&web_id=123`, `https://www.tiktok.com/@pianista_99/video/${TT_ID}`],
    [`https://m.tiktok.com/v/${TT_ID}.html?u_code=abc`, `https://www.tiktok.com/embed/v2/${TT_ID}`],
    [`https://www.tiktok.com/embed/v2/${TT_ID}`, `https://www.tiktok.com/embed/v2/${TT_ID}`],
    [`https://www.tiktok.com/player/v1/${TT_ID}?music_info=1`, `https://www.tiktok.com/embed/v2/${TT_ID}`],
    [`https://www.tiktok.com/@alguien/photo/${TT_ID}`, `https://www.tiktok.com/@alguien/video/${TT_ID}`],
    [`tiktok.com/@alguien/video/${TT_ID}`, `https://www.tiktok.com/@alguien/video/${TT_ID}`],
  ])('%s -> post id', (url, canonical) => {
    expect(parseLink(url)).toMatchObject({ platform: 'tiktok', id: TT_ID, short: false, vertical: true, url: canonical })
  })

  it('marks short links (they need resolving) and strips their tracking query', () => {
    expect(parseLink('https://vm.tiktok.com/ZGeToSUk4/')).toMatchObject({ platform: 'tiktok', id: null, short: true, url: 'https://vm.tiktok.com/ZGeToSUk4/' })
    expect(parseLink('https://vt.tiktok.com/ZSabc123?_r=1')).toMatchObject({ short: true, url: 'https://vt.tiktok.com/ZSabc123/' })
    expect(parseLink('https://www.tiktok.com/t/ZT8abcDEF/')).toMatchObject({ short: true, url: 'https://www.tiktok.com/t/ZT8abcDEF/' })
    expect(isPlayable(parseLink('https://vm.tiktok.com/ZGeToSUk4/')!)).toBe(true)
  })

  it('profiles, sounds and tags are TikTok links without a video', () => {
    for (const url of ['https://www.tiktok.com/@alguien', 'https://www.tiktok.com/music/sonido-original-7123456789012345678', 'https://www.tiktok.com/tag/piano']) {
      const link = parseLink(url)
      expect(link).toMatchObject({ platform: 'tiktok', id: null, short: false })
      expect(isPlayable(link!)).toBe(false)
    }
  })
})

describe('parseLink: other input', () => {
  it('keeps other web links as "other"', () => {
    expect(parseLink('https://www.instagram.com/reel/Cabc123/')).toMatchObject({ platform: 'other', id: null, url: 'https://www.instagram.com/reel/Cabc123/' })
    expect(parseLink('https://open.spotify.com/track/abc')).toMatchObject({ platform: 'other' })
  })

  it('rejects what is not a web link', () => {
    for (const value of ['', '   ', 'hola', 'mailto:alguien@example.com', 'javascript:alert(1)', 'ftp://example.com/x', 'http://localhost']) {
      expect(parseLink(value)).toBeNull()
    }
    expect(parseLink(null)).toBeNull()
  })

  it('pretends nothing about look-alike hosts', () => {
    expect(parseLink(`https://notyoutube.com/watch?v=${ID}`)?.platform).toBe('other')
    expect(parseLink(`https://youtube.com.example.org/watch?v=${ID}`)?.platform).toBe('other')
    expect(parseLink(`https://tiktok.com.example.org/@a/video/${TT_ID}`)?.platform).toBe('other')
  })
})

describe('findLinks / pickLink: shared texts', () => {
  it.each([
    // YouTube app (Android, Spanish): the subject goes to title, the link to text.
    ['YouTube app', { title: 'Mira "Nocturno en mi bemol" en YouTube', text: `https://youtu.be/${ID}?si=AbCdEf123` }, WATCH],
    ['YouTube Shorts', { text: `https://youtube.com/shorts/${ID}?si=Q1w2e3r4` }, `https://www.youtube.com/shorts/${ID}`],
    ['YouTube Music', { text: `https://music.youtube.com/watch?v=${ID}&si=xYz` }, WATCH],
    ['Chrome page share', { title: 'Vídeo - YouTube', url: `https://m.youtube.com/watch?v=${ID}` }, WATCH],
    ['link in the title only', { title: `Escucha esto https://youtu.be/${ID}` }, WATCH],
    ['TikTok app', { text: `Mira el video de @pianista en TikTok https://vm.tiktok.com/ZMh1234Ab/` }, 'https://vm.tiktok.com/ZMh1234Ab/'],
    [
      'TikTok with hashtags',
      { text: `#piano #cover #fyp https://www.tiktok.com/@pianista/video/${TT_ID}?_r=1&_t=8abc ¡Mira más vídeos de @pianista en TikTok!` },
      `https://www.tiktok.com/@pianista/video/${TT_ID}`,
    ],
    ['WhatsApp forward', { text: `Escucha esto 👉https://youtu.be/${ID} 🎹🎶` }, WATCH],
    ['in parentheses', { text: `(míralo aquí: https://youtu.be/${ID}).` }, WATCH],
    ['Spanish quotes', { text: `«https://youtu.be/${ID}»` }, WATCH],
    ['trailing punctuation', { text: `¿Lo puedes sacar? https://www.youtube.com/watch?v=${ID}!!` }, WATCH],
    ['scheme-less', { text: `mira youtu.be/${ID} ahora` }, WATCH],
    ['line breaks', { text: `Hola,\nhttps://youtu.be/${ID}\nGracias` }, WATCH],
  ])('%s', (_name, fields: { title?: string; text?: string; url?: string }, expected) => {
    expect(pickLink(fields.url, fields.text, fields.title)?.url).toBe(expected)
  })

  it('prefers a playable YouTube/TikTok link over other links in the same text', () => {
    const text = `Fuente: https://example.com/blog/entrada y el vídeo https://youtu.be/${ID}`
    expect(pickLink(text)?.url).toBe(WATCH)
    expect(pickLink('Solo esto: https://example.com/a')?.platform).toBe('other')
    expect(pickLink('sin enlaces aquí', '', null)).toBeNull()
  })

  it('finds every link once, in order', () => {
    expect(findLinks(`a https://youtu.be/${ID} b youtu.be/${ID} c https://example.com/x.`)).toEqual([
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}`,
      'https://example.com/x',
    ])
    expect(findLinks(`https://www.youtube.com/watch?v=${ID}`)).toEqual([`https://www.youtube.com/watch?v=${ID}`])
    expect(findLinks('Ver https://es.wikipedia.org/wiki/Nocturno_(música).')).toEqual(['https://es.wikipedia.org/wiki/Nocturno_(música)'])
    expect(findLinks(null)).toEqual([])
  })
})

describe('helpers', () => {
  it('parseStartTime', () => {
    expect(parseStartTime('90')).toBe(90)
    expect(parseStartTime('90s')).toBe(90)
    expect(parseStartTime('1m30s')).toBe(90)
    expect(parseStartTime('1h2m3s')).toBe(3723)
    expect(parseStartTime('2m')).toBe(120)
    expect(parseStartTime('0')).toBeUndefined()
    expect(parseStartTime('abc')).toBeUndefined()
    expect(parseStartTime(null)).toBeUndefined()
  })

  it('linkPath encodes the link for /link?url=', () => {
    expect(linkPath(parseLink(`https://youtu.be/${ID}?t=5`)!)).toBe('/link?url=' + encodeURIComponent(`${WATCH}&t=5s`))
    expect(linkPath('https://vm.tiktok.com/ZGeToSUk4/')).toBe('/link?url=https%3A%2F%2Fvm.tiktok.com%2FZGeToSUk4%2F')
  })

  it('cleanTitle drops emoji and trailing hashtags', () => {
    expect(cleanTitle('Nocturno 🎹✨ en piano #piano #cover #fyp')).toBe('Nocturno en piano')
    expect(cleanTitle('  Vals   del minuto  ')).toBe('Vals del minuto')
    expect(cleanTitle('👨‍👩‍👧 🇪🇸 Preludio')).toBe('Preludio')
    expect(cleanTitle('#piano #fyp')).toBe('')
    expect(cleanTitle('Estudio Op. 10 nº 3 | Piano')).toBe('Estudio Op. 10 nº 3 | Piano')
    expect(cleanTitle(null)).toBe('')
    const long = cleanTitle('palabra '.repeat(30))
    expect(long.length).toBeLessThanOrEqual(90)
    expect(long.endsWith('…')).toBe(true)
  })
})
