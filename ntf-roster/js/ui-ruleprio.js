// NTF Roster: rule priorities at a glance (Rules > Priorities). Every rule as one bar: preferences by priority (1 to
// 100, longest first), then must-hold rules full width, rules that are off greyed. Drag a rule by its grip to
// reorder it (or into Must hold and back), drag a bar to change one priority, or tick several and set them
// together (a priority, raise or lower, must hold or preference, on or off).
import { RULE_TYPES, describeRule } from './rules.js';
import { clampW, viewPool, POOL_NAME } from './ui-rules.js';

const softOnly = r => !!(RULE_TYPES[r.type] && RULE_TYPES[r.type].soft_only);
export const isHard = r => !!r.hard && !softOnly(r);

// Apply one bulk change to the rules with these ids in a draft. how: { weight } | { by } | { hard } | { enabled }.
// Returns how many rules changed. Rules that can only be preferences never become must hold.
export function bulkSet(draft, ids, how) {
  let n = 0;
  for (const r of draft.rules || []) {
    if (!ids.has(r.id)) continue;
    const before = JSON.stringify([r.hard, r.weight, r.enabled]);
    if (how.weight != null) r.weight = clampW(how.weight);   // a must-hold rule keeps it for when it becomes a preference
    if (how.by != null) { r.weight = Math.max(1, Math.min(100, clampW(r.weight) + how.by)); }
    if (how.hard != null && !(how.hard && softOnly(r))) r.hard = how.hard;
    if (how.enabled != null) r.enabled = how.enabled;
    if (JSON.stringify([r.hard, r.weight, r.enabled]) !== before) n++;
  }
  return n;
}

// Put a rule between two neighbours of the list (ids, or null at either end). In Must hold the order doesn't
// matter; in preferences it gets a priority between the two unless its own fits already (ties are broken by the
// order of the rules, so the rule also moves there). Returns false when it can't go there (a share-fairly rule).
export function placeRule(draft, id, { hard, aboveId = null, belowId = null }) {
  const rules = draft.rules || [];
  const r = rules.find(x => x.id === id);
  if (!r || (hard && softOnly(r))) return false;
  const before = JSON.stringify([r.hard, r.weight, rules.map(x => x.id)]);
  if (!hard) {
    const a = aboveId ? clampW((rules.find(x => x.id === aboveId) || {}).weight) : 101;
    const b = belowId ? clampW((rules.find(x => x.id === belowId) || {}).weight) : 0;
    const w = clampW(r.weight);
    // a priority that already fits between the neighbours stays as it is
    if (isHard(r) || w > a || w < b) r.weight = Math.max(1, Math.min(100, a - b >= 2 ? Math.round((a + b) / 2) : b));
  }
  r.hard = !!hard;
  rules.splice(rules.indexOf(r), 1);
  const bi = belowId ? rules.findIndex(x => x.id === belowId) : -1, ai = aboveId ? rules.findIndex(x => x.id === aboveId) : -1;
  if (bi >= 0) rules.splice(bi, 0, r); else if (ai >= 0) rules.splice(ai + 1, 0, r); else rules.push(r);
  return JSON.stringify([r.hard, r.weight, rules.map(x => x.id)]) !== before;
}

// the nearest ancestor that scrolls (the sheet), for scrolling while dragging near its edge
function scroller(el) {
  for (let x = el.parentElement; x; x = x.parentElement) if (/(auto|scroll)/.test(getComputedStyle(x).overflowY) && x.scrollHeight > x.clientHeight) return x;
  return document.scrollingElement;
}

// Saved selections (a named set of rule ids), kept on this device.
const SETS_KEY = 'ntf-roster-rq-sets';
export function loadSets() { try { const o = JSON.parse(localStorage.getItem(SETS_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } }
export function saveSets(o) { try { localStorage.setItem(SETS_KEY, JSON.stringify(o)); return true; } catch (e) { return false; } }

export function openRulePriorities(app) {
  const { h } = app;
  const body = h('div', { class: 'rq' });
  const selected = new Set();
  let showOff = true;

  const commit = (label, how) => {
    const ids = new Set(selected);
    let n = 0;
    app.store.commit(label, d => { n = bulkSet(d, ids, how); if (!n) return false; });
    app.toast(n ? `${label}: ${n} rule${n === 1 ? '' : 's'}` : 'Nothing to change', { action: n ? { label: 'Undo', fn: () => app.store.undo() } : undefined });
  };

  function row(r, state) {
    const hard = isHard(r), off = r.enabled === false, w = clampW(r.weight);
    const title = r.name || describeRule(r, state);
    const t = RULE_TYPES[r.type];
    const on = selected.has(r.id);
    const tick = h('input', { type: 'checkbox', checked: on, 'aria-label': `Select: ${title}`, onchange: () => { tick.checked ? selected.add(r.id) : selected.delete(r.id); draw(); } });
    let barEl;
    if (hard) {
      barEl = h('div', { class: 'rq-track' }, h('div', { class: 'rq-fill hard', style: 'width:100%' }, 'Must hold'));
    } else {
      const out = h('output', { class: 'rq-w' }, String(w));
      const range = h('input', {
        type: 'range', min: '1', max: '100', step: '1', value: String(w), class: 'rq-range', style: `--w:${w}%`, 'aria-label': `Priority of ${title}`,
        oninput: () => { out.textContent = range.value; range.style.setProperty('--w', `${range.value}%`); },
        onchange: () => app.store.commit(`Priority ${range.value} · ${title}`, d => { const x = d.rules.find(y => y.id === r.id); if (!x) return false; x.weight = Number(range.value); }),
      });
      barEl = h('div', { class: 'rq-track' }, range, out);
    }
    const li = h('li', { class: `rq-row${hard ? ' is-hard' : ''}${off ? ' is-off' : ''}${on ? ' sel' : ''}`, 'data-id': r.id });
    const grip = h('button', { type: 'button', class: 'rq-grip', 'aria-label': `Move: ${title} (drag, or the up and down arrow keys)`,
      onpointerdown: e => dragStart(e, li), onkeydown: e => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(li, e.key === 'ArrowUp' ? -1 : 1); }
      } }, h('span', { 'aria-hidden': 'true' }, '⠿'));
    li.append(grip,
      h('label', { class: 'rq-tick' }, tick),
      h('div', { class: 'rq-name' }, h('span', { class: 'rq-ic', 'aria-hidden': 'true' }, t ? t.icon : '?'), h('span', null, title), off ? h('span', { class: 'bx-tag off' }, 'Off') : null,
        viewPool(state) === 'all' && r.pool ? h('span', { class: `bx-badge ${r.pool === 'junior' ? 'jun' : 'sen'}` }, POOL_NAME[r.pool]) : null),
      barEl);
    return li;
  }

  // ---- moving rules: the row moves in the page while dragging; on drop it is saved between its neighbours
  const lists = () => [...body.querySelectorAll('.rq-list')];
  const rowsNow = () => [...body.querySelectorAll('.rq-list > li[data-id]')];
  function drop(li) {
    const id = li.dataset.id, ul = li.parentElement;
    const sib = (el, dir) => { for (let x = dir < 0 ? el.previousElementSibling : el.nextElementSibling; x; x = dir < 0 ? x.previousElementSibling : x.nextElementSibling) if (x.dataset.id) return x.dataset.id; return null; };
    const hard = ul.dataset.hard === '1';
    const r = (app.store.get().rules || []).find(x => x.id === id);
    if (r && hard && softOnly(r)) { app.toast('This kind of rule can only be a preference', { kind: 'error' }); draw(); return; }
    const title = r ? (r.name || describeRule(r, app.store.get())) : 'rule';
    let changed = false;
    app.store.commit(`Move · ${title}`, d => { changed = placeRule(d, id, { hard, aboveId: sib(li, -1), belowId: sib(li, 1) }); if (!changed) return false; });
    if (!changed) draw();
    const g = body.querySelector(`li[data-id="${CSS.escape(id)}"] .rq-grip`);
    if (g) g.focus();
  }
  function step(li, dir) {
    const all = rowsNow(), n = all[all.indexOf(li) + dir], ls = lists(), ul = li.parentElement;
    if (n && n.parentElement === ul) (dir < 0 ? n.before(li) : n.after(li));
    else { const to = ls[ls.indexOf(ul) + dir]; if (!to) return; dir < 0 ? to.append(li) : to.prepend(li); }
    drop(li);
  }
  function dragStart(e, li) {
    if (e.button > 0) return;
    e.preventDefault();
    const sc = scroller(body);   // moving the row in the page drops pointer capture, so listen on the window
    li.classList.add('rq-drag');
    let y = e.clientY, raf = 0;
    const place = () => {
      const next = [...body.querySelectorAll('.rq-list > li')].find(x => x !== li && (b => y < b.top + b.height / 2)(x.getBoundingClientRect()));
      if (next) { if (li.nextElementSibling !== next) next.before(li); }
      else { const last = lists().pop(); if (last.lastElementChild !== li) last.append(li); }
    };
    const tick = () => {
      const b = sc === document.scrollingElement ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect();
      if (y < b.top + 48) sc.scrollTop -= 10; else if (y > b.bottom - 48) sc.scrollTop += 10;
      place();
      raf = requestAnimationFrame(tick);
    };
    const move = ev => { if (ev.pointerId === e.pointerId) { y = ev.clientY; ev.preventDefault(); } };
    const end = ev => {
      if (ev.pointerId !== e.pointerId) return;
      cancelAnimationFrame(raf);
      removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
      li.classList.remove('rq-drag');
      drop(li);
    };
    addEventListener('pointermove', move, { passive: false }); addEventListener('pointerup', end); addEventListener('pointercancel', end);
    raf = requestAnimationFrame(tick);
  }

  function draw() {
    const state = app.store.get();
    const view = viewPool(state);   // one roster's rules (the switch at the top), or both
    const rules = (state.rules || []).filter(r => (view === 'all' || r.pool === view) && (showOff || r.enabled !== false));
    for (const id of [...selected]) if (!(state.rules || []).some(r => r.id === id)) selected.delete(id);
    const hard = rules.filter(isHard), soft = rules.filter(r => !isHard(r)).sort((a, b) => clampW(b.weight) - clampW(a.weight));
    body.textContent = '';
    body.append(h('p', { class: 'team-p' }, view === 'all' ? 'Both rosters\' rules (pick Junior or Senior at the top to see one). ' : `The ${view} roster's rules only. `, 'Must-hold rules are kept whenever possible. Preferences are weighed by priority: a longer bar matters more, and when two clash the longer one wins. Drag a rule by its grip (⠿) to put it higher or lower, or into Must hold; drag a bar to change one priority; or tick several and change them together below.'));
    body.append(h('div', { class: 'team-row' },
      h('label', { class: 'switch', for: 'rq-off' }, h('input', { type: 'checkbox', id: 'rq-off', checked: showOff, onchange: e => { showOff = e.target.checked; draw(); } }),
        h('span', { class: 'sw-track', 'aria-hidden': 'true' }), h('span', null, 'Show rules that are off')),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { const all = rules.every(r => selected.has(r.id)); for (const r of rules) all ? selected.delete(r.id) : selected.add(r.id); draw(); } },
        rules.length && rules.every(r => selected.has(r.id)) ? 'Unselect all' : 'Select all'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { for (const r of soft) selected.add(r.id); draw(); } }, 'Select preferences'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-k': 'clear', disabled: !selected.size, onclick: () => { selected.clear(); draw(); } }, 'Clear selection')));
    // select by type (adds every rule of that kind in view) and saved selections
    const counts = new Map();
    for (const r of rules) counts.set(r.type, (counts.get(r.type) || 0) + 1);
    const typeSel = h('select', { 'aria-label': 'Select by type', 'data-k': 'bytype' },
      h('option', { value: '' }, 'Select by type…'),
      [...counts].map(([k, n]) => h('option', { value: k }, `${(RULE_TYPES[k] && RULE_TYPES[k].label) || k} (${n})`)));
    typeSel.onchange = () => { if (!typeSel.value) return; for (const r of rules) if (r.type === typeSel.value) selected.add(r.id); draw(); };
    const sets = loadSets();
    const setSel = h('select', { 'aria-label': 'Saved selections', 'data-k': 'sets' },
      h('option', { value: '' }, Object.keys(sets).length ? 'Saved selections…' : 'No saved selections yet'),
      Object.keys(sets).map(k => h('option', { value: k }, `${k} (${sets[k].length})`)));
    setSel.onchange = () => {
      const ids = sets[setSel.value]; if (!ids) return;
      const have = new Set((state.rules || []).map(r => r.id));
      selected.clear(); for (const id of ids) if (have.has(id)) selected.add(id);
      draw();
    };
    const nameIn = h('input', { type: 'text', class: 'rq-name-in', placeholder: 'Name this selection', 'aria-label': 'Name for the saved selection', maxlength: '40' });
    const saveB = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-k': 'saveset', disabled: !selected.size, onclick: () => {
      const name = nameIn.value.trim() || `Selection ${Object.keys(sets).length + 1}`;
      const all = loadSets(); all[name] = [...selected];
      const saved = saveSets(all);
      app.toast(saved ? `Saved "${name}" (${selected.size})` : 'Could not save on this device', saved ? undefined : { kind: 'error' });
      draw();
    } }, 'Save selection');
    const delB = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-k': 'delset', disabled: !Object.keys(sets).length, onclick: () => {
      const k = setSel.value; if (!k) { app.toast('Pick a saved selection above first'); return; }
      const all = loadSets(); delete all[k]; saveSets(all); app.toast(`Deleted "${k}"`); draw();
    } }, 'Delete saved');
    body.append(h('div', { class: 'team-row rq-sets' }, typeSel, setSel, nameIn, saveB, delB));
    const sec = (label, list, isH) => [h('h3', { class: 'rq-h' }, label, h('span', { class: 'bx-count' }, String(list.length))),
      h('ul', { class: 'rq-list', 'aria-label': label, 'data-hard': isH ? '1' : '0' },
        list.length ? list.map(r => row(r, state)) : h('li', { class: 'rq-empty' }, rules.length ? 'None. Drag a rule here.' : 'No rules to show.'))];
    body.append(...sec('Preferences, by priority', soft, false), ...sec('Must hold', hard, true));
    const n = selected.size, dis = !n;
    const wSel = h('select', { 'aria-label': 'Priority for the selected rules', disabled: dis },
      h('option', { value: '' }, 'Set priority…'), [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 1].map(v => h('option', { value: String(v) }, String(v))));
    wSel.onchange = () => { if (wSel.value) commit(`Priority ${wSel.value}`, { weight: Number(wSel.value) }); };
    const b = (label, how, cls = 'btn-ghost') => h('button', { type: 'button', class: `btn btn-sm ${cls}`, disabled: dis, onclick: () => commit(label, how) }, label);
    body.append(h('div', { class: 'rp-bar rq-bar', role: 'group', 'aria-label': 'Change the selected rules' },
      h('span', { class: 'rp-count' }, n ? `${n} selected` : 'Tick rules to change several'),
      wSel, b('+10', { by: 10 }), b('−10', { by: -10 }), b('Must hold', { hard: true }), b('Preference', { hard: false }), b('On', { enabled: true }), b('Off', { enabled: false })));
  }

  draw();
  const unsub = app.store.subscribe(() => draw());
  app.sheet({ title: 'Rule priorities', body, wide: true, actions: [{ label: 'Close', primary: true }], onClose: () => unsub() });
}
