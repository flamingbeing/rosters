// The Roster tab: the roster grid, editing names in cells, undo and redo, and the keyboard shortcuts.
import { DEFAULT_GRADE, postingName, bySeniority, matchName, namesInCell, check, fmtSenior, fmtJunior, isCoverPart } from './engine.js';
import { shortName } from './layout.js';
import * as cloud from './cloud.js';
import { SYMBOLS, HOW, WHATS_NEW } from './help.js';
import { addDays } from './monthly.js';
import { dayOf, dayStaff, DEMO, h, newId, person, postingOf, state, syncRooms, toast, withPosting } from './ui-core.js';
import { app, render, switchDate } from './ui-screen.js';
import { confirmChanges, who } from './ui-staff.js';
import { goTab, noListPeople } from './ui-cases.js';
import { buildNamePart, closeTagEditor, parseNamePart, setTagTimer, TAGS, tagTimer } from './ui-tags.js';
import { openPersonBox, openTagEditor } from './ui-person.js';
import { personCache, syncMonthly } from './ui-monthly.js';
import { DOWNLOADS } from './ui-export.js';
import { isMember, saveRosterToCloud } from './ui-team.js';

// ----- roster tab -----

// ---- names in roster cells: drag to swap or move, double-click to type ----

const PREMED = /\s*-\s*premed\s*$/i;
export function cellParts(row, key) {
  return String(row[key] || '').split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean)
    .map(s => key === 'premed' ? s.replace(PREMED, '') : s);
}
export function setCellParts(row, key, parts) {
  row[key] = parts.map(p => key === 'premed' ? `${p} - Premed` : p).join(' / ');
}

export let undoStack = []; // roster rows as JSON, or { roster, day?, what } (JSON) for a whole-roster or whole-day change
export let redoStack = []; // what Undo took back, in the same form; any new change clears it
export function pushUndo(e) {
  undoStack.push(e);
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
}
export const clearUndo = () => { undoStack = []; redoStack = []; };
// Before replacing the whole roster (Generate new): keep the roster. With day, also the day's
// details (restoring a saved version, the person box), and even when there's no roster yet.
export function pushUndoAll(what, { day = false } = {}) {
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
export function undo() {
  const e = undoStack.pop();
  if (!e) return;
  redoStack.push(inverseOf(e));
  applyStep(e, 'Undo');
}
export function redo() {
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
export function maybeWhatsNew() {
  let seen = null;
  try { seen = localStorage.getItem(WHATS_NEW_KEY); } catch { return; }
  if (seen === WHATS_NEW[0][0]) return;
  if (DEMO || !state.staff.length) { try { localStorage.setItem(WHATS_NEW_KEY, WHATS_NEW[0][0]); } catch { /* no storage */ } return; }
  if (document.getElementById('toast')?.classList.contains('show') || document.querySelector('dialog[open]')) { setTimeout(maybeWhatsNew, 5000); return; } // after the message on screen
  toast('The roster has been updated.', { label: 'What\'s new', run: showWhatsNew });
  try { localStorage.setItem(WHATS_NEW_KEY, WHATS_NEW[0][0]); } catch { /* no storage */ }
}
export function showKey() {
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
export function showShortcuts() {
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
export let lastRows = null; // rows as of the last logged change
export const setLastRows = v => (lastRows = v);
export let editing = null; // "rowIndex:key" of the cell being typed in
export const setEditing = v => (editing = v);

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

export function logRoster(changes) {
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

export function afterRosterEdit(undone, prompted) {
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
export function dropToPool(src) {
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
export const TOUCH = matchMedia('(hover: none), (pointer: coarse)').matches;

// Move or swap by tapping (works without dragging, e.g. on a phone): pick "Move or swap" in a
// name's box, then tap where they go. The next tap on a name swaps, on a cell moves, on the
// Admin / no list box takes them off.
let swapSrc = null;
export function startSwap(src, p) {
  closeTagEditor();
  swapSrc = { ...src, who: shortName(p) || p.name };
  document.body.classList.add('swapping');
  render();
}
function endSwap() { swapSrc = null; document.body.classList.remove('swapping'); document.getElementById('swap-bar')?.remove(); }
export function renderSwapBar() {
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

export function startNameDrag(e, src) {
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
      else if (ev.type === 'pointerup' && !src.cover && !src.dup) { clearTimeout(tagTimer); setTagTimer(setTimeout(() => openTagEditor(chip, src), 200)); }
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
export async function resolvePerson(text, role) {
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
export function nameInput(attrs = {}, role = null, rank = null) {
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
export function rankForCell(row, key) {
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

export let rosterView = 'edit';
export const setRosterView = v => (rosterView = v);
