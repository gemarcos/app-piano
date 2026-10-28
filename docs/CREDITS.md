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

## Playback sounds (`public/soundfonts/`)

### Grand piano: Salamander Grand Piano V3 (`soundfonts/salamander/`)

- **What**: 90 MP3 files, about 5.4 MB: 30 notes recorded in minor thirds from A0 to C8 (`A0`, `C1`, `Ds1`, `Fs1` … `C8`), each in 3 of the 16 original velocity layers (`v4` soft, `v9` medium, `v14` loud), named `<note>v<layer>.mp3`. The viewer's default sound, "Piano de cola" (pitch-shifted at most one semitone, with natural decay, damper release, dynamics and the sustain pedal).
- **Source**: *Salamander Grand Piano V3* by **Alexander Holm**, a Yamaha C5 grand recorded with two AKG C414 in AB position (48 kHz / 24 bit, 16 velocity layers). Downloaded from [FreePats](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html) (`SalamanderGrandPianoV3+20161209_44khz16bit.tar.xz`, 44.1 kHz / 16-bit WAV); also published on the [Internet Archive](https://archive.org/details/SalamanderGrandPianoV3) and listed at [sfzinstruments.github.io](https://sfzinstruments.github.io/pianos/salamander/).
- **License**: [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/) (CC BY 3.0). Checked on the Internet Archive item ("Attribution 3.0", creator Alexander Holm), on the FreePats page ("Creative Commons Attribution 3.0") and in the instrument's README ("Licence: CC-by … Author: Alexander Holm").
- **Changes made** (CC BY asks to say so): the silence before each hammer stroke was trimmed (4 ms kept), each file was cut to 3.5–8 s depending on the register with a smooth fade-out to silence, the stereo balance of four notes (C3, A4, D#5, D#6) was limited to ±6 dB, and the files were resampled to 32 kHz (soxr) and encoded as MP3 (LAME VBR quality 2). No other processing. Per-note tuning and level corrections are applied at playback time, not to the files.
- **Attribution line** (shown in Acerca de): "Piano de cola: Salamander Grand Piano V3 de Alexander Holm, CC BY 3.0 (muestras recortadas y convertidas a MP3)."
- **Test audio**: the realistic transcription benchmark `test/fixtures/real/*` (12 short m4a/mp4/webm files, about 3.1 MB) is rendered from the full 16-layer 44.1 kHz pack (not stored in the repo) by `scripts/fixtures/make-real-fixtures.mjs` (CC BY 3.0, same attribution; changes: notes pitch-shifted by at most one semitone and mixed into performances with reverb, detuning, speed changes, phone-speaker and microphone simulation, then AAC/Opus encoded). The music is public domain (Beethoven, Mozart, Satie, Liszt) plus an original ballad (CC0); the Liebestraum No. 3 notes were read from the typeset edition by "RSB/Raimund" on IMSLP (#111552, CC BY 3.0 on IMSLP; mirrored on the Internet Archive as `imslp-s541-liszt-franz`). Each fixture's JSON has a `source` field.

### "Piano clásico" and the metronome: FluidR3_GM renders (`soundfonts/acoustic_grand_piano-mp3/`, `soundfonts/percussion-mp3/`)

- **What**: the 89 FluidR3 piano samples (`acoustic_grand_piano-mp3/A0.mp3` … `C8.mp3`, plus `Db8.mp3`), the sound of the first version, now the viewer's optional "Piano clásico" (played through the same renderer as the grand: pedal, release and dynamics apply), and 6 percussion samples for the metronome and count-in (`percussion-mp3/A1, Bb1, Db2, Eb5, E5, F5.mp3`, GM drum notes 33, 34, 37, 75, 76 and 77; the clicks use 76 and 77). Byte-for-byte copies, not modified.
- **Sound source**: *Fluid (R3) General MIDI SoundFont* (`FluidR3_GM.sf2`) by **Frank Wen**. The author released it under the MIT license (see the [Debian fluid-soundfont copyright file](https://sources.debian.org/src/fluid-soundfont/3.1-5.3/debian/copyright/)).
- **MP3 renders**: [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) by **Benjamin Gleitzman**. Its README releases the FluidR3_GM renders under the [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/us/) license. The repository code is MIT, © 2012 Benjamin Gleitzman. The percussion renders come from **Paul Rosen**'s fork ([paulrosen/midi-js-soundfonts](https://github.com/paulrosen/midi-js-soundfonts), MIT), which abcjs uses by default.
- **Downloaded from**: `https://paulrosen.github.io/midi-js-soundfonts/FluidR3_GM/` (the folder abcjs 6.7 uses as its default `soundFontUrl`).
- **Attribution line** (shown in Acerca de): "Piano clásico y metrónomo: FluidR3_GM de Frank Wen, renderizado por el proyecto midi-js-soundfonts (Benjamin Gleitzman, Paul Rosen), CC BY 3.0 US."
- **Test audio**: `test/fixtures/piano-*.wav` are rendered from the FluidR3 piano samples by `scripts/fixtures/make-piano-fixtures.mjs` (CC BY 3.0, same attribution); each fixture's JSON has a `source` field.

### Room reverb

The soft concert-room reverb of the playback is generated by the app's own code (`src/features/viewer/reverb.ts`): no recorded impulse response or third-party material.

## Interface sounds, intro and generated art (no third-party material)

- **Interface sound effects** (taps, toggles, start/stop of a take, the "score ready" chime, the error cue, the note of the record): synthesized at run time with the Web Audio API by Pauta's own code (`src/ui/sound.ts`). No samples or recordings are used, so there is nothing to license or credit.
- **Launch intro, ambient backdrop (aurora and film grain), empty-state illustrations, generated covers and the "ready" burst**: drawn by Pauta's own CSS and SVG (`src/ui/Intro.tsx`, `Backdrop.tsx`, `EmptyArt.tsx`, `Cover.tsx`, `Celebration.tsx`). No images involved.

## Transcription model weights (`public/models/`)

- **Piano model** (`models/transkun/`, about 30 MB plus the 27 MB ONNX Runtime WebAssembly binary, downloaded the first time it is used and then kept for offline use; not precached): the pretrained "2.0" checkpoint of **Transkun V2** (Yujia Yan and Zhiyao Duan, "Scoring Intervals using Non-Hierarchical Transformer for Automatic Piano Transcription", ISMIR 2024), from the `transkun` 2.0.1 Python package, **MIT License**, Copyright (c) 2021 Yujia Yan (`models/transkun/LICENSE`). The checkpoint is trained on the **MAESTRO** dataset, licensed **CC BY-NC-SA 4.0** (non-commercial, share-alike). Whether those terms reach the weights is an open legal question: get legal advice before any commercial release. Changes: exported from PyTorch to two ONNX graphs (network and interval scorer; attribute heads), weights stored as float16 (computed in float32), with the front end and the semi-CRF decoding reimplemented in TypeScript; same note F1 as the official PyTorch transcription on the realistic benchmark. Details in `models/transkun/NOTICE`.
- **Basic Pitch** (`models/basic-pitch/`, 0.9 MB, precached): Spotify's model, Apache-2.0 (`models/basic-pitch/LICENSE`). Its paper lists MAESTRO among its training data too, so the same open question applies.

## Brand icons (`public/icons/`)

`logo.svg`, `mark.svg`, `favicon.svg`, `favicon-32.png`, `icon-192.png`, `icon-512.png`, `maskable-512.png` and `apple-touch-icon.png` are original artwork made for Pauta: five staff lines with a vinyl disc on an accent gradient. They contain no third-party material.

## Software and fonts

| Component | Use in Pauta | License | Author / project |
|---|---|---|---|
| [Transkun](https://github.com/Yujia-Yan/Transkun) (model exported to ONNX; front end and decoding reimplemented in `src/engine/transcribe/transkun/`, not an npm dependency) | Piano transcription (the default model) | MIT | Yujia Yan |
| [Basic Pitch](https://github.com/spotify/basic-pitch-ts) (`@spotify/basic-pitch`), including its model weights | Note transcription (fast fallback) | Apache-2.0 | Spotify |
| [TensorFlow.js](https://github.com/tensorflow/tfjs) (`@tensorflow/tfjs`) | Runs Basic Pitch; the piano model's device speed check | Apache-2.0 | Google / TensorFlow authors |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (`onnxruntime-web`) | Runs the piano model (WebGPU) | MIT | Microsoft Corporation |
| [abcjs](https://github.com/paulrosen/abcjs) | Score rendering | MIT | Paul Rosen, Gregory Dyke |
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
