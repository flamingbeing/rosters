import { buildLayout, COL_WIDTHS } from './layout.js';

// Reading and writing roster spreadsheets with ExcelJS (passed in, so this runs in the browser and in Node).

export function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result instanceof Date) return v.result.toISOString().slice(0, 10); // a formula whose result is a date
    if (v.result != null) return String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v);
}

// A date written in a sheet cell, as YYYY-MM-DD, or null: "2026-10-14", "14/10/2026" (day first), "14 Oct 2026",
// "Wednesday, 14 October 2026". Written out rather than left to new Date(), which reads these differently by browser.
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function dateFromText(text) {
  const t = String(text ?? '').trim();
  const pad = n => String(n).padStart(2, '0');
  const ok = (y, m, d) => { const x = new Date(Date.UTC(y, m - 1, d)); return x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null; };
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return ok(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = t.match(/(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3})[a-z]*\.?[\s,-]+(\d{4})/i);
  if (m && MON.includes(m[2].toLowerCase())) return ok(+m[3], MON.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  return null;
}

// Rows of a department roster sheet: label in A, senior in C, junior in F, premed in I, notes in L.
export function readRosterRows(ws) {
  const rows = [];
  ws.eachRow({ includeEmpty: false }, row => {
    const t = c => cellText(row.getCell(c).value).trim();
    const label = t(1);
    if (!label) return;
    rows.push({ label: label.replace(/:\s*$/, ''), senior: t(3), junior: t(6), premed: t(9), notes: t(12) });
  });
  return rows;
}

// A staff sheet with a header row. Columns are found by name, so order doesn't matter.
const HEADERS = {
  name: /^(full\s*)?name$/i,
  aliases: /short|alias|nick/i,
  role: /^role$|senior.*junior/i,
  grade: /grade|designation|rank/i,
  posting: /posting|rotation/i,
  subspecs: /subspec/i,
  avoid: /avoid|doesn.?t do|exclu/i,
};

// The department contact list: grade groups in column C, names in B, subspecialty in D.
// Only names, grade groups and subspecialties are read; phone numbers, MCR, emails and
// employee numbers are ignored.
const CONTACT_GROUPS = [
  [/visiting consultant/i, 'senior', 'VC'],
  [/head|senior consultant/i, 'senior', 'SC'],
  [/^consultant|locum/i, 'senior', 'C'],
  [/associate consultant/i, 'senior', 'AC'],
  [/snr resident physician|senior resident physician/i, 'senior', 'RP'],
  [/resident physician/i, 'junior', 'RP'],
  [/mopex/i, 'junior', 'MOPEX'],
  [/^senior resident/i, 'junior', 'Senior resident'],
  [/rotating resident/i, 'junior', 'Rotating resident'],
  [/registrar/i, 'junior', 'Senior resident'],
  [/residents? - ca|^ast$|fellow/i, 'junior', 'Junior resident'],
];
const CONTACT_SUBSPECS = { cardiac: 'cardiac', paeds: 'paeds', neuro: 'neuro', thoracic: 'thoracic', liver: 'hpb', og: 'obs' };

export function cleanContactName(raw) {
  let n = String(raw || '').replace(/\(.*?\)/g, ' ').replace(/^\s*((adj|clin|clinical)\.?\s+)?((asst|assoc|a)\.?\s*\/?\s*)?(prof|dr)\.?\s+(dr\.?\s+)?/i, '')
    .replace(/\b[DS]\/O\b|\bBte\b|\bBinte\b|\bBin\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const comma = n.match(/^(.*?),\s*(.+)$/); // "Wee Peng Hock, Dennis" -> "Dennis Wee Peng Hock"
  // only a single given name after the comma; "…, MMed" is a qualification and is dropped
  if (comma) n = /^[A-Z][a-z]+(-[A-Z]?[a-z]+)?$/.test(comma[2]) ? `${comma[2]} ${comma[1]}` : comma[1];
  return n;
}

export function isContactList(ws) {
  let hit = false;
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n > 6 || hit) return;
    const t = [1, 2, 3, 4].map(c => cellText(row.getCell(c).value)).join(' ');
    if (/contact list/i.test(t) || (/s\/n/i.test(t) && /speciality/i.test(t))) hit = true;
  });
  return hit;
}

export function readContactList(ws) {
  const people = [];
  let group = null;
  ws.eachRow({ includeEmpty: false }, row => {
    const g = cellText(row.getCell(3).value).trim();
    if (g) group = g.replace(/\s+/g, ' ');
    const raw = cellText(row.getCell(2).value).trim();
    if (!raw || !group || /^name$/i.test(raw) || /acupunctur|nurs|\bssn\b/i.test(raw)) return;
    const kind = CONTACT_GROUPS.find(([re]) => re.test(group));
    if (!kind) return; // admin, nursing, research and other non-anaesthetist rows
    const spec = cellText(row.getCell(4).value).toLowerCase();
    const subspecs = [...new Set(spec.split(/[\/\n,]+/).map(x => CONTACT_SUBSPECS[x.trim()]).filter(Boolean))];
    people.push({ name: cleanContactName(raw), role: kind[1], grade: kind[2], subspecs: kind[1] === 'senior' ? subspecs : [], group });
  });
  return { people };
}

export function readStaffSheet(ws) {
  let headerRow = null, cols = {};
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (headerRow) return;
    const found = {};
    row.eachCell((c, i) => {
      const h = cellText(c.value).trim();
      for (const [k, re] of Object.entries(HEADERS)) if (!found[k] && re.test(h)) found[k] = i;
    });
    if (found.name) { headerRow = n; cols = found; }
  });
  if (!headerRow) return { error: 'Could not find a header row with a "Name" column.' };
  const list = s => String(s || '').split(/[,;\/]+/).map(x => x.trim()).filter(Boolean);
  const people = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n <= headerRow) return;
    const get = k => cols[k] ? cellText(row.getCell(cols[k]).value).trim() : '';
    const name = cleanContactName(get('name'));
    if (!name) return;
    const grade = get('grade');
    const roleText = get('role').toLowerCase();
    const seniorish = /consultant|\bac\b|associate/i.test(grade + ' ' + roleText) || ['SC', 'C', 'VC', 'AC'].includes(normGrade(grade, false));
    people.push({
      name,
      aliases: list(get('aliases')),
      role: roleText.startsWith('j') ? 'junior' : roleText.startsWith('s') || seniorish ? 'senior' : 'junior',
      grade: normGrade(grade, seniorish),
      posting: get('posting'),
      subspecs: list(get('subspecs')).map(s => s.toLowerCase()),
      avoid: list(get('avoid')).map(s => s.toLowerCase()),
    });
  });
  return { people };
}

function normGrade(g, seniorish) {
  const s = String(g).toLowerCase();
  if (/\bvc\b|visiting/.test(s)) return 'VC';
  if (/\bsc\b|senior consultant/.test(s)) return 'SC';
  if (/\bac\b|associate/.test(s)) return 'AC';
  if (/consultant|^c$/.test(s)) return 'C';
  if (/registrar/.test(s)) return 'Senior resident';
  if (/\brp\b|resident physician/.test(s)) return 'RP';
  if (/locum/.test(s)) return seniorish ? 'C' : 'Locum';
  if (/baby|mopex|medical officer|\bmo\b/.test(s)) return 'MOPEX';
  if (/rotating/.test(s)) return 'Rotating resident';
  if (/senior resident/.test(s)) return 'Senior resident';
  if (/resident|trainee/.test(s)) return 'Junior resident';
  return seniorish ? 'C' : 'Junior resident';
}

// Build the roster workbook in the department's layout.
export function buildRosterWorkbook(ExcelJS, { date, rows, lists, general, box, colourOf, shortOf, stamp }) {
  const layout = buildLayout({ date, rows, lists, general, box, colourOf, shortOf, stamp });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(date || 'roster', { pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 } });
  ws.columns = COL_WIDTHS.map(width => ({ width }));
  const thin = { style: 'thin' };
  for (const c of layout.cells) {
    const cell = ws.getCell(c.r, c.c1);
    const font = { name: 'Arial', size: c.sz, bold: c.bold, ...(c.color ? { color: { argb: c.color } } : {}) };
    if (c.underlineFirst && c.text) {
      const [first, ...rest] = c.text.split('\n');
      cell.value = { richText: [{ text: first, font: { ...font, underline: true } }, ...(rest.length ? [{ text: '\n' + rest.join('\n'), font }] : [])] };
    } else if (c.runs) {
      cell.value = { richText: c.runs.map(run => ({ text: run.text, font: {
        ...font, ...(run.sup ? { vertAlign: 'superscript' } : {}), ...(run.color ? { color: { argb: run.color } } : {}),
      } })) };
    } else cell.value = c.text;
    cell.font = font;
    cell.alignment = { horizontal: c.align, vertical: c.valign, wrapText: c.c2 < 12, ...(c.pad ? { indent: 1 } : {}) };
    if (c.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.fill } };
    // style the top-left cell, then merge: the merged cells take its style, so the box is drawn all round
    if (c.box) cell.border = { top: thin, bottom: thin, left: thin, right: thin };
    if (c.r2 > c.r || c.c2 > c.c1) ws.mergeCells(c.r, c.c1, c.r2, c.c2);
  }
  for (const [r, h] of Object.entries(layout.heights)) ws.getRow(+r).height = h;
  return wb;
}
