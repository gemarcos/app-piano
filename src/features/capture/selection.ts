// Owner: capture. Pure helpers for the capture flow (no DOM): trim selection rules, titles, progress mapping.
import type { TranscribeStage } from '../../engine/transcribe'
import type { CaptureRange } from './store'

/** Shortest selection that can be transcribed, seconds (shorter files are taken whole). */
export const MIN_SELECTION_SEC = 2
/** Longest selection, seconds (5 min). */
export const MAX_SELECTION_SEC = 300
/** Files up to MAX_SELECTION_SEC are selected whole by default; longer ones start with their first MAX_SELECTION_SEC. */
/** Recordings shorter than this are discarded ("Grabación demasiado corta"). */
export const MIN_RECORDING_SEC = 2

const STEP = 0.05

/** Snaps to the 50 ms grid, but keeps the exact file edges reachable. */
function snap(t: number, total: number): number {
  if (t <= STEP / 2) return 0
  if (t >= total - STEP / 2) return total
  return Math.round(t / STEP) * STEP
}

/** Default trim selection for a file of `duration` seconds. */
export function defaultSelection(duration: number): CaptureRange {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0
  return { start: 0, end: Math.min(total, MAX_SELECTION_SEC) }
}

/** Minimum selection length for a file (the whole file when it is shorter than MIN_SELECTION_SEC). */
export function minSelection(duration: number): number {
  return Math.min(MIN_SELECTION_SEC, Math.max(0, duration))
}

export type SelectionEdit = 'start' | 'end' | 'move'

/**
 * Applies an edit to the selection and enforces the rules: inside [0, duration], at least
 * MIN_SELECTION_SEC long (or the whole file), at most MAX_SELECTION_SEC. 'start'/'end' move one edge
 * (the other stays put unless a limit forces it), 'move' shifts the window keeping its length.
 */
export function applySelectionEdit(prev: CaptureRange, edit: SelectionEdit, value: number, duration: number): CaptureRange {
  const total = Math.max(0, Number.isFinite(duration) ? duration : 0)
  const min = minSelection(total)
  const max = Math.min(MAX_SELECTION_SEC, total)
  const v = Number.isFinite(value) ? value : 0
  if (edit === 'move') {
    const length = Math.min(Math.max(prev.end - prev.start, min), max)
    const start = Math.max(0, Math.min(snap(v, total), total - length))
    return { start, end: Math.min(total, start + length) }
  }
  if (edit === 'start') {
    let start = Math.min(Math.max(0, snap(v, total)), prev.end - min)
    start = Math.max(start, prev.end - max, 0)
    return { start, end: prev.end }
  }
  let end = Math.max(Math.min(total, snap(v, total)), prev.start + min)
  end = Math.min(end, prev.start + max, total)
  return { start: prev.start, end }
}

/** Repairs a stored or default range so it obeys the rules (clamped to the file, then trimmed from the end). */
export function normalizeSelection(range: CaptureRange | null | undefined, duration: number): CaptureRange {
  const total = Math.max(0, Number.isFinite(duration) ? duration : 0)
  const base = range ?? defaultSelection(total)
  const finite = (t: number, fallback: number) => (Number.isFinite(t) ? t : fallback)
  let start = Math.min(Math.max(0, finite(base.start, 0)), total)
  let end = Math.min(Math.max(start, finite(base.end, total)), total)
  const min = minSelection(total)
  const max = Math.min(MAX_SELECTION_SEC, total)
  if (end - start > max) end = start + max
  if (end - start < min) {
    end = Math.min(total, start + min)
    start = Math.max(0, end - min)
  }
  return { start, end }
}

/** Library title for an imported file: its name without the extension ('' when nothing is left). */
export function titleFromFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').trim()
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base).trim()
}

export type PipelineStage = 'preparing' | 'listening' | 'writing' | 'done'

/** One-word labels shown under the progress ring. */
export const STAGE_LABELS: Record<PipelineStage, string> = {
  preparing: 'Preparando',
  listening: 'Escuchando',
  writing: 'Escribiendo',
  done: 'Listo',
}

/** Share of the overall progress taken by the steps before and after the model. */
const PRE = 0.03
const POST = 0.04

/** Overall 0..1 progress for a transcriber progress report. */
export function overallProgress(fraction: number): number {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  return PRE + (1 - PRE - POST) * f
}

/** Pipeline stage for a transcriber stage. */
export function stageFor(stage: TranscribeStage): PipelineStage {
  if (stage === 'loading-model') return 'preparing'
  if (stage === 'analyzing') return 'listening'
  return 'writing'
}
