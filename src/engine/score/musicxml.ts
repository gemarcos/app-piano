// Owner: engine-score. Score -> MusicXML 4.0 partwise (one piano part, two staves).
import type { Score, ScoreEvent } from '../../types'
import { beatTicksOf, meterParts } from './constants'
import { normalizeKey } from './keys'
import { AccidentalState, spellPitch } from './spelling'

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

/** Beam values (levels 1 and 2) for each event of a measure, grouping by beat. */
function beams(events: ScoreEvent[], beat: number): string[][] {
  const out: string[][] = events.map(() => [])
  let i = 0
  while (i < events.length) {
    const beamable = (e: ScoreEvent) => e.pitches.length > 0 && e.duration < 4
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
        if (events[group[k]].duration !== 1) {
          k++
          continue
        }
        let r = k
        while (r + 1 < group.length && events[group[r + 1]].duration === 1) r++
        if (r === k) out[group[k]].push(k === 0 ? 'forward hook' : 'backward hook')
        else for (let x = k; x <= r; x++) out[group[x]].push(x === k ? 'begin' : x === r ? 'end' : 'continue')
        k = r + 1
      }
    }
    i = j
  }
  return out
}

/** MusicXML 4.0 partwise document (one piano part, two staves). */
export function scoreToMusicXml(score: Score): string {
  const key = normalizeKey(score.key)
  const tpm = score.ticksPerMeasure
  const [beatsNum, beatType] = meterParts(score.timeSignature)
  const beat = beatTicksOf(score.timeSignature)
  const bpm = score.bpm > 0 && Number.isFinite(score.bpm) ? score.bpm : 100
  const count = Math.max(1, score.measureCount)
  const states = score.staves.map(() => new AccidentalState(key))
  const prevTie = [false, false]
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
    x.push(`    <measure number="${m + 1}">`)
    if (m === 0) {
      x.push('      <attributes>')
      x.push('        <divisions>4</divisions>')
      x.push(`        <key><fifths>${key.fifths}</fifths><mode>${key.mode}</mode></key>`)
      x.push(`        <time><beats>${beatsNum}</beats><beat-type>${beatType}</beat-type></time>`)
      x.push('        <staves>2</staves>')
      x.push('        <clef number="1"><sign>G</sign><line>2</line></clef>')
      x.push('        <clef number="2"><sign>F</sign><line>4</line></clef>')
      x.push('      </attributes>')
      const compound = score.timeSignature === '6/8'
      const perMinute = compound ? Math.round(bpm / 1.5) : Math.round(bpm)
      x.push('      <direction placement="above">')
      x.push(
        `        <direction-type><metronome parentheses="no"><beat-unit>quarter</beat-unit>${compound ? '<beat-unit-dot/>' : ''}<per-minute>${perMinute}</per-minute></metronome></direction-type>`,
      )
      x.push('        <staff>1</staff>')
      x.push(`        <sound tempo="${Math.round(bpm * 100) / 100}"/>`)
      x.push('      </direction>')
    }
    score.staves.forEach((staff, si) => {
      if (si > 0) x.push(`      <backup><duration>${tpm}</duration></backup>`)
      const events: ScoreEvent[] = staff.measures[m]?.events ?? [{ start: 0, duration: tpm, pitches: [] }]
      const staffNo = si + 1
      const voice = si === 0 ? 1 : 5
      const acc = states[si]
      acc.newBar()
      const beamValues = beams(events, beat)
      events.forEach((ev, ei) => {
        if (ev.pitches.length === 0) {
          prevTie[si] = false
          const whole = events.length === 1 && ev.start === 0 && ev.duration === tpm
          const [type, dots] = TYPES[ev.duration] ?? ['quarter', 0]
          x.push(
            `      <note>${whole ? '<rest measure="yes"/>' : '<rest/>'}<duration>${ev.duration}</duration><voice>${voice}</voice>` +
              (whole ? '' : `<type>${type}</type>${'<dot/>'.repeat(dots)}`) +
              `<staff>${staffNo}</staff></note>`,
          )
          return
        }
        const tieStop = prevTie[si]
        const tieStart = ev.tie === true
        prevTie[si] = tieStart
        const [type, dots] = TYPES[ev.duration] ?? ['quarter', 0]
        const pitches = [...ev.pitches].sort((a, b) => a - b)
        pitches.forEach((p, pi) => {
          const sp = spellPitch(p, key)
          const alter = acc.visit(sp, tieStop && ev.start === 0)
          let n = '      <note>'
          if (pi > 0) n += '<chord/>'
          n += `<pitch><step>${sp.step}</step>${sp.alter !== 0 ? `<alter>${sp.alter}</alter>` : ''}<octave>${sp.octave}</octave></pitch>`
          n += `<duration>${ev.duration}</duration>`
          if (tieStop) n += '<tie type="stop"/>'
          if (tieStart) n += '<tie type="start"/>'
          n += `<voice>${voice}</voice><type>${type}</type>${'<dot/>'.repeat(dots)}`
          if (alter !== null) n += `<accidental>${ACCIDENTALS[String(alter)]}</accidental>`
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
    })
    if (m === count - 1) x.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>')
    x.push('    </measure>')
  }
  x.push('  </part>')
  x.push('</score-partwise>')
  return x.join('\n') + '\n'
}
