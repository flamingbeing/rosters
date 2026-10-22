// The Premeds tab.
import { isBaby, matchName, namesInCell, SPECIAL_ROWS, isSpecialRow } from './engine.js';
import { buildLayout, COL_WIDTHS, doubleCovered } from './layout.js';
import { addDays } from './monthly.js';
import { clone, h, save, select, state, toast } from './ui-core.js';
import { practiceTaskCard } from './ui-practice.js';
import { longDate, render } from './ui-screen.js';
import { nextStep, rosterLists } from './ui-cases.js';
import { afterRosterEdit, cellParts, logRoster, pushUndo, pushUndoAll, redo, redoStack, rosterView, setLastRows, setRosterView, showKey, TOUCH, undo, undoStack } from './ui-roster.js';
import { parseNamePart } from './ui-tags.js';
import { colourCache, colourOf, colourStyle, fillGaps, notesCell, openPersonBox, personChip, rosterCell, runGenerate, shortOf } from './ui-person.js';
import { callsCard, effectiveGeneral } from './ui-general.js';
import { noListCard, problemsCard } from './ui-problems.js';
import { changesCard, downloadButton } from './ui-export.js';
import { historyCard, isMember, rosterLogCard, saveRosterToCloud } from './ui-team.js';

// ----- premed tab -----

export function renderPremed() {
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
export function renderSheet() {
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
  setLastRows(JSON.stringify(r.rows));
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
export function commentsText() {
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
    setLastRows(JSON.stringify(rows));
    afterRosterEdit(true);
    const n = (state.roster.checks || []).filter(w => w.level === 'error').length;
    toast(`Copied ${longDate(from)}'s roster.${n ? ` ${n} problem${n > 1 ? 's' : ''} to fix (people away today, empty rooms).` : ''}`, { label: 'Fill empty gaps', run: fillGaps });
  } }, `Start from ${new Date(from + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}'s roster`);
}

export function renderRoster() {
  const r = state.roster;
  const actions = h('div', { class: 'bar' },
    h('button', { class: 'primary', onclick: () => runGenerate(!!r) }, r ? 'Generate new' : 'Generate roster'),
    !r ? copyRosterButton() : null,
    r && r.date === state.day.date && h('button', { onclick: fillGaps, title: 'Keep every name already on the roster and fill only the empty cells' }, 'Fill empty gaps'),
    r && h('button', { disabled: !undoStack.length, title: undoStack.length ? `Undo${typeof undoStack.at(-1) === 'object' ? ' ' + undoStack.at(-1).what : ' the last change'} (Ctrl+Z)` : 'Nothing to undo', onclick: undo }, 'Undo'),
    r && h('button', { disabled: !redoStack.length, title: redoStack.length ? 'Redo (Ctrl+Y)' : 'Nothing to redo', onclick: redo }, 'Redo'),
    r && isMember() && h('button', { class: 'primary', onclick: saveRosterToCloud }, 'Save'),
    r && h('div', { class: 'seg', role: 'group', 'aria-label': 'View' },
      h('button', { 'aria-pressed': String(rosterView === 'edit'), onclick: () => { setRosterView('edit'); render(); } }, 'Edit'),
      h('button', { 'aria-pressed': String(rosterView === 'sheet'), onclick: () => { setRosterView('sheet'); render(); } }, 'Sheet preview')),
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
