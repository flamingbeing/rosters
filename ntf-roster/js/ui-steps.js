// NTF Roster: the junior roster in three steps, as a card above the roster: 1 import the department sheet, 2 fill the
// calls, PM shifts and pain service (APS) weeks, 3 download the filled sheet. Also the two sheets the steps open: the
// call list check (the levels an import guessed) and the rule-by-rule report after a fill. Logic in steps.js.

import * as M from './model.js';
import * as S from './steps.js';
import { levelOf, strengthOf, LEVELS, STRENGTHS } from './jpool.js';
import { suggestMonth, weeksOf, weekHolder } from './aps.js';
import { importFile, fillSheet } from './ui-import.js';

const XLSX = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Should the card show? The junior view of your own roster, once a department sheet has come in or a call list is set.
export function wanted(app) {
  const st = app.store && app.store.get();
  if (!st || app.isDemo || (st.settings && st.settings.pool === 'senior') || !(st.staff || []).length) return false;
  return Object.keys((st.settings && st.settings.jsteps) || {}).length > 0 || (st.staff || []).some(p => levelOf(p));
}

function filePick(app, label, cls, onFile) {
  const { h, icon } = app;
  const input = h('input', { type: 'file', accept: XLSX, class: 'sr-only' });
  input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; if (f) onFile(f); });
  return h('label', { class: `${cls} more-file` }, input, h('span', { html: icon('upload') }), h('span', null, label));
}

function poolPeople(state, month) {
  return M.staffInMonth(state, month).filter(p => M.poolOf(state, p) === 'junior' && p.group !== 'nurse');
}

// ---------- the card ----------

export function renderSteps(app, slot) {
  const { h, icon } = app;
  slot.innerHTML = '';
  if (!wanted(app)) { slot.hidden = true; return; }
  slot.hidden = false;
  const state = app.store.get();
  const month = app.month;
  const st = S.stepState(state, month);
  const people = poolPeople(state, month);
  const guesses = people.filter(S.isGuessed).length;
  const ev = app.evaluation();
  const hardRules = new Set((ev.violations || []).filter(v => v.hard).map(v => v.ruleId)).size;
  const apsWeeks = weeksOf(month);
  const apsHeld = apsWeeks.filter(m => weekHolder(state, m)).length;
  const when = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${M.fmtDay(M.iso(d))}, ${d.toTimeString().slice(0, 5)}`; };

  const onImport = f => importFile(app, f);
  const current = !st.imported ? 1 : !st.filled ? 2 : !st.exported ? 3 : 0;
  const step = (n, title, status, done, ...acts) => h('li', { class: `js-step${done ? ' is-done' : ''}${current === n ? ' is-now' : ''}` },
    h('span', { class: 'js-n', 'aria-hidden': 'true', html: done ? icon('ok') : String(n) }),
    h('div', { class: 'js-text' }, h('strong', null, title), h('span', { class: 'js-status' }, done ? h('span', { class: 'sr-only' }, 'Done: ') : null, status)),
    h('div', { class: 'js-acts' }, ...acts));
  const btnCls = n => `btn btn-sm ${current === n ? 'btn-primary' : 'btn-ghost'}`;

  const fillBtn = h('button', { type: 'button', class: btnCls(2), onclick: () => openFill(app) }, st.filled ? 'Fill again' : 'Fill');
  const reportBtn = st.filled ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => openReport(app) }, 'Rules report') : null;
  const dlBtn = app.lastBook
    ? h('button', { type: 'button', class: btnCls(3), onclick: e => fillSheet(app, app.lastBook, e.currentTarget) }, 'Download')
    : filePick(app, 'Choose the sheet to fill', btnCls(3), async f => fillSheet(app, { name: f.name, buf: await f.arrayBuffer() }));

  slot.append(h('section', { class: 'card jsteps', 'aria-labelledby': 'jsteps-h' },
    h('div', { class: 'jsteps-head' },
      h('h2', { id: 'jsteps-h' }, `Junior roster, ${M.fmtMonth(month)}`),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => openCallList(app) },
        `Call list${guesses ? ` (${guesses} to check)` : ''}`)),
    h('ol', { class: 'js-steps' },
      step(1, 'Import the department sheet',
        st.imported ? `Imported ${when(st.at.imported)}` : 'The month\'s leave request file (.xlsx), with leave and requests',
        st.imported, filePick(app, st.imported ? 'Import again' : 'Import', btnCls(1), onImport)),
      step(2, 'Fill calls, PM shifts and APS weeks',
        st.filled ? `${apsHeld} of ${apsWeeks.length} APS weeks set · ${hardRules ? `${hardRules} must-hold rule${hardRules === 1 ? '' : 's'} broken` : 'every must-hold rule kept'}`
          : guesses ? `Check the call list first (${guesses} guessed from the sheet)` : 'Drafts the month from your rules; you see the result before it is used',
        st.filled && !hardRules, fillBtn, reportBtn),
      step(3, 'Download the filled sheet',
        st.exported ? `Downloaded ${when(st.at.exported)}` : app.lastBook ? `Writes C, P, HC and the APS weeks into ${app.lastBook.name}` : 'Choose the department sheet: the roster is written into it, formatting kept',
        st.exported, dlBtn))));
}

// ---------- step 2: fill, then the report ----------

export async function openFill(app) {
  const state = app.store.get();
  const guesses = poolPeople(state, app.month).filter(S.isGuessed).length;
  if (guesses) { openCallList(app, { then: () => openFill(app) }); return; }
  app.openAutofill({ quick: true, aps: true, onApplied: () => app.settled().then(() => openReport(app)) });
}

export function openReport(app) {
  const { h, icon } = app;
  const state = app.store.get();
  const scoped = app.scope(state);
  const ev = app.evaluation();
  let describe = r => r.name || r.id;
  try { if (app.rules && app.rules.describeRule) describe = r => app.rules.describeRule(r, state); } catch (e) { /* names only */ }
  const rows = S.ruleReport(scoped, ev, describe);
  const must = rows.filter(r => r.hard), pref = rows.filter(r => !r.hard);
  const name = id => ((state.staff || []).find(p => p.id === id) || {}).name || 'nobody';
  const aps = suggestMonth(state, app.month);

  const list = items => h('ul', { class: 'jr-list' }, items.map(r => h('li', { class: `jr-row ${r.n ? 'is-bad' : 'is-ok'}` },
    r.n ? h('details', null,
      h('summary', null, h('span', { class: 'jr-ic', html: icon('alert') }), h('span', { class: 'jr-name' }, r.name), h('span', { class: 'jr-n' }, `${r.n}×`)),
      h('ul', { class: 'jr-msgs' }, r.msgs.slice(0, 20).map(m => h('li', null, m)), r.msgs.length > 20 ? h('li', null, `and ${r.msgs.length - 20} more`) : null))
      : h('div', { class: 'jr-line' }, h('span', { class: 'jr-ic', html: icon('ok') }), h('span', { class: 'jr-name' }, r.name)))));
  const mustBad = must.filter(r => r.n).length, prefBad = pref.filter(r => r.n).length;
  const body = h('div', { class: 'jreport' },
    h('p', { class: mustBad ? 'warn-box' : 'ok-box' }, mustBad ? `${mustBad} of ${must.length} must-hold rules are broken this month. Tap one to see the days.` : `All ${must.length} must-hold rules are kept.`),
    h('h3', null, 'Pain service (APS) weeks'),
    h('ul', { class: 'jr-aps' }, aps.map(w => h('li', null, h('span', null, `${M.fmtDay(w.days[0])} to ${M.fmtDay(w.days[6])}`), h('strong', null, w.holder ? name(w.holder) : 'not set')))),
    h('h3', null, `Must hold (${must.length})`), list(must),
    h('h3', null, `Preferences (${pref.length}${prefBad ? `, ${prefBad} not fully met` : ''})`),
    h('p', { class: 'bx-help' }, 'Preferences give way when they cannot all be met; the higher the weight on the Rules screen, the later one gives way.'),
    list(pref));
  app.sheet({ title: `Rules report, ${M.fmtMonth(app.month)}`, body, wide: true, actions: [
    { label: 'Change the rules', fn: () => app.go('rules') },
    { label: 'Done', primary: true },
  ] });
}

// ---------- the call list ----------

// Everyone in the junior pool with their call level (MO2 senior MO on call, MO1 junior MO on call, no calls, not on the
// call list) and strong or weak; guesses from the sheet are marked until "Looks right".
export function openCallList(app, { fresh = 0, then = null } = {}) {
  const { h } = app;
  const body = h('div', { class: 'jcall' });
  const draw = () => {
    const state = app.store.get();
    const people = poolPeople(state, app.month);
    const gmap = M.groupMap(state);
    const guesses = people.filter(S.isGuessed).length;
    body.innerHTML = '';
    body.append(h('p', null, fresh
      ? `The sheet brought ${fresh} people new to the call list. Their level is guessed from their section (resident physicians and R2+ junior residents MO2; R1s, MOs and locums MO1). Change any that are wrong, then press Looks right. You only do this once per person.`
      : 'MO2 is the senior MO on call, MO1 the junior MO on call. A weak MO2 is never on call with a weak MO1. Set it once; new people from a later sheet are guessed and shown here.'));
    const order = [['mo2', 'MO2'], ['mo1', 'MO1'], ['nocall', 'No calls'], ['', 'Not on the call list']];
    for (const [lv, title] of order) {
      const grp = people.filter(p => levelOf(p) === lv);
      if (!grp.length) continue;
      body.append(h('h3', null, `${title} (${grp.length})`));
      body.append(h('div', { class: 'jp-rows' }, grp.map(p => {
        const g = gmap.get(p.group);
        const lvl = h('select', { 'aria-label': `Call level: ${p.name}`, onchange: () => save(p, lvl.value, str.value) },
          ...LEVELS.map(([v, l]) => h('option', { value: v, selected: v === levelOf(p) }, l)));
        const str = h('select', { 'aria-label': `Strong or weak: ${p.name}`, onchange: () => save(p, lvl.value, str.value), disabled: !['mo2', 'mo1'].includes(levelOf(p)) },
          ...STRENGTHS.map(([v, l]) => h('option', { value: v, selected: v === strengthOf(p) }, l)));
        return h('div', { class: `jp-row${S.isGuessed(p) ? ' is-guess' : ''}` },
          h('div', { class: 'jp-name' }, h('strong', null, p.name), h('span', { class: 'bx-help' }, [g ? g.name : '', p.note].filter(Boolean).join(' · '), S.isGuessed(p) ? h('span', { class: 'jp-guess' }, 'guess') : null)),
          lvl, str);
      })));
    }
    if (!guesses) body.append(h('p', { class: 'bx-help' }, 'Everyone here has been checked.'));
  };
  const save = (p, level, strength) => {
    app.store.commit(`Set call level: ${p.name}`, d => { S.setLevel(d, p.id, level, strength); });
    draw();
  };
  draw();
  app.sheet({ title: 'Call list', body, wide: true, actions: [
    { label: 'Later' },
    { label: 'Looks right', primary: true, fn: () => {
      const ids = poolPeople(app.store.get(), app.month).filter(S.isGuessed).map(p => p.id);
      if (ids.length) app.store.commit('Call list checked', d => { S.confirmGuesses(d, ids); });
      if (then) app.settled().then(then);
    } },
  ] });
}
