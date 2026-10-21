// NTF Roster: pain service (APS) weeks and leave suggestions for the junior pool. Plain functions over plain data.
//
// An APS week is Monday to Sunday, one person, stored as the code APS on each of the 7 days. The running count of
// weeks per person is `state.aps = { base: { staffId: n }, last: { staffId: 'YYYY-MM' }, through: 'YYYY-MM' }`
// (what happened up to and including `through`, typed in or read from old rosters) plus the weeks in the cells after it.

import * as M from './model.js';
import { CALL_TAGS } from './jpool.js';

const isMonday = s => M.weekday(s) === 1;
export const mondayOf = s => M.addDays(s, -((M.weekday(s) + 6) % 7));
export const weekDays = monday => Array.from({ length: 7 }, (_, i) => M.addDays(monday, i));

// Mondays that start in the month: the weeks this month's sheet is responsible for.
export function weeksOf(month) {
  return M.monthDays(month).filter(isMonday);
}

function apsDaysIn(state, monday, staffId) {
  let n = 0;
  for (const d of weekDays(monday)) {
    const c = M.getCell(state, d, staffId);
    if (c && (c.a || []).includes('APS')) n++;
  }
  return n;
}

// Who has the week starting on `monday` (a person with APS on 4 or more of its 7 days), or ''.
export function weekHolder(state, monday) {
  let best = '', bestN = 0;
  for (const p of state.staff || []) {
    const n = apsDaysIn(state, monday, p.id);
    if (n > bestN) { best = p.id; bestN = n; }
  }
  return bestN >= 4 ? best : '';
}

// Every week with an APS holder in the cells: [{ monday, month, staffId }]
export function weeksInCells(state) {
  const mondays = new Set();
  for (const [d, day] of Object.entries(state.cells || {})) {
    for (const c of Object.values(day)) if ((c.a || []).includes('APS')) { mondays.add(mondayOf(d)); break; }
  }
  const out = [];
  for (const monday of [...mondays].sort()) {
    const staffId = weekHolder(state, monday);
    if (staffId) out.push({ monday, month: M.monthOf(monday), staffId });
  }
  return out;
}

// Weeks done per person before `month`: base (up to `through`) plus the weeks in the cells after it and before `month`.
export function tally(state, month) {
  const aps = state.aps || {};
  const through = aps.through || '';
  const out = new Map();
  for (const p of state.staff || []) out.set(p.id, Number((aps.base || {})[p.id]) || 0);
  for (const w of weeksInCells(state)) {
    if (w.month <= through || w.month >= month) continue;
    out.set(w.staffId, (out.get(w.staffId) || 0) + 1);
  }
  return out;
}

// The last month a person had an APS week before `month` ('' if never known).
export function lastBefore(state, id, month) {
  let last = ((state.aps || {}).last || {})[id] || '';
  for (const w of weeksInCells(state)) if (w.staffId === id && w.month < month && w.month > last) last = w.month;
  return last < month ? last : '';
}

const isR3 = p => /\bR3\b/i.test(`${p.note || ''} ${p.name || ''}`);

// Can this person take the week, and what does it cost? { ok, why: [reasons not ok], score, notes: [short facts] }
export function candidate(state, p, monday, ctx) {
  const days = weekDays(monday);
  const why = [], notes = [];
  const g = (state.groups || []).find(x => x.id === p.group);
  if (!g || g.kind !== 'junior' || p.group === 'locum' || p.group === 'nurse') why.push('not in the call pool');
  else if (M.poolOf(state, p) !== 'junior') why.push('not in the junior pool');
  if (isR3(p)) why.push('R3: no APS');
  if (days.some(d => !M.staffActiveOn(p, d))) why.push('not in post all week');
  const month = M.monthOf(monday);
  const prev = M.addMonths(month, -1);
  if (lastBefore(state, p.id, month) === prev) why.push('had APS last month');
  if (ctx.taken.has(p.id)) why.push('already has an APS week this month');
  let leave = 0;
  const dm = M.dutyMap(state);
  for (const d of days) {
    const eff = M.effectiveCodes(state, d, p.id);
    if (eff.some(c => c !== 'x' && dm.get(c) && dm.get(c).kind === 'leave')) leave++;
  }
  if (leave >= 3) why.push(`on leave ${leave} days that week`);
  else if (leave) notes.push(`${leave} day${leave === 1 ? '' : 's'} leave`);
  const n = ctx.tally.get(p.id) || 0;
  notes.unshift(`${n} week${n === 1 ? '' : 's'} so far`);
  let score = n * 10 + leave * 4;
  if (p.group === 'jr') { score += ctx.manpowerGood(monday) ? -6 : 6; notes.push(ctx.manpowerGood(monday) ? 'JR, manpower is good' : 'JR, manpower is thin'); }
  return { id: p.id, ok: !why.length, why, score, notes, tally: n };
}

// Is there enough manpower that a JR can be spared for the week? (80% of the call list free on an average day)
function manpowerFor(state) {
  const dm = M.dutyMap(state);
  const pool = (state.staff || []).filter(p => p.active !== false && (p.tags || []).some(t => CALL_TAGS.includes(t)));
  return monday => {
    if (!pool.length) return true;
    let free = 0;
    const days = weekDays(monday);
    for (const d of days) for (const p of pool) {
      const eff = M.effectiveCodes(state, d, p.id);
      if (!eff.some(c => c !== 'x' && dm.get(c) && (dm.get(c).kind === 'leave'))) free++;
    }
    return free / (days.length * pool.length) >= 0.8;
  };
}

// Suggestions for every week that starts in the month and has no APS holder yet:
// [{ monday, days, holder, options: [candidate, ...ranked, ok first], pick }]  (pick = best option, never one person twice)
export function suggestMonth(state, month) {
  const t = tally(state, month);
  const taken = new Set(weeksInCells(state).filter(w => w.month === month).map(w => w.staffId));
  const ctx = { tally: t, taken, manpowerGood: manpowerFor(state) };
  const people = (state.staff || []).filter(p => p.active !== false);
  const out = [];
  for (const monday of weeksOf(month)) {
    const holder = weekHolder(state, monday);
    if (holder) { out.push({ monday, days: weekDays(monday), holder, options: [], pick: '' }); continue; }
    const options = people.map(p => candidate(state, p, monday, ctx)).sort((a, b) => (b.ok - a.ok) || (a.score - b.score) || String(a.id).localeCompare(String(b.id)));
    const best = options.find(o => o.ok);
    if (best) ctx.taken.add(best.id);
    out.push({ monday, days: weekDays(monday), holder: '', options, pick: best ? best.id : '' });
  }
  return out;
}

// Write (or clear) a person's APS week into a draft.
export function setWeek(draft, monday, staffId) {
  for (const d of weekDays(monday)) {
    for (const p of draft.staff || []) {
      const c = M.getCell(draft, d, p.id);
      if (c && (c.a || []).includes('APS') && p.id !== staffId) M.setCell(draft, d, p.id, { a: c.a.filter(x => x !== 'APS'), auto: (c.auto || []).filter(x => x !== 'APS') });
    }
    if (staffId) {
      const c = M.getCell(draft, d, staffId);
      const a = (c && c.a) || [];
      if (!a.includes('APS')) M.setCell(draft, d, staffId, { a: [...a, 'APS'] });
    }
  }
}

// ---------- leave: other dates for a request that is not approved ----------

// Leave that is not approved (white) and clashes: more than `max` of the call pool on leave on one of its days.
// For each such block of days, up to 3 nearby windows of the same length with room. [{ staffId, from, to, days, clashes: [date], options: [{from,to,shift}] }]
export function leaveAlternatives(state, month, { max = 3 } = {}) {
  const dm = M.dutyMap(state);
  const pool = (state.staff || []).filter(p => p.active !== false && (p.tags || []).some(t => CALL_TAGS.includes(t)));
  const poolIds = new Set(pool.map(p => p.id));
  const onLeave = (d, id) => M.effectiveCodes(state, d, id).some(c => dm.get(c) && dm.get(c).kind === 'leave' && c !== 'x');
  const count = d => pool.reduce((n, p) => n + (onLeave(d, p.id) ? 1 : 0), 0);
  const days = M.monthDays(month);
  const out = [];
  for (const p of pool) {
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const block = run; run = [];
      const clashes = block.filter(d => count(d) > max);
      if (!clashes.length) return;
      const len = block.length;
      const others = d => count(d) - (onLeave(d, p.id) ? 1 : 0);
      const options = [];
      for (let shift = 1; shift <= 14 && options.length < 3; shift++) {
        for (const sgn of [1, -1]) {
          if (options.length >= 3) break;
          const start = M.addDays(block[0], sgn * shift);
          const win = Array.from({ length: len }, (_, i) => M.addDays(start, i));
          if (win.some(d => !M.staffActiveOn(p, d))) continue;
          // the same weekdays count (a block with a weekend stays a block with a weekend)
          const wk = d => (M.isWeekend(d) || M.isHoliday(state, d) ? 1 : 0);
          if (win.reduce((n, d) => n + wk(d), 0) !== block.reduce((n, d) => n + wk(d), 0)) continue;
          if (win.some(d => others(d) + 1 > max)) continue;
          if (win.some(d => M.effectiveCodes(state, d, p.id).some(c => c !== 'x' && dm.get(c) && dm.get(c).kind === 'shift'))) continue;
          options.push({ from: win[0], to: win[win.length - 1], shift: sgn * shift });
        }
      }
      out.push({ staffId: p.id, from: block[0], to: block[block.length - 1], days: len, clashes, options });
    };
    for (const d of days) {
      const c = M.getCell(state, d, p.id);
      const unapproved = c && (c.a || []).some(code => (dm.get(code) || {}).kind === 'leave' && ['AL', 'AAL'].includes(code)) && !c.ap;
      if (unapproved && poolIds.has(p.id)) run.push(d); else flush();
    }
    flush();
  }
  return out;
}

// ---------- old rosters: weeks done so far ----------

// From sheets read with io.parseDeptWorkbook (one result per file): the weeks each matched person had the pain service.
// Returns { base: { staffId: n }, last: { staffId: 'YYYY-MM' }, through: 'YYYY-MM', weeks: n }.
export function historyFromParsed(parsedList) {
  const mondays = new Map();   // staffId -> Set(monday)
  let through = '';
  for (const parsed of parsedList) {
    for (const m of parsed.months || []) if (m.month > through) through = m.month;
    const idOf = new Map((parsed.people || []).filter(p => p.matchId).map(p => [p.key, p.matchId]));
    for (const [date, row] of Object.entries(parsed.cells || {})) {
      for (const [key, pc] of Object.entries(row)) {
        if (!pc.own || !(pc.a || []).includes('APS') || !idOf.has(key)) continue;
        const id = idOf.get(key);
        if (!mondays.has(id)) mondays.set(id, new Set());
        mondays.get(id).add(mondayOf(date));
      }
    }
  }
  const base = {}, last = {};
  let weeks = 0;
  for (const [id, set] of mondays) {
    base[id] = set.size; weeks += set.size;
    last[id] = [...set].map(M.monthOf).sort().pop();
  }
  return { base, last, through, weeks };
}

// Move an unapproved leave block (AL / AAL on the days from..to) to a new window of the same length.
export function moveLeave(draft, staffId, from, to, newFrom) {
  const days = [];
  for (let d = from; d <= to; d = M.addDays(d, 1)) days.push(d);
  const moved = days.map(d => ({ d, codes: ((M.getCell(draft, d, staffId) || {}).a || []).filter(c => c === 'AL' || c === 'AAL') }));
  for (const { d, codes } of moved) {
    const c = M.getCell(draft, d, staffId);
    if (c) M.setCell(draft, d, staffId, { a: (c.a || []).filter(x => !codes.includes(x)) });
  }
  moved.forEach(({ codes }, i) => {
    const d = M.addDays(newFrom, i);
    const c = M.getCell(draft, d, staffId);
    M.setCell(draft, d, staffId, { a: [...new Set([...((c && c.a) || []), ...codes])] });
  });
}
