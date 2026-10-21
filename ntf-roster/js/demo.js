// NTF Roster: the practice department (?demo). A made-up department about the size of the real one, with leave,
// requests, clinics and meetings for this month and next. This month's calls and PM shifts are already filled
// with a simple pattern; next month's are left empty so Auto-fill can be tried. Every name here is invented.
// Deterministic: the same `today` always gives the same department (seeded random numbers).
import * as M from './model.js';

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

// Invented people, by group (sheet order). [name, short]
const PEOPLE = {
  cons: ['Aileen Tay', 'Bernard Lowe', 'Chitra Raman', 'Desmond Ho', 'Evelyn Seah', 'Faizal Rahman', 'Grace Liew',
    'Harish Menon', 'Irene Quek', 'Jonathan Pereira', 'Karen Toh', 'Lionel Chua', 'Maryam Yusof'],
  ac: ['Nathaniel Sim', 'Olivia Chandran', 'Priya Nair', 'Quentin Lau', 'Rachel Wee', 'Syed Hakim'],
  ext: ['Theresa Ang', 'Umar Basri'],
  vc: ['Vincent Oei', 'Wendy Fernandez', 'Xavier Teo'],
  sr: ['Yvonne Ng', 'Zachary Low', 'Aisyah Rahim', 'Brandon Goh'],
  srp: ['Clara Selvam', 'Dinesh Kumar'],
  rp: ['Elaine Foo', 'Farid Ismail', 'Gabriel Wong'],
  jr: ['Chen Hui Min', 'Ishaan Rao', 'Jasmine Lee', 'Kelvin Phua', 'Lakshmi Iyer', 'Marcus Heng', 'Nur Izzati',
    'Oscar Lim', 'Pei Wen Lim'],
  locum: ['Ravi Shankar', 'Samantha Cole'],
  mo: ['Tobias Ranjit', 'Umairah Salleh', 'Vanessa Kaur', 'Ong Wei Jie', 'Lau Xin Yi', 'Yusuf Hamid', 'Zoe Mitchell',
    'Arjun Pillai', 'Bryan Tham', 'Cheryl Soh', 'Darren Neo', 'Esther Lum', 'Fikri Osman', 'Gwen Yap', 'Hafiz Jamal',
    'Ivy Chia', 'Joel Sng', 'Kavitha Das', "Liam O'Brien", 'Mei Ling Kwek'],
};
const JUNIOR_GROUPS = ['sr', 'srp', 'rp', 'jr', 'locum', 'mo'];

export function demoState(today = M.iso(new Date())) {
  const s = M.defaultState();
  const rand = rng(hash('ntf-demo-' + M.monthOf(today)));
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const thisM = M.monthOf(today), nextM = M.addMonths(thisM, 1), prevM = M.addMonths(thisM, -1);
  const first = `${thisM}-01`;

  s.settings.dept = 'Practice Department of Anaesthesia';
  s.settings.holidays = { ...SG_HOLIDAYS };

  // ---- staff ----
  let n = 0;
  for (const g of s.groups) {
    (PEOPLE[g.id] || []).forEach((name, i) => {
      const parts = name.split(' ');
      const p = { id: `d${String(++n).padStart(2, '0')}`, name, short: `${parts[0]} ${parts[parts.length - 1][0]}`,
        group: g.id, tags: [], fte: 1, start: '', end: '', note: '', active: true };
      if (g.id === 'cons' && (i === 2 || i === 7)) p.tags.push('pain');
      if (g.id === 'cons' && i === 10) { p.tags.push('parttime'); p.fte = 0.6; p.note = 'Mon, Wed, Thu'; }
      if (g.id === 'ext') { p.tags.push('icu'); p.note = 'ICU joint appointment'; }
      if (g.id === 'sr') { p.note = `R${4 + (i % 2)}-SR${1 + (i % 2)}`; p.start = M.addMonths(prevM, -1 - (i % 3)) + '-14'; p.end = M.addDays(`${M.addMonths(nextM, 2 + (i % 2))}-01`, 12); }
      if (g.id === 'jr') { p.note = `R${1 + (i % 3)}`; p.start = `${M.addMonths(thisM, -2 - (i % 2))}-0${1 + (i % 7)}`; p.end = M.addDays(`${M.addMonths(nextM, 1 + (i % 3))}-01`, 9); }
      if (g.id === 'locum') p.note = 'Locum';
      if (g.id === 'mo' && i < 3) { p.tags.push('babymo'); p.note = 'B'; p.start = `${M.addMonths(thisM, -1)}-0${4 + i}`; p.end = M.addDays(`${M.addMonths(nextM, 4)}-01`, 3); }
      s.staff.push(p);
    });
  }
  // A junior resident leaves mid next month and a new one starts the day after (a posting change).
  const jrs = s.staff.filter(p => p.group === 'jr');
  jrs[jrs.length - 1].end = `${nextM}-13`;
  const newJr = { id: 'd65', name: 'Ahmad Zulkifli', short: 'Ahmad Z', group: 'jr', tags: [], fte: 1, start: `${nextM}-14`, end: '', note: 'R1', active: true };
  s.staff.splice(s.staff.indexOf(jrs[jrs.length - 1]) + 1, 0, newJr);

  const byGroup = id => s.staff.filter(p => p.group === id);
  const seniors = [...byGroup('cons'), ...byGroup('ac')];
  const juniors = s.staff.filter(p => JUNIOR_GROUPS.includes(p.group));
  const dm = M.dutyMap(s);
  const kind = c => (dm.get(c) || {}).kind;

  const add = (d, id, code) => {
    const cell = M.getCell(s, d, id) || { a: [], r: [] };
    const k = kind(code);
    if (k === 'request') M.setCell(s, d, id, { r: [...cell.r, code] });
    else M.setCell(s, d, id, { a: [...cell.a, code] });
  };
  const note = (d, id, text) => {
    const cell = M.getCell(s, d, id);
    M.setCell(s, d, id, { note: cell && cell.note ? `${cell.note}; ${text}` : text });
  };
  const has = (d, id, pred) => { const c = M.getCell(s, d, id); return !!c && [...c.a, ...c.r].some(pred); };
  const busy = (d, id) => has(d, id, c => kind(c) === 'leave' || kind(c) === 'other');
  const isWorkday = d => !M.isWeekend(d) && !M.isHoliday(s, d);

  for (const m of [thisM, nextM]) {
    const days = M.monthDays(m);
    // ---- leave blocks ----
    for (const p of s.staff) {
      if (p.group === 'vc') continue;
      const r = rand();
      if (r < 0.3) {
        const len = int(3, 9), start = int(0, days.length - len);
        const code = rand() < 0.15 ? 'AAL' : 'AL';
        for (let i = start; i < start + len; i++) if (M.staffActiveOn(p, days[i])) add(days[i], p.id, code);
      } else if (r < 0.42) {
        const len = int(1, 3), start = int(0, days.length - len);
        const code = pick(['CL', 'CL', 'TL', JUNIOR_GROUPS.includes(p.group) ? 'EL' : 'CL']);
        for (let i = start; i < start + len; i++) if (isWorkday(days[i]) && M.staffActiveOn(p, days[i])) add(days[i], p.id, code);
      } else if (r < 0.46) {
        const d = pick(days);
        if (isWorkday(d) && M.staffActiveOn(p, d)) add(d, p.id, pick(['MC', 'OIL', 'CCL']));
      }
    }
    // ---- requests ----
    for (const p of s.staff) {
      if (p.group === 'vc' || p.group === 'ext' || rand() > 0.45) continue;
      const k = int(1, 3);
      for (let j = 0; j < k; j++) {
        const d = pick(days);
        if (!M.staffActiveOn(p, d) || busy(d, p.id) || has(d, p.id, c => kind(c) === 'request')) continue;
        const junior = JUNIOR_GROUPS.includes(p.group);
        if (M.isWeekend(d)) add(d, p.id, pick(['Nw', 'Nc', 'Wr', 'Cr']));
        else add(d, p.id, junior ? pick(['Nc', 'Nc', 'Cr', 'Pr', 'NP']) : pick(['Nc', 'Cr']));
      }
    }
    // ---- seniors' clinics, APS weeks, a day at NUH, an injection list, ICU weeks ----
    byGroup('cons').forEach((p, i) => {
      const wd = 1 + (i % 5);
      for (const d of days) if (M.weekday(d) === wd && isWorkday(d) && !busy(d, p.id) && M.staffActiveOn(p, d)) add(d, p.id, 'Clinic');
    });
    seniors.filter(p => p.tags.includes('pain')).forEach((p, i) => {
      const mondays = days.filter(d => M.weekday(d) === 1);
      const mon = mondays[(i * 2 + (m === nextM ? 1 : 0)) % mondays.length];
      for (let k = 0; k < 5; k++) { const d = M.addDays(mon, k); if (M.monthOf(d) === m && isWorkday(d) && !busy(d, p.id)) add(d, p.id, 'APS'); }
    });
    const nuhAc = byGroup('ac')[1];
    for (const d of days) if (M.weekday(d) === 4 && isWorkday(d) && !busy(d, nuhAc.id)) add(d, nuhAc.id, 'NUH');
    const vcInj = byGroup('vc')[0];
    for (const d of days) if (M.weekday(d) === 3 && isWorkday(d)) add(d, vcInj.id, 'Inj');
    byGroup('ext').forEach((p, i) => {
      const mondays = days.filter(d => M.weekday(d) === 1);
      const mon = mondays[(i + 1) % mondays.length];
      for (let k = 0; k < 7; k++) { const d = M.addDays(mon, k); if (M.monthOf(d) === m && !busy(d, p.id)) add(d, p.id, 'ICM'); }
    });
    // ---- meetings as notes ----
    const tue = days.filter(d => M.weekday(d) === 2 && isWorkday(d));
    if (tue[1]) seniors.slice(0, 5).forEach(p => { if (!busy(tue[1], p.id)) note(tue[1], p.id, 'Dept meeting 1.30-5.30pm'); });
    const thu = days.filter(d => M.weekday(d) === 4 && isWorkday(d));
    if (thu[2]) byGroup('jr').forEach(p => { if (M.staffActiveOn(p, thu[2]) && !busy(thu[2], p.id)) note(thu[2], p.id, 'Teaching 2-4pm'); });
    const mo0 = byGroup('mo')[5];
    const wed = days.filter(d => M.weekday(d) === 3 && isWorkday(d));
    if (wed[0]) note(wed[0], mo0.id, 'BCLS course pm');
    s.months[m] = { status: 'draft', publishedAt: '', note: '' };
  }

  fillThisMonth(s, thisM, rand);
  return s;
}

// A simple, valid pattern for this month: 1 senior + 2 juniors on call every day, 1 junior on the PM shift each
// working weekday and 1 junior on the public holiday day shift. Respects leave, post call, "no call" requests,
// 3 days between calls where possible, no call the night before leave or a day duty, and the Baby MO pairing rules.
function fillThisMonth(s, month, rand) {
  const dm = M.dutyMap(s);
  const kind = c => (dm.get(c) || {}).kind;
  const cellOf = (d, id) => M.getCell(s, d, id) || { a: [], r: [], auto: [] };
  const put = (d, id, code) => { const c = cellOf(d, id); M.setCell(s, d, id, { a: [...c.a, code], auto: [...(c.auto || []), code] }); };
  const codes = (d, id) => { const c = M.getCell(s, d, id); return c ? [...c.a, ...c.r] : []; };
  const seniorGroups = ['cons', 'ac'], juniorGroups = ['sr', 'srp', 'rp', 'jr', 'locum', 'mo'];
  const seniors = s.staff.filter(p => seniorGroups.includes(p.group));
  const juniors = s.staff.filter(p => juniorGroups.includes(p.group) && M.poolOf(s, p) === 'junior');   // senior residents are on the senior roster
  const calls = new Map(), weekend = new Map(), lastCall = new Map(), pms = new Map();
  const tie = new Map(s.staff.map(p => [p.id, rand()]));

  const canCall = (p, d, strict) => {
    if (!M.staffActiveOn(p, d) || !M.staffActiveOn(p, M.addDays(d, 1))) return false;
    const today = codes(d, p.id), tomorrow = codes(M.addDays(d, 1), p.id);
    if (today.some(c => ['leave', 'other'].includes(kind(c)) || c === 'C' || c === 'Nc' || c === 'P')) return false;
    if (M.effectiveCodes(s, d, p.id).includes('x')) return false;                       // post call
    if (tomorrow.some(c => kind(c) === 'shift')) return false;                           // tomorrow's clinic etc.
    if (M.isWeekend(d) && today.includes('Nw')) return false;
    const last = lastCall.get(p.id);
    const gap = last ? (M.parseISO(d) - M.parseISO(last)) / 864e5 : 99;
    if (strict) {
      if (gap < 3) return false;
      if (tomorrow.some(c => kind(c) === 'leave')) return false;
      if (M.isWeekend(d) && (weekend.get(p.id) || 0) >= 2) return false;
    }
    return (calls.get(p.id) || 0) < Math.floor(7 * (p.fte || 1));
  };
  const order = (list, d) => list.slice().sort((a, b) => {
    const want = p => { const c = codes(d, p.id); return c.includes('Cr') || (M.isWeekend(d) && c.includes('Wr')) ? 1 : 0; };
    const cr = want(b) - want(a);
    return cr || ((calls.get(a.id) || 0) / (a.fte || 1)) - ((calls.get(b.id) || 0) / (b.fte || 1)) || tie.get(a.id) - tie.get(b.id);
  });
  const choose = (list, d, ok) => {
    for (const strict of [true, false]) {
      const c = order(list, d).find(p => canCall(p, d, strict) && ok(p));
      if (c) return c;
    }
    return null;
  };
  const book = (p, d) => {
    put(d, p.id, 'C');
    calls.set(p.id, (calls.get(p.id) || 0) + 1);
    lastCall.set(p.id, d);
    if (M.isWeekend(d)) weekend.set(p.id, (weekend.get(p.id) || 0) + 1);
  };
  const baby = p => p.tags.includes('babymo');
  const pairOk = p => ['srp', 'rp'].includes(p.group);   // on the junior roster (SRs and ACs are on the senior one)

  for (const d of M.monthDays(month)) {
    const sen = choose(seniors, d, () => true);
    if (sen) book(sen, d);
    const j1 = choose(juniors, d, p => !baby(p));
    if (j1) book(j1, d);
    // A Baby MO only goes on with an SRP / RP partner, never with another Baby MO.
    const j2 = choose(juniors, d, p => !baby(p) || (j1 && pairOk(j1)));
    if (j2) book(j2, d);
    // PM shift on working weekdays; the day shift on public holidays.
    const holiday = M.isHoliday(s, d);
    const dayCode = holiday ? 'PHD' : (!M.isWeekend(d) ? 'P' : '');
    if (dayCode) {
      const pr = p => (codes(d, p.id).includes('Pr') ? 1 : 0);
      const pm = juniors.slice().sort((a, b) => pr(b) - pr(a) || (pms.get(a.id) || 0) - (pms.get(b.id) || 0) || tie.get(b.id) - tie.get(a.id))
        .find(p => {
          if (!M.staffActiveOn(p, d)) return false;
          const c = codes(d, p.id);
          if (c.some(x => ['leave', 'other', 'shift'].includes(kind(x))) || c.includes('NP')) return false;
          return !M.effectiveCodes(s, d, p.id).includes('x');
        });
      if (pm) { put(d, pm.id, dayCode); pms.set(pm.id, (pms.get(pm.id) || 0) + 1); }
    }
  }
}
