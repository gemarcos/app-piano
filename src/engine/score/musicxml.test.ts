// Owner: engine-score. MusicXML: structure, well-formedness (Python minidom) and sounding notes.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Score, ScoreEvent, TimeSignature } from '../../types'
import { buildScore, keyFromFifths, pickupTicks, scoreToMusicXml, staffVoices } from './index'
import { knownAnalysis, plainParams, randomNotes, scoreFromMeasures, staffNotes, type StaffNote } from './test-helpers'

const ev = (start: number, duration: number, pitches: number[], tie?: boolean): ScoreEvent =>
  tie ? { start, duration, pitches, tie } : { start, duration, pitches }

/** "python" on Windows, "python3" on Linux/macOS (the Windows "python3" is a Store stub that fails). */
function findPython(): string | null {
  for (const cmd of ['python', 'python3']) {
    const r = spawnSync(cmd, ['-c', 'import xml.dom.minidom, json; print("ok")'], { encoding: 'utf8', windowsHide: true })
    if (r.status === 0 && r.stdout.trim() === 'ok') return cmd
  }
  return null
}

// Parses each file with minidom (non-validating: the DOCTYPE is not fetched) and reports, per file,
// the duration of each staff per measure, the <backup> lengths and the notes with absolute starts.
const CHECKER = String.raw`
import sys, json, xml.dom.minidom as md
STEP = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
def text(node, tag):
    els = node.getElementsByTagName(tag)
    return els[0].firstChild.data if els and els[0].firstChild else None
out = []
for f in sys.argv[2:]:
    doc = md.parse(f)
    tpm = int(sys.argv[1])
    measures, notes, pedals = [], {'1': [], '2': []}, []
    for mi, m in enumerate(doc.getElementsByTagName('measure')):
        pos, last, totals, backups = 0, 0, {}, []
        implicit = m.getAttribute('implicit') == 'yes'
        found = []
        for child in m.childNodes:
            if child.nodeType != child.ELEMENT_NODE:
                continue
            if child.tagName == 'backup':
                d = int(text(child, 'duration')); backups.append(d); pos -= d
            elif child.tagName == 'direction':
                for ped in child.getElementsByTagName('pedal'):
                    off = text(child, 'offset')
                    found.append({'type': ped.getAttribute('type'), 'at': pos + (int(off) if off else 0)})
            elif child.tagName == 'note':
                d = int(text(child, 'duration')); staff = text(child, 'staff'); voice = text(child, 'voice')
                chord = bool(child.getElementsByTagName('chord'))
                start = last if chord else pos
                if not chord:
                    key = staff + '/' + voice
                    totals[key] = totals.get(key, 0) + d; last = pos; pos += d
                p = child.getElementsByTagName('pitch')
                if p:
                    alter = text(p[0], 'alter')
                    midi = (int(text(p[0], 'octave')) + 1) * 12 + STEP[text(p[0], 'step')] + (int(alter) if alter else 0)
                    ties = [t.getAttribute('type') for t in child.getElementsByTagName('tie')]
                    tied = [t.getAttribute('type') for t in child.getElementsByTagName('tied')]
                    found.append({'pitch': midi, 'staff': staff, 'start': start, 'ticks': d, 'ties': ties, 'tied': tied})
        length = max(totals.values()) if totals else tpm
        base = mi * tpm + (tpm - length if implicit else 0)
        for n in found:
            if 'type' in n:
                pedals.append({'type': n['type'], 'tick': base + n['at']})
            else:
                notes[n['staff']].append({'pitch': n['pitch'], 'start': base + n['start'], 'ticks': n['ticks'], 'ties': n['ties'], 'tied': n['tied']})
        measures.append({'totals': totals, 'backups': backups, 'implicit': implicit, 'number': m.getAttribute('number')})
    out.append({'measures': measures, 'notes': notes, 'pedals': pedals})
print(json.dumps(out))
`

interface Checked {
  /** totals: written length per "staff/voice"; implicit: a pickup measure. */
  measures: { totals: Record<string, number>; backups: number[]; implicit: boolean; number: string }[]
  notes: Record<'1' | '2', (StaffNote & { ties: string[]; tied: string[] })[]>
  /** Pedal marks in absolute score ticks. */
  pedals: { type: string; tick: number }[]
}

const python = findPython()
const dir = mkdtempSync(path.join(os.tmpdir(), 'pauta-musicxml-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function check(scores: Score[]): Checked[] {
  const tpms = new Set(scores.map((s) => s.ticksPerMeasure))
  expect(tpms.size).toBe(1)
  const files = scores.map((s, i) => {
    const file = path.join(dir, `score-${Date.now()}-${i}.musicxml`)
    writeFileSync(file, scoreToMusicXml(s), 'utf8')
    return file
  })
  const r = spawnSync(python!, ['-c', CHECKER, String([...tpms][0]), ...files], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  expect(r.stderr).toBe('')
  expect(r.status).toBe(0)
  return JSON.parse(r.stdout) as Checked[]
}

/** Tie-merged notes of one staff of the parsed MusicXML (ties must be well paired). */
function merged(notes: Checked['notes']['1']): StaffNote[] {
  const out: StaffNote[] = []
  const open = new Map<number, StaffNote>()
  for (const n of [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch)) {
    expect(n.ties).toEqual(n.tied) // <tie> (sound) and <tied> (notation) agree
    const prev = open.get(n.pitch)
    if (n.ties.includes('stop')) {
      expect(prev && prev.start + prev.ticks === n.start).toBe(true)
      prev!.ticks += n.ticks
    } else {
      const note = { pitch: n.pitch, start: n.start, ticks: n.ticks }
      out.push(note)
      open.set(n.pitch, note)
    }
    if (!n.ties.includes('start')) open.delete(n.pitch)
  }
  return out.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}

describe('scoreToMusicXml structure', () => {
  const score = scoreFromMeasures(
    [[ev(0, 4, [66]), ev(4, 2, [65]), ev(6, 2, [67, 71]), ev(8, 6, [72]), ev(14, 2, [74], true)], [ev(0, 4, [74]), ev(4, 4, [66]), ev(8, 8, [])]],
    [[ev(0, 16, [43, 50])]],
    { key: keyFromFifths(1, 'major'), bpm: 96, title: 'A & B <C> "D" \'E\'' },
  )
  const xml = scoreToMusicXml(score)

  it('writes a MusicXML 4.0 partwise piano part with two staves', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!DOCTYPE score-partwise PUBLIC')).toBe(true)
    expect(xml).toContain('<score-partwise version="4.0">')
    expect(xml).toContain('<work><work-title>A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;</work-title></work>')
    expect(xml).toContain('<part-name>Piano</part-name>')
    expect(xml).toContain('<divisions>4</divisions>')
    expect(xml).toContain('<key><fifths>1</fifths><mode>major</mode></key>')
    expect(xml).toContain('<time><beats>4</beats><beat-type>4</beat-type></time>')
    expect(xml).toContain('<staves>2</staves>')
    expect(xml).toContain('<clef number="1"><sign>G</sign><line>2</line></clef>')
    expect(xml).toContain('<clef number="2"><sign>F</sign><line>4</line></clef>')
    expect(xml).toContain('<sound tempo="96"/>')
    expect(xml).toContain('<per-minute>96</per-minute>')
    expect(xml.match(/<measure number="/g)).toHaveLength(2)
    expect(xml.match(/<backup><duration>16<\/duration><\/backup>/g)).toHaveLength(2)
    expect(xml).toContain('<barline location="right"><bar-style>light-heavy</bar-style></barline>')
  })

  it('writes pitches, types, dots, chords, voices and accidentals', () => {
    // F#4 in G major: no accidental. F natural: a natural sign.
    expect(xml).toContain('<note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>')
    expect(xml).toContain('<pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><accidental>natural</accidental><staff>1</staff>')
    expect(xml).toContain('<note><chord/><pitch><step>B</step><octave>4</octave></pitch>')
    expect(xml).toContain('<duration>6</duration><voice>1</voice><type>quarter</type><dot/>')
    expect(xml).toContain('<voice>5</voice><type>whole</type><staff>2</staff>')
    // Bar 2: accidentals were reset at the barline, F#4 is in the key again.
    expect(xml).toContain('<pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff>')
  })

  it('gives a courtesy natural after an accidental carried over the barline by a tie', () => {
    const tied = scoreToMusicXml(scoreFromMeasures([[ev(0, 8, []), ev(8, 8, [66], true)], [ev(0, 8, [66]), ev(8, 8, [65])]]))
    const notes = [...tied.matchAll(/<note>.*?<\/note>/g)].map((m) => m[0]).filter((x) => x.includes('<staff>1</staff>') && x.includes('<pitch>'))
    expect(notes).toHaveLength(3)
    expect(notes[0]).toContain('<accidental>sharp</accidental>')
    expect(notes[1]).not.toContain('<accidental>')
    expect(notes[2]).toContain('<step>F</step><octave>4</octave>')
    expect(notes[2]).toContain('<accidental>natural</accidental>')
  })

  it('writes ties with both <tie> and <tied>, and whole-measure rests', () => {
    expect(xml).toContain('<tie type="start"/><voice>1</voice><type>eighth</type><staff>1</staff><notations><tied type="start"/></notations>')
    expect(xml).toContain('<tie type="stop"/><voice>1</voice><type>quarter</type><staff>1</staff><notations><tied type="stop"/></notations>')
    expect(xml).toContain('<note><rest measure="yes"/><duration>16</duration><voice>5</voice><staff>2</staff></note>')
  })

  it('beams eighths and sixteenths by beat', () => {
    const beamed = scoreToMusicXml(scoreFromMeasures([[ev(0, 1, [60]), ev(1, 1, [62]), ev(2, 2, [64]), ev(4, 2, [65]), ev(6, 1, [67]), ev(7, 1, [69]), ev(8, 8, [72])]]))
    const beams = [...beamed.matchAll(/<note>.*?<\/note>/g)].map((m) => [...m[0].matchAll(/<beam number="(\d)">([a-z ]+)<\/beam>/g)].map((b) => `${b[1]}:${b[2]}`).join(','))
    expect(beams.slice(0, 7)).toEqual([
      '1:begin,2:begin',
      '1:continue,2:end',
      '1:end',
      '1:begin',
      '1:continue,2:begin',
      '1:end,2:end',
      '',
    ])
  })

  it('handles 6/8 tempo marks and empty scores', () => {
    const six = scoreToMusicXml(scoreFromMeasures([[ev(0, 12, [72])]], [], { timeSignature: '6/8', bpm: 96 }))
    expect(six).toContain('<time><beats>6</beats><beat-type>8</beat-type></time>')
    expect(six).toContain('<beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>64</per-minute>')
    expect(six).toContain('<sound tempo="96"/>')
    const empty = scoreToMusicXml(buildScore([], plainParams(knownAnalysis()), knownAnalysis()))
    expect(empty.match(/<rest measure="yes"\/>/g)).toHaveLength(2)
    expect(empty).not.toContain('<work>')
  })
})

describe.skipIf(!python)('scoreToMusicXml well-formedness (Python minidom)', () => {
  it('parses, fills every measure exactly and sounds the score notes', () => {
    const meters: TimeSignature[] = ['4/4', '3/4', '2/4', '6/8']
    for (const [mi, ts] of meters.entries()) {
      const scores: Score[] = []
      for (let i = 0; i < 12; i++) {
        const seed = mi * 100 + i
        const a = knownAnalysis({ bpm: 70 + seed, timeSignature: ts, key: keyFromFifths((seed % 15) - 7, seed % 2 ? 'minor' : 'major') })
        const params = plainParams(a, { difficulty: (['original', 'intermedio', 'facil'] as const)[i % 3], maxPolyphony: 1 + (i % 6), transpose: (i % 9) - 4 })
        scores.push(buildScore(randomNotes(60 + i * 20, seed, 12), params, a, `Prueba <${seed}> & "${ts}"`))
      }
      check(scores).forEach((parsed, i) => {
        const score = scores[i]
        expect(parsed.measures).toHaveLength(score.measureCount)
        const lead = pickupTicks(score)
        parsed.measures.forEach((m, mi) => {
          // Every voice of every staff fills its measure; a pickup measure is shorter and implicit.
          const length = mi === 0 ? score.ticksPerMeasure - lead : score.ticksPerMeasure
          const voices = score.staves.flatMap((staff, si) => staffVoices(staff).map((_, vi) => `${si + 1}/${si * 4 + vi + 1}`))
          expect(m.totals, `${ts} #${i} measure ${mi}`).toEqual(Object.fromEntries(voices.map((v) => [v, length])))
          expect(m.backups).toEqual(voices.slice(1).map(() => length))
          expect(m.implicit).toBe(mi === 0 && lead > 0)
          expect(m.number).toBe(String(lead > 0 ? mi : mi + 1))
        })
        expect(merged(parsed.notes['1']), `${ts} #${i} RH`).toEqual(staffNotes(score, 0))
        expect(merged(parsed.notes['2']), `${ts} #${i} LH`).toEqual(staffNotes(score, 1))
      })
    }
  })
})

if (!python) {
  describe('scoreToMusicXml well-formedness', () => {
    it.skip('SKIPPED: neither "python" nor "python3" is available to run xml.dom.minidom', () => {})
  })
}
