# Pauta — product, design and architecture brief

Single source of truth for everyone working on this project. Read it fully before touching code.

## 1. Product

**Pauta** is a mobile app (installable PWA, mobile-first, Capacitor-ready) that **listens to a song from audio or video and produces piano sheet music** for it.

Core flows:
1. **Listen** — record with the microphone (e.g. a song playing nearby, a video on another device). On desktop Chrome, optionally capture tab/system audio via `getDisplayMedia` when supported.
2. **Import** — pick an audio **or video** file (`audio/*,video/*`), preview its waveform, choose the segment to transcribe (trim handles), transcribe.
3. **Transcribe** — on-device: decode → mono 22 050 Hz → Spotify **Basic Pitch** (TF.js, in a Web Worker) → raw `NoteEvent[]` → analysis (tempo, beat phase, key, meter) → quantized grand-staff `Score` → ABC notation rendered by **abcjs**.
4. **Library** — every transcription is saved locally (IndexedDB via Dexie). Search, filter chips, sort, grid/list, favorites, rename, delete, export, backup/restore. Ships with 3 public-domain demo pieces.
5. **Viewer** — renders the score; big play button; cursor follows playback; settings sheet with playback (speed, metronome, count-in, loop, follow), notation (hands, note names, zoom, transpose, key, meter, tempo base, split point, difficulty) and filters (noise/velocity, min duration, pitch range, max polyphony, quantize). Export PDF (print), MusicXML, MIDI, ABC; share.
6. **Settings** — appearance (system/light/dark, reduce motion), notation naming (Do Re Mi / C D E / none), transcription defaults, playback defaults, storage/backup, about & credits.

UI language: **Spanish (es-ES)**. Use musical Spanish: *partitura, compás, tonalidad, tempo, ppm* (pulsos por minuto), *mano derecha / izquierda, transponer, metrónomo, cuenta previa, bucle, cuantización, polifonía*.

## 2. Design language (non-negotiable)

Reference shots live in `docs/reference/` — open them with the Read tool and look at them:
- `ref-1-neumorphic-player.png` — airy lavender-white, soft neumorphic controls, bold black titles, grey subtitles, vinyl/turntable, waveform bars, curved list of round covers, black/white pill "Play".
- `ref-2-dashboard-purple.png` — white cards on light grey, soft shadows, compact list rows with thumbnails, rounded tiles.
- `ref-3-blue-glass.png` — big rounded cards, light grey search pill, image banner, cover cards with text overlay, round accent play/pause button, frosted/glass surfaces.

Blend them into ONE coherent system:
- **Calm, airy, light.** Lavender-tinted light background, white surfaces, very soft shadows, generous radius. Lots of empty space. **Do not try to fill every space.** One idea per screen.
- **Monochrome first, one accent.** Ink (near-black) for primary text and the main "ink" buttons (like ref 1's Play pill). Accent indigo-blue (`--accent`) only for progress, active states and the primary action on a screen. No other hues except inside images.
- **Minimal text.** No marketing copy, no explanations that the UI already makes obvious, no taglines. Short labels. Empty states = one short line + one action.
- **No emojis anywhere. Ever.** (Not in UI, not in toasts, not in code strings shown to users.)
- **Icons: only `@untitled-ui/icons-react`** (Untitled UI free icons, MIT — https://www.untitledui.com/resources/icons). Consistent `strokeWidth` (use `1.8`) and sizes (16/20/24/28). Never mix in other icon sets or unicode symbols as icons. Icons inherit `currentColor`.
- **Typography:** `Plus Jakarta Sans Variable` (bundled via @fontsource). Titles bold (700) with slight negative tracking; secondary text medium (500) in `--ink-2`/`--ink-3`. Use tabular numbers for times/tempo (`font-variant-numeric: tabular-nums`).
- **Shapes:** cards `--r-lg` (24px), sheets `--r-xl` top corners, pills fully rounded, covers either circles (ref 1) or `--r-md` squares (ref 2/3).
- **Depth:** `--shadow-sm/md/lg` for cards; neumorphic raised/inset (`--shadow-neu`, `--shadow-neu-inset`) only for the few round "hardware" controls (record button, play button, transport).
- **Images:** copyright-free photos (Unsplash/Pexels license or CC0/Public Domain), stored locally under `public/images/`, credited in `docs/CREDITS.md` and the About screen. Use them sparingly (covers, one hero, empty states).
- **Theming:** all colors are CSS custom properties in `src/styles/tokens.css` (light default + dark via `prefers-color-scheme` guarded by `:root:not([data-theme="light"])`, and forced via `:root[data-theme="dark"]`). Never hard-code colors in components. Score SVG must be readable in dark mode (use `currentColor` / token colors).
- **Touch:** min hit target 44×44. Respect `env(safe-area-inset-*)`. Layout works from 320px to 480px wide; on wider screens the app is a centered column (max 480px) on the page background.

### Motion (library: `motion`, import from `motion/react`)
- Purposeful and soft. Durations 180–450 ms. Default ease `[0.22, 1, 0.36, 1]`. Springs for presses/drag: `{ type: 'spring', stiffness: 420, damping: 34 }`.
- Page transitions: fade + 12px vertical slide (tabs) / horizontal slide (push screens).
- Press feedback: `whileTap={{ scale: 0.96 }}` on buttons/cards.
- Signature pieces: the **vinyl record** (spins while listening/processing/playing, tonearm moves in), live **waveform bars**, **progress ring**, staggered list entrance, `layoutId` shared transitions where natural (segmented controls, tab indicator, cover → viewer header).
- Respect reduced motion: `<MotionConfig reducedMotion>` is set globally from settings + OS preference; avoid infinite animations when reduced.

## 3. Tech & conventions

- Vite 8 + React 19 + TypeScript 5.9 (strict). HashRouter (works on static hosting / Capacitor / file URLs). `base: './'`.
- **Machine: Windows 11** (development moved from Ubuntu on 2026-10-27). Project root: `C:/Users/Marcos/Desktop/app-piano`. The Bash tool is Git Bash (POSIX syntax); use absolute paths with forward slashes. Node ≥ 22.12 is required; the default `node` here is v24 (no nvm).
- Commands: `npm run typecheck`, `npm test` (vitest, node env), `npm run build`, `npm run dev` (port 5173). Your own server: `node scripts/serve.mjs start <port>` / `node scripts/serve.mjs stop <port>` (add `--preview` to serve `dist/`). Never kill node processes by name.
- **Do not install npm packages.** Everything needed is installed: react, react-dom, react-router-dom 7, motion, abcjs 6.7, @spotify/basic-pitch, @tensorflow/tfjs 3.21, @tonejs/midi, dexie 4 + dexie-react-hooks, zustand 5, @untitled-ui/icons-react, @fontsource-variable/plus-jakarta-sans, vite-plugin-pwa, vitest, fake-indexeddb, puppeteer-core (Chrome path from `scripts/chrome-path.mjs`). If something is truly missing, say so in your final report instead of installing.
- Machine has `ffmpeg`/`ffprobe`, `python` 3.13 + Pillow (`python3` is a Microsoft Store stub: always call `python`), curl and Chrome. No sox, no ImageMagick: never run `convert` (on Windows it is the system disk tool). Temporary files go to `C:/Users/Marcos/AppData/Local/Temp/pauta/<role>/`, never `/tmp` or the repo.
- Styling: plain CSS files co-located with components (`Component.css`) + tokens. Class names prefixed by module (`lib-`, `vw-`, `cap-`, `home-`, `set-`, `ui-`) to avoid collisions. No CSS frameworks.
- Persisted state: Dexie (library) and the zustand settings store (`src/state/settings.ts`, persisted to localStorage with try/catch). Wrap every storage access in try/catch.
- Keep files focused (< ~400 lines). Comments only where logic is non-obvious.
- Accessibility: every icon-only button has `aria-label` (Spanish). Sliders keyboard accessible.

## 4. Architecture & contracts

```
src/
  main.tsx, App.tsx          shell, routes, theme, transitions (foundation)
  types.ts                   shared domain types (foundation; extend only by adding fields)
  styles/tokens.css          design tokens (foundation)
  styles/global.css          resets, base typography, utilities
  state/settings.ts          zustand settings store (foundation)
  data/db.ts                 Dexie DB + repository functions (foundation)
  data/demos.ts              public-domain demo pieces as NoteEvent[] (engine-score)
  data/seed.ts               seeds demos on first run (library)
  lib/format.ts, lib/id.ts   helpers (foundation)
  assets/images.ts           image manifest (assets)
  ui/                        UI kit (ui)
  engine/audio/              decode, resample, peaks, mic/tab recorder (engine-audio)
  engine/transcribe/         Basic Pitch worker + client (engine-audio)
  engine/score/              analysis, quantization, Score model, ABC/MusicXML/MIDI (engine-score)
  features/home/             Home screen (capture)
  features/capture/          record, import/trim, processing, pipeline (capture)
  features/library/          library screen (library)
  features/viewer/           viewer, playback, settings sheet, export (viewer)
  features/settings/         settings + about (settings)
public/
  models/basic-pitch/        model.json + weights (engine-audio)
  soundfonts/acoustic_grand_piano-mp3/*.mp3   abcjs piano samples, flat note names (assets)
  soundfonts/percussion-mp3/*.mp3             metronome/count-in samples, GM 33/34/37/75/76/77 only (assets)
                             -> use getSoundFontUrl(), SOUNDFONT_VOLUME_MULTIPLIER, METRONOME_DRUM,
                                SOUNDFONT_PITCH_RANGE from src/assets/images.ts
  images/                    copyright-free photos (assets)
  icons/                     PWA icons + favicon (assets)
```

Routes (HashRouter, defined in `App.tsx`; do not rename):
| path | screen | tab bar |
|---|---|---|
| `/` | `HomeScreen` | yes |
| `/library` | `LibraryScreen` | yes |
| `/settings` | `SettingsScreen` | yes |
| `/about` | `AboutScreen` | no |
| `/listen` | `RecordScreen` (mic / tab capture; `?mode=mic|tab`) | no |
| `/import` | `ImportScreen` (trim selected file) | no |
| `/processing` | `ProcessingScreen` | no |
| `/score/:id` | `ViewerScreen` | no |
| `/shared` | `SharedScreen` (entrada de «Compartir con Pauta»: archivo -> `/import`, enlace -> `/link`) | no |
| `/link` | `LinkScreen` (`?url=`: reproductor oficial de YouTube/TikTok y escucha) | no |

The **public APIs** of each module are declared (with doc comments) in:
- `src/types.ts`
- `src/engine/audio/index.ts`, `src/engine/transcribe/index.ts`, `src/engine/score/index.ts`
- `src/data/db.ts`, `src/state/settings.ts`, `src/assets/images.ts`

Owners implement behind those signatures. You may ADD exports and optional fields; do not rename or remove existing ones, and do not change semantics others rely on. Import other modules only through their `index.ts` (or the files listed above).

### Score model essentials
- Tick = one sixteenth note. `TICKS_PER_QUARTER = 4`. 4/4 measure = 16 ticks, 3/4 = 12, 2/4 = 8, 6/8 = 12.
- A `Score` has two staves: right hand (treble) and left hand (bass). Notes with `pitch >= splitPoint` go right.
- Raw `NoteEvent[]` are stored in the library together with `ScoreParams`; the viewer **rebuilds the Score live** from raw notes when filters/params change (this is what makes filters meaningful). `buildScore` must be fast (< 30 ms for 3 000 notes).

## 5. Ownership (who edits what)

| area | owner | files |
|---|---|---|
| foundation | lead | config, `main.tsx`, `App.tsx` routes, `types.ts`, `tokens.css`, `db.ts`, `settings.ts`, `lib/*` |
| UI kit & shell polish | ui | `src/ui/**`, `src/styles/global.css`, transitions/frame parts of `App.tsx` (keep routes) |
| assets | assets | `public/images/**`, `public/soundfonts/**`, `public/icons/**`, `src/assets/images.ts`, `docs/CREDITS.md`, icon `<link>`s in `index.html` |
| audio + transcription | engine-audio | `src/engine/audio/**`, `src/engine/transcribe/**`, `public/models/**`, `test/fixtures/**`, `scripts/fixtures/**` |
| score engine | engine-score | `src/engine/score/**`, `src/data/demos.ts` |
| home + capture | capture | `src/features/home/**`, `src/features/capture/**` |
| library | library | `src/features/library/**`, `src/data/seed.ts` |
| viewer | viewer | `src/features/viewer/**` |
| settings | settings | `src/features/settings/**` |
| share | share | `src/features/share/**`, `public/share-target-sw.js`, `scripts/e2e-share.mjs` |

Never edit files you don't own. If you need a change in someone else's module, work around it locally and list the request in your final report.

## 6. Quality bar
- `npm run typecheck` passes with zero errors; `npm test` passes; `npm run build` succeeds.
- No console errors on load. Graceful errors (toast/inline) for: mic permission denied, unsupported file, decode failure, model load failure, empty transcription (no notes detected).
- Everything works offline after first load (PWA precache of model, soundfont, images, fonts).
- Copyright: no real copyrighted song titles/artists/lyrics in demo data or placeholders. Demo pieces are public-domain compositions.
- Attribution: the piano soundfont (FluidR3_GM by Frank Wen, rendered by midi-js-soundfonts) is CC BY 3.0 — the About screen must credit it (see docs/CREDITS.md). Image credits come from `allImages`.
