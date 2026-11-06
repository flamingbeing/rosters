// NUH Junior Monthly: the More screen's "Start a month from the master rotations" section and its review. The master is
// read from Google (the link) or a downloaded .xlsx; the review lists every change for the chosen month, ticked, and only
// the ticked ones are applied (one Undo puts it all back). Then "Make this month's sheet from scratch" builds the sheet.
import * as M from './model.js';
import * as io from './io.js';
import * as G from './gsheets.js';
import * as cloud from './cloud.js';
import { parseMaster, planMaster, applyMaster, chooseTab, sheetName } from './master.js';

const LINK_KEY = 'nuhjm-master-link';

export function masterSection(app, { section, btn, fileButton, monthOptions }) {
  const { h } = app;
  const store = app.store;
  const lastLink = () => { try { return localStorage.getItem(LINK_KEY) || ''; } catch (e) { return ''; } };
  const linkIn = h('input', { type: 'url', class: 'sheet-link', 'aria-label': 'Master rotations sheet link', placeholder: 'Paste the master rotations sheet link', value: lastLink() });
  return section('more-master', 'Start a month from the master rotations',
    'Reads the year\'s block tab of the master rotations sheet ("26-27 Block") and shows what it would change for a month: new people with their first and last day, people who move grade, dates, and each week\'s posting. Nothing changes until you apply the ticked ones. It can be read again whenever the master changes.',
    ...(cloud.enabled ? [h('div', { class: 'more-row' }, linkIn, btn('Read from Google', onGoogle, 'btn btn-primary'))] : []),
    h('div', { class: 'more-row' }, fileButton(cloud.enabled ? 'Or a downloaded .xlsx' : 'Read a downloaded .xlsx', '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', onFile)));

  async function onGoogle() {
    const p = G.parseSheetUrl(linkIn.value);
    if (!p) { app.toast('That does not look like a Google Sheet link. Copy it from the address bar of the open sheet.', { kind: 'warn', ms: 6000 }); return; }
    try { localStorage.setItem(LINK_KEY, linkIn.value.trim()); } catch (e) { /* ignore */ }
    try {
      const info = await G.getTabs(p.id);
      const title = chooseTab(info.tabs.map(t => t.title), app.month);
      const tab = info.tabs.find(t => t.title === title);
      if (!tab) throw new Error(`No block tab for ${M.fmtMonth(app.month)} in this sheet (a tab like "26-27 Block").`);
      review(await G.readGrid(p.id, tab), tab.title);
    } catch (e) { console.error(e); app.toast(cloud.friendly(e), { kind: 'error', ms: 9000 }); }
  }

  async function onFile(file) {
    try {
      await io.loadExcelJS();
      const wb = new window.ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const names = wb.worksheets.map(w => w.name);
      const title = chooseTab(names, app.month);
      if (!title) throw new Error(`No block tab for ${M.fmtMonth(app.month)} in this file (a tab like "26-27 Block").`);
      review(rowsOf(wb.getWorksheet(title)), title);
    } catch (e) { console.error(e); app.toast(`Could not read this file: ${e.message || e}`, { kind: 'error', ms: 9000 }); }
  }

  function review(rows, tab) {
    let master;
    try { master = parseMaster(rows, tab); } catch (e) { app.toast(e.message, { kind: 'error', ms: 9000 }); return; }
    const inYear = m => m >= master.weeks[0].from.slice(0, 7) && m <= master.weeks[master.weeks.length - 1].from.slice(0, 7);
    const sel = h('select', { 'aria-label': 'Month' }, monthOptions(app.month).filter(o => inYear(o.value)));
    const body = h('div', { class: 'bx-form' });
    const off = new Set(), on = new Set(), as = new Map();
    let plan;
    const paint = () => {
      body.innerHTML = '';
      const state = store.get(), month = sel.value;
      plan = planMaster(state, master, month);
      const byId = new Map((state.staff || []).map(p => [p.id, p]));
      const gname = g => ((state.groups || []).find(x => x.id === g) || {}).name || g;
      const tick = (key, dflt, label) => {
        const isOn = dflt ? !off.has(key) : on.has(key);
        const cb = h('input', { type: 'checkbox', checked: isOn, onchange: () => { const s = dflt ? off : on; if (cb.checked === dflt) s.delete(key); else s.add(key); } });
        return h('li', null, h('label', { class: 'ri-row' }, cb, h('span', null, ...label)));
      };
      const block = (id, title, note, items) => (items.length ? h('div', { class: 'bx-field' },
        h('p', { class: 'bx-label', id }, `${title} (${items.length})`), note ? h('p', { class: 'more-p' }, note) : null,
        h('ul', { class: 'ri-list', 'aria-labelledby': id }, items)) : null);
      const range = e => (e.start || e.end ? ` · ${e.start ? `from ${M.fmtDay(e.start)}` : ''}${e.start && e.end ? ' ' : ''}${e.end ? `until ${M.fmtDay(e.end)} ${e.end.slice(0, 4)}` : ''}` : '');
      // a new or close name: who it is on People (the guess, someone else, new, or left out)
      const who = e => {
        const people = [...(state.staff || [])].sort((a, b) => a.name.localeCompare(b.name));
        const cur = off.has('e:' + e.key) ? 'skip' : as.get(e.key) || (e.match ? e.match.id : 'new');
        const s = h('select', { 'aria-label': `Who is ${e.name}`, onchange: () => {
          off.delete('e:' + e.key); as.delete(e.key);
          if (s.value === 'skip') off.add('e:' + e.key); else as.set(e.key, s.value);
        } },
        h('option', { value: 'new', selected: cur === 'new' }, `New person: ${sheetName(e.name, e.group)}`),
        h('option', { value: 'skip', selected: cur === 'skip' }, 'Leave out'),
        ...people.map(p => h('option', { value: p.id, selected: cur === p.id }, `Same as ${p.name}`)));
        return h('li', { class: 'ri-row' }, h('span', null, h('strong', null, e.name), ` · ${e.label}${e.kiv ? ' (KIV)' : ''}${range(e)}`), s);
      };
      const nOn = plan.entries.length - plan.add.length;
      body.append(...[
        h('label', { class: 'bx-field' }, h('span', null, 'Month'), sel),
        h('ul', { class: 'more-list' },
          h('li', null, `Tab "${tab}": ${plan.entries.length} people in ${M.fmtMonth(month)}, ${nOn} already on People, ${plan.add.length} new`),
          plan.floats ? h('li', null, `Obstetric float weeks (OGNF, OGDF) are not set from the master: the OGN and OGD days are typed or filled as before (${plan.floats} days).`) : null,
          plan.unknown.size ? h('li', { class: 'warn' }, `Codes read as the general list (no posting): ${[...plan.unknown.keys()].join(', ')}`) : null,
          ...plan.duplicates.map(d => h('li', { class: 'warn' }, `${d.name} is in the master twice (rows ${d.rows.join(' and ')}): row ${d.rows[0]} is used.`)),),
        block('mr-add', 'New people', 'Added to People with these dates. Pick "Same as" if it is someone already there under another name.', plan.add.map(who)),
        block('mr-close', 'Matched by a close name', 'Check each guess; pick another person or "New person" if it is wrong. The master\'s name is remembered for next time.', plan.close.map(who)),
        block('mr-moves', 'Grade changes', 'From the master\'s sections. An AC stays an AC.', plan.moves.map(mv => tick(mv.key, true, [h('strong', null, mv.name), ` ${mv.from} → ${mv.to}`]))),
        block('mr-dates', 'First and last days', 'From the first and last weeks the master gives them. Outside those days they are not on the month.', plan.dates.map(d => tick(d.key, true, [h('strong', null, d.name),
          ...('start' in d ? [` from ${d.start ? M.fmtDay(d.start) : '(the start)'}`] : []), ...('end' in d ? [` until ${d.end ? `${M.fmtDay(d.end)} ${d.end.slice(0, 4)}` : '(no end)'}`] : []),
          h('span', { class: 'muted' }, ` (was ${d.was.start ? M.fmtDay(d.was.start) : '…'} to ${d.was.end ? M.fmtDay(d.was.end) : '…'})`)]))),
        block('mr-promote', 'Promote to AC?', 'The master does not say who becomes an AC at the change-over. Tick those who do.', plan.promote.map(pr => tick(pr.key, false, [h('strong', null, pr.name), ' SR2 → AC']))),
        block('mr-gone', 'On People but not in the master', 'Tick anyone who has left: their last day becomes the day before this month.', plan.gone.map(g => tick(g.key, false, [h('strong', null, g.name), ` · ${gname((byId.get(g.id) || {}).group)}`]))),
        h('p', { class: 'muted' }, `Each person's postings in ${M.fmtMonth(month)} become the master's (Z where the master has no week for them); calls, leave and requests stay, and locked cells are left alone. Undo puts it all back.`)].filter(Boolean));
    };
    sel.addEventListener('change', () => { off.clear(); on.clear(); as.clear(); paint(); });
    paint();
    app.sheet({
      title: 'From the master rotations', wide: true, body, actions: [{ label: 'Cancel' }, {
        label: 'Apply', primary: true, fn: () => {
          const month = plan.month;
          let res;
          if (M.isMonthLocked(store.get(), month)) store.commit(`Unlock ${M.fmtMonth(month)} for the master`, draft => { M.setMonthLocked(draft, month, false); });
          store.commit(`${M.fmtMonth(month)} from the master rotations`, draft => { res = applyMaster(draft, plan, { off, on, as }); });
          app.setMonth(month);
          const parts = [`${res.people} people`, res.added && `${res.added} new`, res.moved && `${res.moved} moved grade`, res.promoted && `${res.promoted} promoted`, res.dated && `${res.dated} dates`, res.ended && `${res.ended} ended`, `${res.cells} cells`].filter(Boolean);
          app.toast(`${M.fmtMonth(month)} from the master: ${parts.join(', ')}. Next: "Make this month's sheet from scratch" below.`, { action: { label: 'Undo', fn: () => store.undo() }, ms: 10000 });
        },
      }],
    });
  }
}

// An ExcelJS worksheet as rows of cell text.
function rowsOf(ws) {
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    const out = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      const v = cell.value;
      out[c - 1] = v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' ? (v.richText ? v.richText.map(x => x.text).join('') : v.result != null ? String(v.result) : v.text || '') : String(v);
    });
    rows[r - 1] = out;
  });
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}
