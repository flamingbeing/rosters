// Problems: what the checks found, with fixes, and the Admin / no list card.
import { isCoverPart } from './engine.js';
import { shortName } from './layout.js';
import { h, state, toast, undoToast } from './ui-core.js';
import { app, render } from './ui-screen.js';
import { goTab, noListPeople } from './ui-cases.js';
import { afterRosterEdit, cellParts, pushUndo, setCellParts, setRosterView, startNameDrag, TOUCH } from './ui-roster.js';
import { buildNamePart, parseNamePart, personOfPart } from './ui-tags.js';
import { fillGaps, openPersonBox, personChip } from './ui-person.js';

// ---- problems: what the checks found, each with a way to see it and, where there is one, a fix ----

export const problemsOf = r => {
  const seen = new Set(), order = { error: 0, warn: 1, info: 2 };
  return (r?.checks || []).filter(w => w.level !== 'info' && !seen.has(w.text) && seen.add(w.text)).sort((a, b) => order[a.level] - order[b.level]);
};
const roomsOfProblem = w => w.rooms || (/^([A-Z][A-Za-z ]*\d*(?: PACU)?):/.exec(w.text) ? [w.text.split(':')[0]] : []);
function showRoom(label) {
  setRosterView('edit');
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
export function problemsCard() {
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
export function noListCard() {
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
