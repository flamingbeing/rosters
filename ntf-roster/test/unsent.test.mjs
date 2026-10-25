// A save whose answer was lost is recognised by content (js/unsent.js `already`), so it is not saved twice; a month that
// differs only in a pool's lock is not mistaken for it. Run: node ntf-roster/test/unsent.test.mjs
import assert from 'node:assert/strict';
import { loadAppSync } from '../../tools/app-sync-for-tests.mjs';
import { already, write } from '../js/unsent.js';
import * as cloud from '../js/cloud.js';

const { recordSignature: sig } = await loadAppSync();
let n = 0;
const ok = (v, name) => { n++; assert.ok(v, name); };

const state = { settings: { title: 'NTF', pool: 'junior' }, staff: [{ id: 's1', name: 'Dr A' }], rules: [], aps: {} };
const team = cloud.pickTeam(state);
const cells = { '2026-11-02': { s1: 'D' } };
const body = (meta = {}) => ({ team, months: [{ m: '2026-11', cells, meta: { status: 'draft', ...meta } }] });
// the cloud as cloud.loadTeam / loadMonth would give it back after that save landed
const cloudWith = (month = {}) => ({
  loadTeam: async () => ({ ...JSON.parse(JSON.stringify(team)), updatedAt: 500, updatedBy: { email: 'a@x.sg', name: 'Dr A' } }),
  loadMonth: async () => ({ month: '2026-11', cells: JSON.parse(JSON.stringify(cells)), status: 'draft', publishedAt: '', note: '', updatedAt: 500, ...month }),
});

ok(!('pool' in team.settings), 'which pool this browser looks at is not part of the team copy');
const same = await already('all', body(), sig, cloudWith());
ok(same && same.at === 500 && same.by.name === 'Dr A', 'the same content in the cloud counts as sent, with its time');
const locked = { locks: { junior: '2026-10-20', senior: '' } };
ok(await already('all', body(locked), sig, cloudWith(locked)), 'same locks: counts as sent');
ok(!(await already('all', body(locked), sig, cloudWith())), 'a lock the cloud lacks: not the same save');
ok(!(await already('all', body(), sig, cloudWith(locked))), 'a lock only the cloud has: not the same save');
ok(!(await already('all', body(), sig, cloudWith({ cells: { '2026-11-02': { s1: 'N' } } }))), 'different days: not the same save');
ok(!(await already('all', body({ status: 'published' }), sig, cloudWith())), 'different status: not the same save');
ok(!(await already('all', body(), sig, { ...cloudWith(), loadTeam: async () => null })), 'no team copy: not sent');
ok(await already('other', body(), sig, cloudWith()) === null, 'only the "all" save is known');
await assert.rejects(() => write('other', body(), {}, false), /Unknown save/); n++;
console.log(`ntf-roster unsent: ${n} checks passed`);
