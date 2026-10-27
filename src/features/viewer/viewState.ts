// Owner: viewer. Per-score view state (not part of ScoreParams): zoom, hands, speed, loop and
// sound, remembered in localStorage per item. Every storage access is guarded.
import { useCallback, useEffect, useState } from 'react'
import type { Hands } from '../../types'
import type { LoopMode, MeasureRange } from './timeline'

export type SoundSource = 'piano' | 'original'

export interface ViewState {
  /** Percent, 60..160. */
  zoom: number
  hands: Hands
  /** Playback speed in percent, 50..150. */
  speed: number
  loop: LoopMode
  loopRange: MeasureRange | null
  sound: SoundSource
}

export const DEFAULT_VIEW: ViewState = { zoom: 100, hands: 'both', speed: 100, loop: 'off', loopRange: null, sound: 'piano' }

export const ZOOM_RANGE = [60, 160] as const
export const SPEED_RANGE = [50, 150] as const

const KEY = 'pauta.viewer.'

const inRange = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback

/** Repairs anything read from storage. */
export function sanitizeView(raw: unknown): ViewState {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ViewState, unknown>>
  const range = Array.isArray(v.loopRange) && v.loopRange.length === 2 && v.loopRange.every((n) => Number.isInteger(n) && n >= 0)
    ? ([v.loopRange[0], v.loopRange[1]] as MeasureRange)
    : null
  return {
    zoom: inRange(v.zoom, ZOOM_RANGE[0], ZOOM_RANGE[1], DEFAULT_VIEW.zoom),
    hands: v.hands === 'right' || v.hands === 'left' ? v.hands : 'both',
    speed: inRange(v.speed, SPEED_RANGE[0], SPEED_RANGE[1], DEFAULT_VIEW.speed),
    loop: v.loop === 'all' || v.loop === 'ab' ? v.loop : 'off',
    loopRange: range,
    sound: v.sound === 'original' ? 'original' : 'piano',
  }
}

export function loadViewState(id: string): ViewState {
  try {
    const text = window.localStorage.getItem(KEY + id)
    return sanitizeView(text ? JSON.parse(text) : null)
  } catch {
    return { ...DEFAULT_VIEW }
  }
}

export function saveViewState(id: string, state: ViewState): void {
  try {
    window.localStorage.setItem(KEY + id, JSON.stringify(state))
  } catch {
    // storage unavailable (private mode, quota): the view simply is not remembered
  }
}

export function forgetViewState(id: string): void {
  try {
    window.localStorage.removeItem(KEY + id)
  } catch {
    // ignore
  }
}

/** View state of one item, persisted on every change. */
export function useViewState(id: string): [ViewState, (patch: Partial<ViewState>) => void] {
  const [state, setState] = useState<ViewState>(() => loadViewState(id))
  useEffect(() => {
    saveViewState(id, state)
  }, [id, state])
  const update = useCallback((patch: Partial<ViewState>) => setState((s) => sanitizeView({ ...s, ...patch })), [])
  return [state, update]
}
