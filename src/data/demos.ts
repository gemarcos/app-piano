// Owner: engine-score. Public-domain demo pieces expressed as raw NoteEvent[] so they go through
// the same analysis/notation pipeline (and filters) as real transcriptions.
import type { AnalysisResult, KeySignature, Midi, NoteEvent, ScoreParams, Settings, TimeSignature } from '../types'
import { analyzeNotes, defaultParams, keyFromFifths, ticksPerMeasureOf } from '../engine/score'

export interface DemoPiece {
  /** Stable id, also used as the library item id (prefixed 'demo-'). */
  slug: string
  title: string
  composer: string
  bpm: number
  timeSignature: TimeSignature
  notes: NoteEvent[]
  /** Key of the piece (short excerpts can fool the key finder). */
  key?: KeySignature
  /** Split point that keeps each written hand on its own staff (default: the user's setting). */
  splitPoint?: Midi
}

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** 'F#4' -> 66, 'Bb3' -> 58 (C4 = 60). */
export function parsePitch(name: string): Midi {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name)
  if (!m) throw new Error(`Bad pitch: ${name}`)
  return (Number(m[3]) + 1) * 12 + LETTER_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
}

interface VoiceOptions {
  bpm: number
  timeSignature: TimeSignature
  /** Added to the metric velocity (left hand a little softer). */
  level?: number
  /** Tick where the voice starts. */
  offset?: number
}

/**
 * Compact score text -> NoteEvent[]. Tokens are `pitch[+pitch...]:sixteenths` or `r:sixteenths`;
 * '|' marks barlines (ignored, for readability). Example: `G3+B3+D4:8 A3:4 | B3:12`.
 */
export function voice(src: string, opts: VoiceOptions): NoteEvent[] {
  const tick = 60 / opts.bpm / 4
  const bar = ticksPerMeasureOf(opts.timeSignature)
  const beat = opts.timeSignature === '6/8' ? 6 : 4
  const out: NoteEvent[] = []
  let t = opts.offset ?? 0
  for (const token of src.split(/\s+/)) {
    if (!token || token === '|') continue
    const [head, len] = token.split(':')
    const ticks = Number(len)
    if (head !== 'r') {
      const pos = t % bar
      const metric = pos === 0 ? 0.86 : pos % beat === 0 ? 0.76 : 0.68
      const velocity = Math.min(0.9, Math.max(0.6, metric + (opts.level ?? 0)))
      for (const p of head.split('+')) {
        out.push({ pitch: parsePitch(p), start: round6(t * tick), duration: round6(ticks * tick), velocity })
      }
    }
    t += ticks
  }
  return out
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6

function merge(...voices: NoteEvent[][]): NoteEvent[] {
  return voices.flat().sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}

// L. van Beethoven, Symphony No. 9, finale theme ("Ode to Joy"), in G major (school key) with a
// simple left hand of open fifths.
const ODE_BPM = 100
const ode: DemoPiece = {
  slug: 'oda-alegria',
  title: 'Oda a la alegría',
  composer: 'L. van Beethoven',
  bpm: ODE_BPM,
  timeSignature: '4/4',
  key: keyFromFifths(1, 'major'),
  splitPoint: 60,
  notes: merge(
    voice(
      `B4:4 B4:4 C5:4 D5:4 | D5:4 C5:4 B4:4 A4:4 | G4:4 G4:4 A4:4 B4:4 | B4:6 A4:2 A4:8 |
       B4:4 B4:4 C5:4 D5:4 | D5:4 C5:4 B4:4 A4:4 | G4:4 G4:4 A4:4 B4:4 | A4:6 G4:2 G4:8 |
       A4:4 A4:4 B4:4 G4:4 | A4:4 B4:2 C5:2 B4:4 G4:4 | A4:4 B4:2 C5:2 B4:4 A4:4 | G4:4 A4:4 D4:8 |
       B4:4 B4:4 C5:4 D5:4 | D5:4 C5:4 B4:4 A4:4 | G4:4 G4:4 A4:4 B4:4 | A4:6 G4:2 G4:8`,
      { bpm: ODE_BPM, timeSignature: '4/4' },
    ),
    voice(
      `G2+D3:16 | D3+A3:16 | G2+D3:16 | G2+D3:8 D3+A3:8 |
       G2+D3:16 | D3+A3:16 | G2+D3:16 | D3+A3:8 G2+D3:8 |
       D3+A3:8 G2+D3:8 | D3+A3:8 G2+D3:8 | D3+A3:8 G2+D3:8 | G2+D3:8 D3+A3:8 |
       G2+D3:16 | D3+A3:16 | G2+D3:16 | D3+A3:8 G2+D3:8`,
      { bpm: ODE_BPM, timeSignature: '4/4', level: -0.12 },
    ),
  ),
}

// C. Petzold, Minuet in G major, BWV Anh. 114 (Notebook for Anna Magdalena Bach), bars 1-16,
// after the Bach-Gesellschaft text (ornaments omitted).
const MINUET_BPM = 112
const minuet: DemoPiece = {
  slug: 'minueto-sol',
  title: 'Minueto en Sol mayor',
  composer: 'C. Petzold',
  bpm: MINUET_BPM,
  timeSignature: '3/4',
  key: keyFromFifths(1, 'major'),
  splitPoint: 64,
  notes: merge(
    voice(
      `D5:4 G4:2 A4:2 B4:2 C5:2 | D5:4 G4:4 G4:4 | E5:4 C5:2 D5:2 E5:2 F#5:2 | G5:4 G4:4 G4:4 |
       C5:4 D5:2 C5:2 B4:2 A4:2 | B4:4 C5:2 B4:2 A4:2 G4:2 | F#4:4 G4:2 A4:2 B4:2 G4:2 | A4:12 |
       D5:4 G4:2 A4:2 B4:2 C5:2 | D5:4 G4:4 G4:4 | E5:4 C5:2 D5:2 E5:2 F#5:2 | G5:4 G4:4 G4:4 |
       C5:4 D5:2 C5:2 B4:2 A4:2 | B4:4 C5:2 B4:2 A4:2 G4:2 | A4:4 B4:2 A4:2 G4:2 F#4:2 | G4:12`,
      { bpm: MINUET_BPM, timeSignature: '3/4' },
    ),
    voice(
      `G3+B3+D4:8 A3:4 | B3:12 | C4:12 | B3:12 | A3:12 | G3:12 | D4:4 B3:4 G3:4 | D4:4 D3:2 C4:2 B3:2 A3:2 |
       B3:8 A3:4 | G3:4 B3:4 G3:4 | C4:12 | B3:4 C4:2 B3:2 A3:2 G3:2 | A3:8 F#3:4 | G3:8 B3:4 | C4:4 D4:4 D3:4 | G3:8 G2:4`,
      { bpm: MINUET_BPM, timeSignature: '3/4', level: -0.1 },
    ),
  ),
}

// J. S. Bach, Prelude in C major, BWV 846 (Well-Tempered Clavier I), bars 1-8. Every half bar:
// left hand holds the bass (half note) and the second note (from the second sixteenth); the right
// hand plays the three upper notes twice in sixteenths after an eighth rest.
// No single split point reproduces Bach's hands (E4 is a left-hand note in bars 1, 4 and 5 and a
// right-hand one in bar 8). Split 62 keeps the bass as half notes on the lower staff in bars 1-7,
// with the second note leading the upper figure, and gives bar 8 exactly as written.
const PRELUDE_BPM = 66
const PRELUDE_BARS = [
  'C4 E4 G4 C5 E5',
  'C4 D4 A4 D5 F5',
  'B3 D4 G4 D5 F5',
  'C4 E4 G4 C5 E5',
  'C4 E4 A4 E5 A5',
  'C4 D4 F#4 A4 D5',
  'B3 D4 G4 D5 G5',
  'B3 C4 E4 G4 C5',
]
const preludeHalf = (chord: string) => {
  const [b1, b2, r1, r2, r3] = chord.split(' ')
  return {
    bass: `${b1}:8`,
    second: `r:1 ${b2}:7`,
    upper: `r:2 ${r1}:1 ${r2}:1 ${r3}:1 ${r1}:1 ${r2}:1 ${r3}:1`,
  }
}
const preludeVoice = (part: 'bass' | 'second' | 'upper', level: number) =>
  voice(
    PRELUDE_BARS.map((c) => {
      const h = preludeHalf(c)
      return `${h[part]} ${h[part]} |`
    }).join(' '),
    { bpm: PRELUDE_BPM, timeSignature: '4/4', level },
  )
const prelude: DemoPiece = {
  slug: 'preludio-do',
  title: 'Preludio en Do mayor',
  composer: 'J. S. Bach',
  bpm: PRELUDE_BPM,
  timeSignature: '4/4',
  key: keyFromFifths(0, 'major'),
  splitPoint: 62,
  notes: merge(preludeVoice('bass', -0.06), preludeVoice('second', -0.12), preludeVoice('upper', -0.04)),
}

export const demoPieces: DemoPiece[] = [ode, minuet, prelude]

/** Library item ids of the demos are DEMO_ID_PREFIX + slug ('demo-oda-alegria'). */
export const DEMO_ID_PREFIX = 'demo-'

/** The demo behind a library id ('demo-minueto-sol') or a slug ('minueto-sol'), if any. */
export function findDemo(idOrSlug: string): DemoPiece | undefined {
  const slug = typeof idOrSlug === 'string' && idOrSlug.startsWith(DEMO_ID_PREFIX) ? idOrSlug.slice(DEMO_ID_PREFIX.length) : idOrSlug
  return demoPieces.find((d) => d.slug === slug)
}

/** Analysis for a demo: its known tempo, meter and key, first downbeat at 0 s. */
export function demoAnalysis(demo: DemoPiece): AnalysisResult {
  const detected = analyzeNotes(demo.notes)
  return {
    ...detected,
    bpm: demo.bpm,
    bpmConfidence: 1,
    beatOffset: 0,
    timeSignature: demo.timeSignature,
    key: demo.key ?? detected.key,
    keyConfidence: demo.key ? 1 : detected.keyConfidence,
  }
}

/** Params for a demo: the user's defaults plus the demo's split point. */
export function demoParams(
  demo: DemoPiece,
  settings: Pick<Settings, 'quantize' | 'splitPoint' | 'defaultDifficulty'>,
): ScoreParams {
  const params = defaultParams(demoAnalysis(demo), settings)
  return demo.splitPoint !== undefined ? { ...params, splitPoint: demo.splitPoint } : params
}
