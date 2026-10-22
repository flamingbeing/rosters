// Rotations: each junior's posting by week, planned for the year.
import { POSTINGS, postingName, bySeniority } from './engine.js';
import { cellText } from './xlsxio.js';
import { weekPosting, mondayOf, weeksOfYear, setWeeks, readRotationSheet, buildRotationWorkbook, POSTING_FILL } from './rotations.js';
import { download, excel, fileButton, h, readWorkbook, select, state, toast, undoToast } from './ui-core.js';
import { app, longDate, render } from './ui-screen.js';
import { setStaffFilter, staffFilter } from './ui-staff.js';
import { fixNamesCard, lastRotFile, setLastRotFile } from './ui-cases.js';
import { pushUndo } from './ui-roster.js';
import { openPersonBox, personChip } from './ui-person.js';
import { personByText } from './ui-monthly.js';

// ---- rotations: each junior's posting by week, planned for the year ----

let rotYear = null; // the year on screen
let rotSel = null;  // selected cells: { a: [row, col], b: [row, col] } (a rectangle)
let rotNotes = [];  // what the last import couldn't place
let rotUnmatched = []; // names in the last import not on the junior list
let rotScroll = null; // where the grid was scrolled to, kept across re-renders
const ROT_SHORT = { Cardiac: 'Card', Remote: 'Rem' }; // to fit a week's cell
const pushRotUndo = what => pushUndo({ rot: JSON.stringify(state.rotations), what });
const fillOf = code => POSTING_FILL[code] ? '#' + POSTING_FILL[code].slice(2) : '';

export function renderRotations() {
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
        h('input', { placeholder: 'Filter names', value: staffFilter, oninput: e => { setStaffFilter(e.target.value); rotSel = null; const pos = e.target.selectionStart; render(); const i = app.querySelector('.rot-palette input'); i.focus(); i.setSelectionRange(pos, pos); } }))),
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
export function placeRotGrid() {
  const w = app.querySelector('.rot-wrap'), now = w?.querySelector('th.day.now');
  if (!w) return;
  w.scrollLeft = rotScroll ?? (now ? Math.max(0, now.offsetLeft - w.clientWidth / 2) : 0);
}

async function importRotations([file]) {
  setLastRotFile(file);
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
