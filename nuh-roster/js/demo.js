// Demo mode (?demo): a made-up department to try the app with. Every name here is invented.
import { suggestShortName } from './engine.js';
import { weeksOfYear } from './rotations.js';
import { monthIssues, dutiesOn, leaveOn, addDays, NIGHT_DUTIES } from './monthly.js';

const GIVEN = ['Alex', 'Brenda', 'Calvin', 'Dora', 'Edwin', 'Fiona', 'Gavin', 'Hazel', 'Irwin', 'Janice', 'Kelvin', 'Lorna', 'Marcus', 'Nadia',
  'Oscar', 'Petra', 'Quentin', 'Rosa', 'Silas', 'Tessa', 'Ulric', 'Vera', 'Wilbur', 'Xena', 'Yusuf', 'Zelda'];
const SURNAME = ['Tan', 'Lim', 'Ong', 'Goh', 'Chua', 'Koh', 'Teo', 'Yeo', 'Seah', 'Loh', 'Poh', 'Neo', 'Lau', 'Yap', 'Chew', 'Phua', 'Kwek', 'Sim'];
const MIDDLE = ['Wei Ming', 'Hui Min', 'Jia Hao', 'Li Ting', 'Zhi Xuan', 'Kai Wen', 'Shu Fen', 'Yi Ling', 'Jun Jie', 'Mei Xin'];
const IN_GIVEN = ['Aravind', 'Deepa', 'Harish', 'Kavitha', 'Meena', 'Pradeep', 'Ravi', 'Sunita', 'Anand', 'Lakshmi'];
const IN_SURNAME = ['Pillai', 'Nair', 'Kumar', 'Raman', 'Iyer', 'Menon', 'Rao', 'Krishnan'];

// a small fixed random sequence, so every demo starts the same
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }

export function makeDemo(date) {
  const rand = rng(7);
  const pick = a => a[Math.floor(rand() * a.length)];
  const used = new Set();
  const name = i => {
    for (let tries = 0; ; tries++) {
      const n = tries > 50 ? `${pick(GIVEN)} ${pick(SURNAME)} ${pick(MIDDLE)}` : i % 4 === 3 ? `${pick(IN_GIVEN)} ${pick(IN_SURNAME)}` : i % 2 ? `${pick(SURNAME)} ${pick(MIDDLE)}` : `${pick(GIVEN)} ${pick(SURNAME)} ${pick(MIDDLE)}`;
      if (!used.has(n)) { used.add(n); return n; }
    }
  };
  let id = 1;
  const staff = [];
  const add = (role, grade, extra = {}) => {
    const n = name(id);
    const p = { id: 'd' + id++, name: n, aliases: [suggestShortName(n)].filter(s => s && s !== n), role, grade, posting: '', subspecs: [], avoid: [], history: {}, source: 'demo', ...extra };
    staff.push(p);
    return p;
  };
  // about the size of the department on a weekday, so most rooms get their own senior and junior
  const seniorGrades = [...Array(6).fill('SC'), ...Array(17).fill('C'), 'VC', ...Array(11).fill('AC'), ...Array(4).fill('RP')];
  const subs = ['cardiac', 'cardiac', 'cardiac', 'cardiac', 'paeds', 'paeds', 'paeds', 'paeds', 'paeds', 'neuro', 'neuro', 'thoracic', 'thoracic', 'hpb', 'hpb', 'obs', 'obs'];
  seniorGrades.forEach((g, i) => add('senior', g, { subspecs: subs[i] ? [subs[i]] : [] }));
  const juniorGrades = [...Array(9).fill('Senior resident'), ...Array(20).fill('Junior resident'), ...Array(4).fill('RP'), 'Locum', 'Locum', ...Array(9).fill('MOPEX'), ...Array(6).fill('Rotating resident')];
  const postings = ['P', 'RA', 'L', 'SR', 'Neu', 'Amb', 'Cardiac', '', '', ''];
  juniorGrades.forEach((g, i) => add('junior', g, {
    posting: g === 'MOPEX' || g === 'Locum' ? '' : postings[i % postings.length],
    colour: g === 'Locum' ? 'purple' : g === 'MOPEX' && i % 4 === 0 ? 'green' : '',
  }));
  for (const p of staff) if (p.aliases[0] && staff.some(o => o !== p && o.aliases[0] === p.aliases[0])) p.aliases = [];

  // every monthly roster for the chosen month and the months either side (so changing the date,
  // or working out who is post call on the 1st, still finds them)
  const month = date.slice(0, 7);
  const days = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate();
  const seniors = staff.filter(p => p.role === 'senior'), juniors = staff.filter(p => p.role === 'junior' && p.grade !== 'MOPEX');
  const residents = juniors.filter(p => p.grade === 'Senior resident' || p.grade === 'Junior resident');
  const cardiac = seniors.filter(p => p.subspecs.includes('cardiac'));
  const hpb = seniors.filter(p => p.subspecs.includes('hpb'));
  const shift = (m, n) => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const monthly = {};
  for (const m of [shift(month, -1), month, shift(month, 1)]) {
    const nDays = new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
    const base = (+m.slice(0, 4) * 12 + +m.slice(5, 7)) * 31; // a running day number, so months follow on
    const junior = { rows: {} }, senior = { rows: {} }, liver = { rows: {} }, pain = { rows: {} }, aoh = { rows: {} };
    for (let d = 1; d <= nDays; d++) {
      const n = base + d;
      const wd = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, d).getDay();
      const weekday = wd > 0 && wd < 6;
      const j = k => juniors[(n * 5 + k) % juniors.length].name;
      const sn = k => seniors[(n * 3 + k) % seniors.length].name;
      junior.rows[d] = { r1: j(0), r2: j(1), r3: j(2), df: j(3), nf: j(4), s1am: weekday ? '' : j(9), s1pm: j(5), ref: weekday ? j(10) : '', sicumo: j(6), icureg: j(7), epid: sn(0), epin: sn(1) };
      senior.rows[d] = { cons: seniors[(n * 7) % seniors.length].name, c1: cardiac[n % cardiac.length].name, c2: cardiac[(n + 1) % cardiac.length].name, c3: j(8),
        tee: weekday ? cardiac[(n + 2) % cardiac.length].name : '', sicu: seniors[Math.floor(n / 7) % seniors.length].name };
      const week = Math.floor(n / 7);
      liver.rows[d] = { ots: seniors[(week * 5 + 2) % seniors.length].name, otj: juniors[(week * 3 + 10) % juniors.length].name,
        icu: seniors[(week * 5 + 9) % seniors.length].name, donor: hpb[week % hpb.length].name };
      if (weekday) {
        pain.rows[d] = { 'painacp.s': sn(11), 'painacp.a': residents[(n * 2) % residents.length].name, 'acute.s': sn(13), 'acute.a': residents[(n * 2 + 1) % residents.length].name,
          ...(wd === 2 || wd === 4 ? { 'chronic.s': sn(15) } : {}) };
        aoh.rows[d] = { aoh: sn(17), standby: sn(19), exts: wd === 3 ? sn(21) : '', extj: wd === 3 ? j(11) : '' };
      } else {
        pain.rows[d] = { 'acute.s': sn(13), 'acute.a': residents[(n * 2 + 1) % residents.length].name };
        aoh.rows[d] = { aoh: sn(17), standby: sn(19) };
      }
    }
    monthly[m] = { junior, senior, liver, pain, aoh, leave: { entries: [] } };
  }
  // on the chosen day five people are on leave (two seniors, three juniors); the rest of the
  // month's leave falls on other days
  const leave = { entries: [] };
  const day = n => `${month}-${String(Math.min(days, Math.max(1, n))).padStart(2, '0')}`;
  const today = +date.slice(8, 10);
  const away = [
    [seniors[5], -1, 2, 'Annual Leave', ''], [seniors[12], 0, 4, 'Annual Leave', ''],
    [juniors[7], 0, 1, 'Conference Leave', 'ASA meeting'], [juniors[15], -3, 0, 'Annual Leave', ''], [juniors[22], 0, 0, 'Off in Lieu', ''],
  ];
  for (const [p, a, b, type, remarks] of away) leave.entries.push({ name: p.name, from: day(today + a), to: day(today + b), type, remarks });
  const onLeave = new Set(away.map(x => x[0].name));
  for (let k = 0; k < 22; k++) {
    const p = staff[(k * 11 + 5) % staff.length];
    if (onLeave.has(p.name)) continue;
    const len = Math.floor(rand() * 4);
    // before or after the chosen day, never over it
    const from = k % 2 ? today + 1 + Math.floor(rand() * Math.max(1, days - today)) : Math.max(1, today - 1 - len - Math.floor(rand() * Math.max(1, today - 1)));
    const to = Math.min(days, from + len);
    if (from <= today && to >= today) continue;
    if (from > days || to < 1) continue;
    leave.entries.push({ name: p.name, from: day(from), to: day(to), type: k % 7 === 2 ? 'Medical Leave' : k % 5 === 4 ? 'Off in Lieu' : 'Annual Leave', remarks: '' });
  }
  monthly[month].leave = leave;
  tidyMonthly(monthly, staff);
  // rotations for the year and the next: residents move every 4 to 12 weeks; MOPEX and locums don't rotate
  const rotations = { weeks: {} };
  const ROT = ['P', 'RA', 'Neu', 'SR', 'Cardiac', 'L', 'Amb', 'ENT', 'Vasc', 'HPB', 'Remote', 'PACU'];
  const y = +date.slice(0, 4);
  const allWeeks = [...weeksOfYear(y), ...weeksOfYear(y + 1)].filter((m, i, a) => a.indexOf(m) === i);
  staff.filter(p => p.role === 'junior' && !['MOPEX', 'Locum'].includes(p.grade)).forEach((p, i) => {
    let w = 0, k = i;
    while (w < allWeeks.length) {
      const len = 4 + Math.floor(rand() * 9);
      for (const m of allWeeks.slice(w, w + len)) (rotations.weeks[m] ||= {})[p.id] = ROT[k % ROT.length];
      w += len; k += 3;
    }
  });
  return { staff, monthly, rotations, notes: demoNotes(date) };
}

// Two seniors on an admin day, different each day (and not anyone on leave that day).
export function demoAdmin(date, staff, onLeave = new Set()) {
  const seniors = staff.filter(p => p.role === 'senior' && !onLeave.has(p.name));
  const d = Math.round(new Date(date + 'T12:00') / 864e5);
  const a = seniors[(d * 7) % seniors.length], b = seniors[(d * 7 + 11) % seniors.length];
  return [...new Set([a, b])].map(p => p.id);
}

// Case notes for a demo day: most rooms on weekdays (varying by date), emergencies only at weekends.
const NOTES = { 'KROR 2': 'tkr x2', 'KROR 3': 'acl', 'KROR 5': 'shoulder', 'MCOR 1': 'lap chole', 'MCOR 3': 'eye 5y', 'MCOR 4': 'hernia', 'MCOR 6': 'ent 3y',
  'MOR 1': 'craniotomy', 'MOR 2': 'lscs', 'MOR 3': 'whipple', 'MOR 4': 'vats lobectomy', 'MOR 5': 'eye', 'MOR 12': 'cabg', 'MOR 13': 'avr', 'MOR 15': 'thr', 'MOR 16': 'nil' };
const MORE = { 'KROR 4': 'hip scope', 'KROR 6': 'carpal tunnel', 'MCOR 2': 'lap appendix', 'MCOR 5': 'pas 4y', 'MCOR 7': 'tonsils 6y', 'MOR 6': 'evar', 'MOR 10': 'thyroid', 'MOR 11': 'mastectomy', 'MOR 14': 'tka', 'MOR 17': 'hepatectomy' };
export function demoNotes(date) {
  const wd = new Date(date + 'T12:00').getDay();
  if (wd === 0 || wd === 6) return { 'MOR 1': 'emergency crani', 'MOR 2': 'lscs' };
  const d = +date.slice(8, 10);
  const out = { ...NOTES };
  Object.entries(MORE).forEach(([room, note], i) => { if ((i + d) % 3) out[room] = note; });
  if (d % 2) delete out['MOR 4'];
  return out;
}

// Made-up rosters are built by counting round the staff list, so some days clash (a duty on someone's leave,
// a day duty after a night). Swap those for someone free, as a real rota would, so Practice starts clean.
function tidyMonthly(monthly, staff) {
  const byName = new Map(staff.map(p => [p.name, p]));
  const personOf = t => byName.get(t) || null;
  for (let pass = 0; pass < 4; pass++) {
    let fixed = 0;
    for (const month of Object.keys(monthly).sort()) {
      for (const issue of monthIssues(monthly, month, personOf)) {
        if (issue.level !== 'error') continue;
        const d = +issue.date.slice(8, 10), row = monthly[month][issue.kind]?.rows?.[d];
        const cur = row && personOf(row[issue.key]);
        if (!cur) continue;
        // someone of the same role and grade group who has nothing that day or the night before, and isn't away
        // liver and AOH are on-call standbys, so a night before doesn't rule anyone out for them
        // cardiac call and TEE need a cardiac senior, the liver donor an HPB one; anyone of the same role otherwise
        const need = issue.kind === 'senior' && ['c1', 'c2', 'tee'].includes(issue.key) ? 'cardiac' : issue.kind === 'liver' && issue.key === 'donor' ? 'hpb' : '';
        const busy = new Set([issue.date, addDays(issue.date, -1)].flatMap(date => Object.values(dutiesOn(monthly, date)).flatMap(Object.values)));
        const away = new Set(leaveOn(monthly, issue.date).map(e => e.name));
        const pick = staff.find(p => p.role === cur.role && (p.grade === 'MOPEX') === (cur.grade === 'MOPEX') && p.id !== cur.id && !busy.has(p.name) && !away.has(p.name)
          && (!need || (p.subspecs || []).includes(need)));
        const sameDay = new Set(Object.values(dutiesOn(monthly, issue.date)).flatMap(Object.values));
        const nightBefore = new Set(Object.entries(dutiesOn(monthly, addDays(issue.date, -1))).flatMap(([kind, r]) => Object.entries(r).filter(([key]) => NIGHT_DUTIES.includes(`${kind}.${key}`)).map(([, v]) => v)));
        const ok = (p, strict) => p.role === cur.role && p.id !== cur.id && (p.subspecs || []).includes(need) && (['liver', 'aoh'].includes(issue.kind) || !nightBefore.has(p.name)) && !away.has(p.name) && (!strict || !sameDay.has(p.name));
        const pickLoose = pick || (need && (staff.find(p => ok(p, true)) || staff.find(p => ok(p, false))));
        if (pickLoose) { row[issue.key] = pickLoose.name; fixed++; continue; }
        // no one suitable for the day duty (e.g. a cardiac list): move the night before instead
        const a = issue.after, arow = a && monthly[a.date.slice(0, 7)]?.[a.kind]?.rows?.[+a.date.slice(8, 10)];
        const night = arow && personOf(arow[a.key]);
        if (!night) continue;
        const busy2 = new Set([a.date, addDays(a.date, -1), issue.date].flatMap(date => Object.values(dutiesOn(monthly, date)).flatMap(Object.values)));
        const away2 = new Set([...leaveOn(monthly, a.date), ...leaveOn(monthly, issue.date)].map(e => e.name));
        const pick2 = staff.find(p => p.role === night.role && (p.grade === 'MOPEX') === (night.grade === 'MOPEX') && !busy2.has(p.name) && !away2.has(p.name));
        if (pick2) { arow[a.key] = pick2.name; fixed++; }
      }
    }
    if (!fixed) break;
  }
}
