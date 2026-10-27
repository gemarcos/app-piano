// Owner: viewer. Exports of the score as it is now in the viewer.
// MusicXML / MIDI / ABC reuse the library's tested exportFile (same file names and MIME types in
// both screens), fed with the viewer's live params; the PDF goes through the print dialog.
import type { Hands, NoteNaming, Score, ScoreDoc, ScoreParams } from '../../types'
import { scoreToAbc, suggestMeasuresPerLine } from '../../engine/score'
import { safeFileName, shareOrDownload } from '../../lib/download'
import { exportFile, type ExportFormat } from '../library/exports'
import { loadAbcjs } from './abcjs'
import { balancedPerLine, scoreForHands } from './timeline'
import './print.css'

export type ExportResult = 'shared' | 'downloaded' | 'cancelled'
export type { ExportFormat }

export const FORMAT_LABEL: Record<ExportFormat, string> = { musicxml: 'MusicXML', midi: 'MIDI', abc: 'ABC' }

/** Shares (or downloads) one format of the item with the given params. */
export function shareExport(doc: Pick<ScoreDoc, 'notes' | 'analysis' | 'title'>, params: ScoreParams, format: ExportFormat): Promise<ExportResult> {
  const { blob, fileName } = exportFile({ ...doc, params }, format)
  return shareOrDownload(blob, fileName, doc.title)
}

/** Printable width of the score in abcjs units (A4 portrait with 15 mm margins at 96 dpi). */
const PRINT_WIDTH = 680

/**
 * PDF through the browser's print dialog: a print-only sheet (white paper, black ink, title and
 * composer) rendered next to the app, which the print stylesheet hides.
 */
export async function printScore(
  score: Score,
  opts: { title: string; composer?: string; hands: Hands; naming: NoteNaming; pedalMarks?: boolean },
): Promise<void> {
  const abcjs = await loadAbcjs()
  document.querySelectorAll('.vw-print').forEach((n) => n.remove())
  const sheet = document.createElement('div')
  sheet.className = 'vw-print'
  sheet.setAttribute('aria-hidden', 'true')
  const header = document.createElement('header')
  const h1 = document.createElement('h1')
  h1.textContent = opts.title
  header.append(h1)
  if (opts.composer) {
    const p = document.createElement('p')
    p.textContent = opts.composer
    header.append(p)
  }
  const target = document.createElement('div')
  sheet.append(header, target)
  document.body.append(sheet)

  const fit = Math.min(6, suggestMeasuresPerLine(scoreForHands(score, opts.hands), PRINT_WIDTH, { noteNames: opts.naming !== 'none' }))
  const perLine = balancedPerLine(score.measureCount, fit)
  const abc = scoreToAbc(score, { hands: opts.hands, noteNaming: opts.naming, measuresPerLine: perLine, printTempo: true, pedalMarks: opts.pedalMarks })
  // One SVG per system, so page breaks fall between systems instead of through them.
  abcjs.renderAbc(target, abc, {
    responsive: 'resize',
    oneSvgPerLine: true,
    foregroundColor: 'currentColor',
    staffwidth: PRINT_WIDTH,
    paddingtop: 0,
    paddingbottom: 0,
    paddingleft: 0,
    paddingright: 12,
  })

  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup)
    sheet.remove()
  }
  window.addEventListener('afterprint', cleanup)
  // Let the browser lay the sheet out before the dialog snapshots the page.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const title = document.title
  // Chrome names the saved PDF after the page title.
  document.title = safeFileName(opts.title)
  try {
    window.print()
  } finally {
    document.title = title
    // Some browsers never fire afterprint: drop the sheet a bit later anyway.
    window.setTimeout(cleanup, 60_000)
  }
}
