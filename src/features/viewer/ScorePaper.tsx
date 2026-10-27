// Owner: viewer. The score on its paper card: abcjs SVG (responsive, currentColor ink so the theme
// applies without re-rendering), the playing notes highlighted, the A-B loop shaded, taps that
// seek, and auto-scroll that keeps the playing system in view.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TuneObject } from 'abcjs'
import type { Hands, NoteNaming, Score } from '../../types'
import { scoreToAbc, suggestMeasuresPerLine } from '../../engine/score'
import { cx } from '../../ui'
import { loadAbcjs } from './abcjs'
import { buildTimeline, eventIndexAt, scoreForHands, type MeasureRange, type StaffTimeline } from './timeline'
import './ScorePaper.css'

export interface PaperHandle {
  /** Highlights what sounds at `tick` (null clears); `follow` scrolls the system into view. */
  setCursor(tick: number | null, follow: boolean): void
}

export interface ScorePaperProps {
  score: Score
  hands: Hands
  naming: NoteNaming
  /** Percent (100 = abcjs units are CSS px). */
  zoom: number
  /** Shaded measures of an A-B loop. */
  band: MeasureRange | null
  /** A tap on (or near) a note or rest. */
  onTap: (tick: number, measure: number) => void
  /** Visible area between the sticky header and the player bar, in viewport px. */
  viewport: () => { top: number; bottom: number }
  reducedMotion: boolean
  /** Shown instead of the score (e.g. no notes left after the filters). */
  empty?: ReactNode
}

/** abcjs puts no room for annotations at the right edge: keep the last note name of a line whole. */
const PAD_RIGHT = 10
const PAD_LEFT = 0

interface NoteRef {
  g: SVGGElement
  staff: 0 | 1
  index: number
}

interface PaperMap {
  svg: SVGSVGElement
  /** Per staff, the <g> of each timeline event (null for hidden staves or unmapped elements). */
  groups: [(SVGGElement | null)[], (SVGGElement | null)[]]
  notes: NoteRef[]
  /** Barline <g> ending each measure (first shown staff). */
  bars: (SVGGElement | null)[]
  /** System wrappers, in order. */
  lines: SVGGElement[]
  perLine: number
  /** Soft band behind the beat that is playing. */
  cursor: SVGRectElement
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(Math.round(el.clientWidth))
    if (typeof ResizeObserver === 'undefined') return
    let timer = 0
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setWidth((old) => (Math.abs(old - w) > 2 ? w : old)), 120)
    })
    ro.observe(el)
    return () => {
      window.clearTimeout(timer)
      ro.disconnect()
    }
  }, [ref])
  return width
}

/** Element of the abcjs parse tree we read (abcjs types do not expose abselem.elemset). */
interface VoiceElement {
  el_type: string
  abselem?: { elemset?: SVGGElement[] }
}

function buildMap(tune: TuneObject, target: HTMLElement, timeline: [StaffTimeline, StaffTimeline], hands: Hands, perLine: number, measureCount: number): PaperMap | null {
  const svg = target.querySelector('svg')
  if (!svg) return null
  const shown: (0 | 1)[] = hands === 'both' ? [0, 1] : hands === 'right' ? [0] : [1]
  const first: [number[], number[]] = [[], []]
  timeline.forEach((events, s) => events.forEach((ev, i) => {
    if (first[s][ev.measure] === undefined) first[s][ev.measure] = i
  }))
  const groups: PaperMap['groups'] = [timeline[0].map(() => null), timeline[1].map(() => null)]
  const notes: NoteRef[] = []
  const bars: (SVGGElement | null)[] = Array.from({ length: measureCount }, () => null)
  let line = 0
  for (const tl of tune.lines) {
    if (!tl.staff) continue
    tl.staff.forEach((staff, si) => {
      const s = shown[si]
      if (s === undefined) return
      let measure = line * perLine
      let index = 0
      const voice = (staff.voices?.[0] ?? []) as unknown as VoiceElement[]
      for (const el of voice) {
        if (el.el_type === 'bar') {
          if (si === 0 && measure < measureCount) bars[measure] = el.abselem?.elemset?.[0] ?? null
          measure++
          index = 0
          continue
        }
        if (el.el_type !== 'note') continue
        const start = first[s][measure]
        const i = start === undefined ? -1 : start + index
        const g = el.abselem?.elemset?.[0]
        if (i >= 0 && i < timeline[s].length && timeline[s][i].measure === measure && g) {
          groups[s][i] = g
          notes.push({ g, staff: s, index: i })
        }
        index++
      }
    })
    line++
  }
  const lines = Array.from(svg.querySelectorAll<SVGGElement>('g.abcjs-staff-wrapper'))
  const cursor = document.createElementNS(SVG_NS, 'rect')
  cursor.setAttribute('class', 'vw-cursor')
  cursor.setAttribute('rx', '7')
  cursor.style.display = 'none'
  svg.insertBefore(cursor, lines[0] ?? null)
  return { svg, groups, notes, bars, lines, perLine, cursor }
}

/** Puts the cursor band behind the given note groups (same system), or hides it. */
function placeCursor(map: PaperMap, groups: SVGGElement[], line: number) {
  const lineEl = map.lines[line]
  if (!groups.length || !lineEl) {
    map.cursor.style.display = 'none'
    return
  }
  let x0 = Infinity
  let x1 = -Infinity
  for (const g of groups) {
    const b = g.getBBox()
    x0 = Math.min(x0, b.x)
    x1 = Math.max(x1, b.x + b.width)
  }
  const box = lineEl.getBBox()
  map.cursor.setAttribute('x', String(x0 - 6))
  map.cursor.setAttribute('width', String(Math.max(14, x1 - x0 + 12)))
  map.cursor.setAttribute('y', String(box.y - 4))
  map.cursor.setAttribute('height', String(box.height + 6))
  map.cursor.style.display = ''
}

export const ScorePaper = forwardRef<PaperHandle, ScorePaperProps>(function ScorePaper(
  { score, hands, naming, zoom, band, onTap, viewport, reducedMotion, empty },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef<HTMLDivElement>(null)
  const width = useWidth(wrapRef)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  const zoomF = zoom / 100
  const timeline = useMemo(() => buildTimeline(score), [score])
  const layoutScore = useMemo(() => scoreForHands(score, hands), [score, hands])
  const perLine = useMemo(
    () => (width > 0 ? suggestMeasuresPerLine(layoutScore, width, { noteNames: naming !== 'none', zoom: zoomF }) : 2),
    [layoutScore, width, naming, zoomF],
  )
  const abc = useMemo(
    () => scoreToAbc(score, { hands, noteNaming: naming, measuresPerLine: perLine, printTempo: false }),
    [score, hands, naming, perLine],
  )
  const staffwidth = width > 0 ? Math.max(120, Math.round((width / zoomF - PAD_LEFT - PAD_RIGHT) * 10) / 10) : 0

  // Imperative state (changes every frame while playing; no React renders).
  const mapRef = useRef<PaperMap | null>(null)
  const litRef = useRef<Set<SVGGElement>>(new Set())
  const bandKeyRef = useRef('')
  const tickRef = useRef<number | null>(null)
  const followLineRef = useRef(-1)
  const bandRef = useRef<MeasureRange | null>(band)
  bandRef.current = band
  const timelineRef = useRef(timeline)
  timelineRef.current = timeline
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion

  /**
   * Keeps the playing system and the next one in view. When a new system starts and the next one
   * is not visible, the current system moves to the top: the page scrolls while the player is
   * still early in the line, never when the cursor is about to hide behind the player.
   */
  const reveal = useCallback((lineIndex: number) => {
    const lines = mapRef.current?.lines
    const el = lines?.[lineIndex]
    if (!el) return
    const r = el.getBoundingClientRect()
    const after = lines[lineIndex + 1]?.getBoundingClientRect()
    const { top, bottom } = viewportRef.current()
    const needed = after ? after.bottom : r.bottom
    if (r.top >= top + 4 && needed <= bottom - 4) return
    const y = window.scrollY + r.top - top - 8
    window.scrollTo({ top: Math.max(0, y), behavior: reducedRef.current ? 'auto' : 'smooth' })
  }, [])

  const paintCursor = useCallback(
    (tick: number | null, follow: boolean) => {
      tickRef.current = tick
      const map = mapRef.current
      const next = new Set<SVGGElement>()
      let measure = -1
      // The band sits behind the most recent onset (both hands when they start together).
      let bandStart = -Infinity
      let band: SVGGElement[] = []
      if (tick != null && map) {
        const tl = timelineRef.current
        for (const s of [0, 1] as const) {
          const i = eventIndexAt(tl[s], tick)
          if (i < 0) continue
          const g = map.groups[s][i]
          const ev = tl[s][i]
          if (!g) continue
          if (ev.pitches.length) next.add(g)
          if (measure < 0) measure = ev.measure
          if (ev.start > bandStart) {
            bandStart = ev.start
            band = [g]
          } else if (ev.start === bandStart) band.push(g)
        }
      }
      const lit = litRef.current
      lit.forEach((g) => {
        if (!next.has(g)) g.classList.remove('vw-on')
      })
      next.forEach((g) => {
        if (!lit.has(g)) g.classList.add('vw-on')
      })
      litRef.current = next
      const bandKey = band.length ? `${bandStart}:${band.length}` : ''
      if (map && bandKey !== bandKeyRef.current) {
        bandKeyRef.current = bandKey
        placeCursor(map, band, measure < 0 ? -1 : Math.floor(measure / map.perLine))
      }
      if (!follow || measure < 0 || !map) {
        if (!follow) followLineRef.current = -1
        return
      }
      const line = Math.floor(measure / map.perLine)
      if (line !== followLineRef.current) {
        followLineRef.current = line
        reveal(line)
      }
    },
    [reveal],
  )

  const paintBand = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    map.svg.querySelectorAll('.vw-band').forEach((n) => n.remove())
    const range = bandRef.current
    if (!range) return
    const [a, b] = [Math.min(range[0], range[1]), Math.max(range[0], range[1])]
    // One continuous band per system: consecutive measures of a line share a rectangle.
    const segments = new Map<number, { x0: number; x1: number }>()
    for (let m = a; m <= b; m++) {
      const line = Math.floor(m / map.perLine)
      const bar = map.bars[m]
      if (!map.lines[line] || !bar) continue
      const barBox = bar.getBBox()
      let x0: number
      if (m % map.perLine === 0 || !map.bars[m - 1]) {
        // First measure of the system: start just before its first note or rest.
        const xs = map.notes
          .filter((n) => timelineRef.current[n.staff][n.index].measure === m)
          .map((n) => n.g.getBBox().x)
        x0 = (xs.length ? Math.min(...xs) : barBox.x - 40) - 8
      } else {
        const prev = map.bars[m - 1]!.getBBox()
        x0 = prev.x + prev.width
      }
      const x1 = barBox.x + barBox.width / 2
      const seg = segments.get(line)
      segments.set(line, seg ? { x0: Math.min(seg.x0, x0), x1: Math.max(seg.x1, x1) } : { x0, x1 })
    }
    segments.forEach(({ x0, x1 }, line) => {
      const box = map.lines[line].getBBox()
      const rect = document.createElementNS(SVG_NS, 'rect')
      rect.setAttribute('class', 'vw-band')
      rect.setAttribute('x', String(x0))
      rect.setAttribute('y', String(box.y - 6))
      rect.setAttribute('width', String(Math.max(0, x1 - x0)))
      rect.setAttribute('height', String(box.height + 10))
      rect.setAttribute('rx', '8')
      map.svg.insertBefore(rect, map.cursor)
    })
  }, [])

  useImperativeHandle(ref, () => ({ setCursor: paintCursor }), [paintCursor])

  // Render (abcjs is loaded on demand the first time).
  const hasNotes = score.stats.noteCount > 0 && !empty
  useEffect(() => {
    if (!hasNotes || staffwidth <= 0) return
    let cancelled = false
    loadAbcjs()
      .then((abcjs) => {
        const target = targetRef.current
        if (cancelled || !target) return
        const tune = abcjs.renderAbc(target, abc, {
          responsive: 'resize',
          add_classes: true,
          foregroundColor: 'currentColor',
          // abcjs always handles clicks itself and paints the clicked note red by default:
          // keep its selection invisible (taps are ours: they seek).
          selectionColor: 'currentColor',
          staffwidth,
          paddingtop: 6,
          paddingbottom: 14,
          paddingleft: PAD_LEFT,
          paddingright: PAD_RIGHT,
          ariaLabel: 'Partitura',
        })[0]
        litRef.current = new Set()
        bandKeyRef.current = ''
        followLineRef.current = -1
        mapRef.current = tune ? buildMap(tune, target, timelineRef.current, hands, perLine, score.measureCount) : null
        paintBand()
        paintCursor(tickRef.current, false)
        setFailed(false)
        setReady(true)
      })
      .catch((err) => {
        console.warn('[viewer] abcjs', err)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [abc, staffwidth, hasNotes, hands, perLine, score.measureCount, paintBand, paintCursor])

  useEffect(() => {
    paintBand()
  }, [band, paintBand])

  const handleClick = (e: React.MouseEvent) => {
    const map = mapRef.current
    if (!map || !hasNotes) return
    let best: NoteRef | null = null
    let bestD = Infinity
    for (const n of map.notes) {
      const r = n.g.getBoundingClientRect()
      const dx = e.clientX < r.left ? r.left - e.clientX : e.clientX > r.right ? e.clientX - r.right : 0
      const dy = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0
      const d = Math.hypot(dx, dy)
      if (d < bestD) {
        bestD = d
        best = n
      }
    }
    if (!best || bestD > 36) return
    const ev = timelineRef.current[best.staff][best.index]
    onTap(ev.start, ev.measure)
  }

  return (
    <section className={cx('vw-paper', ready && hasNotes && 'is-ready')} aria-label="Partitura">
      <div ref={wrapRef} className="vw-paper__inner" onClick={handleClick}>
        {hasNotes && !failed && <div ref={targetRef} className="vw-paper__abc" />}
        {failed && <p className="vw-paper__message">No se pudo dibujar la partitura</p>}
        {!hasNotes && empty}
      </div>
    </section>
  )
})
