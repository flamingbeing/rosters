// Practice (?demo): scenarios, the planted-mistakes task and the practice draft.
import { isPacu, fmtSenior, isSpecialRow } from './engine.js';
import { buildRosterWorkbook, cellText } from './xlsxio.js';
import { shortName } from './layout.js';
import { dayOf, DEMO, download, excel, fillDemoNotes, h, state, syncRooms, toast, undoToast } from './ui-core.js';
import { isoDate, render, switchDate } from './ui-screen.js';
import { goTab, rosterLists } from './ui-cases.js';
import { afterRosterEdit, cellParts, pushUndoAll, setLastRows } from './ui-roster.js';
import { personOfPart } from './ui-tags.js';
import { colourOf, runGenerate, shortOf } from './ui-person.js';
import { effectiveGeneral } from './ui-general.js';
import { syncMonthly } from './ui-monthly.js';
export const demoLink = () => location.origin + location.pathname + '?demo';

// Practice: harder mornings to try, also as links a trainer can send (?demo=short, ?demo=latemc, ?demo=weekend).
export const SCENARIOS = [['short', 'Short-staffed (seniors away, double covers)'], ['latemc', 'Late MC at 7am (after the roster is out)'], ['weekend', 'A weekend']];
export function applyScenario(kind) {
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
export function resetPracticeDay() {
  pushUndoAll('resetting the day', { day: true });
  state.day = { date: state.day.date, rooms: [], staff: {} };
  state.roster = null; state.practiceTask = null;
  syncRooms(); fillDemoNotes(state.day); syncMonthly();
  setLastRows(null);
  render();
  undoToast('This day is back to how Practice made it.');
}
// Practice: make the roster, then plant three mistakes a rosterer meets most mornings; the card on the Roster
// tab ticks each one off when the live checks no longer find it.
export function startPracticeTask() {
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
  setLastRows(JSON.stringify(r.rows));
  afterRosterEdit(true);
  goTab('roster');
  const n = ['No problems', 'One problem', 'Two problems', 'Three problems'][items.length];
  toast(`${n} ${items.length === 1 ? 'is' : 'are'} planted in this roster. Fix ${items.length === 1 ? 'it' : 'them'} from the Problems card (or by hand); the checklist ticks them off.`);
}
export function practiceTaskCard() {
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
export async function downloadPracticeDraft() {
  const rows = state.day.rooms.filter(r => r.running && !isPacu(r.name)).map(r => ({ roomId: r.id, label: r.name, complex: r.complex, senior: '', junior: '', premed: '', notes: r.notes || '' }));
  const wb = buildRosterWorkbook(await excel(), { date: state.day.date, rows, lists: rosterLists(), general: effectiveGeneral(), box: '', colourOf, shortOf });
  // the admin team's draft has each room's cases in column L (the sent-out sheet doesn't)
  const notes = Object.fromEntries(rows.map(r => [r.label, r.notes]));
  wb.worksheets[0].eachRow(row => { const label = cellText(row.getCell(1).value).replace(/:\s*$/, '').trim(); if (notes[label]) row.getCell(12).value = notes[label]; });
  download(`Practice draft ${state.day.date}.xlsx`, new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  toast('Practice draft downloaded. Now press "Do it all" and pick it.');
}
