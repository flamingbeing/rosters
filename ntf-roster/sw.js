// Offline app shell for NTF Roster, on the shared update module (app-update 0.1.0: sw-core.js does the work; its README has
// the rules): the app opens with poor or no signal, with the roster this browser has saved. The deploy stamps VERSION and MANIFEST (tools/stamp-versions.mjs: a hash of the app's files,
// and one per SHELL file so a phone fetches only the changed ones); never change them by hand. Change the v<N> only when
// this file's own logic changes.
// - Install: every SHELL file or nothing. A new version takes over at once and the open page reloads once (register.js).
// - Pages come from the folder ('./'), whatever the query or hash. Firebase traffic always goes to the network; its SDK
//   files (versioned) are kept once fetched (the core's default rule), and so are the big vendor files (Excel, fonts of
//   the design tokens: same-origin files, refreshed in the background) and the design kit's /v1/ files.
// - sw.js itself is never cached ("Get the latest version" checks for signal with it).

const VERSION = 'ntf-roster-v2';
// the big vendor files (Excel, PDF) are cached the first time they're used, not on install
const SHELL = [
  './', 'style.css', 'css/rules.css', 'manifest.webmanifest', 'css/tokens.css',
  'js/app.js', 'js/store.js', 'js/model.js', 'js/rules.js', 'js/reqprio.js', 'js/solver.js', 'js/solver-worker.js',
  'js/ui-roster.js', 'js/ui-day.js', 'js/ui-rules.js', 'js/ui-people.js', 'js/ui-check.js', 'js/ui-more.js',
  'js/io.js', 'js/jpool.js', 'js/aps.js', 'js/ui-jpool.js', 'js/ui-aps.js', 'js/ui-requests.js', 'js/ui-reqprio.js', 'js/ui-ruleprio.js', 'js/rules-share.js', 'js/rules-text.js', 'js/rotations.js', 'js/people-pull.js', 'js/demo.js', 'js/cloud.js', 'js/firebase-config.js', 'js/ui-team.js', 'js/cloudstate.js', 'js/version.js', 'js/guide.js', 'js/tour.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/icon.svg',
  // the page side of app-update (one exact version), so the app opens offline
  'https://core.anawj.com/update/0.1.0/register.js',
];
const MANIFEST = {};

importScripts('https://core.anawj.com/update/0.1.0/sw-core.js');
AppUpdate.init({
  app: 'ntf-roster', version: VERSION, shell: SHELL, manifest: MANIFEST,
  never: [/\/sw\.js$/],
  runtime: [
    { name: 'kit', match: 'https://design.anawj.com/v1/', strategy: 'stale-while-revalidate', max: 40 },
    { name: 'pinned', match: /^https:\/\/core\.anawj\.com\/(sync|update)\/\d+\.\d+\.\d+\//, strategy: 'cache-first', max: 40 },
    { name: 'files', match: url => url.origin === self.location.origin && /\.(m?js|css|json|png|svg|jpe?g|webp|ico|woff2?|ttf|webmanifest)$/i.test(url.pathname), strategy: 'stale-while-revalidate', max: 60 },
  ],
});
