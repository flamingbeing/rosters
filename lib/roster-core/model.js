// Roster core: the model helpers the roster apps share (nuh-junior-monthly, ntf-roster). Dates (local, never UTC),
// lookups and the cell helpers; each app keeps its own data (duties, groups, default rules), its migrations and its
// month locks in its own js/model.js, which re-exports these. What differs between apps is an option of createCells,
// not a fork: `postings` (posting duties, '@posting', and PPC, the worked-out day off after a rest2 duty) and
// `requestMarks` (approved leave `ap` and request priority marks `rp` kept in a cell).

export function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

// ---------- dates (local, never UTC) ----------

const pad = n => String(n).padStart(2, '0');
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function iso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function parseISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDays(s, n) {
  const [y, m, d] = String(s).split('-').map(Number);
  return iso(new Date(y, m - 1, d + n));
}
export function monthDays(m) {
  const [y, mo] = String(m).split('-').map(Number);
  const last = new Date(y, mo, 0).getDate();
  const out = [];
  for (let d = 1; d <= last; d++) out.push(`${y}-${pad(mo)}-${pad(d)}`);
  return out;
}
export function monthOf(s) { return String(s).slice(0, 7); }
export function addMonths(m, n) {
  const [y, mo] = String(m).split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
// Weekdays are asked for thousands of times per screen (grid, checks, demo): remember them per date string.
const WEEKDAY = new Map();
export function weekday(s) {
  let w = WEEKDAY.get(s);
  if (w === undefined) {
    w = parseISO(s).getDay();
    if (WEEKDAY.size > 5000) WEEKDAY.clear();
    WEEKDAY.set(s, w);
  }
  return w;
}
export function isWeekend(s) { const w = weekday(s); return w === 0 || w === 6; }
export function isHoliday(state, s) { return !!(state && state.settings && state.settings.holidays && state.settings.holidays[s]); }
export function holidayName(state, s) { return (state && state.settings && state.settings.holidays && state.settings.holidays[s]) || ''; }
export function fmtDay(s) { const d = parseISO(s); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; }
export function fmtMonth(m) { const [y, mo] = String(m).split('-').map(Number); return `${MONTH[mo - 1]} ${y}`; }

// ---------- lookups ----------

export function dutyMap(state) { return new Map((state.duties || []).map(d => [d.code, d])); }
// The same map, built once per duties list (read-only use: effectiveCodes and matchesCodes run per cell). It is
// rebuilt when the list changes, even in place (a duty added, replaced or recoded inside a commit).
const DUTY_MAPS = new WeakMap();
export function dutyMapCached(state) {
  const list = state.duties;
  if (!Array.isArray(list)) return dutyMap(state);
  const hit = DUTY_MAPS.get(list);
  if (hit && hit.items.length === list.length && hit.items.every((d, k) => d === list[k] && hit.codes[k] === (d && d.code))) return hit.m;
  const m = dutyMap(state);
  DUTY_MAPS.set(list, { m, items: list.slice(), codes: list.map(d => d && d.code) });
  return m;
}
export function groupMap(state) { return new Map((state.groups || []).map(g => [g.id, g])); }
export function staffMap(state) { return new Map((state.staff || []).map(p => [p.id, p])); }

export function staffActiveOn(person, s) {
  return !!person && person.active !== false && (!person.start || s >= person.start) && (!person.end || s <= person.end);
}
// Everyone in post at some point in the month, in sheet order (group order, then the order in state.staff). Options:
// `absent` (a Set of ids left out that month) and `personIn(p)` (the person as they were that month).
export function staffInMonth(state, m, { absent = null, personIn = null } = {}) {
  const days = monthDays(m), first = days[0], last = days[days.length - 1];
  const order = new Map((state.groups || []).map((g, i) => [g.id, i]));
  return (state.staff || [])
    .map((p, i) => ({ p: personIn ? personIn(p) : p, i }))
    .filter(({ p }) => p.active !== false && !(absent && absent.has(p.id)) && (!p.start || p.start <= last) && (!p.end || p.end >= first))
    .sort((a, b) => ((order.get(a.p.group) ?? 999) - (order.get(b.p.group) ?? 999)) || a.i - b.i)
    .map(({ p }) => p);
}

// ---------- cells ----------

const EMPTY = Object.freeze([]);
const uniq = a => [...new Set((Array.isArray(a) ? a : []).filter(c => typeof c === 'string' && c))];

export function getCell(state, s, staffId) {
  const day = state.cells && state.cells[s];
  return (day && day[staffId]) || null;
}

// The cell helpers for one app's options (see the top of this file).
export function createCells({ postings = false, requestMarks = false } = {}) {
  // Merge a patch into a cell: dedupe codes, keep auto ⊆ a, delete the cell (and the day) when nothing is left.
  // Always writes a new cell object (never mutates the old one), so shallow copies of state stay safe.
  function setCell(draft, s, staffId, patch) {
    if (!draft.cells) draft.cells = {};
    const day = draft.cells[s] || (draft.cells[s] = {});
    const cur = day[staffId] || {};
    const next = { ...cur, ...patch };
    const a = uniq(next.a);
    const cell = { a, r: uniq(next.r), auto: uniq(next.auto).filter(c => a.includes(c)), note: String(next.note || ''), lock: !!next.lock };
    if (requestMarks) {
      if (next.ap) cell.ap = true;   // leave the department has approved (blue in the sheet); white leave is still a request
      // a request's priority mark ('!' must, '?' if possible), only for requests still in the cell
      if (next.rp && typeof next.rp === 'object') {
        const rp = {};
        for (const [c, v] of Object.entries(next.rp)) if (cell.r.includes(c) && (v === '!' || v === '?')) rp[c] = v;
        if (Object.keys(rp).length) cell.rp = rp;
      }
    }
    if (!cell.a.length && !cell.r.length && !cell.note && !cell.lock) delete day[staffId];
    else day[staffId] = cell;
    if (!Object.keys(day).length) delete draft.cells[s];
    return day[staffId] || null;
  }

  // PPC: the day off two days after a duty marked rest2 (the ICU call), when the person is still on the same posting
  // that day (on the last Saturday of a posting there is no day off). Worked out, never stored. Only with `postings`.
  function isPPC(state, s, staffId) {
    if (!postings) return false;
    const back = getCell(state, addDays(s, -2), staffId), cell = getCell(state, s, staffId);
    if (!back || !cell || !Array.isArray(back.a) || !Array.isArray(cell.a)) return false;
    const dm = dutyMapCached(state);
    if (!back.a.some(c => dm.get(c) && dm.get(c).rest2)) return false;
    return cell.a.some(c => dm.get(c) && dm.get(c).kind === 'posting' && back.a.includes(c));
  }
  function postingOf(state, cell) {
    if (!cell || !Array.isArray(cell.a)) return '';
    const dm = dutyMapCached(state);
    return cell.a.find(c => dm.get(c) && dm.get(c).kind === 'posting') || '';
  }

  // Assigned codes plus 'x' when the day before had an overnight shift (and 'PPC' on a PPC day).
  function effectiveCodes(state, s, staffId) {
    const cell = getCell(state, s, staffId);
    const out = cell && Array.isArray(cell.a) ? [...cell.a] : [];
    const prev = getCell(state, addDays(s, -1), staffId);
    if (prev && Array.isArray(prev.a) && prev.a.length) {
      const dm = dutyMapCached(state);
      if (prev.a.some(c => dm.get(c) && dm.get(c).overnight) && !out.includes('x')) out.push('x');
    }
    if (postings && isPPC(state, s, staffId) && !out.includes('PPC')) out.push('PPC');
    return out;
  }

  const TOKENS = postings ? ['@posting', '@shift', '@leave', '@other', '@request', '@away', '@present', '@any'] : ['@shift', '@leave', '@other', '@request', '@away', '@present', '@any'];

  // Tokens to concrete codes. '@present' is a property of the day, not a code: matchesCodes handles it.
  function expandTokens(state, codes) {
    const out = new Set();
    const all = state.duties || [];
    const ofKind = k => all.filter(d => d.kind === k).forEach(d => out.add(d.code));
    for (const c of codes || []) {
      if (c === '@shift') ofKind('shift');
      else if (c === '@leave') ofKind('leave');
      else if (postings && c === '@posting') ofKind('posting');
      else if (c === '@other') ofKind('other');
      else if (c === '@request') ofKind('request');
      else if (c === '@away') { ofKind('leave'); ofKind('other'); out.add('x'); if (postings) out.add('PPC'); }
      else if (c === '@any') { all.forEach(d => out.add(d.code)); out.add('x'); }
      else if (c !== '@present') out.add(c);
    }
    return out;
  }

  // Does this person's day match any of the codes (requests in r count too)? Handles every token.
  function matchesCodes(state, s, staffId, codes, eff) {
    codes = codes || EMPTY;
    const cell = getCell(state, s, staffId);
    const effc = eff || effectiveCodes(state, s, staffId);
    const all = cell && Array.isArray(cell.r) ? [...effc, ...cell.r] : [...effc];
    if (codes.includes('@any') && all.length) return true;
    const set = expandTokens(state, codes);
    if (all.some(c => set.has(c))) return true;
    if (codes.includes('@present')) {
      const dm = dutyMapCached(state);
      const derived = c => c === 'x' || (postings && c === 'PPC');
      const kindOf = c => (derived(c) ? 'derived' : (dm.get(c) && dm.get(c).kind));
      if (effc.some(c => kindOf(c) === 'shift')) return true;
      const person = (state.staff || []).find(p => p.id === staffId);
      if (person && !staffActiveOn(person, s)) return false;
      const away = effc.some(c => derived(c) || kindOf(c) === 'leave' || kindOf(c) === 'other');
      return !isWeekend(s) && !isHoliday(state, s) && !away;
    }
    return false;
  }

  return { TOKENS, setCell, effectiveCodes, isPPC, postingOf, expandTokens, matchesCodes };
}
