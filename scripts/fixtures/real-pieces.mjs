// Score data for the realistic benchmark (scripts/fixtures/make-real-fixtures.mjs). Public-domain compositions encoded
// by hand (openings, lightly simplified where noted) plus one original ballad. Nothing here is copyrighted material.
//
// Voice syntax: whitespace-separated tokens, '|' = barline (ignored). A token is `pitch[+pitch...]:beats` or `r:beats`
// (rest); beats are quarter notes and may be fractions ('1/3'). Suffixes: `~h` = the key is held h beats (default:
// beats x legato), `@v` = absolute MIDI velocity, `@+d` / `@-d` = offset from the voice velocity, `!` = accent.
// Pedal spans and dynamics use beats from the start of the piece (beat 0 = first event, pickup included).

const arp4 = (a, b, c, d, hold = [2, 1.5, 1, 0.5]) => [a, b, c, d].map((p, i) => `${p}:0.5~${hold[i]}`).join(' ')

/** Pedal pressed `press` beats after each change point and lifted `lift` beats after the next one (legato pedalling). */
export function legatoPedal(changes, end, press = 0.2, lift = 0.05) {
  return changes.map((b, i) => [b + press, (i + 1 < changes.length ? changes[i + 1] : end) + lift])
}

export const PIECES = {
  // Original ballad in the style of piano covers: slow, heavy pedal, melody in octaves 5-6 (doubled at the climax),
  // a soft left hand arpeggiating ABOVE middle C (C4-G4-D5-E5 shapes), I-V-vi-IV.
  ballad: {
    title: 'Balada (original)',
    composer: 'Pauta (original, CC0)',
    key: { tonic: 'C', mode: 'major', fifths: 0 },
    timeSignature: '4/4',
    beatsPerBar: 4,
    pickup: 0,
    bpm: 70,
    rubato: { depth: 0.06, period: 8, phase: 0.6 },
    ritardando: { from: 14, factor: 0.72 },
    voices: [
      {
        hand: 'right', role: 'melody', vel: 80, legato: 0.95,
        notes: `r:1 E5:0.5 G5:0.5 C6:1.5 D6:0.5 | B5:1 A5:0.5 G5:0.5 D6:2 |
                C6+C5:1@+10 B5+B4:0.5@+8 A5+A4:0.5@+8 E6+E5:1.5@+14 D6+D5:0.5@+10 | C6:1.5 A5:0.5 G5:1 D6:0.5 B5:0.5 |
                C6+C5:3~3@+4`,
      },
      {
        hand: 'left', role: 'arpeggio', vel: 40,
        notes: [
          arp4('C4', 'G4', 'D5', 'E5'), arp4('C4', 'G4', 'D5', 'E5'),
          arp4('D4', 'G4', 'A4', 'B4'), arp4('D4', 'G4', 'A4', 'B4'),
          arp4('E4', 'A4', 'C5', 'E5'), arp4('E4', 'A4', 'C5', 'E5'),
          arp4('C4', 'F4', 'G4', 'A4'), arp4('C4', 'F4', 'G4', 'A4'),
          'C4+E4+G4:3~3@-2',
        ].join(' | '),
      },
    ],
    pedal: legatoPedal([0, 4, 8, 12, 16], 19.4),
    dynamics: [[0, -4], [8, 4], [10, 8], [14, 0], [19, -8]],
  },

  // L. van Beethoven, "Für Elise" WoO 59, opening (A section, first ending). Written 3/8; here 3/4 with doubled values
  // (the beat is the original eighth note). Pedal on the broken-chord bars.
  elise: {
    title: 'Para Elisa (inicio)',
    composer: 'L. van Beethoven (dominio público)',
    key: { tonic: 'A', mode: 'minor', fifths: 0 },
    timeSignature: '3/4',
    meterNote: 'original 3/8; values doubled here (beat = original eighth note)',
    beatsPerBar: 3,
    pickup: 1,
    bpm: 128,
    rubato: { depth: 0.07, period: 6, phase: 0 },
    ritardando: { from: 21, factor: 0.62 },
    voices: [
      {
        hand: 'right', role: 'melody', vel: 66, legato: 0.92,
        notes: `E5:0.5 D#5:0.5 | E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 | A4:1 r:0.5 C4:0.5 E4:0.5 A4:0.5 |
                B4:1 r:0.5 E4:0.5 G#4:0.5 B4:0.5 | C5:1@+6 r:0.5 E4:0.5 E5:0.5 D#5:0.5 |
                E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 | A4:1 r:0.5 C4:0.5 E4:0.5 A4:0.5 |
                B4:1 r:0.5 E4:0.5 C5:0.5 B4:0.5 | A4:3~3`,
      },
      {
        hand: 'left', role: 'arpeggio', vel: 54, legato: 0.95,
        notes: `r:1 | r:3 | A2:0.5~1.5 E3:0.5~1 A3:0.5~0.5 r:1.5 | E2:0.5~1.5 E3:0.5~1 G#3:0.5~0.5 r:1.5 |
                A2:0.5~1.5 E3:0.5~1 A3:0.5~0.5 r:1.5 | r:3 | A2:0.5~1.5 E3:0.5~1 A3:0.5~0.5 r:1.5 |
                E2:0.5~1.5 E3:0.5~1 G#3:0.5~0.5 r:1.5 | A2:0.5~3 E3:0.5~2.5 A3:2~2`,
      },
    ],
    pedal: [[4.1, 6.95], [7.1, 9.95], [10.1, 12.9], [16.1, 18.95], [19.1, 21.95], [22.1, 25.6]],
    dynamics: [[0, -2], [9, 4], [12, -2], [21, -4], [25, -10]],
  },

  // L. van Beethoven, Sonata Op. 27 No. 2 "Moonlight", I. Adagio sostenuto, opening (simplified ending). Written in cut
  // time with triplet eighths; here 4/4 with triplets. Pianissimo, pedal changed with the harmony.
  moonlight: {
    title: 'Sonata Claro de luna, I (inicio)',
    composer: 'L. van Beethoven (dominio público)',
    key: { tonic: 'C#', mode: 'minor', fifths: 4 },
    timeSignature: '4/4',
    meterNote: 'original alla breve (2/2) with triplet eighths',
    beatsPerBar: 4,
    pickup: 0,
    bpm: 66,
    rubato: { depth: 0.05, period: 8, phase: 1.2 },
    ritardando: { from: 17, factor: 0.78 },
    voices: [
      {
        hand: 'right', role: 'arpeggio', vel: 40, legato: 1,
        notes: [
          'G#3:1/3 C#4:1/3 E4:1/3 '.repeat(4), 'G#3:1/3 C#4:1/3 E4:1/3 '.repeat(4),
          'A3:1/3 C#4:1/3 E4:1/3 '.repeat(2) + 'A3:1/3 D4:1/3 F#4:1/3 '.repeat(2),
          'G#3:1/3 C4:1/3 F#4:1/3 G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 D#4:1/3 F#3:1/3 C4:1/3 D#4:1/3',
          'G#3:1/3 C#4:1/3 E4:1/3 '.repeat(3) + 'G#3:1/3~1 C#4:1/3~1 E4:1/3~1',
        ].join(' | '),
      },
      { hand: 'right', role: 'melody', vel: 62, legato: 0.95, notes: 'r:16 | r:2 G#4:0.75 G#4:0.25 G#4:2~2' },
      {
        hand: 'left', role: 'bass', vel: 50, legato: 1,
        notes: 'C#2+C#3:4 | B1+B2:4 | A1+A2:2 F#1+F#2:2 | G#1+G#2:4 | C#2+C#3:6~6',
      },
    ],
    pedal: [[0.1, 4.04], [4.1, 8.04], [8.1, 10.04], [10.1, 12.04], [12.1, 13.04], [13.1, 14.04], [14.1, 15.04], [15.1, 16.04], [16.1, 22.6]],
    dynamics: [[0, -2], [8, 2], [12, 0], [16, -2], [22, -6]],
  },

  // W. A. Mozart, Sonata K. 545, I. Allegro, opening (bass of bars 5-8 simplified). Dry: no pedal until the last chord.
  mozart: {
    title: 'Sonata K. 545, I (inicio)',
    composer: 'W. A. Mozart (dominio público)',
    key: { tonic: 'C', mode: 'major', fifths: 0 },
    timeSignature: '4/4',
    beatsPerBar: 4,
    pickup: 0,
    bpm: 124,
    rubato: { depth: 0.025, period: 8, phase: 0 },
    ritardando: { from: 31, factor: 0.8 },
    voices: [
      {
        hand: 'right', role: 'melody', vel: 72, legato: 0.9,
        notes: [
          'C5:2 E5:1 G5:1', 'B4:1.5 C5:0.25 D5:0.25 C5:2', 'A5:2 G5:1 C6:1', 'G5:1 F5:1 E5:2',
          'A4 B4 C5 D5 E5 F5 G5 A5 G5 F5 E5 D5 C5 B4 A4 G4', 'G4 A4 B4 C5 D5 E5 F5 G5 F5 E5 D5 C5 B4 A4 G4 F4',
          'F4 G4 A4 B4 C5 D5 E5 F5 E5 D5 C5 B4 A4 G4 F4 E4', 'E4 F4 G4 A4 B4 C5 D5 E5 D5 C5 B4 A4 G4 F4 E4 D4',
          'C4+E4+G4+C5:2~2',
        ]
          .map((bar) => bar.split(' ').map((t) => (t.includes(':') ? t : `${t}:0.25`)).join(' '))
          .join(' | '),
      },
      {
        hand: 'left', role: 'accompaniment', vel: 52, legato: 0.88,
        notes: ['C4 G4 E4 G4 C4 G4 E4 G4', 'D4 G4 F4 G4 C4 G4 E4 G4', 'C4 A4 F4 A4 C4 G4 E4 G4', 'B3 G4 D4 G4 C4 G4 E4 G4']
          .map((bar) => bar.split(' ').map((t) => `${t}:0.5`).join(' '))
          .join(' | '),
      },
      { hand: 'left', role: 'bass', vel: 56, legato: 0.95, notes: 'r:16 | F3:2 E3:2 | D3:2 C3:2 | B2:2 A2:2 | G2:2 G3:2 | C2+C3:2~2' },
    ],
    pedal: [[32.1, 34.6]],
    dynamics: [[0, 0], [16, 2], [24, 8], [32, 2], [34, -4]],
  },

  // E. Satie, Gymnopédie No. 1, from bar 3 (two bars of the accompaniment, then the melody). Pianissimo, hall reverb.
  gymnopedie: {
    title: 'Gymnopédie n.º 1 (inicio)',
    composer: 'E. Satie (dominio público)',
    key: { tonic: 'D', mode: 'major', fifths: 2 },
    timeSignature: '3/4',
    beatsPerBar: 3,
    pickup: 0,
    bpm: 72,
    rubato: { depth: 0.05, period: 6, phase: 0.3 },
    ritardando: { from: 15, factor: 0.72 },
    voices: [
      { hand: 'left', role: 'bass', vel: 48, legato: 1, notes: 'G2:3 | D2:3 | G2:3 | D2:3 | G2:3 | D2:4~4' },
      {
        hand: 'left', role: 'accompaniment', vel: 38, legato: 1,
        notes: 'r:1 B3+D4+F#4:2 | r:1 A3+C#4+F#4:2 | r:1 B3+D4+F#4:2 | r:1 A3+C#4+F#4:2 | r:1 B3+D4+F#4:2 | r:1 A3+C#4+F#4:3~3',
      },
      { hand: 'right', role: 'melody', vel: 58, legato: 0.97, notes: 'r:3 | r:3 | F#5:1 A5:1 G5:1 | F#5:1 C#5:1 B4:1 | C#5:1 D5:1 A4:1 | F#4:4~4' },
    ],
    pedal: legatoPedal([0, 3, 6, 9, 12, 15], 19.2, 0.15, 0.04),
    dynamics: [[0, -2], [9, 3], [15, -2], [19, -6]],
  },

  // F. Liszt, Liebestraum No. 3 (Liebesträume S.541 No. 3, "O lieb, so lang du lieben kannst"), pickup + bars 1-5 and
  // the first beat of bar 6, as written: tenor melody shared between the thumbs, soft eighth-note arpeggios, one pedal
  // per bar (two in bar 5). Notes read from the typeset edition by RSB/Raimund (IMSLP #111552, CC BY 3.0; mirrored on
  // the Internet Archive as imslp-s541-liszt-franz); the composition itself is public domain.
  liebestraum: {
    title: 'Sueño de amor n.º 3 (inicio)',
    composer: 'F. Liszt (dominio público)',
    key: { tonic: 'Ab', mode: 'major', fifths: -4 },
    timeSignature: '6/4',
    meterNote: '6/4 (two dotted-half beats per bar); the beat grid here is the quarter note',
    beatsPerBar: 6,
    pickup: 1,
    bpm: 108,
    rubato: { depth: 0.08, period: 6, phase: -0.8 },
    ritardando: { from: 29, factor: 0.7 },
    voices: [
      { hand: 'left', role: 'bass', vel: 52, legato: 1, notes: 'r:1 | Ab2:1~5 r:5 | G2:1~5 r:5 | F2:1~5 r:5 | Bb1:1~5 r:5 | Eb2:1~5 r:5 | Ab2:2~3' },
      {
        hand: 'right', role: 'arpeggio', vel: 38, legato: 1,
        notes: [
          'r:1',
          'r:0.5 Eb4:0.5 Ab4:0.5 C5:0.5 Ab4:0.5 Eb4:0.5 r:0.5 Eb4:0.5 Ab4:0.5 C5:0.5 Ab4:0.5 Eb4:0.5',
          'r:0.5 E4:0.5 Bb4:0.5 C5:0.5 Bb4:0.5 E4:0.5 r:0.5 E4:0.5 Bb4:0.5 C5:0.5 Bb4:0.5 E4:0.5',
          'r:0.5 Eb4:0.5 A4:0.5 C5:0.5 A4:0.5 Eb4:0.5 r:0.5 Eb4:0.5 A4:0.5 C5:0.5 A4:0.5 Eb4:0.5',
          'r:0.5 D4:0.5 Ab4:0.5 C5:0.5 Ab4:0.5 D4:0.5 r:0.5 D4:0.5 Ab4:0.5 C5:0.5 Ab4:0.5 D4:0.5',
          'r:0.5 Db4:0.5 Eb4:0.5 C5:0.5 Eb4:0.5 Db4:0.5 r:0.5 Db4:0.5 Eb4:0.5 G4:0.5 Eb4:0.5 Db4:0.5',
          'C4+Eb4+Ab4:2~3',
        ].join(' | '),
      },
      { hand: 'right', role: 'melody', vel: 64, legato: 1, notes: 'r:1 | C4:3 r:3 | C4:5 r:1 | C4:2 r:1 Db4:2 r:1 | C4:3 r:3 | r:6 | r:2' },
      { hand: 'left', role: 'melody', vel: 62, legato: 1, notes: 'Eb3:1 | r:3 C4:3 | r:5 C4:1 | r:2 C4:1 r:2 C4:1 | r:6 | F3:1@+2 G3:1 Ab3:1@+4 C4:2@+6 Bb3:1 | Ab3:2~3' },
      { hand: 'left', role: 'inner', vel: 50, legato: 1, notes: 'r:1 | r:6 | r:6 | r:6 | r:3 F3:1 r:1 F3:1 | r:3 Eb3:1 r:2 | r:2' },
    ],
    pedal: [[1.15, 7.04], [7.15, 13.04], [13.15, 19.04], [19.15, 25.04], [25.15, 28.04], [28.15, 31.04], [31.15, 34.2]],
    dynamics: [[0, -2], [13, 2], [25, 6], [29, 2], [33, -6]],
  },
}
