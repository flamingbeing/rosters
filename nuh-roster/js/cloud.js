// Shared storage for the rostering team: Google sign-in and Cloud Firestore (Firebase).
// Only used when firebase-config.js has a project configured. Access is limited by
// firestore.rules to people listed in the "members" collection.
// Roles: after sign-in, and whenever this account's members entry has a newer v than its token, the page asks the Worker
// (/api/claims) to put the role on the account, then refreshes its token: the rules then read the role from the token
// (fewer document reads). If that fails (Worker not set up yet, offline, another address), nothing changes: the rules
// read the members entry, as before.
//
// Data:
//   members/{email}            { role: 'admin' | 'rosterer' | 'viewer', name, staffId?, v } (viewers only read; v goes up
//                              by one when the role changes)
//   team/main                  { settings, staff, roomTemplate, updatedAt, updatedBy }
//   rosters/{date}             { date, day, roster, updatedAt, updatedBy }
//   rosters/{date}/versions/*  { day, roster, savedAt, savedBy }   (never changed once written)
//   accessRequests/{email}     { email, name, requestedAt }       (people asking to join)

import { FIREBASE_CONFIG } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
// demo mode (?demo) never signs in or touches the team's data
export const enabled = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId)
  && typeof location !== 'undefined' && !new URLSearchParams(location.search).has('demo');

let fb = null;
async function sdk() {
  if (fb) return fb;
  const [app, auth, fs] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js'),
  ]);
  const a = app.initializeApp(FIREBASE_CONFIG);
  fb = { auth: auth.getAuth(a), db: fs.getFirestore(a), A: auth, F: fs };
  return fb;
}

// Firestore rejects undefined values; a JSON round trip drops them.
const plain = o => JSON.parse(JSON.stringify(o));
const who = user => ({ email: user.email.toLowerCase(), name: user.rostererName || user.displayName || user.email });

export async function watchUser(cb) {
  if (!enabled) return;
  const { auth, A } = await sdk();
  A.onAuthStateChanged(auth, cb);
}

export async function signIn() {
  const { auth, A } = await sdk();
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await A.signInWithPopup(auth, provider);
}

export async function signOut() {
  const { auth, A } = await sdk();
  await A.signOut(auth);
}

// This account's members entry, or null. Also brings the token's role claim up to date when the entry is newer (quietly;
// see the top of this file).
export async function membership(email) {
  const { db, F } = await sdk();
  const snap = await F.getDoc(F.doc(db, 'members', email.toLowerCase()));
  const entry = snap.exists() ? snap.data() : null;
  await syncClaims(entry);
  return entry;
}

// The Worker's claims routes answer on the app's own address only; anywhere else (local tests, previews) they are skipped.
const CLAIMS_HOST = 'nuhroster.anawj.com';
const onClaimsHost = () => typeof location !== 'undefined' && location.hostname === CLAIMS_HOST;
let claimsAsked = '';   // uid:v last asked for, so a failing Worker is asked once per page, not on every check

// Does the token need asking again? Yes when the entry's v is ahead of the claim's, or a member has no claim yet.
export function claimsBehind(entry, tokenClaims = {}) {
  if (!entry) return !!(tokenClaims.g && tokenClaims.g._);   // removed: clear the old claim
  const v = Number.isInteger(entry.v) ? entry.v : 0;
  return !(tokenClaims.g && tokenClaims.g._) || !(Number(tokenClaims.v) >= v);
}

async function syncClaims(entry) {
  if (!onClaimsHost()) return;
  try {
    const { auth } = await sdk();
    const u = auth.currentUser;
    if (!u) return;
    const { claims } = await u.getIdTokenResult();
    const key = `${u.uid}:${entry ? entry.v ?? 0 : '-'}`;
    if (!claimsBehind(entry, claims) || claimsAsked === key) return;
    claimsAsked = key;
    const r = await fetch('/api/claims', { method: 'POST', headers: { Authorization: 'Bearer ' + await u.getIdToken() } });
    if (r.ok) await u.getIdToken(true);
  } catch (e) { console.warn('claims not updated', e); }
}

// After an admin adds, changes or removes someone: the Worker cuts off that person's older claim at once.
async function tellWorker(email) {
  if (!onClaimsHost()) return;
  try {
    const { auth } = await sdk();
    const u = auth.currentUser;
    if (!u) return;
    await fetch('/api/members/sync', { method: 'POST', headers: { Authorization: 'Bearer ' + await u.getIdToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }) });
  } catch (e) { console.warn('members sync failed', e); }
}

// ---- team list ----

export async function loadTeam() {
  const { db, F } = await sdk();
  const snap = await F.getDoc(F.doc(db, 'team', 'main'));
  return snap.exists() ? snap.data() : null;
}

export async function saveTeam(data, user) {
  const { db, F } = await sdk();
  const doc = plain({ ...data, updatedAt: Date.now(), updatedBy: who(user) });
  await F.setDoc(F.doc(db, 'team', 'main'), doc);
  return doc;
}

// Save the staff list (team/main), the monthly rosters and the rotations together, in one transaction, so they stay
// in step. expectedUpdatedAt is team/main's time when this browser last loaded or saved it: if someone else has
// saved since, a Conflict is thrown unless force is set (as for rosters).
export async function saveTeamAll({ team, months, rotations }, user, { expectedUpdatedAt = null, force = false } = {}) {
  const { db, F } = await sdk();
  const by = who(user), now = Date.now();
  const main = F.doc(db, 'team', 'main');
  const doc = plain({ ...team, updatedAt: now, updatedBy: by });
  await F.runTransaction(db, async tx => {
    const cur = await tx.get(main);
    if (!force && cur.exists() && cur.data().updatedAt !== expectedUpdatedAt) {
      throw new Conflict({ updatedAt: cur.data().updatedAt, updatedBy: cur.data().updatedBy });
    }
    tx.set(main, doc);
    // a copy of each save of the staff list, rooms and settings (permanent in the rules), to go back to if needed
    tx.set(F.doc(F.collection(db, 'team', 'main', 'versions')), plain({ team, savedAt: now, savedBy: by }));
    tx.set(F.doc(db, 'team', 'monthly'), plain({ months, updatedAt: now, updatedBy: by }));
    tx.set(F.doc(db, 'team', 'rotations'), plain({ weeks: rotations.weeks || {}, updatedAt: now, updatedBy: by }));
  });
  return doc;
}

// The monthly rosters live in their own document, so the staff list stays small.
export async function loadMonthly() {
  const { db, F } = await sdk();
  const snap = await F.getDoc(F.doc(db, 'team', 'monthly'));
  return snap.exists() ? snap.data() : null;
}

export async function saveMonthly(months, user) {
  const { db, F } = await sdk();
  await F.setDoc(F.doc(db, 'team', 'monthly'), plain({ months, updatedAt: Date.now(), updatedBy: who(user) }));
}

// Junior rotations (postings by week) for every year, in their own document.
export async function loadRotations() {
  const { db, F } = await sdk();
  const snap = await F.getDoc(F.doc(db, 'team', 'rotations'));
  return snap.exists() ? snap.data() : null;
}

export async function saveRotations(rot, user) {
  const { db, F } = await sdk();
  await F.setDoc(F.doc(db, 'team', 'rotations'), plain({ weeks: rot.weeks || {}, updatedAt: Date.now(), updatedBy: who(user) }));
}

// ---- rosters ----

export async function rosterMeta(date) {
  const { db, F } = await sdk();
  const snap = await F.getDoc(F.doc(db, 'rosters', date));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { updatedAt: d.updatedAt, updatedBy: d.updatedBy };
}

export async function loadRoster(date) {
  const { db, F } = await sdk();
  const snap = await F.getDoc(F.doc(db, 'rosters', date));
  return snap.exists() ? snap.data() : null;
}

export class Conflict extends Error {
  constructor(current) { super('Someone else saved this roster first.'); this.current = current; }
}

// Save the roster for a date and add an entry to its history.
// expectedUpdatedAt is the version this browser last loaded or saved; if the cloud copy has
// moved on since, a Conflict is thrown unless force is set.
export async function saveRoster(date, { day, roster }, user, { expectedUpdatedAt = null, force = false } = {}) {
  const { db, F } = await sdk();
  const ref = F.doc(db, 'rosters', date);
  const by = who(user);
  const now = Date.now();
  await F.runTransaction(db, async tx => {
    const cur = await tx.get(ref);
    if (!force && cur.exists() && cur.data().updatedAt !== expectedUpdatedAt) {
      throw new Conflict({ updatedAt: cur.data().updatedAt, updatedBy: cur.data().updatedBy });
    }
    tx.set(ref, plain({ date, day, roster, updatedAt: now, updatedBy: by }));
    tx.set(F.doc(F.collection(db, 'rosters', date, 'versions')), plain({ day, roster, savedAt: now, savedBy: by }));
  });
  return now;
}

export async function listVersions(date, n = 30) {
  const { db, F } = await sdk();
  const q = F.query(F.collection(db, 'rosters', date, 'versions'), F.orderBy('savedAt', 'desc'), F.limit(n));
  const snap = await F.getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function listRosters(n = 30) {
  const { db, F } = await sdk();
  const q = F.query(F.collection(db, 'rosters'), F.orderBy('updatedAt', 'desc'), F.limit(n));
  const snap = await F.getDocs(q);
  return snap.docs.map(d => ({ date: d.id, updatedAt: d.data().updatedAt, updatedBy: d.data().updatedBy }));
}

// ---- access requests ----

export async function myRequest(email) {
  const { db, F } = await sdk();
  const snap = await F.getDoc(F.doc(db, 'accessRequests', email.toLowerCase()));
  return snap.exists() ? snap.data() : null;
}

export async function requestAccess(user, name) {
  const { db, F } = await sdk();
  const email = user.email.toLowerCase();
  const doc = { email, name: String(name || user.displayName || '').slice(0, 100), requestedAt: Date.now() };
  await F.setDoc(F.doc(db, 'accessRequests', email), doc);
  return doc;
}

export async function listRequests() {
  const { db, F } = await sdk();
  const snap = await F.getDocs(F.collection(db, 'accessRequests'));
  return snap.docs.map(d => d.data()).sort((a, b) => a.requestedAt - b.requestedAt);
}

export async function deleteRequest(email) {
  const { db, F } = await sdk();
  await F.deleteDoc(F.doc(db, 'accessRequests', email.toLowerCase()));
}

// ---- members (admins only, enforced by the rules) ----

export async function listMembers() {
  const { db, F } = await sdk();
  const snap = await F.getDocs(F.collection(db, 'members'));
  return snap.docs.map(d => ({ email: d.id, ...d.data() })).sort((a, b) => a.email.localeCompare(b.email));
}

// staffId: who this account is on the staff list (set by an admin), so My day doesn't have to guess from the name.
export async function setMember(email, role, name = '', staffId = '') {
  const { db, F } = await sdk();
  const id = email.trim().toLowerCase();
  const doc = { role, name, ...(staffId ? { staffId } : {}) };
  // v: 1 for a new entry, one more when the role changes (the rules check it)
  const ref = F.doc(db, 'members', id);
  await F.runTransaction(db, async tx => {
    const old = await tx.get(ref);
    doc.v = nextV(old.exists() ? old.data() : null, role);
    tx.set(ref, doc);
  });
  await tellWorker(id);
}

export const nextV = (old, role) => !old ? 1 : (Number.isInteger(old.v) ? old.v : 0) + (old.role === role ? 0 : 1);

export async function removeMember(email) {
  const { db, F } = await sdk();
  const id = email.toLowerCase();
  await F.deleteDoc(F.doc(db, 'members', id));
  await tellWorker(id);
}
