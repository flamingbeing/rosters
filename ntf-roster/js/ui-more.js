// NTF Roster: the More screen. Import the department's Excel sheet (with a review before anything changes),
// export (Excel in the department layout, PDF through the print dialog, CSV, a calendar file for one person),
// backup and restore, settings (department name, public holidays), the team sharing panel, starting again,
// and the two app-version lines at the very end.
import * as M from './model.js';
import * as io from './io.js';
import * as R from './rotations.js';
import { pullFromPeople } from './people-pull.js';
import { SG_HOLIDAYS } from './demo.js';
import { kitSwitch } from '../../lib/roster-core/kit.js';

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

  let lastBook = null;   // the last sheet imported or chosen: { name, buf }, not saved anywhere

  // ---------- Import ----------
  const importSec = section('more-import', 'Import the department sheet',
    'The monthly "ALL STAFF LEAVE REQUEST" Excel file (.xlsx). You see what was found before anything changes.',
    h('div', { class: 'more-row' }, fileButton('Choose Excel file', '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', onImportFile, 'upload', 'btn btn-primary')));

  // ---------- Rotations from APMES People ----------
  const rotSec = section('more-rot', 'Rotations from APMES People',
    'Where each person is posted or away this month, from the department rotation sheet in APMES People. You link the names there and tap Send; you see what would change here before anything does.',
    h('div', { class: 'more-row' },
      iconBtn('Pull rotations from APMES People…', () => pullFromPeople(app, reviewRotations), 'upload', 'btn btn-primary'),
      btn('Paste rotations…', pasteRotations)));

  async function onImportFile(file) {
    const closeReading = app.toast('Reading the sheet…', { ms: 10000 });
    const done = () => { if (typeof closeReading === 'function') closeReading(); };
    try {
      await io.loadExcelJS();
      const buf = await file.arrayBuffer();
      const parsed = await io.parseDeptWorkbook(buf.slice(0), store.get());
      lastBook = { name: file.name, buf };   // kept in memory so the filled sheet can go back in the same file
      done();
      if (!parsed.months.length) { app.toast(parsed.warnings[0] || 'No month sheet found in this file.', { kind: 'error', ms: 7000 }); return; }
      reviewImport(parsed, file.name);
    } catch (e) {
      console.error(e);
      done();
      app.toast(/^This isn't an \.xlsx/.test(e.message || '') ? e.message : `Could not read this file: ${e.message || e}`, { kind: 'error', ms: 9000 });
    }
  }

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
          store.commit('Import Excel sheet', draft => { sum = io.applyImport(draft, parsed, choices); }, { unlock: true });
          const parts = [`${sum.cells} cells`];
          if (sum.added) parts.unshift(`${sum.added} people added`);
          if (sum.matched) parts.unshift(`${sum.matched} matched`);
          if (sum.codesAdded.length) parts.push(`${sum.codesAdded.length} new code${sum.codesAdded.length === 1 ? '' : 's'}`);
          if (store.unlocked.length) parts.push(`${store.unlocked.map(M.fmtMonth).join(', ')} unlocked`);
          app.toast(`Imported: ${parts.join(', ')}`, { action: { label: 'Undo', fn: () => store.undo() }, ms: 8000 });
          const first = parsed.months[0].month;
          if (first !== app.month) app.setMonth(first);
        } },
      ],
    });
  }

  function pasteRotations() {
    const ta = h('textarea', { class: 'rot-paste', rows: 8, spellcheck: 'false', 'aria-label': 'Rotations text from APMES People', placeholder: 'Name\t2026-10-05\t2026-10-12 …' });
    app.sheet({
      title: 'Paste rotations',
      body: h('div', null, h('p', { class: 'more-p' }, 'The text People sends: a "Name" row of Mondays, then one row per person. You see what would change before anything does.'), ta),
      actions: [{ label: 'Cancel' }, { label: 'Review', primary: true, fn: () => reviewRotations(ta.value) }],
    });
  }

  function reviewRotations(text) {
    const parsed = R.parseRotations(text);
    if (!parsed.rows.length) { app.toast('That is not the rotations text: it needs a "Name" row of Mondays, then one row per person.', { kind: 'error', ms: 7000 }); return; }
    const plan = R.planRotations(parsed, store.get(), app.month);
    const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
    const body = h('div', { class: 'imp' });
    body.append(h('p', { class: 'more-p' }, `For ${M.fmtMonth(app.month)}. Postings at other hospitals and leave are added as codes on weekdays (not public holidays) where the person has no leave or away code yet. Shifts stay. Applying is one step: Undo puts everything back.`));
    const counts = Object.entries(plan.byCode).map(([c, n]) => `${c} ${n}`).join(', ');
    body.append(h('p', { class: 'more-p' }, plan.fills.length
      ? `${plural(plan.fills.length, 'cell', 'cells')} for ${plural(plan.people, 'person', 'people')}: ${counts}.`
      : 'Nothing to add for this month.'));
    const notes = [];
    if (plan.posted) notes.push(`${plural(plan.posted, 'person is', 'people are')} posted at NTF this month (nothing to mark).`);
    if (plan.busy) notes.push(`${plural(plan.busy, 'day was', 'days were')} left alone: the person already has leave or an away code.`);
    if (plan.unmatched.length) notes.push(`Not in this roster, skipped: ${plan.unmatched.join(', ')}.`);
    if (plan.ignored) notes.push(`${plural(plan.ignored, 'week was', 'weeks were')} skipped: a word this version does not know.`);
    if (plan.newCodes.length) notes.push(`New codes will be added as "away" (rename or recolour them under People, Duty codes): ${plan.newCodes.join(', ')}.`);
    if (notes.length) body.append(h('div', { class: 'warn-box', role: 'note' }, notes.map(n => h('div', null, n))));
    app.sheet({
      title: 'Rotations from APMES People',
      body,
      actions: plan.fills.length ? [
        { label: 'Cancel' },
        { label: 'Apply', primary: true, fn: () => {
          let sum = null;
          store.commit('Rotations from APMES People', draft => { sum = R.applyRotations(draft, plan); }, { unlock: true });
          app.toast(`Added ${plural(sum.cells, 'cell', 'cells')}${sum.codesAdded.length ? ` and ${plural(sum.codesAdded.length, 'new code', 'new codes')}` : ''}`, { action: { label: 'Undo', fn: () => store.undo() }, ms: 8000 });
        } },
      ] : [{ label: 'Close' }],
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
    const people = M.staffInView(state, app.month);
    for (const p of people) personSel.append(h('option', { value: p.id, selected: p.id === keep }, p.name));
    if (!people.length) personSel.append(h('option', { value: '' }, 'Nobody in post this month'));
  }
  fillPeople();

  async function exportExcel(months, button) {
    await busy(button, async () => {
      await io.loadExcelJS();
      const blob = await io.exportDeptWorkbook(store.get(), months);
      const name = months.length === 1 ? `ntf-roster-${io.fileStamp(months[0])}.xlsx` : `ntf-roster-${io.fileStamp(months[0])}-to-${io.fileStamp(months[months.length - 1])}.xlsx`;
      io.download(blob, name);
      app.onboard?.('shared');   // Getting started: something was exported
      app.toast(`Downloaded ${name}`);
    });
  }
  async function fillSheet(book, button) {
    await busy(button, async () => {
      await io.loadExcelJS();
      const out = await io.fillDeptWorkbook(book.buf.slice(0), store.get(), app.month);
      const name = `${book.name.replace(/\.xlsx$/i, '')} (filled).xlsx`;
      io.download(out.blob, name);
      app.onboard?.('shared');
      app.toast(`Downloaded ${name}: ${out.changed} cell${out.changed === 1 ? '' : 's'} written${out.missing.length ? `. Not found in the sheet: ${out.missing.slice(0, 4).join(', ')}${out.missing.length > 4 ? '…' : ''}` : ''}`, { ms: 9000 });
    });
  }
  const fillBtn = btn('Fill the sheet I imported', () => (lastBook ? fillSheet(lastBook, fillBtn) : app.toast('Import the sheet first, or choose it below.', { kind: 'error' })), 'btn btn-primary');
  const fillPick = fileButton('Choose the sheet to fill', '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', async file => {
    try { await fillSheet({ name: file.name, buf: await file.arrayBuffer() }, null); } catch (e) { console.error(e); app.toast(e.message || 'Could not fill that file.', { kind: 'error', ms: 9000 }); }
  }, 'upload', 'btn');
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
    h('h3', { class: 'more-sub' }, 'Back into the sheet you were sent'),
    h('p', { class: 'more-p' }, 'Writes the calls (C), PM shifts (P), half calls (HC) and pain service weeks (green) into the same Excel file, and changes nothing else in it: colours, leave, formulas and counts stay as they were. Send the downloaded file back.'),
    h('div', { class: 'more-row' }, fillBtn, fillPick),
    h('h3', { class: 'more-sub' }, 'Excel (department sheet layout)'),
    h('p', { class: 'more-p' }, 'Same layout as the department sheet: sections, coloured codes, x after calls, weekends and holidays shaded, counts and a legend.'),
    h('div', { class: 'more-row' }, xlThis),
    h('div', { class: 'more-row' }, h('label', { class: 'more-lbl', for: 'more-from' }, 'From'), fromSel, h('label', { class: 'more-lbl', for: 'more-to' }, 'to'), toSel, xlRange),
    h('h3', { class: 'more-sub' }, 'PDF'),
    h('p', { class: 'more-p' }, 'Opens the print dialog on the roster grid. Choose Landscape and "Save as PDF".'),
    h('div', { class: 'more-row' }, btn('Print or save as PDF', printRoster)),
    h('h3', { class: 'more-sub' }, 'CSV'),
    h('div', { class: 'more-row' }, btn('Download CSV of this month', () => {
      io.download(new Blob([io.csvForMonth(store.get(), app.month)], { type: 'text/csv;charset=utf-8' }), `ntf-roster-${io.fileStamp(app.month)}.csv`);
      app.onboard?.('shared');
    })),
    h('h3', { class: 'more-sub' }, 'Calendar for one person'),
    h('p', { class: 'more-p' }, 'Their shifts this month as all-day events (.ics). Open the file on a phone to add it to the calendar.'),
    h('div', { class: 'more-row' }, h('label', { class: 'more-lbl', for: 'more-person' }, 'Person'), personSel,
      btn('Download calendar', () => {
        const id = personSel.value;
        if (!id) return;
        const p = store.get().staff.find(s => s.id === id);
        io.download(new Blob([io.icsForPerson(store.get(), id, app.month)], { type: 'text/calendar;charset=utf-8' }), `ntf-roster-${slug(p && (p.short || p.name))}-${io.fileStamp(app.month)}.ics`);
        app.onboard?.('shared');
      })));

  // ---------- Backup ----------
  const backupSec = section('more-backup', 'Backup',
    store.isDemo ? 'The practice department lives in this browser only.' : 'Everything (staff, codes, rules, every month) in one file. Keep one now and then, especially before big changes.',
    h('div', { class: 'more-row' },
      iconBtn('Download backup', () => {
        io.download(new Blob([io.backupJSON(store.get())], { type: 'application/json' }), `ntf-roster-backup-${M.iso(new Date())}.json`);
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

  // ---------- Team ----------
  let teamView = null;
  const teamSlot = h('div');
  const teamSec = section('more-team', 'Team sharing', null, teamSlot);
  if (store.isDemo) {
    teamSlot.append(h('p', { class: 'more-p' }, 'Team sharing is off in the practice department.'));
  } else {
    teamSlot.append(h('p', { class: 'more-p' }, 'Loading…'));
    import('./ui-team.js').then(mod => {
      teamSlot.innerHTML = '';
      if (typeof mod.mountTeam !== 'function') throw new Error('no mountTeam');
      teamView = mod.mountTeam(teamSlot, app, { onChange: app.refreshCloud }) || null;
    }).catch(() => {
      teamSlot.innerHTML = '';
      teamSlot.append(h('p', { class: 'more-p' }, 'Team sharing is not set up yet. Until then this roster lives in this browser only: download a backup now and then.'));
    });
  }

  // ---------- Help: the walkthrough again ----------
  const guide = () => import('./guide.js');
  const walk = iconBtn('Show the walkthrough', async () => (await guide()).takeTour(app), 'tour');
  walk.dataset.tourReturn = 'walkthrough';   // (focus comes back here when the tour ends)
  const helpSec = section('more-help', 'Help', 'A one-minute tour of the main controls, three short practice tasks, and the Getting started checklist.',
    h('div', { class: 'more-row' }, walk,
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

  // ---------- look ----------
  // this device's look and density (the UI kit's switch): not a team setting; at the page end, so the screen reads as it
  // did before the switch was added. Light only (css/kit.css).
  const kitHost = h('div', { class: 'kit-switch' });
  kitSwitch(kitHost);
  const lookSec = section('more-look', 'Look', 'Kept on this device only.', kitHost);

  // ---------- version lines ----------
  const foot = h('div', { class: 'more-foot' });
  import('./version.js').then(mod => {
    if (typeof mod.renderVersion !== 'function') return;
    const out = mod.renderVersion(foot);
    if (out instanceof Node && !out.parentNode) foot.append(out);
  }).catch(() => { /* version helper not there yet: show nothing */ });

  root.append(importSec, rotSec, exportSec, backupSec, settingsSec, teamSec, helpSec, startSec, lookSec, foot);

  return {
    update(state) {
      if (document.activeElement !== deptInput) deptInput.value = state.settings.dept || '';
      renderHolidays();
      fillPeople();
      if (teamView && typeof teamView.update === 'function') { try { teamView.update(state); } catch (e) { console.error(e); } }
    },
    unmount() {
      if (teamView && typeof teamView.unmount === 'function') { try { teamView.unmount(); } catch (e) { console.error(e); } }
    },
  };
}
