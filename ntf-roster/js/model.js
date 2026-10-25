// NTF Roster: the data model. State shape, defaults, migrations, month locks per roster and the two rosters (pools);
// the local-date helpers, cell helpers and code tokens are the roster core's (lib/roster-core/model.js), re-exported here.
// Plain functions over plain data (see SPEC.md "State"). No DOM, so node tests and the solver worker can use it.

import {
  uid, iso, parseISO, addDays, monthDays, monthOf, addMonths, weekday, isWeekend, isHoliday, holidayName, fmtDay, fmtMonth,
  dutyMap, groupMap, staffMap, staffActiveOn, staffInMonth, getCell, createCells,
} from '../../lib/roster-core/model.js';   // /lib/ is the shared folder on every host (worker/routes.js SHARED)

export const STORE_KEY = 'ntf-roster-v1';
export const DEMO_KEY = 'ntf-roster-demo';

// ---------- defaults ----------

// Sheet order: the department's "ALL STAFF LEAVE REQUEST" sections, top to bottom.
export const DEFAULT_GROUPS = [
  { id: 'cons', name: 'Senior consultants / consultants', kind: 'senior' },
  { id: 'ac', name: 'Associate consultants', kind: 'senior' },
  { id: 'ext', name: 'NUH / NTFGH / ICU consultants', kind: 'senior' },
  { id: 'vc', name: 'Visiting consultants', kind: 'senior' },
  { id: 'sr', name: 'Senior residents', kind: 'senior' },
  { id: 'srp', name: 'Senior resident physicians', kind: 'junior' },
  { id: 'rp', name: 'Resident physicians', kind: 'junior' },
  { id: 'jr', name: 'Junior residents', kind: 'junior' },
  { id: 'locum', name: 'Locums', kind: 'junior' },
  { id: 'mo', name: 'Medical officers', kind: 'junior' },
  { id: 'nurse', name: 'Nurses (PACU / pain APN)', kind: 'other' },
];

// Junior pool tags (jpool.js sets them from the Junior pool setup screen): the call level (MO2 = the senior MO on call,
// MO1 = the junior MO on call) with a strong or weak mark, 'nocall' (never on call), and which pool a person is in.
function POOL_TAGS_DEFS() {
  return [
    { id: 'mo2strong', name: 'Strong MO2', help: 'Senior MO on call, strong' },
    { id: 'mo2weak', name: 'Weak MO2', help: 'Senior MO on call, still learning: not with a weak MO1' },
    { id: 'mo2', name: 'MO2', help: 'Senior MO on call, strong or weak not set' },
    { id: 'mo1strong', name: 'Strong MO1', help: 'Junior MO on call, strong' },
    { id: 'mo1weak', name: 'Weak MO1', help: 'Junior MO on call, still learning: not with a weak MO2' },
    { id: 'mo1', name: 'MO1', help: 'Junior MO on call, strong or weak not set' },
    { id: 'nocall', name: 'No calls', help: 'In the pool but never on call (PM shifts and a last-resort half call only)' },
    { id: 'jpool', name: 'Junior pool', help: 'Rostered by the junior roster owner' },
    { id: 'spool', name: 'Senior pool', help: 'Rostered with the seniors, even if in a junior section' },
  ];
}
export const DEFAULT_TAGS = [
  { id: 'babymo', name: 'Baby MO', help: 'New MO, never on call alone' },
  { id: 'parttime', name: 'Part time', help: 'Works part time: set their FTE' },
  { id: 'pain', name: 'Pain (APS)', help: 'Does acute pain service weeks' },
  { id: 'icu', name: 'ICU', help: 'ICU posting or ICU trained' },
  ...POOL_TAGS_DEFS(),
];

const duty = (code, name, kind, color, ink, extra = {}) =>
  ({ code, name, kind, color, ink, overnight: false, auto: false, hours: 0, ...extra });
const shift = (code, name, color, extra) => duty(code, name, 'shift', color, '#fff', { hours: 8, ...extra });
const leave = (code, name, color = '#fde2e4') => duty(code, name, 'leave', color, '#7a1c27');
const request = (code, name) => duty(code, name, 'request', '#0b5394', '#fff');   // UI draws requests as outlined chips
const other = (code, name) => duty(code, name, 'other', '#e0e0e0', '#333');

export const DEFAULT_DUTIES = [
  shift('C', 'Call', '#c62828', { overnight: true, auto: true, hours: 24 }),
  shift('P', 'PM shift', '#ef6c00', { auto: true, hours: 5 }),
  shift('SMO', 'Stepdown MO call', '#6a1b9a', { overnight: true, auto: true, hours: 24 }),
  shift('OTC', 'OT consultant', '#1565c0', { auto: true, hours: 10 }),
  shift('PHD', 'Public holiday day shift', '#00838f', { auto: true, hours: 12 }),
  shift('W', 'Weekend duty', '#4527a0', { overnight: true, hours: 24 }),
  shift('Creg', 'Call tag-on', '#ad1457', { hours: 4 }),
  shift('APS', 'Acute pain service', '#2e7d32'),
  shift('Clinic', 'Clinic', '#558b2f', { hours: 4 }),
  shift('Inj', 'Injection list', '#827717', { hours: 4 }),
  shift('HC', 'Half call (10am to 7pm)', '#8e24aa', { auto: true, hours: 9 }),
  leave('AL', 'Annual leave', '#f8c9cf'),
  leave('AAL', 'Advance annual leave'),
  leave('CL', 'Conference/training leave'),
  leave('TL', 'Training leave'),
  leave('EL', 'Exam leave'),
  leave('RS', 'Reservist'),
  leave('MC', 'Medical leave'),
  leave('HL', 'Hospitalisation leave'),
  leave('ML', 'Maternity leave'),
  leave('NPL', 'No pay leave'),
  leave('OIL', 'Off in lieu'),
  leave('FCL', 'Family care leave'),
  leave('CCL', 'Childcare leave'),
  leave('SPL', 'Special leave'),
  leave('ACLS', 'ACLS / BCLS course'),
  request('Cr', 'Call request'),
  request('Nc', 'No call'),
  request('Wr', 'Weekend shift request'),
  request('Nw', 'No weekend shift'),
  request('Pr', 'PM request'),
  request('NP', 'No PM shift'),
  other('NUH', 'At NUH'),
  other('ICM', 'ICU posting'),
  other('LT', 'Liver transplant'),
  other('Mtg', 'Meeting'),
  other('Teach', 'Teaching'),
  other('JR', 'Junior residency teaching (away from 12pm)'),
  duty('x', 'Post call', 'derived', '#eeeeee', '#555'),
];

// Default rules live here (data only) so defaultState() needs no import from rules.js (no circular import);
// rules.js re-exports them as DEFAULT_RULES. The owner tunes them in the app.
const JUNIORS = ['sr', 'srp', 'rp', 'jr', 'locum', 'mo'];
const SENIORS = ['cons', 'ac'];
const R = (id, type, name, params, o = {}) => ({
  id, type, name, enabled: true, hard: o.hard !== false, weight: o.weight ?? 10,
  who: { groups: [], tags: [], staff: [], exclude: [], ...(o.who || {}) },
  when: { from: '', to: '', days: [], holidays: 'any', ...(o.when || {}) },
  params, note: o.note || '', ...(o.pool ? { pool: o.pool } : {}),
});
const JR = { pool: 'junior' }, SN = { pool: 'senior' };
const soft = (weight, more = {}) => ({ hard: false, weight, ...more });
export const DEFAULT_RULES = [
  R('r-leave', 'sameDay', 'No shifts on leave', { codesA: ['@leave'], codesB: ['@shift'], mode: 'forbid' }),
  R('r-postcall', 'sameDay', 'Post call is a day off', { codesA: ['x'], codesB: ['@shift'], mode: 'forbid' }),
  R('r-jcall', 'cover', '', { codes: ['C'], min: 2, max: 2 }, { who: { groups: JUNIORS }, ...JR }),
  R('r-scall', 'cover', '', { codes: ['C'], min: 1, max: 1 }, { who: { groups: SENIORS }, ...SN }),
  R('r-gap', 'sequence', 'At least 3 days between calls', { ifCodes: ['C'], thenCodes: ['C'], mode: 'forbid', from: 1, to: 2 }, soft(20)),
  R('r-maxcall', 'limit', '', { codes: ['C'], period: 'month', window: 7, min: null, max: 7, fte: true, prorate: false }, { who: { groups: JUNIORS }, ...JR }),
  R('r-wkend', 'limit', 'At most 2 weekend calls a month', { codes: ['C'], period: 'month', window: 7, min: null, max: 2, fte: false, prorate: false }, soft(20, { when: { days: [0, 6] } })),
  R('r-fair-j', 'spread', '', { codes: ['C'], period: 'month', weekendWeight: 2, holidayWeight: 2, tolerance: 1 }, soft(5, { who: { groups: JUNIORS }, ...JR })),
  R('r-fair-s', 'spread', '', { codes: ['C'], period: 'month', weekendWeight: 2, holidayWeight: 2, tolerance: 1 }, soft(5, { who: { groups: SENIORS }, ...SN })),
  R('r-req-cr', 'requests', '', { request: 'Cr', codes: ['C'], mode: 'want', span: 'day' }, soft(10)),
  R('r-req-nc', 'requests', '', { request: 'Nc', codes: ['C'], mode: 'avoid', span: 'day' }),
  R('r-req-wr', 'requests', '', { request: 'Wr', codes: ['@shift'], mode: 'want', span: 'weekend' }, soft(5)),
  R('r-req-nw', 'requests', '', { request: 'Nw', codes: ['@shift'], mode: 'avoid', span: 'weekend' }, soft(50)),
  R('r-req-pr', 'requests', '', { request: 'Pr', codes: ['P'], mode: 'want', span: 'day' }, soft(5)),
  R('r-req-np', 'requests', '', { request: 'NP', codes: ['P'], mode: 'avoid', span: 'day' }),
  R('r-baby', 'together', 'A Baby MO on call needs a senior resident, RP or AC on call',
    { codes: ['C'], other: { groups: ['sr', 'srp', 'rp', 'ac'], tags: [], staff: [], exclude: [] }, otherCodes: ['C'], mode: 'needs', min: 1 },
    { who: { tags: ['babymo'] }, ...JR }),
  R('r-baby2', 'together', 'Two Baby MOs never on call together',
    { codes: ['C'], other: { groups: [], tags: ['babymo'], staff: [], exclude: [] }, otherCodes: ['C'], mode: 'never', min: 1 },
    { who: { tags: ['babymo'] }, ...JR }),
  R('r-preleave', 'sequence', 'No call the night before leave', { ifCodes: ['C'], thenCodes: ['@leave'], mode: 'forbid', from: 1, to: 1 }, soft(10)),
  R('r-pm', 'cover', '', { codes: ['P'], min: 1, max: 1 }, { who: { groups: JUNIORS }, when: { days: [1, 2, 3, 4, 5], holidays: 'exclude' }, ...JR }),
  R('r-otc', 'eligible', '', { codes: ['OTC'] }, { who: { groups: ['cons', 'ac', 'ext', 'vc'] }, ...SN }),
  R('r-phd', 'cover', '', { codes: ['PHD'], min: 1, max: 1 }, { who: { groups: JUNIORS }, when: { holidays: 'only' }, ...JR }),
];

const clone = o => JSON.parse(JSON.stringify(o));

export function defaultState() {
  return migrate({
    v: 1,
    settings: { dept: 'NTFGH Department of Anaesthesia', holidays: {} },
    groups: clone(DEFAULT_GROUPS),
    tags: clone(DEFAULT_TAGS),
    staff: [],
    duties: clone(DEFAULT_DUTIES),
    rules: clone(DEFAULT_RULES),
    rulesLog: [],
    months: {},
    cells: {},
  });
}

// Fill missing fields (old saves, imports, cloud loads). Mutates and returns the state. Anything a damaged or
// hand-made file could hold is made safe here: lists hold objects with a string id (or code), duty kinds and colours
// are from a fixed set (they end up in class names and styles), and maps are plain objects.
export const DUTY_KINDS = ['shift', 'leave', 'request', 'other', 'derived'];
// settings.onboarding: the Getting started ticks the data can't show (duty codes looked at, a rule opened, an export
// or backup made) and whether the checklist was hidden or finished (guide.js)
export const ONBOARDING_KEYS = ['codes', 'rules', 'shared', 'hidden', 'done'];
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, dflt = '') => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : dflt);
const COLOUR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
const strList = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : []);
// a list a hand-edited file may hold as "a,b" (who lists, weekdays)
const looseList = v => (typeof v === 'string' && v ? v.split(',').map(x => x.trim()).filter(Boolean) : Array.isArray(v) ? v : []);
// One duty code made safe (kind from the fixed set, colours as #rgb / #rrggbb). Expects a string `code`.
export function cleanDuty(d) {
  const out = { name: d.code, kind: 'other', color: '#e0e0e0', ink: '#333', overnight: false, auto: false, hours: 0, ...d };
  out.code = str(d.code);
  if (!DUTY_KINDS.includes(out.kind)) out.kind = 'other';
  out.name = str(out.name, out.code);
  if (!COLOUR.test(str(out.color))) out.color = '#e0e0e0';
  if (!COLOUR.test(str(out.ink))) out.ink = '#333333';
  out.overnight = !!out.overnight; out.auto = !!out.auto;
  out.hours = Number(out.hours) || 0;
  return out;
}
// One rule made safe: who lists are lists of strings, days are 0..6, params an object. Expects a string `type`.
export function cleanRule(r) {
  const who = isObj(r.who) ? r.who : {}, when = isObj(r.when) ? r.when : {};
  const lists = Object.fromEntries(['groups', 'tags', 'staff', 'exclude'].map(k => [k, strList(looseList(who[k]))]));
  return {
    name: '', enabled: true, hard: true, weight: 10, note: '', ...r,
    id: str(r.id) || uid('r'), name: str(r.name), note: str(r.note),
    params: isObj(r.params) ? r.params : {},
    who: { ...who, ...lists },
    when: { from: '', to: '', holidays: 'any', ...when, days: looseList(when.days).map(Number).filter(x => Number.isInteger(x) && x >= 0 && x <= 6) },
    ...(RULE_POOLS.includes(r.pool) ? { pool: r.pool } : { pool: undefined }),
  };
}

// ---------- which roster a rule belongs to ----------
// The junior and senior rosters are run separately, each with its own rules (owner, 19 Oct 2026). A rule's `pool`
// says which; it only ever covers that roster's people. Rules from before that, or imported without one, are placed
// by who they cover; a rule about everyone (or both) becomes two, one per roster, to be tuned apart.
export const RULE_POOLS = ['junior', 'senior'];
const JUNIOR_RULE_TAGS = ['jpool', 'mo2', 'mo2strong', 'mo2weak', 'mo1', 'mo1strong', 'mo1weak', 'nocall', 'babymo'];
export function guessRulePool(state, r) {
  if (/^r-jp-/.test(r.id || '')) return 'junior';
  const known = DEFAULT_RULES.find(x => x.id === r.id);
  if (known && known.pool) return known.pool;
  const w = isObj(r.who) ? r.who : {}, votes = new Set();
  const kinds = new Map(((state && state.groups) || []).map(g => [g.id, g.kind]));
  for (const g of looseList(w.groups)) if (kinds.has(g)) votes.add(kinds.get(g) === 'junior' ? 'junior' : 'senior');
  for (const t of looseList(w.tags)) { if (JUNIOR_RULE_TAGS.includes(t)) votes.add('junior'); else if (t === 'spool') votes.add('senior'); }
  for (const id of looseList(w.staff)) { const p = ((state && state.staff) || []).find(x => x.id === id); if (p) votes.add(poolOf(state, p)); }
  return votes.size === 1 ? [...votes][0] : '';
}
// Give every rule a roster: placed by who it covers, or split in two (the senior copy gets the id + "-s").
export function splitRules(state, rules) {
  const out = [], ids = new Set(rules.map(r => r.id));
  for (const r of rules) {
    if (RULE_POOLS.includes(r.pool)) { out.push(r); continue; }
    const g = guessRulePool(state, r);
    if (g) { out.push({ ...r, pool: g }); continue; }
    let id = `${r.id}-s`;
    while (ids.has(id)) id += 's';
    ids.add(id);
    out.push({ ...r, pool: 'junior' }, { ...clone(r), id, pool: 'senior' });
  }
  return out;
}
export function migrate(s) {
  if (!isObj(s)) return defaultState();
  s.v = 1;
  s.settings = { dept: 'NTFGH Department of Anaesthesia', holidays: {}, ...(isObj(s.settings) ? s.settings : {}) };
  s.settings.dept = str(s.settings.dept, 'NTFGH Department of Anaesthesia');
  if (!isObj(s.settings.holidays)) s.settings.holidays = {};
  for (const [k, v] of Object.entries(s.settings.holidays)) if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || typeof v !== 'string') delete s.settings.holidays[k];
  // Getting started ticks (guide.js): only true or false, only the known keys
  if (isObj(s.settings.onboarding)) {
    const ob = {};
    for (const k of ONBOARDING_KEYS) if (typeof s.settings.onboarding[k] === 'boolean') ob[k] = s.settings.onboarding[k];
    s.settings.onboarding = ob;
  } else delete s.settings.onboarding;
  const byId = (list, idKey = 'id') => (Array.isArray(list) ? list : []).filter(x => isObj(x) && str(x[idKey])).map(x => ({ ...x, [idKey]: str(x[idKey]) }));
  s.groups = byId(s.groups).map(g => ({ ...g, name: str(g.name, g.id), kind: g.kind === 'senior' || g.kind === 'junior' ? g.kind : (g.kind ? 'other' : g.kind) }));
  if (!s.groups.length) s.groups = clone(DEFAULT_GROUPS);
  s.tags = Array.isArray(s.tags) ? byId(s.tags).map(t => ({ ...t, name: str(t.name, t.id), help: str(t.help) })) : clone(DEFAULT_TAGS);
  s.duties = byId(s.duties, 'code');
  if (!s.duties.length) s.duties = clone(DEFAULT_DUTIES);
  s.duties = s.duties.map(cleanDuty);
  if (!s.duties.some(d => d.code === 'x')) s.duties.push(clone(DEFAULT_DUTIES.find(d => d.code === 'x')));
  // the junior pool arrived later: older saves get its codes, tags and nurse section once (never overwriting their own)
  if (!s.settings.jpv) {
    for (const c of ['HC', 'ACLS', 'JR']) if (!s.duties.some(d => d.code === c)) s.duties.push(clone(DEFAULT_DUTIES.find(d => d.code === c)));
    for (const t of POOL_TAGS_DEFS()) if (!s.tags.some(x => x.id === t.id)) s.tags.push(t);
    if (!s.groups.some(g => g.id === 'nurse')) s.groups.push(clone(DEFAULT_GROUPS.find(g => g.id === 'nurse')));
    s.settings.jpv = 1;
  }
  // which roster this browser works on (owner, 19 Oct 2026: two rosters, one at a time; the old "All" view is gone)
  if (!['junior', 'senior'].includes(s.settings.pool)) s.settings.pool = 'junior';
  s.staff = byId(s.staff).map(p => {
    const x = {
      short: '', group: 'mo', tags: [], fte: 1, start: '', end: '', note: '', active: true, ...p,
      name: str(p.name, p.id), short: str(p.short), group: str(p.group, 'mo'), note: str(p.note),
      start: str(p.start), end: str(p.end), tags: strList(p.tags),
    };
    if (x.pool !== 'junior' && x.pool !== 'senior') delete x.pool;   // moved by hand to a pool (kept on reimport)
    return x;
  });
  // senior residents are rostered with the seniors (owner, 19 Oct 2026): once, older saves move the section and its people
  if (!s.settings.srv) {
    const sr = s.groups.find(g => g.id === 'sr');
    if (sr && sr.kind === 'junior') {
      sr.kind = 'senior';
      for (const p of s.staff) if (p.group === 'sr' && !p.pool) p.tags = p.tags.filter(t => t !== 'jpool' && t !== 'spool');
    }
    s.settings.srv = 1;
  }
  if (!Array.isArray(s.rules)) s.rules = clone(DEFAULT_RULES);
  s.rules = splitRules(s, s.rules.filter(r => isObj(r) && typeof r.type === 'string').map(cleanRule));
  // every rule is confirmed (owner, 19 Oct 2026): once, drop the old "Predicted from the drafted rules" note sentence
  if (!s.settings.rcv) {
    for (const r of s.rules) if (typeof r.note === 'string' && /Predicted/.test(r.note)) r.note = r.note.replace(/\s*Predicted[^.]*\.?/g, '').trim();
    s.settings.rcv = 1;
  }
  // owner, 20 Oct 2026: a half call for the No calls people is a preference, not a must-hold limit of one a month
  if (!s.settings.jpNch) {
    const old = s.rules.find(r => r.id === 'r-jp-nocall-hc');
    if (old) {
      s.rules = s.rules.filter(r => r.id !== 'r-jp-nocall-hc0');
      Object.assign(old, { name: 'No calls people: avoid half calls (only if the day cannot be filled any other way)', hard: false, weight: 90, params: { ...old.params, codes: ['HC'], max: 0 } });
    }
    s.settings.jpNch = 1;
  }
  if (!Array.isArray(s.rulesLog)) s.rulesLog = [];
  s.rulesLog = s.rulesLog.filter(isObj);
  if (s.rulesLog.length > 200) s.rulesLog = s.rulesLog.slice(-200);
  if (isObj(s.aps)) {   // pain service weeks done before the roster: { base: { id: n }, last: { id: 'YYYY-MM' }, through: 'YYYY-MM' }
    const num = o => Object.fromEntries(Object.entries(isObj(o) ? o : {}).map(([k, v]) => [k, Math.max(0, Math.round(Number(v) || 0))]).filter(([, v]) => v));
    const mon = o => Object.fromEntries(Object.entries(isObj(o) ? o : {}).filter(([, v]) => /^\d{4}-\d{2}$/.test(v)));
    s.aps = { base: num(s.aps.base), last: mon(s.aps.last), through: /^\d{4}-\d{2}$/.test(s.aps.through) ? s.aps.through : '' };
  } else delete s.aps;
  if (!isObj(s.months)) s.months = {};
  for (const [m, v] of Object.entries(s.months)) if (isObj(v)) s.months[m] = monthMeta(v);
  if (!isObj(s.cells)) s.cells = {};
  // cells: { date: { staffId: { a: [], r: [], auto: [], note, lock } } }; drop anything else
  for (const [d, day] of Object.entries(s.cells)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isObj(day)) { delete s.cells[d]; continue; }
    for (const [id, c] of Object.entries(day)) {
      if (!isObj(c)) { delete day[id]; continue; }
      for (const k of ['a', 'r', 'auto']) if (c[k] !== undefined) c[k] = strList(c[k]);
      if (c.note !== undefined && typeof c.note !== 'string') c.note = str(c.note);
      if (c.ap !== undefined) c.ap = !!c.ap;
      if (c.rp !== undefined && (!c.rp || typeof c.rp !== 'object' || Array.isArray(c.rp))) delete c.rp;
    }
  }
  return s;
}

// ---------- dates, lookups and cells: the roster core's (lib/roster-core/model.js, one copy for the roster apps) ----------

export {
  uid, iso, parseISO, addDays, monthDays, monthOf, addMonths, weekday, isWeekend, isHoliday, holidayName, fmtDay, fmtMonth,
  dutyMap, groupMap, staffMap, staffActiveOn, staffInMonth, getCell,
};
// no posting duties or PPC; cells keep approved leave (ap) and request priority marks (rp, reqprio.js)
export const { TOKENS, setCell, effectiveCodes, expandTokens, matchesCodes } = createCells({ requestMarks: true });

// Each roster locks its own month (owner, 19 Oct 2026): months[m].locks = { junior, senior }, each '' (open) or when
// it was locked. While a roster's month is locked, no change to its people's days in that month goes through
// (store.js), whoever tries it: edits, Auto-fill, import, a pull from People. status is 'published' only when both
// are locked (what older copies of the app read); a month from before then, 'published', is locked for both.
// pool: 'junior' or 'senior'; left out, the roster this browser is working on.
const viewOf = state => ((state && state.settings && state.settings.pool) === 'senior' ? 'senior' : 'junior');
export function monthMeta(v) {
  const o = isObj(v) ? v : {};
  const old = o.status === 'published' ? (str(o.publishedAt) || 'yes') : '';
  const l = isObj(o.locks) ? o.locks : { junior: old, senior: old };
  const locks = { junior: str(l.junior), senior: str(l.senior) };
  const both = !!(locks.junior && locks.senior);
  return { ...o, locks, status: both ? 'published' : 'draft', publishedAt: both ? (str(o.publishedAt) || locks.junior) : '' };
}
export const isMonthLocked = (state, m, pool = viewOf(state)) => !!(state && state.months && state.months[m] && monthMeta(state.months[m]).locks[pool]);
export function setMonthLocked(draft, m, locked, pool = viewOf(draft)) {
  if (!draft.months || typeof draft.months !== 'object') draft.months = {};
  const v = monthMeta(draft.months[m]);
  const at = new Date().toISOString();
  for (const k of pool === 'both' ? RULE_POOLS : [pool]) v.locks[k] = locked ? at : '';
  draft.months[m] = monthMeta({ ...v, status: 'draft', publishedAt: '' });
}
export const POOL_LABEL = { junior: 'junior roster', senior: 'senior roster' };

// Which roster a person belongs to: a move by hand (p.pool) wins, then the pool tags, else their section (junior
// sections are the junior pool).
export function poolOf(state, p) {
  if (p && (p.pool === 'junior' || p.pool === 'senior')) return p.pool;
  return autoPoolOf(state, p);
}
// The pool without the move by hand (shown as "Automatic" in the person editor).
export function autoPoolOf(state, p) {
  const t = (p && p.tags) || [];
  if (t.includes('jpool')) return 'junior';
  if (t.includes('spool')) return 'senior';
  const g = ((state && state.groups) || []).find(x => x.id === (p && p.group));
  return g && g.kind === 'junior' ? 'junior' : 'senior';
}
// staffInMonth narrowed by the pool switch at the top of the app (settings.pool: all, junior, senior).
export function staffInView(state, m) {
  const pool = (state.settings && state.settings.pool) || 'all';
  const all = staffInMonth(state, m);
  return pool === 'all' ? all : all.filter(p => poolOf(state, p) === pool);
}
