// Owner: library. Library item -> MusicXML / MIDI / ABC file (engine exporters, no DOM besides Blob).
import type { Score, ScoreDoc } from '../../types'
import { buildScore, sanitizeParams, scoreToAbc, scoreToMidi, scoreToMusicXml } from '../../engine/score'
import { MIME, safeFileName } from '../../lib/download'

export type ExportFormat = 'musicxml' | 'midi' | 'abc'

export const EXPORT_FORMATS: readonly { format: ExportFormat; label: string }[] = [
  { format: 'musicxml', label: 'MusicXML' },
  { format: 'midi', label: 'MIDI' },
  { format: 'abc', label: 'ABC' },
]

const EXTENSION: Record<ExportFormat, string> = { musicxml: '.musicxml', midi: '.mid', abc: '.abc' }

/** The score exactly as the viewer shows it by default: stored params (repaired if needed) over the raw notes. */
export function scoreOfDoc(doc: Pick<ScoreDoc, 'notes' | 'params' | 'analysis' | 'title'>): Score {
  return buildScore(doc.notes, sanitizeParams(doc.params, doc.analysis), doc.analysis, doc.title)
}

export interface ExportFile {
  blob: Blob
  fileName: string
}

/** Builds the file for one format. ABC carries the title and no note names (plain notation). */
export function exportFile(doc: Pick<ScoreDoc, 'notes' | 'params' | 'analysis' | 'title'>, format: ExportFormat): ExportFile {
  const score = scoreOfDoc(doc)
  const fileName = safeFileName(doc.title) + EXTENSION[format]
  switch (format) {
    case 'musicxml':
      return { blob: new Blob([scoreToMusicXml(score)], { type: MIME.musicxml }), fileName }
    case 'midi': {
      // Copy into a plain ArrayBuffer-backed view (BlobPart does not accept shared buffers).
      const bytes = new Uint8Array(scoreToMidi(score))
      return { blob: new Blob([bytes], { type: MIME.midi }), fileName }
    }
    default:
      return { blob: new Blob([scoreToAbc(score, { includeTitle: true, noteNaming: 'none' })], { type: MIME.abc }), fileName }
  }
}
