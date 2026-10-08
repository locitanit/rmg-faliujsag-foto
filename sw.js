// Service worker: keeps the app shell, so the page opens without network too (the photos
// then wait in the local queue). Network first – a new version shows up at once; the
// cached copy is only the fallback. Nothing from Google is ever cached.

const CACHE = "faliujsag-foto-v3";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "aruco.js",
  "auth.js",
  "check.js",
  "config.js",
  "dictionary.js",
  "drive.js",
  "layout.js",
  "photo.js",
  "rounds.js",
  "store.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })),
  );
});
