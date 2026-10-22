// The General part of the roster: calls, clinics and other duties.
import { matchName, namesInCell } from './engine.js';
import { TEAM_ROWS, DUTIES } from './layout.js';
import { generalFromMonthly } from './monthly.js';
import { h, state } from './ui-core.js';
import { render } from './ui-screen.js';
import { logRoster, nameInput, resolvePerson, TOUCH } from './ui-roster.js';
import { closeTagEditor } from './ui-tags.js';
import { openPersonBox, personChip } from './ui-person.js';

// ----- general tab -----

// Names typed into a General field must be on the staff list (unknown ones offer to be added).
async function setGeneral(key, value, role, input) {
  const g = (state.day.general ||= {});
  const before = g[key] || '';
  const v = value.trim();
  for (const n of v.split('/').flatMap(namesInCell)) {
    const p = await resolvePerson(n, role);
    if (!p) { if (input) input.value = before; return; }
  }
  if (v === before) return;
  g[key] = v;
  const show = x => x === NOBODY ? 'nobody' : x || '—';
  if (state.roster) logRoster([`General · ${key}: ${show(before)} → ${show(v)}`]);
  render();
}

// Fields left empty take a default: the MOT on-call team also does EOT 8 and EOT 9.
const GENERAL_DEFAULTS = { 'eot8.s': 'mot.cons', 'eot8.a': 'mot.res1', 'eot9.s': 'mot.cons', 'eot9.a': 'mot.res2', 'eot9.a2': 'mot.res3' };
const NOBODY = '-'; // typed into a field to blank what the monthly rosters (or the MOT team) would put there
export function effectiveGeneral() {
  const typed = Object.fromEntries(Object.entries(state.day.general || {}).filter(([, v]) => v));
  const g = { ...generalFromMonthly(state.monthly, state.day.date), ...typed };
  for (const [k, from] of Object.entries(GENERAL_DEFAULTS)) if (!g[k] && g[from] && g[from] !== NOBODY) g[k] = g[from];
  for (const k of Object.keys(g)) if (g[k] === NOBODY) delete g[k];
  return g;
}

// Everyone named on the Calls/clinics tab, so the OT generator leaves them out.
export function generalPeople() {
  const ids = new Set();
  for (const v of Object.values(effectiveGeneral())) for (const n of String(v).split('/').flatMap(namesInCell)) {
    const p = matchName(n, state.staff).person;
    if (p) ids.add(p.id);
  }
  return ids;
}

// One Calls/clinics field, as person chips like the rest of the app. Names typed here win; otherwise
// the chips come from the monthly rosters or the MOT team (dashed, with where they came from).
// × takes someone off (blanking the field if they were the only one), + adds someone.
let callEditing = null; // the field taking a new name
function generalField(key, role) {
  const typed = (state.day.general || {})[key] || '';
  const value = effectiveGeneral()[key] || '';
  const inherited = !typed && !!value;
  const source = inherited ? (generalFromMonthly(state.monthly, state.day.date)[key] ? 'monthly roster' : 'MOT call team') : '';
  const names = String(value).split('/').map(x => x.trim()).filter(Boolean);
  const setNames = list => setGeneral(key, list.length ? list.join(' / ') : NOBODY, role);
  const chips = names.map((n, i) => {
    const p = matchName(namesInCell(n)[0] || n, state.staff).person;
    const remove = () => { closeTagEditor(); setNames(names.filter((_, k) => k !== i)); };
    const x = TOUCH ? null : h('span', { class: 'icon del', title: 'Take off', onclick: e => { e.stopPropagation(); remove(); } }, '×');
    return p
      ? personChip(p, { class: 'name pchip' + (inherited ? ' inherited' : ''), title: `${p.name} · ${p.grade}${source ? ` · from the ${source}` : ''}`, onclick: e => openPersonBox(e.currentTarget, p, { kind: 'call', remove }) }, x)
      : h('span', { class: 'name pchip unknown', title: `"${n}" isn't on the staff list` }, n, x);
  });
  let adder;
  if (callEditing === key) {
    const add = v => {
      if (callEditing !== key) return; // the change event that follows Enter
      callEditing = null;
      if (v.trim()) setNames([...names, v.trim()]); else render();
    };
    adder = nameInput({ class: 'cell-input', placeholder: 'Pick from the staff list',
      onkeydown: e => { if (e.key === 'Escape') { callEditing = null; render(); } if (e.key === 'Enter') { e.preventDefault(); add(e.target.value); } },
      onchange: e => { if (state.staff.some(p => p.name === e.target.value)) add(e.target.value); },
      onblur: e => setTimeout(() => { if (callEditing === key && !e.target.value.trim()) { callEditing = null; render(); } }, 150) }, role);
    setTimeout(() => adder.focus());
  } else adder = h('button', { class: 'add-name', title: 'Add someone', onclick: () => { callEditing = key; render(); } }, '+');
  const back = typed && (generalFromMonthly(state.monthly, state.day.date)[key] || GENERAL_DEFAULTS[key])
    ? h('button', { class: 'link from', title: 'Use the monthly roster again', onclick: () => setGeneral(key, '', role) }, '↺ monthly') : null;
  return h('div', { class: 'call-field' }, chips, adder, back);
}

// The calls and clinics on the Roster tab, as a compact list (the same fields as Monthly › Today).
// Every Calls/clinics field: [label, key, role].
export const generalFields = () => [
  ...TEAM_ROWS.map(([k, label], i) => [`MOT ${i < 2 ? label.replace(':', '') : 'MO' + (i - 1)}`, 'mot.' + k, i < 2 ? 'senior' : 'junior']),
  ...TEAM_ROWS.slice(0, 3).map(([k, label], i) => [`SICU ${i < 2 ? label.replace(':', '') : 'MO1'}`, 'sicu.' + k, i < 2 ? 'senior' : 'junior']),
  ...DUTIES.flatMap(d => d.fields.map(([f, label]) => [`${d.label} · ${label}`, `${d.key}.${f}`, f === 's' ? 'senior' : 'junior'])),
];
export function callsCard() {
  const rows = generalFields();
  const filled = rows.filter(([, k]) => effectiveGeneral()[k]).length;
  return h('section', { class: 'card' }, h('details', { open: true },
    h('summary', {}, h('h2', { style: 'display:inline' }, 'Calls and clinics'), h('span', { class: 'seen' }, ` ${filled} of ${rows.length} filled`)),
    h('p', { class: 'hint' }, 'The top half of the sheet. Dashed names come from the monthly rosters; × takes someone off, + adds someone.'),
    h('div', { class: 'calls-list' }, rows.map(([label, key, role]) => [h('label', { class: 'seen' }, label), generalField(key, role)]))));
}

export function renderGeneral() {
  const field = generalField;
  return h('div', {},
    h('section', { class: 'card' },
      h('h2', {}, 'Calls and clinics'),
      h('p', { class: 'hint' }, 'MOT and SICU calls, EOT and clinics for the day: the top half of the sheet. Dashed names come from the monthly rosters (or, for EOT 8 and 9, the MOT call team). × takes someone off, + adds someone. Everyone here is left out of the OT lists, and the cardiac call team goes to MOR 12. Load draft roster on the Cases tab fills these from the admin draft.')),
    h('section', { class: 'card scroll' },
      h('h2', {}, 'MOT and SICU Calls'),
      h('table', {},
        h('thead', {}, h('tr', {}, ['', 'MOT', 'SICU'].map(t => h('th', {}, t)))),
        // residents are MO1–MO3; SICU has only an MO1
        h('tbody', {}, TEAM_ROWS.map(([k, label], i) => h('tr', {},
          h('td', { class: 'seen' }, i < 2 ? label : `MO${i - 1}:`),
          h('td', {}, field('mot.' + k, i < 2 ? 'senior' : 'junior')),
          h('td', {}, i < 3 ? field('sicu.' + k, i < 2 ? 'senior' : 'junior') : null)))))),
    h('section', { class: 'card scroll' },
      h('h2', {}, 'EOT and clinics'),
      h('table', {},
        h('thead', {}, h('tr', {}, ['', 'Senior', 'Junior', 'Junior'].map(t => h('th', {}, t)))),
        h('tbody', {}, DUTIES.map(d => h('tr', {},
          h('td', {}, h('b', {}, d.label)),
          [0, 1, 2].map(i => h('td', {}, d.fields[i] ? h('div', {}, h('div', { class: 'seen' }, d.fields[i][1]), field(`${d.key}.${d.fields[i][0]}`, d.fields[i][0] === 's' ? 'senior' : 'junior')) : null))))))),
    h('p', { class: 'hint' }, 'AOCC, AIC, AH OT and ECT are on the Roster tab.'));
}
