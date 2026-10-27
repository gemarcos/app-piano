import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { resolveColors, useElementWidth, useReducedMotionPref, useThemeVersion } from './hooks'
import { cx } from './cx'
import './Waveform.css'

export interface WaveformProps {
  /** Amplitudes 0..1 (any length; resampled to the number of bars that fit). */
  peaks: ArrayLike<number>
  /** 0..1 played fraction, drawn in accent. */
  progress?: number
  /** [start, end] 0..1; bars outside are dimmed. */
  selection?: [number, number]
  height?: number
  barWidth?: number
  gap?: number
  /** Scale so the loudest bar fills the height (default true). */
  normalize?: boolean
  /** Bars grow in when new data arrives (default true). Use false for live, growing data. */
  animate?: boolean
  ariaLabel?: string
  className?: string
}

function resample(peaks: ArrayLike<number>, n: number, normalize: boolean): Float32Array {
  const out = new Float32Array(Math.max(0, n))
  const len = peaks.length
  if (len === 0 || n <= 0) return out
  let max = 0
  for (let i = 0; i < n; i++) {
    const start = Math.floor((i * len) / n)
    const end = Math.max(start + 1, Math.floor(((i + 1) * len) / n))
    let m = 0
    for (let j = start; j < end && j < len; j++) {
      const v = Math.abs(peaks[j] || 0)
      if (v > m) m = v
    }
    out[i] = m
    if (m > max) max = m
  }
  const scale = normalize && max > 0 ? 1 / max : 1
  for (let i = 0; i < n; i++) out[i] = Math.min(1, out[i] * scale)
  return out
}

/** Cheap content signature, so a new array with the same data does not replay the entrance. */
function signature(peaks: ArrayLike<number>): string {
  const len = peaks.length
  const step = Math.max(1, Math.floor(len / 64))
  let sum = 0
  for (let i = 0; i < len; i += step) sum += (peaks[i] || 0) * (i + 1)
  return `${len}:${sum.toFixed(4)}`
}

/** Crisp rounded bars on a canvas (device-pixel aligned), responsive to its container width. */
export function Waveform({
  peaks,
  progress,
  selection,
  height = 72,
  barWidth = 3,
  gap = 2,
  normalize = true,
  animate = true,
  ariaLabel,
  className,
}: WaveformProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const width = useElementWidth(wrapRef)
  const themeVersion = useThemeVersion()
  const reduced = useReducedMotionPref()
  const colors = useRef<string[]>([])
  const grow = useRef(1)
  const props = useRef({ peaks, progress, selection, height, barWidth, gap, normalize, width })
  props.current = { peaks, progress, selection, height, barWidth, gap, normalize, width }

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const p = props.current
    if (!canvas || p.width <= 0) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const W = Math.round(p.width * dpr)
    const H = Math.round(p.height * dpr)
    if (canvas.width !== W) canvas.width = W
    if (canvas.height !== H) canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, W, H)

    const bw = Math.max(1, Math.round(p.barWidth * dpr))
    const g = Math.max(0, Math.round(p.gap * dpr))
    const n = Math.max(1, Math.floor((W + g) / (bw + g)))
    const bars = resample(p.peaks, n, p.normalize)
    if (colors.current.length < 3) return
    const [cWave, cDim, cAccent] = colors.current
    const total = n * bw + (n - 1) * g
    let x = Math.floor((W - total) / 2)
    const minH = Math.max(2, Math.round(2 * dpr))
    const t = grow.current
    const sel = p.selection
    const prog = p.progress

    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n
      // left-to-right entrance wave
      const local = Math.min(1, Math.max(0, t * 1.35 - f * 0.35))
      const eased = 1 - Math.pow(1 - local, 3)
      const bh = Math.max(minH, Math.round(bars[i] * H * eased))
      const y = Math.round((H - bh) / 2)
      let color = cWave
      if (sel && (f < sel[0] || f > sel[1])) color = cDim
      else if (prog != null && f <= prog) color = cAccent
      ctx.fillStyle = color
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, bw, bh, bw / 2)
      else ctx.rect(x, y, bw, bh)
      ctx.fill()
      x += bw + g
    }
  }, [])

  // Theme colors (resolved to concrete values for canvas).
  useLayoutEffect(() => {
    if (wrapRef.current) colors.current = resolveColors(wrapRef.current, ['var(--wave)', 'var(--wave-dim)', 'var(--accent)'])
    draw()
  }, [themeVersion, draw])

  // Entrance animation whenever different data arrives.
  const sig = signature(peaks)
  useEffect(() => {
    if (reduced || !animate) {
      grow.current = 1
      draw()
      return
    }
    grow.current = 0
    const start = performance.now()
    let raf = requestAnimationFrame(function step(now) {
      grow.current = Math.min(1, (now - start) / 560)
      draw()
      if (grow.current < 1) raf = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(raf)
  }, [sig, animate, reduced, draw])

  useEffect(() => {
    draw()
  }, [draw, width, height, barWidth, gap, normalize, progress, selection?.[0], selection?.[1]])

  return (
    <div
      ref={wrapRef}
      className={cx('ui-wave', className)}
      style={{ height }}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <canvas ref={canvasRef} className="ui-wave__canvas" style={{ height }} />
    </div>
  )
}
