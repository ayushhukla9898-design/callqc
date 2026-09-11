const CACHE = 'callqc-v2';
const CORE = ['./index.html', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  // Purane saare cache versions delete karo — naya version turant control le
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Audio streams aur AI APIs kabhi cache mat karo — hamesha network
  if (url.hostname.includes('cloudfront.net') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('groq.com') ||
      url.hostname.includes('openai.com') ||
      url.hostname.includes('mistral.ai') ||
      e.request.method !== 'GET') return;
  // App ki files ke liye NETWORK-FIRST:
  // pehle internet se nayi version lao → offline ho to purani cache dikhao
  e.respondWith(
    fetch(e.request).then(resp => {
      if (resp.ok && (url.origin === location.origin || url.hostname.includes('jsdelivr.net'))) {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => caches.match(e.request))
  );
});
