// The Monthly tab and the monthly roster grids.
import { matchName } from './engine.js';
import { cellText, cleanContactName } from './xlsxio.js';
import { MONTHLY, monthlyDef, LEAVE_TYPES, NIGHT_DUTIES, monthIssues, cleanCell, daysIn, weekday, monthName, addDays, readMonthlyPdf, readMonthlyXlsx, buildMonthlyWorkbook, dutiesOn, leaveOn } from './monthly.js';
import { download, excel, fileButton, h, loadVendor, readWorkbook, save, select, state, toast, undoToast } from './ui-core.js';
import { app, render, switchDate } from './ui-screen.js';
import { fixNamesCard } from './ui-cases.js';
import { nameInput, pushUndo } from './ui-roster.js';
import { renderRotations } from './ui-rotations.js';
import { renderToday } from './ui-today.js';

// ----- monthly tab -----

// A name as written on a monthly roster ("Quah Zi Hui, Bernice", "LOKE BENJAMIN") -> person
export const personCache = new Map();
// A monthly roster name that matches more than one person: their names, else null.
function ambiguousText(text) {
  const t = cleanCell(text);
  if (!t || personByText(t)) return null;
  const m = matchName(t, state.staff);
  return m.ambiguous?.length ? m.ambiguous.map(p => p.name) : null;
}
export const unmatchedTitle = v => { const a = ambiguousText(v); return a ? `Could be ${a.join(' or ')}: type more of the name` : 'Not matched to the staff list'; };
export function personByText(text) {
  const t = cleanCell(text);
  if (!t) return null;
  if (!personCache.has(t)) {
    const m = matchName(t, state.staff);
    personCache.set(t, m.person || matchName(cleanContactName(t), state.staff).person || null);
  }
  return personCache.get(t);
}

// What the monthly rosters say about everyone on a date: id -> { status, why, liver }
export function derivedFor(date) {
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
export const hasMonthly = () => Object.keys(state.monthly || {}).length > 0;

// Bring the day's manpower in line with the monthly rosters. Anything set by hand stays.
export function syncMonthly() {
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
export function renderMonthly() {
  const view = MONTHLY_VIEWS.some(v => v[0] === state.monthlyView) ? state.monthlyView : 'today';
  const tabs = h('div', { class: 'seg subtabs', role: 'group', 'aria-label': 'Monthly' }, MONTHLY_VIEWS.map(([k, label]) =>
    h('button', { 'aria-pressed': String(view === k), onclick: () => { state.monthlyView = k; render(); } }, label)));
  return h('div', {}, tabs, view === 'today' ? renderToday() : view === 'rotations' ? renderRotations() : renderMonthlyRoster(view));
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
