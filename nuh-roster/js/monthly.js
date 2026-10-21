// The department's monthly rosters (HMS exports): reading them from PDF or Excel, writing them
// back out in the same layout, and what each one means for a given day.
// Data shape, per month ('2022-10'):
//   grid rosters: { rows: { '1': { r1: 'Name', … }, … } }
//   leave:        { entries: [{ name, from: '2022-10-01', to: '2022-10-04', type, remarks }] }

// `to`: the Calls/clinics field the column fills on that day. `group`: the band above the header.
// `pdf`: the header text in the HMS file (several columns may share one; they go left to right).
export const MONTHLY = [
  { id: 'pain', label: 'Pain Monthly', title: 'Pain Roster', cols: [
    { key: 'painacp.s', label: 'Pain/ACP Clinic (Senior)', group: 'Pain/ACP Clinic', to: 'painacp.s' },
    { key: 'painacp.a', label: 'Pain/ACP Clinic (Junior)', group: 'Pain/ACP Clinic', to: 'painacp.a' },
    { key: 'acute.s', label: 'Acute Pain (Senior)', group: 'Acute Pain', to: 'acute.s' },
    { key: 'acute.a', label: 'Acute Pain (Junior)', group: 'Acute Pain', to: 'acute.a' },
    { key: 'chronic.s', label: 'Chronic Pain (Senior)', group: 'Chronic Pain', to: 'chronic.s' },
    { key: 'chronic.a', label: 'Chronic Pain (Junior)', group: 'Chronic Pain', to: 'chronic.a' },
  ] },
  { id: 'liver', label: 'Liver Monthly', title: 'Liver Transplant Roster', match: /liver/i, cols: [
    { key: 'otj', label: 'OT (Junior)', liver: true },
    { key: 'ots', label: 'OT (Senior)', liver: true },
    { key: 'icu', label: 'ICU' },
    { key: 'donor', label: 'Donor' },
  ] },
  { id: 'leave', label: 'Leave Monthly', title: 'Leave Roster', match: /leave roster/i, list: true,
    cols: [{ key: 'name', label: 'Name' }, { key: 'period', label: 'Leave Period' }, { key: 'type', label: 'Leave Type' }, { key: 'remarks', label: 'Remarks' }] },
  { id: 'aoh', label: 'AOH Monthly', title: 'Night List (After Office Hr) Roster', match: /night list|after office/i, cols: [
    { key: 'aoh', label: 'AOH' },
    { key: 'standby', label: 'AOH Standby' },
    { key: 'exts', label: 'Extended List (Senior)' },
    { key: 'extj', label: 'Extended List (Junior)' },
  ] },
  { id: 'junior', label: 'Junior Monthly', title: 'Junior On Call Roster', match: /junior on call/i, cols: [
    { key: 'r1', label: 'R1', group: 'Operating Theatre', to: 'mot.res1', night: true },
    { key: 'r2', label: 'R2', group: 'Operating Theatre', to: 'mot.res2', night: true },
    { key: 'r3', label: 'R3', group: 'Operating Theatre', to: 'mot.res3', night: true },
    { key: 'df', label: 'Day Float', group: 'Operating Theatre', to: 'epi.df' },
    { key: 'nf', label: 'Night Float', group: 'Operating Theatre', to: 'epi.nf', night: true },
    { key: 's1am', label: 'R/SR/AC Stay-in S1 (8:30am to 1pm)', pdf: 'R/SR/AC Stay-in S1', group: 'Operating Theatre' },
    { key: 's1pm', label: 'R/SR/AC Stay-in S1 (1pm to 8:30am)', pdf: 'R/SR/AC Stay-in S1', group: 'Operating Theatre', to: 'mot.reg', night: true },
    { key: 'ref', label: 'Anaesthesia Referral (8:30am to 5pm)', pdf: 'Anaesthesia Referral', group: 'Operating Theatre' },
    { key: 'epid', label: 'Epidural (D) (8.30am to 5pm)', pdf: 'Epidural (D)', group: 'Epidural', to: 'epi.s' },
    { key: 'epin', label: 'Epidural (N) (5pm to 8.30am)', pdf: 'Epidural (N)', group: 'Epidural', night: true },
    { key: 'sicumo', label: 'SICU MO', group: 'Intensive Care Units', to: 'sicu.res1', night: true },
    { key: 'icureg', label: 'ICU Registrar', group: 'Intensive Care Units', to: 'sicu.reg', night: true },
  ] },
  { id: 'senior', label: 'Senior Monthly', title: 'Senior On Call Roster', match: /senior on call/i, cols: [
    { key: 'cons', label: 'Cons S3', group: 'Operating Theatre', to: 'mot.cons' },
    { key: 'c1', label: 'C1', group: 'Cardiac Operating Theatre', to: 'cardiac.s' },
    { key: 'c2', label: 'C2', group: 'Cardiac Operating Theatre' },
    { key: 'c3', label: 'C3 (MO)', group: 'Cardiac Operating', to: 'cardiac.a' },
    { key: 'tee', label: 'TEE Cons', pdf: 'Cons', group: 'Tee' },
    { key: 'sicu', label: 'SICU Cons', group: 'Intensive Care Units', to: 'sicu.cons' },
  ] },
];
export const monthlyDef = id => MONTHLY.find(m => m.id === id);
export const LEAVE_TYPES = ['Annual Leave', 'Medical Leave', 'Conference Leave', 'Training Leave', 'Study Leave', 'Exam Leave', 'Maternity Leave', 'Other Leave'];
// The overnight duties after which someone is post call, as 'junior.r1' etc.
export const NIGHT_DUTIES = MONTHLY.flatMap(m => m.cols.filter(c => c.night).map(c => `${m.id}.${c.key}`));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
// "Ng Kai []" -> "Ng Kai"
export const cleanCell = s => String(s ?? '').replace(/\[\s*\]/g, '').replace(/\s+/g, ' ').trim();

export const daysIn = month => new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate();
export const weekday = (month, d) => WEEKDAYS[new Date(+month.slice(0, 4), +month.slice(5, 7) - 1, d).getDay()];
export const monthName = month => `${MONTHS[+month.slice(5, 7) - 1]} ${month.slice(0, 4)}`;
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const addDays = (date, n) => { const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + n)); return d.toISOString().slice(0, 10); };

// "Anaesthesia - Junior On Call Roster For Oct 2022" -> { kind: 'junior', month: '2022-10' }
export function parseTitle(text) {
  const t = String(text || '');
  const m = t.match(/\bfor\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/i);
  const mi = m ? MONTHS.findIndex(x => x.toLowerCase() === m[1].toLowerCase()) : -1;
  const kind = MONTHLY.find(r => r.match && r.match.test(t))?.id || (/pain/i.test(t) ? 'pain' : null);
  return { kind, month: mi >= 0 ? `${m[2]}-${String(mi + 1).padStart(2, '0')}` : null };
}

// "1 Oct - 4 Oct" / "6 Oct" / "29 Sep - 2 Oct" in the roster's month -> ISO dates
export function parsePeriod(text, month) {
  const y = +month.slice(0, 4), m0 = +month.slice(5, 7);
  const parts = String(text).split(/\s*[-–]\s*/).map(s => s.trim()).filter(Boolean);
  const one = s => {
    const x = s.match(/^(\d{1,2})\s*([A-Za-z]{3})?/);
    if (!x) return null;
    const mi = (x[2] && MONTHS.findIndex(k => k.toLowerCase() === x[2].toLowerCase()) + 1) || m0;
    // a month well before the roster's month is next year's (December rosters running into January)
    const yy = mi < m0 - 6 ? y + 1 : mi > m0 + 6 ? y - 1 : y;
    return iso(yy, mi || m0, +x[1]);
  };
  const from = one(parts[0] || ''), to = one(parts[1] || parts[0] || '');
  return from ? { from, to: to || from } : null;
}
export function formatPeriod(e) {
  const f = d => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;
  return e.from === e.to ? f(e.from) : `${f(e.from)} - ${f(e.to)}`;
}

// Assign header labels to the roster's columns: exact header text, shared text taken left to right.
function headerColumns(def, headers) {
  const out = [];
  const used = new Set();
  for (const c of def.cols) {
    const want = [c.label, c.pdf].filter(Boolean).map(norm);
    const h = headers.filter(x => want.includes(norm(x.text)) && !used.has(x)).sort((a, b) => a.x - b.x)[0];
    if (h) { used.add(h); out.push({ col: c, ...h }); }
  }
  return out.sort((a, b) => a.x - b.x);
}

// ---- PDF (text with positions, from pdf.js) ----

// items: [{ str, x, y, w }] per page. Returns { kind, month, data, cols } or { error }.
export function readMonthlyPdf(pages) {
  const all = pages.flat();
  // the title may be one text item or several on one line
  const titleText = [...all.map(i => i.str), ...groupRows(all).map(r => r.map(i => i.str).join(' '))]
    .find(t => /roster\b.*\bfor\s+[a-z]{3}/i.test(t));
  const { kind, month } = parseTitle(titleText);
  if (!kind || !month) return { error: 'This doesn\'t look like one of the monthly rosters (no "… Roster For <month> <year>" title).' };
  const def = monthlyDef(kind);
  const found = new Set();
  let heads = [];
  if (def.list) {
    const entries = [];
    for (const items of pages) {
      const own = headerColumns(def, items.map(i => ({ text: i.str, x: i.x, y: i.y, w: i.w })));
      if (own.length) heads = own; // a page without headers carries on with the last page's
      if (!heads.length) continue;
      heads.forEach(hh => found.add(hh.col.key));
      const hy = own.length ? Math.min(...own.map(hh => hh.y)) : Infinity;
      // left-aligned columns: an item belongs to the last header starting at or before it
      const colOf = it => [...heads].reverse().find(hh => hh.x - 10 <= it.x);
      const lines = groupRows(items.filter(i => i.y < hy - 2 && !/powered by|^\d+\s*\/\s*\d+$/i.test(i.str)));
      const isEntry = line => line.some(it => colOf(it)?.col.key === 'period' && parsePeriod(it.str, month));
      for (const { items: row } of bands(lines, isEntry)) {
        const rec = {};
        for (const it of row) {
          const col = colOf(it);
          if (col) rec[col.col.key] = cleanCell([rec[col.col.key], it.str].filter(Boolean).join(' '));
        }
        const p = rec.period && parsePeriod(rec.period, month);
        if (rec.name && p) entries.push({ name: rec.name, ...p, type: rec.type || '', remarks: rec.remarks || '' });
      }
    }
    return { kind, month, data: { entries }, cols: [...found] };
  }
  const rows = {};
  const isDay = ([d, wd]) => d && /^\d{1,2}$/.test(d.str.trim()) && wd && WEEKDAYS.includes(wd.str.trim());
  for (const items of pages) {
    const own = headerColumns(def, items.map(i => ({ text: i.str, x: i.x + i.w / 2, y: i.y })));
    if (own.length) heads = own;
    if (!heads.length) continue;
    heads.forEach(hh => found.add(hh.col.key));
    const hy = own.length ? Math.min(...own.map(hh => hh.y)) : Infinity;
    for (const { anchor, items: row } of bands(groupRows(items.filter(i => i.y < hy - 2)), isDay)) {
      const rec = (rows[+anchor[0].str] ||= {});
      // centred headers: an item belongs to the first column whose centre lies to its right
      for (const it of row) {
        if (it === anchor[0] || it === anchor[1]) continue;
        const col = heads.find(hh => hh.x > it.x);
        if (col) rec[col.col.key] = cleanCell([rec[col.col.key], it.str].filter(Boolean).join(' '));
      }
    }
  }
  return { kind, month, data: { rows }, cols: [...found] };
}

// items on one line, left to right, top to bottom
function groupRows(items) {
  const rows = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const r = rows.find(r => Math.abs(r.y - it.y) <= 3);
    if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  return rows.map(r => r.items.sort((a, b) => a.x - b.x));
}

// Text wrapped onto a second line in a cell sits a little above or below its row's main line.
// Each anchor line (a day, a leave entry) takes the lines nearest it, within half a row.
// Returns [{ anchor, items }], the items top to bottom then left to right.
function bands(lines, isAnchor) {
  const anchors = lines.filter(isAnchor);
  if (!anchors.length) return [];
  const ys = anchors.map(l => l[0].y);
  const gaps = ys.slice(1).map((y, i) => ys[i] - y).filter(g => g > 0).sort((a, b) => a - b);
  const reach = Math.min(14, (gaps[Math.floor(gaps.length / 2)] || 20) / 2);
  const out = anchors.map(l => [...l]);
  for (const l of lines) {
    if (anchors.includes(l)) continue;
    let best = -1;
    ys.forEach((y, i) => { if (Math.abs(y - l[0].y) < reach && (best < 0 || Math.abs(y - l[0].y) < Math.abs(ys[best] - l[0].y))) best = i; });
    if (best >= 0) out[best].push(...l);
  }
  return out.map((r, i) => ({ anchor: anchors[i], items: r.sort((a, b) => b.y - a.y || a.x - b.x) }));
}

// ---- Excel (the same layout, e.g. an export from here) ----

export function readMonthlyXlsx(ws, cellText) {
  let title = '';
  ws.eachRow((row) => row.eachCell(c => { const t = cellText(c.value); if (!title && /roster\b.*\bfor\s+[a-z]{3}/i.test(t)) title = t; }));
  const { kind, month } = parseTitle(title);
  if (!kind || !month) return { error: 'This doesn\'t look like one of the monthly rosters (no "… Roster For <month> <year>" title).' };
  const def = monthlyDef(kind);
  let headRow = 0, heads = [];
  ws.eachRow((row, n) => {
    if (headRow) return;
    const cells = [];
    row.eachCell((c, i) => cells.push({ text: cellText(c.value).trim(), x: i }));
    const hs = headerColumns(def, cells);
    if (hs.length >= Math.min(2, def.cols.length)) { headRow = n; heads = hs; }
  });
  if (!headRow) return { error: `Couldn't find the ${def.label} column headings.` };
  const get = (row, x) => cleanCell(cellText(row.getCell(x).value));
  if (def.list) {
    const entries = [];
    ws.eachRow((row, n) => {
      if (n <= headRow) return;
      const rec = Object.fromEntries(heads.map(hh => [hh.col.key, get(row, hh.x)]));
      const p = rec.period && parsePeriod(rec.period, month);
      if (rec.name && p) entries.push({ name: rec.name, ...p, type: rec.type || '', remarks: rec.remarks || '' });
    });
    return { kind, month, data: { entries }, cols: heads.map(hh => hh.col.key) };
  }
  const rows = {};
  ws.eachRow((row, n) => {
    if (n <= headRow) return;
    const d = parseInt(get(row, 1), 10);
    if (!(d >= 1 && d <= 31)) return;
    rows[d] = Object.fromEntries(heads.map(hh => [hh.col.key, get(row, hh.x)]).filter(([, v]) => v));
  });
  return { kind, month, data: { rows }, cols: heads.map(hh => hh.col.key) };
}

// The roster as an .xlsx in the HMS layout: title, a band of groups, the headings, a row per day.
export function buildMonthlyWorkbook(ExcelJS, kind, month, data) {
  const def = monthlyDef(kind);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(def.label, { pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const thin = { style: 'thin' };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const head = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FB' } };
  const lead = def.list ? [] : ['Date', 'Day'];
  const labels = [...lead, ...def.cols.map(c => c.label)];
  ws.columns = labels.map((l, i) => ({ width: i < lead.length ? 7 : def.list ? 28 : 24 }));
  const title = ws.getCell(1, 1);
  title.value = `Anaesthesia - ${def.title} For ${monthName(month)}`;
  title.font = { bold: true, size: 13 };
  ws.mergeCells(1, 1, 1, labels.length);
  title.alignment = { horizontal: 'center' };
  let r = 3;
  const groups = def.cols.some(c => c.group);
  if (groups) {
    let i = 0;
    while (i < def.cols.length) {
      let j = i;
      while (j + 1 < def.cols.length && def.cols[j + 1].group === def.cols[i].group) j++;
      const c = ws.getCell(r, lead.length + i + 1);
      c.value = def.cols[i].group || ''; c.font = { bold: true }; c.alignment = { horizontal: 'center' }; c.border = border; c.fill = head;
      if (j > i) ws.mergeCells(r, lead.length + i + 1, r, lead.length + j + 1);
      i = j + 1;
    }
    lead.forEach((l, k) => { const c = ws.getCell(r, k + 1); c.border = border; c.fill = head; });
    r++;
  }
  labels.forEach((l, k) => { const c = ws.getCell(r, k + 1); c.value = l; c.font = { bold: true }; c.alignment = { horizontal: 'center', wrapText: true }; c.border = border; c.fill = head; });
  r++;
  if (def.list) {
    for (const e of [...(data?.entries || [])].sort((a, b) => a.name.localeCompare(b.name) || a.from.localeCompare(b.from))) {
      [e.name, formatPeriod(e), e.type, e.remarks].forEach((v, k) => { const c = ws.getCell(r, k + 1); c.value = v || ''; c.border = border; });
      r++;
    }
  } else {
    for (let d = 1; d <= daysIn(month); d++) {
      const rec = data?.rows?.[d] || {};
      const vals = [d, weekday(month, d), ...def.cols.map(c => rec[c.key] || '')];
      vals.forEach((v, k) => { const c = ws.getCell(r, k + 1); c.value = v; c.border = border; if (k < 2) { c.alignment = { horizontal: 'center' }; c.font = { bold: k === 1 }; } });
      r++;
    }
  }
  return wb;
}

// ---- what the rosters say about one day ----

// Each roster's entries for a date: { junior: { r1: 'Name', … }, … }
export function dutiesOn(monthly, date) {
  const m = monthly?.[date.slice(0, 7)] || {};
  const d = +date.slice(8, 10);
  const out = {};
  for (const def of MONTHLY) if (!def.list) out[def.id] = { ...(m[def.id]?.rows?.[d] || {}) };
  return out;
}

// The Calls/clinics fields the rosters fill for a date: { 'mot.cons': 'Name', … }
export function generalFromMonthly(monthly, date) {
  const duty = dutiesOn(monthly, date);
  const g = {};
  for (const def of MONTHLY) for (const c of def.cols) if (c.to && duty[def.id]?.[c.key]) g[c.to] = duty[def.id][c.key];
  return g;
}

// Leave entries covering a date, from any month
export function leaveOn(monthly, date) {
  const out = [];
  for (const m of Object.values(monthly || {})) for (const e of m.leave?.entries || []) if (e.from <= date && date <= e.to) out.push(e);
  return out;
}

// ---- planning problems across a month ----

// Clashes the monthly rosters already show before the day comes. personOf(text) -> { id, name } or null.
// Returns [{ date, kind, key, level: 'error' | 'warn', text }], one per cell that needs a look:
//   on leave that day; a day duty the morning after an overnight one; two overnight duties the same day
//   (errors); an overnight duty left empty on a day the roster has others filled in (warning).
// Liver and AOH duties are on-call standbys, not a day's work, so they don't clash with being post call
// (as NOTES says, they don't make anyone post call either).
const ON_CALL_ROSTERS = ['liver', 'aoh'];
export function monthIssues(monthly, month, personOf) {
  const out = [];
  const pad = d => `${month}-${String(d).padStart(2, '0')}`;
  const nightOf = (kind, key) => NIGHT_DUTIES.includes(`${kind}.${key}`);
  const cellsOn = date => {
    const duty = dutiesOn(monthly, date), cells = [];
    for (const def of MONTHLY) if (!def.list) for (const c of def.cols) {
      const v = cleanCell(duty[def.id]?.[c.key]);
      for (const name of v.split(/\s*\/\s*/).filter(Boolean)) {
        const p = personOf(name);
        if (p) cells.push({ kind: def.id, key: c.key, label: c.label, p, night: nightOf(def.id, c.key) });
      }
    }
    return cells;
  };
  let prev = cellsOn(addDays(pad(1), -1));
  for (let d = 1; d <= daysIn(month); d++) {
    const date = pad(d), cells = cellsOn(date);
    const away = new Set(leaveOn(monthly, date).map(e => personOf(e.name)?.id).filter(Boolean));
    const lastNight = new Map(prev.filter(c => c.night).map(c => [c.p.id, c]));
    const nights = {};
    for (const c of cells) {
      if (away.has(c.p.id)) out.push({ date, kind: c.kind, key: c.key, level: 'error', text: `${c.p.name} is on leave but has ${c.label}.` });
      const n = lastNight.get(c.p.id);
      if (n && !c.night && !ON_CALL_ROSTERS.includes(c.kind)) out.push({ date, kind: c.kind, key: c.key, level: 'error', text: `${c.p.name} has ${c.label} the morning after ${n.label} (post call).`, after: { date: addDays(date, -1), kind: n.kind, key: n.key } });
      if (c.night) (nights[c.p.id] ||= []).push(c);
    }
    for (const list of Object.values(nights)) if (list.length > 1) for (const c of list.slice(1)) {
      out.push({ date, kind: c.kind, key: c.key, level: 'error', text: `${c.p.name} has two overnight duties (${list.map(x => x.label).join(' and ')}).` });
    }
    // empty overnight duties, on days the roster has something filled in
    const m = monthly?.[month] || {};
    for (const def of MONTHLY) {
      const row = m[def.id]?.rows?.[d];
      if (def.list || !row || !Object.values(row).some(v => cleanCell(v))) continue;
      for (const c of def.cols) if (c.night && !cleanCell(row[c.key])) out.push({ date, kind: def.id, key: c.key, level: 'warn', text: `${c.label} is empty.` });
    }
    prev = cells;
  }
  return out;
}
