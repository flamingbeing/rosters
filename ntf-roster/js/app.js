// NTF Roster: app shell. Loads the state (practice department with ?demo), draws the header, the tabs and the
// bottom bar on phones, routes between views (#roster, #day, #people, #rules, #check, #more) and gives every view
// the same small `app` toolkit: store, month, toasts, sheets, the cached rule check and a DOM helper.
// Views are separate modules loaded on demand; a view that fails to load shows a friendly placeholder instead.

let M = null;      // model.js
let J = null;      // jpool.js (the junior pool: scoping a check or fill to one pool)
let R = null;      // rules.js (may be missing while it is being built)
let CS = null;     // cloudstate.js: what the header's cloud button shows (null while the cloud is off)
let G = null;      // guide.js: Getting started, Help, the tour (tour.js) and "Try it yourself"

// the UI kit: this device's look, theme and density (lib/roster-core/kit.js), in NUHS navy; loaded on demand, the app
// opens on its own styles when core is out of reach
import('../../lib/roster-core/kit.js').then(k => k.startKit({ accent: '#002f6c' })).catch(e => console.warn('UI kit not loaded', e));

const TABS = {
  roster: { label: 'Roster', icon: 'grid', mod: './ui-roster.js' },
  day: { label: 'Day', icon: 'day', mod: './ui-day.js' },
  people: { label: 'People', icon: 'people', mod: './ui-people.js' },
  rules: { label: 'Rules', icon: 'rules', mod: './ui-rules.js' },
  check: { label: 'Check', icon: 'check', mod: './ui-check.js' },
  more: { label: 'More', icon: 'more', mod: './ui-more.js' },
};
const DESKTOP_TABS = ['roster', 'day', 'people', 'rules', 'check', 'more'];
const PHONE_TABS = ['roster', 'day', 'check', 'rules', 'more'];
const PHONE_MQ = '(max-width: 720px)';

// Line icons (24 px grid, stroke = currentColor). Views get them through app.icon(name).
const ICON_PATHS = {
  cloud: '<path d="M7 18.5a4.5 4.5 0 01-.7-8.95A6 6 0 0117.9 10.3 4.1 4.1 0 0117.3 18.5z"/>',
  grid: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9.5h18M3 15h18M9 4v17M15 4v17"/>',
  day: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><rect x="7" y="12" width="4" height="4" rx=".5"/>',
  check: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  rules: '<path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-1"/><circle cx="16" cy="6" r="2.2"/><circle cx="10" cy="12" r="2.2"/><circle cx="18" cy="18" r="2.2"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  spark: '<path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  brush: '<path d="M18.4 2.6a2 2 0 012.8 2.8L11 15.6 8.4 13z"/><path d="M8.4 13C6 13 4.5 14.6 4.5 17c0 1.6-1 2.6-2.5 3 1 .7 2.6 1 4 1 3 0 5-2 5-5.4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  alert: '<path d="M12 3.5l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M9 12h6M9 16h6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eraser: '<path d="M20 20H9l-5.5-5.5a2 2 0 010-2.8l9.2-9.2a2 2 0 012.8 0l5 5a2 2 0 010 2.8L12 18.8"/><path d="M7 10l7 7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.4a2.6 2.6 0 015 .9c0 1.8-2.5 2.3-2.5 4"/><path d="M12 17.3h.01"/>',
  tour: '<circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/>',
  task: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M3.5 6.2l1.3 1.3L7.3 5M3.5 12.2l1.3 1.3 2.5-2.5M3.5 18.2l1.3 1.3 2.5-2.5"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4.5L17 13H5"/>',
};
function icon(name, cls = '') {
  const p = ICON_PATHS[name] || '';
  const fill = name === 'more' ? ' fill="currentColor"' : ' fill="none"';
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" width="20" height="20"${fill} stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${p}</svg>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Tiny DOM helper: h('button', { class: 'btn', onclick: fn, 'aria-label': 'x' }, 'Text', otherNode)
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [prop, val] of Object.entries(v)) {
          if (val == null) continue;
          if (prop.startsWith('--') || prop.includes('-')) el.style.setProperty(prop, String(val));   // custom properties need setProperty
          else el.style[prop] = val;
        }
      }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'indeterminate') el[k] = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  const add = (c) => {
    if (c == null || c === false || c === true) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

const $ = (sel) => document.querySelector(sel);

// ---------- app object ----------
const app = {
  store: null,
  month: '',
  params: {},
  tab: '',
  selectedCell: null,
  h, icon, esc,
  isDemo: false,
  setMonth, go, toast, scope: (st) => (J ? J.scopeToPool(st, ((st.settings && st.settings.pool) || 'all'), M.poolOf) : st), sheet, confirm: confirmBox, evaluation, isPhone,
  selectCell(date, staffId) { app.selectedCell = date && staffId ? { date, staffId } : null; },
  // first-time help (guide.js, tour.js)
  openCloud, refreshCloud: () => renderCloudBtn(), onboard, refreshGuide: renderGuide, openAutofill, shortcuts: () => shortcutsSheet(), settled,
  model: null,
  rules: null,
};

function isPhone() { return window.matchMedia(PHONE_MQ).matches; }

function thisMonth() { return M.monthOf(M.iso(new Date())); }
function validMonth(m) { return typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m); }
function validDay(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && M.iso(M.parseISO(d)) === d; }
// the month a link asks for: ?m=, else the month of ?d= (a Day link), else none
function monthFromParams(p) { return validMonth(p.m) ? p.m : validDay(p.d) ? p.d.slice(0, 7) : ''; }

function setMonth(m) {
  if (!validMonth(m) || m === app.month) return;
  app.month = m;
  app.store.ensureLocked(m);
  evalCache = null;
  try { localStorage.setItem('ntf-roster-ui-month', JSON.stringify({ m, at: M.iso(new Date()) })); } catch (e) { /* ignore */ }
  // keep the month in the link, so a reload or a relaunch of the installed app comes back to it
  try {
    const { tab, params } = parseHash();
    const next = { ...params, m };
    if (next.d && !String(next.d).startsWith(m + '-')) delete next.d;
    const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v != null && v !== '')).toString();
    history.replaceState(history.state, '', '#' + tab + (q ? '?' + q : ''));
    app.params = next;
    current.key = tab + (q ? '?' + q : '');
  } catch (e) { /* ignore */ }
  renderHeader();
  if (current.view && typeof current.view.update === 'function') {
    try { current.view.update(app.store.get(), { month: true }); } catch (e) { console.error(e); }
  }
}

// ---------- rule check cache ----------
let evalCache = null;
const EMPTY_EVAL = () => ({ violations: [], hard: 0, soft: 0, score: 0, failed: [], byCell: new Map(), byDay: new Map(), byRule: new Map() });
function evaluation() {
  const state = app.store.get();
  const pool = (state.settings && state.settings.pool) || 'all';
  if (evalCache && evalCache.state === state && evalCache.month === app.month) return evalCache.res;
  let res = EMPTY_EVAL();
  if (R && typeof R.evaluate === 'function') {
    const days = M.monthDays(app.month);
    // a failed check must never look like "No problems": the header and Check say so (error / failed)
    try { res = R.evaluate(J ? J.scopeToPool(state, pool, M.poolOf) : state, { from: days[0], to: days[days.length - 1] }) || res; } catch (e) { console.error('evaluate failed', e); res = { ...EMPTY_EVAL(), error: true }; }
  }
  evalCache = { state, month: app.month, res };
  return res;
}

// ---------- toasts ----------
// an error toast ("Not saved: …") goes as soon as something else happens: it must not linger over the fix
function clearErrorToasts() { document.querySelectorAll('#toasts .toast-error').forEach(el => el.remove()); }
function toast(msg, { action, kind = 'ok', ms } = {}) {
  const box = $('#toasts');
  clearErrorToasts();
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-msg' }, msg));
  let timer;
  const close = () => { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 180); };
  if (action) {
    el.append(h('button', { type: 'button', class: 'toast-act', onclick: () => { close(); action.fn(); } }, action.label));
  }
  el.append(h('button', { type: 'button', class: 'toast-x', 'aria-label': 'Dismiss', html: icon('close'), onclick: close }));
  box.append(el);
  while (box.children.length > 3) box.firstChild.remove();
  if (ms !== 0) timer = setTimeout(close, ms || (action ? 6000 : 3500));   // ms: 0 stays until dismissed
  return close;
}

// ---------- sheets (modal on desktop, bottom sheet on phone) ----------
// Each open sheet adds a history entry, so the phone's Back button closes the sheet instead of leaving the screen
// underneath. beforeClose(reason) can ask first ("Discard changes?") when a sheet is closed by Back, Esc, the X or
// a tap outside; buttons in the sheet's footer close it without asking.
let sheetCount = 0;
let sheetSeq = 0;
const sheetStack = [];       // [{ seq, pushed, push, onBack }] open sheets, oldest first
let backPending = null;      // a history.back() from closing a sheet that hasn't landed yet
let backDone = null;
window.addEventListener('popstate', (e) => {
  if (backDone) { const r = backDone; backDone = null; backPending = null; r(); }
  const seq = (e.state && e.state.ntfSheet) || 0;
  for (const s of [...sheetStack].reverse()) if (s.pushed && s.seq > seq) s.onBack();
  // sheets opened while that back was on its way get their history entry now
  for (const s of sheetStack) if (!s.pushed) s.push();
});
function sheet({ title = '', body, actions = [], wide = false, onClose, beforeClose, className = '' } = {}) {
  const prevFocus = document.activeElement;
  const id = 'sheet-title-' + (++sheetCount);
  const seq = ++sheetSeq;
  let popped = false;
  const entry = { seq, pushed: false, onBack: () => { popped = true; requestClose('back'); } };
  const pushEntry = () => { try { history.pushState({ ...(history.state || {}), ntfSheet: seq }, ''); } catch (e) { /* ignore */ } popped = false; entry.pushed = true; };
  entry.push = pushEntry;
  if (!backPending) pushEntry();   // else once the pending back has landed (popstate)
  sheetStack.push(entry);
  const back = h('div', { class: 'sheet-back' });
  const footer = actions.length ? h('div', { class: 'sheet-foot' }) : null;
  const dlg = h('div', { class: `sheet${wide ? ' wide' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id },
    h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' },
      h('h2', { id, class: 'sheet-title' }, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', html: icon('close'), onclick: () => requestClose('x') })),
    h('div', { class: 'sheet-body' }, body || null),
    footer);
  let closed = false, asking = false;
  async function requestClose(reason) {
    if (closed || asking) return;
    if (typeof beforeClose === 'function') {
      asking = true;
      let ok = true;
      try { ok = await beforeClose(reason); } catch (e) { ok = true; }
      asking = false;
      if (!ok) { if (reason === 'back') pushEntry(); return; }
    }
    close(reason);
  }
  function close(reason) {
    if (closed) return;
    closed = true;
    const at = sheetStack.indexOf(entry);
    if (at >= 0) sheetStack.splice(at, 1);
    if (entry.pushed && !popped && history.state && history.state.ntfSheet === seq) {
      popped = true;
      backPending = new Promise(res => { backDone = res; });
      history.back();
    }
    document.removeEventListener('keydown', onKey, true);
    back.classList.add('out');
    setTimeout(() => back.remove(), 160);
    if (typeof onClose === 'function') onClose(reason);
    if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
  }
  for (const a of actions) {
    const b = h('button', { type: 'button', class: `btn ${a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-ghost'}` }, a.label);
    b.addEventListener('click', async () => {
      let keep = false;
      try { keep = (await (a.fn ? a.fn(close) : undefined)) === false; } catch (e) { console.error(e); toast(String(e.message || e), { kind: 'error' }); keep = true; }
      if (!keep) close('action');
    });
    footer.append(b);
  }
  function onKey(e) {
    if (!document.contains(dlg)) return;
    const top = [...document.querySelectorAll('.sheet-back')].pop();
    if (top !== back) return;   // only the top sheet reacts
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); requestClose('escape'); }
    if (e.key === 'Tab') {   // keep focus inside the dialog
      const f = [...dlg.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }
  back.addEventListener('mousedown', (e) => { if (e.target === back) requestClose('backdrop'); });
  back.append(dlg);
  document.body.append(back);
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => {
    const first = dlg.querySelector('.sheet-body [autofocus], .sheet-body input, .sheet-body select, .sheet-body textarea, .sheet-body button, .sheet-foot .btn-primary') || dlg.querySelector('.sheet-head .icon-btn');
    if (first) first.focus({ preventScroll: true });
  });
  close.el = dlg;
  return close;
}

function confirmBox(msg, { ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    sheet({
      title: 'Please confirm',
      body: h('p', { class: 'confirm-msg' }, msg),
      actions: [
        { label: 'Cancel', fn: () => { answered = true; resolve(false); } },
        { label: ok, primary: !danger, danger, fn: () => { answered = true; resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

// ---------- header ----------
function renderNav() {
  const tabs = $('#tabs');
  // (data-tour: what the first-time tour lights, tour.js)
  tabs.innerHTML = DESKTOP_TABS.map(t => `<a href="#${t}" class="tab" data-tab="${t}" data-tour="tab-${t}" title="${TABS[t].label}">${icon(TABS[t].icon)}<span>${TABS[t].label}</span></a>`).join('');
  const bb = $('#bottombar');
  bb.innerHTML = PHONE_TABS.map(t => `<a href="#${t}" class="bb-tab" data-tab="${t}" data-tour="tab-${t}">${icon(TABS[t].icon)}<span class="bb-label">${TABS[t].label}</span>${t === 'check' ? '<span class="bb-badge" hidden></span>' : ''}</a>`).join('');
  $('#undo').innerHTML = icon('undo');
  $('#redo').innerHTML = icon('redo');
  $('#help').innerHTML = icon('help');
  $('#prevm').innerHTML = icon('left');
  $('#nextm').innerHTML = icon('right');
  $('#autofill').innerHTML = '<span class="lbl">Fill</span>';
}

function markTabs() {
  const active = app.tab === 'people' && isPhone() ? 'more' : app.tab;
  document.querySelectorAll('[data-tab]').forEach(a => {
    if (a.dataset.tab === active || (a.classList.contains('tab') && a.dataset.tab === app.tab)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

// Header parts are rewritten only when their text changes: it is redrawn after every edit, and rewriting the same
// markup still makes the browser restyle it (speed).
const headerSeen = new WeakMap();
function setHTML(el, html) { if (headerSeen.get(el) !== html) { el.innerHTML = html; headerSeen.set(el, html); } }

function renderCloudBtn() {
  const b = $('#cloudbtn');
  if (!b) return;
  b.hidden = !CS;
  if (!CS) return;
  const st = CS.headerState();
  b.dataset.state = st.kind;
  setHTML(b, `${icon('cloud')}<span class="cl-long">${esc(st.label)}</span><span class="cl-short" aria-hidden="true">${esc(st.short)}</span>${st.kind === 'unsaved' || st.kind === 'newer' || st.kind === 'both' ? '<i class="cl-dot" aria-hidden="true"></i>' : ''}`);
  b.title = st.title;
  b.setAttribute('aria-label', `Cloud: ${st.label}. ${st.title}`);
}

// The cloud panel (sign in, Save to cloud, Pull from cloud, who saved last and when, Earlier saves, members)
async function openCloud() {
  if (!CS) return;
  try {
    const mod = await import('./ui-team.js');
    const body = h('div');
    let view = null;
    sheet({ title: 'Cloud', body, wide: true, actions: [{ label: 'Close', primary: true }], onClose: () => { if (view && view.unmount) view.unmount(); renderCloudBtn(); } });
    view = mod.mountTeam(body, app, { onChange: renderCloudBtn });
  } catch (e) { console.error(e); toast('The cloud panel did not load. Check your connection and reload the page.', { kind: 'error' }); }
}

// which roster this browser is working on (the header switch): 'junior' or 'senior'
function viewPool() { const st = app.store && app.store.get(); return st && st.settings && st.settings.pool === 'senior' ? 'senior' : 'junior'; }

function renderHeader() {
  const state = app.store.get();
  const dept = state.settings?.dept || '';
  if ($('#dept').textContent !== dept) $('#dept').textContent = dept;
  const longM = M.fmtMonth(app.month);   // 'October 2026'; phones show 'Oct 2026'
  setHTML($('#month'), `<span class="m-long">${esc(longM)}</span><span class="m-short" aria-hidden="true">${esc(longM.slice(0, 3) + ' ' + app.month.slice(0, 4))}</span>`);
  $('#today').title = 'Go to today (' + M.fmtDay(M.iso(new Date())) + ')';
  const lk = $('#lockm'), isLocked = M.isMonthLocked(state, app.month), roster = M.POOL_LABEL[viewPool()];
  setHTML(lk, `${icon('lock')}<span class="lk-t">${isLocked ? 'Locked' : 'Lock'}</span>`);
  lk.setAttribute('aria-pressed', String(isLocked));
  lk.title = isLocked ? `${longM} is locked for the ${roster}: nothing in it can change. Press to unlock.` : `Lock ${longM} for the ${roster} so nothing in it can be changed by accident`;
  lk.setAttribute('aria-label', isLocked ? `${longM} locked for the ${roster}. Unlock` : `Lock ${longM} for the ${roster}`);
  document.body.classList.toggle('month-locked', isLocked);
  const u = $('#undo'), r = $('#redo');
  u.disabled = !app.store.canUndo();
  r.disabled = !app.store.canRedo();
  u.title = app.store.canUndo() ? `Undo ${app.store.undoLabel()} (Ctrl+Z)` : 'Nothing to undo';
  r.title = app.store.canRedo() ? `Redo ${app.store.redoLabel()} (Ctrl+Shift+Z)` : 'Nothing to redo';
  u.setAttribute('aria-label', app.store.canUndo() ? `Undo ${app.store.undoLabel()}` : 'Undo');
  r.setAttribute('aria-label', app.store.canRedo() ? `Redo ${app.store.redoLabel()}` : 'Redo');
  const pool = viewPool();
  setHTML($('#poolsw'), [['junior', 'Junior'], ['senior', 'Senior']].map(([k, l]) =>
    `<button type="button" class="pool-btn" data-pool="${k}" aria-pressed="${pool === k}" title="Work on the ${k} roster">${l}</button>`).join(''));
  const hasStaff = !!(state.staff || []).length;
  const ev = hasStaff ? evaluation() : EMPTY_EVAL();
  const p = $('#problems');
  // nothing to check or fill before there are staff (a fresh install): no green "No problems", no Auto-fill
  p.hidden = !hasStaff;
  $('#autofill').disabled = !hasStaff;
  $('#autofill').title = hasStaff ? 'Fill this month from the rules' : 'Add staff first (People)';
  const nFailed = (ev.failed || []).length;
  const bad = ev.hard || ev.error;
  p.className = 'problems ' + (bad ? 'has-hard' : 'is-ok');
  const hardTxt = ev.error ? 'Rule check failed' : ev.hard ? `${ev.hard} problem${ev.hard === 1 ? '' : 's'}` : 'No problems';
  const extra = nFailed ? `${nFailed} rule${nFailed === 1 ? '' : 's'} can't be checked` : ev.soft ? `${ev.soft} to improve` : '';
  setHTML(p, `${icon(bad ? 'alert' : 'ok')}<span class="p-hard">${hardTxt}</span>${extra ? `<span class="p-soft">${extra}</span>` : ''}`);
  p.setAttribute('aria-label', `${hardTxt}${extra ? `, ${extra}` : ''}. Open Check`);
  p.title = 'Rule check for ' + M.fmtMonth(app.month) + ': must-fix problems (hard rules) and things to improve (soft rules)';
  const bb = document.querySelector('.bb-badge');
  if (bb) { bb.hidden = !ev.hard; bb.textContent = ev.hard > 99 ? '99+' : String(ev.hard); }
  const bbTab = document.querySelector('.bb-tab[data-tab="check"]');
  if (bbTab) bbTab.setAttribute('aria-label', ev.hard ? `Check, ${ev.hard} problems` : 'Check');
  renderCloudBtn();
  markTabs();
}

// ---------- router ----------
const current = { tab: '', key: '', view: null, el: null };
let routing = Promise.resolve();

function parseHash() {
  const h = location.hash.replace(/^#/, '');
  let raw;
  try { raw = decodeURIComponent(h); } catch (e) { raw = h; }   // a stray % in a link must not stop the app
  const [t, q] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(q || ''));
  const tab = TABS[t] ? t : (isPhone() ? 'day' : 'roster');
  return { tab, params, key: raw };
}

// replace: change this history entry's address instead of adding one (the tour moves between tabs this way, so Back
// still means what it meant before the tour)
function go(tab, params = {}, { replace = false } = {}) {
  // a sheet just closed and its history entry is still being taken back: navigate once that has landed
  if (backPending) { const p = backPending; backPending = null; p.then(() => go(tab, params, { replace })); setTimeout(() => { if (backDone) { const r = backDone; backDone = null; r(); } }, 400); return; }
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  const hash = '#' + tab + (q ? '?' + q : '');
  if (location.hash === hash) route();
  else if (replace) { try { history.replaceState(history.state, '', hash); } catch (e) { /* ignore */ } route(); }
  else location.hash = hash;
}

// resolves once a closing sheet's history.back() has landed (a new history entry made before then would be taken
// back by it)
function settled() {
  return backPending ? Promise.race([backPending, new Promise(r => setTimeout(r, 450))]) : Promise.resolve();
}

function route() {
  routing = routing.then(doRoute).catch(e => console.error(e));
  return routing;
}

async function doRoute() {
  const { tab, params, key } = parseHash();
  app.params = params;
  const pm = monthFromParams(params);
  if (pm && pm !== app.month) { app.month = pm; app.store.ensureLocked(pm); evalCache = null; }
  const sameTab = tab === current.tab && current.view;
  app.tab = tab;
  renderHeader();
  if (sameTab && typeof current.view.route === 'function') {   // my views take new params without remounting
    current.key = key;
    try { current.view.route(params); } catch (e) { console.error(e); }
    renderGuide();   // (the checklist isn't shown over one person's month)
    return;
  }
  unmountView();
  current.tab = tab; current.key = key;
  const main = $('#main');
  main.innerHTML = '';
  main.dataset.tab = tab;
  document.body.dataset.tab = tab;
  const state = app.store.get();
  guideSlot = null;
  if (!(state.staff || []).length && (tab === 'roster' || tab === 'day' || tab === 'check')) {
    // the first screen of an empty roster: a welcome with the Getting started checklist (guide.js)
    if (G) {
      const w = G.welcomeScreen(app);
      main.append(w.el);
      guideSlot = w.slot; guideWelcome = true;
      renderGuide();
    } else main.append(welcomeCard());
    current.view = { welcome: true };
    return;
  }
  const el = h('div', { class: `view view-${tab}` });
  if (tab === 'more' && isPhone()) el.append(phoneMoreLinks());
  // your own roster: Getting started sits above the grid until it is hidden or finished (and above Day on a phone,
  // where the app opens)
  if ((tab === 'roster' || (tab === 'day' && isPhone())) && !app.isDemo && G) { guideSlot = h('div', { class: 'guide-slot', hidden: true }); guideWelcome = false; el.append(guideSlot); }
  const host = h('div', { class: 'view-host' });
  el.append(host);
  main.append(el);
  renderGuide();
  current.el = el;
  let mod;
  try {
    mod = await import(TABS[tab].mod);
  } catch (e) {
    console.warn(`Could not load ${TABS[tab].mod}`, e);
    if (current.tab !== tab) return;
    host.append(placeholder(tab));
    current.view = { placeholder: true };
    return;
  }
  if (current.tab !== tab || current.el !== el) return;   // the person moved on while it loaded
  const mount = mod.mount || mod.default?.mount;
  if (typeof mount !== 'function') { host.append(placeholder(tab)); current.view = { placeholder: true }; return; }
  try {
    current.view = (await mount(host, app)) || {};
  } catch (e) {
    console.error(`${tab} failed to mount`, e);
    host.innerHTML = '';
    host.append(placeholder(tab, e));
    current.view = { placeholder: true };
  }
}

function unmountView() {
  if (current.view && typeof current.view.unmount === 'function') {
    try { current.view.unmount(); } catch (e) { console.error(e); }
  }
  current.view = null; current.el = null;
}

function placeholder(tab, err) {
  return h('div', { class: 'card empty-card' },
    h('div', { class: 'empty-ic', html: icon(TABS[tab].icon) }),
    h('h2', null, `${TABS[tab].label} isn't ready yet`),
    h('p', null, err ? 'Something went wrong while opening this screen. Your roster is safe; try reloading the page.'
      : 'This part of NTF Roster is still being built. Your roster is safe; the other screens work.'),
    h('p', null, h('a', { href: '#roster', class: 'btn btn-ghost' }, 'Back to the roster')));
}

function phoneMoreLinks() {
  return h('a', { href: '#people', class: 'card link-card' },
    h('span', { class: 'lc-ic', html: icon('people') }),
    h('span', { class: 'lc-text' }, h('strong', null, 'People'), h('span', null, 'Staff, groups, tags and duty codes')),
    h('span', { class: 'lc-go', html: icon('right') }));
}

function welcomeCard() {
  return h('div', { class: 'welcome' },
    h('div', { class: 'card welcome-card' },
      h('div', { class: 'empty-ic', html: icon('grid') }),
      h('h2', null, 'Welcome to NTF Roster'),
      h('p', null, 'Plan the monthly calls, PM shifts and clinics together with leave and requests, check them against your rules, and fill the gaps automatically.'),
      h('p', { class: 'muted' }, 'Start by bringing in the department list. Everything stays in this browser until team sync is set up.'),
      // the next steps, in order; the default rules are already on, with numbers that are guesses
      h('ol', { class: 'welcome-steps' },
        h('li', null, 'Add your staff (import the Excel sheet, or add them under People).'),
        h('li', null, 'Enter leave and requests on the roster (the Excel import brings them in too).'),
        h('li', null, `Check the rules: ${(app.store.get().rules || []).filter(r => r.enabled !== false).length} default rules are already on, and their numbers (calls a month, people on call each night) are guesses.`),
        h('li', null, 'Press Auto-fill, look at the preview, then Apply.')),
      h('div', { class: 'welcome-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => go('more'), html: `${icon('upload')}<span>Import Excel sheet</span>` }),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => go('people'), html: `${icon('plus')}<span>Add staff</span>` }),
        h('a', { class: 'btn btn-ghost', href: './?demo', target: '_blank', rel: 'noopener', html: `${icon('eye')}<span>Try the practice department</span>` }))));
}

// ---------- first-time help (guide.js) ----------
let guideSlot = null, guideWelcome = false;
function renderGuide() {
  if (!G || !guideSlot || !guideSlot.isConnected) return;
  try { G.renderChecklist(app, guideSlot, { welcome: guideWelcome }); } catch (e) { console.error(e); }
}
// A Getting started tick the data can't show (the duty codes looked at, a rule opened, an export or backup made):
// kept in settings.onboarding, not an undo step. Only for your own roster.
function onboard(key) {
  if (app.isDemo || !app.store || typeof app.store.mark !== 'function') return;
  app.store.mark({ [key]: true });
}

// ---------- bars ----------
function renderDemoBar() {
  const bar = $('#demobar');
  if (!app.isDemo && window.NTF_MOVED_TO) { movedBar(bar); return; }
  if (!app.isDemo) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = '';
  bar.append(
    h('span', { class: 'demo-pill' }, 'Practice'),
    h('span', { class: 'demo-text' }, '(made-up department)', h('span', { class: 'demo-long' }, '. Changes stay in this browser.')),
    h('button', { type: 'button', class: 'linkish', onclick: resetDemo }, 'Reset'),
    h('a', { class: 'linkish', href: './', 'aria-label': 'Leave practice' }, h('span', { class: 'demo-leave' }, 'Leave practice'), h('span', { class: 'demo-leave-s', 'aria-hidden': 'true' }, 'Leave')));
}

// The old address (anawj.com/ntf-roster/) with a roster saved in this browser: sign-in works only at the new one, and
// what is saved here stays here. Download a backup, then Restore from a backup at the new address.
function movedBar(bar) {
  const go = () => { try { localStorage.setItem('ntf-roster-moved', '1'); } catch (e) { /* no storage */ } location.replace(window.NTF_MOVED_TO); };
  const backup = async () => {
    const io = await import('./io.js');
    io.download(new Blob([io.backupJSON(app.store.get())], { type: 'application/json' }), `ntf-roster-backup-${M.iso(new Date())}.json`);
  };
  bar.hidden = false;
  bar.innerHTML = '';
  bar.append(
    h('span', { class: 'demo-pill' }, 'Moved'),
    h('span', { class: 'demo-text' }, 'The roster is now at ntfroster.anawj.com (sign-in works there). Download a backup, then use Restore from a backup in More there.'),
    h('button', { type: 'button', class: 'linkish', onclick: backup }, 'Download backup'),
    h('button', { type: 'button', class: 'linkish', onclick: go }, 'Go'));
}

async function resetDemo() {
  if (!(await confirmBox('Start the practice department again? Your practice changes will be replaced.', { ok: 'Reset practice' }))) return;
  let fresh = M.defaultState();
  try { const d = await import('./demo.js'); fresh = d.demoState(M.iso(new Date())); } catch (e) { /* default state */ }
  app.store.replace(fresh, 'Reset practice');
  toast('Practice department reset', { action: { label: 'Undo', fn: () => app.store.undo() } });
}

function showSaveError() {
  const bar = $('#savebar');
  bar.hidden = false;
  bar.innerHTML = '';
  bar.append(
    h('span', null, 'This browser is out of storage space, so the last change was not saved.'),
    h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: downloadBackup }, 'Download backup'),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Dismiss', html: icon('close'), onclick: () => { bar.hidden = true; } }));
}

// The saved roster couldn't be read: it is kept aside, and nothing is saved over it until the person chooses.
function showDamaged() {
  const bar = $('#savebar');
  const dmg = app.store.damaged;
  bar.hidden = false;
  bar.innerHTML = '';
  const download = () => {
    const blob = new Blob([dmg.raw], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `ntf-roster-damaged-${M.iso(new Date())}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  bar.append(
    h('span', null, 'The roster saved in this browser is damaged and could not be opened. Nothing will be saved over it until you choose.'),
    h('button', { type: 'button', class: 'btn btn-sm', onclick: download }, 'Download damaged copy'),
    h('button', {
      type: 'button', class: 'btn btn-sm btn-danger', onclick: async () => {
        const ok = await confirmBox('Start again here? The damaged copy is replaced by what you see now. Download it first if you may need it.', { ok: 'Start again' });
        if (!ok) return;
        app.store.clearDamaged();
        bar.hidden = true;
      },
    }, 'Start again'));
}

function downloadBackup() {
  const blob = new Blob([JSON.stringify({ kind: 'ntf-roster-backup', v: 1, state: app.store.get() }, null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `ntf-roster-backup-${M.iso(new Date())}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- shortcuts ----------
function shortcutsSheet() {
  const rows = [
    ['Ctrl/⌘ + Z', 'Undo'], ['Ctrl/⌘ + Shift + Z, Ctrl + Y', 'Redo'], ['[ and ]', 'Previous / next month'],
    ['Arrow keys', 'Move around the roster'], ['Type a code, then Enter', 'Add or remove that code (e.g. AL ⏎)'],
    ['Enter', 'Open the cell editor'], ['Delete', 'Clear the cell'], ['Esc', 'Close the editor, forget a typed code'], ['?', 'This list'],
  ];
  const tbl = h('table', { class: 'kbd-table' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, h('kbd', null, k)), h('td', null, v)))));
  sheet({ title: 'Keyboard shortcuts', body: tbl, actions: [{ label: 'Close', primary: true }] });
}

function isTyping(el) {
  return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function onKeydown(e) {
  if (document.body.classList.contains('touring')) return;   // (the tour's dialog is open: no undo behind it)
  const mod = e.ctrlKey || e.metaKey;
  if (document.querySelector('.sheet-back') && !mod) return;
  if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
    if (isTyping(e.target)) return;
    e.preventDefault();
    if (e.shiftKey) doRedo(); else doUndo();
    return;
  }
  if (mod && (e.key === 'y' || e.key === 'Y')) { if (isTyping(e.target)) return; e.preventDefault(); doRedo(); return; }
  if (mod || e.altKey || isTyping(e.target)) return;
  if (e.key === '[') { e.preventDefault(); setMonth(M.addMonths(app.month, -1)); }
  else if (e.key === ']') { e.preventDefault(); setMonth(M.addMonths(app.month, 1)); }
  else if (e.key === '?') { e.preventDefault(); shortcutsSheet(); }
}

// Today: this month, with today's column (roster) or today (day view) in view.
function goToday() {
  const today = M.iso(new Date());
  app.selectedCell = { date: today, staffId: null };
  if (app.month !== thisMonth()) { setMonth(thisMonth()); return; }
  if (current.view && typeof current.view.update === 'function') {
    try { current.view.update(app.store.get(), { month: true }); } catch (e) { console.error(e); }
  }
}

function doUndo() {
  const label = app.store.undo();
  app.store.ensureLocked(app.month);
  if (label) toast(`Undone: ${label}`, { action: { label: 'Redo', fn: doRedo }, ms: 3000 });
}
function doRedo() {
  const label = app.store.redo();
  app.store.ensureLocked(app.month);
  if (label) toast(`Redone: ${label}`, { ms: 2500 });
}

async function openAutofill() {
  if (M.isMonthLocked(app.store.get(), app.month)) { toast(`${M.fmtMonth(app.month)} is locked for the ${M.POOL_LABEL[viewPool()]}. Unlock it (the padlock at the top) to use Fill.`, { kind: 'warn', ms: 7000 }); return; }
  try {
    const mod = await import('./ui-roster.js');
    mod.openAutofill(app);
  } catch (e) {
    console.error(e);
    toast('Auto-fill could not start. Try reloading the page.', { kind: 'error' });
  }
}

// ---------- start ----------
function fatal(msg) {
  const main = $('#main');
  main.innerHTML = '';
  main.append(h('div', { class: 'card empty-card' }, h('h2', null, 'NTF Roster could not start'), h('p', null, msg)));
}

async function start() {
  const demo = new URLSearchParams(location.search).has('demo');
  // Ask for every module the first screen needs at once, not one after another (each is a round trip on a slow
  // line): the model, rules, store, the practice department and the first screen's own view (from the link; phones
  // open on Day). Each is still awaited, and handled, where it was before.
  const quiet = p => { p.catch(() => {}); return p; };
  const pJ = quiet(import('./jpool.js')), pM = quiet(import('./model.js')), pR = quiet(import('./rules.js')), pS = quiet(import('./store.js'));
  const pD = demo ? quiet(import('./demo.js')) : null;
  const pG = quiet(import('./guide.js'));
  quiet(import('./tour.js'));   // (guide.js needs it: fetched side by side, not after it)
  quiet(import((TABS[location.hash.replace(/^#/, '').split('?')[0]] || TABS[isPhone() ? 'day' : 'roster']).mod));
  try {
    M = await pM;
  } catch (e) {
    console.error(e);
    fatal('A part of the app did not load. Check your connection and reload the page.');
    return;
  }
  try { J = await pJ; } catch (e) { console.warn('jpool.js not loaded; the pool switch only hides rows', e); }
  try { R = await pR; } catch (e) { console.warn('rules.js not loaded; rule checks are off', e); }
  try { G = await pG; } catch (e) { console.warn('guide.js not loaded; no first-time help', e); }
  app.model = M; app.rules = R;
  app.isDemo = demo;
  let demoState = null;
  if (demo) {
    try { ({ demoState } = await pD); } catch (e) { console.warn('demo.js not loaded; starting empty', e); }
  }
  const { createStore } = await pS;
  app.store = createStore({
    demo,
    fallback: () => (demo && typeof demoState === 'function' ? demoState(M.iso(new Date())) : M.defaultState()),
  });
  app.store.onSaveError = showSaveError;
  // the cloud button in the header (not in practice, and not until Firebase is set up)
  try {
    const cloudMod = await import('./cloud.js');
    if (cloudMod.enabled && !demo) CS = await import('./cloudstate.js');
  } catch (e) { console.warn('cloud.js not loaded; no cloud button', e); }
  app.store.onLocked = (months, label, hits) => {
    const x = (hits && hits[0]) || { m: months[0], pool: viewPool() };
    toast(x.pool === viewPool()
      ? `${M.fmtMonth(x.m)} is locked for the ${M.POOL_LABEL[x.pool]}, so nothing was changed. Press the padlock at the top to unlock it first.`
      : `That would change the ${M.POOL_LABEL[x.pool]}, which is locked for ${M.fmtMonth(x.m)}. Nothing was changed.`, { kind: 'warn', ms: 7000 });
  };
  if (app.store.damaged) showDamaged();
  if (demo) document.title = 'NTF Roster (practice)';

  // Month on screen: the hash (?m=), else this month.
  const hp = parseHash().params;
  // last month seen on this device (owner, 20 Oct 2026), else this month
  let seen = '';
  try { const o = JSON.parse(localStorage.getItem('ntf-roster-ui-month') || 'null'); if (o && validMonth(o.m)) seen = o.m; } catch (e) { /* none */ }
  app.month = monthFromParams(hp) || seen || thisMonth();
  app.store.lockAll();
  // closing the app locks everything again (a reopened phone app may not reload the page, so this also runs as it goes away)
  window.addEventListener('pagehide', () => { try { app.store.lockAll(); } catch (e) { /* closing anyway */ } });
  app.store.ensureLocked(app.month);

  renderNav();
  renderDemoBar();
  renderHeader();

  $('#undo').addEventListener('click', doUndo);
  $('#redo').addEventListener('click', doRedo);
  $('#help').addEventListener('click', () => (G ? G.openHelp(app) : shortcutsSheet()));
  $('#prevm').addEventListener('click', () => setMonth(M.addMonths(app.month, -1)));
  $('#nextm').addEventListener('click', () => setMonth(M.addMonths(app.month, 1)));
  $('#today').addEventListener('click', goToday);
  // unlocking asks nothing: the toast offers Undo, which locks it again
  $('#lockm').addEventListener('click', () => {
    const st = app.store.get(), m = app.month, locked = M.isMonthLocked(st, m);
    const roster = M.POOL_LABEL[viewPool()];
    app.store.commit(`${locked ? 'Unlock' : 'Lock'} ${M.fmtMonth(m)} (${roster})`, draft => { M.setMonthLocked(draft, m, !locked); });
    toast(locked ? `${M.fmtMonth(m)} is unlocked for the ${roster}.` : `${M.fmtMonth(m)} is locked for the ${roster}: nothing in it can change until you unlock it. The other roster is not affected.`, { kind: 'ok', ms: 4000, action: locked ? { label: 'Lock again', fn: () => app.store.undo() } : undefined });
  });
  $('#poolsw').addEventListener('click', e => {
    const b = e.target.closest('[data-pool]');
    if (!b || !app.store) return;
    const k = b.dataset.pool;
    if (viewPool() === k) return;
    app.store.commit(`Work on the ${k} roster`, d => { d.settings.pool = k; });
  });
  $('#autofill').addEventListener('click', openAutofill);
  $('#cloudbtn').addEventListener('click', openCloud);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('hashchange', route);

  let wasPhone = isPhone();
  window.matchMedia(PHONE_MQ).addEventListener('change', () => {
    const now = isPhone();
    if (now === wasPhone) return;
    wasPhone = now;
    markTabs();
    if (current.view && typeof current.view.update === 'function') current.view.update(app.store.get(), { resize: true });
    renderGuide();
  });

  app.store.subscribe((state, info) => {
    // a Getting started tick (settings.onboarding) changes nothing the rule check or the screens show
    if (info && info.source === 'mark') {
      if (evalCache) evalCache.state = state;
      renderGuide();
      return;
    }
    evalCache = null;
    // the pool switch is this browser's own view, not part of the shared roster
    if (CS && info && info.source !== 'external' && !/^Show (all staff|the \w+ pool)$/.test(info.label || '')) CS.noteChange();
    clearErrorToasts();
    if (info && info.source === 'external') toast(info.label, { kind: /^Not saved/.test(info.label) ? 'error' : 'ok' });
    renderHeader();
    if (current.view?.welcome && (state.staff || []).length) { route(); return; }
    if (current.view && typeof current.view.update === 'function') {
      try { current.view.update(state, info); } catch (e) { console.error(e); }
    }
    renderGuide();
  });

  await route();
  document.body.classList.add('ready');
  // has someone saved to the cloud since this browser last did? (quiet; only once the cloud has been used here)
  if (CS && CS.read().synced) {
    let lastCheck = 0;
    const check = () => {
      if (Date.now() - lastCheck < 60000) return;
      lastCheck = Date.now();
      import('./ui-team.js').then(m => m.checkCloud(app)).then(renderCloudBtn).catch(() => {});
    };
    setTimeout(check, 4000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  }
  window.ntfApp = app;   // handy in the console and for browser tests

  // Practice: the tour opens by itself once per device (Not now is right there). Links from your own roster's Help ask
  // for the tour (?demo&tour) or the guided tasks (?demo&try); the extra word comes off the address straight away.
  if (demo && G) {
    const q = new URLSearchParams(location.search);
    const wantTour = q.has('tour'), wantTry = q.has('try');
    if (wantTour || wantTry) { try { history.replaceState(history.state, '', location.pathname + '?demo' + location.hash); } catch (e) { /* ignore */ } }
    let seen = true;
    try { seen = (await import('./tour.js')).tourDone(); } catch (e) { /* no tour */ }
    if (wantTry) G.startTasks(app);
    else if (wantTour || !seen) G.takeTour(app);
  }

  // Offline app shell (sw.js): a new version takes over at once and the page reloads once (version.js).
  import('./unsent.js').then(m => m.start()).catch(e => console.warn('unsent.js not loaded', e));
  import('./version.js')
    .then(m => m.registerSW())
    .catch(e => console.warn('version.js not loaded', e));
}

start();
