// Owner: settings. Third-party software and sounds credited in Acerca de (source: docs/CREDITS.md).
// Image credits come from allImages (src/assets/images.ts).

export interface SoftwareCredit {
  name: string
  author: string
  license: string
  url: string
}

export const SOFTWARE: SoftwareCredit[] = [
  { name: 'Basic Pitch', author: 'Spotify', license: 'Apache-2.0', url: 'https://github.com/spotify/basic-pitch-ts' },
  { name: 'TensorFlow.js', author: 'Google', license: 'Apache-2.0', url: 'https://github.com/tensorflow/tfjs' },
  { name: 'abcjs', author: 'Paul Rosen, Gregory Dyke', license: 'MIT', url: 'https://github.com/paulrosen/abcjs' },
  { name: 'Untitled UI Icons', author: 'Untitled UI', license: 'MIT', url: 'https://www.untitledui.com/resources/icons' },
  { name: 'Plus Jakarta Sans', author: 'Tokotype', license: 'OFL-1.1', url: 'https://github.com/tokotype/PlusJakartaSans' },
  { name: 'Motion', author: 'Matt Perry', license: 'MIT', url: 'https://motion.dev' },
  { name: 'Dexie.js', author: 'David Fahlander', license: 'Apache-2.0', url: 'https://dexie.org' },
  { name: 'zustand', author: 'Poimandres', license: 'MIT', url: 'https://github.com/pmndrs/zustand' },
  { name: 'React', author: 'Meta', license: 'MIT', url: 'https://react.dev' },
  { name: 'React Router', author: 'Remix', license: 'MIT', url: 'https://reactrouter.com' },
  { name: '@tonejs/midi', author: 'Yotam Mann', license: 'MIT', url: 'https://github.com/Tonejs/Midi' },
  { name: 'vite-plugin-pwa y Workbox', author: 'Anthony Fu, Google', license: 'MIT', url: 'https://github.com/vite-pwa/vite-plugin-pwa' },
]

/** CC BY 3.0 attribution of the piano samples. Required word for word: do not edit. */
export const SOUNDFONT_ATTRIBUTION =
  'Sonidos de piano: FluidR3_GM de Frank Wen, renderizado por el proyecto midi-js-soundfonts (Benjamin Gleitzman, Paul Rosen), CC BY 3.0'

/** Phrases of the attribution rendered as links (the visible text stays identical). */
export const SOUNDFONT_LINKS: Record<string, string> = {
  'midi-js-soundfonts': 'https://github.com/gleitz/midi-js-soundfonts',
  'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/us/',
}
