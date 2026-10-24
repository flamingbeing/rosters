// The rules kit's shared cases (app-devkit rules/suite.mjs, copied into .devkit/) for ntf-roster/firestore.rules, plus
// this app's own read counts and its old-page (members entry) path. Fake accounts, demo project only.
// Run with tools/test-rules.sh (it starts the emulator and runs this from the repo root).
//
// The kit's tokens carry no email, and every write here is stamped with the signer's email, so its write cases are
// this app's own (below and in rules.emulator.mjs); `write: []` makes the kit check that no claim alone can write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suite } from '../../.devkit/rules/suite.mjs';

const ROLES = ['admin', 'rosterer', 'viewer'];
const emu = suite({
  project: 'demo-ntf-roster',
  rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
  roles: ROLES,
  collections: [
    { path: 'team/main', read: ROLES, write: [], data: { staff: [] } },
    { path: 'months/2026-11', read: ROLES, write: [], data: { month: '2026-11', cells: {} } },
    { path: 'members/someone@example.com', read: ROLES, write: [], data: { role: 'viewer', name: 'X', v: 1 } },
  ],
});

const by = (email) => ({ email, name: 'X' });
const month = (email) => ({ month: '2026-11', cells: '{}', status: 'draft', publishedAt: '', note: '', updatedAt: 2, updatedBy: by(email) });
const google = (email, claims = {}) => emu.as('u-' + email, { email, email_verified: true, ...claims });
const seed = async () => {
  await emu.clear();
  await emu.seed('members/doc@example.com', { role: 'rosterer', name: 'Doc', v: 1 });
  await emu.seed('months/2026-11', month('doc@example.com'));
};

test('claims path: a read costs 1 lookup (revoked/), a save 1', async () => {
  await seed();
  const u = google('claim@example.com', { g: { _: 'rosterer' }, v: 1 });
  assert.equal(await emu.lookups(() => u.get('months/2026-11')), 1);
  let ok;
  assert.equal(await emu.lookups(async () => { ok = await u.set('months/2026-11', month('claim@example.com')); }), 1);
  assert.equal(ok.ok, true);
});

test('members entry path (older pages): a read costs 2 lookups, a save 2 (at most 3)', async () => {
  await seed();
  const u = google('doc@example.com');
  let r;
  assert.equal(await emu.lookups(async () => { r = await u.get('months/2026-11'); }), 2);
  assert.equal(r.ok, true);
  assert.equal(await emu.lookups(async () => { r = await u.set('months/2026-11', month('doc@example.com')); }), 2);
  assert.equal(r.ok, true);
});

test('an admin changing the members list reads the entry itself: 2 lookups, even with a claim', async () => {
  await seed();
  await emu.seed('members/boss@example.com', { role: 'admin', name: 'Boss', v: 1 });
  const u = google('boss@example.com', { g: { _: 'admin' }, v: 1 });
  let r;
  assert.equal(await emu.lookups(async () => { r = await u.update('members/doc@example.com', { role: 'viewer', name: 'Doc', v: 2 }); }), 2);
  assert.equal(r.ok, true);
});

test('a claim beats the members entry; no claim and no entry: nothing', async () => {
  await seed();
  assert.equal((await google('doc@example.com', { g: { _: 'viewer' }, v: 1 }).set('months/2026-11', month('doc@example.com'))).ok, false);
  assert.equal((await google('nobody@example.com').get('months/2026-11')).ok, false);
  assert.equal((await emu.as('u-unverified', { email: 'doc@example.com', email_verified: false }).get('months/2026-11')).ok, false);
});
