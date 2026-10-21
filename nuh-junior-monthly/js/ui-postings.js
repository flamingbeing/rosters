// NUH Junior Monthly: the Postings screen. Residency postings (cardiac, ICU, pain, obstetrics, out-rotations…) are
// planned by the week (Monday to Sunday) and change every year, so this is a people × weeks table: choosing a posting
// for a week puts that posting code on each of its seven days (the roster grid shows it as the cell colour). Rotations
// from the master rotation sheet can be pasted in (names down, Mondays across).
import * as M from './model.js';
import { pullFromPeople } from './people-pull.js';

const SHORT_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtShort = s => { const d = M.parseISO(s); return `${d.getDate()} ${SHORT_MON[d.getMonth()]}`; };
const mondayOf = s => M.addDays(s, -((M.weekday(s) + 6) % 7));

// The Mondays of every week that touches the month.
export function weeksOf(month) {
  const days = M.monthDays(month);
  const out = [];
  for (let w = mondayOf(days[0]); w <= days[days.length - 1]; w = M.addDays(w, 7)) out.push(w);
  return out;
}

// The posting a person has that week: the code on most of its days ('' if none, '*' when the days differ).
export function weekPosting(state, staffId, monday, postingSet) {
  const seen = new Map();
  for (let k = 0; k < 7; k++) {
    const cell = M.getCell(state, M.addDays(monday, k), staffId);
    const c = cell && (cell.a || []).find(x => postingSet.has(x));
    if (c) seen.set(c, (seen.get(c) || 0) + 1);
  }
  if (!seen.size) return '';
  if (seen.size > 1) return '*';
  return [...seen.keys()][0];
}

// Put `code` (or nothing) as the posting on every day of the week. Leave and calls stay.
export function setWeekPosting(draft, staffId, monday, code, postingSet) {
  for (let k = 0; k < 7; k++) {
    const d = M.addDays(monday, k);
    const cell = M.getCell(draft, d, staffId) || { a: [], r: [], auto: [], note: '', lock: false };
    const a = (cell.a || []).filter(c => !postingSet.has(c));
    if (code) a.unshift(code);
    M.setCell(draft, d, staffId, { a, auto: (cell.auto || []).filter(c => a.includes(c)) });
  }
}

// Read pasted rotations: a header row with dates (the Mondays, any of 7/12/2026, 2026-12-07, 7 Dec), names in the
// first column, posting codes in the cells. Returns { weeks: [iso], rows: [{ name, codes: [] }] }.
export function parseRotations(text, year) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { weeks: [], rows: [] };
  const split = l => (l.includes('\t') ? l.split('\t') : l.split(/,|;/)).map(x => x.trim());
  const head = split(lines[0]);
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = n => String(n).padStart(2, '0');
  const asDate = t => {
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/.exec(t);
    if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
    m = /^(\d{1,2})[\s-]*([A-Za-z]{3})[A-Za-z]*(?:[\s-]*(\d{2,4}))?$/.exec(t);
    if (m && MON[m[2].toLowerCase()]) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year; return `${y}-${pad(MON[m[2].toLowerCase()])}-${pad(m[1])}`; }
    return '';
  };
  const cols = head.map((t, i) => ({ i, d: i === 0 ? '' : asDate(t) })).filter(c => c.d);
  const weeks = cols.map(c => mondayOf(c.d));
  const rows = lines.slice(1).map(l => { const cells = split(l); return { name: cells[0] || '', codes: cols.map(c => cells[c.i] || '') }; }).filter(r => r.name);
  return { weeks, rows };
}

const norm = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z]/g, '');

export function mount(el, app) {
  const { h, store } = app;
  let filter = '', only = '';
  el.innerHTML = '';
  const root = h('div', { class: 'postv' });
  el.append(root);

  function render() {
    const state = store.get();
    const dm = M.dutyMap(state);
    const postings = (state.duties || []).filter(d => d.kind === 'posting');
    const pset = new Set(postings.map(d => d.code));
    const weeks = weeksOf(app.month);
    const gmap = M.groupMap(state);
    const people = M.staffInMonth(state, app.month).filter(p => (gmap.get(p.group) || {}).kind !== 'senior');
    root.innerHTML = '';

    const search = h('input', { type: 'search', class: 'pv-search', placeholder: 'Find a name', value: filter, 'aria-label': 'Find a name',
      oninput: e => { filter = e.target.value; paintRows(); } });
    const pick = h('select', { 'aria-label': 'Show only people on a posting', onchange: e => { only = e.target.value; paintRows(); } },
      h('option', { value: '' }, 'Everyone'), postings.map(d => h('option', { value: d.code }, `On ${d.code} (${d.name})`)));
    pick.value = only;
    root.append(
      h('div', { class: 'card pv-intro' },
        h('h2', null, `Postings, ${M.fmtMonth(app.month)}`),
        h('p', { class: 'muted' }, 'Plan each person\'s posting by the week (Monday to Sunday). It fills every day of that week: the roster shows it as the cell colour, and rules use it ("a cardiac call only on a cardiac day"). Leave and calls already in a cell stay.'),
        h('div', { class: 'pv-tools' }, search, pick,
          h('button', { type: 'button', class: 'btn', onclick: () => pasteDialog() }, 'Paste rotations…'),
          h('button', { type: 'button', class: 'btn', onclick: () => pullFromPeople(app, text => pasteDialog(text)) }, 'Pull from APMES People…'))));

    const table = h('table', { class: 'pv-table' });
    const thead = h('thead', null, h('tr', null, h('th', { scope: 'col', class: 'pv-name' }, 'Name'),
      weeks.map(w => h('th', { scope: 'col' }, h('span', { class: 'pv-wk' }, 'Week of'), fmtShort(w)))));
    const tbody = h('tbody');
    table.append(thead, tbody);
    // how many people on each main posting per week
    const counts = h('tfoot');
    const main = ['C', 'ICU'].filter(c => pset.has(c));
    for (const code of main) {
      counts.append(h('tr', null, h('th', { scope: 'row', class: 'pv-name' }, `On ${code}`), weeks.map(w => {
        const n = people.filter(p => weekPosting(state, p.id, w, pset) === code).length;
        return h('td', { class: 'pv-count' }, String(n));
      })));
    }
    table.append(counts);
    root.append(h('div', { class: 'pv-scroll', tabindex: '0', role: 'region', 'aria-label': 'Postings by week' }, table));

    function paintRows() {
      tbody.innerHTML = '';
      const q = norm(filter);
      let lastGroup = null;
      for (const p of people) {
        if (q && !norm(p.name).includes(q) && !norm(p.short).includes(q)) continue;
        const per = weeks.map(w => weekPosting(state, p.id, w, pset));
        if (only && !per.includes(only)) continue;
        if (p.group !== lastGroup) {
          lastGroup = p.group;
          tbody.append(h('tr', { class: 'pv-group' }, h('th', { scope: 'rowgroup', colspan: String(weeks.length + 1) }, (gmap.get(p.group) || {}).name || p.group)));
        }
        tbody.append(h('tr', null, h('th', { scope: 'row', class: 'pv-name' }, p.name), weeks.map((w, k) => {
          const cur = per[k];
          const du = dm.get(cur);
          const sel = h('select', { class: 'pv-sel', 'aria-label': `${p.name}, week of ${fmtShort(w)}`, style: du ? `background:${du.color}` : '' },
            h('option', { value: '' }, '·'),
            cur === '*' ? h('option', { value: '*' }, 'mixed') : null,
            postings.map(d => h('option', { value: d.code, title: d.name }, d.code)));
          sel.value = cur;
          sel.addEventListener('change', () => {
            if (sel.value === '*') return;
            const code = sel.value;
            store.commit(`${p.short || p.name}: ${code || 'no posting'} for the week of ${fmtShort(w)}`, draft => setWeekPosting(draft, p.id, w, code, pset));
          });
          return h('td', null, sel);
        })));
      }
      if (!tbody.children.length) tbody.append(h('tr', null, h('td', { colspan: String(weeks.length + 1), class: 'muted' }, people.length ? 'Nobody matches.' : 'No juniors yet: add people on People, or import the department sheet on More.')));
    }
    paintRows();
  }

  function pasteDialog(prefill = '') {
    const ta = h('textarea', { rows: '8', class: 'pv-paste', 'aria-label': 'Rotations to paste', placeholder: 'Name\t7/12/2026\t14/12/2026\nAn Example\tICU\tICU\n…' });
    ta.value = prefill;
    const msg = h('p', { class: 'muted' }, prefill ? 'From APMES People: the ICU, cardiac and OG float postings. Look them over, then Apply. Weeks you apply replace the posting those people have that week.' : 'Copy the weeks you need from the rotation sheet: the first row the Mondays, then one row per person (name, then a posting code per week). Names are matched to People; unknown codes are skipped.');
    app.sheet({
      title: 'Paste rotations', body: h('div', { class: 'bx-form' }, msg, ta), actions: [{ label: 'Cancel' }, {
        label: 'Apply', primary: true, fn: () => {
          const state = store.get();
          const pset = new Set((state.duties || []).filter(d => d.kind === 'posting').map(d => d.code));
          const byUpper = new Map([...pset].map(c => [c.toUpperCase(), c]));
          const { weeks, rows } = parseRotations(ta.value, +app.month.slice(0, 4));
          if (!weeks.length || !rows.length) { msg.textContent = 'No dates found in the first row, or no people below it.'; return false; }
          const staff = state.staff || [];
          let found = 0, cells = 0;
          const missing = [];
          store.commit(`Pasted rotations (${weeks.length} weeks)`, draft => {
            for (const r of rows) {
              const p = staff.find(x => norm(x.name) === norm(r.name)) || staff.find(x => norm(x.short) && norm(x.short) === norm(r.name));
              if (!p) { missing.push(r.name); continue; }
              found++;
              r.codes.forEach((t, k) => { const code = byUpper.get(String(t).trim().toUpperCase()); if (code) { setWeekPosting(draft, p.id, weeks[k], code, pset); cells++; } });
            }
          });
          app.toast(`Postings set for ${found} ${found === 1 ? 'person' : 'people'} (${cells} weeks)${missing.length ? `; not found: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}` : ''}`, { kind: missing.length ? 'warn' : 'ok', ms: missing.length ? 0 : 4000 });
        },
      }],
    });
  }

  render();
  return { update: render };
}
