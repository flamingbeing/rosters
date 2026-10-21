// NUH Junior Monthly: the practice department (?demo). A made-up department about the size of the real one, with leave,
// requests, clinics and meetings for this month and next. This month's calls and PM shifts are already filled
// with a simple pattern; next month's are left empty so Auto-fill can be tried. Every name here is invented.
// Deterministic: the same `today` always gives the same department (seeded random numbers).
import * as M from './model.js';
import { matchStaff } from './waitlist.js';

// Singapore public holidays 2026 and 2027 (Ministry of Manpower list; a Sunday holiday gives the Monday off).
// 2027 dates for the lunar and Islamic holidays and Deepavali follow MOM's announced list as far as known:
// check them against mom.gov.sg before relying on them.
export const SG_HOLIDAYS = {
  '2026-01-01': "New Year's Day",
  '2026-02-17': 'Chinese New Year',
  '2026-02-18': 'Chinese New Year (day 2)',
  '2026-03-21': 'Hari Raya Puasa',
  '2026-04-03': 'Good Friday',
  '2026-05-01': 'Labour Day',
  '2026-05-27': 'Hari Raya Haji',
  '2026-05-31': 'Vesak Day',
  '2026-06-01': 'Vesak Day (observed)',
  '2026-08-09': 'National Day',
  '2026-08-10': 'National Day (observed)',
  '2026-11-08': 'Deepavali',
  '2026-11-09': 'Deepavali (observed)',
  '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day",
  '2027-02-06': 'Chinese New Year',
  '2027-02-07': 'Chinese New Year (day 2)',
  '2027-02-08': 'Chinese New Year (observed)',
  '2027-03-10': 'Hari Raya Puasa',
  '2027-03-26': 'Good Friday',
  '2027-05-01': 'Labour Day',
  '2027-05-17': 'Hari Raya Haji',
  '2027-05-20': 'Vesak Day',
  '2027-08-09': 'National Day',
  '2027-10-28': 'Deepavali',
  '2027-12-25': 'Christmas Day',
};

// Small seeded random number generator (mulberry32): same seed, same sequence.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// Invented names (never real staff): first names and surnames mixed by a seeded shuffle.
const FIRST = ['Aaron', 'Bella', 'Chen', 'Divya', 'Ethan', 'Farah', 'Gavin', 'Hana', 'Imran', 'Jia Hui', 'Kai', 'Leila', 'Marcus',
  'Nadia', 'Owen', 'Pooja', 'Qi Wen', 'Rizal', 'Sofia', 'Tariq', 'Uma', 'Victor', 'Wen Xin', 'Yash', 'Zara', 'Amir', 'Beatrice',
  'Calvin', 'Dewi', 'Elliot', 'Fiona', 'Ganesh', 'Hui Ling', 'Isaac', 'Joanne', 'Karthik', 'Li Na', 'Mohan', 'Noelle', 'Pei Ying'];
const LAST = ['Ang', 'Balan', 'Chua', 'D\'Souza', 'Eng', 'Fong', 'Gill', 'Hashim', 'Iskandar', 'Jayaram', 'Kang', 'Loo', 'Mahmud',
  'Nathan', 'Oon', 'Phang', 'Rajan', 'Shah', 'Teo', 'Vellu', 'Wong', 'Yeo', 'Zainal', 'Boon', 'Cheong', 'Devan', 'Ee', 'Fadzil'];
// Group sizes about like the real department's juniors.
const SIZES = { r: 6, res3: 10, res2: 14, res1: 14, nhg: 4, rp: 4, loc: 4, mopex: 12, rr: 10, fellow: 6, ac: 0 };
const RR_FROM = ['GS', 'Ortho', 'ED', 'Uro', 'ENT', 'HRM', 'GS', 'Ortho', 'ED', 'GS'];
const FELLOW_OF = ['C', 'ICU', 'GA', 'GA', 'CP', 'ICU'];

export function demoState(today = M.iso(new Date())) {
  const s = M.defaultState();
  const rand = rng(hash('nuhjm-demo-' + M.monthOf(today)));
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const thisM = M.monthOf(today), nextM = M.addMonths(thisM, 1), prevM = M.addMonths(thisM, -1);
  s.settings.dept = 'Practice Department of Anaesthesia';
  s.settings.holidays = { ...SG_HOLIDAYS };

  // ---- staff ----
  const used = new Set();
  const newName = () => { for (;;) { const n = `${FIRST[int(0, FIRST.length - 1)]} ${LAST[int(0, LAST.length - 1)]}`; if (!used.has(n)) { used.add(n); return n; } } };
  let n = 0;
  const byG = {};
  for (const g of s.groups) {
    byG[g.id] = [];
    for (let i = 0; i < (SIZES[g.id] || 0); i++) {
      let name = newName();
      if (g.id === 'rr') name += ` (${RR_FROM[i % RR_FROM.length]})`;
      if (g.id === 'fellow') name += ` (${FELLOW_OF[i % FELLOW_OF.length]})`;
      const parts = name.replace(/\s*\(.*\)$/, '').split(' ');
      const p = { id: `d${String(++n).padStart(3, '0')}`, name, short: `${parts[0]} ${parts[parts.length - 1][0]}`, group: g.id, tags: [], fte: 1, start: '', end: '', note: '', active: true };
      if (g.id === 'r' || g.id === 'res3') p.tags.push('mo1');
      else if (g.id === 'res2') p.tags.push(i < 9 ? 'mo2' : 'mo1');
      else if (['res1', 'mopex', 'rr', 'loc'].includes(g.id)) p.tags.push('mo3');
      if (g.id === 'rr' && /Ortho|HRM/.test(name)) p.tags.push('rrlate');
      if (g.id === 'mopex' && i < 2) p.tags.push('babymo');
      s.staff.push(p); byG[g.id].push(p);
    }
  }

  // ---- postings, by the week, from 5 weeks before this month to the end of next month ----
  const mon = d => M.addDays(d, -((M.weekday(d) + 6) % 7));
  const start = mon(M.addDays(`${thisM}-01`, -35));
  const lastDay = M.monthDays(nextM).slice(-1)[0];
  const weeks = [];
  for (let w = start; w <= lastDay; w = M.addDays(w, 7)) weeks.push(w);
  const plan = new Map();   // staffId -> [posting per week]
  const set = (p, k, code) => { if (!plan.has(p.id)) plan.set(p.id, new Array(weeks.length).fill('')); plan.get(p.id)[k] = code; };
  // cardiac: the cardiac fellow and two NHG residents throughout (NHG pairs swap every 8 weeks), plus one resident on
  // a 4-week block; everyone has an echo or a perfusion week now and then
  const cardFellow = byG.fellow[0];
  const card = [...byG.res2.slice(0, 4), ...byG.res3.slice(0, 3)];
  weeks.forEach((w, k) => {
    set(cardFellow, k, k % 6 === 4 ? 'C-e' : 'C');
    const pair = Math.floor(k / 8) % 2 === 0 ? [0, 1] : [2, 3];
    pair.forEach((j, x) => set(byG.nhg[j], k, (k + x) % 7 === 3 ? (x ? 'C-p' : 'C-e') : 'C'));
    set(card[Math.floor(k / 4) % card.length], k, k % 4 === 3 ? 'C-p' : 'C');
  });
  // ICU: six at a time on 4-week blocks, two changing every two weeks; one MOPEX new to ICU is supernumerary
  const icuPool = [...byG.res1, ...byG.rr, ...byG.res3.slice(3), ...byG.mopex.slice(2, 6), byG.fellow[1], byG.fellow[5]];
  weeks.forEach((w, k) => {
    for (let slot = 0; slot < 3; slot++) {
      const block = Math.floor((k + slot * 2) / 4);
      const pairs = [icuPool[(block * 6 + slot * 2) % icuPool.length], icuPool[(block * 6 + slot * 2 + 1) % icuPool.length]];
      for (const p of pairs) set(p, k, 'ICU');
    }
  });
  for (const p of icuPool) if (p.group === 'res1' || p.group === 'mopex') { if (hash(p.id) % 3 === 0) p.tags.push('icunew'); }
  const sup = byG.mopex[2]; if (!sup.tags.includes('supernum')) sup.tags.push('supernum');
  // the rest: pain, obstetrics, liver, AH, out-rotations
  const rest = s.staff.filter(p => p.group !== 'ac' && p.group !== 'nhg' && p !== cardFellow);
  weeks.forEach((w, k) => {
    const free = rest.filter(p => !(plan.get(p.id) || [])[k]);
    const take = (code, num) => { for (let i = 0; i < num && free.length; i++) set(free.splice(int(0, free.length - 1), 1)[0], k, code); };
    take('CP', 2); take('AP', 1); take('OG1', 1); take('OG2', 1); take('LI', 1);
    if (k % 6 === 2) take('LivOT', 1);
  });
  byG.rp.forEach((p, i) => weeks.forEach((w, k) => set(p, k, i < 3 ? 'AH' : (plan.get(p.id) || [])[k])));
  byG.res2.slice(10, 12).forEach(p => weeks.forEach((w, k) => { if (!(plan.get(p.id) || [])[k]) set(p, k, k < weeks.length / 2 ? 'KKH' : 'TTSH'); }));
  for (const [id, list] of plan) list.forEach((code, k) => { if (!code) return; for (let j = 0; j < 7; j++) { const d = M.addDays(weeks[k], j); M.setCell(s, d, id, { a: [code] }); } });

  // ---- leave and requests (not in ICU or cardiac: those postings take no leave or call requests) ----
  const onTeam = (id, d) => ((M.getCell(s, d, id) || {}).a || []).some(c => c === 'ICU' || c === 'C' || c === 'C-e' || c === 'C-p');
  for (const m of [prevM, thisM, nextM]) {
    const days = M.monthDays(m);
    for (const p of s.staff) {
      if (p.group === 'ac') continue;
      if (rand() < 0.22) {
        const from = int(0, days.length - 6), len = int(2, 5), code = rand() < 0.75 ? 'AL' : rand() < 0.5 ? 'SL' : 'TL';
        for (let k = from; k < from + len; k++) if (!onTeam(p.id, days[k])) { const c = M.getCell(s, days[k], p.id) || { a: [] }; M.setCell(s, days[k], p.id, { a: [...(c.a || []).filter(x => (M.dutyMap(s).get(x) || {}).kind === 'posting'), code] }); }
      }
      const reqs = int(0, 3);
      for (let r = 0; r < reqs; r++) {
        const d = days[int(0, days.length - 1)];
        if (onTeam(p.id, d)) continue;
        const c = M.getCell(s, d, p.id) || { a: [], r: [] };
        if ((c.a || []).some(x => (M.dutyMap(s).get(x) || {}).kind === 'leave')) continue;
        M.setCell(s, d, p.id, { r: [rand() < 0.7 ? 'X' : rand() < 0.5 ? 'NP' : 'R'] });
      }
    }
  }
  // Not on the roster: the AC rows (seniors) are there only for their S1 calls
  // ---- cardiac and ICU calls already done for last month and this month (next month is left for Auto-fill) ----
  for (const m of [prevM, thisM]) fillCalls(s, m);
  // ---- a made-up leave waitlist for this month (the Leave tab): the same shape the sheet's tab reads into ----
  s.waitlist = { [thisM]: demoWaitlist(s, thisM, rng(hash('nuhjm-demo-waitlist-' + thisM))) };
  return s;
}

function demoWaitlist(s, month, rand) {
  const days = M.monthDays(month);
  const pool = s.staff.filter(p => !['ac', 'fellow'].includes(p.group));
  const ORDER = ['waitlisted', 'adhoc', 'approved', 'expedited', 'rejected', 'closed', 'waitlisted', 'adhoc'];
  const REMARKS = ['', '', '', 'PM', 'medical appt', 'AM'];
  const entries = [];
  const cellRow = {};
  let k = 0;
  for (const d of days) {
    if (M.isWeekend(d)) continue;
    const n = rand() < 0.35 ? 0 : rand() < 0.7 ? 1 : 2;
    for (let slot = 1; slot <= n; slot++) {
      const p = pool[Math.floor(rand() * pool.length)];
      const first = p.name.split(' ')[0];
      const text = rand() < 0.8 ? p.name.replace(/\s*\(.*\)$/, '') : first;
      const remark = REMARKS[Math.floor(rand() * REMARKS.length)];
      const m = matchStaff(text, s.staff);
      const row = d.slice(8) * 1 + 1;
      cellRow[d] = row;
      entries.push({ date: d, slot, cell: `${String.fromCharCode(66 + slot)}${row}`, text: remark ? `${text} (${remark})` : text, name: text, remark,
        status: ORDER[k++ % ORDER.length], exact: true, staffId: m && m.id ? m.id : '', ambiguous: m && m.ambiguous ? m.ambiguous : null });
    }
  }
  return { entries, readAt: '', source: null, columns: 6 };
}

// A simple rota like the real ones: each night, of the people on the posting that night and the next, the one who has
// rested longest (cardiac: at least 3 days between calls; ICU: call, post call, a day off, then an ICU day).
function fillCalls(s, month) {
  const days = M.monthDays(month);
  for (const [call, post, gap, from] of [['C3', 'C', 3, 2], ['R1B', 'ICU', 4, 2]]) {
    const last = new Map();
    for (const d of days) {
      const next = M.addDays(d, 1);
      const cand = s.staff.filter(p => {
        const c = M.getCell(s, d, p.id), cn = M.getCell(s, next, p.id);
        if (!c || !(c.a || []).includes(post) || (c.a || []).length > 1 || (c.r || []).length) return false;
        if (post === 'ICU' && !(cn && (cn.a || []).includes(post))) return false;
        if ((p.tags || []).includes('supernum') || (p.tags || []).includes('babymo')) return false;
        if (M.effectiveCodes(s, d, p.id).some(x => x === 'x' || x === 'PPC')) return false;
        let k = 1; while (k <= 7 && ((M.getCell(s, M.addDays(d, -k), p.id) || {}).a || []).includes(post)) k++;
        if (k <= Math.max(from - 1, (p.tags || []).includes('icunew') && post === 'ICU' ? 3 : 0, (p.tags || []).includes('rrlate') && post === 'ICU' ? 7 : 0)) return false;
        const l = last.get(p.id);
        return l == null || (M.parseISO(d) - M.parseISO(l)) / 864e5 >= gap;
      }).sort((a, b) => (last.get(a.id) || '') < (last.get(b.id) || '') ? -1 : 1);
      if (!cand.length) continue;
      const p = cand[0];
      const c = M.getCell(s, d, p.id);
      M.setCell(s, d, p.id, { a: [...c.a, call] });
      last.set(p.id, d);
    }
  }
}
