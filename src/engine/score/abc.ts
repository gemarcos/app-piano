// Owner: engine-score. Score -> ABC notation for abcjs (grand staff, L:1/16).
import type { Hands, KeySignature, Measure, NoteNaming, Score, ScoreEvent, Staff, TimeSignature } from '../../types'
import { beatTicksOf } from './constants'
import { splitDuration } from './durations'
import { abcKey, normalizeKey } from './keys'
import { pickupTicks, spellingContext, staffVoices, trimLead } from './notes'
import { AccidentalState, choiceOf, pitchClassName, spellChord, type SpellingChoice } from './spelling'

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
  /**
   * Note-name font size in abcjs points (abcjs draws px = round(pt * 4 / 3); its default, 12 pt,
   * dwarfs the notes). Default 8 (11 px). Only used when noteNaming is not 'none'.
   */
  annotationSize?: number
  /** Note-name font family, a CSS font-family list. Default: the app font with sans-serif fallbacks. */
  annotationFont?: string
  /**
   * Name every note, even in fast runs. Default false: in a sixteenth-note beat (a new note on a
   * sixteenth position) only the first new note of the beat is named, so fast passages stay legible
   * (see namedEvents).
   */
  nameEveryNote?: boolean
  /**
   * Pedal marks under the lowest staff from Score.pedals ("Ped." where the damper pedal goes down,
   * "*" where it lifts, "* Ped." for a change), on an invisible voice so the music voices keep their
   * events. Default false; the viewer drives it from Settings.sustainPedal.
   */
  pedalMarks?: boolean
  /**
   * Write measure 0 as a pickup (anacrusis) when it starts with at least a beat of silence in every
   * staff (see pickupTicks): the silent beats are left out of the ABC. Default false (with it, abcjs
   * starts playback and the first elements at the pickup's first note, pickupTicks(score) later than
   * tick 0).
   */
  pickup?: boolean
}

/** Defaults for the note-name annotations (exported for tools and tests). */
export const ABC_ANNOTATION_SIZE = 8
export const ABC_ANNOTATION_FONT = 'Plus Jakarta Sans Variable, Plus Jakarta Sans, system-ui, sans-serif'

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

/**
 * Which events of a measure get a note name. Tie continuations never do. In a sixteenth-note beat
 * (a beat, i.e. a quarter or a dotted quarter in 6/8, where a new note starts on a sixteenth = odd
 * tick, or holding more new notes than eighths) only the first new note is named: the other names
 * would collide in abcjs, which gives annotations no horizontal room. Eighths and slower keep all.
 * `prevTie`: the last event of the previous measure was tied into this one.
 */
export function namedEvents(events: readonly ScoreEvent[], beatTicks: number, prevTie: boolean, every = false): boolean[] {
  const fresh: boolean[] = []
  let tied = prevTie
  for (const ev of events) {
    fresh.push(ev.pitches.length > 0 && !tied)
    tied = ev.pitches.length > 0 && ev.tie === true
  }
  if (every) return fresh
  const named = fresh.slice()
  const perBeat = new Map<number, number[]>()
  events.forEach((ev, i) => {
    if (!fresh[i]) return
    const b = Math.floor(ev.start / beatTicks)
    const list = perBeat.get(b)
    if (list) list.push(i)
    else perBeat.set(b, [i])
  })
  const maxPerBeat = Math.max(1, Math.floor(beatTicks / 2))
  for (const list of perBeat.values()) {
    const dense = list.length > maxPerBeat || list.some((i) => events[i].start % 2 === 1)
    if (dense) for (const i of list.slice(1)) named[i] = false
  }
  return named
}

/** Names under a chord, highest first; more than three notes show only the outer two. */
function chordNames(pitches: number[], naming: NoteNaming, key: KeySignature, context?: SpellingChoice): string {
  const names = [...pitches].sort((a, b) => b - a).map((p) => pitchClassName(p, naming, key, context))
  const shown = names.length > 3 ? [names[0], names[names.length - 1]] : names
  return shown.map((n) => `"_${n}"`).join('')
}

/**
 * One staff with one or two voices. Accidentals follow the engraving rule across the voices of the
 * staff (an accidental in one voice holds for the other until the barline) and abcjs's own rule per
 * voice line, so the sign is printed whenever either needs it. Rests of the second voice are
 * invisible ('x'). At an onset shared by both voices, names go under the first voice only.
 */
class StaffWriter {
  readonly ids: string[]
  readonly clef: 'treble' | 'bass'
  private readonly voices: Measure[][]
  private readonly staffAcc: AccidentalState
  private readonly voiceAcc: AccidentalState[]
  private readonly prevTie: boolean[]
  private readonly lastChoice: (SpellingChoice | undefined)[]

  constructor(
    private readonly score: Score,
    staff: Staff,
    private readonly key: KeySignature,
    private readonly naming: NoteNaming,
    private readonly every: boolean,
    private readonly lead: number,
    private readonly context: (tick: number) => SpellingChoice | undefined,
  ) {
    const id = staff.hand === 'right' ? 'RH' : 'LH'
    this.voices = staffVoices(staff)
    this.ids = this.voices.map((_, v) => (v === 0 ? id : id + '2'))
    this.clef = staff.clef === 'treble' || staff.clef === 'bass' ? staff.clef : staff.hand === 'right' ? 'treble' : 'bass'
    this.staffAcc = new AccidentalState(key)
    this.voiceAcc = this.voices.map(() => new AccidentalState(key))
    this.prevTie = this.voices.map(() => false)
    this.lastChoice = this.voices.map(() => undefined)
  }

  /** The ABC of measure `index`, one string per voice. */
  measure(index: number): string[] {
    const tpm = this.score.ticksPerMeasure
    const ts = this.score.timeSignature
    const beat = beatTicksOf(ts)
    const lead = index === 0 ? this.lead : 0
    const evs = this.voices.map((v) => trimLead(v[index]?.events ?? [{ start: 0, duration: tpm, pitches: [] }], lead, ts))
    // Tie continuations per voice.
    const cont = evs.map((events, v) => {
      let tied = this.prevTie[v]
      return events.map((ev) => {
        const c = tied && ev.pitches.length > 0
        tied = ev.pitches.length > 0 && ev.tie === true
        return c
      })
    })
    // Accidentals, visiting the notes of both voices in time order.
    this.staffAcc.newBar()
    for (const a of this.voiceAcc) a.newBar()
    const signs: string[][][] = evs.map((events) => events.map(() => []))
    const order: [number, number][] = []
    evs.forEach((events, v) => events.forEach((ev, i) => ev.pitches.length && order.push([v, i])))
    order.sort((a, b) => evs[a[0]][a[1]].start - evs[b[0]][b[1]].start || a[0] - b[0])
    const contexts = evs.map((events) => events.map((ev) => this.context(index * tpm + ev.start)))
    for (const [v, i] of order) {
      const ev = evs[v][i]
      const sorted = [...ev.pitches].sort((a, b) => a - b)
      // A tie continuation keeps the letters of its attack (abcjs ties only equal spellings).
      const spelled = spellChord(sorted, this.key, cont[v][i] ? this.lastChoice[v] : contexts[v][i])
      this.lastChoice[v] = choiceOf(sorted, spelled)
      signs[v][i] = spelled.map((sp) => {
        const a = this.staffAcc.visit(sp, cont[v][i])
        const b = this.voiceAcc[v].visit(sp, cont[v][i])
        return (a === null && b === null ? '' : ACCIDENTAL[String(sp.alter)]) + noteLetter(sp.step, sp.octave)
      })
    }
    // Names (thinned per voice; at shared onsets the first voice carries both voices' names).
    const named = evs.map((events, v) => (this.naming === 'none' ? events.map(() => false) : namedEvents(events, beat, this.prevTie[v], this.every)))
    const extra = evs.map((events) => events.map(() => [] as number[]))
    if (evs.length > 1) {
      const first = new Map<number, number>()
      evs[0].forEach((ev, i) => ev.pitches.length && first.set(ev.start, i))
      evs[1].forEach((ev, j) => {
        const i = first.get(ev.start)
        if (!named[1][j] || i === undefined || !named[0][i]) return
        extra[0][i].push(...ev.pitches)
        named[1][j] = false
      })
    }
    return evs.map((events, v) => {
      let line = ''
      events.forEach((ev, i) => {
        let token: string
        if (ev.pitches.length === 0) token = (v === 0 ? 'z' : 'x') + len(ev.duration)
        else {
          const body = signs[v][i].length > 1 ? `[${signs[v][i].join('')}]` : signs[v][i][0]
          const annotation = named[v][i] ? chordNames([...ev.pitches, ...extra[v][i]], this.naming, this.key, contexts[v][i]) : ''
          token = annotation + body + len(ev.duration) + (ev.tie ? '-' : '')
        }
        // Beams break at beats; rests always stand alone.
        const joined = i > 0 && ev.start % beat !== 0 && ev.pitches.length > 0 && events[i - 1].pitches.length > 0
        line += (i === 0 || joined ? '' : ' ') + token
      })
      const last = events[events.length - 1]
      this.prevTie[v] = last !== undefined && last.pitches.length > 0 && last.tie === true
      return line
    })
  }
}

/** Pedal marks of one measure: [tick inside the measure, text], sorted. */
function pedalMarks(score: Score, index: number, lead: number): [number, string][] {
  const tpm = score.ticksPerMeasure
  const total = Math.max(1, score.measureCount) * tpm
  const from = index * tpm
  const marks = new Map<number, string[]>()
  const add = (tick: number, text: string) => {
    // The final release sits on the last sixteenth of the piece.
    const t = tick >= total ? total - 1 : tick
    if (t < from || t >= from + tpm) return
    const rel = Math.max(lead, t - from)
    const list = marks.get(rel) ?? []
    list.push(text)
    marks.set(rel, list)
  }
  const spans = (score.pedals ?? []).filter((s) => s.end > s.start)
  if (pedalThroughout(score)) {
    // Pedal through most of the piece: one "con Ped." where it starts, as published scores do.
    if (spans.length) add(spans[0].start, 'con Ped.')
  } else {
    for (const span of spans) {
      add(span.end, '*')
      add(span.start, 'Ped.')
    }
  }
  return [...marks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, texts]) => [t, texts.includes('*') && texts.includes('Ped.') ? '* Ped.' : texts[0]])
}

/** Share of the score under the pedal from which a single "con Ped." replaces the per-span marks. */
export const PEDAL_THROUGHOUT = 0.6

/** True when the pedal covers most of the score (marks collapse to one "con Ped."). */
export function pedalThroughout(score: Score): boolean {
  const total = Math.max(1, score.measureCount) * score.ticksPerMeasure
  const covered = (score.pedals ?? []).reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0)
  return covered >= PEDAL_THROUGHOUT * total
}

/** The invisible PED voice of a measure: rests carrying "Ped." / "*" annotations below the staff. */
function pedalMeasure(score: Score, index: number, lead: number, afterNames: boolean): string {
  const tpm = score.ticksPerMeasure
  const ts = score.timeSignature
  const marks = pedalMarks(score, index, lead)
  const tokens: string[] = []
  const rest = (from: number, to: number, text?: string) => {
    splitDuration(from, to - from, ts, true).forEach((d, k) => {
      const note = k === 0 && text ? (afterNames ? '"_ "' : '') + `"_${text}"` : ''
      tokens.push(note + 'x' + len(d))
    })
  }
  if (marks.length === 0 || marks[0][0] > lead) rest(lead, marks.length ? marks[0][0] : tpm)
  marks.forEach(([t, text], k) => rest(t, k + 1 < marks.length ? marks[k + 1][0] : tpm, text))
  return tokens.join(' ')
}

/**
 * ABC notation for abcjs: grand staff, L:1/16, key-aware accidentals, ties across barlines, the
 * staff clefs of the Score (a high left hand gets V:LH clef=treble), a second voice per staff where
 * the Score has one (V:RH2 / V:LH2, stems down, sharing the staff: %%score {(RH RH2) | (LH LH2)}),
 * optional pedal marks (an invisible V:PED voice on the lowest staff) and an optional pickup bar.
 * The first voice of each staff (V:RH, V:LH) keeps exactly the events of Staff.measures, in order.
 */
export function scoreToAbc(score: Score, opts: AbcOptions = {}): string {
  const hands: Hands = opts.hands === 'right' || opts.hands === 'left' ? opts.hands : 'both'
  const naming: NoteNaming = opts.noteNaming === 'latin' || opts.noteNaming === 'english' ? opts.noteNaming : 'none'
  const perLine = Math.max(1, Math.min(32, Math.round(Number.isFinite(opts.measuresPerLine) ? opts.measuresPerLine! : 4)))
  const key = normalizeKey(score.key)
  const bpm = score.bpm > 0 && Number.isFinite(score.bpm) ? score.bpm : 100
  const pedals = opts.pedalMarks === true && (score.pedals?.length ?? 0) > 0
  const lead = opts.pickup === true ? pickupTicks(score) : 0
  const lines = ['X:1']
  if (opts.includeTitle && score.title && abcText(score.title)) lines.push(`T:${abcText(score.title)}`)
  lines.push(`M:${score.timeSignature}`, 'L:1/16')
  if (opts.printTempo === false) lines.push('%%printtempo false')
  lines.push(score.timeSignature === '6/8' ? `Q:3/8=${Math.round(bpm / 1.5)}` : `Q:1/4=${Math.round(bpm)}`)
  if (naming !== 'none' || pedals) {
    const size = Number.isFinite(opts.annotationSize) && opts.annotationSize! > 0 ? opts.annotationSize! : ABC_ANNOTATION_SIZE
    const face = (opts.annotationFont ?? ABC_ANNOTATION_FONT).replace(/["\r\n%\\]/g, '').trim() || 'sans-serif'
    lines.push(`%%annotationfont "${face}" ${Math.round(Math.min(40, size) * 10) / 10}`)
  }
  const staves = hands === 'both' ? score.staves : hands === 'right' ? [score.staves[0]] : [score.staves[1]]
  const context = spellingContext(score)
  const writers = staves.map((s) => new StaffWriter(score, s, key, naming, opts.nameEveryNote === true, lead, context))
  const groups = writers.map((w, i) => (pedals && i === writers.length - 1 ? [...w.ids, 'PED'] : w.ids))
  const group = (ids: string[]) => (ids.length > 1 ? `(${ids.join(' ')})` : ids[0])
  if (groups.length === 2) lines.push(`%%score {${group(groups[0])} | ${group(groups[1])}}`)
  else if (groups[0].length > 1) lines.push(`%%score ${group(groups[0])}`)
  writers.forEach((w, i) => {
    for (const id of groups[i]) lines.push(`V:${id} clef=${w.clef}`)
  })
  lines.push(`K:${abcKey(key)}`, '%%MIDI program 0')
  const count = Math.max(1, score.measureCount)
  for (let m0 = 0; m0 < count; m0 += perLine) {
    const m1 = Math.min(count, m0 + perLine)
    const bars = writers.map((w) => w.ids.map(() => [] as string[]))
    const ped: string[] = []
    for (let m = m0; m < m1; m++) {
      writers.forEach((w, i) => w.measure(m).forEach((text, v) => bars[i][v].push(text)))
      if (pedals) ped.push(pedalMeasure(score, m, m === 0 ? lead : 0, naming !== 'none'))
    }
    const end = m1 >= count ? '|]' : '|'
    writers.forEach((w, i) => {
      w.ids.forEach((id, v) => lines.push(`[V:${id}] ${bars[i][v].join(' | ')} ${end}`))
      if (pedals && i === writers.length - 1) lines.push(`[V:PED] ${ped.join(' | ')} ${end}`)
    })
  }
  return lines.join('\n') + '\n'
}

/**
 * Measures per system that keep a score legible in `width` abcjs units (about CSS px at zoom 1;
 * pass the zoom to scale). A measure needs about 16 units per event plus 6 per drawn note name
 * (names thinned as in namedEvents) plus 10; the busiest bars decide (90th percentile, busier
 * staff), after 40 units for clef and key. Sixteenth-note pieces get one bar per line on a phone,
 * plain melodies two or three.
 */
export function suggestMeasuresPerLine(
  score: Score,
  width: number,
  opts: { zoom?: number; noteNames?: boolean; nameEveryNote?: boolean } = {},
): number {
  const zoom = Number.isFinite(opts.zoom) && opts.zoom! > 0 ? opts.zoom! : 1
  const beat = beatTicksOf(score.timeSignature)
  const widths: number[] = []
  const voices = score.staves.map((staff) => staffVoices(staff))
  const prevTie = voices.map((vs) => vs.map(() => false))
  for (let m = 0; m < score.measureCount; m++) {
    let w = 0
    voices.forEach((vs, si) => {
      // Voices of a staff share horizontal space: count the distinct positions and the names.
      const starts = new Set<number>()
      let names = 0
      vs.forEach((measures, vi) => {
        const events = measures[m]?.events ?? []
        for (const ev of events) if (vi === 0 || ev.pitches.length) starts.add(ev.start)
        if (opts.noteNames) names += namedEvents(events, beat, prevTie[si][vi], opts.nameEveryNote === true).filter(Boolean).length
        const last = events[events.length - 1]
        prevTie[si][vi] = last !== undefined && last.pitches.length > 0 && last.tie === true
      })
      w = Math.max(w, Math.max(1, starts.size) * 16 + names * 6 + 10)
    })
    widths.push(w)
  }
  widths.sort((a, b) => a - b)
  const busy = widths.length ? widths[Math.min(widths.length - 1, Math.floor(0.9 * widths.length))] : 26
  const usable = (Number.isFinite(width) ? width : 330) / zoom - 40
  return Math.max(1, Math.min(8, Math.floor(usable / busy)))
}
