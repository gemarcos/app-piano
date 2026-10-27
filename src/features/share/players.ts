// Owner: share. The platforms' OFFICIAL embed players behind one small interface: YouTube through the IFrame
// API on youtube-nocookie.com, TikTok through its Embed Player (player/v1 + postMessage). They are created
// imperatively inside a container that React does not render into. Pauta never touches the media itself:
// it only asks the player to play or pause while the microphone (or tab capture) listens.
import type { SharedLink } from './links'

export type EmbedState = 'playing' | 'paused' | 'ended' | 'buffering'
export type EmbedError = 'not-embeddable' | 'unavailable' | 'offline' | 'failed'

export interface EmbedCallbacks {
  /** The player is on screen (it may still be getting ready for commands). */
  onReady(): void
  onState(state: EmbedState): void
  onError(error: EmbedError): void
  /** The player's own sound state once it plays (a muted player gives a silent take). */
  onSound?(sound: { muted: boolean; volume: number }): void
}

export interface EmbedPlayer {
  /** Unmutes and plays (queued until the player accepts commands). */
  play(): void
  pause(): void
  destroy(): void
}

/** Without any sign of life after this long, the player counts as failed. */
const READY_TIMEOUT_MS = 20_000

function isOffline(): boolean {
  try {
    return navigator.onLine === false
  } catch {
    return false
  }
}

/* ---------------- YouTube (IFrame API) ---------------- */

interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  unMute(): void
  isMuted(): boolean
  getVolume(): number
  setVolume(volume: number): void
  destroy(): void
}

interface YTNamespace {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => YTPlayer
}

type YTWindow = Window & { YT?: Partial<YTNamespace>; onYouTubeIframeAPIReady?: () => void }

const YT_API_URL = 'https://www.youtube.com/iframe_api'
const YT_STATES: Record<number, EmbedState> = { 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering' }
let ytApi: Promise<YTNamespace> | null = null

/** Loads the IFrame API once (shared by every player). */
export function loadYouTubeApi(timeoutMs = 15_000): Promise<YTNamespace> {
  const w = window as YTWindow
  if (w.YT?.Player) return Promise.resolve(w.YT as YTNamespace)
  if (ytApi) return ytApi
  ytApi = new Promise<YTNamespace>((resolve, reject) => {
    const fail = () => {
      ytApi = null
      reject(new Error('youtube-api'))
    }
    const timer = window.setTimeout(fail, timeoutMs)
    const previous = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer)
      try {
        previous?.()
      } catch {
        // someone else's callback
      }
      if (w.YT?.Player) resolve(w.YT as YTNamespace)
      else fail()
    }
    const script = document.createElement('script')
    script.src = YT_API_URL
    script.async = true
    script.onerror = () => {
      window.clearTimeout(timer)
      script.remove()
      fail()
    }
    document.head.appendChild(script)
  })
  return ytApi
}

function youtubeError(code: number): EmbedError {
  if (code === 101 || code === 150) return 'not-embeddable'
  if (code === 100) return 'unavailable'
  return 'failed'
}

export function createYouTubePlayer(container: HTMLElement, link: SharedLink, cb: EmbedCallbacks): EmbedPlayer {
  let player: YTPlayer | null = null
  let ready = false
  let wantPlay = false
  let destroyed = false
  const mount = document.createElement('div')
  container.appendChild(mount)
  const timeout = window.setTimeout(() => !ready && !destroyed && cb.onError(isOffline() ? 'offline' : 'failed'), READY_TIMEOUT_MS)

  const play = () => {
    wantPlay = true
    if (!player || !ready) return
    try {
      player.unMute()
      if (player.getVolume() < 50) player.setVolume(100)
      player.playVideo()
    } catch {
      // the iframe went away
    }
  }

  // YouTube falls back to MUTED playback when the browser blocks sound, and a muted player gives a silent
  // take: when Pauta asked for sound, unmute it again and report what the player says.
  const checkSound = () => {
    if (!player) return
    try {
      if (wantPlay && player.isMuted()) player.unMute()
      cb.onSound?.({ muted: player.isMuted(), volume: player.getVolume() })
    } catch {
      // the iframe went away
    }
  }

  loadYouTubeApi().then(
    (YT) => {
      if (destroyed) return
      player = new YT.Player(mount, {
        host: 'https://www.youtube-nocookie.com',
        videoId: link.id,
        width: '100%',
        height: '100%',
        playerVars: {
          playsinline: 1,
          rel: 0,
          iv_load_policy: 3,
          hl: 'es',
          origin: window.location.origin,
          ...(link.start ? { start: link.start } : {}),
        },
        events: {
          onReady: () => {
            if (destroyed) return
            ready = true
            window.clearTimeout(timeout)
            cb.onReady()
            if (wantPlay) play()
          },
          onStateChange: (e: { data: number }) => {
            const state = YT_STATES[e.data]
            if (!state || destroyed) return
            cb.onState(state)
            if (state === 'playing') checkSound()
          },
          onError: (e: { data: number }) => {
            if (!destroyed) cb.onError(youtubeError(e.data))
          },
        },
      })
    },
    () => {
      window.clearTimeout(timeout)
      if (!destroyed) cb.onError(isOffline() ? 'offline' : 'failed')
    },
  )

  return {
    play,
    pause() {
      wantPlay = false
      try {
        if (ready) player?.pauseVideo()
      } catch {
        // the iframe went away
      }
    },
    destroy() {
      destroyed = true
      window.clearTimeout(timeout)
      try {
        player?.destroy()
      } catch {
        // already gone
      }
      container.replaceChildren()
    },
  }
}

/* ---------------- TikTok (Embed Player, postMessage) ---------------- */

const TIKTOK_ORIGIN = 'https://www.tiktok.com'
const TIKTOK_STATES: Record<number, EmbedState> = { 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering' }

/** Player options (developers.tiktok.com/doc/embed-player): controls on, no autoplay, quiet chrome. */
export function tiktokPlayerUrl(id: string): string {
  const params = new URLSearchParams({
    controls: '1',
    progress_bar: '1',
    play_button: '1',
    volume_control: '1',
    fullscreen_button: '0',
    timestamp: '1',
    loop: '0',
    autoplay: '0',
    music_info: '1',
    description: '0',
    rel: '0',
    native_context_menu: '0',
    closed_caption: '0',
  })
  return `${TIKTOK_ORIGIN}/player/v1/${id}?${params}`
}

interface TikTokMessage {
  'x-tiktok-player'?: boolean
  type?: string
  value?: unknown
}

function tiktokError(value: unknown): EmbedError {
  const code = typeof value === 'number' ? value : Number((value as { errorCode?: unknown } | null)?.errorCode)
  if (code === 1001) return 'unavailable'
  return 'failed'
}

export function createTikTokPlayer(container: HTMLElement, link: SharedLink, cb: EmbedCallbacks): EmbedPlayer {
  let ready = false
  let shown = false
  let wantPlay = false
  let destroyed = false
  const iframe = document.createElement('iframe')
  iframe.src = tiktokPlayerUrl(link.id ?? '')
  iframe.title = 'Vídeo de TikTok'
  iframe.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'
  iframe.referrerPolicy = 'strict-origin-when-cross-origin'

  const show = () => {
    if (shown || destroyed) return
    shown = true
    window.clearTimeout(timeout)
    cb.onReady()
  }
  const timeout = window.setTimeout(() => !shown && !destroyed && cb.onError(isOffline() ? 'offline' : 'failed'), READY_TIMEOUT_MS)

  const post = (type: string) => {
    try {
      iframe.contentWindow?.postMessage({ type, 'x-tiktok-player': true }, TIKTOK_ORIGIN)
    } catch {
      // the iframe went away
    }
  }
  const play = () => {
    wantPlay = true
    if (!ready) return
    post('unMute')
    post('play')
  }

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== TIKTOK_ORIGIN) return
    let data: TikTokMessage | null = null
    try {
      data = typeof event.data === 'string' ? (JSON.parse(event.data) as TikTokMessage) : (event.data as TikTokMessage)
    } catch {
      return
    }
    if (!data || data['x-tiktok-player'] !== true || destroyed) return
    if (data.type === 'onPlayerReady') {
      ready = true
      show()
      if (wantPlay) play()
    } else if (data.type === 'onStateChange') {
      const state = TIKTOK_STATES[Number(data.value)]
      if (state) cb.onState(state)
    } else if (data.type === 'onPlayerError') {
      const error = tiktokError(data.value)
      // 3002 = autoplay blocked: the user can still tap the player, it is not a dead end.
      if (Number((data.value as { errorCode?: unknown } | null)?.errorCode) !== 3002) cb.onError(error)
    }
  }

  window.addEventListener('message', onMessage)
  iframe.addEventListener('load', show)
  container.appendChild(iframe)

  return {
    play,
    pause() {
      wantPlay = false
      if (ready) post('pause')
    },
    destroy() {
      destroyed = true
      window.clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
      iframe.removeEventListener('load', show)
      container.replaceChildren()
    },
  }
}

export function createEmbedPlayer(container: HTMLElement, link: SharedLink, cb: EmbedCallbacks): EmbedPlayer {
  return link.platform === 'tiktok' ? createTikTokPlayer(container, link, cb) : createYouTubePlayer(container, link, cb)
}
