// Offline app shell for NUH Junior Monthly, on the shared update module (app-update 0.2.0: sw-core.js does the work; its README has
// the rules): the app opens with poor or no signal, with the roster this browser has saved. The deploy stamps VERSION and MANIFEST (tools/stamp-versions.mjs: a hash of the app's files,
// and one per SHELL file so a phone fetches only the changed ones); never change them by hand. Change the v<N> only when
// this file's own logic changes.
// - Install: every SHELL file or nothing. A new version takes over at once and the open page reloads once (register.js).
// - Pages come from the folder ('./'), whatever the query or hash. Firebase traffic always goes to the network; its SDK
//   files (versioned) are kept once fetched (the core's default rule), and so are the big vendor files (Excel, fonts of
//   the design tokens: same-origin files, refreshed in the background) and the design kit's /v1/ files.
// - sw.js itself is never cached ("Get the latest version" checks for signal with it).

const VERSION = 'nuh-junior-monthly-v3';
// the big vendor files (Excel, PDF) are cached the first time they're used, not on install
const SHELL = [
  './', 'style.css', 'css/rules.css', 'manifest.webmanifest',
  'https://design.anawj.com/v1/tokens.css', 'https://design.anawj.com/v1/app.css', 'https://design.anawj.com/v1/app.js',
  'js/app.js', 'js/store.js', 'js/model.js', 'js/rules.js', 'js/solver.js', 'js/solver-worker.js',
  'js/ui-roster.js', 'js/ui-day.js', 'js/ui-rules.js', 'js/ui-people.js', 'js/ui-check.js', 'js/ui-more.js', 'js/ui-leave.js', 'js/waitlist.js', 'js/pools.js', 'js/sheetgen.js', 'js/sheetgen-state.js', 'js/sheetgen-xlsx.js', 'js/sheetgen-gsheets.js', 'js/gsheets.js', 'js/sheet.js',
  'js/io.js', 'js/unsent.js', 'js/docsync.js', 'js/demo.js', 'js/cloud.js', 'js/firebase-config.js', 'js/ui-team.js', 'js/version.js', 'js/guide.js', 'js/tour.js', 'js/apmes.js', 'js/people-pull.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/icon.svg',
  // the page side of app-update and the sync engine (exact versions), so the app opens offline
  'https://core.anawj.com/update/0.2.0/register.js',
  'https://core.anawj.com/sync/0.4.0/index.js', 'https://core.anawj.com/sync/0.4.0/src/sync.js', 'https://core.anawj.com/sync/0.4.0/src/writes.js', 'https://core.anawj.com/sync/0.4.0/src/conflict.js', 'https://core.anawj.com/sync/0.4.0/src/store.js', 'https://core.anawj.com/sync/0.4.0/src/outbox.js', 'https://core.anawj.com/sync/0.4.0/src/watchdog.js', 'https://core.anawj.com/sync/0.4.0/src/persist.js', 'https://core.anawj.com/sync/0.4.0/src/status.js', 'https://core.anawj.com/sync/0.4.0/src/forget.js', 'https://core.anawj.com/sync/0.4.0/src/firestore.js',
];
const MANIFEST = {};

importScripts('https://core.anawj.com/update/0.2.0/sw-core.js');
AppUpdate.init({
  app: 'nuh-junior-monthly', version: VERSION, shell: SHELL, manifest: MANIFEST,
  never: [/\/sw\.js$/],
  runtime: [
    { name: 'kit', match: 'https://design.anawj.com/v1/', strategy: 'stale-while-revalidate', max: 40 },
    { name: 'pinned', match: /^https:\/\/core\.anawj\.com\/(sync|update)\/\d+\.\d+\.\d+\//, strategy: 'cache-first', max: 40 },
    { name: 'files', match: url => url.origin === self.location.origin && /\.(m?js|css|json|png|svg|jpe?g|webp|ico|woff2?|ttf|webmanifest)$/i.test(url.pathname), strategy: 'stale-while-revalidate', max: 60 },
  ],
});
