# Pauta UI kit

Everything is exported from `src/ui/index.tsx`: `import { Page, TopBar, Button } from '../../ui'`.
Live gallery (dev server only): `#/__kit`, plus layout demos `#/__kit?demo=screen` and `#/__kit?demo=tab`.
Previews: `docs/screenshots/ui-*.png`.

Rules that keep the app coherent:
- Use kit components before writing your own. Feature CSS only lays them out (gaps, margins, grids).
- Colors only from tokens (`src/styles/tokens.css` + `src/ui/kit.css`). Never hex in feature CSS.
- Icons only from `@untitled-ui/icons-react`, always through `Icon` / `IconButton` / an `icon` prop.
  Sizes 16 / 20 / 24 / 28. There is no bare pause icon in the set: use `PauseIcon` from the kit.
- Copy is Spanish, short. No emojis. Icon-only controls need a Spanish `label` / `ariaLabel`.
- Accent (`--accent`) only for progress, active states and the one primary action of a screen. Filled accent
  surfaces use `--accent-gradient` (indigo to violet, one colour family) with `--on-accent` text.
- Every kit control already makes its interface sound (see "Interface sounds"); feature code only plays the
  screen-level cues (`success`, `error`, `recordStop`) and blocks sounds while recording or playing.

## Design language (2026-10-28 redesign)

- **Depth and light:** `AppFrame` paints a persistent `Backdrop` behind every screen: three soft aurora blobs of the
  accent family drifting very slowly (compositor transforms, still under reduced motion) and a fine film grain.
  Cards and pills carry `--edge` (hairline) and filled pills `--highlight` (top light).
- **Colour story:** ink for text and the main ink pill; `--accent-gradient` for the one primary action, the active
  tab, toggles that are on, slider fills, progress and celebrations; `--accent-glow` for halos. No other hues.
- **Type:** tab titles `--fs-display` 34 px at `--fw-display` 800 with -0.04em; group labels are small uppercase
  eyebrows (`ui-t-eyebrow`); `ui-t-gradient` for one celebrating word or number.
- **Space:** unchanged. One idea per screen; ornament comes from light and motion, not from more elements or text.

---

## Screen recipes

### Tab screen (`/`, `/library`, `/settings`)
```tsx
<Page variant="tab" tabBar>
  <TopBar large title="Biblioteca" right={<IconButton icon={DotsHorizontal} label="Más opciones" onClick={…} />} />
  …content…
</Page>
```
App renders the floating `TabBar` itself on these three paths. `tabBar` adds bottom room for it.

### Push screen (everything else)
```tsx
<Page>
  <TopBar left={<BackButton />} title="Recortar" subtitle="archivo.m4a" right={…} sticky />
  …content…
  <BottomBar>
    <Button variant="accent" size="lg" icon={MusicNote01}>Transcribir</Button>
  </BottomBar>
</Page>
```
- `Page` is a full-height flex column (`min-height: 100dvh`). `BottomBar` must be its **last child**:
  it is pushed to the bottom when content is short and sticks above the safe area when content scrolls,
  with a soft fade over the content. Buttons inside share the width (`flex: 1`).
- Do not use `position: fixed` inside a `Page` (pages are transformed during transitions); use
  `BottomBar`, `TopBar sticky`, or a portal (`Sheet`, dialogs, toasts already are).
- A new screen starts scrolled to the top (`keepScroll` to opt out).

### Spacing scale
Tokens: `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 · `--s-6` 24 · `--s-8` 32 · `--s-10` 40 · `--s-14` 56 · `--s-18` 72 · `--gutter` 20.
- Page side padding: `--gutter` (given by `Page`).
- Between unrelated blocks / sections: `--s-8` to `--s-10`. Let screens breathe; one idea per screen.
- Section title to content: `SectionHeader` already has `--s-2` below; lists of cards: gap `--s-3`.
- Card padding: `md` (16) for rows/compact, `lg` (24) for hero content.
- Radii: cards `--r-lg` 24, sheets `--r-xl` 32, inputs `--r-md` 16, pills `--r-pill`.

### Utility classes (global.css)
`ui-t-display | ui-t-title | ui-t-h2 | ui-t-body | ui-t-caption | ui-t-micro` (type scale),
`ui-t-muted` (`--ink-2`), `ui-t-faint` (`--ink-3`), `tabular` (tabular numbers for times/tempo),
`visually-hidden`, `ui-stack` (flex column, `--gap` default 16px), `ui-row-flex` (row, gap 12), `ui-spacer`.

---

## Layout

| export | usage |
|---|---|
| `AppFrame` | Used once by App. Centered column (max `--app-max`) over the ambient `Backdrop`, mirrors reduced motion to `<html data-reduce-motion>`. Own stacking context (`isolation`). |
| `Backdrop` | Rendered by AppFrame. Aurora (`--aurora-1..3`) + grain (`--grain-opacity`), fixed to the column. |
| `Intro` | Rendered once by App, after AppFrame. Launch intro (see "Launch intro"). |
| `Page({ children, tabBar?, variant?: 'tab'\|'push' = 'push', padded? = true, keepScroll?, className?, style? })` | `<Page variant="tab" tabBar>…</Page>`. Motion root for route transitions (push slides with direction: back = reverse). |
| `TopBar({ title?, subtitle?, left?, right?, large?, sticky? })` | `<TopBar left={<BackButton />} title="Ajustes" />`. `large` = big left title (tab screens). `sticky` = frosted once scrolled, covers the status bar. Left/right slots are optically aligned for ghost `IconButton`s. |
| `BackButton({ fallback = '/', label = 'Atrás' })` | `<BackButton fallback="/library" />`. Goes back in history, or replaces to `fallback` on a deep link. |
| `BottomBar({ children })` | `<BottomBar><Button size="lg">Guardar</Button></BottomBar>` (last child of `Page`). |
| `SectionHeader({ title, action?: { label, onClick } })` | `<SectionHeader title="Recientes" action={{ label: 'Ver todo', onClick }} />` |
| `TabBar({ visible, current?, floating? = true })` | Rendered by App. `current`/`floating` exist only for previews. |

## Buttons

| export | usage |
|---|---|
| `Button({ children, variant: 'ink'\|'accent'\|'secondary'\|'ghost'\|'danger' = 'ink', size: 'sm'\|'md'\|'lg' = 'md', icon?, iconRight?, full?, loading?, disabled?, onClick?, type?, ariaLabel?, ref? })` | `<Button variant="accent" size="lg" full icon={Microphone01}>Escuchar</Button>`. Heights 36 / 44 / 56. `ink` = black pill (main action), `accent` = the one primary action (gradient + glow), `secondary` = white raised pill. `loading` keeps the width and shows a spinner. Lifts 1.5 px on hover (pointer devices) with a light sweep on filled pills; presses to 0.96. `sound` (default `'tap'`, `false` = none): use `false` for buttons whose action opens the microphone or starts playback. |
| `IconButton({ icon, label, onClick?, variant: 'ghost'\|'surface'\|'neu'\|'ink'\|'accent' = 'ghost', size: 'sm'\|'md'\|'lg'\|'xl' = 'md', active?, pressed?, loading?, disabled?, iconSize?, ref? })` | `<IconButton icon={Share07} label="Compartir" onClick={share} />`. Sizes 36 / 44 / 56 / 76 (sm keeps a 44px hit area). `neu` = soft neumorphic hardware control (record, play, transport). `active` = accent tint (or pressed-in for neu); `pressed` sets `aria-pressed` for toggles. `loading` = spinner in place of the icon, inert meanwhile (`aria-busy`). `sound`: default `'tap'`, or `toggleOn`/`toggleOff` when `pressed` is set; `false` = none. |
| `PauseIcon` | `<IconButton icon={playing ? PauseIcon : Play} label={playing ? 'Pausar' : 'Reproducir'} variant="neu" size="xl" />` |

## Surfaces & lists

| export | usage |
|---|---|
| `Card({ children, padding: 'none'\|'sm'\|'md'\|'lg' = 'md', interactive?, onClick?, glass?, ariaLabel?, className?, style?, ...pressHandlers })` | `<Card onClick={open} ariaLabel={title}>…</Card>`. With `onClick` it is a keyboard-accessible button with press scale. `glass` = frosted (over images). Accepts `useLongPress` handlers. |
| `ListRow({ leading?, title, subtitle?, trailing?, onClick?, chevron?, tone?: 'danger', disabled?, current?, wrap?, ariaLabel?, children?, ...pressHandlers })` | `<ListRow leading={<Cover seed={id} src={src} size={48} />} title="Minueto en Sol" subtitle="Sol mayor · 3/4" trailing="1:12" onClick={open} />`. Becomes a `<button>` with `onClick`; never put a Toggle/Button in `trailing` of a clickable row. `children` = full-width content under the title line (sliders). `wrap` lets title and subtitle take more lines instead of an ellipsis (narrow phones). |
| `SettingsGroup({ title?, icon?, children, footer? })` | `<SettingsGroup title="Reproducción" icon={Headphones01}><ListRow title="Metrónomo" trailing={<Toggle … />} /></SettingsGroup>`. White card, hairlines between direct children. Title = uppercase eyebrow; `icon` adds a small accent-gradient tile before it. |
| `EmptyState({ image?: string \| ReactNode, title, action?: ReactNode \| { label, onClick, icon? } })` | `<EmptyState image={<EmptyArt kind="vinyl" />} title="Aún no hay partituras" action={{ label: 'Escuchar', onClick, icon: Microphone01 }} />`. One line, one action; title and action rise in after the art. |
| `EmptyArt({ kind?: 'vinyl' \| 'search' \| 'score' })` | Generated illustration for empty states (no photo): staff lines draw in, a record rolls in and turns slowly / a lens drifts / notes float. Still under reduced motion. |
| `Celebration({ size?, burstKey? })` | One-shot burst of accent dots and note heads plus a shock ring, centered in its positioned parent. Mount it when something is ready (Processing uses it with the `success` sound). Only the ring under reduced motion. |

Settings recipes:
```tsx
<ListRow title="Reducir movimiento" trailing={<Toggle checked={v} onChange={set} ariaLabel="Reducir movimiento" />} />
<ListRow title="Tema" trailing={<Segmented size="sm" value={t} onChange={setT} options={…} />} />
<ListRow title="Sensibilidad" trailing={`${Math.round(s * 100)} %`}>
  <Slider value={s} min={0} max={1} step={0.05} onChange={setS} ariaLabel="Sensibilidad" />
</ListRow>
<ListRow title="Acerca de" chevron onClick={() => navigate('/about')} />
<ListRow title="Borrar biblioteca" tone="danger" onClick={askConfirm} />
```

## Overlays (all portal to `<body>`, lock page scroll, trap focus, close on Escape)

| export | usage |
|---|---|
| `Sheet({ open, onClose, title?, children, footer?, height?: 'auto'\|'tall', ariaLabel?, onExitComplete? })` | `<Sheet open={open} onClose={close} title="Ajustes" footer={<Button full size="lg" onClick={close}>Listo</Button>}>…</Sheet>`. Drag the handle down to dismiss; content scrolls inside. Keep it mounted and toggle `open` (exit animation). |
| `ActionSheet({ open, onClose, title?, actions: { key?, label, icon?, onSelect, tone?: 'danger', disabled? }[], cancelLabel? })` | `<ActionSheet open={o} onClose={c} title={doc.title} actions={[{ label: 'Renombrar', icon: Edit02, onSelect: rename }]} />`. Selecting closes first, then runs `onSelect` after the sheet has left (safe to open a dialog from it). |
| `ConfirmDialog({ open, title, message?, confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', tone?: 'danger', onConfirm, onCancel })` | `<ConfirmDialog open={o} title="¿Eliminar partitura?" message="No se puede deshacer." confirmLabel="Eliminar" tone="danger" onConfirm={del} onCancel={close} />`. You close it in both callbacks. |
| `PromptDialog({ open, title, initialValue, placeholder?, confirmLabel = 'Guardar', cancelLabel?, onConfirm(value), onCancel, maxLength? })` | `<PromptDialog open={o} title="Renombrar" initialValue={doc.title} maxLength={80} onConfirm={(v) => save(v)} onCancel={close} />`. Autofocus + select, Enter submits, value is trimmed and non-empty. |
| `ToastProvider`, `useToast()` | `const toast = useToast(); toast.show('Partitura guardada', { tone: 'success' })`. Tones `neutral` / `success` / `danger`; optional `duration` ms (default 2600). One pill at the top; a new one replaces the old. Use `danger` for errors (mic denied, unsupported file…). |

## Inputs

| export | usage |
|---|---|
| `Segmented<T>({ options: { value, label?, icon?, ariaLabel? }[], value, onChange, size?: 'sm'\|'md', full?, ariaLabel? })` | `<Segmented full value={hands} onChange={setHands} ariaLabel="Manos" options={[{ value: 'both', label: 'Ambas' }, …]} />`. Radio group with arrow keys; sliding indicator; the chosen icon turns accent, a pressed segment dips; `select` sound. Icon-only options need `ariaLabel`. `full` segments use compact side padding (8 px), so icon + label fit three across at 390 px. |
| `Slider({ value, min, max, step = 1, onChange, onChangeEnd?, ariaLabel, format?, showValue?, disabled? })` | `<Slider value={speed} min={50} max={150} step={5} onChange={setSpeed} onChangeEnd={persist} ariaLabel="Velocidad" format={(v) => `${v} %`} showValue />`. Native range (keyboard, screen readers). `onChangeEnd` fires once on release: use it for expensive work (rebuilding the score). |
| `RangeSlider({ value: [a, b], min, max, step = 1, minGap?, onChange, onChangeEnd?, ariaLabel, labels? = ['inicio', 'fin'], format? })` | `<RangeSlider value={[start, end]} min={0} max={dur} step={0.1} minGap={1} onChange={setSel} ariaLabel="Selección" format={formatTime} />` |
| `Toggle({ checked, onChange, ariaLabel?, ariaLabelledBy?, disabled?, id? })` | `<Toggle checked={metronome} onChange={setMetronome} ariaLabel="Metrónomo" />`. Gradient track when on, the knob stretches while pressed, `toggleOn`/`toggleOff` sound. |
| `Stepper({ value, min, max, step = 1, onChange, format?, ariaLabel, disabled? })` | `<Stepper value={bpm} min={40} max={220} onChange={setBpm} ariaLabel="Tempo" format={(v) => `${v} ppm`} />`. Press and hold repeats; value is a spinbutton (arrows, Home/End). Decimal steps are rounded. |
| `Chip({ children, selected?, onClick?, icon?, disabled? })`, `ChipRow({ children, ariaLabel? })` | `<ChipRow ariaLabel="Filtros"><Chip selected={f === 'fav'} onClick={() => setF('fav')} icon={Star01}>Favoritas</Chip></ChipRow>`. ChipRow scrolls horizontally edge to edge (bleeds into the gutters, faded edges). Inside a `Sheet`, unselected chips sit on `--fill` instead of white. |
| `SearchField({ value, onChange, placeholder = 'Buscar', onClear?, autoFocus? })` | `<SearchField value={q} onChange={setQ} placeholder="Buscar partituras" />`. Escape or the X clears. |

## Media & signature pieces

| export | usage |
|---|---|
| `Cover({ src?, seed, size, shape?: 'circle'\|'rounded' = 'rounded', spinning?, alt?, layoutId?, className?, style? })` | `<Cover src={getCover(doc.coverId)?.src} seed={doc.id} size={56} />`. Without `src` (or if it fails) draws a soft token-colored cover with a staff motif from `seed`. Radius follows size (8 / 12 / 16). `size` also takes a CSS length (`'var(--lib-cover)'`, `'100%'`; radius 12, override with `style.borderRadius`). `layoutId` for shared transitions. |
| `Vinyl({ size = 260, spinning?, speed?: 'idle'\|'slow'\|'normal', label?, labelSrc?, tonearm?: 'rest'\|'play'\|'hidden' = 'hidden', progress?, plinth? = true, halo?: 'breathe'\|'live', level?: MotionValue<number>, onClick?, sound?, ariaLabel? })` | `<Vinyl size={280} spinning={isPlaying} tonearm={isPlaying ? 'play' : 'rest'} progress={t / dur} labelSrc={cover} />`. The record, plinth and arm fit inside `size` x `size`. Spin eases in/out (never jumps); none with reduced motion. `idle` = a barely-there drift (resting hero), `slow` for listening/processing. `halo="breathe"` = slow accent glow with ripples inviting a tap (Home); `halo="live"` follows `level` (a MotionValue fed from the meter, so nothing re-renders at 30 Hz) with quicker ripples (recording). Tapping plays `sound` (default `'vinyl'`, a short piano note). |
| `Waveform({ peaks, progress?, selection?: [s, e], height = 72, barWidth = 3, gap = 2, normalize? = true, animate? = true, ariaLabel? })` | `<Waveform peaks={peaks} selection={[s / dur, e / dur]} progress={pos / dur} height={64} />`. Canvas, device-pixel crisp, fills its container width, re-themes itself. Played part = accent, outside selection = dimmed. Bars grow in when the data changes; pass `animate={false}` for live data that grows while recording. |
| `LiveBars({ level, bars = 24, height = 48, active? = true, className? })` | `<LiveBars level={rms} active={recording} />`. Smooth attack/decay, taller in the center. Color = `currentColor` (default `--ink-2`; set `color` via className to change). |
| `ProgressRing({ value, size = 280, stroke = 4, children?, indeterminate?, glow? = true, ariaLabel? })` | `<ProgressRing value={p} size={220}><span className="tabular">{Math.round(p * 100)} %</span></ProgressRing>`. Accent-gradient arc with a soft halo and a glowing head; one spring drives the arc and the head. |
| `Spinner({ size = 20, label? })` | `<Spinner size={18} />` (decorative) or `<Spinner label="Cargando" />` (announced). |
| `Icon({ icon, size = 24, className?, style? })` | `<Icon icon={MusicNote01} size={20} />`. Decorative; stroke width unified by CSS. |

## Hooks & motion

| export | usage |
|---|---|
| `useLongPress(cb, ms = 500)` | `const lp = useLongPress(() => openActions(doc)); <Card onClick={open} {...lp}>`. Touch hold, mouse hold or right click; swallows the click that follows. |
| `useReducedMotionPref()` | `const reduced = useReducedMotionPref()` (OS setting or Ajustes > Reducir movimiento). Use it to skip infinite/decorative animations. |
| `useElementWidth(ref)` | `const width = useElementWidth(paperRef)`: CSS px, kept current with a ResizeObserver (0 until mounted). |
| `ease`, `spring`, `softSpring`, `durations`, `tapScale`, `breathe` | `transition={spring}`, `whileTap={tapScale}`. `breathe` = endless mirrored 3.6 s loop for glows (skip it under reduced motion). |
| `reveal(index, distance?)` | `<motion.p {...reveal(2)}>`: the i-th block of a screen rising in (delay 0.05 + 0.06 x i). |
| `pageVariants` | Used by `Page`. |
| `fadeUp(delay?, distance?)` | `<motion.div {...fadeUp(0.08)}>` |
| `listContainer`, `listItem` | `<motion.ul variants={listContainer} initial="hidden" animate="show">` + `<motion.li variants={listItem}>` (stagger 0.05 s, rise 14 px with a 0.98 scale). The stagger does not propagate through an `AnimatePresence` between them: inside one, give each item its own `initial`/`animate` with an index-based delay. |
| `cx(...classes)` | `className={cx('lib-card', fav && 'is-fav')}` |

Performance: endless loops (backdrop, halos, the play pulse) animate a full `transform` string and `opacity`, which
motion hands to the compositor (WAAPI); never animate layout properties in a loop.

### Interface sounds (`src/ui/sound.ts`)

Synthesized with Web Audio by our own code (no samples). Sounds: `tap`, `select`, `toggleOn`, `toggleOff`,
`recordStart`, `recordStop`, `success`, `error`, `vinyl`.
- `playUiSound(name, { force? })`: no-op when `Settings.uiSounds` is off, while blocked, or without Web Audio.
  `force` ignores blockers (only for the stop cue right after a recorder stopped: it stops capturing synchronously).
- `useUiSoundsBlocked(active)`: silences every interface sound while `active`. Required while the microphone is open
  (RecordScreen, the link take) and while a score plays (viewer). Buttons that open the microphone pass `sound={false}`.
- The AudioContext is separate from the recorder's and the viewer's, created on the first gesture
  (`installUiSoundUnlock()`, called by App). Level `UI_SOUND_LEVEL` (0.26) scaled by `playbackVolume`.
- Already wired: Button, IconButton, Card, ListRow (clickable), Toggle, Segmented, Chip, Stepper, TabBar, ActionSheet
  items, Vinyl (tap), danger toasts (`error`). Screens add `success`/`error` (Processing) and `recordStop`.

### Launch intro (`Intro`, policy in `src/ui/introPolicy.ts`)

Five staff lines draw in, a record rolls onto them and the wordmark rises, then it opens into the app (~1.35 s). The
app renders and loads underneath; a tap or any key skips it. Once per launch (module state: a reload is a new launch,
navigation is not), only when the app opens on a main tab (deep links such as `/score/…`, `/link`, `/shared` open
straight away), a 0.38 s fade under reduced motion, never for automated browsers (`navigator.webdriver`) unless
`localStorage['pauta.intro'] = 'always'` (previews, videos).

Motion is global: App sets `<MotionConfig reducedMotion>`; route transitions use `AnimatePresence mode="wait"` keyed by pathname, so keep page exit work light. The app column clips horizontal overflow (`overflow-x: clip` on `.ui-frame`), so push slides never widen the page.

---

## Extra tokens (`src/ui/kit.css`, light + dark)

| token | for |
|---|---|
| `--accent-2`, `--accent-gradient`, `--accent-glow`, `--on-accent` (tokens.css) | violet end of the accent family, filled accent surfaces, halos, text on the gradient |
| `--edge`, `--highlight` (tokens.css) | hairline of raised surfaces, top light of filled pills |
| `--aurora-1..3`, `--grain-opacity` (tokens.css) | Backdrop |
| `--success-soft`, `--fw-display`, `--ease-spring` (tokens.css) | soft success fill, display weight, overshooting ease |
| `--raised`, `--knob`, `--track`, `--fill`, `--press` | segmented indicator, toggle/slider knobs, slider/toggle track, translucent control fill, pressed rows |
| `--glass-border`, `--glass-blur`, `--bar-bg` | glass surfaces, frosted sticky top bar |
| `--bg-top`, `--bg-bottom`, `--page-outer` | first/last stop of `--bg-gradient` (fades), desktop page background |
| `--danger-ink` | text on `--danger` |
| `--shadow-ink`, `--shadow-ink-sm`, `--shadow-accent`, `--shadow-knob`, `--shadow-float` | elevation of ink/accent buttons, knobs, floating bars |
| `--vinyl*`, `--arm`, `--arm-shadow`, `--metal*` | turntable hardware |
| `--cover-staff`, `--cover-note`, `--cover-tone-0..5` | generated covers |
| `--wave`, `--wave-dim` | waveform bars |
| `--z-bar` 20, `--z-tabbar` 40, `--z-sheet` 60, `--z-dialog` 70, `--z-toast` 90 | layers |
