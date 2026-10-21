// NUH Junior Monthly: help for a first-time user. Three parts, kept here so app.js stays small:
// 1. "Getting started": a card at the top of Roster in your own roster (not practice) with six first steps that tick
//    themselves off. Ticks come from the data where they can (staff, leave or requests, Auto-fill) and otherwise from
//    state.settings.onboarding ({ codes, rules, shared, hidden, done }), which travels with backups and the cloud.
// 2. The Help sheet (the "?" in the header): the tour, "Try it yourself", the checklist again, keyboard shortcuts.
// 3. "Try it yourself" (practice only): three guided tasks in a small floating card, each ticked when the store shows
//    it was done (leave added, a pairing rule added, Auto-fill applied), with "Show me" (tour.js showMe) and Stop.
// The interface tour itself is tour.js. Nothing here changes the roster except through the person's own taps.
import * as M from './model.js';
import { startTour, tourDone, showMe, hideShowMe, visibleTargets } from './tour.js';
import * as cloud from './cloud.js';

const UI_KEY = 'nuhjm-guide';   // per device: { collapsed } (the card folded or open)
const isEmpty = app => !((app.store.get().staff || []).length);

// ---------- the checklist ----------
// Each step: id, title, text and its buttons ({ label, icon?, fn(app) }). needsStaff: its buttons wait for step 1.
export const STEPS = [
  { id: 'staff', title: 'Add your staff',
    text: 'Open More › Import from the Google Sheet and paste the month\'s tab (or a downloaded .xlsx). People, postings, leave and requests come in.',
    acts: [{ label: 'Import from the Google Sheet', icon: 'upload', fn: app => app.go('more') }, { label: 'Add staff', icon: 'plus', fn: app => app.go('people', { s: 'staff' }) }] },
  { id: 'codes', title: 'Check the duty codes',
    text: 'C3, R1B, PC, PPC… with their colours. Auto-fill places only C3 and R1B. Change a meaning under People › Duty codes.',
    acts: [{ label: 'Open duty codes', fn: app => app.go('people', { s: 'codes' }) }] },
  { id: 'rules', title: 'Review the rules',
    text: 'The cardiac and ICU rules come from two years of rosters; the ones marked To confirm are guesses. Open a rule to change it.',
    acts: [{ label: 'Open Rules', fn: app => app.go('rules') }] },
  { id: 'leave', title: 'Check leave and postings', needsStaff: true,
    text: 'Leave and requests come in with the sheet. Check each person\'s posting by the week under Postings.',
    acts: [{ label: 'Open Postings', fn: app => app.go('postings') }] },
  { id: 'autofill', title: 'Auto-fill the month', needsStaff: true,
    text: 'Auto-fill places the cardiac (C3) and ICU (R1B) calls around postings, leave and requests. You see a preview first, and Apply can be undone.',
    acts: [{ label: app => `Auto-fill ${M.fmtMonth(app.month)}`, icon: 'spark', fn: app => app.openAutofill() }] },
  { id: 'shared', title: 'Put it back in the Google Sheet',
    text: 'Look the month over in Check. Then, in More, copy the cells and paste them over the sheet\'s day cells (values only).',
    acts: [{ label: 'Open Check', fn: app => app.go('check') }, { label: 'Put it back', fn: app => app.go('more') }] },
];

// Which steps are done: one pass over the cells that stops once it has seen leave (or a request) and an Auto-fill code.
export function checklistStatus(state) {
  const ob = (state.settings && state.settings.onboarding) || {};
  const dmap = M.dutyMap(state);
  let leave = false, auto = false;
  outer: for (const day of Object.values(state.cells || {})) {
    for (const c of Object.values(day || {})) {
      if (!leave && ((c.r || []).length || (c.a || []).some(x => (dmap.get(x) || {}).kind === 'leave'))) leave = true;
      if (!auto && (c.auto || []).length) auto = true;
      if (leave && auto) break outer;
    }
  }
  const done = { staff: (state.staff || []).length > 0, codes: !!ob.codes, rules: !!ob.rules, leave, autofill: auto, shared: !!ob.shared };
  const n = STEPS.filter(s => done[s.id]).length;
  return { done, n, total: STEPS.length, all: n === STEPS.length, hidden: !!ob.hidden, finished: !!ob.done };
}

function loadUi() { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch (e) { return {}; } }
function saveUi(ui) { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* ignore */ } }

let openId = null;        // the step open in the card (null: the first one not done; '' none)
let keepOpen = false;     // shown again from Help: stays (all ticked) until hidden, no "All set"
let allSetTimer = 0;

// Draw (or redraw) the card into its slot. welcome: the first screen with no staff yet (the card is the screen, so it
// can't be folded or hidden). Redrawn only when what it shows changes (it is asked after every edit).
export function renderChecklist(app, slot, { welcome = false } = {}) {
  const st = checklistStatus(app.store.get());
  const show = (welcome && !loadUi().welcomeHidden) || (!welcome && !app.isDemo && !st.hidden && (!st.finished || keepOpen) && !(app.params && app.params.p));
  if (!show) { slot.hidden = true; slot._sig = ''; slot.innerHTML = ''; return; }
  slot.hidden = false;
  const ui = loadUi();
  const collapsed = !welcome && (ui.collapsed ?? app.isPhone());
  const firstOpen = STEPS.find(s => !st.done[s.id]);
  const open = openId === '' ? null : (STEPS.find(s => s.id === openId) || firstOpen || null);
  const allSet = st.all && !welcome && !keepOpen;
  const sig = JSON.stringify([st.done, collapsed, open && open.id, tourDone(), app.month, welcome, app.isPhone(), allSet]);
  if (slot._sig === sig) return;
  slot._sig = sig;
  const hadFocus = slot.contains(document.activeElement) ? document.activeElement.dataset.gs : null;
  slot.innerHTML = '';
  slot.append(allSet ? allSetCard(app) : card(app, st, { welcome, collapsed, open }));
  if (hadFocus) slot.querySelector(`[data-gs="${hadFocus}"]`)?.focus({ preventScroll: true });
  // everything done: a short "All set", then the card goes for good (Help brings it back)
  clearTimeout(allSetTimer);
  if (allSet) allSetTimer = setTimeout(() => app.store.mark({ done: true }), 3500);
}

function allSetCard(app) {
  const { h, icon } = app;
  return h('section', { class: 'gs gs-allset', 'aria-labelledby': 'gs-h', role: 'status' },
    h('span', { class: 'gs-allset-ic', html: icon('ok') }),
    h('div', { class: 'gs-headtext' },
      h('h2', { class: 'gs-title', id: 'gs-h' }, 'All set'),
      h('p', { class: 'gs-sub' }, 'Every first step is done. More › Help has the tour and this checklist if you want them again.')));
}

function card(app, st, { welcome, collapsed, open }) {
  const { h, icon } = app;
  // laptops: the steps as a row (a stepper) with the open one's words below; phones and the welcome: a list
  const vertical = welcome || app.isPhone();
  const next = STEPS.find(s => !st.done[s.id]);
  const meter = h('span', { class: 'gs-meter', 'aria-hidden': 'true' }, STEPS.map(s => h('i', { class: st.done[s.id] ? 'on' : '' })));
  const sub = h('p', { class: 'gs-sub' }, st.all ? 'All 6 done' : `${st.n} of ${st.total} done`, next && !welcome && !vertical ? h('span', { class: 'gs-next' }, ` · Next: ${next.title}`) : null);
  // phones: the next step on a line of its own (it shows folded too); before Auto-fill, why the screen is red
  const nextLine = next && !welcome && vertical ? h('p', { class: 'gs-nextline' }, 'Next: ', h('strong', null, next.title)) : null;
  const note = !welcome && st.done.staff && !st.done.autofill
    ? h('p', { class: 'gs-note' }, 'Red counts and problems are normal until the month is Auto-filled: it has no calls or shifts yet.') : null;
  const toggle = () => { const ui = loadUi(); ui.collapsed = !collapsed; saveUi(ui); app.refreshGuide(); };
  // the title is the fold button (a heading holding a button: the usual disclosure pattern)
  const head = h('div', { class: 'gs-head' },
    h('div', { class: 'gs-headtext' },
      h('h2', { class: 'gs-title', id: 'gs-h' }, welcome ? 'Getting started'
        : h('button', { type: 'button', class: 'gs-fold', 'data-gs': 'fold', 'aria-expanded': String(!collapsed), 'aria-controls': 'gs-body', onclick: toggle },
          h('span', null, 'Getting started'), h('span', { class: `gs-chev${collapsed ? '' : ' is-open'}`, html: icon('right') }))),
      h('div', { class: 'gs-progress' }, meter, sub), nextLine, note),
    !vertical && !tourDone() && !collapsed ? tourButton(app, 'btn btn-ghost btn-sm gs-tour', 'tour') : null,
    welcome ? null : h('button', { type: 'button', class: 'linkish gs-hide', 'data-gs': 'hide', onclick: () => hideChecklist(app) }, 'Hide'));
  const body = h('div', { class: 'gs-body', id: 'gs-body', hidden: collapsed });
  const list = h('ol', { class: 'gs-steps' });
  STEPS.forEach((s, i) => {
    const done = st.done[s.id], isOpen = open && open.id === s.id;
    const blocked = s.needsStaff && !st.done.staff;
    const detailId = `gs-d-${s.id}`;
    const acts = h('div', { class: 'gs-acts' });
    s.acts.forEach((a, k) => {
      const label = typeof a.label === 'function' ? a.label(app) : a.label;
      // the open step's first button is the main one (navy), the rest are plain
      acts.append(h('button', { type: 'button', class: `btn ${k ? 'btn-ghost' : 'btn-primary'} btn-sm`, 'data-gs': `${s.id}-${k}`, disabled: blocked,
        html: `${a.icon ? icon(a.icon) : ''}<span>${app.esc(label)}</span>`, onclick: () => a.fn(app) }));
    });
    list.append(h('li', { class: `gs-step${done ? ' is-done' : ''}${isOpen ? ' is-open' : ''}` },
      h('button', { type: 'button', class: 'gs-step-btn', 'data-gs': `step-${s.id}`, 'aria-expanded': String(!!isOpen), 'aria-controls': detailId,
        onclick: () => { openId = isOpen ? '' : s.id; app.refreshGuide(); } },
        h('span', { class: 'gs-num', html: done ? icon('ok') : String(i + 1) }),
        h('span', { class: 'gs-step-title' }, s.title, h('span', { class: 'sr-only' }, done ? ' (done)' : ' (to do)')),
        h('span', { class: 'gs-step-chev', html: icon('right') })),
      h('div', { class: 'gs-detail', id: detailId, hidden: !isOpen },
        h('p', { class: 'gs-text' }, s.text, blocked ? h('span', { class: 'gs-wait' }, ' Add your staff first.') : null), acts)));
  });
  body.append(list);
  const foot = h('div', { class: 'gs-foot' });
  if (vertical && !tourDone()) foot.append(tourButton(app, 'btn btn-ghost btn-sm gs-tour', 'tour'));
  foot.append(h('a', { class: 'gs-link', href: './?demo', target: '_blank', rel: 'noopener', 'data-gs': 'practice',
    html: `${icon('eye')}<span>Try the practice department first</span><span class="sr-only"> (opens in a new tab)</span>` }));
  body.append(foot);
  return h('section', { class: `gs${welcome ? ' is-welcome' : ''}${vertical ? ' is-vertical' : ''}${collapsed ? ' is-collapsed' : ''}`, 'aria-labelledby': 'gs-h' }, head, body);
}

// The first screen of an empty roster (Roster, Day and Check before there are staff): a few words, then the checklist.
export function welcomeScreen(app) {
  const { h, icon } = app;
  const slot = h('div', { class: 'guide-slot' });
  // a device with nothing on it yet: sign in and the roster comes down from the cloud; or hide the steps and just import
  const signInBtn = cloud.enabled
    ? h('button', { type: 'button', class: 'btn btn-primary', 'data-gs': 'join', onclick: async () => { signInBtn.disabled = true; try { await (await import('./ui-team.js')).joinAndLoad(app); } finally { signInBtn.disabled = false; } } }, "Sign in and pull the cloud roster")
    : null;
  const toggle = h('button', { type: 'button', class: 'linkish welcome-toggle', 'data-gs': 'toggle-steps' }, loadUi().welcomeHidden ? 'Show the getting started steps' : 'Hide the getting started steps');
  toggle.addEventListener('click', () => {
    const u = loadUi(); u.welcomeHidden = !u.welcomeHidden; saveUi(u);
    toggle.textContent = u.welcomeHidden ? 'Show the getting started steps' : 'Hide the getting started steps';
    app.refreshGuide();
  });
  const team = h('div', { class: 'welcome-team' },
    signInBtn ? h('p', null, 'Already using this on another device? Sign in and the roster comes down from the cloud.') : null,
    h('div', { class: 'welcome-team-btns' }, signInBtn, h('button', { type: 'button', class: `btn ${signInBtn ? 'btn-ghost' : 'btn-primary'}`, onclick: () => app.go('more') }, 'Import from the Google Sheet')),
    toggle);
  const el = h('div', { class: 'welcome' },
    h('div', { class: 'card welcome-card has-guide' },
      h('div', { class: 'welcome-intro' },
        h('div', { class: 'empty-ic', html: icon('grid') }),
        h('h2', null, 'Welcome to NUH Junior Monthly'),
        h('p', null, 'Fill the cardiac (C3) and ICU (R1B) calls in the department\'s Google Sheet: bring the month in, plan postings by the week, check the rules, and let Auto-fill draft the calls.'),
        h('p', { class: 'muted' }, 'Everything stays in this browser until the cloud is set up.')),
      team,
      slot));
  return { el, slot };
}

// "Take the 1-minute tour": in place when there is a roster to show; with no staff yet, in the practice department
// (a new tab), where every control has something to point at
function tourButton(app, cls, key) {
  const { h, icon } = app;
  if (!app.isDemo && isEmpty(app)) {
    return h('a', { class: cls, href: './?demo&tour', target: '_blank', rel: 'noopener', 'data-gs': key,
      html: `${icon('tour')}<span>Take the 1-minute tour</span><span class="sr-only"> (in the practice department, a new tab)</span>` });
  }
  return h('button', { type: 'button', class: cls, 'data-gs': key, 'data-tour-return': key, html: `${icon('tour')}<span>Take the 1-minute tour</span>`, onclick: () => takeTour(app) });
}

function hideChecklist(app) {
  keepOpen = false;
  app.store.mark({ hidden: true });
  app.toast('Getting started hidden. More › Help brings it back.', { action: { label: 'Undo', fn: () => app.store.mark({ hidden: false }) } });
}

export function showChecklist(app) {
  openId = null;
  keepOpen = true;
  const ui = loadUi(); ui.collapsed = false; saveUi(ui);
  app.store.mark({ hidden: false });
  if (app.tab !== 'roster' || (app.params && app.params.p)) app.go('roster');
  else app.refreshGuide();
}

// the roster grid with a control lit (the checklist's "Show me Paint")
async function showOnRoster(app, target, text) {
  if (app.tab !== 'roster' || (app.params && app.params.p)) app.go('roster');
  const found = await waitFor(() => visibleTargets(target)[0], 2000);
  if (found) showMe(app, { el: found, text });
}

function waitFor(fn, ms = 1800) {
  return new Promise(resolve => {
    const t0 = performance.now();
    (function look() {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v || performance.now() - t0 > ms) resolve(v || null);
      else requestAnimationFrame(look);
    })();
  });
}

// ---------- the tour ----------
export function takeTour(app) {
  if (!app.isDemo && isEmpty(app)) { window.open('./?demo&tour', '_blank', 'noopener'); return; }
  stopTasks();
  startTour(app, {
    finish: app.isDemo ? { label: 'Try it yourself', fn: () => startTasks(app) } : null,
    onEnd: () => app.refreshGuide(),
  });
}

// ---------- Help ----------
export function openHelp(app) {
  const { h, icon } = app;
  let close = () => {};
  const parts = (ic, title, sub) => [h('span', { class: 'help-ic', html: icon(ic) }),
    h('span', { class: 'help-txt' }, h('strong', null, title), sub ? h('span', null, sub) : null),
    h('span', { class: 'help-go', html: icon('right') })];
  // a row runs its action once the sheet has closed
  const row = (ic, title, sub, fn) => h('li', null, h('button', { type: 'button', class: 'help-row', onclick: () => { close(); setTimeout(fn, 0); } }, parts(ic, title, sub)));
  const link = (ic, title, sub, href) => h('li', null, h('a', { class: 'help-row', href, target: '_blank', rel: 'noopener', onclick: () => close() }, parts(ic, title, sub)));
  const st = checklistStatus(app.store.get());
  const items = [
    !app.isDemo && isEmpty(app) ? link('tour', 'Take the tour', 'In the practice department, with made-up people (a new tab)', './?demo&tour')
      : row('tour', 'Take the tour', 'A one-minute look at the main controls', () => takeTour(app)),
    app.isDemo && tasks ? row('task', 'Try it yourself', `Task ${tasks.step + 1} of 3 is under way: carry on`, () => tasks.focus())
      : app.isDemo ? row('task', 'Try it yourself', 'Three short tasks: leave, a rule, Auto-fill', () => startTasks(app))
      : link('task', 'Try it yourself', 'Three short tasks in the practice department (a new tab)', './?demo&try'),
    app.isDemo ? null : row('flag', 'Getting started checklist', st.all ? 'All 6 done: show it again' : `${st.n} of ${st.total} done${st.hidden || st.finished ? ': show it again' : ''}`, () => showChecklist(app)),
    // (no keyboard on a touch-only phone)
    window.matchMedia('(hover: none) and (pointer: coarse)').matches ? null
      : row('keyboard', 'Keyboard shortcuts', 'Move around the grid, type codes, switch months', () => app.shortcuts()),
  ];
  close = app.sheet({ title: 'Help', className: 'help-sheet', body: h('ul', { class: 'help-list' }, items) });
}

// ---------- Try it yourself (practice) ----------
let tasks = null;
export function tasksRunning() { return !!tasks; }
export function stopTasks() { if (tasks) tasks.stop(); }

export function startTasks(app) {
  if (!app.isDemo) { window.open('./?demo&try', '_blank', 'noopener'); return; }
  stopTasks();
  const { h, icon } = app;
  const thisM = M.monthOf(M.iso(new Date())), nextM = M.addMonths(thisM, 1);
  const pair = findPair(app.store.get(), thisM);
  const tap = app.isPhone() || window.matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click';
  let base = 0, ruleIds = new Set(), found = null;

  const LIST = [
    { id: 'leave', title: 'Give someone leave',
      text: `${tap} an empty cell in the grid, then AL (annual leave) in the editor.`,
      begin: s => {
        base = leaveCount(s);
        // phones open on Day: the task needs the grid
        if (app.tab !== 'roster' || (app.params && app.params.p)) app.go('roster');
      },
      check: s => leaveCount(s) > base,
      done: () => 'Leave added: a pink AL chip in the grid. The rules now keep shifts off that day.',
      show: async () => {
        const al = document.querySelector('.popover .tchip[data-code="AL"], .ced-sheet .tchip[data-code="AL"]');
        if (al) return showMe(app, { el: al, text: `${tap} AL` });
        if (app.month !== thisM) app.setMonth(thisM);
        if (app.tab !== 'roster' || (app.params && app.params.p)) app.go('roster', { m: thisM });
        const cell = await waitFor(() => emptyCellOnScreen(app));
        if (cell) showMe(app, { el: cell, text: `${tap} this cell, then AL` });
      } },
    { id: 'rule', title: 'Add a rule',
      text: pair ? `Rules › Add rule › Between two people. Choose ${pair.a} under Other people and ${pair.b} under Who: they are both on call on ${pair.day}.`
        : 'Rules › Add rule › Between two people. Choose one person under Other people and another under Who.',
      begin: s => { ruleIds = new Set((s.rules || []).map(r => r.id)); },
      check: s => (found = (s.rules || []).find(r => !ruleIds.has(r.id) && r.type === 'together' && r.params && r.params.mode === 'never'
        && ((r.who && r.who.staff) || []).length && ((r.params.other && r.params.other.staff) || []).length)),
      done: () => {
        let n = 0;
        try { const days = M.monthDays(thisM); n = app.rules.evaluateRule(app.store.get(), found, { from: days[0], to: days[days.length - 1] }).length; } catch (e) { n = 0; }
        return n ? `Rule added, and it finds ${n} must-fix problem${n === 1 ? '' : 's'} in ${M.fmtMonth(thisM)}: a red ring on the cell, and a line in Check.`
          : 'Rule added. They are never on call together this month, so there is nothing to fix.';
      },
      show: async () => {
        // (skip a picker that is still closing: its backdrop has .out until it's removed)
        const combo = [...document.querySelectorAll('.rp-sheet .rp-combo [data-kind="together"]')].find(b => !b.closest('.out'));
        if (combo) return showMe(app, { el: combo, text: `${tap} Between two people` });
        const secs = [...document.querySelectorAll('.rb-sheet .rb-sec')].filter(x => !x.closest('.out'));
        if (secs.length) {
          // the builder: Other people (under What) first, then Who, then Add rule
          const sec = name => secs.find(x => (x.querySelector('.rb-sec-h') || {}).textContent === name);
          const what = sec('What'), whoSec = sec('Who');
          const pick = (box, who) => box && !box.querySelector('.bx-pill.is-on .bx-x') && box.querySelector('.bx-who-sel')
            ? showMe(app, { el: box.querySelector('.bx-who-sel'), text: who ? `Choose ${who} here` : 'Choose a person here' }) : null;
          const done = pick(what, pair && pair.a) ?? pick(whoSec, pair && pair.b);
          if (done !== null) return done;
          const add = document.querySelector('.rb-sheet .sheet-foot .btn-primary');
          if (add) return showMe(app, { el: add, text: `${tap} ${add.textContent.trim()}` });
        }
        if (app.tab !== 'rules') app.go('rules');
        const b = await waitFor(() => visibleTargets('addrule')[0]);
        if (b) showMe(app, { el: b, text: `${tap} Add rule` });
      } },
    { id: 'autofill', title: `Auto-fill ${M.fmtMonth(nextM)}`,
      text: `Go to ${M.fmtMonth(nextM)} (the › beside the month), press Auto-fill, then Start, then Apply.`,
      begin: () => {},
      check: (s, info) => info && info.source === 'commit' && /^Auto-fill /.test(info.label || ''),
      done: () => 'Applied: the cardiac and ICU calls are in. Undo in the header takes it back.',
      show: async () => {
        const btn = document.querySelector('.af-sheet .af-actions .btn-primary');
        if (btn) return showMe(app, { el: btn, text: `${tap} ${btn.textContent.trim()}` });
        if (app.tab !== 'roster' && app.tab !== 'day') app.go('roster', { m: nextM });
        if (app.month !== nextM) {
          const arrow = document.getElementById('nextm');
          if (arrow) return showMe(app, { el: arrow, text: `${tap} › for ${M.fmtMonth(nextM)}` });
        }
        const b = await waitFor(() => visibleTargets('autofill')[0]);
        if (b) showMe(app, { el: b, text: `${tap} Auto-fill` });
      } },
  ];

  let i = 0, ticking = false, timer = 0;
  const prog = h('div', { class: 'task-prog', 'aria-hidden': 'true' }, LIST.map(() => h('i')));
  const kicker = h('p', { class: 'task-kicker' });
  const title = h('h2', { class: 'task-title', id: 'task-title', tabindex: '-1' });
  const text = h('p', { class: 'task-text' });
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const acts = h('div', { class: 'task-acts' });
  const el = h('aside', { class: 'task-card', 'aria-labelledby': 'task-title' }, prog, kicker, title, text, acts, live);
  document.body.append(el);
  document.body.classList.add('has-taskcard');
  const sizeVar = () => document.body.style.setProperty('--task-h', `${el.offsetHeight}px`);

  function paintProg(doneUpTo) { [...prog.children].forEach((x, j) => x.classList.toggle('on', j < doneUpTo)); }
  function draw() {
    const t = LIST[i];
    el.classList.toggle('is-done', ticking);
    kicker.textContent = `Try it yourself · ${i + 1} of ${LIST.length}`;
    paintProg(i + (ticking ? 1 : 0));
    title.innerHTML = '';
    if (ticking) title.append(h('span', { class: 'task-tick', html: icon('ok') }));
    title.append(t.title);
    text.textContent = ticking ? t.doneText : t.text;
    acts.innerHTML = '';
    if (!ticking) {
      acts.append(
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm task-show', html: `${icon('eye')}<span>Show me</span>`, onclick: () => t.show() }),
        h('button', { type: 'button', class: 'linkish task-stop', onclick: stop }, 'Stop'));
    }
    sizeVar();
  }
  function finale() {
    el.classList.add('is-done');
    kicker.textContent = 'Try it yourself';
    paintProg(LIST.length);
    title.innerHTML = '';
    title.append(h('span', { class: 'task-tick', html: icon('ok') }), 'All three done');
    text.textContent = 'That\'s the roster in practice. Your own roster starts empty: import the department sheet or add names, then follow Getting started.';
    acts.innerHTML = '';
    acts.append(
      h('a', { class: 'btn btn-primary btn-sm', href: './' }, 'Go to your own roster'),
      h('button', { type: 'button', class: 'linkish task-stop', onclick: stop }, 'Close'));
    live.textContent = 'All three tasks done.';
    sizeVar();
  }
  function begin() {
    ticking = false;
    LIST[i].begin(app.store.get());
    draw();
    live.textContent = `Task ${i + 1} of ${LIST.length}: ${LIST[i].title}. ${LIST[i].text}`;
  }
  const unsub = app.store.subscribe((state, info) => {
    if (ticking || i >= LIST.length) return;
    if (!LIST[i].check(state, info)) return;
    ticking = true;
    hideShowMe();
    LIST[i].doneText = LIST[i].done();
    draw();
    live.textContent = `Done: ${LIST[i].title}. ${LIST[i].doneText}`;
    // the tick stays long enough to read, then the next task; the clock starts once no window is open (the cell
    // editor on a phone, say), so the tick is seen
    const ms = 1800 + LIST[i].doneText.length * 25;
    const wait = () => {
      if (tasks !== api) return;
      if (document.querySelector('.sheet-back')) { timer = setTimeout(wait, 250); return; }
      timer = setTimeout(() => { i++; if (i < LIST.length) begin(); else finale(); }, ms);
    };
    wait();
  });
  const onResize = () => sizeVar();
  window.addEventListener('resize', onResize);
  function stop() {
    if (tasks !== api) return;
    tasks = null;
    clearTimeout(timer);
    unsub();
    hideShowMe();
    window.removeEventListener('resize', onResize);
    el.remove();
    document.body.classList.remove('has-taskcard');
    document.body.style.removeProperty('--task-h');
  }
  const api = { stop, focus: () => title.focus({ preventScroll: true }), get step() { return i; } };
  tasks = api;
  begin();
  title.focus({ preventScroll: true });
  return api;
}

// leave codes in every cell (a new one means someone was given leave)
function leaveCount(state) {
  const dmap = M.dutyMap(state);
  let n = 0;
  for (const day of Object.values(state.cells || {})) for (const c of Object.values(day || {})) for (const x of c.a || []) if ((dmap.get(x) || {}).kind === 'leave') n++;
  return n;
}

// two juniors on call the same night this month (the practice department has them): names for the rule task
function findPair(state, month) {
  const seniors = new Set((state.groups || []).filter(g => g.kind === 'senior').map(g => g.id));
  const people = M.staffInMonth(state, month).filter(p => !seniors.has(p.group));
  for (const d of M.monthDays(month)) {
    const on = people.filter(p => ((M.getCell(state, d, p.id) || {}).a || []).includes('C'));
    if (on.length >= 2) return { a: on[0].name, b: on[1].name, day: M.fmtDay(d) };
  }
  return null;
}

// an empty weekday cell fully on screen in the grid (clear of the sticky names and day heads)
function emptyCellOnScreen(app) {
  const sc = document.querySelector('.r-scroll');
  if (!sc) return null;
  const box = sc.getBoundingClientRect();
  const nm = sc.querySelector('th.nh'), head = sc.querySelector('thead');
  const left = box.left + (nm ? nm.offsetWidth : 0), top = box.top + (head ? head.offsetHeight : 0) + 30;
  const bottom = Math.min(box.bottom, window.innerHeight) - 80;
  const st = app.store.get();
  for (const b of sc.querySelectorAll('.cell')) {
    const d = b.dataset.d;
    if (!d || M.isWeekend(d) || M.isHoliday(st, d) || b.querySelector('.chip')) continue;
    const r = b.getBoundingClientRect();
    if (r.left >= left + 2 && r.right <= box.right - 2 && r.top >= top && r.bottom <= bottom) return b;
  }
  return null;
}
