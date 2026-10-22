// The Cases tab (the day): rooms, cases, flags, fixed people and reading the admin team's draft.
import { bySeniority, matchName, sameNameScore, splitNameList, namesInCell, suggestFlags, remoteRoom, pacuRoom, isPacu } from './engine.js';
import { readRosterRows, dateFromText, cellText } from './xlsxio.js';
import { shortName, TEAM_ROWS } from './layout.js';
import { addDays } from './monthly.js';
import { dayOf, DEMO, fileButton, h, person, readWorkbook, save, select, state, syncRooms, toast, undoToast } from './ui-core.js';
import { downloadPracticeDraft } from './ui-practice.js';
import { longDate, render, switchDate } from './ui-screen.js';
import { finishStaffEdit, staffEditing, who } from './ui-staff.js';
import { nameInput, pushUndoAll, setRosterView } from './ui-roster.js';
import { canGenerate, openPersonBox, personChip, runGenerate } from './ui-person.js';
import { generalPeople } from './ui-general.js';
import { personCache } from './ui-monthly.js';
import { problemsOf } from './ui-problems.js';

// ----- day tab -----

const pasteText = { leave: '', postcall: '', elsewhere: '', admin: '', notAround: '' };
let unmatched = [];
export let lastDraft = null, lastRotFile = null; // to read again after names are fixed
export const setLastRotFile = v => (lastRotFile = v);

// Names an import couldn't match: pick who each one is (closest names first). The spelling is kept as that person's
// short name, so the next import matches it, then rerun() reads the file again. role: 'senior' | 'junior' | null.
let fixPick = {};
export function fixNamesCard(names, { role = null, rerun, dismiss, what = 'the file' }) {
  const list = [...new Set(names.map(n => String(n).trim()).filter(Boolean))];
  if (!list.length) return null;
  const pool = state.staff.filter(p => !role || p.role === role);
  const options = n => {
    const m = matchName(n, pool);
    const ranked = pool.map(p => [p, (m.ambiguous || []).includes(p) ? 4 : sameNameScore({ name: n }, p)]).filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p]) => p);
    const rest = pool.filter(p => !ranked.includes(p)).sort((a, b) => a.name.localeCompare(b.name));
    return [['', 'Choose…'], ['skip', 'Skip (not on the staff list)'],
      ...(ranked.length ? [['', '── closest names ──'], ...ranked.map(p => [p.id, p.name])] : []),
      ['', '── everyone ──'], ...rest.map(p => [p.id, p.name])];
  };
  const save = () => {
    const changes = [];
    for (const n of list) {
      const p = person(fixPick[n]);
      if (!p) continue;
      if (![p.name, ...(p.aliases || [])].some(a => a.toLowerCase() === n.toLowerCase())) { (p.aliases ||= []).push(n); changes.push(`${p.name}: short name + ${n}`); }
    }
    fixPick = {};
    if (changes.length) (state.staffLog ||= []).unshift({ at: Date.now(), by: who(), changes }), state.staffLog.splice(300);
    personCache.clear();
    toast(changes.length ? `Kept ${changes.length} spelling${changes.length > 1 ? 's' : ''} as short names. Reading ${what} again…` : 'Nothing picked.');
    if (changes.length && rerun) rerun(); else render();
  };
  return h('section', { class: 'card fix-names' },
    h('h2', {}, `${list.length} name${list.length > 1 ? 's' : ''} not matched`),
    h('p', { class: 'hint' }, `Pick who each one is. The spelling is kept as their short name, so ${what} matches next time.`),
    h('table', {}, h('tbody', {}, list.map(n => h('tr', {},
      h('td', {}, h('b', {}, n)),
      h('td', {}, select(fixPick[n] || '', options(n), v => { fixPick[n] = v; })))))),
    h('div', { class: 'bar' },
      h('button', { class: 'primary', onclick: save }, 'Save and read again'),
      h('button', { onclick: () => { fixPick = {}; dismiss(); } }, 'Dismiss')));
}
let lockEditing = null;
export let settingsEditing = false; // "roomId:lockSenior" while picking a fixed person on the Cases tab
export const setSettingsEditing = v => (settingsEditing = v);

// The usual morning in one go: the admin draft, then the roster, then what needs a look.
async function doItAll(files) {
  await loadDraft(files);
  if (!canGenerate()) return;
  runGenerate(true);
  setRosterView('edit');
  state.tab = 'roster'; window.scrollTo(0, 0); render();
  const n = problemsOf(state.roster).length;
  setTimeout(() => document.getElementById('problems')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  toast(n ? `Roster made from the draft: ${n} thing${n > 1 ? 's' : ''} to look at.` : 'Roster made from the draft: no problems found.');
}
// A box saying what to do next, with a button that goes there.
export const goTab = async t => { if (staffEditing() && t !== 'staff' && !(await finishStaffEdit())) return; state.tab = t; window.scrollTo(0, 0); render(); };
export const nextStep = (text, label, tab) => h('div', { class: 'next-step' }, h('span', {}, text), h('button', { class: 'primary', onclick: () => goTab(tab) }, label + ' →'));
let flagsOpen = null; // the room whose full set of flags is showing on Cases
// The same weekday last week, if this browser has it: copy which rooms run, their sessions and fixed people
// (lists repeat by weekday), not the case notes.
function lastWeekButton() {
  const prev = addDays(state.day.date, -7), rec = state.days?.[prev];
  if (!rec?.day?.rooms?.length) return null;
  const wd = new Date(prev + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long' });
  return h('button', { title: `Which rooms run, their sessions and fixed seniors and juniors, from ${longDate(prev)}. Case notes aren't copied.`, onclick: () => {
    pushUndoAll(`copying rooms from last ${wd}`, { day: true });
    const by = Object.fromEntries(rec.day.rooms.map(r => [r.name, r]));
    let n = 0;
    for (const r of state.day.rooms) {
      const o = by[r.name];
      if (!o) continue;
      const lockS = o.lockSenior && person(o.lockSenior) ? o.lockSenior : '', lockJ = o.lockJunior && person(o.lockJunior) ? o.lockJunior : '';
      if (r.running !== !!o.running || r.session !== o.session || r.lockSenior !== lockS || r.lockJunior !== lockJ) n++;
      Object.assign(r, { running: !!o.running, session: o.session || 'full', lockSenior: lockS, lockJunior: lockJ });
    }
    render();
    undoToast(n ? `Copied rooms, sessions and fixed people from last ${wd} (${n} room${n === 1 ? '' : 's'} changed).` : `Already the same as last ${wd}.`);
  } }, `Start from last ${wd}`);
}

export function renderDay(part) {
  const cases = part === 'cases';
  const d = state.day;
  const subs = state.settings.subspecs;
  const running = d.rooms.filter(r => r.running);
  const avail = role => state.staff.filter(p => p.role === role && (dayOf(p.id).status || 'avail') === 'avail').length;
  const names = h('datalist', { id: 'staffNames' }, state.staff.map(p => h('option', { value: p.name })));

  // fixed senior / junior: a chip, picked from the staff list only (no typing in new names)
  const lockInput = (r, key) => {
    const p = r[key] && person(r[key]);
    if (p) return personChip(p, { class: 'name pchip lock-chip', onclick: e => openPersonBox(e.currentTarget, p, { kind: 'lock', room: r, key }) },
      h('span', { class: 'icon del', title: 'Let the roster choose', onclick: e => { e.stopPropagation(); r[key] = ''; render(); } }, '×'));
    const id = r.id + ':' + key;
    if (lockEditing !== id) return h('button', { class: 'add-name', title: 'Fix someone to this room', onclick: () => { lockEditing = id; render(); } }, '+');
    const pick = v => {
      if (lockEditing !== id) return; // the change event that follows Enter
      const q = String(v).trim();
      const exact = state.staff.find(s => s.name === q && s.role === (key === 'lockSenior' ? 'senior' : 'junior'));
      const m = exact ? { person: exact } : matchName(q, state.staff.filter(s => s.role === (key === 'lockSenior' ? 'senior' : 'junior')));
      if (!q) { lockEditing = null; render(); return; }
      if (!m.person) { toast(m.ambiguous ? `"${q}" could be ${m.ambiguous.map(x => x.name).join(' or ')}` : `"${q}" isn't on the staff list. Add them on the Staff tab first.`); return; }
      r[key] = m.person.id; lockEditing = null; render();
    };
    const input = nameInput({ class: 'cell-input', placeholder: 'Pick from the staff list',
      onkeydown: e => { if (e.key === 'Escape') { lockEditing = null; render(); } if (e.key === 'Enter') { e.preventDefault(); pick(e.target.value); } },
      onchange: e => { if (state.staff.some(s => s.name === e.target.value)) pick(e.target.value); },
      onblur: e => setTimeout(() => { if (lockEditing === id && !e.target.value.trim()) { lockEditing = null; render(); } }, 150) },
    key === 'lockSenior' ? 'senior' : 'junior');
    setTimeout(() => input.focus());
    return input;
  };

  // flags: only the ones that are on, as chips; "+ flag" opens the full set for that room
  const flagCell = r => {
    const all = [
      ...subs.map(x => ({ label: x.label, on: r.flags.subspecs.includes(x.key), toggle: () => { r.flags.subspecs = r.flags.subspecs.includes(x.key) ? r.flags.subspecs.filter(k => k !== x.key) : [...r.flags.subspecs, x.key]; } })),
      { label: 'Complex', title: 'No double cover, no MOPEX/Baby MO if avoidable, no liver standby senior', on: !!r.flags.complex, toggle: () => { r.flags.complex = !r.flags.complex; } },
      { label: 'Runs late', title: 'Runs late: avoid people who need to leave early', on: !!r.flags.long, toggle: () => { r.flags.long = !r.flags.long; } },
    ];
    const open = flagsOpen === r.id;
    const chip = f => h('span', { class: 'chip' + (f.on ? ' on' : ''), title: f.title || (f.on ? `Remove ${f.label}` : `Add ${f.label}`), onclick: () => { r.flagsManual = true; f.toggle(); render(); } }, f.label, f.on && !open ? ' ×' : '');
    if (!r.running) return null;
    return h('div', { class: 'chips' },
      (open ? all : all.filter(f => f.on)).map(chip),
      h('button', { class: 'add-flag', onclick: () => { flagsOpen = open ? null : r.id; render(); } }, open ? 'Done' : '+ flag'));
  };

  const roomRow = r => h('tr', { class: r.running ? '' : 'off' },
    h('td', {}, h('input', { type: 'checkbox', checked: r.running, 'aria-label': 'Running', onchange: e => { r.running = e.target.checked; if (r.running && !r.flagsManual) r.flags = suggestFlags(r.notes, state.settings, r.name); render(); } })),
    h('td', { class: 'room' }, h('b', {}, r.name)),
    h('td', { class: 'session' }, select(r.session || 'full', [['full', 'Full'], ['am', 'AM'], ['pm', 'PM']], v => { r.session = v; save(); })),
    h('td', { class: 'notes', 'data-label': 'Case notes' }, h('input', { value: r.notes, placeholder: 'e.g. eye 5y', onchange: e => {
      r.notes = e.target.value;
      if (e.target.value.trim()) r.running = true;
      if (!r.flagsManual) r.flags = suggestFlags(r.notes, state.settings, r.name);
      render();
    } })),
    h('td', { class: 'flags', 'data-label': 'Flags' }, flagCell(r)),
    h('td', { class: 'lock', 'data-label': 'Fixed senior' }, lockInput(r, 'lockSenior')),
    h('td', { class: 'lock', 'data-label': 'Fixed junior' }, lockInput(r, 'lockJunior')),
  );

  const pasteBox = (key, label, hint) => h('div', {},
    h('label', {}, label),
    h('textarea', { placeholder: hint, value: pasteText[key], oninput: e => { pasteText[key] = e.target.value; } }));

  return h('div', {},
    names,
    h('section', { class: 'card' },
      h('h2', {}, cases ? 'Cases' : 'Manpower'),
      !state.staff.length ? nextStep('Add the staff list first, so names in the draft can be matched.', 'Go to Staff', 'staff') : null,
      h('div', { class: 'bar' },
        h('label', { class: 'btn primary', title: 'Load the admin draft, make the roster from it, and show what needs a look' }, 'Do it all: load draft and make roster',
          h('input', { type: 'file', accept: '.xlsx', hidden: true, onchange: async e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) await doItAll(f); } })),
        fileButton('Load draft only', '.xlsx', false, loadDraft),
        DEMO ? h('button', { title: 'A draft in the admin team\'s usual format, made from this practice day', onclick: downloadPracticeDraft }, 'Download a practice draft') : null,
        cases ? lastWeekButton() : null,
        cases
          ? h('button', { onclick: () => { pushUndoAll('clearing the cases', { day: true }); d.rooms = []; syncRooms(); render(); undoToast('Cleared the cases. Rooms are back to running by default.'); } }, 'Clear cases')
          : h('button', { onclick: () => { pushUndoAll('clearing the manpower', { day: true }); d.staff = {}; d.lists = {}; render(); undoToast('Cleared leave, post call and other statuses.'); } }, 'Clear manpower'),
      ),
      h('p', { class: 'hint' }, "Both read the admin team's draft in the usual format: running rooms, case notes, leave, post call and upper-half duties. \"Do it all\" then makes the roster and opens its problems."),
      fixNamesCard(unmatched, { what: lastDraft ? 'the draft' : 'the names', rerun: lastDraft ? () => loadDraft([lastDraft]) : null, dismiss: () => { unmatched = []; render(); } }),
      h('div', { class: 'stats' },
        h('span', {}, h('b', {}, running.length), ' rooms running'),
        h('span', {}, h('b', {}, avail('senior')), ' seniors available'),
        h('span', {}, h('b', {}, avail('junior')), ' juniors available'),
      ),
    ),
    cases && h('section', { class: 'card scroll' },
      h('h2', {}, 'OT lists'),
      h('p', { class: 'hint' }, 'Tick the rooms that are running and type the case notes as usual. Flags are suggested from the notes (ages under ' + state.settings.paedsAgeYears + 'y count as paeds); "+ flag" adds or removes one. Fix a senior or junior to lock them in; the rest is filled automatically.'),
      h('table', { class: 'cases-table' },
        h('thead', {}, h('tr', {}, ['Run', 'Room', 'Session', 'Case notes', 'Flags', 'Fixed senior', 'Fixed junior'].map(t => h('th', {}, t)))),
        h('tbody', {}, d.rooms.map(roomRow))),
    ),
    !cases && h('section', { class: 'card' },
      h('h2', {}, 'Paste from the leave sheet'),
      h('p', { class: 'hint' }, 'Paste names from the leave sheet: short forms like "Koh YW" or "Anjali" work. Separate names with commas or new lines.'),
      h('div', { class: 'paste' },
        pasteBox('leave', 'Leave', 'Koh YW, Ong KS'),
        pasteBox('postcall', 'Post call', ''),
        pasteBox('elsewhere', 'Elsewhere (SICU, EOT, epidural, pain, ECT…)', ''),
        pasteBox('admin', 'Admin / no list', ''),
        pasteBox('notAround', 'Juniors away on the previous working day', ''),
      ),
      h('div', { class: 'bar', style: 'margin-top:12px' }, h('button', { class: 'primary', onclick: applyPaste }, 'Apply names')),
    ),
  );
}

function markNames(names, fn) {
  const missed = [];
  for (const n of names) {
    const m = matchName(n, state.staff);
    if (m.person) {
      const d = dayOf(m.person.id);
      const before = [d.status, d.notAroundPrev];
      fn(d, m.person);
      if (d.status !== before[0]) d.manual = true;
      if (d.notAroundPrev !== before[1]) d.manualAway = true;
    } else missed.push(m.ambiguous ? `${n} (several matches)` : n);
  }
  return missed;
}

// Names as written on the leave sheet / draft, kept so the roster shows them the same way.
function addRaw(key, entries) {
  const lists = (state.day.lists ||= {});
  const list = (lists[key] ||= []);
  for (const e of entries.map(x => x.trim()).filter(Boolean)) if (!list.includes(e)) list.push(e);
}

// The post call / leave / admin lists for the sheet: raw entries that still apply, plus anyone
// whose status was set by hand and isn't listed yet.
export function rosterLists() {
  const out = {};
  for (const key of ['postcall', 'leave', 'admin']) {
    const covered = new Set();
    const list = [];
    for (const e of state.day.lists?.[key] || []) {
      const p = matchName(e.replace(/\(.*?\)/g, '').trim(), state.staff).person;
      if (p) {
        if ((dayOf(p.id).status || 'avail') !== key) continue; // status changed since
        covered.add(p.id);
      }
      list.push(e);
    }
    for (const p of state.staff) {
      const st = state.day.staff[p.id]?.status || 'avail';
      if ((st === key || (key === 'leave' && st === 'mc')) && !covered.has(p.id)) list.push(shortName(p));
    }
    out[key] = list;
  }
  // people working today but on no list go on the Admin/no list row too
  for (const p of noListPeople()) out.admin.push(shortName(p));
  return out;
}

// Seniors and juniors who are available but not on any list of the roster (or the Calls/clinics tab).
export function noListPeople() {
  const rows = state.roster?.date === state.day.date ? state.roster.rows : null;
  if (!rows) return [];
  const listed = new Set(generalPeople());
  for (const row of rows) for (const key of ['senior', 'junior']) for (const n of namesInCell(row[key])) {
    const p = matchName(n, state.staff).person;
    if (p) listed.add(p.id);
  }
  return state.staff.filter(p => (state.day.staff[p.id]?.status || 'avail') === 'avail' && !listed.has(p.id))
    .sort(bySeniority);
}

function applyPaste() {
  const missed = [];
  for (const [key, status] of [['leave', 'leave'], ['postcall', 'postcall'], ['elsewhere', 'elsewhere'], ['admin', 'admin']]) {
    missed.push(...markNames(splitNameList(pasteText[key]), s => { s.status = status; }));
    if (key !== 'elsewhere') addRaw(key, pasteText[key].split(/[\n,;\/\t]+/));
  }
  missed.push(...markNames(splitNameList(pasteText.notAround), s => { s.notAroundPrev = true; }));
  Object.keys(pasteText).forEach(k => { pasteText[k] = ''; });
  unmatched = missed;
  render();
  toast(missed.length ? `${missed.length} name(s) not matched` : 'All names matched.');
}

// The admin draft's top half: MOT/SICU block, duty rows, AOCC/AIC and AH OT.
function readUpperHalf(ws, d) {
  const g = (d.general = {});
  const fixed = (d.fixed = {});
  const byRow = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const t = c => cellText(row.getCell(c).value).trim();
    byRow[n] = { label: t(1).replace(/:\s*$/, '').toLowerCase(), c: t(3), f: t(6), i: t(9) };
  });
  const find = re => byRow.findIndex(x => x && re.test(x.label));
  const team = find(/^consultant$/);
  if (team > 0) TEAM_ROWS.forEach(([k], i) => {
    const x = byRow[team + i];
    if (!x) return;
    if (x.c && !/^mot$/i.test(x.c)) g['mot.' + k] = x.c;
    if (x.f && !/^sicu$/i.test(x.f)) g['sicu.' + k] = x.f;
  });
  const keys = { 'eot 8': 'eot8', 'eot 9': 'eot9', epidural: 'epi', 'cardiac call': 'cardiac', 'pain/acp clinic': 'painacp', 'acute pain': 'acute', 'chronic pain': 'chronic' };
  const strip = (v, t) => v.replace(new RegExp(`\\s*\\(${t}\\)\\s*$`, 'i'), '');
  byRow.forEach((x, n) => {
    if (!x) return;
    const k = keys[x.label];
    if (k === 'epi') { if (x.c) g['epi.s'] = x.c; if (x.f) g['epi.df'] = strip(x.f, 'DF'); if (x.i) g['epi.nf'] = strip(x.i, 'NF'); }
    if (x.label === 'adot' && x.c && !g['epi.s']) g['epi.s'] = x.c;
    if (x.label === 'ect') {
      const room = d.rooms.find(r => r.name === 'ECT');
      const who = t => matchName(namesInCell(t)[0] || '', state.staff).person;
      if (room) { room.running = true; room.lockSenior = who(x.c)?.id || ''; room.lockJunior = who(x.f)?.id || ''; }
    }
    else if (k) {
      if (x.c) g[k + '.s'] = x.c;
      if (x.f) g[k + '.a'] = x.f;
      if (k === 'eot9' && byRow[n + 1] && !byRow[n + 1].label && byRow[n + 1].f) g['eot9.a2'] = byRow[n + 1].f;
    }
    if (x.label === 'aocc') {
      if (x.c) fixed['aocc.s'] = x.c.replace(/\s*\(req\)\s*$/i, '');
      if (x.f) fixed['aocc.j'] = strip(x.f, 'AOCC');
      const aic = x.i.replace(/^AIC:\s*/i, '');
      if (aic) fixed.aic = aic;
    }
    if (/^ah ot/.test(x.label) && x.c) fixed.ahot = x.c;
  });
}

async function loadDraft([file]) {
  lastDraft = file;
  const wb = await readWorkbook(file);
  const ws = wb.worksheets[0];
  const rows = readRosterRows(ws);
  const dateCell = cellText(ws.getCell('C5').value).trim();
  const draftDate = dateFromText(dateCell);
  const moved = draftDate && draftDate !== state.day.date;
  if (moved) switchDate(draftDate);
  const d = state.day;

  // continuation lines (leave lists run over several rows with an empty label)
  const sections = {};
  let current = null;
  ws.eachRow({ includeEmpty: false }, row => {
    const label = cellText(row.getCell(1).value).trim();
    if (label) current = label.toLowerCase();
    if (!current) return;
    for (let c = 3; c <= 12; c++) {
      const t = cellText(row.getCell(c).value).trim();
      if (t) (sections[current] ||= []).push(t);
    }
  });
  const get = re => Object.entries(sections).filter(([k]) => re.test(k)).flatMap(([, v]) => v);

  // PACU rows aren't in the admin draft; keep them as set in Settings
  d.rooms.forEach(r => { r.running = isPacu(r.name) ? !!state.roomTemplate.find(t => t.name === r.name)?.defaultOn : false; });
  let rooms = 0;
  for (const r of rows) {
    const remote = remoteRoom(r.label);
    const pacu = pacuRoom(r.label);
    const m = (pacu ? [null, pacu, pacu.startsWith('MBOR') ? 'MOR' : pacu.split(' ')[0]] : null)
      || r.label.match(/((KROR|MCOR|MOR)\s*\d+)\s*$/i) || (remote ? [null, remote, 'Other'] : null);
    if (!m) continue;
    const name = pacu || remote || m[1].toUpperCase().replace(/\s+/, ' ');
    let room = d.rooms.find(x => x.name === name);
    if (!room) { state.roomTemplate.push({ complex: m[2] ? m[2].toUpperCase() : 'Other', name, defaultOn: true }); syncRooms(); room = d.rooms.find(x => x.name === name); }
    room.running = true;
    room.notes = r.notes;
    room.flagsManual = false;
    room.flags = suggestFlags(r.notes, state.settings, name);
    room.session = /\bam\b/i.test(r.senior) && !/\bpm\b/i.test(r.senior) && !r.notes ? 'am' : 'full';
    rooms++;
  }
  d.lists = { leave: get(/^leave/), postcall: get(/^post call/), admin: get(/^admin/) };
  const missed = [
    ...markNames(get(/^leave/).flatMap(splitNameList).filter(n => !/kiv/i.test(n)), s => { s.status = 'leave'; }),
    ...markNames(get(/^post call/).flatMap(splitNameList), s => { s.status = 'postcall'; }),
    ...markNames(get(/^admin/).flatMap(splitNameList), s => { s.status = 'admin'; }),
  ];
  readUpperHalf(ws, d);
  const upperLabels = /^(recovery|eot|epidural|adot|cardiac call|aocc|pain|acute pain|chronic pain|consultant|registrar|residents|ah ot|ah icu)/;
  const upperNames = Object.entries(sections).filter(([k]) => upperLabels.test(k)).flatMap(([, v]) => v)
    .flatMap(namesInCell).filter(n => !/^(MOT|SICU|AIC\b)/i.test(n)).map(n => n.replace(/^AIC:\s*/i, ''));
  markNames(upperNames, (s, p) => { if ((s.status || 'avail') === 'avail') s.status = 'elsewhere'; });
  unmatched = missed;
  render();
  toast(`Draft loaded${moved ? ` for ${draftDate}` : ''}: ${rooms} rooms.${missed.length ? ` ${missed.length} name(s) not matched.` : ''}`);
}
