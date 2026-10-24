// worker/ntf.js end to end against the Auth and Firestore emulators and ntf-roster/firestore.rules: a claims
// sign-in, a demotion cut off at the next request through revoked/, a removal, and an older page on the members entry.
// Fake accounts, demo project only. Run with tools/test-rules.sh (it starts both emulators).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { admin } from '../claims.js';
import { setup, claims, membersSync, claimFor, ORIGIN } from '../ntf.js';
import { emulator, toValue } from '../../.devkit/rules/suite.mjs';

const PROJECT = 'demo-ntf-roster';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
const emu = emulator({ project: PROJECT, host: FS });
const adm = admin({ project: PROJECT, emulator: { auth: AUTH, firestore: FS } });
const cfg = setup({}, { adm, emulator: true, authBase: `http://${AUTH}/identitytoolkit.googleapis.com` });
const docs = `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents`;

const post = async (url, body, headers = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const idp = (path, body) => post(`http://${AUTH}/identitytoolkit.googleapis.com/v1/${path}?key=fake`, body);

// a verified email-and-password account (stands in for Google: same token fields): { uid, idToken, refreshToken }
async function account(email) {
  const made = (await idp('accounts:signUp', { email, password: 'not-a-real-password', returnSecureToken: true })).body;
  await post(`http://${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`,
    { localId: made.localId, emailVerified: true }, { Authorization: 'Bearer owner' });
  const s = (await idp('accounts:signInWithPassword', { email, password: 'not-a-real-password', returnSecureToken: true })).body;
  return { uid: s.localId, idToken: s.idToken, refreshToken: s.refreshToken };
}
// getIdToken(true): a new ID token with the account's current claims
async function refresh(u) {
  const r = await post(`http://${AUTH}/securetoken.googleapis.com/v1/token?key=fake`, { grant_type: 'refresh_token', refresh_token: u.refreshToken });
  u.idToken = r.body.id_token;
  return u;
}
const tokenBody = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
const call = (fn, u, body) => fn(new Request(`${ORIGIN}/api/x`, { method: 'POST', headers: { Origin: ORIGIN, Authorization: `Bearer ${u.idToken}` },
  body: body ? JSON.stringify(body) : undefined }), cfg).then(async (r) => ({ status: r.status, body: await r.json() }));

// Firestore as that person, through the rules
const read = async (u, path) => (await fetch(`${docs}/${path}`, { headers: { Authorization: `Bearer ${u.idToken}` } })).status;
const save = async (u, path, data) => (await fetch(`${docs}:commit`, {
  method: 'POST', headers: { Authorization: `Bearer ${u.idToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ writes: [{ update: { name: `projects/${PROJECT}/databases/(default)/documents/${path}`, fields: toValue(data).mapValue.fields } }] }) })).status;
const month = (email) => ({ month: '2026-11', cells: '{}', status: 'draft', publishedAt: '', note: '', updatedAt: 2, updatedBy: { email, name: 'X' } });

test('claimFor: known roles only, v defaults to 0', () => {
  assert.deepEqual(claimFor({ role: 'viewer', v: 3 }), { g: { _: 'viewer' }, v: 3 });
  assert.deepEqual(claimFor({ role: 'admin' }), { g: { _: 'admin' }, v: 0 });
  assert.equal(claimFor({ role: 'Viewer' }), null);
  assert.equal(claimFor(null), null);
});

test('claims sign-in, demotion cut off at the next request, re-issue, removal, and an older page', async () => {
  await emu.loadRules(readFileSync(new URL('../../ntf-roster/firestore.rules', import.meta.url), 'utf8'));
  await emu.clear();
  await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await adm.setDoc('members/boss@example.com', { role: 'admin', name: 'Boss', v: 1 });
  await adm.setDoc('members/ann@example.com', { role: 'rosterer', name: 'Ann', v: 1 });
  await adm.setDoc('members/old@example.com', { role: 'viewer', name: 'Old page', v: 1 });
  const boss = await account('boss@example.com'), ann = await account('ann@example.com'), old = await account('old@example.com');

  // sign-in: the page asks for its claims, then refreshes its token
  const c = await call(claims, ann);
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.claims, { m: 'password', g: { _: 'rosterer' }, v: 1 });
  await refresh(ann);
  assert.deepEqual(tokenBody(ann.idToken).g, { _: 'rosterer' });
  let n = 0, status;
  n = await emu.lookups(async () => { status = await save(ann, 'months/2026-11', month('ann@example.com')); });
  assert.equal(status, 200, 'rosterer claim saves');
  assert.equal(n, 1, 'claims path: one lookup (revoked/)');

  // the admin lowers Ann to viewer (v 2), then tells the Worker: her rosterer token is refused at once
  await call(claims, boss); await refresh(boss);
  assert.equal(await save(boss, 'members/ann@example.com', { role: 'viewer', name: 'Ann', v: 2 }), 200);
  const s = await call(membersSync, boss, { email: 'ann@example.com' });
  assert.deepEqual(s.body, { ok: true, accounts: ['cut off'] });
  assert.equal(await save(ann, 'months/2026-11', month('ann@example.com')), 403, 'old claim cannot save');
  assert.equal(await read(ann, 'months/2026-11'), 403, 'and cannot read until re-issued');
  assert.equal(await read(ann, 'members/ann@example.com'), 200, 'but sees her own entry (v 2 is ahead)');

  // her page sees v 2 > 1, asks again: viewer now, revoked/ cleared
  assert.deepEqual((await call(claims, ann)).body.claims, { m: 'password', g: { _: 'viewer' }, v: 2 });
  await refresh(ann);
  assert.equal(await read(ann, 'months/2026-11'), 200);
  assert.equal(await save(ann, 'months/2026-11', month('ann@example.com')), 403, 'viewer cannot save');

  // only an admin (by their entry) may call sync
  assert.equal((await call(membersSync, ann, { email: 'boss@example.com' })).status, 403);

  // removed: revoked/, claims cleared; asking again gives no claims and no access
  assert.equal((await fetch(`${docs}/members/ann@example.com`, { method: 'DELETE', headers: { Authorization: `Bearer ${boss.idToken}` } })).status, 200);
  assert.deepEqual((await call(membersSync, boss, { email: 'ann@example.com' })).body, { ok: true, accounts: ['revoked'] });
  assert.equal(await read(ann, 'months/2026-11'), 403);
  assert.deepEqual((await call(claims, ann)).body.claims, {});
  await refresh(ann);
  assert.equal(await read(ann, 'months/2026-11'), 403);

  // an older page never asks for claims: the members entry still serves it (2 lookups)
  n = await emu.lookups(async () => { status = await read(old, 'months/2026-11'); });
  assert.equal(status, 200);
  assert.equal(n, 2);
});

test('503 without a service account; wrong origin 403; no token 401', async () => {
  const off = setup({});
  const r = await claims(new Request(`${ORIGIN}/api/claims`, { method: 'POST' }), off);
  assert.equal(r.status, 503);
  assert.equal((await membersSync(new Request(`${ORIGIN}/api/members/sync`, { method: 'POST' }), off)).status, 503);
  assert.equal((await membersSync(new Request(`${ORIGIN}/x`, { method: 'POST', headers: { Origin: 'https://evil.example' } }), cfg)).status, 403);
  assert.equal((await membersSync(new Request(`${ORIGIN}/x`, { method: 'POST' }), cfg)).status, 401);
});
