// Owner: viewer. "Original" sound: the stored recording in an HTMLAudioElement (playbackRate =
// speed with the pitch preserved). The player reads its currentTime to drive the cursor.
export class OriginalTrack {
  private audio: HTMLAudioElement | null = null
  private blob: Blob | null = null
  private url: string | null = null

  constructor(private readonly onEnded: () => void) {}

  /** The element for this recording (created once per blob, ahead of the play gesture). */
  load(blob: Blob): HTMLAudioElement {
    if (this.audio && this.blob === blob) return this.audio
    this.release()
    const audio = new Audio()
    audio.preload = 'auto'
    const pitch = audio as HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean }
    pitch.preservesPitch = true
    pitch.webkitPreservesPitch = true
    this.url = URL.createObjectURL(blob)
    audio.src = this.url
    audio.addEventListener('ended', () => {
      if (this.audio === audio) this.onEnded()
    })
    this.audio = audio
    this.blob = blob
    return audio
  }

  get element(): HTMLAudioElement | null {
    return this.audio
  }

  /** Seconds into the recording (null when nothing is loaded). */
  time(): number | null {
    return this.audio ? this.audio.currentTime : null
  }

  seek(seconds: number) {
    if (!this.audio) return
    try {
      this.audio.currentTime = Math.max(0, seconds)
    } catch {
      // metadata not loaded yet: it starts from 0
    }
  }

  setRate(rate: number, volume: number) {
    if (!this.audio) return
    this.audio.playbackRate = rate
    this.audio.volume = Math.min(1, Math.max(0, volume))
  }

  pause() {
    if (this.audio && !this.audio.paused) this.audio.pause()
  }

  release() {
    if (this.audio) {
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
    }
    if (this.url) URL.revokeObjectURL(this.url)
    this.audio = null
    this.blob = null
    this.url = null
  }
}
