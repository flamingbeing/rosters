// NTF Roster: the quick request form. A one-off request for one person ("no calls 10 to 15 Nov", "wants a call on the
// 20th") becomes a rule for those dates only, so the rule builder is not needed for it. Rules it makes are named
// "Request: …" and can be edited or deleted on the Rules screen like any other.

import * as M from './model.js';

const KINDS = [
  ['nocall', 'No calls', ['C', 'HC']],
  ['nopm', 'No PM shifts', ['P']],
  ['away', 'No calls, half calls or PM shifts', ['C', 'HC', 'P']],
  ['wantcall', 'Wants a call', ['C']],
];

export function ruleForRequest({ staffId, name, kind, from, to, hard, note, pool }) {
  const k = KINDS.find(x => x[0] === kind) || KINDS[0];
  const want = kind === 'wantcall';
  const range = from === to ? M.fmtDay(from) : `${M.fmtDay(from)} to ${M.fmtDay(to)}`;
  return {
    id: M.uid('r-req'), type: 'limit',
    name: `Request: ${name}, ${k[1].toLowerCase()}, ${range}`,
    enabled: true, hard: want ? false : !!hard, weight: want ? 40 : (hard ? 10 : 60),
    who: { groups: [], tags: [], staff: [staffId], exclude: [] },
    when: { from, to, days: [], holidays: 'any' },
    params: want
      ? { codes: ['C'], period: 'month', window: 7, min: 1, max: null, fte: false, prorate: false }
      : { codes: [...k[2]], period: 'month', window: 7, min: null, max: 0, fte: false, prorate: false },
    note: String(note || ''),
    pool: pool === 'senior' ? 'senior' : 'junior',   // the person's roster
  };
}

export function openRequest(app, staffId) {
  const { h } = app;
  const st = app.store.get();
  const people = M.staffInView(st, app.month);
  const days = M.monthDays(app.month);
  const sid = (people.find(p => p.id === staffId) || people[0] || {}).id || '';
  const who = h('select', { id: 'rq-who', 'aria-label': 'Person' }, ...people.map(p => h('option', { value: p.id, selected: p.id === sid }, p.name)));
  const kind = h('select', { id: 'rq-kind', 'aria-label': 'Request' }, ...KINDS.map(([v, l]) => h('option', { value: v }, l)));
  const from = h('input', { type: 'date', id: 'rq-from', value: days[0], 'aria-label': 'From' });
  const to = h('input', { type: 'date', id: 'rq-to', value: days[0], 'aria-label': 'To' });
  const strict = h('select', { id: 'rq-hard', 'aria-label': 'How firm' },
    h('option', { value: '1' }, 'Must hold (family emergency, religious day…)'),
    h('option', { value: '0' }, 'Try my best (a preference)'));
  const note = h('input', { type: 'text', id: 'rq-note', placeholder: 'Why (optional)', 'aria-label': 'Note' });
  const field = (label, id, el) => h('div', { class: 'bx-field' }, h('label', { for: id }, label), el);
  const body = h('div', null,
    h('p', { class: 'more-p' }, 'A request for one person on certain dates. It is added as a rule for those dates only; Auto-fill and Check both follow it.'),
    field('Person', 'rq-who', who), field('Request', 'rq-kind', kind),
    h('div', { class: 'jp-row' }, field('From', 'rq-from', from), field('To', 'rq-to', to), h('span')),
    field('How firm', 'rq-hard', strict), field('Note', 'rq-note', note));
  app.sheet({
    title: 'Add a request',
    body,
    actions: [{ label: 'Cancel' }, { label: 'Add request', primary: true, fn: () => {
      const a = from.value, b = to.value || from.value;
      if (!who.value || !a) { app.toast('Choose a person and a date', { kind: 'error' }); return false; }
      if (b < a) { app.toast('The last date is before the first', { kind: 'error' }); return false; }
      const p = people.find(x => x.id === who.value);
      const rule = ruleForRequest({ staffId: who.value, name: p ? (p.short || p.name) : '', kind: kind.value, from: a, to: b, hard: strict.value === '1', note: note.value, pool: p ? M.poolOf(st, p) : 'junior' });
      app.store.commit('Add a request', d => {
        d.rules.push(rule);
        (d.rulesLog = d.rulesLog || []).push({ at: new Date().toISOString(), by: '', action: 'add', ruleId: rule.id, name: rule.name });
      });
      app.toast('Request added', { action: { label: 'Undo', fn: () => app.store.undo() } });
    } }],
  });
}
