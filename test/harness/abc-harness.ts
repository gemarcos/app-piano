// Owner: engine-score. Visual check of the ABC output with abcjs (not part of the app bundle).
// URL: /test/harness/abc.html?case=<slug|stress|six-eight>&naming=latin|english|none&hands=both|right|left
//      &difficulty=original|intermedio|facil&bars=<n, default suggestMeasuresPerLine>&transpose=0&dark=1
//      &annot=12 (note names at the old abcjs default: Helvetica 12 pt, for before/after comparisons)
import '@fontsource-variable/plus-jakarta-sans'
import '../../src/styles/tokens.css'
import abcjs from 'abcjs'
import { buildScore, defaultParams, keyName, scoreToAbc, suggestMeasuresPerLine } from '../../src/engine/score'
import type { AbcOptions } from '../../src/engine/score'
import { demoAnalysis, demoParams, demoPieces } from '../../src/data/demos'
import type { AnalysisResult, Difficulty, NoteEvent, NoteNaming, Score } from '../../src/types'

const q = new URLSearchParams(location.search)
const naming = (q.get('naming') ?? 'latin') as NoteNaming
const hands = (q.get('hands') ?? 'both') as AbcOptions['hands']
const difficulty = (q.get('difficulty') ?? 'original') as Difficulty
const bars = q.get('bars') ? Number(q.get('bars')) : null
const transpose = Number(q.get('transpose') ?? 0)
const only = q.get('case')
const annot = q.get('annot') ? Number(q.get('annot')) : null
if (q.get('dark') === '1') document.documentElement.dataset.theme = 'dark'

const css = `
  html, body { margin: 0; background: var(--bg); color: var(--ink); font-family: 'Plus Jakarta Sans Variable', system-ui, sans-serif; }
  main { max-width: 480px; margin: 0 auto; padding: 28px 16px 48px; display: grid; gap: 28px; }
  header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  header p { margin: 4px 0 0; color: var(--ink-2); font-weight: 500; font-size: 14px; }
  .meta { margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { font-size: 12px; font-weight: 600; color: var(--ink-2); background: var(--surface-2); border-radius: 999px; padding: 4px 10px; font-variant-numeric: tabular-nums; }
  .paper { background: var(--score-paper); color: var(--score-ink); border-radius: 24px; box-shadow: var(--shadow-sm); padding: 14px 8px 6px; }
  .paper svg { display: block; }
  /* Note names one step quieter than the notes. */
  .paper .abcjs-annotation { fill: var(--ink-2); }
`
document.head.append(Object.assign(document.createElement('style'), { textContent: annot ? css + '.paper .abcjs-annotation { fill: currentColor; }' : css }))

interface Case {
  slug: string
  title: string
  subtitle: string
  score: Score
}

const settings = { quantize: 16 as const, splitPoint: 60, defaultDifficulty: difficulty }

function stressNotes(): NoteEvent[] {
  // Accidentals that persist and get cancelled in the bar, a tie over the barline, chords.
  const spb = 60 / 96
  const n = (pitch: number, beat: number, beats: number): NoteEvent => ({ pitch, start: beat * spb, duration: beats * spb, velocity: 0.8 })
  return [
    n(66, 0, 1), n(65, 1, 1), n(66, 2, 0.5), n(68, 2.5, 0.5), n(70, 3, 2),
    n(61, 5, 1), n(60, 6, 1), n(63, 7, 1),
    n(72, 8, 0.25), n(74, 8.25, 0.25), n(75, 8.5, 0.5), n(73, 9, 1), n(71, 10, 1.5), n(70, 11.5, 0.5),
    n(48, 0, 4), n(55, 0, 4), n(52, 4, 2), n(51, 6, 2), n(50, 8, 3), n(43, 11, 1),
    n(60, 12, 1), n(64, 12, 1), n(67, 12, 1), n(70, 12, 1), n(72, 13, 3), n(76, 13, 3),
    n(41, 12, 4), n(48, 12, 4),
  ]
}

function cases(): Case[] {
  const out: Case[] = []
  for (const demo of demoPieces) {
    const analysis = demoAnalysis(demo)
    const params = { ...demoParams(demo, settings), transpose }
    const score = buildScore(demo.notes, params, analysis, demo.title)
    out.push({ slug: demo.slug, title: demo.title, subtitle: demo.composer, score })
  }
  const stress = stressNotes()
  const base: AnalysisResult = {
    bpm: 96,
    bpmConfidence: 1,
    beatOffset: 0,
    timeSignature: '4/4',
    key: { tonic: 'F', mode: 'major', fifths: -1 },
    keyConfidence: 1,
  }
  out.push({
    slug: 'stress',
    title: 'Alteraciones y ligaduras',
    subtitle: 'Prueba',
    score: buildScore(stress, { ...defaultParams(base, settings), transpose }, base, 'Prueba'),
  })
  const six: AnalysisResult = { ...base, timeSignature: '6/8', key: { tonic: 'E', mode: 'minor', fifths: 1 } }
  const sixNotes: NoteEvent[] = [64, 66, 67, 71, 69, 67, 66, 63, 64, 64, 71, 76].map((p, i) => ({
    pitch: p,
    start: (i * 60) / 96 / 2,
    duration: i % 3 === 0 ? 60 / 96 : 60 / 96 / 2,
    velocity: 0.8,
  }))
  out.push({
    slug: 'six-eight',
    title: 'Compás de 6/8',
    subtitle: 'Prueba',
    score: buildScore(sixNotes, { ...defaultParams(six, settings), transpose }, six, 'Prueba'),
  })
  return out
}

const root = document.getElementById('root')!
for (const c of cases()) {
  if (only && c.slug !== only) continue
  const section = document.createElement('section')
  const head = document.createElement('header')
  head.innerHTML = `<h1></h1><p></p><div class="meta"></div>`
  head.querySelector('h1')!.textContent = c.title
  head.querySelector('p')!.textContent = c.subtitle
  const meta = head.querySelector('.meta')!
  for (const text of [keyName(c.score.key, naming), c.score.timeSignature, `${c.score.bpm} ppm`, `${c.score.measureCount} compases`]) {
    meta.append(Object.assign(document.createElement('span'), { className: 'chip', textContent: text }))
  }
  // abcjs 'resize' turns its target into an aspect-ratio box (padding-bottom %, overflow hidden):
  // the target must have no padding of its own, or the bottom of the score is clipped.
  const paper = Object.assign(document.createElement('div'), { className: 'paper' })
  const target = document.createElement('div')
  paper.append(target)
  section.append(head, paper)
  root.append(section)
  const perLine = bars ?? suggestMeasuresPerLine(c.score, 330, { noteNames: naming !== 'none' })
  const font = annot ? { annotationSize: annot, annotationFont: 'Helvetica' } : {}
  const abc = scoreToAbc(c.score, { noteNaming: naming, hands, measuresPerLine: perLine, printTempo: false, ...font })
  const tune = abcjs.renderAbc(target, abc, {
    responsive: 'resize',
    foregroundColor: 'currentColor',
    add_classes: true,
    staffwidth: 330,
    paddingtop: 0,
    paddingbottom: 12,
    paddingleft: 0,
    paddingright: 10,
  })
  const warnings = tune[0]?.warnings ?? []
  if (warnings.length) console.error(`[${c.slug}] abc warnings`, warnings)
  ;(window as unknown as Record<string, unknown>)[`abc_${c.slug.replace(/-/g, '_')}`] = abc
}
