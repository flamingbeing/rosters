// NTF Roster: People > Junior pool. Who is in the junior pool (from a chosen person down), their call level
// (MO2 / MO1 / no calls) and whether they are strong or weak. Setting the first level also adds the junior rules.

import * as M from './model.js';
import { openRequest } from './ui-requests.js';
import { levelOf, strengthOf, tagsFor, LEVELS, STRENGTHS, installJuniorPool, poolProblems, CALL_TAGS } from './jpool.js';

export function renderPool(app, body) {
  const { h } = app;
  const undoAct = { label: 'Undo', fn: () => app.store.undo() };
  const state = app.store.get();
  const people = M.staffInMonth(state, app.month);
  const inPool = people.filter(p => M.poolOf(state, p) === 'junior');
  const gmap = M.groupMap(state);

  body.append(h('p', { class: 'bx-sub' }, 'The junior pool is rostered here: set where it starts, then each person\'s call level (MO2 is the senior MO on call, MO1 the junior MO on call) and whether they are strong or weak. A weak MO2 is never on call with a weak MO1; two strong ones are avoided.'));

  // where the pool starts
  const startSel = h('select', { id: 'jp-start', 'aria-label': 'The junior pool starts at' },
    h('option', { value: '' }, 'Choose a person…'),
    ...people.map(p => h('option', { value: p.id }, p.name)));
  body.append(h('div', { class: 'bx-field' },
    h('label', { for: 'jp-start' }, 'The junior pool starts at (this person and everyone below)'),
    h('div', { class: 'pv-bar' }, startSel,
      h('button', { type: 'button', class: 'btn', onclick: () => {
        const id = startSel.value;
        if (!id) { app.toast('Choose the first person of the pool', { kind: 'error' }); return; }
        const at = people.findIndex(p => p.id === id);
        app.store.commit('Set where the junior pool starts', d => {
          const ids = new Map(people.map((p, i) => [p.id, i]));
          for (const p of d.staff) {
            const i = ids.get(p.id);
            if (i === undefined || p.pool) continue;   // people moved by hand stay where they were put
            const g = gmap.get(p.group);
            p.tags = (p.tags || []).filter(t => t !== 'jpool' && t !== 'spool');
            p.tags.push(i >= at && !(g && g.kind === 'senior') ? 'jpool' : 'spool');
          }
        });
        const n = app.store.get().staff.filter(p => people.some(x => x.id === p.id) && M.poolOf(app.store.get(), p) === 'junior').length;
        app.toast(`${n} people are in the junior pool`, { action: undoAct });
      } }, 'Set'))));

  const moved = people.filter(p => p.pool);
  if (moved.length) body.append(h('p', { class: 'bx-help' }, 'Moved by hand (kept when you set the start or import again; change it in the person\'s details): ',
    moved.map(p => `${p.name} (${p.pool})`).join(', '), '.'));

  const mine = inPool.filter(p => true);
  if (!mine.length) {
    body.append(h('p', { class: 'bx-none' }, 'Nobody is in the junior pool yet. Import the sheet first, then choose where the pool starts.'));
    return;
  }

  const rows = h('div', { class: 'jp-rows' });
  for (const p of mine) {
    const g = gmap.get(p.group);
    const lvl = h('select', { 'aria-label': `Call level: ${p.name}`, onchange: () => save(p, lvl.value, str.value) },
      ...LEVELS.map(([v, l]) => h('option', { value: v, selected: v === levelOf(p) }, l)));
    const str = h('select', { 'aria-label': `Strong or weak: ${p.name}`, onchange: () => save(p, lvl.value, str.value) },
      ...STRENGTHS.map(([v, l]) => h('option', { value: v, selected: v === strengthOf(p) }, l)));
    str.disabled = !['mo2', 'mo1'].includes(levelOf(p));
    rows.append(h('div', { class: 'jp-row' },
      h('div', { class: 'jp-name' }, h('strong', null, p.name), h('span', { class: 'bx-help' }, g ? g.name : '')),
      lvl, str,
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm jp-req', onclick: () => openRequest(app, p.id) }, 'Request…')));
  }
  body.append(rows);

  const problems = poolProblems(state, mine);
  body.append(h('div', { class: 'card jp-status' },
    problems.length ? h('ul', null, ...problems.map(t => h('li', null, t))) : h('p', null, 'The call list is set. Rules for the junior pool are on the Rules screen.'),
    state.settings && state.settings.jpRules ? null : h('p', { class: 'bx-help' }, 'The junior rules are added when you set the first call level.')));

  function save(p, level, strength) {
    app.store.commit(`Set call level: ${p.name}`, d => {
      const x = d.staff.find(s => s.id === p.id);
      if (!x) return false;
      x.tags = tagsFor(x.tags, level, strength);
      if (level && !d.settings.jpRules) installJuniorPool(d);
    });
  }
}

export { CALL_TAGS };
