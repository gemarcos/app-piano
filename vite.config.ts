import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['icons/*'],
      manifest: {
        name: 'Pauta',
        short_name: 'Pauta',
        description: 'Escucha una canción y obtén su partitura de piano.',
        lang: 'es',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#EEF0F8',
        theme_color: '#EEF0F8',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // "Compartir con Pauta" (Android, installed PWA): public/share-target-sw.js answers this POST.
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'media',
                accept: ['audio/*', 'video/*', '.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac', '.mp4', '.m4v', '.mov', '.webm', '.3gp', '.mkv'],
              },
            ],
          },
        },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,jpg,woff2,json,bin,mp3}'],
        // The piano model (Transkun, ~30 MB) and onnxruntime-web (its JS chunk and its ~27 MB WebAssembly binary; .wasm
        // is not in globPatterns) are NOT precached, so first visits stay light: the transcription worker downloads them
        // the first time the piano model runs and keeps them in its own Cache Storage entry ('pauta-piano-transkun-v1',
        // src/engine/transcribe/transkun/files.ts), which also makes it work offline. No Workbox runtime route either
        // (it would store the files twice). Basic Pitch stays precached: offline always works.
        globIgnores: ['**/node_modules/**/*', '**/models/transkun/**', '**/assets/ort*.js'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        // onnxruntime-web's JS chunk (hashed name) is cached the first time the piano model loads, for offline use.
        runtimeCaching: [{ urlPattern: /\/assets\/ort[^/]*\.js$/, handler: 'CacheFirst', options: { cacheName: 'pauta-ort-js', expiration: { maxEntries: 4 } } }],
        importScripts: ['share-target-sw.js'],
      },
    }),
  ],
  worker: { format: 'es' },
  // onnxruntime-web loads its own WebAssembly glue: pre-bundling it breaks that in the dev server.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  server: { host: true, port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
})
