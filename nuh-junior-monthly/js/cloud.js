// NUH Junior Monthly team sharing: Google sign-in and one shared copy of the roster in Cloud Firestore (Firebase).
// Off until js/firebase-config.js has a project (the owner creates "nuh-junior-monthly" later), and never in practice mode
// (?demo). Until then the roster lives in this browser only and moves between devices with Backup.
// Who may read or write what is enforced by firestore.rules (members only); this file just asks.
// Roles: after sign-in, and whenever this account's members entry has a newer v than its token, the page asks the Worker
// (/api/claims) to put the role on the account, then refreshes its token: the rules then read the role from the token
// (fewer document reads). If that fails (Worker not set up yet, offline, another address), nothing changes: the rules
// read the members entry, as before.
//
// Data (SPEC.md "Team sync"):
//   team/main                 { settings, groups, tags, staff, duties, rules, rulesLog, updatedAt, updatedBy }
//   team/main/versions/*      { team, savedAt, savedBy }                       (a copy of each save, never changed)
//   months/{YYYY-MM}          { month, cells (a JSON string of the days), status, publishedAt, note, updatedAt, updatedBy }
//   months/{m}/versions/*     { month, cells, status, publishedAt, note, savedAt, savedBy }   (never changed)
//   members/{email}           { role: 'admin' | 'rosterer' | 'viewer', name, staffId?, v }   (viewers only read; v goes up
//                             by one when the role changes)
//   accessRequests/{email}    { email, name, requestedAt }                     (people asking to join)
// updatedBy / savedBy = { email (lower case, the signed-in account), name }. Times are Date.now() milliseconds.
//
// Conflicts: each save says which updatedAt it last saw (at load or its own last save). If someone else has saved
// since, the save stops with a Conflict, like two people editing the same paper roster: look at theirs first.

import { FIREBASE_CONFIG } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

export const isDemo = params.has('demo');
export const isConfigured = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
// practice mode (?demo) never signs in or touches the team's data
export const enabled = isConfigured && !isDemo;

// The parts of the state that belong to the whole team (one document); the cells go by month.
export const TEAM_KEYS = ['settings', 'groups', 'tags', 'staff', 'duties', 'rules', 'rulesLog'];
export const ROLES = ['admin', 'rosterer', 'viewer'];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_DOC = 900000; // Firestore's limit is 1 MiB a document; stop well before it with a clear message

let fb = null;
export async function sdk() {
  if (!enabled) throw new Error('The cloud is not switched on.');
  if (fb) return fb;
  const [app, auth, fs] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js'),
  ]);
  const { emulator, ...config } = FIREBASE_CONFIG;
  const a = app.initializeApp(config);
  fb = { auth: auth.getAuth(a), db: fs.getFirestore(a), A: auth, F: fs };
  // browser tests only: a config with emulator: { firestore: '127.0.0.1:8085', auth: 'http://127.0.0.1:9099' }
  // talks to the local emulators (fake accounts, demo project); the real config never has it
  if (emulator && /^demo-/.test(config.projectId)) {
    const [host, port] = String(emulator.firestore).split(':');
    fs.connectFirestoreEmulator(fb.db, host, Number(port));
    if (emulator.auth) auth.connectAuthEmulator(fb.auth, emulator.auth, { disableWarnings: true });
  }
  return fb;
}

// Firestore rejects undefined values; a JSON round trip drops them (and copies, so later edits don't leak in).
const plain = o => JSON.parse(JSON.stringify(o));

// Firestore can't store an array directly inside an array; say so plainly rather than fail deep in the SDK.
function nestedArray(v, inArray = false) {
  if (Array.isArray(v)) return inArray || v.some(x => nestedArray(x, true));
  if (v && typeof v === 'object') return Object.values(v).some(x => nestedArray(x, false));
  return false;
}
function checkDoc(doc, what) {
  if (nestedArray(doc)) throw new Error(`The ${what} has a list inside a list, which the team copy can't store.`);
  if (JSON.stringify(doc).length > MAX_DOC) throw new Error(`The ${what} is too big to save to the team in one go.`);
  return doc;
}

async function me() {
  const { auth } = await sdk();
  const u = auth.currentUser;
  if (!u || !u.email) throw new Error('Sign in first.');
  return { email: u.email.toLowerCase(), name: String(u.displayName || u.email).slice(0, 100) };
}

export class Conflict extends Error {
  // what: 'team' | 'month'; current: { updatedAt, updatedBy } of the copy that is there now
  constructor(what, current, month = '') {
    super(what === 'team' ? 'Someone else saved the team list first.' : `Someone else saved ${month} first.`);
    this.name = 'Conflict';
    this.what = what; this.current = current; this.month = month;
  }
}

// Plain-English messages for the errors people actually meet.
export function friendly(err) {
  const code = String((err && err.code) || '');
  if (err instanceof Conflict) return err.message;
  if (code.endsWith('permission-denied')) return "You don't have permission for that. Ask an admin of the team.";
  if (code.endsWith('unavailable') || code.endsWith('network-request-failed')) return 'No connection to the team copy. Try again with signal.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in was cancelled.';
  if (code === 'auth/popup-blocked') return 'The browser blocked the sign-in window. Allow pop-ups for this site and try again.';
  if (code === 'auth/unauthorized-domain') return "Sign-in isn't set up for this address yet.";
  return (err && err.message) || String(err);
}

// ---- sign-in ----

// cb(user | null) now and whenever sign-in changes. Returns an unsubscribe function.
export async function watchUser(cb) {
  if (!enabled) return () => {};
  const { auth, A } = await sdk();
  return A.onAuthStateChanged(auth, cb);
}

export async function signIn() {
  const { auth, A } = await sdk();
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return (await A.signInWithPopup(auth, provider)).user;
}

// app-sync's createApp, once unsent.js has it (core.anawj.com loaded): the role claims go through it. Without it nothing
// refreshes them and the rules read the members entry.
let appOf = async () => null;
export const useApp = fn => { appOf = fn; };

// An access token for the Google Sheets API (the person's own, valid about an hour, kept in memory by gsheets.js only).
// Asks Google in a pop-up for the Sheets scope; works for any Google account, whether or not it is on the team list.
export async function getSheetsToken() {
  const { auth, A } = await sdk();
  const provider = new A.GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/spreadsheets');
  const u = auth.currentUser;
  provider.setCustomParameters(u && u.email ? { login_hint: u.email } : { prompt: 'select_account' });
  const res = await A.signInWithPopup(auth, provider);
  const cred = A.GoogleAuthProvider.credentialFromResult(res);
  if (!cred || !cred.accessToken) throw new Error('Google did not give access to Sheets.');
  return cred.accessToken;
}

export async function signOut() {
  const { auth, A } = await sdk();
  await A.signOut(auth);
}

export async function currentUser() {
  if (!enabled) return null;
  const { auth } = await sdk();
  return auth.currentUser;
}

// This account's entry in members ({ email, role, name, staffId?, v }), or null if it isn't a member. Also brings the
// token's role claim up to date when the entry is newer (quietly; see the top of this file).
export async function myMember() {
  const { email } = await me();
  const entry = await readMember(email);
  fresh = entry;
  await (await appOf())?.refreshClaims();
  fresh = undefined;
  return entry;
}
async function readMember(email) {
  const { db, F } = await sdk();
  const snap = await F.getDoc(F.doc(db, 'members', email));
  return snap.exists() ? { email, ...snap.data() } : null;
}

// The Worker's claims routes answer on the app's own address only; anywhere else (local tests, the old shared host)
// they are skipped.
const CLAIMS_HOST = 'nuhjuniormonthly.anawj.com';
const onClaimsHost = () => typeof location !== 'undefined' && location.hostname === CLAIMS_HOST;

// Does the token need asking again? Yes when the entry's v is ahead of the claim's, or a member has no claim yet.
export function claimsBehind(entry, tokenClaims = {}) {
  if (!entry) return !!(tokenClaims.g && tokenClaims.g._);   // removed: clear the old claim
  const v = Number.isInteger(entry.v) ? entry.v : 0;
  return !(tokenClaims.g && tokenClaims.g._) || !(Number(tokenClaims.v) >= v);
}

// createApp's claims option: after sign-in, and on myMember(), the token's role is brought up to date through the Worker
let fresh;   // the entry myMember() has just read, so the claims check does not read it again
export const claimsConfig = {
  url: '/api/claims', when: onClaimsHost, behind: claimsBehind,
  entry: async user => { if (fresh !== undefined) { const e = fresh; fresh = undefined; return e; } return readMember(user.email); },
};

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

export const canEdit = member => !!member && (member.role === 'admin' || member.role === 'rosterer');

// ---- state <-> documents (pure: no Firebase) ----

// The team document's data from a state (or from anything with the same keys).
export function pickTeam(state) {
  const out = {};
  for (const k of TEAM_KEYS) out[k] = state[k] ?? (k === 'settings' ? {} : []);
  return plain(out);
}

// A month's days as stored (a JSON string; older or test documents may hold the map itself) back to { date: { staffId: Cell } }.
export function cellsFromDoc(v) {
  if (typeof v === 'string') { try { const o = JSON.parse(v); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export function layoutFromDoc(v) {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return null; } }
  return v && typeof v === 'object' && !Array.isArray(v) && v.rows && typeof v.rows === 'object' ? v : null;
}

// One month's days and its status from a state: { cells: { '2026-11-03': { staffId: Cell } }, meta }.
// layout: the month's imported sheet layout (state.sheets[m]), saved with it so other devices can write to the sheet too.
export function pickMonth(state, m) {
  const cells = {};
  for (const [d, day] of Object.entries(state.cells || {})) if (d.startsWith(m + '-') && day && Object.keys(day).length) cells[d] = day;
  const meta = (state.months || {})[m] || {};
  const lay = (state.sheets || {})[m];
  return plain({ cells, layout: lay && typeof lay === 'object' ? lay : null, meta: { status: meta.status === 'published' ? 'published' : 'draft', publishedAt: meta.publishedAt || '', note: meta.note || '' } });
}

// A new state with the team document's parts put in (cells and months kept).
export function mergeTeam(state, doc) {
  const next = { ...state };
  for (const k of TEAM_KEYS) {
    if (!(k in (doc || {}))) continue;
    const v = doc[k];
    if (k === 'settings' ? (v && typeof v === 'object' && !Array.isArray(v)) : Array.isArray(v)) next[k] = plain(v);
  }
  return next;
}

// A new state with month m's days replaced by the month document's (other months kept).
export function mergeMonth(state, m, doc) {
  const cells = {};
  for (const [d, day] of Object.entries(state.cells || {})) if (!d.startsWith(m + '-')) cells[d] = day;
  for (const [d, day] of Object.entries(cellsFromDoc(doc && doc.cells))) {
    if (d.startsWith(m + '-') && day && typeof day === 'object' && Object.keys(day).length) cells[d] = plain(day);
  }
  // the sheet layout the cloud copy holds (a JSON string); a copy saved before layouts were shared leaves this device's own
  const lay = layoutFromDoc(doc && doc.layout);
  const sheets = lay ? { ...(state.sheets || {}), [m]: lay } : state.sheets;
  const months = { ...(state.months || {}) };
  months[m] = { status: doc && doc.status === 'published' ? 'published' : 'draft', publishedAt: (doc && doc.publishedAt) || '', note: (doc && doc.note) || '' };
  return sheets ? { ...state, cells, months, sheets } : { ...state, cells, months };
}

// ---- team list and months ----

export async function loadTeam() {
  const { db, F } = await sdk();
  const snap = await F.getDoc(F.doc(db, 'team', 'main'));
  return snap.exists() ? snap.data() : null;
}

export async function loadMonth(m) {
  if (!MONTH_RE.test(m)) throw new Error('Not a month: ' + m);
  const { db, F } = await sdk();
  const snap = await F.getDoc(F.doc(db, 'months', m));
  return snap.exists() ? { ...snap.data(), cells: cellsFromDoc(snap.data().cells) } : null;
}

// Every month the cloud holds, with its days: [{ month, cells, layout, status, updatedAt, updatedBy, … }].
export async function loadAllMonths() {
  const { db, F } = await sdk();
  const snap = await F.getDocs(F.collection(db, 'months'));
  return snap.docs.map(d => ({ ...d.data(), month: d.id, cells: cellsFromDoc(d.data().cells) })).filter(d => MONTH_RE.test(d.month));
}

// Who saved last and when, for the status line: { team: {updatedAt, updatedBy} | null, month: … | null (month m),
// months: { 'YYYY-MM': {updatedAt, updatedBy} } (every month in the cloud) }.
export async function lastSaved(m) {
  const [t, all] = await Promise.all([loadTeam(), loadAllMonths()]);
  const meta = d => d ? { updatedAt: d.updatedAt, updatedBy: d.updatedBy } : null;
  const months = {};
  for (const d of all) months[d.month] = meta(d);
  return { team: meta(t), month: m ? months[m] || null : null, months };
}

// The months a state holds anything for (days or an imported sheet): [YYYY-MM, …] in order.
export function monthsWithContent(state) {
  const set = new Set();
  for (const d of Object.keys(state.cells || {})) { const day = state.cells[d]; if (day && Object.keys(day).length && MONTH_RE.test(d.slice(0, 7))) set.add(d.slice(0, 7)); }
  for (const m of Object.keys(state.sheets || {})) if (MONTH_RE.test(m)) set.add(m);
  return [...set].sort();
}

// Save the team list and/or one month together, in one transaction, each with its conflict check and a permanent
// copy in its versions. team: pickTeam(state) or a state; month: { m, cells, meta }.
// teamAt / monthAt: the updatedAt this browser last saw (null if it never loaded one). force: save over theirs.
// Returns { at, by } (the new updatedAt for whatever was saved).
export async function saveAll({ team = null, month = null, months = [] } = {}, { teamAt = null, monthAt = null, monthsAt = {}, force = false } = {}) {
  const { db, F } = await sdk();
  const by = await me(), at = Date.now();
  const teamRef = F.doc(db, 'team', 'main');
  let teamDoc = null;
  if (team) teamDoc = checkDoc(plain({ ...pickTeam(team), updatedAt: at, updatedBy: by }), 'team list');
  // every month to write: { m, ref, doc, seen }; `month` (one) is the older way of asking for the same
  const list = [...(month ? [{ ...month, seen: monthAt }] : []), ...months.map(x => ({ ...x, seen: monthsAt[x.m] ?? null }))].map(x => {
    if (!MONTH_RE.test(x.m)) throw new Error('Not a month: ' + x.m);
    const meta = x.meta || {};
    return { m: x.m, seen: x.seen ?? null, ref: F.doc(db, 'months', x.m), doc: checkDoc(plain({
      month: x.m, cells: JSON.stringify(x.cells || {}),   // one string: as a map, Firestore made an index entry for every field of every cell (over its 40,000 a document)
      ...(x.layout ? { layout: JSON.stringify(x.layout) } : {}),   // only months that were imported from a sheet
      status: meta.status === 'published' ? 'published' : 'draft', publishedAt: meta.publishedAt || '', note: meta.note || '',
      updatedAt: at, updatedBy: by,
    }), `month ${x.m}`) };
  });
  if (!teamDoc && !list.length) return { at, by };
  await F.runTransaction(db, async tx => {
    // a transaction reads everything before it writes anything
    const curTeam = teamDoc ? await tx.get(teamRef) : null;
    const curs = [];
    for (const x of list) curs.push(await tx.get(x.ref));
    const stale = (cur, seen) => !force && cur && cur.exists() && cur.data().updatedAt !== seen;
    if (stale(curTeam, teamAt)) throw new Conflict('team', { updatedAt: curTeam.data().updatedAt, updatedBy: curTeam.data().updatedBy });
    list.forEach((x, i) => { if (stale(curs[i], x.seen)) throw new Conflict('month', { updatedAt: curs[i].data().updatedAt, updatedBy: curs[i].data().updatedBy }, x.m); });
    if (teamDoc) {
      tx.set(teamRef, teamDoc);
      const { updatedAt, updatedBy, ...copy } = teamDoc;
      tx.set(F.doc(F.collection(db, 'team', 'main', 'versions')), { team: copy, savedAt: at, savedBy: by });
    }
    for (const x of list) {
      tx.set(x.ref, x.doc);
      const { updatedAt, updatedBy, ...copy } = x.doc;
      tx.set(F.doc(F.collection(db, 'months', x.m, 'versions')), { ...copy, savedAt: at, savedBy: by });
    }
  });
  return { at, by };
}

export async function saveTeam(state, expectedUpdatedAt = null, { force = false } = {}) {
  return (await saveAll({ team: state }, { teamAt: expectedUpdatedAt, force })).at;
}

export async function saveMonth(m, cells, meta = {}, expectedUpdatedAt = null, { force = false, layout = null } = {}) {
  return (await saveAll({ month: { m, cells, meta, layout } }, { monthAt: expectedUpdatedAt, force })).at;
}

// Earlier saves of a month, newest first (each a whole copy: { id, cells, status, savedAt, savedBy, … }).
export async function listVersions(m, n = 20) {
  const { db, F } = await sdk();
  const q = F.query(F.collection(db, 'months', m, 'versions'), F.orderBy('savedAt', 'desc'), F.limit(n));
  const snap = await F.getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data(), cells: cellsFromDoc(d.data().cells) }));
}

// Earlier saves of the staff list, rules and settings, newest first: { id, team, savedAt, savedBy }.
export async function listTeamVersions(n = 20) {
  const { db, F } = await sdk();
  const snap = await F.getDocs(F.query(F.collection(db, 'team', 'main', 'versions'), F.orderBy('savedAt', 'desc'), F.limit(n)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// One line saying what an earlier save holds, for the restore list. kind: 'month' | 'team'.
export function describeVersion(kind, v) {
  if (kind === 'team') {
    const t = (v && v.team) || {};
    const n = k => (Array.isArray(t[k]) ? t[k].length : 0);
    return `${n('staff')} staff, ${n('rules')} rules, ${n('duties')} duty codes`;
  }
  const days = Object.values(cellsFromDoc(v && v.cells)).filter(d => d && Object.keys(d).length).length;
  return `${days} day${days === 1 ? '' : 's'} filled${v && v.status === 'published' ? ', locked' : ''}`;
}

// ---- members (admins only, enforced by the rules) ----

export async function listMembers() {
  const { db, F } = await sdk();
  const snap = await F.getDocs(F.collection(db, 'members'));
  return snap.docs.map(d => ({ email: d.id, ...d.data() })).sort((a, b) => a.email.localeCompare(b.email));
}

// staffId: who this account is on the staff list (optional).
export async function setMember(email, role, name = '', staffId = '') {
  if (!ROLES.includes(role)) throw new Error('Unknown role: ' + role);
  const id = String(email || '').trim().toLowerCase();
  if (!/^[^@\s/]+@[^@\s/]+$/.test(id)) throw new Error('That is not an email address.');
  const { db, F } = await sdk();
  const doc = { role, name: String(name || '').slice(0, 100) };
  if (staffId) doc.staffId = String(staffId).slice(0, 40);
  // v: 1 for a new entry, one more when the role changes (the rules check it)
  const ref = F.doc(db, 'members', id);
  await F.runTransaction(db, async tx => {
    const old = await tx.get(ref);
    doc.v = nextV(old.exists() ? old.data() : null, role);
    tx.set(ref, doc);
  });
  await tellWorker(id);
  return { email: id, ...doc };
}

export const nextV = (old, role) => !old ? 1 : (Number.isInteger(old.v) ? old.v : 0) + (old.role === role ? 0 : 1);

export async function removeMember(email) {
  const { db, F } = await sdk();
  const id = String(email).toLowerCase();
  await F.deleteDoc(F.doc(db, 'members', id));
  await tellWorker(id);
}

// ---- access requests ----

// The signed-in person asks to join (their own request only; they can ask again to update the name).
export async function requestAccess(name = '') {
  const { db, F } = await sdk();
  const by = await me();
  const doc = { email: by.email, name: String(name || by.name || '').slice(0, 100), requestedAt: Date.now() };
  await F.setDoc(F.doc(db, 'accessRequests', by.email), doc);
  return doc;
}

export async function myAccessRequest() {
  const { db, F } = await sdk();
  const { email } = await me();
  const snap = await F.getDoc(F.doc(db, 'accessRequests', email));
  return snap.exists() ? snap.data() : null;
}

// Admins: everyone waiting, oldest first.
export async function listAccessRequests() {
  const { db, F } = await sdk();
  const snap = await F.getDocs(F.collection(db, 'accessRequests'));
  return snap.docs.map(d => d.data()).sort((a, b) => (a.requestedAt || 0) - (b.requestedAt || 0));
}

export async function deleteAccessRequest(email) {
  const { db, F } = await sdk();
  await F.deleteDoc(F.doc(db, 'accessRequests', String(email).toLowerCase()));
}
