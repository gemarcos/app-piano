# Credits

Everything Pauta ships that was made by someone else, with its license. Licenses were checked on each source page (October 2026). The machine-readable image list (used by the About screen) is `src/assets/images.ts`.

## Photos (`public/images/`)

All photos were cropped, resized and converted to WebP. No other edits were made. No photo shows recognizable people, logos or watermarks.

| File | Description | Author | Source | License |
|---|---|---|---|---|
| `covers/keys-soft.webp` | Soft-focus black and white piano keys | Maciej Korsan | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Keys-piano-sh.jpg) (originally [StockSnap](https://stocksnap.io/photo/8QCSDQK2IX)) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `covers/keys-touch.webp` | Finger pressing a piano key | Hans Braxmeier | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Piano_keys_by_Hans_Braxmeier.jpg) (originally [Pixabay](https://pixabay.com/en/play-piano-piano-piano-keys-finger-7626/)) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `covers/vinyl-pastel.webp` | Pastel vinyl record on a turntable | Lee Campbell | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Playing_a_new_vinyl_(Unsplash).jpg) (originally [Unsplash](https://unsplash.com/photos/1w1OMV8CEeM), 2016, CC0 era) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `covers/headphones-pastel.webp` | Pink headphones on a pink and mint background | Icons8 Team | [Unsplash](https://unsplash.com/photos/white-corded-headphones-7LNatQYMzm4) | [Unsplash License](https://unsplash.com/license) |
| `covers/keys-graphic.webp` | Piano keys on a white background | Martin Woortman | [Unsplash](https://unsplash.com/photos/a-close-up-of-a-black-and-white-piano-keys-lBeXkAS8fuM) | [Unsplash License](https://unsplash.com/license) |
| `covers/keys-ivory.webp` | Ivory and black piano keys, close-up | Akshar Dave | [Unsplash](https://unsplash.com/photos/black-and-white-piano-keys-9ZTgaXjcx58) | [Unsplash License](https://unsplash.com/license) |
| `covers/sheet-grey.webp` | Open sheet music in soft light | Marius Masalar | [Unsplash](https://unsplash.com/photos/tilt-selective-photograph-of-music-notes-rPOmLGwai2w) | [Unsplash License](https://unsplash.com/license) |
| `covers/sheet-blush.webp` | Printed sheet music in warm light | Tommy Diner | [Unsplash](https://unsplash.com/photos/an-open-book-with-musical-notes-on-it-n8rK2ALPHTY) | [Unsplash License](https://unsplash.com/license) |
| `covers/haze-lavender.webp` | Soft lavender and blue gradient | Radoslav Bali | [Unsplash](https://unsplash.com/photos/lavender-and-blue-gradient-Bp2sWPJGPHs) | [Unsplash License](https://unsplash.com/license) |
| `covers/haze-peach.webp` | Soft peach and blue gradient | Plufow Le Studio | [Unsplash](https://unsplash.com/photos/soft-pastel-gradient-background-aE8Mx8-vQss) | [Unsplash License](https://unsplash.com/license) |
| `hero-home.webp` | Piano keyboard seen from above on white | Denise Jans | [Unsplash](https://unsplash.com/photos/white-and-black-piano-keyboard-RQ0_Fp2Hr2M) | [Unsplash License](https://unsplash.com/license) |
| `empty-library.webp` | Light turntable at rest in soft window light | Lee Campbell | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Minimal_vinyl_player_(Unsplash).jpg) (originally [Unsplash](https://unsplash.com/photos/4f_Kk-AYf64), April 2017, CC0 era) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

Every Unsplash page above showed "Free to use under the Unsplash License". None of them is an Unsplash+ photo. The Unsplash License does not require attribution. We credit the photographers anyway.

## Piano soundfont (`public/soundfonts/`)

- **What**: 89 piano samples (`acoustic_grand_piano-mp3/A0.mp3` … `C8.mp3`, plus `Db8.mp3`) and 6 percussion samples for the metronome (`percussion-mp3/A1, Bb1, Db2, Eb5, E5, F5.mp3`, GM drum notes 33, 34, 37, 75, 76 and 77). Total: 95 MP3 files, about 2.0 MB. The files are byte-for-byte copies, not modified.
- **Sound source**: *Fluid (R3) General MIDI SoundFont* (`FluidR3_GM.sf2`) by **Frank Wen**. The author released it under the MIT license (see the [Debian fluid-soundfont copyright file](https://sources.debian.org/src/fluid-soundfont/3.1-5.3/debian/copyright/)).
- **MP3 renders**: [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) by **Benjamin Gleitzman**. Its README releases the FluidR3_GM renders under the [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/us/) license. The repository code is MIT, © 2012 Benjamin Gleitzman. The percussion renders come from **Paul Rosen**'s fork ([paulrosen/midi-js-soundfonts](https://github.com/paulrosen/midi-js-soundfonts), MIT), which abcjs uses by default.
- **Downloaded from**: `https://paulrosen.github.io/midi-js-soundfonts/FluidR3_GM/` (the folder abcjs 6.7 uses as its default `soundFontUrl`).
- **Attribution line** (CC BY 3.0): "Piano sounds: FluidR3_GM by Frank Wen, rendered by the midi-js-soundfonts project (Benjamin Gleitzman, Paul Rosen), CC BY 3.0."

## Brand icons (`public/icons/`)

`logo.svg`, `mark.svg`, `favicon.svg`, `favicon-32.png`, `icon-192.png`, `icon-512.png`, `maskable-512.png` and `apple-touch-icon.png` are original artwork made for Pauta: five staff lines with a vinyl disc on an accent gradient. They contain no third-party material.

## Software and fonts

| Component | Use in Pauta | License | Author / project |
|---|---|---|---|
| [Basic Pitch](https://github.com/spotify/basic-pitch-ts) (`@spotify/basic-pitch`), including its model weights | Note transcription | Apache-2.0 | Spotify |
| [TensorFlow.js](https://github.com/tensorflow/tfjs) (`@tensorflow/tfjs`) | Runs the Basic Pitch model | Apache-2.0 | Google / TensorFlow authors |
| [abcjs](https://github.com/paulrosen/abcjs) | Score rendering and playback | MIT | Paul Rosen, Gregory Dyke |
| [Untitled UI Icons](https://www.untitledui.com/resources/icons) (`@untitled-ui/icons-react`) | Icons | MIT | Untitled UI / Devias IO |
| [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) (via `@fontsource-variable/plus-jakarta-sans`) | Typeface | SIL Open Font License 1.1 | The Plus Jakarta Sans Project Authors (Tokotype) |
| [Motion](https://motion.dev) (`motion`) | Animation | MIT | Matt Perry |
| [Dexie.js](https://dexie.org) (`dexie`, `dexie-react-hooks`) | Local library database (IndexedDB) | Apache-2.0 | David Fahlander |
| [zustand](https://github.com/pmndrs/zustand) | Settings state | MIT | Paul Henschel / Poimandres |
| [React](https://react.dev), React DOM | UI | MIT | Meta Platforms, Inc. and affiliates |
| [React Router](https://reactrouter.com) (`react-router-dom`) | Routing | MIT | Remix Software |
| [@tonejs/midi](https://github.com/Tonejs/Midi) | MIDI export | MIT | Yotam Mann |
| [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa), [Workbox](https://github.com/GoogleChrome/workbox) | Offline support (service worker) | MIT | Anthony Fu and contributors; Google |

Build tooling (Vite, TypeScript, Vitest) is not shipped to users and is not listed.
