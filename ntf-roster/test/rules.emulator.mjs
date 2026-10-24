// Firestore rules checks for ntf-roster/firestore.rules against the local emulator (fake accounts, demo project only:
// never signs in, never touches a live project). Run with tools/test-rules.sh (it starts the emulator and runs this
// from ntf-roster/).
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, getDocs, collection, addDoc, runTransaction } from 'firebase/firestore';
import fs from 'node:fs';

const env = await initializeTestEnvironment({ projectId: 'demo-ntf-roster', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 } });
const ADMIN = 'admin@example.com', ROSTERER = 'rosterer@example.com', VIEWER = 'viewer@example.com', ODD = 'odd@example.com', NOROLE = 'norole@example.com';
const by = email => ({ email, name: 'X' });
const team = (email, extra = {}) => ({ settings: { dept: 'Test dept' }, groups: [], tags: [], staff: [{ id: 's1', name: 'Alex Tan', group: 'mo', tags: [] }], duties: [], rules: [], rulesLog: [], updatedAt: 2, updatedBy: by(email), ...extra });
const month = (m, email, extra = {}) => ({ month: m, cells: { [m + '-03']: { s1: { a: ['C'] } } }, status: 'draft', publishedAt: '', note: '', updatedAt: 2, updatedBy: by(email), ...extra });

await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'members', ADMIN), { role: 'admin', name: 'Admin' });
  await setDoc(doc(db, 'members', ROSTERER), { role: 'rosterer', name: 'Rosterer' });
  await setDoc(doc(db, 'members', VIEWER), { role: 'viewer', name: 'Viewer' });
  await setDoc(doc(db, 'members', ODD), { role: 'Viewer', name: 'Mistyped role' });
  await setDoc(doc(db, 'members', NOROLE), { name: 'No role' });
  await setDoc(doc(db, 'team', 'main'), team(ROSTERER, { updatedAt: 1 }));
  await setDoc(doc(db, 'team', 'main', 'versions', 'v1'), { team: { staff: [] }, savedAt: 1, savedBy: by(ROSTERER) });
  await setDoc(doc(db, 'months', '2026-11'), month('2026-11', ROSTERER, { updatedAt: 1 }));
  await setDoc(doc(db, 'months', '2026-11', 'versions', 'v1'), { month: '2026-11', cells: {}, status: 'draft', savedAt: 1, savedBy: by(ROSTERER) });
  await setDoc(doc(db, 'accessRequests', 'waiting@example.com'), { email: 'waiting@example.com', name: 'Waiting', requestedAt: 1 });
});

let n = 0, fail = 0;
async function t(name, p) { n++; try { await p; } catch (e) { fail++; console.log('FAIL', name, String(e.message).slice(0, 200)); } }
const google = (email, verified = true) => env.authenticatedContext('g-' + email, { email, email_verified: verified }).firestore();
const adm = google(ADMIN), ros = google(ROSTERER), view = google(VIEWER), odd = google(ODD), norole = google(NOROLE);
const stranger = google('someone@example.com'), unv = google(ROSTERER, false), shout = google('Rosterer@Example.com'), nobody = env.unauthenticatedContext().firestore();

// reading
await t('viewer reads the team', assertSucceeds(getDoc(doc(view, 'team', 'main'))));
await t('viewer reads a month', assertSucceeds(getDoc(doc(view, 'months', '2026-11'))));
await t('viewer reads month versions', assertSucceeds(getDocs(collection(view, 'months', '2026-11', 'versions'))));
await t('viewer reads team versions', assertSucceeds(getDocs(collection(view, 'team', 'main', 'versions'))));
await t('mistyped role still reads', assertSucceeds(getDoc(doc(odd, 'months', '2026-11'))));
await t('stranger cannot read the team', assertFails(getDoc(doc(stranger, 'team', 'main'))));
await t('stranger cannot read a month', assertFails(getDoc(doc(stranger, 'months', '2026-11'))));
await t('stranger cannot list months', assertFails(getDocs(collection(stranger, 'months'))));
await t('signed out cannot read', assertFails(getDoc(doc(nobody, 'team', 'main'))));
await t('unverified email cannot read', assertFails(getDoc(doc(unv, 'team', 'main'))));
await t('upper-case email still matches its member entry', assertSucceeds(getDoc(doc(shout, 'team', 'main'))));
await t('nothing outside the known collections', assertFails(getDoc(doc(adm, 'other', 'x'))));

// the team document
await t('rosterer saves the team', assertSucceeds(setDoc(doc(ros, 'team', 'main'), team(ROSTERER))));
await t('admin saves the team', assertSucceeds(setDoc(doc(adm, 'team', 'main'), team(ADMIN))));
await t('upper-case sign-in saves stamped in lower case', assertSucceeds(setDoc(doc(shout, 'team', 'main'), team(ROSTERER))));
await t('upper-case stamp is refused', assertFails(setDoc(doc(shout, 'team', 'main'), team('Rosterer@Example.com'))));
await t('viewer cannot save the team', assertFails(setDoc(doc(view, 'team', 'main'), team(VIEWER))));
await t('mistyped role cannot save the team', assertFails(setDoc(doc(odd, 'team', 'main'), team(ODD))));
await t('missing role cannot save the team', assertFails(setDoc(doc(norole, 'team', 'main'), team(NOROLE))));
await t('stranger cannot save the team', assertFails(setDoc(doc(stranger, 'team', 'main'), team('someone@example.com'))));
await t("team save under someone else's name", assertFails(setDoc(doc(ros, 'team', 'main'), team(ADMIN))));
await t('team save with no updatedBy', assertFails(setDoc(doc(ros, 'team', 'main'), { staff: [], updatedAt: 3 })));
await t('team save with a string stamp', assertFails(setDoc(doc(ros, 'team', 'main'), team(ROSTERER, { updatedBy: ROSTERER }))));
await t('team save with an unknown field', assertFails(setDoc(doc(ros, 'team', 'main'), team(ROSTERER, { members: [] }))));
await t('team save with extra keys in the stamp', assertFails(setDoc(doc(ros, 'team', 'main'), team(ROSTERER, { updatedBy: { ...by(ROSTERER), role: 'admin' } }))));
await t('team save dated in the future', assertFails(setDoc(doc(ros, 'team', 'main'), team(ROSTERER, { updatedAt: Date.now() + 86400000 }))));
await t('team save dated now', assertSucceeds(setDoc(doc(ros, 'team', 'main'), team(ROSTERER, { updatedAt: Date.now() }))));
await t('only team/main exists', assertFails(setDoc(doc(ros, 'team', 'monthly'), team(ROSTERER))));
await t('rosterer cannot delete the team', assertFails(deleteDoc(doc(ros, 'team', 'main'))));
await t('admin cannot delete the team either', assertFails(deleteDoc(doc(adm, 'team', 'main'))));

// the team's saved copies
const tver = (email, extra = {}) => ({ team: { staff: [] }, savedAt: 3, savedBy: by(email), ...extra });
await t('rosterer adds a team version', assertSucceeds(addDoc(collection(ros, 'team', 'main', 'versions'), tver(ROSTERER))));
await t("team version under someone else's name", assertFails(addDoc(collection(ros, 'team', 'main', 'versions'), tver(ADMIN))));
await t('viewer cannot add a team version', assertFails(addDoc(collection(view, 'team', 'main', 'versions'), tver(VIEWER))));
await t('team version with an unknown field', assertFails(addDoc(collection(ros, 'team', 'main', 'versions'), tver(ROSTERER, { extra: 1 }))));
await t('team version dated far in the future', assertFails(addDoc(collection(ros, 'team', 'main', 'versions'), tver(ROSTERER, { savedAt: 9999999999999 }))));
await t('team versions cannot change', assertFails(setDoc(doc(adm, 'team', 'main', 'versions', 'v1'), tver(ADMIN))));
await t('team versions cannot be deleted', assertFails(deleteDoc(doc(adm, 'team', 'main', 'versions', 'v1'))));

// months
await t('rosterer saves a month', assertSucceeds(setDoc(doc(ros, 'months', '2026-12'), month('2026-12', ROSTERER))));
await t('admin saves a month', assertSucceeds(setDoc(doc(adm, 'months', '2026-12'), month('2026-12', ADMIN))));
await t('rosterer publishes a month', assertSucceeds(setDoc(doc(ros, 'months', '2026-12'), month('2026-12', ROSTERER, { status: 'published', publishedAt: '2026-11-20T09:00:00Z' }))));
await t('a month with no status, note or publishedAt', assertSucceeds(setDoc(doc(ros, 'months', '2027-01'), { month: '2027-01', cells: {}, updatedAt: 2, updatedBy: by(ROSTERER) })));
await t('viewer cannot save a month', assertFails(setDoc(doc(view, 'months', '2026-12'), month('2026-12', VIEWER))));
await t('mistyped role cannot save a month', assertFails(setDoc(doc(odd, 'months', '2026-12'), month('2026-12', ODD))));
await t("month save under someone else's name", assertFails(setDoc(doc(ros, 'months', '2026-12'), month('2026-12', ADMIN))));
await t('the days as one JSON string', assertSucceeds(setDoc(doc(ros, 'months', '2027-02'), month('2027-02', ROSTERER, { cells: JSON.stringify({ '2027-02-03': { s1: { a: ['C'] } } }) }))));
await t('a JSON string too long', assertFails(setDoc(doc(ros, 'months', '2027-03'), month('2027-03', ROSTERER, { cells: 'x'.repeat(900001) }))));
await t('each roster locks its own month', assertSucceeds(setDoc(doc(ros, 'months', '2027-04'), month('2027-04', ROSTERER, { locks: { junior: '2026-10-19T10:00:00Z', senior: '' } }))));
await t('locks: only junior and senior', assertFails(setDoc(doc(ros, 'months', '2027-04'), month('2027-04', ROSTERER, { locks: { junior: '', other: 'x' } }))));
await t('locks: text only', assertFails(setDoc(doc(ros, 'months', '2027-04'), month('2027-04', ROSTERER, { locks: { junior: true } }))));
await t('locks: a map', assertFails(setDoc(doc(ros, 'months', '2027-04'), month('2027-04', ROSTERER, { locks: 'junior' }))));
await t('a version keeps the locks', assertSucceeds(setDoc(doc(ros, 'months', '2027-04', 'versions', 'v9'), { month: '2027-04', cells: '{}', status: 'draft', locks: { junior: 'x', senior: '' }, savedAt: 3, savedBy: by(ROSTERER) })));
await t('month save with no updatedBy', assertFails(setDoc(doc(ros, 'months', '2026-12'), { month: '2026-12', cells: {} })));
await t('month field must match the document', assertFails(setDoc(doc(ros, 'months', '2026-12'), month('2026-11', ROSTERER))));
await t('document id must be a month', assertFails(setDoc(doc(ros, 'months', 'hello'), month('hello', ROSTERER))));
await t('a day is not a month', assertFails(setDoc(doc(ros, 'months', '2026-12-01'), month('2026-12-01', ROSTERER))));
await t('month 13 is not a month', assertFails(setDoc(doc(ros, 'months', '2026-13'), month('2026-13', ROSTERER))));
await t('unknown status', assertFails(setDoc(doc(ros, 'months', '2026-12'), month('2026-12', ROSTERER, { status: 'final' }))));
await t('cells must be a map or a JSON string, not a list', assertFails(setDoc(doc(ros, 'months', '2026-12'), month('2026-12', ROSTERER, { cells: [] }))));
await t('month save with an unknown field', assertFails(setDoc(doc(ros, 'months', '2026-12'), month('2026-12', ROSTERER, { staff: [] }))));
await t('rosterer cannot delete a month', assertFails(deleteDoc(doc(ros, 'months', '2026-12'))));
await t('admin deletes a month', assertSucceeds(deleteDoc(doc(adm, 'months', '2027-01'))));

// a month's saved copies
const mver = (m, email, extra = {}) => ({ month: m, cells: {}, status: 'draft', publishedAt: '', note: '', savedAt: 3, savedBy: by(email), ...extra });
await t('rosterer adds a month version', assertSucceeds(addDoc(collection(ros, 'months', '2026-11', 'versions'), mver('2026-11', ROSTERER))));
await t('a version with the days as a JSON string', assertSucceeds(addDoc(collection(ros, 'months', '2026-11', 'versions'), mver('2026-11', ROSTERER, { cells: '{}' }))));
await t("month version under someone else's name", assertFails(addDoc(collection(ros, 'months', '2026-11', 'versions'), mver('2026-11', ADMIN))));
await t('viewer cannot add a month version', assertFails(addDoc(collection(view, 'months', '2026-11', 'versions'), mver('2026-11', VIEWER))));
await t('month version for another month', assertFails(addDoc(collection(ros, 'months', '2026-11', 'versions'), mver('2026-10', ROSTERER))));
await t('month version dated far in the future', assertFails(addDoc(collection(ros, 'months', '2026-11', 'versions'), mver('2026-11', ROSTERER, { savedAt: 9999999999999 }))));
await t('month version with an unknown field', assertFails(addDoc(collection(ros, 'months', '2026-11', 'versions'), mver('2026-11', ROSTERER, { updatedAt: 3 }))));
await t('month versions cannot change', assertFails(setDoc(doc(adm, 'months', '2026-11', 'versions', 'v1'), mver('2026-11', ADMIN))));
await t('month versions cannot be deleted', assertFails(deleteDoc(doc(adm, 'months', '2026-11', 'versions', 'v1'))));

// the app's save: team, month and both copies in one transaction (as cloud.js saveAll does)
await t('rosterer saves team and month together', assertSucceeds(runTransaction(ros, async tx => {
  await tx.get(doc(ros, 'team', 'main')); await tx.get(doc(ros, 'months', '2026-11'));
  tx.set(doc(ros, 'team', 'main'), team(ROSTERER, { updatedAt: 5 }));
  tx.set(doc(collection(ros, 'team', 'main', 'versions')), tver(ROSTERER));
  tx.set(doc(ros, 'months', '2026-11'), month('2026-11', ROSTERER, { updatedAt: 5 }));
  tx.set(doc(collection(ros, 'months', '2026-11', 'versions')), mver('2026-11', ROSTERER));
})));

// members
await t('rosterer cannot add a member', assertFails(setDoc(doc(ros, 'members', 'new@example.com'), { role: 'rosterer', name: 'New' })));
await t('viewer cannot make themselves rosterer', assertFails(setDoc(doc(view, 'members', VIEWER), { role: 'rosterer', name: 'Viewer' })));
await t('stranger cannot add themselves', assertFails(setDoc(doc(stranger, 'members', 'someone@example.com'), { role: 'viewer', name: 'Me' })));
await t('admin adds a viewer', assertSucceeds(setDoc(doc(adm, 'members', 'new@example.com'), { role: 'viewer', name: 'New', v: 1 })));
await t('a new entry starts at v 1', assertFails(setDoc(doc(adm, 'members', 'new2@example.com'), { role: 'viewer', name: 'New', v: 5 })));
await t('a role change without a new v is refused', assertFails(setDoc(doc(adm, 'members', 'new@example.com'), { role: 'rosterer', name: 'New', v: 1 })));
await t('a role change may not skip a v', assertFails(setDoc(doc(adm, 'members', 'new@example.com'), { role: 'rosterer', name: 'New', v: 3 })));
await t('admin makes them a rosterer', assertSucceeds(setDoc(doc(adm, 'members', 'new@example.com'), { role: 'rosterer', name: 'New', v: 2 })));
await t('a rename keeps v', assertFails(setDoc(doc(adm, 'members', 'new@example.com'), { role: 'rosterer', name: 'Renamed', v: 3 })));
await t('v must be a number', assertFails(setDoc(doc(adm, 'members', 'new2@example.com'), { role: 'viewer', name: 'New', v: '1' })));
await t('admin cannot add a mistyped role', assertFails(setDoc(doc(adm, 'members', 'new2@example.com'), { role: 'Rosterer', name: 'New' })));
await t('admin links a member to a staff record', assertSucceeds(setDoc(doc(adm, 'members', 'new@example.com'), { role: 'viewer', name: 'New', staffId: 's1', v: 3 })));
await t('staffId must be short text', assertFails(setDoc(doc(adm, 'members', 'new@example.com'), { role: 'viewer', name: 'New', staffId: 12 })));
await t('name must be short', assertFails(setDoc(doc(adm, 'members', 'new@example.com'), { role: 'viewer', name: 'x'.repeat(101) })));
await t('admin cannot add extra fields', assertFails(setDoc(doc(adm, 'members', 'new2@example.com'), { role: 'viewer', name: 'New', admin: true })));
await t('admin cannot add an upper-case email id', assertFails(setDoc(doc(adm, 'members', 'New3@example.com'), { role: 'viewer', name: 'New' })));
await t('member id must look like an email', assertFails(setDoc(doc(adm, 'members', 'not-an-email'), { role: 'viewer', name: 'New' })));
await t('admin cannot demote themselves', assertFails(setDoc(doc(adm, 'members', ADMIN), { role: 'rosterer', name: 'Admin' })));
await t('admin renames themselves', assertSucceeds(setDoc(doc(adm, 'members', ADMIN), { role: 'admin', name: 'Admin Two' })));
await t('admin cannot remove themselves', assertFails(deleteDoc(doc(adm, 'members', ADMIN))));
await t('rosterer cannot remove a member', assertFails(deleteDoc(doc(ros, 'members', 'new@example.com'))));
await t('admin removes someone else', assertSucceeds(deleteDoc(doc(adm, 'members', 'new@example.com'))));
await t('members list members', assertSucceeds(getDocs(collection(view, 'members'))));
await t('stranger reads own (missing) entry', assertSucceeds(getDoc(doc(stranger, 'members', 'someone@example.com'))));
await t("stranger cannot read someone else's entry", assertFails(getDoc(doc(stranger, 'members', ADMIN))));
await t('stranger cannot list members', assertFails(getDocs(collection(stranger, 'members'))));

// access requests
const req = (email, extra = {}) => ({ email, name: 'Asking', requestedAt: 1, ...extra });
await t('stranger asks to join', assertSucceeds(setDoc(doc(stranger, 'accessRequests', 'someone@example.com'), req('someone@example.com'))));
await t('stranger updates their request', assertSucceeds(setDoc(doc(stranger, 'accessRequests', 'someone@example.com'), req('someone@example.com', { name: 'New name', requestedAt: 2 }))));
await t('stranger reads their own request', assertSucceeds(getDoc(doc(stranger, 'accessRequests', 'someone@example.com'))));
await t("stranger cannot read someone else's request", assertFails(getDoc(doc(stranger, 'accessRequests', 'waiting@example.com'))));
await t('request for someone else', assertFails(setDoc(doc(stranger, 'accessRequests', 'other@example.com'), req('other@example.com'))));
await t('request whose email field is someone else', assertFails(setDoc(doc(stranger, 'accessRequests', 'someone@example.com'), req('other@example.com'))));
await t('request with extra fields', assertFails(setDoc(doc(stranger, 'accessRequests', 'someone@example.com'), req('someone@example.com', { role: 'admin' }))));
await t('request with a long name', assertFails(setDoc(doc(stranger, 'accessRequests', 'someone@example.com'), req('someone@example.com', { name: 'x'.repeat(101) }))));
await t('signed out cannot ask', assertFails(setDoc(doc(nobody, 'accessRequests', 'someone@example.com'), req('someone@example.com'))));
await t('unverified email cannot ask', assertFails(setDoc(doc(unv, 'accessRequests', ROSTERER), req(ROSTERER))));
await t('rosterer cannot list requests', assertFails(getDocs(collection(ros, 'accessRequests'))));
await t('stranger cannot list requests', assertFails(getDocs(collection(stranger, 'accessRequests'))));
await t('admin lists requests', assertSucceeds(getDocs(collection(adm, 'accessRequests'))));
await t("rosterer cannot clear someone's request", assertFails(deleteDoc(doc(ros, 'accessRequests', 'waiting@example.com'))));
await t('admin clears a request', assertSucceeds(deleteDoc(doc(adm, 'accessRequests', 'waiting@example.com'))));
await t('stranger withdraws their own request', assertSucceeds(deleteDoc(doc(stranger, 'accessRequests', 'someone@example.com'))));

// roles from claims (set by the Worker's /api/claims): the claim decides, the members entry is the fallback
const claimed = (email, role, extra = {}) => env.authenticatedContext('c-' + email, { email, email_verified: true, g: { _: role }, v: 1, ...extra }).firestore();
const now = Math.floor(Date.now() / 1000);
await env.withSecurityRulesDisabled(async ctx => {
  await setDoc(doc(ctx.firestore(), 'revoked', 'c-gone@example.com'), { at: 1 });
  await setDoc(doc(ctx.firestore(), 'revoked', 'g-' + VIEWER), { at: 1 });
  await setDoc(doc(ctx.firestore(), 'members', 'gone@example.com'), { role: 'viewer', name: 'Gone', v: 2 });
});
await t('a viewer claim reads with no members entry', assertSucceeds(getDoc(doc(claimed('claim@example.com', 'viewer'), 'months', '2026-11'))));
await t('a rosterer claim saves the team', assertSucceeds(setDoc(doc(claimed('claim@example.com', 'rosterer'), 'team', 'main'), team('claim@example.com', { updatedAt: 5 }))));
await t('a viewer claim wins over a rosterer entry', assertFails(setDoc(doc(claimed(ROSTERER, 'viewer'), 'team', 'main'), team(ROSTERER))));
await t('an unknown claim role reads only', assertFails(setDoc(doc(claimed('claim@example.com', 'boss'), 'team', 'main'), team('claim@example.com'))));
await t('a claim whose access has ended is refused', assertFails(getDoc(doc(claimed('claim@example.com', 'viewer', { x: now - 60 }), 'team', 'main'))));
await t('a claim with access until later reads', assertSucceeds(getDoc(doc(claimed('claim@example.com', 'viewer', { x: now + 3600 }), 'team', 'main'))));
await t('a revoked account is refused despite its claim', assertFails(getDoc(doc(claimed('gone@example.com', 'viewer'), 'team', 'main'))));
await t('a revoked account is refused on the members entry too', assertFails(getDoc(doc(view, 'team', 'main'))));
await t('a revoked account still reads its own entry (to see the new v)', assertSucceeds(getDoc(doc(claimed('gone@example.com', 'viewer'), 'members', 'gone@example.com'))));
await t('an admin claim cannot change the members list without an admin entry', assertFails(setDoc(doc(claimed('claim@example.com', 'admin'), 'members', 'x@example.com'), { role: 'viewer', name: 'X', v: 1 })));
await t('an admin claim lists access requests', assertSucceeds(getDocs(collection(claimed('claim@example.com', 'admin'), 'accessRequests'))));
await t('nobody reads revoked/', assertFails(getDoc(doc(claimed('gone@example.com', 'admin'), 'revoked', 'c-gone@example.com'))));
await t('nobody writes revoked/', assertFails(deleteDoc(doc(claimed('gone@example.com', 'admin'), 'revoked', 'c-gone@example.com'))));

await env.cleanup();
if (fail) { console.log(`${fail} of ${n} NTF roster rules checks failed`); process.exit(1); }
console.log(`${n} NTF roster rules checks passed`);
