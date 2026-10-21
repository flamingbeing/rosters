// NTF Roster: files in and out. The department's "ALL STAFF LEAVE REQUEST" Excel sheet (import and export in the
// same layout), JSON backup / restore, rules-only JSON, an ICS calendar for one person and a CSV of a month.
// ExcelJS is passed in (node tests) or loaded the first time Excel is used (browser), so opening the app stays light.
import * as M from './model.js';
import { splitMark } from './reqprio.js';

// ---------- ExcelJS ----------

let excelPromise = null;

// Inject /lib/exceljs.min.js once and resolve window.ExcelJS.
export function loadExcelJS() {
  if (typeof window !== 'undefined' && window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (typeof document === 'undefined') return Promise.reject(new Error('ExcelJS is only loaded in a browser; pass it in.'));
  if (!excelPromise) {
    excelPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/lib/exceljs.min.js';   // one copy for the repo's three apps (shared folder, worker/routes.js)
      s.onload = () => (window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('ExcelJS did not load')));
      s.onerror = () => { excelPromise = null; reject(new Error('Could not load the Excel reader. Check your connection and try again.')); };
      document.head.append(s);
    });
  }
  return excelPromise;
}

async function getExcel(opts) {
  if (opts && opts.ExcelJS) return opts.ExcelJS;
  if (typeof globalThis !== 'undefined' && globalThis.ExcelJS) return globalThis.ExcelJS;
  return loadExcelJS();
}

// ---------- small helpers ----------

const pad = n => String(n).padStart(2, '0');
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const MON3 = MONTHS.map(m => m.slice(0, 3));
const WD_LETTERS = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'S'];

// The text a sheet cell shows (rich text, formulas with cached results, hyperlinks).
export function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return M.iso(v);
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return v.result instanceof Date ? M.iso(v.result) : String(v.result);
    return '';
  }
  return String(v);
}

// A cell comment (ExcelJS: a string or { texts: [{ text }] }).
function noteText(n) {
  if (!n) return '';
  if (typeof n === 'string') return n.trim();
  if (Array.isArray(n.texts)) return n.texts.map(t => t.text || '').join('').trim();
  return '';
}

// Day-first d/m/yy or d/m/yyyy to ISO, or '' when not a real date.
export function dmy(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/);
  if (!m) return '';
  const d = +m[1], mo = +m[2], y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : '';
}
function toDmy(s) { const [y, m, d] = s.split('-').map(Number); return `${d}/${m}/${String(y).slice(2)}`; }

// Lower case, no titles, letters and digits only: "Dr. Tan  Ah-Kow" -> "tan ah kow".
const TITLES = /^(?:(?:adj(?:unct)?\.?\s+)?(?:a\/?\s?prof|assoc\.?\s+prof|asst\.?\s+prof|clin\.?\s+prof|prof|dr|mr|mrs|ms|mdm)\.?\s+)+/i;
export function stripTitles(name) { return String(name || '').trim().replace(TITLES, '').trim(); }
export function normName(name) {
  return stripTitles(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// "Name (R4-SR1 25/5/26-13/9/26)" or "Name (B) 6/5/26-7/9/26" -> { name, note, start, end }.
const DATE_RE = /\d{1,2}[/.]\d{1,2}[/.](?:\d{4}|\d{2})(?![\d])/;
export function parseNameCell(text) {
  let raw = String(text || '').replace(/\s+/g, ' ').trim();
  const brackets = [];
  raw = raw.replace(/\(([^)]*)\)/g, (_, inner) => { brackets.push(inner.trim()); return ' '; });
  // Dates may sit inside a bracket or after the name.
  let rest = raw, start = '', end = '';
  const findRange = (s) => {
    const r = s.match(new RegExp(`(${DATE_RE.source})\\s*[-–]\\s*(${DATE_RE.source}|[A-Za-z]{3,9}\\.?\\s*/?\\s*\\d{2,4})?`));
    if (!r) return null;
    return { all: r[0], a: dmy(r[1]), bRaw: r[2] || '', b: r[2] ? dmy(r[2]) : '' };
  };
  const single = (s) => { const r = s.match(DATE_RE); return r ? { all: r[0], a: dmy(r[0]), bRaw: '', b: '' } : null; };
  let notes = [];
  const take = (s) => {
    if (start) return s;
    const f = findRange(s) || single(s);
    if (!f || !f.a) return s;
    start = f.a; end = f.b;
    const left = s.replace(f.all, ' ');
    return f.bRaw && !f.b ? `${left} until ${f.bRaw}` : left;
  };
  rest = take(rest);
  for (const b of brackets) notes.push(take(b));
  const clean = s => s.replace(/\s+/g, ' ').replace(/^[\s,;-]+|[\s,;-]+$/g, '').trim();
  const name = clean(stripTitles(clean(rest)));
  notes = notes.map(clean).filter(Boolean);
  return { name, note: notes.join(' · '), start, end };
}

// Section headings in the sheet -> group ids. The state's own group names are tried first (custom groups).
const SECTION_RES = [
  [/^SENIOR RESIDENT PHYSICIAN/i, 'srp'],
  [/^SENIOR RESIDENT/i, 'sr'],
  [/^(SENIOR\s+)?CONSULTANTS?\b|^SENIOR CONSULTANT/i, 'cons'],
  [/^ASSOCIATE CONSULTANT/i, 'ac'],
  [/^NUH\b|NTFGH|ICU CONSULTANT/i, 'ext'],
  [/^VISITING CONSULTANT/i, 'vc'],
  [/^RESIDENT PHYSICIAN/i, 'rp'],
  [/^JUNIOR RESIDENT/i, 'jr'],
  [/^LOCUMS?\b/i, 'locum'],
  [/^MEDICAL OFFICERS?\b|^MOS?$/i, 'mo'],
  [/^PACU\b|\bAPN\b|^NURSES?\b/i, 'nurse'],
];
function sectionGroup(text, state) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || (/[a-z]/.test(t) && !/^PACU\b/.test(t))) return null;   // headings are in capitals; names usually aren't
  const groups = state.groups || [];
  const own = groups.find(g => g.name.toUpperCase() === t.toUpperCase());
  if (own) return own.id;
  for (const [re, id] of SECTION_RES) if (re.test(t)) return groups.some(g => g.id === id) ? id : (groups[0] && groups[0].id);
  return null;
}
const COUNT_ROW = /^(total\b|snr doctors|junior doctors|senior doctors|seniors? (at work|on)\b|juniors? (at work|on)\b)/i;
const STOP_ROW = /^(MEETING REQUESTS|LEGEND)\b/i;

// Case-insensitive code lookup: exact match first, then any case.
function codeIndex(state) {
  const exact = new Map(), lower = new Map();
  for (const d of state.duties || []) {
    exact.set(d.code, d);
    if (!lower.has(d.code.toLowerCase())) lower.set(d.code.toLowerCase(), d);
  }
  return t => exact.get(t) || lower.get(t.toLowerCase()) || null;
}

// Cell text -> { a, r, note, u }: a = assigned codes, r = requests, u = code-like words we don't know, note = the rest.
export function parseCellText(text, state, lookup = codeIndex(state)) {
  const out = { a: [], r: [], note: '', u: [] };
  const rest = [];
  const toks = String(text || '').split(/[\s/,;+&]+/).filter(Boolean);
  for (const tok of toks) {
    if (tok.toLowerCase() === 'x') continue;   // post call is derived, never stored
    let d = lookup(tok);
    // "Cr!" / "Nc?": a request with a priority mark (reqprio.js)
    const sm = d ? null : splitMark(tok);
    if (sm && sm.mark) { const dd = lookup(sm.code); if (dd && dd.kind === 'request') { d = dd; (out.rp || (out.rp = {}))[dd.code] = sm.mark; } }
    if (d && d.kind !== 'derived') {
      const list = d.kind === 'request' ? out.r : out.a;
      if (!list.includes(d.code)) list.push(d.code);
    } else rest.push(tok);
  }
  // A cell that is one short word we don't know ("JR", "NS") is probably a code; words beside known codes
  // ("Clinic UG") and anything else ("3-4.30pm", "bcls-pm") are notes.
  if (rest.length === 1 && toks.length === 1 && /^[A-Za-z]{1,6}$/.test(rest[0])) out.u.push(rest[0]);
  else out.note = rest.join(' ');
  return out;
}

// ---------- import: the department sheet ----------

// The meaning of a cell's fill in the department sheet: blue (99CCFF) = approved, green (33CC33) = pain service week.
export function fillKind(cell) {
  const f = cell && cell.fill;
  const c = f && f.type === 'pattern' && f.fgColor && typeof f.fgColor.argb === 'string' ? f.fgColor.argb.toUpperCase() : '';
  if (c.endsWith('99CCFF')) return 'blue';
  if (c.endsWith('33CC33') || c.endsWith('92D050')) return 'aps';
  return '';
}

// Find the month row ("DECEMBER 2026" in column A) and map each day column to a real date.
function readMonthHeader(ws) {
  let hdr = null;
  const maxRow = Math.min(ws.rowCount || 0, 40);
  for (let r = 1; r <= maxRow && !hdr; r++) {
    const t = cellText(ws.getRow(r).getCell(1).value).replace(/\s+/g, ' ').trim().toUpperCase();
    const m = t.match(/^([A-Z]+)\s+(\d{4})$/);
    if (m && MONTHS.includes(m[1])) hdr = { row: r, month: `${m[2]}-${pad(MONTHS.indexOf(m[1]) + 1)}`, label: t };
  }
  if (!hdr) return null;
  const row = ws.getRow(hdr.row), wdRow = ws.getRow(hdr.row + 1);
  const last = Math.max(ws.columnCount || 0, row.cellCount || 0);
  const nums = [];   // [{ col, n }] for plain day numbers
  let endCol = last;
  for (let c = 2; c <= last; c++) {
    const t = cellText(row.getCell(c).value).replace(/\s+/g, ' ').trim();
    if (t.toUpperCase() === hdr.label) { endCol = c - 1; break; }   // the name column repeated at the right
    if (/^\d{1,2}$/.test(t)) nums.push({ col: c, n: +t });
  }
  // Day 1 of the month: the first "1" followed by "2" in the next column (the first numbers may be 29, 30).
  let day1 = null;
  for (let i = 0; i < nums.length; i++) {
    if (nums[i].n === 1 && nums[i + 1] && nums[i + 1].n === 2 && nums[i + 1].col === nums[i].col + 1) { day1 = nums[i].col; break; }
  }
  if (day1 == null) return { ...hdr, cols: [], endCol, warn: `${M.fmtMonth(hdr.month)}: day numbers not found` };
  const first = `${hdr.month}-01`;
  const cols = [];   // [{ col, date }]
  let warn = '';
  for (let c = 2; c <= endCol; c++) {
    const t = cellText(row.getCell(c).value).trim(), w = cellText(wdRow.getCell(c).value).trim();
    if (!t && !w) { if (c > day1) break; else continue; }
    const date = M.addDays(first, c - day1);
    if (/^\d{1,2}$/.test(t) && +t !== +date.slice(8)) warn = `${M.fmtMonth(hdr.month)}: column ${c} says ${t} but should be ${+date.slice(8)}`;
    cols.push({ col: c, date });
  }
  return { ...hdr, cols, endCol, warn };
}

// parseDeptWorkbook(arrayBuffer | ExcelJS workbook, state, { ExcelJS? }) -> review data (see SPEC "Excel").
export async function parseDeptWorkbook(input, state, opts = {}) {
  let wb = input;
  if (!input || !Array.isArray(input.worksheets)) {
    const ExcelJS = await getExcel(opts);
    wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(input); } catch (e) {
      throw new Error('This isn\'t an .xlsx workbook. In Excel use Save As › Excel Workbook (.xlsx) and try again.');
    }
  }
  const lookup = codeIndex(state);
  const out = { months: [], people: [], cells: {}, unknownCodes: {}, meetings: [], warnings: [] };
  const byName = new Map();   // normName -> person
  const staffIdx = new Map();
  for (const p of state.staff || []) {
    for (const n of [p.name, p.short]) { const k = normName(n); if (k && !staffIdx.has(k)) staffIdx.set(k, p.id); }
  }
  const findStaff = (name) => staffIdx.get(normName(name)) ||
    [...staffIdx.entries()].find(([k]) => k.replace(/ /g, '') === normName(name).replace(/ /g, ''))?.[1] || null;

  for (const ws of wb.worksheets) {
    const hdr = readMonthHeader(ws);
    if (!hdr) continue;
    if (hdr.warn) out.warnings.push(hdr.warn);
    if (!hdr.cols.length) continue;
    const monthInfo = { month: hdr.month, sheet: ws.name, dates: hdr.cols.map(c => c.date), people: 0, cells: 0 };
    out.months.push(monthInfo);
    let group = null, stop = false;
    const nameRows = [];
    for (let r = hdr.row + 2; r <= ws.rowCount && !stop; r++) {
      const row = ws.getRow(r);
      const a = cellText(row.getCell(1).value).replace(/\s+/g, ' ').trim();
      if (!a) continue;
      if (STOP_ROW.test(a)) { stop = true; if (/^MEETING/i.test(a)) readMeetings(ws, r, hdr, out); break; }
      if (COUNT_ROW.test(a)) continue;
      const g = sectionGroup(a, state);
      if (g) { group = g; continue; }
      if (/^(NAME|DATE\/TIME|TYPE OF MEETINGS?)$/i.test(a)) continue;
      nameRows.push({ r, a, group });
    }
    for (const { r, a, group: g } of nameRows) {
      const info = parseNameCell(a);
      if (!info.name) continue;
      const key = normName(info.name);
      let person = byName.get(key);
      if (!person) {
        if (!g) out.warnings.push(`${info.name}: no section heading above, put in ${state.groups[state.groups.length - 1]?.name || 'the last group'}`);
        person = { key: 'p' + out.people.length, name: info.name, note: info.note, start: info.start, end: info.end,
          group: g || (state.groups[state.groups.length - 1] || {}).id || 'mo', matchId: findStaff(info.name), rows: [] };
        byName.set(key, person);
        out.people.push(person);
      } else {
        // Seen on an earlier sheet: the later sheet's posting note and dates win when given.
        if (info.note) person.note = info.note;
        if (info.start) { person.start = info.start; person.end = info.end; }
      }
      person.rows.push({ month: hdr.month, row: r });
      monthInfo.people++;
      const row = ws.getRow(r);
      for (const { col, date } of hdr.cols) {
        const cell = row.getCell(col);
        const text = cellText(cell.value).trim();
        const comment = noteText(cell.note);
        const colour = fillKind(cell);
        if (!text && !comment && colour !== 'aps') continue;
        const pc = parseCellText(text, state, lookup);
        // Colours carry meaning in the department sheet: blue = approved leave or a course (unavailable), a green
        // empty cell = a pain service (APS) week.
        if (colour === 'aps' && !text && lookup('APS')) pc.a.push('APS');
        if (colour === 'blue' && text) {
          if (!pc.a.some(c => (lookup(c) || {}).kind === 'leave')) {
            const m = text.match(/^([A-Za-z]{2,6})(?=[-\s(]|$)/);
            const d = m && lookup(m[1]);
            const code = d && d.kind === 'leave' ? d.code : (lookup('CL') ? 'CL' : '');
            if (code) { pc.a.push(code); pc.u = pc.u.filter(u => u.toLowerCase() !== (m ? m[1].toLowerCase() : '')); if (!pc.note && !(d && d.kind === 'leave')) pc.note = text; else if (!pc.note) pc.note = text.replace(m ? m[0] : '', '').replace(/^[-\s]+/, ''); }
          }
          pc.ap = true;
        } else if (colour === 'blue') pc.ap = false;
        if (comment) pc.note = pc.note ? `${pc.note} ${comment}` : comment;
        if (colour === 'blue' && pc.a.some(c => (lookup(c) || {}).kind === 'leave')) pc.ap = true;
        if (!pc.a.length && !pc.r.length && !pc.u.length && !pc.note) continue;
        for (const u of pc.u) {
          const k = Object.keys(out.unknownCodes).find(c => c.toLowerCase() === u.toLowerCase()) || u;
          out.unknownCodes[k] = (out.unknownCodes[k] || 0) + 1;
        }
        const day = out.cells[date] || (out.cells[date] = {});
        const own = date.startsWith(hdr.month);
        // A date seen on two sheets (the 29, 30 / JAN columns): the sheet whose own month it is wins.
        if (day[person.key] && !own) continue;
        day[person.key] = { a: pc.a, r: pc.r, ...(pc.rp ? { rp: pc.rp } : {}), note: pc.note, u: pc.u, own, ap: !!pc.ap };
        if (own) monthInfo.cells++;
      }
    }
  }
  if (!out.months.length) out.warnings.push('No month sheet found: expected a row with the month (like "DECEMBER 2026") in column A and day numbers across.');
  // Meeting names -> staff.
  for (const mt of out.meetings) {
    const p = byName.get(normName(mt.name));
    mt.matchKey = p ? p.key : null;
    mt.matchId = p ? p.matchId : findStaff(mt.name);
  }
  return out;
}

// MEETING REQUESTS block: groups of NAME / DATE/TIME / TYPE OF MEETINGS rows; each value spans the columns of
// one request (merged cells repeat their text). Best effort: the day number at the start of DATE/TIME.
function readMeetings(ws, startRow, hdr, out) {
  const seen = new Set();
  for (let r = startRow + 1; r <= Math.min(ws.rowCount, startRow + 60); r++) {
    const a = cellText(ws.getRow(r).getCell(1).value).trim();
    if (!/^NAME$/i.test(a)) continue;
    const nameRow = ws.getRow(r), timeRow = ws.getRow(r + 1), typeRow = ws.getRow(r + 2);
    if (!/^DATE/i.test(cellText(timeRow.getCell(1).value).trim())) continue;
    for (let c = 2; c <= hdr.endCol; c++) {
      const name = cellText(nameRow.getCell(c).value).trim();
      const when = cellText(timeRow.getCell(c).value).trim();
      if (!name || !when) continue;
      const what = cellText(typeRow.getCell(c).value).trim();
      const id = `${name}|${when}|${what}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const m = when.match(/^(\d{1,2})\b/);
      if (!m) continue;
      const date = `${hdr.month}-${pad(+m[1])}`;
      if (M.monthOf(date) !== hdr.month || !M.monthDays(hdr.month).includes(date)) continue;
      const time = (when.match(/\(([^)]*)\)/) || [])[1] || '';
      out.meetings.push({ name, date, text: ['Meeting', what, time].filter(Boolean).join(' ').trim() });
    }
  }
}

// applyImport(draft, parsed, choices) -> summary. Call inside store.commit (one undo step).
// choices = { people: { [key]: 'new' | 'skip' | staffId }, unknown: { [code]: 'code' | 'note' }, meetings: bool }
// For the people and months in the sheet: leave, requests and other codes come from the sheet (replacing what
// was there); shifts already planned in the app stay unless the sheet has a shift that day. Dates from the
// neighbouring months (the 29, 30 / JAN columns) only fill empty cells.
export function applyImport(draft, parsed, choices = {}) {
  const sum = { added: 0, matched: 0, skipped: 0, cells: 0, codesAdded: [], meetings: 0 };
  const pick = choices.people || {};
  const unk = choices.unknown || {};
  const idOf = {};   // parsed person key -> staff id
  const staffById = new Map((draft.staff || []).map(p => [p.id, p]));
  for (const p of parsed.people) {
    const ch = pick[p.key] ?? (p.matchId ? p.matchId : 'new');
    if (ch === 'skip') { sum.skipped++; continue; }
    if (ch !== 'new' && staffById.has(ch)) {
      const s = staffById.get(ch);
      if (p.note) s.note = p.note;
      if (p.start) s.start = p.start;
      if (p.end) s.end = p.end;
      idOf[p.key] = ch; sum.matched++;
    } else {
      const s = { id: M.uid('s'), name: p.name, short: '', group: p.group, tags: [], fte: 1, start: p.start || '', end: p.end || '', note: p.note || '', active: true };
      draft.staff.push(s); staffById.set(s.id, s);
      idOf[p.key] = s.id; sum.added++;
    }
  }
  // Unknown codes the person chose to keep as codes become duties of kind "other".
  const asCode = new Map();
  for (const [code, how] of Object.entries(unk)) {
    if (how !== 'code') continue;
    const have = (draft.duties || []).find(d => d.code.toLowerCase() === code.toLowerCase());
    if (have) { asCode.set(code.toLowerCase(), have.code); continue; }
    draft.duties.push({ code, name: code, kind: 'other', color: '#e0e0e0', ink: '#333', overnight: false, auto: false, hours: 0 });
    asCode.set(code.toLowerCase(), code);
    sum.codesAdded.push(code);
  }
  const kindOf = new Map((draft.duties || []).map(d => [d.code, d.kind]));
  for (const [date, row] of Object.entries(parsed.cells)) {
    for (const [key, pc] of Object.entries(row)) {
      const sid = idOf[key];
      if (!sid) continue;
      const cur = M.getCell(draft, date, sid);
      if (!pc.own && cur) continue;
      const extra = [], noteWords = [];
      for (const u of pc.u || []) {
        const c = asCode.get(u.toLowerCase());
        if (c) { if (!extra.includes(c)) extra.push(c); } else noteWords.push(u);
      }
      const sheetA = [...pc.a, ...extra];
      const sheetShifts = sheetA.filter(c => kindOf.get(c) === 'shift');
      const keptShifts = cur && !sheetShifts.length ? (cur.a || []).filter(c => kindOf.get(c) === 'shift') : [];
      const a = [...keptShifts, ...sheetA];
      const note = [noteWords.join(' '), pc.note].filter(Boolean).join(' ').trim() || (cur ? cur.note : '');
      M.setCell(draft, date, sid, { a, r: pc.r, rp: pc.rp || (cur && cur.rp) || null, note, auto: (cur && cur.auto || []).filter(c => keptShifts.includes(c)), lock: cur ? cur.lock : false, ap: !!pc.ap });
      sum.cells++;
    }
  }
  // People in the sheet whose cells are now empty in the sheet's own month: clear their leave and requests too.
  for (const mInfo of parsed.months) {
    for (const date of M.monthDays(mInfo.month)) {
      for (const p of parsed.people) {
        const sid = idOf[p.key];
        if (!sid || !p.rows.some(x => x.month === mInfo.month) || (parsed.cells[date] && parsed.cells[date][p.key])) continue;
        const cur = M.getCell(draft, date, sid);
        if (!cur) continue;
        const keep = (cur.a || []).filter(c => kindOf.get(c) === 'shift');
        if (keep.length === (cur.a || []).length && !(cur.r || []).length) continue;
        M.setCell(draft, date, sid, { a: keep, r: [] });
      }
    }
    if (!draft.months[mInfo.month]) draft.months[mInfo.month] = { status: 'draft', publishedAt: '', note: '' };
  }
  if (choices.meetings !== false) {
    for (const mt of parsed.meetings || []) {
      const sid = (mt.matchKey && idOf[mt.matchKey]) || (mt.matchId && staffById.has(mt.matchId) ? mt.matchId : null);
      if (!sid) continue;
      const cur = M.getCell(draft, mt.date, sid);
      const note = cur && cur.note ? (cur.note.includes(mt.text) ? cur.note : `${cur.note}; ${mt.text}`) : mt.text;
      M.setCell(draft, mt.date, sid, { note });
      sum.meetings++;
    }
  }
  return sum;
}

// ---------- export: fill the sheet you were sent ----------

// Writes the roster's calls (C), PM shifts (P), half calls (HC) and pain service weeks (green) into the workbook the
// department sent, keeping everything else in it as it was (colours, formulas, counts). Only cells that change are
// touched: a request the shift satisfies (Cr beside a C) is left as written, leave is never overwritten.
// input: the .xlsx bytes. Returns { blob, changed, missing } (missing: roster people not found in the sheet).
const WRITE_CODES = ['C', 'P', 'HC'];
const SATISFIES = { Cr: ['C'], Pr: ['P'], Wr: ['C', 'HC', 'P'] };
export async function fillDeptWorkbook(input, state, month, opts = {}) {
  const ExcelJS = await getExcel(opts);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(input);
  const lookup = codeIndex(state);
  const byName = new Map();
  for (const p of state.staff || []) for (const n of [p.name, p.short]) { const k = normName(n); if (k && !byName.has(k)) byName.set(k, p); }
  const out = { blob: null, changed: 0, missing: [], sheet: '' };
  const seen = new Set();
  for (const ws of wb.worksheets) {
    const hdr = readMonthHeader(ws);
    if (!hdr || hdr.month !== month || !hdr.cols.length) continue;
    out.sheet = ws.name;
    for (let r = hdr.row + 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const a = cellText(row.getCell(1).value).replace(/\s+/g, ' ').trim();
      if (!a) continue;
      if (STOP_ROW.test(a)) break;
      if (COUNT_ROW.test(a) || sectionGroup(a, state)) continue;
      const info = parseNameCell(a);
      const person = info.name && byName.get(normName(info.name));
      if (!person) continue;
      seen.add(person.id);
      for (const { col, date } of hdr.cols) {
        if (!date.startsWith(month)) continue;
        const cell = row.getCell(col);
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) continue;
        const mine = M.getCell(state, date, person.id);
        const want = ((mine && mine.a) || []);
        const wantShifts = WRITE_CODES.filter(c => want.includes(c));
        const text = cellText(cell.value).trim();
        const toks = text.split(/[\s/,;+&]+/).filter(Boolean);
        const isCode = t => WRITE_CODES.some(c => c.toLowerCase() === t.toLowerCase());
        const have = toks.filter(isCode).map(t => WRITE_CODES.find(c => c.toLowerCase() === t.toLowerCase()));
        const reqs = toks.map(t => lookup(t)).filter(d => d && d.kind === 'request').map(d => d.code);
        const covered = c => reqs.some(rq => (SATISFIES[rq] || []).includes(c));
        let next = toks.filter(t => !isCode(t) || wantShifts.some(c => c.toLowerCase() === t.toLowerCase()));
        for (const c of wantShifts) if (!have.includes(c) && !covered(c)) next.push(c);
        const nextText = next.join(' ');
        if (nextText !== toks.join(' ')) { cell.value = nextText || null; out.changed++; }
        // pain service week: a green, empty cell
        const wantAps = want.includes('APS'), isGreen = fillKind(cell) === 'aps';
        if (wantAps && !isGreen && !text) { cell.style = { ...cell.style, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF33CC33' } } }; out.changed++; }
        else if (!wantAps && isGreen && !text) { cell.style = { ...cell.style, fill: { type: 'pattern', pattern: 'none' } }; out.changed++; }
      }
    }
  }
  if (!out.sheet) throw new Error(`The file has no sheet for ${M.fmtMonth(month)}. Choose the sheet the department sent for that month.`);
  out.missing = (state.staff || []).filter(p => p.active !== false && !seen.has(p.id) && M.staffInMonth(state, month).includes(p)).map(p => p.name);
  const buf = await wb.xlsx.writeBuffer();
  out.blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return out;
}

// ---------- export: the department sheet ----------

const argb = hex => 'FF' + String(hex || '#ffffff').replace('#', '').toUpperCase().padEnd(6, '0').slice(0, 6);
const fill = hex => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
const thin = { style: 'thin', color: { argb: 'FFC9D1DD' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

// The text written for a person in the name column: "Name (note 25/5/26-13/9/26)".
export function nameCellText(p) {
  const dates = p.start ? `${toDmy(p.start)}${p.end ? '-' + toDmy(p.end) : ''}` : '';
  const inner = [p.note, dates].filter(Boolean).join(' ');
  return inner ? `${p.name} (${inner})` : p.name;
}

// The codes written in one cell: assigned, requests, and x on post-call days.
function cellCodes(state, date, sid) {
  const cell = M.getCell(state, date, sid);
  const eff = M.effectiveCodes(state, date, sid);
  const out = eff.filter(c => c !== 'x');
  for (const r of (cell && cell.r) || []) if (!out.includes(r)) out.push(r + ((cell.rp && cell.rp[r]) || ''));
  if (eff.includes('x')) out.push('x');
  return { codes: out, note: cell ? cell.note : '' };
}

// exportDeptWorkbook(state, months[], { ExcelJS? }) -> Promise<Blob> (one sheet per month, department layout).
export async function exportDeptWorkbook(state, months, opts = {}) {
  const wb = await buildDeptWorkbook(state, months, opts);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function buildDeptWorkbook(state, months, opts = {}) {
  const ExcelJS = await getExcel(opts);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NTF Roster';
  wb.created = new Date();
  const dm = M.dutyMap(state);
  for (const month of months) {
    const days = M.monthDays(month);
    // Whole weeks, Sunday to Saturday, like the department sheet (29, 30 of the month before … JAN 1, 2).
    const first = M.addDays(days[0], -M.weekday(days[0]));
    const last = M.addDays(days[days.length - 1], 6 - M.weekday(days[days.length - 1]));
    const dates = [];
    for (let d = first; d <= last; d = M.addDays(d, 1)) dates.push(d);
    const lastCol = dates.length + 2;   // A = names, then the days, then the name again
    const label = `${M.fmtMonth(month).toUpperCase()}`;
    const ws = wb.addWorksheet(M.fmtMonth(month).replace(/^(\w{3})\w*/, '$1'), {
      views: [{ state: 'frozen', xSplit: 1, ySplit: 3, zoomScale: 90 }],
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
      properties: { defaultRowHeight: 16 },
    });
    ws.getColumn(1).width = 34;
    for (let i = 0; i < dates.length; i++) ws.getColumn(i + 2).width = 5.6;
    ws.getColumn(lastCol).width = 34;

    // Title
    ws.mergeCells(1, 1, 1, lastCol);
    const title = ws.getCell(1, 1);
    title.value = 'STAFF LEAVE REQUEST';
    title.font = { bold: true, size: 14, color: { argb: 'FF002F6C' } };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 22;

    // Month row and weekday row
    const mRow = ws.getRow(2), wRow = ws.getRow(3);
    mRow.getCell(1).value = label;
    mRow.getCell(lastCol).value = label;
    for (const c of [mRow.getCell(1), mRow.getCell(lastCol)]) c.font = { bold: true, size: 12, color: { argb: 'FF002F6C' } };
    dates.forEach((d, i) => {
      const c = i + 2, own = d.startsWith(month), dn = +d.slice(8);
      const mc = mRow.getCell(c), wc = wRow.getCell(c);
      mc.value = own || d < days[0] ? dn : `${MON3[+d.slice(5, 7) - 1]} ${dn}`;
      wc.value = WD_LETTERS[M.weekday(d)];
      for (const cell of [mc, wc]) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { bold: true, size: 9, color: { argb: own ? 'FF26303D' : 'FF7A1C27' } };
        cell.border = BORDER;
        const hol = M.isHoliday(state, d);
        if (!own) cell.fill = fill('#ff9b9b');
        else if (hol) cell.fill = fill('#ffe2b8');
        else if (M.isWeekend(d)) cell.fill = fill('#e3e8f0');
        if (hol && cell === mc) cell.note = M.holidayName(state, d);
      }
    });

    // Sections and names
    let r = 4;
    const people = M.staffInMonth(state, month);
    // the count rows follow the app's senior / junior rosters (moves by hand included)
    const seniorIds = new Set(people.filter(p => M.poolOf(state, p) === 'senior').map(p => p.id));
    for (const g of state.groups || []) {
      const inGroup = people.filter(p => p.group === g.id);
      if (!inGroup.length) continue;
      const row = ws.getRow(r);
      row.getCell(1).value = g.name.toUpperCase();
      row.getCell(lastCol).value = g.name.toUpperCase();
      for (let c = 1; c <= lastCol; c++) {
        const cell = row.getCell(c);
        cell.fill = fill('#e8eef7');
        cell.font = { bold: true, size: 10, color: { argb: 'FF002F6C' } };
        cell.border = BORDER;
      }
      r++;
      for (const p of inGroup) {
        const pr = ws.getRow(r);
        const nm = nameCellText(p);
        pr.getCell(1).value = nm;
        pr.getCell(lastCol).value = nm;
        for (const c of [pr.getCell(1), pr.getCell(lastCol)]) { c.font = { size: 10 }; c.border = BORDER; }
        dates.forEach((d, i) => {
          const cell = pr.getCell(i + 2);
          cell.border = BORDER;
          cell.alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: true };
          const { codes, note } = cellCodes(state, d, p.id);
          const own = d.startsWith(month);
          if (codes.length) cell.value = codes.join(' ');
          if (note) cell.note = note;
          const main = codes.map(c => dm.get(c)).find(x => x && x.kind !== 'request' && x.kind !== 'derived');
          if (main) {
            cell.fill = fill(main.color);
            cell.font = { size: 9, bold: main.kind === 'shift', color: { argb: argb(main.ink) } };
          } else {
            const req = codes.map(c => dm.get(c) || dm.get(c.replace(/[!?]$/, ''))).find(x => x && x.kind === 'request');
            cell.font = { size: 9, bold: !!req, color: { argb: req ? argb(req.color) : (codes.includes('x') ? 'FF555555' : 'FF26303D') } };
            if (!own) cell.fill = fill('#ffe3e3');
            else if (M.isHoliday(state, d)) cell.fill = fill('#fff1dd');
            else if (M.isWeekend(d)) cell.fill = fill('#eef1f6');
          }
        });
        r++;
      }
    }

    // Count rows
    r++;
    const counts = [
      ['Total Seniors At Work', p => seniorIds.has(p.id), ['@present']],
      ['Total Juniors At Work', p => !seniorIds.has(p.id), ['@present']],
      ["Seniors on 'C'", p => seniorIds.has(p.id), ['C']],
      ["Juniors on 'C'", p => !seniorIds.has(p.id), ['C']],
    ];
    for (const [lbl, who, codes] of counts) {
      const row = ws.getRow(r);
      row.getCell(1).value = lbl;
      row.getCell(1).font = { bold: true, size: 10 };
      dates.forEach((d, i) => {
        const n = people.filter(p => who(p) && M.staffActiveOn(p, d) && M.matchesCodes(state, d, p.id, codes)).length;
        const cell = row.getCell(i + 2);
        cell.value = n;
        cell.alignment = { horizontal: 'center' };
        cell.font = { size: 9, bold: true };
        cell.border = BORDER;
        cell.fill = fill('#f3f5f9');
      });
      row.getCell(lastCol).value = lbl;
      r++;
    }

    // Legend: code and name pairs, four to a row
    r++;
    ws.getRow(r).getCell(1).value = 'LEGEND';
    ws.getRow(r).getCell(1).font = { bold: true, size: 10, color: { argb: 'FF002F6C' } };
    r++;
    const used = (state.duties || []).filter(d => d.kind !== 'derived' || d.code === 'x');
    const per = 4, span = Math.max(4, Math.floor((dates.length - 1) / per));
    used.forEach((d, i) => {
      const row = ws.getRow(r + Math.floor(i / per));
      const c = 2 + (i % per) * span;
      const cc = row.getCell(c), nc = row.getCell(c + 1);
      cc.value = d.code;
      cc.alignment = { horizontal: 'center' };
      if (d.kind === 'request') cc.font = { bold: true, size: 9, color: { argb: argb(d.color) } };
      else { cc.fill = fill(d.color); cc.font = { bold: true, size: 9, color: { argb: argb(d.ink) } }; }
      cc.border = BORDER;
      nc.value = d.name;
      nc.font = { size: 9 };
    });
  }
  return wb;
}

// ---------- JSON ----------

export function backupJSON(state) {
  return JSON.stringify({ kind: 'ntf-roster-backup', v: 1, exportedAt: new Date().toISOString(), state }, null, 1);
}

// The state from a backup file, checked and migrated. Throws an Error with a plain message when it isn't one.
export function restoreJSON(text) {
  let data;
  try { data = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { throw new Error('This file is not a NTF Roster backup (it is not valid JSON).'); }
  if (!data || typeof data !== 'object') throw new Error('This file is not a NTF Roster backup.');
  if (data.kind === 'ntf-roster-rules') throw new Error('This is a rules file, not a backup: import it on the Rules screen.');
  if (data.kind !== 'ntf-roster-backup') throw new Error('This file is not a NTF Roster backup.');
  const s = data.state;
  if (!s || typeof s !== 'object' || Array.isArray(s) || !Array.isArray(s.staff) || !s.cells || typeof s.cells !== 'object' || Array.isArray(s.cells)) throw new Error('This backup is damaged: the roster inside it is missing.');
  try { return M.migrate(JSON.parse(JSON.stringify(s))); } catch (e) { throw new Error('This backup is damaged: it could not be read.'); }
}

export function rulesJSON(state) {
  return JSON.stringify({ kind: 'ntf-roster-rules', v: 1, exportedAt: new Date().toISOString(), rules: state.rules || [], duties: state.duties || [] }, null, 1);
}

export function parseRulesJSON(text) {
  let data;
  try { data = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { throw new Error('This file is not a rules file (it is not valid JSON).'); }
  if (!data || data.kind !== 'ntf-roster-rules') throw new Error(data && data.kind === 'ntf-roster-backup' ? 'This is a whole backup, not a rules file: restore it under More, Backup.' : 'This file is not a NTF Roster rules file.');
  if (!Array.isArray(data.rules)) throw new Error('This rules file has no rules in it.');
  // cleaned like a backup: a rules file from anywhere must not carry broken lists or odd duty kinds into the roster
  return {
    rules: data.rules.filter(r => r && typeof r === 'object' && !Array.isArray(r) && typeof r.type === 'string').map(M.cleanRule),
    duties: Array.isArray(data.duties) ? data.duties.filter(d => d && typeof d === 'object' && typeof d.code === 'string' && d.code).map(M.cleanDuty) : [],
  };
}

// ---------- ICS (one person's shifts) ----------

const icsEsc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Fold lines longer than 75 octets (RFC 5545): continuation lines start with one space.
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '', len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const icsDate = s => s.replace(/-/g, '');
function stampUTC(d = new Date()) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function icsForPerson(state, staffId, month, { now = new Date() } = {}) {
  const p = (state.staff || []).find(s => s.id === staffId);
  const dm = M.dutyMap(state);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//anawj.com//NTF Roster//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEsc(`NTF Roster ${p ? p.name : ''} ${M.fmtMonth(month)}`.replace(/\s+/g, ' ').trim())}`];
  const stamp = stampUTC(now);
  for (const date of M.monthDays(month)) {
    const cell = M.getCell(state, date, staffId);
    for (const code of (cell && cell.a) || []) {
      const d = dm.get(code);
      if (!d || d.kind !== 'shift') continue;
      lines.push('BEGIN:VEVENT',
        `UID:${icsDate(date)}-${code.replace(/[^A-Za-z0-9]/g, '')}-${String(staffId).replace(/[^A-Za-z0-9-]/g, '')}@ntfroster.anawj.com`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(date)}`,
        `DTEND;VALUE=DATE:${icsDate(M.addDays(date, 1))}`,
        `SUMMARY:${icsEsc(`${d.name} (${code})`)}`,
        ...(cell.note ? [`DESCRIPTION:${icsEsc(cell.note)}`] : []),
        'TRANSP:TRANSPARENT',
        'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---------- CSV (a month) ----------

// Text starting with = + - @ (or a tab / carriage return) would run as a formula in Excel: a leading ' keeps it text.
const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function csvForMonth(state, month) {
  const days = M.monthDays(month);
  const gm = M.groupMap(state);
  const rows = [['Name', 'Group', ...days, 'Notes']];
  for (const p of M.staffInMonth(state, month)) {
    const notes = [];
    const row = [p.name, (gm.get(p.group) || {}).name || p.group];
    for (const d of days) {
      const { codes, note } = cellCodes(state, d, p.id);
      row.push(codes.join(' '));
      if (note) notes.push(`${+d.slice(8)}: ${note}`);
    }
    row.push(notes.join('; '));
    rows.push(row);
  }
  return '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---------- download ----------

export function download(blob, filename) {
  if (!(blob instanceof Blob)) blob = new Blob([String(blob)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// File-name-safe month: "ntf-roster-2026-12.xlsx"
export function fileStamp(month) { return String(month || M.iso(new Date())).replace(/[^0-9A-Za-z-]/g, ''); }
