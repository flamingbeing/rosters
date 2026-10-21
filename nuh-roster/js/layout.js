// The department roster sheet as a list of cells, shared by the Excel export and the in-page preview.
// Columns are 1-based like Excel (A=1 ... L=12). Parts not generated yet are left blank.

import { namesInCell, COLOUR_ARGB } from './engine.js';

export const COL_WIDTHS = [10, 5, 9.14, 9.14, 9.14, 9.14, 9.14, 9.14, 9.14, 9.14, 9.14, 9.14];
export const RED = 'FFFF0000';
export const BLUE = 'FF0000FF';
export const GREY = 'FFBFBFBF';

// The General tab: MOT and SICU teams, then the duty rows (specialist in C, assistants in F and I).
export const TEAM_ROWS = [['cons', 'Consultant:'], ['reg', 'Registrar/AC:'], ['res1', 'Residents:'], ['res2', ''], ['res3', '']];
export const DUTIES = [
  { key: 'eot8', label: 'EOT 8', fields: [['s', 'Senior'], ['a', 'Junior']] },
  { key: 'eot9', label: 'EOT 9', fields: [['s', 'Senior'], ['a', 'Junior'], ['a2', 'Junior 2']] },
  { key: 'epi', label: 'Epidural', fields: [['s', 'Senior'], ['df', 'Day float (DF)'], ['nf', 'Night float (NF)']] },
  { key: 'cardiac', label: 'Cardiac Call', fields: [['s', 'Senior'], ['a', 'Junior']] },
  { key: 'painacp', label: 'Pain/ACP Clinic', fields: [['s', 'Senior'], ['a', 'Junior']] },
  { key: 'acute', label: 'Acute Pain', fields: [['s', 'Senior'], ['a', 'Junior']] },
  { key: 'chronic', label: 'Chronic Pain', fields: [['s', 'Senior'], ['a', 'Junior']] },
];

// lists: { postcall: [...names], leave: [...], admin: [...] }
// colourOf(namePart) -> 'green' | 'purple' | '' for each name on the OT rows.
// shortOf(namePart) -> the same part with the person's short name ("Koh YW (RA)").
// general: the General tab's fields ({ 'mot.cons': '…', 'eot8.s': '…' }); box: the free text
// in the comments box at the top right.
// stamp: a short note at the top right, e.g. "Updated 09:15" on a sheet sent again after changes.
export function buildLayout({ date, rows, lists = {}, general = {}, box = '', colourOf = () => '', shortOf = s => s, stamp = '' }) {
  const cells = [];
  const heights = {};
  const put = (r, c1, c2, text, o = {}) => cells.push({ r, r2: o.r2 || r, c1, c2, text: text ?? '', runs: o.runs || null, edit: o.edit || null, sz: o.sz || 8, bold: !!o.bold, color: o.color || null, align: o.align || 'center', box: !!o.box, valign: o.valign || 'middle', underlineFirst: !!o.underlineFirst, fill: o.fill || null, pad: !!o.pad });
  const label = (r, text, o = {}) => put(r, 1, 2, text, { align: 'right', ...o });

  const d = date ? new Date(date + 'T12:00:00') : null;
  // the title band (A to K, in line with the OT rows) is shaded grey, as on the department's sheet
  put(2, 1, 11, 'DEPARTMENT OF ANAESTHESIA', { sz: 10, bold: true, fill: GREY });
  put(3, 1, 11, 'NATIONAL UNIVERSITY HEALTH SYSTEM', { sz: 10, bold: true, fill: GREY });
  if (stamp) put(4, 9, 11, stamp, { align: 'right', bold: true, color: RED });
  label(5, 'Date', { bold: true });
  put(5, 3, 5, d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '', { bold: true });
  put(5, 6, 7, d ? d.toLocaleDateString('en-GB', { weekday: 'long' }) : '', { bold: true });

  const short = text => String(text || '').split(/\s*\/\s*/).filter(Boolean).map(shortOf).join(' / ');
  const names = (r, c1, c2, text, o = {}) => put(r, c1, c2, short(text), { ...o, runs: cellRuns(text, colourOf, null, shortOf) });
  const g = k => general[k] || '';

  put(7, 3, 5, 'MOT', { bold: true });
  put(7, 6, 8, 'SICU', { bold: true });
  TEAM_ROWS.forEach(([k, text], i) => {
    if (text) label(8 + i, text);
    names(8 + i, 3, 5, g('mot.' + k));
    names(8 + i, 6, 8, g('sicu.' + k));
  });

  const special = id => rows.find(x => x.roomId === id) || {};
  const tag = (text, t) => text && !new RegExp(`\\(${t}\\)`, 'i').test(text) ? `${text} (${t})` : text;
  put(14, 3, 5, 'Specialist', { bold: true });
  put(14, 6, 8, 'Assistants', { bold: true });
  let r = 15;
  const duty = (text, c, f, i) => {
    if (text) label(r, text);
    names(r, 3, 5, c);
    names(r, 6, 8, f);
    if (i != null) names(r, 9, 11, i);
    r++;
  };
  duty('EOT 8:', g('eot8.s'), g('eot8.a'));
  duty('EOT 9:', g('eot9.s'), g('eot9.a'));
  duty('', '', g('eot9.a2'));
  duty('Epidural:', g('epi.s'), tag(g('epi.df'), 'DF'));
  duty('', '', tag(g('epi.nf'), 'NF'));
  duty('Cardiac Call:', g('cardiac.s'), g('cardiac.a'));
  r++;
  // the comments box runs from the date row down to the cardiac call row, leaving a gap above AIC
  put(5, 9, 11, box, { r2: r - 2, box: true, align: 'left', valign: 'top', pad: true });
  label(r, 'AOCC:');
  names(r, 3, 5, special('aocc').senior);
  names(r, 6, 8, special('aocc').junior);
  put(r, 9, 11, 'AIC: ' + short(special('aic').senior), { box: true });
  r++;
  duty('Pain/ACP Clinic:', g('painacp.s'), g('painacp.a'));
  duty('Acute Pain:', g('acute.s'), g('acute.a'));
  duty('Chronic Pain:', g('chronic.s'), g('chronic.a'));
  r++;

  // admin, post call and leave grids: nine names per row across C..K, in line with the OT rows
  const grid = (title, names) => {
    const list = names.length ? names : [''];
    for (let i = 0; i < list.length; i += 9) {
      if (i === 0) label(r, title);
      heights[r] = 22.5;
      list.slice(i, i + 9).forEach((n, k) => put(r, 3 + k, 3 + k, n, { box: true }));
      r++;
    }
  };
  grid('Admin/no list', lists.admin || []);
  grid('Post call', lists.postcall || []);
  grid('Leave', lists.leave || []);
  r++;

  const otFrom = r; // where the OT rooms start (AH OT), for an image sent in two parts
  label(r, 'AH OT : ', { bold: true, color: BLUE });
  put(r, 3, 11, short(special('ahot').senior), { box: true, color: BLUE });
  r++;

  const doubles = doubleCovered(rows.filter(x => x.complex !== 'Clinic'));
  rows.forEach((row, i) => {
    if (row.complex === 'Clinic') return; // AH OT, AOCC and AIC are shown above
    // room labels are black, apart from the remote cases in red
    label(r, row.label + ':', row.complex === 'Other' ? { bold: true, color: RED } : {});
    put(r, 3, 5, short(row.senior), { box: true, runs: cellRuns(row.senior, colourOf, doubles, shortOf) });
    put(r, 6, 8, short(row.junior), { box: true, runs: cellRuns(row.junior, colourOf, null, shortOf) });
    put(r, 9, 11, short(row.premed), { box: true, bold: true, runs: cellRuns(row.premed, colourOf, null, shortOf) });
    r++;
  });
  return { cells, heights, rows: r - 1, cols: 12, otFrom };
}

const key = n => n.toLowerCase().replace(/\s+/g, ' ').trim();

// Seniors named in more than one room's senior cell, i.e. double covering.
export function doubleCovered(rows) {
  const count = {};
  for (const row of rows) for (const n of new Set(namesInCell(row.senior).map(key))) count[n] = (count[n] || 0) + 1;
  return new Set(Object.keys(count).filter(n => count[n] > 1));
}

export function isDouble(part, doubles) {
  const n = namesInCell(part)[0];
  return !!n && doubles.has(key(n));
}

// A roster cell as text runs: each name in its colour, and a superscript "&" after a senior
// who is double covering. Returns null when plain text will do.
function cellRuns(text, colourOf, doubles = null, shortOf = s => s) {
  const parts = String(text || '').split(/\s*\/\s*/).filter(Boolean);
  const colours = parts.map(p => COLOUR_ARGB[colourOf(p)] || null);
  const dbl = parts.map(p => !!doubles && isDouble(p, doubles));
  if (!colours.some(Boolean) && !dbl.some(Boolean)) return null;
  const runs = [];
  parts.forEach((p, k) => {
    if (k) runs.push({ text: ' / ' });
    runs.push({ text: shortOf(p), color: colours[k] });
    if (dbl[k]) runs.push({ text: '&', sup: true, color: colours[k] });
  });
  return runs;
}

// Short form for the post call / leave grid: the shortest name we know them by.
export function shortName(p) {
  const forms = [p.name, ...(p.aliases || [])].filter(Boolean);
  return forms.sort((a, b) => a.length - b.length)[0] || '';
}
