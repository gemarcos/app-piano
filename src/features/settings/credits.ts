// Owner: settings. Third-party software and sounds credited in Acerca de (source: docs/CREDITS.md).
// Image credits come from allImages (src/assets/images.ts).

export interface SoftwareCredit {
  name: string
  author: string
  license: string
  url: string
}

export const SOFTWARE: SoftwareCredit[] = [
  { name: 'Transkun', author: 'Yujia Yan', license: 'MIT', url: 'https://github.com/Yujia-Yan/Transkun' },
  { name: 'Basic Pitch', author: 'Spotify', license: 'Apache-2.0', url: 'https://github.com/spotify/basic-pitch-ts' },
  { name: 'TensorFlow.js', author: 'Google', license: 'Apache-2.0', url: 'https://github.com/tensorflow/tfjs' },
  { name: 'ONNX Runtime Web', author: 'Microsoft', license: 'MIT', url: 'https://github.com/microsoft/onnxruntime' },
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

/**
 * CC BY 3.0 attributions of the playback sounds (owner: piano-sound; see docs/CREDITS.md). Required:
 * keep author, work, license and the note on the changes made to the samples.
 */
export const SOUNDFONT_ATTRIBUTION =
  'Piano de cola: Salamander Grand Piano V3 de Alexander Holm, CC BY 3.0 (muestras recortadas y convertidas a MP3). ' +
  'Piano clásico y metrónomo: FluidR3_GM de Frank Wen, renderizado por el proyecto midi-js-soundfonts (Benjamin Gleitzman, Paul Rosen), CC BY 3.0 US.'

/** Phrases of the attribution rendered as links (the visible text stays identical). Longest first. */
export const SOUNDFONT_LINKS: Record<string, string> = {
  'Salamander Grand Piano V3': 'https://archive.org/details/SalamanderGrandPianoV3',
  'midi-js-soundfonts': 'https://github.com/gleitz/midi-js-soundfonts',
  'CC BY 3.0 US': 'https://creativecommons.org/licenses/by/3.0/us/',
  'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
}
