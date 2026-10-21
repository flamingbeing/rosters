// NUH Junior Monthly: the rule engine. Rules are plain data (SPEC.md "Rules"); this file knows how to describe, validate
// and check them, fast enough to re-check a whole month on every edit, and incrementally for the solver.
//
// ---------------------------------------------------------------------------------------------------------------
// HOW TO ADD A NEW RULE TYPE (the owner asks for a kind of rule none of the types below can express):
//
//   1. Add one entry to RULE_TYPES below. An entry is self-contained:
//        label, icon, help, example         words for the rule builder (ui-rules.js builds its form from `params`)
//        params: [ParamSpec]                { key, label, kind: 'codes'|'code'|'number'|'select'|'who'|'bool', ... }
//        defaults() -> params               a fresh params object
//        scope: 'day'|'person'|'global'     what one evaluation covers (the solver re-checks only what a change touches)
//        soft_only?: true                   always soft (penalty only)
//        describe(rule, T) -> string        short English; T has helpers: T.codes(list), T.who(who), T.when(when)...
//        validate?(rule, state) -> string[] extra problems beyond the generic param checks
//        compile(rule, X) -> evaluator      X is the compile kit (see compileRule): matchers, who/when filters, ctx.
//      The evaluator is an object with any of:
//        day(d, out)     -> penalty for day index d           (scope 'day')
//        person(p, out)  -> penalty for person index p         (scope 'person')
//        global(out)     -> penalty for everything             (scope 'global'; with touch(p) to refresh one person
//                           incrementally and init() to refresh everyone)
//      Each violation adds to the penalty (X.u per unit), bumps X.ctx.n2 (the violation count), and when `out` is an array pushes
//      X.V(pen, msg, { date, staffId, dates?, staffIds? }) (only build messages when out is given: it keeps the
//      solver fast).
//   2. Add positive and negative cases to test/rules.test.mjs, plus a describeRule check.
//   Nothing else changes: the checker, the rule builder and the solver all read RULE_TYPES.
// ---------------------------------------------------------------------------------------------------------------

import {
  DEFAULT_RULES, dutyMap, addDays, monthDays, monthOf, fmtDay, fmtMonth, uid, isHoliday, getCell, TOKENS, notInSheet, personIn, CALLS,
} from './model.js';

const NO_ABSENT = new Set();

export { DEFAULT_RULES };

// ---------- context: the grid of effective codes for a date range, built once per evaluate ----------

// Flags per person-day (bit mask), so token tests are one AND.
export const F = { SHIFT: 1, LEAVE: 2, OTHER: 4, REQ: 8, X: 16, ANY: 32, PRESENT: 64, POSTING: 128 };
const KIND_BIT = { shift: F.SHIFT, leave: F.LEAVE, other: F.OTHER, request: F.REQ, posting: F.POSTING };
const NONE = Object.freeze([]);

// How many days either side of the range the rules look at: at least 7, more for long rolling windows, far
// day-after offsets and long runs (so a rule never misses last month's cells it needs).
// What one call is worth in "share fairly" under the day-off scheme (the rosterer's points): 1, plus `ob` when the day is a day off
// (weekend or public holiday) and plus `eb` when the day after is one too: Friday 1.5, Saturday 2, Sunday 1.5, a public holiday
// 1.5, or 2 when the day after is also off.
export function dayOffWeight(isOff, nextOff, ob = 0.5, eb = 0.5) { return 1 + (isOff ? ob : 0) + (nextOff ? eb : 0); }
// What each person was over (+) or under (-) their fair share of a posting's calls in the months before `month`, in points:
// for each earlier month, their points minus their posting days times the pool's rate that month; the last month counts fully
// and each month before it a quarter less (carryMonths of them). A call day counts as a day on the posting. Past months only:
// next month is not rostered yet. Returns Map(person id -> points).
export function carryBalances(state, month, { codes, among, carryMonths = 4, scheme, offBonus, eveBonus, weekendWeight, holidayWeight }) {
  const out = new Map();
  const callSet = new Set(codes || []), postSet = new Set([...(among || []), ...(codes || [])]);
  if (!callSet.size || !(among || []).length) return out;
  const offdays = scheme !== 'fixed';
  const isOff = s => { const wd = new Date(s + 'T00:00:00').getDay(); return wd === 0 || wd === 6 || isHoliday(state, s); };
  const wOf = s => {
    if (offdays) return dayOffWeight(isOff(s), isOff(addDays(s, 1)), offBonus ?? 0.5, eveBonus ?? 0.5);
    const wd = new Date(s + 'T00:00:00').getDay(), wk = wd === 0 || wd === 6;
    return isHoliday(state, s) ? (wk ? Math.max(holidayWeight ?? 2, weekendWeight ?? 2) : (holidayWeight ?? 2)) : wk ? (weekendWeight ?? 2) : 1;
  };
  const staff = (state.staff || []).filter(p => p && p.active !== false);
  let m = month;
  for (let j = 0; j < Math.max(0, Math.min(12, carryMonths | 0)); j++) {
    m = monthOf(addDays(m + '-01', -1));
    const w = Math.max(0.25, 1 - 0.25 * j), per = new Map();
    let sumP = 0, sumD = 0;
    for (const d of monthDays(m)) {
      const day = state.cells && state.cells[d];
      if (!day) continue;
      for (const p of staff) {
        const c = day[p.id];
        if (!c || !Array.isArray(c.a)) continue;
        const isCall = c.a.some(x => callSet.has(x));
        if (!isCall && !c.a.some(x => postSet.has(x))) continue;
        const t = per.get(p.id) || { P: 0, D: 0 };
        t.D++; sumD++;
        if (isCall) { const pts = wOf(d); t.P += pts; sumP += pts; }
        per.set(p.id, t);
      }
    }
    if (!sumD) continue;
    const rate = sumP / sumD;
    for (const [id, t] of per) out.set(id, (out.get(id) || 0) + w * (t.P - t.D * rate));
  }
  return out;
}


export function ruleReach(rules) {
  let reach = 7;
  for (const r of rules || []) {
    if (!r || r.enabled === false || !r.params) continue;
    const p = r.params;
    if (r.type === 'sequence') reach = Math.max(reach, Math.abs(num(p.from, 1)), Math.abs(num(p.to, 1)));
    else if (r.type === 'limit' && p.period === 'rolling') reach = Math.max(reach, num(p.window, 7) - 1);
    else if (r.type === 'maxRun') reach = Math.max(reach, num(p.max, 5) + 1);
    else if (r.type === 'postingStart') reach = Math.max(reach, num(p.days, 1) + 1);
  }
  return Math.min(400, Math.max(7, Math.ceil(reach) || 7));
}

// Days from..to plus at least 7 days either side (more when a rule reaches further: ruleReach), widened to whole
// months (so month limits count every day). `rules` defaults to the state's rules.
export function buildContext(state, { from, to, rules }) {
  const dm = dutyMap(state);
  const reach = ruleReach(rules || state.rules);
  const start = minS(addDays(from, -reach), monthOf(from) + '-01');
  const endM = monthDays(monthOf(to));
  const end = maxS(addDays(to, reach), endM[endM.length - 1]);
  const days = [];
  for (let s = start; s <= end; s = addDays(s, 1)) days.push(s);
  const n = days.length;
  // each person with the grade the month's imported sheet showed (model.js gradeIn): rules about groups follow it
  const people = (state.staff || []).filter(p => p && p.active !== false).map(p => personIn(state, monthOf(from), p));
  const P = people.length;
  const ctx = {
    state, dm, days, n, people, P, from, to,
    lo: days.indexOf(from), hi: days.indexOf(to),
    index: new Map(people.map((p, i) => [p.id, i])),
    wd: new Int8Array(n), hol: new Uint8Array(n),
    act: new Uint8Array(P * n), codes: new Array(P * n), req: new Array(P * n),
    post: new Uint8Array(P * n), post2: new Uint8Array(P * n), flags: new Uint8Array(P * n), prePost: new Uint8Array(P),
    pre: new Array(P), kindBit: new Map(), overnight: new Set(), rest2: new Set(), posting: new Set(), n2: 0,
    month: [], weekStart: new Int32Array(n),
  };
  for (const d of dm.values()) {
    if (KIND_BIT[d.kind]) ctx.kindBit.set(d.code, KIND_BIT[d.kind]);
    if (d.overnight) ctx.overnight.add(d.code);
    if (d.rest2) ctx.rest2.add(d.code);
    if (d.kind === 'posting') ctx.posting.add(d.code);
  }
  ctx.kindBit.set('x', F.X);
  for (let d = 0; d < n; d++) {
    const [y, m, dd] = days[d].split('-').map(Number);
    ctx.wd[d] = new Date(y, m - 1, dd).getDay();
    ctx.hol[d] = isHoliday(state, days[d]) ? 1 : 0;
    ctx.month[d] = days[d].slice(0, 7);
    ctx.weekStart[d] = d - ((ctx.wd[d] + 6) % 7);   // index of that week's Monday (may be < 0)
  }
  const before = addDays(start, -1);
  // which posting a call belongs to (C3 is cardiac C, R1B is ICU; the fair-share rules can name others)
  const callPost = { C3: 'C', R1B: 'ICU' };
  for (const r of (rules || state.rules || [])) if (r && r.type === 'spread' && r.params && (r.params.among || []).length) for (const c of r.params.codes || []) callPost[c] = r.params.among[0];
  // people the month's imported sheet left out are not in post that month (model.js notInSheet)
  const absentIn = {};
  for (const mk of new Set(ctx.month)) absentIn[mk] = notInSheet(state, mk);
  for (let p = 0; p < P; p++) {
    const per = people[p];
    const prev = getCell(state, before, per.id);
    ctx.prePost[p] = prev && Array.isArray(prev.a) && prev.a.some(c => ctx.overnight.has(c)) ? 1 : 0;
    const prev2 = getCell(state, addDays(start, -2), per.id);
    ctx.pre[p] = [prev2 && Array.isArray(prev2.a) ? prev2.a : NONE, prev && Array.isArray(prev.a) ? prev.a : NONE];
    for (let d = 0; d < n; d++) {
      const i = p * n + d, s = days[d];
      ctx.act[i] = (!per.start || s >= per.start) && (!per.end || s <= per.end) && !(absentIn[ctx.month[d]] || NO_ABSENT).has(per.id) ? 1 : 0;
      const cell = state.cells && state.cells[s] && state.cells[s][per.id];
      ctx.codes[i] = cell && Array.isArray(cell.a) ? cell.a : NONE;
      ctx.req[i] = cell && Array.isArray(cell.r) ? cell.r : NONE;
    }
    // On the sheet a call replaces the posting code that day (C3 on a cardiac week): a call day with no posting of its own on a
    // person who has the call's posting within three days either side is read as on that posting, so the rules about being
    // on cardiac / ICU are not tripped by the call itself. Only the rules see it; nothing is written to the roster.
    for (let d = 0; d < n; d++) {
      const i = p * n + d, cs = ctx.codes[i];
      if (cs === NONE || !cs.length) continue;
      const code = cs.find(c => callPost[c]);
      if (!code) continue;
      const post = callPost[code];
      if (cs.some(c => ctx.posting.has(c))) continue;
      let near = false;
      for (let k = 1; k <= 3 && !near; k++) {
        near = [d - k, d + k].some(e => {
          if (e >= 0 && e < n) return ctx.codes[p * n + e].includes(post);
          const c = getCell(state, addDays(days[d], e - d), per.id);   // past the edge of the window: the saved day
          return !!c && Array.isArray(c.a) && c.a.includes(post);
        });
      }
      if (near) ctx.codes[i] = cs.concat(post);
    }
    for (let d = 0; d < n; d++) refresh(ctx, p * n + d);
  }
  ctx.periods = { month: monthPeriods(ctx), week: weekPeriods(ctx), range: [{ key: 'range', a: ctx.lo, b: ctx.hi }] };
  return ctx;
}

const minS = (a, b) => (a < b ? a : b);
const maxS = (a, b) => (a > b ? a : b);

// Recompute post call and flags for one person-day (the solver calls this for i and i+1 after a change).
export function refresh(ctx, i) {
  const d = i % ctx.n;
  const prevCodes = d > 0 ? ctx.codes[i - 1] : null;
  let post = d > 0 ? 0 : ctx.prePost[(i / ctx.n) | 0];
  if (prevCodes) for (let k = 0; k < prevCodes.length; k++) if (ctx.overnight.has(prevCodes[k])) { post = 1; break; }
  ctx.post[i] = post;
  const a = ctx.codes[i], r = ctx.req[i];
  // PPC: a rest2 duty (ICU call) two days back, and still on that duty's posting today
  let post2 = 0;
  if (ctx.rest2.size && a.length) {
    const back = d >= 2 ? ctx.codes[i - 2] : ctx.pre[(i / ctx.n) | 0][d];
    if (back && back.some(c => ctx.rest2.has(c))) for (let k = 0; k < a.length; k++) if (ctx.posting.has(a[k]) && back.includes(a[k])) { post2 = 1; break; }
  }
  ctx.post2[i] = post2;
  let f = 0;
  for (let k = 0; k < a.length; k++) f |= ctx.kindBit.get(a[k]) || 0;
  for (let k = 0; k < r.length; k++) f |= ctx.kindBit.get(r[k]) || 0;
  if (post || post2) f |= F.X;
  if (a.length || r.length || post) f |= F.ANY;
  if (ctx.act[i]) {
    const wd = ctx.wd[d];
    if ((f & F.SHIFT) || (wd !== 0 && wd !== 6 && !ctx.hol[d] && !(f & (F.LEAVE | F.OTHER | F.X)))) f |= F.PRESENT;
  }
  ctx.flags[i] = f;
}

function monthPeriods(ctx) {
  const out = [];
  const seen = new Set();
  for (let d = ctx.lo; d <= ctx.hi; d++) {
    const m = ctx.month[d];
    if (seen.has(m)) continue;
    seen.add(m);
    let a = d, b = d;
    while (a > 0 && ctx.month[a - 1] === m) a--;
    while (b < ctx.n - 1 && ctx.month[b + 1] === m) b++;
    out.push({ key: m, a, b });
  }
  return out;
}
function weekPeriods(ctx) {
  const out = [];
  for (let ws = ctx.weekStart[ctx.lo]; ws <= ctx.hi; ws += 7) {
    out.push({ key: ws, a: Math.max(0, ws), b: Math.min(ctx.n - 1, ws + 6) });
  }
  return out;
}

// ---------- compile kit: matchers and filters ----------

// A code list (codes and tokens) -> matcher(i) for a person-day, plus elem(code) for one code.
export function compileCodes(ctx, codes) {
  let mask = 0, wantPPC = false;
  const set = new Set();
  for (const c of codes || []) {
    if (c === '@shift') mask |= F.SHIFT;
    else if (c === '@leave') mask |= F.LEAVE;
    else if (c === '@posting') mask |= F.POSTING;
    else if (c === '@other') mask |= F.OTHER;
    else if (c === '@request') mask |= F.REQ;
    else if (c === '@away') mask |= F.LEAVE | F.OTHER | F.X;
    else if (c === '@any') mask |= F.ANY;
    else if (c === '@present') mask |= F.PRESENT;
    else if (c === 'x') mask |= F.X;
    else if (c === 'PPC') { wantPPC = true; set.add(c); }
    else if (c) set.add(c);
  }
  const has = set.size > 0;
  const flags = ctx.flags, cs = ctx.codes, rs = ctx.req;
  // The kinds of the listed codes (an unknown code counts as "any code"): a person-day whose flags have none of
  // them can't hold one, so most days are ruled out with one AND instead of scanning the cell (speed).
  let need = 0;
  for (const c of set) need |= ctx.kindBit.get(c) || F.ANY;
  const post2 = ctx.post2;
  const m0 = has
    ? i => {
      const f = flags[i];
      if (f & mask) return true;
      if (!(f & need)) return false;
      const a = cs[i];
      for (let k = 0; k < a.length; k++) if (set.has(a[k])) return true;
      const r = rs[i];
      for (let k = 0; k < r.length; k++) if (set.has(r[k])) return true;
      return false;
    }
    : i => (flags[i] & mask) !== 0;
  const m = wantPPC ? i => post2[i] === 1 || m0(i) : m0;
  const elemMask = mask & ~F.PRESENT;
  // one code (not a day): does it match? (x, kinds, @any)
  m.elem = code => set.has(code) || (wantPPC && code === 'PPC') || (elemMask & F.ANY) !== 0 || (elemMask & (ctx.kindBit.get(code) || 0)) !== 0;
  m.present = (mask & F.PRESENT) !== 0;
  m.empty = !mask && !has && !wantPPC;
  m.set = set;
  return m;
}

const blankWho = () => ({ groups: [], tags: [], staff: [], exclude: [] });
export function compileWho(ctx, who) {
  who = { ...blankWho(), ...(who || {}) };
  const everyone = !who.groups.length && !who.tags.length && !who.staff.length;
  const inWho = new Uint8Array(ctx.P);
  const list = [];
  ctx.people.forEach((p, i) => {
    let ok = everyone || who.groups.includes(p.group) || who.staff.includes(p.id) || (p.tags || []).some(t => who.tags.includes(t));
    if (who.exclude.includes(p.id)) ok = false;
    if (Array.isArray(who.onlyGroups) && who.onlyGroups.length && !who.onlyGroups.includes(p.group)) ok = false;   // and in one of these groups
    if (ok) { inWho[i] = 1; list.push(i); }
  });
  return { inWho, list };
}

export function compileWhen(ctx, when) {
  when = { from: '', to: '', days: [], holidays: 'any', ...(when || {}) };
  const ok = new Uint8Array(ctx.n);
  const days = (when.days || []).map(Number);
  for (let d = 0; d < ctx.n; d++) {
    const s = ctx.days[d];
    if (when.from && s < when.from) continue;
    if (when.to && s > when.to) continue;
    if (days.length && !days.includes(ctx.wd[d])) continue;
    if (when.holidays === 'only' && !ctx.hol[d]) continue;
    if (when.holidays === 'exclude' && ctx.hol[d]) continue;
    ok[d] = 1;
  }
  return ok;
}

const unset = v => v === '' || v == null || Number.isNaN(Number(v));
const num = (v, dflt = null) => (unset(v) ? dflt : Number(v));

// A list from anything an imported file might hold: arrays stay, "0,6" splits, anything else is empty.
const asList = v => (Array.isArray(v) ? v.filter(x => x != null && x !== '') : typeof v === 'string' && v ? v.split(',').map(x => x.trim()).filter(Boolean) : []);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
export function normalizeWho(who) {
  const w = obj(who);
  return { ...w, groups: asList(w.groups).map(String), tags: asList(w.tags).map(String), staff: asList(w.staff).map(String), exclude: asList(w.exclude).map(String) };
}
export function normalizeWhen(when) {
  const w = { from: '', to: '', days: [], holidays: 'any', ...obj(when) };
  w.days = asList(w.days).map(Number).filter(x => Number.isInteger(x) && x >= 0 && x <= 6);
  if (typeof w.from !== 'string') w.from = '';
  if (typeof w.to !== 'string') w.to = '';
  if (!['any', 'only', 'exclude'].includes(w.holidays)) w.holidays = 'any';
  return w;
}

// Rule with every field present (params merged over the type's defaults), and lists that are really lists (an
// imported or hand-edited rule with `groups: null` or `days: "0,6"` must not break every check).
export function normalizeRule(rule) {
  const t = RULE_TYPES[rule && rule.type];
  const params = { ...(t ? t.defaults() : {}), ...obj(rule && rule.params) };
  if (t) for (const spec of t.params) {
    if (spec.kind === 'codes') params[spec.key] = asList(params[spec.key]).map(String);
    else if (spec.kind === 'who') params[spec.key] = normalizeWho(params[spec.key]);
    else if (spec.kind === 'code' && params[spec.key] != null && typeof params[spec.key] !== 'string') params[spec.key] = String(params[spec.key]);
  }
  return {
    id: '', name: '', enabled: true, hard: true, weight: 10, note: '', ...obj(rule),
    who: normalizeWho(rule && rule.who),
    when: normalizeWhen(rule && rule.when),
    params,
  };
}

// Compile one rule into an evaluator for this context (null if the rule can't be checked).
export function compileRule(ctx, raw) {
  const t = RULE_TYPES[raw && raw.type];
  if (!t) return null;
  const rule = normalizeRule(raw);
  const hard = !!rule.hard && !t.soft_only;
  const u = hard ? 1000 : Math.min(100, Math.max(1, num(rule.weight, 10)));
  let ev = null;
  try {
    const T = ctx.T || (ctx.T = textKit(ctx.state));   // one word kit per check, shared by all its rules (speed)
    const X = {
      ctx, rule, hard, u, T,
      codes: list => compileCodes(ctx, list),
      who: w => compileWho(ctx, normalizeWho(w)),
      when: compileWhen(ctx, rule.when),
      name: p => { const per = ctx.people[p]; return (per && (per.short || per.name)) || '?'; },
      day: d => fmtDay(ctx.days[d]),
      inRange: d => d >= ctx.lo && d <= ctx.hi,
      V: (penalty, msg, o = {}) => ({ ruleId: rule.id, type: rule.type, hard, penalty, msg, ...o }),
      iso: d => ctx.days[d],
      num,
    };
    X.W = X.who(rule.who);
    ev = t.compile(rule, X);
  } catch (e) { ev = null; }
  if (!ev) return null;
  return { rule, type: t, hard, u, ...ev };
}

export function compileRules(ctx, rules) {
  return (rules || []).map(r => compileRule(ctx, r)).filter(Boolean);
}

// ---------- words ----------

const TOKEN_WORDS = { '@posting': 'any posting', PPC: 'the day off after an ICU post call (PPC)', '@shift': 'any call or shift', '@leave': 'leave', '@other': 'other duty', '@request': 'a request', '@away': 'away', '@present': 'at work', '@any': 'anything', x: 'post call (PC)' };
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const listOr = (a, word = 'or') => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} ${word} ${a[a.length - 1]}`);
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

function textKit(state) {
  const dm = dutyMap(state);
  const groups = state.groups || [], tags = state.tags || [], staff = state.staff || [];
  const kindIds = k => groups.filter(g => g.kind === k).map(g => g.id);
  const codeName = c => TOKEN_WORDS[c] || (dm.get(c) && dm.get(c).name) || c;
  const T = {
    code: codeName,
    // '…' until codes are chosen ("Never … and … on the same day"); every call together is just "any call", and a long list is cut
    codes: list => {
      const l = list || [];
      if (!l.length) return '…';
      if (l.length === CALLS.length && CALLS.every(c => l.includes(c))) return 'any call';
      if (l.length > 4) return `${l.slice(0, 3).map(codeName).join(', ')} or ${l.length - 3} more`;
      return listOr(l.map(codeName));
    },
    // for a count in front ('at most 2 calls a month'): every call together is just "calls"
    codesN: list => { const t = T.codes(list); return t === 'any call' ? 'calls' : t; },
    // "on Call", but "at work", "away", "on leave" for tokens that read better without "on"
    on: list => (list && list.length === 1 && ['@present', '@away', '@any'].includes(list[0]) ? codeName(list[0]) : `on ${T.codes(list)}`),
    // "juniors", "seniors", "everyone", or names
    who(who) {
      who = { ...blankWho(), ...(who || {}) };
      const parts = [];
      if (who.groups.length) {
        if (sameSet(who.groups, kindIds('junior'))) parts.push('juniors');
        else if (sameSet(who.groups, kindIds('senior'))) parts.push('seniors');
        else parts.push(...who.groups.map(id => (groups.find(g => g.id === id) || { name: id }).name));
      }
      parts.push(...who.tags.map(id => (tags.find(g => g.id === id) || { name: id }).name));
      parts.push(...who.staff.map(id => { const p = staff.find(x => x.id === id); return p ? (p.short || p.name) : id; }));
      let text = parts.length ? listOr(parts.length > 4 ? [...parts.slice(0, 3), `${parts.length - 3} more`] : parts) : 'everyone';
      if (Array.isArray(who.onlyGroups) && who.onlyGroups.length) text += ` (only ${listOr(who.onlyGroups.map(id => (groups.find(g => g.id === id) || { name: id }).name), 'or')})`;
      if (who.exclude.length) text += ` except ${listOr(who.exclude.map(id => { const p = staff.find(x => x.id === id); return p ? (p.short || p.name) : id; }), 'and')}`;
      return text;
    },
    // a noun for counts: junior(s), senior(s), Baby MO(s), person/people
    noun(who, count) {
      who = { ...blankWho(), ...(who || {}) };
      const one = count === 1;
      const g = who.groups;
      if (g.length > 1 && !who.tags.length && !who.staff.length) {
        const kinds = new Set(g.map(id => (groups.find(x => x.id === id) || {}).kind));
        if (kinds.size === 1 && kinds.has('junior')) return one ? 'junior' : 'juniors';
        if (kinds.size === 1 && kinds.has('senior')) return one ? 'senior' : 'seniors';
      }
      if (!g.length && who.tags.length === 1 && !who.staff.length) {
        const name = (tags.find(x => x.id === who.tags[0]) || { name: who.tags[0] }).name;
        return one ? name : name + 's';
      }
      return one ? 'person' : 'people';
    },
    // "weekends", "weekdays except public holidays", "public holidays", "Mon, Wed, from 3 Nov"
    when(when) {
      when = { from: '', to: '', days: [], holidays: 'any', ...(when || {}) };
      const days = [...(when.days || [])].map(Number).sort();
      const parts = [];
      if (days.length && days.length < 7) {
        if (sameSet(days, [0, 6])) parts.push('weekends');
        else if (sameSet(days, [1, 2, 3, 4, 5])) parts.push('weekdays');
        else parts.push(days.map(d => DAY_NAMES[d]).join(', '));
      }
      if (when.holidays === 'only') parts.push(parts.length ? 'on public holidays' : 'public holidays');
      if (when.holidays === 'exclude') parts.push('except public holidays');
      const short = s => fmtDay(s).replace(/^\w+ /, '');
      if (when.from && when.to) parts.push(`${short(when.from)} to ${short(when.to)}`);
      else if (when.from) parts.push(`from ${short(when.from)}`);
      else if (when.to) parts.push(`until ${short(when.to)}`);
      return parts.join(' ');
    },
    amount(min, max) {
      min = num(min); max = num(max);
      if (min != null && max != null) return min === max ? `exactly ${min}` : `${min} to ${max}`;
      if (min != null) return `at least ${min}`;
      if (max != null) return `at most ${max}`;
      return 'any number of';
    },
  };
  return T;
}

const isEveryone = who => !who || (!(who.groups || []).length && !(who.tags || []).length && !(who.staff || []).length && !(who.exclude || []).length);
const withWhen = (text, rule, T) => { const w = T.when(rule.when); return w ? `${text} (${w})` : text; };
const whoPrefix = (rule, T) => (isEveryone(rule.who) ? '' : `${cap(T.who(rule.who))}: `);

// ---------- the rule types ----------

const P = {
  codes: (key = 'codes', label = 'Codes', help) => ({ key, label, kind: 'codes', help }),
  num: (key, label, o = {}) => ({ key, label, kind: 'number', ...o }),
  sel: (key, label, options, help) => ({ key, label, kind: 'select', options, help }),
};

export const RULE_TYPES = {
  // Each day, how many people (in who) have the codes.
  cover: {
    label: 'Cover each day', icon: '👥', scope: 'day',
    help: 'How many people must (or may) be on a duty each day.',
    example: 'Each day: exactly 2 juniors on Call',
    params: [P.codes('codes', 'Duty'), P.num('min', 'At least', { min: 0, optional: true }), P.num('max', 'At most', { min: 0, optional: true })],
    defaults: () => ({ codes: [], min: 1, max: null }),
    describe(r, T) {
      const p = r.params, w = T.when(r.when);
      const amt = T.amount(p.min, p.max);
      const n = num(p.max, num(p.min, 2));
      let noun = T.noun(r.who, n);
      if (!isEveryone(r.who) && (noun === 'person' || noun === 'people')) noun += ` from ${T.who(r.who)}`;
      return `${w ? cap(w) : 'Each day'}: ${amt} ${noun} ${T.on(p.codes)}`;
    },
    validate(r) { return unset(r.params.min) && unset(r.params.max) ? ['Set at least or at most'] : []; },
    compile(r, X) {
      const m = X.codes(r.params.codes);
      if (m.empty) return null;
      const min = num(r.params.min), max = num(r.params.max);
      const { list } = X.W, ok = X.when, { ctx, u } = X, n = ctx.n, act = ctx.act;
      return {
        info: { m, list, ok, min, max },
        day(d, out) {
          if (!ok[d]) return 0;
          let cnt = 0;
          for (let k = 0; k < list.length; k++) { const i = list[k] * n + d; if (act[i] && m(i)) cnt++; }
          let pen = 0;
          if (min != null && cnt < min) {
            pen += u * (min - cnt); ctx.n2++;
            if (out) out.push(X.V(u * (min - cnt), `${X.day(d)}: ${cnt} ${X.T.noun(r.who, cnt)} ${X.T.on(r.params.codes)}, needs ${min}`, { date: X.iso(d) }));
          }
          if (max != null && cnt > max) {
            pen += u * (cnt - max); ctx.n2++;
            if (out) {
              const ids = list.filter(p => act[p * n + d] && m(p * n + d)).map(p => ctx.people[p].id);
              out.push(X.V(u * (cnt - max), `${X.day(d)}: ${cnt} ${X.T.noun(r.who, cnt)} ${X.T.on(r.params.codes)}, at most ${max}`, { date: X.iso(d), staffIds: ids }));
            }
          }
          return pen;
        },
      };
    },
  },

  // Each person's count per week / month / rolling window.
  limit: {
    label: 'Limit per person', icon: '🔢', scope: 'person',
    help: 'How many times each person may (or must) do a duty per week, month or any run of days.',
    example: 'Juniors: at most 7 Call a month (scaled by FTE)',
    params: [
      P.codes('codes', 'Duty'),
      P.sel('period', 'Per', [['week', 'Week (Mon to Sun)'], ['month', 'Month'], ['rolling', 'Any run of days']]),
      P.num('window', 'Days in the run', { min: 1, max: 62, optional: true, help: 'Only for "any run of days"' }),
      P.num('min', 'At least', { min: 0, optional: true }),
      P.num('max', 'At most', { min: 0, optional: true }),
      { key: 'fte', label: 'Scale by FTE', kind: 'bool', help: 'Part-timers get a smaller share' },
      { key: 'prorate', label: 'Scale by days in post', kind: 'bool', help: 'People joining or leaving mid-period get a smaller share' },
    ],
    defaults: () => ({ codes: [], period: 'month', window: 7, min: null, max: 4, fte: false, prorate: false }),
    describe(r, T) {
      const p = r.params;
      const per = p.period === 'week' ? 'a week' : p.period === 'rolling' ? `in any ${num(p.window, 7)} days` : 'a month';
      const w = T.when(r.when);
      let s = `${cap(T.who(r.who))}: ${T.amount(p.min, p.max)} ${T.codesN(p.codes)} ${per}${w ? ` on ${w}` : ''}`;
      const sc = [p.fte && 'scaled by FTE', p.prorate && 'pro rata'].filter(Boolean);
      if (sc.length) s += ` (${sc.join(', ')})`;
      return s;
    },
    validate(r) {
      const out = [];
      if (unset(r.params.min) && unset(r.params.max)) out.push('Set at least or at most');
      if (r.params.period === 'rolling' && !(num(r.params.window, 0) >= 1)) out.push('Set how many days in the run');
      return out;
    },
    compile(r, X) {
      const p = r.params, m = X.codes(p.codes);
      if (m.empty) return null;
      const min = num(p.min), max = num(p.max);
      const { ctx, u } = X, n = ctx.n, ok = X.when, act = ctx.act, inWho = X.W.inWho;
      const codesTxt = X.T.codes(p.codes);
      const factorOf = (pi, act_, tot) => (p.fte ? (Number(ctx.people[pi].fte) > 0 ? Number(ctx.people[pi].fte) : 1) : 1) * (p.prorate ? (tot ? act_ / tot : 0) : 1);
      const capOf = f => Math.floor(max * f + 1e-9);
      // the minimum for a period: scaled down (and rounded down) when the period runs past the last day checked,
      // because those days aren't planned yet (an empty next month must not force a duty onto the 30th)
      const needOf = (f, planned, tot) => (planned >= tot ? Math.ceil(min * f - 1e-9) : Math.floor(min * f * (tot ? planned / tot : 0) + 1e-9));
      if (p.period === 'rolling') {
        const W = Math.min(ctx.n, Math.max(1, Math.round(num(p.window, 7))));
        const kept = new Uint8Array(n);
        return {
          person(pi, out) {
            if (!inWho[pi]) return 0;
            const base = pi * n, lo = ctx.lo, hi = ctx.hi;
            const s0 = Math.max(0, lo - W + 1), s1 = Math.min(hi, n - W);
            if (s1 < s0) return 0;
            const e1 = s1 + W - 1;
            let pen = 0;
            // the days of one window (only built for messages)
            const hitsIn = s => { const h = []; for (let d = s; d < s + W; d++) if (ok[d] && act[base + d] && m(base + d)) h.push(d); return h; };
            // sliding counts over the window [s, s+W): ok days, ok days in post, ok days up to hi, hits
            let tot = 0, a_ = 0, planned = 0, cnt = 0;
            for (let d = s0; d <= e1; d++) {
              const hit = ok[d] && act[base + d] && m(base + d) ? 1 : 0;
              kept[d] = hit;
              if (d < s0 + W) { if (ok[d]) { tot++; if (d <= hi) planned++; if (act[base + d]) { a_++; cnt += hit; } } }
            }
            // At most: the fewest duties that must go so no window is over (drop the latest duty of an over-full
            // window first), counting only duties inside the dates checked. One extra duty costs one unit however
            // many windows it sits in; one message per run of over-full windows.
            let kc = cnt, vMax = null, vMin = null;
            for (let s = s0; s <= s1; s++) {
              if (s > s0) {
                const dOut = s - 1, dIn = s + W - 1;
                if (ok[dOut]) { tot--; if (dOut <= hi) planned--; if (act[base + dOut]) { a_--; cnt -= (ok[dOut] && m(base + dOut)) ? 1 : 0; kc -= kept[dOut]; } }
                if (ok[dIn]) { tot++; if (dIn <= hi) planned++; if (act[base + dIn]) { a_++; const h = m(base + dIn) ? 1 : 0; cnt += h; kc += kept[dIn]; } }
              }
              const f = factorOf(pi, a_, tot);
              if (max != null) {
                const capN = capOf(f);
                let removed = 0;
                for (let d = s + W - 1; kc > capN && d >= s; d--) {
                  if (!kept[d]) continue;
                  kept[d] = 0; kc--;
                  if (d >= lo && d <= hi) removed++;
                }
                if (removed) {
                  pen += u * removed;
                  if (vMax) vMax.penalty += u * removed;
                  else {
                    ctx.n2++;
                    if (out) {
                      const hits = hitsIn(s), dates = hits.filter(X.inRange).map(X.iso);
                      vMax = X.V(u * removed, `${X.name(pi)}: ${hits.length} ${codesTxt} in ${W} days from ${X.day(s)}, at most ${capN}`, { staffId: ctx.people[pi].id, date: dates[0] || X.iso(Math.max(s, lo)), dates });
                      out.push(vMax);
                    } else vMax = { penalty: 0 };
                  }
                } else vMax = null;
              }
              if (min != null) {
                const need = needOf(f, planned, tot);
                if (cnt < need) {
                  // at least: each short window counts (a long empty stretch is worse than a short one)
                  pen += u * (need - cnt);
                  if (vMin) vMin.penalty += u * (need - cnt);
                  else {
                    ctx.n2++;
                    if (out) {
                      vMin = X.V(u * (need - cnt), `${X.name(pi)}: ${cnt} ${codesTxt} in ${W} days from ${X.day(s)}, needs ${need}`, { staffId: ctx.people[pi].id, date: X.iso(Math.min(Math.max(s, lo), hi)) });
                      out.push(vMin);
                    } else vMin = { penalty: 0 };
                  }
                } else vMin = null;
              }
            }
            return pen;
          },
        };
      }
      const periods = ctx.periods[p.period === 'week' ? 'week' : 'month'];
      return {
        person(pi, out) {
          if (!inWho[pi]) return 0;
          const base = pi * n, lo = ctx.lo, hi = ctx.hi;
          let pen = 0;
          for (const per of periods) {
            let cnt = 0, inCnt = 0, a_ = 0, tot = 0, planned = 0;
            for (let d = per.a; d <= per.b; d++) {
              if (!ok[d]) continue; tot++;
              if (d <= hi) planned++;
              if (!act[base + d]) continue; a_++;
              if (m(base + d)) { cnt++; if (d >= lo && d <= hi) inCnt++; }
            }
            if (!a_) continue;
            const f = factorOf(pi, a_, tot);
            const label = () => (p.period === 'week' ? `in the week of ${fmtDay(addDays(ctx.days[0], per.key))}` : `in ${fmtMonth(per.key)}`);
            if (max != null) {
              // only the duties inside the dates checked can be taken away (last month's excess is last month's problem)
              const capN = capOf(f), over = Math.min(cnt - capN, inCnt);
              if (over > 0) {
                pen += u * over; ctx.n2++;
                if (out) {
                  const dates = []; for (let d = Math.max(per.a, lo); d <= Math.min(per.b, hi); d++) if (ok[d] && act[base + d] && m(base + d)) dates.push(X.iso(d));
                  out.push(X.V(u * over, `${X.name(pi)}: ${cnt} ${codesTxt} ${label()}, at most ${capN}`, { staffId: ctx.people[pi].id, date: dates[0], dates }));
                }
              }
            }
            if (min != null) {
              const need = needOf(f, planned, tot);
              if (cnt < need) {
                pen += u * (need - cnt); ctx.n2++;
                // a month's minimum is about the whole month (no date); a week's is pinned to the week
                if (out) out.push(X.V(u * (need - cnt), `${X.name(pi)}: ${cnt} ${codesTxt} ${label()}, needs ${need}`, p.period === 'week' ? { staffId: ctx.people[pi].id, date: X.iso(Math.min(Math.max(per.a, lo), hi)) } : { staffId: ctx.people[pi].id, month: per.key }));
              }
            }
          }
          return pen;
        },
      };
    },
  },

  // If a person has A on day d, then on d+from..d+to they must not / must have B.
  sequence: {
    label: 'Day-after rules', icon: '⏭️', scope: 'person',
    help: 'What may or must follow (or come before) a duty: gaps between calls, no call before leave.',
    example: 'After Call: no Call for the next 2 days',
    params: [
      P.codes('ifCodes', 'If someone has'),
      P.sel('mode', 'Then they', [['forbid', 'must not have'], ['require', 'must have']]),
      P.codes('thenCodes', 'Codes'),
      P.num('from', 'From day', { min: -14, max: 14, help: '1 = the next day, -1 = the day before' }),
      P.num('to', 'To day', { min: -14, max: 14 }),
      P.sel('thenDay', 'Only when that day is', [['', 'any day'], ['0', 'a Sunday'], ['1', 'a Monday'], ['2', 'a Tuesday'], ['3', 'a Wednesday'], ['4', 'a Thursday'], ['5', 'a Friday'], ['6', 'a Saturday']], 'Leave on "any day" unless the rule is only about one weekday (for example no Saturday call after an ICU call).'),
    ],
    defaults: () => ({ ifCodes: [], thenCodes: [], mode: 'forbid', from: 1, to: 1, thenDay: '' }),
    describe(r, T) {
      const p = r.params, a = num(p.from, 1), b = num(p.to, a);
      const no = p.mode === 'require' ? '' : 'no ';
      let off;
      if (a === 1 && b === 1) off = 'the next day';
      else if (a === 1 && b > 1) off = `for the next ${b} days`;
      else if (a === -1 && b === -1) off = 'the day before';
      else if (b === -1 && a < -1) off = `in the ${-a} days before`;
      else if (a === b) off = a > 0 ? `${a} days later` : a < 0 ? `${-a} days before` : 'the same day';
      else off = `from day ${a} to day ${b}`;
      const lead = a > 0 ? `After ${T.codes(p.ifCodes)}` : cap(T.codes(p.ifCodes));
      const tdn = p.thenDay === '' || p.thenDay == null ? null : Number(p.thenDay);
      const onDay = tdn == null ? '' : ` (only on a ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][tdn]})`;
      return withWhen(`${whoPrefix(r, T)}${whoPrefix(r, T) ? lead.toLowerCase() : lead}: ${no}${T.codes(p.thenCodes)} ${off}${onDay}`, r, T);
    },
    validate(r) { return num(r.params.from, 1) > num(r.params.to, 1) ? ['From day is after To day'] : []; },
    compile(r, X) {
      const p = r.params, mi = X.codes(p.ifCodes), mt = X.codes(p.thenCodes);
      if (mi.empty || mt.empty) return null;
      const a = num(p.from, 1), b = num(p.to, a), forbid = p.mode !== 'require';
      const tday = p.thenDay === '' || p.thenDay == null ? -1 : Number(p.thenDay);   // only when the later day is this weekday
      const { ctx, u } = X, n = ctx.n, ok = X.when, act = ctx.act, inWho = X.W.inWho;
      const d0 = Math.max(0, ctx.lo - Math.max(b, 0)), d1 = Math.min(n - 1, ctx.hi - Math.min(a, 0));
      const samePair = i => {
        const els = ctx.post[i] ? [...ctx.codes[i], ...ctx.req[i], 'x'] : [...ctx.codes[i], ...ctx.req[i]];
        for (let x = 0; x < els.length; x++) {
          if (!mi.elem(els[x])) continue;
          for (let y = 0; y < els.length; y++) if (y !== x && mt.elem(els[y])) return true;
        }
        return false;
      };
      return {
        person(pi, out) {
          if (!inWho[pi]) return 0;
          const base = pi * n;
          let pen = 0;
          for (let d = d0; d <= d1; d++) {
            if (!ok[d] || !act[base + d] || !mi(base + d)) continue;
            for (let k = a; k <= b; k++) {
              const e = d + k;
              if (e < 0 || e >= n || !act[base + e]) continue;
              if (tday >= 0 && ctx.wd[e] !== tday) continue;
              const dIn = d >= ctx.lo && d <= ctx.hi, eIn = e >= ctx.lo && e <= ctx.hi;
              if (!dIn && !eIn) continue;
              // the same day (offset 0, must not): two different codes, one from each list (a code never clashes with itself)
              const hit = k === 0 && forbid ? samePair(base + e) : mt(base + e);
              if (!forbid && !hit && !eIn && !ctx.codes[base + e].length) continue;   // a day not planned yet
              if (forbid ? hit : !hit) {
                pen += u; ctx.n2++;
                if (out) {
                  const msg = forbid
                    ? `${X.name(pi)}: ${X.T.codes(p.ifCodes)} on ${X.day(d)}, then ${X.T.codes(p.thenCodes)} on ${X.day(e)}`
                    : `${X.name(pi)}: ${X.T.codes(p.ifCodes)} on ${X.day(d)} needs ${X.T.codes(p.thenCodes)} on ${X.day(e)}`;
                  out.push(X.V(u, msg, { staffId: ctx.people[pi].id, date: X.iso(dIn ? d : e), dates: [d, e].filter(X.inRange).map(X.iso) }));
                }
              }
            }
          }
          return pen;
        },
      };
    },
  },

  // A and B on the same day: forbidden, or A needs B.
  sameDay: {
    label: 'Same-day combinations', icon: '🚫', scope: 'person',
    help: 'Codes that can\'t go together on one day (leave and a shift), or one that needs another.',
    example: 'Never leave and any shift on the same day',
    params: [
      P.codes('codesA', 'Codes A'),
      P.sel('mode', 'Rule', [['forbid', 'can\'t be on the same day as'], ['require', 'needs on the same day']]),
      P.codes('codesB', 'Codes B'),
    ],
    defaults: () => ({ codesA: [], codesB: [], mode: 'forbid' }),
    describe(r, T) {
      const p = r.params;
      const s = p.mode === 'require'
        ? `${cap(T.codes(p.codesA))} only with ${T.codes(p.codesB)} on the same day`
        : `Never ${T.codes(p.codesA)} and ${T.codes(p.codesB)} on the same day`;
      return withWhen(whoPrefix(r, T) + (whoPrefix(r, T) ? s[0].toLowerCase() + s.slice(1) : s), r, T);
    },
    compile(r, X) {
      const p = r.params, mA = X.codes(p.codesA), mB = X.codes(p.codesB);
      if (mA.empty || mB.empty) return null;
      const forbid = p.mode !== 'require';
      const { ctx, u } = X, n = ctx.n, ok = X.when, act = ctx.act, inWho = X.W.inWho;
      // two different codes of the day, one matching A and the other B (so "@shift + @shift" means two shifts)
      const pair = i => {
        const els = [...ctx.codes[i], ...ctx.req[i]];
        if (ctx.post[i]) els.push('x');
        if (ctx.post2[i]) els.push('PPC');   // the day off after an ICU post call counts as a thing of the day too
        const pres = (ctx.flags[i] & F.PRESENT) !== 0;
        const pa = mA.present && pres, pb = mB.present && pres;
        if (pa && pb) return ['at work', 'at work'];
        if (pa) { const c = els.find(mB.elem); return c ? ['at work', c] : null; }
        if (pb) { const c = els.find(mA.elem); return c ? [c, 'at work'] : null; }
        for (let x = 0; x < els.length; x++) {
          if (!mA.elem(els[x])) continue;
          for (let y = 0; y < els.length; y++) if (y !== x && mB.elem(els[y])) return [els[x], els[y]];
        }
        return null;
      };
      // a pair where one side is post call (x)
      const pairX = i => {
        const els = [...ctx.codes[i], ...ctx.req[i]];
        const pres = (ctx.flags[i] & F.PRESENT) !== 0;
        if (mA.elem('x')) { if (mB.present && pres) return ['x', 'at work']; const c = els.find(mB.elem); if (c) return ['x', c]; }
        if (mB.elem('x')) { if (mA.present && pres) return ['at work', 'x']; const c = els.find(mA.elem); if (c) return [c, 'x']; }
        return null;
      };
      return {
        info: { mA, mB, forbid, ok, inWho },
        person(pi, out) {
          if (!inWho[pi]) return 0;
          const base = pi * n;
          let pen = 0;
          for (let d = ctx.lo; d <= ctx.hi; d++) {
            const i = base + d;
            if (!ok[d] || !act[i] || !mA(i)) continue;
            if (forbid) {
              if (!mB(i)) continue;
              const pr = pair(i);
              if (!pr) continue;
              pen += u; ctx.n2++;
              if (out) out.push(X.V(u, `${X.day(d)}: ${X.name(pi)} has ${X.T.code(pr[0])} and ${X.T.code(pr[1])}`, { staffId: ctx.people[pi].id, date: X.iso(d) }));
            } else if (!mB(i)) {
              pen += u; ctx.n2++;
              if (out) out.push(X.V(u, `${X.day(d)}: ${X.name(pi)} has ${X.T.codes(p.codesA)} without ${X.T.codes(p.codesB)}`, { staffId: ctx.people[pi].id, date: X.iso(d) }));
            }
          }
          // The day after the last day checked: post call there comes from a duty inside the range (a call on the
          // 30th before a clinic already planned on the 1st), so it is this range's problem too.
          const e = ctx.hi + 1, ie = base + e;
          if (forbid && e < n && ok[e] && act[ie] && ctx.post[ie]) {
            const pr = pairX(ie);
            if (pr) {
              pen += u; ctx.n2++;
              if (out) out.push(X.V(u, `${X.day(e)}: ${X.name(pi)} has ${X.T.code(pr[0])} and ${X.T.code(pr[1])}`, { staffId: ctx.people[pi].id, date: X.iso(ctx.hi), dates: [X.iso(ctx.hi)] }));
            }
          }
          return pen;
        },
      };
    },
  },

  // Between people on the same day: never together, or needs someone else on.
  together: {
    label: 'Pairing between people', icon: '🤝', scope: 'day',
    help: 'Who can\'t be on together (two Baby MOs), or who needs someone else on with them.',
    example: 'Baby MO on Call: at least 1 of senior residents or ACs on Call too',
    params: [
      P.codes('codes', 'If someone in Who has'),
      P.sel('mode', 'Then', [['needs', 'they need someone else'], ['never', 'nobody else may be']]),
      { key: 'other', label: 'Other people', kind: 'who' },
      P.codes('otherCodes', 'On'),
      P.num('min', 'How many others (needs)', { min: 1, optional: true }),
    ],
    defaults: () => ({ codes: [], other: blankWho(), otherCodes: [], mode: 'needs', min: 1 }),
    describe(r, T) {
      const p = r.params;
      const same = JSON.stringify({ ...blankWho(), ...(p.other || {}) }) === JSON.stringify({ ...blankWho(), ...(r.who || {}) });
      const min = Math.max(1, num(p.min, 1));
      const lead = `${cap(T.who(r.who))} on ${T.codes(p.codes)}`;
      let s;
      if (p.mode === 'never') s = `${lead}: never with ${same ? `another ${T.noun(p.other, 1)}` : T.who(p.other)} on ${T.codes(p.otherCodes)}`;
      else {
        const others = same
          ? (min === 1 ? `another ${T.noun(p.other, 1)}` : `${min} other ${T.noun(p.other, min)}`)
          : (min === 1 ? `someone from ${T.who(p.other)}` : `${min} from ${T.who(p.other)}`);
        s = `${lead}: needs ${others} on ${T.codes(p.otherCodes)} too`;
      }
      return withWhen(s, r, T);
    },
    validate(r) { return r.params.mode === 'needs' && !(num(r.params.min, 1) >= 1) ? ['How many others must be 1 or more'] : []; },
    compile(r, X) {
      const p = r.params, m = X.codes(p.codes), mo = X.codes(p.otherCodes);
      if (m.empty || mo.empty) return null;
      const O = X.who(p.other);
      const min = num(p.min, 1), never = p.mode === 'never';
      const { ctx, u } = X, n = ctx.n, ok = X.when, act = ctx.act, list = X.W.list;
      const S = [], Os = [];
      return {
        day(d, out) {
          if (!ok[d]) return 0;
          S.length = 0;
          for (let k = 0; k < list.length; k++) { const i = list[k] * n + d; if (act[i] && m(i)) S.push(list[k]); }
          if (!S.length) return 0;
          Os.length = 0;
          for (let k = 0; k < O.list.length; k++) { const i = O.list[k] * n + d; if (act[i] && mo(i)) Os.push(O.list[k]); }
          let pen = 0;
          for (const s of S) {
            if (never) {
              // count each unordered pair once
              // count each unordered pair once: skip o when the pair is already counted from o's side
              // (o is in S with the first codes and s is one of the others with the other codes)
              const sIsOther = Os.includes(s);
              const bad = Os.filter(o => o !== s && !(sIsOther && o < s && S.includes(o)));
              if (!bad.length) continue;
              pen += u * bad.length; ctx.n2++;
              if (out) out.push(X.V(u * bad.length, `${X.day(d)}: ${X.name(s)} (${X.T.codes(p.codes)}) with ${bad.map(X.name).join(', ')} (${X.T.codes(p.otherCodes)})`, { date: X.iso(d), staffId: ctx.people[s].id, staffIds: [s, ...bad].map(i => ctx.people[i].id) }));
            } else {
              const cnt = Os.length - (Os.includes(s) ? 1 : 0);
              if (cnt >= min) continue;
              pen += u * (min - cnt); ctx.n2++;
              if (out) out.push(X.V(u * (min - cnt), `${X.day(d)}: ${X.name(s)} on ${X.T.codes(p.codes)} needs ${min === 1 ? 'someone' : min} from ${X.T.who(p.other)} on ${X.T.codes(p.otherCodes)}`, { date: X.iso(d), staffId: ctx.people[s].id }));
            }
          }
          return pen;
        },
      };
    },
  },

  // No more than max consecutive days with codes.
  maxRun: {
    label: 'Consecutive days', icon: '📅', scope: 'person',
    help: 'The longest run of days in a row someone may have a duty.',
    example: 'Everyone: at most 5 days in a row of any shift',
    params: [P.codes('codes', 'Codes'), P.num('max', 'At most days in a row', { min: 1 })],
    defaults: () => ({ codes: [], max: 5 }),
    describe(r, T) { return withWhen(`${cap(T.who(r.who))}: at most ${num(r.params.max, 5)} days in a row of ${T.codes(r.params.codes)}`, r, T); },
    validate(r) { return !(num(r.params.max, 0) >= 1) ? ['At most must be 1 or more'] : []; },
    compile(r, X) {
      const m = X.codes(r.params.codes);
      if (m.empty) return null;
      const max = Math.max(1, num(r.params.max, 5));
      const { ctx, u } = X, n = ctx.n, ok = X.when, act = ctx.act, inWho = X.W.inWho;
      return {
        person(pi, out) {
          if (!inWho[pi]) return 0;
          const base = pi * n;
          let pen = 0, run = 0;
          for (let d = 0; d <= n; d++) {
            const hit = d < n && ok[d] && act[base + d] && m(base + d);
            if (hit) { run++; continue; }
            if (run > max) {
              const a = d - run, b = d - 1;
              if (b >= ctx.lo && a <= ctx.hi) {
                pen += u * (run - max); ctx.n2++;
                if (out) {
                  const dates = []; for (let k = Math.max(a, ctx.lo); k <= Math.min(b, ctx.hi); k++) dates.push(X.iso(k));
                  out.push(X.V(u * (run - max), `${X.name(pi)}: ${run} days in a row of ${X.T.codes(r.params.codes)} from ${X.day(a)}, at most ${max}`, { staffId: ctx.people[pi].id, date: dates[0], dates }));
                }
              }
            }
            run = 0;
          }
          return pen;
        },
      };
    },
  },

  // Someone with request R on d wants / doesn't want codes on d (or that weekend).
  requests: {
    label: 'Honour requests', icon: '🙋', scope: 'person',
    help: 'Give people what they asked for (Cr, Pr, Wr) and keep them off what they asked not to do (Nc, NP, Nw).',
    example: 'No call (Nc): no Call that day',
    params: [
      { key: 'request', label: 'Request', kind: 'code' },
      P.sel('mode', 'They', [['want', 'want'], ['avoid', 'don\'t want']]),
      P.codes('codes', 'Codes'),
      P.sel('span', 'On', [['day', 'that day'], ['weekend', 'that weekend (Sat or Sun)']]),
    ],
    defaults: () => ({ request: 'Cr', codes: ['C'], mode: 'want', span: 'day' }),
    describe(r, T) {
      const p = r.params;
      const span = p.span === 'weekend' ? 'that weekend' : 'that day';
      const s = p.mode === 'avoid' ? `no ${T.codes(p.codes).replace(/^any /, '')} ${span}` : `give ${T.codes(p.codes)} ${span}`;
      return withWhen(`${whoPrefix(r, T)}${T.code(p.request)} (${p.request}): ${s}`, r, T);
    },
    validate(r, state) {
      const d = dutyMap(state).get(r.params.request);
      if (!r.params.request) return ['Choose the request code'];
      return d && d.kind !== 'request' ? [`${r.params.request} is not a request code`] : [];
    },
    compile(r, X) {
      const p = r.params, m = X.codes(p.codes), code = p.request;
      if (m.empty || !code) return null;
      const want = p.mode !== 'avoid', weekend = p.span === 'weekend';
      const { ctx, u } = X, n = ctx.n, ok = X.when, act = ctx.act, inWho = X.W.inWho;
      // the flags say first whether the day holds a code of the request's kind at all (one AND; speed)
      const cb = ctx.kindBit.get(code) || F.ANY, flags = ctx.flags;
      const has = i => (flags[i] & cb) !== 0 && (ctx.req[i].includes(code) || ctx.codes[i].includes(code));
      const reqTxt = `${X.T.code(code)} (${code})`;
      // a weekend request can sit up to 6 days before its weekend (Mon..Sun), and a weekend can straddle the
      // range (Sat 31 Oct, Sun 1 Nov): scan those request days too, keep weekends with a day in the range
      const dA = weekend ? Math.max(0, ctx.lo - 6) : ctx.lo, dB = weekend ? Math.min(n - 1, ctx.hi + 1) : ctx.hi;
      // Speed: the days each person has a request code, listed once. Requests never change while a month is checked
      // or auto-filled (Auto-fill places only shift codes), so the solver's re-checks look at those few days only.
      // Any other kind of code (a misconfigured rule) is looked for on every day, as it could be placed.
      let days = null;
      if (cb === F.REQ) {
        days = [];
        for (let pi = 0; pi < ctx.P; pi++) {
          const list = [];
          if (inWho[pi]) for (let d = dA; d <= dB; d++) if (has(pi * n + d)) list.push(d);
          days.push(list);
        }
      }
      return {
        info: { m, code, want, weekend, ok, inWho },
        person(pi, out) {
          if (!inWho[pi]) return 0;
          const base = pi * n;
          let pen = 0, lastSat = -99;
          const list = days && days[pi], end = list ? list.length : dB - dA + 1;
          for (let x = 0; x < end; x++) {
            const d = list ? list[x] : dA + x, i = base + d;
            if (!ok[d] || !act[i] || !has(i)) continue;
            if (!weekend) {
              const hit = m(i);
              if (want ? hit : !hit) continue;
              pen += u; ctx.n2++;
              if (out) out.push(X.V(u, want ? `${X.day(d)}: ${X.name(pi)} asked for ${X.T.codes(p.codes)} (${code})` : `${X.day(d)}: ${X.name(pi)} has ${X.T.codes(p.codes)} despite ${reqTxt}`, { staffId: ctx.people[pi].id, date: X.iso(d) }));
              continue;
            }
            const wd = ctx.wd[d];
            const sat = wd === 6 ? d : wd === 0 ? d - 1 : d + (6 - wd);
            if (sat + 1 < ctx.lo || sat > ctx.hi) continue;   // that weekend has no day in the range
            if (sat === lastSat) continue;
            lastSat = sat;
            let hits = 0, inHits = 0;
            const wk = [];
            for (const e of [sat, sat + 1]) if (e >= 0 && e < n && act[base + e]) { wk.push(e); if (m(base + e)) { hits++; if (X.inRange(e)) inHits++; } }
            const wkIn = wk.filter(X.inRange);
            if (!wkIn.length) continue;
            if (want && hits === 0) {
              pen += u; ctx.n2++;
              if (out) out.push(X.V(u, `Weekend of ${X.day(Math.max(sat, 0))}: ${X.name(pi)} asked for ${X.T.codes(p.codes)} (${code})`, { staffId: ctx.people[pi].id, date: X.iso(wkIn[0]), dates: wkIn.map(X.iso) }));
            } else if (!want && inHits > 0) {
              // only the duties inside the range count (the other day of the weekend is the other month's problem)
              pen += u * inHits; ctx.n2++;
              if (out) { const dates = wkIn.filter(e => m(base + e)).map(X.iso); out.push(X.V(u * inHits, `Weekend of ${X.day(Math.max(sat, 0))}: ${X.name(pi)} has ${X.T.codes(p.codes)} despite ${reqTxt}`, { staffId: ctx.people[pi].id, date: dates[0], dates })); }
            }
          }
          return pen;
        },
      };
    },
  },

  // Penalty for people whose weighted count (per FTE) is far from the group average.
  spread: {
    label: 'Share fairly', icon: '⚖️', scope: 'global', soft_only: true,
    help: 'Spread a duty evenly: weekends and public holidays count extra. Always soft.',
    example: 'Share Call fairly among juniors (weekends x2, holidays x2)',
    params: [
      P.codes('codes', 'Duty'),
      P.sel('period', 'Over', [['month', 'Each month'], ['range', 'The dates checked']]),
      P.sel('scheme', 'A call counts', [['offdays', 'More on a day off, and the day before one'], ['fixed', 'By weekend and public holiday weights']],
        'Days off are weekends and public holidays. The first way is the rosterer\'s points: a weekday 1, Friday 1.5, Saturday 2, Sunday 1.5, a public holiday 1.5 (2 when the day after is also off).'),
      P.num('offBonus', 'Day off adds (first way)', { min: 0, max: 5 }),
      P.num('eveBonus', 'Day before a day off adds (first way)', { min: 0, max: 5 }),
      P.num('weekendWeight', 'Weekend counts as (second way)', { min: 0, max: 10 }),
      P.num('holidayWeight', 'Public holiday counts as (second way)', { min: 0, max: 10 }),
      P.num('tolerance', 'Allowed difference from average', { min: 0, max: 10 }),
      P.num('alert', 'Only point it out above (points)', { min: 0, max: 20 }, 'Fill still aims for an even share, but Check and the dot after a name only mention a gap bigger than this many points (0 or empty: the same as the allowed difference) and bigger than the percentage below.'),
      P.num('alertPct', 'and above this % of the average', { min: 0, max: 500 }, 'A gap also has to be this big compared with the average (a gap of 1 against an average of 2 is 50%). People with few calls, like MO3s, then show up sooner than with a fixed number. 0: no percentage test.'),
      P.sel('byGroup', 'Compare with', [['no', 'Everyone in the rule'], ['yes', 'The same grade']], 'The average each person is compared with: everyone in the rule, or only people of the same grade.'),
      { key: 'among', label: 'Only people on (their days on it set the share)', kind: 'codes', optional: true, help: 'A posting, e.g. ICU: only people in ICU count, and someone in ICU for half the month gets half a share.' },
      P.num('carry', 'Carry over from earlier months (0 to 1)', { min: 0, max: 1 }, 'How much of what a person was over or under in the months before counts now: 0 none, 1 all. Needs "Only people on". The last month counts fully, each month before a quarter less.'),
      P.num('carryMonths', 'Months to look back', { min: 1, max: 12 }),
    ],
    defaults: () => ({ codes: [], period: 'month', scheme: 'offdays', offBonus: 0.5, eveBonus: 0.5, weekendWeight: 2, holidayWeight: 2, tolerance: 1, among: [], carry: 0, carryMonths: 4, alert: 0, alertPct: 0, byGroup: 'no' }),
    describe(r, T) {
      const p = r.params;
      const among = (p.among || []).length ? `people on ${T.codes(p.among)}` : T.who(r.who);
      const how = p.scheme === 'fixed' ? `weekends x${num(p.weekendWeight, 2)}, holidays x${num(p.holidayWeight, 2)}`
        : `a day off adds ${num(p.offBonus, 0.5)} and so does the day before one: Fri ${1 + num(p.eveBonus, 0.5)}, Sat ${1 + num(p.offBonus, 0.5) + num(p.eveBonus, 0.5)}, Sun ${1 + num(p.offBonus, 0.5)}`;
      const cy = num(p.carry, 0) > 0 && (p.among || []).length ? `; ${Math.round(num(p.carry, 0) * 100)}% of the last ${num(p.carryMonths, 4)} months' difference carries over` : '';
      return withWhen(`Share ${T.codes(p.codes)} fairly among ${among} (${how}${cy})`, r, T);
    },
    compile(r, X) {
      const p = r.params, m = X.codes(p.codes);
      if (m.empty) return null;
      const ww = num(p.weekendWeight, 2), hw = num(p.holidayWeight, 2), tol = num(p.tolerance, 1);
      const offdays = p.scheme !== 'fixed', ob = num(p.offBonus, 0.5), eb = num(p.eveBonus, 0.5);
      // the call itself counts as a day on the posting (C3 on a cardiac week, R1B on an ICU week): on the sheet the call replaces the posting code
      const ma = (p.among || []).length ? X.codes([...p.among, ...(p.codes || [])]) : null;
      const alertAt = Math.max(tol, num(p.alert, 0));   // a gap is only pointed out above this (points) and above alertPct of the average; the solver still pushes from `tol`
      const alertPct = Math.max(0, num(p.alertPct, 0)) / 100, byGroup = p.byGroup === 'yes';
      const { ctx, u } = X, n = ctx.n, ok = X.when, act = ctx.act, list = X.W.list, inWho = X.W.inWho;
      const periods = p.period === 'range' ? ctx.periods.range : ctx.periods.month;
      const K = periods.length;
      const val = new Float64Array(ctx.P * K).fill(NaN);   // weighted count per FTE, NaN = not in this period
      const raw = new Float64Array(ctx.P * K);
      // what each person was over or under in the months before each period (points), scaled by how much carries over
      const cw = (p.among || []).length ? Math.max(0, Math.min(1, num(p.carry, 0))) : 0;
      const carry = new Float64Array(ctx.P * K);
      if (cw > 0) {
        for (let k = 0; k < K; k++) {
          const mk = p.period === 'range' ? ctx.month[ctx.lo] : periods[k].key;
          const bal = carryBalances(ctx.state, mk, { ...p, carryMonths: num(p.carryMonths, 4) });
          ctx.people.forEach((pp, pi) => { carry[pi * K + k] = cw * (bal.get(pp.id) || 0); });
        }
      }
      // a public holiday on a weekend counts as the larger of the two weights
      const isOff = d => ctx.wd[d] === 0 || ctx.wd[d] === 6 || !!ctx.hol[d];
      const nextOff = d => (d + 1 < n ? isOff(d + 1) : (ctx.wd[d] + 1) % 7 === 0 || (ctx.wd[d] + 1) % 7 === 6);   // past the window: weekends only
      const wOf = d => {
        if (offdays) return dayOffWeight(isOff(d), nextOff(d), ob, eb);
        const wk = ctx.wd[d] === 0 || ctx.wd[d] === 6; return ctx.hol[d] ? (wk ? Math.max(hw, ww) : hw) : wk ? ww : 1;
      };
      const touch = pi => {
        if (!inWho[pi]) return;
        const base = pi * n, fte = Number(ctx.people[pi].fte) > 0 ? Number(ctx.people[pi].fte) : 1;
        for (let k = 0; k < K; k++) {
          const per = periods[k];
          let sum = 0, a_ = 0, tot = 0;
          for (let d = per.a; d <= per.b; d++) {
            if (!ok[d]) continue; tot++;
            if (!act[base + d] || (ma && !ma(base + d))) continue; a_++;
            if (m(base + d)) sum += wOf(d);
          }
          const frac = tot ? a_ / tot : 0;
          raw[pi * K + k] = sum;
          val[pi * K + k] = frac >= (ma ? 0.15 : 0.25) ? (sum + carry[pi * K + k]) / (fte * frac) : NaN;
        }
      };
      return {
        touch,
        init() { for (const pi of list) touch(pi); },
        global(out) {
          let pen = 0;
          for (let k = 0; k < K; k++) {
            // the average each person is compared with: everyone in the rule, or the people of the same grade
            const sum = new Map(), cnt = new Map();
            const keyOf = pi => (byGroup ? ctx.people[pi].group : '');
            for (const pi of list) { const v = val[pi * K + k]; if (v === v) { const g = keyOf(pi); sum.set(g, (sum.get(g) || 0) + v); cnt.set(g, (cnt.get(g) || 0) + 1); } }
            for (const pi of list) {
              const v = val[pi * K + k];
              if (v !== v) continue;
              const g = keyOf(pi), c = cnt.get(g) || 0;
              if (c < 2) continue;
              const mean = sum.get(g) / c;
              const dev = Math.abs(v - mean) - tol;
              if (dev <= 1e-9) continue;
              const pp = Math.round(u * dev * 10) / 10;
              pen += pp; ctx.n2++;
              if (out && Math.abs(v - mean) > alertAt && Math.abs(v - mean) > alertPct * Math.abs(mean)) {
                const lab = p.period === 'range' ? 'in these dates' : `in ${fmtMonth(periods[k].key)}`;
                // about the whole period, so no date: the grid marks the name, Check's Show opens their month
                const wtxt = ww !== 1 || hw !== 1 ? ' (weekends and holidays count extra)' : '';
                out.push(X.V(pp, `${X.name(pi)}: ${X.T.codes(p.codes)} ${round1(v)} ${lab}${wtxt}${carry[pi * K + k] ? ` (includes ${carry[pi * K + k] > 0 ? '+' : ''}${round1(carry[pi * K + k])} carried over from earlier months)` : ''}; ${byGroup ? 'average for the grade' : 'group average'} ${round1(mean)}`, { staffId: ctx.people[pi].id, month: periods[k].key }));
              }
            }
          }
          return pen;
        },
      };
    },
  },

  // Only people in who may have codes.
  eligible: {
    label: 'Only these people', icon: '🎫', scope: 'person',
    help: 'Restrict a duty to some people (OT consultant: seniors only).',
    example: 'Only seniors may do OT consultant',
    params: [P.codes('codes', 'Duty')],
    defaults: () => ({ codes: [] }),
    describe(r, T) { return withWhen(`Only ${T.who(r.who)} may do ${T.codes(r.params.codes)}`, r, T); },
    compile(r, X) {
      const m = X.codes(r.params.codes);
      if (m.empty) return null;
      const { ctx, u } = X, n = ctx.n, ok = X.when, act = ctx.act, inWho = X.W.inWho;
      return {
        info: { m, ok, inWho },
        person(pi, out) {
          if (inWho[pi]) return 0;
          const base = pi * n;
          let pen = 0;
          for (let d = ctx.lo; d <= ctx.hi; d++) {
            const i = base + d;
            if (!ok[d] || !act[i] || !m(i)) continue;
            pen += u; ctx.n2++;
            if (out) out.push(X.V(u, `${X.day(d)}: ${X.name(pi)} has ${X.T.codes(r.params.codes)}, only ${X.T.who(r.who)} may`, { staffId: ctx.people[pi].id, date: X.iso(d) }));
          }
          return pen;
        },
      };
    },
  },

  // Calls before the date set on each person ("No calls until", People › edit a person): baby MOs until they pass the test, very new
  // people. Hard: the date is the rosterer's own decision.
  noCallsUntil: {
    label: 'No calls until their date', icon: '🚫', scope: 'person',
    help: 'People with a "No calls until" date (People › edit a person) take no calls before it: baby MOs until they pass the test, very new people.',
    example: 'No calls before the date set on each person',
    params: [P.codes('codes', 'Calls')],
    defaults: () => ({ codes: [] }),
    describe(r, T) { return withWhen(`No ${T.codes(r.params.codes).replace(/^any /, '')} before the "no calls until" date set on each person`, r, T); },
    compile(r, X) {
      const m = X.codes(r.params.codes);
      if (m.empty) return null;
      const { ctx, u } = X, n = ctx.n, ok = X.when, act = ctx.act, inWho = X.W.inWho;
      const until = ctx.people.map(p => String(p.noCallsUntil || ''));
      return {
        info: { m, ok, inWho, until },
        person(pi, out) {
          if (!until[pi] || !inWho[pi]) return 0;
          const base = pi * n;
          let pen = 0;
          for (let d = ctx.lo; d <= ctx.hi; d++) {
            const i = base + d;
            if (!ok[d] || !act[i] || ctx.days[d] >= until[pi] || !m(i)) continue;
            pen += u; ctx.n2++;
            if (out) out.push(X.V(u, `${X.day(d)}: ${X.name(pi)} has ${X.T.codes(r.params.codes)}, no calls until ${fmtDay(until[pi])}`, { staffId: ctx.people[pi].id, date: X.iso(d) }));
          }
          return pen;
        },
      };
    },
  },

  // Each person in who has codes every day in when (unless away).
  // No call in the first days of a posting block ("no ICU call on day 1", "new to ICU: calls from day 4").
  postingStart: {
    label: 'Start of a posting', icon: '🚪', scope: 'person',
    help: 'No calls in the first days of a posting: a block of days in a row on the same posting, however it started.',
    example: 'New to ICU: no ICU call in the first 3 days in ICU (calls from day 4)',
    params: [P.codes('codes', 'Calls'), { key: 'posting', label: 'Posting', kind: 'code' }, P.num('days', 'Not in the first … days', { min: 1, max: 60 })],
    defaults: () => ({ codes: [], posting: '', days: 1 }),
    describe(r, T) {
      const days = num(r.params.days, 1);
      return withWhen(`${whoPrefix(r, T)}no ${T.codes(r.params.codes).replace(/^any /, '')} in the first ${days === 1 ? 'day' : days + ' days'} of ${T.codes([r.params.posting])} (from day ${days + 1})`, r, T);
    },
    validate(r) { return !r.params.posting ? ['No posting chosen'] : !(num(r.params.days, 0) >= 1) ? ['Days must be 1 or more'] : []; },
    compile(r, X) {
      const m = X.codes(r.params.codes);
      const post = r.params.posting;
      if (m.empty || !post) return null;
      const days = Math.max(1, num(r.params.days, 1));
      const { ctx, u } = X, n = ctx.n, ok = X.when, act = ctx.act, inWho = X.W.inWho, codes = ctx.codes;
      const on = i => codes[i].includes(post);
      return {
        person(pi, out) {
          if (!inWho[pi]) return 0;
          const base = pi * n;
          let pen = 0;
          for (let d = ctx.lo; d <= ctx.hi; d++) {
            const i = base + d;
            if (!ok[d] || !act[i] || !m(i) || !on(i)) continue;
            let k = 1;
            while (k <= days && d - k >= 0 && on(i - k)) k++;
            if (k > days || d - k < 0) continue;   // ran past the days we can see: a long block
            // day k of the block (k = 1 is the first day)
            pen += u; ctx.n2++;
            if (out) out.push(X.V(u, `${X.day(d)}: ${X.name(pi)} on ${X.T.codes(r.params.codes)} on day ${k} of ${X.T.codes([post])}, first allowed day ${days + 1}`, { staffId: ctx.people[pi].id, date: X.iso(d) }));
          }
          return pen;
        },
      };
    },
  },

  standing: {
    label: 'Standing duty', icon: '📌', scope: 'person',
    help: 'Someone always does a duty on certain days unless they are away (APS every weekday).',
    example: 'Pain (APS): Acute pain service every day (weekdays)',
    params: [P.codes('codes', 'Duty')],
    defaults: () => ({ codes: [] }),
    describe(r, T) { return withWhen(`${cap(T.who(r.who))}: ${T.codes(r.params.codes)} every day unless away`, r, T); },
    compile(r, X) {
      const m = X.codes(r.params.codes);
      if (m.empty) return null;
      const { ctx, u } = X, n = ctx.n, ok = X.when, act = ctx.act, inWho = X.W.inWho;
      return {
        person(pi, out) {
          if (!inWho[pi]) return 0;
          const base = pi * n;
          let pen = 0;
          for (let d = ctx.lo; d <= ctx.hi; d++) {
            const i = base + d;
            if (!ok[d] || !act[i] || (ctx.flags[i] & (F.LEAVE | F.OTHER | F.X)) || m(i)) continue;
            pen += u; ctx.n2++;
            if (out) out.push(X.V(u, `${X.day(d)}: ${X.name(pi)} has no ${X.T.codes(r.params.codes).replace(/^any /, '')}`, { staffId: ctx.people[pi].id, date: X.iso(d) }));
          }
          return pen;
        },
      };
    },
  },
};

const round1 = x => Math.round(x * 10) / 10;

// ---------- public API ----------

export function newRule(type, state) {
  const t = RULE_TYPES[type];
  if (!t) throw new Error(`Unknown rule type: ${type}`);
  const params = t.defaults();
  if (type === 'requests' && state) {
    const req = (state.duties || []).find(d => d.kind === 'request');
    if (req) params.request = req.code;
  }
  return {
    id: uid('r'), type, name: '', enabled: true, hard: !t.soft_only, weight: 10,
    who: blankWho(), when: { from: '', to: '', days: [], holidays: 'any' }, params, note: '',
  };
}

export function describeRule(rule, state) {
  const t = RULE_TYPES[rule && rule.type];
  if (!t) return `Unknown rule type "${rule && rule.type}"`;
  try { return t.describe(normalizeRule(rule), textKit(state)); } catch (e) { return t.label; }
}

export function validateRule(rule, state) {
  const out = [];
  const t = RULE_TYPES[rule && rule.type];
  if (!t) return [`Unknown rule type "${rule && rule.type}"`];
  const r = normalizeRule(rule);
  const dm = dutyMap(state);
  const known = c => dm.has(c) || c === 'x' || c === 'PPC' || TOKENS.includes(c);
  for (const spec of t.params) {
    const v = r.params[spec.key];
    if (spec.kind === 'codes') {
      const list = Array.isArray(v) ? v : [];
      if (!list.length && !spec.optional) out.push(t.params.filter(s => s.kind === 'codes').length > 1 ? `No codes chosen for ${spec.label}` : 'No codes chosen');
      for (const c of list) if (!known(c)) out.push(`Unknown code "${c}"`);
    } else if (spec.kind === 'code') {
      if (v && !known(v)) out.push(`Unknown code "${v}"`);
    } else if (spec.kind === 'number') {
      if (unset(v)) { if (!spec.optional) out.push(`Set "${spec.label}"`); continue; }
      const x = Number(v);
      if (spec.min != null && x < spec.min) out.push(`"${spec.label}" must be at least ${spec.min}`);
      if (spec.max != null && x > spec.max) out.push(`"${spec.label}" must be at most ${spec.max}`);
    } else if (spec.kind === 'select') {
      if (spec.options && !spec.options.some(([val]) => val === v)) out.push(`Choose "${spec.label}"`);
    } else if (spec.kind === 'who') {
      whoProblems({ ...blankWho(), ...(v || {}) }, state, out);
    }
  }
  if (!unset(r.params.min) && !unset(r.params.max) && Number(r.params.min) > Number(r.params.max)) out.push('At least is more than at most');
  if (r.when.from && r.when.to && r.when.from > r.when.to) out.push('Start date is after end date');
  if (!r.hard || t.soft_only) {
    const w = Number(r.weight);
    if (!(w >= 1 && w <= 100)) out.push('Weight must be 1 to 100');
  }
  whoProblems(r.who, state, out);
  if (t.validate) out.push(...t.validate(r, state));
  return [...new Set(out)];
}

function whoProblems(who, state, out) {
  const gids = new Set((state.groups || []).map(g => g.id)), tids = new Set((state.tags || []).map(g => g.id));
  for (const g of who.groups || []) if (!gids.has(g)) out.push(`Unknown group "${g}"`);
  for (const g of who.tags || []) if (!tids.has(g)) out.push(`Unknown tag "${g}"`);
}

function rangeOf(opts) {
  let { from, to } = opts || {};
  if (!from && !to) {
    const d = new Date();
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const days = monthDays(m);
    from = days[0]; to = days[days.length - 1];
  }
  if (!from) from = to;
  if (!to) to = from;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

// Run one compiled rule over the whole range (violations into out when given). Returns { pen, n }.
export function runRule(ctx, cr, out) {
  ctx.n2 = 0;
  let pen = 0;
  if (cr.day) for (let d = ctx.lo; d <= ctx.hi; d++) pen += cr.day(d, out);
  if (cr.person) for (let p = 0; p < ctx.P; p++) pen += cr.person(p, out);
  if (cr.global) { if (cr.init) cr.init(); pen += cr.global(out); }
  return { pen, n: ctx.n2 };
}

function indexViolations(violations) {
  const byCell = new Map(), byDay = new Map(), byRule = new Map();
  const add = (map, k, v) => { const a = map.get(k); if (a) a.push(v); else map.set(k, [v]); };
  for (const v of violations) {
    add(byRule, v.ruleId, v);
    const dates = v.dates && v.dates.length ? v.dates : (v.date ? [v.date] : []);
    const ids = v.staffIds && v.staffIds.length ? v.staffIds : (v.staffId ? [v.staffId] : []);
    for (const d of dates) {
      add(byDay, d, v);
      for (const id of ids) add(byCell, `${d}|${id}`, v);
    }
  }
  return { byCell, byDay, byRule };
}

// failed: ids of enabled rules that couldn't be checked (broken data); the screens say so instead of "No problems".
export function evaluate(state, opts = {}) {
  const range = rangeOf(opts);
  const rules = (opts.rules || state.rules || []).filter(r => r && r.enabled !== false);
  const ctx = buildContext(state, { ...range, rules });
  const failed = [];
  const violations = [];
  let score = 0;
  for (const r of rules) {
    const cr = compileRule(ctx, r);
    if (!cr) { if (!RULE_TYPES[r.type] || validateRuleSafe(r, state)) failed.push(r.id); continue; }
    const mark = violations.length;
    try { score += runRule(ctx, cr, violations).pen; } catch (e) { violations.length = mark; failed.push(r.id); }
  }
  let hard = 0, soft = 0;
  for (const v of violations) if (v.hard) hard++; else soft++;
  return { violations, hard, soft, score: Math.round(score * 10) / 10, from: range.from, to: range.to, failed, ...indexViolations(violations) };
}

// A rule that compiles to nothing is fine when it is just unfinished (no codes chosen yet); it is broken when it has
// codes and still can't be checked.
function validateRuleSafe(rule, state) {
  try {
    const t = RULE_TYPES[rule.type], r = normalizeRule(rule);
    return t.params.some(spec => spec.kind === 'codes' && r.params[spec.key].length) && !validateRule(rule, state).length;
  } catch (e) { return true; }
}

// One rule, even when disabled (the builder's live "check now").
export function evaluateRule(state, rule, opts = {}) {
  const range = rangeOf(opts);
  const ctx = buildContext(state, { ...range, rules: [rule] });
  const cr = compileRule(ctx, rule);
  if (!cr) return [];
  const out = [];
  try { runRule(ctx, cr, out); } catch (e) { return []; }
  return out;
}
