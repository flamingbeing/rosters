// NTF Roster: the Team sharing panel (inside More). Sign in with Google, see your role, Save to cloud (the staff list,
// rules, codes and settings, plus every month that changed), Pull from cloud, who saved last and when, a prompt when
// someone else saved first, and for admins the members list and people asking to join.
// Off (a short note instead) until js/firebase-config.js is filled in, and always off in practice mode (?demo).
import * as cloud from './cloud.js';
import * as CS from './cloudstate.js';
import { mergeByPool } from './jpool.js';

// The team copy's updatedAt this browser last loaded or saved, per device (not part of the roster):
// { team: ms | null, months: { 'YYYY-MM': ms }, sig: { 'YYYY-MM': fingerprint of the month as last saved or pulled } }. A save that finds a different updatedAt there stops (conflict).
const SEEN_KEY = 'ntf-roster-team-seen';
const ROLE_LABEL = { admin: 'Admin', rosterer: 'Rosterer', viewer: 'Viewer' };
const ROLE_HELP = {
  admin: 'You can save and load the roster, and add or remove members.',
  rosterer: 'You can save and load the roster.',
  viewer: 'You can load the roster; an admin can let you save it.',
};

function readSeen() {
  try {
    const s = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null');
    if (s && typeof s === 'object') return { team: s.team ?? null, months: (s.months && typeof s.months === 'object') ? s.months : {}, sig: (s.sig && typeof s.sig === 'object') ? s.sig : {} };
  } catch { /* private window or damaged: start fresh */ }
  return { team: null, months: {}, sig: {} };
}
function writeSeen(s) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* ignore */ } }

// A short fingerprint of a month's content, to tell which months changed since the last save or pull.
function sigOf(state, m) {
  const t = JSON.stringify(cloud.pickMonth(state, m));
  let x = 5381;
  for (let i = 0; i < t.length; i++) x = ((x * 33) ^ t.charCodeAt(i)) >>> 0;
  return t.length + ':' + x.toString(36);
}
// Bring every cloud month into the state; remember what the cloud holds so only later changes are saved.
function mergeAllMonths(state, docs, seen) {
  let next = state;
  for (const d of docs) next = cloud.mergeMonth(next, d.month, d);
  for (const d of docs) { seen.months[d.month] = d.updatedAt ?? null; seen.sig[d.month] = sigOf(next, d.month); }
  return next;
}

function when(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
// the name is whatever the saver's account says; the email is checked by the rules, so show it too
const byName = b => (b ? (b.name && b.email && b.name !== b.email ? `${b.name} (${b.email})` : b.email || b.name) : '') || 'someone';

// The cloud's last save of the staff list/rules or of this month, whichever is later: { at, by } (at 0 when nothing is saved)
function latestOf(status) {
  const all = [status && status.team, ...Object.values((status && status.months) || {})].filter(x => x && x.updatedAt);
  const best = all.sort((x, y) => y.updatedAt - x.updatedAt)[0];
  return best ? { at: best.updatedAt, by: byName(best.updatedBy) } : { at: 0, by: '' };
}
// One status line for the months other than the one on screen: how many the cloud holds and how many are newer than here
function otherMonths(status, seen, month, h) {
  const all = Object.entries((status && status.months) || {}).filter(([m, x]) => m !== month && x);
  if (!all.length) return null;
  const newer = all.filter(([m, x]) => x.updatedAt !== (seen.months[m] ?? null)).length;
  return h('li', { class: 'team-p' }, `${all.length} other ${all.length === 1 ? 'month is' : 'months are'} in the cloud` + (newer ? `; ${newer} newer than the copy in this browser.` : ', all matching this browser.'));
}

// Does the cloud hold a save this browser has not loaded or made?
const newerThanHere = (status, seen) => !!status && ((status.team && status.team.updatedAt !== seen.team) || Object.entries(status.months || {}).some(([m, x]) => x && x.updatedAt !== (seen.months[m] ?? null)));

// Ask the cloud, quietly, whether it is ahead of this browser (for the header's cloud button). Does nothing when signed out.
export async function checkCloud(app) {
  try {
    if (!(await cloud.currentUser()) || !(await cloud.myMember())) return;
    const st = await cloud.lastSaved(app.month), seen = readSeen(), last = latestOf(st);
    CS.noteCloud(last.at, last.by, newerThanHere(st, seen));
  } catch (e) { console.warn('cloud check failed', e); }
}

// The one-tap start on a device with an empty roster (the welcome screen): sign in (if not already), and when the account is on
// the team list, bring down the team's staff list, rules and the month on screen. Nothing local is lost: the roster was empty.
export async function joinAndLoad(app) {
  const fmt = m => (app.model && app.model.fmtMonth ? app.model.fmtMonth(m) : m);
  try {
    let user = await cloud.currentUser();
    if (!user) user = await cloud.signIn();
    if (!user) return;   // gone to Google to sign in; tap again when back
    const member = await cloud.myMember();
    if (!member) {
      app.toast(`Signed in as ${user.email}, but that account is not on the members list yet. Cloud in More lets you ask to join.`, { kind: 'warn', ms: 10000 });
      app.go('more');
      return;
    }
    const m = app.month;
    const [t, docs] = await Promise.all([cloud.loadTeam(), cloud.loadAllMonths()]);
    const mo = docs.find(d => d.month === m) || null;
    if (!t && !docs.length) { app.toast('Signed in, but nothing has been saved to the cloud yet. Save it first from a device that has the roster.', { kind: 'warn', ms: 9000 }); app.go('more'); return; }
    let next = app.store.get();
    if (t) next = cloud.mergeTeam(next, t);
    const seen = readSeen();
    next = mergeAllMonths(next, docs, seen);
    app.store.replace(next, 'Pull from cloud');
    if (t) seen.team = t.updatedAt ?? null;
    writeSeen(seen);
    CS.noteSynced(Math.max(t ? t.updatedAt || 0 : 0, ...docs.map(d => d.updatedAt || 0)), byName(([...docs].sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))[0] || t || {}).updatedBy));
    app.toast(mo ? `Pulled the cloud roster and ${fmt(m)}.` : `Pulled the cloud roster. ${fmt(m)} is not in the cloud yet.`, { action: { label: 'Undo', fn: () => app.store.undo() } });
  } catch (e) {
    console.error(e);
    app.toast(cloud.friendly(e), { kind: 'error', ms: 9000 });
  }
}

export function mountTeam(el, app, opts = {}) {
  const changed = () => { try { if (opts.onChange) opts.onChange(); } catch (e) { console.warn(e); } };
  const h = app.h;
  const M = app.model;
  const fmtMonth = m => (M && M.fmtMonth ? M.fmtMonth(m) : m);
  const root = h('div', { class: 'team' });
  el.append(root);
  const note = text => root.append(h('p', { class: 'team-p' }, text));

  if (cloud.isDemo || (app.store && app.store.isDemo)) {
    note('The cloud is off in the practice department: nothing here is signed in or saved.');
    return { update() {}, unmount() {} };
  }
  if (!cloud.enabled) {
    note("The cloud isn't switched on yet: until then this roster lives in this browser; use Backup to move it.");
    return { update() {}, unmount() {} };
  }

  let alive = true, unwatch = null;
  let user = null, member, request = null, status = null, members = null, requests = null;
  let busy = '', month = app.month, ready = false;

  const toastErr = e => app.toast(cloud.friendly(e), { kind: 'error' });
  const btn = (label, fn, cls = 'btn btn-ghost') => h('button', { type: 'button', class: cls, disabled: !!busy, onclick: fn }, label);

  async function refresh() {
    if (!alive) return;
    if (!user) { member = null; render(); return; }
    member = undefined; render();
    try {
      member = await cloud.myMember();
      if (!member) {
        request = await cloud.myAccessRequest().catch(() => null);
      } else {
        status = await cloud.lastSaved(month).catch(e => { console.warn(e); return null; });
        if (status) { const last = latestOf(status); CS.noteCloud(last.at, last.by, newerThanHere(status, readSeen())); changed(); }
        if (member.role === 'admin') {
          [members, requests] = await Promise.all([cloud.listMembers(), cloud.listAccessRequests()]);
        } else { members = null; requests = null; }
      }
    } catch (e) {
      console.warn(e);
      member = null;
      toastErr(e);
    }
    if (alive) render();
  }

  async function work(label, fn) {
    if (busy) return;
    busy = label; render();
    try { await fn(); } catch (e) {
      if (e instanceof cloud.Conflict) conflictPrompt(e); else toastErr(e);
    } finally { busy = ''; if (alive) render(); }
  }

  // ---- actions ----

  const signIn = () => work('Signing in…', async () => { await cloud.signIn(); });
  const signOut = () => work('Signing out…', async () => { await cloud.signOut(); });

  // Saves the staff list, rules and settings plus every month that changed since this browser last saved or pulled.
  function save(force = false) {
    return work('Saving…', async () => {
      const st = app.store.get(), seen = readSeen();
      const todo = cloud.monthsWithContent(st).filter(m => force || seen.sig[m] !== sigOf(st, m) || seen.months[m] == null);
      const months = todo.map(m => ({ m, ...cloud.pickMonth(st, m) }));
      const { at, by } = await cloud.saveAll({ team: st, months }, { teamAt: seen.team, monthsAt: seen.months, force });
      seen.team = at;
      for (const m of todo) { seen.months[m] = at; seen.sig[m] = sigOf(st, m); }
      writeSeen(seen);
      status = { team: { updatedAt: at, updatedBy: by }, month: todo.includes(month) ? { updatedAt: at, updatedBy: by } : (status && status.month) || null,
        months: { ...((status && status.months) || {}), ...Object.fromEntries(todo.map(m => [m, { updatedAt: at, updatedBy: by }])) } };
      CS.noteSynced(at, byName(by)); changed();
      app.toast(todo.length ? `Saved to the cloud: the staff list, rules and ${todo.length === 1 ? fmtMonth(todo[0]) : todo.length + ' months'}.` : 'Saved to the cloud: the staff list and rules. The months had not changed.');
    });
  }

  async function load() {
    const m = month;
    const ok = await app.confirm(`Pull the cloud copy? It replaces the staff list, rules, duty codes, settings and every month the cloud holds in this browser. Months only this browser has stay as they are. Undo brings yours back.`, { ok: 'Pull from cloud' });
    if (!ok) return;
    return work('Pulling…', async () => {
      const [t, docs] = await Promise.all([cloud.loadTeam(), cloud.loadAllMonths()]);
      const mo = docs.find(d => d.month === m) || null;
      if (!t && !docs.length) { app.toast('Nothing has been saved to the cloud yet.', { kind: 'warn' }); return; }
      let next = app.store.get();
      if (t) next = cloud.mergeTeam(next, t);
      const seen = readSeen();
      next = mergeAllMonths(next, docs, seen);
      app.store.replace(next, 'Pull from cloud');
      if (t) seen.team = t.updatedAt ?? null;
      writeSeen(seen);
      status = { team: t ? { updatedAt: t.updatedAt, updatedBy: t.updatedBy } : null, month: mo ? { updatedAt: mo.updatedAt, updatedBy: mo.updatedBy } : null,
        months: Object.fromEntries(docs.map(d => [d.month, { updatedAt: d.updatedAt, updatedBy: d.updatedBy }])) };
      CS.noteSynced(latestOf(status).at, latestOf(status).by); changed();
      app.toast(docs.length ? `Pulled the cloud copy and ${docs.length === 1 ? fmtMonth(docs[0].month) : docs.length + ' months'}.` : 'Pulled the cloud copy. No months are in the cloud yet, so yours are kept.',
        { action: { label: 'Undo', fn: () => app.store.undo() } });
    });
  }

  // Earlier saves: every save keeps a copy; pick one to bring into this browser (Undo brings back what was here). Nothing
  // changes in the cloud until Save to cloud.
  async function history() {
    const m = month;
    let months, teams;
    try { [months, teams] = await Promise.all([cloud.listVersions(m, 20), cloud.listTeamVersions(20)]); } catch (e) { toastErr(e); return; }
    let which = 'month';
    const body = h('div', { class: 'team' });
    let dlg = null;
    const restore = (kind, v) => {
      let next = app.store.get();
      if (kind === 'team') next = cloud.mergeTeam(next, v.team);
      else next = cloud.mergeMonth(next, m, v);
      app.store.replace(next, 'Restore an earlier save');
      if (dlg) dlg(); 
      app.toast(kind === 'team' ? `Restored the staff list and rules saved ${when(v.savedAt)}. Save to cloud to share it.`
        : `Restored ${fmtMonth(m)} as saved ${when(v.savedAt)}. Save to cloud to share it.`,
      { action: { label: 'Undo', fn: () => app.store.undo() }, ms: 10000 });
    };
    const draw = () => {
      body.textContent = '';
      const list = which === 'month' ? months : teams;
      const tabs = h('div', { class: 'team-row', role: 'group', 'aria-label': 'What to restore' },
        h('button', { type: 'button', class: which === 'month' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm', 'aria-pressed': String(which === 'month'), onclick: () => { which = 'month'; draw(); } }, fmtMonth(m)),
        h('button', { type: 'button', class: which === 'team' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm', 'aria-pressed': String(which === 'team'), onclick: () => { which = 'team'; draw(); } }, 'Staff list and rules'));
      body.append(tabs, h('p', { class: 'team-p' }, 'Each Save to cloud keeps a copy. Restoring brings that copy into this browser only (Undo puts yours back); it reaches the cloud when you Save to cloud.'));
      if (!list.length) { body.append(h('p', { class: 'team-p' }, 'No earlier saves yet.')); return; }
      body.append(h('ul', { class: 'team-list', 'aria-label': 'Earlier saves' }, list.map((v, i) => h('li', { class: 'team-item' },
        h('span', { class: 'team-who' }, `${when(v.savedAt)}${i === 0 ? ' (latest)' : ''}`,
          h('small', null, `${byName(v.savedBy)}: ${cloud.describeVersion(which, v)}`)),
        btn('Restore', () => restore(which, v), 'btn btn-ghost btn-sm')))));
    };
    draw();
    const s = app.sheet({ title: 'Earlier saves', body, actions: [{ label: 'Close', primary: true }] });
    dlg = typeof s === 'function' ? s : null;
  }

  // Keep this browser's pool (its people, their shifts and the rules only about them) and take the cloud's for the rest,
  // then save the result. For two rosterers who each look after one pool and saved at about the same time.
  function mergePool(pool) {
    let merged = false;
    return work('Merging…', async () => {
      const [t, docs] = await Promise.all([cloud.loadTeam(), cloud.loadAllMonths()]);
      const next = mergeByPool(app.store.get(), t, docs, pool, M.poolOf, cloud.cellsFromDoc);
      app.store.replace(next, 'Merge with cloud');
      const seen = readSeen();
      if (t) seen.team = t.updatedAt ?? null;
      for (const d of docs) { seen.months[d.month] = d.updatedAt ?? null; delete seen.sig[d.month]; }
      writeSeen(seen);
      merged = true;
    }).then(() => (merged ? save(false) : null));
  }

  function conflictPrompt(e) {
    const what = e.what === 'team' ? 'the staff list and rules' : fmtMonth(e.month);
    const pool = ((app.store.get().settings || {}).pool) || 'all';
    const poolOk = pool === 'junior' || pool === 'senior';
    app.sheet({
      title: 'Someone else saved first',
      body: h('div', { class: 'team' },
        h('p', { class: 'team-p' }, `${byName(e.current && e.current.updatedBy)} saved ${what} to the cloud ${when(e.current && e.current.updatedAt)}, after this browser last loaded or saved it.`),
        poolOk ? h('p', { class: 'team-p' }, `Merge keeps your ${pool} pool (its people, their shifts and the rules only about them) and takes theirs for everyone else, then saves. Undo brings yours back.`) : null,
        h('p', { class: 'team-p' }, 'Pull theirs to see it first (undo brings yours back), or save yours over it. Their save stays in the cloud history either way.')),
      actions: [
        { label: 'Cancel' },
        poolOk ? { label: `Merge: keep my ${pool} pool`, primary: true, fn: () => { mergePool(pool); } } : null,
        { label: 'Pull theirs', fn: () => { load(); } },
        { label: 'Save mine anyway', danger: true, fn: () => { save(true); } },
      ].filter(Boolean),
    });
  }

  function askToJoin(name) {
    return work('Sending…', async () => {
      request = await cloud.requestAccess(name);
      app.toast('Asked to join. An admin will add you.');
    });
  }

  function setRole(m, role) {
    return work('Saving…', async () => {
      await cloud.setMember(m.email, role, m.name || '', m.staffId || '');
      members = await cloud.listMembers();
      app.toast(`${m.name || m.email} is now ${ROLE_LABEL[role].toLowerCase()}.`);
    });
  }

  async function remove(m) {
    const ok = await app.confirm(`Remove ${m.name || m.email} from the members list? They will no longer see the roster.`, { ok: 'Remove', danger: true });
    if (!ok) return;
    return work('Removing…', async () => {
      await cloud.removeMember(m.email);
      members = await cloud.listMembers();
      app.toast(`Removed ${m.name || m.email}.`);
    });
  }

  function add(email, name, role) {
    return work('Adding…', async () => {
      const m = await cloud.setMember(email, role, name);
      if ((requests || []).some(r => r.email === m.email)) await cloud.deleteAccessRequest(m.email);
      [members, requests] = await Promise.all([cloud.listMembers(), cloud.listAccessRequests()]);
      app.toast(`Added ${name || m.email} as ${ROLE_LABEL[role].toLowerCase()}.`);
    });
  }

  function dismiss(r) {
    return work('Removing…', async () => {
      await cloud.deleteAccessRequest(r.email);
      requests = await cloud.listAccessRequests();
    });
  }

  // ---- drawing ----

  function render() {
    if (!alive) return;
    root.textContent = '';
    if (!ready) { note('Checking sign-in…'); return; }
    if (!user) {
      note('Sign in with your Google account to keep this roster in the cloud: save it from one device and pull it on another.');
      root.append(h('div', { class: 'team-row' }, btn(busy || 'Sign in with Google', signIn, 'btn btn-primary')));
      return;
    }
    const email = (user.email || '').toLowerCase();
    const signOutBtn = btn('Sign out', signOut, 'btn btn-ghost btn-sm');
    if (member === undefined) {
      root.append(h('p', { class: 'team-p' }, 'Signed in as ', h('strong', null, email), '. Checking your access…'));
      return;
    }
    if (!member) { renderOutsider(email, signOutBtn); return; }

    const role = ROLE_LABEL[member.role] ? member.role : 'viewer';
    root.append(
      h('div', { class: 'team-row' },
        h('span', null, 'Signed in as ', h('strong', null, email)),
        h('span', { class: 'team-role', 'data-role': role }, ROLE_LABEL[member.role] || `${member.role || 'no role'} (reads only)`),
        signOutBtn),
      h('p', { class: 'team-p' }, ROLE_HELP[role]));

    // who saved last and when, and whether this browser has that copy
    const seen = readSeen();
    const line = (label, meta, seenAt, none) => {
      if (!meta || !meta.updatedAt) return h('li', null, `${label}: ${none}`);
      const fresh = seenAt === meta.updatedAt;
      return h('li', null, `${label}: saved by ${byName(meta.updatedBy)}, ${when(meta.updatedAt)}. `,
        fresh ? h('span', { class: 'team-p' }, '(the copy in this browser)')
          : h('span', { class: 'team-new' }, seenAt == null ? 'Not loaded in this browser yet.' : 'Newer than the copy in this browser.'));
    };
    root.append(h('ul', { class: 'team-status', 'aria-label': 'Cloud copy' },
      status ? [
        line('Staff list, rules and settings', status.team, seen.team, 'not saved to the cloud yet.'),
        line(fmtMonth(month), status.month, seen.months[month] ?? null, 'not saved to the cloud yet.'),
        otherMonths(status, seen, month, h),
      ] : h('li', { class: 'team-p' }, 'Could not check the cloud copy just now.')));
    const mine = CS.read();
    root.append(h('p', { class: 'team-p' },
      mine.changed ? `This browser: last changed ${when(mine.changed)}.` : 'This browser: no changes yet.',
      mine.synced ? ` Last saved to or pulled from the cloud ${when(mine.synced)}.` : ' Not saved to the cloud from here yet.'));

    const editor = cloud.canEdit(member);
    root.append(h('div', { class: 'team-row' },
      editor ? btn(busy === 'Saving…' ? busy : 'Save to cloud', () => save(false), 'btn btn-primary') : null,
      btn(busy === 'Pulling…' ? busy : 'Pull from cloud', load),
      btn('Earlier saves', history, 'btn btn-ghost'),
      btn('Refresh', () => refresh(), 'btn btn-ghost btn-sm')));
    root.append(h('p', { class: 'team-p' }, editor
      ? 'Save to cloud sends the staff list, rules, duty codes, settings and every month that changed since this browser last saved or pulled.'
      : 'Pull from cloud brings in the staff list, rules and every month in the cloud.'));

    if (member.role === 'admin') renderAdmin(email);
  }

  function renderOutsider(email, signOutBtn) {
    root.append(h('div', { class: 'team-row' }, h('span', null, 'Signed in as ', h('strong', null, email)), signOutBtn));
    note("This account isn't on the members list yet. Ask to join, and an admin can add you.");
    if (request) note(`You asked on ${when(request.requestedAt)}${request.name ? ` as ${request.name}` : ''}. An admin will add you; you can ask again to change your name.`);
    const nameIn = h('input', { type: 'text', id: 'team-ask-name', maxlength: '100', autocomplete: 'name', value: (request && request.name) || user.displayName || '' });
    root.append(h('div', { class: 'team-row' },
      h('label', { for: 'team-ask-name' }, 'Your name'), nameIn,
      btn(busy === 'Sending…' ? busy : (request ? 'Ask again' : 'Ask to join'), () => askToJoin(nameIn.value.trim()), 'btn btn-primary')));
  }

  function renderAdmin(myEmail) {
    root.append(h('h3', { class: 'team-h' }, 'Members'));
    if (!members) { note('Could not load the members list.'); }
    else {
      root.append(h('ul', { class: 'team-list', 'aria-label': 'Members' }, members.map(m => {
        const self = m.email === myEmail;
        const id = 'team-role-' + m.email.replace(/[^a-z0-9]/g, '-');
        const sel = h('select', { id, disabled: self || !!busy, title: self ? "You can't change your own role" : null, onchange: e => setRole(m, e.target.value) },
          cloud.ROLES.map(r => h('option', { value: r, selected: m.role === r }, ROLE_LABEL[r])));
        return h('li', { class: 'team-item' },
          h('span', { class: 'team-who' }, m.name || m.email, m.name ? h('small', null, m.email) : null, self ? h('small', null, 'You') : null),
          h('label', { for: id, class: 'sr-only' }, `Role for ${m.name || m.email}`), sel,
          self ? null : btn('Remove', () => remove(m), 'btn btn-danger-ghost btn-sm'));
      })));
    }

    const em = h('input', { type: 'email', id: 'team-add-email', autocomplete: 'off', placeholder: 'name@example.com' });
    const nm = h('input', { type: 'text', id: 'team-add-name', maxlength: '100', autocomplete: 'off' });
    const rl = h('select', { id: 'team-add-role' }, cloud.ROLES.map(r => h('option', { value: r, selected: r === 'viewer' }, ROLE_LABEL[r])));
    root.append(h('form', { class: 'team-add', 'aria-label': 'Add a member', onsubmit: e => { e.preventDefault(); if (em.value.trim()) add(em.value.trim(), nm.value.trim(), rl.value); } },
      h('label', null, 'Google account email', em),
      h('label', null, 'Name', nm),
      h('label', null, 'Role', rl),
      h('button', { type: 'submit', class: 'btn btn-ghost', disabled: !!busy }, 'Add member')));

    root.append(h('h3', { class: 'team-h' }, 'Asking to join'));
    if (!requests || !requests.length) { note('Nobody is waiting.'); return; }
    root.append(h('ul', { class: 'team-list', 'aria-label': 'Asking to join' }, requests.map(r => h('li', { class: 'team-item' },
      h('span', { class: 'team-who' }, r.name || r.email, h('small', null, `${r.email}, asked ${when(r.requestedAt)}`)),
      btn('Add as viewer', () => add(r.email, r.name || '', 'viewer'), 'btn btn-ghost btn-sm'),
      btn('Add as rosterer', () => add(r.email, r.name || '', 'rosterer'), 'btn btn-ghost btn-sm'),
      btn('Dismiss', () => dismiss(r), 'btn btn-danger-ghost btn-sm')))));
  }

  render();
  cloud.watchUser(u => { ready = true; user = u; status = null; members = null; requests = null; request = null; refresh(); })
    .then(fn => { unwatch = fn; if (!alive && fn) fn(); })
    .catch(e => { ready = true; console.warn(e); root.textContent = ''; note('The cloud could not start: ' + cloud.friendly(e)); });

  return {
    update() {
      // a new month on screen: show its team status
      if (app.month !== month) { month = app.month; if (member) refresh(); }
    },
    unmount() { alive = false; if (typeof unwatch === 'function') unwatch(); },
  };
}
