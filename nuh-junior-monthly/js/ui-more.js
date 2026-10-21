// NUH Junior Monthly: the More screen. Import the department's Excel sheet (with a review before anything changes),
// export (Excel in the department layout, PDF through the print dialog, CSV, the staff list for APMES People, a
// calendar file for one person),
// backup and restore, settings (department name, public holidays), the team sharing panel, starting again,
// and the two app-version lines at the very end.
import * as M from './model.js';
import * as io from './io.js';
import * as S from './sheet.js';
import * as G from './gsheets.js';
import * as cloud from './cloud.js';
import { buildSheet } from './sheetgen.js';
import { specFromState } from './sheetgen-state.js';
import { toWorkbook } from './sheetgen-xlsx.js';
import { toSpreadsheetBody } from './sheetgen-gsheets.js';
import { SG_HOLIDAYS } from './demo.js';

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'person';

export function mount(el, app) {
  const { h, icon } = app;
  const store = app.store;
  const root = h('div', { class: 'more' });
  el.innerHTML = '';
  el.append(root);

  // ---------- helpers ----------
  const section = (id, title, intro, ...kids) => h('section', { class: 'card more-sec', 'aria-labelledby': id },
    h('h2', { id }, title), intro ? h('p', null, intro) : null, ...kids);
  const btn = (label, fn, cls = 'btn btn-ghost') => h('button', { type: 'button', class: cls, onclick: fn }, label);
  const iconBtn = (label, fn, ic, cls = 'btn btn-ghost') => h('button', { type: 'button', class: cls, onclick: fn },
    h('span', { html: icon(ic) }), h('span', null, label));
  const fileButton = (label, accept, onFile, ic = 'upload', cls = 'btn btn-ghost') => {
    const input = h('input', { type: 'file', accept, class: 'sr-only' });
    input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; if (f) onFile(f); });
    return h('label', { class: `${cls} more-file` }, input, h('span', { html: icon(ic) }), h('span', null, label));
  };
  async function busy(button, fn) {
    if (button) button.disabled = true;
    try { await fn(); } catch (e) { console.error(e); app.toast(e.message || 'Something went wrong', { kind: 'error' }); } finally { if (button) button.disabled = false; }
  }
  const monthOptions = (sel) => {
    const out = [];
    for (let i = -12; i <= 12; i++) { const m = M.addMonths(app.month, i); out.push(h('option', { value: m, selected: m === sel }, M.fmtMonth(m))); }
    return out;
  };

  // ---------- The department's Google Sheet: in, then the filled cells back ----------
  const pasteBox = h('textarea', { rows: '4', class: 'sheet-paste', 'aria-label': 'Paste the month\'s Request tab here',
    placeholder: 'In the Google Sheet: open the month\'s Request tab, click the box above row 1 and left of column A (selects everything), copy (Ctrl+C or Cmd+C), then paste here.' });
  // Read straight from Google (the person's own sign-in; nothing is written until "Put the roster back"). Off in practice mode.
  const LINK_KEY = 'nuhjm-sheet-link';
  const lastLink = () => { try { return localStorage.getItem(LINK_KEY) || ''; } catch (e) { return ''; } };
  const linkIn = h('input', { type: 'url', class: 'sheet-link', id: 'sheet-link', 'aria-label': 'Google Sheet link', placeholder: 'Paste the Google Sheet link', value: lastLink() });
  const googleRead = cloud.enabled ? [
    h('p', { class: 'more-p' }, 'Easiest: paste the link of the Google Sheet (open on the month\'s tab) and sign in with Google. It reads the sheet as you; it changes nothing.'),
    h('div', { class: 'more-row' }, linkIn, btn('Read from Google', onGoogleRead, 'btn btn-primary')),
    h('p', { class: 'more-p muted' }, 'Or copy and paste it yourself:'),
  ] : [];
  const importSec = section('more-import', 'Import from the Google Sheet',
    'The month\'s grid tab ("1 - 30 Nov 26 Request"). People, postings, leave, requests and calls already typed come in; you see what was found before anything changes. Seniors\' rows are left alone.',
    ...googleRead,
    pasteBox,
    h('div', { class: 'more-row' },
      btn('Read the paste', () => readSheetRows(S.rowsFromTSV(pasteBox.value), 'the paste'), 'btn btn-primary'),
      fileButton('Or a downloaded .xlsx', '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', onSheetFile)));

  async function onGoogleRead() {
    const p = G.parseSheetUrl(linkIn.value);
    if (!p) { app.toast('That does not look like a Google Sheet link. Copy it from the address bar of the open sheet.', { kind: 'warn', ms: 6000 }); return; }
    try { localStorage.setItem(LINK_KEY, linkIn.value.trim()); } catch (e) { /* ignore */ }
    try {
      const info = await G.getTabs(p.id);
      const tab = G.chooseTab(info.tabs, p.gid);
      if (!tab) throw new Error('That sheet has no tabs.');
      const rows = await G.readGrid(p.id, tab);
      readSheetRows(rows, `Google: ${tab.title}`, tab.title, { id: p.id, gid: tab.gid, title: tab.title });
    } catch (e) { console.error(e); app.toast(cloud.friendly(e), { kind: 'error', ms: 9000 }); }
  }

  async function onSheetFile(file) {
    try {
      await io.loadExcelJS();
      const wb = new window.ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets.find(w => /request/i.test(w.name)) || wb.worksheets[0];
      const rows = [];
      ws.eachRow({ includeEmpty: true }, (row, r) => {
        const out = [];
        row.eachCell({ includeEmpty: true }, (cell, c) => { const v = cell.value; out[c - 1] = v == null ? '' : typeof v === 'object' ? (v.richText ? v.richText.map(x => x.text).join('') : v.result != null ? String(v.result) : v.text || '') : String(v); });
        rows[r - 1] = out;
      });
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      readSheetRows(rows, file.name, ws.name);
    } catch (e) { console.error(e); app.toast(`Could not read this file: ${e.message || e}`, { kind: 'error', ms: 9000 }); }
  }

  // is the day before the month's first day empty for the people in the sheet? (then postings that carry over look like they start on day 1)
  function prevMissing(grid, month) {
    const st = store.get(), before = M.addDays(M.monthDays(month)[0], -1);
    const names = new Set(grid.people.map(p => (p.name || '').toLowerCase().replace(/[^a-z]/g, '')));
    const ids = (st.staff || []).filter(p => names.has((p.name || '').toLowerCase().replace(/[^a-z]/g, ''))).map(p => p.id);
    return !ids.some(id => (M.getCell(st, before, id)?.a || []).length);
  }

  function readSheetRows(rows, from, tab = 'Request', source = null) {
    const grid = S.parseGrid(rows);
    if (!grid) { app.toast('No roster grid found: it needs the header row with S/N, Grade, Name and the days 1, 2, 3…', { kind: 'error', ms: 9000 }); return; }
    const sel = h('select', { 'aria-label': 'Month' }, monthOptions(grid.month && S.monthFits(grid, grid.month) ? grid.month : app.month));
    const body = h('div', { class: 'bx-form' });
    const unticked = new Set();   // grade moves the rosterer unticked (kept when the month is changed)
    const movesBox = plan => {
      const n = plan.moves.length;
      if (!n) return null;
      const row = mv => {
        const cb = h('input', { type: 'checkbox', checked: !unticked.has(mv.id), onchange: () => { if (cb.checked) unticked.delete(mv.id); else unticked.add(mv.id); } });
        return h('li', null, h('label', { class: 'ri-row' }, cb, h('span', null, h('strong', null, mv.name), ` ${mv.fromGrade} → ${mv.toGrade}`)));
      };
      return h('div', { class: 'bx-field' },
        h('p', { class: 'bx-label', id: 'imp-moves' }, `${n} ${n === 1 ? 'person moves' : 'people move'} grade`),
        h('p', { class: 'more-p' }, 'The sheet shows a new grade. Ticked ones move to the end of that group on People › Staff; untick anyone who should stay where they are.'),
        h('ul', { class: 'ri-list', 'aria-labelledby': 'imp-moves' }, plan.moves.map(row)));
    };
    const paint = () => {
      body.innerHTML = '';
      const month = sel.value;
      const plan = S.planImport(store.get(), grid, month);
      const fits = S.monthFits(grid, month);
      const ok = plan.people.filter(p => !p.skip), matched = ok.filter(p => p.match).length;
      const skipped = plan.people.filter(p => p.skip);
      const older = plan.olderMoves.length;
      body.append(
        h('label', { class: 'bx-field' }, h('span', null, 'Month'), sel),
        ...(fits ? [] : [h('p', { class: 'warn' }, `This grid has ${grid.nDays} days starting on a ${grid.firstWd || '?'}: check the month.`)]),
        h('ul', { class: 'more-list' },
          h('li', null, `${ok.length} juniors: ${matched} already on People, ${ok.length - matched} new`),
          skipped.length ? h('li', null, `${skipped.length} rows left alone (${[...new Set(skipped.map(p => p.grade || '?'))].join(', ')}: grades not on People › Groups)`) : null,
          h('li', null, `Rows ${plan.people[0]?.row}–${plan.people[plan.people.length - 1]?.row}, days in columns ${S.colName(grid.firstCol)} to ${S.colName(grid.nextCol - 1)}`),
          (() => { const c = S.countCalls(store.get(), plan); return h('li', null, c.size ? `Calls found: ${[...c].map(([k, v]) => `${k} ${v}`).join(', ')}` : 'No calls found in the sheet yet'); })(),
          prevMissing(grid, month) ? h('li', { class: 'warn' }, `${M.fmtMonth(M.addMonths(month, -1))} isn't in the app yet, so everyone on ICU or cardiac looks like they start on day 1. Import last month's tab first, then this one.`) : null,
          plan.unknown.size ? h('li', null, `Codes the app didn't know (added as "other"): ${[...plan.unknown.keys()].join(', ')}`) : null,
          older ? h('li', null, `${older} ${older === 1 ? 'person has' : 'people have'} another grade here than on People, but ${M.fmtMonth(plan.latest)} is already imported: an older month doesn't move anyone's grade.`) : null),
        movesBox(plan),
        h('p', { class: 'muted' }, `${M.fmtMonth(month)} for these people is replaced by the sheet (Undo puts it back).`));
      return { plan, month };
    };
    sel.addEventListener('change', paint);
    paint();
    app.sheet({
      title: `Import ${from}`, body, actions: [{ label: 'Cancel' }, {
        label: 'Import', primary: true, fn: () => {
          const { plan, month } = paint();
          const moves = plan.moves.filter(mv => !unticked.has(mv.id)).map(mv => mv.id);
          let res;
          // reading a month in is deliberate, so it opens that month (a locked one refuses every change)
          if (M.isMonthLocked(store.get(), month)) store.commit(`Unlock ${M.fmtMonth(month)} to import`, draft => { M.setMonthLocked(draft, month, false); });
          store.commit(`Imported ${M.fmtMonth(month)} from the sheet`, draft => { res = S.applyImport(draft, plan, grid, { tab, source, moves }); if (!M.isMonthLocked(draft, month)) M.setMonthLocked(draft, month, false); });
          app.setMonth(month);
          const moved = res.moved ? `${res.moved} moved grade, ` : '';
          app.toast(`${M.fmtMonth(month)} imported: ${res.added} new people, ${moved}${res.cells} cells`, { action: { label: 'Undo', fn: () => store.undo() }, ms: 8000 });
        },
      }],
    });
  }

  // ---- Make the month's sheet from scratch (trial, owner 17 Oct 2026): the whole form with its formulas, for the people and
  // days the app has. As an Excel file, or straight into a new Google Sheet (the Sheets scope the app already has).
  const genBox = h('div', { class: 'sheet-gen' });
  const genSec = section('more-sheet-gen', "Make this month's sheet from scratch (trial)", null, genBox);
  function renderGen() {
    genBox.innerHTML = '';
    const state = store.get(), spec = specFromState(state, app.month), nP = spec.people.length;
    const link = h('p', { class: 'ok-box', role: 'status', hidden: true });
    genBox.append(
      h('p', { class: 'more-p' }, `The department's roster form (names, grades, the day cells, the totals, the counts and the manpower rows, all with their formulas) built for ${M.fmtMonth(app.month)} and the ${nP} ${nP === 1 ? 'person' : 'people'} in the app. Consultants and others the app does not hold are not included. Nothing in your live sheet is touched: this makes a new file.`),
      h('div', { class: 'more-row' },
        btn('Download as an Excel file', async () => {
          try {
            const ExcelJS = await io.loadExcelJS();
            const wb = toWorkbook(buildSheet(specFromState(store.get(), app.month)), ExcelJS);
            const buf = await wb.xlsx.writeBuffer();
            io.download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `roster-${io.fileStamp(app.month)}.xlsx`);
          } catch (e) { app.toast(e.message || 'Could not make the file.', { kind: 'error' }); }
        }),
        cloud.enabled ? btn('Create a new Google Sheet', async e => {
          const b = e.currentTarget; b.disabled = true;
          try {
            const made = await G.createSpreadsheet(toSpreadsheetBody(buildSheet(specFromState(store.get(), app.month)), { title: `NUH junior roster ${M.fmtMonth(app.month)} (made by the app)` }));
            link.hidden = false; link.textContent = '';
            link.append('Made it: ', h('a', { href: made.url, target: '_blank', rel: 'noopener' }, 'open the new Google Sheet'), '. It is a new file in your Google Drive; the live sheet was not touched.');
          } catch (err) { app.toast(err.message || 'Could not make the sheet.', { kind: 'error', ms: 9000 }); }
          b.disabled = false;
        }, 'btn btn-primary') : null),
      link);
  }
  renderGen();

  const backBox = h('div', { class: 'sheet-return' });
  const exportSheetSec = section('more-sheet-back', 'Put the roster back in the Google Sheet', null, backBox);
  function renderBack() {
    backBox.innerHTML = '';
    const state = store.get();
    const ex = S.exportBlock(state, app.month);
    if (!ex) { backBox.append(h('p', { class: 'more-p' }, `Import ${M.fmtMonth(app.month)} from the sheet first: the app then knows which rows and columns to give back.`)); return; }
    backBox.append(
      h('p', null, ex.changes.length ? `${ex.changes.length} ${ex.changes.length === 1 ? 'cell differs' : 'cells differ'} from the sheet as imported.` : 'Nothing differs from the sheet as imported.'),
      h('ol', { class: 'more-steps' },
        h('li', null, 'Copy the cells (the button below).'),
        h('li', null, `In the sheet's ${ex.tab || 'Request'} tab, click cell `, h('strong', null, ex.topLeft), ' (day 1 of the first row).'),
        h('li', null, 'Paste values only (Ctrl+Shift+V, or Cmd+Shift+V). Only the day cells ', h('strong', null, ex.range), ' are covered: names, totals, colours and formulas stay.')),
      h('div', { class: 'more-row' },
        btn('Copy cells for the sheet', async () => {
          try { await navigator.clipboard.writeText(ex.tsv); app.toast(`Copied ${ex.range}: paste it at ${ex.topLeft}`, { kind: 'ok' }); app.onboard && app.onboard('shared'); }
          catch (e) { app.toast('Copying was blocked by the browser: use Download instead.', { kind: 'warn' }); }
        }, 'btn btn-primary'),
        btn('Download the cells (.tsv)', () => io.download(new Blob([ex.tsv], { type: 'text/tab-separated-values' }), `nuhjm-${io.fileStamp(app.month)}-${ex.range.replace(':', '-')}.tsv`))),
      ex.changes.length ? h('details', { class: 'more-changes' }, h('summary', null, 'What changed'),
        h('table', { class: 'more-tbl' }, h('thead', null, h('tr', null, ['Cell', 'Name', 'Day', 'Was', 'Now'].map(t => h('th', { scope: 'col' }, t)))),
          h('tbody', null, ex.changes.slice(0, 400).map(c => h('tr', null, h('td', null, c.cell), h('td', null, c.name), h('td', null, M.fmtDay(c.date)), h('td', null, c.from || '·'), h('td', null, h('strong', null, c.to || '·'))))))) : null,
      h('p', { class: 'more-p' }, 'Import again just before pasting if others have been editing the sheet: the paste replaces those day cells.'));
    const lay = state.sheets[app.month];
    if (cloud.enabled && lay && lay.source) backBox.prepend(googleWriteBox(ex, lay));
    if (M.isMonthLocked(state, app.month)) backBox.prepend(h('p', { class: 'warn-box', role: 'note' }, `${M.fmtMonth(app.month)} is locked: nothing in it can change, and nothing is written to the sheet. Unlock it first (the Locked button at the top).`));
  }

  // Write straight to the Google Sheet: first read the whole block again and check it is exactly what was read; only then write
  // the changed cells (plain values) and read them back. Anything unexpected: nothing is written and the cells are listed.
  let gNote = null;   // the last result shown under the buttons (kept when this section redraws)
  const noteBox = h('div', { class: 'sheet-note', 'aria-live': 'polite' });
  function showNote(kind, text, diffs) {
    gNote = { kind, text, diffs };
    paintNote();
  }
  function paintNote() {
    noteBox.innerHTML = '';
    if (!gNote) return;
    noteBox.append(h('p', { class: gNote.kind === 'ok' ? 'ok-box' : 'warn-box', role: 'note' }, gNote.text));
    if (gNote.diffs && gNote.diffs.length) noteBox.append(h('table', { class: 'more-tbl' },
      h('thead', null, h('tr', null, ['Cell', 'Name', 'When read', 'Now in the sheet'].map(t => h('th', { scope: 'col' }, t)))),
      h('tbody', null, gNote.diffs.slice(0, 40).map(d => h('tr', null, h('td', null, d.cell), h('td', null, d.name), h('td', null, d.then || '·'), h('td', null, h('strong', null, d.now || '·')))))),
      gNote.diffs.length > 40 ? h('p', { class: 'muted' }, `and ${gNote.diffs.length - 40} more`) : null);
  }
  const clock = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  function googleWriteBox(ex, lay) {
    const state = store.get(), locked = M.isMonthLocked(state, app.month), n = ex.changes.length;
    const nDays = M.monthDays(app.month).length;
    const busy = on => box.querySelectorAll('button').forEach(b => { b.disabled = on || (b.dataset.needs === 'changes' && (!n || locked)); });
    const check = async () => {
      busy(true);
      try {
        const r = await G.checkUnchanged(lay.source, lay, nDays);
        if (r.ok) showNote('ok', `Checked just now (${clock(r.at)}): the Google Sheet is exactly as you read it. ${r.rows} rows and ${r.cells} cells compared, nothing has changed.`);
        else showNote('warn', `The Google Sheet has changed since you read it (${r.diffs.length} cell${r.diffs.length === 1 ? '' : 's'}). Nothing was written. Read it again from Google, then redo your changes.`, r.diffs);
        return r;
      } catch (e) { console.error(e); showNote('warn', cloud.friendly(e)); return null; } finally { busy(false); }
    };
    const write = async () => {
      if (locked) { app.toast(`${M.fmtMonth(app.month)} is locked. Unlock it first.`, { kind: 'warn' }); return; }
      const r = await check();
      if (!r || !r.ok) return;
      const okd = await askList({
        title: `Write ${n} cell${n === 1 ? '' : 's'} to Google?`,
        intro: `Checked just now (${clock(r.at)}): the Google Sheet is exactly as you read it. These ${n} cell${n === 1 ? '' : 's'} in "${lay.source.title}" will be changed, and nothing else in the sheet is touched. Plain values only: no formulas, colours or other tabs.`,
        rows: ex.changes.map(c => ({ cell: c.cell, name: c.name, day: M.fmtDay(c.date), was: c.from, now: c.to })),
        cols: ['Cell', 'Name', 'Day', 'Now in the sheet', 'Will become'], ok: `Write ${n} cell${n === 1 ? '' : 's'}`, file: `nuhjm-${io.fileStamp(app.month)}-to-write.csv`,
      });
      if (!okd) return;
      busy(true);
      try {
        const w = await G.writeChanges(lay.source, lay, ex.changes);
        store.commit(`Wrote ${n} cells to the Google Sheet`, draft => { S.markWritten(draft, app.month, ex.changes); });
        if (w.verified) showNote('ok', `Wrote ${w.written} cell${w.written === 1 ? '' : 's'} at ${clock(new Date())} and read them back: all match what was written.`);
        else showNote('warn', `Wrote ${w.written} cells, but ${w.mismatches.length} did not read back as written: ${w.mismatches.slice(0, 5).map(m => m.cell).join(', ')}. Check the sheet (its version history can undo this).`);
        app.onboard && app.onboard('shared');
        // the roster now matches the sheet: a good moment to keep it in the cloud too
        if (w.verified && app.openCloud && !app.isDemo && cloud.enabled) app.toast('Written to the sheet. Save the roster to the cloud too?', { action: { label: 'Open cloud', fn: () => app.openCloud() }, ms: 10000 });
      } catch (e) { console.error(e); showNote('warn', `${cloud.friendly(e)} Some cells may not have been written: read the sheet again to see.`); } finally { busy(false); }
    };
    const box = h('div', { class: 'sheet-google' },
      h('p', null, 'Or write straight to the Google Sheet. It first reads the sheet again and checks that nothing changed since you read it; then it writes only the changed cells, as plain values, and reads them back.'),
      h('div', { class: 'more-row' },
        h('button', { type: 'button', class: 'btn btn-primary', 'data-needs': 'changes', disabled: !n || locked, onclick: write }, n ? `Check, then write ${n} cell${n === 1 ? '' : 's'} to Google` : 'Nothing to write'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: check }, 'Only check the sheet is unchanged')),
      lay.lastWrite ? h('div', { class: 'sheet-undo' },
        h('p', null, `Last write to Google: ${lay.lastWrite.changes.length} cell${lay.lastWrite.changes.length === 1 ? '' : 's'} on ${new Date(lay.lastWrite.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. You can put them back as they were: cells somebody has changed since are left alone.`),
        h('div', { class: 'more-row' },
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => undo() }, 'Undo that write in Google'),
          btn('Download that list (.csv)', () => downloadList(lay.lastWrite.changes.map(c => [c.cell, c.name, M.fmtDay(c.date), c.from, c.to]), ['Cell', 'Name', 'Day', 'Was', 'Written'], `nuhjm-${io.fileStamp(app.month)}-last-write.csv`)))) : null,
      noteBox);
    const undo = async () => {
      busy(true);
      try {
        const w = lay.lastWrite;
        const peek = await G.checkCells(lay.source, lay, w.changes);   // what each cell holds now
        const okd = await askList({
          title: `Undo the last write (${w.changes.length} cell${w.changes.length === 1 ? '' : 's'})?`,
          intro: `Cells that still hold what was written go back to what was there before. ${peek.skipped.length ? `${peek.skipped.length} cell${peek.skipped.length === 1 ? ' has' : 's have'} been changed by someone since and will be left alone.` : 'None has been changed since.'}`,
          rows: w.changes.map(c => ({ cell: c.cell, name: c.name, day: M.fmtDay(c.date), was: peek.now.get(c.cell) ?? '', now: c.from, left: peek.skipped.some(s => s.cell === c.cell) })),
          cols: ['Cell', 'Name', 'Day', 'Now in the sheet', 'Will go back to'], ok: 'Put them back',
        });
        if (!okd) return;
        const res = await G.undoChanges(lay.source, lay, w.changes);
        store.commit('Undid the write to the Google Sheet', draft => { S.markUndone(draft, app.month, res.restored, res.skipped); });
        showNote(res.verified && !res.skipped.length ? 'ok' : 'warn',
          `Put back ${res.restored.length} cell${res.restored.length === 1 ? '' : 's'} and read them back${res.verified ? ': all match.' : ', but some did not read back as expected: check the sheet.'}${res.skipped.length ? ` ${res.skipped.length} left alone because someone changed them since.` : ''}`, res.skipped.map(s => ({ cell: s.cell, name: '', then: s.expected, now: s.got })));
      } catch (e) { console.error(e); showNote('warn', cloud.friendly(e)); } finally { busy(false); }
    };
    paintNote();
    return box;
  }

  // CSV of a list of rows (for keeping a record of what was written)
  function downloadList(rows, cols, name) {
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    io.download(new Blob([[cols, ...rows].map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' }), name);
  }
  // A dialog listing every cell that will change; resolves true on the main button, false on Cancel or close.
  function askList({ title, intro, rows, cols, ok, file }) {
    return new Promise(resolve => {
      let answered = false;
      const body = h('div', { class: 'ask-list' },
        h('p', null, intro),
        h('div', { class: 'ask-scroll' }, h('table', { class: 'more-tbl' },
          h('thead', null, h('tr', null, cols.map(t => h('th', { scope: 'col' }, t)))),
          h('tbody', null, rows.map(r => h('tr', { class: r.left ? 'is-left' : null }, h('td', null, r.cell), h('td', null, r.name), h('td', null, r.day), h('td', null, r.was || '·'), h('td', null, h('strong', null, r.left ? 'left alone' : (r.now || '·')))))))),
        file ? h('div', { class: 'more-row' }, btn('Download this list (.csv)', () => downloadList(rows.map(r => [r.cell, r.name, r.day, r.was, r.now]), cols, file))) : null);
      app.sheet({ title, body, wide: true, actions: [
        { label: 'Cancel', fn: () => { answered = true; resolve(false); } },
        { label: ok, primary: true, fn: () => { answered = true; resolve(true); } },
      ], onClose: () => { if (!answered) resolve(false); } });
    });
  }
  renderBack();

  // ---------- (the NTF app's Excel import, unused here) ----------
  async function onImportFile(file) {
    const closeReading = app.toast('Reading the sheet…', { ms: 10000 });
    const done = () => { if (typeof closeReading === 'function') closeReading(); };
    try {
      await io.loadExcelJS();
      const parsed = await io.parseDeptWorkbook(await file.arrayBuffer(), store.get());
      done();
      if (!parsed.months.length) { app.toast(parsed.warnings[0] || 'No month sheet found in this file.', { kind: 'error', ms: 7000 }); return; }
      reviewImport(parsed, file.name);
    } catch (e) {
      console.error(e);
      done();
      app.toast(/^This isn't an \.xlsx/.test(e.message || '') ? e.message : `Could not read this file: ${e.message || e}`, { kind: 'error', ms: 9000 });
    }
  }
  void onImportFile;

  function reviewImport(parsed, fileName) {
    const state = store.get();
    const choices = { people: {}, unknown: {}, meetings: true };
    const body = h('div', { class: 'imp' });
    body.append(h('p', { class: 'more-p' }, `From ${fileName}. For the people and months in the sheet, leave, requests and other codes come from the sheet (replacing what is there now). Calls and shifts already planned here stay. Applying is one step: Undo puts everything back.`));
    body.append(h('h3', null, 'Months'), h('ul', { class: 'imp-months' }, parsed.months.map(m =>
      h('li', null, `${M.fmtMonth(m.month)}: ${m.people} people, ${m.cells} filled cells (columns ${M.fmtDay(m.dates[0])} to ${M.fmtDay(m.dates[m.dates.length - 1])})`))));
    if (parsed.warnings.length) body.append(h('div', { class: 'warn-box', role: 'note' }, parsed.warnings.map(w => h('div', null, w))));

    // People: new or matched, with their group
    const nNew = parsed.people.filter(p => !p.matchId).length;
    body.append(h('h3', null, `People (${parsed.people.length}: ${parsed.people.length - nNew} matched, ${nNew} new)`));
    const staffOpts = (sel) => (state.staff || []).map(s => h('option', { value: s.id, selected: s.id === sel }, `Same as ${s.name}`));
    const list = h('div', { class: 'imp-people' });
    for (const p of parsed.people) {
      choices.people[p.key] = p.matchId || 'new';
      const meta = [p.note, p.start ? `${M.fmtDay(p.start)} ${p.start.slice(0, 4)}${p.end ? ` to ${M.fmtDay(p.end)} ${p.end.slice(0, 4)}` : ''}` : ''].filter(Boolean).join(' · ');
      const tag = h('span', { class: `imp-tag ${p.matchId ? 'match' : 'new'}` }, p.matchId ? 'matched' : 'new');
      const act = h('select', { 'aria-label': `What to do with ${p.name}` },
        h('option', { value: 'new', selected: !p.matchId }, 'Add as new person'),
        staffOpts(p.matchId),
        h('option', { value: 'skip' }, 'Skip this person'));
      const grp = h('select', { 'aria-label': `Group for ${p.name}`, disabled: !!p.matchId },
        (state.groups || []).map(g => h('option', { value: g.id, selected: g.id === p.group }, g.name)));
      act.addEventListener('change', () => {
        choices.people[p.key] = act.value;
        grp.disabled = act.value !== 'new';
        tag.className = `imp-tag ${act.value === 'new' ? 'new' : act.value === 'skip' ? '' : 'match'}`;
        tag.textContent = act.value === 'new' ? 'new' : act.value === 'skip' ? 'skipped' : 'matched';
      });
      grp.addEventListener('change', () => { p.group = grp.value; });
      list.append(h('div', { class: 'imp-person' }, h('div', { class: 'pn' }, h('strong', null, p.name), tag, meta ? h('small', null, meta) : null), act, grp));
    }
    body.append(list);

    // Unknown codes
    const unk = Object.entries(parsed.unknownCodes);
    if (unk.length) {
      body.append(h('h3', null, 'Codes this roster does not know yet'));
      const box = h('div', { class: 'imp-codes' });
      unk.forEach(([code, n], i) => {
        const def = /^[A-Z]{1,4}$/.test(code) ? 'code' : 'note';
        choices.unknown[code] = def;
        const name = `unk-${i}`;
        const radio = (val, label) => {
          const r = h('input', { type: 'radio', name, value: val, checked: def === val });
          r.addEventListener('change', () => { if (r.checked) choices.unknown[code] = val; });
          return h('label', null, r, label);
        };
        box.append(h('div', { class: 'imp-code', role: 'radiogroup', 'aria-label': `Code ${code}` },
          h('code', null, code), h('span', { class: 'muted' }, `${n} cell${n === 1 ? '' : 's'}`),
          radio('code', 'Add as a code'), radio('note', 'Keep as a note')));
      });
      body.append(box, h('p', { class: 'more-p' }, 'New codes are added as kind "other" (away from the pool). You can rename or recolour them under People, Duty codes.'));
    }
    if (parsed.meetings.length) {
      const cb = h('input', { type: 'checkbox', checked: true });
      cb.addEventListener('change', () => { choices.meetings = cb.checked; });
      body.append(h('label', { class: 'more-row' }, cb, `Add ${parsed.meetings.length} meeting request${parsed.meetings.length === 1 ? '' : 's'} as notes on the day`));
    }

    app.sheet({
      title: 'Import the department sheet',
      body, wide: true,
      actions: [
        { label: 'Cancel' },
        { label: 'Apply import', primary: true, fn: () => {
          let sum = null;
          store.commit('Import Excel sheet', draft => { sum = io.applyImport(draft, parsed, choices); });
          const parts = [`${sum.cells} cells`];
          if (sum.added) parts.unshift(`${sum.added} people added`);
          if (sum.matched) parts.unshift(`${sum.matched} matched`);
          if (sum.codesAdded.length) parts.push(`${sum.codesAdded.length} new code${sum.codesAdded.length === 1 ? '' : 's'}`);
          app.toast(`Imported: ${parts.join(', ')}`, { action: { label: 'Undo', fn: () => store.undo() }, ms: 8000 });
          const first = parsed.months[0].month;
          if (first !== app.month) app.setMonth(first);
        } },
      ],
    });
  }

  // ---------- Export ----------
  const fromSel = h('select', { id: 'more-from', 'aria-label': 'First month' }, monthOptions(app.month));
  const toSel = h('select', { id: 'more-to', 'aria-label': 'Last month' }, monthOptions(app.month));
  const personSel = h('select', { id: 'more-person' });
  function fillPeople() {
    const state = store.get();
    const keep = personSel.value;
    personSel.innerHTML = '';
    const people = M.staffInMonth(state, app.month);
    for (const p of people) personSel.append(h('option', { value: p.id, selected: p.id === keep }, p.name));
    if (!people.length) personSel.append(h('option', { value: '' }, 'Nobody in post this month'));
  }
  fillPeople();

  async function exportExcel(months, button) {
    await busy(button, async () => {
      await io.loadExcelJS();
      const blob = await io.exportDeptWorkbook(store.get(), months);
      const name = months.length === 1 ? `nuhjm-${io.fileStamp(months[0])}.xlsx` : `nuhjm-${io.fileStamp(months[0])}-to-${io.fileStamp(months[months.length - 1])}.xlsx`;
      io.download(blob, name);
      app.onboard?.('shared');   // Getting started: something was exported
      app.toast(`Downloaded ${name}`);
    });
  }
  const xlThis = btn('Download this month', () => exportExcel([app.month], xlThis), 'btn btn-primary');
  const xlRange = btn('Download these months', () => {
    let a = fromSel.value, b = toSel.value;
    if (a > b) [a, b] = [b, a];
    const months = [];
    for (let m = a; m <= b && months.length < 24; m = M.addMonths(m, 1)) months.push(m);
    exportExcel(months, xlRange);
  });

  function printRoster() {
    app.onboard?.('shared');
    if (app.tab !== 'roster') app.go('roster', { m: app.month });
    let tries = 0;
    const wait = () => {
      if (document.querySelector('.view-roster') || tries++ > 30) { setTimeout(() => window.print(), 150); return; }
      setTimeout(wait, 100);
    };
    wait();
  }

  const exportSec = section('more-export', 'Export', null,
    h('h3', { class: 'more-sub' }, 'Excel (department sheet layout)'),
    h('p', { class: 'more-p' }, 'Same layout as the department sheet: sections, coloured codes, x after calls, weekends and holidays shaded, counts and a legend.'),
    h('div', { class: 'more-row' }, xlThis),
    h('div', { class: 'more-row' }, h('label', { class: 'more-lbl', for: 'more-from' }, 'From'), fromSel, h('label', { class: 'more-lbl', for: 'more-to' }, 'to'), toSel, xlRange),
    h('h3', { class: 'more-sub' }, 'PDF'),
    h('p', { class: 'more-p' }, 'Opens the print dialog on the roster grid. Choose Landscape and "Save as PDF".'),
    h('div', { class: 'more-row' }, btn('Print or save as PDF', printRoster)),
    h('h3', { class: 'more-sub' }, 'CSV'),
    h('div', { class: 'more-row' }, btn('Download CSV of this month', () => {
      io.download(new Blob([io.csvForMonth(store.get(), app.month)], { type: 'text/csv;charset=utf-8' }), `nuhjm-${io.fileStamp(app.month)}.csv`);
      app.onboard?.('shared');
    })),
    h('h3', { class: 'more-sub' }, 'Staff list for APMES People'),
    h('p', { class: 'more-p' }, 'APMES People (the resident list the logbook and evals share) can bring its residents’ years up to date from this list: names and grades only. There, Import from roster gets it in one tap; if that doesn’t work, copy it here and paste it there.'),
    h('div', { class: 'more-row' }, btn('Copy the staff list for APMES People', () => import('./apmes.js').then(m => m.copyForApmes(app)))),
    h('h3', { class: 'more-sub' }, 'Calendar for one person'),
    h('p', { class: 'more-p' }, 'Their shifts this month as all-day events (.ics). Open the file on a phone to add it to the calendar.'),
    h('div', { class: 'more-row' }, h('label', { class: 'more-lbl', for: 'more-person' }, 'Person'), personSel,
      btn('Download calendar', () => {
        const id = personSel.value;
        if (!id) return;
        const p = store.get().staff.find(s => s.id === id);
        io.download(new Blob([io.icsForPerson(store.get(), id, app.month)], { type: 'text/calendar;charset=utf-8' }), `nuhjm-${slug(p && (p.short || p.name))}-${io.fileStamp(app.month)}.ics`);
        app.onboard?.('shared');
      })));

  // ---------- Backup ----------
  const backupSec = section('more-backup', 'Backup',
    store.isDemo ? 'The practice department lives in this browser only.' : 'Everything (staff, codes, rules, every month) in one file. Keep one now and then, especially before big changes.',
    h('div', { class: 'more-row' },
      iconBtn('Download backup', () => {
        io.download(new Blob([io.backupJSON(store.get())], { type: 'application/json' }), `nuhjm-backup-${M.iso(new Date())}.json`);
        app.onboard?.('shared');
      }, 'note'),
      fileButton('Restore from a backup', '.json,application/json', onRestore)));
  backupSec.dataset.tour = 'backup';   // (the first-time tour lights it)

  async function onRestore(file) {
    let next;
    try { next = io.restoreJSON(await file.text()); } catch (e) { app.toast(e.message, { kind: 'error', ms: 7000 }); return; }
    const months = Object.keys(next.months || {}).length || new Set(Object.keys(next.cells || {}).map(M.monthOf)).size;
    const okd = await app.confirm(`Replace everything in this browser with ${file.name}? It has ${next.staff.length} people, ${next.rules.length} rules and ${months} month${months === 1 ? '' : 's'}. You can undo this straight after.`, { ok: 'Restore', danger: true });
    if (!okd) return;
    store.replace(next, 'Restore backup');
    app.toast('Backup restored', { action: { label: 'Undo', fn: () => store.undo() }, ms: 8000 });
  }

  // ---------- Settings ----------
  const deptInput = h('input', { type: 'text', id: 'more-dept', value: store.get().settings.dept || '', autocomplete: 'off' });
  deptInput.addEventListener('change', () => {
    const v = deptInput.value.trim();
    if (v === (store.get().settings.dept || '')) return;
    store.commit('Department name', d => { d.settings.dept = v; });
  });
  const holList = h('div');
  const holDate = h('input', { type: 'date', id: 'more-hol-date' });
  const holName = h('input', { type: 'text', id: 'more-hol-name', placeholder: 'e.g. Deepavali', autocomplete: 'off' });
  function renderHolidays() {
    const hol = store.get().settings.holidays || {};
    const dates = Object.keys(hol).sort();
    holList.innerHTML = '';
    if (!dates.length) { holList.append(h('p', { class: 'more-p' }, 'No public holidays yet. Load the Singapore list or add them one by one.')); return; }
    let year = '';
    let ul = null;
    for (const d of dates) {
      if (d.slice(0, 4) !== year) {
        year = d.slice(0, 4);
        ul = h('ul', { class: 'more-hols' });
        holList.append(h('div', { class: 'more-year' }, year), ul);
      }
      ul.append(h('li', null,
        h('span', { class: 'hd' }, M.fmtDay(d)),
        h('span', { class: 'hn' }, hol[d]),
        h('button', { type: 'button', class: 'btn btn-xs btn-danger-ghost', 'aria-label': `Remove ${hol[d]} (${M.fmtDay(d)} ${year})`, onclick: () => {
          store.commit(`Remove holiday ${hol[d]}`, s => { delete s.settings.holidays[d]; });
        } }, 'Remove')));
    }
  }
  function addHoliday() {
    const d = holDate.value, n = holName.value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { app.toast('Pick a date first', { kind: 'warn' }); holDate.focus(); return; }
    if (!n) { app.toast('Give the holiday a name', { kind: 'warn' }); holName.focus(); return; }
    store.commit(`Add holiday ${n}`, s => { s.settings.holidays[d] = n; });
    holDate.value = ''; holName.value = '';
  }
  holName.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addHoliday(); } });
  function loadSg() {
    const have = store.get().settings.holidays || {};
    const add = Object.keys(SG_HOLIDAYS).filter(d => !have[d]);
    if (!add.length) { app.toast('All Singapore public holidays for 2026 and 2027 are already in the list'); return; }
    store.commit('Load Singapore public holidays', s => { for (const d of add) s.settings.holidays[d] = SG_HOLIDAYS[d]; });
    app.toast(`Added ${add.length} public holiday${add.length === 1 ? '' : 's'}`, { action: { label: 'Undo', fn: () => store.undo() } });
  }
  renderHolidays();

  const settingsSec = section('more-settings', 'Settings', null,
    h('div', { class: 'more-row' }, h('label', { class: 'more-lbl', for: 'more-dept' }, 'Department name'), deptInput),
    h('h3', { class: 'more-sub' }, 'Public holidays'),
    h('p', { class: 'more-p' }, 'Holidays are shaded on the roster, count as non-working days and drive holiday rules (like the public holiday day shift).'),
    h('div', { class: 'more-row' },
      h('label', { class: 'sr-only', for: 'more-hol-date' }, 'Holiday date'), holDate,
      h('label', { class: 'sr-only', for: 'more-hol-name' }, 'Holiday name'), holName,
      iconBtn('Add', addHoliday, 'plus')),
    h('div', { class: 'more-row' }, btn('Load Singapore public holidays (2026 to 2027)', loadSg)),
    holList);

  // ---------- Cloud ----------
  let teamView = null;
  const teamSlot = h('div');
  const teamSec = section('more-team', 'Cloud', null, teamSlot);
  if (store.isDemo) {
    teamSlot.append(h('p', { class: 'more-p' }, 'The cloud is off in the practice department.'));
  } else {
    teamSlot.append(h('p', { class: 'more-p' }, 'Loading…'));
    import('./ui-team.js').then(mod => {
      teamSlot.innerHTML = '';
      if (typeof mod.mountTeam !== 'function') throw new Error('no mountTeam');
      teamView = mod.mountTeam(teamSlot, app, { onChange: app.refreshCloud }) || null;
    }).catch(() => {
      teamSlot.innerHTML = '';
      teamSlot.append(h('p', { class: 'more-p' }, 'The cloud is not set up yet. Until then this roster lives in this browser only: download a backup now and then.'));
    });
  }

  // ---------- Help: the walkthrough again ----------
  const guide = () => import('./guide.js');
  const walk = iconBtn('Show the walkthrough', async () => (await guide()).takeTour(app), 'tour');
  walk.dataset.tourReturn = 'walkthrough';   // (focus comes back here when the tour ends)
  const helpSec = section('more-help', 'Help', 'A one-minute tour of the main controls, three short practice tasks, and the Getting started checklist.',
    h('div', { class: 'more-row' }, iconBtn('Help and shortcuts', async () => (await guide()).openHelp(app), 'help'), walk,
      store.isDemo ? iconBtn('Try it yourself', async () => (await guide()).startTasks(app), 'task')
        : h('a', { class: 'btn btn-ghost', href: './?demo&try', target: '_blank', rel: 'noopener', html: `${icon('task')}<span>Try it yourself</span><span class="sr-only"> (practice department, a new tab)</span>` }),
      store.isDemo ? null : iconBtn('Getting started checklist', async () => (await guide()).showChecklist(app), 'flag')));

  // ---------- Start again ----------
  const startSec = section('more-start', store.isDemo ? 'Practice department' : 'Start again', null,
    h('p', { class: 'more-p' }, store.isDemo
      ? 'This is a made-up department for trying things out. Changes stay in this browser.'
      : 'Clears the roster in this browser and starts empty (default codes and rules). Download a backup first if you might want it back.'),
    h('div', { class: 'more-row' },
      store.isDemo
        ? btn('Reset the practice department', resetPractice, 'btn btn-danger-ghost')
        : btn('Start again (clear this browser)', startAgain, 'btn btn-danger-ghost'),
      store.isDemo
        ? h('a', { class: 'btn btn-ghost', href: './' }, 'Go to your own roster')
        : h('a', { class: 'btn btn-ghost', href: './?demo', target: '_blank', rel: 'noopener' }, 'Try the practice department')));
  startSec.classList.add('more-danger');

  async function startAgain() {
    const okd = await app.confirm('Clear everything in this browser and start with an empty roster? Staff, rules and every month go. You can undo straight after, but not once you leave the page.', { ok: 'Clear and start again', danger: true });
    if (!okd) return;
    store.replace(M.defaultState(), 'Start again');
    app.toast('Started again with an empty roster', { action: { label: 'Undo', fn: () => store.undo() }, ms: 8000 });
  }
  async function resetPractice() {
    const okd = await app.confirm('Start the practice department again? Your practice changes will be replaced.', { ok: 'Reset practice' });
    if (!okd) return;
    const { demoState } = await import('./demo.js');
    store.replace(demoState(M.iso(new Date())), 'Reset practice');
    app.toast('Practice department reset', { action: { label: 'Undo', fn: () => store.undo() } });
  }

  // ---------- People link on phone (the shell adds one above this screen; this is a fallback) ----------
  const view = el.closest('.view');
  if (app.isPhone() && !(view && view.querySelector('.link-card'))) {
    root.append(h('a', { href: '#people', class: 'card link-card', onclick: (e) => { e.preventDefault(); app.go('people'); } },
      h('span', { class: 'lc-ic', html: icon('people') }),
      h('span', { class: 'lc-text' }, h('strong', null, 'People'), h('span', null, 'Staff, groups, tags and duty codes')),
      h('span', { class: 'lc-go', html: icon('right') })));
  }
  if (app.isPhone()) {
    root.append(h('a', { href: '#postings', class: 'card link-card', onclick: (e) => { e.preventDefault(); app.go('postings'); } },
      h('span', { class: 'lc-ic', html: icon('day') }),
      h('span', { class: 'lc-text' }, h('strong', null, 'Postings'), h('span', null, 'Plan postings by the week')),
      h('span', { class: 'lc-go', html: icon('right') })));
  }

  // ---------- version lines ----------
  const foot = h('div', { class: 'more-foot' });
  import('./version.js').then(mod => {
    if (typeof mod.renderVersion !== 'function') return;
    const out = mod.renderVersion(foot);
    if (out instanceof Node && !out.parentNode) foot.append(out);
  }).catch(() => { /* version helper not there yet: show nothing */ });

  root.append(teamSec, importSec, exportSheetSec, genSec, exportSec, backupSec, settingsSec, helpSec, startSec, foot);

  return {
    update(state) {
      if (document.activeElement !== deptInput) deptInput.value = state.settings.dept || '';
      renderHolidays();
      fillPeople();
      renderBack();
      renderGen();
      if (teamView && typeof teamView.update === 'function') { try { teamView.update(state); } catch (e) { console.error(e); } }
    },
    unmount() {
      if (teamView && typeof teamView.unmount === 'function') { try { teamView.unmount(); } catch (e) { console.error(e); } }
    },
  };
}
