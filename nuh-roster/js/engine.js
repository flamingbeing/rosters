// OT roster engine: name matching, case-note parsing, assignment and checks.
// Pure functions only (no DOM), so it can be tested in Node.

export const DEFAULT_SETTINGS = {
  paedsAgeYears: 12,
  premedCap: 3,
  subspecs: [
    { key: 'paeds', label: 'Paeds', keywords: ['pas', 'paeds', 'paed'], hard: true, posting: 'P', byAge: true },
    { key: 'cardiac', label: 'Cardiac', keywords: ['c', 'cardiac', 'cabg', 'avr', 'mvr'], hard: true, posting: 'Cardiac' },
    { key: 'neuro', label: 'Neuro', keywords: ['nes', 'neuro', 'craniotomy', 'crani'], hard: true, posting: 'Neu' },
    { key: 'thoracic', label: 'Thoracic', keywords: ['vats', 'thoracic', 'lobectomy'], hard: true, posting: 'SR' },
    { key: 'hpb', label: 'Liver / HPB', keywords: ['hepatec', 'hepatectomy', 'whipple', 'liver', 'hpb'], hard: false, posting: 'L' },
    { key: 'obs', label: 'Obstetric', keywords: ['lscs'], hard: false, posting: '' },
    { key: 'regional', label: 'Regional', keywords: ['tkr', 'thr', 'acl', 'shoulder', 'knee', 'hip'], hard: false, posting: 'RA' },
  ],
  complexKeywords: ['whipple', 'hepatec', 'hepatectomy', 'oesophagectomy', 'scoli', 'evar', 'laryngect', 'lefort', 'transplant', 'vats', 'ugi', 'thoracic'],
  longKeywords: ['7pm', '8pm', 'long'],
  // rooms whose lists always need a subspec, whatever the case notes say
  roomDefaults: { 'MOR 12': ['cardiac'], 'MOR 13': ['cardiac'] },
};

// in order of seniority
export const JUNIOR_GRADES = ['Senior resident', 'Junior resident', 'RP', 'Locum', 'MOPEX', 'Rotating resident'];
export const SENIOR_GRADES = ['SC', 'C', 'VC', 'AC', 'RP'];
// seniors first, then by grade, then by name
export const bySeniority = (a, b) => (a.role === b.role ? 0 : a.role === 'senior' ? -1 : 1)
  || rank(a) - rank(b) || String(a.name).localeCompare(String(b.name));
const rank = p => { const i = (p.role === 'senior' ? SENIOR_GRADES : JUNIOR_GRADES).indexOf(p.grade); return i < 0 ? 99 : i; };
export const DEFAULT_GRADE = { senior: 'C', junior: 'Junior resident' };
// residents in training: preferred for complex lists
export const isResident = p => ['Senior resident', 'Junior resident', 'Rotating resident'].includes(p?.grade);
// Postings as [tag on the roster, name]. The tag is what the sheet shows after a name, e.g. "(RA)".
export const POSTINGS = [['', '—'], ['P', 'Paeds'], ['Neu', 'Neuro'], ['SR', 'Special Risk'], ['Cardiac', 'Cardiac'], ['ENT', 'ENT'],
  ['RA', 'Regional'], ['Vasc', 'Vascular'], ['Amb', 'Ambulatory'], ['Remote', 'Remote'], ['PACU', 'PACU'], ['L', 'Liver Transplant'], ['HPB', 'Liver Donor']];
export const postingName = code => POSTINGS.find(p => p[0] === code)?.[1] || code || '';
// Grades used before the department's own grade names, and what they became.
export const OLD_GRADES = { senior: { Consultant: 'C' }, junior: { 'Senior Resident': 'Senior resident', Resident: 'Junior resident', 'Baby MO': 'MOPEX', 'Rotating Resident': 'Rotating resident' } };

// Name colour on the roster: green marks Baby MOs (never left alone), purple marks locums.
export const COLOURS = [['', 'Black'], ['green', 'Green'], ['purple', 'Purple']];
export const COLOUR_ARGB = { green: 'FF00B050', purple: 'FF7030A0', red: 'FFFF0000' };
export const isBaby = p => !!p && p.colour === 'green';
export const STATUSES = [
  ['avail', 'Available'],
  ['leave', 'Leave'],
  ['mc', 'MC'],
  ['postcall', 'Post call'],
  ['elsewhere', 'Elsewhere'],
  ['admin', 'Admin / no list'],
];

// defaultOn: ticked as running when a new day is set up. MOR 7-9 are emergency OTs and have no line.
export const DEFAULT_ROOMS = [
  ['Other', ['Remote 1', 'Remote 2']],
  ['KROR', ['KROR PACU', 'KROR 1', 'KROR 2', 'KROR 3', 'KROR 4', 'KROR 5', 'KROR 6', 'KROR 7']],
  ['MCOR', ['MCOR PACU', 'MCOR 1', 'MCOR 2', 'MCOR 3', 'MCOR 4', 'MCOR 5', 'MCOR 6', 'MCOR 7', 'MCOR 8', 'MCOR 9', 'MCOR 10']],
  ['ECT', ['ECT']],
  ['MOR', ['MBOR PACU', 'MOR 1', 'MOR 2', 'MOR 3', 'MOR 4', 'MOR 5', 'MOR 6', 'MOR 10', 'MOR 11', 'MOR 12', 'MOR 13', 'MOR 14', 'MOR 15', 'MOR 16', 'MOR 17', 'MOR 18']],
].flatMap(([complex, rooms]) => rooms.map(name => ({ complex, name, defaultOn: !['Remote 2', 'KROR 1', 'MCOR 9'].includes(name) })));

// Rows at the top of the OT roster that aren't operating rooms. AOCC gets a senior and two
// juniors, AIC one consultant or senior resident; AH OT is filled by hand.
export const SPECIAL_ROWS = [
  { id: 'ahot', name: 'AH OT' },
  { id: 'aocc', name: 'AOCC' },
  { id: 'aic', name: 'AIC' },
];
export const isSpecialRow = row => row?.complex === 'Clinic';

// PACU rows are filled by hand: the generator leaves them empty and doesn't ask for a senior.
export const isPacu = name => /pacu/i.test(String(name));
export function pacuRoom(label) {
  const m = String(label).match(/\b(KROR|MCOR|MBOR|MOR)\s*PACU\b/i);
  return m ? `${m[1].toUpperCase() === 'MOR' ? 'MBOR' : m[1].toUpperCase()} PACU` : null;
}

// "Remote Case" / "Remote case 2" / "Remote 2:" -> "Remote 1" / "Remote 2"
export function remoteRoom(label) {
  const m = String(label).match(/^\s*remote(?:\s*case)?\s*(\d)?/i);
  return m ? `Remote ${m[1] || 1}` : null;
}

// ---------- names ----------

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = s => norm(s).split(' ').filter(Boolean);

// Does query token q match staff tokens t starting at i, either as a whole token
// or as a run of initials ("yw" -> "yi wei")? Returns the number of tokens consumed.
function tokenMatch(q, t, i) {
  if (t[i] === q) return 1;
  if (q.length === 1 && t[i][0] === q) return 1; // "R Chua", "Muthu R Kumar"
  if (i + 1 < t.length && t[i] + t[i + 1] === q) return 2; // "Xinyi" vs "Xin Yi"
  // initials, unless q is itself a surname ("Ng" isn't "Nathan Goh")
  if (q.length >= 2 && q.length <= 4 && i + q.length <= t.length && !SURNAMES.has(q)) {
    for (let k = 0; k < q.length; k++) if (t[i + k][0] !== q[k]) return 0;
    return q.length;
  }
  return 0;
}

function nameMatchesForms(query, forms) {
  const q = tokens(query);
  if (!q.length) return 0;
  let best = 0;
  for (const form of forms) {
    const t = tokens(form);
    if (!t.length) continue;
    if (q.join(' ') === t.join(' ')) return 3;
    // every query token must match a distinct staff token (initials may span several)
    const used = new Array(t.length).fill(false);
    let ok = true;
    for (const qt of q) {
      let hit = false;
      for (let i = 0; i < t.length && !hit; i++) {
        if (used[i]) continue;
        const n = tokenMatch(qt, t, i);
        if (n && !used.slice(i, i + n).some(Boolean)) {
          for (let k = 0; k < n; k++) used[i + k] = true;
          hit = true;
        }
      }
      if (!hit) { ok = false; break; }
    }
    if (ok) best = Math.max(best, q.length > 1 ? 2 : 1);
  }
  return best;
}

// Find the staff member a free-text name refers to. Returns {person} or {ambiguous:[...]} or {}.
export function matchName(query, staff) {
  let top = 0, hits = [];
  for (const p of staff) {
    const sc = nameMatchesForms(query, [p.name, ...(p.aliases || [])]);
    if (sc > top) { top = sc; hits = [p]; } else if (sc && sc === top) hits.push(p);
  }
  if (hits.length === 1) return { person: hits[0] };
  if (hits.length > 1) return { ambiguous: hits };
  return {};
}

// Split a free-text list ("Koh YW, Ong KS / Anjali (KIV)") into name strings.
export function splitNameList(text) {
  return String(text ?? '')
    .split(/[\n,;\/\t]+/)
    .map(s => s.replace(/\(.*?\)/g, '').trim())
    .filter(Boolean);
}

// Pull person names out of one roster cell, ignoring annotations.
// "Sophia am /Seah MP pm" -> ["Sophia", "Seah MP"]; "Ravindra (Seah MP C)" -> ["Ravindra"]
export function namesInCell(text) {
  return String(text ?? '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\*+/g, ' ')
    .split('/')
    .map(s => s
      .replace(/\s-\s*premed.*$/i, '')
      .replace(/\s+[LC]-.*$/, '')        // "L-4pm", "L-4-5pm", "C-OT13", "C-KROR PACU"
      .replace(/\s+-.*$/, '')          // "-mtg 8.30", "-C-OT 4", "-5pm"
      .replace(/\b(am|pm)\b/gi, ' ')
      .replace(/\breq\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(s => s && /[a-z]/i.test(s));
}

// ---------- case notes ----------

function ageYears(notes) {
  let min = Infinity;
  const re = /(\d+(?:\.\d+)?)\s*(y|yo|yr|yrs|m|mo|mth|mths|w|wk|wks|d)\b/gi;
  for (const m of String(notes).matchAll(re)) {
    const n = parseFloat(m[1]);
    const u = m[2].toLowerCase();
    const y = u.startsWith('y') ? n : u.startsWith('m') ? n / 12 : u.startsWith('w') ? n / 52 : n / 365;
    min = Math.min(min, y);
  }
  return min;
}

function hasKeyword(notes, kw) {
  const k = norm(kw);
  if (!k) return false;
  return new RegExp(`(^| )${k.replace(/ /g, ' ')}( |$)`).test(norm(notes));
}

// Suggest flags for a room from its free-text case notes (and the room's own defaults).
export function suggestFlags(notes, settings = DEFAULT_SETTINGS, roomName = '') {
  const room = String(roomName).toUpperCase().replace(/\s+/g, ' ').trim();
  const defaults = Object.entries(settings.roomDefaults || {}).find(([k]) => k.toUpperCase().replace(/\s+/g, ' ').trim() === room)?.[1] || [];
  const subspecs = [...defaults];
  for (const s of settings.subspecs) {
    let hit = (s.keywords || []).some(k => hasKeyword(notes, k));
    if (s.byAge && ageYears(notes) < settings.paedsAgeYears) hit = true;
    if (hit && !subspecs.includes(s.key)) subspecs.push(s.key);
  }
  const complex = (settings.complexKeywords || []).some(k => hasKeyword(notes, k));
  const long = (settings.longKeywords || []).some(k => hasKeyword(notes, k));
  return { subspecs, complex, long };
}

// ---------- assignment ----------

const INF = 1e6;

// Hungarian algorithm for a rectangular cost matrix (rows <= cols). Returns col index per row.
export function hungarian(cost) {
  const n = cost.length, m = n ? cost[0].length : 0;
  if (!n) return [];
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity), used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const res = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) res[p[j] - 1] = j - 1;
  return res;
}

// Assign rows to cols minimising cost; works whether rows > cols or not.
function assign(cost) {
  if (!cost.length || !cost[0].length) return cost.map(() => -1);
  const n = cost.length, m = cost[0].length;
  if (n <= m) return hungarian(cost);
  const t = Array.from({ length: m }, (_, j) => cost.map(r => r[j]));
  const colToRow = hungarian(t);
  const res = new Array(n).fill(-1);
  colToRow.forEach((i, j) => { if (i >= 0) res[i] = j; });
  return res;
}

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
}

const roomNum = name => parseInt(String(name).match(/(\d+)\s*$/)?.[1] ?? 'NaN', 10);

function subspecByKey(settings) {
  return Object.fromEntries(settings.subspecs.map(s => [s.key, s]));
}

// Senior consultants and consultants: preferred for complex lists, double covers and rooms with a Baby MO or MOPEX.
const STRONG = ['SC', 'C'];
function seniorRoomCost(p, d, room, settings, noise) {
  const sub = subspecByKey(settings);
  for (const k of room.flags.subspecs) {
    if (sub[k]?.hard && !(p.subspecs || []).includes(k)) return INF;
  }
  for (const a of p.avoid || []) {
    if (room.flags.subspecs.includes(a) || hasKeyword(room.notes, a)) return INF;
  }
  let c = noise;
  const special = room.flags.complex || room.flags.subspecs.some(k => sub[k]?.hard);
  if (d.liverStandby && special) c += 50;
  if (d.leaveTime && room.flags.long) c += 40;
  const mine = (p.subspecs || []).filter(k => room.flags.subspecs.includes(k)).length;
  c -= mine * 5;
  // complex lists go to the most senior (SC, C) where they can; small, so subspecs and the hard rules still win
  if (room.flags.complex) c += STRONG.includes(p.grade) ? -3 : 3;
  // keep subspecialists free for rooms that need them
  if ((p.subspecs || []).some(k => sub[k]?.hard) && !room.flags.subspecs.some(k => sub[k]?.hard)) c += 3;
  return c;
}

function juniorRoomCost(p, d, room, settings, noise, doubled) {
  const sub = subspecByKey(settings);
  const baby = isBaby(p);
  if (baby && doubled) return INF;
  let c = noise;
  if (baby && room.flags.complex) c += 30;
  if (room.flags.complex) c += isResident(p) ? -5 : 10;
  else if (p.grade === 'MOPEX') c -= 2;
  if (p.posting) {
    const match = room.flags.subspecs.some(k => sub[k]?.posting && sub[k].posting === p.posting)
      || (p.posting === 'SR' && room.flags.complex);
    c += match ? -15 : 4;
  }
  // the liver standby team isn't given complex lists
  if (d.liverStandby && room.flags.complex) c += 50;
  if (d.leaveTime && room.flags.long) c += 40;
  return c;
}

const dayOf = (day, p) => day.staff?.[p.id] || {};
const isAvail = (day, p) => (dayOf(day, p).status || 'avail') === 'avail';
// working today, on the lists or elsewhere (calls, clinics)
const canWork = (day, p) => ['avail', 'elsewhere'].includes(dayOf(day, p).status || 'avail');

// A name as written on the roster, with the day's details: "Koh YW (L) (AOH) L-4pm -mtg 3pm"
export function fmtSenior(p, d) {
  let s = p.name;
  if (d.liverStandby) s += ' (L)';
  if (d.aoh) s += ` (${d.aoh})`;
  if (d.note) s += ' ' + d.note;
  if (d.leaveTime) s += ' L-' + d.leaveTime;
  if (d.comment) s += ' -' + d.comment;
  return s;
}

export function fmtJunior(p, d) {
  let s = p.name;
  if (p.posting) s += ` (${p.posting})`;
  if (d.liverStandby && p.posting !== 'L') s += ' (L)';
  if (d.aoh) s += ` (${d.aoh})`;
  if (d.note) s += ' ' + d.note;
  if (d.leaveTime) s += ' L-' + d.leaveTime;
  if (d.comment) s += ' -' + d.comment;
  return s;
}

// Generate the OT section. Returns { rows, warnings, unusedSeniors, unusedJuniors }.
// day.fixed: text already decided for the special rows (from the draft or the General tab):
// { ahot, 'aocc.s', 'aocc.j', aic }. A filled one is kept as is instead of generated.
export function generate({ staff, day, settings = DEFAULT_SETTINGS, seed = 1 }) {
  const rand = rng(seed);
  const warnings = [];
  const fixed = day.fixed || {};
  const special = SPECIAL_ROWS.map(r => ({ ...r, complex: 'Clinic', running: true, notes: '', session: 'full', flags: { subspecs: [], complex: false, long: false } }));
  const aoccFixed = !!(fixed['aocc.s'] || fixed['aocc.j']);
  const allRooms = [...special, ...day.rooms.filter(r => r.running)];
  const rooms = allRooms.filter(r => !isPacu(r.name) && r.id !== 'ahot' && r.id !== 'aic' && !(r.id === 'aocc' && aoccFixed)).map(r => ({
    ...r,
    flags: { subspecs: [], complex: false, long: false, ...(r.flags || {}) },
  }));
  const byId = Object.fromEntries(staff.map(p => [p.id, p]));
  const rowOf = Object.fromEntries(rooms.map(r => [r.id, { roomId: r.id, label: r.name, complex: r.complex, seniors: [], juniors: [], premed: null, notes: r.notes || '' }]));

  // ---- seniors ----
  const lockedSeniors = new Set();
  for (const r of rooms) {
    if (r.lockSenior && byId[r.lockSenior]) {
      // a fixed person who is on leave, MC, post call or admin today isn't put in
      if (!canWork(day, byId[r.lockSenior])) { warnings.push({ level: 'warn', text: `${r.name}: ${byId[r.lockSenior].name} is fixed here but isn't working today.` }); continue; }
      rowOf[r.id].seniors.push(r.lockSenior); lockedSeniors.add(r.lockSenior);
    }
  }
  // operating rooms first; AOCC takes a senior left over afterwards
  const openRooms = rooms.filter(r => !rowOf[r.id].seniors.length && r.id !== 'aocc');
  const seniors = staff.filter(p => p.role === 'senior' && isAvail(day, p) && !lockedSeniors.has(p.id));

  // cost of each senior for each room (noise fixed up front so options compare fairly)
  const base = seniors.map(p => {
    const noise = rand() * 2;
    return Object.fromEntries(openRooms.map(r => [r.id, seniorRoomCost(p, dayOf(day, p), r, settings, noise)]));
  });
  const slotCost = slots => seniors.map((p, i) => slots.map(slot => {
    let c = 0;
    for (const r of slot) { const x = base[i][r.id]; if (x >= INF) return INF; c += x; }
    // a double cover goes to a senior consultant or consultant where it can
    if (slot.length > 1) c += STRONG.includes(p.grade) ? -2 : 2;
    return c;
  }));
  const evaluate = slots => {
    const cost = slotCost(slots);
    if (!cost.length) return { cost, a: [], total: slots.length * INF };
    const a = assign(cost);
    let total = 0;
    const filled = new Set();
    a.forEach((j, i) => { if (j >= 0) { total += Math.min(cost[i][j], INF); if (cost[i][j] < INF) filled.add(j); } });
    total += (slots.length - filled.size) * INF;
    return { cost, a, total };
  };

  // slots: single rooms, plus double covers when seniors are short.
  // Pairs are chosen one at a time, each time taking the pair that leaves the best overall assignment.
  let slots = openRooms.map(r => [r]);
  let need = openRooms.length - seniors.length;
  const pairNotes = [];
  if (need > 0) {
    const sub = subspecByKey(settings);
    const cands = [];
    for (let i = 0; i < openRooms.length; i++) for (let j = i + 1; j < openRooms.length; j++) {
      const a = openRooms[i], b = openRooms[j];
      if (a.complex !== b.complex || a.complex === 'Other' || a.complex === 'Clinic') continue;
      const halfDay = (a.session === 'am' && b.session !== 'am') || (b.session === 'am' && a.session !== 'am')
        || (a.session === 'pm' && b.session !== 'pm') || (b.session === 'pm' && a.session !== 'pm');
      if (!halfDay && (a.flags.complex || b.flags.complex)) continue;
      const gap = Math.abs(roomNum(a.name) - roomNum(b.name)) || 5;
      let c = halfDay ? 0 : 3 * Math.min(gap, 6);
      if (a.flags.subspecs.some(k => sub[k]?.hard) || b.flags.subspecs.some(k => sub[k]?.hard)) c += 6;
      cands.push({ a, b, c: c + rand() * 0.5 });
    }
    const used = new Set();
    const pairs = [];
    while (need > 0) {
      let best = null, bestTotal = Infinity;
      for (const cd of cands) {
        if (used.has(cd.a.id) || used.has(cd.b.id)) continue;
        const trial = [...pairs, [cd.a, cd.b], ...openRooms.filter(r => !used.has(r.id) && r !== cd.a && r !== cd.b).map(r => [r])];
        // rooms beyond the number of seniors can't all be filled yet; compare on what can be
        const t = evaluate(trial).total + cd.c;
        if (t < bestTotal) { bestTotal = t; best = cd; }
      }
      if (!best) break;
      used.add(best.a.id); used.add(best.b.id);
      pairs.push([best.a, best.b]);
      need--;
    }
    slots = [...pairs, ...openRooms.filter(r => !used.has(r.id)).map(r => [r])];
    for (const [a, b] of pairs) pairNotes.push(`${a.name} + ${b.name}`);
    if (pairs.length) warnings.push({ level: 'info', text: `Short of seniors: double cover ${pairNotes.join(', ')}.` });
    if (need > 0) warnings.push({ level: 'error', text: `Still short of ${need} senior(s) after double cover — some rooms left empty.` });
  }

  const { cost: sCost, a: sAssign } = evaluate(slots);
  const usedSeniors = new Set();
  sAssign.forEach((j, i) => {
    if (j < 0) return;
    if (sCost[i][j] >= INF) return;
    usedSeniors.add(seniors[i].id);
    for (const r of slots[j]) rowOf[r.id].seniors.push(seniors[i].id);
  });
  // a senior left over (e.g. because a subspec room had nobody eligible) takes one room of a double cover
  const spare = seniors.filter(p => !usedSeniors.has(p.id));
  for (const slot of slots) {
    if (slot.length < 2 || !spare.length) continue;
    for (const r of slot.slice(1)) {
      // the spare senior who suits the room best, not just the first who may
      let k = -1, bestC = INF;
      spare.forEach((p, n) => { const c = seniorRoomCost(p, dayOf(day, p), r, settings, 0); if (c < bestC) { bestC = c; k = n; } });
      if (k < 0) continue;
      const [p] = spare.splice(k, 1);
      rowOf[r.id].seniors = [p.id];
      usedSeniors.add(p.id);
      slot.splice(slot.indexOf(r), 1);
      const i = pairNotes.findIndex(t => t.includes(r.name));
      if (i >= 0) pairNotes.splice(i, 1);
    }
  }
  const pairInfo = warnings.findIndex(w => w.text.startsWith('Short of seniors'));
  if (pairInfo >= 0) {
    if (pairNotes.length) warnings[pairInfo].text = `Short of seniors: double cover ${pairNotes.join(', ')}.`;
    else warnings.splice(pairInfo, 1);
  }
  const doubled = new Set();
  for (const slot of slots) {
    if (slot.length > 1 && slot.some(r => rowOf[r.id].seniors.length)) slot.forEach(r => doubled.add(r.id));
  }
  for (const r of openRooms) {
    if (!rowOf[r.id].seniors.length) {
      const req = r.flags.subspecs.filter(k => subspecByKey(settings)[k]?.hard).map(k => subspecByKey(settings)[k].label);
      warnings.push({ level: 'error', rooms: [r.name], text: `${r.name}: no eligible senior${req.length ? ` (needs ${req.join(', ')})` : ''}.` });
    }
  }

  if (rowOf.aocc && !rowOf.aocc.seniors.length) {
    let free = seniors.filter(p => !usedSeniors.has(p.id));
    // AIC needs a consultant (SC, C): when only one is left, AOCC takes someone else if it can
    const consultants = free.filter(p => STRONG.includes(p.grade));
    if (!fixed.aic && consultants.length === 1 && free.length > 1) free = free.filter(p => p !== consultants[0]);
    const p = free[Math.floor(rand() * free.length)];
    if (p) { rowOf.aocc.seniors.push(p.id); usedSeniors.add(p.id); }
    else warnings.push({ level: 'warn', text: 'AOCC: no senior left after the OT lists.' });
  }

  // ---- AIC: a consultant left over, else a senior resident ----
  let aicPerson = null;
  if (!fixed.aic) {
    const free = seniors.filter(p => !usedSeniors.has(p.id) && ['SC', 'C'].includes(p.grade));
    aicPerson = free[Math.floor(rand() * free.length)] || null;
    if (!aicPerson) {
      const sr = staff.filter(p => p.role === 'junior' && p.grade === 'Senior resident' && isAvail(day, p) && !day.rooms.some(r => r.running && r.lockJunior === p.id));
      aicPerson = sr[Math.floor(rand() * sr.length)] || null;
    }
    if (aicPerson) usedSeniors.add(aicPerson.id);
    else warnings.push({ level: 'warn', text: 'AIC: no consultant or senior resident free.' });
  }

  // ---- juniors ----
  const lockedJuniors = new Set();
  if (aicPerson?.role === 'junior') lockedJuniors.add(aicPerson.id);
  for (const r of rooms) {
    if (r.lockJunior && byId[r.lockJunior]) {
      if (!canWork(day, byId[r.lockJunior])) { warnings.push({ level: 'warn', text: `${r.name}: ${byId[r.lockJunior].name} is fixed here but isn't working today.` }); continue; }
      rowOf[r.id].juniors.push(r.lockJunior); lockedJuniors.add(r.lockJunior);
    }
  }
  // AOCC takes juniors left over after the OT lists, like its senior
  const jRooms = rooms.filter(r => !rowOf[r.id].juniors.length && r.id !== 'aocc');
  let juniors = staff.filter(p => p.role === 'junior' && isAvail(day, p) && !lockedJuniors.has(p.id));
  // first pass: one junior per room; dummy "nobody" columns let rooms go without
  // a Baby MO never goes where there is no senior
  // a Baby MO or MOPEX goes with a senior consultant or consultant where it can
  const pairing = (p, r) => (isBaby(p) || p.grade === 'MOPEX') && rowOf[r.id].seniors.length && !rowOf[r.id].seniors.some(id => STRONG.includes(byId[id]?.grade)) ? 4 : 0;
  const jCost = juniors.map(p => jRooms.map(r => isBaby(p) && !rowOf[r.id].seniors.length ? INF
    : juniorRoomCost(p, dayOf(day, p), r, settings, rand() * 2, doubled.has(r.id)) + pairing(p, r)));
  const nobody = jRooms.map(r => doubled.has(r.id) ? 5000 : r.flags.complex ? 80 : 40);
  const rowsForNobody = Math.max(0, jRooms.length - juniors.length);
  const fullCost = [
    ...jCost,
    ...Array.from({ length: rowsForNobody }, () => nobody.slice()),
  ];
  const jAssign = assign(fullCost);
  const placed = new Set();
  jAssign.forEach((j, i) => {
    if (j < 0 || i >= juniors.length || jCost[i][j] >= INF) return;
    rowOf[jRooms[j].id].juniors.push(juniors[i].id);
    placed.add(juniors[i].id);
  });
  // extra juniors: AOCC gets its two first, then double up elsewhere,
  // favouring rooms with Baby MOs, complex lists and posting matches
  let extras = juniors.filter(p => !placed.has(p.id));
  while (rowOf.aocc && rowOf.aocc.juniors.length < 2) {
    const k = extras.findIndex(p => !isBaby(p));
    if (k < 0) { warnings.push({ level: 'warn', text: `AOCC: ${rowOf.aocc.juniors.length ? 'only one junior' : 'no junior'} free.` }); break; }
    rowOf.aocc.juniors.push(extras[k].id); extras.splice(k, 1);
  }
  while (extras.length) {
    const cost = extras.map(p => rooms.map(r => {
      const here = rowOf[r.id].juniors.map(id => byId[id]);
      if (r.complex === 'Clinic' || (isBaby(p) && !rowOf[r.id].seniors.length)) return INF;
      let c = juniorRoomCost(p, dayOf(day, p), r, settings, rand() * 2, doubled.has(r.id));
      if (c >= INF) return INF;
      if (isBaby(p)) c += 20; // a Baby MO as the extra is fine, but prefer seniors-in-training
      if (here.some(isBaby)) c -= 20;
      c += here.length * 25;
      if (!here.length) c -= 30;
      return c;
    }));
    const a = assign(cost);
    const next = [];
    a.forEach((j, i) => {
      if (j < 0 || cost[i][j] >= INF) { next.push(extras[i]); return; }
      rowOf[rooms[j].id].juniors.push(extras[i].id);
    });
    if (next.length === extras.length) break;
    extras = next;
  }

  // ---- ad hoc covers: a room still without a junior is covered by one from a nearby room
  // in the same complex ("Name (C)"), which beats leaving it empty ----
  const homeOf = {};
  for (const r of rooms) for (const id of rowOf[r.id].juniors) homeOf[id] ||= r;
  const coverLoad = {};
  for (const r of rooms) {
    const row = rowOf[r.id];
    row.covers = [];
    if (row.juniors.length || r.complex === 'Clinic' || r.complex === 'Other') continue;
    let best = null, bestC = Infinity;
    for (const [id, home] of Object.entries(homeOf)) {
      const p = byId[id];
      if (home.complex !== r.complex || home.id === r.id || isBaby(p) || home.complex === 'Clinic') continue;
      if (coverLoad[id]) continue; // one ad hoc cover per junior
      let c = Math.abs((roomNum(home.name) || 0) - (roomNum(r.name) || 0)) + rand();
      if (home.flags.complex) c += 8;
      if (rowOf[home.id].juniors.length > 1) c -= 10;
      if (p.grade === 'MOPEX') c += 3;
      if (c < bestC) { bestC = c; best = id; }
    }
    if (best) {
      row.covers.push(best);
      coverLoad[best] = (coverLoad[best] || 0) + 1;
      warnings.push({ level: doubled.has(r.id) ? 'warn' : 'info', text: `${r.name}: no junior free, ${byId[best].name} covers from ${homeOf[best].name} (C).` });
    } else {
      warnings.push({ level: doubled.has(r.id) ? 'error' : 'warn', text: `${r.name}: no junior${doubled.has(r.id) ? ' but senior is double covering' : ''}.` });
    }
  }

  // ---- premed cover ----
  const roomOfJunior = {};
  for (const r of rooms) for (const id of rowOf[r.id].juniors) roomOfJunior[id] = r;
  const coverers = staff.filter(p => p.role === 'junior' && !isBaby(p)
    && ['avail', 'elsewhere'].includes(dayOf(day, p).status || 'avail') && !dayOf(day, p).notAroundPrev);
  const load = {};
  const premedRooms = rooms.filter(r => r.complex !== 'Clinic' && rowOf[r.id].juniors.some(id => dayOf(day, byId[id]).notAroundPrev));
  for (const r of premedRooms) {
    const row = rowOf[r.id];
    const mate = row.juniors.map(id => byId[id]).find(p => !dayOf(day, p).notAroundPrev && !isBaby(p));
    if (mate) { row.premed = mate.id; load[mate.id] = (load[mate.id] || 0) + 1; continue; }
    const sameSenior = rooms.filter(o => o.id !== r.id && row.seniors.length && rowOf[o.id].seniors[0] === row.seniors[0]).map(o => rowOf[o.id].premed).filter(Boolean);
    let best = null, bestC = Infinity;
    for (const p of coverers) {
      const l = load[p.id] || 0;
      if (l >= settings.premedCap) continue;
      const home = roomOfJunior[p.id];
      let c = l * 3 + rand();
      if (!home) c += 4; else if (home.complex !== r.complex) c += 2;
      if (home?.flags.complex) c += 2;
      if (sameSenior.includes(p.id)) c -= 3;
      if (c < bestC) { bestC = c; best = p; }
    }
    if (best) { row.premed = best.id; load[best.id] = (load[best.id] || 0) + 1; }
    else warnings.push({ level: 'warn', fix: 'premed', rooms: [r.name], text: `${r.name}: needs premed cover but nobody is free.` });
  }

  // Why each person was put where they are, in a few words (shown on the roster when hovering a name):
  // { personId: 'Paeds subspec · SC/C for a complex list' }. Only the strongest reasons, not the arithmetic.
  const sub = subspecByKey(settings);
  const pairOf = id => slots.find(sl => sl.length > 1 && sl.some(x => x.id === id));
  function whyHere(r0, row) {
    const r = { ...r0, flags: { subspecs: [], complex: false, long: false, ...(r0.flags || {}) } };
    const out = {};
    for (const id of row.seniors) {
      const p = byId[id], w = [];
      if (r.lockSenior === id) w.push('fixed here');
      const mine = (p.subspecs || []).filter(k => r.flags.subspecs.includes(k)).map(k => sub[k]?.label || k);
      if (mine.length) w.push(`${mine.join(', ')} subspec`);
      if (r.flags.complex && STRONG.includes(p.grade)) w.push(`${p.grade} for a complex list`);
      const pr = pairOf(r.id);
      if (pr && rowOf[pr.find(x => x.id !== r.id).id]?.seniors.includes(id)) w.push(`double covers with ${pr.find(x => x.id !== r.id).name} (short of seniors)`);
      if (r.id === 'aocc') w.push('free after the OT lists');
      out[id] = w.join(' · ') || 'free, and suits the list';
    }
    row.juniors.forEach((id, k) => {
      const p = byId[id], w = [];
      if (r.lockJunior === id) w.push('fixed here');
      if (k > 0) w.push('second junior (more juniors than rooms)');
      const postingMatch = p.posting && (r.flags.subspecs.some(x => sub[x]?.posting === p.posting) || (p.posting === 'SR' && r.flags.complex));
      if (postingMatch) w.push(`${p.posting} posting`);
      if (r.flags.complex && isResident(p)) w.push('resident for a complex list');
      if (isBaby(p)) w.push('Baby MO: with a senior who isn\'t double covering');
      else if (p.grade === 'MOPEX' && row.seniors.some(s => STRONG.includes(byId[s]?.grade))) w.push('MOPEX with a consultant');
      if (r.id === 'aocc') w.push('free after the OT lists');
      out[id] = w.join(' · ') || 'free, and suits the list';
    });
    for (const id of row.covers || []) out[id] = `ad hoc cover from ${homeOf[id]?.name || 'a nearby room'} (no junior free)`;
    return out;
  }

  const pacu = Object.fromEntries(allRooms.filter(r => isPacu(r.name)).map(r => [r.id, { roomId: r.id, label: r.name, complex: r.complex, senior: '', junior: '', premed: '', notes: r.notes || '' }]));
  const textRow = (r, senior, junior = '') => ({ roomId: r.id, label: r.name, complex: r.complex, senior, junior, premed: '', notes: '' });
  const rows = allRooms.map(r => {
    if (pacu[r.id]) return pacu[r.id];
    if (r.id === 'ahot') return textRow(r, fixed.ahot || '');
    if (r.id === 'aic') return textRow(r, fixed.aic || (aicPerson ? (aicPerson.role === 'senior' ? fmtSenior : fmtJunior)(aicPerson, dayOf(day, aicPerson)) : ''));
    if (r.id === 'aocc' && aoccFixed) return textRow(r, fixed['aocc.s'] || '', fixed['aocc.j'] || '');
    const row = rowOf[r.id];
    return {
      roomId: r.id,
      label: r.name,
      complex: r.complex,
      why: whyHere(r, row),
      senior: row.seniors.map(id => fmtSenior(byId[id], dayOf(day, byId[id]))).join(' / '),
      junior: [...row.juniors.map(id => fmtJunior(byId[id], dayOf(day, byId[id]))), ...(row.covers || []).map(id => `${byId[id].name} (C)`)].join(' / '),
      premed: row.premed ? `${byId[row.premed].name} - Premed` : '',
      notes: row.notes,
    };
  });
  const allUsed = new Set([...Object.values(rowOf).flatMap(r => [...r.seniors, ...r.juniors]), ...(aicPerson ? [aicPerson.id] : [])]);
  const unusedSeniors = staff.filter(p => p.role === 'senior' && isAvail(day, p) && !allUsed.has(p.id)).map(p => p.name);
  const unusedJuniors = staff.filter(p => p.role === 'junior' && isAvail(day, p) && !allUsed.has(p.id)).map(p => p.name);
  return { rows, warnings, unusedSeniors, unusedJuniors };
}

// ---------- checks on a (possibly hand-edited) roster ----------

// Someone leaving early is written "Name L-4pm" (or "L-4-5pm"); whoever covers the room is
// written "Name C-OT13", "Name C-KROR PACU" or "Name C-MOR 4". Returns rooms where a leaver has no cover.
const COVER_RE = /\bC-\s*(.+?)(?=\s+L-|\s+-\s|$)/i;
export function coverText(part) { return String(part).match(COVER_RE)?.[1].trim() || ''; }

// Which room a cover refers to: a full room name ("KROR PACU", "MOR 4"), or "OT13" / "13"
// meaning that room number in the coverer's own complex.
export function coverTarget(text, row, rows) {
  const t = String(text).toUpperCase().replace(/\s+/g, ' ').trim();
  const exact = rows.find(r => r.label.toUpperCase() === t);
  if (exact) return exact.label;
  const n = t.match(/^(?:OT\s*)?(\d+)$/)?.[1];
  if (n) return rows.find(r => r.complex === row.complex && roomNum(r.label) === +n)?.label || null;
  return null;
}

// A junior written "Name (C)" in a room is only an ad hoc cover there, not physically in it.
export const isCoverPart = part => /\(\s*C\s*\)/i.test(String(part));

export function missingCovers(rows) {
  const out = [];
  const covered = new Set();
  for (const row of rows) for (const col of ['senior', 'junior']) for (const part of String(row[col] || '').split('/')) {
    if (isCoverPart(part)) covered.add(row.label);
    const c = coverText(part);
    if (c) { const target = coverTarget(c, row, rows); if (target) covered.add(target); }
  }
  for (const row of rows) for (const col of ['senior', 'junior']) for (const part of String(row[col] || '').split('/')) {
    const m = part.match(/\bL-\s*([\d.:]+(?:\s*-\s*[\d.:]+)?\s*(?:am|pm)?)/i);
    if (m && !covered.has(row.label)) out.push({ row, name: namesInCell(part)[0] || part.trim(), when: m[1] });
  }
  return out;
}

export function check({ rows, staff, day, settings = DEFAULT_SETTINGS }) {
  const out = [];
  for (const m of missingCovers(rows)) {
    out.push({ level: 'warn', text: `${m.row.label}: ${m.name} leaves L-${m.when} but nobody covers the room (C-${/^\D+\s\d+$/.test(m.row.label) ? 'OT' + roomNum(m.row.label) : m.row.label}).` });
  }
  const sub = subspecByKey(settings);
  const roomById = Object.fromEntries(day.rooms.map(r => [r.id, r]));
  const where = {}; // person id -> [{row, col}]
  const resolve = (text, col, row) => namesInCell(text).map(n => {
    const m = matchName(n, staff);
    if (m.ambiguous) out.push({ level: 'warn', text: `${row.label}: "${n}" could be ${m.ambiguous.map(p => p.name).join(' or ')}.` });
    else if (!m.person) out.push({ level: 'warn', text: `${row.label}: "${n}" is not in the staff list.` });
    else (where[m.person.id] ||= []).push({ row, col });
    return m.person;
  }).filter(Boolean);

  const seniorsOf = {}, juniorsOf = {};
  for (const row of rows) {
    // AH OT (after hours) is a separate job, not a second room: it never counts as double cover
    seniorsOf[row.roomId] = resolve(row.senior, row.roomId === 'ahot' ? 'ahot' : 'senior', row);
    const parts = String(row.junior || '').split('/');
    juniorsOf[row.roomId] = resolve(parts.filter(x => !isCoverPart(x)).join('/'), 'junior', row);
    resolve(parts.filter(isCoverPart).join('/'), 'cover', row);
    resolve(String(row.premed || '').replace(/-\s*premed/i, ''), 'premed', row);
  }
  for (const [id, uses] of Object.entries(where)) {
    const p = staff.find(s => s.id === id);
    const d = dayOf(day, p);
    const st = d.status || 'avail';
    if (['leave', 'mc', 'postcall'].includes(st)) {
      const rooms = [...new Set(uses.map(u => u.row.label))];
      out.push({ level: 'error', fix: 'takeOff', person: p.id, rooms, text: `${p.name} is ${{ leave: 'on leave', mc: 'on MC', postcall: 'post call' }[st]} but rostered in ${rooms.join(', ')}.` });
    } else if (st === 'admin' || st === 'elsewhere') {
      const rooms = [...new Set(uses.filter(u => u.col !== 'premed').map(u => u.row.label))];
      if (rooms.length) out.push({ level: 'warn', fix: 'takeOff', person: p.id, rooms, text: `${p.name} is ${st === 'admin' ? 'on an admin day (no list)' : 'elsewhere today'} but rostered in ${rooms.join(', ')}.` });
    }
    const asJunior = uses.filter(u => u.col === 'junior');
    if (asJunior.length > 1) out.push({ level: 'warn', fix: 'cover', person: p.id, rooms: asJunior.map(u => u.row.label), text: `${p.name} is the junior in ${asJunior.map(u => u.row.label).join(' and ')}.` });
    const asSenior = uses.filter(u => u.col === 'senior');
    if (asSenior.length > 2) {
      const extra = asSenior.slice(2).map(u => u.row.label);
      out.push({ level: 'error', fix: 'reseat', col: 'senior', person: p.id, rooms: extra, text: `${p.name} is the senior in ${asSenior.length} rooms (${asSenior.map(u => u.row.label).join(', ')}); double cover is two at most.` });
    } else if (asSenior.length > 1) {
      const complexes = new Set(asSenior.map(u => u.row.complex));
      if (complexes.size > 1) out.push({ level: 'warn', rooms: asSenior.map(u => u.row.label), text: `${p.name} covers rooms in different complexes (${asSenior.map(u => u.row.label).join(', ')}).` });
    }
    if (asSenior.length && asJunior.length) {
      out.push({ level: 'warn', fix: 'reseat', col: 'junior', person: p.id, rooms: asJunior.map(u => u.row.label), text: `${p.name} is the senior in ${asSenior.map(u => u.row.label).join(', ')} and the junior in ${asJunior.map(u => u.row.label).join(', ')}.` });
    }
    const asPremed = uses.filter(u => u.col === 'premed');
    if (asPremed.length > settings.premedCap) out.push({ level: 'warn', fix: 'premed', rooms: asPremed.map(u => u.row.label), text: `${p.name} has premeds for ${asPremed.length} rooms (cap ${settings.premedCap}).` });
  }
  for (const row of rows) {
    const room = roomById[row.roomId];
    if (!room) continue;
    const flags = { subspecs: [], ...(room.flags || {}) };
    const sen = seniorsOf[row.roomId], jun = juniorsOf[row.roomId];
    if (!isPacu(row.label) && !String(row.senior || '').trim()) out.push({ level: 'error', fix: 'fill', rooms: [row.label], text: `${row.label}: no senior.` });
    for (const k of flags.subspecs) {
      if (!sub[k]?.hard) continue;
      if (sen.length && !sen.some(p => (p.subspecs || []).includes(k))) {
        out.push({ level: 'error', fix: 'reseat', col: 'senior', person: sen[0].id, rooms: [row.label], text: `${row.label}: ${sub[k].label} list but ${sen.map(p => p.name).join(' / ')} has no ${sub[k].label} subspec.` });
      }
    }
    for (const p of sen) {
      if ((p.avoid || []).some(a => flags.subspecs.includes(a) || hasKeyword(row.notes, a))) {
        out.push({ level: 'error', fix: 'reseat', col: 'senior', person: p.id, rooms: [row.label], text: `${row.label}: ${p.name} doesn't do this list.` });
      }
      if (dayOf(day, p).liverStandby && (flags.complex || flags.subspecs.some(k => sub[k]?.hard))) {
        out.push({ level: 'warn', fix: 'reseat', col: 'senior', person: p.id, rooms: [row.label], text: `${row.label}: ${p.name} is liver standby but has a complex/subspec list.` });
      }
    }
    for (const p of jun) {
      if (dayOf(day, p).liverStandby && flags.complex) out.push({ level: 'warn', fix: 'reseat', col: 'junior', person: p.id, rooms: [row.label], text: `${row.label}: ${p.name} is liver standby but has a complex list.` });
    }
    const shared = row.roomId !== 'ahot' && sen.some(p => (where[p.id] || []).filter(u => u.col === 'senior').length > 1);
    if (shared && jun.some(isBaby)) {
      out.push({ level: 'error', fix: 'reseat', col: 'junior', person: jun.find(isBaby).id, rooms: [row.label], text: `${row.label}: Baby MO in a room whose senior is double covering.` });
    }
    if (shared && flags.complex) out.push({ level: 'warn', rooms: [row.label], text: `${row.label}: complex list but senior is double covering.` });
    // a double-covered room needs its own junior (or a cover from another room) in it
    const juniorParts = String(row.junior || '').split('/').map(x => x.trim()).filter(Boolean);
    if (shared && !isPacu(row.label) && !juniorParts.length) {
      out.push({ level: 'error', fix: 'fill', rooms: [row.label], text: `${row.label}: no junior, and the senior is double covering.` });
    }
    const needPremed = jun.some(p => dayOf(day, p).notAroundPrev) && !jun.some(p => !dayOf(day, p).notAroundPrev && !isBaby(p));
    if (needPremed && !String(row.premed || '').trim()) out.push({ level: 'warn', fix: 'premed', rooms: [row.label], text: `${row.label}: junior wasn't around yesterday — needs premed cover.` });
  }
  return out;
}

// ---------- learning from past rosters ----------

const ROOM_RE = /^\s*((KROR|MCOR|MOR)\s*\d+)/i;

// rows: [{label, senior, junior, premed, notes}] from one roster file.
export function learnFromRosters(rosterRows, staff, settings = DEFAULT_SETTINGS) {
  const people = staff.map(p => ({ ...p, aliases: [...(p.aliases || [])], history: { ...(p.history || {}) } }));
  const rooms = [];
  let nextId = 1 + people.reduce((m, p) => Math.max(m, parseInt(String(p.id).replace(/\D/g, ''), 10) || 0), 0);
  const counts = {}; // id -> {senior, junior}
  const postingSeen = {};

  const add = (raw, col, notes, label) => {
    for (const n of namesInCell(raw)) {
      if (n.length < 3) continue;
      const m = matchName(n, people);
      let p = m.person;
      if (m.ambiguous) continue;
      if (!p) {
        // a short form ("Seah MP") is only useful once we know the full name
        if (tokens(n).length < 2 || tokens(n).some(t => t.length <= 2)) continue;
        p = { id: 'p' + nextId++, source: 'roster', name: n, aliases: [], role: col, grade: DEFAULT_GRADE[col], posting: '', subspecs: [], avoid: [], history: {} };
        people.push(p);
      } else if (norm(n) !== norm(p.name) && !p.aliases.some(a => norm(a) === norm(n))) {
        if (tokens(n).length > tokens(p.name).length) { p.aliases.push(p.name); p.name = n; } else p.aliases.push(n);
      }
      const c = (counts[p.id] ||= { senior: 0, junior: 0 });
      c[col]++;
      if (col === 'senior') for (const k of suggestFlags(notes, settings, label).subspecs) p.history[k] = (p.history[k] || 0) + 1;
    }
    if (col === 'junior') {
      for (const part of String(raw).split('/')) {
        const tag = part.match(/\((RA|P|L|SR|Neu|Amb|Cardiac|ENT|Vasc|Remote|PACU|HPB|LivOT)\)/)?.[1];
        const nm = namesInCell(part)[0];
        if (!tag || !nm) continue;
        const p = matchName(nm, people).person;
        if (p) postingSeen[p.id] = tag === 'LivOT' ? 'L' : tag;
      }
    }
  };

  for (const r of rosterRows) {
    const m = String(r.label).match(ROOM_RE);
    const remote = remoteRoom(r.label);
    const isRemote = !!remote;
    if (!m && !isRemote) continue;
    const name = isRemote ? remote : m[1].toUpperCase().replace(/\s+/, ' ');
    if (!rooms.some(x => x.name === name)) rooms.push({ complex: isRemote ? 'Other' : m[2].toUpperCase(), name });
    add(r.senior, 'senior', r.notes || '', name);
    add(r.junior, 'junior', r.notes || '', name);
  }
  for (const p of people) {
    const c = counts[p.id];
    if (c && !staff.some(s => s.id === p.id)) p.role = c.senior >= c.junior ? 'senior' : 'junior';
    if (p.role === 'senior' && SENIOR_GRADES.indexOf(p.grade) < 0) p.grade = DEFAULT_GRADE.senior;
    if (p.role === 'junior' && JUNIOR_GRADES.indexOf(p.grade) < 0) p.grade = DEFAULT_GRADE.junior;
    if (postingSeen[p.id] && !p.posting) p.posting = postingSeen[p.id];
  }
  const order = { Other: 0, KROR: 1, MCOR: 2, MOR: 3 };
  rooms.sort((a, b) => (order[a.complex] - order[b.complex]) || (roomNum(a.name) - roomNum(b.name)));
  return { staff: people, rooms };
}

// Tick each senior's subspecs from the lists they were seen doing in past rosters.
// Only adds ticks; returns how many were added.
export function tickFromHistory(staff, minCount = 1) {
  let added = 0;
  for (const p of staff) {
    if (p.role !== 'senior') continue;
    for (const [k, n] of Object.entries(p.history || {})) {
      if (n >= minCount && !(p.subspecs || []).includes(k)) { (p.subspecs ||= []).push(k); added++; }
    }
  }
  return added;
}

// ---------- merging a contact list ----------

// Match a contact-list name ("Melody Goh Bee Hoon") to a staff entry ("Melody Goh") either way round.
export function findSameStaff(name, staff) {
  const m = matchName(name, staff);
  if (m.person) return m.person;
  const squash = n => tokens(n).join('');
  const hits = staff.filter(p => [p.name, ...(p.aliases || [])].some(f => matchName(f, [{ id: 'x', name }]).person
    || squash(f) === squash(name)));
  return hits.length === 1 ? hits[0] : null;
}

// How alike two names are as the same person: 3 the same name (any order, spacing or case),
// 2 one is a fuller form of the other ("Koh YW" / "Koh Yi Wen Gerald"), 1 a single shared name
// ("Divya" / "Divya Ramesh"), 0 different people.
export function sameNameScore(a, b) {
  const fa = [a.name, ...(a.aliases || [])].filter(Boolean), fb = [b.name, ...(b.aliases || [])].filter(Boolean);
  const sorted = n => tokens(n).sort().join(' '), squash = n => tokens(n).sort().join('');
  if (fa.some(x => fb.some(y => sorted(x) === sorted(y) || squash(x) === squash(y)))) return 3;
  const one = (x, ys) => nameMatchesForms(x, ys);
  return Math.max(...fa.map(x => one(x, fb)), ...fb.map(y => one(y, fa)));
}

// Pairs of staff who look like the same person, most likely first. Pairs marked as different
// people (notDup) are left out; a single shared first name only counts when nobody else has it.
export function findDuplicates(staff) {
  const out = [];
  for (let i = 0; i < staff.length; i++) for (let j = i + 1; j < staff.length; j++) {
    const a = staff[i], b = staff[j];
    if ((a.notDup || []).includes(b.id) || (b.notDup || []).includes(a.id)) continue;
    const sc = sameNameScore(a, b);
    if (!sc) continue;
    if (sc === 1) {
      const short = tokens(a.name).length <= tokens(b.name).length ? a : b;
      if (staff.filter(p => p !== short && sameNameScore(short, p)).length > 1) continue;
    }
    out.push({ a, b, score: sc });
  }
  return out.sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name));
}

// Fold one person into another: the kept record gets the other's names as short names and
// anything it lacks (subspecs, lists they don't do, history, posting, colour).
export function mergeStaffRecords(keep, drop) {
  const names = new Set((keep.aliases || []).map(norm));
  const aliases = [...(keep.aliases || [])];
  for (const n of [drop.name, ...(drop.aliases || [])]) if (n && norm(n) !== norm(keep.name) && !names.has(norm(n))) { names.add(norm(n)); aliases.push(n); }
  const history = { ...(keep.history || {}) };
  for (const [k, v] of Object.entries(drop.history || {})) history[k] = (history[k] || 0) + v;
  return {
    ...keep, aliases, history,
    subspecs: [...new Set([...(keep.subspecs || []), ...(drop.subspecs || [])])],
    avoid: [...new Set([...(keep.avoid || []), ...(drop.avoid || [])])],
    posting: keep.posting || drop.posting || '',
    colour: keep.colour || drop.colour || '',
  };
}

// added by a contact-list import ('import' is the older name for it; staff sheets give 'sheet')
const fromContact = p => p.source === 'contact' || p.source === 'import';

// What importing person c (from a contact list or staff sheet) changes on staff member p.
// Returns { p: updated copy, changes: ['grade AC → C', …] }.
export function importUpdate(p, c, contact = true) {
  const q = { ...p, subspecs: [...(p.subspecs || [])], aliases: [...(p.aliases || [])] };
  const changes = [];
  const set = (k, v, label = k) => { if (v != null && v !== '' && q[k] !== v) { changes.push(`${label} ${q[k] || '—'} → ${v}`); q[k] = v; } };
  if (contact) {
    // the contact list is older than the rosters: its role only counts for people it added itself
    if (fromContact(p)) { set('role', c.role); set('grade', c.grade); }
    else if (p.role === c.role) set('grade', c.grade);
  } else {
    set('role', c.role); set('grade', c.grade); set('posting', c.posting);
    for (const k of c.avoid || []) if (!(q.avoid ||= []).includes(k)) { q.avoid = [...q.avoid, k]; changes.push(`doesn't do + ${k}`); }
  }
  for (const k of c.subspecs || []) if (!q.subspecs.includes(k)) { q.subspecs.push(k); changes.push(`subspec + ${k}`); }
  for (const n of [...(c.aliases || []), ...(norm(c.name) !== norm(p.name) ? [c.name] : [])]) {
    if (n && norm(n) !== norm(q.name) && !q.aliases.some(a => norm(a) === norm(n))) { q.aliases.push(n); changes.push(`also known as ${n}`); }
  }
  return { p: q, changes };
}

// How an import would go, before anything changes: people matched (with what changes),
// people who might be someone already on the list, new people, and names set to always skip.
export function planImport(staff, people, { contact = true, skip = [] } = {}) {
  const skipSet = new Set(skip.map(norm));
  const items = [];
  const matched = new Set();
  for (const c of people) {
    if (skipSet.has(norm(c.name))) { items.push({ kind: 'skipped', c }); continue; }
    const p = findSameStaff(c.name, staff);
    if (p && !matched.has(p.id)) { matched.add(p.id); items.push({ kind: 'match', c, p, ...importUpdate(p, c, contact) }); continue; }
    const candidates = staff.map(s => ({ s, sc: sameNameScore({ name: c.name, aliases: c.aliases || [] }, s) }))
      .filter(x => x.sc).sort((a, b) => b.sc - a.sc).slice(0, 4).map(x => x.s);
    if (candidates.length) items.push({ kind: 'maybe', c, candidates });
    else items.push({ kind: contact && c.role === 'junior' ? 'newJunior' : 'new', c });
  }
  // people an earlier import of the contact list added who are no longer on it
  const maybeIds = new Set(items.flatMap(i => (i.candidates || []).map(x => x.id)));
  const stale = contact ? staff.filter(p => fromContact(p) && !matched.has(p.id) && !maybeIds.has(p.id)) : [];
  return { items, stale };
}

// Fold contact-list people into the staff list. Matched people get the list's subspecs added,
// and its grade only if their role hasn't changed since (rosters are newer than the list).
// New seniors are added; new juniors are not, since junior postings rotate.
export function mergeContacts(staff, people, newId) {
  const out = staff.map(p => ({ ...p, subspecs: [...(p.subspecs || [])] }));
  const skipped = [];
  for (const c of people) {
    const p = findSameStaff(c.name, out);
    if (p) {
      p.inContactList = true;
      if (fromContact(p)) { p.role = c.role; p.grade = c.grade; p.name = c.name; }
      else if (p.role === c.role && p.grade !== c.grade) p.grade = c.grade;
      for (const k of c.subspecs) if (!p.subspecs.includes(k)) p.subspecs.push(k);
    } else if (c.role === 'senior') {
      out.push({ id: newId(), source: 'contact', name: c.name, aliases: [], role: c.role, grade: c.grade, posting: '', subspecs: c.subspecs, avoid: [], history: {}, inContactList: true });
    } else skipped.push(c.name);
  }
  // people added by an earlier import of this list who aren't anaesthetists (admin, nursing…)
  const stale = out.filter(p => fromContact(p) && !p.inContactList);
  const kept = out.filter(p => !(fromContact(p) && !p.inContactList));
  kept.forEach(p => { delete p.inContactList; });
  return { staff: kept, skipped, removed: stale.map(p => p.name) };
}

// ---------- short names ----------

// Common surnames in the department's names; used to tell "Koh Yi Wen" (surname first)
// from "Anjali Varma" (given name first).
const SURNAMES = new Set(`tan lim lee ng ong wong goh chua chan koh teo ang yeo tay ho low toh sim chong chia seah foo
  leong loh poh neo lau yap chew phua peng chen huang zhang liu wang li hwang tham tiong khoo quek oon chern cheah eu ti
  kang boey bao cui shen wo go chionh lui er oo hong lam chang zhao zhou wu xu sun ma hu guo he lin luo song tang han
  feng deng cao xie yang liang chiew chng gan heng hoe kek kwek lai lau leow lew liew lo mok pang pek seet soh tee teh
  thong wee yong yeoh yeow yip yu zheng choo fung kwan ling mah ow siew tung woo aw lum
  foong ngiam sng ting loke au kwok kok hoo hsu chiam chin chee choy eng fong kee khor kong ku lek loo lye mak neoh ooi
  pua see sia sin siow soo tai tey tng tsang wan yee yin yoong yuen quah thio tian`.split(/\s+/).filter(Boolean));

// Common given names, mostly English: written as an initial and the surname ("R Chua").
const COMMON_GIVEN = new Set(`aaron abigail adam adeline adrian agnes aidan aileen alan albert alex alexander alexandra alexis alfred
  alice alicia alison amanda amber amelia amy andrea andrew andy angel angela angeline anita ann anna anne annette anthony april
  arthur ashley audrey barbara ben benedict benjamin bernard beth bethany betty bianca bill bob bonnie brandon brenda brian bridget
  bryan caitlin caleb calvin cameron carl carmen carol caroline carolyn catherine cecilia celeste charlene charles charlotte chelsea cheryl
  chloe chris christina christine christopher cindy claire clara clarence claribel clarissa claudia clement colin connie constance
  cynthia daisy dale damien daniel danielle danny daphne darren david dawn dean deborah debbie denise dennis derek desmond diana
  diane dominic donald doris dorothy douglas dylan eda edmund edward edwin eileen elaine eleanor elizabeth ella ellen emily emma
  eric erica esther ethan eugene eunice eva evelyn faith felicia fiona florence frances francis frank freda gabriel gareth gary
  gavin genevieve geoffrey george gerald gilbert gillian gina glen glenn gloria grace graham grant gregory hannah harold harry hazel
  heather helen henry hilary iris ivy jocelyn kenny hillary howard ian irene isaac isabel isabelle ivan jack jacqueline jade james jamie jane janet janice
  jared jasmin jasmine jason jean jeanette jeffrey jennifer jenny jeremy jerome jerry jessica jill joan joanna joanne joe joel john
  johnny jolene jonathan joseph josephine joshua joy joyce judith judy julia julian juliana julie justin karen kate katherine kathleen
  kathy katrina keith kelly kelvin kenneth kevin kimberly kristen lance laura lauren lawrence leonard leslie lillian linda lindsay
  lionel lisa lois lorraine louis louise lucas lucy lydia lynn mabel madeline magdalene malcolm marcus margaret maria marian marie
  marilyn mark martha martin mary matthew maureen maurice maxine megan melanie melissa melvin michael michelle miranda molly monica
  nancy natalie nathan nathaniel neil nelson nicholas nicole noel nora norman olivia oscar pamela patricia patrick paul paula pauline
  peggy penelope peter philip phoebe phyllis priscilla rachel ralph raymond rebecca regina reuben rex richard rita robert robin
  roger ronald rose rosemary ruby russell ruth ryan sabrina samantha samuel sandra sarah sean serene sharon sheila shirley sophia
  sophie stacey stanley stella stephanie stephen steven susan suzanne sylvia tabitha terence teresa terry theodore theresa thomas
  tiffany timothy tina tracy trevor valerie vanessa veronica victor victoria vincent violet vivian walter wendy william winnie
  yvonne zachary zach zoe`.split(/\s+/).filter(Boolean));

// The way names are written on the leave and post call lists:
// "Koh Yi Wen" -> "Koh YW", "Lim Xinyi" -> "Xinyi", "Anjali Varma" -> "Anjali",
// "Gavin Teo Wen Hao" -> "G Teo", "Robert Ashford" -> "R Ashford".
export function suggestShortName(name) {
  let t = String(name).replace(/\(.*?\)/g, ' ').replace(/[^A-Za-z\-' ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  while (t.length > 1 && t[0].length === 1) t = t.slice(1); // "S. Kavinesh"
  if (t.length < 2) return t[0] || '';
  const isSurname = w => SURNAMES.has(w.toLowerCase());
  if (isSurname(t[0])) {
    // a trailing English name isn't part of the initials: "Koh Yi Wen Gerald" -> "Koh YW"
    let given = t.slice(1).flatMap(w => w.split('-')).filter(Boolean);
    if (given.length > 2 && COMMON_GIVEN.has(given[given.length - 1].toLowerCase())) given = given.slice(0, -1);
    if (given.length === 1) return given[0].length <= 4 ? t.join(' ') : given[0]; // "Ng Kai" stays as is
    return `${t[0]} ${given.map(w => w[0].toUpperCase()).join('')}`;
  }
  if (COMMON_GIVEN.has(t[0].toLowerCase())) {
    // the surname comes straight after the English given name(s): "Rebecca Victoria Lau Rui Xin" -> Lau
    let i = 1;
    while (i < t.length - 1 && COMMON_GIVEN.has(t[i].toLowerCase())) i++;
    const last = t[i];
    return `${t[0][0].toUpperCase()} ${last}`;
  }
  return t[0];
}

// Suggest a short name for everyone who has none, skipping any that would clash with
// another person's name or short name. Returns [{ id, name, short }].
export function suggestShortNames(staff) {
  const key = s => String(s).toLowerCase().trim();
  const taken = new Map(); // form -> person id
  for (const p of staff) for (const f of [p.name, ...(p.aliases || [])]) taken.set(key(f), taken.has(key(f)) ? null : p.id);
  const proposals = staff.filter(p => !(p.aliases || []).length && p.name).map(p => ({ id: p.id, name: p.name, short: suggestShortName(p.name) }));
  const count = {};
  for (const x of proposals) count[key(x.short)] = (count[key(x.short)] || 0) + 1;
  return proposals.filter(x => x.short && key(x.short) !== key(x.name) && count[key(x.short)] === 1
    && (!taken.has(key(x.short)) || taken.get(key(x.short)) === x.id));
}

// ---------- what changed since the roster was sent ----------

// The parts of the roster a reader cares about, small enough to keep for each date sent.
export const sentRows = rows => rows.map(r => ({ label: r.label, senior: r.senior || '', junior: r.junior || '', premed: r.premed || '' }))
  .filter(r => r.senior || r.junior || r.premed);
// Room by room, what is different now: [{ label, what, from, to }] (what: senior, junior, premed; a room
// added or closed shows as from '' or to '').
export function rosterChanges(before, after) {
  const by = rows => Object.fromEntries(sentRows(rows).map(r => [r.label, r]));
  const a = by(before || []), b = by(after || []);
  const out = [];
  for (const label of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
    for (const what of ['senior', 'junior', 'premed']) {
      const from = (a[label]?.[what] || '').trim(), to = (b[label]?.[what] || '').trim();
      if (from !== to) out.push({ label, what, from, to });
    }
  }
  return out;
}
export const changeText = c => `${c.label} ${c.what}: ${c.from || '(none)'} → ${c.to || '(none)'}`;
