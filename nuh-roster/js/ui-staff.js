// The Staff tab, and duplicates on the staff list.
import { JUNIOR_GRADES, SENIOR_GRADES, DEFAULT_GRADE, bySeniority, COLOURS, COLOUR_ARGB, splitNameList, learnFromRosters, tickFromHistory, suggestShortNames, planImport, importUpdate, findDuplicates, mergeStaffRecords } from './engine.js';
import { readRosterRows, readStaffSheet, isContactList, readContactList } from './xlsxio.js';
import * as cloud from './cloud.js';
import { clone, DEMO, fileButton, h, newId, readWorkbook, save, select, setNextId, staffColour, state, syncRooms, toast } from './ui-core.js';
import { demoLink } from './ui-practice.js';
import { app, render } from './ui-screen.js';
import { SCREEN_COLOUR, staffHighlight } from './ui-person.js';
import { cloudError, cs, isMember, isViewer, rostererName, teamSyncBar, when } from './ui-team.js';

// ----- staff tab -----

export let staffFilter = '';
export const setStaffFilter = v => (staffFilter = v);
let tickMin = 1;
export let staffBackup = null; // copy of the staff list taken when editing starts; null when not editing
export const setStaffBackup = v => (staffBackup = v);
export const staffEditing = () => staffBackup !== null;
export const who = () => (typeof rostererName === 'string' && rostererName.trim()) || cs?.user?.displayName || cs?.user?.email || 'this browser';

const subLabel = k => state.settings.subspecs.find(s => s.key === k)?.label || k;
const listText = a => (a || []).join(', ') || 'none';

// What changed between two staff lists, as readable lines.
function diffStaff(before, after) {
  const out = [];
  const old = Object.fromEntries(before.map(p => [p.id, p]));
  const now = Object.fromEntries(after.map(p => [p.id, p]));
  for (const p of after) {
    const o = old[p.id];
    if (!o) { out.push(`Added ${p.role} ${p.name || '(no name)'} (${p.grade}${p.posting ? ', ' + p.posting : ''}${(p.subspecs || []).length ? ', ' + p.subspecs.map(subLabel).join('/') : ''})`); continue; }
    const c = [];
    if (o.name !== p.name) c.push(`renamed from ${o.name}`);
    if (o.role !== p.role) c.push(`moved ${o.role} → ${p.role}`);
    if (o.grade !== p.grade) c.push(`grade ${o.grade} → ${p.grade}`);
    if ((o.posting || '') !== (p.posting || '')) c.push(`posting ${o.posting || 'none'} → ${p.posting || 'none'}`);
    const colourName = k => COLOURS.find(x => x[0] === (k || ''))[1].toLowerCase();
    if ((o.colour || '') !== (p.colour || '')) c.push(`colour ${colourName(o.colour)} → ${colourName(p.colour)}`);
    if (listText(o.aliases) !== listText(p.aliases)) c.push(`short names ${listText(o.aliases)} → ${listText(p.aliases)}`);
    const os = new Set(o.subspecs || []), ns = new Set(p.subspecs || []);
    const plus = [...ns].filter(k => !os.has(k)).map(k => '+' + subLabel(k)), minus = [...os].filter(k => !ns.has(k)).map(k => '−' + subLabel(k));
    if (plus.length || minus.length) c.push(`subspecs ${[...plus, ...minus].join(' ')}`);
    if (listText(o.avoid) !== listText(p.avoid)) c.push(`doesn't do ${listText(o.avoid)} → ${listText(p.avoid)}`);
    if (c.length) out.push(`${p.name}: ${c.join('; ')}`);
  }
  for (const o of before) if (!now[o.id]) out.push(`Removed ${o.role} ${o.name}`);
  return out;
}

// A modal listing changes. Resolves to one of the button keys.
export function confirmChanges(title, lines, buttons) {
  return new Promise(resolve => {
    const dlg = h('dialog', { class: 'changes' },
      h('h2', {}, title),
      h('ul', {}, lines.slice(0, 300).map(l => h('li', {}, l))),
      lines.length > 300 ? h('p', { class: 'hint' }, `…and ${lines.length - 300} more.`) : null,
      h('div', { class: 'bar' }, buttons.map(([key, label, cls]) => h('button', { class: cls || '', onclick: () => {
        if (Date.now() - opened < 300) return; // ignore the key press that opened the dialog
        dlg.close(); dlg.remove(); resolve(key);
      } }, label))));
    const opened = Date.now();
    dlg.addEventListener('cancel', e => { e.preventDefault(); dlg.close(); dlg.remove(); resolve('back'); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function startStaffEdit() { staffBackup = clone(state.staff); render(); }

// Ask to keep or discard edits. Resolves true when editing has ended.
export async function finishStaffEdit() {
  if (!staffEditing()) return true;
  const changes = diffStaff(staffBackup, state.staff);
  if (!changes.length) { staffBackup = null; render(); return true; }
  const choice = await confirmChanges(`Save ${changes.length} change${changes.length > 1 ? 's' : ''} to the staff list?`, changes,
    [['save', 'Save changes', 'primary'], ['back', 'Keep editing'], ['discard', 'Discard changes']]);
  if (choice === 'back') return false;
  if (choice === 'discard') state.staff = staffBackup;
  else (state.staffLog ||= []).unshift({ at: Date.now(), by: who(), changes }), state.staffLog.splice(300);
  staffBackup = null;
  render();
  if (choice === 'save') toast(isMember() ? 'Changes saved here. Use "Save for the team" to share them.' : 'Changes saved.');
  return true;
}

function staffLogCard() {
  const log = state.staffLog || [];
  if (!log.length) return null;
  return h('section', { class: 'card' }, h('details', {},
    h('summary', {}, `Change history (${log.length})`),
    h('ul', { class: 'log' }, log.map(e => h('li', {},
      h('div', { class: 'seen' }, `${when(e.at)} · ${e.by}`),
      h('ul', {}, e.changes.map(c => h('li', {}, c))))))));
}

// The Staff tab: seniors or juniors, read-only until Edit.
export function renderStaffTab() {
  if (state.staffRole === 'postings') { state.staffRole = 'junior'; } // postings moved to Monthly › Rotations
  const role = state.staffRole === 'junior' ? 'junior' : 'senior';
  const pick = (r, label) => h('button', { 'aria-pressed': String(role === r), onclick: () => { state.staffRole = r; staffFilter = ''; render(); } }, label);
  const n = r => state.staff.filter(p => p.role === r).length;
  return h('div', {}, h('div', { class: 'seg subtabs', role: 'group', 'aria-label': 'Staff' },
    pick('senior', `Seniors (${n('senior')})`), pick('junior', `Juniors (${n('junior')})`)),
    renderStaff(role));
}

function renderStaff(role) {
  if (!staffEditing()) return renderStaffView(role);
  const subs = state.settings.subspecs;
  const senior = role === 'senior';
  const list = state.staff
    .filter(p => p.role === role)
    .filter(p => !staffFilter || (p.name + ' ' + (p.aliases || []).join(' ')).toLowerCase().includes(staffFilter.toLowerCase()))
    .sort(bySeniority);

  const row = p => h('tr', { 'data-id': p.id, class: staffHighlight === p.id ? 'highlight' : '' },
    h('td', {}, h('input', { value: p.name, onchange: e => { p.name = e.target.value.trim(); save(); } })),
    h('td', {}, h('input', { value: (p.aliases || []).join(', '), placeholder: 'e.g. Koh YW', onchange: e => { p.aliases = splitNameList(e.target.value); save(); } })),
    h('td', {}, select(p.grade, p.role === 'senior' ? SENIOR_GRADES : JUNIOR_GRADES, v => { p.grade = v; if (v === 'Locum' && !p.colour) p.colour = 'purple'; render(); })),
    !senior && h('td', {}, select(p.colour || '', COLOURS, v => { p.colour = v; render(); })),
    senior && h('td', {}, h('div', { class: 'chips' }, subs.map(s => {
        const on = (p.subspecs || []).includes(s.key);
        return h('span', { class: 'chip' + (on ? ' on' : ''), title: s.hard ? 'Only seniors with this subspec get these lists' : '', onclick: () => {
          p.subspecs = on ? p.subspecs.filter(k => k !== s.key) : [...(p.subspecs || []), s.key]; render();
        } }, s.label);
      }))),
    senior && h('td', {}, h('input', { value: (p.avoid || []).join(', '), placeholder: 'e.g. eye, obs', onchange: e => { p.avoid = splitNameList(e.target.value).map(s => s.toLowerCase()); save(); } })),
    h('td', {}, select(p.role, [['senior', 'Senior'], ['junior', 'Junior']], v => {
      p.role = v;
      if (!(v === 'senior' ? SENIOR_GRADES : JUNIOR_GRADES).includes(p.grade)) p.grade = DEFAULT_GRADE[v];
      if (v === 'senior') { p.colour = ''; p.posting = ''; }
      render();
      toast(`Moved ${p.name || 'them'} to ${v === 'senior' ? 'Seniors' : 'Juniors'}.`);
    })),
    h('td', {}, h('button', { class: 'small', title: 'Remove', onclick: () => { if (confirm(`Remove ${p.name}?`)) { state.staff = state.staff.filter(x => x !== p); render(); } } }, '✕')),
  );

  const count = state.staff.filter(p => p.role === role).length;
  return h('div', {},
    h('section', { class: 'card' },
      h('h2', {}, senior ? 'Seniors' : 'Juniors'),
      h('p', { class: 'hint' }, senior
        ? 'Tick each senior\'s subspecs and the lists they don\'t do. "Move to" moves someone to the juniors.'
        : 'Set each junior\'s grade and colour (postings are on Monthly › Rotations). Green marks a Baby MO: never left alone, so their senior won\'t double cover. Purple marks locums. "Move to" moves someone to the seniors.'),
      h('div', { class: 'bar sync dirty' },
        h('span', {}, `Editing the staff list. ${diffStaff(staffBackup, state.staff).length} change(s) so far; nothing is kept until you review and save.`),
        h('button', { class: 'primary', onclick: finishStaffEdit }, 'Review & save changes'),
        h('button', { onclick: () => { if (confirm('Discard all changes since you started editing?')) { state.staff = staffBackup; staffBackup = null; render(); } } }, 'Cancel')),
      h('div', { class: 'bar' },
        fileButton('Import staff sheet or contact list', '.xlsx,.csv', false, importStaffSheet),
        fileButton('Learn from past rosters', '.xlsx', true, learnFiles),
        senior && h('span', { class: 'btn-group' },
          h('button', { title: 'Tick each senior\'s subspecs from the subspec lists they did in past rosters you loaded. Only adds ticks.', onclick: () => {
            const n = tickFromHistory(state.staff, tickMin);
            render();
            toast(n ? `Ticked ${n} subspec(s). Check them before generating.` : 'Nothing new to tick.');
          } }, 'Tick subspecs from past rosters'),
          h('label', { class: 'seen' }, ' if seen ≥ ', h('input', { type: 'number', min: 1, max: 20, value: tickMin, style: 'width:56px', onchange: e => { tickMin = Math.max(1, +e.target.value || 1); } }), ' times')),
        h('button', { title: 'Look for people on the staff list twice under different spellings', onclick: () => { showDups = true; render(); } }, 'Find duplicates'),
        h('button', { title: 'Fill in short names (e.g. Koh YW, Anjali) for everyone who has none', onclick: () => {
          const props = suggestShortNames(state.staff);
          if (!props.length) return toast('Everyone already has a short name, or the suggestions would clash.');
          const eg = props.slice(0, 6).map(x => `${x.name} → ${x.short}`).join('\n');
          if (!confirm(`Add short names for ${props.length} people (seniors and juniors)?\n\n${eg}${props.length > 6 ? '\n…' : ''}\n\nYou can edit any of them afterwards.`)) return;
          for (const x of props) { const p = state.staff.find(s => s.id === x.id); if (p) p.aliases = [x.short]; }
          render();
          toast(`Added ${props.length} short names. Check them, then save for the team.`);
        } }, 'Suggest short names'),
        h('button', { onclick: () => { state.staff.unshift({ id: newId(), name: '', aliases: [], role, grade: DEFAULT_GRADE[role], posting: '', subspecs: [], avoid: [], history: {} }); staffFilter = ''; render(); } }, senior ? '+ Add senior' : '+ Add junior'),
        h('span', { class: 'grow' }),
        h('input', { placeholder: 'Filter names', value: staffFilter, oninput: e => { staffFilter = e.target.value; const pos = e.target.selectionStart; render(); const i = app.querySelector('input[placeholder="Filter names"]'); i.focus(); i.setSelectionRange(pos, pos); } }),
      ),
      h('div', { class: 'stats' }, h('span', {}, h('b', {}, count), senior ? ' seniors' : ' juniors')),
      importSkipNote(),
    ),
    duplicatesCard(),
    count
      ? h('section', { class: 'card scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, (senior ? ['Name', 'Short names', 'Grade', 'Subspecs', "Doesn't do", 'Move to', ''] : ['Name', 'Short names', 'Grade', 'Colour', 'Move to', '']).map(t => h('th', {}, t)))),
        h('tbody', {}, list.map(row))))
      : h('section', { class: 'card empty' }, `No ${senior ? 'seniors' : 'juniors'} yet. Import the master staff sheet, or load a few past rosters to build the list automatically.`),
  );
}

// The first time the real app opens (no staff yet): three ways in, instead of an empty staff page.
function welcomeCard() {
  if (state.staff.length || DEMO || isViewer()) return null;
  const signIn = cloud.enabled && !cs.user;
  return h('section', { class: 'card welcome' },
    h('h2', {}, 'Welcome to the NUH roster'),
    h('p', {}, 'Each day goes: monthly rosters → cases → generate the roster → fix the problems it lists → send it out. To start, the app needs the staff list.'),
    h('ol', { class: 'welcome-steps' },
      h('li', {}, h('b', {}, 'New here? '), 'Practise first on a made-up department, with a short tour. Nothing you do there touches the real roster. ',
        h('a', { class: 'btn primary', href: demoLink(), target: '_blank', rel: 'noopener' }, 'Try Practice')),
      cloud.enabled ? h('li', {}, h('b', {}, 'On the team? '), signIn ? 'Sign in with your Google account: the team\'s staff list loads by itself. ' : cs.member ? 'The team\'s staff list loads when someone has saved it (Staff › Save for the team). ' : 'Ask an admin to add you, then sign in again. ',
        signIn ? h('button', { onclick: () => cloud.signIn().catch(e => { if (e?.code !== 'auth/popup-closed-by-user') cloudError(e); }) }, 'Sign in with Google') : null) : null,
      h('li', {}, h('b', {}, 'Setting it up? '), 'Import the master staff sheet or the contact list (Excel). You check the list before anything is kept. ',
        fileButton('Import staff sheet', '.xlsx,.csv', false, async files => { if (!staffEditing()) startStaffEdit(); await importStaffSheet(files); }))));
}

function renderStaffView(role) {
  const subs = state.settings.subspecs;
  const senior = role === 'senior';
  const list = state.staff
    .filter(p => p.role === role)
    .filter(p => !staffFilter || (p.name + ' ' + (p.aliases || []).join(' ')).toLowerCase().includes(staffFilter.toLowerCase()))
    .sort(bySeniority);
  const count = state.staff.filter(p => p.role === role).length;
  const row = p => h('tr', {},
    h('td', {}, h('b', { style: staffColour(p) ? `color:${SCREEN_COLOUR[staffColour(p)] || '#' + COLOUR_ARGB[staffColour(p)].slice(2)}` : '' }, p.name)),
    h('td', {}, (p.aliases || []).join(', ')),
    h('td', {}, p.grade),
    !senior && h('td', { class: 'seen' }, COLOURS.find(c => c[0] === staffColour(p))[1]),
    senior
      ? h('td', {}, h('div', { class: 'chips' }, (p.subspecs || []).map(k => h('span', { class: 'chip on static' }, subLabel(k)))))
      : null,
    senior && h('td', {}, (p.avoid || []).join(', ')),
  );
  return h('div', {},
    welcomeCard(),
    h('section', { class: 'card' },
      h('h2', {}, senior ? 'Seniors' : 'Juniors'),
      h('p', { class: 'hint' }, senior
        ? 'The seniors the roster is generated from, with their subspecs and the lists they don\'t do.'
        : 'The juniors the roster is generated from, with their grade. Postings are on Monthly › Rotations.'),
      teamSyncBar(),
      h('div', { class: 'bar' },
        h('button', { onclick: startStaffEdit }, `Edit ${senior ? 'seniors' : 'juniors'}`),
        h('button', { title: 'Look for people on the staff list twice under different spellings', onclick: () => { showDups = true; startStaffEdit(); } }, 'Find duplicates'),
        h('span', { class: 'grow' }),
        h('input', { placeholder: 'Filter names', value: staffFilter, oninput: e => { staffFilter = e.target.value; const pos = e.target.selectionStart; render(); const i = app.querySelector('input[placeholder="Filter names"]'); i.focus(); i.setSelectionRange(pos, pos); } })),
      h('div', { class: 'stats' }, h('span', {}, h('b', {}, count), senior ? ' seniors' : ' juniors')),
    ),
    count
      ? h('section', { class: 'card scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, (senior ? ['Name', 'Short names', 'Grade', 'Subspecs', "Doesn't do"] : ['Name', 'Short names', 'Grade', 'Colour']).map(t => h('th', {}, t)))),
        h('tbody', {}, list.map(row))))
      : h('section', { class: 'card empty' }, `No ${senior ? 'seniors' : 'juniors'} yet. Click Edit to import the master staff sheet or learn from past rosters.`),
    staffLogCard(),
  );
}

async function importStaffSheet([file]) {
  const wb = await readWorkbook(file);
  const ws = wb.worksheets[0];
  const contact = isContactList(ws);
  let people;
  if (contact) people = readContactList(ws).people;
  else {
    const res = readStaffSheet(ws);
    if (res.error) return toast(res.error);
    people = res.people;
  }
  const plan = planImport(state.staff, people, { contact, skip: state.settings.importSkip || [] });
  const done = await reviewImport(plan, contact, file.name);
  if (!done) return;
  render();
  toast(`${done} Review the changes before saving.`);
}

// The import, person by person, before anything changes. Nobody is ticked to start with.
// Resolves to a summary, or null if cancelled.
function reviewImport(plan, contact, fileName) {
  const label = p => `${p.name} (${p.role === 'senior' ? 'senior' : 'junior'}, ${p.grade})`;
  const dec = new Map(); // item -> { on, how, always }
  const rowOf = new Map(); // item -> its tick box
  const refresh = () => { for (const [it, d] of dec) { const cb = rowOf.get(it); if (cb) cb.checked = d.on; } };
  for (const it of plan.items) dec.set(it, { on: false, how: it.kind === 'maybe' ? 'same:' + it.candidates[0].id : '', always: false });
  const removeStale = new Set();
  const of = k => plan.items.filter(i => i.kind === k);
  const tick = (checked, onchange) => h('input', { type: 'checkbox', checked, onchange: e => onchange(e.target.checked) });
  const alwaysOf = new Map(); // item -> its Always skip box
  const always = it => {
    const cb = tick(false, v => { dec.get(it).always = v; if (v) { dec.get(it).on = false; refresh(); } });
    alwaysOf.set(it, cb);
    return h('label', { class: 'check seen', title: 'Never offer this name again when importing' }, cb, ' Always skip');
  };
  const person = (it, extra) => {
    // ticking someone in undoes Always skip
    const cb = tick(false, v => { dec.get(it).on = v; if (v && dec.get(it).always) { dec.get(it).always = false; alwaysOf.get(it).checked = false; } });
    rowOf.set(it, cb);
    return h('tr', {},
      h('td', {}, h('label', { class: 'check' }, cb, ' ', h('b', {}, it.c.name)), h('div', { class: 'seen' }, `${it.c.role}, ${it.c.grade}`)),
      h('td', {}, extra || null), h('td', {}, always(it)));
  };
  // a section with Select all / Clear for its checkboxes
  const section = (title, hint, rows, closed) => {
    if (!rows.length) return null;
    const body = h('div', {}, hint ? h('p', { class: 'hint' }, hint) : null, h('table', {}, h('tbody', {}, rows)));
    // Select all leaves out names set to Always skip
    const setAll = v => { for (const cb of body.querySelectorAll('td:first-child input[type=checkbox]')) if (cb.checked !== v && !(v && cb.closest('tr').querySelector('td:last-child input')?.checked)) { cb.checked = v; cb.dispatchEvent(new Event('change')); } };
    const head = [h('h3', { style: 'display:inline' }, `${title} (${rows.length})`), ' ',
      h('button', { class: 'small', onclick: e => { e.preventDefault(); setAll(true); } }, 'Select all'), ' ',
      h('button', { class: 'small', onclick: e => { e.preventDefault(); setAll(false); } }, 'Clear')];
    return closed ? h('section', {}, h('details', {}, h('summary', {}, ...head), body)) : h('section', {}, h('div', { class: 'section-head' }, ...head), body);
  };

  return new Promise(resolve => {
    const close = v => { dlg.close(); dlg.remove(); resolve(v); };
    const apply = () => {
      const skip = new Set(state.settings.importSkip || []);
      const byId = new Map(state.staff.map(p => [p.id, p]));
      const added = [];
      let updated = 0;
      const create = c => ({ id: newId(), source: contact ? 'contact' : 'sheet', name: c.name, aliases: c.aliases || [], role: c.role, grade: c.grade, posting: c.posting || '', subspecs: c.subspecs || [], avoid: c.avoid || [], history: {} });
      for (const it of plan.items) {
        const d = dec.get(it);
        if (!d) continue;
        if (d.always) { skip.add(it.c.name); continue; }
        if (!d.on) continue;
        if (it.kind === 'match') { byId.set(it.p.id, it.p); updated++; }
        else if (it.kind === 'maybe' && d.how.startsWith('same:')) { const t = byId.get(d.how.slice(5)); if (t) { byId.set(t.id, importUpdate(t, it.c, contact).p); updated++; } }
        else added.push(create(it.c));
      }
      for (const p of removeStale) byId.delete(p.id);
      state.staff = [...byId.values(), ...added];
      state.settings.importSkip = [...skip];
      close(`${fileName}: ${added.length} added, ${updated} updated${removeStale.size ? `, ${removeStale.size} removed` : ''}.`);
    };
    const dlg = h('dialog', { class: 'changes wide' },
      h('h2', {}, `Import ${fileName}`),
      h('p', { class: 'hint' }, `${plan.items.length} people read${contact ? ' (names, grades and subspecs only)' : ''}. Tick the people to bring in; nothing changes until you press Import.`),
      h('div', { class: 'import-review' },
        section('Might already be on the list', 'These look like someone already here, written differently. Pick who they are, or add them as a new person.',
          of('maybe').map(it => person(it, select(dec.get(it).how, [...it.candidates.map(p => ['same:' + p.id, `Same as ${label(p)}`]), ['add', 'Add as a new person']], v => { dec.get(it).how = v; })))),
        section('New people', null, of('new').map(it => person(it))),
        section('New juniors', 'Junior postings rotate, so juniors who aren\'t on the staff list usually stay out.', of('newJunior').map(it => person(it)), true),
        section('Changes to people on the list', null, of('match').filter(it => it.changes.length).map(it => h('tr', {},
          h('td', {}, h('label', { class: 'check' }, tick(false, v => { dec.get(it).on = v; }), ' ', h('b', {}, it.p.name))),
          h('td', { class: 'seen', colspan: 2 }, it.changes.join('; '))))),
        section('No longer on the contact list', 'Added by an earlier import of the contact list but not on this one. Tick to remove them.', plan.stale.map(p => h('tr', {},
          h('td', {}, h('label', { class: 'check' }, tick(false, v => { if (v) removeStale.add(p); else removeStale.delete(p); }), ' Remove ', h('b', {}, p.name))),
          h('td', { class: 'seen', colspan: 2 }, p.grade)))),
        h('p', { class: 'seen' }, `${of('match').filter(it => !it.changes.length).length} already on the list with nothing to change.${of('skipped').length ? ` ${of('skipped').length} always skipped.` : ''}`)),
      h('div', { class: 'bar' },
        h('button', { class: 'primary', onclick: apply }, 'Import'),
        h('button', { onclick: () => close(null) }, 'Cancel')));
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(null); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

// ---- duplicates on the staff list ----

let showDups = false;
// Move a person's day records (status, flags, fixed rooms) to the person they were merged into.
function remapStaffId(from, to) {
  const days = [state.day, ...Object.values(state.days || {}).map(r => r.day)].filter(Boolean);
  for (const d of days) {
    if (d.staff?.[from]) {
      // keep whichever of the two isn't simply available (e.g. on leave)
      const a = d.staff[to], b = d.staff[from];
      d.staff[to] = !a ? b : (a.status || 'avail') === 'avail' && (b.status || 'avail') !== 'avail' ? { ...a, ...b } : { ...b, ...a };
      delete d.staff[from];
    }
    for (const r of d.rooms || []) { if (r.lockSenior === from) r.lockSenior = to; if (r.lockJunior === from) r.lockJunior = to; }
  }
}
function mergePair(keep, drop) {
  state.staff = state.staff.filter(p => p !== drop).map(p => p === keep ? mergeStaffRecords(keep, drop) : p);
  remapStaffId(drop.id, keep.id);
  toast(`Merged ${drop.name} into ${keep.name}. ${drop.name} is kept as a short name.`);
  render();
}
function duplicatesCard() {
  if (!showDups) return null;
  const pairs = findDuplicates(state.staff);
  const who = p => h('div', {}, h('b', {}, p.name), h('div', { class: 'seen' }, `${p.role === 'senior' ? 'Senior' : 'Junior'} · ${p.grade}${(p.aliases || []).length ? ' · ' + p.aliases.join(', ') : ''}`));
  return h('section', { class: 'card' },
    h('div', { class: 'bar' }, h('h2', { class: 'grow', style: 'margin:0' }, `Possible duplicates (${pairs.length})`), h('button', { onclick: () => { showDups = false; render(); } }, 'Close')),
    pairs.length
      ? h('table', {}, h('tbody', {}, pairs.map(({ a, b }) => h('tr', {},
        h('td', {}, who(a)), h('td', {}, who(b)),
        h('td', {}, h('div', { class: 'btn-group' },
          h('button', { title: `Keep ${a.name}; ${b.name} becomes a short name`, onclick: () => mergePair(a, b) }, `Keep ${a.name}`),
          h('button', { title: `Keep ${b.name}; ${a.name} becomes a short name`, onclick: () => mergePair(b, a) }, `Keep ${b.name}`),
          h('button', { onclick: () => { a.notDup = [...new Set([...(a.notDup || []), b.id])]; b.notDup = [...new Set([...(b.notDup || []), a.id])]; render(); } }, 'Different people')))))))
      : h('p', { class: 'hint' }, 'No likely duplicates.'));
}
function importSkipNote() {
  const list = state.settings.importSkip || [];
  if (!list.length) return null;
  return h('details', { class: 'seen', style: 'margin-top:8px' }, h('summary', {}, `${list.length} name(s) are always skipped when importing`),
    h('div', { class: 'chips', style: 'margin-top:6px' }, list.map(n => h('span', { class: 'chip static' }, n, ' ',
      h('button', { class: 'link', title: 'Import this name again next time', onclick: () => { state.settings.importSkip = list.filter(x => x !== n); render(); } }, '×')))));
}

async function learnFiles(files) {
  let staff = state.staff, rooms = [];
  for (const f of files) {
    const wb = await readWorkbook(f);
    const res = learnFromRosters(readRosterRows(wb.worksheets[0]), staff, state.settings);
    staff = res.staff;
    for (const r of res.rooms) if (!rooms.some(x => x.name === r.name)) rooms.push(r);
  }
  const before = state.staff.length;
  state.staff = staff;
  setNextId(1 + staff.reduce((m, p) => Math.max(m, parseInt(String(p.id).replace(/\D/g, ''), 10) || 0), 0));
  const newRooms = rooms.filter(r => !state.roomTemplate.some(t => t.name === r.name));
  if (newRooms.length) { state.roomTemplate.push(...newRooms.map(r => ({ ...r, defaultOn: true }))); syncRooms(); }
  toast(`Read ${files.length} roster(s): ${staff.length - before} new people${newRooms.length ? `, ${newRooms.length} new rooms` : ''}. Check roles, grades and subspecs.`);
  render();
}
