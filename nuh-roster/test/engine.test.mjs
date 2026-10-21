// Run with: node nuh-roster/test/engine.test.mjs  (fake names only)
import assert from 'node:assert/strict';
import { matchName, namesInCell, suggestFlags, generate, check, tickFromHistory, suggestShortName, suggestShortNames } from '../js/engine.js';

const P = (id, name, role, extra = {}) => ({ id, name, role, grade: role === 'senior' ? 'C' : 'Junior resident', aliases: [], posting: '', subspecs: [], avoid: [], ...extra });

// names
const staff0 = [P('a', 'Koh Yi Wen', 'senior'), P('b', 'Seah Mei Ping', 'senior'), P('c', 'Koh Yi Ling', 'senior')];
assert.equal(matchName('Koh YW', staff0).person.id, 'a');
assert.equal(matchName('Seah MP', staff0).person.id, 'b');
assert.ok(matchName('Koh', staff0).ambiguous);
assert.deepEqual(namesInCell('Melody am /Seah MP pm'), ['Melody', 'Seah MP']);
assert.deepEqual(namesInCell('Ravindra (Seah MP C)'), ['Ravindra']);
assert.deepEqual(namesInCell('Brandon Ong -mtg 8.30, 3.30'), ['Brandon Ong']);
assert.deepEqual(namesInCell('Yeo Shu-Lin (AOH 3)'), ['Yeo Shu-Lin']);

// flags
assert.deepEqual(suggestFlags('pras 10mo').subspecs, ['paeds']);
assert.deepEqual(suggestFlags('c').subspecs, ['cardiac']);
assert.deepEqual(suggestFlags('scoli 28y').subspecs, []);
assert.equal(suggestFlags('scoli 28y').complex, true);
assert.deepEqual(suggestFlags('eye').subspecs, []);
assert.deepEqual(suggestFlags('', undefined, 'MOR 12').subspecs, ['cardiac'], 'MOR 12 is cardiac by default');
assert.deepEqual(suggestFlags('c', undefined, 'mor 13').subspecs, ['cardiac'], 'no duplicate, case-insensitive room');
assert.deepEqual(suggestFlags('', undefined, 'MOR 11').subspecs, []);
{
  const st = [{ id: 'x', role: 'senior', subspecs: ['neuro'], history: { cardiac: 2, paeds: 1 } }, { id: 'y', role: 'junior', history: { paeds: 3 } }];
  assert.equal(tickFromHistory(st, 2), 1);
  assert.deepEqual(st[0].subspecs, ['neuro', 'cardiac']);
  assert.equal(tickFromHistory(st, 1), 1);
  assert.equal(st[1].subspecs, undefined, 'juniors untouched');
}

// generation
const room = (id, name, complex, notes = '') => ({ id, name, complex, running: true, notes, flags: suggestFlags(notes), session: 'full' });
const staff = [
  P('s1', 'Senior Paeds', 'senior', { subspecs: ['paeds'] }),
  P('s2', 'Senior Cardiac', 'senior', { subspecs: ['cardiac'] }),
  P('s3', 'Senior General', 'senior', { avoid: ['eye'] }),
  P('j1', 'Junior Baby', 'junior', { grade: 'MOPEX', colour: 'green' }),
  P('j2', 'Junior Resident', 'junior'),
  P('j3', 'Junior Mopex', 'junior', { grade: 'MOPEX' }),
  P('j4', 'Junior Paeds', 'junior', { posting: 'P' }),
];
const day = {
  rooms: [room('r1', 'MCOR 1', 'MCOR', 'ent 3y'), room('r2', 'MOR 12', 'MOR', 'c'), room('r3', 'MCOR 2', 'MCOR', 'eye'), room('r4', 'MCOR 3', 'MCOR', 'hernia')],
  staff: { j2: { notAroundPrev: true } },
};
for (let seed = 1; seed < 30; seed++) {
  const g = generate({ staff, day, seed });
  const by = Object.fromEntries(g.rows.map(r => [r.label, r]));
  assert.match(by['MCOR 1'].senior, /Senior Paeds/, 'paeds room gets the paeds senior');
  assert.match(by['MOR 12'].senior, /Senior Cardiac/, 'cardiac room gets the cardiac senior');
  assert.doesNotMatch(by['MCOR 2'].senior, /Senior General/, "senior who doesn't do eye isn't given eye");
  // one double cover is needed (3 seniors, 4 rooms): Baby MO must not be in a double-covered room
  const counts = {};
  g.rows.forEach(r => r.senior.split(' / ').filter(Boolean).forEach(s => { counts[s] = (counts[s] || 0) + 1; }));
  for (const r of g.rows) {
    if (r.junior.includes('Junior Baby')) assert.ok(r.senior.split(' / ').every(s => counts[s] === 1), `Baby MO in double-covered room (seed ${seed})`);
  }
  assert.match(by['MCOR 1'].junior, /Junior Paeds/, 'paeds posting junior goes to the paeds list');
  const withJ2 = g.rows.find(r => r.complex !== 'Clinic' && r.junior.includes('Junior Resident'));
  if (withJ2) assert.ok(withJ2.premed && !withJ2.premed.includes('Junior Resident') && !withJ2.premed.includes('Junior Baby'), 'premed cover from someone around yesterday, not a Baby MO');
  const errs = check({ rows: g.rows, staff, day }).filter(w => w.level === 'error');
  assert.deepEqual(errs, [], JSON.stringify(errs));
}

// checks catch hand edits
const bad = [{ roomId: 'r1', label: 'MCOR 1', complex: 'MCOR', senior: 'Senior General', junior: 'Junior Baby', premed: '', notes: 'ent 3y' }];
const out = check({ rows: bad, staff, day: { ...day, staff: { s3: { status: 'leave' } } } }).map(w => w.text).join('\n');
assert.match(out, /on leave/);
assert.match(out, /Paeds list/);
{
  // live checks that used to exist only as generator notes, or not at all
  const r = (roomId, label, senior, junior) => ({ roomId, label, complex: 'MCOR', senior, junior, premed: '', notes: '' });
  const day2 = { rooms: day.rooms.map(x => ({ ...x, flags: { subspecs: [], complex: false, long: false } })), staff: {} };
  const texts = rows => check({ rows, staff, day: day2 }).map(w => `${w.level}|${w.fix || ''}|${w.text}`);
  // double cover with no junior in one of the rooms
  let t = texts([r('r3', 'MCOR 2', 'Senior General', ''), r('r4', 'MCOR 3', 'Senior General', 'Junior Resident')]);
  assert.ok(t.some(x => /^error\|fill\|MCOR 2: no junior, and the senior is double covering/.test(x)), t.join('\n'));
  // AH OT is its own job, not a second room: a senior on AH OT and one room isn't double covering
  t = texts([{ roomId: 'ahot', label: 'AH OT', complex: 'Clinic', senior: 'Senior General', junior: '', premed: '', notes: '' }, r('r3', 'MCOR 2', 'Senior General', '')]);
  assert.ok(!t.some(x => /double covering|rooms \(/.test(x)), t.join('\n'));
  assert.ok(!t.some(x => /MCOR 3: no junior/.test(x)));
  // a cover from another room counts as a junior
  t = texts([r('r3', 'MCOR 2', 'Senior General', 'Junior Mopex C'), r('r4', 'MCOR 3', 'Senior General', 'Junior Resident')]);
  assert.ok(!t.some(x => /no junior/.test(x)), t.join('\n'));
  // one senior in three rooms
  t = texts([r('r1', 'MCOR 1', 'Senior General', 'Junior Paeds'), r('r3', 'MCOR 2', 'Senior General', 'Junior Mopex'), r('r4', 'MCOR 3', 'Senior General', 'Junior Resident')]);
  assert.ok(t.some(x => /^error\|reseat\|Senior General is the senior in 3 rooms/.test(x)), t.join('\n'));
  // senior in one room and junior in another
  t = texts([r('r1', 'MCOR 1', 'Senior Paeds', 'Junior Paeds'), r('r3', 'MCOR 2', 'Senior General', 'Senior Paeds')]);
  assert.ok(t.some(x => /^warn\|reseat\|Senior Paeds is the senior in MCOR 1 and the junior in MCOR 2/.test(x)), t.join('\n'));
  // admin day / elsewhere on a list
  const t2 = check({ rows: [r('r4', 'MCOR 3', 'Senior General', 'Junior Resident')], staff, day: { ...day2, staff: { s3: { status: 'admin' }, j2: { status: 'elsewhere' } } } }).map(w => `${w.level}|${w.fix}|${w.text}`);
  assert.ok(t2.some(x => /^warn\|takeOff\|Senior General is on an admin day/.test(x)), t2.join('\n'));
  assert.ok(t2.some(x => /^warn\|takeOff\|Junior Resident is elsewhere today/.test(x)), t2.join('\n'));
  console.log('live check tests passed');
}
assert.equal(suggestShortName('Koh Yi Wen'), 'Koh YW');
assert.equal(suggestShortName('Lim Xinyi'), 'Xinyi');
assert.equal(suggestShortName('Anjali Varma'), 'Anjali');
assert.equal(suggestShortName('Gavin Teo Wen Hao'), 'G Teo');
assert.equal(suggestShortName('Robert Ashford'), 'R Ashford');
assert.equal(suggestShortName('Clara Louise Chew Hui Min'), 'C Chew');
assert.equal(suggestShortName('Mary Ann Tan'), 'M Tan');
assert.equal(suggestShortName('Kenneth Pang Wei Te'), 'K Pang');
assert.equal(suggestShortName('Rebecca Victoria Lau Rui Xin'), 'R Lau');
assert.equal(suggestShortName('Yeo Shu-Lin'), 'Yeo SL');
{
  const st = [P('a', 'Koh Yi Wen', 'senior'), P('b', 'Koh Yu Wei', 'junior'), P('c', 'Anjali Varma', 'senior'), P('d', 'Ong Kah Seng', 'senior', { aliases: ['Ong KS'] }), P('e', 'Anjali Rao', 'junior')];
  assert.deepEqual(suggestShortNames(st), [], 'clashing suggestions and people with short names are skipped');
  st.pop(); st.splice(1, 1);
  assert.deepEqual(suggestShortNames(st).map(x => x.short), ['Koh YW', 'Anjali']);
}
console.log('engine tests passed');

// contact list merging (fake names)
{
  const { mergeContacts, findSameStaff } = await import('../js/engine.js');
  const { cleanContactName } = await import('../js/xlsxio.js');
  assert.equal(cleanContactName('Dr Wee Peng Hock, Dennis'), 'Dennis Wee Peng Hock');
  assert.equal(cleanContactName('A/Prof Melody Goh Bee Hoon '), 'Melody Goh Bee Hoon');
  assert.equal(cleanContactName('Dr Kamala D/O Subramaniam'), 'Kamala Subramaniam');
  assert.equal(cleanContactName('Dr Ng Kai (SAF)'), 'Ng Kai');
  const staff = [P('a', 'Melody Goh', 'senior'), P('b', 'Dennis Wee', 'senior', { grade: 'AC' }), P('c', 'Zara Lim', 'senior')];
  assert.equal(findSameStaff('Melody Goh Bee Hoon', staff).id, 'a');
  let n = 0;
  const res = mergeContacts(staff, [
    { name: 'Melody Goh Bee Hoon', role: 'senior', grade: 'C', subspecs: ['cardiac'] },
    { name: 'Dennis Wee Peng Hock', role: 'senior', grade: 'C', subspecs: [] },
    { name: 'New Person Senior', role: 'senior', grade: 'AC', subspecs: ['paeds'] },
    { name: 'New Junior Person', role: 'junior', grade: 'MOPEX', subspecs: [] },
  ], () => 'n' + ++n);
  assert.deepEqual(res.staff.find(p => p.id === 'a').subspecs, ['cardiac']);
  assert.equal(res.staff.find(p => p.id === 'b').grade, 'C');
  assert.ok(res.staff.some(p => p.name === 'New Person Senior'));
  assert.deepEqual(res.skipped, ['New Junior Person']);
  assert.deepEqual(staff[0].subspecs, [], 'input not mutated');
  console.log('contact tests passed');
}

// leave and cover tags
{
  const { missingCovers, namesInCell: nic } = await import('../js/engine.js');
  assert.deepEqual(nic('Koh YW L-4pm / Lee AB C-OT13'), ['Koh YW', 'Lee AB']);
  assert.deepEqual(nic('Koh YW L-4-5pm'), ['Koh YW']);
  const rows = [
    { roomId: 'a', label: 'MOR 13', complex: 'MOR', senior: 'Senior One L-4pm', junior: '' },
    { roomId: 'b', label: 'MOR 14', complex: 'MOR', senior: 'Senior Two', junior: '' },
  ];
  assert.equal(missingCovers(rows).length, 1);
  rows[1].senior = 'Senior Two C-OT13';
  assert.equal(missingCovers(rows).length, 0);
  rows.push({ roomId: 'c', label: 'KROR PACU', complex: 'KROR', senior: 'Senior Three L-4-5pm', junior: '' });
  assert.equal(missingCovers(rows).length, 1);
  rows[1].junior = 'Junior Four C-KROR PACU';
  assert.equal(missingCovers(rows).length, 0, 'cover by full room name, from another complex');
  rows[1].senior = 'Senior Two C-13';
  assert.equal(missingCovers(rows).length, 0, 'bare number means own complex');
  const r2 = [
    { roomId: 'a', label: 'MOR 13', complex: 'MOR', senior: 'Senior One', junior: 'Junior Five L-3pm' },
    { roomId: 'b', label: 'MOR 14', complex: 'MOR', senior: 'Senior Two', junior: 'Junior Six' },
  ];
  assert.equal(missingCovers(r2).length, 1);
  r2[0].junior = 'Junior Five L-3pm / Junior Six (C)';
  assert.equal(missingCovers(r2).length, 0, '"Name (C)" in the room counts as its cover');
  const st = [P('j5', 'Junior Five', 'junior'), P('j6', 'Junior Six', 'junior'), P('s1', 'Senior One', 'senior'), P('s2', 'Senior Two', 'senior')];
  const day = { rooms: [{ id: 'a', name: 'MOR 13' }, { id: 'b', name: 'MOR 14' }], staff: {} };
  assert.ok(!check({ rows: r2, staff: st, day }).some(w => /junior in/.test(w.text)), 'an ad hoc cover is not a second junior posting');
  // short of juniors: a room is covered "(C)" by a junior from the same complex rather than left empty
  {
    const st = [P('s1', 'Senior One', 'senior'), P('s2', 'Senior Two', 'senior'), P('s3', 'Senior Three', 'senior'), P('j1', 'Junior One', 'junior'), P('j2', 'Junior Two', 'junior')];
    const mk = (id, name) => ({ id, name, complex: 'MOR', running: true, notes: '', session: 'full' });
    const day = { rooms: [mk('m1', 'MOR 1'), mk('m2', 'MOR 2'), mk('m3', 'MOR 3')], staff: {} };
    const res = generate({ staff: st, day, seed: 3 });
    const rows = res.rows.filter(r => /^MOR/.test(r.label));
    assert.equal(rows.filter(r => /\(C\)/.test(r.junior)).length, 1, 'one room gets an ad hoc cover');
    assert.ok(rows.every(r => r.junior), 'no room left without a junior');
    assert.ok(!check({ rows: res.rows, staff: st, day }).some(w => /junior in/.test(w.text)));
  }
  console.log('cover tests passed');
}

// AOCC gets a senior and two juniors; AIC a spare consultant or a senior resident
{
  const st = [
    P('s1', 'Senior A', 'senior'), P('s2', 'Senior B', 'senior'), P('s3', 'Senior C', 'senior'),
    P('j1', 'Junior A', 'junior'), P('j2', 'Junior B', 'junior'), P('j3', 'Junior C', 'junior'),
    P('j4', 'Junior SR', 'junior', { grade: 'Senior resident' }),
  ];
  const dy = { rooms: [room('r1', 'MOR 1', 'MOR', 'hernia')], staff: {} };
  const g = generate({ staff: st, day: dy, seed: 5 });
  const by = Object.fromEntries(g.rows.map(r => [r.label, r]));
  assert.ok(by['AOCC'].senior, 'AOCC has a senior');
  assert.equal(by['AOCC'].junior.split(' / ').length, 2, 'AOCC has two juniors');
  assert.ok(by['AIC'].senior, 'AIC filled');
  assert.equal(by['AH OT'].senior, '', 'AH OT left for hand entry');
  const fixedDay = { ...dy, fixed: { ahot: 'Senior C', aic: 'Junior SR' } };
  const g2 = generate({ staff: st, day: fixedDay, seed: 5 });
  assert.equal(g2.rows.find(r => r.label === 'AH OT').senior, 'Senior C');
  assert.equal(g2.rows.find(r => r.label === 'AIC').senior, 'Junior SR');
  console.log('special row tests passed');
}

// monthly rosters (fake names only)
{
  const M = await import('../js/monthly.js');
  assert.deepEqual(M.parseTitle('Anaesthesia - Junior On Call Roster For Oct 2022'), { kind: 'junior', month: '2022-10' });
  assert.equal(M.parseTitle('Anaesthesia - Liver Transplant Roster (new) For Oct 2022').kind, 'liver');
  assert.equal(M.parseTitle('Anaesthesia - Night List (After Office Hr) Roster For Oct 2022').kind, 'aoh');
  assert.deepEqual(M.parsePeriod('1 Oct - 4 Oct', '2022-10'), { from: '2022-10-01', to: '2022-10-04' });
  assert.deepEqual(M.parsePeriod('6 Oct', '2022-10'), { from: '2022-10-06', to: '2022-10-06' });
  assert.deepEqual(M.parsePeriod('30 Dec - 2 Jan', '2022-12'), { from: '2022-12-30', to: '2023-01-02' });
  assert.equal(M.formatPeriod({ from: '2022-10-01', to: '2022-10-04' }), '1 Oct - 4 Oct');
  // a page of PDF text: header centres, then a row per day
  const page = [
    { str: 'Anaesthesia - Junior On Call Roster For Oct 2022', x: 177, y: 811, w: 257 },
    { str: 'R1', x: 146, y: 748, w: 8 }, { str: 'R2', x: 238, y: 748, w: 8 }, { str: 'Day Float', x: 414, y: 748, w: 27 },
    { str: '1', x: 41, y: 731, w: 3 }, { str: 'Sat', x: 76, y: 731, w: 9 }, { str: 'Junior Alpha', x: 109, y: 731, w: 50 }, { str: 'Junior Beta []', x: 201, y: 731, w: 50 }, { str: 'Junior Gamma', x: 386, y: 731, w: 50 },
  ];
  const r = M.readMonthlyPdf([page]);
  assert.equal(r.kind, 'junior');
  assert.deepEqual(r.data.rows[1], { r1: 'Junior Alpha', r2: 'Junior Beta', df: 'Junior Gamma' });
  const monthly = { '2022-10': { junior: r.data, leave: { entries: [{ name: 'Senior One', from: '2022-10-01', to: '2022-10-03', type: 'Medical Leave' }] } } };
  assert.equal(M.generalFromMonthly(monthly, '2022-10-01')['mot.res1'], 'Junior Alpha');
  assert.equal(M.generalFromMonthly(monthly, '2022-10-01')['epi.df'], 'Junior Gamma');
  assert.equal(M.leaveOn(monthly, '2022-10-03').length, 1);
  assert.equal(M.leaveOn(monthly, '2022-10-04').length, 0);
  assert.ok(M.NIGHT_DUTIES.includes('junior.r1') && !M.NIGHT_DUTIES.includes('junior.df'));
  console.log('monthly tests passed');
}

// the liver standby junior gets (L) and isn't given the complex list
{
  const st = [P('s1', 'Senior One', 'senior'), P('s2', 'Senior Two', 'senior'), P('j1', 'Junior Liver', 'junior'), P('j2', 'Junior Other', 'junior')];
  const mk = (id, name, complex) => ({ id, name, complex: 'MOR', running: true, notes: '', session: 'full', flags: { subspecs: [], complex, long: false }, flagsManual: true });
  for (let seed = 1; seed <= 10; seed++) {
    const day = { rooms: [mk('m1', 'MOR 1', true), mk('m2', 'MOR 2', false)], staff: { j1: { liverStandby: true } } };
    const res = generate({ staff: st, day, seed });
    const m1 = res.rows.find(r => r.label === 'MOR 1'), m2 = res.rows.find(r => r.label === 'MOR 2');
    assert.ok(!m1.junior.includes('Junior Liver'), `liver standby junior on the complex list (seed ${seed})`);
    assert.ok(m2.junior.includes('Junior Liver (L)'));
  }
  console.log('liver standby tests passed');
}

// duplicates and import review (fake names only)
{
  const { findDuplicates, sameNameScore, mergeStaffRecords, planImport } = await import('../js/engine.js');
  const st = [P('a', 'Koh Yi Wen', 'senior'), P('b', 'Koh Yi Wen Gerald', 'senior'), P('c', 'Divya', 'junior'), P('d', 'Divya Ramesh', 'junior'),
    P('e', 'Wu Jiahui', 'junior'), P('f', 'Jiahui Wu', 'junior'), P('g', 'Lim Wei Ming', 'senior'), P('h', 'Lim Wei Ling', 'senior')];
  assert.equal(sameNameScore(st[4], st[5]), 3, 'same name in another order');
  assert.ok(sameNameScore(st[0], st[1]) >= 2, 'an extra name');
  assert.ok(sameNameScore({ name: 'Koh YW' }, st[1]) >= 2, 'initials');
  assert.equal(sameNameScore(st[6], st[7]), 0, 'different people');
  const pairs = findDuplicates(st).map(x => [x.a.id, x.b.id].sort().join(''));
  assert.ok(pairs.includes('ef') && pairs.includes('cd'), 'finds reordered and short-name duplicates');
  assert.ok(!pairs.includes('gh'));
  st[4].notDup = ['f'];
  assert.ok(!findDuplicates(st).some(x => [x.a.id, x.b.id].sort().join('') === 'ef'), 'pairs marked different are left out');
  const m = mergeStaffRecords({ ...st[3], subspecs: ['paeds'] }, { ...st[2], subspecs: ['neuro'], colour: 'green' });
  assert.deepEqual(m.aliases, ['Divya']);
  assert.deepEqual(m.subspecs, ['paeds', 'neuro']);
  assert.equal(m.colour, 'green');
  const plan = planImport([P('x', 'Koh Yi Wen', 'senior')], [
    { name: 'Koh Yi Wen', role: 'senior', grade: 'SC', subspecs: [] },
    { name: 'Koh Yi Wen Gerald', role: 'senior', grade: 'C', subspecs: [] },
    { name: 'New Senior Person', role: 'senior', grade: 'AC', subspecs: [] },
    { name: 'New Junior Person', role: 'junior', grade: 'MOPEX', subspecs: [] },
    { name: 'Skipped Person', role: 'senior', grade: 'C', subspecs: [] },
  ], { skip: ['skipped person'] });
  assert.deepEqual(plan.items.map(i => i.kind), ['match', 'maybe', 'new', 'newJunior', 'skipped']);
  assert.deepEqual(plan.items[0].changes, ['grade C → SC']);
  assert.equal(plan.items[1].candidates[0].id, 'x');
  console.log('duplicate tests passed');
}

// a fixed person who isn't working isn't put in; one ad hoc cover per junior
{
  const st = [P('s1', 'Senior One', 'senior'), P('s2', 'Senior Two', 'senior'), P('s3', 'Senior Three', 'senior'), P('j1', 'Junior One', 'junior')];
  const mk = (id, name, extra = {}) => ({ id, name, complex: 'MOR', running: true, notes: '', session: 'full', ...extra });
  const day = { rooms: [mk('m1', 'MOR 1', { lockSenior: 's1' }), mk('m2', 'MOR 2'), mk('m3', 'MOR 3')], staff: { s1: { status: 'leave' } } };
  const res = generate({ staff: st, day, seed: 2 });
  assert.ok(!res.rows.some(r => r.senior.includes('Senior One')), 'fixed senior on leave is left out');
  assert.ok(res.warnings.some(w => /fixed here but isn't working/.test(w.text)));
  const covers = res.rows.filter(r => /\(C\)/.test(r.junior)).length;
  assert.ok(covers <= 1, `one junior covers at most one other room (got ${covers})`);
  console.log('fixed and cover cap tests passed');
}

// review fixes: MC check, surname vs initials, trailing English name, month words, wrapped PDF lines
{
  const { parsePeriod, readMonthlyPdf, addDays } = await import('../js/monthly.js');
  const st = [P('s1', 'Senior One', 'senior'), P('n', 'Nathan Goh', 'senior')];
  const rows = [{ roomId: 'a', label: 'MOR 1', complex: 'MOR', senior: 'Senior One', junior: '' }];
  assert.match(check({ rows, staff: st, day: { rooms: [], staff: { s1: { status: 'mc' } } } }).map(w => w.text).join(), /on MC/);
  assert.equal(matchName('Ng', st).person, undefined, 'a surname is not initials');
  assert.equal(suggestShortName('Koh Yi Wen Gerald'), 'Koh YW');
  assert.equal(parsePeriod('6 Okt', '2022-10').from, '2022-10-06');
  assert.equal(addDays('2022-12-31', 1), '2023-01-01');
  const it = (str, x, y, w = 30) => ({ str, x, y, w });
  const page = [it('Anaesthesia - Night List (After Office Hr) Roster', 100, 800), it('For Oct 2022', 300, 800),
    it('AOH', 100, 700, 40), it('AOH Standby', 190, 700, 60),
    it('1', 20, 680, 8), it('Sat', 40, 680, 15), it('Alpha One', 100, 680, 50), it('Bravo', 190, 680, 40),
    it('2', 20, 660, 8), it('Sun', 40, 660, 15), it('Charlie', 100, 665, 40), it('Delta', 100, 655, 40), it('Echo', 190, 660, 40)];
  const res = readMonthlyPdf([page, [it('3', 20, 780, 8), it('Mon', 40, 780, 15), it('Foxtrot', 100, 780, 40)]]);
  assert.equal(res.data.rows[2].aoh, 'Charlie Delta', 'a name wrapped onto two lines');
  assert.equal(res.data.rows[3].aoh, 'Foxtrot', 'a page without headers');
  console.log('review fix tests passed');
}

// rotations: weeks, postings on a date, reading a sheet (fake names only)
{
  const R = await import('../js/rotations.js');
  assert.equal(R.mondayOf('2026-10-18'), '2026-10-12');
  assert.equal(R.weeksOfYear(2026)[0], '2025-12-29');
  assert.equal(R.postingCode('Paeds'), 'P');
  assert.equal(R.postingCode('liver'), 'L');
  assert.equal(R.postingCode('banana'), null);
  assert.equal(R.headerDate('14/10/2026', 2026), '2026-10-12');
  assert.equal(R.headerDate('12 Oct', 2026), '2026-10-12');
  const rot = R.emptyRotations();
  const j = { id: 'j1', role: 'junior', posting: 'RA' };
  R.setWeeks(rot, 'j1', ['2026-10-12'], 'P');
  assert.equal(R.postingOn(rot, j, '2026-10-15'), 'P');
  assert.equal(R.postingOn(rot, j, '2026-10-20'), 'RA', 'the usual posting outside the rotation');
  assert.equal(R.postingOn(rot, j, '2026-10-15', 'Neu'), 'Neu', "the day's change wins");
  assert.equal(R.postingOn(rot, { id: 's', role: 'senior', posting: '' }, '2026-10-15'), '');
  // a sheet: a title row, then names and Mondays
  const grid = [['Rotations 2026'], ['Name', 'Usual', new Date(Date.UTC(2026, 9, 12)), '19 Oct', '26/10/2026'],
    ['Alpha Junior', 'RA', 'Paeds', 'Paeds', 'Neuro'], ['Nobody Known', '', 'P'], ['Bravo Junior', '', '', 'Cardiac', 'Mystery']];
  const ws = { eachRow: (_, fn) => grid.forEach((vals, i) => fn({ eachCell: (_o, f) => vals.forEach((v, c) => f({ value: v }, c + 1)) }, i + 1)) };
  const cellText = v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '');
  const staffR = [{ id: 'a', name: 'Alpha Junior' }, { id: 'b', name: 'Bravo Junior' }];
  const res = R.readRotationSheet(ws, cellText, n => staffR.find(p => p.name === n) || null, 2026);
  assert.deepEqual(res.mondays, ['2026-10-12', '2026-10-19', '2026-10-26']);
  assert.deepEqual(res.people, ['a', 'b']);
  assert.equal(res.weeks['2026-10-12'].a, 'P');
  assert.equal(res.weeks['2026-10-26'].a, 'Neu');
  assert.equal(res.weeks['2026-10-19'].b, 'Cardiac');
  assert.deepEqual(res.unmatched, ['Nobody Known']);
  assert.deepEqual(res.unknown, ['Mystery']);
  console.log('rotation tests passed');
}

{
  // what changed since the roster was sent
  const { rosterChanges, changeText } = await import('../js/engine.js');
  const { buildLayout } = await import('../js/layout.js');
  const before = [{ label: 'MOR 1', senior: 'A', junior: 'B' }, { label: 'MOR 2', senior: 'C', junior: '' }, { label: 'MOR 3', senior: '', junior: '' }];
  const after = [{ label: 'MOR 1', senior: 'A', junior: 'D' }, { label: 'MOR 2', senior: '', junior: '' }, { label: 'MOR 4', senior: 'E', junior: '', premed: 'F' }];
  const c = rosterChanges(before, after).map(changeText);
  assert.deepEqual(c, ['MOR 1 junior: B → D', 'MOR 2 senior: C → (none)', 'MOR 4 senior: (none) → E', 'MOR 4 premed: (none) → F']);
  assert.deepEqual(rosterChanges(before, before), []);
  const stamped = buildLayout({ date: '2026-10-14', rows: [], stamp: 'Updated 09:15' }).cells.find(x => x.text === 'Updated 09:15');
  assert.ok(stamped && stamped.r === 4, 'the stamp sits above the date row');
  assert.ok(!buildLayout({ date: '2026-10-14', rows: [] }).cells.some(x => x.r === 4), 'no stamp on a first send');
  console.log('sent changes tests passed');
}

{
  // clashes the monthly rosters show before the day
  const { monthIssues } = await import('../js/monthly.js');
  const people = { A: { id: 'a', name: 'A' }, B: { id: 'b', name: 'B' }, C: { id: 'c', name: 'C' } };
  const personOf = t => people[t] || null;
  const monthly = { '2026-10': {
    junior: { rows: { 1: { r1: 'A', nf: 'A' }, 2: { df: 'A', r1: 'B' }, 3: { r1: 'C', r2: '' } } },
    liver: { rows: { 2: { otj: 'B' } } },
    pain: { rows: { 3: { 'acute.a': 'B' } } },
    leave: { entries: [{ name: 'C', from: '2026-10-03', to: '2026-10-03', type: 'Annual Leave' }] },
  } };
  const t = monthIssues(monthly, '2026-10', personOf).map(i => `${i.date.slice(8)} ${i.level} ${i.text}`);
  assert.ok(t.includes('01 error A has two overnight duties (R1 and Night Float).'), t.join('\n'));
  assert.ok(t.some(x => /^02 error A has Day Float the morning after /.test(x)), t.join('\n'));
  assert.ok(!t.some(x => /B has OT \(Junior\)/.test(x)), 'liver duties are on call, not a clash with a night before');
  assert.ok(t.some(x => /^03 error B has Acute Pain \(Junior\) the morning after R1/.test(x)), t.join('\n'));
  assert.ok(t.includes('03 error C is on leave but has R1.'), t.join('\n'));
  assert.ok(t.some(x => /^03 warn R2 is empty/.test(x)), t.join('\n'));
  // the made-up department starts (nearly) clean
  const { makeDemo } = await import('../js/demo.js');
  const d = makeDemo('2026-03-17');
  const byName = new Map(d.staff.map(p => [p.name, p]));
  assert.equal(monthIssues(d.monthly, '2026-03', n => byName.get(n) || null).filter(i => i.level === 'error').length, 0, 'demo month has no clashes');
  console.log('monthly clash tests passed');
}

{
  // seniority: complex lists, double covers and Baby MO / MOPEX rooms prefer SC and C
  const room = (id, name, notes, extra = {}) => ({ id, name, complex: 'MOR', running: true, notes, flags: suggestFlags(notes), session: 'full', ...extra });
  const st = [
    P('a', 'Senior Associate', 'senior', { grade: 'AC' }), P('b', 'Senior Consultant', 'senior', { grade: 'SC' }),
    P('j', 'Junior Mopex', 'junior', { grade: 'MOPEX' }), P('k', 'Junior Resident', 'junior'),
  ];
  let complexToSC = 0, mopexWithSC = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const g = generate({ staff: st, day: { rooms: [room('r1', 'MOR 1', 'laparotomy', { flags: { subspecs: [], complex: true, long: false } }), room('r2', 'MOR 2', 'hernia')], staff: {} }, seed });
    const r1 = g.rows.find(r => r.label === 'MOR 1');
    if (/Senior Consultant/.test(r1.senior)) complexToSC++;
    // two plain lists: the MOPEX goes with the SC
    const g2 = generate({ staff: st, day: { rooms: [room('r1', 'MOR 1', 'hernia'), room('r2', 'MOR 2', 'hernia')], staff: {} }, seed });
    if (g2.rows.some(r => /Senior Consultant/.test(r.senior) && /Junior Mopex/.test(r.junior))) mopexWithSC++;
  }
  assert.equal(complexToSC, 20, 'the complex list goes to the SC every time');
  assert.ok(mopexWithSC >= 15, `MOPEX mostly with the SC (${mopexWithSC}/20)`);
  // one senior short: the double cover goes to the SC
  const st2 = [P('a', 'Senior Associate', 'senior', { grade: 'AC' }), P('b', 'Senior Consultant', 'senior', { grade: 'SC' }), P('c', 'Senior Visiting', 'senior', { grade: 'VC' })];
  let dblSC = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const g = generate({ staff: st2, day: { rooms: [room('r1', 'MOR 1', ''), room('r2', 'MOR 2', ''), room('r3', 'MOR 3', ''), room('r4', 'MOR 4', '')], staff: {} }, seed });
    const n = {}; g.rows.forEach(r => String(r.senior).split(/\s*\/\s*/).filter(Boolean).forEach(x => { n[x] = (n[x] || 0) + 1; }));
    if (Object.entries(n).some(([k, v]) => v > 1 && /Consultant/.test(k))) dblSC++;
  }
  assert.ok(dblSC >= 15, `double cover mostly by the SC (${dblSC}/20)`);
  console.log('seniority tests passed');
}

{
  const { buildIcs } = await import('../js/ics.js');
  const t = buildIcs([{ date: '2026-10-31', title: 'MOR 4, Senior', details: 'with A; cases: lap chole\nleaving 4pm', uid: '2026-10-31-p1@nuhroster' }], { now: new Date('2026-10-13T10:00:00Z') });
  assert.match(t, /^BEGIN:VCALENDAR\r\n/);
  assert.match(t, /DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261101\r\n/, 'all-day event ending the next day, across a month end');
  assert.match(t, /SUMMARY:MOR 4\\, Senior/);
  assert.match(t.replace(/\r\n /g, ''), /DESCRIPTION:with A\\; cases: lap chole\\nleaving 4pm/);
  assert.ok(t.split('\r\n').every(l => l.length <= 75), 'lines folded');
  // folded by UTF-8 bytes, never splitting a character (· and emoji are several bytes)
  const u = buildIcs([{ date: '2026-10-31', title: 'MOR 4', details: 'with A · B → C 🙂 '.repeat(12), uid: 'x' }]);
  const enc = new TextEncoder();
  assert.ok(u.split('\r\n').every(l => enc.encode(l).length <= 75), 'lines at most 75 octets');
  assert.ok(!/[\ud800-\udfff]/.test(u.replace(/\p{Extended_Pictographic}/gu, '')), 'no split emoji');
  assert.ok(u.replace(/\r\n /g, '').includes('with A · B → C 🙂 with A'), 'unfolds to the same text');
  console.log('calendar tests passed');
}

{
  const { dateFromText } = await import('../js/xlsxio.js');
  assert.equal(dateFromText('2026-10-14'), '2026-10-14');
  assert.equal(dateFromText('14/10/2026'), '2026-10-14');
  assert.equal(dateFromText('1.2.26'), '2026-02-01');
  assert.equal(dateFromText('14 Oct 2026'), '2026-10-14');
  assert.equal(dateFromText('Wednesday, 14 October 2026'), '2026-10-14');
  assert.equal(dateFromText('WEDNESDAY, 14 OCTOBER 2026'), '2026-10-14', 'capitals');
  const { cellText } = await import('../js/xlsxio.js');
  assert.equal(cellText({ formula: 'TODAY()+1', result: new Date('2026-10-14T00:00:00Z') }), '2026-10-14', 'a formula date');
  assert.equal(dateFromText('31/02/2026'), null, 'no 31 February');
  assert.equal(dateFromText(''), null);
  console.log('draft date tests passed');
}

{
  // saved data from the first versions of the app comes up to date
  const { mergeSaved, migrateRooms } = await import('../js/store.js');
  const { DEFAULT_SETTINGS } = await import('../js/engine.js');
  const v1 = { staff: [], settings: { premedCap: 2 }, roomTemplate: [{ complex: 'Other', name: 'Remote Case' }, { complex: 'KROR', name: 'KROR 2' }, { complex: 'MCOR', name: 'MCOR 8' }, { complex: 'MCOR', name: 'MCOR 10' }, { complex: 'MOR', name: 'MOR 1' }],
    day: { rooms: [{ name: 'Remote Case' }] }, roster: { rows: [{ label: 'Remote Case' }] } };
  const st = mergeSaved({ settings: {}, roomTemplate: [] }, JSON.parse(JSON.stringify(v1)), DEFAULT_SETTINGS);
  assert.equal(st.roomsVersion, 1);
  assert.equal(st.settings.premedCap, 2, 'saved settings kept');
  assert.equal(st.settings.subspecs.length, DEFAULT_SETTINGS.subspecs.length, 'new settings get their defaults');
  migrateRooms(st);
  const names = st.roomTemplate.map(r => r.name);
  assert.equal(st.roomsVersion, 4);
  assert.deepEqual(names, ['Remote 1', 'Remote 2', 'KROR PACU', 'KROR 1', 'KROR 2', 'MCOR PACU', 'MCOR 8', 'MCOR 9', 'MCOR 10', 'ECT', 'MBOR PACU', 'MOR 1']);
  assert.equal(st.day.rooms[0].name, 'Remote 1'); assert.equal(st.roster.rows[0].label, 'Remote 1');
  assert.equal(st.roomTemplate.find(r => r.name === 'MOR 1').defaultOn, true);
  assert.equal(st.roomTemplate.find(r => r.name === 'KROR 1').defaultOn, false);
  const again = JSON.stringify(st); migrateRooms(st); assert.equal(JSON.stringify(st), again, 'running it twice changes nothing');
  assert.equal(mergeSaved('blank', null, DEFAULT_SETTINGS), 'blank');
  console.log('saved data migration tests passed');
}

{
  // help texts: every mark the printable guide explains is in the in-app key too; What's new is dated, newest first
  const { SYMBOLS, HOW, WHATS_NEW } = await import('../js/help.js');
  const fs = await import('node:fs');
  const guide = fs.readFileSync(new URL('../guide.html', import.meta.url), 'utf8');
  const marks = [...guide.matchAll(/<th>([^<]+)<\/th>/g)].map(m => m[1].replace('&amp;', '&'));
  const keyText = SYMBOLS.map(([k, v]) => k + ' ' + v).join(' | ');
  for (const m of marks) assert.ok(keyText.includes(m.split(' ')[0].replace(/…$/, '')), `guide mark "${m}" is also in the in-app key`);
  assert.ok(HOW.length >= 8 && HOW.every(([q, a]) => q.endsWith('?') && a.length > 20));
  const dates = WHATS_NEW.map(([d]) => new Date(d));
  assert.ok(dates.every(d => !isNaN(d)) && dates.every((d, i) => !i || d <= dates[i - 1]), "What's new is dated, newest first");
  console.log('help text tests passed');
}

{
  // AOCC leaves the last free consultant for AIC
  const room = (id, name) => ({ id, name, complex: 'MOR', running: true, notes: '', flags: suggestFlags(''), session: 'full' });
  const st = [P('a', 'Senior Busy', 'senior', { grade: 'AC' }), P('b', 'Senior Assoc', 'senior', { grade: 'AC' }), P('c', 'Senior Cons', 'senior', { grade: 'C' })];
  let ok = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const g = generate({ staff: st, day: { rooms: [room('r1', 'MOR 1')], staff: {} }, seed });
    const by = Object.fromEntries(g.rows.map(r => [r.label, r]));
    if (/Senior Cons/.test(by.AIC.senior) && by.AOCC.senior && !/Senior Cons/.test(by.AOCC.senior)) ok++;
  }
  assert.ok(ok >= 15, `AIC keeps the consultant (${ok}/20)`);
  console.log('AOCC/AIC tests passed');
}
