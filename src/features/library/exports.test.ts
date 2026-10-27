// Owner: library. MusicXML / MIDI / ABC files of a library item, through the engine exporters.
import abcjs from 'abcjs'
import { describe, expect, it } from 'vitest'
import { Midi } from '@tonejs/midi'
import { demoAnalysis, demoParams, demoPieces } from '../../data/demos'
import { MIME } from '../../lib/download'
import { exportFile, scoreOfDoc } from './exports'

const settings = { quantize: 16 as const, splitPoint: 60, defaultDifficulty: 'original' as const }
const docs = demoPieces.map((demo) => ({
  title: demo.title,
  notes: demo.notes,
  analysis: demoAnalysis(demo),
  params: { ...demoParams(demo, settings), difficulty: 'original' as const },
}))

describe('exportFile', () => {
  it('MusicXML: well-formed header, title, file name and MIME type', async () => {
    for (const doc of docs) {
      const { blob, fileName } = exportFile(doc, 'musicxml')
      expect(fileName).toBe(`${doc.title}.musicxml`)
      expect(blob.type).toBe(MIME.musicxml)
      const text = await blob.text()
      expect(text.startsWith('<?xml')).toBe(true)
      expect(text).toContain('<score-partwise')
      expect(text).toContain(doc.title)
    }
  })

  it('MIDI: a standard MIDI file with both hands', async () => {
    const { blob, fileName } = exportFile(docs[0], 'midi')
    expect(fileName).toBe('Oda a la alegría.mid')
    expect(blob.type).toBe(MIME.midi)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd')
    const midi = new Midi(bytes)
    expect(midi.tracks.map((t) => t.name)).toEqual(['Mano derecha', 'Mano izquierda'])
    expect(midi.tracks[0].notes.length).toBeGreaterThan(0)
    expect(midi.tracks[1].notes.length).toBeGreaterThan(0)
  })

  it('ABC: title included, no note names, parses in abcjs without warnings', async () => {
    for (const doc of docs) {
      const { blob, fileName } = exportFile(doc, 'abc')
      expect(fileName).toBe(`${doc.title}.abc`)
      expect(blob.type).toBe(MIME.abc)
      const text = await blob.text()
      expect(text).toContain(`T:${doc.title}`)
      expect(text).not.toContain('%%annotationfont')
      expect(text).not.toMatch(/"_[A-Z]/)
      const [tune] = abcjs.parseOnly(text)
      expect(tune.warnings ?? []).toEqual([])
    }
  })

  it('uses the stored params (e.g. a transposition) and a safe file name', async () => {
    const doc = { ...docs[1], title: 'Minueto: versión 2/3', params: { ...docs[1].params, transpose: 2 } }
    expect(scoreOfDoc(doc).key.tonic).toBe('A')
    const { fileName, blob } = exportFile(doc, 'abc')
    expect(fileName).toBe('Minueto - versión 2 - 3.abc')
    expect(await blob.text()).toMatch(/^K:A$/m)
  })

  it('repairs broken stored params instead of failing', () => {
    const doc = { ...docs[0], params: { ...docs[0].params, bpm: Number.NaN, quantize: 5 as unknown as 16, timeSignature: '5/4' as never } }
    const score = scoreOfDoc(doc)
    expect(score.measureCount).toBeGreaterThan(0)
    expect(score.timeSignature).toBe('4/4')
    expect(exportFile(doc, 'musicxml').blob.size).toBeGreaterThan(0)
  })
})
