# Continuar el desarrollo de Pauta

Documento de traspaso escrito el 2026-10-27 (10:40) al pausar el trabajo en el PC del laboratorio.
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
  - Clona por **HTTPS**: `git clone https://github.com/gemarcos/pauta.git`. Git Credential Manager pide iniciar sesión en el navegador. La clave SSH se quedó en el PC Linux.
  - `.gitattributes` fuerza LF en el repo, así que los `.sh` no se rompen.
- `npm install` y después `npm run dev` (puerto 5173, `--host` para abrirlo desde el móvil en la misma red Wi-Fi; Windows puede pedir permiso en el firewall).
- **Chrome sin interfaz** (`scripts/shot.mjs`, `scripts/fixtures/check-transcription.mjs`): ambos usan `scripts/chrome-path.mjs`, que lo encuentra solo en Windows (Program Files, LocalAppData y Edge como alternativa), Linux y macOS. Si no lo encuentra, define `CHROME_PATH`. En PowerShell: `$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"`.
- **Herramientas de los agentes** (opcionales en Windows):
  - `ffmpeg` (vídeos de animaciones para el cliente): `winget install Gyan.FFmpeg`.
  - Python 3 + Pillow (tableros de previsualización): `winget install Python.Python.3.12` y después `pip install pillow`.
  - `sox` solo hace falta para regenerar los audios de prueba, que ya están en `test/fixtures/`.
- **Adaptar los prompts de `docs/agents/pauta-build.workflow.js` antes de reutilizarlos.** Son del PC Linux:
  - quita `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use 22 >/dev/null 2>&1;`;
  - cambia las rutas absolutas (`/home/alumnos/gemarcos/Escritorio/apps-claude/pauta`) por la raíz nueva;
  - sustituye `/tmp/claude-11397/...` por la carpeta temporal o el scratchpad de la sesión;
  - sustituye `pkill -f "vite --port N"` por una forma de parar el servidor en Windows: `npx kill-port N`, o `taskkill` con el PID que escucha en el puerto (`netstat -ano | findstr :N`);
  - actualiza la ruta del journal del workflow nuevo en el prompt del agente de enlace.
- Los permisos de micrófono y la captura de pestaña funcionan igual en Chrome y Edge de Windows. Las pruebas e2e con audio falso usan flags de Chrome que también valen en Windows (`--use-file-for-fake-audio-capture=C:\\ruta\\melody-bass.wav`).

## 4. Estado por módulo (al pausar)

Verificado al pausar: `tsc --noEmit` con **0 errores**; `vitest` con **23 tests OK** (2 archivos, motor de audio). El build de producción funcionaba con los cimientos (no se volvió a ejecutar tras los últimos cambios).

| Módulo | Dueño | Estado | Qué falta |
|---|---|---|---|
| Cimientos: config, rutas, tipos, tokens, DB, ajustes, lib | lead | **Hecho** | — |
| Kit de interfaz `src/ui/**` + galería `#/__kit` (solo dev) + `docs/UI-KIT.md` | ui | **Hecho** (informe en `docs/agents/reports/ui.json`) | Ver «Peticiones abiertas» |
| Recursos: 12 fotos libres, piano offline (89 mp3) + percusión del metrónomo, iconos de la app, `docs/CREDITS.md` | assets | **Hecho** (informe en `docs/agents/reports/assets.json`) | — |
| Motor de audio + transcripción `src/engine/audio/**`, `src/engine/transcribe/**`, modelo en `public/models/basic-pitch/`, fixtures `test/fixtures/` (incluidas variantes con eco «-room»), harness `test/harness/transcribe.*`, `scripts/fixtures/*` | engine-audio | **Implementado, sin cerrar** (se paró a mitad) | Calibrar umbrales con `scripts/fixtures/check-transcription.mjs` (objetivo F1 ≥ 0,9 en `scale.wav`; lo mejor posible en `chords` y `melody-bass`, también en las variantes `-room`). Verificar que el build saca el worker en su propio chunk y que tfjs no entra en el bundle principal. Comprobar que `scale.mp4` se decodifica. |
| Motor de partituras `src/engine/score/**` + 3 demos de dominio público en `src/data/demos.ts` (Oda a la alegría, Minueto en Sol de Petzold, Preludio en Do de Bach) | engine-score | **Implementado, sin cerrar** (no quedan stubs; ~2.000 líneas) | **Faltan todos sus tests** (lista J del prompt en el workflow): ortografía de alteraciones en todas las tonalidades, estado de alteraciones dentro del compás, ligaduras en barra de compás, descomposición de duraciones, pentagramas iguales, entrada vacía, filtros, transposición, dificultad, precisión del análisis (bpm ±3 %, tonalidad), rendimiento (< 30 ms con 3.000 notas), ABC sin warnings con `abcjs.parseOnly`, MusicXML bien formado y MIDI de ida y vuelta. Revisar la calidad visual de las demos. |
| Ajustes y Acerca de `src/features/settings/**` | settings | **Pendiente** (pantalla provisional; se paró al empezar) | Todo. Ver el prompt `SETTINGS` del workflow. Incluir la atribución CC BY 3.0 del soundfont en Acerca de. |
| Biblioteca + `src/data/seed.ts` | library | **Pendiente** | Todo (prompt `LIBRARY`). |
| Visor + reproducción + hoja de ajustes/filtros + exportación | viewer | **Pendiente** | Todo (prompt `VIEWER`). |
| Inicio + escuchar/importar/procesar | capture | **Pendiente** | Todo (prompt `CAPTURE`). |
| Integración: e2e `scripts/e2e.mjs`, capturas finales, README | integration | **Pendiente** | Todo (prompt `INTEGRATION`). |

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
- **Nota visual pendiente:** en la partitura generada, los **nombres de nota (Do Re Mi) se ven demasiado grandes** respecto a las notas (Avance 2). Reducir el tamaño de las anotaciones en abcjs.
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
