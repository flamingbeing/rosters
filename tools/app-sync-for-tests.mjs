// app-sync at the version the apps pin, for unit tests (the apps load it from core.anawj.com in the browser).
// Uses APP_SYNC_DIR when set (a checkout of the tag), else a shallow clone of the tag into the temp folder.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_SYNC_VERSION = '1.4.0';
export async function loadAppSync(version = APP_SYNC_VERSION) {
  let dir = process.env.APP_SYNC_DIR;
  if (!dir) {
    dir = join(mkdtempSync(join(tmpdir(), 'app-sync-')), 'app-sync');
    execFileSync('git', ['-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', 'v' + version, 'https://github.com/flamingbeing/app-sync', dir], { stdio: 'inherit' });
  }
  if (!existsSync(join(dir, 'app.js'))) throw new Error('No app-sync in ' + dir);
  // the entries as createDocSync takes them: { createApp, auth, sync, recordSignature, VERSION }
  const u = f => import(pathToFileURL(join(dir, f)).href);
  const [a, au, sy, ix] = await Promise.all(['app.js', 'auth.js', 'sync.js', 'index.js'].map(u));
  return { createApp: a.createApp, auth: au.auth, sync: sy.sync, recordSignature: ix.recordSignature, VERSION: a.VERSION, dir };
}

// localStorage for Node (the outbox falls back to it when there is no IndexedDB)
export function installFakeStorage() {
  const store = {};
  const api = {};
  for (const [k, f] of Object.entries({
    getItem: key => (key in store ? store[key] : null), setItem: (key, v) => { store[key] = String(v); }, removeItem: key => { delete store[key]; },
  })) Object.defineProperty(api, k, { value: f, enumerable: false, configurable: true });
  const proxy = new Proxy(api, {
    get: (t, k) => (k in t ? t[k] : store[k]), ownKeys: () => Object.keys(store), has: (t, k) => k in t || k in store,
    getOwnPropertyDescriptor: (t, k) => (k in store ? { value: store[k], enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(t, k)),
  });
  globalThis.localStorage = proxy;
  return store;
}
