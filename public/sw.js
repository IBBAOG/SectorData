/**
 * SectorData — minimal service worker.
 *
 * Scope: Add-to-Home-Screen install support only.
 *
 * Explicit non-goals (per product spec):
 *   - NO offline mode for business data.
 *   - NO caching of dashboard responses, RPC payloads, charts, or any
 *     authenticated endpoint. All data must stay fresh from the server.
 *
 * What this SW does cache (the app shell):
 *   - /manifest.json
 *   - /favicon.ico
 *   - /logo.png (used by the manifest icons)
 *
 * Why we still register a SW at all: the Add-to-Home-Screen install prompt on
 * Android Chrome is only offered when the page hosts a valid SW + manifest.
 * Without this, the "Install SectorData on your phone" UX never fires.
 */

const CACHE_NAME = "sectordata-shell-v1";
const SHELL_ASSETS = ["/manifest.json", "/favicon.ico", "/logo.png"];

self.addEventListener("install", (event) => {
  // Pre-cache the shell assets so the install prompt criteria are satisfied
  // even on first navigation. Failures here must NOT block install (some
  // assets are optional).
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  // Clean up any older shell caches and immediately take control of open
  // clients so an updated SW does not require a hard reload.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only handle GET — we never cache POST/PUT/DELETE etc.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Same-origin shell assets are the only thing we serve from cache.
  // Everything else (HTML pages, API routes, Supabase calls, Yahoo proxy,
  // chunks, fonts) goes straight to network — no caching, no stale data.
  const isShellAsset =
    url.origin === self.location.origin && SHELL_ASSETS.includes(url.pathname);

  if (!isShellAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          // Only cache successful, basic (same-origin) responses.
          if (!response || response.status !== 200 || response.type !== "basic") {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => cached);
    }),
  );
});
