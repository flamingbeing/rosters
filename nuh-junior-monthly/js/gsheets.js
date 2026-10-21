// NUH Junior Monthly: read the department's Google Sheet and write the filled cells back, from the browser, with the signed-in
// person's own Google access (Sheets API v4). Nothing goes through a server of ours; the access token is kept in memory only.
//
// The safety rules (owner, 16 Oct 2026: "the sheet must stay exactly the same, just with the calls added"):
//   - It writes only the cells that changed (the new calls and their post call / day off), as plain values, never formulas,
//     formatting or other tabs.
//   - Before writing it reads the whole imported block again and checks it is still exactly what was read (names in their rows,
//     every day cell). If anything differs it writes nothing and says which cells.
//   - After writing it reads the written cells back and checks them.
// Because it acts as the person signed in, the sheet's own sharing and protected ranges still apply.
import { colName } from './sheet.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets/';
export const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// The sign-in (cloud.js asks Google for the Sheets scope in a pop-up). Replaceable so tests need no Google account.
export const hooks = {
  getToken: async () => (await import('./cloud.js')).getSheetsToken(),
};

let cached = null;   // { token, exp }
export function forgetToken() { cached = null; }
export async function token(force = false) {
  if (!force && cached && Date.now() < cached.exp) return cached.token;
  const t = await hooks.getToken();
  if (!t) throw new SheetsError('Google did not give access to Sheets.', 0);
  cached = { token: t, exp: Date.now() + 50 * 60 * 1000 };
  return t;
}

export class SheetsError extends Error {
  constructor(message, status = 0, reason = '') { super(message); this.name = 'SheetsError'; this.status = status; this.reason = reason; }
}

const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const normName = s => norm(s).toLowerCase();

// A link, or the bare id, to { id, gid }. gid is the tab in the link (null when the link names none).
export function parseSheetUrl(text) {
  const t = String(text || '').trim();
  const m = t.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  const id = m ? m[1] : (/^[a-zA-Z0-9_-]{30,}$/.test(t) ? t : '');
  if (!id) return null;
  const g = t.match(/[#?&]gid=(\d+)/);
  return { id, gid: g ? g[1] : null };
}

const quoteTab = title => `'${String(title).replace(/'/g, "''")}'`;

async function call(url, { method = 'GET', body = null } = {}) {
  let tok = await token();
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(url, { method, headers: { Authorization: `Bearer ${tok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new SheetsError('No connection to Google. Try again with signal.', 0); }
    if (res.status === 401 && attempt === 0) { forgetToken(); tok = await token(true); continue; }   // expired: sign in once more
    if (res.ok) return res.json();
    let detail = null;
    try { detail = (await res.json()).error || null; } catch (e) { /* no body */ }
    const reason = detail && detail.details && detail.details[0] && detail.details[0].reason || '';
    throw new SheetsError(friendly(res.status, detail && detail.message, reason), res.status, reason);
  }
  throw new SheetsError('Google sign-in did not hold. Try again.', 401);
}

function friendly(status, message = '', reason = '') {
  if (reason === 'SERVICE_DISABLED' || /has not been used|is disabled/i.test(message)) return "The Google Sheets API isn't switched on for this app's project yet. Ask the owner.";
  if (status === 401) return 'Google sign-in expired. Try again.';
  if (status === 403) return "Google says this account can't open or edit that sheet. Ask the sheet's owner to share it with you.";
  if (status === 404) return 'That sheet was not found. Check the link, and that you can open it.';
  if (status === 429) return 'Google asks to slow down. Try again in a minute.';
  return `Google said: ${message || status}`;
}

// The tabs of a sheet: { title, tabs: [{ gid, title, rows, cols }] }
export async function getTabs(id) {
  const j = await call(`${API}${id}?fields=${encodeURIComponent('properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))')}`);
  return {
    title: (j.properties && j.properties.title) || '',
    tabs: (j.sheets || []).map(s => ({ gid: String(s.properties.sheetId), title: s.properties.title, rows: (s.properties.gridProperties || {}).rowCount || 1000, cols: (s.properties.gridProperties || {}).columnCount || 26 })),
  };
}

// The month's grid tab: the one in the link, else the first called "Request", else the first.
export function chooseTab(tabs, gid) {
  return (gid != null && tabs.find(t => t.gid === String(gid))) || tabs.find(t => /request/i.test(t.title)) || tabs[0] || null;
}

function pad(rows) { return (rows || []).map(r => (r || []).map(v => (v == null ? '' : String(v)))); }

// Every cell of a tab as text (what the sheet shows), rows from the top.
export async function readGrid(id, tab) {
  const rng = `${quoteTab(tab.title)}!A1:${colName(Math.max(0, Math.min(tab.cols, 80) - 1))}${Math.min(tab.rows, 2000)}`;
  const j = await call(`${API}${id}/values/${encodeURIComponent(rng)}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`);
  return pad(j.values);
}

// A tab's cells with their fill colours: rows of [{ v: text, bg: '#rrggbb' or '' for no fill }] (what the Leave Waitlist's status
// colours are read from). Read only: it asks for the text and the background colour of each cell, nothing else.
export async function readColoured(id, tab) {
  const rng = `${quoteTab(tab.title)}!A1:${colName(Math.max(0, Math.min(tab.cols, 40) - 1))}${Math.min(tab.rows, 400)}`;
  const fields = 'sheets.data.rowData.values(formattedValue,effectiveFormat.backgroundColor)';
  const j = await call(`${API}${id}?includeGridData=true&ranges=${encodeURIComponent(rng)}&fields=${encodeURIComponent(fields)}`);
  const data = ((j.sheets || [])[0] || {}).data || [];
  const rows = ((data[0] || {}).rowData) || [];
  const hex = c => {
    if (!c) return '';
    const ch = v => Math.max(0, Math.min(255, Math.round((v || 0) * 255)));
    const r = ch(c.red), g = ch(c.green), b = ch(c.blue);
    return r >= 254 && g >= 254 && b >= 254 ? '' : '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  };
  return rows.map(r => (r.values || []).map(v => ({ v: v.formattedValue == null ? '' : String(v.formattedValue), bg: hex(v.effectiveFormat && v.effectiveFormat.backgroundColor) })));
}

// A tab whose name matches (the Leave Waitlist, the WR/ Premed Roster...), else null.
export function findTab(tabs, re) { return (tabs || []).find(t => re.test(t.title)) || null; }

async function readCells(id, tab, cells, render = 'FORMATTED_VALUE') {
  const out = new Map();
  for (let i = 0; i < cells.length; i += 100) {
    const part = cells.slice(i, i + 100);
    const qs = part.map(c => 'ranges=' + encodeURIComponent(`${quoteTab(tab.title)}!${c}`)).join('&');
    const j = await call(`${API}${id}/values:batchGet?${qs}&valueRenderOption=${render}`);
    (j.valueRanges || []).forEach((vr, n) => out.set(part[n], norm(vr.values && vr.values[0] && vr.values[0][0])));
  }
  return out;
}

// Is the sheet still exactly what was read? lay = the saved layout of the month (names, orig, firstCol, ...).
// Returns { ok, diffs: [{ cell, name, then, now }], rows, cells, at }.
export async function checkUnchanged(source, lay, nDays) {
  const tab = { title: lay.source ? lay.source.title : lay.tab, rows: 2000, cols: 80 };
  const meta = await getTabs(source.id);
  const t = meta.tabs.find(x => x.title === tab.title || String(x.gid) === String(source.gid));
  if (!t) return { ok: false, diffs: [{ cell: tab.title, name: '', then: 'the tab', now: 'not found' }], rows: 0, cells: 0, at: new Date() };
  const rows = await readGrid(source.id, t);
  const diffs = [];
  let cells = 0, nrows = 0;
  for (const key of Object.keys(lay.orig)) {
    const r = Number(key), row = rows[r - 1] || [];
    nrows++;
    const nameWas = lay.names && lay.names[r];
    if (nameWas != null) {
      const now = row[lay.firstCol - 1];
      cells++;
      if (normName(now) !== normName(nameWas)) diffs.push({ cell: `${colName(lay.firstCol - 1)}${r}`, name: nameWas, then: nameWas, now: norm(now) });
    }
    for (let k = 0; k <= nDays; k++) {
      cells++;
      const was = norm(lay.orig[r][k]), now = norm(row[lay.firstCol + k]);
      if (was !== now) diffs.push({ cell: `${colName(lay.firstCol + k)}${r}`, name: (lay.names && lay.names[r]) || '', then: was, now });
    }
  }
  return { ok: !diffs.length, diffs, rows: nrows, cells, at: new Date() };
}

// Write the changed cells (as plain values), then read them back. changes: [{ cell, to }].
export async function writeChanges(source, lay, changes) {
  const tab = { title: lay.source ? lay.source.title : lay.tab };
  // never replace a formula with a value (the day cells hold none, but check): look at what is really in each cell
  const raw = await readCells(source.id, tab, changes.map(c => c.cell), 'FORMULA');
  const withFormula = changes.filter(c => String(raw.get(c.cell) || '').startsWith('='));
  if (withFormula.length) throw new SheetsError(`${withFormula[0].cell} holds a formula, so the app will not overwrite it. Nothing was written.`, 0, 'FORMULA');
  for (let i = 0; i < changes.length; i += 200) {
    const part = changes.slice(i, i + 200);
    await call(`${API}${source.id}/values:batchUpdate`, {
      method: 'POST',
      body: { valueInputOption: 'RAW', data: part.map(c => ({ range: `${quoteTab(tab.title)}!${c.cell}`, values: [[c.to]] })) },
    });
  }
  const back = await readCells(source.id, tab, changes.map(c => c.cell));
  const bad = changes.filter(c => norm(back.get(c.cell)) !== norm(c.to));
  return { written: changes.length, verified: !bad.length, mismatches: bad.map(c => ({ cell: c.cell, wanted: c.to, got: norm(back.get(c.cell)) })) };
}

// What each of the changed cells holds now, and which of them no longer hold what was written (for the undo preview).
export async function checkCells(source, lay, changes) {
  const tab = { title: lay.source ? lay.source.title : lay.tab };
  const now = await readCells(source.id, tab, changes.map(c => c.cell));
  return { now, skipped: changes.filter(c => norm(now.get(c.cell)) !== norm(c.to)).map(c => ({ cell: c.cell, expected: c.to, got: norm(now.get(c.cell)) })) };
}

// Put back what was there before a write (the `from` of each change), but only in cells that still hold what was written:
// a cell somebody has edited since is left alone and named. Returns { restored, skipped: [{ cell, expected, got }], verified }.
export async function undoChanges(source, lay, changes) {
  const tab = { title: lay.source ? lay.source.title : lay.tab };
  const now = await readCells(source.id, tab, changes.map(c => c.cell));
  const ours = changes.filter(c => norm(now.get(c.cell)) === norm(c.to));
  const skipped = changes.filter(c => norm(now.get(c.cell)) !== norm(c.to)).map(c => ({ cell: c.cell, expected: c.to, got: norm(now.get(c.cell)) }));
  for (let i = 0; i < ours.length; i += 200) {
    await call(`${API}${source.id}/values:batchUpdate`, {
      method: 'POST',
      body: { valueInputOption: 'RAW', data: ours.slice(i, i + 200).map(c => ({ range: `${quoteTab(tab.title)}!${c.cell}`, values: [[c.from || '']] })) },
    });
  }
  const back = ours.length ? await readCells(source.id, tab, ours.map(c => c.cell)) : new Map();
  const bad = ours.filter(c => norm(back.get(c.cell)) !== norm(c.from));
  return { restored: ours, skipped, verified: !bad.length };
}

// Make a brand-new spreadsheet from a body built by sheetgen-gsheets.js (one call: values, formulas, colours, merges and
// colour rules). Needs only the Sheets scope the app already asks for; the new file lands in the signed-in person's Drive.
// Returns { id, url, gid }.
export async function createSpreadsheet(body) {
  const j = await call(`${API.replace(/\/$/, '')}?fields=${encodeURIComponent('spreadsheetId,spreadsheetUrl,sheets.properties.sheetId')}`, { method: 'POST', body });
  return { id: j.spreadsheetId, url: j.spreadsheetUrl, gid: String((j.sheets && j.sheets[0] && j.sheets[0].properties.sheetId) || 0) };
}
