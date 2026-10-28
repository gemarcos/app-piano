// Owner: assets. Paths of the static assets (brand icons, piano samples, abcjs soundfont). Full credits: docs/CREDITS.md.
// The interface uses no photographs: covers, empty states and the intro are drawn by the app itself.
import type { TimeSignature } from '../types'

const base = import.meta.env.BASE_URL

/* ---------- Brand icons (public/icons) ---------- */

export const brandIcons = {
  /** Ink rounded tile with the paper mark and the vermilion label (512 viewBox). Fine as <img>. */
  logo: base + 'icons/logo.svg',
  /** Mark only, black on transparent. Use as a CSS mask (`mask: url(...) center / contain no-repeat; background: currentColor`) to tint it. */
  mark: base + 'icons/mark.svg',
  favicon: base + 'icons/favicon.svg',
}

/* ---------- Playback sounds (public/soundfonts) ---------- */

/**
 * Grand piano samples played by the viewer: Salamander Grand Piano V3 (Yamaha C5) by Alexander Holm,
 * CC BY 3.0 (credits in docs/CREDITS.md and Acerca de). 30 notes in minor thirds A0..C8 x velocity
 * layers 4, 9 and 14, named `<note>v<layer>.mp3` with s for sharps (A0v4.mp3, Ds1v9.mp3, Fs6v14.mp3).
 */
export const PIANO_SAMPLE_DIR = 'soundfonts/salamander/'

/** Absolute URL of a piano sample file (browser only: uses document.baseURI). */
export function getPianoSampleUrl(file: string): string {
  return new URL(PIANO_SAMPLE_DIR + file, document.baseURI).href
}

/**
 * The "Piano clásico" sound: the FluidR3_GM piano renders (Frank Wen; midi-js-soundfonts, CC BY 3.0),
 * one MP3 per key with flat names (A0.mp3, Bb0.mp3 … C8.mp3, Db8.mp3), the sound phase B played through
 * abcjs; the viewer now plays them through its own renderer too.
 */
export const CLASSIC_PIANO_DIR = 'soundfonts/acoustic_grand_piano-mp3/'

/** Metronome clicks: GM wood blocks from the bundled percussion samples (76 high = downbeat, 77 low). */
export const METRONOME_CLICKS = { accent: 'soundfonts/percussion-mp3/E5.mp3', beat: 'soundfonts/percussion-mp3/F5.mp3' } as const

/** Absolute URL of a bundled sound file given relative to the app base (browser only). */
export function getSoundUrl(path: string): string {
  return new URL(path, document.baseURI).href
}

/* ---------- abcjs soundfont (public/soundfonts), no longer used for playback ---------- */

/** Folder of the bundled abcjs-format soundfont, relative to the app base. */
export const SOUNDFONT_DIR = 'soundfonts/'

/**
 * Absolute URL for abcjs synth `soundFontUrl` (served locally and precached, so playback works offline).
 * abcjs requests `${url}${instrument}-mp3/${note}.mp3`, e.g. `acoustic_grand_piano-mp3/Db4.mp3`.
 * Call it in the browser only (uses document.baseURI).
 */
export function getSoundFontUrl(): string {
  return new URL(SOUNDFONT_DIR, document.baseURI).href
}

/**
 * The bundled samples are FluidR3_GM (the set abcjs uses by default), which abcjs boosts ×3 only when loaded
 * from its own CDN URL. Pass this as `soundFontVolumeMultiplier` to get the same loudness locally.
 */
export const SOUNDFONT_VOLUME_MULTIPLIER = 3

/** MIDI range with piano samples (A0..Db8). Clamp/drop playback pitches outside it or abcjs logs load errors. */
export const SOUNDFONT_PITCH_RANGE: readonly [number, number] = [21, 109]

/**
 * abcjs `drum` patterns for a click metronome that only use the bundled percussion samples
 * (76 = high wood block on the downbeat, 77 = low wood block on the other beats).
 * Use with `drumBars: 1`, and `drumIntro: 1` for a one-bar count-in.
 */
export const METRONOME_DRUM: Record<TimeSignature, string> = {
  '2/4': 'dd 76 77 100 70',
  '3/4': 'ddd 76 77 77 100 70 70',
  '4/4': 'dddd 76 77 77 77 100 70 70 70',
  '6/8': 'dd 76 77 100 70',
}

/** GM percussion pitches present in soundfonts/percussion-mp3 (33 click, 34 bell, 37 side stick, 75 claves, 76/77 wood blocks). */
export const METRONOME_PITCHES: readonly number[] = [33, 34, 37, 75, 76, 77]
