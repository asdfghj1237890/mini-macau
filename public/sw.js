// Mini Map Macau service worker.
//
// This worker exists for one reason: Chromium only fires `beforeinstallprompt`
// (the one-tap INSTALL button in the add-to-home-screen card) for a page that
// has a service worker with a fetch handler. It deliberately caches nothing —
// `/api/lrt/*` is served `Cache-Control: private` behind an origin check,
// `/data/*.json` is versioned by the deploy, and the basemap tiles are the
// tile server's business. Chromium recognises the empty handler as a no-op
// and skips starting the worker for navigations, so it costs nothing.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', () => {})
