// NUH Junior Monthly: the More screen's "Make blank month sheets" section. For each month in a range it builds the
// department's whole sheet (the Request tab with its totals and counts, the Junior Call Roster, the WR / Premed Roster and
// the Leave Waitlist, every tab as formulas), as Google Sheets in the app's own Drive folder or as Excel files.
// The Google Sheets come locked as the department keeps them: the Request tab and the two roster tabs only for the
// rosterers, with the juniors' block open while requests are open (Open for requests / Lock requests below), and the Leave
// Waitlist open to all. The folder is shared once with the rosterers (no email from Google) and, if ticked, with anyone
// who has the link. The list of made sheets is kept with the team's data; the folder is the person's own (drive.file).
import * as M from './model.js';
import * as io from './io.js';
import * as G from './gsheets.js';
import * as cloud from './cloud.js';
import { buildSheet } from './sheetgen.js';
import { specFromState } from './sheetgen-state.js';
import { buildTabs, requestBlock, monthLabel } from './sheetgen-tabs.js';
import { toWorkbook } from './sheetgen-xlsx.js';
import { toSpreadsheetBody } from './sheetgen-gsheets.js';

const FOLDER_KEY = 'nuhjm-sheet-folder';
export const FOLDER_NAME = 'NUH junior rosters (made by the app)';
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export const makerOf = state => {
  const s = (state.settings && state.settings.sheetMaker) || {};
  return { editors: Array.isArray(s.editors) ? s.editors : [], daily: typeof s.daily === 'string' ? s.daily : '', anyone: s.anyone !== false, made: s.made && typeof s.made === 'object' ? s.made : {} };
};
export const parseEmails = text => String(text || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
export const fileTitle = month => `${month.slice(5)}. ${monthLabel(month)} Roster`;

// Everything one month's file needs, from the app's data (pure: the tests use it too)
export function monthFiles(state, month, { open = true, me = '' } = {}) {
  const mk = makerOf(state);
  const spec = specFromState(state, month, { seniors: true });
  const model = buildSheet(spec);
  const tabs = buildTabs(model, { holidays: spec.holidays, requestTab: 'Request', ...(mk.daily.trim() ? { dailyRosterers: mk.daily.trim() } : {}) });
  const block = requestBlock(model, spec.people);
  const body = toSpreadsheetBody(model, { title: fileTitle(month), sheetName: 'Request', tabs, protect: { editors: mk.editors, me, open: open ? block : '' } });
  return { spec, model, tabs, block, body };
}

export function sheetMakerSection(app, { section, btn }) {
  const { h } = app;
  const store = app.store;
  const sel = (label, value) => {
    const s = h('select', { 'aria-label': label });
    for (let i = -3; i <= 15; i++) { const m = M.addMonths(app.month, i); s.append(h('option', { value: m, selected: m === value }, M.fmtMonth(m))); }
    return s;
  };
  const fromSel = sel('First month', app.month), toSel = sel('Last month', app.month);
  const mk0 = makerOf(store.get());
  const save = (label, fn) => store.commit(label, d => { d.settings.sheetMaker = { ...makerOf(d), ...fn(makerOf(d)) }; });
  const editorsIn = h('textarea', { rows: '3', 'aria-label': 'Rosterers who can edit the locked tabs', placeholder: 'Their Google emails, one per line or with commas' }, mk0.editors.join('\n'));
  editorsIn.addEventListener('change', () => {
    const list = [...new Set(parseEmails(editorsIn.value))];
    const bad = list.filter(e => !EMAIL.test(e));
    if (bad.length) { app.toast(`Not an email: ${bad.join(', ')}`, { kind: 'warn', ms: 6000 }); return; }
    save('Rosterers for the sheets', () => ({ editors: list }));
  });
  const dailyIn = h('input', { type: 'text', 'aria-label': 'Daily rosterers named in the Leave Waitlist', placeholder: 'e.g. Dr A and Dr B', value: mk0.daily });
  dailyIn.addEventListener('change', () => save('Daily rosterers for the sheets', () => ({ daily: dailyIn.value.trim() })));
  const anyoneIn = h('input', { type: 'checkbox', checked: mk0.anyone });
  anyoneIn.addEventListener('change', () => save(anyoneIn.checked ? 'Sheets open to anyone with the link' : 'Sheets only for the rosterers', () => ({ anyone: anyoneIn.checked })));
  const openIn = h('input', { type: 'checkbox', checked: true });
  const status = h('p', { class: 'ok-box', role: 'status', hidden: true });
  const info = h('ul', { class: 'more-list' });
  const list = h('div', { class: 'bx-field' });

  const months = () => {
    let a = fromSel.value, b = toSel.value;
    if (b < a) [a, b] = [b, a];
    const out = [];
    for (let m = a; m <= b && out.length < 12; m = M.addMonths(m, 1)) out.push(m);
    return out;
  };
  const say = (...kids) => { status.hidden = false; status.textContent = ''; status.append(...kids); };

  async function makeGoogle(e) {
    const b = e.currentTarget; b.disabled = true;
    const ms = months(), mk = makerOf(store.get());
    const empty = ms.filter(m => !M.staffInMonth(store.get(), m).length);
    if (empty.length) { app.toast(`No one on People in ${empty.map(M.fmtMonth).join(', ')}: add or import people first.`, { kind: 'warn', ms: 7000 }); b.disabled = false; return; }
    try {
      let folderId = '';
      try { folderId = localStorage.getItem(FOLDER_KEY) || ''; } catch (err) { /* private mode */ }
      say(`Making the folder "${FOLDER_NAME}"…`);
      const folder = await G.ensureFolder(folderId, FOLDER_NAME);
      try { localStorage.setItem(FOLDER_KEY, folder.id); } catch (err) { /* ignore */ }
      await G.shareFolder(folder.id, { editors: mk.editors, anyone: mk.anyone });
      const me = await G.whoAmI();
      const done = [];
      for (const [i, m] of ms.entries()) {
        say(`Making ${M.fmtMonth(m)} (${i + 1} of ${ms.length})…`);
        const f = monthFiles(store.get(), m, { open: openIn.checked, me });
        const made = await G.createSpreadsheet(f.body);
        await G.moveToFolder(made.id, folder.id);
        done.push(m);
        store.commit(`Made the ${M.fmtMonth(m)} sheet`, d => {
          const cur = makerOf(d);
          d.settings.sheetMaker = { ...cur, made: { ...cur.made, [m]: { id: made.id, url: made.url, title: fileTitle(m), block: f.block, open: openIn.checked, at: new Date().toISOString(), people: f.spec.people.length } } };
        });
      }
      say(`Made ${done.length} ${done.length === 1 ? 'sheet' : 'sheets'} in `, h('a', { href: folder.url, target: '_blank', rel: 'noopener' }, 'the app\'s Drive folder'), '. Open each from the list below.');
    } catch (err) { console.error(err); app.toast(cloud.friendly(err), { kind: 'error', ms: 9000 }); status.hidden = true; }
    b.disabled = false;
  }

  async function makeExcel(e) {
    const b = e.currentTarget; b.disabled = true;
    try {
      const ExcelJS = await io.loadExcelJS();
      for (const m of months()) {
        const f = monthFiles(store.get(), m);
        const buf = await toWorkbook(f.model, ExcelJS, 'Request', f.tabs).xlsx.writeBuffer();
        io.download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `roster-${io.fileStamp(m)}.xlsx`);
      }
    } catch (err) { app.toast(err.message || 'Could not make the file.', { kind: 'error' }); }
    b.disabled = false;
  }

  async function setOpen(m, open, button) {
    button.disabled = true;
    const rec = makerOf(store.get()).made[m];
    try {
      await G.setRequestsOpen(rec.id, open ? rec.block : null);
      store.commit(`${open ? 'Opened' : 'Locked'} ${M.fmtMonth(m)} for requests`, d => { const cur = makerOf(d); d.settings.sheetMaker = { ...cur, made: { ...cur.made, [m]: { ...cur.made[m], open } } }; });
      app.toast(`${M.fmtMonth(m)}: ${open ? 'open for requests' : 'locked; only the rosterers can edit the Request tab'}.`);
    } catch (err) { console.error(err); app.toast(cloud.friendly(err), { kind: 'error', ms: 9000 }); }
    button.disabled = false;
  }

  function paint() {
    const state = store.get(), mk = makerOf(state), ms = months();
    const spec = specFromState(state, ms[0], { seniors: true });
    const nSen = spec.people.length - M.staffInMonth(state, ms[0]).length;
    info.textContent = '';
    info.append(
      h('li', null, `${ms.length === 1 ? M.fmtMonth(ms[0]) : `${ms.length} months, ${M.fmtMonth(ms[0])} to ${M.fmtMonth(ms[ms.length - 1])}`}: ${spec.people.length} people in ${M.fmtMonth(ms[0])}, from People and their dates.`),
      h('li', nSen ? null : { class: 'warn' }, nSen ? `${nSen} seniors' rows (HOD, SC, consultants) as in the ${M.fmtMonth(spec.seniorsFrom)} sheet.` : 'No seniors\' rows: import the latest month\'s sheet once (above) and the HOD, SC and consultant rows come with it.'),
      mk.editors.length ? null : h('li', { class: 'warn' }, 'No rosterers yet: the locked tabs will be editable by you (and the file\'s owner) only.'));
    list.textContent = '';
    const made = Object.entries(mk.made).sort(([a], [b]) => a.localeCompare(b));
    if (!made.length) return;
    list.append(h('p', { class: 'bx-label', id: 'sm-made' }, 'Made sheets'), h('ul', { class: 'ri-list', 'aria-labelledby': 'sm-made' }, made.map(([m, r]) => {
      const b = btn(r.open ? `Lock ${M.fmtMonth(m)} requests` : `Open ${M.fmtMonth(m)} for requests`, () => setOpen(m, !r.open, b));
      return h('li', { class: 'ri-row' }, h('span', null, h('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.title || fileTitle(m)), h('span', { class: 'muted' }, ` · ${r.open ? 'open for requests' : 'locked'} · made ${M.fmtDay(r.at.slice(0, 10))}`)), cloud.enabled ? b : null);
    })));
  }
  fromSel.addEventListener('change', () => { if (toSel.value < fromSel.value) toSel.value = fromSel.value; paint(); });
  toSel.addEventListener('change', paint);

  const sec = section('more-sheet-gen', 'Make blank month sheets', null,
    h('p', { class: 'more-p' }, 'The department\'s whole sheet for each month: the Request tab (names, grades, the day cells, the totals, the counts and the manpower rows), the Junior Call Roster, the WR / Premed Roster and the Leave Waitlist, all with their formulas. People come from People with their dates, with weekends and public holidays marked. Nothing in a live sheet is touched: each month is a new file.'),
    h('div', { class: 'more-row' }, h('label', { class: 'bx-field' }, h('span', null, 'From'), fromSel), h('label', { class: 'bx-field' }, h('span', null, 'To'), toSel)),
    info,
    ...(cloud.enabled ? [
      h('label', { class: 'bx-field' }, h('span', null, 'Rosterers (they can edit the locked tabs; Google sends them no email)'), editorsIn),
      h('label', { class: 'bx-field' }, h('span', null, 'Daily rosterers, as the Leave Waitlist names them'), dailyIn),
      h('label', { class: 'ri-row' }, anyoneIn, h('span', null, 'Anyone with the link can open and type in the sheets (the juniors\' requests and the Leave Waitlist)')),
      h('label', { class: 'ri-row' }, openIn, h('span', null, 'Open for requests now (the juniors\' rows of the Request tab)')),
    ] : []),
    h('div', { class: 'more-row' },
      cloud.enabled ? btn('Make the Google Sheets', makeGoogle, 'btn btn-primary') : null,
      btn('Download as an Excel file', makeExcel)),
    status, list);
  paint();
  return {
    sec,
    update(state) {
      const mk = makerOf(state);
      if (document.activeElement !== editorsIn) editorsIn.value = mk.editors.join('\n');
      if (document.activeElement !== dailyIn) dailyIn.value = mk.daily;
      anyoneIn.checked = mk.anyone;
      paint();
    },
  };
}
