// NUH Junior Monthly: the department sheet's "Leave Waitlist" tab, read as data (step 1: read only).
//
// The tab has one row per day of the month (the day number in column A, the weekday in B) and the waitlist columns
// "Waitlist 1" to "Waitlist 6": who is waitlisted for leave on that day, as free text (sometimes with a short remark such as
// "(PM)" or "- medical appt"). The STATUS of each waitlisted person is only the cell's fill colour (the legend on the tab):
//   orange  waitlisted from a leave application (prioritised for approval if the roster permits)
//   none    an ad hoc waitlist request
//   green   waitlist leave expedited approved
//   blue    waitlist leave approved
//   red     a bad day, or waitlist leave rejected
//   cyan    daily roster drafted, waitlist leave application closed
// This file is pure (no screen, no network): the reader (gsheets.js readColoured) gives rows of { v, bg }, this turns them into
// entries. A later step lets the daily rosterers change a status and writes the colour back; here nothing is written.
import { monthDays } from './model.js';

// The statuses, in the order of the sheet's legend. `sheet` is the colour the sheet uses (what the reader recognises); the
// screen shows its own soft tint (ui-leave.js), in the same hue.
export const STATUSES = [
  { id: 'waitlisted', label: 'Waitlisted from a leave application', short: 'Waitlisted', sheet: '#ff9900', hint: 'Prioritised for approval if the roster permits' },
  { id: 'adhoc', label: 'Ad hoc waitlist request', short: 'Ad hoc', sheet: '#ffffff', hint: 'No fill in the sheet' },
  { id: 'expedited', label: 'Waitlist leave expedited approved', short: 'Expedited', sheet: '#00ff00', hint: '' },
  { id: 'approved', label: 'Waitlist leave approved', short: 'Approved', sheet: '#4a86e8', hint: '' },
  { id: 'rejected', label: 'Bad day, or waitlist leave rejected', short: 'Rejected', sheet: '#ff0000', hint: '' },
  { id: 'closed', label: 'Daily roster drafted, application closed', short: 'Closed', sheet: '#00ffff', hint: '' },
];
export const STATUS_BY_ID = Object.fromEntries(STATUSES.map(s => [s.id, s]));

const rgb = hex => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
};

// A fill colour to the status it stands for: the nearest legend colour, so a slightly different shade of orange or blue still
// reads as that status. White, no fill, and anything pale or grey is an ad hoc request (the sheet has no other meaning for it).
// Returns { id, exact } where exact is false when the colour was only close.
export function statusOfColour(bg) {
  const c = rgb(bg);
  if (!c) return { id: 'adhoc', exact: true };
  const pale = Math.min(...c) >= 215;   // white, off-white, very light tints
  if (pale) return { id: 'adhoc', exact: Math.min(...c) >= 250 };
  let best = null;
  for (const s of STATUSES) {
    if (s.id === 'adhoc') continue;
    const t = rgb(s.sheet);
    const d = Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2]);
    if (!best || d < best.d) best = { id: s.id, d };
  }
  return { id: best.id, exact: best.d <= 40 };
}

const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const key = s => norm(s).toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

// "Alina (PM)" -> { name: 'Alina', remark: 'PM' }; "Ryan - medical appt" -> { name: 'Ryan', remark: 'medical appt' }
export function splitEntry(text) {
  let t = norm(text), remark = '';
  const paren = t.match(/\(([^)]*)\)/);
  if (paren) { remark = norm(paren[1]); t = norm(t.replace(paren[0], ' ')); }
  const dash = t.match(/^(.*?)\s+[-–—:]\s+(.+)$/);
  if (dash) { remark = norm([dash[2], remark].filter(Boolean).join('; ')); t = norm(dash[1]); }
  return { name: t, remark };
}

// The waitlist text to someone on the staff list: exact name first, then all the written words found in one person's name, then
// the same words as someone's first name. Several people fit -> no match (shown as written, marked "which one?").
// staff: [{ id, name, short }]. Returns { id } | { ambiguous: [ids] } | null.
export function matchStaff(name, staff) {
  const k = key(name);
  if (!k) return null;
  const words = k.split(' ');
  const people = (staff || []).map(p => ({ id: p.id, full: key(p.name), short: key(p.short || ''), words: key(p.name).split(' ') }));
  const exact = people.filter(p => p.full === k || (p.short && p.short === k));
  if (exact.length === 1) return { id: exact[0].id };
  if (exact.length > 1) return { ambiguous: exact.map(p => p.id) };
  const within = people.filter(p => words.every(w => p.words.some(pw => pw === w || (w.length >= 3 && pw.startsWith(w)))));
  if (within.length === 1) return { id: within[0].id };
  if (within.length > 1) return { ambiguous: within.map(p => p.id) };
  return null;
}

const colLetter = i => { let n = i + 1, s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

// The tab's rows ([[{ v, bg }, ...], ...]; plain strings are fine too) to the month's entries.
// Returns { header, columns, entries, days, problems }. entries: [{ date, slot, cell, text, name, remark, status, exact, staffId }].
export function parseWaitlist(rows, month, staff = []) {
  const cell = (r, c) => { const x = (rows[r] || [])[c]; return x && typeof x === 'object' ? { v: norm(x.v), bg: x.bg || '' } : { v: norm(x), bg: '' }; };
  const problems = [];
  let h = -1;
  for (let r = 0; r < Math.min(rows.length, 8) && h < 0; r++) {
    if ((rows[r] || []).some((_, c) => /^waitlist\s*\d*$/i.test(cell(r, c).v))) h = r;
  }
  if (h < 0) return { header: -1, columns: [], entries: [], days: 0, problems: ['No "Waitlist 1" heading found in the first rows of that tab.'] };
  const columns = [];
  (rows[h] || []).forEach((_, c) => { if (/^waitlist\s*\d*$/i.test(cell(h, c).v)) columns.push(c); });
  // the day number is the first numeric cell left of the waitlist columns
  const dayCol = (() => {
    for (let c = 0; c < columns[0]; c++) {
      let n = 0;
      for (let r = h + 1; r < Math.min(rows.length, h + 6); r++) if (/^\d{1,2}$/.test(cell(r, c).v)) n++;
      if (n >= 3) return c;
    }
    return -1;
  })();
  if (dayCol < 0) return { header: h, columns, entries: [], days: 0, problems: ['No column of day numbers found beside the waitlist.'] };
  const dates = monthDays(month);
  const entries = [];
  let days = 0;
  for (let r = h + 1; r < rows.length; r++) {
    const dn = cell(r, dayCol).v;
    if (!/^\d{1,2}$/.test(dn)) continue;
    const n = Number(dn);
    if (n < 1 || n > dates.length) { problems.push(`Row ${r + 1}: day ${n} is not in ${month}.`); continue; }
    days++;
    const date = dates[n - 1];
    columns.forEach((c, slot) => {
      const x = cell(r, c);
      if (!x.v) return;
      const { name, remark } = splitEntry(x.v);
      const st = statusOfColour(x.bg);
      const m = matchStaff(name, staff);
      entries.push({ date, slot: slot + 1, cell: `${colLetter(c)}${r + 1}`, text: x.v, name, remark, status: st.id, exact: st.exact, staffId: m && m.id ? m.id : '', ambiguous: m && m.ambiguous ? m.ambiguous : null });
    });
  }
  return { header: h, columns, entries, days, problems };
}

// Counts per status for the legend, and the ones that need a look.
export function summarize(entries) {
  const counts = Object.fromEntries(STATUSES.map(s => [s.id, 0]));
  let unmatched = 0, odd = 0;
  for (const e of entries || []) {
    counts[e.status] = (counts[e.status] || 0) + 1;
    if (!e.staffId) unmatched++;
    if (!e.exact) odd++;
  }
  return { counts, total: (entries || []).length, unmatched, odd };
}
