import { memo, useMemo, useState, type CSSProperties, type SyntheticEvent } from 'react'
import { motion } from 'motion/react'
import { cx } from './cx'
import './Cover.css'

export interface CoverProps {
  /** Image URL. Without it (or if it fails to load) a soft generated cover is drawn from `seed`. */
  src?: string
  /** Stable string (item id) that picks the generated tone and motif. */
  seed: string
  /** px */
  size: number
  shape?: 'circle' | 'rounded'
  /** Slow continuous rotation (circle covers in a "now playing" context). */
  spinning?: boolean
  /** Accessible description; omit for decorative covers. */
  alt?: string
  /** motion layoutId for shared transitions (e.g. list cover -> viewer header). */
  layoutId?: string
  className?: string
  style?: CSSProperties
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TONES = 6
const LINE_GAP = 7

function coverParams(seed: string) {
  const rand = mulberry32(hashString(seed || 'pauta'))
  const tone = Math.floor(rand() * TONES)
  const angle = -14 + rand() * 22
  const top = 30 + rand() * 14
  const count = 2 + Math.floor(rand() * 2)
  let step = 2 + Math.floor(rand() * 5)
  const notes = Array.from({ length: count }, (_, i) => {
    step = Math.max(0, Math.min(8, step + Math.floor(rand() * 5) - 2))
    return { x: 30 + i * (44 / Math.max(1, count - 1)) + (rand() * 6 - 3), y: top + step * (LINE_GAP / 2) }
  })
  return { tone, angle, top, notes }
}

/** Generated placeholder: token tone + five staff lines and a few note heads. */
const CoverArt = memo(function CoverArt({ seed, minimal }: { seed: string; minimal: boolean }) {
  const p = useMemo(() => coverParams(seed), [seed])
  return (
    <span className="ui-cover__art" style={{ background: `var(--cover-tone-${p.tone})` }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <g transform={`rotate(${p.angle.toFixed(2)} 50 50)`}>
          {[0, 1, 2, 3, 4].map((i) => (
            <line
              key={i}
              className="ui-cover__staff"
              x1={-30}
              x2={130}
              y1={p.top + i * LINE_GAP}
              y2={p.top + i * LINE_GAP}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {!minimal &&
            p.notes.map((n, i) => (
              <ellipse
                key={i}
                className="ui-cover__note"
                cx={n.x}
                cy={n.y}
                rx={4.3}
                ry={3.1}
                transform={`rotate(-22 ${n.x.toFixed(2)} ${n.y.toFixed(2)})`}
              />
            ))}
        </g>
      </svg>
    </span>
  )
})

function radiusFor(size: number, shape: 'circle' | 'rounded'): string {
  if (shape === 'circle') return '50%'
  if (size <= 48) return 'var(--r-xs)'
  if (size <= 96) return 'var(--r-sm)'
  return 'var(--r-md)'
}

/** Square/round cover image with a generated fallback. */
export function Cover({ src, seed, size, shape = 'rounded', spinning = false, alt, layoutId, className, style }: CoverProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const showImage = Boolean(src) && failedSrc !== src
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => setLoadedSrc(e.currentTarget.getAttribute('src'))
  return (
    <motion.div
      layoutId={layoutId}
      className={cx('ui-cover', `ui-cover--${shape}`, spinning && 'is-spinning', className)}
      style={{ width: size, height: size, borderRadius: radiusFor(size, shape), ...style }}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
    >
      <span className="ui-cover__inner">
        {showImage ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className={loadedSrc === src ? 'is-loaded' : undefined}
            onLoad={onLoad}
            onError={() => setFailedSrc(src ?? null)}
          />
        ) : (
          <CoverArt seed={seed} minimal={size < 40} />
        )}
      </span>
    </motion.div>
  )
}
