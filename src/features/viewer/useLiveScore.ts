// Owner: viewer. ScoreParams edited live: every change rebuilds the score from the raw notes
// (buildScore is a few ms) after a short debounce for slider drags, and is saved to the library
// (params + summary) a little later. Raw notes and analysis are read once per item, so our own
// saves echoing back through the live query never trigger rebuilds.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScoreDoc, ScoreParams } from '../../types'
import { buildScore, defaultParams, sanitizeParams, summarizeScore } from '../../engine/score'
import { demoParams, findDemo } from '../../data/demos'
import { updateScore } from '../../data/db'
import { getSettings } from '../../state/settings'

/** The value, `ms` after it stopped changing. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (Object.is(settled, value)) return
    const timer = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms, settled])
  return settled
}

/**
 * Params a "Restablecer" goes back to. Demos: exactly what the seed stores (their split point, the
 * 1/16 grid their exact sixteenths need, 'original'); other items: the defaults for their analysis.
 */
export function initialParams(doc: Pick<ScoreDoc, 'id' | 'analysis'>): ScoreParams {
  const settings = getSettings()
  const demo = findDemo(doc.id)
  return demo ? { ...demoParams(demo, settings), quantize: 16, difficulty: 'original' } : defaultParams(doc.analysis, settings)
}

const FILTER_KEYS = ['minVelocity', 'minDuration', 'pitchRange', 'maxPolyphony', 'quantize'] as const

export function useLiveScore(doc: ScoreDoc) {
  const id = doc.id
  // Raw data never changes in the viewer: keep the first copy of this item.
  const [base] = useState(() => ({ notes: doc.notes, analysis: doc.analysis }))
  const [params, setParams] = useState<ScoreParams>(() => sanitizeParams(doc.params, doc.analysis))
  const built = useDebounced(params, 120)
  const score = useMemo(() => buildScore(base.notes, built, base.analysis), [base, built])

  // Debounced save; a pending save is flushed when the viewer closes.
  const saved = useRef(JSON.stringify(sanitizeParams(doc.params, doc.analysis)))
  const pending = useRef<(() => void) | null>(null)
  useEffect(() => {
    const json = JSON.stringify(built)
    if (json === saved.current) {
      // Back to what is stored (e.g. +1 then -1): drop the save scheduled for the intermediate value,
      // or the flush on close would persist it.
      pending.current = null
      return
    }
    const write = () => {
      pending.current = null
      saved.current = json
      updateScore(id, { params: built, summary: summarizeScore(score) }).catch((err) => console.warn('[viewer] save', err))
    }
    pending.current = write
    const timer = window.setTimeout(write, 600)
    return () => window.clearTimeout(timer)
  }, [id, built, score])
  useEffect(() => () => pending.current?.(), [])

  const patch = useCallback(
    (values: Partial<ScoreParams>) => setParams((p) => sanitizeParams({ ...p, ...values }, base.analysis)),
    [base],
  )
  const reset = useCallback(() => setParams(sanitizeParams(initialParams({ id, analysis: base.analysis }), base.analysis)), [id, base])
  const resetFilters = useCallback(() => {
    const d = initialParams({ id, analysis: base.analysis })
    setParams((p) => {
      const next = { ...p }
      for (const key of FILTER_KEYS) (next as Record<string, unknown>)[key] = d[key]
      return sanitizeParams(next, base.analysis)
    })
  }, [id, base])

  return { params, patch, reset, resetFilters, score, analysis: base.analysis }
}
