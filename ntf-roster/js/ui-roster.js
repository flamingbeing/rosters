// NTF Roster: the month grid (like the department's "ALL STAFF LEAVE REQUEST" sheet), the cell editor, paint mode,
// the one-person calendar (#roster?p=staffId) and the Auto-fill dialog (openAutofill, also used by the header button).
// The grid is built as one HTML string per render from lookup maps made once, so 80 people x 31 days stays fast.
import * as M from './model.js';
import { priorityRow } from './ui-reqprio.js';
import { suggestMonth, setWeek } from './aps.js';

const WD = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'];
const KIND_ORDER = [['shift', 'Shifts'], ['leave', 'Leave'], ['request', 'Requests'], ['other', 'Other']];
// remembered filters, one set per roster (practice and your own roster don't share them)
let UI_KEY = 'ntf-roster-ui-roster';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const key = (d, s) => d + '|' + s;

function loadUi() {
  const def = { group: '', tag: '', q: '', showReq: true, hi: '', paint: false, paintCode: '', other: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem(UI_KEY) || '{}'), q: '', paint: false }; } catch (e) { return def; }
}
function saveUi(ui) {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ group: ui.group, tag: ui.tag, showReq: ui.showReq, hi: ui.hi, paintCode: ui.paintCode, other: ui.other })); } catch (e) { /* ignore */ }
}

// ---------- small shared helpers (also used by ui-day.js) ----------
export function whoMatches(who, person) {
  if (!who) return true;
  if ((who.exclude || []).includes(person.id)) return false;
  const g = who.groups || [], t = who.tags || [], s = who.staff || [];
  if (!g.length && !t.length && !s.length) return true;
  return g.includes(person.group) || s.includes(person.id) || (person.tags || []).some(x => t.includes(x));
}

export function whenMatches(when, d, state) {
  if (!when) return true;
  if (when.from && d < when.from) return false;
  if (when.to && d > when.to) return false;
  if (when.days && when.days.length && !when.days.includes(M.weekday(d))) return false;
  if (when.holidays === 'only' || when.holidays === 'exclude') {
    const hol = M.isHoliday(state, d);
    if (when.holidays === 'only' && !hol) return false;
    if (when.holidays === 'exclude' && hol) return false;
  }
  return true;
}

// Does this person have any of `codes` on day d? Fast path for plain codes; tokens (@shift, x…) go through the model.
export function makeHasCodes(state) {
  const overnight = new Set((state.duties || []).filter(d => d.overnight).map(d => d.code));
  const plainOf = new WeakMap();   // codes list -> no tokens in it (asked once per list, not once per cell)
  return function hasCodes(d, sid, codes) {
    if (!codes || !codes.length) return false;
    let plain = plainOf.get(codes);
    if (plain === undefined) { plain = codes.every(c => c[0] !== '@' && c !== 'x'); plainOf.set(codes, plain); }
    if (!plain) {
      try { return M.matchesCodes(state, d, sid, codes); } catch (e) { return false; }
    }
    const cell = state.cells?.[d]?.[sid];
    if (!cell) return false;
    return (cell.a || []).some(c => codes.includes(c)) || (cell.r || []).some(c => codes.includes(c));
  };
}

// Short label for a cover rule: "Juniors C", "Seniors C", "Baby MO C"
export function coverLabel(rule, state) {
  const w = rule.who || {};
  const groups = state.groups || [];
  const g = w.groups || [];
  let who = '';
  if (g.length && g.every(id => groups.find(x => x.id === id)?.kind === 'junior')) who = 'Juniors';
  else if (g.length && g.every(id => groups.find(x => x.id === id)?.kind === 'senior')) who = 'Seniors';
  else if (g.length) who = g.map(id => groups.find(x => x.id === id)?.name || id).join(', ');
  const tags = (w.tags || []).map(id => (state.tags || []).find(x => x.id === id)?.name || id);
  if (tags.length) who = (who ? who + ' + ' : '') + tags.join(', ');
  if ((w.staff || []).length) who = (who ? who + ' + ' : '') + w.staff.length + ' named';
  if (!who) who = 'All';
  const codes = (rule.params?.codes || []).join('/');
  return `${who} ${codes}`.trim();
}

// Cover status of every enabled cover rule on day d: [{ rule, label, n, min, max, status, people }]
// Who a rule covers is worked out once per rule and staff list (the grid asks for every day of the month).
const coverWho = new WeakMap();   // rule -> { list, people }
function coverPeople(rule, staffList) {
  const hit = coverWho.get(rule);
  if (hit && hit.list === staffList) return hit.people;
  const people = staffList.filter(p => whoMatches(rule.who, p));
  coverWho.set(rule, { list: staffList, people });
  return people;
}
export function coverOn(state, d, staffList, hasCodes) {
  const out = [];
  for (const rule of state.rules || []) {
    if (rule.type !== 'cover' || rule.enabled === false) continue;
    if (!whenMatches(rule.when, d, state)) continue;
    const codes = rule.params?.codes || [];
    const people = coverPeople(rule, staffList).filter(p => M.staffActiveOn(p, d) && hasCodes(d, p.id, codes));
    const n = people.length;
    const min = numOrNull(rule.params?.min), max = numOrNull(rule.params?.max);
    const status = min != null && n < min ? 'short' : max != null && n > max ? 'over' : 'ok';
    out.push({ rule, label: coverLabel(rule, state), n, min, max, status, people });
  }
  return out;
}
function numOrNull(v) { return v === '' || v == null || Number.isNaN(+v) ? null : +v; }

export function emptyCell() { return { a: [], r: [], auto: [], note: '', lock: false }; }

// Add or remove one code in a cell (draft state). Requests go to r, everything else to a. A hand edit makes the code manual.
export function toggleCode(draft, d, sid, code, on, dmap) {
  const duty = dmap.get(code);
  if (!duty || duty.kind === 'derived') return;
  const cell = { ...emptyCell(), ...(M.getCell(draft, d, sid) || {}) };
  const field = duty.kind === 'request' ? 'r' : 'a';
  const list = new Set(cell[field] || []);
  const has = list.has(code);
  const want = on == null ? !has : on;
  if (want) list.add(code); else list.delete(code);
  const patch = { [field]: [...list] };
  if (field === 'a') patch.auto = (cell.auto || []).filter(c => c !== code);
  M.setCell(draft, d, sid, patch);
}

// the roster this browser is not working on (shown greyed with the Junior / Senior roster button)
const otherPool = state => (state && state.settings && state.settings.pool === 'senior' ? 'junior' : 'senior');

function cellHas(state, d, sid, code) {
  const c = state.cells?.[d]?.[sid];
  return !!c && ((c.a || []).includes(code) || (c.r || []).includes(code));
}

// ---------- view ----------
export function mount(el, app) {
  const { h, icon } = app;
  UI_KEY = `${(app.store && app.store.key) || 'ntf-roster'}-ui-roster`;
  const ui = loadUi();
  let sel = app.selectedCell ? { ...app.selectedCell } : null;
  let editor = null;          // { d, s, close, refresh, el }
  let typed = '', typedTimer = 0;
  let paintDrag = null;
  let lastPerson = null;
  let firstRender = true;

  el.innerHTML = '';
  const root = h('div', { class: 'roster' });
  el.append(root);

  // Toolbar
  const tb = h('div', { class: 'r-toolbar', role: 'toolbar', 'aria-label': 'Roster tools' });
  const search = h('input', { type: 'search', class: 'input r-search', placeholder: 'Find', 'aria-label': 'Find a person', value: ui.q });
  const searchWrap = h('label', { class: 'r-searchwrap' }, h('span', { class: 'r-search-ic', html: icon('search') }), search);
  const groupSel = h('select', { class: 'input r-sel', 'aria-label': 'Show group' });
  const tagSel = h('select', { class: 'input r-sel', 'aria-label': 'Show tag' });
  const hiSel = h('select', { class: 'input r-sel', 'aria-label': 'Highlight a code' });
  // (data-tour: what the first-time tour lights, tour.js)
  const reqBtn = h('button', { type: 'button', class: 'tbtn', 'aria-pressed': String(ui.showReq), title: 'Show or hide requests (Cr, Nc, Wr…)', 'data-tour': 'layers' });
  const paintBtn = h('button', { type: 'button', class: 'tbtn', 'aria-pressed': 'false', title: 'Paint mode: pick a code, then tap or drag across cells', 'data-tour': 'paint' });
  reqBtn.innerHTML = `${icon('eye')}<span>Requests</span>`;
  paintBtn.innerHTML = `${icon('brush')}<span>Paint</span>`;
  // the grid's marks explained (they are small and otherwise unexplained)
  const keyBtn = h('button', { type: 'button', class: 'tbtn', title: 'What the marks in the grid mean', onclick: showKey, 'data-tour': 'layers' }, 'Key');
  // the other roster's rows, greyed and read-only, to see who is on (owner, 19 Oct 2026)
  const otherBtn = h('button', { type: 'button', class: 'tbtn', 'data-k': 'other', 'aria-pressed': String(!!ui.other),
    onclick: () => { ui.other = !ui.other; saveUi(ui); otherBtn.setAttribute('aria-pressed', String(ui.other)); renderGrid(); } });
  const otherLabel = () => { const o = otherPool(app.store.get()); otherBtn.textContent = `${o === 'senior' ? 'Senior' : 'Junior'} roster`; otherBtn.title = `Show the ${o} roster too, greyed: to see who is on. It can only be changed from the ${o} roster (the switch at the top).`; };
  tb.append(paintBtn, searchWrap, groupSel, tagSel, hiSel, reqBtn, otherBtn, keyBtn);
  function showKey() {
    const row = (mark, text) => h('li', { class: 'gk-row' }, h('span', { class: 'gk-mark', html: mark }), h('span', null, text));
    app.sheet({
      title: 'Key', actions: [{ label: 'Close', primary: true }],
      body: h('ul', { class: 'gk' },
        row('<span class="chip" style="--c:#c62828;--i:#fff">C</span>', 'A duty, leave or other code (filled chip)'),
        row('<span class="chip au" style="--c:#c62828;--i:#fff">C</span>', 'Placed by Auto-fill (light line under the chip); re-running Auto-fill may change it'),
        row('<span class="chip rq" style="--c:#0b5394">Nc</span>', 'A request (outlined chip): what someone asked for, not what they are doing'),
        row('<span class="chip dx">x</span>', 'Post call: the day after an overnight duty (worked out, never typed)'),
        row('<span class="gk-cell"><span class="vx vh"></span></span>', 'Red corner: a must-fix problem in that cell (tap the cell to see it)'),
        row('<span class="gk-cell"><span class="vx vs"></span></span>', 'Amber corner: something to improve (a preference)'),
        row('<span class="vx-nm vh"></span>', 'Dot after a name: a problem about their whole month (fair share, a monthly minimum)'),
        row('<span class="gk-cell"><span class="nd"></span></span>', 'Blue dot: a note on that cell'),
        row('<span class="gk-txt">Wk</span>', 'Weekend and public holiday calls this month (the totals at the end of each row)'),
        row('<span class="gk-txt">2/2</span>', 'Bottom rows: how many are on each cover rule that day, against what it needs')),
    });
  }
  const typedPill = h('span', { class: 'typed', 'aria-live': 'polite', hidden: true });
  tb.append(typedPill);

  const paintBar = h('div', { class: 'r-paintbar', hidden: true, role: 'group', 'aria-label': 'Paint with code' });
  const banner = h('div', { class: 'r-banner', hidden: true });
  const lockNote = h('div', { class: 'lock-note', role: 'note', hidden: true });
  const body = h('div', { class: 'r-body', 'data-tour': 'grid' });
  const scroll = h('div', { class: 'r-scroll', tabindex: '-1' });
  const styleEl = h('style');
  body.append(scroll);
  root.append(styleEl, tb, paintBar, lockNote, banner, body);
  const personHost = h('div', { class: 'person-host', hidden: true });
  root.append(personHost);

  // ---------- toolbar options ----------
  let selectsKey = '';   // what the selects were last built from (rebuilt only when that changes: speed)
  function fillSelects(state) {
    const groups = (state.groups || []);
    const opts = [['', 'All groups'], ['@senior', 'Seniors'], ['@junior', 'Juniors'], ...groups.map(g => [g.id, g.name])];
    // a remembered group or tag that no longer exists would hide everyone with no way to clear it: forget it
    const tags = state.tags || [];
    if (ui.group && !opts.some(([v]) => v === ui.group)) { ui.group = ''; saveUi(ui); }
    if (ui.tag && !tags.some(t => t.id === ui.tag)) { ui.tag = ''; saveUi(ui); }
    const k = JSON.stringify([opts, tags.map(t => [t.id, t.name]), (state.duties || []).map(d => [d.code, d.name, d.kind]), ui.group, ui.tag, ui.hi]);
    if (k === selectsKey) return;
    selectsKey = k;
    groupSel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}"${v === ui.group ? ' selected' : ''}>${esc(l)}</option>`).join('');
    tagSel.innerHTML = [['', 'All tags'], ...tags.map(t => [t.id, t.name])].map(([v, l]) => `<option value="${esc(v)}"${v === ui.tag ? ' selected' : ''}>${esc(l)}</option>`).join('');
    tagSel.hidden = !tags.length;
    const duties = (state.duties || []).filter(d => d.kind !== 'derived');
    hiSel.innerHTML = `<option value="">Highlight: none</option>` + KIND_ORDER.map(([k, label]) => {
      const list = duties.filter(d => d.kind === k);
      return list.length ? `<optgroup label="${label}">${list.map(d => `<option value="${esc(d.code)}"${d.code === ui.hi ? ' selected' : ''}>${esc(d.code)} · ${esc(d.name)}</option>`).join('')}</optgroup>` : '';
    }).join('');
  }

  let paintKey = '';   // what the paint bar was last built from (each painted cell re-renders: don't rebuild it then)
  function renderPaintBar(state) {
    paintBar.hidden = !ui.paint;
    paintBtn.setAttribute('aria-pressed', String(ui.paint));
    if (!ui.paint) { paintKey = ''; return; }
    const duties = (state.duties || []).filter(d => d.kind !== 'derived');
    // ('__clear' is the Clear chip, not a duty: keep it)
    if (ui.paintCode !== '__clear' && (!ui.paintCode || !duties.some(d => d.code === ui.paintCode))) ui.paintCode = (duties.find(d => d.code === 'AL') || duties[0] || {}).code || '';
    const k = JSON.stringify([ui.paintCode, duties.map(d => [d.code, d.name, d.kind, d.color, d.ink])]);
    if (k === paintKey) return;
    paintKey = k;
    paintBar.innerHTML = '';
    paintBar.append(h('span', { class: 'pb-label' }, 'Paint:'));
    for (const [k, label] of KIND_ORDER) {
      const list = duties.filter(d => d.kind === k);
      if (!list.length) continue;
      const grp = h('span', { class: 'pb-group', role: 'group', 'aria-label': label });
      for (const d of list) {
        grp.append(h('button', {
          type: 'button', class: `pchip k-${d.kind}`, 'data-code': d.code, 'aria-pressed': String(ui.paintCode === d.code),
          title: d.name, 'aria-label': `${d.code}, ${d.name}`, style: chipVars(d),
          onclick: () => { ui.paintCode = d.code; saveUi(ui); renderPaintBar(app.store.get()); },
        }, d.code));
      }
      paintBar.append(grp);
    }
    paintBar.append(h('button', {
      type: 'button', class: 'pchip pchip-clear', 'aria-pressed': String(ui.paintCode === '__clear'), title: 'Clear cells',
      html: `${icon('eraser')}<span>Clear</span>`, onclick: () => { ui.paintCode = '__clear'; renderPaintBar(app.store.get()); },
    }));
    paintBar.append(h('span', { class: 'pb-hint' }, ui.paintCode === '__clear' ? 'Tap (or drag with a mouse) to clear cells' : `Tap cells to add ${ui.paintCode} (drag with a mouse); tap a cell that has it to remove`));
    paintBar.append(h('button', { type: 'button', class: 'btn btn-primary btn-sm pb-done', onclick: () => setPaint(false) }, `Done painting`));
  }
  function setPaint(on) {
    ui.paint = on; closeEditor(); renderPaintBar(app.store.get()); root.classList.toggle('painting', ui.paint);
    if (!on) paintBtn.focus({ preventScroll: true });
  }

  search.addEventListener('input', () => { ui.q = search.value; renderGrid(); });
  groupSel.addEventListener('change', () => { ui.group = groupSel.value; saveUi(ui); renderGrid(); });
  tagSel.addEventListener('change', () => { ui.tag = tagSel.value; saveUi(ui); renderGrid(); });
  hiSel.addEventListener('change', () => { ui.hi = hiSel.value; saveUi(ui); applyHighlight(); });
  reqBtn.addEventListener('click', () => {
    ui.showReq = !ui.showReq; saveUi(ui); reqBtn.setAttribute('aria-pressed', String(ui.showReq));
    scroll.querySelector('table')?.classList.toggle('no-req', !ui.showReq);
    prevRender = null;
  });
  paintBtn.addEventListener('click', () => setPaint(!ui.paint));

  // ---------- grid ----------
  let ctx = null;   // lookups for the current render
  let prevRender = null;   // { shape, head, rows, foot, keys, parts, footParts } of the last grid render
  let rowCache = new Map(), rowCacheKey = '';   // staffId -> { k, html, parts } from the last render (see rowSig)

  // Progressive drawing. A full redraw (another month, back from another tab, a filter) puts only the rows in the
  // grid's window into the page first and adds the rest over the next frames, so the month shows at once even on a
  // slow phone (the browser's work grows with the number of cells). Rows above the window wait in a spacer sized from
  // the rows drawn before (same people, so nearly the same heights); when they come in, the scroll position is
  // corrected by any difference, so nothing on screen moves. Anything that needs a row not drawn yet calls
  // flushRows() first, which draws the rest at once. The first screen after the app starts is drawn whole.
  let pending = null;   // { rows, top, next, raf, timer }: rows [0, top) wait in the spacer, rows [next, end) below
  const BATCH = 24;     // rows added per frame below the window
  function queueRows(rows, top, next) {
    pending = { rows, top, next, raf: 0, timer: 0 };
    later();
  }
  function later() {   // the next step after the next paint
    const p = pending;
    p.raf = requestAnimationFrame(() => { p.timer = setTimeout(step, 0); });
  }
  function step() {
    const p = pending;
    if (!p) return;
    const tb = scroll.querySelector('table.grid')?.tBodies[0];
    if (!tb) { pending = null; return; }
    if (p.top) drawAbove(tb, p);
    else {
      const end = Math.min(p.rows.length, p.next + BATCH);
      tb.insertAdjacentHTML('beforeend', p.rows.slice(p.next, end).join(''));
      p.next = end;
    }
    if (!p.top && p.next >= p.rows.length) pending = null;
    else later();
  }
  // the rows above the window replace the spacer; keep what is on screen where it is
  function drawAbove(tb, p) {
    const spacer = tb.querySelector('tr.r-spacer');
    if (spacer) {
      const anchor = spacer.nextElementSibling;
      const y0 = anchor ? anchor.offsetTop : 0;
      spacer.insertAdjacentHTML('beforebegin', p.rows.slice(0, p.top).join(''));
      spacer.remove();
      const dy = anchor ? anchor.offsetTop - y0 : 0;
      if (dy) scroll.scrollTop += dy;
    }
    p.top = 0;
  }
  function flushRows() {
    const p = pending;
    if (!p) return;
    pending = null;
    cancelAnimationFrame(p.raf); clearTimeout(p.timer);
    const tb = scroll.querySelector('table.grid')?.tBodies[0];
    if (!tb) return;
    if (p.top) drawAbove(tb, p);
    if (p.next < p.rows.length) tb.insertAdjacentHTML('beforeend', p.rows.slice(p.next).join(''));
  }
  function dropRows() {   // a new full redraw replaces them anyway
    if (!pending) return;
    cancelAnimationFrame(pending.raf); clearTimeout(pending.timer);
    pending = null;
  }

  function filteredStaff(state) {
    let list = M.staffInView(state, app.month);
    const gmap = M.groupMap(state);
    if (ui.group === '@senior' || ui.group === '@junior') {
      const kind = ui.group.slice(1);
      list = list.filter(p => gmap.get(p.group)?.kind === kind);
    } else if (ui.group) list = list.filter(p => p.group === ui.group);
    if (ui.tag) list = list.filter(p => (p.tags || []).includes(ui.tag));
    const q = ui.q.trim().toLowerCase();
    if (q) list = list.filter(p => (p.name || '').toLowerCase().includes(q) || (p.short || '').toLowerCase().includes(q));
    return list;
  }

  // the other roster's people for the greyed rows: the same search, in their own sections
  function otherStaff(state) {
    if (!ui.other) return [];
    const o = otherPool(state);
    const q = ui.q.trim().toLowerCase();
    return M.staffInMonth(state, app.month).filter(p => M.poolOf(state, p) === o
      && (!q || (p.name || '').toLowerCase().includes(q) || (p.short || '').toLowerCase().includes(q)));
  }

  function buildCtx(state) {
    const days = M.monthDays(app.month);
    const dmap = M.dutyMap(state);
    const dutyIdx = new Map((state.duties || []).map((d, i) => [d.code, i]));
    const overnight = new Set((state.duties || []).filter(d => d.overnight).map(d => d.code));
    const ev = app.evaluation();
    const today = M.iso(new Date());
    const dayMeta = days.map(d => {
      const hol = M.isHoliday(state, d) ? (M.holidayName(state, d) || 'Public holiday') : '';
      return { d, wd: M.weekday(d), we: M.isWeekend(d), hol, num: +d.slice(8), today: d === today, label: M.fmtDay(d), prev: M.addDays(d, -1) };
    });
    const autoCodes = (state.duties || []).filter(d => d.auto && d.kind === 'shift').map(d => d.code);
    // problems about a person's whole month (fair share, a monthly minimum): a mark on the name, not on day 1
    const personV = new Map();
    for (const v of ev.violations || []) {
      if (v.date || (v.dates || []).length || !v.staffId) continue;
      if (!personV.has(v.staffId)) personV.set(v.staffId, []);
      personV.get(v.staffId).push(v);
    }
    return { state, days, dmap, dutyIdx, overnight, ev, today, dayMeta, autoCodes, personV, hasCodes: makeHasCodes(state), gmap: M.groupMap(state) };
  }

  let lastCss = null;
  function dutyStyles(state) {
    let css = (state.duties || []).map((d, i) => { const v = chipVars(d); return `.dc-${i}{--c:${v['--c']};--i:${v['--i']}}`; }).join('');
    if (ui.hi && ctx) {
      const i = ctx.dutyIdx.get(ui.hi);
      css += i == null ? '' : `.grid.hi .chip:not(.dc-${i}){opacity:.14}.grid.hi .chip.dc-${i}{box-shadow:0 0 0 2px #002f6c}`;
    }
    // rewriting a <style> makes the browser restyle every element on the page (thousands in the grid): only when
    // the CSS really changed (speed: each edit used to pay for it)
    if (css !== lastCss) { styleEl.textContent = css; lastCss = css; }
  }

  function applyHighlight() {
    dutyStyles(app.store.get());
    scroll.querySelector('table')?.classList.toggle('hi', !!ui.hi);
    prevRender = null;
  }

  function prevHasOvernight(state, d, sid, overnight) {
    const prev = state.cells?.[M.addDays(d, -1)]?.[sid];
    return !!prev && (prev.a || []).some(c => overnight.has(c));
  }

  function cellHtml(c, person, dm, focusable) {
    const { state, dmap, dutyIdx, overnight, ev } = c;
    const d = dm.d, sid = person.id;
    const cell = state.cells?.[d]?.[sid];
    const vs = ev.byCell?.get(key(d, sid)) || [];
    const prevCell = state.cells?.[dm.prev]?.[sid];
    const post = !!prevCell && (prevCell.a || []).some(x => overnight.has(x));
    let chips = '';
    const names = [];
    if (cell) {
      for (const code of cell.a || []) {
        const i = dutyIdx.get(code);
        const du = dmap.get(code);
        const isAuto = (cell.auto || []).includes(code);
        chips += `<span class="chip${i == null ? ' unk' : ' dc-' + i}${du ? ' k-' + esc(du.kind) : ''}${isAuto ? ' au' : ''}${code.length > 3 ? ' sm' : ''}">${esc(code)}</span>`;
        names.push((du ? du.name : code) + (isAuto ? ' (auto)' : ''));
      }
      for (const code of cell.r || []) {
        const i = dutyIdx.get(code), mk = (cell.rp && cell.rp[code]) || '';
        chips += `<span class="chip rq${i == null ? '' : ' dc-' + i}${code.length + mk.length > 3 ? ' sm' : ''}">${esc(code + mk)}</span>`;
        names.push('request ' + (dmap.get(code)?.name || code) + (mk === '!' ? ', must' : mk === '?' ? ', if possible' : ''));
      }
    }
    if (post && !(cell?.a || []).includes('x')) { chips += '<span class="chip dx">x</span>'; names.push('post call'); }
    let cls = 'c';
    if (dm.we) cls += ' we';
    if (dm.hol) cls += ' hol';
    if (dm.today) cls += ' td';
    let marks = '';
    const hard = vs.some(v => v.hard);
    if (vs.length) marks += `<span class="vx ${hard ? 'vh' : 'vs'}"></span>`;
    if (cell?.note) { marks += '<span class="nd"></span>'; names.push('note: ' + cell.note); }
    if (cell?.lock) { marks += '<span class="lk"></span>'; names.push('locked'); }
    if (vs.length) names.push(`${vs.length} problem${vs.length > 1 ? 's' : ''}: ` + vs.map(v => v.msg).join('; '));
    const label = `${person.name}, ${dm.label}: ${names.length ? names.join(', ') : 'empty'}`;
    const title = vs.length || cell?.note ? ` title="${esc([cell?.note ? 'Note: ' + cell.note : '', ...vs.map(v => (v.hard ? '⛔ ' : '⚠ ') + v.msg)].filter(Boolean).join('\n'))}"` : '';
    return `<td class="${cls}"><button class="cell" data-d="${d}" data-s="${esc(sid)}" tabindex="${focusable ? 0 : -1}" aria-label="${esc(label)}"${title}>${marks}${chips}</button></td>`;
  }

  // Everything one person's row is drawn from (their cells, the day before the month for post call, problems,
  // details, the selected cell), as a string. A row whose string is the same as last render reuses last render's
  // HTML: an edit changes one or two rows, and building all 2,000 cells again was most of an edit's cost (speed).
  function rowSig(c, p, pv, focusDay) {
    const cells = c.state.cells || {};
    let k = JSON.stringify([p.name, p.short, p.tags, p.note, p.start, p.end, p.active, focusDay,
      pv.map(v => [v.hard, v.msg]), (cells[c.dayMeta[0].prev] || {})[p.id] || 0]);
    for (const dm of c.dayMeta) {
      const cell = (cells[dm.d] || {})[p.id];
      if (cell) k += '|' + dm.num + JSON.stringify(cell);
      const vs = c.ev.byCell?.get(key(dm.d, p.id));
      if (vs && vs.length) k += '!' + dm.num + vs.map(v => (v.hard ? 'H' : 'S') + v.msg).join('\u0001');
    }
    return k;
  }

  function renderGrid() {
    const t0 = performance.now();
    const state = app.store.get();
    ctx = buildCtx(state);
    const c = ctx;
    dutyStyles(state);
    otherLabel();
    const staff = filteredStaff(state);
    const others = otherStaff(state);
    const all = M.staffInView(state, app.month);
    // summary columns: auto codes used this month (C always) + weekend/holiday calls
    const used = new Set();
    for (const d of c.days) {
      const day = state.cells?.[d];
      if (!day) continue;
      for (const sid in day) for (const code of day[sid].a || []) if (c.autoCodes.includes(code)) used.add(code);
    }
    const sumCodes = c.autoCodes.filter(code => used.has(code) || code === 'C');
    const hasC = c.dmap.has('C');
    const nSum = sumCodes.length + (hasC ? 1 : 0);
    const nCols = 1 + c.days.length + nSum;

    if (!sel || !staff.some(p => p.id === sel.staffId) || !c.days.includes(sel.date)) {
      const d0 = c.days.includes(c.today) ? c.today : c.days[0];
      sel = staff.length ? { date: sel && c.days.includes(sel.date) ? sel.date : d0, staffId: staff[0].id } : null;
    }

    const tableClass = `grid${ui.showReq ? '' : ' no-req'}${ui.hi ? ' hi' : ''}`;
    let open = `<table class="${tableClass}" style="--days:${c.days.length};--sums:${nSum}">`;
    open += `<caption class="sr-only">Roster for ${esc(M.fmtMonth(app.month))}. Rows are people, columns are days. Use the arrow keys to move, Enter to edit.</caption>`;
    open += '<colgroup><col class="col-nm">' + c.days.map(() => '<col class="col-d">').join('') + sumCodes.map(() => '<col class="col-s">').join('') + (hasC ? '<col class="col-s">' : '') + '</colgroup>';
    let html = '<thead><tr><th scope="col" class="nh"><span class="nh-in">' + staff.length + (staff.length === all.length ? '' : ' of ' + all.length) + ' people</span></th>';
    for (const dm of c.dayMeta) {
      let cls = 'dh';
      if (dm.we) cls += ' we';
      if (dm.hol) cls += ' hol';
      if (dm.today) cls += ' td';
      const t = dm.hol ? ` title="${esc(dm.hol)}"` : '';
      html += `<th scope="col" class="${cls}"${t} data-d="${dm.d}"><abbr class="dh-in" title="${esc(M.fmtDay(dm.d) + (dm.hol ? ', ' + dm.hol : ''))}"><span class="wd">${WD[dm.wd]}</span><span class="dn">${dm.num}</span></abbr></th>`;
    }
    sumCodes.forEach((code, i) => { html += `<th scope="col" class="sh${i ? '' : ' s1'}" title="${esc(c.dmap.get(code)?.name || code)} this month"><abbr title="${esc(c.dmap.get(code)?.name || code)} this month">${esc(code)}</abbr></th>`; });
    if (hasC) html += `<th scope="col" class="sh${sumCodes.length ? '' : ' s1'}"><abbr title="Weekend and public holiday calls this month">Wk</abbr></th>`;
    html += '</tr></thead>';
    const head = html;
    const rows = [];   // one string per body row, so a re-render can replace only the rows that changed
    const keys = [];   // what each row is (a person's id, or 'g:' and a group): sizes the space for rows drawn later
    const parts = [];  // a person row's cells, one string each (an edit then swaps only the cells that changed)

    const groups = state.groups || [];
    const tagMap = new Map((state.tags || []).map(t => [t.id, t]));
    // what every row shares (month, today, duty codes, holidays, tag names, summary columns): when it changes, no
    // row's old HTML can be reused
    const allKey = JSON.stringify([app.month, c.today, sumCodes, hasC, [...c.overnight], c.dayMeta.map(dm => dm.hol),
      (state.duties || []).map(d => [d.code, d.name, d.kind]), (state.tags || []).map(t => [t.id, t.name])]);
    if (allKey !== rowCacheKey) { rowCache = new Map(); rowCacheKey = allKey; }
    const nextCache = new Map();
    // ro: the other roster's rows, greyed and read-only (no cell buttons, so no editing, painting or keyboard stops)
    const addPeople = (list, ro) => {
    const byGroup = new Map();
    for (const p of list) { if (!byGroup.has(p.group)) byGroup.set(p.group, []); byGroup.get(p.group).push(p); }
    const groupOrder = [...groups.map(g => g.id), ...[...byGroup.keys()].filter(id => !groups.some(g => g.id === id))];
    for (const gid of groupOrder) {
      const people = byGroup.get(gid);
      if (!people || !people.length) continue;
      const g = c.gmap.get(gid);
      rows.push(`<tr class="grp-row${ro ? ' ro' : ''}"><th colspan="${nCols}" scope="colgroup" class="grp"><span class="grp-label">${esc(g ? g.name : 'No group')}<span class="grp-n">${people.length}</span></span></th></tr>`);
      keys.push((ro ? 'og:' : 'g:') + gid); parts.push(null);
      for (const p of people) {
        const pv = ro ? [] : (c.personV.get(p.id) || []);
        const sig = (ro ? 'ro|' : '') + rowSig(c, p, pv, !ro && sel && sel.staffId === p.id ? sel.date : '');
        const ck = (ro ? 'ro:' : '') + p.id;
        const hit = rowCache.get(ck);
        keys.push(ck);
        if (hit && hit.k === sig) { rows.push(hit.html); parts.push(hit.parts); nextCache.set(ck, hit); continue; }
        const tagTxt = (p.tags || []).map(t => tagMap.get(t)?.name || t);
        const tagBadge = (p.tags || []).includes('babymo') ? '<span class="tagb" title="Baby MO">B</span>' : (p.tags || []).includes('parttime') ? '<span class="tagb tagb-pt" title="Part time">PT</span>' : '';
        const pvTxt = pv.length ? ' · ' + pv.map(v => (v.hard ? '⛔ ' : '⚠ ') + v.msg).join(' · ') : '';
        const pvMark = pv.length ? `<span class="vx-nm ${pv.some(v => v.hard) ? 'vh' : 'vs'}" aria-hidden="true"></span>` : '';
        const cellsOut = [];
        if (ro) cellsOut.push(`<th scope="row" class="nm"><span class="nm-ro" title="${esc(p.name + ' (' + M.POOL_LABEL[otherPool(state)] + ', view only)')}"><span class="nm-txt">${esc(p.short || p.name)}</span>${tagBadge}</span></th>`);
        else cellsOut.push(`<th scope="row" class="nm"><button type="button" class="nm-btn" data-p="${esc(p.id)}" title="${esc(p.name + (tagTxt.length ? ' · ' + tagTxt.join(', ') : '') + (p.note ? ' · ' + p.note : '') + pvTxt + '. Open their month')}"${pv.length ? ` aria-label="${esc(`${p.short || p.name}, ${pv.length} problem${pv.length > 1 ? 's' : ''} this month. Open their month`)}"` : ''}><span class="nm-txt">${esc(p.short || p.name)}</span>${tagBadge}${pvMark}</button></th>`);
        for (const dm of c.dayMeta) {
          const focusable = sel && sel.staffId === p.id && sel.date === dm.d;
          const cell = M.staffActiveOn(p, dm.d) ? cellHtml(c, p, dm, focusable && !ro) : `<td class="c off${dm.we ? ' we' : ''}"><span class="sr-only">not in post</span></td>`;
          cellsOut.push(ro ? cell.replace(/<button class="cell"[^>]*?( aria-label="[^"]*")[^>]*>/, '<span class="cell-ro" role="img"$1>').replace('</button>', '</span>') : cell);
        }
        // counts
        const counts = {};
        let wk = 0;
        for (const d of c.days) {
          const a = state.cells?.[d]?.[p.id]?.a;
          if (!a) continue;
          for (const code of a) counts[code] = (counts[code] || 0) + 1;
          if (a.includes('C') && (M.isWeekend(d) || M.isHoliday(state, d))) wk++;
        }
        sumCodes.forEach((code, i) => { cellsOut.push(`<td class="sc${i ? '' : ' s1'}${counts[code] ? '' : ' zero'}">${counts[code] || 0}</td>`); });
        if (hasC) cellsOut.push(`<td class="sc${sumCodes.length ? '' : ' s1'}${wk ? '' : ' zero'}">${wk}</td>`);
        html = (ro ? '<tr class="ro">' : '<tr>') + cellsOut.join('') + '</tr>';
        rows.push(html);
        parts.push(cellsOut);
        nextCache.set(ck, { k: sig, html, parts: cellsOut });
      }
    }
    };
    addPeople(staff, false);
    if (others.length) {
      rows.push(`<tr class="grp-row ro-head"><th colspan="${nCols}" scope="colgroup" class="grp"><span class="grp-label">${esc(M.POOL_LABEL[otherPool(state)][0].toUpperCase() + M.POOL_LABEL[otherPool(state)].slice(1))}: view only<span class="grp-n">${others.length}</span></span></th></tr>`);
      keys.push('g:@other'); parts.push(null);
      addPeople(others, true);
    }
    rowCache = nextCache;
    if (!staff.length) { rows.push(`<tr><td colspan="${nCols}" class="nobody">Nobody matches these filters.</td></tr>`); keys.push(''); parts.push(null); }
    html = '';

    // cover rows: per day, each cover rule's count vs min/max
    let covRules = (state.rules || []).filter(r => r.type === 'cover' && r.enabled !== false);
    const covByDay = covRules.length && staff.length ? c.days.map(d => coverOn(state, d, all, c.hasCodes)) : [];
    // a rule with no day this month (public holidays only, in a month without one) gets no empty row
    covRules = covRules.filter(rule => covByDay.some(day => day.some(x => x.rule === rule)));
    const footParts = [];   // per cover row: [row start tag, cells...] (an edit swaps only the cells that changed)
    if (covRules.length && staff.length) {
      covRules.forEach((rule, ri) => {
        const desc = safeDescribe(rule, state);
        const cells = [`<tr style="--b:${(covRules.length - 1 - ri) * 24}px">`, `<th scope="row" class="nm cov-nm" title="${esc(desc)}">${esc(coverLabel(rule, state))}</th>`];
        c.days.forEach((d, di) => {
          const cv = covByDay[di].find(x => x.rule === rule);
          if (!cv) { cells.push('<td class="cov na"></td>'); return; }
          const need = cv.min != null ? cv.min : cv.max;
          const txt = need != null ? `${cv.n}/${need}` : String(cv.n);
          cells.push(`<td class="cov ${cv.status}" title="${esc(`${M.fmtDay(d)}: ${cv.n} on ${(rule.params?.codes || []).join('/')}${cv.min != null ? `, needs ${cv.min}` : ''}${cv.max != null ? `, at most ${cv.max}` : ''}`)}">${txt}</td>`);
        });
        if (nSum) cells.push(`<td colspan="${nSum}" class="cov-sum s1"></td>`);
        footParts.push(cells);
      });
      html += '<tfoot>' + footParts.map(r => r.join('') + '</tr>').join('') + '</tfoot>';
    }
    const foot = html;

    // the banner first: it changes the grid's height, so the one layout the grid needs below includes it (speed)
    renderBanner(state, c);
    const hadFocus = scroll.contains(document.activeElement) && document.activeElement.classList.contains('cell');
    const shape = [app.month, open, rows.length, foot ? 1 : 0].join('|');
    const table = scroll.querySelector('table.grid');
    let patch = !!(prevRender && prevRender.shape === shape && table && table.tBodies[0]);
    if (patch && document.body.classList.contains('ready')) {
      // more changed rows than fit on a screen (Auto-fill, an import, undoing them): redraw, progressively, instead
      let n = 0;
      for (let i = 0; i < rows.length && n <= 30; i++) if (rows[i] !== prevRender.rows[i]) n++;
      if (n > 30) patch = false;
    }
    // rows of the last render still to be drawn: draw them if this render patches it, drop them if it replaces it
    if (pending) { if (patch) flushRows(); else dropRows(); }
    if (patch && table.tBodies[0].rows.length !== rows.length) patch = false;
    if (patch) {
      // Same layout as last time: swap only what changed (a typical edit touches a cell or two).
      if (head !== prevRender.head) table.tHead.outerHTML = head;
      const trs = table.tBodies[0].rows;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i] === prevRender.rows[i]) continue;
        // a person's row with the same cells as before: swap only the cells that changed (usually one or two), so
        // the browser restyles and repaints a cell, not the row
        const a = parts[i], z = prevRender.parts && prevRender.parts[i], tds = trs[i].cells;
        if (a && z && a.length === z.length && tds.length === a.length) { for (let j = a.length - 1; j >= 0; j--) if (a[j] !== z[j]) tds[j].outerHTML = a[j]; }
        else trs[i].outerHTML = rows[i];
      }
      if (foot !== prevRender.foot && table.tFoot) {
        // the same cover rows: swap only the counts that changed (each footer cell is pinned to the bottom, so
        // replacing them all is costly); otherwise the whole footer
        const a = footParts, z = prevRender.footParts || [], trs = table.tFoot.rows;
        const same = a.length === z.length && trs.length === a.length && a.every((r, i) => r.length === z[i].length && r[0] === z[i][0] && trs[i].cells.length === r.length - 1);
        if (same) a.forEach((r, i) => { for (let j = r.length - 1; j >= 1; j--) if (r[j] !== z[i][j]) trs[i].cells[j - 1].outerHTML = r[j]; });
        else table.tFoot.outerHTML = foot;
      }
    } else {
      // (the scroll position is read only here: reading it makes the browser lay the page out first, which an edit
      // that patches rows doesn't need)
      const st = scroll.scrollTop, sl = scroll.scrollLeft;
      let top = 0, end = rows.length, gap = 0;   // draw rows [top, end) now; the rows above wait in a gap of this height
      if (document.body.classList.contains('ready') && rows.length > 30) {
        // heights of the rows drawn last time, by person or group (the same people are mostly in the same places),
        // to size the space above the window; at the top there is none (and reading heights costs a layout)
        const old = new Map(), trs = st > 66 ? table?.tBodies[0]?.rows : null;
        if (trs && prevRender && prevRender.keys && trs.length === prevRender.keys.length && !table.querySelector('tr.r-spacer')) {
          for (let i = 0; i < trs.length; i++) old.set(prevRender.keys[i], trs[i].offsetHeight);
        }
        const est = i => old.get(keys[i]) || (/^o?g:/.test(keys[i]) ? 25 : 33);
        const view = scroll.clientHeight || 800;
        let y = 0, i = 0;
        while (i < rows.length && y + est(i) <= st - 66) { y += est(i); i++; }   // keep two rows above the window
        top = i; gap = y;
        while (i < rows.length && y < st + view + 132) { y += est(i); i++; }     // and four below it
        end = Math.max(i, Math.min(rows.length, top + 12));
      }
      const spacer = top ? `<tr class="r-spacer" aria-hidden="true"><td colspan="${nCols}" style="height:${gap}px;padding:0;border:0"></td></tr>` : '';
      scroll.innerHTML = open + head + '<tbody>' + spacer + rows.slice(top, end).join('') + '</tbody>' + foot + '</table>';
      scroll.scrollTop = st; scroll.scrollLeft = sl;
      if (top || end < rows.length) queueRows(rows, top, end);
    }
    prevRender = { shape, head, rows, foot, keys, parts, footParts };
    if (hadFocus) { const b = selBtn(); if (b) { b.tabIndex = 0; if (document.activeElement !== b) b.focus({ preventScroll: true }); } }
    ctx.renderMs = performance.now() - t0;
    root.dataset.renderMs = ctx.renderMs.toFixed(1);
  }

  function safeDescribe(rule, state) {
    try { return (rule.name ? rule.name + ': ' : '') + (app.rules?.describeRule ? app.rules.describeRule(rule, state) : ''); } catch (e) { return rule.name || 'Cover rule'; }
  }

  function renderBanner(state, c) {
    // a locked month says so here, with the way out (the padlock in the header does the same)
    const locked = M.isMonthLocked(state, app.month);
    lockNote.hidden = !locked;
    if (locked && lockNote.dataset.m !== app.month + otherPool(state)) {
      lockNote.dataset.m = app.month + otherPool(state);
      lockNote.textContent = '';
      lockNote.title = 'Nothing in a locked month can change, so it cannot be edited by accident.';
      lockNote.setAttribute('aria-description', lockNote.title);
      lockNote.append(h('span', { class: 'ln-t' }, `${M.fmtMonth(app.month)} is locked for the ${M.POOL_LABEL[otherPool(state) === 'senior' ? 'junior' : 'senior']}`, h('span', { class: 'ln-more' }, ': nothing in it can change, so it cannot be edited by accident.')),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => document.getElementById('lockm').click() }, 'Unlock to edit'));
    }
    // Offer auto-fill in the roster itself when nothing in this month was auto-filled or entered yet.
    let any = false;
    for (const d of c.days) {
      const day = state.cells?.[d];
      if (!day) continue;
      for (const sid in day) if ((day[sid].a || []).some(code => c.autoCodes.includes(code))) { any = true; break; }
      if (any) break;
    }
    // (not while Getting started is showing: its next step says the same)
    banner.hidden = locked || any || !(state.staff || []).length || !!document.querySelector('.guide-slot:not([hidden]) .gs');
    if (banner.hidden) return;
    banner.innerHTML = '';
    banner.append(
      h('span', { class: 'rb-ic', html: icon('spark') }),
      h('span', { class: 'rb-text' }, h('strong', null, `No calls or shifts in ${M.fmtMonth(app.month)} yet. `), 'Enter leave and requests first, then let Fill draft the calls and PM shifts around them.'),
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => openAutofill(app, { quick: true }) }, 'Fill this month'));
  }

  // Bring a day's column into view (only scrolls when it is hidden behind the name column or off the right edge).
  function revealDay(th) {
    const nmW = scroll.querySelector('th.nh')?.offsetWidth || 150;
    const left = th.offsetLeft, right = left + th.offsetWidth;
    if (left - nmW >= scroll.scrollLeft && right <= scroll.scrollLeft + scroll.clientWidth) return;
    scroll.scrollLeft = Math.max(0, left - nmW - th.offsetWidth * 2);
  }
  function scrollToToday() {
    const th = scroll.querySelector('th.dh.td');
    if (!th) { scroll.scrollLeft = 0; return; }
    revealDay(th);
  }

  function selBtn() {
    if (!sel) return null;
    const q = () => scroll.querySelector(`.cell[data-d="${sel.date}"][data-s="${CSS.escape(sel.staffId)}"]`);
    let b = q();
    if (!b && pending) { flushRows(); b = q(); }   // its row may not be drawn yet
    return b;
  }

  function setSel(d, s, focus = true) {
    const old = selBtn();
    if (old) old.tabIndex = -1;
    sel = { date: d, staffId: s };
    app.selectCell(d, s);
    focusSel(focus);
  }

  function focusSel(focus = true) {
    const b = selBtn();
    if (!b) return;
    b.tabIndex = 0;
    if (focus) {
      b.focus({ preventScroll: true });
      keepVisible(b);
    }
  }

  // Scroll the cell into view, clear of the sticky name column and header.
  function keepVisible(b) {
    const td = b.parentElement;
    const nmW = scroll.querySelector('th.nh')?.offsetWidth || 0;
    const headH = scroll.querySelector('thead')?.offsetHeight || 0;
    const left = td.offsetLeft, top = td.offsetTop;
    if (left - nmW < scroll.scrollLeft) scroll.scrollLeft = left - nmW;
    else if (left + td.offsetWidth > scroll.scrollLeft + scroll.clientWidth) scroll.scrollLeft = left + td.offsetWidth - scroll.clientWidth;
    if (top - headH - 26 < scroll.scrollTop) scroll.scrollTop = Math.max(0, top - headH - 26);
    else if (top + td.offsetHeight > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = top + td.offsetHeight - scroll.clientHeight + 8;
  }

  // ---------- grid events ----------
  scroll.addEventListener('click', (e) => {
    const nb = e.target.closest('.nm-btn');
    if (nb) { app.go('roster', { m: app.month, p: nb.dataset.p }); return; }
    const b = e.target.closest('.cell');
    if (!b || ui.paint) return;
    setSel(b.dataset.d, b.dataset.s, true);
    openEditor(b.dataset.d, b.dataset.s, b);
  });
  scroll.addEventListener('focusin', (e) => {
    const b = e.target.closest('.cell');
    if (!b) return;
    if (!sel || sel.date !== b.dataset.d || sel.staffId !== b.dataset.s) {
      const old = selBtn(); if (old && old !== b) old.tabIndex = -1;
      sel = { date: b.dataset.d, staffId: b.dataset.s };
      app.selectCell(sel.date, sel.staffId);
      b.tabIndex = 0;
    }
  });
  scroll.addEventListener('keydown', onGridKey);
  scroll.addEventListener('pointerdown', onPaintDown);
  scroll.addEventListener('scroll', () => { if (editor && !app.isPhone()) positionPopover(); }, { passive: true });

  function moveSel(dx, dy) {
    if (!sel) return;
    flushRows();
    const days = ctx.days;
    const rows = [...scroll.querySelectorAll('tbody tr:not(.grp-row) .nm-btn')].map(b => b.dataset.p);
    let di = days.indexOf(sel.date) + dx, ri = rows.indexOf(sel.staffId) + dy;
    di = Math.max(0, Math.min(days.length - 1, di));
    ri = Math.max(0, Math.min(rows.length - 1, ri));
    // skip "not in post" cells along the way
    const target = scroll.querySelector(`.cell[data-d="${days[di]}"][data-s="${CSS.escape(rows[ri])}"]`);
    if (target) setSel(days[di], rows[ri]);
  }

  function onGridKey(e) {
    const b = e.target.closest('.cell');
    if (!b) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowRight') { e.preventDefault(); moveSel(1, 0); }
    else if (k === 'ArrowLeft') { e.preventDefault(); moveSel(-1, 0); }
    else if (k === 'ArrowDown') { e.preventDefault(); moveSel(0, 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); moveSel(0, -1); }
    else if (k === 'Home') { e.preventDefault(); moveSel(-99, 0); }
    else if (k === 'End') { e.preventDefault(); moveSel(99, 0); }
    else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      if (typed && k === 'Enter') applyTyped();
      else if (!ui.paint) openEditor(sel.date, sel.staffId, b);
      else paintOne(b);
    } else if ((k === 'Delete' || k === 'Backspace') && !typed) {
      e.preventDefault();
      clearCell(sel.date, sel.staffId);
    } else if (k === 'Backspace' && typed) {
      e.preventDefault(); setTyped(typed.slice(0, -1));
    } else if (k === 'Escape' && typed) {
      e.preventDefault(); setTyped('');
    } else if (/^[a-zA-Z0-9]$/.test(k)) {
      e.preventDefault(); setTyped((typed + k).slice(0, 8));
    }
  }

  function setTyped(v) {
    typed = v;
    clearTimeout(typedTimer);
    typedPill.hidden = !typed;
    if (typed) {
      const match = findCode(typed);
      typedPill.innerHTML = '';
      typedPill.append(h('kbd', null, typed), match ? ` ${match.name} · Enter to add or remove` : ' (no such code yet)');
      typedTimer = setTimeout(() => setTyped(''), 4000);
    }
  }

  function findCode(t) {
    const duties = (app.store.get().duties || []).filter(d => d.kind !== 'derived');
    return duties.find(d => d.code === t) || duties.find(d => d.code.toLowerCase() === t.toLowerCase());
  }

  function applyTyped() {
    const du = findCode(typed);
    if (!du) { app.toast(`No code "${typed}". Add it under People › Duty codes.`, { kind: 'warn' }); setTyped(''); return; }
    const state = app.store.get();
    const on = !cellHas(state, sel.date, sel.staffId, du.code);
    const name = personName(state, sel.staffId);
    app.store.commit(`${on ? 'Add' : 'Remove'} ${du.code} · ${name} ${M.fmtDay(sel.date)}`, draft => toggleCode(draft, sel.date, sel.staffId, du.code, on, M.dutyMap(draft)));
    setTyped('');
  }

  function clearCell(d, s) {
    const state = app.store.get();
    if (!M.getCell(state, d, s)) return;
    app.store.commit(`Clear ${personName(state, s)} ${M.fmtDay(d)}`, draft => {
      if (draft.cells?.[d]) { delete draft.cells[d][s]; if (!Object.keys(draft.cells[d]).length) delete draft.cells[d]; }
    });
  }

  // ---------- paint mode ----------
  function onPaintDown(e) {
    if (!ui.paint || e.button > 0) return;
    const b = e.target.closest('.cell');
    if (!b || !ui.paintCode) return;
    // Touch: a swipe scrolls the grid as usual (the browser cancels the pointer); only a tap paints one cell.
    if (e.pointerType === 'touch') {
      const x0 = e.clientX, y0 = e.clientY;
      const end = (ev) => {
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        if (ev.type !== 'pointerup' || Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) return;
        const state = app.store.get();
        const code = ui.paintCode;
        paintDrag = { code, mode: code === '__clear' ? 'del' : cellHas(state, b.dataset.d, b.dataset.s, code) ? 'del' : 'add', cells: new Map(), last: null };
        addPaintCell(b);
        finishPaint();
      };
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      return;
    }
    e.preventDefault();
    try { if (b.hasPointerCapture?.(e.pointerId)) b.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const state = app.store.get();
    const code = ui.paintCode;
    const mode = code === '__clear' ? 'del' : cellHas(state, b.dataset.d, b.dataset.s, code) ? 'del' : 'add';
    paintDrag = { code, mode, cells: new Map(), last: null };
    addPaintCell(b);
    const move = (ev) => {
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.cell');
      if (t && scroll.contains(t)) addPaintCell(t);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      finishPaint();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function addPaintCell(b) {
    flushRows();
    const d = b.dataset.d, s = b.dataset.s;
    const last = paintDrag.last;
    // fast drags skip cells: fill the gap along the same row
    if (last && last.s === s && last.d !== d) {
      const days = ctx.days;
      const i0 = days.indexOf(last.d), i1 = days.indexOf(d);
      const [a, z] = i0 < i1 ? [i0, i1] : [i1, i0];
      for (let i = a + 1; i < z; i++) {
        const mid = scroll.querySelector(`.cell[data-d="${days[i]}"][data-s="${CSS.escape(s)}"]`);
        if (mid) markPaint(mid);
      }
    }
    markPaint(b);
    paintDrag.last = { d, s };
  }

  function markPaint(b) {
    const k = key(b.dataset.d, b.dataset.s);
    if (paintDrag.cells.has(k)) return;
    paintDrag.cells.set(k, { d: b.dataset.d, s: b.dataset.s });
    b.classList.add(paintDrag.mode === 'add' ? 'p-add' : 'p-del');
    if (paintDrag.mode === 'add') b.setAttribute('data-paint', paintDrag.code);
  }

  function finishPaint() {
    const p = paintDrag;
    paintDrag = null;
    scroll.querySelectorAll('.p-add, .p-del').forEach(b => { b.classList.remove('p-add', 'p-del'); b.removeAttribute('data-paint'); });
    if (!p || !p.cells.size) return;
    const n = p.cells.size;
    const label = p.code === '__clear' ? `Clear ${n} cell${n > 1 ? 's' : ''}` : `${p.mode === 'add' ? 'Paint' : 'Remove'} ${p.code} on ${n} cell${n > 1 ? 's' : ''}`;
    app.store.commit(label, draft => {
      const dmap = M.dutyMap(draft);
      for (const { d, s } of p.cells.values()) {
        if (p.code === '__clear') {
          if (draft.cells?.[d]?.[s]) { delete draft.cells[d][s]; if (!Object.keys(draft.cells[d]).length) delete draft.cells[d]; }
        } else toggleCode(draft, d, s, p.code, p.mode === 'add', dmap);
      }
    });
  }

  function paintOne(b) {
    paintDrag = { code: ui.paintCode, mode: ui.paintCode === '__clear' || cellHas(app.store.get(), b.dataset.d, b.dataset.s, ui.paintCode) ? 'del' : 'add', cells: new Map(), last: null };
    markPaint(b);
    finishPaint();
  }

  // ---------- cell editor ----------
  function personName(state, sid) {
    const p = (state.staff || []).find(x => x.id === sid);
    return p ? (p.short || p.name) : 'Someone';
  }

  // The editor is built once and then updated in place after each change (the chips' on/off, the problems, the
  // note): rebuilding ~45 buttons and re-focusing one made every tap in it slow on phones (speed).
  function editorBody(d, sid) {
    const wrap = h('div', { class: 'ced' });
    let built = null;   // { key, chips: [{ b, code, kind, field }], firstSec, noteSec, note, lock, clear, extras: [] }
    const cellNow = () => ({ ...emptyCell(), ...(M.getCell(app.store.get(), d, sid) || {}) });
    const who = () => `${personName(app.store.get(), sid)} ${M.fmtDay(d)}`;

    function build(state, key) {
      wrap.innerHTML = '';
      const chips = [], secs = [];
      for (const [kind, title] of KIND_ORDER) {
        const list = (state.duties || []).filter(x => x.kind === kind);
        if (!list.length) continue;
        const field = kind === 'request' ? 'r' : 'a';
        const sec = h('div', { class: 'ced-sec' }, h('h3', { class: 'ced-h' }, title));
        const box = h('div', { class: 'ced-chips' });
        for (const du of list) {
          const b = h('button', {
            type: 'button', class: `tchip k-${kind}`, 'aria-pressed': 'false',
            'data-code': du.code, title: du.name, 'aria-label': `${du.code}, ${du.name}`, style: chipVars(du),
            onclick: () => {
              const on = (cellNow()[field] || []).includes(du.code);
              app.store.commit(`${on ? 'Remove' : 'Add'} ${du.code} · ${who()}`, draft => toggleCode(draft, d, sid, du.code, !on, M.dutyMap(draft)));
            },
          }, h('span', { class: 'tc-code' }, du.code), h('span', { class: 'tc-name' }, du.name));
          chips.push({ b, code: du.code, kind, field });
          box.append(b);
        }
        sec.append(box);
        secs.push(sec);
        wrap.append(sec);
      }
      const note = h('textarea', { class: 'input ced-note', rows: '2', placeholder: 'Note (e.g. 3-4.30pm meeting)', 'aria-label': 'Note' });
      note.addEventListener('change', () => {
        const v = note.value.trim();
        if (v === (cellNow().note || '')) return;
        app.store.commit(`Note · ${who()}`, draft => M.setCell(draft, d, sid, { note: v }));
      });
      const lockId = 'lk-' + Math.random().toString(36).slice(2, 7);
      const lock = h('input', { type: 'checkbox', id: lockId });
      lock.addEventListener('change', () => app.store.commit(`${lock.checked ? 'Lock' : 'Unlock'} ${who()}`, draft => M.setCell(draft, d, sid, { lock: lock.checked })));
      const noteSec = h('div', { class: 'ced-sec' }, h('h3', { class: 'ced-h' }, 'Note'), note);
      wrap.append(noteSec);
      const clear = h('button', { type: 'button', class: 'btn btn-danger-ghost btn-sm', onclick: () => clearCell(d, sid) }, 'Clear');
      wrap.append(h('div', { class: 'ced-row' },
        h('label', { class: 'switch', for: lockId }, lock, h('span', { class: 'sw-track', 'aria-hidden': 'true' }), h('span', null, 'Lock (auto-fill won\'t change it)')),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { app.go('day', { d, m: app.month }); closeEditor(); } }, 'Open day'),
        clear));
      built = { key, chips, firstSec: secs[0] || noteSec, noteSec, note, lock, clear, extras: [] };
    }

    const fill = () => {
      const state = app.store.get();
      const dkey = JSON.stringify((state.duties || []).map(x => [x.code, x.name, x.kind, x.color, x.ink]));
      if (!built || built.key !== dkey) build(state, dkey);
      const dmap = M.dutyMap(state);
      const cell = cellNow();
      const ev = app.evaluation();
      const vs = ev.byCell?.get(key(d, sid)) || [];
      // the lines above the chips (post call, auto-filled, locked, problems) and the unknown-codes line: small, redrawn
      for (const x of built.extras) x.remove();
      built.extras = [];
      const post = prevHasOvernight(state, d, sid, new Set((state.duties || []).filter(x => x.overnight).map(x => x.code)));
      if (post || (cell.auto || []).length || cell.lock) {
        const info = h('p', { class: 'ced-info' });
        if (post) info.append(h('span', { class: 'chip dx' }, 'x'), ' Post call (after an overnight duty). ');
        if ((cell.auto || []).length) info.append(`Auto-filled: ${cell.auto.join(', ')}. Editing a code makes it yours; auto-fill then keeps it. `);
        if (cell.lock) info.append('Locked: auto-fill leaves this cell alone.');
        built.extras.push(info);
      }
      if (vs.length) {
        built.extras.push(h('ul', { class: 'ced-viol' }, vs.map(v => h('li', { class: v.hard ? 'vh' : 'vs' },
          h('span', { class: 'vi', html: app.icon('alert') }), h('span', null, v.msg, v.hard ? '' : h('span', { class: 'muted' }, ' (soft)'))))));
      }
      for (const x of built.extras) wrap.insertBefore(x, built.firstSec);
      // Cr / Nc in the cell: how much each counts, and Must / Auto / If possible
      const prow = priorityRow(app, d, sid);
      if (prow) { wrap.insertBefore(prow, built.noteSec); built.extras.push(prow); }
      const unknown = [...(cell.a || []), ...(cell.r || [])].filter(c => !dmap.has(c));
      if (unknown.length) {
        const u = h('p', { class: 'ced-info' }, `Codes not in the list: ${unknown.join(', ')}. Add them under People › Duty codes.`);
        wrap.insertBefore(u, built.noteSec);
        built.extras.push(u);
      }
      for (const { b, code, kind, field } of built.chips) {
        const on = (cell[field] || []).includes(code);
        const cls = `tchip k-${kind}${on ? ' on' : ''}${(cell.auto || []).includes(code) ? ' au' : ''}`;
        if (b.className !== cls) b.className = cls;
        b.setAttribute('aria-pressed', String(on));
      }
      // a note being typed is kept; otherwise show the saved one
      if (document.activeElement !== built.note) built.note.value = cell.note || '';
      built.lock.checked = !!cell.lock;
      built.clear.disabled = !M.getCell(state, d, sid);
    };
    fill();
    return { wrap, fill };
  }

  function openEditor(d, sid, anchor) {
    closeEditor();
    const state = app.store.get();
    const p = (state.staff || []).find(x => x.id === sid);
    if (!p) return;
    const title = `${p.name} · ${M.fmtDay(d)}`;
    const { wrap, fill } = editorBody(d, sid);
    if (app.isPhone()) {
      const close = app.sheet({ title, body: wrap, className: 'ced-sheet', actions: [{ label: 'Done', primary: true }], onClose: () => { if (editor && editor.close === close) editor = null; } });
      editor = { d, s: sid, close, refresh: fill };
      return;
    }
    const pop = h('div', { class: 'popover', role: 'dialog', 'aria-label': title },
      h('div', { class: 'pop-head' }, h('h2', { class: 'pop-title' }, p.name, h('span', { class: 'pop-sub' }, M.fmtDay(d) + (M.isHoliday(state, d) ? ' · ' + (M.holidayName(state, d) || 'Public holiday') : ''))),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', html: app.icon('close'), onclick: () => closeEditor(true) })),
      h('div', { class: 'pop-body' }, wrap));
    document.body.append(pop);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeEditor(true); } };
    const onDown = (e) => { if (!pop.contains(e.target) && !e.target.closest?.('.cell') && !e.target.closest?.('.sheet-back') && !e.target.closest?.('.toast') && !e.target.closest?.('.task-card')) closeEditor(false); };
    pop.addEventListener('keydown', onKey);
    setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    editor = {
      d, s: sid, el: pop, refresh: fill,
      close: (refocus) => {
        document.removeEventListener('mousedown', onDown);
        pop.remove();
        if (refocus) focusSel(true);
      },
    };
    positionPopover(anchor);
    requestAnimationFrame(() => pop.querySelector('.tchip')?.focus({ preventScroll: true }));
  }

  function positionPopover(anchor) {
    if (!editor || !editor.el) return;
    if (!(anchor && document.contains(anchor))) flushRows();
    const a = anchor && document.contains(anchor) ? anchor : scroll.querySelector(`.cell[data-d="${editor.d}"][data-s="${CSS.escape(editor.s)}"]`);
    if (!a) return;
    const r = a.getBoundingClientRect();
    const pop = editor.el;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = r.right + 8;
    if (left + pw > vw - 8) left = r.left - pw - 8;
    if (left < 8) left = Math.max(8, Math.min(vw - pw - 8, r.left));
    let top = r.top - 40;
    top = Math.max(8, Math.min(vh - ph - 8, top));
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function closeEditor(refocus = false) {
    if (!editor) return;
    const e = editor;
    editor = null;
    e.close(refocus);
  }

  // ---------- one person's month ----------
  function renderPerson(sid) {
    const state = app.store.get();
    const p = (state.staff || []).find(x => x.id === sid);
    if (!p) { app.go('roster', { m: app.month }); return; }
    const days = M.monthDays(app.month);
    const dmap = M.dutyMap(state);
    const dutyIdx = new Map((state.duties || []).map((d, i) => [d.code, i]));
    const overnight = new Set((state.duties || []).filter(d => d.overnight).map(d => d.code));
    const ev = app.evaluation();
    const today = M.iso(new Date());
    const list = M.staffInView(state, app.month);
    const idx = list.findIndex(x => x.id === sid);
    const prev = list[idx - 1], next = list[idx + 1];
    const g = M.groupMap(state).get(p.group);
    const tags = (p.tags || []).map(t => (state.tags || []).find(x => x.id === t)?.name || t);

    // counts
    const counts = new Map();
    let wk = 0, req = 0, probs = [];
    for (const d of days) {
      const cell = state.cells?.[d]?.[sid];
      if (cell) {
        for (const c of cell.a || []) counts.set(c, (counts.get(c) || 0) + 1);
        req += (cell.r || []).length;
        if ((cell.a || []).includes('C') && (M.isWeekend(d) || M.isHoliday(state, d))) wk++;
      }
      probs = probs.concat(ev.byCell?.get(key(d, sid)) || []);
    }
    // problems about the whole month (fair share, a monthly minimum) have no day: list them first
    probs = (ev.violations || []).filter(v => v.staffId === sid && !v.date && !(v.dates || []).length).concat([...new Set(probs)]);
    personHost.innerHTML = '';
    const head = h('div', { class: 'ps-head' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => app.go('roster', { m: app.month }), html: `${app.icon('back')}<span>Roster</span>` }),
      h('div', { class: 'ps-id' }, h('h2', { class: 'ps-name' }, p.name), h('p', { class: 'ps-meta' }, [g?.name, ...tags, p.note].filter(Boolean).join(' · '))),
      h('div', { class: 'ps-nav' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': prev ? `Previous person: ${prev.name}` : 'No previous person', disabled: !prev, html: app.icon('left'), onclick: () => prev && app.go('roster', { m: app.month, p: prev.id }) }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': next ? `Next person: ${next.name}` : 'No next person', disabled: !next, html: app.icon('right'), onclick: () => next && app.go('roster', { m: app.month, p: next.id }) })));
    const stats = h('div', { class: 'ps-stats' });
    const order = (state.duties || []).filter(d => counts.has(d.code));
    for (const du of order) {
      const i = dutyIdx.get(du.code);
      stats.append(h('div', { class: 'stat' }, h('span', { class: `chip dc-${i} k-${du.kind}` }, du.code), h('span', { class: 'stat-n' }, String(counts.get(du.code))), h('span', { class: 'stat-l' }, du.name)));
    }
    if (dmap.has('C')) stats.append(h('div', { class: 'stat' }, h('span', { class: 'chip ghost' }, 'Wk'), h('span', { class: 'stat-n' }, String(wk)), h('span', { class: 'stat-l' }, 'Weekend / PH calls')));
    stats.append(h('div', { class: 'stat' }, h('span', { class: 'chip ghost' }, 'Rq'), h('span', { class: 'stat-n' }, String(req)), h('span', { class: 'stat-l' }, 'Requests')));
    if (!order.length && !req) stats.append(h('p', { class: 'muted' }, 'Nothing entered for this month yet.'));

    // calendar: Sunday first like the department sheet
    const cal = h('div', { class: 'cal', role: 'grid', 'aria-label': `${p.name}, ${M.fmtMonth(app.month)}` });
    const hdr = h('div', { class: 'cal-row cal-hdr', role: 'row' }, WD.map(w => h('div', { class: 'cal-wd', role: 'columnheader' }, w)));
    cal.append(hdr);
    let row = h('div', { class: 'cal-row', role: 'row' });
    const lead = M.weekday(days[0]);
    for (let i = 0; i < lead; i++) row.append(h('div', { class: 'cal-pad', role: 'gridcell', 'aria-hidden': 'true' }));
    for (const d of days) {
      if (M.weekday(d) === 0 && row.children.length) { cal.append(row); row = h('div', { class: 'cal-row', role: 'row' }); }
      const cell = state.cells?.[d]?.[sid];
      const vs = ev.byCell?.get(key(d, sid)) || [];
      const prevC = state.cells?.[M.addDays(d, -1)]?.[sid];
      const post = !!prevC && (prevC.a || []).some(c => overnight.has(c));
      const hol = M.isHoliday(state, d) ? (M.holidayName(state, d) || 'Public holiday') : '';
      const inPost = M.staffActiveOn(p, d);
      const names = [];
      const box = h('button', {
        type: 'button', class: `cal-day${M.isWeekend(d) ? ' we' : ''}${hol ? ' hol' : ''}${d === today ? ' td' : ''}${inPost ? '' : ' off'}`,
        role: 'gridcell', disabled: !inPost,
        onclick: (e) => { sel = { date: d, staffId: sid }; app.selectCell(d, sid); openEditor(d, sid, e.currentTarget); },
      });
      box.append(h('span', { class: 'cd-num' }, String(+d.slice(8)), hol ? h('span', { class: 'cd-hol' }, hol) : null));
      const chips = h('span', { class: 'cd-chips' });
      for (const c of cell?.a || []) {
        const du = dmap.get(c);
        chips.append(h('span', { class: `chip dc-${dutyIdx.get(c)} k-${du?.kind || 'other'}${(cell.auto || []).includes(c) ? ' au' : ''}` }, c));
        names.push(du ? du.name : c);
      }
      for (const c of cell?.r || []) { const mk = (cell.rp && cell.rp[c]) || ''; chips.append(h('span', { class: `chip rq dc-${dutyIdx.get(c)}` }, c + mk)); names.push('request ' + (dmap.get(c)?.name || c) + (mk === '!' ? ', must' : mk === '?' ? ', if possible' : '')); }
      if (post) { chips.append(h('span', { class: 'chip dx' }, 'x')); names.push('post call'); }
      box.append(chips);
      if (cell?.note) { box.append(h('span', { class: 'cd-note' }, cell.note)); names.push('note: ' + cell.note); }
      if (vs.length) { box.append(h('span', { class: `vx ${vs.some(v => v.hard) ? 'vh' : 'vs'}` })); names.push(`${vs.length} problem${vs.length > 1 ? 's' : ''}`); }
      if (cell?.lock) { box.append(h('span', { class: 'lk' })); names.push('locked'); }
      box.setAttribute('aria-label', `${M.fmtDay(d)}${hol ? ', ' + hol : ''}: ${inPost ? (names.join(', ') || 'empty') : 'not in post'}`);
      row.append(box);
    }
    while (row.children.length < 7) row.append(h('div', { class: 'cal-pad', role: 'gridcell', 'aria-hidden': 'true' }));
    cal.append(row);

    personHost.append(head, stats, cal);
    if (probs.length) {
      personHost.append(h('div', { class: 'card ps-probs' }, h('h3', null, `Problems this month (${probs.length})`),
        h('ul', { class: 'plist' }, probs.map(v => h('li', { class: v.hard ? 'vh' : 'vs' }, h('span', { class: 'vi', html: app.icon('alert') }), h('span', null, v.msg))))));
    }
  }

  // ---------- render / route ----------
  function render(opts = {}) {
    const state = app.store.get();
    const pid = app.params.p;
    const personMode = !!pid && (state.staff || []).some(x => x.id === pid);
    root.classList.toggle('person-mode', personMode);
    tb.hidden = personMode; body.hidden = personMode; personHost.hidden = !personMode;
    if (personMode) {
      paintBar.hidden = true; banner.hidden = true;
      dutyStyles(state);
      renderPerson(pid);
      if (lastPerson !== pid) { el.closest('.main')?.scrollTo(0, 0); lastPerson = pid; }
    } else {
      lastPerson = null;
      fillSelects(state);
      renderPaintBar(state);
      renderGrid();
      if (firstRender || opts.month) {
        const sc = app.selectedCell;
        if (sc && sc.date && sc.date.startsWith(app.month) && sc.staffId) {
          sel = { ...sc };
          focusSel(false);
          const b = selBtn();
          if (b) { keepVisible(b); b.parentElement.classList.add('flash'); setTimeout(() => b.parentElement?.classList.remove('flash'), 1600); }
        } else if (sc && sc.date && sc.date.startsWith(app.month)) {
          const th = scroll.querySelector(`th.dh[data-d="${sc.date}"]`);
          if (th) {
            revealDay(th);
            th.classList.add('flash'); setTimeout(() => th.classList.remove('flash'), 1600);
          }
        } else scrollToToday();
        firstRender = false;
      }
    }
    if (editor) {
      if (opts.month) closeEditor();
      else editor.refresh();
    }
  }

  render();

  return {
    update(state, info = {}) { render({ month: !!info.month }); },
    route(params) { render({ month: false }); },
    unmount() { closeEditor(); clearTimeout(typedTimer); if (pending) { cancelAnimationFrame(pending.raf); clearTimeout(pending.timer); pending = null; } },
  };
}

function safeColor(c, fallback) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$|^[a-z]+$|^rgba?\([\d\s.,%]+\)$/.test(c) ? c : fallback;
}

// Duty colours are the owner's data, so make sure chip text stays readable (WCAG AA 4.5:1 for small text):
// if the ink on the background is too faint, darken (light ink) or lighten (dark ink) the background step by step.
function hexRgb(c) {
  if (typeof c !== 'string' || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return null;
  let x = c.slice(1);
  if (x.length === 3) x = x.split('').map(ch => ch + ch).join('');
  return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16));
}
function lum([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const toHex = (rgb) => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const contrastCache = new Map();
export function readable(bg, ink) {
  const k = bg + '/' + ink;
  if (contrastCache.has(k)) return contrastCache.get(k);
  let out = { c: safeColor(bg, '#e0e0e0'), i: safeColor(ink, '#222') };
  const B = hexRgb(bg), I = hexRgb(ink);
  if (B && I && contrast(B, I) < 4.6) {
    const inkLight = lum(I) > lum(B);
    let cur = B;
    for (let n = 0; n < 40 && contrast(cur, I) < 4.6; n++) cur = cur.map(v => inkLight ? v * 0.94 : v + (255 - v) * 0.12);
    if (contrast(cur, I) < 4.6) out.i = inkLight ? '#000000' : '#ffffff';
    else out.c = toHex(cur);
  }
  contrastCache.set(k, out);
  return out;
}
// CSS custom properties for a chip of this duty: { '--c', '--i' } (requests are outlined: their colour is the text)
export function chipVars(du) {
  if (!du) return { '--c': '#e0e0e0', '--i': '#333' };
  if (du.kind === 'request') { const r = readable('#ffffff', du.color || '#0b5394'); return { '--c': r.i, '--i': r.i }; }
  const r = readable(du.color || '#e0e0e0', du.ink || '#222');
  return { '--c': r.c, '--i': r.i };
}

// ---------- Auto-fill dialog ----------
let runCount = 0;

export function openAutofill(app, { quick = false } = {}) {
  const { h } = app;
  const state = app.store.get();
  if (!(state.staff || []).length) { app.toast('Add staff first: People, or import the Excel sheet.', { kind: 'warn' }); return; }
  const days = M.monthDays(app.month);
  const from = days[0], to = days[days.length - 1];
  const autoDuties = (state.duties || []).filter(d => d.auto);
  const wrap = h('div', { class: 'af' });
  let worker = null, stopped = false, t0 = 0, tick = 0;
  let timeMs = 6000;
  try { timeMs = +localStorage.getItem('ntf-roster-af-time') || 6000; } catch (e) { /* ignore */ }
  // what to fill, remembered on this device: codes (null = all), also assign the free APS weeks, apply when done
  let pref = { codes: null, aps: true, auto: true };
  try { pref = { ...pref, ...JSON.parse(localStorage.getItem('ntf-roster-af-pref') || '{}') }; } catch (e) { /* ignore */ }
  const savePref = () => { try { localStorage.setItem('ntf-roster-af-pref', JSON.stringify(pref)); } catch (e) { /* ignore */ } };
  const chosenCodes = () => { const all = autoDuties.map(d => d.code); const c = Array.isArray(pref.codes) ? all.filter(x => pref.codes.includes(x)) : all; return c.length ? c : all; };
  const apsOpen = () => (state.settings && state.settings.pool) !== 'senior' ? suggestMonth(state, app.month).filter(w => !w.holder && w.pick) : [];

  const close = app.sheet({
    title: `Auto-fill ${M.fmtMonth(app.month)}`, body: wrap, className: 'af-sheet',
    onClose: () => { stopWorker(); },
  });

  function stopWorker() {
    stopped = true;
    clearInterval(tick);
    if (worker) { worker.terminate(); worker = null; }
  }

  // Existing auto vs manual entries in the month
  function counts(s) {
    let auto = 0, manual = 0, locked = 0;
    const autoSet = new Set(autoDuties.map(d => d.code));
    for (const d of days) {
      const day = s.cells?.[d];
      if (!day) continue;
      for (const sid in day) {
        const c = day[sid];
        if (c.lock) locked++;
        for (const code of c.a || []) {
          if (!autoSet.has(code)) continue;
          if ((c.auto || []).includes(code)) auto++; else manual++;
        }
      }
    }
    return { auto, manual, locked };
  }

  function stageOptions() {
    stopped = false;
    const n = counts(state);
    wrap.innerHTML = '';
    wrap.append(
      h('p', null, 'Drafts ', h('strong', null, autoDuties.map(d => d.code).join(', ') || 'no codes'), ` for ${M.fmtMonth(app.month)} from your rules (cover, limits, requests, pairings), then improves it while you watch.`),
      h('ul', { class: 'af-keep' },
        h('li', null, 'Kept as they are: leave, requests, notes and anything entered by hand', n.manual ? ` (${n.manual} hand-entered shift${n.manual > 1 ? 's' : ''})` : '', '.'),
        n.locked ? h('li', null, `${n.locked} locked cell${n.locked > 1 ? 's are' : ' is'} left alone.`) : null,
        n.auto ? h('li', null, `${n.auto} earlier auto-filled shift${n.auto > 1 ? 's' : ''} may change.`) : null,
        h('li', null, 'Nothing changes until you press Apply, and Apply can be undone.')));
    // upper bounds: the search usually ends sooner, once it stops finding a better roster
    const chosen = new Set(chosenCodes());
    const cs = h('fieldset', { class: 'af-time' }, h('legend', null, 'Fill these'));
    for (const d of autoDuties) {
      const id = 'af-c-' + d.code;
      const cb = h('input', { type: 'checkbox', id, checked: chosen.has(d.code) });
      cb.addEventListener('change', () => { const on = autoDuties.map(x => x.code).filter(c => wrap.querySelector('#af-c-' + c)?.checked); pref.codes = on; savePref(); });
      cs.append(h('label', { class: 'af-opt', for: id }, cb, h('span', { class: 'af-opt-l' }, d.code), h('span', { class: 'af-opt-s' }, d.name || '')));
    }
    wrap.append(cs);
    const nAps = apsOpen().length;
    if (nAps) {
      const cb = h('input', { type: 'checkbox', id: 'af-aps', checked: !!pref.aps });
      cb.addEventListener('change', () => { pref.aps = cb.checked; savePref(); });
      wrap.append(h('label', { class: 'af-opt', for: 'af-aps' }, cb, h('span', { class: 'af-opt-l' }, `Also assign the ${nAps} free APS week${nAps > 1 ? 's' : ''}`), h('span', { class: 'af-opt-s' }, 'suggested people, fewest weeks first')));
    }
    const ca = h('input', { type: 'checkbox', id: 'af-auto', checked: !!pref.auto });
    ca.addEventListener('change', () => { pref.auto = ca.checked; savePref(); });
    wrap.append(h('label', { class: 'af-opt', for: 'af-auto' }, ca, h('span', { class: 'af-opt-l' }, 'Apply when done'), h('span', { class: 'af-opt-s' }, 'you can Undo; stops to show you if rules are unmet')));
    const times = [[3000, 'Quick', '3 s'], [6000, 'Normal', '6 s'], [15000, 'Thorough', '15 s']];
    const fs = h('fieldset', { class: 'af-time' }, h('legend', null, 'Search for at most'));
    for (const [ms, label, sub] of times) {
      const id = 'af-t-' + ms;
      const r = h('input', { type: 'radio', name: 'af-time', id, value: String(ms), checked: ms === timeMs });
      r.addEventListener('change', () => { timeMs = ms; try { localStorage.setItem('ntf-roster-af-time', String(ms)); } catch (e) { /* ignore */ } });
      fs.append(h('label', { class: 'af-opt', for: id }, r, h('span', { class: 'af-opt-l' }, label), h('span', { class: 'af-opt-s' }, sub)));
    }
    wrap.append(fs);
    if (!autoDuties.length) wrap.append(h('p', { class: 'warn-box' }, 'No duty is marked "auto-fill" yet. Mark codes under People › Duty codes.'));
    wrap.append(h('div', { class: 'af-actions' },
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, 'Cancel'),
      h('button', { type: 'button', class: 'btn btn-primary', disabled: !autoDuties.length, onclick: run, html: `${app.icon('spark')}<span>Start</span>` })));
  }

  function stageProgress() {
    wrap.innerHTML = '';
    const bar = h('div', { class: 'af-bar', role: 'progressbar', 'aria-label': 'Auto-fill progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, h('span', { class: 'af-bar-fill' }));
    wrap.append(
      h('p', { class: 'af-status', 'aria-live': 'polite' }, 'Building a first draft…'),
      bar,
      h('div', { class: 'af-live' },
        h('div', { class: 'af-num' }, h('span', { class: 'af-n af-hard' }, '–'), h('span', null, 'must-fix')),
        h('div', { class: 'af-num' }, h('span', { class: 'af-n af-soft' }, '–'), h('span', null, 'to improve')),
        h('div', { class: 'af-num' }, h('span', { class: 'af-n af-time-n' }, '0 s'), h('span', null, 'elapsed'))),
      h('div', { class: 'af-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { stopWorker(); stageOptions(); }, html: `${app.icon('stop')}<span>Stop</span>` })));
    t0 = performance.now();
    shownPct = 0;
    tick = setInterval(() => {
      const el = wrap.querySelector('.af-time-n');
      if (el) el.textContent = Math.round((performance.now() - t0) / 1000) + ' s';
      const pct = Math.min(99, ((performance.now() - t0) / timeMs) * 100);
      setPct(pct);
    }, 250);
  }

  let apsPicks = [];
  let shownPct = 0;   // the bar only moves forward (the clock and the solver's own count both feed it)
  function setPct(pct) {
    const bar = wrap.querySelector('.af-bar');
    if (!bar) return;
    pct = shownPct = Math.max(shownPct, pct);
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    bar.firstChild.style.width = pct + '%';
  }

  function onProgress(m) {
    if (stopped) return;
    const hEl = wrap.querySelector('.af-hard'), sEl = wrap.querySelector('.af-soft'), st = wrap.querySelector('.af-status');
    if (m.best && hEl) { hEl.textContent = m.best.hard; sEl.textContent = m.best.soft; hEl.classList.toggle('zero', !m.best.hard); }
    if (st) st.textContent = m.best && m.best.hard === 0 ? 'All must-fix rules met. Improving fairness and requests…' : 'Searching for a better roster…';
    if (typeof m.pct === 'number') setPct(Math.max(0, Math.min(100, m.pct)));
  }

  function run() {
    runCount++;
    const seed = runCount;
    let snapshot = app.scope(app.store.get());   // the pool in view only: the other pool's people and rules are left out
    apsPicks = pref.aps ? apsOpen().map(w => [w.monday, w.pick]) : [];
    if (apsPicks.length) { snapshot = structuredClone(snapshot); for (const [m, id] of apsPicks) setWeek(snapshot, m, id); }   // fill the calls around them
    stageProgress();
    const codes = chosenCodes();
    const opts = { from, to, seed, timeMs, codes: codes.length < autoDuties.length ? codes : null };
    let fellBack = false;
    const fallback = async (why) => {
      if (fellBack || stopped) return;
      fellBack = true;
      console.warn('Auto-fill worker failed, running on the main thread', why);
      if (worker) { worker.terminate(); worker = null; }
      const st = wrap.querySelector('.af-status');
      if (st) st.textContent = 'Working on this device… (the page may pause for a few seconds)';
      try {
        const { solve } = await import('./solver.js');
        await new Promise(r => setTimeout(r, 60));
        if (stopped) return;
        const result = solve(snapshot, { ...opts, timeMs: Math.min(timeMs, 4000), onProgress: (p) => onProgress(p) });
        done(result, snapshot);
      } catch (e) {
        console.error(e);
        clearInterval(tick);
        wrap.innerHTML = '';
        wrap.append(h('p', { class: 'warn-box' }, 'Auto-fill could not run: ' + (e.message || e)),
          h('div', { class: 'af-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, 'Close')));
      }
    };
    try {
      worker = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'progress') onProgress(m);
        else if (m.type === 'done') { worker.terminate(); worker = null; done(m.result, snapshot); }
        else if (m.type === 'error') fallback(m.message);
      };
      worker.onerror = (e) => { e.preventDefault?.(); fallback(e.message || 'worker error'); };
      worker.postMessage({ type: 'solve', state: snapshot, opts });
    } catch (e) { fallback(e); }
  }

  function diff(snapshot, result) {
    const asg = result.assignments || {};
    const inFill = new Set((snapshot.staff || []).map(p => p.id));
    let added = 0, removed = 0;
    for (const d of days) {
      const ids = new Set([...Object.keys(snapshot.cells?.[d] || {}), ...Object.keys(asg[d] || {})]);
      for (const sid of ids) {
        if (!inFill.has(sid)) continue;
        const cell = snapshot.cells?.[d]?.[sid];
        if (cell?.lock) continue;
        const sel = result.codes ? new Set(result.codes) : null;
        const before = new Set((cell?.auto || []).filter(c => !sel || sel.has(c)));
        const manual = (cell?.a || []).filter(c => !before.has(c));
        const after = new Set((asg[d]?.[sid] || []).filter(c => !manual.includes(c)));
        for (const c of after) if (!before.has(c)) added++;
        for (const c of before) if (!after.has(c)) removed++;
      }
    }
    return { added, removed };
  }

  function done(result, snapshot) {
    if (stopped) return;
    clearInterval(tick);
    if (!result) { stageOptions(); return; }
    const now = app.evaluation();
    const ch = diff(snapshot, result);
    const after = result.after || { hard: 0, soft: 0 };
    wrap.innerHTML = '';
    const changedTxt = ch.added + ch.removed ? `${ch.added} shift${ch.added === 1 ? '' : 's'} added, ${ch.removed} removed` : 'No changes: the current roster is already the best found';
    wrap.append(
      h('p', { class: 'af-headline' }, changedTxt, h('span', { class: 'muted' }, ` · ${((result.ms || 0) / 1000).toFixed(1)} s${result.iterations ? `, ${Number(result.iterations).toLocaleString()} tries` : ''}`)),
      h('div', { class: 'af-compare' },
        cmp('Must-fix problems', now.hard, after.hard),
        cmp('To improve (soft)', now.soft, after.soft)));
    const unf = result.unfilled || [];
    const applyIt = () => {
      app.store.commit(`Auto-fill ${M.fmtMonth(app.month)}`, draft => { for (const [m, id] of apsPicks) setWeek(draft, m, id); applyAssignments(draft, result, days, new Set((snapshot.staff || []).map(p => p.id))); });
      close();
      app.toast(`Auto-fill applied: ${changedTxt.toLowerCase()}${apsPicks.length ? `; ${apsPicks.length} APS week${apsPicks.length > 1 ? 's' : ''} assigned` : ''}`, { action: { label: 'Undo', fn: () => app.store.undo() } });
    };
    if (pref.auto && !unf.length && after.hard === 0) { applyIt(); return; }
    if (unf.length) {
      wrap.append(h('div', { class: 'af-unf' },
        h('h3', null, `Still short on ${unf.length} day${unf.length === 1 ? '' : 's'}`),
        // name the cover rule (juniors or seniors on Call, say), not just the code
        h('ul', null, unf.slice(0, 12).map(u => {
          const st = app.store.get(), rule = (st.rules || []).find(r => r.id === u.ruleId);
          let what = u.code;
          try { if (rule) what = rule.name || app.rules.describeRule(rule, st); } catch (e) { /* keep the code */ }
          return h('li', null, `${M.fmtDay(u.date)}: ${u.need} more needed for "${what}"`);
        })),
        unf.length > 12 ? h('p', { class: 'muted' }, `and ${unf.length - 12} more`) : null,
        h('p', { class: 'muted' }, 'Usually too much leave that day, or a rule that is too strict. Check them after applying.')));
    } else if (after.hard === 0) {
      wrap.append(h('p', { class: 'ok-box', html: `${app.icon('ok')}<span>Every must-fix rule is met.</span>` }));
    }
    wrap.append(h('div', { class: 'af-actions' },
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, 'Discard'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: run }, 'Try again'),
      h('button', {
        type: 'button', class: 'btn btn-primary', autofocus: true,
        onclick: applyIt,
      }, 'Apply')));
    wrap.querySelector('.btn-primary')?.focus();
  }

  function cmp(label, a, b) {
    const better = b < a, worse = b > a;
    return h('div', { class: 'af-cmp' }, h('span', { class: 'af-cmp-l' }, label),
      h('span', { class: 'af-cmp-v' }, h('span', { class: 'af-before' }, String(a)), ' → ', h('strong', { class: better ? 'good' : worse ? 'bad' : '' }, String(b))));
  }

  stageOptions();
  if (quick && autoDuties.length) run();
}

// Set each cell's auto codes from the solver result, keeping every non-auto code. Locked cells are skipped.
// `only` (a Set of staff ids): the people the fill covered (one pool); everyone else's cells are left alone.
export function applyAssignments(draft, result, days, only = null) {
  const asg = result.assignments || {};
  for (const d of days) {
    const ids = new Set([...Object.keys(draft.cells?.[d] || {}), ...Object.keys(asg[d] || {})]);
    for (const sid of ids) {
      if (only && !only.has(sid)) continue;
      const cell = M.getCell(draft, d, sid);
      if (cell?.lock) continue;
      const oldAll = cell?.auto || [];
      const oldAuto = result.codes ? oldAll.filter(c => result.codes.includes(c)) : oldAll;   // only the codes this run filled
      const other = oldAll.filter(c => !oldAuto.includes(c));
      const keep = (cell?.a || []).filter(c => !oldAuto.includes(c));
      const newAuto = (asg[d]?.[sid] || []).filter(c => !keep.includes(c));
      if (!cell && !newAuto.length) continue;
      M.setCell(draft, d, sid, { a: [...keep, ...newAuto], auto: [...other, ...newAuto] });
    }
  }
}
