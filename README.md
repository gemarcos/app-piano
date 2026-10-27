# Pauta

Pauta es una app para el móvil que **escucha una canción y escribe su partitura de piano**. Graba con el micrófono o importa un archivo de audio o de vídeo; la transcripción se hace en el propio dispositivo (Basic Pitch de Spotify con TensorFlow.js en un Web Worker), se analizan el tempo, la tonalidad y el compás, y el resultado se dibuja como gran pentagrama (mano derecha y mano izquierda) con abcjs. Cada partitura se guarda en una biblioteca local, se puede reproducir con el cursor siguiendo las notas, ajustar (velocidad, metrónomo, bucle, transposición, manos, dificultad, filtros…) y exportar a PDF, MusicXML, MIDI o ABC.

Es una PWA instalable: funciona sin conexión después de la primera carga y está preparada para empaquetarse con Capacitor. La interfaz está en español.

## Requisitos

- **Node.js 22.12 o superior** (Vite 8 lo exige).
  - Windows: el instalador LTS de [nodejs.org](https://nodejs.org) o `winget install OpenJS.NodeJS.LTS`.
  - Linux y macOS: `nvm install 22 && nvm use 22` (el repositorio trae `.nvmrc`).
  - Comprueba la versión con `node -v`.
- **Google Chrome** (o Chromium / Edge) solo para los scripts de comprobación sin interfaz (`scripts/e2e.mjs`, capturas, medición de la transcripción). Se encuentra solo en Windows, Linux y macOS; si no, indica la ruta en `CHROME_PATH`:
  - PowerShell: `$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"`
  - Bash: `export CHROME_PATH=/usr/bin/chromium`

## Puesta en marcha

```bash
npm install
npm run dev
```

Vite muestra dos direcciones: `http://localhost:5173/` y la de tu red local (por ejemplo `http://192.168.1.20:5173/`). Para probarla en el móvil, conéctalo a la misma red Wi-Fi y abre la dirección de red. En Windows, la primera vez el firewall puede pedir permiso para Node.js: acéptalo para redes privadas.

Desde la red local la app abre y permite importar archivos, pero **el micrófono y el modo sin conexión necesitan un contexto seguro** (HTTPS o `localhost`): por HTTP en una IP de la red, el navegador del móvil no deja grabar ni instalar el service worker. Para probar esas dos cosas en el móvil, publica el build en un hosting con HTTPS (ver más abajo).

### Build de producción

```bash
npm run build      # typecheck + build en dist/
npm run preview    # sirve dist/ en http://localhost:4173/ (y en la red local)
```

`dist/` es un sitio estático (`base: './'` y rutas con `#`), así que se puede subir tal cual a cualquier hosting estático con HTTPS (GitHub Pages, Netlify, Cloudflare Pages, un servidor propio…), también en una subcarpeta.

## Instalarla como app (PWA)

1. Abre la dirección HTTPS de la app en el móvil.
2. Android (Chrome): menú ⋮ > **Añadir a pantalla de inicio** (o **Instalar aplicación**).
   iPhone/iPad (Safari): botón Compartir > **Añadir a pantalla de inicio**.
3. La primera carga guarda en caché todo lo necesario para trabajar sin conexión (unos 6 MB: el modelo de transcripción, los sonidos del piano, las imágenes y la tipografía). Las actualizaciones se instalan solas al volver a abrirla.

## Android e iOS con Capacitor (pasos previstos, no ejecutados)

El proyecto está preparado para Capacitor (HashRouter, rutas relativas, todo local), pero las dependencias de Capacitor **no están instaladas**. Cuando se quiera empaquetar:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init Pauta es.pauta.app --web-dir dist
npm run build
npx cap add android          # necesita Android Studio
npx cap add ios              # necesita macOS con Xcode
npx cap sync                 # repetir después de cada npm run build
npx cap open android         # o: npx cap open ios
```

- **Android**: añade `<uses-permission android:name="android.permission.RECORD_AUDIO" />` (y `MODIFY_AUDIO_SETTINGS`) en `android/app/src/main/AndroidManifest.xml`.
- **iOS**: añade `NSMicrophoneUsageDescription` en `ios/App/App/Info.plist` con un texto como «Pauta usa el micrófono para escuchar la música que quieres transcribir».
- Dentro de la app nativa no hace falta el service worker (los archivos ya están en el paquete). La captura de pestaña no existe en móviles.

## Arquitectura

```
src/
  main.tsx, App.tsx      arranque, rutas (HashRouter), tema y transiciones entre pantallas
  types.ts               tipos compartidos (NoteEvent, Score, ScoreDoc, Settings…)
  ui/                    kit de interfaz (botones, hojas, vinilo, forma de onda…): docs/UI-KIT.md
  engine/audio/          decodificar audio y vídeo, remuestrear, picos, grabar micrófono o pestaña, WAV
  engine/transcribe/     Basic Pitch en un Web Worker (TensorFlow.js solo vive en ese chunk)
  engine/score/          análisis (tempo, compás, tonalidad), cuantización, partitura, ABC, MusicXML y MIDI
  features/home          Inicio
  features/capture       grabar, importar y recortar, procesar (pipeline.ts)
  features/library       biblioteca (búsqueda, filtros, orden, cuadrícula o lista, acciones)
  features/viewer        visor: partitura, reproducción, hoja de ajustes y filtros, exportación
  features/settings      Ajustes y Acerca de
  data/                  IndexedDB con Dexie (db.ts), piezas de ejemplo (demos.ts) y su siembra (seed.ts)
  state/settings.ts      ajustes del usuario (zustand, guardados en localStorage)
public/                  modelo de Basic Pitch, sonidos del piano (FluidR3_GM), imágenes, iconos
```

Flujo de una transcripción: archivo o grabación → audio mono a 22 050 Hz → Basic Pitch (Web Worker, WebGL o CPU) → notas (`NoteEvent[]`) → análisis de tempo, pulso, compás y tonalidad → `Score` cuantizado en dos pentagramas → ABC → abcjs. La biblioteca guarda las notas en bruto con sus parámetros, así que el visor reconstruye la partitura en directo cuando cambian los ajustes o los filtros. abcjs y el modelo se cargan bajo demanda, en sus propios chunks.

Más detalle: `docs/BRIEF.md` (producto, diseño, contratos y propiedad de cada módulo), `docs/UI-KIT.md` (kit de interfaz) y `docs/CONTINUAR.md` (estado del proyecto).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo en el puerto 5173, accesible desde la red local. |
| `npm run build` | Comprobación de tipos y build de producción en `dist/`. |
| `npm run preview` | Sirve `dist/` en el puerto 4173. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Tests unitarios (Vitest, entorno Node). |
| `npm run e2e` | Lo mismo que `node scripts/e2e.mjs`. |
| `node scripts/serve.mjs start\|stop\|status <puerto> [--preview]` | Arranca en segundo plano un servidor de Vite propio (con `--preview`, el build de `dist/`) en `127.0.0.1:<puerto>` y lo para después. Solo detiene el proceso Node que escucha en ese puerto. |
| `node scripts/e2e.mjs` | Prueba completa de la app en Chrome sin interfaz, con un perfil limpio (ver abajo). |
| `node scripts/e2e-capture.mjs [--url …] [--preview]` | Solo el flujo de captura: importar `scale.wav` y `scale.mp4`, grabar con micrófono simulado, toma demasiado corta y cancelar el procesado. |
| `node scripts/e2e-share.mjs [--url …] [--shots]` | Solo «Compartir con Pauta», sobre el build de producción (con service worker): archivo compartido hasta Recortar, enlace de YouTube con su reproductor oficial, avisos y una toma con micrófono simulado. `scripts/e2e.mjs` incluye además las comprobaciones j1 y j2. |
| `node scripts/fixtures/check-transcription.mjs` | Pasa todos los audios de `test/fixtures/` por la transcripción real y muestra precisión, exhaustividad y F1 por archivo, tiempos y backend (`--sensitivity`, `--min-note-ms`, `--gpu`, `--swiftshader`, `--backend cpu`, `--sweep-sensitivity`, `--perf N`, `--mic`, `--only`, `--verbose`). Falla si `scale.wav` baja de F1 0,9. |
| `node scripts/fixtures/check-bundle.mjs` | Build de prueba en una carpeta temporal que comprueba que el worker es un chunk propio y que TensorFlow.js y Basic Pitch no aparecen en ningún otro. |
| `node scripts/shot.mjs <url> <out.png> [--dark]` | Captura móvil (390×844 @2x) y muestra los errores de consola. |
| `node scripts/fixtures/make-piano-fixtures.mjs` | Regenera los audios de piano real de prueba (necesita ffmpeg). `make-fixtures.sh` regenera los sintéticos (necesita sox y ffmpeg; Linux o macOS). |

### Prueba completa: `scripts/e2e.mjs`

```bash
npm run build
node scripts/e2e.mjs                       # sirve dist/ con vite preview en el puerto 5189 y lo para al acabar
node scripts/e2e.mjs --url http://localhost:5173/   # usa un servidor que ya esté en marcha
```

Comprueba, en un Chrome sin interfaz con un perfil nuevo y un micrófono simulado: que Inicio carga sin errores y la barra inferior navega; que la biblioteca tiene exactamente las 3 piezas de ejemplo también tras recargar; que cada ejemplo se abre con notas, suena (el cursor avanza), se pausa, transpone (+2 cambia la tonalidad y redibuja) y muestra una sola mano; las exportaciones del visor (MusicXML, MIDI, ABC y PDF); importar `scale.wav` y `scale.mp4`; grabar 6 s con el micrófono simulado; el tema oscuro y la copia de seguridad en Ajustes; los casos límite de la captura; y que en toda la ejecución no hay errores de consola ni peticiones fallidas. Termina con una tabla PASS/FAIL y sale con código 1 si algo falla.

Opciones: `--build` (rehace `dist/` antes), `--dev` (servidor de desarrollo en vez de `dist/`), `--only a,b,c1` (solo esas comprobaciones), `--headful` (ver el navegador), `--keep` (conservar el perfil y las descargas), `--verbose` (trazas de error).

Está escrito para Windows, Linux y macOS (rutas con `path.join`, Chrome localizado por `scripts/chrome-path.mjs`, `scripts/serve.mjs` usa `netstat` en Windows y `lsof` o `ss` en Linux y macOS); hasta ahora se ha ejecutado en Windows 11. En una máquina sin GPU, Chrome transcribe con WebGL por software o con la CPU: va más lento, y los tiempos de espera de la prueba lo contemplan.

## Limitaciones

- **La calidad depende del audio.** Un piano solo y limpio da los mejores resultados. Voces, batería o mezclas densas añaden notas falsas; los filtros del visor (ruido, duración mínima, rango, polifonía) ayudan a limpiarlas.
- **Polifonía densa.** En acordes de piano real aparecen fantasmas de octava y notas internas tapadas (F1 de 0,76 a 0,80 en las pruebas, frente a 1,00 en una escala).
- **Una sola voz por pentagrama** y reparto de manos por un punto de división (ajustable). Las texturas a varias voces se simplifican.
- **Tempo**: en algunas texturas se detecta el doble o la mitad; se corrige con «Tempo base». El 6/8 solo se elige a mano.
- **Enlaces de YouTube y TikTok: Pauta nunca descarga el vídeo.** Lo abre con el reproductor oficial de la plataforma y lo escucha por el micrófono mientras suena, así que la calidad depende del altavoz y del micrófono (un archivo de audio o de vídeo da mejor resultado) y hace falta conexión. Los vídeos con la inserción desactivada por su autor no se reproducen dentro de Pauta: la app propone ponerlos en otro dispositivo cerca y tocar «Escuchar».
- **TikTok comparte enlaces cortos** (`vm.tiktok.com`): Pauta intenta resolverlos con el oEmbed oficial de TikTok, que a menudo limita las peticiones; si no se puede, pide guardar el vídeo desde TikTok y abrirlo con «Archivo». En Europa, el reproductor de TikTok muestra antes su propio aviso de cookies.
- **«Compartir con Pauta» desde la hoja de compartir solo existe en Android**, con la app instalada desde una dirección HTTPS en Chrome. En iPhone (una PWA no puede recibir contenido compartido; hará falta la app nativa con una extensión de compartir) y en el ordenador, el enlace se pega con «Enlace» en Inicio.
- La **captura de pestaña** solo existe en Chrome y Edge de escritorio. En la pantalla de un enlace, «Pestaña» captura otra pestaña (por ejemplo, el vídeo abierto en YouTube) o la pantalla con su audio: Chrome todavía no ofrece la propia pestaña de Pauta. El **micrófono** necesita HTTPS (o `localhost`).
- La **primera transcripción** tarda algo más porque carga y prepara el modelo (de 4 a 10 s en un ordenador; más en móviles).
- Piezas muy largas a velocidad lenta ocupan bastante memoria al reproducirse (el audio se genera entero).
- Probada en Chrome de escritorio con emulación móvil; falta probarla en dispositivos iOS reales.

## Créditos

Las fotos son libres de derechos (licencia Unsplash y CC0) y los sonidos del piano son FluidR3_GM de Frank Wen, renderizados por el proyecto midi-js-soundfonts (CC BY 3.0). La lista completa de imágenes, sonidos y software, con autores y licencias, está en [`docs/CREDITS.md`](docs/CREDITS.md) y en la pantalla **Acerca de** de la app.
