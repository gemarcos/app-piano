/*
 * Pauta, owner: share. Web Share Target handler, imported by the generated service worker
 * (vite.config.ts > workbox.importScripts). Android (installed PWA) sends a multipart POST to ./share-target
 * (manifest share_target) with title / text / url and the shared files under "media". The share is kept in
 * Cache Storage and the app opens #/shared, which reads and clears it (src/features/share/inbox.ts).
 * Nothing leaves the device. Keep CACHE and the key layout in sync with inbox.ts.
 */
;(function () {
  'use strict'

  var CACHE = 'pauta-share-v1'
  var MAX_FILES = 4

  function scoped(path) {
    return new URL(path, self.registration.scope).href
  }

  function isShareTarget(request) {
    if (request.method !== 'POST') return false
    var url = new URL(request.url)
    return url.origin + url.pathname === scoped('share-target')
  }

  function text(value) {
    return typeof value === 'string' ? value.slice(0, 4000) : ''
  }

  function isFile(value) {
    return value && typeof value === 'object' && typeof value.size === 'number' && value.size > 0
  }

  async function store(request) {
    var form = await request.formData()
    await caches.delete(CACHE)
    var cache = await caches.open(CACHE)
    var files = form.getAll('media').filter(isFile).slice(0, MAX_FILES)
    var meta = { v: 1, at: Date.now(), title: text(form.get('title')), text: text(form.get('text')), url: text(form.get('url')), files: [] }
    for (var i = 0; i < files.length; i++) {
      var file = files[i]
      var key = scoped('__share/file-' + i)
      await cache.put(key, new Response(file, { headers: { 'content-type': file.type || 'application/octet-stream' } }))
      meta.files.push({ key: key, name: file.name || '', type: file.type || '' })
    }
    await cache.put(scoped('__share/meta'), new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }))
  }

  self.addEventListener('fetch', function (event) {
    if (!isShareTarget(event.request)) return
    event.respondWith(
      store(event.request).then(
        function () {
          return Response.redirect(scoped('#/shared'), 303)
        },
        function () {
          return Response.redirect(scoped('#/shared?error=1'), 303)
        },
      ),
    )
  })
})()
