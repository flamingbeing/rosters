// NTF Roster: Check > APS weeks and Check > Leave dates (the junior pool). APS: who takes each Monday-to-Sunday pain
// service week, from a running count; the person confirms or changes. Leave dates: other dates for unapproved leave
// that would put too many of the call list away at once.

import * as M from './model.js';
import { suggestMonth, tally, lastBefore, setWeek, weekHolder, historyFromParsed, leaveAlternatives, moveLeave } from './aps.js';
import * as io from './io.js';

const dayRange = (a, b) => `${M.fmtDay(a)} to ${M.fmtDay(b)}`;

export function renderAps(app, panel, st) {
  const { h } = app;
  const undoAct = { label: 'Undo', fn: () => app.store.undo() };
  const name = id => { const p = (st.staff || []).find(x => x.id === id); return p ? p.name : id; };
  const plan = suggestMonth(st, app.month);
  const picks = new Map();

  panel.append(h('p', { class: 'bx-sub' }, `A pain service week runs Monday to Sunday, one person, and that person takes no calls or PM shifts that week. The suggestion goes to whoever has done the fewest weeks (a JR first when manpower is good; never an R3, nobody two months running). Choose, then Auto-fill the calls around them.`));
  if (!plan.length) panel.append(h('p', { class: 'bx-none' }, 'No weeks start in this month.'));
  const list = h('div', { class: 'aps-weeks' });
  for (const w of plan) {
    const last = w.days[6];
    const title = `${M.fmtDay(w.monday)} to ${M.fmtDay(last)}`;
    let right;
    if (w.holder) {
      right = h('div', { class: 'aps-held' }, h('strong', null, name(w.holder)),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { app.store.commit(`Clear the APS week of ${M.fmtDay(w.monday)}`, d => setWeek(d, w.monday, '')); app.toast('Week cleared', { action: undoAct }); } }, 'Clear'));
    } else {
      const sel = h('select', { 'aria-label': `APS week of ${M.fmtDay(w.monday)}`, onchange: () => { picks.set(w.monday, sel.value); note.textContent = noteFor(sel.value); } },
        h('option', { value: '' }, 'Nobody yet'),
        h('optgroup', { label: 'Suggested' }, ...w.options.filter(o => o.ok).slice(0, 8).map(o => h('option', { value: o.id, selected: o.id === w.pick }, `${name(o.id)} (${o.tally})`))),
        h('optgroup', { label: 'Not suggested' }, ...w.options.filter(o => !o.ok && !/call pool|junior pool/.test(o.why[0])).slice(0, 20).map(o => h('option', { value: o.id }, `${name(o.id)}: ${o.why.join(', ')}`))));
      const noteFor = id => { const o = w.options.find(x => x.id === id); return o ? o.notes.join(' · ') + (o.ok ? '' : ` · ${o.why.join(', ')}`) : ''; };
      const note = h('span', { class: 'bx-help' }, noteFor(w.pick));
      picks.set(w.monday, w.pick);
      right = h('div', { class: 'aps-pick' }, sel, note);
    }
    list.append(h('div', { class: 'aps-week' }, h('div', { class: 'aps-when' }, title), right));
  }
  panel.append(list);
  const open = plan.filter(w => !w.holder);
  if (open.length) {
    panel.append(h('div', { class: 'more-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
      const chosen = [...picks.entries()].filter(([, id]) => id);
      if (!chosen.length) { app.toast('Choose someone for at least one week', { kind: 'error' }); return; }
      app.store.commit('Assign APS weeks', d => { for (const [monday, id] of chosen) setWeek(d, monday, id); });
      app.toast(`${chosen.length} APS week${chosen.length === 1 ? '' : 's'} assigned`, { action: undoAct });
    } }, 'Assign these weeks')));
  }

  // the running count
  const t = tally(st, app.month);
  const aps = st.aps || {};
  const people = M.staffInView(st, app.month).filter(p => M.poolOf(st, p) === 'junior' && !['nurse', 'locum'].includes(p.group));
  panel.append(h('h3', { class: 'more-sub' }, 'Weeks done so far'),
    h('p', { class: 'bx-help' }, `Counts before ${M.fmtMonth(app.month)}: the number typed here (up to ${aps.through ? M.fmtMonth(aps.through) : 'the start'}) plus the APS weeks in the roster after that. Change a number to correct it.`));
  const rows = h('div', { class: 'jp-rows' });
  for (const p of people) {
    const inp = h('input', { type: 'number', min: '0', max: '60', value: String((aps.base || {})[p.id] || 0), 'aria-label': `Weeks before the roster: ${p.name}`, class: 'aps-n',
      onchange: () => app.store.commit(`APS count: ${p.name}`, d => { d.aps = d.aps || { base: {}, last: {}, through: '' }; d.aps.base = d.aps.base || {}; d.aps.base[p.id] = Math.max(0, Math.round(Number(inp.value) || 0)); }) });
    const last = lastBefore(st, p.id, app.month);
    rows.append(h('div', { class: 'jp-row' },
      h('div', { class: 'jp-name' }, h('strong', null, p.name), h('span', { class: 'bx-help' }, `${t.get(p.id) || 0} in total${last ? `, last in ${M.fmtMonth(last)}` : ''}`)),
      h('label', { class: 'bx-help' }, 'Typed count ', inp)));
  }
  panel.append(rows);
  panel.append(h('div', { class: 'more-row' }, fileButtons(app, st)));
}

function fileButtons(app, st) {
  const { h } = app;
  const inp = h('input', { type: 'file', multiple: true, accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hidden: true });
  inp.addEventListener('change', async () => {
    const files = [...(inp.files || [])];
    inp.value = '';
    if (!files.length) return;
    try {
      await io.loadExcelJS();
      const list = [];
      for (const f of files) list.push(await io.parseDeptWorkbook(await f.arrayBuffer(), app.store.get()));
      const hist = historyFromParsed(list);
      if (!hist.through) { app.toast('No month sheet found in those files.', { kind: 'error' }); return; }
      if (!(await app.confirm(`Found ${hist.weeks} APS weeks for ${Object.keys(hist.base).length} people up to ${M.fmtMonth(hist.through)} (green cells). Replace the typed counts with these?`, { ok: 'Use them' }))) return;
      app.store.commit('APS weeks from old rosters', d => { d.aps = { base: hist.base, last: hist.last, through: hist.through }; });
      app.toast(`Counts set from ${files.length} roster${files.length === 1 ? '' : 's'}`, { action: { label: 'Undo', fn: () => app.store.undo() } });
    } catch (e) { console.error(e); app.toast(e.message || 'Could not read those files', { kind: 'error', ms: 8000 }); }
  });
  return h('span', null, h('button', { type: 'button', class: 'btn', onclick: () => inp.click(), html: `${app.icon('upload')}<span>Read old rosters…</span>` }), inp);
}

export function renderLeave(app, panel, st) {
  const { h } = app;
  const undoAct = { label: 'Undo', fn: () => app.store.undo() };
  const items = leaveAlternatives(st, app.month);
  const name = id => { const p = (st.staff || []).find(x => x.id === id); return p ? p.name : id; };
  panel.append(h('p', { class: 'bx-sub' }, 'Leave that is not approved yet (white in the sheet) and would put more than 3 of the call list away on one day. Other dates of the same length that have room are shown, for the person to choose. Approved (blue) leave is never moved.'));
  if (!items.length) { panel.append(h('p', { class: 'ok-box', html: `${app.icon('ok')}<span>No unapproved leave clashes this month.</span>` })); return; }
  for (const it of items) {
    panel.append(h('div', { class: 'card aps-leave' },
      h('p', null, h('strong', null, name(it.staffId)), `: leave ${it.from === it.to ? M.fmtDay(it.from) : dayRange(it.from, it.to)} is too many away on ${it.clashes.map(M.fmtDay).join(', ')}.`),
      it.options.length ? h('div', { class: 'aps-opts' }, h('span', { class: 'bx-help' }, 'Other dates that work:'),
        ...it.options.map(o => h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
          app.store.commit(`Move leave: ${name(it.staffId)}`, d => moveLeave(d, it.staffId, it.from, it.to, o.from));
          app.toast(`Moved to ${o.from === o.to ? M.fmtDay(o.from) : dayRange(o.from, o.to)}`, { action: undoAct });
        } }, o.from === o.to ? M.fmtDay(o.from) : dayRange(o.from, o.to)))) : h('p', { class: 'bx-help' }, 'No nearby dates with room.')));
  }
}
