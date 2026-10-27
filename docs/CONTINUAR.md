# Continuar el desarrollo de Pauta

Documento de traspaso escrito el 2026-10-27 (10:40) al pausar el trabajo en el PC del laboratorio.
**Retomado en Windows el 2026-10-27 (13:00):** entorno preparado, typecheck/tests/build verificados y prompts adaptados (sección 3). El avance por fases se anota en la sección 4.
**Claude: si estás leyendo esto al empezar una sesión, sigue la sección 1 antes de hacer nada más.**

---

## 1. Al retomar (instrucciones para Claude)

1. Lee, en este orden: este archivo → `docs/BRIEF.md` (producto, diseño, arquitectura, propiedad de archivos) → `docs/UI-KIT.md` (API del kit) → `docs/CLIENT-FEEDBACK.md` → `docs/agents/reports/*.json` (informes de los agentes que terminaron) → los contratos (`src/types.ts`, `src/engine/*/index.ts`, `src/data/db.ts`, `src/state/settings.ts`, `src/assets/images.ts`).
2. Prepara el entorno (sección 3) y verifica: `npm run typecheck && npm test && npm run build`.
3. Mira las referencias de diseño del cliente en `docs/reference/` y las previsualizaciones ya enviadas en `docs/preview/` para recuperar el contexto visual.
4. Retoma el plan de la sección 5. El cliente quiere trabajo con **varios agentes en paralelo** y un **agente de enlace** que le vaya enseñando el avance (sección 6).
5. Antes de dar nada por terminado, comprueba que el estado descrito aquí sigue siendo cierto en el código: puede haber cambios posteriores a este documento.

## 2. Qué es

App móvil (PWA instalable, preparada para Capacitor) que **escucha audio o vídeo y genera la partitura de piano**. Transcripción en el dispositivo con Basic Pitch (TF.js en un Web Worker). Análisis de tempo, tonalidad y compás. Cuantización a gran pentagrama (mano derecha/izquierda). Render y reproducción con abcjs. Biblioteca local (IndexedDB/Dexie). Visor con play, ajustes y filtros. Exportación a PDF/MusicXML/MIDI/ABC. Interfaz en español, estilo claro y aireado basado en las tres referencias del cliente.

## 3. Puesta en marcha en otro ordenador

**El siguiente ordenador es Windows** (el desarrollo empezó en Ubuntu 24.04). El código de la app es multiplataforma; lo que cambia es el entorno.

- **Node ≥ 22.12** (Vite 8 lo exige).
  - Windows: instalador LTS de nodejs.org o `winget install OpenJS.NodeJS.LTS`. Comprueba `node -v` ≥ 22.12.
  - Linux: `nvm install 22 && nvm use 22` (`.nvmrc` = 22).
- **Git para Windows**: Claude Code lo usa para su shell (Git Bash).
  - Clona por **HTTPS**: `git clone https://github.com/gemarcos/app-piano.git` (el repo se llama `app-piano`). Git Credential Manager pide iniciar sesión en el navegador. La clave SSH se quedó en el PC Linux. Si el PC tiene varias cuentas de GitHub guardadas, fija la del repo: `git config credential.username gemarcos` (así no pregunta qué cuenta usar).
  - `.gitattributes` fuerza LF en el repo, así que los `.sh` no se rompen.
- `npm install` y después `npm run dev` (puerto 5173, `--host` para abrirlo desde el móvil en la misma red Wi-Fi; Windows puede pedir permiso en el firewall).
- **Chrome sin interfaz** (`scripts/shot.mjs`, `scripts/fixtures/check-transcription.mjs`): ambos usan `scripts/chrome-path.mjs`, que lo encuentra solo en Windows (Program Files, LocalAppData y Edge como alternativa), Linux y macOS. Si no lo encuentra, define `CHROME_PATH`. En PowerShell: `$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"`.
- **Herramientas de los agentes** (opcionales en Windows):
  - `ffmpeg` (vídeos de animaciones para el cliente): `winget install Gyan.FFmpeg`.
  - Python 3 + Pillow (tableros de previsualización): `winget install Python.Python.3.12` y después `pip install pillow`.
  - `sox` solo hace falta para regenerar los audios de prueba, que ya están en `test/fixtures/`.
- **Prompts de los agentes: adaptados a Windows el 2026-10-27** (`docs/agents/pauta-build.workflow.js`, `docs/agents/client-liaison.md` y la sección 3 del BRIEF):
  - raíz `C:/Users/Marcos/Desktop/app-piano`, Git Bash, Node 24 sin nvm;
  - temporales en `C:/Users/Marcos/AppData/Local/Temp/pauta/<rol>/` (el scratchpad de la sesión tiene una ruta tan larga que rompe herramientas con el límite de 260 caracteres de Windows);
  - servidores con `node scripts/serve.mjs start|stop|status <puerto>` (solo mata el proceso node que escucha en ese puerto; `--preview` sirve `dist/`). Nunca matar procesos por nombre;
  - el agente de enlace espera entre rondas con `node scripts/wait-for-changes.mjs` y lee el journal del lead en `C:/Users/Marcos/AppData/Local/Temp/pauta/journal.jsonl`;
  - en Windows `python3` es un acceso directo de la Microsoft Store: hay que llamar a `python`. `convert` es la herramienta de discos de Windows, no ImageMagick (no está instalado): las imágenes se componen con Pillow.
  - Esta sesión no tiene ejecutor de workflows: el lead lanza cada agente con el Agent tool (COMMON + prompt del rol + anexo de la fase), en el orden que documenta el final del workflow.
- Los permisos de micrófono y la captura de pestaña funcionan igual en Chrome y Edge de Windows. Las pruebas e2e con audio falso usan flags de Chrome que también valen en Windows (`--use-file-for-fake-audio-capture=C:\\ruta\\melody-bass.wav`).

## 4. Estado por módulo (al pausar)

Verificado al pausar: `tsc --noEmit` con **0 errores**; `vitest` con **23 tests OK** (2 archivos, motor de audio). El build de producción funcionaba con los cimientos (no se volvió a ejecutar tras los últimos cambios).

| Módulo | Dueño | Estado | Qué falta |
|---|---|---|---|
| Cimientos: config, rutas, tipos, tokens, DB, ajustes, lib | lead | **Hecho** | — |
| Kit de interfaz `src/ui/**` + galería `#/__kit` (solo dev) + `docs/UI-KIT.md` | ui | **Hecho** (informe en `docs/agents/reports/ui.json`) | Ver «Peticiones abiertas» |
| Recursos: 12 fotos libres, piano offline (89 mp3) + percusión del metrónomo, iconos de la app, `docs/CREDITS.md` | assets | **Hecho** (informe en `docs/agents/reports/assets.json`) | — |
| Motor de audio + transcripción `src/engine/audio/**`, `src/engine/transcribe/**`, modelo en `public/models/basic-pitch/`, fixtures `test/fixtures/` (incluidas variantes con eco «-room»), harness `test/harness/transcribe.*`, `scripts/fixtures/*` | engine-audio | **Hecho** (fase A, 2026-10-27; informe en `docs/agents/reports/engine-audio.json`) | — Calibrado: F1 medio 0,920 (sintéticos 0,971; piano real 0,869, con 5 fixtures nuevas `piano-*` renderizadas con el soundfont), `scale.wav` 1,00, `silence.wav` 0 notas, `scale.mp4` se decodifica. Worker en su propio chunk y tfjs fuera del resto: `node scripts/fixtures/check-bundle.mjs` (repetirlo en la fase C). Límite conocido de Basic Pitch: acordes de piano real F1 0,76–0,80 (fantasmas de octava). |
| Motor de partituras `src/engine/score/**` + 3 demos de dominio público en `src/data/demos.ts` (Oda a la alegría, Minueto en Sol de Petzold, Preludio en Do de Bach) | engine-score | **Hecho** (fase A, 2026-10-27; informe en `docs/agents/reports/engine-score.json`) | — 111 tests (lista J completa) y 5 bugs reales corregidos (compás de vals, tempo de melodías rápidas, acordes con dos notas en la misma letra, alteraciones tras ligadura, bajo en «fácil»). Nombres de nota a 8 pt y solo uno por pulso en pasajes de semicorcheas (`nameEveryNote` lo desactiva). `suggestMeasuresPerLine` para el visor. Límites: ambigüedad de tempo doble/mitad en algunas texturas, una sola voz por pentagrama. |
| Ajustes y Acerca de `src/features/settings/**` | settings | **Hecho** (fase B, 2026-10-27; informe en `docs/agents/reports/settings.json`) | — «Restaurar ejemplos» depende de `restoreDemos()` (library). Peticiones opcionales al kit para la fase D: padding compacto en `Segmented full` con iconos y prop `wrap` en `ListRow` (Ajustes los resuelve en su CSS). |
| Biblioteca + `src/data/seed.ts` | library | **Hecho** (fase B, 2026-10-27; informe en `docs/agents/reports/library.json`) | — Siembra de las 3 demos una sola vez (también con StrictMode), «Restaurar ejemplos» ya funciona. Para la fase D: `useAllScores()` carga todas las notas de cada partitura (una consulta solo de resúmenes aligeraría bibliotecas grandes); peticiones opcionales al kit (chips en hojas en oscuro, `Cover` con tamaño CSS, documentar que el escalonado no atraviesa `AnimatePresence`). |
| Visor + reproducción + hoja de ajustes/filtros + exportación | viewer | **Hecho** (fase B, 2026-10-27; informe en `docs/agents/reports/viewer.json`) | — Reproducción propia sobre el buffer que renderiza abcjs (bucles exactos, A–B, búsqueda instantánea), metrónomo y cuenta previa con el soundfont local, sonido «Original», PDF por sistemas. abcjs se carga bajo demanda en su propio chunk (509 KB). Para la fase D: el buffer ocupa ~23 MB por 90 s a 1× (mucho más en piezas largas a velocidad lenta); cambiar velocidad/metrónomo durante la reproducción deja un hueco de 60–150 ms; solo verificado sin altavoces (headless). |
| Inicio + escuchar/importar/procesar | capture | **Hecho** (fase B, 2026-10-27; informe en `docs/agents/reports/capture.json`) | — `node scripts/e2e-capture.mjs` (y `--preview`) 6/6: importar `scale.wav` y `scale.mp4`, micrófono falso, toma corta, cancelar. El vinilo continúa entre Inicio, Grabar y Procesando (FLIP propio, `HeroVinyl`). Para la fase D: en iOS el medidor de nivel puede quedarse quieto porque su AudioContext se crea fuera del gesto (sin verificar en dispositivo); el constructor de AudioContext bloquea 80–240 ms (por eso la grabación arranca 520 ms después de entrar); la captura de pestaña no se probó de principio a fin (headless no puede elegir pestaña). |
| Integración: e2e `scripts/e2e.mjs`, capturas finales, README | integration | **Hecho** (fase C, 2026-10-27; informe en `docs/agents/reports/integration.json`) | — `node scripts/e2e.mjs` 15/15 contra el build de producción (incluye exportaciones y modo sin conexión), README en español, `docs/screenshots/final-*.png` (13 pantallas en claro y oscuro). Arreglados: zoom en móvil durante las transiciones, guardado obsoleto en el visor, hueco en blanco entre pantallas (de ~150 ms a ~50 ms; Inicio→Grabar sigue en ~124 ms). Para la fase D: resúmenes en `useAllScores()`, Inicio→Grabar, pruebas en dispositivos reales, ejecutar el e2e en Linux; refrescar capturas finales y README tras la fase de calidad y «Compartir con Pauta». |
| Calidad: audio (petición del cliente, 16:20) | audio-accuracy | **Hecho** (informe en `docs/agents/reports/audio-accuracy.json`) | — Benchmark realista `test/fixtures/real/` (12 audios), compensación de afinación y velocidades por intensidad: F1 0,744 → 0,873. Onsets and Frames (modelo de piano) evaluado aparte: 0,940; el cliente lo aprobó (19:30) y lo integró piano-model (fila siguiente). |
| Modelo de piano (decisión del cliente, 19:30) | piano-model | **Hecho** (informe en `docs/agents/reports/piano-model.json`) | — Onsets and Frames reescrito en `src/engine/transcribe/oaf/` (Apache-2.0) con pesos de 16,5 MB en `public/models/onsets-frames/`: fuera de la precarga, se descargan la primera vez y quedan en Cache Storage. `Settings.transcriptionModel` ('auto', 'piano' o 'fast'): 'auto' comprueba WebGL 2 y la velocidad antes de descargar, y si no basta usa Basic Pitch. F1 realista 0,873 → 0,936; grabación real de Liebestraum ±50 ms 0,534 → 0,666. `scripts/fixtures/align-reference.mjs` alinea una partitura MIDI con una grabación. Sin probar en móviles reales. Pesos entrenados con MAESTRO (CC BY-NC-SA): consulta legal antes de cualquier uso comercial. Para la fase D: línea opcional en Procesando con el modelo usado. |
| Calidad: sonido (peticiones del cliente, 16:20 y 19:40) | piano-sound | **Hecho** (informe en `docs/agents/reports/piano-sound.json`) | — «Piano de cola» (Salamander Grand V3, CC BY 3.0) con pedal, caída natural y reverberación de sala propia; «Piano clásico» (FluidR3, el de la primera versión) como alternativa en «Timbre» (visor y Ajustes). |
| Calidad: partitura (peticiones del cliente, 16:20, 16:35 y 16:45) | score-accuracy | **Hecho** la primera ronda (informe en `docs/agents/reports/score-accuracy.json`); **en curso** la segunda: ritmo con la grabación real de Liebestraum (19:55) | — Velocidades, pedal (CC64 y «Ped.»), dos voces por pentagrama, tempo con mapa de pulsos, manos adaptativas, clave por pentagrama, ortografía por armonía, anacrusa. Tempo, compás, parte fuerte y tonalidad correctos en 11/12 audios realistas. Sin tresillos (plan: `TICKS_PER_QUARTER` 4 → 12). |
| «Compartir con Pauta» (aprobado por el cliente, 16:00) | share | **Hecho** (2026-10-27; informe en `docs/agents/reports/share.json`) | — Share target en Android (PWA instalada desde HTTPS), pantalla `/link` con los reproductores oficiales, botón «Enlace» en Inicio, `scripts/e2e-share.mjs`. Sin verificar aquí: el menú Compartir real de Android, los enlaces cortos de TikTok (su oEmbed limita las peticiones) y el sonido de los vídeos insertados. Para la fase D: `preferCurrentTab` en `startRecording` (la pestaña de Pauta no sale en el selector de Chrome), `inputMode="url"` en `PromptDialog`, unificar la apertura de archivos de Inicio y de compartir. Pasos para probarlo en Android en el informe. |

## 5. Plan para terminar

Las fases y los prompts completos de cada agente están en `docs/agents/pauta-build.workflow.js` (constantes `COMMON`, `UI`, `AUDIO`, `SCORE`, `ASSETS`, `CAPTURE`, `LIBRARY`, `VIEWER`, `SETTINGS`, `INTEGRATION`).

1. **Fase A, cerrar los motores** (en paralelo):
   - `engine-score`: escribir y pasar los tests (sin reescribir lo que ya funciona).
   - `engine-audio`: calibración y verificación del build.
   - Cada agente debe partir del código existente, no empezar de cero.
2. **Fase B, pantallas** (en paralelo, en cuanto terminen sus dependencias): `settings`, `library`, `viewer` y `capture`, con sus prompts tal cual. Añade a cada uno las «Peticiones abiertas» de la sección 7 que le toquen.
3. **Fase C, integración**: e2e completo, capturas finales en claro y oscuro, README.
4. **Fase D, revisión y arreglos** (un segundo workflow, previsto pero sin lanzar):
   - Revisores en paralelo, que solo informan:
     - diseño frente a las referencias y el BRIEF (espacio, coherencia, nada de emojis ni texto sobrante);
     - corrección del código (fugas de AudioContext/worker, limpieza de abcjs, errores de IndexedDB);
     - calidad de la transcripción con las fixtures;
     - usabilidad móvil (áreas táctiles de 44 px, safe areas, hojas, estados vacíos y de error).
   - Después, agentes que arreglan cada área por separado, y una verificación final.
5. **Entrega**: capturas y vídeo de animaciones al cliente. Opcionalmente, publicar el build como Artifact para probarla en el móvil (base `./`, HashRouter; el service worker falla en silencio si el host no lo permite; el micrófono necesita la capacidad correspondiente del Artifact).

## 6. El cliente y cómo trabajar con él

- Escribe en español y sigue el trabajo desde el móvil (Remote Control). Quiere **ver el avance**: tableros de imágenes en claro y oscuro, y vídeos cortos de las animaciones.
- **Agente de enlace**: relanzarlo con el prompt de `docs/agents/client-liaison.md`. Hace un tablero cada 8–10 minutos si hay novedades. Si el agente no puede usar `SendUserFile`, te los pasa con `SendMessage` a «main». Revisa cada imagen antes de enviarla.
  - **Desde el 2026-10-27 (19:55) el cliente pidió limitar los agentes**: como mucho dos trabajando a la vez, ninguno esperando durante horas. No dejes al agente de enlace en marcha esperando: prepara tú las vistas previas cuando haya algo nuevo, o lánzalo solo para una entrega concreta. Para seguir un trabajo, reanuda el agente que ya tiene el contexto (`SendMessage`) en vez de crear otro.
- **Sus comentarios** van a `docs/CLIENT-FEEDBACK.md` (lo más nuevo arriba). Todos los agentes lo leen al empezar y antes de terminar.
- Reglas que pidió expresamente:
  - motion design con la librería `motion`;
  - iconos **solo** de Untitled UI (`@untitled-ui/icons-react`);
  - **nada de emojis**;
  - estilo coherente con sus referencias, sin textos innecesarios, con simplicidad y espacios vacíos («no intentes llenar cada espacio»);
  - imágenes sin copyright;
  - biblioteca de partituras descargadas;
  - visor con play y todos los ajustes y filtros necesarios.
- Copyright: nada de títulos, artistas ni letras con derechos en datos de ejemplo. Las demos son de dominio público y solo llevan notas.

## 7. Peticiones abiertas y notas

- **Para los agentes de pantallas (del informe del kit):** las pestañas usan `<Page variant="tab" tabBar>` y `<TopBar large title="…">`. «Acerca de» es una pantalla push con `<BackButton fallback="/settings" />`. Hay esqueletos de ejemplo en `#/__kit?demo=tab` y `#/__kit?demo=screen`.
- **Para el visor (del informe de recursos):**
  - Inicializa el sintetizador de abcjs con `soundFontUrl: getSoundFontUrl()` y `soundFontVolumeMultiplier: SOUNDFONT_VOLUME_MULTIPLIER` (3; sin él suena unas tres veces más bajo).
  - Metrónomo: `drum: METRONOME_DRUM[timeSignature], drumBars: 1`. Cuenta previa: `drumIntro: 1`. Cuenta previa sin metrónomo: `drumOff: true`.
  - Recorta o descarta las notas fuera de `SOUNDFONT_PITCH_RANGE` (21..109) en el ABC de reproducción, porque al transponer pueden salirse.
  - La carpeta de los samples es `soundfonts/acoustic_grand_piano-mp3/`, con nombres de nota en bemoles.
- **Para Ajustes/Acerca de:**
  - Créditos de `allImages` (autor, fuente, licencia y enlaces).
  - Atribución obligatoria: «Sonidos de piano: FluidR3_GM de Frank Wen, renderizado por el proyecto midi-js-soundfonts (Benjamin Gleitzman, Paul Rosen), CC BY 3.0».
  - Lista de software (en `docs/CREDITS.md`).
  - Logo: `brandIcons.logo`.
- ~~**Nota visual pendiente:** nombres de nota demasiado grandes (Avance 2).~~ Resuelto en la fase A (8 pt, aclarados en pasajes rápidos; antes y después en `docs/screenshots/engine-score-nombres-antes-ahora.png`, enseñado en el Avance 4).
- **Pendiente para la fase D (diseño):** con `AnimatePresence mode="wait"` hay un instante en blanco (0,1–0,3 s) entre pantallas (se ve en el vídeo del Avance 4); en la Biblioteca, al pasar de lista a cuadrícula, ~0,2 s de vacío antes de que aparezcan las tarjetas.
- **Agente de enlace:** `SendUserFile` no está disponible para los subagentes; entrega con `SendMessage` a «main» y el lead revisa y reenvía cada tablero y vídeo. Para grabar vídeos sin tirones usa un build de producción en su carpeta temporal (el servidor de desarrollo pierde fotogramas en las transiciones).
- **Limitaciones conocidas del kit:**
  - Las hojas solo se arrastran desde el asa o la cabecera.
  - Los overlays no ponen `inert` en el fondo.
  - La transición compartida portada→visor (`layoutId`) no está probada con `AnimatePresence mode="wait"`.
- **Hecho por el lead tras el informe del kit:** con el tema «Sistema», el color de la barra del navegador sigue los cambios de claro/oscuro del sistema (`App.tsx`).
- **Unsplash:** su web pide una comprobación anti-bots a los scripts; no se automatizó (correcto). Las licencias se verificaron en cada página y las descargas se hicieron desde el CDN.

## 8. Mapa rápido

- `docs/BRIEF.md`: la biblia del proyecto, incluida la tabla de propiedad de archivos.
- `docs/UI-KIT.md`: API del kit.
- `docs/CREDITS.md`: licencias.
- `docs/reference/`: diseños de referencia del cliente.
- `docs/preview/`: lo que ya se le enseñó al cliente (00 moodboard y guía de estilo, 01 kit, 02 primera partitura y vídeo de animaciones).
- `docs/screenshots/`: capturas de los agentes.
- `docs/agents/`: prompts del workflow, prompt del agente de enlace e informes.
- `scripts/shot.mjs`: capturas móviles (390×844 @2x) con errores de consola.
