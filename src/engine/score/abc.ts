// Owner: engine-score. Score -> ABC notation for abcjs (grand staff, L:1/16).
import type { Hands, KeySignature, NoteNaming, Score, ScoreEvent, Staff } from '../../types'
import { beatTicksOf } from './constants'
import { abcKey, normalizeKey } from './keys'
import { AccidentalState, pitchClassName, spellPitch } from './spelling'

export interface AbcOptions {
  /** Which staves to include (display and playback). Default 'both'. */
  hands?: Hands
  /** Note-name annotations under the notes. Default 'none'. */
  noteNaming?: NoteNaming
  /** Include the T: title line. Default false (the viewer shows the title itself). */
  includeTitle?: boolean
  /** Measures per system (line). Default 4. */
  measuresPerLine?: number
  /** Print the tempo mark above the first system (playback tempo is always set). Default true. */
  printTempo?: boolean
}

const ACCIDENTAL: Record<string, string> = { '-2': '__', '-1': '_', '0': '=', '1': '^', '2': '^^' }

/** Header text: no line breaks, no comment marker. */
function abcText(text: string): string {
  return text.replace(/[\r\n\t]+/g, ' ').replace(/\\/g, '').replace(/%/g, '\\%').trim()
}

function noteLetter(step: string, octave: number): string {
  if (octave >= 5) return step.toLowerCase() + "'".repeat(octave - 5)
  return step + ','.repeat(Math.max(0, 4 - octave))
}

const len = (ticks: number) => (ticks === 1 ? '' : String(ticks))

class StaffWriter {
  readonly id: string
  private readonly acc: AccidentalState
  private prevTie = false

  constructor(
    private readonly score: Score,
    private readonly staff: Staff,
    private readonly key: KeySignature,
    private readonly naming: NoteNaming,
  ) {
    this.id = staff.hand === 'right' ? 'RH' : 'LH'
    this.acc = new AccidentalState(key)
  }

  measure(index: number): string {
    const tpm = this.score.ticksPerMeasure
    const events: ScoreEvent[] = this.staff.measures[index]?.events ?? [{ start: 0, duration: tpm, pitches: [] }]
    const beat = beatTicksOf(this.score.timeSignature)
    this.acc.newBar()
    let out = ''
    events.forEach((ev, i) => {
      const token = this.event(ev)
      // Beams break at beats; rests always stand alone.
      const joined = i > 0 && ev.start % beat !== 0 && ev.pitches.length > 0 && events[i - 1].pitches.length > 0
      out += (i === 0 || joined ? '' : ' ') + token
    })
    return out
  }

  private event(ev: ScoreEvent): string {
    const continuation = this.prevTie && ev.pitches.length > 0
    const overBarline = continuation && ev.start === 0
    this.prevTie = ev.pitches.length > 0 && ev.tie === true
    if (ev.pitches.length === 0) return 'z' + len(ev.duration)
    const pitches = [...ev.pitches].sort((a, b) => a - b)
    const notes = pitches.map((p) => {
      const sp = spellPitch(p, this.key)
      const alter = this.acc.visit(sp, overBarline)
      return (alter === null ? '' : ACCIDENTAL[String(alter)]) + noteLetter(sp.step, sp.octave)
    })
    let annotation = ''
    if (this.naming !== 'none' && !continuation) {
      const names = [...pitches].reverse().map((p) => pitchClassName(p, this.naming, this.key))
      const shown = names.length > 3 ? [names[0], names[names.length - 1]] : names
      annotation = shown.map((n) => `"_${n}"`).join('')
    }
    const body = notes.length > 1 ? `[${notes.join('')}]` : notes[0]
    return annotation + body + len(ev.duration) + (ev.tie ? '-' : '')
  }
}

/** ABC notation for abcjs (grand staff, L:1/16, correct key-aware accidentals, ties across barlines). */
export function scoreToAbc(score: Score, opts: AbcOptions = {}): string {
  const hands: Hands = opts.hands === 'right' || opts.hands === 'left' ? opts.hands : 'both'
  const naming: NoteNaming = opts.noteNaming === 'latin' || opts.noteNaming === 'english' ? opts.noteNaming : 'none'
  const perLine = Math.max(1, Math.min(32, Math.round(Number.isFinite(opts.measuresPerLine) ? opts.measuresPerLine! : 4)))
  const key = normalizeKey(score.key)
  const bpm = score.bpm > 0 && Number.isFinite(score.bpm) ? score.bpm : 100
  const lines = ['X:1']
  if (opts.includeTitle && score.title && abcText(score.title)) lines.push(`T:${abcText(score.title)}`)
  lines.push(`M:${score.timeSignature}`, 'L:1/16')
  if (opts.printTempo === false) lines.push('%%printtempo false')
  lines.push(score.timeSignature === '6/8' ? `Q:3/8=${Math.round(bpm / 1.5)}` : `Q:1/4=${Math.round(bpm)}`)
  const staves = hands === 'both' ? score.staves : hands === 'right' ? [score.staves[0]] : [score.staves[1]]
  if (staves.length === 2) lines.push('%%score {RH | LH}')
  const writers = staves.map((s) => new StaffWriter(score, s, key, naming))
  for (const w of writers) lines.push(`V:${w.id} clef=${w.id === 'RH' ? 'treble' : 'bass'}`)
  lines.push(`K:${abcKey(key)}`, '%%MIDI program 0')
  const count = Math.max(1, score.measureCount)
  for (let m0 = 0; m0 < count; m0 += perLine) {
    const m1 = Math.min(count, m0 + perLine)
    for (const w of writers) {
      const bars: string[] = []
      for (let m = m0; m < m1; m++) bars.push(w.measure(m))
      lines.push(`[V:${w.id}] ${bars.join(' | ')} ${m1 >= count ? '|]' : '|'}`)
    }
  }
  return lines.join('\n') + '\n'
}
