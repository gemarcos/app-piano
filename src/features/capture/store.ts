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
  setFile: (file: Blob, decoded: DecodedMedia, range: CaptureRange) => void
  setRecording: (source: 'mic' | 'tab', decoded: DecodedMedia, blob: Blob | null) => void
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
} as const satisfies Partial<CaptureState>

export const useCaptureStore = create<CaptureState>()((set) => ({
  ...EMPTY,
  setFile: (file, decoded, range) =>
    set({ source: 'file', blob: file, name: decoded.name, mime: decoded.mime, kind: decoded.kind, decoded, range }),
  setRecording: (source, decoded, blob) =>
    set({
      source,
      blob,
      name: '',
      mime: blob?.type || decoded.mime,
      kind: 'audio',
      decoded,
      range: { start: 0, end: decoded.duration },
    }),
  setRange: (range) => set({ range }),
  reset: () => set({ ...EMPTY }),
}))

/** Non-reactive snapshot (for effects that must read the capture once, e.g. on mount). */
export function getCapture(): CaptureState {
  return useCaptureStore.getState()
}
