// Owner: engine-score. Score -> MusicXML 4.0 partwise (one piano part, two staves).
import type { Score, ScoreEvent } from '../../types'
import { SIXTEENTH, TICKS_PER_QUARTER, beatTicksOf, meterParts } from './constants'
import { isTripletEdge } from './durations'
import { normalizeKey } from './keys'
import { pickupTicks, spellingContext, staffVoices, trimLead } from './notes'
import { AccidentalState, choiceOf, spellChord, type SpelledPitch, type SpellingChoice } from './spelling'

const TYPES: Record<number, [string, number]> = {
  1: ['16th', 0],
  2: ['eighth', 0],
  3: ['eighth', 1],
  4: ['quarter', 0],
  6: ['quarter', 1],
  8: ['half', 0],
  12: ['half', 1],
  16: ['whole', 0],
}
const ACCIDENTALS: Record<string, string> = {
  '-2': 'flat-flat',
  '-1': 'flat',
  '0': 'natural',
  '1': 'sharp',
  '2': 'double-sharp',
}

export function xmlEscape(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Written type of a tuplet event by its length in ticks (sixteenth-triplet units of 2). */
const TUPLET_TYPES: Record<number, [string, number]> = {
  2: ['16th', 0],
  4: ['eighth', 0],
  6: ['eighth', 1],
  8: ['quarter', 0],
  12: ['quarter', 1],
}

/** Per event: 0 = straight, 3 = eighth-triplet beat, 6 = sixteenth-sextuplet beat (as in the ABC writer). */
function tupletKinds(events: readonly ScoreEvent[]): number[] {
  const out = events.map(() => 0)
  const beats = new Map<number, number[]>()
  events.forEach((ev, i) => {
    const b = Math.floor(ev.start / TICKS_PER_QUARTER)
    beats.set(b, [...(beats.get(b) ?? []), i])
  })
  for (const list of beats.values()) {
    if (!list.some((i) => isTripletEdge(events[i].start) || isTripletEdge(events[i].start + events[i].duration))) continue
    const kind = list.every((i) => events[i].duration % 4 === 0 && events[i].start % 4 === 0) ? 3 : 6
    for (const i of list) out[i] = kind
  }
  return out
}

/** Beam values (levels 1 and 2) for each event of a measure, grouping by beat. */
function beams(events: ScoreEvent[], beat: number): string[][] {
  const out: string[][] = events.map(() => [])
  let i = 0
  while (i < events.length) {
    const beamable = (e: ScoreEvent) => e.pitches.length > 0 && e.duration < TICKS_PER_QUARTER
    if (!beamable(events[i])) {
      i++
      continue
    }
    const group = [i]
    const beatIndex = Math.floor(events[i].start / beat)
    let j = i + 1
    while (j < events.length && beamable(events[j]) && Math.floor(events[j].start / beat) === beatIndex) group.push(j++)
    if (group.length > 1) {
      group.forEach((g, n) => out[g].push(n === 0 ? 'begin' : n === group.length - 1 ? 'end' : 'continue'))
      // Second beam for sixteenths: runs share it, lone ones get a hook.
      let k = 0
      while (k < group.length) {
        if (events[group[k]].duration > SIXTEENTH) {
          k++
          continue
        }
        let r = k
        while (r + 1 < group.length && events[group[r + 1]].duration <= SIXTEENTH) r++
        if (r === k) out[group[k]].push(k === 0 ? 'forward hook' : 'backward hook')
        else for (let x = k; x <= r; x++) out[group[x]].push(x === k ? 'begin' : x === r ? 'end' : 'continue')
        k = r + 1
      }
    }
    i = j
  }
  return out
}

export interface MusicXmlOptions {
  /**
   * Write measure 0 as an implicit pickup measure (number 0, shorter) when it starts with at least a
   * beat of silence in every staff (see pickupTicks). Default true.
   */
  pickup?: boolean
}

const CLEF_SIGN: Record<'treble' | 'bass', string> = { treble: '<sign>G</sign><line>2</line>', bass: '<sign>F</sign><line>4</line>' }

/** Pedal directions of one measure (staff 2), positioned with <offset> from the written measure start. */
function pedalDirections(score: Score, index: number, lead: number, div: number): string[] {
  const tpm = score.ticksPerMeasure
  const from = index * tpm
  const last = index === Math.max(1, score.measureCount) - 1
  const out: [number, number, string][] = []
  for (const span of score.pedals ?? []) {
    if (!(span.end > span.start)) continue
    const marks: [number, 'start' | 'stop'][] = [
      [span.end, 'stop'],
      [span.start, 'start'],
    ]
    for (const [tick, type] of marks) {
      const rel = tick - from
      if (rel < 0 || rel > tpm || (rel === tpm && !last)) continue
      const at = Math.max(0, rel - lead)
      const offset = at > 0 ? `<offset sound="yes">${Math.round((at * div) / TICKS_PER_QUARTER)}</offset>` : ''
      out.push([
        at,
        type === 'stop' ? 0 : 1,
        `      <direction placement="below"><direction-type><pedal type="${type}" line="no" sign="yes"/></direction-type>${offset}<staff>2</staff><sound damper-pedal="${type === 'start' ? 'yes' : 'no'}"/></direction>`,
      ])
    }
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((d) => d[2])
}

/**
 * MusicXML 4.0 partwise document (one piano part, two staves). Each staff writes one or two voices
 * (voices 1/2 on the upper staff, 5/6 on the lower; the second voice has stems down and hidden
 * rests), the staff clefs of the Score, pedal marks with damper-pedal sound from Score.pedals, and
 * an implicit pickup measure when the music starts after the first beat.
 */
export function scoreToMusicXml(score: Score, opts: MusicXmlOptions = {}): string {
  const key = normalizeKey(score.key)
  const tpm = score.ticksPerMeasure
  const ts = score.timeSignature
  const [beatsNum, beatType] = meterParts(ts)
  const beat = beatTicksOf(ts)
  const bpm = score.bpm > 0 && Number.isFinite(score.bpm) ? score.bpm : 100
  const count = Math.max(1, score.measureCount)
  const lead = opts.pickup === false ? 0 : pickupTicks(score)
  // Divisions per quarter: 4 for straight music, 12 when a tuplet needs thirds of a sixteenth.
  const anyTuplet = score.staves.some((st) => staffVoices(st).some((ms) => ms.some((m) => m.events.some((e) => isTripletEdge(e.start) || isTripletEdge(e.start + e.duration)))))
  const div = anyTuplet ? TICKS_PER_QUARTER : TICKS_PER_QUARTER / SIXTEENTH
  const D = (ticks: number) => Math.round((ticks * div) / TICKS_PER_QUARTER)
  const voices = score.staves.map((staff) => staffVoices(staff))
  const context = spellingContext(score)
  const staffAcc = score.staves.map(() => new AccidentalState(key))
  const prevTie = voices.map((vs) => vs.map(() => false))
  const lastChoice: (SpellingChoice | undefined)[][] = voices.map((vs) => vs.map(() => undefined))
  const clefs = score.staves.map((staff, si): 'treble' | 'bass' =>
    staff.clef === 'treble' || staff.clef === 'bass' ? staff.clef : si === 0 ? 'treble' : 'bass',
  )
  const x: string[] = []
  x.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>')
  x.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
  )
  x.push('<score-partwise version="4.0">')
  if (score.title) x.push(`  <work><work-title>${xmlEscape(score.title)}</work-title></work>`)
  x.push('  <identification><encoding><software>Pauta</software></encoding></identification>')
  x.push('  <part-list>')
  x.push('    <score-part id="P1">')
  x.push('      <part-name>Piano</part-name>')
  x.push('      <score-instrument id="P1-I1"><instrument-name>Piano</instrument-name></score-instrument>')
  x.push('      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument>')
  x.push('    </score-part>')
  x.push('  </part-list>')
  x.push('  <part id="P1">')
  for (let m = 0; m < count; m++) {
    const cut = m === 0 ? lead : 0
    const length = tpm - cut
    const number = lead > 0 ? m : m + 1
    x.push(`    <measure number="${number}"${cut > 0 ? ' implicit="yes"' : ''}>`)
    if (m === 0) {
      x.push('      <attributes>')
      x.push(`        <divisions>${div}</divisions>`)
      x.push(`        <key><fifths>${key.fifths}</fifths><mode>${key.mode}</mode></key>`)
      x.push(`        <time><beats>${beatsNum}</beats><beat-type>${beatType}</beat-type></time>`)
      x.push('        <staves>2</staves>')
      x.push(`        <clef number="1">${CLEF_SIGN[clefs[0]]}</clef>`)
      x.push(`        <clef number="2">${CLEF_SIGN[clefs[1]]}</clef>`)
      x.push('      </attributes>')
      const compound = ts === '6/8'
      const perMinute = compound ? Math.round(bpm / 1.5) : Math.round(bpm)
      x.push('      <direction placement="above">')
      x.push(
        `        <direction-type><metronome parentheses="no"><beat-unit>quarter</beat-unit>${compound ? '<beat-unit-dot/>' : ''}<per-minute>${perMinute}</per-minute></metronome></direction-type>`,
      )
      x.push('        <staff>1</staff>')
      x.push(`        <sound tempo="${Math.round(bpm * 100) / 100}"/>`)
      x.push('      </direction>')
    }
    let firstSequence = true
    voices.forEach((vs, si) => {
      const evs = vs.map((measures) => trimLead(measures[m]?.events ?? [{ start: 0, duration: tpm, pitches: [] }], cut, ts))
      const twoVoices = evs.length > 1 && evs[1].some((e) => e.pitches.length > 0)
      // Tie continuations per voice, then accidentals across the voices of the staff in time order.
      const cont = evs.map((events, vi) => {
        let tied = prevTie[si][vi]
        return events.map((ev) => {
          const c = tied && ev.pitches.length > 0
          tied = ev.pitches.length > 0 && ev.tie === true
          return c
        })
      })
      staffAcc[si].newBar()
      const spelled: { sp: SpelledPitch; alter: number | null }[][][] = evs.map((events) => events.map(() => []))
      const order: [number, number][] = []
      evs.forEach((events, vi) => events.forEach((ev, i) => ev.pitches.length && order.push([vi, i])))
      order.sort((a, b) => evs[a[0]][a[1]].start - evs[b[0]][b[1]].start || a[0] - b[0])
      for (const [vi, i] of order) {
        const pitches = [...evs[vi][i].pitches].sort((a, b) => a - b)
        // A tie continuation keeps the letters of its attack.
        const ctx = cont[vi][i] ? lastChoice[si][vi] : context(m * tpm + evs[vi][i].start)
        const sps = spellChord(pitches, key, ctx)
        lastChoice[si][vi] = choiceOf(pitches, sps)
        spelled[vi][i] = sps.map((sp) => ({ sp, alter: staffAcc[si].visit(sp, cont[vi][i]) }))
      }
      evs.forEach((events, vi) => {
        if (!firstSequence) x.push(`      <backup><duration>${D(length)}</duration></backup>`)
        firstSequence = false
        if (si === 1 && vi === 0) x.push(...pedalDirections(score, m, cut, div))
        const staffNo = si + 1
        const voice = si * 4 + vi + 1
        const beamValues = beams(events, beat)
        const tuplet = tupletKinds(events)
        const typeOf = (ev: ScoreEvent, ei: number): [string, number, string] => {
          const k = tuplet[ei]
          if (k === 0) {
            const [type, dots] = TYPES[ev.duration / SIXTEENTH] ?? ['quarter', 0]
            return [type, dots, '']
          }
          const [type, dots] = TUPLET_TYPES[ev.duration] ?? ['eighth', 0]
          return [type, dots, k === 3 ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' : '<time-modification><actual-notes>6</actual-notes><normal-notes>4</normal-notes></time-modification>']
        }
        const stem = twoVoices ? `<stem>${vi === 0 ? 'up' : 'down'}</stem>` : ''
        events.forEach((ev, ei) => {
          if (ev.pitches.length === 0) {
            const whole = events.length === 1 && ev.start === 0 && ev.duration === tpm
            const [type, dots, mod] = typeOf(ev, ei)
            x.push(
              `      <note${vi > 0 ? ' print-object="no"' : ''}>${whole ? '<rest measure="yes"/>' : '<rest/>'}<duration>${D(ev.duration)}</duration><voice>${voice}</voice>` +
                (whole ? '' : `<type>${type}</type>${'<dot/>'.repeat(dots)}${mod}`) +
                `<staff>${staffNo}</staff></note>`,
            )
            return
          }
          const tieStop = cont[vi][ei]
          const tieStart = ev.tie === true
          const [type, dots, mod] = typeOf(ev, ei)
          spelled[vi][ei].forEach(({ sp, alter }, pi) => {
            let n = '      <note>'
            if (pi > 0) n += '<chord/>'
            n += `<pitch><step>${sp.step}</step>${sp.alter !== 0 ? `<alter>${sp.alter}</alter>` : ''}<octave>${sp.octave}</octave></pitch>`
            n += `<duration>${D(ev.duration)}</duration>`
            if (tieStop) n += '<tie type="stop"/>'
            if (tieStart) n += '<tie type="start"/>'
            n += `<voice>${voice}</voice><type>${type}</type>${'<dot/>'.repeat(dots)}${mod}`
            if (alter !== null) n += `<accidental>${ACCIDENTALS[String(alter)]}</accidental>`
            n += stem
            n += `<staff>${staffNo}</staff>`
            if (pi === 0) beamValues[ei].forEach((b, level) => (n += `<beam number="${level + 1}">${b}</beam>`))
            if (tieStop || tieStart) {
              n += '<notations>'
              if (tieStop) n += '<tied type="stop"/>'
              if (tieStart) n += '<tied type="start"/>'
              n += '</notations>'
            }
            x.push(n + '</note>')
          })
        })
        const lastEv = events[events.length - 1]
        prevTie[si][vi] = lastEv !== undefined && lastEv.pitches.length > 0 && lastEv.tie === true
      })
    })
    if (m === count - 1) x.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>')
    x.push('    </measure>')
  }
  x.push('  </part>')
  x.push('</score-partwise>')
  return x.join('\n') + '\n'
}
