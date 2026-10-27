// Owner: assets. Manifest of the copyright-free images shipped in public/images/,
// plus paths of the other static assets (brand icons, abcjs soundfont). Full credits: docs/CREDITS.md.
import type { TimeSignature } from '../types'

export interface ImageAsset {
  id: string
  /** URL relative to the app base (use as <img src>). */
  src: string
  alt: string
  author: string
  /** 'Unsplash', 'Pexels', 'Wikimedia Commons'… */
  sourceName: string
  sourceUrl: string
  license: string
  /** Link to the license text. */
  licenseUrl?: string
  /** Where the photo was first published, when sourceUrl is a mirror (e.g. a CC0 Unsplash photo kept on Commons). */
  originalUrl?: string
  /** Intrinsic size in px; set width/height on <img> to avoid layout shift. */
  width?: number
  height?: number
  /** Overall brightness: put ink text (or a scrim) over 'light' images and white text over 'dark' ones. */
  tone?: 'light' | 'dark'
}

const base = import.meta.env.BASE_URL

const UNSPLASH = { sourceName: 'Unsplash', license: 'Licencia Unsplash', licenseUrl: 'https://unsplash.com/license' }
const COMMONS_CC0 = {
  sourceName: 'Wikimedia Commons',
  license: 'CC0 1.0 (dominio público)',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
}

/** Square images (640×640 WebP) used as covers for library items. */
export const covers: ImageAsset[] = [
  {
    id: 'keys-soft',
    src: base + 'images/covers/keys-soft.webp',
    alt: 'Teclas de piano desenfocadas en blanco y negro',
    author: 'Maciej Korsan',
    ...COMMONS_CC0,
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Keys-piano-sh.jpg',
    originalUrl: 'https://stocksnap.io/photo/8QCSDQK2IX',
    width: 640,
    height: 640,
    tone: 'dark',
  },
  {
    id: 'vinyl-pastel',
    src: base + 'images/covers/vinyl-pastel.webp',
    alt: 'Disco de vinilo en tonos pastel girando en un tocadiscos',
    author: 'Lee Campbell',
    ...COMMONS_CC0,
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Playing_a_new_vinyl_(Unsplash).jpg',
    originalUrl: 'https://unsplash.com/photos/1w1OMV8CEeM',
    width: 640,
    height: 640,
    tone: 'dark',
  },
  {
    id: 'sheet-blush',
    src: base + 'images/covers/sheet-blush.webp',
    alt: 'Partitura impresa con luz cálida',
    author: 'Tommy Diner',
    ...UNSPLASH,
    sourceUrl: 'https://unsplash.com/photos/an-open-book-with-musical-notes-on-it-n8rK2ALPHTY',
    width: 640,
    height: 640,
    tone: 'light',
  },
  {
    id: 'keys-graphic',
    src: base + 'images/covers/keys-graphic.webp',
    alt: 'Teclas de piano sobre fondo blanco',
    author: 'Martin Woortman',
    ...UNSPLASH,
    sourceUrl: 'https://unsplash.com/photos/a-close-up-of-a-black-and-white-piano-keys-lBeXkAS8fuM',
    width: 640,
    height: 640,
    tone: 'light',
  },
  {
    id: 'haze-lavender',
    src: base + 'images/covers/haze-lavender.webp',
    alt: 'Degradado suave lavanda y azul',
    author: 'Radoslav Bali',
    ...UNSPLASH,
    sourceUrl: 'https://unsplash.com/photos/lavender-and-blue-gradient-Bp2sWPJGPHs',
    width: 640,
    height: 640,
    tone: 'light',
  },
  {
    id: 'keys-touch',
    src: base + 'images/covers/keys-touch.webp',
    alt: 'Dedo pulsando una tecla de piano',
    author: 'Hans Braxmeier',
    ...COMMONS_CC0,
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Piano_keys_by_Hans_Braxmeier.jpg',
    originalUrl: 'https://pixabay.com/en/play-piano-piano-piano-keys-finger-7626/',
    width: 640,
    height: 640,
    tone: 'dark',
  },
  {
    id: 'headphones-pastel',
    src: base + 'images/covers/headphones-pastel.webp',
    alt: 'Auriculares rosas sobre fondo rosa y menta',
    author: 'Icons8 Team',
    ...UNSPLASH,
    sourceUrl: 'https://unsplash.com/photos/white-corded-headphones-7LNatQYMzm4',
    width: 640,
    height: 640,
    tone: 'light',
  },
  {
    id: 'sheet-grey',
    src: base + 'images/covers/sheet-grey.webp',
    alt: 'Partitura abierta con luz suave',
    author: 'Marius Masalar',
    ...UNSPLASH,
    sourceUrl: 'https://unsplash.com/photos/tilt-selective-photograph-of-music-notes-rPOmLGwai2w',
    width: 640,
    height: 640,
    tone: 'light',
  },
  {
    id: 'keys-ivory',
    src: base + 'images/covers/keys-ivory.webp',
    alt: 'Teclas de piano color marfil en primer plano',
    author: 'Akshar Dave',
    ...UNSPLASH,
    sourceUrl: 'https://unsplash.com/photos/black-and-white-piano-keys-9ZTgaXjcx58',
    width: 640,
    height: 640,
    tone: 'dark',
  },
  {
    id: 'haze-peach',
    src: base + 'images/covers/haze-peach.webp',
    alt: 'Degradado suave melocotón y azul',
    author: 'Plufow Le Studio',
    ...UNSPLASH,
    sourceUrl: 'https://unsplash.com/photos/soft-pastel-gradient-background-aE8Mx8-vQss',
    width: 640,
    height: 640,
    tone: 'light',
  },
]

/** Larger images for the Home banner (1200×720) and the empty library (900×700). */
export const heroImages: { home?: ImageAsset; emptyLibrary?: ImageAsset } = {
  home: {
    id: 'hero-home',
    src: base + 'images/hero-home.webp',
    alt: 'Teclado de piano visto desde arriba sobre fondo blanco',
    author: 'Denise Jans',
    ...UNSPLASH,
    sourceUrl: 'https://unsplash.com/photos/white-and-black-piano-keyboard-RQ0_Fp2Hr2M',
    width: 1200,
    height: 720,
    // The left ~45% is plain white (room for a title in ink); the keys fill the right side.
    tone: 'light',
  },
  emptyLibrary: {
    id: 'empty-library',
    src: base + 'images/empty-library.webp',
    alt: 'Tocadiscos claro en reposo con luz suave',
    author: 'Lee Campbell',
    ...COMMONS_CC0,
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Minimal_vinyl_player_(Unsplash).jpg',
    originalUrl: 'https://unsplash.com/photos/4f_Kk-AYf64',
    width: 900,
    height: 700,
    // Soft white light in the top ~40%, the turntable sits low in the frame.
    tone: 'light',
  },
}

export const allImages: ImageAsset[] = [...covers, ...Object.values(heroImages).filter(Boolean) as ImageAsset[]]

export function getCover(id: string): ImageAsset | undefined {
  return covers.find((c) => c.id === id)
}

/** Deterministic cover choice for a seed (e.g. the item id). Returns '' when no covers exist. */
export function pickCoverId(seed: string): string {
  if (covers.length === 0) return ''
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return covers[Math.abs(h) % covers.length].id
}

/* ---------- Brand icons (public/icons) ---------- */

export const brandIcons = {
  /** Accent-gradient rounded tile with the white mark (512 viewBox). Fine as <img>. */
  logo: base + 'icons/logo.svg',
  /** Mark only, black on transparent. Use as a CSS mask (`mask: url(...) center / contain no-repeat; background: currentColor`) to tint it. */
  mark: base + 'icons/mark.svg',
  favicon: base + 'icons/favicon.svg',
}

/* ---------- abcjs soundfont (public/soundfonts) ---------- */

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
