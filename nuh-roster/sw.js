// Offline app shell for the NUH roster (the logbook's pattern): the app opens with poor or no signal, and My day
// shows the last roster this phone loaded. VERSION is stamped at deploy with a hash of the app's files
// (tools/stamp-versions.mjs), so an update is offered ("Update available: Reload") whenever they change; don't bump
// it by hand. Firebase traffic always goes to the network; its SDK files (versioned) are cached here.

const VERSION = 'nuh-roster-v1';
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
// the NUHS design kit lives on another host; SHELL caches it at install, and this answers it from that cache offline
const KIT = 'https://design.anawj.com/v1/';
const SDK_FILES = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(f => SDK + f);
// the big vendor files (Excel, PDF) are cached the first time they're used, not on install
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'guide.html',
  'https://design.anawj.com/v1/tokens.css', 'https://design.anawj.com/v1/app.css', 'https://design.anawj.com/v1/app.js',
  'js/app.js', 'js/engine.js', 'js/layout.js', 'js/xlsxio.js', 'js/monthly.js', 'js/rotations.js', 'js/cloud.js', 'js/firebase-config.js',
  'js/demo.js', 'js/pdfout.js', 'js/pngout.js', 'js/ics.js', 'js/store.js', 'js/help.js',
  'js/ui-core.js', 'js/ui-practice.js', 'js/ui-screen.js', 'js/ui-tour.js', 'js/ui-staff.js', 'js/ui-cases.js', 'js/ui-roster.js',
  'js/ui-tags.js', 'js/ui-person.js', 'js/ui-general.js', 'js/ui-monthly.js', 'js/ui-myday.js', 'js/ui-rotations.js', 'js/ui-today.js',
  'js/ui-premed.js', 'js/ui-problems.js', 'js/ui-export.js', 'js/ui-settings.js', 'js/ui-team.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/icon.svg',
];

self.addEventListener('install', e => {
  // one missing file must not stop the whole install, so cache each on its own
  e.waitUntil(caches.open(VERSION).then(c => Promise.all([
    ...SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})),
    ...SDK_FILES.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})),
  ])));
});

// The page asks a waiting worker to take over when the user taps "Reload".
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('nuh-roster-') && k !== VERSION) await caches.delete(k); // other apps keep theirs
    await self.clients.claim();
  })());
});

const NEVER = /(^|\.)(googleapis\.com|gstatic\.com|firebaseio\.com|firebaseapp\.com|google\.com)$/;

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.url.startsWith(SDK) || req.url.startsWith(KIT)) {
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
    // navigations: the cached shell, whatever the query (?demo) or hash (#myday); keyed by the folder ('./')
    const key = req.mode === 'navigate' && !url.pathname.endsWith('guide.html') ? './' : req;
    const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    try {
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
