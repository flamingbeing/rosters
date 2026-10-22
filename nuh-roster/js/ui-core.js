// Shared state and helpers for the roster screens (ui-*.js): the saved roster (state), saving, staff lookups and
// the tiny DOM helper. Imports no other ui-*.js file, so it is ready before they run; what it needs from them goes
// through hooks (set by app.js).
import { DEFAULT_SETTINGS, DEFAULT_ROOMS, OLD_GRADES, suggestFlags } from './engine.js';
import { cleanContactName } from './xlsxio.js';
import { emptyRotations, postingOn } from './rotations.js';
import { makeDemo, demoNotes, demoAdmin } from './demo.js';
import { mergeSaved, migrateRooms as migrateRoomsIn } from './store.js';
import { leaveOn } from './monthly.js';
// Seniors are always shown in black; juniors may be green (Baby MO) or purple (locum).
export const staffColour = p => (p && p.role !== 'senior' && p.colour) || '';

// ?demo: a made-up department, kept apart from real data in its own storage
export const DEMO = new URLSearchParams(location.search).has('demo');
export const KEY = DEMO ? 'ot-roster-demo' : 'ot-roster-v1';
export const clone = o => JSON.parse(JSON.stringify(o));
// tomorrow, in local time: the roster is made the day before
export const today = () => {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------- state ----------

export function blankState() {
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

export let state = blankState();
export const setState = v => (state = v);
// storage trouble, shown as a bar: 'full' (a save failed) or { corrupt: key } (saved data couldn't be read)
export let storeProblem = null;
export const setStoreProblem = v => (storeProblem = v);
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
export function postingOf(p) { return postingOn(state.rotations, p, state.day.date, state.day.staff[p.id]?.posting); }
// What the rotation (or usual posting) says, without the day's change.
export function plannedPosting(p) { return postingOn(state.rotations, p, state.day.date); }
export function withPosting(p) { return p?.role === 'junior' ? { ...p, posting: postingOf(p) } : p; }
export function dayStaff() { return state.staff.map(withPosting); }

// a new demo day starts with that day's made-up case notes, and two seniors on an admin day
export function fillDemoNotes(day) {
  const notes = demoNotes(day.date);
  for (const r of day.rooms) if (notes[r.name]) { r.notes = notes[r.name]; r.running = true; r.flags = suggestFlags(r.notes, state.settings, r.name); }
  const wd = new Date(day.date + 'T12:00').getDay();
  if (wd === 0 || wd === 6) return;
  const onLeave = new Set(leaveOn(state.monthly, day.date).map(e => e.name));
  for (const id of demoAdmin(day.date, state.staff, onLeave)) day.staff[id] = { ...(day.staff[id] || {}), status: 'admin', manual: true };
}

// Room list changes since the first version: Remote Case -> Remote 1 + Remote 2, add KROR 1 and MCOR 9.
// Names imported before titles were stripped ("Dr Brandon Ong", "A/Prof ..."): clean them and
// remember they came from an import, so a contact list can correct their role.
export function cleanStaffNames() {
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

export function migrateRooms() { migrateRoomsIn(state); } // (a declaration, so it can run before this line)

export let saveTimer, lastSaved = '', checkKey = '', clearedForGood = false, otherTab = false;
export const setCheckKey = v => (checkKey = v);
export const setClearedForGood = v => (clearedForGood = v);
export const setOtherTab = v => (otherTab = v);
export function save() {
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
      if (was) { storeProblem = null; hooks.renderStoreBar(); toast('Saving in this browser works again.'); }
    } catch {
      // usually the browser's storage is full: say so, rather than losing changes without a word
      if (!storeProblem || was) { storeProblem = 'full'; hooks.renderStoreBar(); }
    }
  }, 200);
}

export let nextId = 1 + state.staff.reduce((m, p) => Math.max(m, parseInt(String(p.id).replace(/\D/g, ''), 10) || 0), 0);
export const setNextId = v => (nextId = v);
export const newId = () => 'p' + nextId++;

export function syncRooms() {
  const byName = Object.fromEntries((state.day.rooms || []).map(r => [r.name, r]));
  state.day.rooms = state.roomTemplate.map((t, i) => byName[t.name]
    ? { ...byName[t.name], complex: t.complex }
    : { id: 'r' + i + '-' + t.name.replace(/\W+/g, ''), name: t.name, complex: t.complex, running: !!t.defaultOn, session: 'full', notes: '', flags: { subspecs: [], complex: false, long: false }, flagsManual: false, lockSenior: '', lockJunior: '' });
}

export const dayOf = id => (state.day.staff[id] ||= {});
export const person = id => state.staff.find(p => p.id === id);

// Set by app.js: what this file needs from the screens.
export const hooks = { renderStoreBar() {}, undo() {} };

// ---------- tiny DOM helper ----------

export function h(tag, attrs = {}, ...kids) {
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
export function toast(msg, action) {
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
export const undoToast = msg => toast(msg, { label: 'Undo', run: hooks.undo, title: 'Undo (Ctrl+Z)' });

export const select = (value, options, onchange) => { let found = false; return h('select', { onchange: e => onchange(e.target.value) },
  options.map(o => {
    const [v, label] = Array.isArray(o) ? o : [o, o || '—'];
    const on = !found && v === value; if (on) found = true; // only the first ("Choose…", not a separator line)
    return h('option', { value: v, selected: on }, label);
  })); };

export const fileButton = (label, accept, multiple, onfiles) => h('label', { class: 'btn' }, label,
  h('input', { type: 'file', accept, multiple, hidden: true, onchange: async e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) await onfiles(f); } }));

// Vendor scripts (ExcelJS, jsPDF, pdf.js) load the first time they're needed, so opening the app (and My day on
// a phone) doesn't wait for them. Each loads once.
const vendorLoads = {};
export function loadVendor(src) {
  return vendorLoads[src] ||= new Promise((ok, fail) => {
    const el = document.createElement('script');
    el.src = src; el.onload = ok;
    el.onerror = () => { delete vendorLoads[src]; fail(new Error(`Couldn't load ${src}`)); };
    document.head.append(el);
  });
}
export const excel = async () => { await loadVendor('/lib/exceljs.min.js'); return window.ExcelJS; };

export async function readWorkbook(file) {
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

export function download(name, blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
