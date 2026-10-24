// Firestore rules checks for nuh-roster/firestore.rules against the local emulator (fake accounts, demo project only).
// Run with tools/test-rules.sh (it starts the emulator and runs this from nuh-roster/).
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, getDocs, collection, addDoc } from 'firebase/firestore';
import fs from 'node:fs';
const env = await initializeTestEnvironment({ projectId: 'demo-roster', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 } });
const ADMIN = 'admin@example.com', ROSTERER = 'rosterer@example.com', VIEWER = 'viewer@example.com', ODD = 'odd@example.com', NOROLE = 'norole@example.com';
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'members', ADMIN), { role: 'admin', name: 'Admin', v: 1 });
  await setDoc(doc(db, 'members', ROSTERER), { role: 'rosterer', name: 'Rosterer', v: 1 });
  await setDoc(doc(db, 'members', VIEWER), { role: 'viewer', name: 'Viewer', v: 1 });
  await setDoc(doc(db, 'members', ODD), { role: 'Viewer', name: 'Mistyped role' });
  await setDoc(doc(db, 'members', NOROLE), { name: 'No role' });
  await setDoc(doc(db, 'rosters', '2026-10-14'), { date: '2026-10-14', day: {}, roster: {}, updatedAt: 1, updatedBy: { email: ROSTERER, name: 'R' } });
  await setDoc(doc(db, 'rosters', '2026-10-14', 'versions', 'v1'), { day: {}, roster: {}, savedAt: 1, savedBy: { email: ROSTERER, name: 'R' } });
});
let n = 0, fail = 0;
async function t(name, p) { n++; try { await p; } catch (e) { fail++; console.log('FAIL', name, e.message.slice(0, 200)); } }
const google = (email, verified = true) => env.authenticatedContext('g-' + email, { email, email_verified: verified }).firestore();
const adm = google(ADMIN), ros = google(ROSTERER), view = google(VIEWER), odd = google(ODD), norole = google(NOROLE);
const stranger = google('someone@example.com'), unv = google(ROSTERER, false), shout = google('Rosterer@Example.com'), nobody = env.unauthenticatedContext().firestore();
const by = email => ({ email, name: 'X' });
const roster = (date, email, extra = {}) => ({ date, day: {}, roster: {}, updatedAt: 2, updatedBy: by(email), ...extra });

// reading
await t('viewer reads a roster', assertSucceeds(getDoc(doc(view, 'rosters', '2026-10-14'))));
await t('viewer reads the team', assertSucceeds(getDoc(doc(view, 'team', 'main'))));
await t('viewer reads versions', assertSucceeds(getDocs(collection(view, 'rosters', '2026-10-14', 'versions'))));
await t('stranger cannot read', assertFails(getDoc(doc(stranger, 'rosters', '2026-10-14'))));
await t('signed out cannot read', assertFails(getDoc(doc(nobody, 'rosters', '2026-10-14'))));
await t('unverified email cannot read', assertFails(getDoc(doc(unv, 'rosters', '2026-10-14'))));
await t('upper-case email still matches its member entry', assertSucceeds(getDoc(doc(shout, 'rosters', '2026-10-14'))));

// writing rosters
await t('rosterer saves a roster', assertSucceeds(setDoc(doc(ros, 'rosters', '2026-10-15'), roster('2026-10-15', ROSTERER))));
await t('admin saves a roster', assertSucceeds(setDoc(doc(adm, 'rosters', '2026-10-15'), roster('2026-10-15', ADMIN))));
await t('viewer cannot save a roster', assertFails(setDoc(doc(view, 'rosters', '2026-10-15'), roster('2026-10-15', VIEWER))));
await t('mistyped role cannot save', assertFails(setDoc(doc(odd, 'rosters', '2026-10-15'), roster('2026-10-15', ODD))));
await t('missing role cannot save', assertFails(setDoc(doc(norole, 'rosters', '2026-10-15'), roster('2026-10-15', NOROLE))));
await t('cannot save under someone else\'s name', assertFails(setDoc(doc(ros, 'rosters', '2026-10-15'), roster('2026-10-15', ADMIN))));
await t('cannot save with no updatedBy', assertFails(setDoc(doc(ros, 'rosters', '2026-10-15'), { date: '2026-10-15', day: {} })));
await t('date must match the document', assertFails(setDoc(doc(ros, 'rosters', '2026-10-15'), roster('2026-10-16', ROSTERER))));
await t('document id must be a date', assertFails(setDoc(doc(ros, 'rosters', 'hello'), roster('hello', ROSTERER))));
await t('rosterer cannot delete a roster', assertFails(deleteDoc(doc(ros, 'rosters', '2026-10-15'))));
await t('admin deletes a roster', assertSucceeds(deleteDoc(doc(adm, 'rosters', '2026-10-15'))));

// versions
const ver = email => ({ day: {}, roster: {}, savedAt: 3, savedBy: by(email) });
await t('rosterer adds a version', assertSucceeds(addDoc(collection(ros, 'rosters', '2026-10-14', 'versions'), ver(ROSTERER))));
await t('version under someone else\'s name', assertFails(addDoc(collection(ros, 'rosters', '2026-10-14', 'versions'), ver(ADMIN))));
await t('viewer cannot add a version', assertFails(addDoc(collection(view, 'rosters', '2026-10-14', 'versions'), ver(VIEWER))));
await t('versions cannot change', assertFails(setDoc(doc(adm, 'rosters', '2026-10-14', 'versions', 'v1'), ver(ADMIN))));
await t('versions cannot be deleted', assertFails(deleteDoc(doc(adm, 'rosters', '2026-10-14', 'versions', 'v1'))));

// team documents
const team = email => ({ staff: [], updatedAt: 2, updatedBy: by(email) });
for (const d of ['main', 'monthly', 'rotations']) await t(`rosterer saves team/${d}`, assertSucceeds(setDoc(doc(ros, 'team', d), team(ROSTERER))));
await t('viewer cannot save the team', assertFails(setDoc(doc(view, 'team', 'main'), team(VIEWER))));
await t('team save under someone else\'s name', assertFails(setDoc(doc(ros, 'team', 'main'), team(ADMIN))));
await t('unknown team document', assertFails(setDoc(doc(ros, 'team', 'other'), team(ROSTERER))));
await t('rosterer cannot delete a team doc', assertFails(deleteDoc(doc(ros, 'team', 'main'))));

// the staff list's history
const tver = email => ({ team: { staff: [] }, savedAt: 3, savedBy: by(email) });
await t('rosterer adds a staff-list version', assertSucceeds(addDoc(collection(ros, 'team', 'main', 'versions'), tver(ROSTERER))));
await t('staff-list version under someone else\'s name', assertFails(addDoc(collection(ros, 'team', 'main', 'versions'), tver(ADMIN))));
await t('viewer cannot add a staff-list version', assertFails(addDoc(collection(view, 'team', 'main', 'versions'), tver(VIEWER))));
await t('no versions for the monthly doc', assertFails(addDoc(collection(ros, 'team', 'monthly', 'versions'), tver(ROSTERER))));
await t('viewer reads staff-list versions', assertSucceeds(getDocs(collection(view, 'team', 'main', 'versions'))));

// members
await t('rosterer cannot add a member', assertFails(setDoc(doc(ros, 'members', 'new@example.com'), { role: 'rosterer', name: 'New' })));
await t('viewer cannot make themselves rosterer', assertFails(setDoc(doc(view, 'members', VIEWER), { role: 'rosterer', name: 'Viewer' })));
await t('admin adds a viewer', assertSucceeds(setDoc(doc(adm, 'members', 'new@example.com'), { role: 'viewer', name: 'New', v: 1 })));
await t('admin cannot add a mistyped role', assertFails(setDoc(doc(adm, 'members', 'new2@example.com'), { role: 'Rosterer', name: 'New', v: 1 })));
await t('admin links a member to a staff record', assertSucceeds(setDoc(doc(adm, 'members', 'new@example.com'), { role: 'viewer', name: 'New', staffId: 'p12', v: 1 })));
await t('staffId must be short text', assertFails(setDoc(doc(adm, 'members', 'new@example.com'), { role: 'viewer', name: 'New', staffId: 12, v: 1 })));
await t('admin cannot add extra fields', assertFails(setDoc(doc(adm, 'members', 'new2@example.com'), { role: 'viewer', name: 'New', admin: true, v: 1 })));
await t('admin cannot add an upper-case email id', assertFails(setDoc(doc(adm, 'members', 'New3@example.com'), { role: 'viewer', name: 'New', v: 1 })));
await t('admin cannot demote themselves', assertFails(setDoc(doc(adm, 'members', ADMIN), { role: 'rosterer', name: 'Admin', v: 2 })));
await t('admin renames themselves', assertSucceeds(setDoc(doc(adm, 'members', ADMIN), { role: 'admin', name: 'Admin Two', v: 1 })));
await t('a new entry starts at v 1', assertFails(setDoc(doc(adm, 'members', 'new4@example.com'), { role: 'viewer', name: 'New' })));
await t('a role change without a v bump is refused', assertFails(setDoc(doc(adm, 'members', 'new@example.com'), { role: 'rosterer', name: 'New', staffId: 'p12', v: 1 })));
await t('a role change bumps v by one', assertSucceeds(setDoc(doc(adm, 'members', 'new@example.com'), { role: 'rosterer', name: 'New', staffId: 'p12', v: 2 })));
await t('v must be a whole number', assertFails(setDoc(doc(adm, 'members', 'new@example.com'), { role: 'rosterer', name: 'New', v: '2' })));
await t('admin cannot remove themselves', assertFails(deleteDoc(doc(adm, 'members', ADMIN))));
await t('admin removes someone else', assertSucceeds(deleteDoc(doc(adm, 'members', 'new@example.com'))));
await t('members list members', assertSucceeds(getDocs(collection(view, 'members'))));
await t('stranger reads own (missing) entry', assertSucceeds(getDoc(doc(stranger, 'members', 'someone@example.com'))));
await t('stranger cannot list members', assertFails(getDocs(collection(stranger, 'members'))));

// access requests
const req = (email, extra = {}) => ({ email, name: 'Asking', requestedAt: 1, ...extra });
await t('stranger asks to join', assertSucceeds(setDoc(doc(stranger, 'accessRequests', 'someone@example.com'), req('someone@example.com'))));
await t('request for someone else', assertFails(setDoc(doc(stranger, 'accessRequests', 'other@example.com'), req('other@example.com'))));
await t('request with extra fields', assertFails(setDoc(doc(stranger, 'accessRequests', 'someone@example.com'), req('someone@example.com', { role: 'admin' }))));
await t('request with a long name', assertFails(setDoc(doc(stranger, 'accessRequests', 'someone@example.com'), req('someone@example.com', { name: 'x'.repeat(101) }))));
await t('rosterer cannot list requests', assertFails(getDocs(collection(ros, 'accessRequests'))));
await t('admin lists requests', assertSucceeds(getDocs(collection(adm, 'accessRequests'))));

// roles from claims (set by the Worker's /api/claims): the claim decides, the members entry is the fallback
const claimed = (email, role, extra = {}) => env.authenticatedContext('c-' + email, { email, email_verified: true, g: { _: role }, v: 1, ...extra }).firestore();
const now = Math.floor(Date.now() / 1000);
await env.withSecurityRulesDisabled(async ctx => {
  await setDoc(doc(ctx.firestore(), 'revoked', 'c-gone@example.com'), { at: 1 });
  await setDoc(doc(ctx.firestore(), 'revoked', 'g-' + VIEWER), { at: 1 });
  await setDoc(doc(ctx.firestore(), 'members', 'gone@example.com'), { role: 'viewer', name: 'Gone', v: 2 });
});
await t('a viewer claim reads with no members entry', assertSucceeds(getDoc(doc(claimed('claim@example.com', 'viewer'), 'rosters', '2026-10-14'))));
await t('a rosterer claim saves a roster', assertSucceeds(setDoc(doc(claimed('claim@example.com', 'rosterer'), 'rosters', '2026-10-20'), roster('2026-10-20', 'claim@example.com'))));
await t('a viewer claim wins over a rosterer entry', assertFails(setDoc(doc(claimed(ROSTERER, 'viewer'), 'team', 'main'), team(ROSTERER))));
await t('an unknown claim role reads only', assertFails(setDoc(doc(claimed('claim@example.com', 'boss'), 'team', 'main'), team('claim@example.com'))));
await t('a claim whose access has ended is refused', assertFails(getDoc(doc(claimed('claim@example.com', 'viewer', { x: now - 60 }), 'team', 'main'))));
await t('a claim with access until later reads', assertSucceeds(getDoc(doc(claimed('claim@example.com', 'viewer', { x: now + 3600 }), 'team', 'main'))));
await t('a revoked account is refused despite its claim', assertFails(getDoc(doc(claimed('gone@example.com', 'viewer'), 'team', 'main'))));
await t('a revoked account is refused on the members entry too', assertFails(getDoc(doc(view, 'team', 'main'))));
await t('a revoked account still reads its own entry (to see the new v)', assertSucceeds(getDoc(doc(claimed('gone@example.com', 'viewer'), 'members', 'gone@example.com'))));
await t('an admin claim cannot change the members list without an admin entry', assertFails(setDoc(doc(claimed('claim@example.com', 'admin'), 'members', 'x@example.com'), { role: 'viewer', name: 'X', v: 1 })));
await t('an admin claim lists access requests', assertSucceeds(getDocs(collection(claimed('claim@example.com', 'admin'), 'accessRequests'))));
await t('an admin claim deletes a roster', assertSucceeds(deleteDoc(doc(claimed('claim@example.com', 'admin'), 'rosters', '2026-10-20'))));
await t('nobody reads revoked/', assertFails(getDoc(doc(claimed('gone@example.com', 'admin'), 'revoked', 'c-gone@example.com'))));
await t('nobody writes revoked/', assertFails(deleteDoc(doc(claimed('gone@example.com', 'admin'), 'revoked', 'c-gone@example.com'))));

await env.cleanup();
if (fail) { console.log(`${fail} of ${n} roster rules checks failed`); process.exit(1); }
console.log(`${n} roster rules checks passed`);
