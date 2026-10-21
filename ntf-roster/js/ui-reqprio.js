// NTF Roster: request priority. One sheet shows every call request (Cr) and no-call request (Nc) in the month, person by
// person, coloured by how much each counts (reqprio.js), and lets the rosterer mark many at once: "!" must, "?" if
// possible, or back to automatic. The cell editor shows the same for one cell (priorityRow).
import * as M from './model.js';
import * as P from './reqprio.js';

// Set or clear one request's mark in a draft. mark: '!', '?' or '' (automatic).
export function setMark(draft, d, sid, code, mark) {
  const cell = M.getCell(draft, d, sid);
  if (!cell || !(cell.r || []).includes(code)) return;
  const rp = { ...(cell.rp || {}) };
  if (mark) rp[code] = mark; else delete rp[code];
  M.setCell(draft, d, sid, { rp });
}

const ord = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
const pct = f => `${Math.round(f * 100)}%`;

// What one request's level means, in a few words.
export function levelText(p, cap) {
  if (!p) return '';
  if (p.level === 'must') return 'Must (marked !)';
  if (p.mark === '?') return `If possible (marked ?), counts ${pct(p.factor)}`;
  if (p.level === 'normal') return `Counts in full (${ord(p.rank + 1)} of ${p.count} this month)`;
  return `If possible: ${ord(p.rank + 1)} of ${p.count}, over the ${cap} that count in full; counts ${pct(p.factor)}`;
}

function priorities(state, m, ids = null) {
  return P.monthPriorities(M.monthDays(m), d => (state.cells || {})[d], P.capOf(state), ids);
}

// The cell editor's line for one cell: for each Cr or Nc in it, Must / Auto / If possible.
export function priorityRow(app, d, sid) {
  const { h } = app;
  const state = app.store.get();
  const cell = M.getCell(state, d, sid);
  const codes = ((cell && cell.r) || []).filter(P.isFair);
  if (!codes.length) return null;
  const pr = priorities(state, M.monthOf(d), new Set([sid]));
  const cap = P.capOf(state);
  const who = (state.staff || []).find(x => x.id === sid);
  const name = who ? (who.short || who.name) : '';
  return h('div', { class: 'ced-sec rp-sec' },
    h('h3', { class: 'ced-h' }, 'Request priority'),
    codes.map(code => {
      const p = pr.get(`${d}|${sid}|${code}`);
      const mark = (cell.rp && cell.rp[code]) || '';
      const opt = (m, label) => h('button', {
        type: 'button', class: `btn btn-sm ${mark === m ? 'btn-primary' : 'btn-ghost'}`, 'aria-pressed': String(mark === m),
        onclick: () => app.store.commit(`${code} priority · ${name} ${M.fmtDay(d)}`, dr => setMark(dr, d, sid, code, m)),
      }, label);
      return h('div', { class: 'rp-line' },
        h('span', { class: 'rp-code' }, code),
        h('span', { class: 'rp-opts', role: 'group', 'aria-label': `${code} priority` }, opt('!', 'Must !'), opt('', 'Auto'), opt('?', 'If possible ?')),
        h('span', { class: 'rp-why muted' }, levelText(p, cap)));
    }),
    h('button', { type: 'button', class: 'linkish', onclick: () => openPriorities(app) }, 'See every request this month'));
}

// The sheet: every Cr and Nc of the month for the people in view, the limit, and bulk marking.
export function openPriorities(app) {
  const { h } = app;
  const body = h('div', { class: 'rp' });
  const selected = new Set();   // keys `${date}|${staffId}|${code}`
  let overOnly = false;

  const commitMarks = (mark) => {
    if (!selected.size) return;
    const list = [...selected].map(k => k.split('|'));
    app.store.commit(`${mark === '!' ? 'Must' : mark === '?' ? 'If possible' : 'Automatic'}: ${list.length} request${list.length === 1 ? '' : 's'}`,
      dr => { for (const [d, sid, code] of list) setMark(dr, d, sid, code, mark); });
    selected.clear();
    draw();
    app.toast(`${list.length} request${list.length === 1 ? '' : 's'} marked ${mark === '!' ? 'must' : mark === '?' ? 'if possible' : 'automatic'}.`, { action: { label: 'Undo', fn: () => app.store.undo() } });
  };

  function draw() {
    const state = app.store.get(), m = app.month, cap = P.capOf(state);
    const people = M.staffInView(state, m);
    const pr = priorities(state, m, new Set(people.map(p => p.id)));
    const by = new Map();
    for (const p of pr.values()) { if (!by.has(p.staffId)) by.set(p.staffId, []); by.get(p.staffId).push(p); }
    for (const k of [...selected]) if (!pr.has(k)) selected.delete(k);
    body.textContent = '';
    const capSel = h('select', { id: 'rp-cap', onchange: e => app.store.commit('Requests that count in full', dr => { dr.settings.requestCap = Number(e.target.value); }) },
      [0, 1, 2, 3, 4, 5, 6, 8, 10].map(n => h('option', { value: String(n), selected: n === cap }, String(n))));
    body.append(
      h('p', { class: 'team-p' }, 'Each person\'s first ', h('label', { for: 'rp-cap', class: 'sr-only' }, 'How many count in full'), capSel,
        ' call or no-call requests (Cr, Nc) in the month count in full, by date. Later ones are "if possible": they give way first, and the more someone asked for, the sooner. Mark one ! to make it count in full (a hard rule stays hard), or ? to let it give way.'),
      h('div', { class: 'rp-legend', 'aria-hidden': 'true' },
        h('span', { class: 'rp-chip lv-must' }, 'Must !'), h('span', { class: 'rp-chip lv-normal' }, 'Counts in full'), h('span', { class: 'rp-chip lv-low' }, 'If possible')));
    const rows = people.filter(p => by.has(p.id)).map(p => ({ p, list: by.get(p.id) }))
      .filter(x => !overOnly || x.list.length > cap)
      .sort((a, b) => b.list.length - a.list.length || a.p.name.localeCompare(b.p.name));
    body.append(h('div', { class: 'team-row' },
      h('label', { class: 'switch', for: 'rp-over' }, h('input', { type: 'checkbox', id: 'rp-over', checked: overOnly, onchange: e => { overOnly = e.target.checked; draw(); } }),
        h('span', { class: 'sw-track', 'aria-hidden': 'true' }), h('span', null, `Only people with more than ${cap}`))));
    if (!rows.length) { body.append(h('p', { class: 'team-p' }, `No call or no-call requests in ${M.fmtMonth(m)}${overOnly ? ' over the limit' : ''}.`)); }
    body.append(h('ul', { class: 'rp-list', 'aria-label': 'Requests by person' }, rows.map(({ p, list }) => {
      const keys = list.map(x => `${x.date}|${x.staffId}|${x.code}`);
      const all = keys.every(k => selected.has(k));
      return h('li', { class: 'rp-person' },
        h('div', { class: 'rp-who' }, h('strong', null, p.short || p.name), h('span', { class: `rp-n${list.length > cap ? ' over' : ''}` }, `${list.length} request${list.length === 1 ? '' : 's'}`),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { for (const k of keys) all ? selected.delete(k) : selected.add(k); draw(); } }, all ? 'Unselect' : 'Select all')),
        h('div', { class: 'rp-chips' }, list.map((x, i) => {
          const k = keys[i], on = selected.has(k);
          return h('button', {
            type: 'button', class: `rp-chip lv-${x.level}${on ? ' sel' : ''}`, 'aria-pressed': String(on),
            title: levelText(x, cap), 'aria-label': `${M.fmtDay(x.date)} ${x.code}${x.mark}: ${levelText(x, cap)}`,
            onclick: () => { on ? selected.delete(k) : selected.add(k); draw(); },
          }, `${M.fmtDay(x.date).replace(/ \w+$/, '')} ${x.code}${x.mark}`, x.level === 'low' ? h('small', null, pct(x.factor)) : null);
        })));
    })));
    body.append(h('div', { class: 'rp-bar', role: 'group', 'aria-label': 'Mark the selected requests' },
      h('span', { class: 'rp-count' }, selected.size ? `${selected.size} selected` : 'Tap requests to select'),
      h('button', { type: 'button', class: 'btn btn-sm btn-primary', disabled: !selected.size, onclick: () => commitMarks('!') }, 'Must !'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', disabled: !selected.size, onclick: () => commitMarks('') }, 'Auto'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', disabled: !selected.size, onclick: () => commitMarks('?') }, 'If possible ?')));
  }

  draw();
  const unsub = app.store.subscribe(() => draw());
  app.sheet({ title: `Request priority · ${M.fmtMonth(app.month)}`, body, wide: true, actions: [{ label: 'Close', primary: true }], onClose: () => unsub() });
}
