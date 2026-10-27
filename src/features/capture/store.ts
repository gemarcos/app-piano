// Owner: capture. What is being transcribed, handed from Home / Record / Import to Processing.
// Not persisted: a decoded AudioBuffer cannot be stored, and a reload simply sends the user back to Home.
import { create } from 'zustand'
import type { DecodedMedia } from '../../engine/audio'

export type CaptureSource = 'mic' | 'tab' | 'file'

export interface CaptureRange {
  /** Seconds of the decoded media. */
  start: number
  end: number
}

/** Library details decided before Processing (a take from a shared link: its title and the link). */
export interface CaptureMeta {
  /** Title of the new item (default: the file name, or 'Grabación <fecha>'). */
  title?: string
  /** Stored as the item's sourceName (default: the imported file name). */
  sourceName?: string
  /** "Reintentar" after no notes goes back in history to the screen that made the take, not to a new take on /listen. */
  retryBack?: boolean
}

export interface CaptureState {
  source: CaptureSource | null
  /** The imported file, or the recording (mic/tab, only when settings.keepOriginalAudio). */
  blob: Blob | null
  /** File name for imports ('' for recordings). */
  name: string
  mime: string
  kind: 'audio' | 'video'
  decoded: DecodedMedia | null
  /** Part of `decoded` to transcribe. */
  range: CaptureRange | null
  /** Set by recordings that know more about themselves (share flow); null otherwise. */
  meta: CaptureMeta | null
  setFile: (file: Blob, decoded: DecodedMedia, range: CaptureRange) => void
  setRecording: (source: 'mic' | 'tab', decoded: DecodedMedia, blob: Blob | null, meta?: CaptureMeta) => void
  setRange: (range: CaptureRange) => void
  reset: () => void
}

const EMPTY = {
  source: null,
  blob: null,
  name: '',
  mime: '',
  kind: 'audio',
  decoded: null,
  range: null,
  meta: null,
} as const satisfies Partial<CaptureState>

export const useCaptureStore = create<CaptureState>()((set) => ({
  ...EMPTY,
  setFile: (file, decoded, range) =>
    set({ source: 'file', blob: file, name: decoded.name, mime: decoded.mime, kind: decoded.kind, decoded, range, meta: null }),
  setRecording: (source, decoded, blob, meta) =>
    set({
      source,
      blob,
      name: '',
      mime: blob?.type || decoded.mime,
      kind: 'audio',
      decoded,
      range: { start: 0, end: decoded.duration },
      meta: meta ?? null,
    }),
  setRange: (range) => set({ range }),
  reset: () => set({ ...EMPTY }),
}))

/** Non-reactive snapshot (for effects that must read the capture once, e.g. on mount). */
export function getCapture(): CaptureState {
  return useCaptureStore.getState()
}
