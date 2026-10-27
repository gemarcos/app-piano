// Owner: viewer (playback side: piano-sound). Playback engine.
//
// Piano: synth.ts renders the whole tune (grand piano samples, pedal, metronome and count-in) into
// one AudioBuffer, which we play ourselves with AudioBufferSourceNodes: an exact clock for the cursor
// (AudioContext time minus output latency) and seeks without re-rendering. Loops play a second,
// seamless buffer (the loop rendered on its own with its ring-out folded onto its start, so the wrap
// has no jump); the first pass comes from the tune itself and crossfades into it at the loop end.
// Every start fades in over a few milliseconds and every stop fades out, so nothing clicks.
// Speed, metronome and count-in are baked into the buffer, so changing them re-renders it.
// Original: the stored recording (originalTrack.ts); the cursor follows its currentTime.
//
// Times are "score seconds": seconds at 100 % from tick 0 of measure 0 (see engine tickToSeconds).
import { FrameLoop, heardTime, sameRange } from './clock'
import { OriginalTrack } from './originalTrack'
import { releasePianoSamples } from './pianoSamples'
import { connectRoom } from './reverb'
import { renderLoop, renderTune, wholeLoop, type SynthSpec, type TuneRender } from './synth'
import { ScreenWakeLock } from './wakeLock'

export type { SynthSpec } from './synth'

export type PlayerStatus = 'idle' | 'loading' | 'countin' | 'playing' | 'paused'

export interface PlayerSnapshot {
  status: PlayerStatus
  /** Score seconds. */
  position: number
  /** Score seconds. */
  duration: number
  /** Whether the score should show a cursor (playing, or paused after playing or seeking). */
  cursor: boolean
}

export interface PlayerSpec {
  /** null when there is nothing to play (no notes). */
  synth: SynthSpec | null
  duration: number
  /** Percent, 50..150. */
  speed: number
  metronome: boolean
  countIn: boolean
  /** 0..1 */
  volume: number
  /** Loop bounds in score seconds, or null. */
  loop: [number, number] | null
  sound: 'piano' | 'original'
  /**
   * Stored recording and the map between score seconds and seconds of the recording (through the
   * analysis beat map, so rubato stays in sync; may give negative times before the recording).
   */
  original: { blob: Blob; toSource: (scoreSeconds: number) => number; fromSource: (sourceSeconds: number) => number } | null
}

interface Rendered extends TuneRender {
  key: string
}

interface LoopRendered {
  key: string
  buffer: AudioBuffer
}

const PLAYING: readonly PlayerStatus[] = ['countin', 'playing']
/** Small scheduling lead so the first samples are never late (avoids a click at the start). */
const LEAD = 0.03
/** Fade-in of every start (a start in the middle of a held note must not click). */
const FADE_IN = 0.004
/** Time constant of the fade-out on pause / seek (about 20 ms to silence). */
const FADE_OUT_TAU = 0.005
/** Crossfade from the tune into the loop buffer at the loop end. */
const LOOP_XFADE = 0.02
/** Decoded samples are kept this long after the viewer closes (reopening a score is instant). */
const SAMPLE_KEEP_MS = 60_000

declare global {
  interface Window {
    abcjsAudioContext?: AudioContext
    webkitAudioContext?: typeof AudioContext
  }
}

let releaseTimer = 0

export class ScorePlayer {
  private spec: PlayerSpec | null = null
  private snap: PlayerSnapshot = { status: 'idle', position: 0, duration: 0, cursor: false }
  private listeners = new Set<() => void>()
  onFrame: (position: number, cursor: boolean) => void = () => {}
  onError: (message: string) => void = () => {}

  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  /** Per-start bus between the sources and the volume: it carries the fades. */
  private bus: GainNode | null = null
  private rendered: Rendered | null = null
  private rendering: { key: string; promise: Promise<Rendered> } | null = null
  private looped: LoopRendered | null = null
  private looping: { key: string; promise: Promise<LoopRendered> } | null = null
  private sources: AudioBufferSourceNode[] = []
  private startCtxTime = 0
  private startBufOffset = 0
  private startScore = 0
  private loopBuf: [number, number] | null = null

  private readonly original = new OriginalTrack(() => {
    if (this.playing) this.finish()
  })
  private readonly wakeLock = new ScreenWakeLock()
  private readonly frames = new FrameLoop(() => this.tick())
  private playToken = 0

  /* ---------- store (useSyncExternalStore) ---------- */

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.snap

  private set(patch: Partial<PlayerSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  get playing(): boolean {
    return PLAYING.includes(this.snap.status)
  }

  /* ---------- inputs ---------- */

  update(next: PlayerSpec): void {
    const prev = this.spec
    this.spec = next
    if (this.snap.duration !== next.duration || this.snap.position > next.duration) {
      this.set({ duration: next.duration, position: Math.min(this.snap.position, next.duration) })
    }
    if (next.sound === 'original' && next.original) this.original.load(next.original.blob)
    if (!prev) return

    const active = this.playing || this.snap.status === 'loading'
    // Only the piano sound changed (same music): re-render and carry on from here, like a speed change.
    const soundOnly =
      !!prev.synth &&
      !!next.synth &&
      prev.synth.voices === next.synth.voices &&
      prev.synth.instrument !== next.synth.instrument &&
      prev.synth.msPerMeasure === next.synth.msPerMeasure &&
      prev.synth.timeSignature === next.synth.timeSignature &&
      prev.duration === next.duration &&
      prev.sound === next.sound &&
      prev.original?.blob === next.original?.blob
    if (soundOnly && next.sound === 'piano') {
      if (active) {
        this.pause()
        void this.play({ countIn: false })
      } else this.prerender()
      return
    }
    const tuneChanged =
      prev.synth?.key !== next.synth?.key ||
      prev.synth?.msPerMeasure !== next.synth?.msPerMeasure ||
      prev.synth?.timeSignature !== next.synth?.timeSignature ||
      prev.duration !== next.duration
    if (prev.sound !== next.sound || tuneChanged || prev.original?.blob !== next.original?.blob) {
      // The music itself changed: stop cleanly; the next play renders the new tune.
      if (active) this.pause()
      if (tuneChanged) this.prerender()
      return
    }
    if (next.sound === 'original') {
      this.original.setRate(next.speed / 100, next.volume)
      return
    }
    this.applyVolume()
    const bakedChanged = prev.speed !== next.speed || prev.metronome !== next.metronome || prev.countIn !== next.countIn
    if (bakedChanged) {
      // Speed, metronome and count-in live in the buffer: re-render and carry on from here.
      if (active) {
        this.pause()
        void this.play({ countIn: false })
      } else this.prerender()
    } else if (!sameRange(prev.loop, next.loop)) {
      if (this.snap.status === 'playing') this.restartAt(this.currentPosition())
      else if (!active) this.prerender()
    }
  }

  /* ---------- transport ---------- */

  toggle(): void {
    if (this.playing || this.snap.status === 'loading') this.pause()
    else void this.play()
  }

  async play(opts: { countIn?: boolean } = {}): Promise<void> {
    const spec = this.spec
    if (!spec || spec.duration <= 0 || this.playing) return
    if (spec.sound === 'original') {
      this.playOriginal()
      return
    }
    if (!spec.synth) return
    // Created (or resumed) inside the user gesture: required by autoplay policies.
    const ctx = this.ensureContext()
    if (!ctx) {
      this.onError('Este navegador no puede reproducir sonido')
      return
    }
    void ctx.resume().catch(() => {})
    const token = ++this.playToken
    this.set({ status: 'loading' })
    let rendered: Rendered
    let loop: LoopRendered | null
    try {
      for (;;) {
        rendered = await this.ensureBuffer()
        if (token !== this.playToken) return
        loop = await this.ensureLoop(rendered)
        if (token !== this.playToken) return
        if (this.spec && rendered.key === this.bufferKey(this.spec) && (loop?.key ?? '') === this.loopKey(this.spec)) break
      }
    } catch (err) {
      if (token !== this.playToken) return
      console.warn('[viewer] synth', err)
      this.set({ status: 'paused' })
      this.onError('No se pudo preparar el sonido')
      return
    }
    const countIn = (opts.countIn ?? true) && rendered.introSec > 0
    let from = this.snap.position
    if (countIn) {
      // The count-in leads into a downbeat: start from the beginning of the current measure.
      const md = (this.spec?.synth?.msPerMeasure ?? 0) / 1000
      if (md > 0) from = Math.floor(from / md + 1e-6) * md
    }
    this.startSources(rendered, loop, from, countIn)
    void this.wakeLock.acquire(() => this.playing)
  }

  pause(): void {
    this.playToken++
    const wasPlaying = this.playing
    const position = wasPlaying ? this.currentPosition() : this.snap.position
    this.stopSources(true)
    this.original.pause()
    this.frames.stop()
    this.wakeLock.release()
    this.set({ status: this.snap.status === 'idle' ? 'idle' : 'paused', position, cursor: this.snap.cursor || wasPlaying })
    this.onFrame(position, this.snap.cursor)
  }

  seek(position: number): void {
    const spec = this.spec
    if (!spec) return
    const pos = Math.min(Math.max(0, position), Math.max(0, spec.duration - 0.001))
    if (this.playing) {
      if (spec.sound === 'original') this.original.seek(this.toSource(this.clampToLoop(pos)))
      else this.restartAt(pos)
      return
    }
    this.set({ position: pos, cursor: true })
    this.onFrame(pos, true)
  }

  /** Releases audio resources (it can be used again afterwards; StrictMode remounts rely on that). */
  dispose(): void {
    this.playToken++
    this.stopSources(false)
    this.frames.stop()
    this.wakeLock.release()
    this.original.release()
    const ctx = this.ctx
    this.ctx = null
    this.gain = null
    this.bus = null
    this.rendered = null
    this.rendering = null
    this.looped = null
    this.looping = null
    if (ctx) {
      if (window.abcjsAudioContext === ctx) delete window.abcjsAudioContext
      void ctx.close().catch(() => {})
    }
    this.snap = { ...this.snap, status: 'idle', cursor: false, position: 0 }
    window.clearTimeout(releaseTimer)
    releaseTimer = window.setTimeout(releasePianoSamples, SAMPLE_KEEP_MS)
  }

  /* ---------- piano ---------- */

  private ensureContext(): AudioContext | null {
    window.clearTimeout(releaseTimer)
    if (this.ctx && this.ctx.state !== 'closed') return this.ctx
    const AC = window.AudioContext ?? window.webkitAudioContext
    if (!AC) return null
    try {
      // The whole tune lives in one stereo buffer: 32 kHz keeps the piano's useful band
      // (up to 16 kHz) with a third less memory than 48 kHz on long or slowed-down pieces.
      let ctx: AudioContext
      try {
        ctx = new AC({ sampleRate: 32000 })
      } catch {
        ctx = new AC()
      }
      const gain = ctx.createGain()
      // The piano goes out dry plus a soft concert-room reverb (live, so it rings on naturally
      // after a pause and flows across loop wraps).
      connectRoom(ctx, gain)
      this.ctx = ctx
      this.gain = gain
      this.applyVolume()
      return ctx
    } catch {
      return null
    }
  }

  private applyVolume() {
    if (!this.gain || !this.ctx || !this.spec) return
    this.gain.gain.setTargetAtTime(Math.min(1, Math.max(0, this.spec.volume)), this.ctx.currentTime, 0.02)
  }

  private bufferKey(spec: PlayerSpec): string {
    const s = spec.synth
    if (!s) return ''
    return [s.msPerMeasure.toFixed(3), s.timeSignature, spec.speed, spec.metronome ? 1 : 0, spec.countIn ? 1 : 0, spec.duration.toFixed(3), s.key].join('|')
  }

  private loopKey(spec: PlayerSpec): string {
    return spec.loop && spec.synth ? `${this.bufferKey(spec)}|${spec.loop[0].toFixed(4)},${spec.loop[1].toFixed(4)}` : ''
  }

  /** Renders the current tune (and loop) in the background once audio exists (so the next play is instant). */
  private prerender() {
    if (!this.ctx || !this.spec?.synth) return
    this.ensureBuffer()
      .then((r) => this.ensureLoop(r))
      .catch(() => {})
  }

  private ensureBuffer(): Promise<Rendered> {
    const spec = this.spec
    if (!spec?.synth || !this.ctx) return Promise.reject(new Error('nothing to render'))
    const key = this.bufferKey(spec)
    if (this.rendered?.key === key) return Promise.resolve(this.rendered)
    if (this.rendering?.key === key) return this.rendering.promise
    const promise = renderTune(this.ctx, spec.synth, spec).then(
      (r): Rendered => {
        if (this.rendering?.key === key) this.rendering = null
        const rendered = { ...r, key }
        if (this.spec && this.bufferKey(this.spec) === key) this.rendered = rendered
        return rendered
      },
      (err) => {
        if (this.rendering?.key === key) this.rendering = null
        throw err
      },
    )
    this.rendering = { key, promise }
    return promise
  }

  /** The seamless loop buffer for the current loop (null without a loop). */
  private ensureLoop(r: Rendered): Promise<LoopRendered | null> {
    const spec = this.spec
    const ctx = this.ctx
    if (!spec?.synth || !spec.loop || !ctx) return Promise.resolve(null)
    const key = this.loopKey(spec)
    if (this.looped?.key === key) return Promise.resolve(this.looped)
    if (this.looping?.key === key) return this.looping.promise
    const [a, b] = spec.loop
    const whole = a <= 1e-6 && b >= spec.duration - 1e-6
    const work =
      whole && r.key === this.bufferKey(spec)
        ? Promise.resolve(wholeLoop(ctx, r, spec.duration))
        : renderLoop(ctx, spec.synth, spec, spec.loop, r.levelDb)
    const promise = work.then(
      (buffer): LoopRendered => {
        if (this.looping?.key === key) this.looping = null
        const looped = { key, buffer }
        if (this.spec && this.loopKey(this.spec) === key) this.looped = looped
        return looped
      },
      (err) => {
        if (this.looping?.key === key) this.looping = null
        throw err
      },
    )
    this.looping = { key, promise }
    return promise
  }

  private newBus(at: number): GainNode {
    const ctx = this.ctx!
    const bus = ctx.createGain()
    bus.gain.setValueAtTime(0, at)
    bus.gain.linearRampToValueAtTime(1, at + FADE_IN)
    bus.connect(this.gain!)
    this.bus = bus
    return bus
  }

  private startSources(r: Rendered, loop: LoopRendered | null, fromScore: number, countIn: boolean) {
    const ctx = this.ctx
    const spec = this.spec
    if (!ctx || !this.gain || !spec) return
    this.stopSources(true)
    const from = this.clampToLoop(Math.min(Math.max(0, fromScore), spec.duration))
    const offset = r.introSec + from / r.speedF
    const now = ctx.currentTime + LEAD
    const bus = this.newBus(now)
    let musicAt = now
    if (countIn) {
      this.source(r.buffer, bus).start(now, 0, r.introSec)
      musicAt = now + r.introSec
    }
    if (spec.loop && loop) {
      const A = r.introSec + spec.loop[0] / r.speedF
      const cycle = loop.buffer.duration
      const B = A + cycle
      this.loopBuf = [A, B]
      const firstPass = B - offset
      if (firstPass > LOOP_XFADE + 0.005) {
        // The first pass is the tune itself (what led into the loop rings on); it hands over to the
        // loop buffer at the loop end, where both hold the same music, with a short crossfade.
        const handover = musicAt + firstPass
        const out = ctx.createGain()
        out.gain.setValueAtTime(1, handover - LOOP_XFADE)
        out.gain.linearRampToValueAtTime(0, handover)
        out.connect(bus)
        const head = this.source(r.buffer, out)
        head.start(musicAt, offset)
        head.stop(handover + 0.01)
        const into = ctx.createGain()
        into.gain.setValueAtTime(0, handover - LOOP_XFADE)
        into.gain.linearRampToValueAtTime(1, handover)
        into.connect(bus)
        const body = this.source(loop.buffer, into)
        body.loop = true
        body.loopStart = 0
        body.loopEnd = cycle
        body.start(handover - LOOP_XFADE, cycle - LOOP_XFADE)
      } else {
        const body = this.source(loop.buffer, bus)
        body.loop = true
        body.loopStart = 0
        body.loopEnd = cycle
        body.start(musicAt, Math.min(Math.max(0, offset - A), Math.max(0, cycle - 1 / ctx.sampleRate)))
      }
    } else if (spec.loop) {
      // No loop buffer (should not happen): loop the tune itself.
      const main = this.source(r.buffer, bus)
      main.loop = true
      main.loopStart = r.introSec + spec.loop[0] / r.speedF
      main.loopEnd = r.introSec + spec.loop[1] / r.speedF
      this.loopBuf = [main.loopStart, main.loopEnd]
      main.start(musicAt, offset)
    } else {
      this.loopBuf = null
      this.source(r.buffer, bus).start(musicAt, offset)
    }
    this.startCtxTime = musicAt
    this.startBufOffset = offset
    this.startScore = from
    this.set({ status: countIn ? 'countin' : 'playing', position: from, cursor: true })
    this.onFrame(from, true)
    this.frames.start()
  }

  private source(buffer: AudioBuffer, to: AudioNode): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource()
    src.buffer = buffer
    src.connect(to)
    this.sources.push(src)
    return src
  }

  /** Stops what is playing: with `fade`, a quick fade-out first (no click), else at once. */
  private stopSources(fade: boolean) {
    const ctx = this.ctx
    const bus = this.bus
    const sources = this.sources
    this.sources = []
    this.bus = null
    if (!sources.length && !bus) return
    const now = ctx && ctx.state !== 'closed' ? ctx.currentTime : 0
    if (fade && ctx && bus && ctx.state === 'running') {
      bus.gain.cancelScheduledValues(now)
      bus.gain.setTargetAtTime(0, now, FADE_OUT_TAU)
    }
    const at = fade && ctx && ctx.state === 'running' ? now + FADE_OUT_TAU * 8 : 0
    for (const src of sources) {
      try {
        if (at) src.stop(at)
        else {
          src.stop()
          src.disconnect()
        }
      } catch {
        // already stopped
      }
    }
    if (bus) {
      if (at) window.setTimeout(() => bus.disconnect(), 150)
      else bus.disconnect()
    }
  }

  private restartAt(position: number) {
    const spec = this.spec
    if (!spec || spec.sound === 'original') return
    const ready = this.rendered && this.rendered.key === this.bufferKey(spec) && (!spec.loop || this.looped?.key === this.loopKey(spec))
    if (ready && this.rendered) this.startSources(this.rendered, spec.loop ? this.looped : null, position, false)
    else {
      this.pause()
      this.set({ position })
      void this.play({ countIn: false })
    }
  }

  /** Inside the loop when there is one; back to the start when at the very end. */
  private clampToLoop(pos: number): number {
    const loop = this.spec?.loop
    if (loop) return pos < loop[0] || pos >= loop[1] - 0.005 ? loop[0] : pos
    return pos >= (this.spec?.duration ?? 0) - 0.005 ? 0 : pos
  }

  private currentPosition(): number {
    const spec = this.spec
    if (!spec) return 0
    if (spec.sound === 'original') {
      const t = this.original.time()
      return t == null || !spec.original ? this.snap.position : Math.max(0, spec.original.fromSource(t))
    }
    const ctx = this.ctx
    const r = this.rendered
    if (!ctx || !r || !this.playing) return this.snap.position
    const t = heardTime(ctx)
    if (t < this.startCtxTime) return this.startScore
    let p = this.startBufOffset + (t - this.startCtxTime)
    const lb = this.loopBuf
    if (lb && p >= lb[1]) p = lb[0] + ((p - lb[0]) % (lb[1] - lb[0]))
    return Math.max(0, (p - r.introSec) * r.speedF)
  }

  /* ---------- original ---------- */

  /** Seconds of the recording where a score time falls (the recording starts at 0). */
  private toSource(scoreSeconds: number): number {
    return Math.max(0, this.spec?.original?.toSource(scoreSeconds) ?? scoreSeconds)
  }

  private playOriginal() {
    const spec = this.spec
    const audio = spec?.original ? this.original.load(spec.original.blob) : null
    if (!spec || !audio) {
      this.onError('No hay audio original')
      return
    }
    const token = ++this.playToken
    const from = this.clampToLoop(Math.min(Math.max(0, this.snap.position), spec.duration))
    this.original.setRate(spec.speed / 100, spec.volume)
    this.original.seek(this.toSource(from))
    this.set({ status: 'playing', position: from, cursor: true })
    this.onFrame(from, true)
    this.frames.start()
    void this.wakeLock.acquire(() => this.playing)
    // Called synchronously inside the user gesture (iOS needs that).
    audio.play().catch((err) => {
      if (token !== this.playToken) return
      console.warn('[viewer] original audio', err)
      this.frames.stop()
      this.set({ status: 'paused' })
      this.onError('No se pudo reproducir el audio original')
    })
  }

  /* ---------- frame loop ---------- */

  private tick() {
    const spec = this.spec
    if (!spec || !this.playing) return
    if (this.snap.status === 'countin' && this.ctx && heardTime(this.ctx) >= this.startCtxTime) this.set({ status: 'playing' })
    let pos = this.currentPosition()
    if (spec.sound === 'original' && spec.loop && pos >= spec.loop[1]) {
      this.original.seek(this.toSource(spec.loop[0]))
      pos = spec.loop[0]
    }
    if (!spec.loop && pos >= spec.duration) {
      this.finish()
      return
    }
    this.snap = { ...this.snap, position: pos }
    this.listeners.forEach((l) => l())
    this.onFrame(pos, true)
  }

  /**
   * Reached the end without a loop: back to the start, cursor hidden. The last notes ring out (the
   * sources end by themselves; a new start fades whatever is still ringing).
   */
  private finish() {
    this.playToken++
    this.original.pause()
    this.frames.stop()
    this.wakeLock.release()
    this.set({ status: 'paused', position: 0, cursor: false })
    this.onFrame(0, false)
  }
}
