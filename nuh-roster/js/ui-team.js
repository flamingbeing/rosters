// The team file, team sign-in and rosters shared through the cloud.
import { DEFAULT_SETTINGS, DEFAULT_ROOMS, matchName } from './engine.js';
import * as cloud from './cloud.js';
import { emptyRotations } from './rotations.js';
import { blankState, cleanStaffNames, clone, DEMO, download, h, migrateRooms, saveTimer, select, setClearedForGood, setNextId, setState, state, syncRooms, toast, undoToast } from './ui-core.js';
import { dayHash, markSaved, render, setHashPending, switchDate } from './ui-screen.js';
import { setStaffBackup } from './ui-staff.js';
import { clearUndo, logRoster, pushUndoAll, setEditing, setLastRows, undoStack } from './ui-roster.js';
import { myDayDate, viewerLoad } from './ui-myday.js';

// ---------- team file ----------

document.getElementById('saveTeam').addEventListener('click', () => {
  const data = { kind: 'ot-roster-team', version: 1, savedAt: new Date().toISOString(), settings: state.settings, staff: state.staff, roomTemplate: state.roomTemplate, roomsVersion: state.roomsVersion, staffLog: state.staffLog || [], rotations: state.rotations };
  download(`OT roster team file ${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
});
document.getElementById('loadTeam').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.kind === 'ot-roster-all' && data.state) {
      // a whole browser's roster (from the old address): staff, days, monthly rosters, rotations, settings
      const d = data.state;
      if (!Array.isArray(d.staff) || (d.day && typeof d.day !== 'object') || (d.days && typeof d.days !== 'object')) { toast('That file is damaged: its staff list or days are missing. Nothing was changed.'); return; }
      if (state.staff.length && !confirm('Replace everything the roster has saved in this browser with this file?')) return;
      const before = state;
      try {
        setState({ ...blankState(), ...d, roomsVersion: d.roomsVersion || 1, settings: { ...clone(DEFAULT_SETTINGS), ...d.settings } });
        state.day ||= blankState().day;
        state.rotations ||= emptyRotations();
        cleanStaffNames(); migrateRooms(); syncRooms();
      } catch {
        setState(before); // keep what was here rather than a half-loaded file
        toast('That file is damaged, so nothing was changed.');
        return;
      }
      setNextId(1 + state.staff.reduce((m, p) => Math.max(m, parseInt(String(p.id).replace(/\D/g, ''), 10) || 0), 0));
      clearUndo(); setLastRows(state.roster ? JSON.stringify(state.roster.rows) : null);
      render();
      toast(`Loaded everything from the file: ${state.staff.length} staff, ${Object.keys(state.days || {}).length + 1} days.`);
      return;
    }
    if (data.kind !== 'ot-roster-team') throw new Error('not a team file');
    if (state.staff.length && !confirm('Replace the staff list, rooms and settings in this browser with the team file?')) return;
    state.settings = { ...clone(DEFAULT_SETTINGS), ...data.settings };
    state.staff = data.staff || [];
    state.staffLog = data.staffLog || [];
    setStaffBackup(null);
    cleanStaffNames();
    state.roomTemplate = data.roomTemplate || clone(DEFAULT_ROOMS);
    state.roomsVersion = data.roomsVersion || 1;
    if (data.rotations) state.rotations = { ...emptyRotations(), ...data.rotations };
    migrateRooms();
    setNextId(1 + state.staff.reduce((m, p) => Math.max(m, parseInt(String(p.id).replace(/\D/g, ''), 10) || 0), 0));
    syncRooms();
    render();
    toast(`Team file loaded: ${state.staff.length} staff.`);
  } catch (err) {
    toast(err instanceof SyntaxError ? "That file isn't a roster file (it can't be read as JSON)." : "That file isn't an OT roster team file or a Download everything file.");
  }
});

// ---------- team sign-in and shared rosters ----------

export const cs = { ready: !cloud.enabled, user: null, member: null, meta: {}, versions: {}, recent: null, members: null, request: null, requests: null };
export let rostererName = '';
const nameKey = () => 'ot-roster-name:' + (cs.user?.email || '').toLowerCase();
function storeName(n) { rostererName = n; try { localStorage.setItem(nameKey(), n); } catch { /* no storage */ } }
state.cloudBase ||= {}; // date -> updatedAt of the cloud copy this browser last loaded or saved

export const isMember = () => !!cs.member;
export const isAdmin = () => cs.member?.role === 'admin';
export const isViewer = () => cs.member?.role === 'viewer'; // reads the saved rosters and My day; changes nothing
const ROLES = [['rosterer', 'Rosterer'], ['admin', 'Admin'], ['viewer', 'Viewer (sees rosters, changes nothing)']];
const me = () => ({ email: cs.user.email, displayName: cs.user.displayName, rostererName: rostererName.trim() });
export const when = ms => new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const byName = b => b?.name || b?.email || 'someone';

// Cloud errors in words someone can act on; the technical message goes to the console.
export function cloudError(e) {
  console.error(e);
  const code = String(e?.code || '').replace(/^firestore\//, ''), msg = String(e?.message || e || '');
  const kept = ' Your work is still kept in this browser.';
  const words =
    code === 'permission-denied' ? "You don't have access to that. Ask an admin to add you to the team (or give you the rosterer role)."
    : code === 'unauthenticated' ? 'You\'ve been signed out. Sign in again, then try once more.' + kept
    : code === 'unavailable' || !navigator.onLine || /network|fetch|offline|dynamically imported module/i.test(msg) ? "Can't reach the team's storage (offline, or the hospital network blocks it). Try again when connected." + kept
    : code === 'deadline-exceeded' || code === 'resource-exhausted' ? 'The team\'s storage is slow or busy right now. Try again in a minute.' + kept
    : `Something went wrong talking to the team's storage (${code || 'error'}). Try again.` + kept;
  toast(words);
}

export function renderCloudBar() {
  const el = document.getElementById('cloud');
  if (!el) return;
  const note = document.getElementById('privacy');
  if (note && DEMO) note.hidden = true; // the demo banner says it already
  else if (note && cloud.enabled) {
    note.textContent = isMember() ? '' : 'Works in this browser without signing in. Sign in to save and share rosters with the team.';
    note.hidden = isMember();
  }
  if (!cloud.enabled) { el.replaceChildren(); return; }
  if (!cs.ready) { el.replaceChildren(h('span', { class: 'seen' }, 'Connecting…')); return; }
  if (!cs.user) {
    el.replaceChildren(h('button', { class: 'primary', onclick: () => cloud.signIn().catch(e => { if (e?.code !== 'auth/popup-closed-by-user') cloudError(e); }) }, 'Sign in with Google'));
    return;
  }
  const out = h('span', { class: 'signout' },
    h('button', { onclick: () => cloud.signOut() }, 'Sign out'),
    h('button', { class: 'small', title: 'For a shared computer: also removes the roster, staff list and your name from this browser', onclick: signOutAndClear }, 'Sign out and clear this computer'));
  if (!cs.member) {
    if (!cs.memberError) {
      el.replaceChildren(...[
        cs.request
          ? h('span', { class: 'seen' }, `${cs.user.email}: access requested ${when(cs.request.requestedAt)}. An admin needs to approve it, then sign in again.`)
          : [h('span', { class: 'seen' }, `${cs.user.email} isn't on the team yet.`),
            h('button', { class: 'primary', onclick: async () => {
              const name = prompt('Your name, so the admin knows who you are:', cs.user.displayName || '');
              if (name === null) return;
              try { cs.request = await cloud.requestAccess(cs.user, name.trim()); render(); toast('Access requested. An admin will approve it.'); } catch (e) { cloudError(e); }
            } }, 'Request access')],
        out].flat());
      return;
    }
    const why = cs.memberError === 'permission-denied'
        ? `Signed in as ${cs.user.email}, but the database refused access. Check the Firestore rules are published.`
        : `Signed in as ${cs.user.email}, but the team list couldn't be checked (${cs.memberError}).`;
    el.replaceChildren(h('span', { class: 'seen' }, why), out);
    return;
  }
  el.replaceChildren(...[
    h('label', { class: 'seen', title: 'Shown in the history when you save' }, 'Rosterer ',
      h('input', { value: rostererName, placeholder: cs.user.displayName || 'Your name', style: 'width:140px', onchange: e => {
        storeName(e.target.value);
      } })),
    h('span', { class: 'seen', title: cs.user.email }, isAdmin() ? 'admin' : ''),
    isAdmin() && Array.isArray(cs.requests) && cs.requests.length
      ? h('button', { onclick: () => { state.tab = 'settings'; render(); document.getElementById('requests')?.scrollIntoView(); } }, `${cs.requests.length} access request${cs.requests.length > 1 ? 's' : ''}`)
      : null,
    out].filter(Boolean));
}

cloud.watchUser(async user => {
  cs.user = user; cs.member = null; cs.meta = {}; cs.versions = {}; cs.recent = null; cs.members = null; cs.request = null; cs.requests = null;
  if (user) {
    cs.memberError = null;
    try { cs.member = await cloud.membership(user.email); } catch (e) { cs.memberError = e?.code || String(e); console.error(e); }
    rostererName = '';
    try { rostererName = localStorage.getItem(nameKey()) || ''; } catch { /* no storage */ }
    if (cs.member && !rostererName) rostererName = cs.member.name || user.displayName || '';
    if (!cs.member && !cs.memberError) { try { cs.request = await cloud.myRequest(user.email); } catch (e) { console.error(e); } }
    if (cs.member?.role === 'admin') { try { cs.requests = await cloud.listRequests(); } catch (e) { console.error(e); cs.requests = []; } }
  }
  cs.ready = true;
  if (isViewer()) { state.tab = 'myday'; document.body.classList.add('viewer'); }
  render();
  if (cs.member) await loadTeamFromCloud(false);
  if (isViewer()) { const d = myDayDate(); if (d !== state.day.date) switchDate(d); else viewerLoad(d); }
}).catch(e => { cs.ready = true; cloudError(e); render(); });

const teamHash = () => JSON.stringify([state.settings, state.staff, state.roomTemplate, state.staffLog || [], state.monthly || {}, state.rotations || {}]);

// Shown on the staff and settings tabs: whether this browser's staff list, rooms and settings match the team's.
export function teamSyncBar() {
  if (!isMember()) return cloud.enabled ? null : h('p', { class: 'hint' }, 'To share with other rosterers, use Export JSON at the bottom of the page.');
  const dirty = state.teamSyncedHash !== teamHash();
  return h('div', { class: 'bar sync' + (dirty ? ' dirty' : '') },
    h('span', {}, dirty
      ? 'You have changes to staff, rooms, settings or monthly rosters that the team doesn\'t have yet.'
      : `Shared with the team${state.teamSyncedAt ? `, last saved ${when(state.teamSyncedAt)}` : ''}.`),
    h('button', { class: dirty ? 'primary' : '', onclick: () => saveTeamToCloud() }, 'Save for the team'),
    h('button', { onclick: () => loadTeamFromCloud(true) }, 'Load team version'));
}

// A shared OT computer: sign out and leave nothing of the roster behind in this browser.
async function signOutAndClear() {
  const unsavedDay = (date, day, roster) => roster && state.cloudHash?.[date]?.hash !== dayHash(day, roster);
  const unsaved = state.teamSyncedHash !== teamHash() || unsavedDay(state.day.date, state.day, state.roster)
    || Object.entries(state.days || {}).some(([d, rec]) => unsavedDay(d, rec.day, rec.roster));
  if (!confirm(`Sign out and remove the roster, staff list and your name from this browser?${unsaved ? '\n\nSome changes here are not saved for the team: press Cancel and save them (or Download everything) first.' : ''}`)) return;
  try {
    for (const k of Object.keys(localStorage)) if (/^(ot-roster|nuh-roster)/.test(k)) localStorage.removeItem(k);
  } catch { /* no storage */ }
  clearTimeout(saveTimer); setClearedForGood(true);
  window.onbeforeunload = null;
  try { await cloud.signOut(); } catch { /* signed out anyway */ }
  location.reload();
}

async function saveTeamToCloud(force = false) {
  try {
    const team = { settings: state.settings, staff: state.staff, roomTemplate: state.roomTemplate, roomsVersion: state.roomsVersion, staffLog: state.staffLog || [] };
    const hash = teamHash(); // what is being sent
    let doc;
    try {
      doc = await cloud.saveTeamAll({ team, months: state.monthly || {}, rotations: state.rotations || emptyRotations() }, me(), { expectedUpdatedAt: state.teamSyncedAt ?? null, force });
    } catch (e) {
      if (!(e instanceof cloud.Conflict)) throw e;
      // someone saved the team list after this browser last loaded it: don't overwrite their work unasked
      const c = e.current;
      if (confirm(`${byName(c.updatedBy)} saved the team's staff list, rooms and monthly rosters ${when(c.updatedAt)}, after this browser last loaded them.\n\nOK: replace theirs with this browser's version.\nCancel: keep theirs (you can then load it, or download yours first).`)) return saveTeamToCloud(true);
      toast('Not saved. The team version is newer.', { label: 'Load team version', run: () => loadTeamFromCloud(true) });
      return;
    }
    state.teamSyncedAt = doc.updatedAt;
    state.teamSyncedHash = hash;
    render();
    toast(`Saved for the team: ${state.staff.length} staff, ${state.roomTemplate.length} rooms and settings.`);
  } catch (e) { cloudError(e); }
}

async function loadTeamFromCloud(asked) {
  try {
    const t = await cloud.loadTeam();
    if (!t) { if (asked) toast('Nobody has saved a team staff list yet.'); return; }
    if (!asked && t.updatedAt === state.teamSyncedAt) return;
    // this browser has its own unsaved changes: say the team's is newer instead of offering to replace them
    if (!asked && state.staff.length && !isViewer() && state.teamSyncedHash && state.teamSyncedHash !== teamHash()) {
      toast(`The team's staff list was saved by ${byName(t.updatedBy)} ${when(t.updatedAt)}; this browser has changes not saved for the team.`, { label: 'Load theirs', run: () => loadTeamFromCloud(true) });
      return;
    }
    if (state.staff.length && !isViewer() && !confirm(`Load the team's staff list (${t.staff?.length || 0} people, saved by ${byName(t.updatedBy)} ${when(t.updatedAt)})? It replaces the staff list, rooms and settings in this browser.`)) return;
    state.settings = { ...clone(DEFAULT_SETTINGS), ...t.settings };
    state.staff = t.staff || [];
    state.staffLog = t.staffLog || [];
    setStaffBackup(null);
    cleanStaffNames();
    state.roomTemplate = t.roomTemplate || clone(DEFAULT_ROOMS);
    const m = await cloud.loadMonthly();
    if (m) state.monthly = m.months || {};
    const rot = await cloud.loadRotations();
    if (rot) state.rotations = { ...emptyRotations(), weeks: rot.weeks || {} };
    state.teamSyncedAt = t.updatedAt;
    state.roomsVersion = t.roomsVersion || 1;
    migrateRooms();
    setNextId(1 + state.staff.reduce((m, p) => Math.max(m, parseInt(String(p.id).replace(/\D/g, ''), 10) || 0), 0));
    syncRooms();
    state.teamSyncedHash = teamHash();
    render();
    toast(`Team version loaded: ${state.staff.length} staff, ${state.roomTemplate.length} rooms and settings.`);
  } catch (e) { cloudError(e); }
}

export async function saveRosterToCloud() {
  const date = state.day.date;
  if (!date) return toast('Pick a date first.');
  if (state.roster?.date && state.roster.date !== date) return toast(`This roster is for ${state.roster.date}, not ${date}. Generate or restore it for ${date} first.`);
  if (!rostererName.trim()) {
    const n = prompt('Your name, for the roster history:', cs.user.displayName || '');
    if (!n) return;
    storeName(n.trim());
  }
  const data = { day: state.day, roster: state.roster };
  const hash = dayHash(); // what is being sent: edits made during the save stay "not saved"
  try {
    let ts;
    try {
      ts = await cloud.saveRoster(date, data, me(), { expectedUpdatedAt: state.cloudBase[date] ?? null });
    } catch (e) {
      if (!(e instanceof cloud.Conflict)) throw e;
      const c = e.current;
      if (!confirm(`${byName(c.updatedBy)} saved the ${date} roster at ${when(c.updatedAt)}, after you opened it.\n\nOK: save yours as the latest (theirs stays in the history).\nCancel: don't save, so you can open theirs from the history first.`)) return;
      ts = await cloud.saveRoster(date, data, me(), { force: true });
    }
    state.cloudBase[date] = ts;
    markSaved(date, ts, hash);
    delete cs.meta[date]; delete cs.versions[date]; cs.recent = null;
    render();
    toast(`Saved the ${date} roster.`);
  } catch (e) { cloudError(e); }
}

// Has anything been set up for this day (rooms running, case notes, anyone's status)?
const dayHasData = d => !!d && ((d.rooms || []).some(r => r.notes || r.lockSenior || r.lockJunior)
  || Object.values(d.staff || {}).some(x => x.manual || x.manualLiver || x.manualAway || x.comment || x.leaveTime || x.aoh));
function openSaved(date, snapshot, updatedAt) {
  const here = state.day.date === date;
  // what this browser already has for that date, on screen or put away
  const local = here ? state.roster || dayHasData(state.day) : state.days?.[date] && (state.days[date].roster || dayHasData(state.days[date].day));
  // on the date on screen Undo brings back what was there; another date's local copy can't be undone
  if (local && !here && !confirm(`Replace what you have for ${date} with the saved version? Your changes to that date in this browser will be lost.`)) return;
  if (here) pushUndoAll('the restore', { day: true });
  else { (state.days ||= {})[state.day.date] = { day: state.day, roster: state.roster }; clearUndo(); }
  delete state.days?.[date];
  state.day = clone(snapshot.day);
  state.roster = clone(snapshot.roster);
  state.day.date = date;
  logRoster([`Restored the version saved ${snapshot.savedAt ? when(snapshot.savedAt) : ''} by ${byName(snapshot.savedBy || snapshot.updatedBy)}`.replace('  ', ' ')]);
  setLastRows(state.roster ? JSON.stringify(state.roster.rows) : null);
  state.cloudBase[date] = updatedAt;
  setHashPending({ date, at: updatedAt });
  setEditing(null);
  syncRooms();
  state.tab = 'roster';
  render();
  if (here && undoStack.length) undoToast(`Restored the ${date} roster.`); else toast(`Restored the ${date} roster.`);
}

async function openLatest(date) {
  try {
    const d = await cloud.loadRoster(date);
    if (!d) return toast(`No saved roster for ${date}.`);
    openSaved(date, d, d.updatedAt);
  } catch (e) { cloudError(e); }
}

// fetch something once per key, then re-render when it arrives
function lazy(store, key, fn) {
  if (store[key] === undefined) {
    store[key] = 'loading';
    fn().then(v => { store[key] = v; render(); }, e => { store[key] = null; cloudError(e); });
  }
  return store[key] === 'loading' ? null : store[key];
}

export function rosterLogCard() {
  const log = state.roster?.log || [];
  if (!log.length) return null;
  return h('section', { class: 'card' }, h('details', {},
    h('summary', {}, `Change log (${log.length})`),
    h('ul', { class: 'log' }, log.map(e => h('li', {},
      h('div', { class: 'seen' }, `${when(e.at)} · ${e.by}`),
      e.changes.length === 1 ? h('div', {}, e.changes[0]) : h('ul', {}, e.changes.map(c => h('li', {}, c))))))));
}

export function historyCard() {
  if (!isMember()) return null;
  const date = state.day.date;
  const meta = lazy(cs.meta, date, () => cloud.rosterMeta(date));
  const versions = lazy(cs.versions, date, () => cloud.listVersions(date));
  if (cs.recent === null) { cs.recent = 'loading'; cloud.listRosters().then(v => { cs.recent = v; render(); }, e => { cs.recent = []; cloudError(e); }); }
  const recent = Array.isArray(cs.recent) ? cs.recent : [];
  const behind = meta && state.cloudBase[date] !== meta.updatedAt;
  return h('section', { class: 'card' },
    h('h2', {}, 'Saved rosters'),
    meta
      ? h('p', { class: 'hint' }, `${date}: last saved by ${byName(meta.updatedBy)}, ${when(meta.updatedAt)}. `,
        behind ? h('button', { class: 'link', onclick: () => openLatest(date) }, 'Open latest') : 'You have the latest.')
      : h('p', { class: 'hint' }, `${date} hasn't been saved yet.`),
    versions?.length ? h('details', { open: versions.length <= 5 },
      h('summary', {}, `History for ${date} (${versions.length})`),
      h('ul', { class: 'history' }, versions.map(v => h('li', {},
        h('span', {}, `${when(v.savedAt)} · ${byName(v.savedBy)}`),
        h('button', { class: 'link', onclick: () => openSaved(date, v, meta?.updatedAt ?? v.savedAt) }, 'Restore'))))) : null,
    recent.filter(x => x.date !== date).length ? h('details', {},
      h('summary', {}, 'Other dates'),
      h('ul', { class: 'history' }, recent.filter(x => x.date !== date).map(x => h('li', {},
        h('span', {}, `${x.date} · ${byName(x.updatedBy)}`),
        h('button', { class: 'link', onclick: () => openLatest(x.date) }, 'Restore'))))) : null,
  );
}

let newMember = { email: '', role: 'rosterer', name: '' };
export function membersCard() {
  if (cs.members === null) {
    cs.members = 'loading';
    cloud.listMembers().then(v => { cs.members = v; render(); }, e => { cs.members = []; cloudError(e); });
  }
  const list = Array.isArray(cs.members) ? cs.members : [];
  const refresh = () => { cs.members = null; cs.requests = null; cloud.listRequests().then(v => { cs.requests = v; render(); }, cloudError); render(); };
  const requests = Array.isArray(cs.requests) ? cs.requests : [];
  return h('section', { class: 'card scroll' },
    requests.length ? h('div', { id: 'requests', style: 'margin-bottom:16px' },
      h('h2', {}, 'Access requests'),
      h('table', {},
        h('thead', {}, h('tr', {}, ['Google email', 'Name', 'Asked', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, requests.map(q => h('tr', {},
          h('td', {}, q.email), h('td', {}, q.name || ''), h('td', { class: 'seen' }, when(q.requestedAt)),
          h('td', {},
            h('button', { class: 'small primary', onclick: () => cloud.setMember(q.email, 'rosterer', q.name || '').then(() => cloud.deleteRequest(q.email)).then(() => { toast(`Approved ${q.email} as a rosterer.`); refresh(); }, cloudError) }, 'Approve'), ' ',
            h('button', { class: 'small', title: 'Can see the saved rosters and their own day, but change nothing', onclick: () => cloud.setMember(q.email, 'viewer', q.name || '').then(() => cloud.deleteRequest(q.email)).then(() => { toast(`Approved ${q.email} as a viewer.`); refresh(); }, cloudError) }, 'Approve as viewer'), ' ',
            h('button', { class: 'small', onclick: () => { if (confirm(`Decline ${q.email}?`)) cloud.deleteRequest(q.email).then(refresh, cloudError); } }, 'Decline'))))))) : null,
    h('h2', {}, 'Team members'),
    h('p', { class: 'hint' }, 'Only these Google accounts can sign in and see the shared staff list and rosters. Admins can also manage this list.'),
    h('table', {},
      h('thead', {}, h('tr', {}, ['Google email', 'Name', 'On the staff list as', 'Role', ''].map(t => h('th', {}, t)))),
      h('tbody', {},
        list.map(m => h('tr', {},
          h('td', {}, m.email), h('td', {}, m.name || ''),
          // who they are on the staff list: My day uses this instead of guessing from the name
          h('td', {}, select(m.staffId || '', [['', m.name && matchName(m.name, state.staff).person ? `(by name: ${matchName(m.name, state.staff).person.name})` : '—'], ...state.staff.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => [p.id, p.name])],
            v => cloud.setMember(m.email, m.role, m.name || '', v).then(refresh, cloudError))),
          h('td', {}, select(m.role, ROLES, v => cloud.setMember(m.email, v, m.name || '', m.staffId || '').then(refresh, cloudError))),
          h('td', {}, m.email === cs.user.email.toLowerCase() ? '' : h('button', { class: 'small', onclick: () => { if (confirm(`Remove ${m.email}?`)) cloud.removeMember(m.email).then(refresh, cloudError); } }, '✕')))),
        h('tr', {},
          h('td', {}, h('input', { type: 'email', placeholder: 'name@gmail.com', value: newMember.email, oninput: e => { newMember.email = e.target.value; } })),
          h('td', {}, h('input', { placeholder: 'Name', value: newMember.name, oninput: e => { newMember.name = e.target.value; } })),
          h('td', {}, select(newMember.role, ROLES, v => { newMember.role = v; })),
          h('td', {}, h('button', { class: 'small', onclick: () => {
            const e = newMember.email.trim().toLowerCase();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return toast('Enter a Google email address.');
            cloud.setMember(e, newMember.role, newMember.name.trim()).then(() => { newMember = { email: '', role: 'rosterer', name: '' }; refresh(); toast(`Added ${e}.`); }, cloudError);
          } }, 'Add'))))),
  );
}
