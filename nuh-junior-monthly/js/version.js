// NUH Junior Monthly: the installable app's two helpers.
// 1. registerSW(): installs sw.js (the offline app shell) through the shared update module (app-update register.js):
//    a new version takes over at once and the page reloads once. app.js calls it once at start.
// 2. renderVersion(el): the two small lines that end the settings screen (AGENTS.md, "App version and Get the latest
//    version"): which saved copy this phone runs, and a way out for a phone stuck on an old one. That way out only
//    clears this app's own saved copy (its service worker and its 'nuh-junior-monthly-' caches), never the roster saved in
//    this browser (localStorage, IndexedDB) or sign-in.

const PREFIX = 'nuh-junior-monthly-';
// the app's folder: '/nuh-junior-monthly/' on anawj.com, '/' on nuhjuniormonthly.anawj.com (this file is in js/)
const APP_ROOT = new URL('../', import.meta.url).href;
const SW_URL = new URL('sw.js', APP_ROOT).href;

// 'nuh-junior-monthly-2026-10-14-3f9a2c1d' -> '2026-10-14 (3f9a2c1d)'; an undated name shows as it is; '' when none.
export function versionLabel(cacheNames) {
  const k = (cacheNames || []).filter(x => x.startsWith(PREFIX) && !x.startsWith(PREFIX + 'rt-')).sort().at(-1);   // not the runtime caches
  if (!k) return '';
  const v = k.slice(PREFIX.length), d = /^(\d{4}-\d{2}-\d{2})-([0-9a-f]+)$/.exec(v);
  return d ? `${d[1]} (${d[2]})` : v;
}

export async function appVersion() {
  try { return window.caches ? versionLabel(await caches.keys()) : ''; } catch { return ''; }
}

// Check for signal first (sw.js straight from the network); with none, change nothing. Otherwise unregister only
// this app's service worker, delete only this app's caches and reload. Returns false (and changes nothing) offline.
export async function getLatest() {
  try {
    const res = await fetch(SW_URL + '?fresh=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  } catch {
    return false;
  }
  try {
    const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
    for (const reg of regs) if (reg.scope === APP_ROOT) await reg.unregister(); // other apps on the origin keep theirs
  } catch (e) { console.warn('Could not unregister the service worker', e); }
  try {
    if (window.caches) for (const k of await caches.keys()) if (k.startsWith(PREFIX)) await caches.delete(k);
  } catch (e) { console.warn('Could not clear the saved copy', e); }
  location.reload();
  return true;
}

// The two lines, appended to el. Returns the wrapper.
export function renderVersion(el) {
  const wrap = document.createElement('div');
  wrap.className = 'appver muted';
  wrap.style.cssText = 'font-size:12px;line-height:1.5';
  const ver = document.createElement('div');
  ver.className = 'appver-line';
  const row = document.createElement('div');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'linkish appver-get';
  btn.style.cssText = 'font-size:inherit;font-weight:400;color:inherit;padding:6px 0;cursor:pointer';
  btn.textContent = 'Not updating? Get the latest version';
  const msg = document.createElement('span');
  msg.setAttribute('role', 'status');
  msg.className = 'appver-msg';
  btn.addEventListener('click', async () => {
    btn.disabled = true; msg.textContent = '';
    const ok = await getLatest();
    if (!ok) { msg.textContent = ' No signal: nothing was changed. Try again when you have signal.'; btn.disabled = false; }
  });
  row.append(btn, msg);
  wrap.append(ver, row);
  el.append(wrap);
  appVersion().then(v => { if (v) ver.textContent = 'App version ' + v; });
  return wrap;
}

// Register sw.js everywhere except ?nosw (and file://), through app-update's register.js: it checks for a new version on
// every return to the tab and every 3 h, and reloads the page once when one takes over. Loaded with import(), so a
// blocked core.anawj.com never stops the app; offline it comes from the saved copy (sw.js SHELL).
export const UPDATE = 'https://core.anawj.com/update/0.1.0/register.js';
export async function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:' || new URLSearchParams(location.search).has('nosw')) return null;
  try {
    const m = await import(UPDATE);
    return await m.register({ app: PREFIX.slice(0, -1), sw: SW_URL, scope: APP_ROOT });
  } catch (err) { console.warn('Service worker not registered', err); return null; }
}
