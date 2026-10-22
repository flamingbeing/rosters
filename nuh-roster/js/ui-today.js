// Today: who is where, then the calls and clinics.
import { bySeniority } from './engine.js';
import { MONTHLY, addDays, dutiesOn } from './monthly.js';
import { dayOf, h, person, state, undoToast } from './ui-core.js';
import { app, realToday, render } from './ui-screen.js';
import { nextStep, renderDay } from './ui-cases.js';
import { logRoster, pushUndoAll, TOUCH } from './ui-roster.js';
import { openPersonBox, personChip } from './ui-person.js';
import { renderGeneral } from './ui-general.js';
import { hasMonthly, personByText, unmatchedTitle } from './ui-monthly.js';

// ---- today: who is where, then the calls and clinics ----

export const BOARD = [['working', 'Working'], ['leave', 'Leave'], ['mc', 'MC'], ['postcall', 'Post call'], ['admin', 'Admin']];
export const groupOf = st => ({ leave: 'leave', mc: 'mc', postcall: 'postcall', admin: 'admin' })[st || 'avail'] || 'working';
let boardRole = 'all', boardFilter = '';
// Several days at once: { pid, from, until, status, comment } in state.carry. Saving with "Same until" keeps
// one entry per person starting today; clearing the date ends it today. New days pick them up (applyCarry).
export function setCarry(p, untilDate, group, comment) {
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
export function applyCarry(day) {
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
export function setStatus(p, group, { quiet = false } = {}) {
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

export function renderToday() {
  return h('div', {},
    manpowerBoard(),
    monthlyDayCard(),
    renderGeneral(),
    h('section', { class: 'card' }, h('details', {},
      h('summary', {}, 'More: load the admin draft, paste names from the leave sheet'),
      renderDay('manpower'))));
}
