import {
  DEFAULT_SETTINGS, DEFAULT_ROOMS, JUNIOR_GRADES, SENIOR_GRADES, DEFAULT_GRADE, OLD_GRADES, POSTINGS, postingName, bySeniority, STATUSES, COLOURS, COLOUR_ARGB, isBaby,
  matchName, sameNameScore, splitNameList, namesInCell, sentRows, rosterChanges, changeText, suggestFlags, generate, check, learnFromRosters, tickFromHistory, remoteRoom, suggestShortNames, mergeContacts, planImport, importUpdate, findDuplicates, mergeStaffRecords, pacuRoom, isPacu, fmtSenior, fmtJunior, SPECIAL_ROWS, isSpecialRow, isCoverPart, coverTarget,
} from './engine.js';
// Seniors are always shown in black; juniors may be green (Baby MO) or purple (locum).
const staffColour = p => (p && p.role !== 'senior' && p.colour) || '';
import { readRosterRows, dateFromText, readStaffSheet, buildRosterWorkbook, cellText, isContactList, readContactList, cleanContactName } from './xlsxio.js';
import { buildLayout, COL_WIDTHS, shortName, doubleCovered, isDouble, TEAM_ROWS, DUTIES } from './layout.js';
import * as cloud from './cloud.js';
import { buildRosterPdf } from './pdfout.js';
import { buildRosterCanvas } from './pngout.js';
import { buildIcs } from './ics.js';
import { SYMBOLS, HOW, WHATS_NEW } from './help.js';
import { emptyRotations, postingOn, weekPosting, mondayOf, weeksOfYear, setWeeks, readRotationSheet, buildRotationWorkbook, POSTING_FILL } from './rotations.js';
import { makeDemo, demoNotes, demoAdmin } from './demo.js';
import { mergeSaved, migrateRooms as migrateRoomsIn } from './store.js';
import { MONTHLY, monthlyDef, LEAVE_TYPES, NIGHT_DUTIES, monthIssues, cleanCell, daysIn, weekday, monthName, addDays, readMonthlyPdf, readMonthlyXlsx, buildMonthlyWorkbook, dutiesOn, generalFromMonthly, leaveOn } from './monthly.js';

// ?demo: a made-up department, kept apart from real data in its own storage
const DEMO = new URLSearchParams(location.search).has('demo');
const KEY = DEMO ? 'ot-roster-demo' : 'ot-roster-v1';
const clone = o => JSON.parse(JSON.stringify(o));
// tomorrow, in local time: the roster is made the day before
const today = () => {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------- state ----------

function blankState() {
  return {
    settings: clone(DEFAULT_SETTINGS),
    staff: [],
    roomTemplate: clone(DEFAULT_ROOMS),
    day: { date: today(), rooms: [], staff: {} },
    roster: null,
    days: {},     // other dates: { '2026-10-12': { day, roster } }
    monthly: {},  // monthly rosters by month: { '2022-10': { junior: { rows }, leave: { entries } } }
    rotations: emptyRotations(), // junior postings by week { weeks: { monday: { id: code } } }; a day's change is day.staff[id].posting
    tab: 'staff',
    cloudBase: {},
    roomsVersion: 4,
  };
}

let state = blankState();
// storage trouble, shown as a bar: 'full' (a save failed) or { corrupt: key } (saved data couldn't be read)
let storeProblem = null;
try {
  const raw = localStorage.getItem(KEY);
  let saved = null;
  try { saved = JSON.parse(raw || 'null'); } catch {
    // damaged: keep a copy before the next save writes over it
    const key = `${KEY}-damaged-${Date.now()}`;
    try { localStorage.setItem(key, raw); storeProblem = { corrupt: key }; } catch { storeProblem = { corrupt: null, raw }; }
  }
  if (saved) state = mergeSaved(state, saved, DEFAULT_SETTINGS);
} catch { /* private mode: start fresh */ }
migrateRooms();
syncRooms();
state.rotations ||= emptyRotations();
// bumped when the demo data changes, so a demo already open in a browser picks it up
const DEMO_VERSION = 7;
if (DEMO && !state.staff.length) startDemo();
else if (DEMO && state.demoVersion !== DEMO_VERSION) { state = blankState(); syncRooms(); startDemo(); } // the made-up department changed: start it again

function startDemo() {
  const demo = makeDemo(state.day.date);
  state.staff = demo.staff;
  state.monthly = demo.monthly;
  state.rotations = demo.rotations;
  state.demoVersion = DEMO_VERSION;
  fillDemoNotes(state.day);
  state.tab = 'monthly';
}
// The staff list as it is on the day on screen: each junior's posting from the rotation (or that day's change).
function postingOf(p) { return postingOn(state.rotations, p, state.day.date, state.day.staff[p.id]?.posting); }
// What the rotation (or usual posting) says, without the day's change.
function plannedPosting(p) { return postingOn(state.rotations, p, state.day.date); }
function withPosting(p) { return p?.role === 'junior' ? { ...p, posting: postingOf(p) } : p; }
function dayStaff() { return state.staff.map(withPosting); }

// a new demo day starts with that day's made-up case notes, and two seniors on an admin day
function fillDemoNotes(day) {
  const notes = demoNotes(day.date);
  for (const r of day.rooms) if (notes[r.name]) { r.notes = notes[r.name]; r.running = true; r.flags = suggestFlags(r.notes, state.settings, r.name); }
  const wd = new Date(day.date + 'T12:00').getDay();
  if (wd === 0 || wd === 6) return;
  const onLeave = new Set(leaveOn(state.monthly, day.date).map(e => e.name));
  for (const id of demoAdmin(day.date, state.staff, onLeave)) day.staff[id] = { ...(day.staff[id] || {}), status: 'admin', manual: true };
}
const demoLink = () => location.origin + location.pathname + '?demo';

// Practice: harder mornings to try, also as links a trainer can send (?demo=short, ?demo=latemc, ?demo=weekend).
const SCENARIOS = [['short', 'Short-staffed (seniors away, double covers)'], ['latemc', 'Late MC at 7am (after the roster is out)'], ['weekend', 'A weekend']];
function applyScenario(kind) {
  if (kind === 'weekend') {
    const d = new Date(state.day.date + 'T12:00'); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    switchDate(isoDate(d));
    return toast('A weekend: only emergency lists and calls. Generate, then check who covers what.');
  }
  pushUndoAll(`the "${SCENARIOS.find(x => x[0] === kind)[1]}" practice`, { day: true });
  if (kind === 'short') {
    // enough away that the lists outnumber the seniors by three, so some rooms must be double covered
    const avail = state.staff.filter(p => p.role === 'senior' && (dayOf(p.id).status || 'avail') === 'avail');
    const rooms = state.day.rooms.filter(r => r.running && !isPacu(r.name)).length + 1; // + AOCC
    const n = Math.max(4, avail.length - rooms + 3);
    const away = avail.filter(p => !(p.subspecs || []).length).slice(0, n);
    for (const p of away) Object.assign(dayOf(p.id), { status: 'leave', manual: true });
    runGenerate(true);
    goTab('roster');
    return toast(`${away.length} more seniors are away: the roster double covers where it can (the & marks). Check the Problems card.`);
  }
  if (kind === 'latemc') {
    if (!state.roster || state.roster.date !== state.day.date) runGenerate(true);
    const on = role => state.staff.find(p => p.role === role && state.roster.rows.some(r => !isSpecialRow(r) && cellParts(r, role === 'senior' ? 'senior' : 'junior').some(x => personOfPart(x) === p)));
    const sick = [on('senior'), on('junior')].filter(Boolean);
    for (const p of sick) Object.assign(dayOf(p.id), { status: 'mc', manual: true });
    afterRosterEdit(true);
    goTab('roster');
    return toast(`${sick.map(p => shortName(p) || p.name).join(' and ')} just called in sick. Take them off and fill the gaps, then send the changes.`);
  }
}

// Practice: the day as Practice first made it.
function resetPracticeDay() {
  pushUndoAll('resetting the day', { day: true });
  state.day = { date: state.day.date, rooms: [], staff: {} };
  state.roster = null; state.practiceTask = null;
  syncRooms(); fillDemoNotes(state.day); syncMonthly();
  lastRows = null;
  render();
  undoToast('This day is back to how Practice made it.');
}
// Practice: make the roster, then plant three mistakes a rosterer meets most mornings; the card on the Roster
// tab ticks each one off when the live checks no longer find it.
function startPracticeTask() {
  if (!state.roster || state.roster.date !== state.day.date) runGenerate(true);
  const r = state.roster;
  if (!r) return;
  pushUndoAll('the practice task', { day: true });
  const rows = r.rows.filter(x => !isSpecialRow(x) && !isPacu(x.label) && x.senior && x.junior);
  const onLeave = state.staff.find(p => p.role === 'senior' && ['leave', 'mc'].includes(dayOf(p.id).status));
  const [a, b] = [rows[1], rows[4]];
  const items = [];
  if (a && onLeave) { a.senior = fmtSenior(onLeave, dayOf(onLeave.id)); items.push({ label: `Someone on leave is on a list`, match: `${onLeave.name} is on`, person: onLeave.id, fix: 'takeOff' }); }
  // a day already short of a senior has none to spare: a "no senior" gap there could never be filled, so plant a
  // second double cover instead (it only needs a junior)
  const short = r.rows.some(x => !isSpecialRow(x) && !isPacu(x.label) && !String(x.senior || '').trim());
  if (b && !short) { b.senior = ''; items.push({ label: `${b.label} has no senior`, match: `${b.label}: no senior` }); }
  // a double cover with no junior, inside one complex (as the generator would pair rooms)
  const used = new Set([a, ...(short ? [] : [b])]);
  const plantDouble = () => {
    const host = rows.find(x => !used.has(x) && rows.some(y => y !== x && !used.has(y) && y.complex === x.complex));
    const dbl = host && rows.find(y => y !== host && !used.has(y) && y.complex === host.complex);
    const s0 = host && cellParts(host, 'senior')[0];
    if (!dbl || !s0) return;
    used.add(host); used.add(dbl);
    dbl.senior = s0; dbl.junior = '';
    items.push({ label: `${dbl.label}: a double cover with no junior`, match: `${dbl.label}: no junior` });
  };
  plantDouble();
  if (short) plantDouble();
  state.practiceTask = { date: state.day.date, items };
  lastRows = JSON.stringify(r.rows);
  afterRosterEdit(true);
  goTab('roster');
  const n = ['No problems', 'One problem', 'Two problems', 'Three problems'][items.length];
  toast(`${n} ${items.length === 1 ? 'is' : 'are'} planted in this roster. Fix ${items.length === 1 ? 'it' : 'them'} from the Problems card (or by hand); the checklist ticks them off.`);
}
function practiceTaskCard() {
  const t = state.practiceTask;
  if (!DEMO || !t || t.date !== state.day.date || !state.roster) return null;
  const checks = state.roster.checks || [];
  // matched by person where there is one, so a name that starts another name can't keep an item open
  const done = t.items.map(i => !checks.some(w => i.person ? w.person === i.person && w.fix === i.fix : w.text.includes(i.match)));
  const all = done.every(Boolean);
  return h('section', { class: 'card practice-task' + (all ? ' done' : '') },
    h('h2', {}, all ? 'Well done: all fixed' : `Practice: fix ${t.items.length} problems (${done.filter(Boolean).length} of ${t.items.length})`),
    h('ul', { class: 'task-list' }, t.items.map((i, k) => h('li', { class: done[k] ? 'ok' : '' }, done[k] ? '✓ ' : '○ ', i.label))),
    all ? h('div', { class: 'bar' }, h('button', { class: 'small', onclick: startPracticeTask }, 'Another one'), h('button', { class: 'small', onclick: () => { state.practiceTask = null; render(); } }, 'Close'))
      : h('p', { class: 'hint' }, 'Try the fix buttons in the Problems card first: Take off, Fill empty gaps, Swap.'));
}
// Practice: a draft in the admin team's format, so "Do it all" can be tried as on a real morning.
async function downloadPracticeDraft() {
  const rows = state.day.rooms.filter(r => r.running && !isPacu(r.name)).map(r => ({ roomId: r.id, label: r.name, complex: r.complex, senior: '', junior: '', premed: '', notes: r.notes || '' }));
  const wb = buildRosterWorkbook(await excel(), { date: state.day.date, rows, lists: rosterLists(), general: effectiveGeneral(), box: '', colourOf, shortOf });
  // the admin team's draft has each room's cases in column L (the sent-out sheet doesn't)
  const notes = Object.fromEntries(rows.map(r => [r.label, r.notes]));
  wb.worksheets[0].eachRow(row => { const label = cellText(row.getCell(1).value).replace(/:\s*$/, '').trim(); if (notes[label]) row.getCell(12).value = notes[label]; });
  download(`Practice draft ${state.day.date}.xlsx`, new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  toast('Practice draft downloaded. Now press "Do it all" and pick it.');
}

// Room list changes since the first version: Remote Case -> Remote 1 + Remote 2, add KROR 1 and MCOR 9.
// Names imported before titles were stripped ("Dr Brandon Ong", "A/Prof ..."): clean them and
// remember they came from an import, so a contact list can correct their role.
function cleanStaffNames() {
  for (const p of state.staff) {
    // grades from before the department's own grade names
    // a registrar is a senior resident, on the junior list
    if (p.role === 'senior' && p.grade === 'Registrar') { p.role = 'junior'; p.grade = 'Senior resident'; }
    if (p.posting === 'Card') p.posting = 'Cardiac';
    const old = OLD_GRADES[p.role]?.[p.grade];
    if (old) { if (p.grade === 'Baby MO' && !p.colour) p.colour = 'green'; p.grade = old; }
    const clean = cleanContactName(p.name);
    if (clean !== p.name.trim() && /^\s*(dr|a\/prof|prof|adj)\b/i.test(p.name)) { p.name = clean; p.source ||= 'contact'; }
  }
}
cleanStaffNames();

function migrateRooms() { migrateRoomsIn(state); } // (a declaration, so it can run before this line)

let saveTimer, lastSaved = '', checkKey = '', clearedForGood = false, otherTab = false;
function save() {
  clearTimeout(saveTimer);
  if (clearedForGood) return; // signed out and cleared: write nothing back
  if (otherTab) return; // another tab saved since: this one would overwrite it
  if (storeProblem?.corrupt === null && !storeProblem.downloaded) return; // the damaged data is still only in storage
  saveTimer = setTimeout(() => {
    const was = storeProblem === 'full';
    try {
      const json = JSON.stringify(state);
      if (json === lastSaved && storeProblem !== 'full') return; // nothing changed since the last write
      localStorage.setItem(KEY, json);
      lastSaved = json;
      if (was) { storeProblem = null; renderStoreBar(); toast('Saving in this browser works again.'); }
    } catch {
      // usually the browser's storage is full: say so, rather than losing changes without a word
      if (!storeProblem || was) { storeProblem = 'full'; renderStoreBar(); }
    }
  }, 200);
}

let nextId = 1 + state.staff.reduce((m, p) => Math.max(m, parseInt(String(p.id).replace(/\D/g, ''), 10) || 0), 0);
const newId = () => 'p' + nextId++;

function syncRooms() {
  const byName = Object.fromEntries((state.day.rooms || []).map(r => [r.name, r]));
  state.day.rooms = state.roomTemplate.map((t, i) => byName[t.name]
    ? { ...byName[t.name], complex: t.complex }
    : { id: 'r' + i + '-' + t.name.replace(/\W+/g, ''), name: t.name, complex: t.complex, running: !!t.defaultOn, session: 'full', notes: '', flags: { subspecs: [], complex: false, long: false }, flagsManual: false, lockSenior: '', lockJunior: '' });
}

const dayOf = id => (state.day.staff[id] ||= {});
const person = id => state.staff.find(p => p.id === id);

// ---------- tiny DOM helper ----------

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

// A short message at the bottom. With an action (e.g. Undo) it stays longer and has a button.
function toast(msg, action) {
  const t = document.getElementById('toast');
  // a live region only speaks when its text changes: empty it first, so the same message is read out again
  t.replaceChildren();
  void t.offsetWidth;
  t.replaceChildren(msg, ...(action ? [' ', h('button', { class: 'small', title: action.title || null, onclick: () => { t.classList.remove('show'); action.run(); } }, action.label)] : []));
  t.classList.toggle('actionable', !!action);
  t.classList.add('show');
  clearTimeout(toast.t);
  const ms = action ? 8000 : 3500;
  toast.t = setTimeout(() => t.classList.remove('show'), ms);
  // keep it while someone is reading or reaching for its button
  t.onmouseenter = t.onfocusin = () => clearTimeout(toast.t);
  t.onmouseleave = t.onfocusout = () => { clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2500); };
}
const undoToast = msg => toast(msg, { label: 'Undo', run: undo, title: 'Undo (Ctrl+Z)' });

const select = (value, options, onchange) => { let found = false; return h('select', { onchange: e => onchange(e.target.value) },
  options.map(o => {
    const [v, label] = Array.isArray(o) ? o : [o, o || '—'];
    const on = !found && v === value; if (on) found = true; // only the first ("Choose…", not a separator line)
    return h('option', { value: v, selected: on }, label);
  })); };

const fileButton = (label, accept, multiple, onfiles) => h('label', { class: 'btn' }, label,
  h('input', { type: 'file', accept, multiple, hidden: true, onchange: async e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) await onfiles(f); } }));

// Vendor scripts (ExcelJS, jsPDF, pdf.js) load the first time they're needed, so opening the app (and My day on
// a phone) doesn't wait for them. Each loads once.
const vendorLoads = {};
function loadVendor(src) {
  return vendorLoads[src] ||= new Promise((ok, fail) => {
    const el = document.createElement('script');
    el.src = src; el.onload = ok;
    el.onerror = () => { delete vendorLoads[src]; fail(new Error(`Couldn't load ${src}`)); };
    document.head.append(el);
  });
}
const excel = async () => { await loadVendor('/lib/exceljs.min.js'); return window.ExcelJS; };

async function readWorkbook(file) {
  const wb = new (await excel()).Workbook();
  const buf = await file.arrayBuffer();
  if (/\.csv$/i.test(file.name)) {
    const ws = wb.addWorksheet('csv');
    const text = new TextDecoder().decode(buf);
    for (const line of text.split(/\r?\n/)) if (line.trim()) ws.addRow(parseCsvLine(line));
    return wb;
  }
  await wb.xlsx.load(buf);
  return wb;
}

function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

function download(name, blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- render ----------

const app = document.getElementById('app');
// banners (Practice, update, moved, backup, storage) sit under the app bar, above the screen
const barHost = () => document.getElementById('bars') || document.body;
// Fields in table cells have no visible label of their own: name each from its column heading and row,
// so a screen reader says "Session, MOR 4" rather than "combo box".
function labelTableFields(root) {
  for (const f of root.querySelectorAll('td input:not([aria-label]):not([type=hidden]), td select:not([aria-label]), td textarea:not([aria-label])')) {
    if (f.labels?.length) continue;
    const td = f.closest('td'), tr = td.parentElement, table = td.closest('table');
    const col = [...tr.children].indexOf(td);
    const head = table.querySelector('thead tr')?.children[col]?.textContent.trim();
    const rowName = [...tr.children].find(c => c !== td && c.textContent.trim())?.textContent.trim()
      || tr.querySelector('input')?.value || '';
    const label = [head, rowName].filter(Boolean).join(', ') || f.placeholder || '';
    if (label) f.setAttribute('aria-label', label.slice(0, 80));
  }
  // a <label> written just before its field (not wrapping it): tie the two together
  for (const l of root.querySelectorAll('label:not([for])')) {
    const f = l.nextElementSibling;
    if (f && /^(INPUT|SELECT|TEXTAREA)$/.test(f.tagName) && !f.labels?.length && !f.getAttribute('aria-label') && !l.contains(f)) f.setAttribute('aria-label', l.textContent.trim().slice(0, 80));
  }
}
const SCREEN_TITLES = { monthly: 'Monthly', cases: 'Cases', roster: 'Roster', premed: 'Premeds', staff: 'Staff', settings: 'Settings', myday: 'My day' };
function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  const y = window.scrollY;
  if (state.tab === 'day') state.tab = 'cases';
  colourCache.clear();
  if (state.tab === 'seniors' || state.tab === 'juniors') { state.staffRole = state.tab === 'juniors' ? 'junior' : 'senior'; state.tab = 'staff'; }
  if (state.tab === 'general' || state.tab === 'manpower') { state.monthlyView = state.tab === 'manpower' ? 'today' : state.monthlyView; state.tab = 'monthly'; }
  if (isViewer()) state.tab = 'myday';
  if (!['monthly', 'roster', 'premed', 'cases', 'staff', 'settings', 'myday'].includes(state.tab)) state.tab = 'staff';
  personCache.clear();
  syncMonthly();
  if (hashPending?.date === state.day.date) { markSaved(hashPending.date, hashPending.at); hashPending = null; }
  // checks follow every change, wherever it was made (a status on Today, a fix here)
  if (state.roster?.rows && state.roster.date === state.day.date) {
    const key = JSON.stringify([state.roster.rows, state.day, state.staff, state.settings, state.rotations]);
    if (key !== checkKey || !state.roster.checks) { checkKey = key; state.roster.checks = check({ rows: state.roster.rows, staff: dayStaff(), day: state.day, settings: state.settings }); }
  }
  const title = document.getElementById('screen-title'); // the large title on phones
  if (title) { title.textContent = SCREEN_TITLES[state.tab] || ''; title.hidden = !title.textContent; }
  app.replaceChildren(({ monthly: renderMonthly, roster: renderRoster, premed: renderPremed, cases: () => renderDay('cases'), staff: renderStaffTab, settings: renderSettings, myday: renderMyDay })[state.tab]());
  renderCloudBar();
  renderDateBar();
  renderSteps();
  renderSwapBar();
  renderDemoBar();
  renderMovedBar();
  if (storeProblem && !document.getElementById('store-bar')) renderStoreBar();
  if (cs.ready && (!document.getElementById('backup-bar') || isMember() || isViewer())) renderBackupBar();
  window.scrollTo(0, y);
  if (state.tab === 'monthly' && state.monthlyView === 'rotations') placeRotGrid();
  labelTableFields(app);
  save();
}
// Each date keeps its own manpower, calls, cases and roster. Switching the header date puts
// the current day away and brings up the other one (empty if it's new).
function switchDate(date) {
  if (!date || date === state.day.date) return;
  (state.days ||= {})[state.day.date] = { day: state.day, roster: state.roster && { ...state.roster, checks: undefined } };
  const rec = state.days[date];
  delete state.days[date];
  state.day = rec?.day || { date, rooms: [], staff: {} };
  state.day.date = date;
  state.roster = rec?.roster || null;
  syncRooms();
  if (isViewer()) viewerLoad(date);
  if (DEMO && !state.monthly?.[date.slice(0, 7)]?.junior) for (const [m, v] of Object.entries(makeDemo(date).monthly)) (state.monthly ||= {})[m] ||= v; // months further out
  if (DEMO && !rec) fillDemoNotes(state.day);
  applyCarry(state.day);
  clearUndo(); editing = null;
  lastRows = state.roster ? JSON.stringify(state.roster.rows) : null;
  render();
}

// The demo banner: what this is, and the way back out.
// The old address (anawj.com/nuh-roster/) with a roster saved in this browser: say where the app is now and
// offer this browser's data as a file first (Import JSON at the new address loads it).
function renderMovedBar() {
  const to = window.ROSTER_MOVED_TO;
  if (!to || document.getElementById('moved-bar')) return;
  const go = () => { try { localStorage.setItem('nuh-roster-moved', '1'); } catch { /* no storage */ } location.replace(to); };
  barHost().prepend(h('div', { id: 'moved-bar', class: 'demo-bar moved-bar' },
    h('b', {}, 'The roster has moved'), h('span', {}, ' to nuhroster.anawj.com. What this browser saved here stays at this old address: download it, then use Import JSON at the bottom of the new page.'),
    h('span', { class: 'grow' }),
    h('button', { class: 'small primary', onclick: downloadEverything }, 'Download everything'),
    h('button', { class: 'small', onclick: go }, 'Go to the new address')));
}
// The same roster open in two tabs: each would quietly write over the other. When another tab saves, this one stops
// saving and says so, with Reload to pick up the other tab's work.
addEventListener('storage', e => {
  if (e.key !== KEY || clearedForGood || otherTab) return;
  otherTab = true; clearTimeout(saveTimer);
  document.getElementById('tab-bar')?.remove();
  barHost().prepend(h('div', { id: 'tab-bar', class: 'demo-bar moved-bar', role: 'alert' },
    h('b', {}, 'The roster was changed in another tab.'), h('span', {}, ' This tab has stopped saving so it doesn\'t undo that. Reload to carry on here with the latest, or close this tab.'),
    h('span', { class: 'grow' }), h('button', { class: 'small primary', onclick: () => location.reload() }, 'Reload')));
});
// Not signed in to the team: the roster lives only in this browser. Once a week, suggest a backup file.
const BACKUP_KEY = 'nuh-roster-backup-nag';
function renderBackupBar() {
  document.getElementById('backup-bar')?.remove();
  if (clearedForGood || DEMO || isViewer() || isMember() || !state.staff.length) return;
  let snooze = 0;
  try { snooze = +localStorage.getItem(BACKUP_KEY) || 0; } catch { /* no storage */ }
  const last = Math.max(state.backupAt || 0, snooze);
  if (!last) { try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch { /* no storage */ } return; } // first week: quiet
  if (Date.now() - last < 7 * 864e5) return;
  const later = () => { try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch { /* no storage */ } renderBackupBar(); };
  barHost().prepend(h('div', { id: 'backup-bar', class: 'demo-bar' },
    h('b', {}, 'A backup?'), h('span', {}, ' The roster is kept only in this browser. Download everything once a week, or sign in to save it for the team.'),
    h('span', { class: 'grow' }),
    h('button', { class: 'small primary', onclick: () => { downloadEverything(); renderBackupBar(); } }, 'Download everything'),
    h('button', { class: 'small', onclick: later }, 'Later')));
}
// A bar when this browser can't keep the roster: storage full, or saved data that couldn't be read.
function renderStoreBar() {
  document.getElementById('store-bar')?.remove();
  if (!storeProblem) return;
  const bar = h('div', { id: 'store-bar', class: 'demo-bar moved-bar', role: 'alert' });
  if (storeProblem === 'full') {
    const old = oldDays(90);
    bar.append(h('b', {}, 'Changes are not being kept in this browser.'),
      h('span', {}, ' Its storage is probably full. Download everything to keep a copy' + (old.length ? `, then remove days more than 3 months old (${old.length}).` : '.')),
      h('span', { class: 'grow' }),
      h('button', { class: 'small primary', onclick: downloadEverything }, 'Download everything'),
      ...(old.length ? [h('button', { class: 'small', onclick: () => removeOldDays(old) }, 'Remove old days')] : []));
  } else {
    const { corrupt, raw } = storeProblem;
    const copy = () => { download(`NUH roster, damaged saved data ${realToday()}.txt`, new Blob([corrupt ? localStorage.getItem(corrupt) || '' : raw || ''], { type: 'text/plain' })); storeProblem.downloaded = true; save(); };
    bar.append(h('b', {}, 'The roster saved in this browser couldn\'t be read, so the app started empty.'),
      h('span', {}, corrupt ? ' A copy of it is kept in this browser.' : ' It couldn\'t be copied, so download it now, before you change anything.'),
      h('span', { class: 'grow' }),
      h('button', { class: 'small primary', onclick: copy }, 'Download the damaged data'),
      h('button', { class: 'small', onclick: () => { storeProblem = null; renderStoreBar(); save(); } }, 'Hide'));
  }
  barHost().prepend(bar);
}
// Stored dates more than n days before today (the open date is never in state.days).
function oldDays(n) {
  const cut = addDays(realToday(), -n);
  return Object.keys(state.days || {}).filter(d => d < cut).sort();
}
function removeOldDays(dates) {
  if (!confirm(`Remove ${dates.length} days from ${dates[0]} to ${dates[dates.length - 1]} from this browser? Download everything first if you want to keep them (days saved for the team stay in the cloud).`)) return;
  for (const d of dates) delete state.days[d];
  save();
  renderStoreBar();
}
// Everything this browser holds for the roster (staff, settings, every day's roster, monthly rosters, rotations).
function downloadEverything() {
  state.backupAt = Date.now(); save();
  const data = { kind: 'ot-roster-all', version: 1, savedAt: new Date().toISOString(), state };
  download(`NUH roster, everything in this browser ${realToday()}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
}

// Practice mode is the demo: a made-up department in its own storage, opened next to the real
// roster (a new tab), so people can try things without touching real data.
function renderDemoBar() {
  if (!DEMO) {
    const team = document.querySelector('.top .team');
    if (team && !document.getElementById('practice-link')) team.prepend(h('a', { id: 'practice-link', class: 'btn small', href: demoLink(), target: '_blank', rel: 'noopener', title: 'Try the app on made-up data in a new tab. Your real roster isn\'t touched.' }, 'Practice'));
    return;
  }
  if (document.getElementById('demo-bar')) return;
  barHost().prepend(h('div', { id: 'demo-bar', class: 'demo-bar' },
    h('b', {}, 'Practice'), h('span', { class: 'demo-text' }, ' · made-up staff and rosters, saved only in this browser. Try anything: nothing here touches the real roster.'),
    h('span', { class: 'grow' }),
    // on a phone the tools fold away, so the bar doesn't take a third of the screen
    h('details', { class: 'demo-tools', open: innerWidth > 600 }, h('summary', {}, 'Practice tools'), h('span', { class: 'demo-actions' },
    h('button', { class: 'small', onclick: () => startTour() }, 'Tour'),
    h('button', { class: 'small', title: 'A roster with three problems planted in it, to find and fix', onclick: startPracticeTask }, 'Fix 3 problems'),
    (() => { const sel = select('', [['', 'Try a morning…'], ...SCENARIOS.map(([k, label]) => [k, label])], v => { if (v) { applyScenario(v); sel.value = ''; } }); sel.setAttribute('aria-label', 'Practice a harder morning'); return sel; })(),
    h('button', { class: 'small', title: 'This day back to how Practice made it (Undo brings your version back)', onclick: resetPracticeDay }, 'Reset this day'),
    h('button', { class: 'small', onclick: () => { if (confirm('Start practice again from scratch?')) { try { localStorage.removeItem(KEY); localStorage.removeItem(TOUR_KEY); } catch { /* no storage */ } location.reload(); } } }, 'Start again'),
    )),
    h('a', { class: 'btn small', href: location.pathname }, 'Back to the real roster')));
}

// ---- a short guided tour: a ring around each part of the screen and a note beside it ----
const TOUR_KEY = 'nuh-roster-tour';
const TOUR = [
  { sel: '#date', title: 'The day you\'re rostering', text: 'Everything follows this date. ‹ › step a day ([ and ] on a keyboard), and it warns you when it isn\'t tomorrow.' },
  { tab: 'monthly', sel: '#steps', title: 'Your morning, in five steps', text: 'Monthly rosters, cases, roster, check, then save or download. Each step turns green when it\'s done; tap one to go there.' },
  { tab: 'monthly', sel: '.board', title: 'Who\'s working', text: 'Leave, MC and post call come from the monthly rosters. Tap a name to change their day; "Select several" moves many at once.' },
  { tab: 'cases', sel: '#app label.btn.primary', title: 'Start from the admin draft', text: '"Do it all" reads the admin team\'s draft, makes the roster and shows what needs a look. In Practice, "Download a practice draft" gives you one to try.' },
  { tab: 'roster', sel: '#problems', title: 'What needs a look', text: 'Problems are listed here with a button that fixes each one, and Show to find the room.' },
  { tab: 'roster', sel: 'table.sheet', title: 'The roster', text: 'Tap a name for its box: leaving time, (L), comments, Move or swap. On a computer you can drag names; + suggests the best fits first.' },
  { tab: 'roster', sel: '.split', title: 'Send it out', text: 'Download the sheet as Excel or PDF, or save it for the team. Undo (Ctrl+Z) takes back anything.' },
  { sel: '#keyBtn', title: 'Stuck?', text: 'Key and help explains every mark (&, C, (L), the colours) and answers "How do I…?". It also has a one-page guide to print for the OT computer.' },
];
let tourStep = -1;
function startTour() {
  // the tour points at a roster; an empty real app has none, so offer Practice (which has one) instead
  if (!DEMO && (!state.staff.length || !state.roster)) {
    toast('The tour shows a made-up roster in Practice, so it doesn\'t touch yours.', { label: 'Open Practice', run: () => window.open(demoLink(), '_blank', 'noopener') });
    return;
  }
  tourStep = 0; showTourStep();
}
function endTour() {
  tourStep = -1;
  document.getElementById('tour')?.remove();
  try { localStorage.setItem(TOUR_KEY, 'done'); } catch { /* no storage */ }
}
async function showTourStep() {
  const step = TOUR[tourStep];
  if (!step) return endTour();
  if (step.tab && state.tab !== step.tab) { await goTab(step.tab); }
  if (step.tab === 'roster' && !state.roster && DEMO && canGenerate()) runGenerate(false); // practice: make one to look at
  rosterView = 'edit';
  const el = document.querySelector(step.sel);
  if (!el) { tourStep++; return showTourStep(); }
  // a tall part (the board on a phone) shows from its top; the note sits below it or at the bottom
  const tall = el.getBoundingClientRect().height > innerHeight * 0.5;
  el.scrollIntoView({ block: tall ? 'start' : 'center' });
  await new Promise(r => setTimeout(r, 120));
  const r = el.getBoundingClientRect();
  const top = Math.max(r.top, 4), bottom = Math.min(r.bottom, innerHeight - 4);
  document.getElementById('tour')?.remove();
  const ring = h('div', { class: 'tour-ring', style: `left:${Math.max(r.left - 6, 2)}px; top:${top - 6}px; width:${Math.min(r.width + 12, innerWidth - 4)}px; height:${bottom - top + 12}px` });
  const below = !tall && bottom + 230 < innerHeight;
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-label': step.title, style: below ? `top:${bottom + 14}px` : tall || top < 240 ? 'bottom:16px' : `bottom:${innerHeight - top + 14}px` },
    h('div', { class: 'seen' }, `${tourStep + 1} of ${TOUR.length}`),
    h('h3', {}, step.title), h('p', {}, step.text),
    h('div', { class: 'bar' },
      h('button', { class: 'small', onclick: endTour }, 'Skip'),
      h('span', { class: 'grow' }),
      tourStep ? h('button', { class: 'small', onclick: () => { tourStep--; showTourStep(); } }, 'Back') : null,
      h('button', { class: 'small primary', onclick: () => { tourStep++; showTourStep(); } }, tourStep === TOUR.length - 1 ? 'Done' : 'Next')));
  document.body.append(h('div', { id: 'tour' }, ring, card));
}
addEventListener('resize', () => { if (tourStep >= 0) showTourStep(); });
addEventListener('keydown', e => { if (tourStep >= 0 && e.key === 'Escape') endTour(); });

// One date for the whole workspace, in the header: the date in words (the picker shows
// mm/dd on some phones), steps a day either way, and whether this day is saved.
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const realToday = () => isoDate(new Date());
const longDate = iso => iso ? new Date(iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
function renderDateBar() {
  const el = document.getElementById('date');
  if (!el) return;
  if (!el.querySelector('.date-pick')) {
    const step = n => () => switchDate(addDays(state.day.date || realToday(), n));
    el.append(
      h('div', { class: 'date-row' },
        h('button', { class: 'small', title: 'Previous day', 'aria-label': 'Previous day', onclick: step(-1) }, '‹'),
        h('label', { class: 'date-pick' }, h('span', { class: 'date-words' }), h('input', { type: 'date', 'aria-label': 'Roster date', onchange: e => { if (e.target.value) switchDate(e.target.value); } })),
        h('button', { class: 'small', title: 'Next day', 'aria-label': 'Next day', onclick: step(1) }, '›'),
        h('button', { class: 'small', 'data-go': 'today', onclick: () => switchDate(realToday()) }, 'Today'),
        h('button', { class: 'small', 'data-go': 'tomorrow', onclick: () => switchDate(today()) }, 'Tomorrow')),
      h('div', { class: 'date-notes' }, h('span', { class: 'date-warn' }), h('span', { class: 'save-state' })));
  }
  const date = state.day.date || '';
  const input = el.querySelector('input');
  if (input.value !== date) input.value = date;
  el.querySelector('.date-words').textContent = longDate(date) || 'Pick a date';
  el.querySelectorAll('[data-go]').forEach(b => b.setAttribute('aria-pressed', String(date === (b.dataset.go === 'today' ? realToday() : today()))));
  const warn = el.querySelector('.date-warn');
  warn.textContent = date && date !== today() ? `Not tomorrow: you're on ${date === realToday() ? 'today' : longDate(date)}.` : '';
  warn.hidden = !warn.textContent;
  el.querySelector('.save-state').replaceChildren(...saveState());
}

// The day's work in order, under the tabs: each step says whether it's done and goes there.
function renderSteps() {
  const el = document.getElementById('steps');
  if (!el) return;
  if (!['monthly', 'cases', 'roster', 'premed'].includes(state.tab) || !state.staff.length) {
    el.hidden = true;
    const nb = document.getElementById('nextbar'); if (nb) nb.hidden = true;
    document.body.classList.remove('has-nextbar');
    return;
  }
  el.hidden = false;
  const date = state.day.date, month = date?.slice(0, 7);
  const mon = state.monthly?.[month] || {};
  const kinds = MONTHLY.filter(d => d.list ? mon[d.id]?.entries?.length : Object.keys(mon[d.id]?.rows || {}).length);
  const cases = state.day.rooms.filter(r => r.running && r.notes).length;
  const r = state.roster && state.roster.date === date ? state.roster : null;
  const probs = r ? problemsOf(r) : [];
  const errors = probs.filter(w => w.level === 'error').length;
  const saved = state.cloudHash?.[date]?.hash === dayHash(), out = state.outHash?.[date] === dayHash();
  const steps = [
    ['monthly', 'Monthly rosters', kinds.length ? 'ok' : 'todo', kinds.length ? `${kinds.length} of ${MONTHLY.length} loaded` : `none for ${monthName(month)}`],
    ['cases', 'Cases', cases ? 'ok' : 'todo', cases ? `${cases} rooms with cases` : 'load the admin draft'],
    ['roster', 'Roster', r ? 'ok' : 'todo', r ? 'made' : 'not made yet'],
    ['check', 'Check', !r ? 'off' : errors ? 'bad' : 'ok', !r ? '—' : errors ? `${errors} problem${errors > 1 ? 's' : ''}` : probs.length ? `${probs.length} to look at` : 'no problems'],
    ['send', 'Save or download', !r ? 'off' : saved || out ? 'ok' : 'todo', !r ? '—' : saved ? 'saved to the team' : out ? 'downloaded' : 'not yet'],
  ];
  const go = k => {
    if (k === 'check') { rosterView = 'edit'; goTab('roster').then(() => document.getElementById('problems')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); return; }
    goTab(k === 'send' ? 'roster' : k);
  };
  const mark = { ok: '✓', bad: '!', todo: '', off: '' };
  el.replaceChildren(...steps.map(([k, label, st, note], i) => h('button', { class: `step ${st}` + (state.tab === k ? ' here' : ''), onclick: () => go(k) },
    h('span', { class: 'dot' }, mark[st] || String(i + 1)), h('span', { class: 'what' }, h('b', {}, label), h('small', {}, note)))));
  // phones: the next step to do, in reach of a thumb at the bottom of the screen (CSS shows it only on phones)
  let bar = document.getElementById('nextbar');
  if (!bar) { bar = h('nav', { id: 'nextbar', 'aria-label': 'Next step' }); document.body.append(bar); }
  const next = steps.find(([, , st]) => st === 'bad' || st === 'todo');
  bar.hidden = !next;
  document.body.classList.toggle('has-nextbar', !!next);
  if (next) {
    const [k, label, st, note] = next, i = steps.indexOf(next);
    // on the Roster tab with no roster, the button makes it; otherwise it goes to the step
    const make = k === 'roster' && state.tab === 'roster';
    bar.replaceChildren(h('span', { class: 'what' }, h('small', {}, `Step ${i + 1} of ${steps.length}`), h('b', {}, `${label}: ${note}`)),
      h('button', { class: 'primary' + (st === 'bad' ? ' bad' : ''), onclick: () => make ? runGenerate(false) : go(k) }, make ? 'Make it' : st === 'bad' ? 'Show' : 'Go'));
  }
}

// Whether the day on screen is saved where the team can see it.
const hashOf = o => { let x = 5381; const t = JSON.stringify(o); for (let i = 0; i < t.length; i++) x = (x * 33 ^ t.charCodeAt(i)) >>> 0; return x.toString(36); };
const dayHash = (day = state.day, roster = state.roster) => hashOf({ day, roster: roster && { ...roster, checks: undefined } });
let hashPending = null; // a date whose saved copy was just opened; its hash is taken after the next sync
function saveState() {
  const date = state.day.date;
  if (DEMO || !cloud.enabled || !isMember()) return [h('span', { class: 'seen' }, 'Saved in this browser only')];
  const saved = state.cloudHash?.[date];
  if (!saved) return [h('span', { class: 'unsaved' }, state.roster ? 'Not saved to the team yet' : '')];
  if (saved.hash === dayHash()) return [h('span', { class: 'saved' }, `✓ Saved to the team ${when(saved.at)}`)];
  return [h('span', { class: 'unsaved' }, 'Changes not saved to the team'), ' ', h('button', { class: 'small', onclick: saveRosterToCloud }, 'Save')];
}
function markSaved(date, at, hash = dayHash()) { (state.cloudHash ||= {})[date] = { hash, at }; }

document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', async () => {
  const t = b.dataset.tab;
  if (staffEditing() && t !== 'staff' && !(await finishStaffEdit())) return;
  state.tab = t; window.scrollTo(0, 0); render();
}));

// ----- staff tab -----

let staffFilter = '';
let tickMin = 1;
let staffBackup = null; // copy of the staff list taken when editing starts; null when not editing
const staffEditing = () => staffBackup !== null;
const who = () => (typeof rostererName === 'string' && rostererName.trim()) || cs?.user?.displayName || cs?.user?.email || 'this browser';

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
function confirmChanges(title, lines, buttons) {
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

function startStaffEdit() { staffBackup = clone(state.staff); render(); }

// Ask to keep or discard edits. Resolves true when editing has ended.
async function finishStaffEdit() {
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
function renderStaffTab() {
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
  nextId = 1 + staff.reduce((m, p) => Math.max(m, parseInt(String(p.id).replace(/\D/g, ''), 10) || 0), 0);
  const newRooms = rooms.filter(r => !state.roomTemplate.some(t => t.name === r.name));
  if (newRooms.length) { state.roomTemplate.push(...newRooms.map(r => ({ ...r, defaultOn: true }))); syncRooms(); }
  toast(`Read ${files.length} roster(s): ${staff.length - before} new people${newRooms.length ? `, ${newRooms.length} new rooms` : ''}. Check roles, grades and subspecs.`);
  render();
}

// ----- day tab -----

const pasteText = { leave: '', postcall: '', elsewhere: '', admin: '', notAround: '' };
let unmatched = [];
let lastDraft = null, lastRotFile = null; // to read again after names are fixed

// Names an import couldn't match: pick who each one is (closest names first). The spelling is kept as that person's
// short name, so the next import matches it, then rerun() reads the file again. role: 'senior' | 'junior' | null.
let fixPick = {};
function fixNamesCard(names, { role = null, rerun, dismiss, what = 'the file' }) {
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
let settingsEditing = false; // "roomId:lockSenior" while picking a fixed person on the Cases tab

// The usual morning in one go: the admin draft, then the roster, then what needs a look.
async function doItAll(files) {
  await loadDraft(files);
  if (!canGenerate()) return;
  runGenerate(true);
  rosterView = 'edit';
  state.tab = 'roster'; window.scrollTo(0, 0); render();
  const n = problemsOf(state.roster).length;
  setTimeout(() => document.getElementById('problems')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  toast(n ? `Roster made from the draft: ${n} thing${n > 1 ? 's' : ''} to look at.` : 'Roster made from the draft: no problems found.');
}
// A box saying what to do next, with a button that goes there.
const goTab = async t => { if (staffEditing() && t !== 'staff' && !(await finishStaffEdit())) return; state.tab = t; window.scrollTo(0, 0); render(); };
const nextStep = (text, label, tab) => h('div', { class: 'next-step' }, h('span', {}, text), h('button', { class: 'primary', onclick: () => goTab(tab) }, label + ' →'));
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

function renderDay(part) {
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
function rosterLists() {
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
function noListPeople() {
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

// ----- roster tab -----

// ---- names in roster cells: drag to swap or move, double-click to type ----

const PREMED = /\s*-\s*premed\s*$/i;
function cellParts(row, key) {
  return String(row[key] || '').split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean)
    .map(s => key === 'premed' ? s.replace(PREMED, '') : s);
}
function setCellParts(row, key, parts) {
  row[key] = parts.map(p => key === 'premed' ? `${p} - Premed` : p).join(' / ');
}

let undoStack = []; // roster rows as JSON, or { roster, day?, what } (JSON) for a whole-roster or whole-day change
let redoStack = []; // what Undo took back, in the same form; any new change clears it
function pushUndo(e) {
  undoStack.push(e);
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
}
const clearUndo = () => { undoStack = []; redoStack = []; };
// Before replacing the whole roster (Generate new): keep the roster. With day, also the day's
// details (restoring a saved version, the person box), and even when there's no roster yet.
function pushUndoAll(what, { day = false } = {}) {
  const rosterNow = state.roster && state.roster.date === state.day.date ? state.roster : null;
  if (!rosterNow && !day) return;
  pushUndo({ roster: JSON.stringify(rosterNow), ...(day ? { day: JSON.stringify(state.day) } : {}), what });
}
// The state an entry would replace, in the entry's own form, so the step can be reversed.
const inverseOf = e => typeof e === 'string' ? JSON.stringify(state.roster?.rows || [])
  : e.rot ? { rot: JSON.stringify(state.rotations), what: e.what }
  : e.mon ? { mon: JSON.stringify(state.monthly || {}), what: e.what }
  : { roster: JSON.stringify(state.roster), ...(e.day ? { day: JSON.stringify(state.day) } : {}), what: e.what };
function applyStep(e, verb) {
  if (typeof e === 'string') { if (state.roster) { state.roster.rows = JSON.parse(e); afterRosterEdit(true); } return; }
  if (e.rot) { state.rotations = JSON.parse(e.rot); render(); toast(`${verb === 'Undo' ? 'Undid' : 'Redid'} ${e.what}.`); return; }
  if (e.mon) { state.monthly = JSON.parse(e.mon); personCache.clear(); syncMonthly(); render(); toast(`${verb === 'Undo' ? 'Undid' : 'Redid'} ${e.what}.`); return; }
  if (e.day) state.day = JSON.parse(e.day);
  state.roster = JSON.parse(e.roster);
  lastRows = state.roster ? JSON.stringify(state.roster.rows) : null;
  if (state.roster) logRoster([`${verb}: ${e.what}`]);
  syncRooms();
  render();
  toast(`${verb === 'Undo' ? 'Undid' : 'Redid'} ${e.what}.`);
}
function undo() {
  const e = undoStack.pop();
  if (!e) return;
  redoStack.push(inverseOf(e));
  applyStep(e, 'Undo');
}
function redo() {
  const e = redoStack.pop();
  if (!e) return;
  undoStack.push(inverseOf(e));
  applyStep(e, 'Redo');
}
// Keyboard shortcuts (Cmd instead of Ctrl on a Mac), when not typing in a box. ? lists them.
const SHORTCUTS = [['Ctrl+Z', 'Undo'], ['Ctrl+Y or Ctrl+Shift+Z', 'Redo'], ['Ctrl+S', 'Save the roster for the team (or download it)'],
  ['Alt+1 … Alt+4', 'Monthly, Cases, Roster, Premeds'], ['[ and ]', 'Previous and next day'], ['/', 'Filter names'], ['Esc', 'Close a box, or cancel Move or swap'], ['?', 'This list']];
const WHATS_NEW_KEY = 'nuh-roster-whats-new';
// a bottom sheet on phones, a centred card on wide screens (the app kit's aSheet: drag down or tap outside to close)
const openSheet = dlg => (window.aSheet ? window.aSheet.open(dlg) : dlg.showModal());
function showWhatsNew() {
  const dlg = h('dialog', { class: 'a-sheet changes key' }, h('h2', {}, 'What\'s new'),
    WHATS_NEW.map(([when, items]) => [h('h3', {}, when), h('ul', {}, items.map(t => h('li', {}, t)))]),
    h('div', { class: 'bar' }, h('button', { class: 'primary', onclick: () => dlg.close() }, 'Close'), h('button', { onclick: () => { dlg.close(); showKey(); } }, 'Key and help')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); openSheet(dlg);
  try { localStorage.setItem(WHATS_NEW_KEY, WHATS_NEW[0][0]); } catch { /* no storage */ }
}
// once per device, for people who have used it before (not on a first visit, Practice or for the tour)
function maybeWhatsNew() {
  let seen = null;
  try { seen = localStorage.getItem(WHATS_NEW_KEY); } catch { return; }
  if (seen === WHATS_NEW[0][0]) return;
  if (DEMO || !state.staff.length) { try { localStorage.setItem(WHATS_NEW_KEY, WHATS_NEW[0][0]); } catch { /* no storage */ } return; }
  if (document.getElementById('toast')?.classList.contains('show') || document.querySelector('dialog[open]')) { setTimeout(maybeWhatsNew, 5000); return; } // after the message on screen
  toast('The roster has been updated.', { label: 'What\'s new', run: showWhatsNew });
  try { localStorage.setItem(WHATS_NEW_KEY, WHATS_NEW[0][0]); } catch { /* no storage */ }
}
function showKey() {
  const dlg = h('dialog', { class: 'a-sheet changes key' }, h('h2', {}, 'Key and help'),
    h('table', { class: 'key-table' }, h('tbody', {}, SYMBOLS.map(([k, what]) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', {}, what))))),
    h('h3', {}, 'How do I…'),
    h('div', { class: 'how' }, HOW.map(([q, a]) => h('details', { ontoggle: e => { if (e.target.open) dlg.querySelectorAll('.how details[open]').forEach(d => { if (d !== e.target) d.open = false; }); } },
      h('summary', {}, '…' + q), h('p', {}, a)))),
    h('div', { class: 'bar' }, h('button', { class: 'primary', onclick: () => { dlg.close(); dlg.remove(); } }, 'Close'),
      h('a', { class: 'btn', href: 'guide.html', target: '_blank', rel: 'noopener' }, 'One-page guide to print'),
      h('button', { onclick: () => { dlg.close(); showWhatsNew(); } }, 'What\'s new')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); openSheet(dlg);
}
function showShortcuts() {
  const dlg = h('dialog', { class: 'a-sheet changes' }, h('h2', {}, 'Keyboard shortcuts'),
    h('table', {}, h('tbody', {}, SHORTCUTS.map(([k, what]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, what))))),
    h('div', { class: 'bar' }, h('button', { class: 'primary', onclick: () => { dlg.close(); dlg.remove(); } }, 'Close')));
  dlg.addEventListener('close', () => dlg.remove()); // Esc too
  document.body.append(dlg); openSheet(dlg);
}
document.addEventListener('keydown', e => {
  if (e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey) {
    if (k === 'z' && !e.shiftKey && undoStack.length) { e.preventDefault(); undo(); }
    else if ((k === 'y' || (k === 'z' && e.shiftKey)) && redoStack.length) { e.preventDefault(); redo(); }
    else if (k === 's') {
      e.preventDefault();
      if (!state.roster || state.roster.date !== state.day.date) return toast('Make the roster first.');
      if (cloud.enabled && isMember()) saveRosterToCloud(); else DOWNLOADS[0][2]();
    }
    return;
  }
  if (e.altKey && !mod && /^Digit[1-4]$/.test(e.code)) { e.preventDefault(); goTab(['monthly', 'cases', 'roster', 'premed'][+e.code.slice(5) - 1]); return; }
  if (e.altKey || mod) return;
  if (e.key === '?') { e.preventDefault(); showShortcuts(); }
  else if (e.key === '[' || e.key === ']') { e.preventDefault(); switchDate(addDays(state.day.date, e.key === '[' ? -1 : 1)); }
  else if (e.key === '/') { const f = app.querySelector('input[placeholder="Filter names"]'); if (f) { e.preventDefault(); f.focus(); } }
});
let lastRows = null; // rows as of the last logged change
let editing = null; // "rowIndex:key" of the cell being typed in

const COLS = { senior: 'senior', junior: 'junior', premed: 'premed', notes: 'cases' };

// Cell-by-cell description of what changed between two versions of the roster rows.
function describeRowChanges(before, after) {
  const out = [];
  const old = Object.fromEntries(before.map(r => [r.roomId, r]));
  for (const r of after) {
    const o = old[r.roomId];
    if (!o) continue;
    for (const [k, label] of Object.entries(COLS)) {
      if ((o[k] || '') !== (r[k] || '')) out.push(`${r.label} ${label}: ${o[k] || '—'} → ${r[k] || '—'}`);
    }
  }
  return out;
}

function logRoster(changes) {
  if (!changes.length || !state.roster) return;
  (state.roster.log ||= []).unshift({ at: Date.now(), by: who(), changes });
  state.roster.log.splice(500);
}

// Where each junior is physically rostered: person id -> [{ row, part }] (ad hoc covers left out).
function juniorPlaces(rows) {
  const out = {};
  rows.forEach((row, i) => cellParts(row, 'junior').forEach((part, k) => {
    if (isCoverPart(part)) return;
    const p = matchName(namesInCell(part)[0] || '', state.staff).person;
    if (p) (out[p.id] ||= []).push({ row: i, part: k });
  }));
  return out;
}

// A junior can't be in two rooms at once: offer to make one of them an ad hoc cover (C).
let askingCover = false;
async function askCoverForDoubles(before) {
  if (askingCover) return;
  askingCover = true;
  try { await askCover(before); } finally { askingCover = false; }
}
async function askCover(before) {
  const rows = state.roster.rows;
  const now = juniorPlaces(rows);
  let changed = false; // every double-booked junior is asked about, one after another
  for (const [id, places] of Object.entries(now)) {
    if (places.length < 2 || (before[id]?.length || 0) >= places.length) continue;
    const p = state.staff.find(s => s.id === id);
    const was = new Set((before[id] || []).map(x => rows[x.row]?.label));
    const order = [...places].sort((a, b) => was.has(rows[a.row].label) - was.has(rows[b.row].label));
    const labels = places.map(x => rows[x.row].label);
    const choice = await confirmChanges(`${p.name} is now in ${labels.join(' and ')}`,
      ['A junior can\'t be in two places at once. Pick the room where they are only an ad hoc cover: it shows as "' + shortName(p) + ' (C)" in red.'],
      [...order.map((x, k) => [String(k), `Cover in ${rows[x.row].label}`, k ? '' : 'primary']), ['back', 'Keep both']]);
    if (choice === 'back') continue;
    const x = order[+choice];
    const parts = cellParts(rows[x.row], 'junior');
    const cur = parseNamePart(parts[x.part]);
    parts[x.part] = buildNamePart({ ...cur, tags: [...cur.tags, 'C'], cover: '' });
    setCellParts(rows[x.row], 'junior', parts);
    changed = true;
  }
  if (changed) afterRosterEdit(false, true);
}

function afterRosterEdit(undone, prompted) {
  const r = state.roster;
  const before = lastRows ? juniorPlaces(JSON.parse(lastRows)) : {};
  if (lastRows && !undone && !prompted) learnFromEdit(JSON.parse(lastRows), r.rows);
  if (lastRows) {
    const changes = describeRowChanges(JSON.parse(lastRows), r.rows);
    logRoster(undone ? changes.map(c => 'Undo: ' + c) : changes);
  }
  lastRows = JSON.stringify(r.rows);
  r.checks = check({ rows: r.rows, staff: dayStaff(), day: state.day, settings: state.settings });
  render();
  if (!undone && !prompted) askCoverForDoubles(before);
}

// Learning from hand changes: when a senior is taken off a subspecialty list by hand on three
// different days, offer to stop giving them that kind of list (it goes on their "doesn't do" list).
function learnFromEdit(oldRows, newRows) {
  const subs = state.settings.subspecs;
  const seniorsIn = row => new Set(namesInCell(row?.senior || '').map(n => matchName(n, state.staff).person?.id).filter(Boolean));
  const now = Object.fromEntries(newRows.map(x => [x.roomId, x]));
  for (const old of oldRows) {
    const room = state.day.rooms.find(x => x.id === old.roomId);
    const kinds = (room?.flags?.subspecs || []).filter(k => subs.find(x => x.key === k)?.hard);
    if (!kinds.length) continue;
    const kept = seniorsIn(now[old.roomId]);
    for (const id of seniorsIn(old)) {
      if (kept.has(id)) continue;
      const p = person(id);
      if (!p || p.role !== 'senior') continue;
      for (const k of kinds) {
        if ((p.avoid || []).includes(k)) continue;
        const rec = (((state.learned ||= {})[id] ||= {})[k] ||= { days: [] });
        if (rec.asked || rec.days.includes(state.day.date)) continue;
        rec.days.push(state.day.date);
        if (rec.days.length < 3) continue;
        rec.asked = true;
        const label = subs.find(x => x.key === k).label;
        setTimeout(() => toast(`You've taken ${shortName(p) || p.name} off ${label} lists on ${rec.days.length} days.`, { label: `Stop giving them ${label}`, run: () => {
          p.avoid = [...new Set([...(p.avoid || []), k])];
          (state.staffLog ||= []).unshift({ at: Date.now(), by: who(), changes: [`${p.name}: doesn't do + ${k} (learned from the roster)`] });
          render();
          toast(`${p.name} won't be given ${label} lists. Change it on the Staff tab.`);
        } }), 400);
        return;
      }
    }
  }
}

function dropName(src, dst) {
  if (src.pool) return dropFromPool(src.pool, dst);
  if (src.cover) return dropAsCover(src, dst);
  if (src.dup) return dropAsDouble(src, dst);
  if (dst.pool) return dropToPool(src);
  const rows = state.roster.rows;
  const a = rows[src.row], b = rows[dst.row];
  if (!a || !b) return;
  const aParts = cellParts(a, src.key);
  const name = aParts[src.part];
  if (name == null) return;
  if (src.row === dst.row && src.key === dst.key && (dst.part == null || dst.part === src.part)) return;
  pushUndo(JSON.stringify(rows));
  if (dst.part != null) {
    // swap two names
    const bParts = src.row === dst.row && src.key === dst.key ? aParts : cellParts(b, dst.key);
    const other = bParts[dst.part];
    aParts[src.part] = other;
    bParts[dst.part] = name;
    setCellParts(a, src.key, aParts);
    if (bParts !== aParts) setCellParts(b, dst.key, bParts);
    toast(`Swapped ${name} and ${other}.`);
  } else {
    // move into another cell
    aParts.splice(src.part, 1);
    setCellParts(a, src.key, aParts);
    const bParts = cellParts(b, dst.key);
    bParts.push(name);
    setCellParts(b, dst.key, bParts);
    toast(`Moved ${name} to ${b.label}.`);
  }
  afterRosterEdit();
}

// A name dragged from the Admin / no list card onto the roster: onto a name swaps them (the
// other person goes back to no list), onto a cell adds them there.
function dropFromPool(id, dst) {
  const p = state.staff.find(s => s.id === id);
  const row = state.roster.rows[dst.row];
  if (!p || !row || !dst.key) return;
  const d = dayOf(p.id);
  const admin = d.status === 'admin';
  if (admin) pushUndoAll(`putting ${p.name} in ${row.label}`, { day: true }); else pushUndo(JSON.stringify(state.roster.rows));
  if (admin) { d.status = 'avail'; d.manual = true; } // off their admin day and onto a list
  const text = p.role === 'senior' ? fmtSenior(p, d) : fmtJunior(withPosting(p), d);
  const parts = cellParts(row, dst.key);
  if (dst.part != null && parts[dst.part] != null) parts[dst.part] = text; else parts.push(text);
  setCellParts(row, dst.key, parts);
  toast(`Put ${p.name} in ${row.label}.`);
  afterRosterEdit();
}

// A junior dragged by their C grip: they stay in their room and are added to the other room's
// junior cell as an ad hoc cover, "Name (C)".
function dropAsCover(src, dst) {
  const rows = state.roster.rows;
  const from = rows[src.row], to = rows[dst.row];
  if (!from || !to || dst.pool || from === to) return;
  const cur = parseNamePart(cellParts(from, src.key)[src.part] || '');
  const n = namesInCell(cur.name)[0];
  if (!n) return;
  const parts = cellParts(to, 'junior');
  if (parts.some(x => namesInCell(x)[0] === n)) return toast(`${n} is already in ${to.label}.`);
  pushUndo(JSON.stringify(rows));
  parts.push(buildNamePart({ name: cur.name, tags: [...cur.tags.filter(t => TAGS.includes(t)), 'C'], leave: '', cover: '', dash: '' }));
  setCellParts(to, 'junior', parts);
  toast(`${n} covers ${to.label} (C).`);
  afterRosterEdit();
}

// A senior dragged by their &: they stay in their room and also take the other room's
// senior cell, i.e. double cover it.
function dropAsDouble(src, dst) {
  const rows = state.roster.rows;
  const from = rows[src.row], to = rows[dst.row];
  if (!from || !to || dst.pool || from === to) return;
  const cur = parseNamePart(cellParts(from, src.key)[src.part] || '');
  const n = namesInCell(cur.name)[0];
  if (!n) return;
  const parts = cellParts(to, 'senior');
  if (parts.some(x => namesInCell(x)[0] === n)) return toast(`${n} is already in ${to.label}.`);
  if (from.complex !== to.complex && !confirm(`${from.label} and ${to.label} are in different complexes. Double cover across complexes anyway?`)) return;
  pushUndo(JSON.stringify(rows));
  parts.push(buildNamePart({ name: cur.name, tags: cur.tags.filter(t => TAGS.includes(t)), leave: cur.leave, cover: '', dash: '' }));
  setCellParts(to, 'senior', parts);
  toast(`${n} double covers ${from.label} and ${to.label}.`);
  afterRosterEdit();
}

// A name dragged off the roster onto the Admin / no list card: take it out of its cell.
function dropToPool(src) {
  const row = state.roster.rows[src.row];
  const parts = row ? cellParts(row, src.key) : [];
  const name = parts[src.part];
  if (name == null) return;
  pushUndo(JSON.stringify(state.roster.rows));
  parts.splice(src.part, 1);
  setCellParts(row, src.key, parts);
  toast(`Took ${namesInCell(name)[0] || name} off ${row.label}.`);
  afterRosterEdit();
}

// Touchscreens get no dragging, covering or deleting on the chips: tapping a name opens it.
const TOUCH = matchMedia('(hover: none), (pointer: coarse)').matches;

// Move or swap by tapping (works without dragging, e.g. on a phone): pick "Move or swap" in a
// name's box, then tap where they go. The next tap on a name swaps, on a cell moves, on the
// Admin / no list box takes them off.
let swapSrc = null;
function startSwap(src, p) {
  closeTagEditor();
  swapSrc = { ...src, who: shortName(p) || p.name };
  document.body.classList.add('swapping');
  render();
}
function endSwap() { swapSrc = null; document.body.classList.remove('swapping'); document.getElementById('swap-bar')?.remove(); }
function renderSwapBar() {
  document.getElementById('swap-bar')?.remove();
  if (!swapSrc || state.tab !== 'roster') { if (swapSrc && state.tab !== 'roster') endSwap(); return; }
  document.body.append(h('div', { id: 'swap-bar', class: 'swap-bar' },
    h('span', {}, `Tap a name to swap with ${swapSrc.who}, an empty cell to move them there, or Admin / no list to take them off.`),
    h('button', { class: 'small', onclick: () => { endSwap(); render(); } }, 'Cancel')));
}
document.addEventListener('click', e => {
  if (!swapSrc) return;
  const t = e.target.closest?.('#app [data-drop]');
  if (!t || e.target.closest('#swap-bar')) return;
  e.preventDefault(); e.stopPropagation();
  clearTimeout(tagTimer);
  const src = swapSrc;
  endSwap();
  if (t.dataset.pool != null) dropName(src, { pool: true });
  else dropName(src, { row: +t.dataset.row, key: t.dataset.key, part: t.dataset.part != null ? +t.dataset.part : null });
  render();
}, true);
document.addEventListener('keydown', e => { if (swapSrc && e.key === 'Escape') { endSwap(); render(); } });

function startNameDrag(e, src) {
  if (e.button !== 0 || swapSrc) return;
  e.preventDefault();
  const chip = e.currentTarget.closest('.name') || e.currentTarget;
  const x0 = e.clientX, y0 = e.clientY;
  let ghost = null, over = null;
  const targetAt = (x, y) => document.elementFromPoint(x, y)?.closest('[data-drop]');
  const move = ev => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      ghost = chip.cloneNode(true);
      ghost.classList.add('ghost');
      document.body.append(ghost);
      chip.classList.add('dragging');
    }
    ev.preventDefault();
    ghost.style.left = ev.clientX + 10 + 'px';
    ghost.style.top = ev.clientY + 10 + 'px';
    const t = targetAt(ev.clientX, ev.clientY);
    if (t !== over) { over?.classList.remove('over'); over = t; over?.classList.add('over'); }
  };
  const up = ev => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!ghost) {
      // a click without dragging opens the name's details
      if (ev.type === 'pointerup' && src.pool) { const p = person(src.pool); if (p) openPersonBox(chip, p, { kind: 'view' }); }
      else if (ev.type === 'pointerup' && !src.cover && !src.dup) { clearTimeout(tagTimer); tagTimer = setTimeout(() => openTagEditor(chip, src), 200); }
      return;
    }
    ghost.remove();
    chip.classList.remove('dragging');
    over?.classList.remove('over');
    const t = ev.type === 'pointerup' ? targetAt(ev.clientX, ev.clientY) : null;
    if (!t) return;
    if (t.dataset.pool != null) { if (!src.pool && !src.cover && !src.dup) dropName(src, { pool: true }); return; }
    dropName(src, { row: +t.dataset.row, key: t.dataset.key, part: t.dataset.part != null ? +t.dataset.part : null });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

// Resolve a typed name to a person. Unknown names offer to add the person (so typos are caught);
// resolves to the person, or null when cancelled.
async function resolvePerson(text, role) {
  const v = String(text).trim();
  if (!v) return null;
  const m = matchName(v, state.staff);
  if (m.person) return m.person;
  if (m.ambiguous) { toast(`"${v}" could be ${m.ambiguous.map(p => p.name).join(' or ')}. Type more of the name.`); return null; }
  const other = role === 'senior' ? 'junior' : 'senior';
  const choice = await confirmChanges(`"${v}" isn't on the staff list`, ['Check the spelling. If it\'s right, add them so they can be rostered.'],
    [[role, `Add to ${role === 'senior' ? 'Seniors' : 'Juniors'}`, 'primary'], [other, `Add to ${other === 'senior' ? 'Seniors' : 'Juniors'}`], ['back', 'Cancel']]);
  if (choice === 'back') return null;
  const p = { id: newId(), name: v, aliases: [], role: choice, grade: DEFAULT_GRADE[choice], posting: '', subspecs: [], avoid: [], history: {}, source: 'roster-entry' };
  state.staff.push(p);
  (state.staffLog ||= []).unshift({ at: Date.now(), by: who(), changes: [`Added ${choice} ${v} (typed on the roster)`] });
  toast(`Added ${v} to ${choice === 'senior' ? 'Seniors' : 'Juniors'}. Fill in their details there.`);
  return p;
}

// A text box that suggests names from the staff list (optionally one role).
// A name box with the staff list as suggestions. rank(p) -> [group, note] puts the best people first
// (lower group first) and shows the note beside each name.
function nameInput(attrs = {}, role = null, rank = null) {
  const id = 'names-' + (role || 'all') + (rank ? '-ranked' : '');
  if (!document.getElementById(id)) document.body.append(h('datalist', { id }));
  const list = state.staff.filter(p => !role || p.role === role).map(p => [p, rank ? rank(p) : [0, '']]);
  list.sort((a, b) => a[1][0] - b[1][0] || bySeniority(a[0], b[0]));
  // a monthly grid calls this hundreds of times per render: rebuild the shared list only when it changes
  const dl = document.getElementById(id), sig = list.map(([p, [, note]]) => p.name + '|' + (note || '')).join('\n');
  if (dl.dataset.sig !== sig) { dl.dataset.sig = sig; dl.replaceChildren(...list.map(([p, [, note]]) => h('option', { value: p.name, label: note || undefined }))); }
  return h('input', { list: id, autocomplete: 'off', spellcheck: 'false', ...attrs });
}
// For the + in a roster cell: free people who suit the room first, then free people, then people
// already on a list, then people who aren't working.
function rankForCell(row, key) {
  const room = state.day.rooms.find(r => r.id === row.roomId);
  const needs = (room?.flags?.subspecs || []).map(k => state.settings.subspecs.find(x => x.key === k)).filter(Boolean);
  const free = new Set(noListPeople().map(p => p.id));
  const off = { leave: 'on leave', mc: 'on MC', postcall: 'post call', admin: 'admin day' };
  return p => {
    const st = state.day.staff[p.id]?.status || 'avail';
    if (off[st]) return [4, off[st]];
    if (!free.has(p.id)) return [3, st === 'elsewhere' ? 'calls / clinics' : 'already on a list'];
    if (key === 'senior') {
      const hard = needs.filter(x => x.hard);
      if (hard.length && !hard.every(x => (p.subspecs || []).includes(x.key))) return [2, `free · not ${hard.map(x => x.label).join('/')}`];
      return [0, hard.length ? `free · ${hard.map(x => x.label).join('/')}` : 'free'];
    }
    const posting = postingOf(p);
    if (posting && needs.some(x => x.posting === posting)) return [0, `free · ${postingName(posting)} posting`];
    return [1, `free${posting ? ' · ' + postingName(posting) : ''}`];
  };
}

// ---- tags on one name: "(L)", "(RA)", "(AOH 1)" and the part after a dash ("-5pm", "-C-OT 4") ----

const TAGS = ['L', 'AOH', 'HPB', 'RA', 'P', 'SR', 'Neu', 'Cardiac', 'ENT', 'Vasc', 'Amb', 'Remote', 'PACU'];
let tagTimer = null;

// "Koh YW (RA) L-4pm C-OT13 -mtg 5pm" -> name, tags, leave ("4pm" / "4-5pm"), cover ("OT13", "KROR PACU"), note
const TIME = '[\\d.:]+(?:\\s*-\\s*[\\d.:]+)?\\s*(?:am|pm)?';
// "/" separates names in a cell and brackets hold tags, so typed text can't use them as-is
const cellSafe = t => String(t || '').replace(/\bw\/\s*/gi, 'with ').replace(/\s*\/\s*/g, ' or ').replace(/\(/g, '[').replace(/\)/g, ']').trim();
// The parts of today's roster cells this person is physically in (not covers).
function rosterPartsOf(p) {
  if (!state.roster || state.roster.date !== state.day.date) return [];
  return state.roster.rows.flatMap(r => ['senior', 'junior'].flatMap(k => cellParts(r, k))).filter(x => !isCoverPart(x) && personOfPart(x) === p);
}
function parseNamePart(text) {
  const tags = [...String(text).matchAll(/\(([^)]*)\)/g)].map(m => m[1].trim()).filter(Boolean);
  let rest = String(text).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  let leave = '', cover = '', dash = '';
  rest = rest.replace(new RegExp(`\\s+L-\\s*(${TIME})`, 'i'), (_, t) => { leave = t.trim(); return ''; });
  rest = rest.replace(/\s+-?C-\s*(.+?)(?=\s+L-|\s+-|$)/i, (_, c) => { cover = c.trim().replace(/^OT\s+/i, 'OT'); return ''; });
  const m = rest.match(/^(.*?)\s+-\s*(.+)$/);
  if (m) {
    rest = m[1].trim(); dash = m[2].trim();
    // older roster style: "Name -5pm" means leaving at 5pm
    if (!leave && new RegExp(`^${TIME}$`, 'i').test(dash)) { leave = dash; dash = ''; }
  }
  return { name: rest.trim(), tags, leave, cover, dash };
}
const buildNamePart = ({ name, tags, leave, cover, dash }) =>
  `${name}${tags.map(t => ` (${t})`).join('')}${leave ? ` L-${leave}` : ''}${cover ? ` C-${cover}` : ''}${dash ? ` -${dash}` : ''}`;

// Keep the "Name (C)" entry in the room a junior covers in step with their C- tag.
function syncCoverEntry(row, oldName, oldCover, name, coverTo) {
  const rows = state.roster.rows;
  const target = c => c ? rows.find(r => r.label === coverTarget(c, row, rows)) : null;
  const isEntry = (part, n) => isCoverPart(part) && namesInCell(part)[0] === namesInCell(n)[0];
  const from = target(oldCover), to = target(coverTo);
  if (from && (from !== to || oldName !== name)) setCellParts(from, 'junior', cellParts(from, 'junior').filter(x => !isEntry(x, oldName)));
  if (to && to !== row && !cellParts(to, 'junior').some(x => isEntry(x, name))) setCellParts(to, 'junior', [...cellParts(to, 'junior'), `${name} (C)`]);
}

// Everywhere a person is on today's roster: rooms, ad hoc covers, premeds, calls and clinics.
function wherePerson(p) {
  const out = [];
  const is = text => namesInCell(text).some(n => matchName(n, state.staff).person?.id === p.id);
  for (const row of state.roster?.rows || []) {
    for (const key of ['senior', 'junior']) for (const part of cellParts(row, key)) {
      if (!is(part)) continue;
      if (isCoverPart(part)) out.push(`Covering ${row.label} (C)`);
      else {
        out.push(`In ${row.label} (${key})`);
        const c = parseNamePart(part).cover;
        if (c) out.push(`Covering ${coverTarget(c, row, state.roster.rows) || c} (C-${c})`);
      }
    }
    if (cellParts(row, 'premed').some(is)) out.push(`Premed for ${row.label}`);
  }
  const g = effectiveGeneral();
  for (const [k, label] of TEAM_ROWS) for (const team of ['mot', 'sicu']) if (is(g[`${team}.${k}`] || '')) out.push(`${team.toUpperCase()} ${label.replace(':', '') || 'MO'}`);
  for (const d of DUTIES) for (const [f, label] of d.fields) if (is(g[`${d.key}.${f}`] || '')) out.push(`${d.label} ${label.toLowerCase()}`);
  const st = state.day.staff[p.id]?.status;
  if (st && st !== 'avail') out.push(STATUSES.find(s => s[0] === st)?.[1] || st);
  return out;
}
function whereCard(p) {
  const at = wherePerson(p);
  return h('div', { class: 'where' },
    h('b', {}, p.name), h('span', { class: 'seen' }, ` · ${p.grade}${postingOf(p) ? ' · ' + postingName(postingOf(p)) : ''}`),
    h('ul', {}, (at.length ? at : ['Not on any list today']).map(t => h('li', {}, t))));
}

function closeTagEditor() {
  const open = document.querySelector('.tag-editor');
  open?.remove(); boxPerson = null; highlightPerson(null);
  // keyboard and screen-reader users land back on the name they opened (or the same person after a re-render)
  if (open && boxReturn) {
    const back = boxReturn.el?.isConnected ? boxReturn.el : boxReturn.pid ? document.querySelector(`[data-pid="${boxReturn.pid}"][tabindex]`) : null;
    boxReturn = null;
    if (back && (!document.activeElement || document.activeElement === document.body)) back.focus({ preventScroll: true });
  }
}
// A box just opened: take focus (the box itself, so phones don't pop the keyboard), keep Tab inside it.
let boxReturn = null;
function focusBox(box, anchor) {
  boxReturn = { el: anchor, pid: anchor?.dataset?.pid || '' };
  box.tabIndex = -1;
  box.focus({ preventScroll: true });
  box.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = [...box.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter(x => !x.disabled && x.offsetParent);
    if (!f.length) return;
    if (e.shiftKey && (document.activeElement === f[0] || document.activeElement === box)) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
  });
  box.addEventListener('keydown', e => { if (e.key === 'Escape' && e.target === box) closeTagEditor(); });
}
// Light up every chip of one person (hover, or while their box is open), so double bookings show.
let boxPerson = null;
function highlightPerson(id) {
  const on = id || boxPerson;
  document.querySelectorAll('[data-pid].hl').forEach(e => { if (e.dataset.pid !== on) e.classList.remove('hl'); });
  if (on) document.querySelectorAll(`[data-pid="${on}"]`).forEach(e => e.classList.add('hl'));
}

function openRawEditor(chip, src) {
  closeTagEditor();
  const row = state.roster.rows[src.row];
  const parts = cellParts(row, src.key);
  const cur = parseNamePart(parts[src.part] ?? '');
  const p = matchName(cur.name, state.staff).person;
  const on = new Set(cur.tags.filter(t => TAGS.includes(t)));
  const other = h('input', { value: cur.tags.filter(t => !TAGS.includes(t) && !/^C$/i.test(t)).join(', '), placeholder: 'e.g. AOH 1' });
  const juniorCell = src.key === 'junior';
  const coveredBox = h('input', { type: 'checkbox', checked: cur.tags.some(t => /^C$/i.test(t)) });
  const dash = h('input', { value: cur.dash, placeholder: 'e.g. mtg 3pm' });
  const leave = h('input', { value: cur.leave, placeholder: 'e.g. 4pm or 4-5pm' });
  const cover = h('input', { value: cur.cover, placeholder: 'e.g. OT13, KROR PACU' });
  const name = nameInput({ value: cur.name }, src.key === 'senior' ? 'senior' : 'junior');
  const chips = h('div', { class: 'chips' }, TAGS.map(t => {
    const c = h('span', { class: 'chip' + (on.has(t) ? ' on' : ''), title: t === 'L' ? (src.key === 'senior' ? 'Liver standby' : 'Liver posting') : '', onclick: () => {
      if (on.has(t)) on.delete(t); else on.add(t);
      c.classList.toggle('on', on.has(t));
    } }, t);
    return c;
  }));
  const apply = async () => {
    const tags = [...TAGS.filter(t => on.has(t)), ...splitNameList(other.value).filter(t => !/^C$/i.test(t)), ...(juniorCell && coveredBox.checked ? ['C'] : [])];
    let picked = name.value.trim() || cur.name;
    if (picked !== cur.name) {
      const person = await resolvePerson(picked, src.key === 'senior' ? 'senior' : 'junior');
      if (!person) return;
      picked = person.name;
    }
    const coverTo = cover.value.trim().replace(/^C-/i, '');
    const next = buildNamePart({ name: picked, tags, leave: leave.value.trim().replace(/^L-/i, ''), cover: coverTo, dash: dash.value.trim() });
    closeTagEditor();
    if (next === parts[src.part]) return;
    pushUndo(JSON.stringify(state.roster.rows));
    parts[src.part] = next;
    setCellParts(row, src.key, parts);
    // a junior covering another room (C-OT13) is shown there as "Name (C)"
    if (juniorCell && !coveredBox.checked) syncCoverEntry(row, cur.name, cur.cover, picked, coverTo);
    // keep the day's details in step so checks and regenerating agree with the sheet
    if (p) {
      const d = dayOf(p.id);
      if (src.key === 'senior') d.liverStandby = on.has('L');
      d.leaveTime = leave.value.trim().replace(/^L-/i, '');
    }
    afterRosterEdit();
  };
  const remove = () => {
    closeTagEditor();
    pushUndo(JSON.stringify(state.roster.rows));
    parts.splice(src.part, 1);
    setCellParts(row, src.key, parts);
    afterRosterEdit();
  };
  const box = h('div', { class: 'tag-editor', role: 'dialog', 'aria-label': 'Edit name',
    onkeydown: e => { if (e.key === 'Escape') closeTagEditor(); if (e.key === 'Enter') { e.preventDefault(); apply(); } } },
    p ? whereCard(p) : null,
    h('label', {}, 'Name'), name,
    h('label', {}, 'Tags'), chips,
    h('label', {}, 'Other tags'), other,
    h('label', {}, 'Leaving (L-)'), leave,
    h('label', {}, 'Covering (C-)'), cover,
    juniorCell && h('label', { class: 'check', title: 'No junior is physically in this room: this person only covers it ad hoc. Shown as "Name (C)" in red.' }, coveredBox, ' Covered (ad hoc cover, not physically here)'),
    h('label', {}, 'Comment (also shown in the comments box)'), dash,
    h('div', { class: 'bar', style: 'margin:8px 0 0' },
      h('button', { class: 'primary', onclick: apply }, 'Save'),
      h('button', { onclick: closeTagEditor }, 'Cancel'),
      h('span', { class: 'grow' }),
      h('button', { onclick: remove, title: 'Take this name out of the cell' }, 'Remove')),
  );
  document.body.append(box);
  focusBox(box, chip);
  const rc = chip.getBoundingClientRect();
  const w = box.offsetWidth, hgt = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, rc.left)) + 'px';
  box.style.top = (rc.bottom + hgt + 8 < window.innerHeight ? rc.bottom + 4 : Math.max(8, rc.top - hgt - 4)) + 'px';
  setTimeout(() => {
    const away = e => { if (!box.contains(e.target)) { closeTagEditor(); window.removeEventListener('pointerdown', away, true); } };
    window.addEventListener('pointerdown', away, true);
  });
}

// ---- the person box: one look for a person on every daily tab (Today, Cases, Roster, Premeds) ----

const personOfPart = part => matchName(namesInCell(part)[0] || '', state.staff).person;
const isAohTag = t => /^AOH\b/i.test(t);
// tags that belong to the roster cell rather than the person's day
const CELL_TAGS = TAGS.filter(t => t !== 'L' && t !== 'AOH');

// The day's markers after a short name: (L), (AOH), L-4pm
function dayMarks(p) {
  const d = state.day.staff[p.id] || {};
  return [d.liverStandby ? '(L)' : '', d.aoh ? `(${d.aoh})` : '', d.leaveTime ? `L-${d.leaveTime}` : ''].filter(Boolean).join(' ');
}
// The person chip for the daily tabs: short name in their colour, then the day's markers
function personChip(p, attrs = {}, ...extra) {
  const marks = dayMarks(p);
  return h('span', { class: 'name pchip', 'data-pid': p.id, style: colourStyle(p.name), title: `${p.name} · ${p.grade}`, tabindex: 0, role: 'button', ...attrs },
    h('span', { class: 'label' }, shortName(p) || p.name), marks ? h('span', { class: 'marks' }, ' ' + marks) : null, ...extra);
}

// Write a person's day details (L-, (L), (AOH), comment) into every roster cell they're physically in.
function syncPersonCells(p) {
  if (!state.roster || state.roster.date !== state.day.date) return;
  const d = state.day.staff[p.id] || {};
  for (const row of state.roster.rows) for (const key of ['senior', 'junior']) {
    const parts = cellParts(row, key);
    let changed = false;
    parts.forEach((part, k) => {
      if (isCoverPart(part) || personOfPart(part) !== p) return;
      const cur = parseNamePart(part);
      const postingL = p.role === 'junior' && postingOf(p) === 'L';
      const tags = cur.tags.filter(t => !isAohTag(t) && !(t === 'L' && !postingL));
      if (d.liverStandby && !tags.includes('L')) tags.unshift('L');
      if (d.aoh) tags.push(d.aoh);
      const next = buildNamePart({ ...cur, tags, leave: d.leaveTime || '', dash: d.comment || '' });
      if (next !== part) { parts[k] = next; changed = true; }
    });
    if (changed) setCellParts(row, key, parts);
  }
}

// A junior's posting changed for the day: swap the posting tag in their roster cells ("(RA)" -> "(P)").
function retagPosting(p, from, to) {
  if (!state.roster || state.roster.date !== state.day.date) return;
  const isPostingTag = t => POSTINGS.some(([code]) => code && code === t);
  for (const row of state.roster.rows) {
    const parts = cellParts(row, 'junior');
    let changed = false;
    parts.forEach((part, k) => {
      if (isCoverPart(part) || personOfPart(part) !== p) return;
      const cur = parseNamePart(part);
      let tags = cur.tags.filter(t => !(t === from && from !== 'L') && !(from === 'L' && t === 'L' && !state.day.staff[p.id]?.liverStandby));
      if (!from && tags.some(isPostingTag)) tags = tags.filter(t => !isPostingTag(t) || t === 'L');
      if (to && !tags.includes(to)) tags.push(to);
      const next = buildNamePart({ ...cur, tags });
      if (next !== part) { parts[k] = next; changed = true; }
    });
    if (changed) setCellParts(row, 'junior', parts);
  }
}

// Open the Staff tab in edit mode on this person.
let staffHighlight = null;
async function goEditStaff(p) {
  closeTagEditor();
  state.tab = 'staff';
  state.staffRole = p.role;
  staffFilter = '';
  staffHighlight = p.id;
  if (!staffEditing()) startStaffEdit(); else render();
  setTimeout(() => app.querySelector(`tr[data-id="${p.id}"]`)?.scrollIntoView({ block: 'center' }), 50);
}

// ctx: { kind: 'roster', src } | { kind: 'today' } | { kind: 'lock', room, key } | { kind: 'premed', row, options }
function openPersonBox(anchor, p, ctx) {
  closeTagEditor();
  boxPerson = p.id; setTimeout(() => highlightPerson(p.id));
  const d = state.day.staff[p.id] || {};
  const roster = ctx.kind === 'roster';
  const rrow = roster ? state.roster.rows[ctx.src.row] : null;
  const parts = roster ? cellParts(rrow, ctx.src.key) : [];
  const part = roster ? parts[ctx.src.part] ?? '' : '';
  const cur = roster ? parseNamePart(part) : { tags: [], leave: '', cover: '', dash: '' };
  const cover = roster && isCoverPart(part);
  // away from the roster tab, the day's details start from the person's first roster cell
  const firstPart = roster ? null : rosterPartsOf(p)[0];
  const seed = roster ? (cover ? { tags: [], leave: '', dash: '' } : cur) : firstPart ? parseNamePart(firstPart) : { tags: [], leave: '', dash: '' };

  // the person's day (shared by every tab)
  const leave = h('input', { value: d.leaveTime || seed.leave, placeholder: 'e.g. 4pm or 4-5pm' });
  const liver = h('input', { type: 'checkbox', checked: !!d.liverStandby || (p.role === 'senior' && seed.tags.includes('L')) });
  const aoh = h('input', { value: d.aoh || seed.tags.find(isAohTag) || '', placeholder: 'e.g. AOH or AOH 1' });
  const comment = h('input', { value: d.comment ?? seed.dash, placeholder: 'e.g. mtg 3pm' });
  const away = h('input', { type: 'checkbox', checked: !!d.notAroundPrev });
  // a status or comment that runs for several days (a course, an admin week): carried into those days
  const carried = (state.carry || []).find(c => c.pid === p.id && c.from <= state.day.date && state.day.date <= c.until);
  const until = h('input', { type: 'date', value: carried?.until || '', min: addDays(state.day.date, 1), title: 'The status and comment also go on each day up to this date' });
  // a junior's posting for this day only (the rotation is planned on Monthly › Rotations)
  const postingPick = p.role === 'junior' ? select(postingOf(p), POSTINGS, () => {}) : null;
  let status = groupOf(d.status);
  const statusBtns = BOARD.map(([k, label]) => h('button', { class: 'small', 'aria-pressed': String(k === status), onclick: e => {
    status = k; e.currentTarget.parentNode.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
  } }, label));

  // this roster cell only
  const on = new Set(cur.tags.filter(t => CELL_TAGS.includes(t)));
  const other = h('input', { value: cur.tags.filter(t => !TAGS.includes(t) && !/^C$/i.test(t) && !isAohTag(t)).join(', '), placeholder: 'e.g. KIV' });
  const coverTo = h('input', { value: cur.cover, placeholder: 'e.g. OT13, KROR PACU' });
  const coveredBox = h('input', { type: 'checkbox', checked: cover });
  const chips = h('div', { class: 'chips' }, CELL_TAGS.map(t => {
    const c = h('span', { class: 'chip' + (on.has(t) ? ' on' : ''), onclick: () => { if (on.has(t)) on.delete(t); else on.add(t); c.classList.toggle('on', on.has(t)); } }, t);
    return c;
  }));
  const premedPick = ctx.kind === 'premed' ? select(p.name, ctx.options, () => {}) : null;

  const apply = () => {
    const rosterNow = state.roster && state.roster.date === state.day.date;
    const s = dayOf(p.id);
    const before = JSON.stringify([state.day, rosterNow ? state.roster.rows : null]);
    pushUndoAll(`the change to ${p.name}`, { day: true });
    if (roster) {
      const juniorCell = ctx.src.key === 'junior';
      const coverText = coverTo.value.trim().replace(/^C-/i, '');
      // a Liver Transplant posting's (L) isn't one of the cell's tag chips; keep it
      const postingL = p.role === 'junior' && postingOf(p) === 'L' && cur.tags.includes('L');
      const tags = [...(postingL ? ['L'] : []), ...CELL_TAGS.filter(t => on.has(t)), ...splitNameList(other.value).map(cellSafe).filter(t => t && !/^C$/i.test(t)), ...(juniorCell && coveredBox.checked ? ['C'] : [])];
      parts[ctx.src.part] = buildNamePart({ name: cur.name, tags, leave: '', cover: coverText, dash: '' });
      setCellParts(rrow, ctx.src.key, parts);
      if (juniorCell && !coveredBox.checked) syncCoverEntry(rrow, cur.name, cur.cover, cur.name, coverText);
    }
    // only fields that changed are written, so a Save that changes nothing leaves no Undo step
    const put = (k, v) => { if ((s[k] || '') !== v) s[k] = v; };
    put('leaveTime', leave.value.trim().replace(/^L-/i, ''));
    if (liver.checked !== !!s.liverStandby) { s.liverStandby = liver.checked; s.manualLiver = true; delete s.autoLiver; }
    put('aoh', cellSafe(aoh.value.trim().replace(/^\(|\)$/g, '')));
    put('comment', cellSafe(comment.value.trim().replace(/^-\s*/, '')));
    if (s.carried?.comment && s.comment !== s.carried.comment) { delete s.carried.comment; if (!s.carried.status) delete s.carried; } // edited by hand
    if (postingPick) {
      const was = postingOf(p), v = postingPick.value;
      if (v === plannedPosting(p)) delete s.posting; else s.posting = v;
      if (v !== was) retagPosting(p, was, v);
    }
    if (p.role === 'junior' && away.checked !== !!s.notAroundPrev) { s.notAroundPrev = away.checked; s.manualAway = true; delete s.autoAway; }
    if (ctx.kind === 'today' && status !== groupOf(s.status)) { closeTagEditor(); setStatus(p, status, { quiet: true }); }
    setCarry(p, until.value, ctx.kind === 'today' ? status : groupOf(s.status), s.comment || '');
    if (ctx.kind === 'premed' && premedPick.value !== p.name) ctx.setCover(premedPick.value);
    syncPersonCells(p);
    closeTagEditor();
    if (JSON.stringify([state.day, rosterNow ? state.roster.rows : null]) === before) undoStack.pop(); // nothing changed
    if (rosterNow) afterRosterEdit(); else render();
  };
  const remove = () => {
    closeTagEditor();
    if (roster) dropToPool(ctx.src);
    else if (ctx.kind === 'lock') { ctx.room[ctx.key] = ''; render(); }
    else if (ctx.kind === 'premed') ctx.setCover('');
    else if (ctx.kind === 'call') ctx.remove();
  };
  const field = (label, el, title) => [h('label', { title: title || '' }, label), el];
  const box = h('div', { class: 'tag-editor person-box', role: 'dialog', 'aria-label': p.name,
    onkeydown: e => { if (e.key === 'Escape') closeTagEditor(); if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); apply(); } } },
    h('div', { class: 'where' },
      h('div', { class: 'bar', style: 'margin:0' },
        h('div', { class: 'grow' }, h('b', { style: colourStyle(p.name) }, p.name), h('div', { class: 'seen' }, [shortName(p) !== p.name ? shortName(p) : '', p.grade, postingOf(p) ? postingName(postingOf(p)) : ''].filter(Boolean).join(' · '))),
        h('button', { class: 'small', title: 'Edit their name, short names, grade and so on on the Staff tab', onclick: () => goEditStaff(p) }, 'Edit')),
      h('ul', {}, (wherePerson(p).length ? wherePerson(p) : ['Not on any list today']).map(t => h('li', {}, t)))),
    ctx.kind === 'today' ? [h('label', {}, 'Today'), h('div', { class: 'seg status-pick' }, statusBtns)] : null,
    roster ? [h('label', {}, 'Tags in this room'), chips, ...field('Other tags', other), ...field('Covering (C-)', coverTo, 'Covers another room, e.g. when someone there leaves early'),
      ctx.src.key === 'junior' ? h('label', { class: 'check', title: 'No junior is physically in this room: this person only covers it ad hoc. Shown as "Name (C)" in red.' }, coveredBox, ' Ad hoc cover here (C), not physically here') : null] : null,
    ctx.kind === 'premed' ? field('Premed cover', premedPick) : null,
    h('div', { class: 'seen', style: 'margin-top:6px; font-weight:600' }, 'For the whole day (shows wherever they are)'),
    ...field('Leaving (L-)', leave),
    h('label', { class: 'check' }, liver, ' Liver standby (L): no complex lists'),
    ...field('AOH tag', aoh, 'Shown as (AOH) after their name'),
    ...field('Comment (also shown in the comments box)', comment, 'Shown on the sent-out sheet: meetings, times, where they are. No patient details, NRIC, phone numbers or medical reasons.'),
    ...field('Same until (optional)', until, 'For something that runs several days: the status and comment go on each day up to this date'),
    carried ? h('div', { class: 'seen' }, `Carried from ${longDate(carried.from)} to ${longDate(carried.until)}. Clear the date to stop it.`) : null,
    p.role === 'junior' ? h('label', { class: 'check', title: 'Not around on the previous working day: needs premed cover' }, away, ' Away on the previous working day') : null,
    postingPick ? field(`Posting today${d.posting != null ? ` (rotation: ${postingName(plannedPosting(p)) || 'none'})` : ''}`, postingPick, 'Changes their posting for this day only; the weekly rotation is on Monthly › Rotations') : null,
    h('div', { class: 'bar', style: 'margin:8px 0 0' },
      h('button', { class: 'primary save', onclick: apply }, 'Save'),
      h('button', { onclick: closeTagEditor }, 'Cancel'),
      h('span', { class: 'grow' }),
      roster ? h('button', { title: 'Then tap another name to swap, or an empty cell or the Admin / no list box to move them there', onclick: () => startSwap(ctx.src, p) }, 'Move or swap') : null,
      ['roster', 'lock', 'premed', 'call'].includes(ctx.kind) ? h('button', { onclick: remove, title: ctx.kind === 'lock' ? 'Let the roster choose' : 'Take them off here' }, 'Remove') : null),
  );
  document.body.append(box);
  focusBox(box, anchor);
  const rc = anchor.getBoundingClientRect();
  const w = box.offsetWidth, hgt = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, rc.left)) + 'px';
  box.style.top = (rc.bottom + hgt + 8 < window.innerHeight ? rc.bottom + 4 : Math.max(8, rc.top - hgt - 4)) + 'px';
  setTimeout(() => {
    const awayClick = e => { if (!box.contains(e.target)) { closeTagEditor(); window.removeEventListener('pointerdown', awayClick, true); } };
    window.addEventListener('pointerdown', awayClick, true);
  });
}

// A name on the roster: the person box, or (for a name not on the staff list) the plain editor.
function openTagEditor(chip, src) {
  const part = cellParts(state.roster.rows[src.row], src.key)[src.part] ?? '';
  const p = personOfPart(part);
  if (p) openPersonBox(chip, p, { kind: 'roster', src });
  else openRawEditor(chip, src);
}

// Case notes typed on the roster also update the day's room, so flags and checks follow.
function editNotes(i, value) {
  const row = state.roster.rows[i];
  if (!row || value === row.notes) return;
  pushUndo(JSON.stringify(state.roster.rows));
  logRoster([`${row.label} cases: ${row.notes || '—'} → ${value || '—'}`]);
  row.notes = value;
  lastRows = JSON.stringify(state.roster.rows);
  const room = state.day.rooms.find(x => x.id === row.roomId);
  if (room) {
    room.notes = value;
    if (!room.flagsManual) room.flags = suggestFlags(value, state.settings, room.name);
  }
  const before = JSON.stringify(state.roster.checks);
  state.roster.checks = check({ rows: state.roster.rows, staff: dayStaff(), day: state.day, settings: state.settings });
  save();
  if (JSON.stringify(state.roster.checks) !== before) render();
}

const notesCell = (row, i, attrs = {}) => h('td', {
  ...attrs, contenteditable: 'plaintext-only', spellcheck: 'false', title: 'Click to edit the case notes',
  onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
  onblur: e => editNotes(i, e.target.textContent.trim()),
}, row.notes || '');

// The colour of a roster name: red for an ad hoc cover ("Name (C)"), else the person's
// colour ('green', 'purple' or '', consultants always black).
const colourCache = new Map();
function colourOf(part) {
  if (isCoverPart(part)) return 'red';
  const n = namesInCell(part)[0];
  if (!n) return '';
  const k = n + '|' + state.staff.length;
  if (!colourCache.has(k)) colourCache.set(k, staffColour(matchName(n, state.staff).person));
  return colourCache.get(k);
}
// The sheet uses short names: "Koh Yi Wen (RA) L-4pm" -> "Koh YW (RA) L-4pm".
function shortOf(part) {
  const n = namesInCell(part)[0];
  if (!n) return part;
  const p = matchName(n, state.staff).person;
  if (!p) return part;
  const s = shortName(p);
  const at = part.indexOf(n);
  return s && at >= 0 ? part.slice(0, at) + s + part.slice(at + n.length) : part;
}
// On screen the sheet's bright green (Baby MO) is darkened so it reads on white (2.9:1 → 5:1); the sheet itself,
// the .xlsx, PDF and image keep the department's colours.
const SCREEN_COLOUR = { green: '#00803a', red: '#c00000' };
const colourStyle = part => { const k = colourOf(part), c = COLOUR_ARGB[k]; return c ? `color:${SCREEN_COLOUR[k] || '#' + c.slice(2)}` : ''; };

// Add a person to a cell from the staff list (unknown names offer to add them to the staff list).
async function addToCell(i, key, text) {
  const p = await resolvePerson(text, key === 'senior' ? 'senior' : 'junior');
  if (!p) return false;
  if (state.roster.rows[i].roomId === 'aic' && !(['SC', 'C'].includes(p.grade) || p.grade === 'Senior resident')
    && !confirm(`AIC is usually a consultant or senior resident. Put ${p.name} (${p.grade}) there anyway?`)) return false;
  if (!p) return false;
  const row = state.roster.rows[i];
  const d = state.day.staff[p.id] || {};
  pushUndo(JSON.stringify(state.roster.rows));
  setCellParts(row, key, [...cellParts(row, key), p.role === 'senior' ? fmtSenior(p, d) : fmtJunior(withPosting(p), d)]);
  editing = null;
  afterRosterEdit();
  return true;
}

function rosterCell(row, i, key, doubles) {
  const id = i + ':' + key;
  const parts = cellParts(row, key);
  let adder;
  if (editing === id) {
    // Enter and the change event can both fire for one pick: add the name once
    let busy = false;
    const add = v => { if (busy) return; busy = true; addToCell(i, key, v).then(ok => { if (!ok) busy = false; }); };
    adder = nameInput({ class: 'cell-input', placeholder: 'Type a name',
      onkeydown: e => { if (e.key === 'Escape') { editing = null; render(); } if (e.key === 'Enter') { e.preventDefault(); add(e.target.value); } },
      onchange: e => { if (state.staff.some(p => p.name === e.target.value)) add(e.target.value); },
      onblur: e => setTimeout(() => { if (editing === id && !e.target.value.trim()) { editing = null; render(); } }, 150),
    }, key === 'senior' && row.roomId !== 'aic' ? 'senior' : key === 'senior' ? null : 'junior', rankForCell(row, key));
    setTimeout(() => adder.focus());
  } else {
    adder = h('button', { class: 'add-name', title: 'Add a name', onclick: () => { clearTimeout(tagTimer); closeTagEditor(); editing = id; render(); } }, '+');
  }
  // each name shows the short name. With a mouse: drag the chip to move or swap it, drag the
  // C to add a junior to another room as an ad hoc cover, drag a senior's & to have them
  // double cover another room, × takes the name off. On a touchscreen there's no dragging
  // (so the page scrolls); tapping opens the name's details.
  const chip = (p, k) => {
    const src = { row: i, key, part: k };
    const icon = (cls, title, text, o) => h('span', { class: 'icon ' + cls, title, onpointerdown: e => { e.stopPropagation(); o.down?.(e); }, onclick: e => { e.stopPropagation(); o.click?.(); } }, text);
    const pid = personOfPart(p)?.id;
    const why = pid ? row.why?.[pid] : ''; // from the generator; stale after a hand move, so only for who is still here
    const el = h('span', { class: 'name', 'data-drop': '', 'data-row': i, 'data-key': key, 'data-part': k, 'data-pid': pid || '', style: colourStyle(p), title: why ? `${p}\nWhy here: ${why}` : p,
      onpointerenter: TOUCH || !pid ? null : () => highlightPerson(pid), onpointerleave: TOUCH || !pid ? null : () => highlightPerson(null),
      onpointerdown: TOUCH ? null : e => startNameDrag(e, src),
      onclick: TOUCH ? () => openTagEditor(el, src) : null,
      tabindex: 0, role: 'button', 'aria-label': `${p} (${key}, ${row.label}): open`,
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTagEditor(el, src); } } },
      !TOUCH && key === 'junior' && !isCoverPart(p) ? icon('cover', 'Drag to another room to add them there as an ad hoc cover (C). They stay in this room.', 'C', { down: e => startNameDrag(e, { ...src, cover: true }) }) : null,
      key === 'senior' && (!TOUCH || isDouble(p, doubles)) ? icon('dbl' + (isDouble(p, doubles) ? ' on' : ''),
        (isDouble(p, doubles) ? 'Double covering. ' : '') + (TOUCH ? '' : 'Drag to another room to have them double cover it too.'), '&',
        { down: TOUCH ? null : e => startNameDrag(e, { ...src, dup: true }) }) : null,
      h('span', { class: 'label' }, shortOf(p)),
      !TOUCH ? icon('del', isCoverPart(p) ? 'Remove this ad hoc cover' : 'Take off this list (they go to Admin / no list)', '×', { click: () => dropToPool(src) }) : null);
    return el;
  };
  return h('td', {
    class: 'cell', 'data-drop': '', 'data-row': i, 'data-key': key, title: 'Drag a name to swap or move it. Click a name to edit it.',
  }, h('div', { class: 'names' }, parts.map(chip), adder));
}

// The day as the generator sees it: people on the Calls/clinics tab are busy, and the
// cardiac call team goes to MOR 12.
function generatorDay() {
  const busy = generalPeople();
  const genDay = { ...state.day, staff: { ...state.day.staff }, rooms: state.day.rooms.map(r => ({ ...r })) };
  const mor12 = genDay.rooms.find(r => r.name === 'MOR 12' && r.running);
  if (mor12) {
    const eff = effectiveGeneral();
    const first = k => matchName(namesInCell(eff[k] || '')[0] || '', state.staff).person;
    const cs = first('cardiac.s'), ca = first('cardiac.a');
    if (cs && !mor12.lockSenior) mor12.lockSenior = cs.id;
    if (ca && !mor12.lockJunior) mor12.lockJunior = ca.id;
  }
  for (const id of busy) if ((genDay.staff[id]?.status || 'avail') === 'avail') genDay.staff[id] = { ...(genDay.staff[id] || {}), status: 'elsewhere' };
  return genDay;
}

function canGenerate() {
  if (!state.staff.length) { toast('Add staff on the Staff tab first.'); return false; }
  if (!state.day.rooms.some(r => r.running)) { toast('Tick the running rooms on the Cases tab first.'); return false; }
  return true;
}

function runGenerate(newSeed) {
  if (!canGenerate()) return;
  const seed = newSeed ? Math.floor(Math.random() * 1e9) : (state.roster?.seed || 1);
  const res = generate({ staff: dayStaff(), day: generatorDay(), settings: state.settings, seed });
  const log = state.roster?.date === state.day.date ? state.roster.log || [] : [];
  const replacing = state.roster?.rows?.length && state.roster.date === state.day.date;
  pushUndoAll('the new roster');
  editing = null;
  state.roster = { ...res, seed, date: state.day.date, log, checks: check({ rows: res.rows, staff: dayStaff(), day: state.day, settings: state.settings }) };
  logRoster([log.length ? 'Generated a new roster' : 'Generated the roster']);
  lastRows = JSON.stringify(res.rows);
  render();
  if (replacing) undoToast('Made a new roster. Changes by hand were replaced (Fill empty gaps keeps them).');
}

// Keep every name already on the roster and generate only the empty cells: people already
// placed stay where they are (so the generator can pair or cover around them), everyone
// else rostered is left out.
function fillGaps() {
  if (!canGenerate()) return;
  const r = state.roster;
  const genDay = generatorDay();
  const placed = new Set(), locked = new Set();
  const person = text => matchName(namesInCell(text)[0] || '', state.staff).person;
  for (const row of r.rows) for (const key of ['senior', 'junior']) for (const part of cellParts(row, key)) {
    const p = person(part);
    if (p) placed.add(p.id);
  }
  for (const row of r.rows) {
    const room = genDay.rooms.find(x => x.id === row.roomId);
    if (!room) continue;
    const s = person(cellParts(row, 'senior')[0] || '');
    const j = person(cellParts(row, 'junior').find(x => !isCoverPart(x)) || '');
    if (s && !locked.has(s.id)) { room.lockSenior = s.id; locked.add(s.id); }
    if (j && !locked.has(j.id)) { room.lockJunior = j.id; locked.add(j.id); }
  }
  for (const id of placed) {
    if (locked.has(id) || (genDay.staff[id]?.status || 'avail') !== 'avail') continue;
    genDay.staff[id] = { ...(genDay.staff[id] || {}), status: 'elsewhere' };
  }
  const special = id => r.rows.find(x => x.roomId === id) || {};
  const fixed = { ...(genDay.fixed || {}) };
  if (special('ahot').senior) fixed.ahot = special('ahot').senior;
  if (special('aic').senior) fixed.aic = special('aic').senior;
  if (special('aocc').senior || special('aocc').junior) { fixed['aocc.s'] = special('aocc').senior || ''; fixed['aocc.j'] = special('aocc').junior || ''; }
  genDay.fixed = fixed;
  const old = Object.fromEntries(r.rows.map(x => [x.roomId, x]));
  const fillFrom = res => {
    const filled = [];
    const rows = res.rows.map(g => {
      const o = old[g.roomId];
      if (!o) { if (g.senior || g.junior) filled.push(`${g.label} (new room)`); return g; }
      const row = { ...o };
      for (const key of ['senior', 'junior', 'premed']) if (!String(o[key] || '').trim() && g[key]) { row[key] = g[key]; filled.push(`${g.label} ${key}`); }
      return row;
    });
    return { res, rows, filled };
  };
  // a few tries: one seed can spend the last free senior on a room another try fills, leaving a gap it could have filled
  let best = null;
  for (let i = 0; i < 6; i++) {
    const t = fillFrom(generate({ staff: dayStaff(), day: clone(genDay), settings: state.settings, seed: Math.floor(Math.random() * 1e9) }));
    if (!best || t.filled.length > best.filled.length) best = t;
  }
  const { res, rows, filled } = best;
  // rows filled in by hand for rooms that aren't running any more stay
  const kept = new Set(rows.map(x => x.roomId));
  rows.push(...r.rows.filter(o => !kept.has(o.roomId) && (o.senior || o.junior || o.premed)));
  if (!filled.length) return toast('Nothing to fill: no one free for the empty cells.');
  pushUndo(JSON.stringify(r.rows));
  r.rows = rows;
  r.warnings = res.warnings;
  editing = null;
  afterRosterEdit(false, true);
  toast(`Filled ${filled.length} empty cell(s).`);
}

let rosterView = 'edit';

// ----- general tab -----

// Names typed into a General field must be on the staff list (unknown ones offer to be added).
async function setGeneral(key, value, role, input) {
  const g = (state.day.general ||= {});
  const before = g[key] || '';
  const v = value.trim();
  for (const n of v.split('/').flatMap(namesInCell)) {
    const p = await resolvePerson(n, role);
    if (!p) { if (input) input.value = before; return; }
  }
  if (v === before) return;
  g[key] = v;
  const show = x => x === NOBODY ? 'nobody' : x || '—';
  if (state.roster) logRoster([`General · ${key}: ${show(before)} → ${show(v)}`]);
  render();
}

// Fields left empty take a default: the MOT on-call team also does EOT 8 and EOT 9.
const GENERAL_DEFAULTS = { 'eot8.s': 'mot.cons', 'eot8.a': 'mot.res1', 'eot9.s': 'mot.cons', 'eot9.a': 'mot.res2', 'eot9.a2': 'mot.res3' };
const NOBODY = '-'; // typed into a field to blank what the monthly rosters (or the MOT team) would put there
function effectiveGeneral() {
  const typed = Object.fromEntries(Object.entries(state.day.general || {}).filter(([, v]) => v));
  const g = { ...generalFromMonthly(state.monthly, state.day.date), ...typed };
  for (const [k, from] of Object.entries(GENERAL_DEFAULTS)) if (!g[k] && g[from] && g[from] !== NOBODY) g[k] = g[from];
  for (const k of Object.keys(g)) if (g[k] === NOBODY) delete g[k];
  return g;
}

// Everyone named on the Calls/clinics tab, so the OT generator leaves them out.
function generalPeople() {
  const ids = new Set();
  for (const v of Object.values(effectiveGeneral())) for (const n of String(v).split('/').flatMap(namesInCell)) {
    const p = matchName(n, state.staff).person;
    if (p) ids.add(p.id);
  }
  return ids;
}

// One Calls/clinics field, as person chips like the rest of the app. Names typed here win; otherwise
// the chips come from the monthly rosters or the MOT team (dashed, with where they came from).
// × takes someone off (blanking the field if they were the only one), + adds someone.
let callEditing = null; // the field taking a new name
function generalField(key, role) {
  const typed = (state.day.general || {})[key] || '';
  const value = effectiveGeneral()[key] || '';
  const inherited = !typed && !!value;
  const source = inherited ? (generalFromMonthly(state.monthly, state.day.date)[key] ? 'monthly roster' : 'MOT call team') : '';
  const names = String(value).split('/').map(x => x.trim()).filter(Boolean);
  const setNames = list => setGeneral(key, list.length ? list.join(' / ') : NOBODY, role);
  const chips = names.map((n, i) => {
    const p = matchName(namesInCell(n)[0] || n, state.staff).person;
    const remove = () => { closeTagEditor(); setNames(names.filter((_, k) => k !== i)); };
    const x = TOUCH ? null : h('span', { class: 'icon del', title: 'Take off', onclick: e => { e.stopPropagation(); remove(); } }, '×');
    return p
      ? personChip(p, { class: 'name pchip' + (inherited ? ' inherited' : ''), title: `${p.name} · ${p.grade}${source ? ` · from the ${source}` : ''}`, onclick: e => openPersonBox(e.currentTarget, p, { kind: 'call', remove }) }, x)
      : h('span', { class: 'name pchip unknown', title: `"${n}" isn't on the staff list` }, n, x);
  });
  let adder;
  if (callEditing === key) {
    const add = v => {
      if (callEditing !== key) return; // the change event that follows Enter
      callEditing = null;
      if (v.trim()) setNames([...names, v.trim()]); else render();
    };
    adder = nameInput({ class: 'cell-input', placeholder: 'Pick from the staff list',
      onkeydown: e => { if (e.key === 'Escape') { callEditing = null; render(); } if (e.key === 'Enter') { e.preventDefault(); add(e.target.value); } },
      onchange: e => { if (state.staff.some(p => p.name === e.target.value)) add(e.target.value); },
      onblur: e => setTimeout(() => { if (callEditing === key && !e.target.value.trim()) { callEditing = null; render(); } }, 150) }, role);
    setTimeout(() => adder.focus());
  } else adder = h('button', { class: 'add-name', title: 'Add someone', onclick: () => { callEditing = key; render(); } }, '+');
  const back = typed && (generalFromMonthly(state.monthly, state.day.date)[key] || GENERAL_DEFAULTS[key])
    ? h('button', { class: 'link from', title: 'Use the monthly roster again', onclick: () => setGeneral(key, '', role) }, '↺ monthly') : null;
  return h('div', { class: 'call-field' }, chips, adder, back);
}

// The calls and clinics on the Roster tab, as a compact list (the same fields as Monthly › Today).
// Every Calls/clinics field: [label, key, role].
const generalFields = () => [
  ...TEAM_ROWS.map(([k, label], i) => [`MOT ${i < 2 ? label.replace(':', '') : 'MO' + (i - 1)}`, 'mot.' + k, i < 2 ? 'senior' : 'junior']),
  ...TEAM_ROWS.slice(0, 3).map(([k, label], i) => [`SICU ${i < 2 ? label.replace(':', '') : 'MO1'}`, 'sicu.' + k, i < 2 ? 'senior' : 'junior']),
  ...DUTIES.flatMap(d => d.fields.map(([f, label]) => [`${d.label} · ${label}`, `${d.key}.${f}`, f === 's' ? 'senior' : 'junior'])),
];
function callsCard() {
  const rows = generalFields();
  const filled = rows.filter(([, k]) => effectiveGeneral()[k]).length;
  return h('section', { class: 'card' }, h('details', { open: true },
    h('summary', {}, h('h2', { style: 'display:inline' }, 'Calls and clinics'), h('span', { class: 'seen' }, ` ${filled} of ${rows.length} filled`)),
    h('p', { class: 'hint' }, 'The top half of the sheet. Dashed names come from the monthly rosters; × takes someone off, + adds someone.'),
    h('div', { class: 'calls-list' }, rows.map(([label, key, role]) => [h('label', { class: 'seen' }, label), generalField(key, role)]))));
}

function renderGeneral() {
  const field = generalField;
  return h('div', {},
    h('section', { class: 'card' },
      h('h2', {}, 'Calls and clinics'),
      h('p', { class: 'hint' }, 'MOT and SICU calls, EOT and clinics for the day: the top half of the sheet. Dashed names come from the monthly rosters (or, for EOT 8 and 9, the MOT call team). × takes someone off, + adds someone. Everyone here is left out of the OT lists, and the cardiac call team goes to MOR 12. Load draft roster on the Cases tab fills these from the admin draft.')),
    h('section', { class: 'card scroll' },
      h('h2', {}, 'MOT and SICU Calls'),
      h('table', {},
        h('thead', {}, h('tr', {}, ['', 'MOT', 'SICU'].map(t => h('th', {}, t)))),
        // residents are MO1–MO3; SICU has only an MO1
        h('tbody', {}, TEAM_ROWS.map(([k, label], i) => h('tr', {},
          h('td', { class: 'seen' }, i < 2 ? label : `MO${i - 1}:`),
          h('td', {}, field('mot.' + k, i < 2 ? 'senior' : 'junior')),
          h('td', {}, i < 3 ? field('sicu.' + k, i < 2 ? 'senior' : 'junior') : null)))))),
    h('section', { class: 'card scroll' },
      h('h2', {}, 'EOT and clinics'),
      h('table', {},
        h('thead', {}, h('tr', {}, ['', 'Senior', 'Junior', 'Junior'].map(t => h('th', {}, t)))),
        h('tbody', {}, DUTIES.map(d => h('tr', {},
          h('td', {}, h('b', {}, d.label)),
          [0, 1, 2].map(i => h('td', {}, d.fields[i] ? h('div', {}, h('div', { class: 'seen' }, d.fields[i][1]), field(`${d.key}.${d.fields[i][0]}`, d.fields[i][0] === 's' ? 'senior' : 'junior')) : null))))))),
    h('p', { class: 'hint' }, 'AOCC, AIC, AH OT and ECT are on the Roster tab.'));
}

// ----- monthly tab -----

// A name as written on a monthly roster ("Quah Zi Hui, Bernice", "LOKE BENJAMIN") -> person
const personCache = new Map();
// A monthly roster name that matches more than one person: their names, else null.
function ambiguousText(text) {
  const t = cleanCell(text);
  if (!t || personByText(t)) return null;
  const m = matchName(t, state.staff);
  return m.ambiguous?.length ? m.ambiguous.map(p => p.name) : null;
}
const unmatchedTitle = v => { const a = ambiguousText(v); return a ? `Could be ${a.join(' or ')}: type more of the name` : 'Not matched to the staff list'; };
function personByText(text) {
  const t = cleanCell(text);
  if (!t) return null;
  if (!personCache.has(t)) {
    const m = matchName(t, state.staff);
    personCache.set(t, m.person || matchName(cleanContactName(t), state.staff).person || null);
  }
  return personCache.get(t);
}

// What the monthly rosters say about everyone on a date: id -> { status, why, liver }
function derivedFor(date) {
  const out = new Map();
  const at = p => out.get(p.id) || out.set(p.id, {}).get(p.id);
  for (const e of leaveOn(state.monthly, date)) {
    const p = personByText(e.name);
    if (p) Object.assign(at(p), /medical/i.test(e.type) ? { status: 'mc', why: e.type } : { status: 'leave', why: e.type || 'Leave' });
  }
  const prev = dutiesOn(state.monthly, addDays(date, -1));
  for (const key of state.settings.nightDuties || NIGHT_DUTIES) {
    const [kind, col] = key.split('.');
    const p = personByText(prev[kind]?.[col]);
    if (p && !at(p).status) Object.assign(at(p), { status: 'postcall', why: `${monthlyDef(kind)?.cols.find(c => c.key === col)?.label} yesterday` });
  }
  const today = dutiesOn(state.monthly, date);
  for (const def of MONTHLY) for (const c of def.cols) if (c.liver) { const p = personByText(today[def.id]?.[c.key]); if (p) at(p).liver = true; }
  return out;
}
const prevWorkingDay = date => { let d = addDays(date, -1); while ([0, 6].includes(new Date(d + 'T12:00:00').getDay())) d = addDays(d, -1); return d; };
const hasMonthly = () => Object.keys(state.monthly || {}).length > 0;

// Bring the day's manpower in line with the monthly rosters. Anything set by hand stays.
function syncMonthly() {
  if (!hasMonthly() || !state.day?.date) return;
  const now = derivedFor(state.day.date);
  const before = derivedFor(prevWorkingDay(state.day.date));
  for (const p of state.staff) {
    const r = now.get(p.id) || {};
    const s = { ...(state.day.staff[p.id] || {}) };
    if (!s.manual) {
      if (r.status) { s.status = r.status; s.auto = r.why; }
      else if (s.auto) { s.status = 'avail'; delete s.auto; }
    }
    if (!s.manualLiver) {
      if (r.liver) { s.liverStandby = true; s.autoLiver = true; } else if (s.autoLiver) { s.liverStandby = false; delete s.autoLiver; }
    }
    if (p.role === 'junior' && !s.manualAway) {
      const away = ['leave', 'mc', 'postcall'].includes(before.get(p.id)?.status);
      if (away) { s.notAroundPrev = true; s.autoAway = true; } else if (s.autoAway) { s.notAroundPrev = false; delete s.autoAway; }
    }
    if (Object.keys(s).length && JSON.stringify(s) !== JSON.stringify(state.day.staff[p.id] || {})) state.day.staff[p.id] = s;
  }
}

const MONTHLY_VIEWS = [['today', 'Today'], ['pain', 'Pain Monthly'], ['liver', 'Liver Monthly'], ['leave', 'Leave Monthly'], ['aoh', 'AOH Monthly'], ['junior', 'Junior Monthly'], ['senior', 'Senior Monthly'], ['rotations', 'Rotations']];
function renderMonthly() {
  const view = MONTHLY_VIEWS.some(v => v[0] === state.monthlyView) ? state.monthlyView : 'today';
  const tabs = h('div', { class: 'seg subtabs', role: 'group', 'aria-label': 'Monthly' }, MONTHLY_VIEWS.map(([k, label]) =>
    h('button', { 'aria-pressed': String(view === k), onclick: () => { state.monthlyView = k; render(); } }, label)));
  return h('div', {}, tabs, view === 'today' ? renderToday() : view === 'rotations' ? renderRotations() : renderMonthlyRoster(view));
}

// ---- My day: where one person is on the day on screen (viewers' page; anyone at #myday) ----

// My day opens on today until early afternoon (people check it in the morning), then on tomorrow.
const MYDAY_SWITCH_HOUR = 14;
const myDayDate = () => new Date().getHours() < MYDAY_SWITCH_HOUR ? realToday() : today();
// On opening: My day goes to myDayDate(); the roster leaves a past date for tomorrow (the day being made),
// with a way back. Today is left alone, for morning changes.
function openOnTheRightDay() {
  const was = state.day.date;
  if (state.tab === 'myday') { if (myDayDate() !== was) switchDate(myDayDate()); return; }
  if (isViewer() || !state.staff.length || !was || was >= realToday()) return;
  switchDate(today());
  toast(`Opened tomorrow, ${longDate(today())}.`, { label: `Back to ${longDate(was)}`, run: () => switchDate(was) });
}
// What this person saw last time on each date, to mark what changed since: { date: { at, lines } }
const SEEN_KEY = 'nuh-roster-seen';
function seenBefore(date, pid) {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}')[date + '|' + pid] || null; } catch { return null; }
}
function markSeen(date, pid, at, lines) {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    all[date + '|' + pid] = { at, lines };
    const keys = Object.keys(all).sort(); // keep the last 60 entries
    for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete all[k];
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch { /* no storage */ }
}
let seenCache = { id: '', prev: null };
const hhmm = t => t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
// a viewer coming back to the page after a while gets the latest saved roster
let viewerLoadedAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isViewer() && state.tab === 'myday' && Date.now() - viewerLoadedAt > 60e3) viewerLoad(state.day.date);
});

const ME_KEY = 'nuh-roster-me';
let viewerDate = null, viewerFound = null;
// A viewer sees the roster saved for the team, never a local draft.
let viewerMeta = null; // { updatedAt, updatedBy } of the roster on screen
async function viewerLoad(date) {
  viewerDate = date; viewerFound = null; viewerLoadedAt = Date.now();
  try {
    const snap = await cloud.loadRoster(date);
    if (viewerDate !== date) return;
    viewerFound = !!snap?.roster;
    viewerMeta = snap ? { updatedAt: snap.updatedAt, updatedBy: snap.updatedBy } : null;
    state.day = snap?.day ? { ...clone(snap.day), date } : { date, rooms: [], staff: {} };
    state.roster = snap?.roster ? clone(snap.roster) : null;
    syncRooms();
  } catch (e) { if (viewerDate === date) viewerFound = 'failed'; cloudError(e); }
  render();
}
// Who "my" is: the staff record an admin linked to this account, else the name picked in this browser, else a guess
// from the member's name (myPersonGuessed says so, so My day can ask to confirm).
let myPersonGuessed = false;
function myPerson() {
  myPersonGuessed = false;
  let id = '';
  try { id = localStorage.getItem(ME_KEY) || ''; } catch { /* no storage */ }
  const linked = cs.member?.staffId && person(cs.member.staffId);
  if (linked) return linked;
  if (person(id)) return person(id);
  const guess = cs.member?.name ? matchName(cs.member.name, state.staff).person : null;
  myPersonGuessed = !!guess;
  return guess || null;
}
// Everything the roster says about p on the day on screen: [what, detail] lines.
function dayLines(p) {
  const out = [];
  const d = state.day.staff[p.id] || {};
  const off = { leave: 'On leave', mc: 'On MC', postcall: 'Post call', admin: 'Admin day (no list)' }[d.status || 'avail'];
  if (off) out.push([off, d.auto || '']);
  const r = state.roster && state.roster.date === state.day.date ? state.roster : null;
  if (r) for (const row of r.rows) {
    const room = row.label;
    for (const [key, role] of [['senior', 'Senior'], ['junior', 'Junior']]) for (const part of cellParts(row, key)) {
      if (personOfPart(part) !== p) continue;
      const cover = isCoverPart(part);
      const other = cellParts(row, key === 'senior' ? 'junior' : 'senior').filter(x => !isCoverPart(x)).map(x => shortOf(x)).join(' / ');
      const parsed = parseNamePart(part);
      out.push([`${room}${cover ? ' (ad hoc cover)' : ''}`, [role, other ? `with ${other}` : '', row.notes ? `· ${row.notes}` : '', parsed.leave ? `· leaving ${parsed.leave}` : '', parsed.cover ? `· also covers ${parsed.cover}` : ''].filter(Boolean).join(' '),
        { room, role, with: other, notes: row.notes || '', senior: key === 'junior' ? other : '' }]);
    }
    for (const part of cellParts(row, 'premed')) if (personOfPart(part) === p) out.push([`Premed for ${room}`, row.notes || '']);
  }
  const g = effectiveGeneral();
  for (const [label, key] of generalFields()) {
    const names = String(g[key] || '').split('/').flatMap(namesInCell);
    if (names.some(n => matchName(n, state.staff).person === p)) out.push([label.replace(' · ', ': '), '']);
  }
  if (d.comment) out.push(['Note', d.comment]);
  return out;
}
// What the roster says about p on another date: that date's saved day (this browser's, or the team's for a viewer),
// else what the monthly rosters say (leave, calls, clinics). rec: { day, roster } or null.
function linesOn(p, date, rec) {
  const keep = [state.day, state.roster];
  try {
    state.day = rec?.day ? { ...rec.day, date } : { date, rooms: [], staff: {} };
    state.roster = rec?.roster ? { ...rec.roster, date } : null;
    if (!rec?.day) { const r = derivedFor(date).get(p.id); if (r?.status) state.day.staff[p.id] = { status: r.status, auto: r.why }; }
    return dayLines(p);
  } finally { [state.day, state.roster] = keep; }
}
const weekDates = from => Array.from({ length: 7 }, (_, i) => addDays(from, i));
let weekOpen = false, weekRecs = {}; // date -> { day, roster } or null (viewers: from the cloud, loaded on asking)
async function loadWeek() {
  const dates = weekDates(realToday());
  if (isViewer()) {
    const got = await Promise.all(dates.map(d => weekRecs[d] !== undefined ? weekRecs[d] : cloud.loadRoster(d).catch(() => null)));
    dates.forEach((d, i) => { weekRecs[d] = got[i]?.roster ? { day: got[i].day, roster: got[i].roster } : null; });
  } else for (const d of dates) weekRecs[d] = d === state.day.date ? { day: state.day, roster: state.roster } : state.days?.[d] || null;
  render();
}
// A day's lines as one calendar event: the room (or leave, a call) as the title, everything as the details.
const eventOf = (p, date, lines) => lines.length ? { date, uid: `${date}-${p.id}@nuhroster.anawj.com`,
  title: lines.map(l => l[0]).slice(0, 2).join(' + '), details: lines.map(l => l[1] ? `${l[0]}: ${l[1]}` : l[0]).join('\n') } : null;
function downloadIcs(p, events, name) {
  const list = events.filter(Boolean);
  if (!list.length) return toast('Nothing on the roster to add yet.');
  download(name, new Blob([buildIcs(list)], { type: 'text/calendar' }));
  toast(`Calendar file downloaded (${list.length} day${list.length === 1 ? '' : 's'}). Open it to add to your calendar.`);
}
// For the logbook's case summary: the facts of one list, to paste (nothing is sent to the logbook).
async function copyForLogbook(date, meta) {
  const text = [`Date: ${longDate(date)}`, `Room: ${meta.room}`, meta.senior ? `Supervisor: ${meta.senior}` : meta.with ? `With: ${meta.with}` : '', meta.notes ? `Cases: ${meta.notes}` : ''].filter(Boolean).join('\n');
  try { await navigator.clipboard.writeText(text); toast('Copied for the logbook: paste it into the case summary.'); }
  catch { prompt('Copy this for the logbook:', text.replace(/\n/g, ' · ')); }
}
function weekCard(p) {
  if (!weekOpen) return null;
  const dates = weekDates(realToday());
  if (!dates.every(d => d in weekRecs)) return h('p', { class: 'seen' }, 'Loading the week…');
  const days = dates.map(d => ({ d, lines: linesOn(p, d, weekRecs[d]), out: !!weekRecs[d]?.roster }));
  return h('div', { class: 'myweek' },
    h('h3', {}, 'My week'),
    h('ul', { class: 'myweek-list' }, days.map(x => h('li', {},
      h('button', { class: 'link', onclick: () => switchDate(x.d) }, new Date(x.d + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })),
      ' ', x.lines.length ? x.lines.map(l => l[0]).join(' · ') : h('span', { class: 'seen' }, x.out ? 'not on the roster' : 'roster not out yet'),
      !x.out && x.lines.length ? h('span', { class: 'seen' }, ' (from the monthly rosters)') : null))),
    h('button', { class: 'small', onclick: () => downloadIcs(p, days.map(x => eventOf(p, x.d, x.lines)), `My week from ${realToday()}.ics`) }, 'Add the week to my calendar'));
}
function renderMyDay() {
  const p = myPerson();
  const date = state.day.date;
  const linked = !!(cs.member?.staffId && person(cs.member.staffId));
  const pick = linked ? h('span', { class: 'seen', title: 'An admin linked your account to this name (Settings › Team members)' }, 'your account')
    : select(p?.id || '', [['', 'Pick your name…'], ...state.staff.slice().sort((a, b) => a.name.localeCompare(b.name)).map(x => [x.id, x.name])],
      v => { try { localStorage.setItem(ME_KEY, v); } catch { /* no storage */ } render(); });
  const r = state.roster && state.roster.date === date ? state.roster : null;
  const lines = p ? dayLines(p) : [];
  const when = date === today() ? 'Tomorrow' : date === realToday() ? 'Today' : longDate(date);
  // what changed for this person since they last looked (viewers, from the saved roster's time)
  const meta = isViewer() ? viewerMeta : null;
  const key = l => l.join(' ');
  // what they saw before this version, read once per version (later renders keep the marks)
  const seenId = p && meta?.updatedAt && viewerFound === true ? `${date}|${p.id}|${meta.updatedAt}` : '';
  if (seenId && seenCache.id !== seenId) {
    seenCache = { id: seenId, prev: seenBefore(date, p.id) };
    markSeen(date, p.id, meta.updatedAt, lines.map(key));
  }
  const seen = seenId && seenCache.prev?.at !== meta.updatedAt ? seenCache.prev : null;
  const changed = seen ? new Set(lines.map(key).filter(k => !seen.lines.includes(k))) : new Set();
  const gone = seen ? seen.lines.filter(k => !lines.some(l => key(l) === k)) : [];
  return h('div', {},
    h('section', { class: 'card myday' },
      h('div', { class: 'section-head' }, h('h2', { style: 'margin:0' }, p ? `${when} for ${shortName(p) || p.name}` : 'My day'), h('span', { class: 'grow' }),
        pick),
      p && myPersonGuessed ? h('p', { class: 'warn-note' }, `Matched to ${p.name} from your account's name. Not you? Pick your name above.`) : null,
      !p ? h('p', { class: 'hint' }, 'Pick your name once; this browser remembers it.')
        : !state.staff.length ? h('p', { class: 'hint' }, 'Loading the staff list…')
        : !r && !lines.length ? h('p', { class: 'empty' }, isViewer() && viewerFound === 'failed' ? 'Couldn\'t load the roster. Check your signal, then open My day again.' : isViewer() && viewerFound === null ? 'Loading…' : `The roster for ${longDate(date)} isn't out yet.`)
        : lines.length ? h('ul', { class: 'myday-list' }, lines.map(l => h('li', { class: changed.has(key(l)) ? 'changed' : null }, h('b', {}, l[0]), l[1] ? h('span', {}, ' ', l[1]) : null, changed.has(key(l)) ? h('span', { class: 'new-tag' }, ' changed') : null,
          l[2]?.room ? h('button', { class: 'small logbook-copy', title: 'Date, room, supervisor and case notes, to paste into the logbook', onclick: () => copyForLogbook(date, l[2]) }, 'Copy for logbook') : null)))
        : h('p', { class: 'empty' }, `You're not on the roster for ${longDate(date)}.`),
      changed.size || gone.length ? h('p', { class: 'warn-note', role: 'status' }, `Changed since you last looked${gone.length ? ` (no longer: ${gone.join('; ')})` : ''}.`) : null,
      p ? h('div', { class: 'bar myday-actions' },
        lines.length ? h('button', { class: 'small', onclick: () => downloadIcs(p, [eventOf(p, date, lines)], `My day ${date}.ics`) }, 'Add to calendar') : null,
        h('button', { class: 'small', 'aria-expanded': String(weekOpen), onclick: () => { weekOpen = !weekOpen; if (weekOpen) { weekRecs = {}; loadWeek(); } else render(); } }, weekOpen ? 'Hide my week' : 'My week')) : null,
      p ? weekCard(p) : null,
      meta?.updatedAt && viewerFound === true ? h('p', { class: 'seen' }, `Saved by ${meta.updatedBy?.name || 'the rosterer'} at ${hhmm(meta.updatedAt)}${new Date(meta.updatedAt).toDateString() !== new Date().toDateString() ? `, ${longDate(isoDate(new Date(meta.updatedAt)))}` : ''}. `,
        h('button', { class: 'link', onclick: () => viewerLoad(date) }, 'Check again')) : null,
      p && r && postingOf(p) && p.role === 'junior' ? h('p', { class: 'seen' }, `Posting this week: ${postingName(postingOf(p))}`) : null,
      h('p', { class: 'hint' }, 'Add it to your home screen (browser menu › Add to Home Screen): it opens here and works with poor signal. Or bookmark ', h('code', {}, location.origin + location.pathname + '#myday'),
        isViewer() ? null : [' · ', h('button', { class: 'link', onclick: () => { history.replaceState(null, '', location.pathname); goTab('roster'); } }, 'Back to the roster')])),
    r ? renderSheet() : null);
}

// ---- rotations: each junior's posting by week, planned for the year ----

let rotYear = null; // the year on screen
let rotSel = null;  // selected cells: { a: [row, col], b: [row, col] } (a rectangle)
let rotNotes = [];  // what the last import couldn't place
let rotUnmatched = []; // names in the last import not on the junior list
let rotScroll = null; // where the grid was scrolled to, kept across re-renders
const ROT_SHORT = { Cardiac: 'Card', Remote: 'Rem' }; // to fit a week's cell
const pushRotUndo = what => pushUndo({ rot: JSON.stringify(state.rotations), what });
const fillOf = code => POSTING_FILL[code] ? '#' + POSTING_FILL[code].slice(2) : '';

function renderRotations() {
  const year = rotYear ||= +state.day.date.slice(0, 4);
  const weeks = weeksOfYear(year);
  const now = mondayOf(state.day.date);
  const people = state.staff.filter(p => p.role === 'junior')
    .filter(p => !staffFilter || (p.name + ' ' + (p.aliases || []).join(' ')).toLowerCase().includes(staffFilter.toLowerCase()))
    .sort(bySeniority);
  const rot = state.rotations;
  const sel = rotSel && (() => {
    const [r1, r2] = [rotSel.a[0], rotSel.b[0]].sort((x, y) => x - y), [c1, c2] = [rotSel.a[1], rotSel.b[1]].sort((x, y) => x - y);
    return { r1, r2, c1, c2 };
  })();
  const inSel = (r, c) => sel && r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2;
  const apply = code => {
    if (!sel) return;
    pushRotUndo('the rotation change');
    for (let r = sel.r1; r <= sel.r2; r++) setWeeks(rot, people[r].id, weeks.slice(sel.c1, sel.c2 + 1), code);
    const n = (sel.r2 - sel.r1 + 1) * (sel.c2 - sel.c1 + 1);
    rotSel = null; render();
    undoToast(code == null ? `Cleared ${n} week${n > 1 ? 's' : ''} (back to the usual posting).` : `Set ${n} week${n > 1 ? 's' : ''} to ${postingName(code)}.`);
  };
  // select with a click, shift-click to extend, or drag across the grid
  let dragging = false;
  const cellDown = (e, r, c) => {
    e.preventDefault();
    rotSel = e.shiftKey && rotSel ? { a: rotSel.a, b: [r, c] } : { a: [r, c], b: [r, c] };
    dragging = true;
    const up = () => { dragging = false; window.removeEventListener('pointerup', up); render(); };
    window.addEventListener('pointerup', up);
    refreshSel();
  };
  const cellEnter = (r, c) => { if (dragging) { rotSel.b = [r, c]; refreshSel(); } };
  function refreshSel() {
    const [r1, r2] = [rotSel.a[0], rotSel.b[0]].sort((x, y) => x - y), [c1, c2] = [rotSel.a[1], rotSel.b[1]].sort((x, y) => x - y);
    app.querySelectorAll('td.wk').forEach(td => { const r = +td.dataset.r, c = +td.dataset.c; td.classList.toggle('sel', r >= r1 && r <= r2 && c >= c1 && c <= c2); });
  }

  // the month labels over the weeks
  const monthHead = [];
  weeks.forEach((m, i) => {
    const mo = +m.slice(5, 7), y = +m.slice(0, 4);
    const last = monthHead.at(-1);
    if (last && last.mo === mo && last.y === y) last.span++; else monthHead.push({ mo, y, span: 1 });
  });
  const counts = {};
  for (const p of state.staff.filter(x => x.role === 'junior')) { const c = weekPosting(rot, p.id, now) ?? p.posting ?? ''; counts[c] = (counts[c] || 0) + 1; }
  const selCount = sel ? (sel.r2 - sel.r1 + 1) * (sel.c2 - sel.c1 + 1) : 0;

  return h('div', {},
    h('section', { class: 'card' },
      h('div', { class: 'section-head' },
        h('button', { class: 'small', 'aria-label': 'Previous year', onclick: () => { rotYear--; rotSel = null; rotScroll = null; render(); } }, '‹'),
        h('h2', { style: 'display:inline; margin:0 8px' }, `Rotations · ${year}`),
        h('button', { class: 'small', 'aria-label': 'Next year', onclick: () => { rotYear++; rotSel = null; rotScroll = null; render(); } }, '›'),
        h('span', { class: 'grow' }),
        fileButton('Import rotation (Excel)', '.xlsx,.csv', false, importRotations),
        h('button', { onclick: exportRotations }, 'Download .xlsx'),
        h('button', { onclick: () => {
          pushRotUndo(`clearing ${year}`);
          for (const m of weeks) delete rot.weeks[m];
          render(); undoToast(`Cleared the ${year} rotation.`);
        } }, 'Clear year'),
        weeksOfYear(year).some(m => state.rotations.weeks[m]) && !weeksOfYear(year + 1).slice(1).some(m => state.rotations.weeks[m])
          ? h('button', { title: `Copy ${year}'s rotation into ${year + 1}, week by week, as a start`, onclick: () => fillNextYear(year) }, `Start ${year + 1} from ${year}`) : null),
      h('p', { class: 'hint' }, 'Each column is a week (Monday to Sunday). Select weeks by clicking, shift-clicking or dragging (across people too), then pick the posting. Blank weeks use the usual posting. To change someone\'s posting for one day only, open them from Today or the roster and use "Posting today". The Excel file has names down the first column and each week\'s Monday across the top; Download gives you one to fill in.'),
      fixNamesCard(rotUnmatched, { role: 'junior', what: 'the rotation file', rerun: lastRotFile ? () => importRotations([lastRotFile]) : null, dismiss: () => { rotUnmatched = []; render(); } }),
      rotNotes.length ? h('ul', { class: 'warnings' }, rotNotes.map(t => h('li', { class: 'warn' }, t)), h('li', { class: 'info' }, h('button', { class: 'link', onclick: () => { rotNotes = []; render(); } }, 'Dismiss'))) : null,
      h('div', { class: 'stats' }, h('span', {}, `Week of ${longDate(now)}:`), POSTINGS.filter(([k]) => counts[k]).map(([k, label]) => h('span', {}, h('b', {}, counts[k]), ' ', k ? label : 'no posting'))),
      h('div', { class: 'rot-palette' + (selCount ? '' : ' idle') },
        h('span', { class: 'seen' }, selCount ? `${selCount} week${selCount > 1 ? 's' : ''} selected:` : 'Select weeks, then pick:'),
        POSTINGS.filter(([k]) => k).map(([k, label]) => h('button', { class: 'small post', disabled: !selCount, style: `background:${fillOf(k)}`, title: label, onclick: () => apply(k) }, k)),
        h('button', { class: 'small', disabled: !selCount, title: 'Back to the usual posting', onclick: () => apply(null) }, 'Usual'),
        h('span', { class: 'grow' }),
        h('input', { placeholder: 'Filter names', value: staffFilter, oninput: e => { staffFilter = e.target.value; rotSel = null; const pos = e.target.selectionStart; render(); const i = app.querySelector('.rot-palette input'); i.focus(); i.setSelectionRange(pos, pos); } }))),
    h('section', { class: 'card scroll rot-wrap', onscroll: e => { rotScroll = e.target.scrollLeft; } },
      people.length ? h('table', { class: 'rot' },
        h('thead', {},
          h('tr', {}, h('th', { class: 'who' }), h('th', { class: 'usual' }), monthHead.map(x => h('th', { class: 'mon', colspan: x.span }, `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.mo - 1]}${x.y !== year ? ' ' + x.y : ''}`))),
          h('tr', {}, h('th', { class: 'who' }, 'Name'), h('th', { class: 'usual' }, 'Usual'), weeks.map(m => h('th', { class: 'day' + (m === now ? ' now' : ''), title: `Week of ${longDate(m)}` }, +m.slice(8))))),
        h('tbody', {}, people.map((p, r) => h('tr', {},
          h('td', { class: 'who' }, personChip(p, { onclick: e => openPersonBox(e.currentTarget, p, { kind: 'view' }) })),
          h('td', { class: 'usual' }, select(p.posting || '', POSTINGS.map(([k, l]) => [k, k || '—']), v => { p.posting = v; render(); })),
          weeks.map((m, c) => {
            const code = weekPosting(rot, p.id, m);
            const shown = code ?? p.posting ?? '';
            return h('td', { class: 'wk' + (code == null ? ' usual' : '') + (m === now ? ' now' : '') + (inSel(r, c) ? ' sel' : ''), 'data-r': r, 'data-c': c,
              style: shown ? `background:${fillOf(shown)}` : '', title: `${p.name} · week of ${longDate(m)}: ${postingName(shown) || 'no posting'}${code == null ? ' (usual)' : ''}`,
              onpointerdown: e => cellDown(e, r, c), onpointerenter: () => cellEnter(r, c) }, ROT_SHORT[shown] || shown);
          })))),
        rotCountsFoot(weeks, people, rot, now)) : h('p', { class: 'empty' }, state.staff.length ? 'No juniors match.' : 'Add the staff list first.')));
}
// Under the grid: how many juniors are on each posting, week by week, so a week with nobody on a posting shows up.
function rotCountsFoot(weeks, people, rot, now) {
  const on = (p, m) => weekPosting(rot, p.id, m) ?? p.posting ?? '';
  const used = POSTINGS.filter(([k]) => k && people.some(p => weeks.some(m => on(p, m) === k)));
  if (!used.length) return null;
  return h('tfoot', {}, used.map(([k, label]) => h('tr', { class: 'rot-count' },
    h('th', { class: 'who', scope: 'row' }, label), h('th', { class: 'usual' }, k),
    weeks.map(m => { const n = people.filter(p => on(p, m) === k).length; return h('td', { class: 'wk' + (n ? '' : ' none') + (m === now ? ' now' : ''), title: `Week of ${longDate(m)}: ${n} on ${label}` }, n || '0'); }))));
}
// A new year starts empty: copy this year's pattern across, week by week (week 1 to week 1…), with Undo.
function fillNextYear(year) {
  const from = weeksOfYear(year), to = weeksOfYear(year + 1);
  pushRotUndo(`starting ${year + 1} from ${year}`);
  let n = 0;
  to.forEach((m, i) => {
    const src = state.rotations.weeks[from[Math.min(i, from.length - 1)]];
    if (!src || from[Math.min(i, from.length - 1)] === m) return; // the shared boundary week stays
    for (const [id, code] of Object.entries(src)) if (weekPosting(state.rotations, id, m) == null) { setWeeks(state.rotations, id, [m], code); n++; }
  });
  rotYear = year + 1; rotScroll = 0;
  render();
  undoToast(`Started ${year + 1} from ${year}'s pattern (${n} weeks set). Change what differs, or Undo.`);
}

// keep the grid where it was, or open it on the week on screen
function placeRotGrid() {
  const w = app.querySelector('.rot-wrap'), now = w?.querySelector('th.day.now');
  if (!w) return;
  w.scrollLeft = rotScroll ?? (now ? Math.max(0, now.offsetLeft - w.clientWidth / 2) : 0);
}

async function importRotations([file]) {
  lastRotFile = file;
  try {
    const wb = await readWorkbook(file);
    const year = rotYear || +state.day.date.slice(0, 4);
    const person = name => { const p = personByText(name); return p?.role === 'junior' ? p : null; };
    let res = null;
    for (const ws of wb.worksheets) { const r = readRotationSheet(ws, cellText, person, year); if (!r.error) { res = r; break; } res ||= r; }
    if (res.error) return toast(res.error);
    pushRotUndo('the rotation import');
    // the weeks and people in the file are set exactly as the file has them (blank = usual posting)
    for (const m of res.mondays) for (const id of res.people) setWeeks(state.rotations, id, [m], res.weeks[m]?.[id] ?? null);
    rotUnmatched = res.unmatched;
    rotNotes = [
      ...(res.unknown.length ? [`Not a posting (left out): ${res.unknown.map(t => `"${t}"`).join(', ')}. Postings are ${POSTINGS.filter(([k]) => k).map(([k, l]) => l).join(', ')}.`] : []),
    ];
    const first = res.mondays.slice().sort()[0];
    if (first) rotYear = +first.slice(0, 4);
    render();
    undoToast(`${file.name}: ${res.people.length} people over ${res.mondays.length} weeks.`);
  } catch (e) { console.error(e); toast(`Couldn't read ${file.name}.`); }
}

async function exportRotations() {
  const year = rotYear || +state.day.date.slice(0, 4);
  const people = state.staff.filter(p => p.role === 'junior').sort(bySeniority);
  const wb = buildRotationWorkbook(await excel(), { year, people, rot: state.rotations });
  download(`Junior rotations ${year}.xlsx`, new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

// ---- today: who is where, then the calls and clinics ----

const BOARD = [['working', 'Working'], ['leave', 'Leave'], ['mc', 'MC'], ['postcall', 'Post call'], ['admin', 'Admin']];
const groupOf = st => ({ leave: 'leave', mc: 'mc', postcall: 'postcall', admin: 'admin' })[st || 'avail'] || 'working';
let boardRole = 'all', boardFilter = '';
// Several days at once: { pid, from, until, status, comment } in state.carry. Saving with "Same until" keeps
// one entry per person starting today; clearing the date ends it today. New days pick them up (applyCarry).
function setCarry(p, untilDate, group, comment) {
  const date = state.day.date;
  const list = state.carry ||= [];
  const i = list.findIndex(c => c.pid === p.id && c.from <= date && date <= c.until);
  if (!untilDate || untilDate <= date) {
    if (i >= 0) { if (list[i].from < date) list[i].until = addDays(date, -1); else list.splice(i, 1); }
    return;
  }
  const entry = { pid: p.id, from: i >= 0 ? list[i].from : date, until: untilDate, status: group === 'working' ? '' : group, comment };
  if (i >= 0) list[i] = entry; else list.push(entry);
  // keep only what still matters
  state.carry = list.filter(c => c.until >= addDays(realToday(), -1));
}
// On a day being opened: anything carried over it goes in, unless that day was changed by hand for the person
// or a monthly roster already says leave, MC or post call. d.carried records what was put in, so a carry that is
// ended, shortened or changed takes it back out again.
function applyCarry(day) {
  const covering = pid => (state.carry || []).find(c => c.pid === pid && c.from < day.date && day.date <= c.until);
  for (const [pid, d] of Object.entries(day.staff || {})) {
    if (!d.carried) continue;
    const was = d.carried === true ? { status: d.status } : d.carried, c = covering(pid);
    if (c && (c.status || '') === (was.status || '') && (c.comment || '') === (was.comment || '')) continue;
    if (was.status && d.status === was.status) d.status = 'avail';
    if (was.comment && d.comment === was.comment) delete d.comment;
    delete d.carried;
  }
  for (const c of state.carry || []) {
    if (!(c.from < day.date && day.date <= c.until)) continue;
    const d = (day.staff[c.pid] ||= {});
    if (d.carried || d.manual) continue;
    const put = {};
    if (c.status && (!d.status || d.status === 'avail')) { d.status = c.status; put.status = c.status; }
    if (c.comment && !d.comment) { d.comment = c.comment; put.comment = c.comment; }
    if (put.status || put.comment) d.carried = put;
  }
}
function setStatus(p, group, { quiet = false } = {}) {
  const s = dayOf(p.id);
  const was = groupOf(s.status);
  s.status = group === 'working' ? (s.status === 'elsewhere' ? 'elsewhere' : 'avail') : group;
  s.manual = true;
  delete s.auto;
  delete s.carried; // a hand change wins over a status carried from another day
  if (state.roster && was !== group) logRoster([`${p.name}: ${BOARD.find(b => b[0] === was)[1]} → ${BOARD.find(b => b[0] === group)[1]}`]);
  if (!quiet) render();
}
// Today › Manpower: tick several people, then move them all at once
let boardPick = null; // Set of staff ids while selecting, else null
function moveMany(ids, group) {
  const people = [...ids].map(person).filter(Boolean);
  if (!people.length) return;
  pushUndoAll(`moving ${people.length} to ${BOARD.find(b => b[0] === group)[1]}`, { day: true });
  for (const p of people) setStatus(p, group, { quiet: true });
  boardPick = null;
  render();
  undoToast(`Moved ${people.length} ${people.length > 1 ? 'people' : 'person'} to ${BOARD.find(b => b[0] === group)[1]}.`);
}
function manpowerBoard() {
  const people = state.staff
    .filter(p => boardRole === 'all' || p.role === boardRole)
    .filter(p => !boardFilter || (p.name + ' ' + (p.aliases || []).join(' ')).toLowerCase().includes(boardFilter.toLowerCase()))
    .sort(bySeniority);
  const chip = p => {
    const s = state.day.staff[p.id] || {};
    return personChip(p, {
      class: 'name pchip board-chip' + (s.manual ? ' manual' : '') + (p.role === 'senior' ? ' senior' : '') + (boardPick?.has(p.id) ? ' picked' : ''), draggable: TOUCH || boardPick ? null : 'true',
      title: `${p.name} · ${p.grade}${s.manual ? ' · set by hand' : s.auto ? ` · ${s.auto}` : ''}${s.status === 'elsewhere' ? ' · elsewhere (calls/clinics)' : ''}`,
      ondragstart: e => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; },
      onclick: e => {
        if (!boardPick) return openPersonBox(e.currentTarget, p, { kind: 'today' });
        if (boardPick.has(p.id)) boardPick.delete(p.id); else boardPick.add(p.id);
        render();
      },
    });
  };
  const col = ([key, label]) => {
    const list = people.filter(p => groupOf(state.day.staff[p.id]?.status) === key);
    return h('div', { class: 'board-col', 'data-group': key,
      ondragover: e => { e.preventDefault(); e.currentTarget.classList.add('over'); },
      ondragleave: e => e.currentTarget.classList.remove('over'),
      ondrop: e => { e.preventDefault(); e.currentTarget.classList.remove('over'); const p = person(e.dataTransfer.getData('text/plain')); if (p && groupOf(state.day.staff[p.id]?.status) !== key) { pushUndoAll(`moving ${p.name}`, { day: true }); setStatus(p, key); } } },
      h('h3', {}, label, h('span', { class: 'seen' }, ` ${list.length}`)),
      h('div', { class: 'pool-names' }, list.map(chip)));
  };
  const manualCount = Object.values(state.day.staff).filter(s => s.manual || s.manualLiver || s.manualAway).length;
  return h('section', { class: 'card' },
    h('h2', {}, 'Manpower'),
    h('p', { class: 'hint' }, (TOUCH ? 'Tap a name to move them or change their day (leaving time, (L), comment). ' : 'Drag a name to another group, or click it to change their day (leaving time, (L), comment). ')
      + (hasMonthly() ? 'Leave, MC and post call come from the Leave, Junior and Senior rosters; anything you move by hand stays (bold border).' : 'Import the monthly rosters to fill leave, MC and post call automatically.')),
    h('div', { class: 'bar' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Who' }, [['all', 'Everyone'], ['senior', 'Seniors'], ['junior', 'Juniors']].map(([k, l]) =>
        h('button', { 'aria-pressed': String(boardRole === k), onclick: () => { boardRole = k; render(); } }, l))),
      h('button', { 'aria-pressed': String(!!boardPick), title: 'Tap several names, then pick where they all go', onclick: () => { boardPick = boardPick ? null : new Set(); render(); } }, boardPick ? 'Done selecting' : 'Select several'),
      manualCount && hasMonthly() ? h('button', { onclick: () => {
        pushUndoAll('the reset to monthly rosters', { day: true });
        for (const s of Object.values(state.day.staff)) {
          if (s.manualLiver && !s.autoLiver) s.liverStandby = false;
          if (s.manualAway && !s.autoAway) s.notAroundPrev = false;
          delete s.manual; delete s.manualAway; delete s.manualLiver; if (!s.auto) s.status = 'avail';
        }
        render();
        undoToast(`Back to the monthly rosters (${manualCount} change${manualCount > 1 ? 's' : ''} by hand undone).`);
      } }, 'Reset to monthly rosters') : null,
      h('span', { class: 'grow' }),
      h('input', { placeholder: 'Filter names', value: boardFilter, oninput: e => { boardFilter = e.target.value; const pos = e.target.selectionStart; render(); const i = app.querySelector('.card input[placeholder="Filter names"]'); i.focus(); i.setSelectionRange(pos, pos); } })),
    boardPick ? h('div', { class: 'pick-bar' },
      h('span', {}, boardPick.size ? `${boardPick.size} selected. Move to:` : 'Tap names to select them.'),
      BOARD.map(([k, label]) => h('button', { class: 'small', disabled: !boardPick.size, onclick: () => moveMany(boardPick, k) }, label)),
      boardPick.size ? h('button', { class: 'small link', onclick: () => { boardPick.clear(); render(); } }, 'Clear') : null) : null,
    state.staff.length ? h('div', { class: 'board' }, BOARD.map(col)) : nextStep('Nobody here yet: add the staff list first.', 'Go to Staff', 'staff'));
}

// The day's other duties from the monthly rosters (AOH, liver team, cardiac and so on)
function monthlyDayCard() {
  if (!hasMonthly()) return null;
  const duty = dutiesOn(state.monthly, state.day.date);
  const items = [];
  for (const def of MONTHLY) for (const c of def.cols) {
    const v = duty[def.id]?.[c.key];
    if (v) items.push([def.label.replace(' Monthly', ''), c.label, v]);
  }
  if (!items.length) return null;
  return h('section', { class: 'card' }, h('details', {},
    h('summary', {}, `From the monthly rosters today (${items.length})`),
    h('table', {}, h('tbody', {}, items.map(([r, c, v]) => h('tr', {}, h('td', { class: 'seen' }, r), h('td', {}, c), h('td', { class: personByText(v) ? '' : 'unmatched', title: personByText(v) ? '' : unmatchedTitle(v) }, v)))))));
}

function renderToday() {
  return h('div', {},
    manpowerBoard(),
    monthlyDayCard(),
    renderGeneral(),
    h('section', { class: 'card' }, h('details', {},
      h('summary', {}, 'More: load the admin draft, paste names from the leave sheet'),
      renderDay('manpower'))));
}

// ---- the monthly roster grids ----

const curMonth = () => state.day.date.slice(0, 7);
const shiftMonth = n => { const d = new Date(state.day.date.slice(0, 7) + '-01T12:00:00'); d.setMonth(d.getMonth() + n); switchDate(d.toISOString().slice(0, 8) + '01'); };
function monthData(kind, month = curMonth(), create = false) {
  const m = state.monthly?.[month]?.[kind];
  if (m || !create) return m;
  return (((state.monthly ||= {})[month] ||= {})[kind] = monthlyDef(kind).list ? { entries: [] } : { rows: {} });
}

let pdfjs = null;
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  await loadVendor('vendor/pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  return (pdfjs = window.pdfjsLib);
}
async function readMonthlyFile(file) {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      pages.push(tc.items.filter(x => x.str.trim()).map(x => ({ str: x.str, x: x.transform[4], y: x.transform[5], w: x.width })));
    }
    return readMonthlyPdf(pages);
  }
  const wb = await readWorkbook(file);
  // the roster may not be on the first sheet: take the first sheet that reads as one
  let first = null;
  for (const ws of wb.worksheets) {
    const res = readMonthlyXlsx(ws, cellText);
    if (!res.error) return res;
    first ||= res;
  }
  return first || { error: `${file.name} has no sheets.` };
}
async function importMonthly(files) {
  const done = [], gaps = [];
  const before = JSON.stringify(state.monthly || {});
  for (const file of files) {
    let res;
    try { res = await readMonthlyFile(file); } catch (e) { res = { error: `Couldn't read ${file.name}: ${e.message}` }; }
    if (res.error) { toast(res.error); continue; }
    const def = monthlyDef(res.kind);
    // a renamed heading leaves its column empty: say so rather than import half a roster quietly
    const missingCols = res.cols ? def.cols.filter(c => !res.cols.includes(c.key)).map(c => c.label) : [];
    if (missingCols.length) gaps.push(`${def.label}: no ${missingCols.join(', ')} column`);
    ((state.monthly ||= {})[res.month] ||= {})[res.kind] = res.data;
    done.push(res);
  }
  if (!done.length) return;
  pushUndo({ mon: before, what: `importing ${done.length === 1 ? 'the ' + monthlyDef(done[0].kind).label : done.length + ' monthly rosters'}` });
  personCache.clear();
  const names = done.flatMap(r => r.data.entries ? r.data.entries.map(e => e.name) : Object.values(r.data.rows).flatMap(Object.values));
  const missing = [...new Set(names.filter(n => !personByText(n)))];
  const last = done.at(-1);
  state.monthlyView = last.kind;
  const msg = `Imported ${done.map(r => `${monthlyDef(r.kind).label} (${monthName(r.month)})`).join(', ')}.${missing.length ? ` ${missing.length} name(s) aren't on the staff list (in red).` : ''}${gaps.length ? ` Check: ${gaps.join('; ')}.` : ''}`;
  render();
  if (last.month !== curMonth()) toast(msg, { label: `Show ${monthName(last.month)}`, run: () => switchDate(last.month + '-01') });
  else undoToast(msg);
}
async function exportMonthly(kind) {
  const wb = buildMonthlyWorkbook(await excel(), kind, curMonth(), monthData(kind) || {});
  const buf = await wb.xlsx.writeBuffer();
  download(`${monthlyDef(kind).label} ${monthName(curMonth())}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

// The month's clashes (monthly.js monthIssues), worked out once per change of the monthly rosters or staff.
let issuesCache = { key: '', list: [] };
function issuesOf(month) {
  const key = month + JSON.stringify([state.monthly?.[month], state.monthly?.[addDays(month + '-01', -1).slice(0, 7)], state.staff.length]);
  if (issuesCache.key !== key) issuesCache = { key, list: monthIssues(state.monthly, month, personByText) };
  return issuesCache.list;
}
// Which monthly rosters are in, for this month and the next: missing ones leave post call, calls or leave out.
function loadedStrip() {
  const m = curMonth(), next = addDays(m + '-28', 7).slice(0, 7);
  const has = (month, def) => def.list ? state.monthly?.[month]?.[def.id]?.entries?.length : Object.keys(state.monthly?.[month]?.[def.id]?.rows || {}).length;
  const line = month => h('div', { class: 'loaded-row' }, h('span', { class: 'seen' }, monthName(month) + ':'),
    MONTHLY.map(def => { const ok = has(month, def); return h('span', { class: 'chip static' + (ok ? ' ok' : ' missing'), title: ok ? 'Loaded' : 'Not loaded yet' }, (ok ? '✓ ' : '– ') + def.label.replace(' Monthly', '')); }));
  return h('div', { class: 'loaded' }, line(m), line(next));
}
// The names in red on a monthly roster, to fix in one go (the alias makes them match at once; nothing to re-read).
let monthlyFixOpen = false;
function monthlyFixNames(kind) {
  const d = monthData(kind);
  if (!d) return null;
  const names = d.entries ? d.entries.map(e => e.name) : Object.values(d.rows || {}).flatMap(Object.values);
  const missing = [...new Set(names.map(cleanCell).filter(n => n && !personByText(n)))];
  if (!missing.length) return null;
  if (!monthlyFixOpen) return h('p', { class: 'hint' }, `${missing.length} name${missing.length > 1 ? 's in red aren\'t' : ' in red isn\'t'} matched to the staff list. `, h('button', { class: 'small', onclick: () => { monthlyFixOpen = true; render(); } }, 'Fix names'));
  return fixNamesCard(missing, { what: 'this roster', rerun: () => { monthlyFixOpen = false; render(); }, dismiss: () => { monthlyFixOpen = false; render(); } });
}
function monthlyBar(kind) {
  const def = monthlyDef(kind);
  const issues = def.list ? [] : issuesOf(curMonth()).filter(i => i.kind === kind);
  const errs = issues.filter(i => i.level === 'error').length, gaps = issues.length - errs;
  const nextIssue = () => {
    const cells = [...app.querySelectorAll('table.monthly td.clash, table.monthly td.gap')];
    if (!cells.length) return;
    const at = cells.findIndex(c => c.contains(document.activeElement));
    const c = cells[(at + 1) % cells.length];
    c.scrollIntoView({ block: 'center', inline: 'center' }); c.querySelector('input')?.focus({ preventScroll: true });
  };
  return h('section', { class: 'card' },
    h('div', { class: 'bar' },
      h('button', { title: 'Previous month', onclick: () => shiftMonth(-1) }, '‹'),
      h('h2', { style: 'margin:0' }, `${def.label} · ${monthName(curMonth())}`),
      h('button', { title: 'Next month', onclick: () => shiftMonth(1) }, '›'),
      h('span', { class: 'grow' }),
      fileButton('Import roster (PDF or Excel)', '.pdf,.xlsx', true, importMonthly),
      h('button', { onclick: () => exportMonthly(kind) }, 'Download .xlsx'),
      monthData(kind) && h('button', { onclick: () => {
        pushUndo({ mon: JSON.stringify(state.monthly || {}), what: `clearing the ${def.label}` });
        delete state.monthly[curMonth()][kind]; personCache.clear(); render();
        undoToast(`Cleared the ${def.label} for ${monthName(curMonth())}.`);
      } }, 'Clear')),
    h('p', { class: 'hint', style: 'margin:0' }, kind === 'leave'
      ? 'Leave sets people on leave on those days (Medical Leave counts as MC). Import the HMS leave roster or add leave by hand.'
      : `Import the HMS ${def.label.toLowerCase()} (PDF) or an Excel copy, or type names in. ${def.cols.some(c => c.to) ? 'Columns marked • fill the calls and clinics on Today. ' : ''}${def.cols.some(c => c.night) ? 'Overnight duties make people post call the next day. ' : ''}Names in red aren't matched to the staff list.`),
    issues.length ? h('p', { class: 'month-issues', role: 'status' },
      h('b', {}, [errs ? `${errs} clash${errs > 1 ? 'es' : ''}` : '', gaps ? `${gaps} empty overnight dut${gaps > 1 ? 'ies' : 'y'}` : ''].filter(Boolean).join(', ')),
      ' this month (marked in the grid: on leave, a day duty after a night, two nights at once). ',
      h('button', { class: 'small', onclick: nextIssue }, 'Next ›')) : null,
    loadedStrip(),
    monthlyFixNames(kind));
}

function renderMonthlyRoster(kind) {
  const def = monthlyDef(kind);
  if (def.list) return renderLeaveRoster();
  const month = curMonth();
  const data = monthData(kind);
  const set = (d, key, v) => {
    const rows = monthData(kind, month, true).rows;
    const rec = (rows[d] ||= {});
    if (v) rec[key] = v; else delete rec[key];
    personCache.clear();
    render();
  };
  const today = +state.day.date.slice(8, 10);
  const flagged = {};
  for (const i of issuesOf(month)) if (i.kind === kind) (flagged[`${+i.date.slice(8, 10)}|${i.key}`] ||= []).push(i);
  const cell = (d, c) => {
    const v = data?.rows?.[d]?.[c.key] || '';
    const f = flagged[`${d}|${c.key}`];
    return h('td', { class: f ? (f.some(i => i.level === 'error') ? 'clash' : 'gap') : null }, nameInput({ value: v, class: v && !personByText(v) ? 'unmatched' : '', title: v && !personByText(v) ? unmatchedTitle(v) : f ? f.map(i => i.text).join(' ') : '', 'aria-invalid': f?.some(i => i.level === 'error') ? 'true' : null,
      onchange: e => set(d, c.key, cleanCell(e.target.value)),
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } } }));
  };
  const days = Array.from({ length: daysIn(month) }, (_, i) => i + 1);
  return h('div', {}, monthlyBar(kind),
    h('section', { class: 'card scroll' }, h('table', { class: 'monthly' },
      h('thead', {}, h('tr', {}, ['Date', 'Day', ...def.cols.map(c => `${c.label}${c.to ? ' •' : ''}${c.night ? ' ☾' : ''}`)].map(t => h('th', {}, t)))),
      h('tbody', {}, days.map(d => {
        const wd = weekday(month, d);
        return h('tr', { class: (wd === 'Sat' || wd === 'Sun' ? 'weekend' : '') + (d === today ? ' today' : '') },
          h('td', {}, h('button', { class: 'link', title: 'Go to this day', onclick: () => { switchDate(`${month}-${String(d).padStart(2, '0')}`); } }, d)),
          h('td', { class: 'seen' }, wd),
          def.cols.map(c => cell(d, c)));
      })))));
}

let leaveFilter = '';
function renderLeaveRoster() {
  const month = curMonth();
  const data = monthData('leave');
  const entries = (data?.entries || [])
    .filter(e => !leaveFilter || e.name.toLowerCase().includes(leaveFilter.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name) || a.from.localeCompare(b.from));
  const change = () => { personCache.clear(); render(); };
  const row = e => h('tr', {},
    h('td', {}, nameInput({ value: e.name, class: personByText(e.name) ? '' : 'unmatched', title: personByText(e.name) ? '' : unmatchedTitle(e.name), onchange: ev => { e.name = cleanCell(ev.target.value); change(); } })),
    h('td', {}, h('input', { type: 'date', value: e.from, onchange: ev => { e.from = ev.target.value; if (e.to < e.from) e.to = e.from; change(); } })),
    h('td', {}, h('input', { type: 'date', value: e.to, onchange: ev => { e.to = ev.target.value < e.from ? e.from : ev.target.value; change(); } })),
    h('td', {}, select(e.type, LEAVE_TYPES.includes(e.type) || !e.type ? LEAVE_TYPES : [e.type, ...LEAVE_TYPES], v => { e.type = v; change(); })),
    h('td', {}, h('input', { value: e.remarks || '', onchange: ev => { e.remarks = ev.target.value; save(); } })),
    h('td', {}, h('button', { class: 'small', title: 'Remove', onclick: () => { data.entries = data.entries.filter(x => x !== e); change(); } }, '✕')));
  return h('div', {}, monthlyBar('leave'),
    h('section', { class: 'card scroll' },
      h('div', { class: 'bar' },
        h('button', { onclick: () => { monthData('leave', month, true).entries.unshift({ name: '', from: state.day.date, to: state.day.date, type: 'Annual Leave', remarks: '' }); leaveFilter = ''; render(); } }, '+ Add leave'),
        h('span', { class: 'stats' }, h('span', {}, h('b', {}, data?.entries?.length || 0), ' entries')),
        h('span', { class: 'grow' }),
        h('input', { placeholder: 'Filter names', value: leaveFilter, oninput: e => { leaveFilter = e.target.value; const pos = e.target.selectionStart; render(); const i = app.querySelector('.card.scroll input[placeholder="Filter names"]'); i.focus(); i.setSelectionRange(pos, pos); } })),
      leavePerDay(month),
      entries.length
        ? h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'From', 'To', 'Leave type', 'Remarks', ''].map(t => h('th', {}, t)))), h('tbody', {}, entries.map(row)))
        : h('p', { class: 'empty' }, `No leave for ${monthName(month)} yet.`)));
}
// How many are away each day of the month, seniors and juniors, so a heavy day shows before it's approved.
function leavePerDay(month) {
  const limit = state.settings.leaveLimit || 0;
  const days = Array.from({ length: daysIn(month) }, (_, i) => i + 1);
  const counts = days.map(d => {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const people = [...new Set(leaveOn(state.monthly, date).map(e => personByText(e.name)).filter(Boolean))];
    return { d, date, s: people.filter(p => p.role === 'senior').length, j: people.filter(p => p.role !== 'senior').length };
  });
  if (!counts.some(c => c.s + c.j)) return null;
  return h('div', { class: 'leave-days', role: 'group', 'aria-label': 'People on leave each day' },
    counts.map(c => h('button', { class: 'leave-day' + (weekday(month, c.d) === 'Sat' || weekday(month, c.d) === 'Sun' ? ' weekend' : '') + (limit && c.s + c.j > limit ? ' over' : ''),
      title: `${c.d} ${monthName(month)}: ${c.s} senior${c.s === 1 ? '' : 's'} and ${c.j} junior${c.j === 1 ? '' : 's'} away${limit && c.s + c.j > limit ? ` (more than ${limit})` : ''}. Go to the day.`,
      onclick: () => switchDate(c.date) },
      h('span', { class: 'n' }, c.d), h('span', { class: 'sj' }, c.s + c.j ? `${c.s}/${c.j}` : ''))),
    h('span', { class: 'seen' }, ' seniors/juniors away' + (limit ? `; more than ${limit} is marked` : '')));
}

// ----- premed tab -----

function renderPremed() {
  const r = state.roster;
  if (!r) return h('section', { class: 'card' }, h('h2', {}, 'Premed cover'), nextStep('Premed cover is set on the roster. Make the roster first.', 'Go to Roster', 'roster'));
  const byName = n => matchName(n, state.staff).person;
  const away = p => !!p && !!state.day.staff[p.id]?.notAroundPrev;
  // who can cover: residents and MOPEX who were around yesterday and are working today
  const coverers = state.staff.filter(p => p.role === 'junior' && !isBaby(p) && !away(p)
    && ['avail', 'elsewhere'].includes(state.day.staff[p.id]?.status || 'avail'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const load = {};
  for (const row of r.rows) for (const n of cellParts(row, 'premed')) load[n] = (load[n] || 0) + 1;
  const homeOf = {};
  r.rows.forEach(row => cellParts(row, 'junior').forEach(part => { const p = byName(namesInCell(part)[0] || ''); if (p) homeOf[p.id] = row.label; }));

  const setCover = (row, name) => {
    pushUndo(JSON.stringify(r.rows));
    row.premed = name ? `${name} - Premed` : '';
    afterRosterEdit();
  };
  let needed = 0, missing = 0;
  const rows = r.rows.filter(row => row.complex !== 'Clinic').map(row => {
    const juniors = cellParts(row, 'junior').map(part => ({ part, p: byName(namesInCell(part)[0] || '') }));
    const awayNames = juniors.filter(j => away(j.p)).map(j => j.p.name);
    const needs = awayNames.length > 0;
    const mate = juniors.find(j => j.p && !away(j.p) && !isBaby(j.p))?.p;
    const cur = cellParts(row, 'premed')[0] || '';
    if (needs) { needed++; if (!cur) missing++; }
    const options = [['', '— none —'], ...coverers.map(p => [p.name, `${p.name}${homeOf[p.id] ? ' · ' + homeOf[p.id] : ' · not on a list'}${load[p.name] ? ` · ${load[p.name]} room${load[p.name] > 1 ? 's' : ''}` : ''}`])];
    if (cur && !options.some(o => o[0] === cur)) options.push([cur, cur]);
    const coverP = cur && byName(cur);
    return h('tr', { class: needs && !cur ? 'flagged' : '' },
      h('td', { class: 'room' }, row.label + ':'),
      h('td', {}, h('div', { class: 'names' }, juniors.map(j => j.p
        ? personChip(j.p, { onclick: e => openPersonBox(e.currentTarget, j.p, { kind: 'view' }) })
        : h('span', { class: 'name', style: colourStyle(j.part) }, j.part)))),
      h('td', { class: 'seen' }, awayNames.length ? `${awayNames.join(', ')} away yesterday${mate && !cur ? ` · ${mate.name} in the same room could cover` : ''}` : ''),
      h('td', {}, coverP
        ? personChip(coverP, { onclick: e => openPersonBox(e.currentTarget, coverP, { kind: 'premed', options, setCover: v => setCover(row, v) }) })
        : select('', [['', needs ? '+ Add cover (needed)' : '+ Add cover'], ...options.slice(1)], v => setCover(row, v))));
  }).filter(Boolean);
  return h('div', {},
    h('section', { class: 'card' },
      h('h2', {}, 'Premed cover'),
      h('p', { class: 'hint' }, 'A room needs premed cover when its junior wasn\'t around on the previous working day (it comes from the monthly rosters, or tick "away yesterday" under Monthly › Today). Cover can be any resident or MOPEX who was around, from any complex. The list shows where each person is today and how many rooms they already cover (max ' + state.settings.premedCap + ').'),
      h('div', { class: 'bar' },
        h('span', { class: 'stats' }, h('span', {}, h('b', {}, needed), ' rooms need cover'), h('span', {}, h('b', {}, missing), ' still without')),
        h('span', { class: 'grow' }))),
    h('section', { class: 'card scroll' }, h('table', { class: 'sheet' },
      h('thead', {}, h('tr', {}, ['', 'Junior', '', 'Premed cover'].map(t => h('th', {}, t)))),
      h('tbody', {}, rows))),
    rosterLogCard());
}

// The sheet exactly as it will be exported, drawn as an HTML table.
function renderSheet() {
  colourCache.clear();
  const layout = buildLayout({ date: state.day.date, rows: state.roster.rows, lists: rosterLists(), general: effectiveGeneral(), box: commentsText(), colourOf, shortOf });
  const start = {}, covered = new Set();
  for (const c of layout.cells) {
    start[c.r + ':' + c.c1] = c;
    for (let r = c.r; r <= c.r2; r++) for (let k = c.c1; k <= c.c2; k++) if (r !== c.r || k !== c.c1) covered.add(r + ':' + k);
  }
  const trs = [];
  for (let r = 2; r <= layout.rows; r++) {
    const tds = [];
    for (let k = 1; k <= layout.cols; k++) {
      if (covered.has(r + ':' + k)) continue;
      const c = start[r + ':' + k];
      if (!c) { tds.push(h('td', {})); continue; }
      const style = [
        `font-size:${c.sz === 10 ? 13 : 11}px`, c.bold ? 'font-weight:700' : '', c.color ? `color:#${c.color.slice(2)}` : '',
        `text-align:${c.align}`, `vertical-align:${c.valign}`,
        c.fill ? `background:#${c.fill.slice(2)}` : '', c.pad ? 'padding:6px 10px' : '',
      ].filter(Boolean).join(';');
      const attrs = { class: (c.box ? 'box' : '') + (c.c1 === 12 ? ' spill' : ''), colspan: c.c2 - c.c1 + 1, rowspan: c.r2 - c.r + 1, style };
      const lines = String(c.text).split('\n');
      tds.push(h('td', attrs, c.runs
        ? c.runs.map(run => h(run.sup ? 'sup' : 'span', { style: run.color ? `color:#${run.color.slice(2)}` : '' }, run.text))
        : lines.map((t, i) => [i ? h('br') : null, c.underlineFirst && i === 0 ? h('u', {}, t) : t])));
    }
    trs.push(h('tr', { style: layout.heights[r] ? `height:${Math.round(layout.heights[r] * 1.33)}px` : '' }, tds));
  }
  return h('section', { class: 'card scroll sheet-wrap' },
    h('table', { class: 'xl' },
      h('colgroup', {}, COL_WIDTHS.map(w => h('col', { style: `width:${Math.round(w * 7 + 5)}px` }))),
      h('tbody', {}, trs)));
}

// Rosters saved before AH OT, AOCC and AIC were added get empty rows for them.
function ensureSpecialRows(r) {
  if (r.rows.some(x => x.complex === 'Clinic')) return;
  r.rows.unshift(...SPECIAL_ROWS.map(x => ({ roomId: x.id, label: x.name, complex: 'Clinic', senior: '', junior: '', premed: '', notes: '' })));
  lastRows = JSON.stringify(r.rows);
}

// The comments box: free text at the top right of the sheet.
// Comments added to names on the roster ("Koh YW -mtg 3pm") as comments box lines.
function nameComments() {
  const out = [];
  for (const row of state.roster?.rows || []) for (const key of ['senior', 'junior']) for (const part of cellParts(row, key)) {
    const { name, dash } = parseNamePart(part);
    if (dash) { const line = `${shortOf(name)} - ${dash}`; if (!out.includes(line)) out.push(line); }
  }
  return out;
}
// The comments box text: what was typed, then name comments not already in it.
function commentsText() {
  const typed = state.day.box || '';
  const extra = nameComments().filter(l => !typed.toLowerCase().includes(l.toLowerCase()));
  return [typed.trimEnd(), ...extra].filter(Boolean).join('\n');
}

function boxCard() {
  const fromNames = nameComments();
  return h('section', { class: 'card' },
    h('h2', {}, 'Comments box'),
    h('p', { class: 'hint' }, 'Shown in the box at the top right of the sheet, e.g. meetings or people away. People on an admin day go on the Admin/no list row instead (Monthly › Today).'),
    h('textarea', { rows: 5, value: state.day.box || '', placeholder: 'e.g. Melody Goh - mtg 2 to 5pm', onchange: e => {
      const before = state.day.box || '';
      state.day.box = e.target.value;
      logRoster([`Comments box: ${before || '—'} → ${e.target.value || '—'}`]);
      save();
    } }),
    fromNames.length ? h('div', { class: 'hint' }, 'Also shown, from comments on names:', h('ul', {}, fromNames.map(l => h('li', {}, l)))) : null);
}

// No roster yet: start from the last day this browser has one for (within a week), when the lists change little.
// Rows go across for the rooms running today; the live checks then show who is on leave or post call now, and
// "Fill empty gaps" fills what's missing. With Undo.
function copyRosterButton() {
  const from = Array.from({ length: 7 }, (_, i) => addDays(state.day.date, -(i + 1))).find(d => state.days?.[d]?.roster?.rows?.length);
  if (!from) return null;
  return h('button', { title: `Copy the roster of ${longDate(from)} into this day, then check it: people on leave or post call today are flagged`, onclick: () => {
    const src = state.days[from].roster;
    pushUndoAll(`starting from ${longDate(from)}`, { day: true });
    // today's rooms in today's order: the AOCC/AIC/AH OT rows first, then each running room (empty if new)
    const byLabel = new Map(clone(src.rows).map(x => [x.label, x]));
    const rows = [...clone(src.rows).filter(isSpecialRow).map(x => ({ ...x, why: undefined })),
      ...state.day.rooms.filter(x => x.running).map(room => {
        const o = byLabel.get(room.name);
        return { roomId: room.id, label: room.name, complex: room.complex, senior: o?.senior || '', junior: o?.junior || '', premed: '', notes: room.notes || '' };
      })];
    state.roster = { rows, warnings: [], date: state.day.date, seed: src.seed, log: [] };
    logRoster([`Started from the roster of ${longDate(from)}`]);
    lastRows = JSON.stringify(rows);
    afterRosterEdit(true);
    const n = (state.roster.checks || []).filter(w => w.level === 'error').length;
    toast(`Copied ${longDate(from)}'s roster.${n ? ` ${n} problem${n > 1 ? 's' : ''} to fix (people away today, empty rooms).` : ''}`, { label: 'Fill empty gaps', run: fillGaps });
  } }, `Start from ${new Date(from + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}'s roster`);
}

function renderRoster() {
  const r = state.roster;
  const actions = h('div', { class: 'bar' },
    h('button', { class: 'primary', onclick: () => runGenerate(!!r) }, r ? 'Generate new' : 'Generate roster'),
    !r ? copyRosterButton() : null,
    r && r.date === state.day.date && h('button', { onclick: fillGaps, title: 'Keep every name already on the roster and fill only the empty cells' }, 'Fill empty gaps'),
    r && h('button', { disabled: !undoStack.length, title: undoStack.length ? `Undo${typeof undoStack.at(-1) === 'object' ? ' ' + undoStack.at(-1).what : ' the last change'} (Ctrl+Z)` : 'Nothing to undo', onclick: undo }, 'Undo'),
    r && h('button', { disabled: !redoStack.length, title: redoStack.length ? 'Redo (Ctrl+Y)' : 'Nothing to redo', onclick: redo }, 'Redo'),
    r && isMember() && h('button', { class: 'primary', onclick: saveRosterToCloud }, 'Save'),
    r && h('div', { class: 'seg', role: 'group', 'aria-label': 'View' },
      h('button', { 'aria-pressed': String(rosterView === 'edit'), onclick: () => { rosterView = 'edit'; render(); } }, 'Edit'),
      h('button', { 'aria-pressed': String(rosterView === 'sheet'), onclick: () => { rosterView = 'sheet'; render(); } }, 'Sheet preview')),
    r && downloadButton(),
  );
  if (!r) {
    // what's missing before a roster can be made, with a way there
    const casesIn = state.day.rooms.some(x => x.running && x.notes);
    const next = !state.staff.length ? nextStep('Add the staff list first: the roster is made from it.', 'Go to Staff', 'staff')
      : !casesIn ? nextStep('No case notes yet for this day. Load the admin draft on Cases first, or generate from the rooms that run by default.', 'Go to Cases', 'cases')
      : null;
    return h('div', {}, h('section', { class: 'card' }, h('h2', {}, 'OT roster'), next,
      h('p', { class: 'hint' }, 'Generates AOCC, AIC and the OT lists: seniors, juniors and premed cover. You can edit any cell before downloading.'), state.staff.length ? actions : null), historyCard());
  }

  ensureSpecialRows(r);
  const doubles = doubleCovered(r.rows.filter(x => x.complex !== 'Clinic'));
  const flaggedRooms = new Set([...(r.warnings || []), ...(r.checks || [])].filter(w => w.level === 'error').map(w => w.text.split(':')[0]));
  const body = [];
  let last = null;
  r.rows.forEach((row, i) => {
    const sp = row.complex === 'Clinic';
    if (!sp && i && r.rows[i - 1].complex === 'Clinic') body.push(h('tr', { class: 'gap' }, h('td', { colspan: 4 })));
    body.push(h('tr', { class: (flaggedRooms.has(row.label) ? 'flagged' : '') + (sp ? ' special' : ''), 'data-label': row.label },
      h('td', { class: 'room' }, row.label + ':'),
      rosterCell(row, i, 'senior', doubles),
      row.roomId === 'aic' || row.roomId === 'ahot' ? h('td', {}) : rosterCell(row, i, 'junior', doubles),
      sp ? h('td', {}) : notesCell(row, i, { class: 'notes' })));
  });
  if (rosterView === 'sheet') {
    return h('div', {},
      h('section', { class: 'card no-print' }, h('h2', {}, 'OT roster'), actions,
        h('p', { class: 'hint', style: 'margin:0' }, 'This is what the downloaded .xlsx looks like. The top half comes from Monthly › Today; case notes aren\'t included. Switch to Edit to move names or change tags. & marks a senior who is double covering.')),
      renderSheet());
  }
  return h('div', {},
    h('section', { class: 'card' }, h('h2', {}, 'OT roster'), actions,
      h('p', { class: 'hint', style: 'margin:0' }, `${TOUCH ? 'Tap' : 'Click'} a name for its details and to move or swap it${TOUCH ? '' : ' (or drag it)'}; + adds someone, × takes them off. `,
        h('button', { class: 'link', onclick: showKey }, 'What do &, C, (L) and the colours mean? How do I…?'))),
    h('div', { class: 'cols' },
      h('section', { class: 'card scroll' },
        h('table', { class: 'sheet roster-edit' },
          h('thead', {}, h('tr', {}, ['', 'Senior', 'Junior', 'Cases'].map(t => h('th', {}, t)))),
          h('tbody', {}, body))),
      h('div', {},
        practiceTaskCard(),
        problemsCard(),
        changesCard(),
        noListCard(),
        boxCard(),
        callsCard(),
        historyCard(),
        rosterLogCard(),
      ),
    ),
  );
}

// ---- problems: what the checks found, each with a way to see it and, where there is one, a fix ----

const problemsOf = r => {
  const seen = new Set(), order = { error: 0, warn: 1, info: 2 };
  return (r?.checks || []).filter(w => w.level !== 'info' && !seen.has(w.text) && seen.add(w.text)).sort((a, b) => order[a.level] - order[b.level]);
};
const roomsOfProblem = w => w.rooms || (/^([A-Z][A-Za-z ]*\d*(?: PACU)?):/.exec(w.text) ? [w.text.split(':')[0]] : []);
function showRoom(label) {
  rosterView = 'edit';
  if (state.tab !== 'roster') { state.tab = 'roster'; render(); }
  const tr = app.querySelector(`tr[data-label="${CSS.escape(label)}"]`);
  if (!tr) return;
  tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
  tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash');
}
// Take a person off some rooms (all their cells there, or only one column).
function takeOff(id, labels, keys = ['senior', 'junior', 'premed']) {
  const p = state.staff.find(x => x.id === id);
  let changed = false;
  for (const row of state.roster.rows.filter(x => labels.includes(x.label))) for (const key of keys) {
    const parts = cellParts(row, key);
    const keep = parts.filter(x => personOfPart(x) !== p);
    if (keep.length !== parts.length) { setCellParts(row, key, keep); changed = true; }
  }
  return changed;
}
function problemFixes(w) {
  const rooms = roomsOfProblem(w);
  const p = w.person && state.staff.find(x => x.id === w.person);
  const who = p ? shortName(p) || p.name : '';
  const btn = (label, run, primary) => h('button', { class: 'small' + (primary ? ' primary' : ''), onclick: run }, label);
  const out = [];
  if (w.fix === 'takeOff' && p) out.push(btn(`Take ${who} off`, () => {
    pushUndo(JSON.stringify(state.roster.rows));
    takeOff(p.id, rooms); afterRosterEdit();
    toast(`Took ${who} off ${rooms.join(', ')}.`, { label: 'Fill the gaps', run: fillGaps });
  }, true));
  if (w.fix === 'cover' && p && rooms[1]) out.push(btn(`Cover only in ${rooms[1]}`, () => {
    const row = state.roster.rows.find(x => x.label === rooms[1]);
    const parts = cellParts(row, 'junior');
    const k = parts.findIndex(x => !isCoverPart(x) && personOfPart(x) === p);
    if (k < 0) return;
    pushUndo(JSON.stringify(state.roster.rows));
    const cur = parseNamePart(parts[k]);
    parts[k] = buildNamePart({ ...cur, tags: [...cur.tags, 'C'], cover: '' });
    setCellParts(row, 'junior', parts); afterRosterEdit();
    undoToast(`${who} is now an ad hoc cover (C) in ${rooms[1]}.`);
  }, true));
  if (w.fix === 'fill') out.push(btn('Fill empty gaps', fillGaps, true));
  if (w.fix === 'reseat' && p) out.push(btn('Swap for someone suitable', () => {
    pushUndo(JSON.stringify(state.roster.rows));
    takeOff(p.id, rooms, [w.col || 'senior']);
    afterRosterEdit();
    fillGaps();
  }, true));
  if (w.fix === 'premed') out.push(btn('Go to Premeds', () => goTab('premed')));
  if (rooms[0]) out.push(btn('Show', () => showRoom(rooms[0])));
  return out;
}
function problemsCard() {
  const r = state.roster;
  const list = problemsOf(r);
  const notes = (r.warnings || []).filter(w => !list.some(x => x.text === w.text));
  const errors = list.filter(w => w.level === 'error').length;
  return h('section', { class: 'card problems', id: 'problems' },
    h('h2', {}, list.length ? `Problems (${list.length})` : 'Problems'),
    list.length
      ? h('ul', { class: 'warnings' }, list.map(w => h('li', { class: w.level }, h('span', {}, h('b', { class: 'level' }, { error: 'Problem: ', warn: 'Check: ', info: 'Note: ' }[w.level] || ''), w.text), h('span', { class: 'fixes' }, problemFixes(w)))))
      : h('p', { class: 'ok-note' }, '✓ No problems found.'),
    errors ? null : list.length ? h('p', { class: 'hint' }, 'Only warnings left: worth a look, but nothing is wrong.') : null,
    notes.length ? h('details', {}, h('summary', { class: 'seen' }, `Notes from making the roster (${notes.length})`),
      h('ul', { class: 'warnings' }, notes.map(w => h('li', { class: 'info' }, w.text)))) : null);
}

// Everyone available but on no list. They go on the sheet's Admin/no list row; drag them
// onto the roster to give them a list, or drag a name here to take it off.
function noListCard() {
  const people = noListPeople();
  const admin = state.staff.filter(p => state.day.staff[p.id]?.status === 'admin');
  const chip = p => personChip(p, { title: `${p.name} · ${p.grade}. Drag onto the roster.`,
    onpointerdown: TOUCH ? null : e => startNameDrag(e, { pool: p.id }),
    onclick: TOUCH ? e => openPersonBox(e.currentTarget, p, { kind: 'view' }) : null });
  const group = (title, list) => list.length ? h('div', { class: 'pool-group' }, h('b', {}, title), h('div', { class: 'pool-names' }, list.map(chip))) : null;
  return h('section', { class: 'card pool', 'data-drop': '', 'data-pool': '' },
    h('h2', {}, 'Admin / no list'),
    h('p', { class: 'hint' }, TOUCH ? 'Working today but not on any list, so they go on the Admin/no list row. Use + on the roster to give them a list.' : 'Working today but not on any list, so they go on the Admin/no list row. Drag a name onto the roster to give them a list, or drag a name off the roster onto this box (or click its ×).'),
    group('Seniors', people.filter(p => p.role === 'senior')),
    group('Juniors', people.filter(p => p.role === 'junior')),
    group('Admin day', admin),
    !people.length && !admin.length ? h('p', { class: 'hint' }, 'Everyone working has a list.') : null);
}

async function exportXlsx(stamp = '') {
  colourCache.clear();
  const wb = buildRosterWorkbook(await excel(), { date: state.day.date, rows: state.roster.rows, lists: rosterLists(), general: effectiveGeneral(), box: commentsText(), colourOf, shortOf, stamp });
  const buf = await wb.xlsx.writeBuffer();
  download(`OT roster ${state.day.date}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

let jspdf = null;
async function exportPdf(stamp = '') {
  if (!jspdf) {
    try {
      await loadVendor('vendor/jspdf.umd.min.js');
    } catch { toast("Couldn't load the PDF maker (offline?). Try again, or download the .xlsx."); return false; }
    jspdf = window.jspdf.jsPDF;
  }
  colourCache.clear();
  const layout = buildLayout({ date: state.day.date, rows: state.roster.rows, lists: rosterLists(), general: effectiveGeneral(), box: commentsText(), colourOf, shortOf, stamp });
  download(`OT roster ${state.day.date}.pdf`, buildRosterPdf(jspdf, layout).output('blob'));
}

// Printing: the sheet shrinks to fit one A4 page (portrait, 10 mm margins), whatever its length.
addEventListener('beforeprint', () => {
  const t = document.querySelector('table.xl');
  if (!t) return;
  t.style.zoom = '';
  const r = t.getBoundingClientRect();
  const mm = 96 / 25.4, w = 190 * mm, hgt = 277 * mm;
  const k = Math.min(1, w / r.width, hgt / r.height) * 0.98;
  if (k < 1) t.style.zoom = String(k);
});
addEventListener('afterprint', () => { const t = document.querySelector('table.xl'); if (t) t.style.zoom = ''; });

// The sheet as an image: shared straight to WhatsApp (or any app) where the phone allows it, else downloaded.
// Returns false when nothing went out (the share sheet was closed). parts: 1 image, or 2 (calls and lists, then the
// OT rooms, each with the title and date) that stay readable when WhatsApp shrinks a tall photo.
async function exportImage(stamp = '', text = '', parts = 1) {
  colourCache.clear();
  const layout = buildLayout({ date: state.day.date, rows: state.roster.rows, lists: rosterLists(), general: effectiveGeneral(), box: commentsText(), colourOf, shortOf, stamp });
  const spans = parts === 2 && layout.otFrom ? [[[2, layout.otFrom - 1]], [[2, 5], [layout.otFrom, layout.rows]]] : [[[2, layout.rows]]];
  const files = [];
  for (const [i, sp] of spans.entries()) {
    const blob = await new Promise(ok => buildRosterCanvas(layout, 1400, sp).toBlob(ok, 'image/png'));
    files.push(new File([blob], `OT roster ${state.day.date}${spans.length > 1 ? ` (${i + 1} of ${spans.length})` : ''}.png`, { type: 'image/png' }));
  }
  if (navigator.canShare?.({ files })) {
    try { await navigator.share({ files, title: `OT roster ${longDate(state.day.date)}`, ...(text ? { text } : {}) }); return true; }
    catch (e) { if (e?.name === 'AbortError') return false; }
  }
  for (const f of files) download(f.name, f);
  if (text) { try { await navigator.clipboard.writeText(text); } catch { /* no clipboard */ } }
  const what = files.length > 1 ? `${files.length} images downloaded` : 'Image downloaded';
  toast(text ? `${what} and the changes copied: paste them under the image on WhatsApp.` : `${what}. Send ${files.length > 1 ? 'them' : 'it'} on WhatsApp as a photo or file.`);
  return true;
}

// Download button: the format last picked (remembered in this browser), with a menu to change it.
// a download or print counts as the day being sent out (the steps strip shows it until the roster changes)
// A sheet sent again after changes says "Updated hh:mm" at the top; re-sending the same version keeps its stamp.
function stampForSend() {
  const s = state.outSent?.[state.day.date];
  if (!s) return '';
  return s.hash === dayHash() ? s.stamp || '' : `Updated ${hhmm(Date.now())}`;
}
// Record what went out (only once it did), so the roster can show what changed since.
function markSent(stamp) {
  const date = state.day.date;
  (state.outHash ||= {})[date] = dayHash();
  const sent = state.outSent ||= {};
  sent[date] = { hash: dayHash(), at: Date.now(), stamp, rows: sentRows(state.roster.rows) };
  const cut = addDays(realToday(), -30);
  for (const d of Object.keys(sent)) if (d < cut) delete sent[d];
  save(); renderSteps(); render();
}
const sentOut = fn => async () => {
  const stamp = stampForSend();
  let ok;
  try { ok = await fn(stamp); } catch (e) { console.error(e); toast("Couldn't make the file. Try again."); return; }
  if (ok !== false) markSent(stamp);
};
// The rooms that changed since the roster was last sent, with a way to send the changes.
function changesCard() {
  const r = state.roster, s = state.outSent?.[state.day.date];
  if (!r || !s || s.hash === dayHash()) return null;
  const list = rosterChanges(s.rows, r.rows);
  if (!list.length) return null;
  const text = `OT roster ${longDate(state.day.date)}, changes since ${hhmm(s.at)}:\n` + list.map(c => '• ' + changeText(c)).join('\n');
  return h('section', { class: 'card changes', id: 'changes' },
    h('h2', {}, `Changed since sent at ${hhmm(s.at)} (${list.length})`),
    h('ul', { class: 'changes-list' }, list.map(c => h('li', {}, h('b', {}, `${c.label} ${c.what}: `), c.from || '(none)', ' → ', c.to || '(none)'))),
    h('div', { class: 'bar' },
      h('button', { class: 'small primary', onclick: async () => { const stamp = stampForSend(); if (await exportImage(stamp, text) !== false) markSent(stamp); } }, 'Send image with the changes'),
      h('button', { class: 'small', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Changes copied.'); } catch { toast("Couldn't copy here."); } } }, 'Copy the changes')),
    h('p', { class: 'hint' }, 'The sheet you send now says "Updated" with the time, so it can be told apart from the first one.'));
}
const DOWNLOADS = [['xlsx', 'Download .xlsx', sentOut(exportXlsx)], ['pdf', 'Download PDF', sentOut(exportPdf)], ['png', 'Image for WhatsApp', sentOut(exportImage)], ['png2', 'Image in 2 parts (easier to read on a phone)', sentOut(stamp => exportImage(stamp, '', 2))], ['print', 'Print', sentOut(() => { rosterView = 'sheet'; render(); setTimeout(() => window.print(), 100); })]];
let downloadMenu = false;
function downloadButton() {
  let pick = 'xlsx';
  try { pick = localStorage.getItem('nuh-roster-download') || 'xlsx'; } catch { /* no storage */ }
  // members: one step to save the roster for the team and then send the image
  const all = cloud.enabled && isMember() ? [...DOWNLOADS, ['saveimage', 'Save for the team, then image', async () => {
    await saveRosterToCloud();
    if (state.cloudHash?.[state.day.date]?.hash === dayHash()) await sentOut(exportImage)();
  }]] : DOWNLOADS;
  const cur = all.find(d => d[0] === pick) || all[0];
  return h('div', { class: 'split' },
    h('button', { onclick: () => cur[2]() }, cur[1]),
    h('button', { class: 'caret', 'aria-label': 'Other formats', 'aria-expanded': String(downloadMenu), onclick: () => { downloadMenu = !downloadMenu; render(); } }, '▾'),
    downloadMenu ? h('div', { class: 'menu' }, all.map(([k, label, fn]) => h('button', { class: k === cur[0] ? 'on' : '', onclick: () => {
      if (k !== 'print') { try { localStorage.setItem('nuh-roster-download', k); } catch { /* no storage */ } }
      downloadMenu = false; render(); fn();
    } }, label))) : null);
}

// ----- settings tab -----

function roomEditor() {
  const t = state.roomTemplate;
  const changed = () => { syncRooms(); render(); };
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= t.length) return; [t[i], t[j]] = [t[j], t[i]]; changed(); };
  const complexes = [...new Set(['Other', 'KROR', 'MCOR', 'MOR', ...t.map(r => r.complex)])];
  return h('div', { class: 'scroll' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Complex', 'Room', 'Running by default', ''].map(x => h('th', {}, x)))),
    h('tbody', {},
      t.map((r, i) => h('tr', {},
        h('td', {}, select(r.complex, complexes, v => { r.complex = v; changed(); })),
        h('td', {}, h('input', { value: r.name, onchange: e => {
          const v = e.target.value.trim();
          if (!v || t.some(x => x !== r && x.name === v)) { toast(v ? `${v} is already in the list.` : 'A room needs a name.'); e.target.value = r.name; return; }
          (state.day.rooms || []).forEach(x => { if (x.name === r.name) x.name = v; });
          r.name = v; changed();
        } })),
        h('td', {}, h('input', { type: 'checkbox', checked: r.defaultOn, 'aria-label': 'Running by default', onchange: e => { r.defaultOn = e.target.checked; save(); } })),
        h('td', { style: 'white-space:nowrap' },
          h('button', { class: 'small', title: 'Move up', onclick: () => move(i, -1) }, '↑'), ' ',
          h('button', { class: 'small', title: 'Move down', onclick: () => move(i, 1) }, '↓'), ' ',
          h('button', { class: 'small', title: 'Remove room', onclick: () => { if (confirm(`Remove ${r.name} from the roster?`)) { t.splice(i, 1); changed(); } } }, '✕')))),
      h('tr', {}, h('td', { colspan: 4 }, h('button', { class: 'small', onclick: () => {
        const name = prompt('Room name, e.g. MOR 19');
        if (!name?.trim()) return;
        if (t.some(x => x.name === name.trim())) return toast(`${name.trim()} is already in the list.`);
        const complex = (name.match(/^(KROR|MCOR|MOR)/i)?.[1] || 'Other').toUpperCase().replace('OTHER', 'Other');
        let i = t.map(x => x.complex).lastIndexOf(complex);
        t.splice(i < 0 ? t.length : i + 1, 0, { complex, name: name.trim(), defaultOn: true });
        changed();
      } }, '+ Add room'))))));
}

function renderSettings() {
  const st = state.settings;
  const subRow = s => h('tr', {},
    h('td', {}, h('input', { value: s.label, onchange: e => { s.label = e.target.value; save(); } })),
    h('td', {}, h('input', { value: s.keywords.join(', '), onchange: e => { s.keywords = splitNameList(e.target.value).map(x => x.toLowerCase()); save(); } })),
    h('td', {}, h('label', {}, h('input', { type: 'checkbox', checked: s.hard, onchange: e => { s.hard = e.target.checked; save(); } }), ' required')),
    h('td', {}, select(s.posting || '', POSTINGS, v => { s.posting = v; save(); })),
    h('td', {}, h('button', { class: 'small', onclick: () => { st.subspecs = st.subspecs.filter(x => x !== s); render(); } }, '✕')),
  );

  return h('div', {},
    h('section', { class: 'card' },
      h('div', { class: 'bar', style: 'margin:0' },
        h('h2', { class: 'grow', style: 'margin:0' }, 'Settings'),
        settingsEditing
          ? h('button', { class: 'primary', onclick: () => { settingsEditing = false; render(); toast(isMember() ? 'Settings kept here. Use "Save for the team" to share them.' : 'Settings saved.'); } }, 'Done')
          : h('button', { onclick: () => { settingsEditing = true; render(); } }, 'Edit settings')),
      h('p', { class: 'hint', style: 'margin:0' }, settingsEditing ? 'Editing: changes apply straight away.' : 'Read only. Press Edit settings to change anything.'),
      teamSyncBar()),
    h('fieldset', { class: 'lock', disabled: !settingsEditing },
    h('section', { class: 'card scroll' },
      h('h2', {}, 'Subspecialties'),
      h('p', { class: 'hint' }, 'Keywords are matched as whole words in the case notes. "Required" means only seniors with that subspec can take the list. The posting is the junior posting that suits it.'),
      h('table', {},
        h('thead', {}, h('tr', {}, ['Name', 'Keywords in case notes', 'Senior', 'Junior posting', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, st.subspecs.map(subRow))),
      h('div', { class: 'bar', style: 'margin-top:8px' },
        h('button', { onclick: () => { const label = prompt('Subspecialty name'); if (label) { st.subspecs.push({ key: label.toLowerCase().replace(/\W+/g, '-'), label, keywords: [], hard: false, posting: '' }); render(); } } }, '+ Add subspecialty')),
    ),
    h('section', { class: 'card' },
      h('h2', {}, 'Rules'),
      h('div', { class: 'paste' },
        h('div', {}, h('label', {}, 'Paeds if patient is younger than (years)'), h('input', { type: 'number', min: 1, max: 18, value: st.paedsAgeYears, onchange: e => { st.paedsAgeYears = +e.target.value || 12; save(); } })),
        h('div', {}, h('label', {}, 'Max rooms per premed cover'), h('input', { type: 'number', min: 1, max: 6, value: st.premedCap, onchange: e => { st.premedCap = +e.target.value || 3; save(); } })),
        h('div', {}, h('label', {}, 'Mark days with more people on leave than (0: off)'), h('input', { type: 'number', min: 0, max: 60, value: st.leaveLimit || 0, onchange: e => { st.leaveLimit = Math.max(0, +e.target.value || 0); save(); } })),
        h('div', {}, h('label', {}, 'Complex list keywords'), h('textarea', { value: st.complexKeywords.join(', '), onchange: e => { st.complexKeywords = splitNameList(e.target.value).map(x => x.toLowerCase()); save(); } })),
        h('div', {}, h('label', {}, 'Runs-late keywords'), h('textarea', { value: st.longKeywords.join(', '), onchange: e => { st.longKeywords = splitNameList(e.target.value).map(x => x.toLowerCase()); save(); } })),
      ),
    ),
    h('section', { class: 'card' },
      h('h2', {}, 'Post call'),
      h('p', { class: 'hint' }, 'Someone on one of these overnight duties in the monthly rosters is post call the next day.'),
      h('div', { class: 'chips' }, MONTHLY.flatMap(def => def.cols.filter(c => !def.list).map(c => {
        const key = `${def.id}.${c.key}`;
        const list = st.nightDuties || NIGHT_DUTIES;
        const on = list.includes(key);
        return h('span', { class: 'chip' + (on ? ' on' : ''), onclick: () => { st.nightDuties = on ? list.filter(k => k !== key) : [...list, key]; render(); } }, `${def.label.replace(' Monthly', '')}: ${c.label}`);
      })))),
    h('section', { class: 'card' },
      h('h2', {}, 'Rooms'),
      h('p', { class: 'hint' }, 'The rooms on the roster, in order. "Running by default" rooms are ticked when you set up a new day (Clear day). Rooms in the same complex can share a senior when seniors are short. MOR 7–9 are emergency OTs, so they have no line.'),
      roomEditor(),
      h('p', { class: 'hint', style: 'margin-top:12px' }, 'Room defaults: subspecs a room always needs, one room per line, e.g. "MOR 12: cardiac". Use the keys ' + st.subspecs.map(x => x.key).join(', ') + '.'),
      h('textarea', { rows: 3, 'aria-label': 'Room defaults', value: Object.entries(st.roomDefaults || {}).map(([room, ks]) => `${room}: ${ks.join(', ')}`).join('\n'), onchange: e => {
        const keys = new Set(st.subspecs.map(x => x.key));
        const out = {}, bad = [];
        for (const line of e.target.value.split('\n')) {
          const [room, ks] = line.split(':');
          if (!room?.trim() || ks == null) continue;
          const list = splitNameList(ks).map(x => x.toLowerCase());
          bad.push(...list.filter(k => !keys.has(k)));
          out[room.trim().toUpperCase().replace(/\s+/, ' ')] = list.filter(k => keys.has(k));
        }
        st.roomDefaults = out;
        state.day.rooms.forEach(r => { if (!r.flagsManual) r.flags = suggestFlags(r.notes, st, r.name); });
        save(); toast(bad.length ? `Unknown subspec: ${bad.join(', ')}` : 'Room defaults updated.');
      } }),
    ),
    ),
    isAdmin() ? membersCard() : null,
    h('section', { class: 'card' },
      h('h2', {}, 'Practice mode'),
      h('p', { class: 'hint' }, 'Try the app with a made-up department: invented staff, monthly rosters and cases, with a short tour. It is kept apart from your real data and never signs in or shares anything. Send the link to anyone who wants to learn it.'),
      h('div', { class: 'bar', style: 'margin:0' },
        DEMO ? null : h('a', { class: 'btn', href: demoLink(), target: '_blank', rel: 'noopener' }, 'Open practice'),
        h('button', { onclick: () => navigator.clipboard.writeText(demoLink()).then(() => toast('Practice link copied.'), () => prompt('Practice link', demoLink())) }, 'Copy practice link'),
        h('code', { class: 'seen' }, demoLink()))),
    h('fieldset', { class: 'lock', disabled: !settingsEditing },
    h('section', { class: 'card' },
      h('h2', {}, 'Reset'),
      h('div', { class: 'bar' },
        h('button', { onclick: () => { if (confirm('Reset rules and subspecialties to the defaults? Staff are kept.')) { state.settings = clone(DEFAULT_SETTINGS); render(); } } }, 'Reset rules'),
        h('button', { onclick: () => { if (confirm('Delete everything stored in this browser (staff, day, roster)?')) { state = blankState(); syncRooms(); render(); } } }, 'Delete all data in this browser')),
    )),
    appVersion(),
  );
}

// App version and "Get the latest version" (owner, 14 Oct 2026; prewarm's pattern): which saved copy this phone runs,
// and a way out for a phone stuck on an old one. It only clears the app's own saved copy, never the roster data or sign-in.
function appVersion() {
  const ver = h('div', { id: 'appver' }), msg = h('span', { role: 'status' });
  if (window.caches) caches.keys().then(ks => {
    const k = ks.find(x => x.startsWith('nuh-roster-')); if (!k) return;
    const v = k.slice('nuh-roster-'.length), d = /^(\d{4}-\d{2}-\d{2})-([0-9a-f]+)$/.exec(v);
    ver.textContent = 'App version ' + (d ? `${d[1]} (${d[2]})` : v);
  }).catch(() => {});
  const getLatest = async btn => {
    btn.disabled = true; msg.textContent = '';
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const url = new URL(reg?.active?.scriptURL || new URL('sw.js', location.href));
      url.searchParams.set('fresh', Date.now());
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await reg?.unregister();
      if (window.caches) for (const k of await caches.keys()) if (k.startsWith('nuh-roster-')) await caches.delete(k);
      location.reload();
    } catch { msg.textContent = 'No signal: nothing was changed. Try again with signal.'; btn.disabled = false; }
  };
  return h('div', { class: 'appver hint' }, ver,
    h('div', {}, h('button', { type: 'button', class: 'link', onclick: e => getLatest(e.currentTarget) }, 'Not updating? Get the latest version'), ' ', msg));
}

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
        state = { ...blankState(), ...d, roomsVersion: d.roomsVersion || 1, settings: { ...clone(DEFAULT_SETTINGS), ...d.settings } };
        state.day ||= blankState().day;
        state.rotations ||= emptyRotations();
        cleanStaffNames(); migrateRooms(); syncRooms();
      } catch {
        state = before; // keep what was here rather than a half-loaded file
        toast('That file is damaged, so nothing was changed.');
        return;
      }
      nextId = 1 + state.staff.reduce((m, p) => Math.max(m, parseInt(String(p.id).replace(/\D/g, ''), 10) || 0), 0);
      clearUndo(); lastRows = state.roster ? JSON.stringify(state.roster.rows) : null;
      render();
      toast(`Loaded everything from the file: ${state.staff.length} staff, ${Object.keys(state.days || {}).length + 1} days.`);
      return;
    }
    if (data.kind !== 'ot-roster-team') throw new Error('not a team file');
    if (state.staff.length && !confirm('Replace the staff list, rooms and settings in this browser with the team file?')) return;
    state.settings = { ...clone(DEFAULT_SETTINGS), ...data.settings };
    state.staff = data.staff || [];
    state.staffLog = data.staffLog || [];
    staffBackup = null;
    cleanStaffNames();
    state.roomTemplate = data.roomTemplate || clone(DEFAULT_ROOMS);
    state.roomsVersion = data.roomsVersion || 1;
    if (data.rotations) state.rotations = { ...emptyRotations(), ...data.rotations };
    migrateRooms();
    nextId = 1 + state.staff.reduce((m, p) => Math.max(m, parseInt(String(p.id).replace(/\D/g, ''), 10) || 0), 0);
    syncRooms();
    render();
    toast(`Team file loaded: ${state.staff.length} staff.`);
  } catch (err) {
    toast(err instanceof SyntaxError ? "That file isn't a roster file (it can't be read as JSON)." : "That file isn't an OT roster team file or a Download everything file.");
  }
});

// ---------- team sign-in and shared rosters ----------

const cs = { ready: !cloud.enabled, user: null, member: null, meta: {}, versions: {}, recent: null, members: null, request: null, requests: null };
let rostererName = '';
const nameKey = () => 'ot-roster-name:' + (cs.user?.email || '').toLowerCase();
function storeName(n) { rostererName = n; try { localStorage.setItem(nameKey(), n); } catch { /* no storage */ } }
state.cloudBase ||= {}; // date -> updatedAt of the cloud copy this browser last loaded or saved

const isMember = () => !!cs.member;
const isAdmin = () => cs.member?.role === 'admin';
const isViewer = () => cs.member?.role === 'viewer'; // reads the saved rosters and My day; changes nothing
const ROLES = [['rosterer', 'Rosterer'], ['admin', 'Admin'], ['viewer', 'Viewer (sees rosters, changes nothing)']];
const me = () => ({ email: cs.user.email, displayName: cs.user.displayName, rostererName: rostererName.trim() });
const when = ms => new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const byName = b => b?.name || b?.email || 'someone';

// Cloud errors in words someone can act on; the technical message goes to the console.
function cloudError(e) {
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

function renderCloudBar() {
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
function teamSyncBar() {
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
  clearTimeout(saveTimer); clearedForGood = true;
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
    staffBackup = null;
    cleanStaffNames();
    state.roomTemplate = t.roomTemplate || clone(DEFAULT_ROOMS);
    const m = await cloud.loadMonthly();
    if (m) state.monthly = m.months || {};
    const rot = await cloud.loadRotations();
    if (rot) state.rotations = { ...emptyRotations(), weeks: rot.weeks || {} };
    state.teamSyncedAt = t.updatedAt;
    state.roomsVersion = t.roomsVersion || 1;
    migrateRooms();
    nextId = 1 + state.staff.reduce((m, p) => Math.max(m, parseInt(String(p.id).replace(/\D/g, ''), 10) || 0), 0);
    syncRooms();
    state.teamSyncedHash = teamHash();
    render();
    toast(`Team version loaded: ${state.staff.length} staff, ${state.roomTemplate.length} rooms and settings.`);
  } catch (e) { cloudError(e); }
}

async function saveRosterToCloud() {
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
  lastRows = state.roster ? JSON.stringify(state.roster.rows) : null;
  state.cloudBase[date] = updatedAt;
  hashPending = { date, at: updatedAt };
  editing = null;
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

function rosterLogCard() {
  const log = state.roster?.log || [];
  if (!log.length) return null;
  return h('section', { class: 'card' }, h('details', {},
    h('summary', {}, `Change log (${log.length})`),
    h('ul', { class: 'log' }, log.map(e => h('li', {},
      h('div', { class: 'seen' }, `${when(e.at)} · ${e.by}`),
      e.changes.length === 1 ? h('div', {}, e.changes[0]) : h('ul', {}, e.changes.map(c => h('li', {}, c))))))));
}

function historyCard() {
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
function membersCard() {
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

lastRows = state.roster ? JSON.stringify(state.roster.rows) : null;
state.tab = location.hash === '#myday' ? 'myday' : state.staff.length ? 'roster' : 'staff'; // the page opens on the roster
render();
openOnTheRightDay();
setTimeout(maybeWhatsNew, 1200);
// a practice link with a scenario (?demo=short): set it up once per visit
if (DEMO) {
  const sc = new URLSearchParams(location.search).get('demo');
  let done = '';
  try { done = sessionStorage.getItem('nuh-roster-scenario') || ''; } catch { /* no storage */ }
  if (SCENARIOS.some(x => x[0] === sc) && done !== sc) { try { sessionStorage.setItem('nuh-roster-scenario', sc); } catch { /* no storage */ } setTimeout(() => applyScenario(sc), 300); }
}
// practice mode opens with the tour, once
if (DEMO && !SCENARIOS.some(x => x[0] === new URLSearchParams(location.search).get('demo'))) { try { if (!localStorage.getItem(TOUR_KEY)) setTimeout(startTour, 700); } catch { /* no storage */ } }
document.getElementById('tourBtn')?.addEventListener('click', () => startTour());
document.getElementById('allBtn')?.addEventListener('click', downloadEverything);
addEventListener('hashchange', () => { if (location.hash === '#myday' && state.tab !== 'myday') { closeTagEditor(); state.tab = 'myday'; window.scrollTo(0, 0); render(); } });
document.getElementById('keysBtn')?.addEventListener('click', showShortcuts);
// Something unexpected broke mid-change: say so in plain words (the screen may not have caught up), once a minute
// at most; the details go to the console.
let lastCrash = 0;
function crashed(err) {
  console.error(err);
  if (Date.now() - lastCrash < 60e3) return;
  lastCrash = Date.now();
  toast('Something went wrong, so your last change may not have gone in. Check it, press Undo, or reload the page.', { label: 'Reload', run: () => location.reload() });
}
addEventListener('error', e => { if (e.error) crashed(e.error); });
addEventListener('unhandledrejection', e => crashed(e.reason));
// Offline app shell (sw.js): the app opens with poor signal. A new version installs alongside and is offered here.
(function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:' || window.ROSTER_MOVED_TO || /^(www\.)?anawj\.com$/.test(location.hostname)) return; // not at the old address (it redirects)
  let reloading = false, wantReload = false;
  const hadController = !!navigator.serviceWorker.controller; // the first install takes control quietly
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading || !(hadController || wantReload)) return; reloading = true; location.reload(); });
  navigator.serviceWorker.register('sw.js').then(reg => {
    const offer = w => {
      if (document.getElementById('update-bar')) return;
      barHost().prepend(h('div', { id: 'update-bar', class: 'demo-bar', role: 'status' }, h('b', {}, 'Update available'), h('span', { class: 'grow' }),
        h('button', { class: 'small primary', onclick: () => { document.getElementById('update-bar')?.remove(); wantReload = true; w.postMessage('skipWaiting'); } }, 'Reload')));
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); }); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(err => console.warn('Service worker not registered', err));
})();
document.getElementById('keyBtn')?.addEventListener('click', showKey);
// Phones: keep the bottom-sheet person box above the on-screen keyboard, and the field being typed in visible.
if (window.visualViewport) {
  const fit = () => {
    const box = document.querySelector('.tag-editor');
    if (!box || innerWidth > 600) return;
    const vv = visualViewport, covered = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    box.style.bottom = covered + 'px';
    box.style.maxHeight = Math.round(vv.height * 0.9) + 'px';
  };
  visualViewport.addEventListener('resize', fit);
  visualViewport.addEventListener('scroll', fit);
  document.addEventListener('focusin', e => {
    if (innerWidth > 600 || !e.target.closest?.('.tag-editor')) return;
    setTimeout(() => { fit(); e.target.scrollIntoView({ block: 'nearest' }); }, 250);
  });
}
