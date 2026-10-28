// Offline app shell for NUH roster, on the shared update module (app-update 1.4.0: sw-core.js does the work; its README has
// the rules): the app opens with poor or no signal, and My day shows the last roster this phone loaded. guide.html is a SHELL page of its own. The deploy stamps VERSION and MANIFEST (tools/stamp-versions.mjs: a hash of the app's files,
// and one per SHELL file so a phone fetches only the changed ones); never change them by hand. Change the v<N> only when
// this file's own logic changes.
// - Install: every SHELL file or nothing. A new version takes over at once and the open page reloads once (register.js).
// - Pages come from the folder ('./'), whatever the query or hash. Firebase traffic always goes to the network; its SDK
//   files (versioned) are kept once fetched (the core's default rule), and so are the big vendor files (Excel, fonts of
//   the design tokens: same-origin files, refreshed in the background) and the design kit's /v1/ files.
// - sw.js itself is never cached ("Get the latest version" checks for signal with it).

const VERSION = 'nuh-roster-v3';
// the big vendor files (Excel, PDF) are cached the first time they're used, not on install
const SHELL = [
  './', 'style.css', 'manifest.webmanifest', 'guide.html',
  'https://design.anawj.com/v1/tokens.css', 'https://design.anawj.com/v1/app.css', 'https://design.anawj.com/v1/app.js',
  'js/app.js', 'js/engine.js', 'js/layout.js', 'js/xlsxio.js', 'js/monthly.js', 'js/rotations.js', 'js/cloud.js', 'js/firebase-config.js',
  'js/unsent.js', '../lib/roster-core/docsync.js', '../lib/roster-core/kit.js', 'js/demo.js', 'js/pdfout.js', 'js/pngout.js', 'js/ics.js', 'js/store.js', 'js/help.js',
  'js/ui-core.js', 'js/ui-practice.js', 'js/ui-screen.js', 'js/ui-tour.js', 'js/ui-staff.js', 'js/ui-cases.js', 'js/ui-roster.js',
  'js/ui-tags.js', 'js/ui-person.js', 'js/ui-general.js', 'js/ui-monthly.js', 'js/ui-myday.js', 'js/ui-rotations.js', 'js/ui-today.js',
  'js/ui-premed.js', 'js/ui-problems.js', 'js/ui-export.js', 'js/ui-settings.js', 'js/ui-team.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/icon.svg',
  // the UI kit (lib/roster-core/kit.js KIT_SHELL: its styles, early.js and the modules the page imports)
  'https://core.anawj.com/ui/1.0.0-rc.23/theme/early.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/theme.css', 'https://core.anawj.com/ui/1.0.0-rc.23/ui/layout.css', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/choice.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/colour.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/grid.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/guard.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/index.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/looks.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/looks/a.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/looks/b.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/looks/c.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/looks/d.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/motion.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/palette-css.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/presets.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/schema.js', 'https://core.anawj.com/ui/1.0.0-rc.23/theme/switch.js', 'https://core.anawj.com/ui/1.0.0-rc.23/ui/data-grid.js',
  // the page side of app-update and the sync engine (exact versions), so the app opens offline
  'https://core.anawj.com/update/1.4.0/register.js',
  'https://core.anawj.com/sync/1.4.0/index.js', 'https://core.anawj.com/sync/1.4.0/app.js', 'https://core.anawj.com/sync/1.4.0/src/runner.js', 'https://core.anawj.com/sync/1.4.0/auth.js', 'https://core.anawj.com/sync/1.4.0/src/auth.js', 'https://core.anawj.com/sync/1.4.0/src/signin/anonymous.js', 'https://core.anawj.com/sync/1.4.0/src/signin/email-link.js', 'https://core.anawj.com/sync/1.4.0/src/signin/passcode.js', 'https://core.anawj.com/sync/1.4.0/src/signin/password.js', 'https://core.anawj.com/sync/1.4.0/src/user.js', 'https://core.anawj.com/sync/1.4.0/src/conflict.js', 'https://core.anawj.com/sync/1.4.0/src/core.js', 'https://core.anawj.com/sync/1.4.0/src/firestore.js', 'https://core.anawj.com/sync/1.4.0/src/forget.js', 'https://core.anawj.com/sync/1.4.0/src/kinds.js', 'https://core.anawj.com/sync/1.4.0/src/module-sync.js', 'https://core.anawj.com/sync/1.4.0/src/outbox.js', 'https://core.anawj.com/sync/1.4.0/src/persist.js', 'https://core.anawj.com/sync/1.4.0/src/registry.js', 'https://core.anawj.com/sync/1.4.0/src/replace.js', 'https://core.anawj.com/sync/1.4.0/src/status.js', 'https://core.anawj.com/sync/1.4.0/src/store.js', 'https://core.anawj.com/sync/1.4.0/src/sync.js', 'https://core.anawj.com/sync/1.4.0/src/view.js', 'https://core.anawj.com/sync/1.4.0/src/watchdog.js', 'https://core.anawj.com/sync/1.4.0/src/writes.js', 'https://core.anawj.com/sync/1.4.0/sync.js', 'https://core.anawj.com/sync/1.4.0/src/cache.js', 'https://core.anawj.com/sync/1.4.0/src/report.js',
];
const MANIFEST = {};

importScripts('https://core.anawj.com/update/1.4.0/sw-core.js');
AppUpdate.init({
  app: 'nuh-roster', version: VERSION, shell: SHELL, manifest: MANIFEST,
  never: [/\/sw\.js$/],
  runtime: [
    { name: 'kit', match: 'https://design.anawj.com/v1/', strategy: 'stale-while-revalidate', max: 40 },
    { name: 'pinned', match: /^https:\/\/core\.anawj\.com\/(sync|update)\/\d+\.\d+\.\d+\//, strategy: 'cache-first', max: 40 },
    { name: 'files', match: url => url.origin === self.location.origin && /\.(m?js|css|json|png|svg|jpe?g|webp|ico|woff2?|ttf|webmanifest)$/i.test(url.pathname), strategy: 'stale-while-revalidate', max: 60 },
  ],
});
