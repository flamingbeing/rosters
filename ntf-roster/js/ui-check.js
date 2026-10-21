// NTF Roster: the Check screen. How the month on screen stands against the rules: must-fix problems (hard rules)
// and things to improve (soft rules) grouped by rule, each with a Show button that jumps to the cell; a fairness
// table (who does how many of each auto-filled duty, weekends and holidays, against their group's average); and a
// coverage table (each "cover each day" rule, day by day).

import * as M from './model.js';
import { RULE_TYPES, describeRule } from './rules.js';
import { whoMatches, whenMatches, chipStyle } from './ui-rules.js';
import { renderAps, renderLeave } from './ui-aps.js';

const PAGE = 6;   // problems shown per rule before "Show all"

export function mount(el, app) {
  const { h } = app;
  let view = ['problems', 'fairness', 'coverage', 'aps', 'leave'].includes(app.params.v) ? app.params.v : 'problems';
  let person = '';
  let hardOnly = false;
  let ruleFocus = app.params.rule || '';
  const expanded = new Set();

  const root = h('div', { class: 'cv' });
  el.append(root);

  function render() {
    const st = app.store.get();
    const ev = app.evaluation();
    const keepFocus = document.activeElement && root.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    root.innerHTML = '';
    const rulesOn = (st.rules || []).filter(r => r.enabled !== false).length;
    root.append(
      h('div', { class: 'bx-head' }, h('div', { class: 'bx-head-text' },
        h('h2', { class: 'bx-h' }, 'Check'),
        h('p', { class: 'bx-sub' }, `${M.fmtMonth(app.month)} against ${rulesOn} ${rulesOn === 1 ? 'rule' : 'rules'} that are on. `,
          h('a', { href: '#rules' }, 'Change the rules'))),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-k': 'reqprio', onclick: () => import('./ui-reqprio.js').then(mod => mod.openPriorities(app)) }, 'Request priority')),
      h('div', { class: 'cv-sum', 'data-tour': 'check' },   // (data-tour: the first-time tour, tour.js)
        stat(ev.hard, 'must fix', 'Hard rules broken', ev.hard ? 'bad' : 'ok'),
        stat(ev.soft, 'to improve', 'Preferences not met', ev.soft ? 'warn' : 'ok'),
        stat(fmtScore(ev.score), 'penalty · lower is better', 'Each must-fix problem counts 1000, each thing to improve its weight', 'plain')));
    // a rule that couldn't be checked (a damaged or odd rule from a file) must not pass for "no problems"
    const nFailed = (ev.failed || []).length;
    if (ev.error || nFailed) {
      const names = (ev.failed || []).map(id => (st.rules || []).find(r => r.id === id)).filter(Boolean).map(r => title(r, st));
      root.append(h('p', { class: 'warn-box', role: 'status' }, ev.error
        ? 'The rule check failed, so problems may be missing. Check the rules (a rule imported from a file may be damaged), or reload.'
        : `${nFailed} ${nFailed === 1 ? 'rule' : 'rules'} can't be checked and ${nFailed === 1 ? 'is' : 'are'} left out: ${names.join('; ') || 'unknown rule type'}. Edit or delete ${nFailed === 1 ? 'it' : 'them'} under Rules.`));
    }
    const tabs = h('div', { class: 'bx-tabs', role: 'tablist', 'aria-label': 'Check sections', 'data-tour': 'check' },
      [['problems', 'Problems'], ['fairness', 'Fairness'], ['coverage', 'Coverage'], ['aps', 'APS weeks'], ['leave', 'Leave dates']].map(([k, l]) => h('button', {
        type: 'button', role: 'tab', class: 'bx-tab', id: `cv-tab-${k}`, 'aria-selected': String(view === k), onclick: () => { view = k; render(); },
      }, l)));
    const panel = h('div', { class: 'cv-panel', role: 'tabpanel', 'aria-labelledby': `cv-tab-${view}` });
    root.append(tabs, panel);
    if (view === 'problems') renderProblems(panel, st, ev);
    else if (view === 'fairness') renderFairness(panel, st);
    else if (view === 'aps') renderAps(app, panel, st);
    else if (view === 'leave') renderLeave(app, panel, st);
    else renderCoverage(panel, st);
    if (keepFocus) { const f = root.querySelector(keepFocus); if (f) f.focus({ preventScroll: true }); }
  }

  function stat(n, label, title, kind) {
    return h('div', { class: `cv-stat ${kind}`, title }, h('strong', null, String(n)), h('span', null, label));
  }

  // ---------- problems ----------
  function renderProblems(panel, st, ev) {
    const people = M.staffInView(st, app.month);
    const pid = fid();
    const sel = h('select', { id: pid, 'data-k': 'person', onchange: () => { person = sel.value; render(); } },
      h('option', { value: '' }, 'Everyone'), people.map(p => h('option', { value: p.id }, p.name)));
    sel.value = person;
    const ho = h('input', { type: 'checkbox', checked: hardOnly, 'data-k': 'hardonly', onchange: () => { hardOnly = ho.checked; render(); } });
    const rmap = new Map((st.rules || []).map(r => [r.id, r]));
    panel.append(h('div', { class: 'cv-bar' },
      h('div', { class: 'cv-field' }, h('label', { for: pid }, 'Person'), sel),
      h('label', { class: 'switch' }, ho, h('span', { class: 'sw-track' }), h('span', null, 'Only must-fix')),
      ruleFocus && rmap.has(ruleFocus) ? h('span', { class: 'bx-pill is-on cv-only' }, `Only: ${title(rmap.get(ruleFocus), st)}`,
        h('button', { type: 'button', class: 'bx-x', 'aria-label': 'Show every rule', onclick: () => { ruleFocus = ''; render(); } }, '×')) : null));
    const vs = (ev.violations || []).filter(v => (!hardOnly || v.hard) && (!ruleFocus || v.ruleId === ruleFocus)
      && (!person || v.staffId === person || (v.staffIds || []).includes(person)));
    if (!vs.length) {
      const any = (ev.violations || []).length;
      panel.append(h('p', { class: 'ok-box' }, h('span', { html: app.icon('ok') }),
        any ? 'Nothing for this filter.' : `No problems in ${M.fmtMonth(app.month)}. Every rule that is on holds.`));
      return;
    }
    const by = new Map();
    for (const v of vs) { const a = by.get(v.ruleId); if (a) a.push(v); else by.set(v.ruleId, [v]); }
    const groups = [...by.entries()].map(([id, list]) => ({ id, list, rule: rmap.get(id), hard: list.some(v => v.hard), pen: list.reduce((s, v) => s + (v.penalty || 0), 0) }))
      .sort((a, b) => (b.hard - a.hard) || (b.pen - a.pen));
    const ul = h('div', { class: 'cv-groups' });
    for (const g of groups) {
      const t = g.rule && RULE_TYPES[g.rule.type];
      const list = [...g.list].sort((a, b) => String(a.date || (a.dates || [])[0] || '').localeCompare(String(b.date || (b.dates || [])[0] || '')));
      const open = expanded.has(g.id) || list.length <= PAGE + 1;
      const shown = open ? list : list.slice(0, PAGE);
      ul.append(h('section', { class: `card cv-group ${g.hard ? 'is-hard' : 'is-soft'}`, 'aria-label': g.rule ? title(g.rule, st) : 'Rule' },
        h('div', { class: 'cv-gh' },
          h('span', { class: 'rv-ic', 'aria-hidden': 'true' }, t ? t.icon : '?'),
          h('div', { class: 'cv-gt' },
            h('h3', null, g.rule ? title(g.rule, st) : 'A rule that no longer exists'),
            h('p', { class: 'rv-meta' }, h('span', { class: `bx-badge ${g.hard ? 'hard' : 'soft'}` }, g.hard ? 'Must hold' : `Preference · ${g.rule ? g.rule.weight : ''}`),
              h('span', { class: `bx-tag ${g.hard ? 'bad' : 'warn'}` }, `${list.length} ${list.length === 1 ? 'problem' : 'problems'}`))),
          g.rule ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-k': `edit-${g.id}`, onclick: () => app.go('rules', { edit: g.id }), 'aria-label': `Edit rule: ${title(g.rule, st)}` }, 'Edit rule') : null),
        h('ul', { class: 'cv-vs' }, shown.map((v, i) => h('li', null,
          h('span', { class: 'cv-msg' }, v.msg),
          canShow(v) ? h('button', { type: 'button', class: 'btn btn-ghost btn-xs', 'data-k': `show-${g.id}-${i}`, onclick: () => show(v), 'aria-label': `Show: ${v.msg}` }, 'Show') : null))),
        open ? null : h('button', { type: 'button', class: 'linkish cv-more', 'data-k': `more-${g.id}`, onclick: () => { expanded.add(g.id); render(); } }, `Show all ${list.length}`)));
    }
    panel.append(ul);
  }

  const canShow = v => !!(v.date || (v.dates || []).length || v.staffId);

  // Jump to the problem: the cell (date + person), the person's month, or the day.
  function show(v) {
    const date = v.date || (v.dates || [])[0] || '';
    const sid = v.staffId || ((v.staffIds || []).length === 1 ? v.staffIds[0] : '');
    if (date && sid) { app.selectCell(date, sid); app.go('roster', { m: M.monthOf(date) }); return; }
    if (sid) { app.go('roster', { m: app.month, p: sid }); return; }
    if (date) {
      if (app.isPhone()) { app.go('day', { d: date }); return; }
      app.selectedCell = { date, staffId: null };   // a date-only selection: the roster flashes that day column
      app.go('roster', { m: M.monthOf(date) });
    }
  }

  // ---------- fairness ----------
  function renderFairness(panel, st) {
    const days = M.monthDays(app.month);
    const people = M.staffInView(st, app.month);
    const auto = (st.duties || []).filter(d => d.kind === 'shift' && d.auto);
    const counts = new Map();   // staffId -> { code: n, we, hol, total }
    const used = new Set();
    for (const p of people) {
      const c = { we: 0, hol: 0, total: 0 };
      for (const d of auto) c[d.code] = 0;
      for (const s of days) {
        const cell = M.getCell(st, s, p.id);
        const a = (cell && cell.a) || [];
        let any = false;
        for (const d of auto) if (a.includes(d.code)) { c[d.code]++; c.total++; any = true; used.add(d.code); }
        if (any && M.isWeekend(s)) c.we++;
        if (any && M.isHoliday(st, s)) c.hol++;
      }
      counts.set(p.id, c);
    }
    const cols = auto.filter(d => used.has(d.code));
    if (!people.length) { panel.append(h('p', { class: 'muted' }, 'Nobody is in post this month.')); return; }
    if (!cols.length) {
      panel.append(h('p', { class: 'warn-box' }, `No auto-filled duties (${auto.map(d => d.code).join(', ') || 'none marked auto'}) on the roster in ${M.fmtMonth(app.month)} yet. Run Auto-fill or add some, then come back.`));
      return;
    }
    const keys = [...cols.map(d => ({ k: d.code, label: d.code, du: d, title: d.name })), { k: 'we', label: 'Wk', title: 'Weekend days with any of these duties (Wk, as on the roster)' }, { k: 'hol', label: 'PH', title: 'Public holidays with any of these duties' }, { k: 'total', label: 'Total', title: 'All of these duties' }];
    panel.append(h('p', { class: 'bx-help' }, `Counts for ${M.fmtMonth(app.month)}. Highlighted: well above or below the group's average, per FTE (part-timers are compared on their share).`),
      h('p', { class: 'cv-legend' }, h('span', { class: 'cv-hi-k' }, 'More than average'), h('span', { class: 'cv-lo-k' }, 'Less than average')));
    const table = h('table', { class: 'cv-table cv-fair' });
    table.append(h('thead', null, h('tr', null, h('th', { scope: 'col', class: 'cv-name' }, 'Name'),
      keys.map(k => h('th', { scope: 'col', title: k.title }, k.du ? h('span', { class: 'chip', style: chipStyle(k.du) }, k.label) : k.label)))));
    const tb = h('tbody');
    for (const g of st.groups || []) {
      const ps = people.filter(p => p.group === g.id);
      if (!ps.length) continue;
      const fte = p => (Number(p.fte) > 0 ? Number(p.fte) : 1);
      const mean = {};
      for (const k of keys) mean[k.k] = ps.reduce((s, p) => s + counts.get(p.id)[k.k] / fte(p), 0) / ps.length;
      tb.append(h('tr', { class: 'cv-grow' }, h('th', { scope: 'colgroup', colspan: String(keys.length + 1) }, g.name, h('span', { class: 'bx-count' }, String(ps.length)))));
      for (const p of ps) {
        const c = counts.get(p.id);
        tb.append(h('tr', null,
          h('th', { scope: 'row', class: 'cv-name' }, p.short || p.name, fte(p) !== 1 ? h('span', { class: 'cv-fte' }, ` ${fte(p)}`) : null),
          keys.map(k => {
            const v = c[k.k], norm = v / fte(p), m = mean[k.k], diff = norm - m;
            const far = ps.length > 1 && Math.abs(diff) > Math.max(1.5, m * 0.35);
            const cls = far ? (diff > 0 ? 'cv-hi' : 'cv-lo') : '';
            return h('td', { class: `${cls}${v ? '' : ' cv-zero'}`, title: far ? `${Math.abs(diff).toFixed(1)} ${diff > 0 ? 'above' : 'below'} the group average (${m.toFixed(1)})` : null },
              v ? String(v) : '·', far ? h('span', { class: 'sr-only' }, diff > 0 ? ' (above average)' : ' (below average)') : null);
          })));
      }
      tb.append(h('tr', { class: 'cv-mean' }, h('th', { scope: 'row', class: 'cv-name' }, 'Average'), keys.map(k => h('td', null, mean[k.k] ? mean[k.k].toFixed(1) : '·'))));
    }
    table.append(tb);
    panel.append(h('div', { class: 'cv-scroll', tabindex: '0', role: 'region', 'aria-label': 'Fairness table' }, table));
  }

  // ---------- coverage ----------
  function renderCoverage(panel, st) {
    const days = M.monthDays(app.month);
    const rules = (st.rules || []).filter(r => r.enabled !== false && r.type === 'cover');
    if (!rules.length) { panel.append(h('p', { class: 'muted' }, 'No "Cover each day" rules are on. Add one under Rules to see coverage here.')); return; }
    const staff = (st.staff || []).filter(p => p.active !== false);
    const effCache = new Map();
    const eff = (s, id) => { const k = s + '|' + id; let e = effCache.get(k); if (!e) { e = M.effectiveCodes(st, s, id); effCache.set(k, e); } return e; };
    const rows = rules.map(r => {
      const p = r.params || {};
      const min = p.min == null || p.min === '' ? null : Number(p.min), max = p.max == null || p.max === '' ? null : Number(p.max);
      const who = staff.filter(x => whoMatches(r.who, x));
      const cells = days.map(s => {
        if (!whenMatches(r.when, s, st)) return { s, na: true };
        let n = 0;
        for (const x of who) if (M.staffActiveOn(x, s) && M.matchesCodes(st, s, x.id, p.codes || [], eff(s, x.id))) n++;
        const status = min != null && n < min ? 'under' : max != null && n > max ? 'over' : 'ok';
        return { s, n, status, min, max };
      });
      return { r, cells, under: cells.filter(c => c.status === 'under'), over: cells.filter(c => c.status === 'over') };
    });
    panel.append(h('p', { class: 'bx-help' }, 'Each "Cover each day" rule, day by day: how many people it counts. Red = too few, amber = too many, grey = the rule doesn\'t apply that day.'));
    const goDay = s => (app.isPhone() ? app.go('day', { d: s }) : (app.selectedCell = { date: s, staffId: null }, app.go('roster', { m: M.monthOf(s) })));
    if (app.isPhone()) {
      for (const row of rows) {
        const bad = [...row.under, ...row.over].sort((a, b) => a.s.localeCompare(b.s));
        const applies = row.cells.filter(c => !c.na).length;
        const none = row.r.when && row.r.when.holidays === 'only' ? 'No public holidays this month' : 'Doesn\'t apply to any day this month';
        panel.append(h('section', { class: `card cv-cov-card ${row.under.length ? 'is-hard' : row.over.length ? 'is-soft' : ''}` },
          h('h3', null, title(row.r, st)),
          h('p', { class: bad.length ? '' : 'cv-okline' }, bad.length ? `${row.under.length} short, ${row.over.length} over, of ${applies} days` : applies ? `All ${applies} days OK` : none),
          bad.length ? h('ul', { class: 'cv-daylist' }, bad.map(c => h('li', null, h('button', { type: 'button', class: `cv-day ${c.status}`, onclick: () => goDay(c.s) },
            `${M.fmtDay(c.s)}: ${c.n}`, h('span', { class: 'muted' }, c.status === 'under' ? ` needs ${c.min}` : ` max ${c.max}`))))) : null));
      }
      return;
    }
    const table = h('table', { class: 'cv-table cv-cov' });
    table.append(h('thead', null, h('tr', null, h('th', { scope: 'col', class: 'cv-name' }, 'Rule'),
      days.map(s => h('th', { scope: 'col', class: `${M.isWeekend(s) ? 'we' : ''}${M.isHoliday(st, s) ? ' hol' : ''}`, title: M.fmtDay(s) + (M.isHoliday(st, s) ? `, ${M.holidayName(st, s)}` : '') },
        h('span', { class: 'cv-dn' }, String(Number(s.slice(8)))), h('span', { class: 'cv-dw' }, 'SMTWTFS'[M.weekday(s)]))),
      h('th', { scope: 'col' }, 'Days off target'))));
    const skipped = rows.filter(row => row.cells.every(c => c.na));
    if (skipped.length) panel.append(h('p', { class: 'bx-help' }, `Not shown, no day this month: ${skipped.map(row => title(row.r, st)).join('; ')}.`));
    table.append(h('tbody', null, rows.filter(row => !skipped.includes(row)).map(row => h('tr', null,
      h('th', { scope: 'row', class: 'cv-name cv-rname' }, title(row.r, st)),
      row.cells.map(c => c.na ? h('td', { class: 'na', title: `${M.fmtDay(c.s)}: rule doesn't apply` }, h('span', { class: 'sr-only' }, 'not applicable'))
        : c.status === 'ok' ? h('td', { class: 'ok', title: `${M.fmtDay(c.s)}: ${c.n}` }, String(c.n))
          : h('td', { class: c.status }, h('button', { type: 'button', class: 'cv-cellbtn', title: `${M.fmtDay(c.s)}: ${c.n}, ${c.status === 'under' ? `needs ${c.min}` : `at most ${c.max}`}`,
            'aria-label': `${M.fmtDay(c.s)}: ${c.n}, ${c.status === 'under' ? `needs ${c.min}` : `at most ${c.max}`}. Show`, onclick: () => goDay(c.s) }, String(c.n)))),
      h('td', { class: `cv-tot${row.under.length + row.over.length ? ' bad' : ''}` }, String(row.under.length + row.over.length))))));
    panel.append(h('div', { class: 'cv-scroll', tabindex: '0', role: 'region', 'aria-label': 'Coverage table' }, table));
  }

  render();
  return {
    update() { render(); },
    route(params) {
      if (params.rule) { ruleFocus = params.rule; view = 'problems'; }
      if (['problems', 'fairness', 'coverage', 'aps', 'leave'].includes(params.v)) view = params.v;
      render();
    },
  };
}

function title(r, st) { return (r && r.name) || describeRule(r, st); }
function fmtScore(s) { const n = Number(s) || 0; return n >= 10000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)); }
let nid = 0;
function fid() { return `cv-${++nid}`; }
// A selector that finds the same control after a re-render (data-k on the controls that re-render keeps).
function focusKey(el) { return el.dataset && el.dataset.k ? `[data-k="${CSS.escape(el.dataset.k)}"]` : el.id && el.id.startsWith('cv-tab-') ? `#${el.id}` : null; }
