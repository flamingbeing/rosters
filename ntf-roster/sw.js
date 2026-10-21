// Offline app shell for NTF Roster (nuh-roster's pattern): the app opens with poor or no signal, with the roster
// this browser has saved. VERSION is stamped at deploy with a hash of the app's files (tools/stamp-versions.mjs), so
// an update is offered ("Update available: Reload") whenever they change; don't bump it by hand.
// Firebase traffic always goes to the network; its SDK files (versioned) and the Excel library are cached the first
// time they're used, not on install (most phones never need them).

const VERSION = 'ntf-roster-v1';
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const SHELL = [
  './', 'index.html', 'style.css', 'css/rules.css', 'manifest.webmanifest', 'css/tokens.css',
  'js/app.js', 'js/store.js', 'js/model.js', 'js/rules.js', 'js/reqprio.js', 'js/solver.js', 'js/solver-worker.js',
  'js/ui-roster.js', 'js/ui-day.js', 'js/ui-rules.js', 'js/ui-people.js', 'js/ui-check.js', 'js/ui-more.js',
  'js/io.js', 'js/jpool.js', 'js/aps.js', 'js/ui-jpool.js', 'js/ui-aps.js', 'js/ui-requests.js', 'js/ui-reqprio.js', 'js/ui-ruleprio.js', 'js/rules-share.js', 'js/rules-text.js', 'js/rotations.js', 'js/people-pull.js', 'js/demo.js', 'js/cloud.js', 'js/firebase-config.js', 'js/ui-team.js', 'js/cloudstate.js', 'js/version.js', 'js/guide.js', 'js/tour.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];

self.addEventListener('install', e => {
  // one missing file must not stop the whole install, so cache each on its own
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(
    SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})),
  )));
});

// The page asks a waiting worker to take over when the user taps "Reload".
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('ntf-roster-') && k !== VERSION) await caches.delete(k); // other apps keep theirs
    await self.clients.claim();
  })());
});

const NEVER = /(^|\.)(googleapis\.com|gstatic\.com|firebaseio\.com|firebaseapp\.com|google\.com)$/;

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // "Get the latest version" checks for signal with cache: 'no-store': straight to the network
  if (req.cache === 'no-store') return;
  const url = new URL(req.url);
  if (req.url.startsWith(SDK)) {
    e.respondWith(caches.open(VERSION).then(async c => (await c.match(req.url)) || fetch(req).then(res => {
      if (res.ok) c.put(req.url, res.clone());
      return res;
    })));
    return;
  }
  if (url.origin !== self.location.origin || NEVER.test(url.hostname)) return;
  if (url.pathname.includes('/__/')) return; // Firebase auth helper pages
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // navigations: the cached shell, whatever the query (?demo) or hash (#day); keyed by the folder ('./')
    const key = req.mode === 'navigate' ? './' : req;
    const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    try {
      // anything else same-origin (/lib/exceljs.min.js, fonts of the design tokens) is kept after its first use
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    } catch (err) {
      const shell = req.mode === 'navigate' && await cache.match('./');
      if (shell) return shell;
      throw err;
    }
  })());
});
