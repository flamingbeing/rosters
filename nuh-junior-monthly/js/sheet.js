// NUH Junior Monthly: the department's Google Sheet in and out. The sheet stays the source of truth (its formulas,
// colours and other tabs are the department's), so the app reads the month's grid tab (pasted from Sheets, or a
// downloaded .xlsx) and gives back only the day cells, in the same rows and columns, to paste over the same block.
// A cell whose meaning didn't change goes back exactly as it was typed ("X/NP", "(XX)", "TL ").
//
// The grid tab ("1 - 30 Nov 26 Request"): a header row "S/N | Grade | Name | 1 | 2 | … | 30 | 1-Dec", the weekday names
// in the row above it, one row per person below (S/N, grade, name, one code per day, then the 1st of next month), then
// a blank row and count rows. Pure functions, no DOM (node tests use them).
import * as M from './model.js';

const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Column number (0-based) to letters: 3 -> D, 34 -> AI
export function colName(i) { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }

// Rows (arrays of cell text) from a paste: tab-separated, as Google Sheets copies a range.
export function rowsFromTSV(text) {
  return String(text || '').replace(/\r/g, '').split('\n').map(l => l.split('\t'));
}

// Find the grid: header row, day columns, people. `rowOffset` = the sheet row of rows[0] minus 1 (a paste that
// started at A1 has 0). Returns null when no grid is found.
export function parseGrid(rows, { rowOffset = 0, colOffset = 0 } = {}) {
  const h = rows.findIndex(r => r.slice(0, 5).some(c => /^name$/i.test(norm(c))) && r.slice(0, 5).some(c => /^(grade|s\/n)$/i.test(norm(c))));
  if (h < 0) return null;
  const head = rows[h];
  const nameCol = head.findIndex(c => /^name$/i.test(norm(c)));
  const gradeCol = head.findIndex(c => /^grade$/i.test(norm(c)));
  const snCol = head.findIndex(c => /^s\/n$/i.test(norm(c)));
  const days = [];
  for (let c = nameCol + 1; c < head.length; c++) {
    const v = norm(head[c]);
    if (/^\d{1,2}$/.test(v) && +v === days.length + 1) days.push(c); else break;
  }
  if (days.length < 28) return null;
  const nextCol = days[days.length - 1] + 1;
  const wdRow = rows[h - 1] || [];
  const firstWd = norm(wdRow[days[0]]).slice(0, 3).toLowerCase();
  // the month: a "1 to 30 November 26" or "Nov 26" anywhere above the header
  let month = '';
  for (let r = 0; r < h && !month; r++) for (const c of rows[r]) {
    const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*'?(\d{2,4})\b/i.exec(norm(c));
    if (m) { const y = m[2].length === 2 ? 2000 + +m[2] : +m[2]; month = `${y}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}`; break; }
  }
  const people = [];
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = norm(row[nameCol]);
    const sn = snCol >= 0 ? norm(row[snCol]) : '';
    const grade = gradeCol >= 0 ? norm(row[gradeCol]) : '';
    if (!name) { if (people.length && rows.slice(r + 1, r + 3).every(x => !norm((x || [])[nameCol]))) break; continue; }
    if (people.length && !grade && !/^\d+$/.test(sn)) break;   // the count rows ("R1", "Total Jnr") have neither
    people.push({ row: r + 1 + rowOffset, sn, grade, name, texts: days.map(c => (row[c] == null ? '' : String(row[c]))), next: row[nextCol] == null ? '' : String(row[nextCol]) });
  }
  return { headerRow: h + 1 + rowOffset, firstCol: days[0] + colOffset, nextCol: nextCol + colOffset, nDays: days.length, firstWd, month, people };
}

// Does the month fit the grid (days in the month, weekday of the 1st)?
export function monthFits(grid, month) {
  if (!grid || !/^\d{4}-\d{2}$/.test(month || '')) return false;
  const days = M.monthDays(month);
  if (days.length !== grid.nDays) return false;
  const wd = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][M.weekday(days[0])];
  return !grid.firstWd || grid.firstWd === wd;
}

// Words the sheet uses that the app works out from the date or ignores.
const IGNORE = new Set(['WE', 'PH', 'WD', '']);
// One cell's text -> { a: [codes], r: [requests], pc, ppc, unknown: [] }. dmap: code -> duty; upper: CODE -> code.
export function codesFromText(text, dmap, upper) {
  const out = { a: [], r: [], pc: false, ppc: false, unknown: [] };
  const t = norm(text);
  if (!t) return out;
  for (let tok of t.split(/[\s/,+&]+/)) {
    tok = tok.replace(/^\((.*)\)$/, '$1').replace(/_+$/, '');   // (XX) -> XX, R_ -> R, S1_ -> S1 (a request)
    const req = /_$/.test(t) && !tok.includes('_');
    const T = tok.toUpperCase();
    if (IGNORE.has(T)) continue;
    if (T === 'PC') { out.pc = true; continue; }
    if (T === 'PPC') { out.ppc = true; continue; }
    if (T === 'X') { out.r.push('X'); continue; }
    const code = upper.get(T);
    if (!code) { out.unknown.push(tok); continue; }
    const du = dmap.get(code);
    if (du.kind === 'request') out.r.push(code);
    else if (req && du.kind === 'shift') { out.r.push('R'); }   // "S1_" / "R1_": asks for that call
    else out.a.push(code);
  }
  return out;
}

// The group for a grade text ("RES3", "Fellow", "LOC")
export function groupForGrade(state, grade) {
  const G = norm(grade).toUpperCase();
  const g = (state.groups || []).find(x => (x.grades || []).map(s => s.toUpperCase()).includes(G))
    || (state.groups || []).find(x => x.id.toUpperCase() === G);
  return g ? g.id : null;
}

const nameKey = s => norm(s).toLowerCase().replace(/[^a-z]/g, '');

// The newest month imported from the sheet so far ('' before the first import).
export function latestImported(state) {
  return Object.keys((state && state.sheets) || {}).filter(m => /^\d{4}-\d{2}$/.test(m)).sort().pop() || '';
}
// How a group's grade reads in the review ("RES1"): its first sheet grade.
const gradeLabel = (state, gid) => { const g = (state.groups || []).find(x => x.id === gid); return (g && (g.grades || [])[0]) || String(gid || '?').toUpperCase(); };

// What an import would do: people matched / new / skipped (seniors' rows), unknown codes, cells, and who moves to
// another group because the sheet shows a new grade (the July change-over). Moves only from the newest month imported
// so far (or a newer one): an older month never moves anyone back (those are in `olderMoves`, for the review to say).
export function planImport(state, grid, month) {
  const dmap = M.dutyMap(state);
  const upper = new Map([...dmap.keys()].map(c => [c.toUpperCase(), c]));
  const byName = new Map((state.staff || []).map(p => [nameKey(p.name), p]));
  const unknown = new Map();
  const people = [];
  for (const row of grid.people) {
    const group = groupForGrade(state, row.grade);
    if (!group) { people.push({ ...row, skip: true, why: `grade ${row.grade || '?'} not on People › Groups` }); continue; }
    const match = byName.get(nameKey(row.name));
    const parsed = row.texts.map(t => codesFromText(t, dmap, upper));
    parsed.forEach(p => p.unknown.forEach(u => unknown.set(u, (unknown.get(u) || 0) + 1)));
    people.push({ ...row, group, match: match ? match.id : '', parsed });
  }
  // someone listed twice (moved to another grade mid-month): keep the row with their roster, leave the other alone
  const busy = p => (p.texts || []).filter(t => norm(t) && !/^(Z|WE|PH)$/i.test(norm(t))).length;
  const seen = new Map();
  for (const p of people) {
    if (p.skip) continue;
    const k = nameKey(p.name), other = seen.get(k);
    if (!other) { seen.set(k, p); continue; }
    const drop = busy(p) > busy(other) ? other : p;
    drop.skip = true; drop.why = 'listed twice: this row is left as it is';
    if (drop === other) seen.set(k, p);
  }
  // grade changes, from the row that is kept (someone listed twice moves to that row's grade)
  const staff = new Map((state.staff || []).map(p => [p.id, p]));
  const changes = people.filter(p => !p.skip && p.match && staff.get(p.match).group !== p.group).map(p => {
    const was = staff.get(p.match);
    return { id: was.id, name: was.name, row: p.row, from: was.group, to: p.group, fromGrade: gradeLabel(state, was.group), toGrade: norm(p.grade) };
  });
  const latest = latestImported(state), newest = !latest || month >= latest;
  return { month, people, unknown, latest, moves: newest ? changes : [], olderMoves: newest ? [] : changes };
}

// The calls (shifts) found in the rows that will be imported, by code: Map code -> count. For the import review, so a missing
// call is visible straight away.
export function countCalls(state, plan) {
  const dmap = M.dutyMap(state), upper = new Map([...dmap.keys()].map(c => [c.toUpperCase(), c]));
  const out = new Map();
  for (const row of plan.people) {
    if (row.skip) continue;
    for (const t of row.texts) for (const c of codesFromText(t, dmap, upper).a) if (dmap.get(c)?.kind === 'shift') out.set(c, (out.get(c) || 0) + 1);
  }
  return new Map([...out.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

// Apply a planned import (inside a store commit): move people whose grade changed, add new people, replace this
// month's cells for everyone in the sheet, remember the sheet layout and each cell's original text (for the copy
// back). Unknown codes are added as kind "other" when addUnknown is true, else kept as cell notes. `moves`: the staff
// ids of the planned grade moves to make (the ones left ticked in the review); all of them when not given.
export function applyImport(draft, plan, grid, { addUnknown = true, tab = '', source = null, moves = null } = {}) {
  const month = plan.month;
  const days = M.monthDays(month);
  if (addUnknown) for (const code of plan.unknown.keys()) if (!draft.duties.some(d => d.code.toUpperCase() === code.toUpperCase())) draft.duties.push(M.cleanDuty({ code, name: code, kind: 'other' }));
  // a new grade: to the end of the new group, as People › Staff adds people, so the sheet order stays grouped
  const take = moves == null ? null : new Set(moves);
  let moved = 0;
  for (const mv of plan.moves || []) {
    if (take && !take.has(mv.id)) continue;
    const i = draft.staff.findIndex(p => p.id === mv.id);
    if (i < 0 || draft.staff[i].group === mv.to) continue;
    const [p] = draft.staff.splice(i, 1);
    p.group = mv.to;
    let at = -1;
    draft.staff.forEach((x, k) => { if (x.group === mv.to) at = k; });
    if (at >= 0) draft.staff.splice(at + 1, 0, p); else draft.staff.push(p);
    moved++;
  }
  const dmap = M.dutyMap(draft);
  const upper = new Map([...dmap.keys()].map(c => [c.toUpperCase(), c]));
  // source: { id, gid, title } when it was read straight from a Google Sheet; names: the name in each row as read (to check the rows haven't moved)
  const layout = { tab, headerRow: grid.headerRow, firstCol: grid.firstCol, nextCol: grid.nextCol, rows: {}, orig: {}, names: {}, importedAt: new Date().toISOString() };
  if (source) layout.source = { id: String(source.id), gid: source.gid == null ? null : String(source.gid), title: String(source.title || tab) };
  let added = 0, cells = 0;
  layout.grades = {};   // the grade (group) each person has in this month's sheet
  const inSheet = new Set();   // everyone the sheet lists, even a row left alone (someone listed twice)
  for (const row of plan.people) {
    layout.orig[row.row] = [...row.texts, row.next];
    layout.names[row.row] = row.name;
    if (row.skip) { if (row.match) inSheet.add(row.match); continue; }
    let id = row.match;
    if (!id) {
      id = M.uid('s');
      draft.staff.push({ id, name: row.name, short: '', group: row.group, tags: [], fte: 1, start: '', end: '', note: '', active: true });
      added++;
    }
    layout.rows[row.row] = id;
    layout.grades[id] = row.group;
    inSheet.add(id);
    // the sheet shows only the call (or PC / PPC) on a posting day: the posting underneath comes from the days around
    const parsedRow = row.texts.map(t => codesFromText(t, dmap, upper));
    const postOf = p => p.a.find(c => dmap.get(c)?.kind === 'posting') || '';
    const covered = p => p.pc || p.ppc || p.a.some(c => dmap.get(c)?.kind === 'shift');
    const fill = parsedRow.map(postOf);
    // last month's last days (already imported) count as the days before day 1
    const prevPost = (() => { for (let b = 1; b <= 3; b++) { const c = M.getCell(draft, M.addDays(days[0], -b), id); const p = c && (c.a || []).find(x => dmap.get(x)?.kind === 'posting'); if (p) return p; } return ''; })();
    for (let k = 0; k < fill.length; k++) {
      if (fill[k] || !covered(parsedRow[k])) continue;
      let b = k - 1; while (b >= 0 && !postOf(parsedRow[b]) && covered(parsedRow[b])) b--;
      let f = k + 1; while (f < fill.length && !postOf(parsedRow[f]) && covered(parsedRow[f])) f++;
      const before = b >= 0 ? postOf(parsedRow[b]) : prevPost, after = f < fill.length ? postOf(parsedRow[f]) : '';
      fill[k] = before || after;
      if (before && after && before !== after) fill[k] = before;
    }
    // leave or a blank day or two inside a posting (the same posting on both sides) keeps the posting underneath:
    // the posting is planned by the week, and a day's leave doesn't start a new block
    for (let k = 0; k < fill.length; k++) {
      if (fill[k]) continue;
      const p = parsedRow[k];
      if (p.a.some(c => dmap.get(c)?.kind === 'shift')) continue;
      let b = k - 1; while (b >= 0 && !fill[b] && k - b <= 6) b--;
      let f = k + 1; while (f < fill.length && !fill[f] && f - k <= 6) f++;
      const before = b >= 0 ? fill[b] : (k < 3 ? prevPost : ''), after = f < fill.length ? fill[f] : '';
      if (before && before === after && (f - b - 1) <= 7) for (let j = Math.max(b + 1, 0); j < f; j++) if (!fill[j]) fill[j] = before;
    }
    days.forEach((d, k) => {
      const p = parsedRow[k];
      if (fill[k] && !p.a.includes(fill[k])) p.a.unshift(fill[k]);
      // PC / PPC the app can't explain from the cells (carried over from last month) stay as typed codes
      if (p.pc && (k === 0 || !parsedRow[k - 1].a.some(c => dmap.get(c)?.overnight))) p.a.push('PC');
      if (p.ppc && (k < 2 || !parsedRow[k - 2].a.some(c => dmap.get(c)?.rest2))) p.a.push('PPC');
      const note = !addUnknown && p.unknown.length ? p.unknown.join(' ') : '';
      M.setCell(draft, d, id, { a: p.a, r: p.r, auto: [], note, lock: false });
      if (p.a.length || p.r.length) cells++;
    });
  }
  if (!draft.sheets || typeof draft.sheets !== 'object') draft.sheets = {};
  // who was on the staff list now, and who the sheet lists: anyone known but not listed is hidden from the month
  // (model.js notInSheet); people added later are not in `known`, so they stay visible
  layout.known = draft.staff.map(p => p.id);
  layout.inSheet = [...inSheet];
  draft.sheets[month] = layout;
  return { added, cells, moved };
}

// The text the sheet should show for one person-day: a call first, then PC / PPC, leave, other, the posting; requests
// follow ("P/X").
export function cellText(state, date, staffId) {
  const dmap = M.dutyMap(state);
  const cell = M.getCell(state, date, staffId);
  const eff = M.effectiveCodes(state, date, staffId);
  const a = (cell && cell.a) || [];
  const r = ((cell && cell.r) || []).map(c => (c === 'XX' ? '(XX)' : c));
  const of = k => a.filter(c => (dmap.get(c) || {}).kind === k);
  let main = '';
  const shifts = of('shift');
  if (shifts.length) main = shifts.join('/');
  else if (of('leave').length) main = of('leave').join('/');   // leave the day after a call: the sheet shows the leave
  else if (eff.includes('x') || a.includes('PC')) main = 'PC';
  else if (eff.includes('PPC')) main = 'PPC';
  else if (of('other').filter(c => c !== 'PC' && c !== 'PPC').length) main = of('other').filter(c => c !== 'PC' && c !== 'PPC').join('/');
  else if (!r.length && of('posting').length) main = of('posting')[0];
  return [main, ...r].filter(Boolean).join('/');
}

// Same meaning? (so an unchanged cell goes back exactly as typed). A posting the sheet didn't show (a weekend, a
// request or a blank day inside a posting: the app fills the posting in underneath) doesn't count as a change.
function sameMeaning(state, text, want) {
  const dmap = M.dutyMap(state);
  const upper = new Map([...dmap.keys()].map(c => [c.toUpperCase(), c]));
  const a = codesFromText(text, dmap, upper), b = codesFromText(want, dmap, upper);
  const shown = a.a.some(c => dmap.get(c)?.kind === 'posting');
  const key = p => [...p.a.filter(c => shown || dmap.get(c)?.kind !== 'posting'), ...p.r.map(x => 'r:' + x), p.pc ? 'PC' : '', p.ppc ? 'PPC' : '', ...p.unknown].filter(Boolean).sort().join(',');
  return key(a) === key(b);
}

// The block to paste back over the sheet: every person row from the first to the last, day 1 to the 1st of next
// month. Rows the app doesn't know (seniors) go back exactly as they were. Returns { tsv, range, changes: [...] }.
export function exportBlock(state, month) {
  const lay = state.sheets && state.sheets[month];
  if (!lay) return null;
  const days = M.monthDays(month);
  const rowsNums = Object.keys(lay.orig).map(Number).sort((x, y) => x - y);
  if (!rowsNums.length) return null;
  const first = rowsNums[0], last = rowsNums[rowsNums.length - 1];
  const nextDay = M.addDays(days[days.length - 1], 1);
  const lines = [], changes = [];
  for (let r = first; r <= last; r++) {
    const orig = lay.orig[r];
    const id = lay.rows[r];
    const person = id && (state.staff || []).find(p => p.id === id);
    if (!orig) { lines.push(new Array(days.length + 1).fill('').join('\t')); continue; }
    const out = [];
    days.forEach((d, k) => {
      const was = orig[k] || '';
      if (!person) { out.push(was); return; }
      const want = cellText(state, d, id);
      if (sameMeaning(state, was, want)) { out.push(was); return; }
      out.push(want);
      changes.push({ cell: `${colName(lay.firstCol + k)}${r}`, row: r, k, name: person.name, date: d, from: was.trim(), to: want });
    });
    // the 1st of next month: post call (or the day off) after a call on the last days
    const nextOrig = orig[days.length] || '';
    let nx = nextOrig;
    if (person) {
      const lastCell = M.getCell(state, days[days.length - 1], id);
      const dmap = M.dutyMap(state);
      let want = '';
      if (lastCell && (lastCell.a || []).some(c => dmap.get(c)?.overnight)) want = 'PC';
      else {
        const prev2 = M.getCell(state, days[days.length - 2], id);
        if (prev2 && (prev2.a || []).some(c => dmap.get(c)?.rest2) && (lastCell?.a || []).some(c => (prev2.a || []).includes(c) && dmap.get(c)?.kind === 'posting')) want = 'PPC';
      }
      // the 1st-of-next-month cell holds a marker (Z) in some sheets: leave anything that isn't blank or a PC/PPC as it is
      const nextKeep = norm(nextOrig) !== '' && !/^(PC|PPC)$/i.test(norm(nextOrig));
      if (want && !nextKeep && norm(nextOrig).toUpperCase() !== want) nx = want;
      if (nx !== nextOrig) changes.push({ cell: `${colName(lay.nextCol)}${r}`, row: r, k: days.length, name: person.name, date: nextDay, from: nextOrig.trim(), to: nx });
    }
    out.push(nx);
    lines.push(out.join('\t'));
  }
  const range = `${colName(lay.firstCol)}${first}:${colName(lay.nextCol)}${last}`;
  return { tsv: lines.join('\n'), range, first, last, topLeft: `${colName(lay.firstCol)}${first}`, changes, tab: lay.tab };
}

// After the changes were written to the Google Sheet: the sheet now holds these texts, so they become the "as imported"
// copy (the next copy back then shows only what changed since). Inside a store commit.
export function markWritten(draft, month, changes) {
  const lay = draft.sheets && draft.sheets[month];
  if (!lay) return;
  for (const c of changes) if (lay.orig[c.row]) lay.orig[c.row][c.k] = c.to;
  // kept so the write can be undone: exactly which cells, what was there, what was written
  lay.lastWrite = { at: new Date().toISOString(), changes: changes.map(c => ({ cell: c.cell, row: c.row, k: c.k, name: c.name, date: c.date, from: c.from, to: c.to })) };
}
// After an undo of that write: the cells put back are "as read" again; cells left alone (edited since) stay in the record.
export function markUndone(draft, month, restored, skipped) {
  const lay = draft.sheets && draft.sheets[month];
  if (!lay || !lay.lastWrite) return;
  const back = new Set(restored.map(c => c.cell));
  for (const c of lay.lastWrite.changes) if (back.has(c.cell) && lay.orig[c.row]) lay.orig[c.row][c.k] = c.from;
  const left = lay.lastWrite.changes.filter(c => !back.has(c.cell));
  lay.lastWrite = left.length ? { ...lay.lastWrite, changes: left } : null;
}
