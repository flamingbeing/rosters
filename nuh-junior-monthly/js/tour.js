// NUH Junior Monthly: the interface tour (coach marks), like the NUH roster's Practice tour. One step at a time, the real
// controls are lit through cut-outs in a dimmed layer, with a card beside them: Back, Next, Skip and "3 of 10".
// Keys: → or Enter next, ← back, Esc skips. Phone Back ends it too (the tour has its own history entry).
// Also showMe(): a passive spotlight for the "Show me" buttons in guide.js (taps go through to the page).
//
// The steps are data (TOUR_STEPS below), so they are easy to change:
//   { id, title, text, target?, tab?, maxH?, count?, only?, phone?: {…}, laptop?: {…} }
// - target: the value of a data-tour="…" attribute, or a list of them. The first is the step's own control (the
//   step is skipped when it isn't on screen: no staff yet, say); the others are lit too when they are there (the
//   tab that leads to it). Every visible element with that value is lit as one cut-out.
// - tab: the tab to open first (the tour goes back to where it started at the end).
// - maxH: light only the top part of a tall target (the grid).
// - phone / laptop: fields that replace the step's own at that size (phone = app.isPhone(), up to 720 px).
// - title and text may be functions of the app (practice-only words).
// - count: false for the welcome and the last card (no "3 of 10").
// - only: 'laptop' or 'phone' for a step that is only at that size (People is a header tab on a laptop).
// Seen or skipped is kept per device in localStorage 'nuhjm-tour' = { v, done }: bump TOUR_V to show a changed
// tour to everyone again. The tour only points: it never changes the roster.

export const TOUR_V = 1;
const KEY = 'nuhjm-tour';
const hardCount = app => { try { return (app.evaluation() || {}).hard || 0; } catch (e) { return 0; } };
const STOP_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
// how many counted stops this size has (the words on the welcome card)
const stops = app => {
  const n = TOUR_STEPS.filter(s => s.count !== false && (!s.only || s.only === (app.isPhone() ? 'phone' : 'laptop'))).length;
  return STOP_WORDS[n] || String(n);
};

export const TOUR_STEPS = [
  { id: 'intro', count: false, title: 'A one-minute tour',
    text: app => app.isDemo
      ? `This is the practice department: made-up people with leave, requests and the starting rules. ${stops(app)} quick stops show where everything is. Nothing here reaches your own roster.`
      : `${stops(app)} quick stops show where everything is. The tour only points: it changes nothing.` },
  { id: 'month', tab: 'roster', target: 'month', title: 'Switch month',
    text: 'The arrows change month; Today comes back to this month.',
    laptop: { text: 'The arrows change month (or the [ and ] keys); Today comes back to this month.' } },
  { id: 'grid', tab: 'roster', target: 'grid', maxH: 210, title: 'The roster',
    text: 'One row per person and one column per day, like the department sheet. Tap a cell to open its editor: duties, leave, requests, a note and a lock.',
    laptop: { text: 'One row per person and one column per day, like the department sheet. Click a cell to open its editor, or use the arrow keys and type a code (AL, then Enter).' } },
  { id: 'paint', tab: 'roster', target: 'paint', title: 'Paint',
    text: 'For blocks of leave: pick a code (AL, say), then tap cell after cell. Done painting ends it.',
    laptop: { text: 'For blocks of leave: pick a code (AL, say), then drag across the days. Done painting ends it.' } },
  { id: 'layers', tab: 'roster', target: 'layers', title: 'Requests and the key',
    text: 'Requests (Cr, Nc, Wr…) are outlined chips: what someone asked for, not what they are doing. Requests shows or hides them; Key explains every mark in the grid.' },
  { id: 'problems', tab: 'roster', target: 'problems', title: 'Problems',
    text: app => hardCount(app)
      ? 'Must-fix problems this month: hard rules that are broken. A red ring marks each cell; this opens the full list.'
      : 'Must-fix problems show here: hard rules that are broken. This month has none; when it does, a red ring marks each cell and this opens the list.',
    phone: { target: 'tab-check', text: app => hardCount(app)
      ? 'The number on Check counts this month\'s must-fix problems: hard rules that are broken. A red ring in the grid marks each cell.'
      : 'Check lists the month\'s problems. Must-fix ones (hard rules that are broken) put a number on Check and a red ring on the cell; this month has none.' } },
  { id: 'autofill', tab: 'roster', target: 'autofill', title: 'Auto-fill',
    text: 'Drafts the calls and PM shifts around leave and requests, from your rules. You see a preview first, and Apply can be undone.' },
  { id: 'check', tab: 'check', target: ['check', 'tab-check'], title: 'Check',
    text: 'How the month stands: problems by rule (Show finds the cell), who does how many (Fairness), and cover day by day.' },
  { id: 'day', tab: 'day', target: ['day', 'tab-day'], title: 'Day view',
    text: 'One day at a time: who is on what, who is away, requests and notes.',
    phone: { text: 'One day at a time: who is on what, who is away, requests and notes. Phones open here.' } },
  { id: 'people', tab: 'people', target: 'tab-people', only: 'laptop', title: 'People',
    text: 'The staff list, junior and senior groups, and the duty codes with their colours. Add or import names here first.' },
  { id: 'rules', tab: 'rules', target: ['addrule', 'tab-rules'], title: 'Rules are yours to change',
    text: 'Every rule is listed here, on or off. Add rule › Combination restriction covers what can\'t go together: Call and Clinic on one day, or two people never on call together.' },
  { id: 'backup', tab: 'more', target: ['backup', 'tab-more'], title: 'Backup and sharing',
    text: app => app.isDemo
      ? 'Your own roster lives in its browser: download a backup now and then. Import and Export (Excel, calendar files, printing) are further up this screen. The cloud is off in practice.'
      : 'This roster lives in this browser: download a backup now and then. Import and Export (Excel, calendar files, printing) are further up this screen. The cloud stays off until it is set up.',
    phone: { text: app => (app.isDemo ? 'Your own roster lives in its browser: download a backup now and then. ' : 'This roster lives in this browser: download a backup now and then. ')
      + 'Import and Export are further up this screen, and People (staff and duty codes) is at the top.' } },
  { id: 'end', count: false, target: 'tab-more', title: 'That\'s the tour',
    text: app => app.isDemo
      ? 'Try three short tasks next, or look around on your own. More › Help has the tour again.'
      : 'More › Help has the tour again, three practice tasks and the keyboard shortcuts.' },
];

// ---------- seen / skipped, per device ----------
export function tourDone() {
  try { const t = JSON.parse(localStorage.getItem(KEY) || 'null'); return !!(t && t.v === TOUR_V && t.done); } catch (e) { return false; }
}
export function setTourDone(done = true) {
  try { localStorage.setItem(KEY, JSON.stringify({ v: TOUR_V, done: !!done })); } catch (e) { /* private mode: it shows again next time */ }
}

// ---------- shared helpers ----------
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Keyboard or pointer, last used: the card's Next takes focus (with its ring) only for keyboard use; after a tap or
// when the tour opens by itself the card itself takes it, so phones don't show a heavy ring on every step.
let viaKeys = false;
try {
  document.addEventListener('keydown', e => { if (!e.ctrlKey && !e.metaKey) viaKeys = true; }, true);
  document.addEventListener('pointerdown', () => { viaKeys = false; }, true);
} catch (e) { /* no document (unit tests) */ }
const SVGNS = 'http://www.w3.org/2000/svg';
function el(tag, cls, attrs = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// every element with data-tour="name" that is on screen (inside display: none it has no box)
export function visibleTargets(name) {
  return [...document.querySelectorAll(`[data-tour="${name}"]`)].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  });
}
// wait (a frame at a time) for a target to appear after a tab switch; [] when it never does
function waitTargets(name, ms) {
  return new Promise(resolve => {
    const t0 = performance.now();
    (function look() {
      const found = visibleTargets(name);
      if (found.length || performance.now() - t0 > ms) resolve(found);
      else requestAnimationFrame(look);
    })();
  });
}
function unionRect(els) {
  let r = null;
  for (const e of els) {
    const b = e.getBoundingClientRect();
    r = r ? { left: Math.min(r.left, b.left), top: Math.min(r.top, b.top), right: Math.max(r.right, b.right), bottom: Math.max(r.bottom, b.bottom) }
      : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  }
  return r;
}
// the screen's content area: below the header, above the phone's tab bar
function contentBox() {
  const m = document.getElementById('main');
  const r = m ? m.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  return { top: Math.max(0, r.top), bottom: Math.min(window.innerHeight, r.bottom) };
}
// Bring the targets into view: a chip at the end of the sideways tool row, a section far down More. On a phone the
// card docks at the bottom, so a target in the content goes to the top of the screen.
function reveal(els, phone, cardRoom = 0, maxH = 0) {
  if (!els.length) return;
  const r = unionRect(els), vw = window.innerWidth, box = contentBox();
  const last = els[els.length - 1];
  try {
    if (r.left < 0 || r.right > vw) last.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const inMain = document.getElementById('main')?.contains(els[0]);
    const r2 = unionRect(els);
    const bottom = maxH ? Math.min(r2.bottom, r2.top + maxH) : r2.bottom;
    if (inMain && (r2.top < box.top || bottom > box.bottom - cardRoom)) els[0].scrollIntoView({ block: phone ? 'start' : 'nearest', inline: 'nearest' });
    // in a window (Show me in the rule builder, say): to the middle of its scrolling body
    else if (!inMain && els[0].closest('.sheet-body')) {
      const sb = els[0].closest('.sheet-body').getBoundingClientRect();
      if (r2.top < sb.top || r2.bottom > sb.bottom) els[0].scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  } catch (e) { /* old browsers: leave it */ }
}
// one cut-out: the elements plus a little room, kept on screen (only the top of a tall one)
function holeOf(els, maxH) {
  const r = unionRect(els);
  if (!r) return null;
  const pad = 6, vw = window.innerWidth, vh = window.innerHeight;
  const left = Math.max(3, r.left - pad), top = Math.max(3, r.top - pad);
  const right = Math.min(vw - 3, r.right + pad);
  let bottom = Math.min(vh - 3, r.bottom + pad);
  if (maxH && bottom - top > maxH) {
    bottom = top + maxH;
    // end on a row boundary, not through someone's name
    let snap = 0;
    for (const tr of els[0].querySelectorAll('tbody tr')) {
      const b = tr.getBoundingClientRect().bottom + 2;
      if (b > bottom) break;
      if (b > top + 40) snap = b;
    }
    if (snap) bottom = snap;
  }
  if (right - left < 4 || bottom - top < 4) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

// The dim layer: an SVG path covering the screen with a cut-out per hole (even-odd fill), and a blue ring around
// each hole. NUHS: square corners except the 5 px of a control.
function makeDim(cls) {
  const wrap = el('div', cls, { 'aria-hidden': 'true' });
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'tour-dim');
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  wrap.append(svg);
  let rings = [], cur = [], anim = 0;
  const R = 5;
  function rr({ x, y, w, h }) {
    const r = Math.min(R, w / 2, h / 2);
    return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  }
  function draw(holes) {
    const vw = window.innerWidth, vh = window.innerHeight;
    svg.setAttribute('width', vw); svg.setAttribute('height', vh); svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    path.setAttribute('d', `M0 0H${vw}V${vh}H0Z` + holes.map(rr).join(''));
    while (rings.length < holes.length) { const g = el('div', 'tour-ring'); wrap.append(g); rings.push(g); }
    while (rings.length > holes.length) rings.pop().remove();
    holes.forEach((hl, i) => {
      const g = rings[i];
      g.style.transform = `translate(${hl.x}px, ${hl.y}px)`;
      g.style.width = hl.w + 'px';
      g.style.height = hl.h + 'px';
    });
  }
  // glide from the last holes to the new ones (same count only), unless motion is reduced
  function set(holes) {
    cancelAnimationFrame(anim);
    const from = cur;
    cur = holes;
    if (reduced() || !from.length || from.length !== holes.length) { draw(holes); return; }
    const t0 = performance.now(), ms = 220;
    const ease = t => 1 - Math.pow(1 - t, 3);
    (function frame(now) {
      const t = Math.min(1, (now - t0) / ms), k = ease(t);
      draw(holes.map((b, i) => {
        const a = from[i];
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k };
      }));
      if (t < 1) anim = requestAnimationFrame(frame);
    })(t0);
  }
  return { el: wrap, set, stop: () => cancelAnimationFrame(anim) };
}

// ---------- the tour ----------
let active = null;
let tourSeq = 0;
export function tourRunning() { return !!active; }
export function stopTour() { if (active) active.stop('skip'); }

// startTour(app, { steps, finish: { label, fn }, onEnd(reason) }): reason 'done' or 'skip'. finish adds a button to the
// last card (practice: "Try it yourself").
export async function startTour(app, { steps = TOUR_STEPS, finish = null, onEnd } = {}) {
  if (active) active.stop('replaced');
  const my = ++tourSeq;
  const returnFocus = document.activeElement;
  const ret = returnFocus && returnFocus.dataset ? returnFocus.dataset.tourReturn : '';
  // a sheet that just closed may still be taking its history entry back: start once that has landed
  if (typeof app.settled === 'function') await app.settled();
  if (my !== tourSeq) return null;

  const skipped = new Set();
  let cur = -1, want = 0, seq = 0, step = null, groups = [], ended = false, popped = false, wasPhone = null;
  const phone = () => app.isPhone();
  const fits = s => !s.only || s.only === (phone() ? 'phone' : 'laptop');

  // the layer: a shade that takes every tap, the dim with its cut-outs, the card and a live region
  const root = el('div', 'tour', { 'data-tour-layer': '' });
  const shade = el('div', 'tour-shade');
  const dim = makeDim('tour-holes');
  const card = el('div', 'tour-card', { tabindex: '-1', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title', 'aria-describedby': 'tour-text' });
  const live = el('p', 'sr-only', { 'aria-live': 'polite' });
  const prog = el('div', 'tour-prog', { 'aria-hidden': 'true' });
  const progFill = el('span');
  prog.append(progFill);
  const top = el('div', 'tour-top');
  const count = el('p', 'tour-count');
  const skipBtn = el('button', 'linkish tour-skip', { type: 'button' });
  top.append(count, skipBtn);
  const title = el('h2', 'tour-title', { id: 'tour-title' });
  const text = el('p', 'tour-text', { id: 'tour-text' });
  const foot = el('div', 'tour-foot');
  const backBtn = el('button', 'btn btn-ghost btn-sm tour-back', { type: 'button' });
  backBtn.textContent = 'Back';
  const extraBtn = el('button', 'btn btn-ghost btn-sm tour-extra', { type: 'button' });
  const nextBtn = el('button', 'btn btn-primary btn-sm tour-next', { type: 'button' });
  foot.append(backBtn, extraBtn, nextBtn);
  card.append(prog, top, title, text, foot);
  root.append(shade, dim.el, card, live);
  root.classList.toggle('is-still', reduced());
  document.body.append(root);
  document.body.classList.add('touring');

  // its own history entry: the phone's Back button ends the tour; at the end it is taken back, which also brings
  // back the screen the tour started on (tab switches during the tour replace this entry's address)
  const tid = Date.now();
  try { history.pushState({ ...(history.state || {}), jmTour: tid }, ''); } catch (e) { /* ignore */ }
  const onPop = () => { if (!ended && !(history.state && history.state.jmTour === tid)) { popped = true; stop('skip'); } };
  window.addEventListener('popstate', onPop);

  const counted = () => steps.map((s, i) => i).filter(i => steps[i].count !== false && fits(steps[i]) && !skipped.has(i));
  // focus for the card: Next for keyboard use, else the card itself (no ring after a tap)
  const focusCard = () => (viaKeys ? nextBtn : card).focus({ preventScroll: true });
  const variant = s => {
    const v = { ...s, ...((phone() ? s.phone : s.laptop) || {}) };
    for (const k of ['title', 'text']) if (typeof v[k] === 'function') v[k] = v[k](app);
    v.targets = v.target ? [].concat(v.target) : [];
    return v;
  };

  async function show(i, dir = 1) {
    const mine = ++seq;
    if (i < 0) i = 0;
    if (i >= steps.length) { stop('done'); return; }
    want = i;   // (Next and Back count from here while a step is still loading)
    if (!fits(steps[i])) { show(i + dir, dir); return; }
    wasPhone = phone();
    const s = variant(steps[i]);
    let moved = false;
    if (s.tab && (app.tab !== s.tab || (s.tab === 'roster' && app.params && app.params.p))) { app.go(s.tab, {}, { replace: true }); moved = true; }
    let found = [];
    if (s.targets.length) {
      // a tab switch may take a moment to draw (its module loads); otherwise the control is there or it isn't
      const first = await waitTargets(s.targets[0], moved ? 2000 : 400);
      if (mine !== seq || ended) return;
      if (!first.length) { skipped.add(i); show(i + dir, dir); return; }
      found = [first, ...s.targets.slice(1).map(visibleTargets).filter(g => g.length)];
    }
    cur = i; step = s; groups = found;
    const list = counted(), n = list.indexOf(i);
    count.textContent = n >= 0 ? `${n + 1} of ${list.length}` : (i === 0 ? 'Welcome' : 'All done');
    progFill.style.width = `${n >= 0 ? ((n + 1) / list.length) * 100 : i === 0 ? 0 : 100}%`;
    title.textContent = s.title;
    text.textContent = s.text;
    const first = i === 0, last = i === steps.length - 1;
    backBtn.hidden = first;
    skipBtn.hidden = last;
    skipBtn.textContent = first ? 'Not now' : 'Skip tour';
    nextBtn.textContent = first ? 'Start the tour' : last ? 'Done' : 'Next';
    extraBtn.hidden = !(last && finish);
    if (last && finish) extraBtn.textContent = finish.label;
    // practice's last card: "Try it yourself" is the next step, so it is the navy one and Done the plain one
    nextBtn.className = `btn ${last && finish ? 'btn-ghost' : 'btn-primary'} btn-sm tour-next`;
    extraBtn.className = `btn ${last && finish ? 'btn-primary' : 'btn-ghost'} btn-sm tour-extra`;
    root.dataset.step = s.id;
    root.classList.toggle('is-free', !groups.length);   // no target: the card sits in the middle
    // the card's size first (placing it needs it), then the target into view, then both placed
    sizeCard();
    if (groups.length) reveal(groups[0], phone(), phone() ? card.offsetHeight + 24 : 0, s.maxH);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));   // (after a scroll settles)
    if (mine !== seq || ended) return;
    place();
    live.textContent = `${n >= 0 ? `Step ${n + 1} of ${list.length}: ` : ''}${s.title}. ${s.text}`;
    focusCard();
  }

  function sizeCard() {
    const vw = window.innerWidth, m = phone() ? 12 : 16;
    card.style.width = `${phone() ? vw - 2 * m : Math.min(370, vw - 2 * m)}px`;
  }

  // where the card goes: beside the step's own control on a laptop; on a phone docked above the tab bar (or under
  // the header when the control is down there)
  function place() {
    if (ended) return;
    const holes = groups.map((g, k) => holeOf(g, k === 0 ? step && step.maxH : 0)).filter(Boolean);
    dim.set(holes);
    sizeCard();
    const r = holes[0] ? { left: holes[0].x, top: holes[0].y, right: holes[0].x + holes[0].w, bottom: holes[0].y + holes[0].h } : null;
    const vw = window.innerWidth, vh = window.innerHeight, gap = 12;
    const w = card.offsetWidth, h = card.offsetHeight;
    let left, topY;
    if (!r) { left = (vw - w) / 2; topY = Math.max(16, (vh - h) / 2); }
    else if (phone()) {
      const m = 12, box = contentBox();
      left = m;
      const low = box.bottom - gap - h, high = box.top + 8;
      if (r.bottom <= low - 4 || r.top >= box.bottom - 12) topY = low;   // (or the control is in the tab bar)
      else if (r.top >= high + h + 4) topY = high;
      else topY = r.top - box.top > box.bottom - r.bottom ? Math.max(8, r.top - gap - h) : Math.min(vh - h - 8, r.bottom + gap);
    } else {
      const m = 16, cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
      const clampX = x => Math.max(m, Math.min(vw - w - m, x)), clampY = y => Math.max(m, Math.min(vh - h - m, y));
      const tries = [
        [r.bottom + gap + h <= vh - m, () => [clampX(cx - w / 2), r.bottom + gap]],
        [r.top - gap - h >= m, () => [clampX(cx - w / 2), r.top - gap - h]],
        [r.right + gap + w <= vw - m, () => [r.right + gap, clampY(cy - h / 2)]],
        [r.left - gap - w >= m, () => [r.left - gap - w, clampY(cy - h / 2)]],
      ];
      const fit = tries.find(t => t[0]);
      [left, topY] = fit ? fit[1]() : [vw - w - m, vh - h - m];
    }
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(topY)}px)`;
  }

  let raf = 0;
  // a resize or scroll moves the cut-outs; crossing 720 px (a phone turned, a window resized) redoes the step, whose
  // words and control differ by size
  const replace = () => {
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      if (!step || ended) return;
      if (wasPhone !== null && phone() !== wasPhone) show(cur, 1); else place();
    });
  };
  window.addEventListener('resize', replace);
  window.addEventListener('scroll', replace, true);

  // keys: → and Enter next, ← back, Esc skip, Tab stays in the card; the app's own shortcuts wait until the end
  function onKey(e) {
    if (e.key === 'Tab') {
      const f = [...card.querySelectorAll('button')].filter(b => !b.hidden);
      if (!f.length) return;
      const k = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    } else if (e.key === 'Escape') { e.preventDefault(); stop('skip'); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (want > 0) back(); }
    else if (e.key === 'Enter' || e.key === ' ') {
      // on a card button the button's own click does it; anywhere else Enter means Next
      if (!(card.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON')) { e.preventDefault(); next(); }
    }
    // the app's own keys wait (undo with Ctrl+Z too: the app ignores keys while the tour is open); the browser's own
    // keys, zoom or reload, still work
    if (!(e.ctrlKey || e.metaKey)) e.stopPropagation();
  }
  document.addEventListener('keydown', onKey, true);
  // focus that wanders out (a tap on the shade, a screen reader) comes back to the card
  const onFocus = e => { if (!ended && !card.contains(e.target)) focusCard(); };
  document.addEventListener('focusin', onFocus);
  shade.addEventListener('click', focusCard);

  const next = () => { if (want === steps.length - 1 && cur === want) stop('done'); else show(want + 1, 1); };
  const back = () => {
    let i = want - 1;
    while (i > 0 && skipped.has(i)) i--;
    show(i, -1);
  };
  nextBtn.addEventListener('click', next);
  backBtn.addEventListener('click', back);
  skipBtn.addEventListener('click', () => stop('skip'));
  extraBtn.addEventListener('click', () => stop('done', finish));

  function stop(reason, then) {
    if (ended) return;
    ended = true;
    seq++;
    if (active === api) active = null;
    if (reason !== 'replaced') setTourDone(true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('focusin', onFocus);
    window.removeEventListener('resize', replace);
    window.removeEventListener('scroll', replace, true);
    window.removeEventListener('popstate', onPop);
    cancelAnimationFrame(raf);
    dim.stop();
    document.body.classList.remove('touring');
    root.classList.add('is-leaving');
    setTimeout(() => root.remove(), reduced() ? 0 : 160);
    // take the tour's history entry back: the address returns to where the tour started (and the app routes there)
    const notNow = reason === 'skip' && cur <= 0;
    const after = () => {
      if (then && typeof then.fn === 'function') { then.fn(); return; }
      if (typeof onEnd === 'function') onEnd(reason);
      if (reason === 'replaced') return;
      if (notNow && typeof app.toast === 'function') app.toast('The tour is under More › Help whenever you want it.');
      const t0 = performance.now();
      (function refocus() {
        // the person has moved on (opened a cell, say): leave their focus where it is
        const a = document.activeElement;
        if (a && a !== document.body && !root.contains(a)) return;
        const target = returnFocus && document.contains(returnFocus) && returnFocus !== document.body ? returnFocus
          : ret ? document.querySelector(`[data-tour-return="${ret}"]`) : null;
        if (target) { target.focus({ preventScroll: true }); return; }
        if (performance.now() - t0 < 1500) requestAnimationFrame(refocus);
        else document.getElementById('main')?.focus({ preventScroll: true });
      })();
    };
    if (reason !== 'replaced' && !popped && history.state && history.state.jmTour === tid) {
      let done = false;
      const land = () => { if (done) return; done = true; window.removeEventListener('popstate', land); setTimeout(after, 0); };
      window.addEventListener('popstate', land);
      setTimeout(land, 500);   // (if the browser never says)
      history.back();
    } else after();
  }

  const api = { stop };
  active = api;
  show(0);
  return api;
}

// ---------- "Show me": a passive spotlight ----------
// Lights one control with a short label beside it; taps go through to the page. It goes on the next tap or key, or
// after a few seconds. showMe(app, { target: 'paint' } or { el }, text) returns false when nothing is on screen.
let spot = null;
export function hideShowMe() { if (spot) spot(); }
export function showMe(app, { target, el: node, text = '', ms = 7000 } = {}) {
  hideShowMe();
  const els = node ? [node] : visibleTargets(target);
  if (!els.length || !els[0].isConnected) return false;
  reveal(els, app.isPhone(), 0);
  const layer = el('div', 'tour-spot');
  const dim = makeDim('tour-holes');
  const label = el('p', 'tour-tip', { role: 'status' });
  label.textContent = text;
  layer.append(dim.el, label);
  document.body.append(layer);
  const place = () => {
    const hl = els[0].isConnected ? holeOf(els) : null;
    if (!hl) { done(); return; }
    dim.set([hl]);
    label.hidden = !text;
    const vw = window.innerWidth, vh = window.innerHeight, m = 12;
    label.style.maxWidth = Math.min(300, vw - 2 * m) + 'px';
    const lw = label.offsetWidth, lh = label.offsetHeight;
    const below = hl.y + hl.h + 10 + lh <= Math.min(vh, contentBox().bottom) - m;
    const x = Math.max(m, Math.min(vw - lw - m, hl.x + hl.w / 2 - lw / 2));
    const y = below ? hl.y + hl.h + 10 : Math.max(m, hl.y - 10 - lh);
    label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  requestAnimationFrame(place);
  let raf = 0;
  const replace = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(); }); };
  const timer = setTimeout(done, ms);
  // (armed a moment later, so the tap that asked for it doesn't end it)
  const arm = setTimeout(() => { document.addEventListener('pointerdown', done, true); document.addEventListener('keydown', done, true); }, 60);
  window.addEventListener('resize', replace);
  window.addEventListener('scroll', replace, true);
  function done() {
    if (spot !== done) return;
    spot = null;
    clearTimeout(timer); clearTimeout(arm); cancelAnimationFrame(raf); dim.stop();
    document.removeEventListener('pointerdown', done, true);
    document.removeEventListener('keydown', done, true);
    window.removeEventListener('resize', replace);
    window.removeEventListener('scroll', replace, true);
    layer.classList.add('is-leaving');
    setTimeout(() => layer.remove(), reduced() ? 0 : 160);
  }
  spot = done;
  return true;
}
