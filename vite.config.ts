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
        background_color: '#EEEEF5',
        theme_color: '#EEEEF5',
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
        // The piano model (Onsets and Frames, ~16 MB) is NOT precached, so first visits stay light: the transcription
        // worker downloads it the first time it is used and keeps it in its own Cache Storage entry
        // ('pauta-onsets-frames-v1', src/engine/transcribe/oaf/weights.ts), which also makes it work offline. No Workbox
        // runtime route either (it would store the files twice). Basic Pitch stays precached: offline always works.
        globIgnores: ['**/node_modules/**/*', '**/models/onsets-frames/**'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        importScripts: ['share-target-sw.js'],
      },
    }),
  ],
  worker: { format: 'es' },
  server: { host: true, port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
})
