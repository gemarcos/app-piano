// Interface sound effects, synthesized with Web Audio by our own code (no samples, nothing to license).
// - The AudioContext is created lazily on the first user gesture and is separate from the recorder's and the
//   viewer's contexts.
// - Sounds are off while anything blocks them (a microphone take, score playback): see useUiSoundsBlocked.
// - Settings.uiSounds switches them off; the level follows Settings.playbackVolume, kept low.
import { useEffect, useId } from 'react'
import { getSettings } from '../state/settings'

export type UiSound =
  | 'tap'
  | 'select'
  | 'toggleOn'
  | 'toggleOff'
  | 'recordStart'
  | 'recordStop'
  | 'success'
  | 'error'
  | 'vinyl'

export const UI_SOUNDS: readonly UiSound[] = ['tap', 'select', 'toggleOn', 'toggleOff', 'recordStart', 'recordStop', 'success', 'error', 'vinyl']

/** Master level at playbackVolume = 1. Interface sounds sit well under the music. */
export const UI_SOUND_LEVEL = 0.26
/** The same sound retriggered faster than this is skipped (press-and-hold steppers, double taps). */
export const UI_SOUND_MIN_GAP_S = 0.045

/** The few Web Audio members the synth uses (lets tests pass a fake context). */
export type SoundContext = Pick<
  AudioContext,
  'currentTime' | 'destination' | 'state' | 'resume' | 'createOscillator' | 'createGain' | 'createBiquadFilter' | 'createBuffer' | 'createBufferSource' | 'sampleRate'
>

export interface UiSoundEnv {
  /** Builds the context (called once, from a user gesture). Null when Web Audio is unavailable. */
  createContext: () => SoundContext | null
  /** Settings.uiSounds. */
  enabled: () => boolean
  /** 0..1 (Settings.playbackVolume). */
  volume: () => number
}

interface ToneSpec {
  freq: number
  at: number
  type?: OscillatorType
  gain?: number
  attack?: number
  decay: number
  /** Glides the pitch to this frequency over `glide` seconds. */
  glideTo?: number
  glide?: number
}

/** One enveloped oscillator into `out`. */
function tone(c: SoundContext, out: AudioNode, t: ToneSpec) {
  const osc = c.createOscillator()
  const env = c.createGain()
  osc.type = t.type ?? 'sine'
  osc.frequency.setValueAtTime(t.freq, t.at)
  if (t.glideTo) osc.frequency.exponentialRampToValueAtTime(t.glideTo, t.at + (t.glide ?? t.decay * 0.6))
  const peak = t.gain ?? 0.5
  const attack = t.attack ?? 0.008
  env.gain.setValueAtTime(0.0001, t.at)
  env.gain.linearRampToValueAtTime(peak, t.at + attack)
  env.gain.exponentialRampToValueAtTime(0.0001, t.at + attack + t.decay)
  osc.connect(env)
  env.connect(out)
  osc.start(t.at)
  osc.stop(t.at + attack + t.decay + 0.03)
}

/** A soft bell: fundamental plus two quieter, faster-decaying partials. */
function bell(c: SoundContext, out: AudioNode, freq: number, at: number, decay: number, gain = 0.32) {
  tone(c, out, { freq, at, gain, decay, attack: 0.012 })
  tone(c, out, { freq: freq * 2, at, gain: gain * 0.28, decay: decay * 0.5, attack: 0.01 })
  tone(c, out, { freq: freq * 3.01, at, gain: gain * 0.1, decay: decay * 0.3, attack: 0.008 })
}

/** A short piano-like pluck: slightly stretched harmonics, the upper ones dying first, through a soft low-pass. */
function pluck(c: SoundContext, out: AudioNode, freq: number, at: number, decay: number, gain = 0.34) {
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(3400, at)
  lp.frequency.exponentialRampToValueAtTime(900, at + decay)
  lp.connect(out)
  const amps = [1, 0.5, 0.26, 0.14, 0.07]
  amps.forEach((a, i) => {
    const n = i + 1
    const stretched = freq * n * Math.sqrt(1 + 0.0004 * n * n)
    tone(c, lp, { freq: stretched, at, gain: gain * a, decay: decay / Math.sqrt(n), attack: 0.005, type: n === 1 ? 'triangle' : 'sine' })
  })
}

const NOTE = { C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, G4: 392, D5: 587.33, Eb4: 311.13, Cs4: 277.18 }

/** The voices. `at` is a context time slightly in the future. Every sound ends within ~1.6 s. */
const VOICES: Record<UiSound, (c: SoundContext, out: AudioNode, at: number) => void> = {
  tap: (c, out, at) => tone(c, out, { freq: 1180, glideTo: 760, glide: 0.04, at, gain: 0.22, decay: 0.06 }),
  select: (c, out, at) => tone(c, out, { freq: 1480, at, gain: 0.16, decay: 0.045, type: 'triangle' }),
  toggleOn: (c, out, at) => {
    tone(c, out, { freq: NOTE.E5, at, gain: 0.2, decay: 0.08 })
    tone(c, out, { freq: NOTE.A5, at: at + 0.05, gain: 0.22, decay: 0.12 })
  },
  toggleOff: (c, out, at) => {
    tone(c, out, { freq: NOTE.A5, at, gain: 0.18, decay: 0.07 })
    tone(c, out, { freq: NOTE.E5, at: at + 0.05, gain: 0.18, decay: 0.1 })
  },
  // Short on purpose: the microphone opens ~0.5 s later and must not hear it.
  recordStart: (c, out, at) => {
    bell(c, out, NOTE.C5, at, 0.18, 0.26)
    bell(c, out, NOTE.G5, at + 0.07, 0.22, 0.26)
  },
  recordStop: (c, out, at) => {
    bell(c, out, NOTE.G5, at, 0.18, 0.24)
    bell(c, out, NOTE.C5, at + 0.08, 0.3, 0.24)
  },
  success: (c, out, at) => {
    ;[NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => bell(c, out, f, at + i * 0.075, i === 3 ? 1.25 : 0.85, i === 3 ? 0.3 : 0.24))
  },
  error: (c, out, at) => {
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(1400, at)
    lp.connect(out)
    tone(c, lp, { freq: NOTE.Eb4, at, gain: 0.3, decay: 0.16, type: 'triangle' })
    tone(c, lp, { freq: NOTE.Cs4, at: at + 0.12, gain: 0.3, decay: 0.24, type: 'triangle' })
  },
  // Tapping the record: one soft piano note (short: Escuchar opens the microphone right after).
  vinyl: (c, out, at) => pluck(c, out, NOTE.G4, at, 0.36),
}

export interface UiSounds {
  /** Plays a sound now. `force` ignores blockers (only right after a recorder stopped). Returns whether it played. */
  play: (name: UiSound, options?: { force?: boolean }) => boolean
  /** Creates/resumes the context inside a user gesture, without a sound. */
  unlock: () => void
  /** While any key is blocking, nothing plays. */
  block: (key: string, blocked: boolean) => void
  isBlocked: () => boolean
  /** Whether the AudioContext exists yet (it is created lazily). */
  hasContext: () => boolean
}

export function createUiSounds(env: UiSoundEnv): UiSounds {
  let ctx: SoundContext | null = null
  let master: GainNode | null = null
  let failed = false
  const blockers = new Set<string>()
  const lastPlayed = new Map<UiSound, number>()

  const ensure = (): SoundContext | null => {
    if (ctx || failed) return ctx
    try {
      ctx = env.createContext()
    } catch {
      ctx = null
    }
    if (!ctx) {
      failed = true
      return null
    }
    master = ctx.createGain()
    master.connect(ctx.destination)
    return ctx
  }

  const resume = (c: SoundContext) => {
    if (c.state === 'suspended') c.resume().catch(() => {})
  }

  return {
    play(name, options) {
      if (!env.enabled()) return false
      if (blockers.size > 0 && !options?.force) return false
      const voice = VOICES[name]
      if (!voice) return false
      const c = ensure()
      if (!c || !master) return false
      resume(c)
      const now = c.currentTime
      const last = lastPlayed.get(name)
      if (last != null && now - last < UI_SOUND_MIN_GAP_S && now >= last) return false
      lastPlayed.set(name, now)
      const volume = Math.min(1, Math.max(0, env.volume()))
      master.gain.setValueAtTime(UI_SOUND_LEVEL * (0.35 + 0.65 * volume), now)
      try {
        voice(c, master, now + 0.005)
        return true
      } catch {
        return false
      }
    },
    unlock() {
      if (!env.enabled() || blockers.size > 0) return
      const c = ensure()
      if (c) resume(c)
    },
    block(key, blocked) {
      if (blocked) blockers.add(key)
      else blockers.delete(key)
    },
    isBlocked: () => blockers.size > 0,
    hasContext: () => ctx !== null,
  }
}

function browserContext(): SoundContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return Ctor ? new Ctor({ latencyHint: 'interactive' }) : null
}

/** The app's interface sounds. */
export const uiSounds: UiSounds = createUiSounds({
  createContext: browserContext,
  enabled: () => getSettings().uiSounds !== false,
  volume: () => getSettings().playbackVolume ?? 0.9,
})

/** Plays an interface sound (no-op when switched off, blocked or unsupported). */
export function playUiSound(name: UiSound, options?: { force?: boolean }): void {
  uiSounds.play(name, options)
}

let unlockInstalled = false

/**
 * Creates the AudioContext on the first pointer/key gesture (iOS only lets a context start inside one), so the
 * first sound is not late. Call once at startup.
 */
export function installUiSoundUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return
  unlockInstalled = true
  const onGesture = () => {
    if (!getSettings().uiSounds) return
    uiSounds.unlock()
    window.removeEventListener('pointerdown', onGesture, true)
    window.removeEventListener('keydown', onGesture, true)
  }
  window.addEventListener('pointerdown', onGesture, true)
  window.addEventListener('keydown', onGesture, true)
}

/** Silences interface sounds while `active` (a microphone take, score playback). */
export function useUiSoundsBlocked(active: boolean): void {
  const key = useId()
  useEffect(() => {
    uiSounds.block(key, active)
    return () => uiSounds.block(key, false)
  }, [key, active])
}
