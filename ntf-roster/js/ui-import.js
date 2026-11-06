// NTF Roster: reading the department sheet in (with a review before anything changes) and writing the roster back
// into that same file. Used by the More screen and by the three steps card (ui-steps.js). The file read last stays in
// memory for this tab only (app.lastBook), so "Fill the sheet" writes into the sheet that came in.
import * as M from './model.js';
import * as io from './io.js';
import * as S from './steps.js';

async function busy(app, button, fn) {
  if (button) button.disabled = true;
  try { await fn(); } catch (e) { console.error(e); app.toast(e.message || 'Something went wrong', { kind: 'error' }); } finally { if (button) button.disabled = false; }
}

// Read a chosen file and open the import's review sheet; onDone({ sum, guessed, month }) after Apply.
export async function importFile(app, file, { onDone = null } = {}) {
  const store = app.store;
  const closeReading = app.toast('Reading the sheet…', { ms: 10000 });
  const done = () => { if (typeof closeReading === 'function') closeReading(); };
  try {
    await io.loadExcelJS();
    const buf = await file.arrayBuffer();
    const parsed = await io.parseDeptWorkbook(buf.slice(0), store.get());
    app.lastBook = { name: file.name, buf };   // kept in memory (this tab only) so the filled sheet can go back in the same file
    done();
    if (!parsed.months.length) { app.toast(parsed.warnings[0] || 'No month sheet found in this file.', { kind: 'error', ms: 7000 }); return; }
    reviewImport(app, parsed, file.name, onDone);
  } catch (e) {
    console.error(e);
    done();
    app.toast(/^This isn't an \.xlsx/.test(e.message || '') ? e.message : `Could not read this file: ${e.message || e}`, { kind: 'error', ms: 9000 });
  }
}

function reviewImport(app, parsed, fileName, onDone) {
  const { h } = app;
  const store = app.store;
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
        let setup = { guessed: [] };
        const junior = !(store.get().settings && store.get().settings.pool === 'senior');
        store.commit('Import Excel sheet', draft => {
          sum = io.applyImport(draft, parsed, choices);
          for (const m of parsed.months) S.markStep(draft, m.month, 'imported');
          // the junior roster: guess the call level of anyone new to it, and add the junior rules the first time
          if (junior) setup = S.autoSetupPool(draft, parsed.months[0].month);
        }, { unlock: true });
        const parts = [`${sum.cells} cells`];
        if (sum.added) parts.unshift(`${sum.added} people added`);
        if (sum.matched) parts.unshift(`${sum.matched} matched`);
        if (sum.codesAdded.length) parts.push(`${sum.codesAdded.length} new code${sum.codesAdded.length === 1 ? '' : 's'}`);
        if (store.unlocked.length) parts.push(`${store.unlocked.map(M.fmtMonth).join(', ')} unlocked`);
        app.toast(`Imported: ${parts.join(', ')}`, { action: { label: 'Undo', fn: () => store.undo() }, ms: 8000 });
        const first = parsed.months[0].month;
        if (first !== app.month) app.setMonth(first);
        if (onDone) onDone({ sum, guessed: setup.guessed, month: first });
        // people new to the junior call list: their guessed levels are checked once
        if (setup.guessed.length) app.settled().then(() => import('./ui-steps.js')).then(m => m.openCallList(app, { fresh: setup.guessed.length })).catch(e => console.error(e));
      } },
    ],
  });
}

export async function fillSheet(app, book, button = null) {
  const store = app.store;
  await busy(app, button, async () => {
    await io.loadExcelJS();
    const out = await io.fillDeptWorkbook(book.buf.slice(0), store.get(), app.month);
    const name = `${book.name.replace(/\.xlsx$/i, '')} (filled).xlsx`;
    io.download(out.blob, name);
    app.onboard?.('shared');
    S.noteExported(store, app.month);
    app.toast(`Downloaded ${name}: ${out.changed} cell${out.changed === 1 ? '' : 's'} written${out.missing.length ? `. Not found in the sheet: ${out.missing.slice(0, 4).join(', ')}${out.missing.length > 4 ? '…' : ''}` : ''}`, { ms: 9000 });
  });
}
