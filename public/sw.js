const SHELL_CACHE = 'pos-shell-v1'
const STATIC_CACHE = 'pos-static-v1'
const API_CACHE = 'pos-api-v1'
const ALL_CACHES = [SHELL_CACHE, STATIC_CACHE, API_CACHE]

const SHELL_URLS = ['/pos', '/products', '/inventory', '/categories', '/reports']

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS).catch(() => {}))
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Static Next.js assets — cache first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((res) => {
          caches.open(STATIC_CACHE).then((c) => c.put(request, res.clone()))
          return res
        })
      })
    )
    return
  }

  // API — network first, cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          caches.open(API_CACHE).then((c) => c.put(request, res.clone()))
          return res
        })
        .catch(() => caches.match(request))
    )
    return
  }

  // Navigation + everything else — network first, shell cache fallback
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          caches.open(SHELL_CACHE).then((c) => c.put(request, res.clone()))
        }
        return res
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match('/pos')))
  )
})
