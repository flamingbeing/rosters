// NUH Junior Monthly: the data model. State shape, defaults, local-date helpers, cell helpers and code tokens.
// Plain functions over plain data (see SPEC.md "State"). No DOM, so node tests and the solver worker can use it.

export const STORE_KEY = 'nuhjm-v1';
export const DEMO_KEY = 'nuhjm-demo';

// ---------- defaults ----------

// Sheet order: the grade column of the department's monthly junior roster sheet ("1 - 30 Nov 26 Request"), top to
// bottom. `grades` are the texts in the sheet's Grade column that belong to the group (import matches them).
export const DEFAULT_GROUPS = [
  { id: 'ac', name: 'Associate consultants (AC)', kind: 'senior', grades: ['AC'] },
  { id: 'r', name: 'Senior residents (R)', kind: 'junior', grades: ['R', 'SR'] },
  { id: 'res3', name: 'Residents year 3 (RES3)', kind: 'junior', grades: ['RES3'] },
  { id: 'res2', name: 'Residents year 2 (RES2)', kind: 'junior', grades: ['RES2'] },
  { id: 'res1', name: 'Residents year 1 (RES1)', kind: 'junior', grades: ['RES1'] },
  { id: 'nhg', name: 'NHG cardiac residents (NHG)', kind: 'junior', grades: ['NHG'] },
  { id: 'rp', name: 'Resident physicians (RP)', kind: 'junior', grades: ['RP', 'HC'] },
  { id: 'loc', name: 'Locums (LOC)', kind: 'junior', grades: ['LOC', 'LOCUM'] },
  { id: 'mopex', name: 'MOPEX', kind: 'junior', grades: ['MOPEX'] },
  { id: 'rr', name: 'Rotating residents (RR)', kind: 'junior', grades: ['RR'] },
  { id: 'fellow', name: 'Fellows', kind: 'junior', grades: ['FELLOW'] },
];

export const DEFAULT_TAGS = [
  { id: 'babymo', name: 'Baby MO', help: 'New MO: first month, no leave, never alone' },
  { id: 'mo1', name: 'MO1 call level', help: 'Does R1 (MO1) calls' },
  { id: 'mo2', name: 'MO2 call level', help: 'Does R2 (MO2) calls' },
  { id: 'mo3', name: 'MO3 call level', help: 'Does R3 (MO3) calls' },
  { id: 'fsscap', name: 'Fri to Sun call cap', help: 'At most 2 calls on a Friday, Saturday or Sunday a month (the R1 to R3 rosterer sets this for one person)' },
  { id: 'mo1s', name: 'Strong MO1', help: 'MO1 pool: strong (from the manpower master list)' },
  { id: 'mo1w', name: 'Weak MO1', help: 'MO1 pool: weak (from the manpower master list)' },
  { id: 'mo2s', name: 'Strong MO2', help: 'MO2 pool: strong (from the manpower master list)' },
  { id: 'mo2w', name: 'Weak MO2', help: 'MO2 pool: weak (from the manpower master list)' },
  { id: 'mo3s', name: 'Strong MO3', help: 'MO3 pool: strong (from the manpower master list)' },
  { id: 'mo3w', name: 'Weak MO3', help: 'MO3 pool: weak (from the manpower master list)' },
  { id: 'icunew', name: 'New to ICU', help: 'First time in ICU: ICU calls from day 4 of the posting' },
  { id: 'rrlate', name: 'Ortho / HRM resident', help: 'Rotating resident from Ortho or HRM: ICU calls from day 8' },
  { id: 'supernum', name: 'Supernumerary in ICU', help: 'In ICU without calls (MOPEX new to ICU, hospital clinicians, a fellow\'s first month)' },
];

const duty = (code, name, kind, color, ink, extra = {}) =>
  ({ code, name, kind, color, ink, overnight: false, auto: false, hours: 0, ...extra });
const shift = (code, name, color, extra) => duty(code, name, 'shift', color, '#fff', { hours: 8, ...extra });
const call = (code, name, color, extra) => shift(code, name, color, { overnight: true, hours: 24, ...extra });
const posting = (code, name, color, ink = '#1f2937') => duty(code, name, 'posting', color, ink, { hours: 8 });
const leave = (code, name, color = '#fde2e4') => duty(code, name, 'leave', color, '#7a1c27');
const request = (code, name) => duty(code, name, 'request', '#0b5394', '#fff');   // UI draws requests as outlined chips
const other = (code, name) => duty(code, name, 'other', '#e0e0e0', '#333');

// The codes on the department's sheet (its legend and two years of rosters). Postings are planned by the week
// (Postings tab); calls are what the app fills; PC (post call) and PPC (the day off after an ICU post call) are worked
// out, never typed.
const BASE_DUTIES = [
  call('C3', 'Cardiac call', '#b71c1c', { auto: true }),
  call('R1B', 'ICU call (SICU)', '#0d47a1', { auto: true, rest2: true }),
  call('R1', 'MO1 call', '#c62828', { auto: true }),
  call('R2', 'MO2 call', '#ad1457', { auto: true }),
  call('R3', 'MO3 call', '#6a1b9a', { auto: true }),
  call('S1', 'Registrar call (S1)', '#4e342e'),
  call('S1B', 'Stay-in S1 (S1B)', '#5d4037'),
  call('OGC', 'Obstetric call', '#00695c'),
  call('OGN', 'Obstetric night float', '#00796b'),
  shift('OGD', 'Obstetric day float', '#26a69a'),
  shift('WR', 'Saturday APS ward round', '#558b2f', { hours: 4 }),
  shift('P1', 'Premed 1 (Sunday)', '#827717', { hours: 4 }),
  shift('P2', 'Premed 2 (Sunday)', '#827717', { hours: 4 }),
  shift('P3', 'Premed 3 (Sunday)', '#827717', { hours: 4 }),
  shift('P4', 'Premed 4 (Sunday)', '#827717', { hours: 4 }),
  shift('P5', 'Premed 5 (Sunday)', '#827717', { hours: 4 }),
  shift('P6', 'Premed 6 (Sunday)', '#827717', { hours: 4 }),
  shift('P', 'Premed duty', '#827717', { hours: 4 }),
  shift('AHC', 'Alexandra Hospital call', '#4527a0'),
  posting('C', 'Cardiac', '#ffcdd2'),
  posting('C-e', 'Cardiac echo week', '#f8bbd0'),
  posting('C-p', 'Cardiac perfusion week', '#f8bbd0'),
  posting('ICU', 'Surgical ICU', '#bbdefb'),
  posting('CP', 'Chronic pain', '#dcedc8'),
  posting('AP', 'Acute pain (APS)', '#c5e1a5'),
  posting('OG1', 'Obstetrics 1', '#b2dfdb'),
  posting('OG2', 'Obstetrics 2', '#b2dfdb'),
  posting('LI', 'Liver transplant', '#ffe0b2'),
  posting('LivOT', 'Liver transplant OT', '#ffcc80'),
  posting('AH', 'Alexandra Hospital', '#e1bee7'),
  posting('AH1', 'Alexandra Hospital 1', '#e1bee7'),
  posting('AH2', 'Alexandra Hospital 2', '#e1bee7'),
  posting('AH3', 'Alexandra Hospital 3', '#e1bee7'),
  posting('KKH', 'Out: KKH', '#d7ccc8'),
  posting('TTSH', 'Out: TTSH', '#d7ccc8'),
  posting('NTF', 'Out: NTFGH', '#d7ccc8'),
  leave('AL', 'Annual leave', '#f8c9cf'),
  leave('SL', 'Study leave'),
  leave('TL', 'Training leave'),
  leave('MC', 'Medical leave'),
  leave('ML', 'Maternity leave'),
  leave('PL', 'Paternity leave'),
  leave('HL', 'Hospitalisation leave'),
  leave('FCL', 'Family care leave'),
  leave('CCL', 'Childcare leave'),
  leave('NS', 'NS (reservist)'),
  leave('0.5', 'Half day leave'),
  request('X', 'No call'),
  request('X!', 'No call: must have (e.g. going on holiday)'),
  request('X?', 'No call: nice to have (e.g. clearing leave)'),
  request('XX', 'Call blocked by the planner'),
  request('NP', 'No premed'),
  request('R', 'Call request'),
  request('R!', 'Call request: must have (e.g. needs the call money)'),
  request('R?', 'Call request: nice to have'),
  other('Z', 'Not on the roster'),
  other('Adm', 'Admin day'),
  other('Pain', 'Pain clinic'),
  other('RD', 'Rest day'),
  other('Exam', 'Exam'),
  other('PC', 'Post call (carried over from last month)'),
  other('PPC', 'Day off after ICU post call (carried over)'),
  duty('x', 'Post call (PC)', 'derived', '#eeeeee', '#555'),
];

// Colours follow the department sheet's legend (owner, 16 Oct 2026), so people who work on both read the same colours:
// calls orange, obstetric calls red, cardiac magenta, ICU yellow, chronic pain green, acute pain bright green, liver
// transplant purple, leave blue, premed duty peach, post call and "not on the roster" grey, blocked requests red, call
// requests blue, postings away from NUH and the obstetric / Alexandra postings plain. Softened a little, the same hues.
// BASE_DUTIES above holds the colours before that change: a saved duty still in its old colours is brought across once
// (updateRules); one the rosterer changed is left alone.
const CALL_OR = ['#bf5600', '#ffffff'], PEACH = ['#ffdfc2', '#4d2b08'], LEAVE = ['#aecbfa', '#0b2a66'], PLAIN = ['#f1f3f6', '#1f2937'], GREY = ['#d5d8de', '#1f2937'], RED_REQ = ['#c62828', '#ffffff'], BLUE_REQ = ['#1f5fd0', '#ffffff'];
const PALETTE = {
  ...Object.fromEntries(['C3', 'R1B', 'R1', 'R2', 'R3', 'S1', 'S1B', 'OGC', 'AHC'].map(c => [c, CALL_OR])),
  OGN: ['#b71c1c', '#ffffff'], OGD: ['#b71c1c', '#ffffff'],
  ...Object.fromEntries(['WR', 'P', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map(c => [c, PEACH])),
  C: ['#f8c2f4', '#1f2937'], 'C-e': ['#fce4fa', '#1f2937'], 'C-p': ['#fce4fa', '#1f2937'],
  ICU: ['#fff59d', '#1f2937'], CP: ['#a5d6a7', '#1f2937'], AP: ['#c8f7c5', '#1f2937'],
  LI: ['#e1c8ff', '#1f2937'], LivOT: ['#f1e8ff', '#1f2937'],
  ...Object.fromEntries(['OG1', 'OG2', 'AH', 'AH1', 'AH2', 'AH3', 'KKH', 'TTSH'].map(c => [c, PLAIN])), NTF: GREY,
  ...Object.fromEntries(['AL', 'SL', 'TL', 'MC', 'ML', 'PL', 'HL', 'FCL', 'CCL', 'NS', '0.5'].map(c => [c, LEAVE])),
  ...Object.fromEntries(['X', 'X!', 'X?', 'XX', 'NP'].map(c => [c, RED_REQ])),
  ...Object.fromEntries(['R', 'R!', 'R?'].map(c => [c, BLUE_REQ])),
  Z: GREY, PC: GREY, PPC: GREY, x: ['#e3e5e9', '#444b57'],
};
export const DEFAULT_DUTIES = BASE_DUTIES.map(d => (PALETTE[d.code] ? { ...d, color: PALETTE[d.code][0], ink: PALETTE[d.code][1] } : d));

// Default rules live here (data only) so defaultState() needs no import from rules.js (no circular import);
// rules.js re-exports them as DEFAULT_RULES. Cardiac and ICU are on; the rest are predictions from the department's
// roster guide and past rosters, some off until the rosterer confirms them. The rosterer tunes them in the app.
// every group except RES3 and senior residents (R): the day-1 cardiac call rule is for the others
const C3_D1_GROUPS = ['ac', 'res2', 'res1', 'nhg', 'rp', 'loc', 'mopex', 'rr', 'fellow'];
// the rules that make the R1 to R3 calls work (Rules tab: "Turn on all the R1 to R3 rules"; Fill turns them on when R1 to R3 are ticked)
export const R13_RULE = /^r-(r1|r2|r3)-|^r-mo-|^r-fair$|^r-gap$/;
// The calls Fill drafts (the Fill dialog's ticks, kept on the device): cardiac and ICU until the rosterer ticks R1 to R3.
// Check's "only what Fill places" filter reads the same list.
export function fillCodes(state) {
  const all = (state.duties || []).filter(d => d.auto && d.kind === 'shift').map(d => d.code);
  let chosen = all.filter(c => !['R1', 'R2', 'R3'].includes(c));
  if (!chosen.length) chosen = all.slice();
  try {
    const saved = JSON.parse(localStorage.getItem('nuhjm-af-codes') || 'null');
    if (Array.isArray(saved)) { const keep = all.filter(c => saved.includes(c)); if (keep.length) chosen = keep; }
  } catch (e) { /* no saved choice */ }
  return chosen;
}
export const CALLS = ['R1', 'R2', 'R3', 'S1', 'S1B', 'R1B', 'C3', 'OGC', 'OGN'];
const R = (id, type, name, params, o = {}) => ({
  id, type, name, enabled: o.enabled !== false, hard: o.hard !== false, weight: o.weight ?? 10,
  who: { groups: [], tags: [], staff: [], exclude: [], ...(o.who || {}) },
  when: { from: '', to: '', days: [], holidays: 'any', ...(o.when || {}) },
  params, note: o.note || '',
});
const soft = (weight, more = {}) => ({ hard: false, weight, ...more });
const PREDICTED = 'Predicted from the roster guide: confirm or change.';
export const DEFAULT_RULES = [
  // cardiac (C3): seen on every night of 2025 and 2026
  R('r-c3-cover', 'cover', 'One cardiac call every night', { codes: ['C3'], min: 1, max: 1 }),
  R('r-c3-onc', 'sameDay', 'Cardiac call only on a cardiac day', { codesA: ['C3'], codesB: ['C', 'C-e', 'C-p'], mode: 'require' }),
  R('r-c3-echo', 'sameDay', 'Avoid cardiac calls in echo or perfusion weeks', { codesA: ['C3'], codesB: ['C-e', 'C-p'], mode: 'forbid' }, soft(30, { note: 'Real rosters: now and then, when the cardiac team is short.' })),
  R('r-c3-next', 'sequence', 'Post call falls inside the cardiac posting', { ifCodes: ['C3'], thenCodes: ['C', 'C-e', 'C-p'], mode: 'require', from: 1, to: 1 }, soft(40)),
  R('r-c3-gap', 'sequence', 'No cardiac call the day after a cardiac call (post call)', { ifCodes: ['C3'], thenCodes: ['C3'], mode: 'forbid', from: 1, to: 1 }),
  // an EOD call (a call right after the post call day) is the last resort when a night would otherwise be empty (owner, 16 Oct 2026)
  R('r-c3-eod', 'sequence', 'No EOD cardiac call (2 days after a cardiac call): only to cover a night', { ifCodes: ['C3'], thenCodes: ['C3'], mode: 'forbid', from: 2, to: 2 }, soft(500, { note: 'EOD call: a call right after the post call day. Used only when no one else can cover the night.' })),
  R('r-c3-d1', 'postingStart', 'No cardiac call on day 1 of the posting', { codes: ['C3'], posting: 'C', days: 1 }, soft(20, { who: { onlyGroups: C3_D1_GROUPS }, note: 'Not for RES3 and senior residents, who may take a call on day 1 (owner, 16 Oct 2026).' })),
  R('r-c3-fair', 'spread', 'Share cardiac calls fairly', { codes: ['C3'], period: 'month', scheme: 'offdays', offBonus: 0.5, eveBonus: 0.5, weekendWeight: 2, holidayWeight: 1.5, tolerance: 1, among: ['C'], carry: 0.5, carryMonths: 4, alert: 1, alertPct: 40 }, soft(40, { note: 'Echo and perfusion weeks (C-e, C-p) take no calls, so they do not count towards the share (owner, 16 Oct 2026).' })),
  R('r-c3-sat', 'limit', 'At most 1 Saturday cardiac call a month', { codes: ['C3'], period: 'month', window: 7, min: null, max: 1, fte: false, prorate: false }, soft(20, { when: { days: [6] } })),
  // ICU (R1B): call, post call, a day off (PPC), back to ICU
  R('r-r1b-cover', 'cover', 'One ICU call every night', { codes: ['R1B'], min: 1, max: 1 }),
  R('r-r1b-on', 'sameDay', 'ICU call only on an ICU day', { codesA: ['R1B'], codesB: ['ICU'], mode: 'require' }),
  R('r-r1b-next', 'sequence', 'Post call falls inside the ICU posting', { ifCodes: ['R1B'], thenCodes: ['ICU'], mode: 'require', from: 1, to: 1 }, soft(40)),
  R('r-r1b-gap', 'sequence', 'No ICU call on the post call day', { ifCodes: ['R1B'], thenCodes: ['R1B'], mode: 'forbid', from: 1, to: 1 }),
  R('r-r1b-gap4', 'sequence', 'An ICU day between the day off and the next call', { ifCodes: ['R1B'], thenCodes: ['R1B'], mode: 'forbid', from: 3, to: 3 }, soft(15)),
  // a call on the first day of ICU is the last resort for covering a night (real rosters: 4 times in 2 years, at a rotation change)
  R('r-r1b-d1', 'postingStart', 'No ICU call on day 1 in ICU: only to cover a night', { codes: ['R1B'], posting: 'ICU', days: 1 }, soft(400, { note: 'Used only when no one else can cover the night.' })),
  // strict only for non-anaesthesia residents (rotating residents) and MOPEXes; anaesthesia residents new to ICU: a preference (owner, 16 Oct 2026)
  R('r-r1b-new', 'postingStart', 'New to ICU: calls from day 4 (rotating residents, MOPEX)', { codes: ['R1B'], posting: 'ICU', days: 3 }, { who: { tags: ['icunew'], onlyGroups: ['rr', 'mopex'] } }),
  R('r-r1b-new-res', 'postingStart', 'New to ICU: calls from day 4 (anaesthesia residents)', { codes: ['R1B'], posting: 'ICU', days: 3 }, soft(30, { who: { tags: ['icunew'], onlyGroups: ['r', 'res3', 'res2', 'res1', 'nhg', 'rp', 'loc', 'fellow'] } })),
  R('r-r1b-rr', 'postingStart', 'Ortho / HRM residents: ICU calls from day 8', { codes: ['R1B'], posting: 'ICU', days: 7 }, soft(40, { who: { tags: ['rrlate'] }, note: 'SICU rules: day 4 or 5 when manpower is short, never a weekend first call.' })),
  R('r-r1b-super', 'limit', 'Supernumerary: no ICU calls', { codes: ['R1B'], period: 'month', window: 7, min: null, max: 0, fte: false, prorate: false }, { who: { tags: ['supernum'] } }),
  R('r-r1b-fellow', 'limit', 'Fellows: at most 2 weekend ICU calls a month', { codes: ['R1B'], period: 'month', window: 7, min: null, max: 2, fte: false, prorate: false }, soft(30, { who: { groups: ['fellow'] }, when: { days: [0, 6] } })),
  R('r-r1b-fair', 'spread', 'Share ICU calls fairly', { codes: ['R1B'], period: 'month', scheme: 'offdays', offBonus: 0.5, eveBonus: 0.5, weekendWeight: 2, holidayWeight: 1.5, tolerance: 1, among: ['ICU'], carry: 0.5, carryMonths: 4, alert: 1, alertPct: 40 }, soft(40)),
  R('r-r1b-sat', 'limit', 'At most 2 Saturday ICU calls a month', { codes: ['R1B'], period: 'month', window: 7, min: null, max: 2, fte: false, prorate: false }, soft(20, { when: { days: [6] } })),
  // everyone
  // screening the requests before the app assigns R1 to R3 (the R1 to R3 rosterer's rules, 16 Oct 2026). X/NP is one request, not two. The pool
  // rules stay off until the strong / weak list is imported (More > People > Tags), then the import turns them on.
  R('r-req-load', 'limit', 'At most 4 requests a month (call requests, X, NP; X/NP counts once)', { codes: ['R', 'R!', 'R?', 'X', 'X!', 'X?', 'NP'], period: 'month', window: 7, min: null, max: 4, fte: false, prorate: false }, soft(5)),
  R('r-req-npload', 'limit', 'At most 2 no-premed requests a month', { codes: ['NP'], period: 'month', window: 7, min: null, max: 2, fte: false, prorate: false }, soft(5, { note: 'Premed duties (P1 to P6) are not counted yet: they are not on the sheet until the premed roster is planned.' })),
  R('r-pool-1', 'cover', 'One call request a day from the MO1 pool (strong and weak)', { codes: ['R', 'R!', 'R?'], min: null, max: 1 }, soft(5, { who: { tags: ['mo1s', 'mo1w'] }, enabled: false })),
  R('r-pool-2', 'cover', 'One call request a day from the MO2 pool (strong and weak)', { codes: ['R', 'R!', 'R?'], min: null, max: 1 }, soft(5, { who: { tags: ['mo2s', 'mo2w'] }, enabled: false })),
  R('r-pool-3', 'cover', 'One call request a day from strong MO2 and weak MO3', { codes: ['R', 'R!', 'R?'], min: null, max: 1 }, soft(5, { who: { tags: ['mo2s', 'mo3w'] }, enabled: false })),
  // the R1 to R3 rosterer's rules (16 Oct 2026). Off with the other R1 to R3 rules until the rosterer turns the group on (Rules tab).
  R('r-mo-nogo', 'sameDay', 'No R1 to R3 call on a posting, obstetric call or rest day', { codesA: ['OGN', 'OGD', 'OGC', 'TTSH', 'NTF', 'KKH', 'LI', 'C', 'C3', 'C-e', 'C-p', 'AP', 'CP', 'WR', 'RD'], codesB: ['R1', 'R2', 'R3'], mode: 'forbid' }, { enabled: false, note: 'From the R1 to R3 rosterer, 16 Oct 2026. ' }),
  R('r-mo-weak', 'cover', 'At most one weak MO on the R1, R2 and R3 calls of a night', { codes: ['R1', 'R2', 'R3'], min: null, max: 1 }, soft(60, { who: { tags: ['mo1w', 'mo2w', 'mo3w'] }, enabled: false, note: 'From the R1 to R3 rosterer, 16 Oct 2026. A weak R1 gets a strong R2 and R3, a weak R2 a strong R1 and R3, a weak R3 a strong R1 and R2. Needs the strong / weak list (People > Tags).' })),
  R('r-mo-satfri', 'sequence', 'No Friday call the week after a Saturday call', { ifCodes: ['R1', 'R2', 'R3'], thenCodes: ['R1', 'R2', 'R3'], mode: 'forbid', from: 6, to: 6 }, soft(10, { when: { days: [6] }, enabled: false, note: 'From the R1 to R3 rosterer, 16 Oct 2026. ' })),
  R('r-mo-icusat1', 'sequence', 'No Saturday R1 to R3 call the day after, or two days after, an ICU call (Thu, Fri)', { ifCodes: ['R1B'], thenCodes: ['R1', 'R2', 'R3'], mode: 'forbid', from: 1, to: 2, thenDay: '6' }, soft(30, { enabled: false, note: 'From the R1 to R3 rosterer, 16 Oct 2026: no Saturday call after ICU on the previous Thursday, Friday, Saturday or Sunday. This one covers the Thursday and Friday before.' })),
  R('r-mo-icusat2', 'sequence', 'No Saturday R1 to R3 call six or seven days after an ICU call (Sun, Sat)', { ifCodes: ['R1B'], thenCodes: ['R1', 'R2', 'R3'], mode: 'forbid', from: 6, to: 7, thenDay: '6' }, soft(30, { enabled: false, note: 'The Sunday and Saturday of the week before (see the rule above).' })),
  R('r-mo-fss', 'limit', 'At most 2 Friday, Saturday or Sunday calls a month for people tagged "Fri to Sun call cap"', { codes: CALLS, period: 'month', window: 7, min: null, max: 2, fte: false, prorate: false }, soft(40, { who: { tags: ['fsscap'] }, when: { days: [0, 5, 6] }, enabled: false, note: 'From the R1 to R3 rosterer, 16 Oct 2026. Tick the tag on the person it applies to (People > Staff).' })),
  R('r-mo-pool-r1', 'requests', 'A call request (R) from the MO1 pool gets R1', { request: 'R', codes: ['R1'], mode: 'want', span: 'day' }, soft(10, { who: { tags: ['mo1s', 'mo1w'] }, enabled: false, note: 'From the R1 to R3 rosterer, 16 Oct 2026. Needs the strong / weak list (People > Tags).' })),
  R('r-mo-pool-rh1', 'requests', 'A must-have call request (R!) from the MO1 pool gets R1', { request: 'R!', codes: ['R1'], mode: 'want', span: 'day' }, soft(60, { who: { tags: ['mo1s', 'mo1w'] }, enabled: false, note: 'As the rule above, for R!.' })),
  R('r-mo-pool-r2', 'requests', 'A call request (R) from the MO2 pool gets R2', { request: 'R', codes: ['R2'], mode: 'want', span: 'day' }, soft(10, { who: { tags: ['mo2s', 'mo2w'] }, enabled: false, note: 'From the R1 to R3 rosterer, 16 Oct 2026. Needs the strong / weak list (People > Tags).' })),
  R('r-mo-pool-rh2', 'requests', 'A must-have call request (R!) from the MO2 pool gets R2', { request: 'R!', codes: ['R2'], mode: 'want', span: 'day' }, soft(60, { who: { tags: ['mo2s', 'mo2w'] }, enabled: false, note: 'As the rule above, for R!.' })),
  R('r-mo-pool-r3', 'requests', 'A call request (R) from the MO3 pool gets R3', { request: 'R', codes: ['R3'], mode: 'want', span: 'day' }, soft(10, { who: { tags: ['mo3s', 'mo3w'] }, enabled: false, note: 'From the R1 to R3 rosterer, 16 Oct 2026. Needs the strong / weak list (People > Tags).' })),
  R('r-mo-pool-rh3', 'requests', 'A must-have call request (R!) from the MO3 pool gets R3', { request: 'R!', codes: ['R3'], mode: 'want', span: 'day' }, soft(60, { who: { tags: ['mo3s', 'mo3w'] }, enabled: false, note: 'As the rule above, for R!.' })),
  R('r-mo-res', 'limit', 'Residents: 3 to 5 R1 to R3 calls a month', { codes: ['R1', 'R2', 'R3'], period: 'month', window: 7, min: 3, max: 5, fte: false, prorate: false }, soft(20, { who: { groups: ['res1', 'res2', 'res3'] }, enabled: false, note: 'From the R1 to R3 rosterer, 16 Oct 2026. ' })),
  R('r-mo-fellow', 'limit', 'Fellows: 1 to 2 R1 to R3 calls a month', { codes: ['R1', 'R2', 'R3'], period: 'month', window: 7, min: 1, max: 2, fte: false, prorate: false }, soft(20, { who: { groups: ['fellow'] }, enabled: false, note: 'From the R1 to R3 rosterer, 16 Oct 2026. ' })),
  R('r-mo-mopex', 'limit', 'MOPEX: 1 R1 to R3 call a month', { codes: ['R1', 'R2', 'R3'], period: 'month', window: 7, min: 1, max: 1, fte: false, prorate: false }, soft(20, { who: { groups: ['mopex'] }, enabled: false, note: 'From the R1 to R3 rosterer, 16 Oct 2026. ' })),
  R('r-leave', 'sameDay', 'No calls on leave', { codesA: ['@leave'], codesB: ['@shift'], mode: 'forbid' }),
  R('r-postcall', 'sameDay', 'Post call is a day off', { codesA: ['x', 'PC'], codesB: ['@shift'], mode: 'forbid' }),
  R('r-ppc', 'sameDay', 'No EOD call: nothing on the day off after an ICU post call (PPC), unless a night would be empty', { codesA: ['PPC'], codesB: ['@shift'], mode: 'forbid' }, soft(500, { note: 'EOD call: a call right after the post call day. Used only when no one else can cover the night.' })),
  R('r-notroster', 'sameDay', 'No calls when not on the roster (Z)', { codesA: ['Z'], codesB: ['@shift'], mode: 'forbid' }),
  R('r-preleave', 'sequence', 'No post call into leave', { ifCodes: CALLS, thenCodes: ['@leave'], mode: 'forbid', from: 1, to: 1 }, soft(50, { note: PREDICTED })),
  // call requests and blocks are softer than the rules above: kept when there is room, given up first when a night would be empty (owner, 16 Oct 2026)
  R('r-req-x', 'requests', 'No call when asked (X)', { request: 'X', codes: CALLS, mode: 'avoid', span: 'day' }, soft(60)),
  R('r-req-xh', 'requests', 'No call, must have (X!)', { request: 'X!', codes: CALLS, mode: 'avoid', span: 'day' }, soft(150)),
  R('r-req-xl', 'requests', 'No call, nice to have (X?)', { request: 'X?', codes: CALLS, mode: 'avoid', span: 'day' }, soft(20)),
  R('r-req-xx', 'requests', 'No call when blocked by the planner', { request: 'XX', codes: CALLS, mode: 'avoid', span: 'day' }, soft(200)),
  R('r-req-r', 'requests', 'Call when asked (R)', { request: 'R', codes: CALLS, mode: 'want', span: 'day' }, soft(10)),
  R('r-req-rh', 'requests', 'Call when asked, must have (R!)', { request: 'R!', codes: CALLS, mode: 'want', span: 'day' }, soft(100)),
  R('r-req-rl', 'requests', 'Call when asked, nice to have (R?)', { request: 'R?', codes: CALLS, mode: 'want', span: 'day' }, soft(3)),
  R('r-req-np', 'requests', 'No premed when asked (NP)', { request: 'NP', codes: ['P', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'], mode: 'avoid', span: 'day' }, soft(30)),
  R('r-sat2', 'limit', 'At most 2 Saturday calls a month', { codes: CALLS, period: 'month', window: 7, min: null, max: 2, fte: false, prorate: false }, soft(20, { when: { days: [6] }, note: PREDICTED })),
  R('r-sat-run', 'sequence', 'No Saturday calls two weeks running', { ifCodes: CALLS, thenCodes: CALLS, mode: 'forbid', from: 7, to: 7 }, soft(30, { when: { days: [6] }, note: 'MedHub (the guide\'s first rule). ' + PREDICTED })),
  R('r-sun-fri', 'sequence', 'MedHub: no Fri or Sat call after a Sunday call', { ifCodes: CALLS, thenCodes: CALLS, mode: 'forbid', from: 5, to: 6 }, soft(2, { when: { days: [0] }, note: 'The guide: very hard to keep; real rosters break it often (1 in 3 cardiac calls). ' + PREDICTED })),
  R('r-livot', 'sameDay', 'Avoid calls in liver transplant OT week', { codesA: ['LivOT'], codesB: CALLS, mode: 'forbid' }, soft(5, { note: PREDICTED })),
  R('r-og-eod', 'sequence', 'No every-other-day obstetric calls', { ifCodes: ['OGC'], thenCodes: ['OGC'], mode: 'forbid', from: 2, to: 2 }, soft(30, { note: PREDICTED })),
  R('r-nocalls', 'noCallsUntil', 'No calls before the date set on the person', { codes: CALLS }),
  R('r-baby', 'limit', 'Baby MOs: no calls', { codes: CALLS, period: 'month', window: 7, min: null, max: 0, fte: false, prorate: false }, soft(50, { who: { tags: ['babymo'] }, enabled: false, note: PREDICTED })),
  // the main calls (off until the rosterer starts filling them in the app)
  R('r-r1-cover', 'cover', 'One MO1 call (R1) every night', { codes: ['R1'], min: 1, max: 1 }, { enabled: false, note: PREDICTED }),
  R('r-r2-cover', 'cover', 'One MO2 call (R2) every night', { codes: ['R2'], min: 1, max: 1 }, { enabled: false, note: PREDICTED }),
  R('r-r3-cover', 'cover', 'One MO3 call (R3) every night', { codes: ['R3'], min: 1, max: 1 }, { enabled: false, note: PREDICTED }),
  R('r-r1-who', 'eligible', 'R1 only for MO1s', { codes: ['R1'] }, { who: { tags: ['mo1'] }, enabled: false, note: PREDICTED }),
  R('r-r2-who', 'eligible', 'R2 for MO1s and MO2s', { codes: ['R2'] }, { who: { tags: ['mo1', 'mo2'] }, enabled: false, note: PREDICTED }),
  R('r-r3-who', 'eligible', 'R3 for MO2s and MO3s', { codes: ['R3'] }, { who: { tags: ['mo2', 'mo3'] }, enabled: false, note: PREDICTED }),
  R('r-gap', 'sequence', 'No calls on consecutive or alternate days', { ifCodes: ['R1', 'R2', 'R3'], thenCodes: CALLS, mode: 'forbid', from: 1, to: 2 }, soft(30, { enabled: false, note: PREDICTED })),
  R('r-fair', 'spread', 'Share R1 to R3 calls fairly', { codes: ['R1', 'R2', 'R3'], period: 'month', scheme: 'offdays', offBonus: 0.5, eveBonus: 0.5, weekendWeight: 2, holidayWeight: 1.5, tolerance: 1, alert: 1, alertPct: 40, byGroup: 'yes' }, soft(5, { enabled: false, note: PREDICTED })),
];

const clone = o => JSON.parse(JSON.stringify(o));

export function defaultState() {
  return migrate({
    v: 1,
    settings: { dept: 'NUH Department of Anaesthesia', holidays: {} },
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
export const DUTY_KINDS = ['shift', 'posting', 'leave', 'request', 'other', 'derived'];
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
  out.overnight = !!out.overnight; out.auto = !!out.auto; out.rest2 = !!out.rest2;
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
  };
}
// One-time updates to rules that were already saved (the owner's rulings of 16 Oct 2026): requests and blocks become
// preferences, "new to ICU" is strict only for rotating residents and MOPEXes. Only a rule still in its old form changes.
function updateRules(s) {
  if ((s.rulesVersion || 1) >= 20) return;
  const from2 = (s.rulesVersion || 1) < 2;
  s.rulesVersion = 20;
  const find = id => s.rules.find(r => r.id === id);
  if (from2) for (const [id, w] of [['r-req-x', 60], ['r-req-xx', 80]]) { const r = find(id); if (r && r.hard) { r.hard = false; r.weight = w; } }
  const n = from2 && find('r-r1b-new');
  if (n && !(n.who && n.who.onlyGroups) && n.who && n.who.tags.length === 1 && n.who.tags[0] === 'icunew' && !n.who.groups.length) {
    n.who.onlyGroups = ['rr', 'mopex'];
    n.name = 'New to ICU: calls from day 4 (rotating residents, MOPEX)';
    if (!find('r-r1b-new-res')) s.rules.push(cleanRule(clone(DEFAULT_RULES.find(r => r.id === 'r-r1b-new-res'))));
  }
  // EOD calls (owner, 16 Oct 2026): the day off after an ICU post call and the 3-day cardiac gap give way, as a last resort,
  // to covering a night; the post call day itself never does
  const add = id => { if (!find(id)) s.rules.push(cleanRule(clone(DEFAULT_RULES.find(r => r.id === id)))); };
  const pc = find('r-postcall');
  if (pc && pc.params && Array.isArray(pc.params.codesA) && pc.params.codesA.includes('PPC')) { pc.params.codesA = pc.params.codesA.filter(c => c !== 'PPC'); add('r-ppc'); }
  const d1 = find('r-r1b-d1');
  if (d1 && d1.hard && d1.params && +d1.params.days === 1) { d1.hard = false; d1.weight = 400; d1.name = 'No ICU call on day 1 in ICU: only to cover a night'; }
  const g1 = find('r-r1b-gap');
  if (g1 && g1.params && +g1.params.from === 1 && +g1.params.to === 2) g1.params.to = 1;
  const g3 = find('r-c3-gap');
  if (g3 && g3.params && +g3.params.from === 1 && +g3.params.to === 2) { g3.params.to = 1; add('r-c3-eod'); }
  // request importance (owner, 16 Oct 2026): X! must have, X? nice to have, next to X
  for (const code of ['X!', 'X?', 'R!', 'R?']) {
    if (!(s.duties || []).some(d => d.code === code)) {
      const at = (s.duties || []).findIndex(d => d.code === code[0]);
      const du = cleanDuty(clone(DEFAULT_DUTIES.find(d => d.code === code)));
      if (at >= 0) s.duties.splice(at + 1, 0, du); else s.duties.push(du);
    }
  }
  add('r-req-xh'); add('r-req-xl'); add('r-req-rh'); add('r-req-rl');
  // an equal number of calls matters more (owner, 16 Oct 2026): the fairness rules go from 10 to 40 unless already changed
  for (const id of ['r-c3-fair', 'r-r1b-fair']) { const f = find(id); if (f && !f.hard && Number(f.weight) === 10) f.weight = 40; }
  // the rosterer's points for a shared call (Fri 1.5, Sat 2, Sun 1.5, a public holiday 1.5 or 2), and echo / perfusion weeks do not
  // count as cardiac days for the share (owner, 16 Oct 2026); only rules still in their old form change
  for (const id of ['r-c3-fair', 'r-r1b-fair', 'r-fair']) {
    const f = find(id);
    if (f && f.params && !f.params.scheme) { f.params.scheme = 'offdays'; f.params.offBonus = 0.5; f.params.eveBonus = 0.5; }
  }
  const cf = find('r-c3-fair');
  if (cf && cf.params && Array.isArray(cf.params.among) && cf.params.among.join() === 'C,C-e,C-p') cf.params.among = ['C'];
  // "no calls until" a date set on a person (owner, 16 Oct 2026)
  add('r-nocalls');
  // blocked by the planner is already decided, so it outranks every request (owner, 16 Oct 2026): 80 -> 200
  const xx = find('r-req-xx');
  if (xx && !xx.hard && Number(xx.weight) === 80) xx.weight = 200;
  // carry over from earlier months (owner, 16 Oct 2026): the cardiac and ICU fair-share rules still without it get half, four months back
  for (const id of ['r-c3-fair', 'r-r1b-fair']) {
    const f = find(id);
    if (f && f.params && f.params.carry === undefined) { f.params.carry = 0.5; f.params.carryMonths = 4; }
  }
  // fewer alerts about equal calls (owner, 16 Oct 2026): the cardiac and ICU fair-share rules only point out a gap above 2
  for (const id of ['r-c3-fair', 'r-r1b-fair']) {
    const f = find(id);
    if (f && f.params && f.params.alert === undefined) f.params.alert = 2;
  }
  // alerts by percentage (owner, 16 Oct 2026): a gap has to be over 1 point and over 40% of the average; people with few calls
  // (MO3s) show up sooner than with a fixed two points. The R1 to R3 share compares each grade with itself.
  for (const id of ['r-c3-fair', 'r-r1b-fair', 'r-fair']) {
    const f = find(id);
    if (!f || !f.params || f.params.alertPct !== undefined) continue;
    f.params.alertPct = 40;
    if (id !== 'r-fair' && Number(f.params.alert) === 2) f.params.alert = 1;
    if (id === 'r-fair') { f.params.alert = f.params.alert || 1; f.params.byGroup = 'yes'; }
  }
  // no day-1 cardiac call rule for RES3 and senior residents (owner, 16 Oct 2026); a rule still without a group limit changes
  const c3d1 = find('r-c3-d1');
  if (c3d1 && c3d1.who && !(Array.isArray(c3d1.who.onlyGroups) && c3d1.who.onlyGroups.length)) c3d1.who.onlyGroups = [...C3_D1_GROUPS];
  if (!(s.tags || []).some(x => x.id === 'fsscap')) (s.tags = s.tags || []).push(clone(DEFAULT_TAGS.find(t => t.id === 'fsscap')));
  for (const id of ['r-mo-icusat1', 'r-mo-icusat2', 'r-mo-fss', 'r-mo-pool-r1', 'r-mo-pool-rh1', 'r-mo-pool-r2', 'r-mo-pool-rh2', 'r-mo-pool-r3', 'r-mo-pool-rh3']) add(id);
  for (const id of ['r-mo-nogo', 'r-mo-weak', 'r-mo-satfri', 'r-mo-res', 'r-mo-fellow', 'r-mo-mopex']) add(id);
  // R1 to R3 can be filled (a tick in the Fill dialog, off until ticked)
  for (const code of ['R1', 'R2', 'R3']) { const du = (s.duties || []).find(d => d.code === code); if (du) du.auto = true; }
  // strong / weak pools and the request screening (the R1 to R3 rosterer's rules, 16 Oct 2026)
  for (const t of DEFAULT_TAGS.filter(t => /^mo[123][sw]$/.test(t.id))) if (!(s.tags || []).some(x => x.id === t.id)) (s.tags = s.tags || []).push(clone(t));
  add('r-req-load'); add('r-req-npload'); add('r-pool-1'); add('r-pool-2'); add('r-pool-3');
  // the sheet's colours on the original soft look (owner, 16 Oct 2026; stronger fills made the text hard to read): every duty with a palette colour takes it once. (An earlier
  // step moved only duties still in the very first defaults, and missed ones saved with older defaults, such as S1 and OGD.)
  for (const [code, pal] of Object.entries(PALETTE)) {
    const du = (s.duties || []).find(d => d.code === code);
    if (du) { du.color = pal[0]; du.ink = pal[1]; }
  }
}

export function migrate(s) {
  if (!isObj(s)) return defaultState();
  s.v = 1;
  s.settings = { dept: 'NUH Department of Anaesthesia', holidays: {}, ...(isObj(s.settings) ? s.settings : {}) };
  s.settings.dept = str(s.settings.dept, 'NUH Department of Anaesthesia');
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
  s.staff = byId(s.staff).map(p => ({
    short: '', group: 'res1', tags: [], fte: 1, start: '', end: '', noCallsUntil: '', note: '', active: true, ...p,
    name: str(p.name, p.id), short: str(p.short), group: str(p.group, 'res1'), note: str(p.note),
    start: str(p.start), end: str(p.end), noCallsUntil: /^\d{4}-\d{2}-\d{2}$/.test(str(p.noCallsUntil)) ? str(p.noCallsUntil) : '', tags: strList(p.tags),
  }));
  if (!Array.isArray(s.rules)) s.rules = clone(DEFAULT_RULES);
  s.rules = s.rules.filter(r => isObj(r) && typeof r.type === 'string').map(cleanRule);
  updateRules(s);
  if (!Array.isArray(s.rulesLog)) s.rulesLog = [];
  s.rulesLog = s.rulesLog.filter(isObj);
  if (s.rulesLog.length > 200) s.rulesLog = s.rulesLog.slice(-200);
  if (!isObj(s.months)) s.months = {};
  if (!isObj(s.cells)) s.cells = {};
  // cells: { date: { staffId: { a: [], r: [], auto: [], note, lock } } }; drop anything else
  for (const [d, day] of Object.entries(s.cells)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isObj(day)) { delete s.cells[d]; continue; }
    for (const [id, c] of Object.entries(day)) {
      if (!isObj(c)) { delete day[id]; continue; }
      for (const k of ['a', 'r', 'auto']) if (c[k] !== undefined) c[k] = strList(c[k]);
      if (c.note !== undefined && typeof c.note !== 'string') c.note = str(c.note);
    }
  }
  return s;
}

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
// A month is locked (finished) when its status is 'published': the team copy already stores that status, so locking is
// shared with the team and needs no change to the rules. While locked, no change to that month's days goes through
// (store.js), whoever tries it: calls, Auto-fill, import, copy back to the Google Sheet.
export const isMonthLocked = (state, m) => !!(state && state.months && state.months[m] && state.months[m].status === 'published');
export function setMonthLocked(draft, m, locked) {
  if (!draft.months || typeof draft.months !== 'object') draft.months = {};
  draft.months[m] = { ...(draft.months[m] || {}), status: locked ? 'published' : 'draft', publishedAt: locked ? new Date().toISOString() : '' };
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
function dutyMapCached(state) {
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

// People on the staff list when month m's sheet was read who are not in that sheet (left, rotated out, a typo): hidden from
// the month and never given calls by Auto-fill. Someone added after the import is not in this set, and neither is anyone
// when the month has no imported sheet, or the setting `hideNotInSheet` is switched off.
const NOBODY = new Set();
export function notInSheet(state, m, ignoreSetting = false) {
  if (!ignoreSetting && state && state.settings && state.settings.hideNotInSheet === false) return NOBODY;
  const lay = state && state.sheets && state.sheets[m];
  if (!lay || !Array.isArray(lay.inSheet) || !Array.isArray(lay.known)) return NOBODY;
  const here = new Set(lay.inSheet);
  return new Set(lay.known.filter(id => !here.has(id)));
}

// A person's grade (group) in month m: the one that month's imported sheet showed (the sheet is the source of truth for
// grades, so an old month keeps the grade it had), else their current group.
export function gradeIn(state, m, p) {
  const g = state && state.sheets && state.sheets[m] && state.sheets[m].grades && state.sheets[m].grades[p.id];
  return g && (state.groups || []).some(x => x.id === g) ? g : p.group;
}
// The person as they were in month m: the same object unless their grade that month differs.
export function personIn(state, m, p) {
  const g = gradeIn(state, m, p);
  return g === p.group ? p : { ...p, group: g };
}

// Everyone in post at some point in the month, in sheet order (group order, then the order in state.staff), each with
// the grade they had that month.
export function staffInMonth(state, m) {
  const days = monthDays(m), first = days[0], last = days[days.length - 1];
  const order = new Map((state.groups || []).map((g, i) => [g.id, i]));
  const absent = notInSheet(state, m);
  return (state.staff || [])
    .map((p, i) => ({ p: personIn(state, m, p), i }))
    .filter(({ p }) => p.active !== false && !absent.has(p.id) && (!p.start || p.start <= last) && (!p.end || p.end >= first))
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

// Merge a patch into a cell: dedupe codes, keep auto ⊆ a, delete the cell (and the day) when nothing is left.
// Always writes a new cell object (never mutates the old one), so shallow copies of state stay safe.
export function setCell(draft, s, staffId, patch) {
  if (!draft.cells) draft.cells = {};
  const day = draft.cells[s] || (draft.cells[s] = {});
  const cur = day[staffId] || {};
  const next = { ...cur, ...patch };
  const a = uniq(next.a);
  const cell = { a, r: uniq(next.r), auto: uniq(next.auto).filter(c => a.includes(c)), note: String(next.note || ''), lock: !!next.lock };
  if (!cell.a.length && !cell.r.length && !cell.note && !cell.lock) delete day[staffId];
  else day[staffId] = cell;
  if (!Object.keys(day).length) delete draft.cells[s];
  return day[staffId] || null;
}

// Assigned codes plus 'x' when the day before had an overnight shift.
export function effectiveCodes(state, s, staffId) {
  const cell = getCell(state, s, staffId);
  const out = cell && Array.isArray(cell.a) ? [...cell.a] : [];
  const prev = getCell(state, addDays(s, -1), staffId);
  if (prev && Array.isArray(prev.a) && prev.a.length) {
    const dm = dutyMapCached(state);
    if (prev.a.some(c => dm.get(c) && dm.get(c).overnight) && !out.includes('x')) out.push('x');
  }
  if (isPPC(state, s, staffId) && !out.includes('PPC')) out.push('PPC');
  return out;
}

// PPC: the day off two days after a duty marked rest2 (the ICU call), when the person is still on the same posting
// that day (on the last Saturday of a posting there is no day off). Worked out, never stored.
export function isPPC(state, s, staffId) {
  const back = getCell(state, addDays(s, -2), staffId), cell = getCell(state, s, staffId);
  if (!back || !cell || !Array.isArray(back.a) || !Array.isArray(cell.a)) return false;
  const dm = dutyMapCached(state);
  if (!back.a.some(c => dm.get(c) && dm.get(c).rest2)) return false;
  return cell.a.some(c => dm.get(c) && dm.get(c).kind === 'posting' && back.a.includes(c));
}
export function postingOf(state, cell) {
  if (!cell || !Array.isArray(cell.a)) return '';
  const dm = dutyMapCached(state);
  return cell.a.find(c => dm.get(c) && dm.get(c).kind === 'posting') || '';
}

export const TOKENS = ['@posting', '@shift', '@leave', '@other', '@request', '@away', '@present', '@any'];

// Tokens to concrete codes. '@present' is a property of the day, not a code: matchesCodes handles it.
export function expandTokens(state, codes) {
  const out = new Set();
  const all = state.duties || [];
  const ofKind = k => all.filter(d => d.kind === k).forEach(d => out.add(d.code));
  for (const c of codes || []) {
    if (c === '@shift') ofKind('shift');
    else if (c === '@leave') ofKind('leave');
    else if (c === '@posting') ofKind('posting');
    else if (c === '@other') ofKind('other');
    else if (c === '@request') ofKind('request');
    else if (c === '@away') { ofKind('leave'); ofKind('other'); out.add('x'); out.add('PPC'); }
    else if (c === '@any') { all.forEach(d => out.add(d.code)); out.add('x'); }
    else if (c !== '@present') out.add(c);
  }
  return out;
}

// Does this person's day match any of the codes (requests in r count too)? Handles every token.
export function matchesCodes(state, s, staffId, codes, eff) {
  codes = codes || EMPTY;
  const cell = getCell(state, s, staffId);
  const effc = eff || effectiveCodes(state, s, staffId);
  const all = cell && Array.isArray(cell.r) ? [...effc, ...cell.r] : [...effc];
  if (codes.includes('@any') && all.length) return true;
  const set = expandTokens(state, codes);
  if (all.some(c => set.has(c))) return true;
  if (codes.includes('@present')) {
    const dm = dutyMapCached(state);
    const kindOf = c => (c === 'x' || c === 'PPC' ? 'derived' : (dm.get(c) && dm.get(c).kind));
    if (effc.some(c => kindOf(c) === 'shift')) return true;
    const person = (state.staff || []).find(p => p.id === staffId);
    if (person && !staffActiveOn(person, s)) return false;
    const away = effc.some(c => c === 'x' || c === 'PPC' || kindOf(c) === 'leave' || kindOf(c) === 'other');
    return !isWeekend(s) && !isHoliday(state, s) && !away;
  }
  return false;
}
