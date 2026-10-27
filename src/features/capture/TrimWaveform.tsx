// Owner: capture. Waveform with a draggable selection: two handles (also keyboard sliders) and a window that
// can be dragged as a whole. Rules (min/max length, file bounds) come from applySelectionEdit.
import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { Waveform, cx } from '../../ui'
import { formatTime } from '../../lib/format'
import { applySelectionEdit, type SelectionEdit } from './selection'
import type { CaptureRange } from './store'
import './TrimWaveform.css'

export interface TrimWaveformProps {
  peaks: ArrayLike<number>
  duration: number
  value: CaptureRange
  onChange: (next: CaptureRange) => void
  /** Called when a drag or key press ends (e.g. to persist the selection). */
  onCommit?: (next: CaptureRange) => void
  /** Playback position as a fraction of the whole file (0..1). */
  progress?: number
  height?: number
}

interface Drag {
  edit: SelectionEdit
  pointerId: number
  /** Seconds between the pointer and the dragged edge (or the window start). */
  offset: number
  moved: boolean
}

export function TrimWaveform({ peaks, duration, value, onChange, onCommit, progress, height = 88 }: TrimWaveformProps) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const latest = useRef(value)
  latest.current = value

  const a = duration > 0 ? value.start / duration : 0
  const b = duration > 0 ? value.end / duration : 1

  const timeAt = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration
  }

  const onPointerDown = (edit: SelectionEdit) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const t = timeAt(e.clientX)
    const anchor = edit === 'end' ? latest.current.end : latest.current.start
    drag.current = { edit, pointerId: e.pointerId, offset: t - anchor, moved: false }
    if (edit !== 'move') e.currentTarget.focus({ preventScroll: true })
  }

  /** Pressing the waveform outside the selection pulls the nearest edge there and keeps dragging it. */
  const onTrackPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const t = timeAt(e.clientX)
    const edit: 'start' | 'end' = t < latest.current.start ? 'start' : 'end'
    const next = applySelectionEdit(latest.current, edit, t, duration)
    latest.current = next
    onChange(next)
    drag.current = { edit, pointerId: e.pointerId, offset: 0, moved: true }
  }

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    d.moved = true
    const next = applySelectionEdit(latest.current, d.edit, timeAt(e.clientX) - d.offset, duration)
    if (next.start !== latest.current.start || next.end !== latest.current.end) {
      latest.current = next
      onChange(next)
    }
  }

  const onPointerEnd = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    if (d.moved) onCommit?.(latest.current)
  }

  const onKeyDown = (edit: 'start' | 'end') => (e: KeyboardEvent<HTMLElement>) => {
    const current = latest.current
    const at = edit === 'start' ? current.start : current.end
    const step = e.shiftKey ? 5 : 0.5
    let target: number | null = null
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') target = at - step
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') target = at + step
    else if (e.key === 'PageDown') target = at - 10
    else if (e.key === 'PageUp') target = at + 10
    else if (e.key === 'Home') target = 0
    else if (e.key === 'End') target = duration
    if (target == null) return
    e.preventDefault()
    const next = applySelectionEdit(current, edit, target, duration)
    latest.current = next
    onChange(next)
    onCommit?.(next)
  }

  const handleProps = (edit: 'start' | 'end') => ({
    role: 'slider',
    tabIndex: 0,
    'aria-label': edit === 'start' ? 'Inicio de la selección' : 'Fin de la selección',
    'aria-valuemin': 0,
    'aria-valuemax': Math.round(duration * 10) / 10,
    'aria-valuenow': Math.round((edit === 'start' ? value.start : value.end) * 10) / 10,
    'aria-valuetext': formatTime(edit === 'start' ? value.start : value.end),
    onPointerDown: onPointerDown(edit),
    onKeyDown: onKeyDown(edit),
  })

  const whole = a <= 0.0005 && b >= 0.9995
  return (
    <div
      ref={ref}
      className="cap-trim"
      style={{ height }}
      onPointerDown={onTrackPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <Waveform peaks={peaks} selection={whole ? undefined : [a, b]} progress={progress} height={height} />
      <div
        className={cx('cap-trim__window', whole && 'is-whole')}
        style={{ left: `${a * 100}%`, right: `${(1 - b) * 100}%` }}
        onPointerDown={onPointerDown('move')}
      >
        <span className="cap-trim__handle cap-trim__handle--start" {...handleProps('start')}>
          <span className="cap-trim__grip" />
        </span>
        <span className="cap-trim__handle cap-trim__handle--end" {...handleProps('end')}>
          <span className="cap-trim__grip" />
        </span>
      </div>
    </div>
  )
}
