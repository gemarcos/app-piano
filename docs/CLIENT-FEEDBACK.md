# Comentarios del cliente

Feedback from the client, relayed during development. Newest first. Every agent: read this before finishing your work and apply whatever concerns your area. If an item conflicts with docs/BRIEF.md, this file wins (it reflects the client's latest wishes).

<!-- entries: "## YYYY-MM-DD HH:MM — area" followed by the request -->

## 2026-10-27 16:45 — transcription: solo piano only, arpeggios missing

The client only transcribes SOLO PIANO videos (no voice, no drums). With Liszt's Liebestraum No. 3 (public-domain composition: may be encoded from a public-domain edition for tests) the result was again very poor: many wrong notes and pedalled arpeggios missing from the score. Assigned: score-accuracy (fast notes merged into chords by quantization and then cut by the polyphony cap; one voice per staff chopping the melody: add a second voice per staff; arpeggios crossing the split point) and audio-accuracy (Liebestraum-style benchmark, arpeggio recall, piano-specific model comparison as the main track).

Client's words:
> «Son puramente de piano. Nada más. lo he probado con Liebestraum No. 3 y tambien ha sido horrible la interpretación. A parte ha fallado en muchas notas Parece que es incapaz de tocar arpegios o por lo menos no es capaz de detectar ninguno y no aparecen en las partituras»

## 2026-10-27 16:35 — score: key, rhythm and hands (real example from the client)

The client compared the app's output for a slow piano-cover ballad (copyrighted: never copy its notes into fixtures, tests or demos; recreate the texture) with its published sheet music. Assigned to score-accuracy (with audio-accuracy for the audio side):
- Key: C major was detected correctly, but key matters a lot to the client: chromatic notes must be spelled by harmonic context (the Ab of an F minor chord in C major is Ab, never G#).
- Rhythm: the app read 142 bpm for a piece at about 70 (tempo octave error), so each bar became two bars of 16ths and ties. Prefer the tempo reading that gives the simplest notation. The 8th-note triplet pickup was mangled: support an incomplete first bar (anacrusis) and assess 8th-note triplets.
- Hands: the left-hand staff came out empty because the left hand plays above middle C (the reference writes it in treble clef) and the app splits at a fixed C4. Separate hands by voice/register (melody right, accompaniment left) and choose the left-hand clef (treble when it plays high).
- Pitches were mostly right in this example.

Client's words:
> «Se que estas ya en ello pero te puedo dar una pequeña demostracion. Mira lo mal que lo ha calculado. La tonalidad tambien es muy importante y el ritmo y parece que no lo pilla del todo bien»

## 2026-10-27 16:20 — transcription accuracy / playback sound (TOP PRIORITY)

The client tested the phase B build (http://localhost:4173) and found it poor. Assigned to three agents: piano-sound, audio-accuracy, score-accuracy.
1. **Transcription**: "many notes are read terribly". Raise note accuracy on REAL material (real piano recordings with pedal and reverb, video audio that is often detuned or sped up, phone-speaker/microphone captures), not just the synthetic fixtures. Measure before/after on a realistic benchmark.
2. **Sustain ("el sostenido")**: lead's reading is the sustain (damper) pedal: detect where the original audio holds the pedal and reproduce it, in playback and as Ped. marks in the score (Score.pedals, Settings.sustainPedal). If the client meant sharps (♯), that is covered by item 1: correct pitch/tuning and key so accidentals come out right.
3. **Sound**: playback "sounds horrible", "like an electric keyboard": give it a real grand-piano tone (concert/grand piano samples, natural decay and release, velocity, pedal).
4. When done, show the client a new preview WITH SOUND (before/after audio, video with audio) plus before/after scores.

Client's words:
> «parece que es un poco horrible interpretando las notas. Tambien suena horrible en el piano. A lo mejor podemos intentar meterle el sostenido donde haga falta que lo interprete del video. Y es lo que digo, lo está interpretando bastatnte mal. Hay muchas notas que lee fatal. Tambien vamos a darle un tono distinto, mas de piano de cola que ahora parece que tiene de teclado electrico. Cuando lo tenga dame otra vista previa»

## 2026-10-27 15:53 — share / capture

**Status: APPROVED by the client at 16:00 (files AND links). Assigned to the share agent after phase C; other agents do not implement it.**
Client's approval: > «Sí, añade «Compartir con Pauta»: los archivos de vídeo o audio van directos a recortar, y los enlaces de TikTok o YouTube se abren con su reproductor oficial y Pauta los escucha por el micrófono.»

Request: "share to Pauta". When the user shares a TikTok or YouTube link (or a video/audio file) from another app, Pauta should appear in the phone's share sheet and take them straight to a transcription.

Constraints set by the lead:
- Never download media from TikTok or YouTube: it breaks their terms of service, Google Play and the App Store reject apps that do it, and browsers block it anyway (CORS, signed streams). No server-side downloader.
- Android with the PWA installed: Web Share Target in the manifest (POST multipart with title/text/url plus files audio/*, video/*), handled by the service worker. Shared files go straight to Import (trim). Shared links open a screen that plays the official embed (YouTube IFrame API, TikTok embed) and records it with the microphone; on desktop, tab capture as in "Pestaña".
- YouTube: parse the video id from the URL; oEmbed allows CORS and answers 401 when embedding is disabled, so show a calm fallback. TikTok shares short links (vm.tiktok.com): verify whether the embed or oEmbed resolves them in the browser; otherwise fall back to "save the video and share the file".
- iOS: a PWA cannot be a share target; it needs the native Capacitor app with a share extension (later).

Client's words:
> «No sé si es posible pero estaria genial la opcion de reconocer por enlace. Si tu en tiktok oyoutube compartes un enlace debe aparecer la opcion de esta app y asi puedes sacar las partituras directamente a partir del tiktok»
