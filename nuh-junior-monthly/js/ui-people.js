// NUH Junior Monthly: the People screen. Four parts: Staff (grouped like the department sheet: add, edit, bulk add, reorder,
// remove), Groups (rename, senior/junior, order), Tags (Baby MO, Part time…) and Duty codes (colours, overnight,
// auto-fill). Every change is one store.commit, so it can be undone; removals offer Undo straight away.

import * as M from './model.js';
import { chipStyle, contrast } from './ui-rules.js';
import * as Pools from './pools.js';

const KIND_LABEL = { shift: 'Calls and shifts', posting: 'Postings', leave: 'Leave', request: 'Requests', other: 'Other', derived: 'Worked out (not stored)' };
const KIND_HELP = {
  shift: 'Calls and duties. Overnight calls give post call (PC) the next day; auto-fill fills the ones marked auto.',
  posting: 'Where someone works that week (cardiac, ICU…): planned by the week on Postings, shown as the cell colour.',
  leave: 'Away and unavailable.', request: 'What someone asked for, kept apart from what they are given.',
  other: 'Away from the call pool, or a note-like code.', derived: 'Worked out by the app, never typed in.',
};
let nid = 0;
const fid = p => `${p}-${++nid}`;

export function mount(el, app) {
  const { h } = app;
  let part = ['staff', 'groups', 'tags', 'codes'].includes(app.params.s) ? app.params.s : 'staff';
  let q = '';
  let showLeft = false;
  const undoAct = { label: 'Undo', fn: () => app.store.undo() };

  const root = h('div', { class: 'pv' });
  const head = h('div', { class: 'bx-head' }, h('div', { class: 'bx-head-text' },
    h('h2', { class: 'bx-h' }, 'People'),
    h('p', { class: 'bx-sub' }, 'Staff in sheet order, their groups and tags, and the duty codes used on the roster.')));
  const nav = h('div', { class: 'bx-tabs', role: 'tablist', 'aria-label': 'People sections' });
  const body = h('div', { class: 'pv-body' });
  root.append(head, nav, body);
  el.append(root);

  function renderNav() {
    const st = app.store.get();
    nav.innerHTML = '';
    for (const [k, l, n] of [['staff', 'Staff', (st.staff || []).length], ['groups', 'Groups', (st.groups || []).length], ['tags', 'Tags', (st.tags || []).length], ['codes', 'Duty codes', (st.duties || []).length]]) {
      nav.append(h('button', { type: 'button', role: 'tab', class: 'bx-tab', 'aria-selected': String(part === k), id: `pv-tab-${k}`,
        onclick: () => { part = k; render(); } }, l, h('span', { class: 'bx-count' }, String(n))));
    }
    body.setAttribute('role', 'tabpanel');
    body.setAttribute('aria-labelledby', `pv-tab-${part}`);
  }

  function render() {
    renderNav();
    const keep = document.activeElement && body.contains(document.activeElement) && document.activeElement.matches('input[type="search"]');
    body.innerHTML = '';
    if (part === 'staff') renderStaff();
    else if (part === 'groups') renderGroups();
    else if (part === 'tags') renderTags();
    else renderCodes();
    if (keep) { const s = body.querySelector('input[type="search"]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
  }

  // =============== Staff ===============
  function renderStaff() {
    const st = app.store.get();
    const today = M.iso(new Date());
    const hasLeft = p => p.active === false || (p.end && p.end < today);
    const search = h('input', { type: 'search', class: 'bx-search', placeholder: 'Search staff', 'aria-label': 'Search staff', value: q,
      oninput: () => { q = search.value.trim().toLowerCase(); renderStaffList(); } });
    const leftCb = h('input', { type: 'checkbox', checked: showLeft, onchange: () => { showLeft = leftCb.checked; renderStaffList(); } });
    const leftN = (st.staff || []).filter(hasLeft).length;
    body.append(h('div', { class: 'pv-bar' },
      h('div', { class: 'rv-search' }, h('span', { class: 'bx-search-ic', html: app.icon('search') }), search),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => editPerson(null), html: `${app.icon('plus')}<span>Add person</span>` }),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => bulkAdd() }, 'Bulk add'),
      leftN ? h('label', { class: 'switch' }, leftCb, h('span', { class: 'sw-track' }), h('span', null, `Show ${leftN} who left`)) : null));
    const listBox = h('div', { class: 'pv-list' });
    body.append(listBox);

    function renderStaffList() {
      const s = app.store.get();
      listBox.innerHTML = '';
      const staff = (s.staff || []).filter(p => (showLeft || !hasLeft(p)) && (!q || `${p.name} ${p.short} ${p.note}`.toLowerCase().includes(q)));
      if (!(s.staff || []).length) {
        listBox.append(h('div', { class: 'card bx-empty' }, h('p', null, 'No staff yet. Add people one by one, paste a list with Bulk add, or import the department Excel sheet (More).'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => bulkAdd() }, 'Bulk add names')));
        return;
      }
      const gids = new Set((s.groups || []).map(g => g.id));
      const groups = [...(s.groups || []), ...(staff.some(p => !gids.has(p.group)) ? [{ id: '__none', name: 'No group', kind: '' }] : [])];
      let shown = 0;
      for (const g of groups) {
        const ps = staff.filter(p => (g.id === '__none' ? !gids.has(p.group) : p.group === g.id));
        if (!ps.length && (q || g.id === '__none')) continue;
        shown += ps.length;
        const sec = h('section', { class: 'pv-group', 'aria-label': g.name },
          h('div', { class: 'pv-group-h' },
            h('h3', null, g.name),
            g.kind ? h('span', { class: `bx-badge ${g.kind === 'senior' ? 'sen' : 'jun'}` }, g.kind === 'senior' ? 'Senior' : 'Junior') : null,
            h('span', { class: 'bx-count' }, String(ps.length)),
            g.id !== '__none' ? h('button', { type: 'button', class: 'btn btn-ghost btn-xs pv-gadd', 'aria-label': `Add a person to ${g.name}`, onclick: () => editPerson(null, g.id) }, '+ Add') : null));
        if (!ps.length) sec.append(h('p', { class: 'muted pv-emptyg' }, 'Nobody in this group.'));
        else sec.append(h('ul', { class: 'pv-rows' }, ps.map((p, i) => h('li', null, personRow(s, p, i, ps.length, hasLeft(p))))));
        listBox.append(sec);
      }
      if (!shown && q) listBox.append(h('p', { class: 'bx-none' }, `Nobody matches "${q}".`));
    }
    renderStaffList();
  }

  function personRow(st, p, i, n, left) {
    const tags = (p.tags || []).map(id => (st.tags || []).find(t => t.id === id)).filter(Boolean);
    const meta = [];
    if (Number(p.fte) && Number(p.fte) !== 1) meta.push(`FTE ${p.fte}`);
    if (p.start) meta.push(`from ${M.fmtDay(p.start)} ${p.start.slice(0, 4)}`);
    if (p.end) meta.push(`until ${M.fmtDay(p.end)} ${p.end.slice(0, 4)}`);
    if (p.noCallsUntil) meta.push(`no calls until ${M.fmtDay(p.noCallsUntil)} ${p.noCallsUntil.slice(0, 4)}`);
    if (p.active === false) meta.push('not active');
    return h('div', { class: `pv-row${left ? ' is-left' : ''}` },
      h('button', { type: 'button', class: 'pv-main', onclick: () => editPerson(p) },
        h('span', { class: 'pv-name' }, p.name || '(no name)', p.short ? h('span', { class: 'pv-short' }, p.short) : null),
        tags.length || meta.length ? h('span', { class: 'pv-meta' }, tags.map(t => h('span', { class: 'pill' }, t.name)), meta.length ? h('span', null, meta.join(' · ')) : null) : null,
        p.note ? h('span', { class: 'pv-note' }, p.note) : null),
      h('div', { class: 'pv-acts' },
        h('button', { type: 'button', class: 'icon-btn', disabled: i === 0, 'aria-label': `Move ${p.name} up`, title: 'Move up', onclick: () => move(p.id, -1), html: arrow('up') }),
        h('button', { type: 'button', class: 'icon-btn', disabled: i === n - 1, 'aria-label': `Move ${p.name} down`, title: 'Move down', onclick: () => move(p.id, 1), html: arrow('down') })));
  }

  function move(id, dir) {
    app.store.commit('Reorder staff', d => {
      const i = d.staff.findIndex(p => p.id === id);
      if (i < 0) return false;
      const g = d.staff[i].group;
      let j = i + dir;
      while (j >= 0 && j < d.staff.length && d.staff[j].group !== g) j += dir;
      if (j < 0 || j >= d.staff.length) return false;
      [d.staff[i], d.staff[j]] = [d.staff[j], d.staff[i]];
    });
    requestAnimationFrame(() => {
      const b = body.querySelector(`[aria-label="Move ${CSS.escape((app.store.get().staff.find(p => p.id === id) || {}).name || '')} ${dir < 0 ? 'up' : 'down'}"]`);
      if (b && !b.disabled) b.focus();
    });
  }

  // Removing is behind the edit sheet and a confirm (it takes all their roster entries with it); someone who has left
  // is better given an end date, which keeps their history.
  async function removePerson(p) {
    const st = app.store.get();
    let entries = 0;
    for (const day of Object.values(st.cells || {})) if (day[p.id]) entries++;
    const msg = `Remove ${p.name}${entries ? ` and their ${entries} roster ${entries === 1 ? 'entry' : 'entries'}` : ''}? If they have left, set "Until" (their last day) instead: that keeps their history.`;
    if (!(await app.confirm(msg, { ok: 'Remove', danger: true }))) return false;
    app.store.commit('Remove person', d => {
      const i = d.staff.findIndex(x => x.id === p.id);
      if (i < 0) return false;
      d.staff.splice(i, 1);
      for (const day of Object.keys(d.cells || {})) {
        if (d.cells[day][p.id]) { delete d.cells[day][p.id]; if (!Object.keys(d.cells[day]).length) delete d.cells[day]; }
      }
    });
    app.toast(`Removed ${p.name} and their roster entries`, { action: undoAct });
  }

  function editPerson(p, groupId) {
    const st = app.store.get();
    const isNew = !p;
    const d = p ? structuredClone(p) : { id: M.uid('s'), name: '', short: '', group: groupId || ((st.groups || [])[0] || {}).id || 'mo', tags: [], fte: 1, start: '', end: '', noCallsUntil: '', note: '', active: true };
    const ids = { name: fid('pn'), short: fid('ps'), group: fid('pg'), fte: fid('pf'), start: fid('pst'), end: fid('pe'), until: fid('pnc'), note: fid('pno') };
    const err = h('p', { class: 'bx-err', role: 'alert' });
    const name = h('input', { type: 'text', id: ids.name, value: d.name, autocomplete: 'off', maxlength: '80', required: true });
    const short = h('input', { type: 'text', id: ids.short, value: d.short || '', maxlength: '20', placeholder: 'Shown on the grid' });
    const group = h('select', { id: ids.group }, (st.groups || []).map(g => h('option', { value: g.id }, g.name)));
    group.value = d.group;
    const fte = h('input', { type: 'number', id: ids.fte, value: String(d.fte ?? 1), min: '0.1', max: '1', step: '0.1', inputmode: 'decimal' });
    const start = h('input', { type: 'date', id: ids.start, value: d.start || '' });
    const end = h('input', { type: 'date', id: ids.end, value: d.end || '' });
    const until = h('input', { type: 'date', id: ids.until, value: d.noCallsUntil || '' });
    // a baby MO or a very new person: calls start a month after they start, or whenever you set it
    const suggest = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { if (start.value) until.value = M.iso(new Date(M.parseISO(start.value).getFullYear(), M.parseISO(start.value).getMonth() + 1, M.parseISO(start.value).getDate())); else err.textContent = 'Set the start date first.'; } }, 'A month after they start');
    const note = h('textarea', { id: ids.note, rows: '2', placeholder: 'Rotation, dates, anything useful' }, d.note || '');
    const active = h('input', { type: 'checkbox', checked: d.active !== false });
    const tagBox = tagToggles(st, d.tags);
    const bodyEl = h('div', { class: 'bx-form' },
      field('Name', ids.name, name),
      h('div', { class: 'bx-two' }, field('Short name (optional)', ids.short, short), field('Group', ids.group, group)),
      (st.tags || []).length ? h('div', { class: 'bx-field' }, h('p', { class: 'bx-label' }, 'Tags'), tagBox) : null,
      h('div', { class: 'bx-two' }, field('FTE (1 = full time)', ids.fte, fte), h('div', { class: 'bx-field bx-sw-field' }, h('label', { class: 'switch' }, active, h('span', { class: 'sw-track' }), h('span', null, 'Active')))),
      h('div', { class: 'bx-two' }, field('Starts (optional)', ids.start, start), field('Leaves (optional)', ids.end, end)),
      h('div', { class: 'bx-field' }, field('No calls until (optional)', ids.until, until), h('p', { class: 'bx-help' }, 'Baby MOs until they pass the test, very new people. Blank means calls are allowed. Their leave and postings are planned as usual. ', suggest)),
      field('Note (optional)', ids.note, note), err);
    const actions = [{ label: 'Cancel' }, {
      label: isNew ? 'Add person' : 'Save', primary: true,
      fn: () => {
        const nm = name.value.trim();
        if (!nm) { err.textContent = 'Type a name.'; name.focus(); return false; }
        if (start.value && end.value && end.value < start.value) { err.textContent = 'The leaving date is before the start date.'; return false; }
        const f = Number(fte.value);
        const out = { ...d, name: nm, short: short.value.trim(), group: group.value, tags: [...d.tags], fte: f > 0 && f <= 1 ? Math.round(f * 100) / 100 : 1, start: start.value, end: end.value, noCallsUntil: until.value, note: note.value.trim(), active: active.checked };
        app.store.commit(isNew ? 'Add person' : 'Edit person', s => {
          const i = s.staff.findIndex(x => x.id === out.id);
          if (i >= 0) s.staff[i] = out;
          else {
            // new people go at the end of their group, so the sheet order stays grouped
            let at = -1;
            s.staff.forEach((x, k) => { if (x.group === out.group) at = k; });
            if (at >= 0) s.staff.splice(at + 1, 0, out); else s.staff.push(out);
          }
        });
        app.toast(isNew ? `Added ${nm}` : `Saved ${nm}`, { action: undoAct, ms: 3000 });
      },
    }];
    if (!isNew) actions.unshift({ label: 'Remove', danger: true, fn: () => removePerson(p) });
    app.sheet({ title: isNew ? 'Add a person' : `Edit ${p.name}`, body: bodyEl, actions });
  }

  function bulkAdd() {
    const st = app.store.get();
    const gid = fid('bg'), tid = fid('bt');
    const group = h('select', { id: gid }, (st.groups || []).map(g => h('option', { value: g.id }, g.name)));
    group.value = ((st.groups || []).find(g => g.id === 'mo') || (st.groups || [])[0] || {}).id || '';
    const tags = [];
    const count = h('p', { class: 'bx-help', 'aria-live': 'polite' }, 'One name per line.');
    const ta = h('textarea', { id: tid, rows: '8', placeholder: 'Alex Tan\nPriya Nair\nNur Aisyah', oninput: () => { const n = names().length; count.textContent = n ? `${n} ${n === 1 ? 'name' : 'names'}` : 'One name per line.'; } });
    const names = () => ta.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    app.sheet({
      title: 'Bulk add staff',
      body: h('div', { class: 'bx-form' }, field('Into group', gid, group),
        (st.tags || []).length ? h('div', { class: 'bx-field' }, h('p', { class: 'bx-label' }, 'Tags for all of them (optional)'), tagToggles(st, tags)) : null,
        field('Names', tid, ta), count),
      actions: [{ label: 'Cancel' }, {
        label: 'Add', primary: true,
        fn: () => {
          const s0 = app.store.get();
          const have = new Set((s0.staff || []).map(p => p.name.toLowerCase()));
          const list = [...new Set(names())];
          const fresh = list.filter(n => !have.has(n.toLowerCase()));
          if (!fresh.length) { app.toast(list.length ? 'Everyone on the list is already here' : 'Type at least one name', { kind: 'warn' }); return list.length ? undefined : false; }
          app.store.commit('Bulk add staff', s => {
            let at = -1;
            s.staff.forEach((x, k) => { if (x.group === group.value) at = k; });
            const add = fresh.map(n => ({ id: M.uid('s'), name: n, short: '', group: group.value, tags: [...tags], fte: 1, start: '', end: '', note: '', active: true }));
            if (at >= 0) s.staff.splice(at + 1, 0, ...add); else s.staff.push(...add);
          });
          const skipped = list.length - fresh.length;
          app.toast(`Added ${fresh.length} ${fresh.length === 1 ? 'person' : 'people'}${skipped ? ` (${skipped} already here)` : ''}`, { action: undoAct });
        },
      }],
    });
  }

  function tagToggles(st, arr) {
    return h('div', { class: 'bx-pills', role: 'group', 'aria-label': 'Tags' }, (st.tags || []).map(t => {
      const b = h('button', { type: 'button', class: 'bx-pill', 'aria-pressed': String(arr.includes(t.id)), title: t.help || null,
        onclick: () => { const i = arr.indexOf(t.id); if (i >= 0) arr.splice(i, 1); else arr.push(t.id); b.setAttribute('aria-pressed', String(arr.includes(t.id))); } }, t.name);
      return b;
    }));
  }

  // =============== Groups ===============
  function renderGroups() {
    const st = app.store.get();
    body.append(h('p', { class: 'bx-help pv-intro' }, 'Groups are the sections of the department sheet, in order. Rules choose people by group; "senior" and "junior" decide who counts as a senior or junior.'));
    const ul = h('ul', { class: 'pv-edit-list' });
    (st.groups || []).forEach((g, i) => {
      const n = (st.staff || []).filter(p => p.group === g.id).length;
      const nr = rulesUsing(st, r => (r.who.groups || []).includes(g.id) || ((r.params.other || {}).groups || []).includes(g.id));
      const nameId = fid('gn');
      const name = h('input', { type: 'text', id: nameId, value: g.name, maxlength: '60',
        onchange: () => { const v = name.value.trim(); if (!v) { name.value = g.name; return; } app.store.commit('Rename group', d => { d.groups[i].name = v; }); } });
      const kindSel = h('select', { 'aria-label': `${g.name}: senior or junior`, onchange: () => app.store.commit('Change group kind', d => { d.groups[i].kind = kindSel.value; }) },
        h('option', { value: 'senior' }, 'Senior'), h('option', { value: 'junior' }, 'Junior'));
      kindSel.value = g.kind === 'senior' ? 'senior' : 'junior';
      ul.append(h('li', { class: 'pv-edit' },
        h('div', { class: 'bx-field pv-grow' }, h('label', { class: 'sr-only', for: nameId }, 'Group name'), name,
          h('span', { class: 'bx-help' }, `${n} ${n === 1 ? 'person' : 'people'}${nr ? ` · used in ${nr} ${nr === 1 ? 'rule' : 'rules'}` : ''}`)),
        kindSel,
        h('div', { class: 'pv-acts' },
          h('button', { type: 'button', class: 'icon-btn', disabled: i === 0, 'aria-label': `Move ${g.name} up`, onclick: () => moveIn('groups', i, -1, 'Reorder groups'), html: arrow('up') }),
          h('button', { type: 'button', class: 'icon-btn', disabled: i === st.groups.length - 1, 'aria-label': `Move ${g.name} down`, onclick: () => moveIn('groups', i, 1, 'Reorder groups'), html: arrow('down') }),
          h('button', { type: 'button', class: 'icon-btn pv-del', disabled: n > 0, title: n ? 'Move its people to another group first' : 'Remove group', 'aria-label': `Remove group ${g.name}`,
            onclick: () => {
              app.store.commit('Remove group', d => { d.groups.splice(i, 1); });
              app.toast(`Removed ${g.name}${nr ? ` (still named in ${nr} ${nr === 1 ? 'rule' : 'rules'})` : ''}`, { action: undoAct, kind: nr ? 'warn' : 'ok' });
            }, html: app.icon('close') }))));
    });
    body.append(ul, addRow('Add group', 'New group name', (v, kind) => {
      const id = slug(v, (st.groups || []).map(g => g.id));
      app.store.commit('Add group', d => { d.groups.push({ id, name: v, kind }); });
    }, true));
  }

  // =============== Tags ===============
  function renderTags() {
    const st = app.store.get();
    body.append(h('p', { class: 'bx-help pv-intro' }, 'Tags mark people across groups (Baby MO, Part time). Rules can apply to a tag; give each a short line of help.'));
    body.append(h('p', { class: 'bx-help pv-intro' }, 'The strong and weak MO1, MO2 and MO3 pools come from the manpower master list.'),
      h('button', { type: 'button', class: 'btn', onclick: importPools }, 'Import the strong / weak list'));
    const ul = h('ul', { class: 'pv-edit-list' });
    (st.tags || []).forEach((t, i) => {
      const n = (st.staff || []).filter(p => (p.tags || []).includes(t.id)).length;
      const nr = rulesUsing(st, r => (r.who.tags || []).includes(t.id) || ((r.params.other || {}).tags || []).includes(t.id));
      const nameId = fid('tn'), helpId = fid('th');
      const name = h('input', { type: 'text', id: nameId, value: t.name, maxlength: '40',
        onchange: () => { const v = name.value.trim(); if (!v) { name.value = t.name; return; } app.store.commit('Rename tag', d => { d.tags[i].name = v; }); } });
      const help = h('input', { type: 'text', id: helpId, value: t.help || '', maxlength: '120', placeholder: 'What it means',
        onchange: () => app.store.commit('Edit tag help', d => { d.tags[i].help = help.value.trim(); }) });
      ul.append(h('li', { class: 'pv-edit' },
        h('div', { class: 'bx-field pv-tagname' }, h('label', { for: nameId }, 'Tag'), name),
        h('div', { class: 'bx-field pv-grow' }, h('label', { for: helpId }, 'Help'), help,
          h('span', { class: 'bx-help' }, `${n} ${n === 1 ? 'person' : 'people'}${nr ? ` · used in ${nr} ${nr === 1 ? 'rule' : 'rules'}` : ''}`)),
        h('div', { class: 'pv-acts' }, h('button', { type: 'button', class: 'icon-btn pv-del', 'aria-label': `Remove tag ${t.name}`,
          onclick: async () => {
            if ((n || nr) && !(await app.confirm(`${t.name} is on ${n} ${n === 1 ? 'person' : 'people'}${nr ? ` and in ${nr} ${nr === 1 ? 'rule' : 'rules'}` : ''}. Remove it from them too?`, { ok: 'Remove tag', danger: true }))) return;
            app.store.commit('Remove tag', d => {
              d.tags.splice(i, 1);
              for (const p of d.staff) p.tags = (p.tags || []).filter(x => x !== t.id);
              for (const r of d.rules) {
                if (r.who && r.who.tags) r.who.tags = r.who.tags.filter(x => x !== t.id);
                if (r.params && r.params.other && r.params.other.tags) r.params.other.tags = r.params.other.tags.filter(x => x !== t.id);
              }
            });
            app.toast(`Removed tag ${t.name}`, { action: undoAct });
          }, html: app.icon('close') }))));
    });
    body.append(ul, addRow('Add tag', 'New tag name', v => {
      const id = slug(v, (st.tags || []).map(t => t.id));
      app.store.commit('Add tag', d => { d.tags.push({ id, name: v, help: '' }); });
    }));
  }


  // The strong / weak pools: paste the manpower master list (the sheet's table with its heading row); matched people get the pool
  // tag and the call level, and the pool rules (one call request a day per pool) turn on.
  function importPools() {
    const tid = fid('pl');
    const out = h('p', { class: 'bx-help', 'aria-live': 'polite' }, 'Copy the table from the sheet, heading row included (Strong MO1, Weak MO1, Strong MO2 ...), and paste it here.');
    const ta = h('textarea', { id: tid, rows: '8', placeholder: 'Strong MO1\tWeak MO1\tStrong MO2\t...' });
    const check = () => {
      const st = app.store.get();
      const r = Pools.parsePoolText(ta.value);
      if (r.problem) return { r, text: r.problem };
      const m = Pools.matchPools(r.found, (st.staff || []).filter(p => p.active !== false));
      const bits = [`${m.assign.length} ${m.assign.length === 1 ? 'person' : 'people'} matched`];
      if (m.unmatched.length) bits.push(`not on the staff list: ${m.unmatched.join(', ')}`);
      if (m.ambiguous.length) bits.push(`more than one person fits: ${m.ambiguous.join(', ')}`);
      if (m.twice.length) bits.push(`in two pools (first one kept): ${m.twice.join(', ')}`);
      return { r, m, text: bits.join('. ') + '.' };
    };
    ta.addEventListener('input', () => { out.textContent = ta.value.trim() ? check().text : 'Copy the table from the sheet, heading row included, and paste it here.'; });
    app.sheet({
      title: 'Import the strong / weak list',
      body: h('div', { class: 'bx-form' }, field('The table', tid, ta), out),
      actions: [{ label: 'Cancel' }, {
        label: 'Set the pools', primary: true,
        fn: () => {
          const c = check();
          if (!c.m || !c.m.assign.length) { app.toast(c.m ? 'No one on the list matched the staff list' : c.text, { kind: 'warn' }); return false; }
          let n = 0;
          app.store.commit('Import the strong / weak pools', d => { n = Pools.applyPools(d, c.m.assign); });
          app.toast(`Set the pools for ${n} ${n === 1 ? 'person' : 'people'}; the pool request rules are on`, { action: undoAct, ms: 7000 });
        },
      }],
    });
  }

  // =============== Duty codes ===============
  function renderCodes() {
    const st = app.store.get();
    app.onboard?.('codes');   // Getting started: the duty codes were looked at
    const use = codeUsage(st);
    body.append(h('div', { class: 'pv-bar' },
      h('p', { class: 'bx-help pv-grow' }, 'Codes are case-sensitive here (Excel import matches any case). Colours show on the grid; auto-fill only assigns shifts marked auto.'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => editCode(null), html: `${app.icon('plus')}<span>Add code</span>` })));
    for (const k of ['shift', 'leave', 'request', 'other', 'derived']) {
      const ds = (st.duties || []).filter(d => d.kind === k);
      if (!ds.length) continue;
      body.append(h('section', { class: 'pv-group', 'aria-label': KIND_LABEL[k] },
        h('div', { class: 'pv-group-h' }, h('h3', null, KIND_LABEL[k]), h('span', { class: 'bx-count' }, String(ds.length))),
        h('p', { class: 'bx-help pv-kh' }, KIND_HELP[k]),
        h('ul', { class: 'pv-codes' }, ds.map(d => {
          const flags = [d.overnight ? 'overnight' : '', d.rest2 ? 'then PPC' : '', d.auto ? 'auto-fill' : '', Number(d.hours) ? `${d.hours} h` : ''].filter(Boolean).join(' · ');
          const u = use.get(d.code) || { rules: 0, cells: 0 };
          return h('li', null, h('button', { type: 'button', class: 'pv-code', onclick: () => editCode(d), 'aria-label': `Edit ${d.code}: ${d.name}` },
            h('span', { class: `chip pv-chip${d.kind === 'request' ? ' rq' : ''}`, style: chipStyle(d) }, d.code),
            h('span', { class: 'pv-code-t' }, h('strong', null, d.name), flags ? h('span', { class: 'muted' }, flags) : null),
            h('span', { class: 'pv-code-u muted' }, u.cells || u.rules ? `${u.cells} cells${u.rules ? ` · ${u.rules} rules` : ''}` : '')));
        }))));
    }
  }

  function editCode(du) {
    const st = app.store.get();
    const isNew = !du;
    const d = du ? { ...du } : { code: '', name: '', kind: 'shift', color: '#5c6bc0', ink: '#ffffff', overnight: false, auto: false, hours: 8 };
    const derived = d.kind === 'derived';
    const ids = { code: fid('cc'), name: fid('cn'), kind: fid('ck'), color: fid('ccol'), ink: fid('cink'), hours: fid('ch') };
    const err = h('p', { class: 'bx-err', role: 'alert' });
    const prev = h('span', { class: 'chip pv-chip-big' });
    const ratio = h('span', { class: 'bx-help' });
    const code = h('input', { type: 'text', id: ids.code, value: d.code, maxlength: '10', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', disabled: derived, oninput: paint });
    const name = h('input', { type: 'text', id: ids.name, value: d.name, maxlength: '60' });
    const kind = h('select', { id: ids.kind, disabled: derived, onchange: () => { flagsBox.hidden = kind.value !== 'shift'; paint(); } },
      ['shift', 'leave', 'request', 'other'].map(k => h('option', { value: k }, KIND_LABEL[k])), derived ? h('option', { value: 'derived' }, 'Worked out') : null);
    kind.value = d.kind;
    const color = h('input', { type: 'color', id: ids.color, value: hex6(d.color, '#e0e0e0'), oninput: paint });
    const ink = h('input', { type: 'color', id: ids.ink, value: hex6(d.ink, '#333333'), oninput: paint });
    const overnight = h('input', { type: 'checkbox', checked: !!d.overnight });
    const auto = h('input', { type: 'checkbox', checked: !!d.auto });
    const rest2 = h('input', { type: 'checkbox', checked: !!d.rest2 });
    const hours = h('input', { type: 'number', id: ids.hours, value: String(d.hours || 0), min: '0', max: '24', step: '0.5', inputmode: 'decimal' });
    const flagsBox = h('div', { class: 'bx-form' },
      h('label', { class: 'switch' }, overnight, h('span', { class: 'sw-track' }), h('span', null, 'Overnight (post call, PC, the next day)')),
      h('label', { class: 'switch' }, rest2, h('span', { class: 'sw-track' }), h('span', null, 'Then a day off (PPC) if still on the posting')),
      h('label', { class: 'switch' }, auto, h('span', { class: 'sw-track' }), h('span', null, 'Auto-fill may assign it')));
    flagsBox.hidden = d.kind !== 'shift';
    function paint() {
      const look = { kind: kind.value, color: color.value, ink: ink.value };
      prev.textContent = code.value || d.code || '?';
      prev.className = `chip pv-chip-big${kind.value === 'request' ? ' rq' : ''}`;
      const s = chipStyle(look);
      for (const [k, v] of Object.entries(s)) prev.style.setProperty(k, v);
      const r = kind.value === 'request' ? contrast(color.value, '#ffffff') : contrast(color.value, ink.value);
      ratio.textContent = r < 4.5 ? `Contrast ${r.toFixed(1)}:1 is low; the grid will adjust the text colour.` : `Contrast ${r.toFixed(1)}:1`;
    }
    paint();
    const bodyEl = h('div', { class: 'bx-form' },
      h('div', { class: 'pv-prev' }, prev, ratio),
      h('div', { class: 'bx-two' }, field('Code', ids.code, code), field('Kind', ids.kind, kind)),
      field('Name', ids.name, name),
      h('div', { class: 'bx-two' }, field(kind.value === 'request' ? 'Colour (outline and text)' : 'Colour', ids.color, color), field('Text colour', ids.ink, ink)),
      field('Hours', ids.hours, hours),
      flagsBox, derived ? h('p', { class: 'bx-help' }, 'Post call (PC) is worked out from overnight calls; you can change its name and colours.') : null, err);
    const actions = [{ label: 'Cancel' }, {
      label: isNew ? 'Add code' : 'Save', primary: true,
      fn: async () => {
        const c = derived ? d.code : code.value.trim();
        const problem = codeProblem(st, c, du && du.code);
        if (problem) { err.textContent = problem; code.focus(); return false; }
        const out = { ...d, code: c, name: name.value.trim() || c, kind: kind.value, color: color.value, ink: ink.value,
          overnight: kind.value === 'shift' && overnight.checked, rest2: kind.value === 'shift' && overnight.checked && rest2.checked, auto: kind.value === 'shift' && auto.checked, hours: Math.max(0, Number(hours.value) || 0) };
        const renamed = du && du.code !== c;
        let everywhere = false;
        if (renamed) {
          const u = codeUsage(st).get(du.code) || { rules: 0, cells: 0 };
          if (u.rules || u.cells) {
            const choice = await choose(`${du.code} is used in ${u.rules} ${u.rules === 1 ? 'rule' : 'rules'} and ${u.cells} roster ${u.cells === 1 ? 'cell' : 'cells'}. Rename it there too?`,
              [['cancel', 'Cancel'], ['only', 'Only the code'], ['all', `Rename everywhere`]]);
            if (choice === 'cancel' || !choice) return false;
            everywhere = choice === 'all';
          }
        }
        app.store.commit(isNew ? 'Add duty code' : renamed ? `Rename ${du.code} to ${c}` : 'Edit duty code', s => {
          const i = du ? s.duties.findIndex(x => x.code === du.code) : -1;
          if (i >= 0) s.duties[i] = out; else s.duties.push(out);
          if (everywhere) renameCode(s, du.code, c);
        });
        app.toast(isNew ? `Added ${c}` : renamed ? `Renamed ${du.code} to ${c}${everywhere ? ' everywhere' : ''}` : `Saved ${c}`, { action: undoAct });
      },
    }];
    if (!isNew && !derived) actions.unshift({ label: 'Delete', danger: true, fn: () => deleteCode(du) });
    app.sheet({ title: isNew ? 'Add a duty code' : `Edit ${du.code}`, body: bodyEl, actions });
  }

  async function deleteCode(du) {
    const u = codeUsage(app.store.get()).get(du.code) || { rules: 0, cells: 0 };
    if ((u.cells || u.rules) && !(await app.confirm(`${du.code} is in ${u.cells} roster ${u.cells === 1 ? 'cell' : 'cells'}${u.rules ? ` and ${u.rules} ${u.rules === 1 ? 'rule' : 'rules'}` : ''}. Delete it and take it off the roster? Rules that name it will show a warning.`, { ok: 'Delete code', danger: true }))) return false;
    app.store.commit(`Delete ${du.code}`, s => {
      s.duties = s.duties.filter(x => x.code !== du.code);
      for (const day of Object.keys(s.cells || {})) {
        for (const sid of Object.keys(s.cells[day] || {})) {
          const c = s.cells[day][sid];
          if ((c.a || []).includes(du.code) || (c.r || []).includes(du.code)) {
            M.setCell(s, day, sid, { a: (c.a || []).filter(x => x !== du.code), r: (c.r || []).filter(x => x !== du.code), auto: (c.auto || []).filter(x => x !== du.code) });
          }
        }
      }
    });
    app.toast(`Deleted ${du.code}`, { action: undoAct });
  }

  // A small question sheet with several answers. Resolves to the chosen key (or null when closed).
  function choose(msg, options) {
    return new Promise(resolve => {
      let done = false;
      app.sheet({
        title: 'Rename code', body: h('p', { class: 'confirm-msg' }, msg),
        actions: options.map(([k, l], i) => ({ label: l, primary: i === options.length - 1, fn: () => { done = true; resolve(k); } })),
        onClose: () => { if (!done) resolve(null); },
      });
    });
  }

  // =============== shared bits ===============
  function field(label, id, input) {
    return h('div', { class: 'bx-field' }, h('label', { for: id }, label), input);
  }

  function addRow(btnLabel, placeholder, onAdd, withKind = false) {
    const id = fid('add');
    const inp = h('input', { type: 'text', id, placeholder, maxlength: '60', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); go(); } } });
    const kind = withKind ? h('select', { 'aria-label': 'Senior or junior' }, h('option', { value: 'junior' }, 'Junior'), h('option', { value: 'senior' }, 'Senior')) : null;
    function go() {
      const v = inp.value.trim();
      if (!v) { inp.focus(); return; }
      onAdd(v, kind ? kind.value : undefined);
      app.toast(`Added ${v}`, { action: undoAct, ms: 3000 });
    }
    return h('div', { class: 'pv-addrow' }, h('label', { class: 'sr-only', for: id }, placeholder), inp, kind,
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: go, html: `${app.icon('plus')}<span>${btnLabel}</span>` }));
  }

  function moveIn(key, i, dir, label) {
    app.store.commit(label, d => {
      const j = i + dir;
      if (j < 0 || j >= d[key].length) return false;
      [d[key][i], d[key][j]] = [d[key][j], d[key][i]];
    });
  }

  render();
  return {
    update() { render(); },
    route(params) { if (['staff', 'groups', 'tags', 'codes'].includes(params.s)) part = params.s; render(); },
  };
}

// ---------- helpers ----------

function rulesUsing(st, test) {
  return (st.rules || []).filter(r => { try { return test({ who: r.who || {}, params: r.params || {} }); } catch (e) { return false; } }).length;
}

// code -> { rules, cells }
function codeUsage(st) {
  const out = new Map();
  const bump = (c, k) => { const u = out.get(c) || { rules: 0, cells: 0 }; u[k]++; out.set(c, u); };
  for (const r of st.rules || []) {
    const seen = new Set();
    for (const v of Object.values(r.params || {})) {
      if (Array.isArray(v)) v.forEach(c => seen.add(c)); else if (typeof v === 'string') seen.add(v);
    }
    seen.forEach(c => bump(c, 'rules'));
  }
  for (const day of Object.values(st.cells || {})) {
    for (const c of Object.values(day || {})) {
      new Set([...(c.a || []), ...(c.r || [])]).forEach(code => bump(code, 'cells'));
    }
  }
  return out;
}

function renameCode(s, from, to) {
  for (const r of s.rules || []) {
    for (const [k, v] of Object.entries(r.params || {})) {
      if (Array.isArray(v)) r.params[k] = v.map(c => (c === from ? to : c));
      else if (v === from) r.params[k] = to;
    }
  }
  for (const day of Object.values(s.cells || {})) {
    for (const c of Object.values(day || {})) {
      for (const k of ['a', 'r', 'auto']) if (Array.isArray(c[k])) c[k] = [...new Set(c[k].map(x => (x === from ? to : x)))];
    }
  }
}

function codeProblem(st, c, oldCode) {
  if (!c) return 'Type a code.';
  if (/\s/.test(c)) return 'Codes have no spaces.';
  if (c.startsWith('@')) return 'Codes can\'t start with @ (those are groups of codes in rules).';
  if (c === 'x' && oldCode !== 'x') return 'x is post call, worked out by the app.';
  if (c !== oldCode && (st.duties || []).some(d => d.code === c)) return `${c} already exists.`;
  const clash = (st.duties || []).find(d => d.code !== oldCode && d.code !== c && d.code.toLowerCase() === c.toLowerCase());
  if (clash) return `${clash.code} already exists; Excel import couldn't tell ${c} and ${clash.code} apart.`;
  return '';
}

function slug(name, taken) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'g';
  let id = base, n = 2;
  while (taken.includes(id)) id = `${base}-${n++}`;
  return id;
}

function hex6(c, fb) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || ''));
  if (!m) return fb;
  return m[1].length === 3 ? '#' + m[1].split('').map(x => x + x).join('') : c.toLowerCase();
}

function arrow(dir) {
  const d = dir === 'up' ? 'M12 19V5M6 11l6-6 6 6' : 'M12 5v14M6 13l6 6 6-6';
  return `<svg class="ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}
