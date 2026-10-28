// The offline shell holds everything the unsent-saves outbox needs, at the exact versions the page loads, so a phone
// that opens offline can still keep a save. Run: node ntf-roster/test/precache.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAppSync } from '../../tools/app-sync-for-tests.mjs';

const APP_SYNC_VERSION = '1.4.0';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const sw = read('sw.js'), unsent = read('js/unsent.js'), app = read('js/version.js');
let n = 0;
const ok = (v, name) => { n++; assert.ok(v, name); };

const base = `https://core.anawj.com/sync/${APP_SYNC_VERSION}/`;
ok(unsent.includes(base) && unsent.includes('loadCore'), 'the page loads app-sync at the pinned version');
ok(sw.includes(`'${base}index.js'`), 'sw.js precaches index.js');

// every module index.js pulls in (read from the tagged source)
const sync = await loadAppSync(APP_SYNC_VERSION);
const entries = JSON.parse(readFileSync(join(sync.dir, 'entries.json'), 'utf8'));
for (const f of [...entries.app, ...entries.auth, ...entries.sync]) ok(sw.includes(`'${base}${f}'`), `sw.js precaches ${f}`);
ok(['createApp', 'auth', 'sync', 'recordSignature'].every(k => typeof sync[k] === 'function'), 'app-sync gives what docsync.js and unsent.js use');
ok(sync.VERSION === APP_SYNC_VERSION, 'the pinned tag is the version it says');

ok(/update\/1\.4\.0\/register\.js/.test(app) && sw.includes('https://core.anawj.com/update/1.4.0/register.js') && sw.includes("importScripts('https://core.anawj.com/update/1.4.0/sw-core.js')"), 'update module 1.4.0 in page and worker');
ok(!/update\/0\.1\.0/.test(sw + app), 'no older update module left');
ok(/canReload/.test(app), 'the page gives register a canReload');
for (const f of ['js/unsent.js', '../lib/roster-core/docsync.js']) ok(sw.includes(`'${f}'`), `${f} is in the shell`);
console.log(`ntf-roster precache: ${n} checks passed`);
