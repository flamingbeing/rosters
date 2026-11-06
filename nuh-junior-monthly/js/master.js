// NUH Junior Monthly: start a month from the master rotations sheet. The master is the department's year plan: one tab per
// academic year ("26-27 Block", July to June), one row per person under section rows (SR2, SR1, CA1… MOPEX, External), one
// column per week with that week's posting. A second name column at the half-year change-over holds the names for January to
// June (grades and blocks change there). It is edited all year, so this is a re-pull: read it, compare with People and the
// month, show every change ticked, apply only the ticked ones. Nothing here touches the DOM; ui-more.js draws the review.
import * as M from './model.js';
import { normName } from './io.js';

// The master's sections: the People group each one goes to, and the label kept for the review (SR2 is the one that can be
// promoted to AC: the master does not say who is, the rosterer ticks them).
const SECTIONS = [
  [/^resident physicians?\b/i, 'rp', 'RP'],
  [/^sr2\b/i, 'r', 'SR2'],
  [/^sr1\b/i, 'r', 'SR1'],
  [/^smo\b/i, 'r', 'SMO'],
  [/^ca3\b/i, 'res3', 'CA3'],
  [/^ca2\b/i, 'res2', 'CA2'],
  [/^ca1\b/i, 'res1', 'CA1'],
  [/^fellows?\b/i, 'fellow', 'Fellow'],
  [/^mopex\b/i, 'mopex', 'MOPEX'],
  [/^external\b/i, 'rr', 'External'],
];
const STOP = /^(supra|total|junior manpower|paeds icu trainee|icm trainee)/i;
// The groups the master covers: people in them who are not in the master are listed (unticked) as possibly gone.
export const MASTER_GROUPS = ['r', 'res3', 'res2', 'res1', 'nhg', 'rp', 'fellow', 'mopex', 'rr'];

// Master code -> the monthly sheet's code (from the monthly sheets of Oct to Dec 2026 against the master, weekdays).
// '' = the general list (no posting in the monthly sheet), 'Z' = not on the roster that week, FLOAT = the obstetric floats
// (the night float alternates OGN and PC, so they are typed or filled, not set from here).
export const FLOAT = 'float';
export const DEFAULT_MASTER_CODES = {
  ICU: 'ICU', C: 'C', 'C-E': 'C-e', 'C-P': 'C-p', CP: 'CP', AP: 'AP', KKH: 'KKH', LIVOT: 'LivOT', OG1: 'OG1', OG2: 'OG2',
  LIVER: 'LI', 'NTFGH-JR': 'NTF', 'NTFGH-SR': 'NTF', 'NTFGH-RA': 'NTF', 'NTF ICU': 'NTF', 'TTSH NICU': 'TTSH', 'TTSH NEU': 'TTSH',
  'AH-AMB': 'AH', 'ML/ NPL': 'ML', ML: 'ML', SAF: 'Z', NPL: 'Z', 'KIV ELECTIVE': 'Z', 'PALL-E': 'Z',
  OGNF1: FLOAT, OGNF2: FLOAT, OGDF: FLOAT,
  GC: '', ENT: '', NEU: '', RA: '', 'RA-E': '', PAED: '', 'PAED-E': '', SR: '', AOCC: '', FUN: '', RR: '', UGIT: '', VASCULAR: '',
  REMOTE: '', THORACIC: '', OR: '', GYNAE: '', DENTAL: '', PREP: '', ELECTIVE: '', 'PART A': '', 'PART B': '', 'PART C': '', AMB: '',
};
const codeKey = t => String(t || '').toUpperCase().replace(/\s+/g, ' ').trim();
// What a master cell means: { code, known }. "Prep/ Neu" and other mixes read as their first part.
export function mapCode(text, table = DEFAULT_MASTER_CODES) {
  const k = codeKey(text);
  if (!k) return { code: null, known: true };
  if (k in table) return { code: table[k], known: true };
  const first = k.split('/')[0].trim();
  if (first in table) return { code: table[first], known: true };
  return { code: '', known: false };
}

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WEEK = /(\d{1,2})\s*\*?\s*(?:\([A-Za-z]\))?\s*-\s*(\d{1,2})\s*\*?\s*(?:\([A-Za-z]\))?\s*$/;

// The academic year of a tab name ("26-27 Block" -> 2026), or null.
export function tabYear(name) {
  const m = /(\d{2})\s*-\s*(\d{2})/.exec(String(name || ''));
  return m && +m[2] === (+m[1] + 1) % 100 ? 2000 + +m[1] : null;
}
// The tab for a month: the block tab whose July to June holds it.
export function chooseTab(names, month) {
  const [y, m] = month.split('-').map(Number);
  const want = m >= 7 ? y : y - 1;
  return names.find(n => /block/i.test(n) && tabYear(n) === want) || null;
}

const cellStr = v => (v == null ? '' : String(v).replace(/\r/g, '').trim());

// Read one block tab (rows of cell text, as copied or read from Google or Excel).
// -> { year, weeks: [{ col, from, to }], people: [{ key, name, rows, halves: [{ group, label, from, to, codes: {iso: text} }] }],
//      duplicates: [{ name, rows }] }
export function parseMaster(rows, tabName) {
  const year = tabYear(tabName);
  if (!year) throw new Error(`"${tabName}" is not a block tab: its name should hold the academic year, like "26-27 Block".`);
  const lab = rows.findIndex((r, i) => i < 8 && (r || []).filter(c => WEEK.test(cellStr(c))).length >= 10);
  if (lab < 0) throw new Error('No row of weeks ("13-19", "20-26"…) near the top of the tab.');
  const head = rows[lab];
  const nameCols = [0];
  head.forEach((c, j) => { if (j > 0 && /changeover/i.test(cellStr(c)) && !WEEK.test(cellStr(c))) nameCols.push(j); });
  // weeks: each runs from the day after the last one to its end number (the first starts in July)
  const weeks = [];
  let start = null;
  head.forEach((c, j) => {
    const m = WEEK.exec(cellStr(c));
    if (!m || nameCols.includes(j)) return;
    if (!start) start = new Date(year, +m[1] > 25 ? 5 : 6, +m[1]);
    const end = new Date(start);
    for (let k = 0; k < 12 && end.getDate() !== +m[2]; k++) end.setDate(end.getDate() + 1);
    weeks.push({ col: j, from: iso(start), to: iso(end) });
    start = new Date(end); start.setDate(start.getDate() + 1);
  });
  if (weeks.length < 10) throw new Error('Too few weeks read from the row of weeks.');
  // the change-over day: a week of 8 days gives its last day to the next week (the new half's postings start that day)
  for (let k = 0; k + 1 < weeks.length; k++) {
    const w = weeks[k];
    if (M.addDays(w.from, 7) <= w.to) { weeks[k + 1].from = w.to; w.to = M.addDays(w.to, -1); }
  }
  const halfOf = col => nameCols.filter(c => c < col).length - 1;   // 0 = July to December, 1 = January to June
  const sectionAt = [];   // per row: [group, label] or null
  let sec = null;
  rows.forEach((r, i) => {
    if (i <= lab) { sectionAt[i] = null; return; }
    const a = cellStr((r || [])[0]);
    const hit = SECTIONS.find(([re]) => re.test(a));
    if (hit) { sec = [hit[1], hit[2], i]; sectionAt[i] = null; return; }
    if (STOP.test(a)) sec = null;
    sectionAt[i] = sec;
  });
  // which column holds the names for each half, per section (a section with no names in the change-over column keeps
  // column A; the external block always does: that column holds their home departments there)
  const useCol = (h, s) => {
    if (h === 0 || s[0] === 'rr') return 0;
    const col = nameCols[h];
    return rows.some((r, i) => sectionAt[i] && sectionAt[i][2] === s[2] && cellStr((r || [])[col]) && !SECTIONS.some(([re]) => re.test(cellStr(r[col])))) ? col : 0;
  };
  const byKey = new Map(), duplicates = [];
  for (let h = 0; h < nameCols.length; h++) {
    const seen = new Map();
    rows.forEach((r, i) => {
      const s = sectionAt[i];
      if (!s) return;
      let name = cellStr((r || [])[useCol(h, s)]).replace(/\s+/g, ' ');
      if (!name || SECTIONS.some(([re]) => re.test(name))) return;
      const kiv = /^kiv\b/i.test(name);
      name = name.replace(/^kiv\s+/i, '');
      const key = normName(name.replace(/\(.*?\)/g, ''));
      if (!key) return;
      if (seen.has(key)) { duplicates.push({ name, rows: [seen.get(key) + 1, i + 1], half: h }); return; }   // the first row wins
      seen.set(key, i);
      const codes = {};
      for (const w of weeks) {
        if (halfOf(w.col) !== h) continue;
        const t = cellStr(r[w.col]);
        if (!t) continue;
        for (let d = w.from; d <= w.to; d = M.addDays(d, 1)) codes[d] = t;
      }
      const first = weeks.find(w => halfOf(w.col) === h), last = [...weeks].reverse().find(w => halfOf(w.col) === h);
      let group = s[0];
      if (group === 'rr' && /\(\s*cardiac/i.test(name)) group = 'nhg';
      const p = byKey.get(key) || { key, name, rows: [], halves: [] };
      p.rows.push(i + 1);
      p.halves.push({ half: h, group, label: s[1], kiv, from: first.from, to: last.to, codes });
      byKey.set(key, p);
    });
  }
  return { year, tab: tabName, weeks, halves: nameCols.length, people: [...byKey.values()], duplicates };
}

// The name People gets for someone new: the bracket stays for rotating residents and fellows (home department, "(GA)"),
// as the department sheet writes them; others lose it ("(SAF)").
export function sheetName(name, group) {
  let n = String(name).replace(/\s+/g, ' ').trim();
  if (group === 'nhg') n = n.replace(/\s*\(\s*cardiac[^)]*\)/i, '');
  else if (group !== 'rr' && group !== 'fellow') n = n.replace(/\s*\(.*?\)/g, '');
  // "Tan Li-Linn, Elizabeth" -> "Elizabeth Tan Li-Linn"
  const comma = /^([^,()]+),\s*([^()]+?)(\s*\(.*\))?$/.exec(n);
  if (comma) n = `${comma[2].trim()} ${comma[1].trim()}${comma[3] || ''}`;
  return n.trim();
}

// Find a master name on People: an exact name or a remembered master name, else a close one (the same words in another
// order or with words missing, one name run together, a small typo). -> { id, how: 'exact' | 'close' } or null.
export function findPerson(staff, name, taken = new Set()) {
  const bare = normName(String(name).replace(/\(.*?\)/g, ''));
  const words = bare.split(' ').filter(Boolean);
  const pool = staff.filter(p => !taken.has(p.id));
  const names = p => [p.name, p.short, ...(p.aliases || [])].filter(Boolean).map(x => normName(String(x).replace(/\(.*?\)/g, '')));
  let hit = pool.find(p => names(p).includes(bare));
  if (hit) return { id: hit.id, how: 'exact' };
  const flat = bare.replace(/ /g, '');
  hit = pool.find(p => names(p).some(n => n.replace(/ /g, '') === flat));
  if (hit) return { id: hit.id, how: 'close' };
  const subset = (a, b) => a.length && a.every(w => b.includes(w));
  hit = pool.find(p => names(p).some(n => { const w = n.split(' '); return Math.min(words.length, w.length) >= 2 ? subset(words, w) || subset(w, words) : false; }));
  if (hit) return { id: hit.id, how: 'close' };
  // one word ("Vikash") inside a longer name, or a near spelling of the whole name
  if (words.length === 1 && words[0].length >= 4) {
    const c = pool.filter(p => names(p).some(n => n.split(' ').some(w => w.includes(words[0]))));
    if (c.length === 1) return { id: c[0].id, how: 'close' };
  }
  hit = pool.find(p => names(p).some(n => n.length > 6 && editDistance(n, bare) <= 2));
  if (hit) return { id: hit.id, how: 'close' };
  // the same words with a typo in one ("Jon Smiht" for "Jon Smith Lee")
  const near = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && editDistance(a, b) <= 2);
  hit = pool.find(p => names(p).some(n => { const w = n.split(' '); return words.length >= 2 && words.every(x => w.some(y => near(x, y))); }));
  return hit ? { id: hit.id, how: 'close' } : null;
}
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// What pulling the master into `month` would change. Each list item has a `key` the review ticks.
// -> { month, entries: [person in the master that month], add, close, moves, dates, promote, gone, duplicates, floats, unknown }
export function planMaster(state, master, month, { table = DEFAULT_MASTER_CODES } = {}) {
  const days = M.monthDays(month), first = days[0], last = days[days.length - 1];
  const staff = state.staff || [];
  const gmap = M.groupMap(state);
  const taken = new Set();
  const entries = [], unknown = new Map();
  let floats = 0;
  const yearFrom = master.weeks[0].from, yearTo = master.weeks[master.weeks.length - 1].to;
  for (const mp of master.people) {
    const all = Object.assign({}, ...mp.halves.map(h => h.codes));
    const on = Object.keys(all).sort();
    if (!on.length) continue;
    const from = on[0], to = on[on.length - 1];
    if (to < first || from > last) continue;
    // the half that covers most of the month gives the grade
    const half = [...mp.halves].sort((a, b) => overlap(b, first, last) - overlap(a, first, last))[0];
    const cells = {};
    for (const d of days) {
      if (d < from || d > to) continue;
      const t = all[d];
      const { code, known } = mapCode(t, table);
      if (!known) unknown.set(codeKey(t), (unknown.get(codeKey(t)) || 0) + 1);
      if (code === FLOAT) { floats++; cells[d] = ''; } else cells[d] = code == null ? 'Z' : code;
    }
    const found = findPerson(staff, mp.name, taken);
    if (found) taken.add(found.id);
    entries.push({
      key: mp.key, name: mp.name, rows: mp.rows, group: half.group, label: half.label, kiv: half.kiv,
      start: from > yearFrom ? from : '', end: to < yearTo ? to : '', cells, match: found,
    });
  }
  const byId = new Map(staff.map(p => [p.id, p]));
  const add = entries.filter(e => !e.match);
  const close = entries.filter(e => e.match && e.match.how === 'close');
  const moves = [], dates = [], promote = [];
  for (const e of entries) {
    const p = e.match && byId.get(e.match.id);
    if (!p) continue;
    const g = gmap.get(p.group) || {};
    // seniors (AC) stay where they are: a promotion the rosterer made is never undone by the master
    if (p.group !== e.group && g.kind !== 'senior' && gmap.has(e.group)) moves.push({ key: 'g:' + e.key, id: p.id, name: p.name, from: g.name || p.group, to: gmap.get(e.group).name, group: e.group });
    // AC promotion is not in the master: at the half-year change-over, SR2s are offered (unticked)
    if (e.label === 'SR2' && g.kind !== 'senior' && (month.endsWith('-01') || month.endsWith('-07')) && gmap.has('ac')) promote.push({ key: 'p:' + e.key, id: p.id, name: p.name });
    const ch = {};
    // a start date matters only if it falls in this month or later (an older one changes nothing from here on)
    if (e.start !== (p.start || '') && (e.start || '') > M.addDays(first, -1) || (p.start && p.start >= first && !e.start)) ch.start = e.start;
    if (e.end && e.end !== (p.end || '')) ch.end = e.end;
    if (p.end && p.end < last && !e.end) ch.end = '';   // the master now keeps them on
    if (Object.keys(ch).length) dates.push({ key: 'd:' + e.key, id: p.id, name: p.name, was: { start: p.start || '', end: p.end || '' }, ...ch });
  }
  // People in the groups the master covers, in post this month, not found in it: maybe gone (unticked)
  const matched = new Set(entries.filter(e => e.match).map(e => e.match.id));
  const gone = M.staffInMonth(state, month)
    .filter(p => MASTER_GROUPS.includes(p.group) && !matched.has(p.id))
    .map(p => ({ key: 'x:' + p.id, id: p.id, name: p.name, end: M.addDays(first, -1) }));
  const half = +month.slice(5) <= 6 ? 1 : 0;
  const dupes = master.duplicates.filter(d => (d.half || 0) === Math.min(half, master.halves - 1) && entries.some(e => e.key === normName(d.name.replace(/\(.*?\)/g, ''))));
  return { month, tab: master.tab, entries, add, close, moves, dates, promote, gone, duplicates: dupes, floats, unknown };
}
const overlap = (h, a, b) => { let n = 0; for (const d of Object.keys(h.codes)) if (d >= a && d <= b) n++; return n; };

// Apply the ticked parts. choices: { off: Set of keys left unticked, on: Set of keys ticked among the unticked-by-default
// lists (promote, gone), as: Map entry key -> staff id or 'new' (the rosterer's choice for a new or close match) }.
// -> { added, moved, promoted, dated, ended, people, cells }
export function applyMaster(draft, plan, { off = new Set(), on = new Set(), as = new Map() } = {}) {
  const res = { added: 0, moved: 0, promoted: 0, dated: 0, ended: 0, people: 0, cells: 0 };
  const staff = draft.staff || (draft.staff = []);
  const byId = id => staff.find(p => p.id === id);
  const postings = new Set((draft.duties || []).filter(d => d.kind === 'posting').map(d => d.code));
  const days = M.monthDays(plan.month);
  for (const e of plan.entries) {
    if (off.has('e:' + e.key)) continue;
    let id = as.has(e.key) ? as.get(e.key) : e.match && e.match.id;
    if (id === 'new' || !id || !byId(id)) {
      const p = { id: M.uid('s'), name: sheetName(e.name, e.group), short: '', group: e.group, tags: [], fte: 1, start: e.start, end: e.end, noCallsUntil: '', note: 'From the master rotations', active: true, aliases: [e.name] };
      staff.push(p);
      id = p.id; res.added++;
    } else {
      const p = byId(id);
      if ((!e.match || e.match.id !== id || e.match.how === 'close') && !(p.aliases || []).includes(e.name)) p.aliases = [...(p.aliases || []), e.name];
    }
    res.people++;
    // the month's days: the master's posting (or Z, or ML) replaces the last one it set; calls, leave and requests stay
    for (const d of days) {
      if (!(d in e.cells)) continue;
      const want = e.cells[d];
      const cell = M.getCell(draft, d, id) || { a: [], r: [], auto: [], note: '', lock: false };
      if (cell.lock) continue;
      const a = (cell.a || []).filter(c => !postings.has(c) && c !== 'Z');
      if (postings.has(want)) a.unshift(want);
      else if (want && !a.includes(want)) a.push(want);
      const before = (cell.a || []).join(' ');
      if (a.join(' ') !== before) { M.setCell(draft, d, id, { a, auto: (cell.auto || []).filter(c => a.includes(c)) }); res.cells++; }
    }
  }
  for (const mv of plan.moves) if (!off.has(mv.key) && byId(mv.id)) { byId(mv.id).group = mv.group; res.moved++; }
  for (const pr of plan.promote) if (on.has(pr.key) && byId(pr.id)) { byId(pr.id).group = 'ac'; res.promoted++; }
  for (const dt of plan.dates) {
    if (off.has(dt.key) || !byId(dt.id)) continue;
    const p = byId(dt.id);
    if ('start' in dt) p.start = dt.start;
    if ('end' in dt) p.end = dt.end;
    res.dated++;
  }
  for (const g of plan.gone) if (on.has(g.key) && byId(g.id)) { byId(g.id).end = g.end; res.ended++; }
  return res;
}
