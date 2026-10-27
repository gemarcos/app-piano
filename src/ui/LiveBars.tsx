import { useEffect, useMemo, useRef } from 'react'
import { useReducedMotionPref } from './hooks'
import { cx } from './cx'
import './Waveform.css'

export interface LiveBarsProps {
  /** Current input level 0..1 (update as often as you like). */
  level: number
  bars?: number
  height?: number
  /** false = resting glyph (no input). */
  active?: boolean
  className?: string
}

const IDLE_LEVEL = 0.26

/** Live level meter drawn as thin vertical bars, taller in the center (ref-1 waveform glyph). */
export function LiveBars({ level, bars = 24, height = 48, active = true, className }: LiveBarsProps) {
  const reduced = useReducedMotionPref()
  const levelRef = useRef(level)
  levelRef.current = level
  const activeRef = useRef(active)
  activeRef.current = active
  const barEls = useRef<(HTMLSpanElement | null)[]>([])
  const heights = useRef<Float32Array>(new Float32Array(0))

  const weights = useMemo(
    () =>
      Array.from({ length: bars }, (_, i) => {
        const x = bars === 1 ? 0 : (i / (bars - 1)) * 2 - 1
        return 0.22 + 0.78 * Math.pow(Math.cos((x * Math.PI) / 2), 1.4)
      }),
    [bars],
  )

  useEffect(() => {
    if (heights.current.length !== bars) heights.current = new Float32Array(bars)
    const h = heights.current
    const phases = Array.from({ length: bars }, (_, i) => i * 1.9 + Math.sin(i * 0.7) * 2.3)
    const minPx = 4
    let raf = 0
    let last = performance.now()

    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000))
      last = now
      const t = now / 1000
      const isActive = activeRef.current
      const lv = isActive ? Math.min(1, Math.max(0, levelRef.current)) : IDLE_LEVEL
      let settled = true
      for (let i = 0; i < bars; i++) {
        const wobble = !isActive || reduced ? 1 : 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * (6 + (i % 5) * 1.3) + phases[i]))
        const target = lv * weights[i] * wobble
        const cur = h[i]
        const tau = target > cur ? 0.04 : 0.16
        const next = cur + (target - cur) * (1 - Math.exp(-dt / tau))
        h[i] = next
        if (Math.abs(next - target) > 0.003) settled = false
        const el = barEls.current[i]
        if (el) el.style.height = `${Math.max(minPx, next * height).toFixed(1)}px`
      }
      if (!isActive && settled) {
        raf = 0
        return
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [bars, height, weights, reduced, active])

  return (
    <div className={cx('ui-livebars', active && 'is-active', className)} style={{ height }} aria-hidden="true">
      {weights.map((_, i) => (
        <span
          key={i}
          className="ui-livebars__bar"
          ref={(el) => {
            barEls.current[i] = el
          }}
        />
      ))}
    </div>
  )
}
