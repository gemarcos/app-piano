import { describe, expect, it } from 'vitest'
import { estimateVelocities, strikeEnergy, VELOCITY_FLOOR, VELOCITY_LOUD, withVelocities } from './velocity'

const SR = 22050

/** Adds a decaying harmonic tone (partials 1..5) starting at `start` seconds. */
function strike(out: Float32Array, pitch: number, start: number, amp: number, cents = 0, seconds = 1.2) {
  const f0 = 440 * 2 ** ((pitch - 69) / 12 + cents / 1200)
  const from = Math.round(start * SR)
  for (let i = 0; i < seconds * SR && from + i < out.length; i++) {
    const t = i / SR
    let v = 0
    for (let k = 1; k <= 5; k++) v += Math.sin(2 * Math.PI * f0 * k * t) / k
    out[from + i] += amp * v * Math.exp(-2.5 * t)
  }
}

const note = (pitch: number, start: number) => ({ pitch, start, duration: 0.5, velocity: 0.4 })

describe('estimateVelocities', () => {
  it('orders notes by how hard they were struck, loudest near VELOCITY_LOUD, never below the floor', () => {
    const x = new Float32Array(SR * 6)
    strike(x, 60, 0.5, 0.5)
    strike(x, 64, 2.0, 0.15)
    strike(x, 67, 3.5, 0.03)
    strike(x, 72, 5.0, 0.0005)
    const v = estimateVelocities([note(60, 0.5), note(64, 2.0), note(67, 3.5), note(72, 5.0)], x, SR)
    expect(v[0]).toBeGreaterThan(v[1])
    expect(v[1]).toBeGreaterThan(v[2])
    expect(v[0]).toBeCloseTo(VELOCITY_LOUD, 1)
    expect(Math.min(...v)).toBeGreaterThanOrEqual(VELOCITY_FLOOR)
    expect(v[3]).toBe(VELOCITY_FLOOR)
  })

  it('measures a re-strike under the pedal by what it adds, not by what was already ringing', () => {
    const x = new Float32Array(SR * 4)
    strike(x, 60, 0.5, 0.4, 0, 3) // long, still ringing at 1.5 s
    strike(x, 60, 1.5, 0.4)
    const fresh = new Float32Array(SR * 4)
    strike(fresh, 60, 1.5, 0.4)
    const sustained = strikeEnergy(x, SR, 60, 1.5)
    const alone = strikeEnergy(fresh, SR, 60, 1.5)
    expect(sustained / alone).toBeGreaterThan(0.5)
    expect(sustained / alone).toBeLessThan(2.5)
  })

  it('looks for the partials where a detuned recording actually has them', () => {
    const x = new Float32Array(SR * 2)
    strike(x, 69, 0.5, 0.3, 40)
    expect(strikeEnergy(x, SR, 69, 0.5, 40)).toBeGreaterThan(strikeEnergy(x, SR, 69, 0.5, 0))
  })

  it('handles empty input and keeps every other note field', () => {
    expect(estimateVelocities([], new Float32Array(10), SR)).toEqual([])
    const x = new Float32Array(SR)
    strike(x, 60, 0.2, 0.3)
    const [n] = withVelocities([note(60, 0.2)], x, SR)
    expect(n).toMatchObject({ pitch: 60, start: 0.2, duration: 0.5 })
    expect(n.velocity).toBeGreaterThanOrEqual(VELOCITY_FLOOR)
  })
})
