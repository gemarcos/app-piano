import { describe, expect, it } from 'vitest'
import { UI_SOUNDS, UI_SOUND_LEVEL, createUiSounds, type SoundContext, type UiSoundEnv } from './sound'

/** Records what the synth asks Web Audio for. */
function fakeContext() {
  const log = { oscillators: 0, gains: 0, filters: 0, starts: [] as number[], stops: [] as number[], masterGain: [] as number[], resumes: 0 }
  const param = (onSet?: (v: number) => void) => ({
    value: 0,
    setValueAtTime: (v: number) => onSet?.(v),
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: (v: number) => {
      if (!(v > 0)) throw new RangeError('exponential ramp to a non-positive value')
    },
    setTargetAtTime: () => {},
  })
  const node = () => ({ connect: () => {}, disconnect: () => {} })
  let gainCount = 0
  const ctx = {
    currentTime: 1,
    sampleRate: 48000,
    state: 'suspended' as AudioContextState,
    destination: node(),
    resume: async () => {
      log.resumes++
      ctx.state = 'running'
    },
    createOscillator: () => {
      log.oscillators++
      return { ...node(), type: 'sine', frequency: param(), start: (t: number) => log.starts.push(t), stop: (t: number) => log.stops.push(t) }
    },
    createGain: () => {
      log.gains++
      const first = gainCount++ === 0
      return { ...node(), gain: param(first ? (v) => log.masterGain.push(v) : undefined) }
    },
    createBiquadFilter: () => {
      log.filters++
      return { ...node(), type: 'lowpass', frequency: param(), Q: param() }
    },
    createBuffer: () => ({}),
    createBufferSource: () => ({ ...node(), start: () => {}, stop: () => {} }),
  }
  return { ctx: ctx as unknown as SoundContext & { currentTime: number }, log }
}

function setup(over: Partial<UiSoundEnv> = {}) {
  const fake = fakeContext()
  let created = 0
  const state = { enabled: true, volume: 1 }
  const sounds = createUiSounds({
    createContext: () => {
      created++
      return fake.ctx
    },
    enabled: () => state.enabled,
    volume: () => state.volume,
    ...over,
  })
  return { sounds, fake, state, created: () => created }
}

describe('interface sounds', () => {
  it('creates no AudioContext until the first sound or gesture', () => {
    const { sounds, created } = setup()
    expect(created()).toBe(0)
    expect(sounds.hasContext()).toBe(false)
    expect(sounds.play('tap')).toBe(true)
    expect(created()).toBe(1)
    expect(sounds.hasContext()).toBe(true)
  })

  it('reuses one context and resumes it when suspended', () => {
    const { sounds, fake, created } = setup()
    sounds.unlock()
    expect(fake.log.resumes).toBe(1)
    fake.ctx.currentTime += 1
    sounds.play('tap')
    fake.ctx.currentTime += 1
    sounds.play('select')
    expect(created()).toBe(1)
  })

  it('stays silent (and never builds a context) when switched off', () => {
    const { sounds, state, created } = setup()
    state.enabled = false
    expect(sounds.play('success')).toBe(false)
    sounds.unlock()
    expect(created()).toBe(0)
  })

  it('is silent while recording or playing, and plays again afterwards', () => {
    const { sounds, fake } = setup()
    sounds.block('mic', true)
    sounds.block('player', true)
    expect(sounds.isBlocked()).toBe(true)
    expect(sounds.play('tap')).toBe(false)
    sounds.block('mic', false)
    expect(sounds.play('tap')).toBe(false)
    sounds.block('player', false)
    expect(sounds.isBlocked()).toBe(false)
    fake.ctx.currentTime += 1
    expect(sounds.play('tap')).toBe(true)
  })

  it('force plays through a blocker (the stop cue right after the recorder stopped)', () => {
    const { sounds } = setup()
    sounds.block('mic', true)
    expect(sounds.play('recordStop', { force: true })).toBe(true)
  })

  it('force still respects the off switch', () => {
    const { sounds, state } = setup()
    state.enabled = false
    expect(sounds.play('recordStop', { force: true })).toBe(false)
  })

  it('skips the same sound retriggered within a few milliseconds', () => {
    const { sounds, fake } = setup()
    expect(sounds.play('select')).toBe(true)
    expect(sounds.play('select')).toBe(false)
    expect(sounds.play('tap')).toBe(true)
    fake.ctx.currentTime += 0.1
    expect(sounds.play('select')).toBe(true)
  })

  it('keeps the level low and follows the playback volume', () => {
    const { sounds, fake, state } = setup()
    sounds.play('tap')
    state.volume = 0
    fake.ctx.currentTime += 1
    sounds.play('tap')
    const [loud, quiet] = fake.log.masterGain
    expect(loud).toBeCloseTo(UI_SOUND_LEVEL)
    expect(loud).toBeLessThanOrEqual(0.3)
    expect(quiet).toBeGreaterThan(0)
    expect(quiet).toBeLessThan(loud)
  })

  it('synthesizes every sound with valid envelopes, all ending within 1.6 s', () => {
    for (const name of UI_SOUNDS) {
      const { sounds, fake } = setup()
      expect(sounds.play(name)).toBe(true)
      expect(fake.log.oscillators).toBeGreaterThan(0)
      const end = Math.max(...fake.log.stops) - fake.ctx.currentTime
      expect(end).toBeGreaterThan(0)
      expect(end).toBeLessThan(1.6)
      expect(Math.min(...fake.log.starts)).toBeGreaterThan(fake.ctx.currentTime)
    }
  })

  it('keeps the cues before a microphone take short enough not to be recorded', () => {
    for (const name of ['vinyl', 'recordStart'] as const) {
      const { sounds, fake } = setup()
      sounds.play(name)
      expect(Math.max(...fake.log.stops) - fake.ctx.currentTime).toBeLessThan(0.5)
    }
  })

  it('degrades silently without Web Audio', () => {
    const { sounds } = setup({ createContext: () => null })
    expect(sounds.play('tap')).toBe(false)
    expect(() => sounds.unlock()).not.toThrow()
    const throwing = createUiSounds({
      createContext: () => {
        throw new Error('no audio')
      },
      enabled: () => true,
      volume: () => 1,
    })
    expect(throwing.play('success')).toBe(false)
  })
})
