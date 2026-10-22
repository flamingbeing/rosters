// Tags on one name in a roster cell ("(L)", "(AOH 1)", "-5pm") and the tag editor.
import { postingName, STATUSES, matchName, splitNameList, namesInCell, isCoverPart, coverTarget } from './engine.js';
import { TEAM_ROWS, DUTIES } from './layout.js';
import { dayOf, h, postingOf, state } from './ui-core.js';
import { afterRosterEdit, cellParts, nameInput, pushUndo, resolvePerson, setCellParts } from './ui-roster.js';
import { effectiveGeneral } from './ui-general.js';

// ---- tags on one name: "(L)", "(RA)", "(AOH 1)" and the part after a dash ("-5pm", "-C-OT 4") ----

export const TAGS = ['L', 'AOH', 'HPB', 'RA', 'P', 'SR', 'Neu', 'Cardiac', 'ENT', 'Vasc', 'Amb', 'Remote', 'PACU'];
export let tagTimer = null;
export const setTagTimer = v => (tagTimer = v);

// "Koh YW (RA) L-4pm C-OT13 -mtg 5pm" -> name, tags, leave ("4pm" / "4-5pm"), cover ("OT13", "KROR PACU"), note
const TIME = '[\\d.:]+(?:\\s*-\\s*[\\d.:]+)?\\s*(?:am|pm)?';
// "/" separates names in a cell and brackets hold tags, so typed text can't use them as-is
export const cellSafe = t => String(t || '').replace(/\bw\/\s*/gi, 'with ').replace(/\s*\/\s*/g, ' or ').replace(/\(/g, '[').replace(/\)/g, ']').trim();
// The parts of today's roster cells this person is physically in (not covers).
export function rosterPartsOf(p) {
  if (!state.roster || state.roster.date !== state.day.date) return [];
  return state.roster.rows.flatMap(r => ['senior', 'junior'].flatMap(k => cellParts(r, k))).filter(x => !isCoverPart(x) && personOfPart(x) === p);
}
export function parseNamePart(text) {
  const tags = [...String(text).matchAll(/\(([^)]*)\)/g)].map(m => m[1].trim()).filter(Boolean);
  let rest = String(text).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  let leave = '', cover = '', dash = '';
  rest = rest.replace(new RegExp(`\\s+L-\\s*(${TIME})`, 'i'), (_, t) => { leave = t.trim(); return ''; });
  rest = rest.replace(/\s+-?C-\s*(.+?)(?=\s+L-|\s+-|$)/i, (_, c) => { cover = c.trim().replace(/^OT\s+/i, 'OT'); return ''; });
  const m = rest.match(/^(.*?)\s+-\s*(.+)$/);
  if (m) {
    rest = m[1].trim(); dash = m[2].trim();
    // older roster style: "Name -5pm" means leaving at 5pm
    if (!leave && new RegExp(`^${TIME}$`, 'i').test(dash)) { leave = dash; dash = ''; }
  }
  return { name: rest.trim(), tags, leave, cover, dash };
}
export const buildNamePart = ({ name, tags, leave, cover, dash }) =>
  `${name}${tags.map(t => ` (${t})`).join('')}${leave ? ` L-${leave}` : ''}${cover ? ` C-${cover}` : ''}${dash ? ` -${dash}` : ''}`;

// Keep the "Name (C)" entry in the room a junior covers in step with their C- tag.
export function syncCoverEntry(row, oldName, oldCover, name, coverTo) {
  const rows = state.roster.rows;
  const target = c => c ? rows.find(r => r.label === coverTarget(c, row, rows)) : null;
  const isEntry = (part, n) => isCoverPart(part) && namesInCell(part)[0] === namesInCell(n)[0];
  const from = target(oldCover), to = target(coverTo);
  if (from && (from !== to || oldName !== name)) setCellParts(from, 'junior', cellParts(from, 'junior').filter(x => !isEntry(x, oldName)));
  if (to && to !== row && !cellParts(to, 'junior').some(x => isEntry(x, name))) setCellParts(to, 'junior', [...cellParts(to, 'junior'), `${name} (C)`]);
}

// Everywhere a person is on today's roster: rooms, ad hoc covers, premeds, calls and clinics.
export function wherePerson(p) {
  const out = [];
  const is = text => namesInCell(text).some(n => matchName(n, state.staff).person?.id === p.id);
  for (const row of state.roster?.rows || []) {
    for (const key of ['senior', 'junior']) for (const part of cellParts(row, key)) {
      if (!is(part)) continue;
      if (isCoverPart(part)) out.push(`Covering ${row.label} (C)`);
      else {
        out.push(`In ${row.label} (${key})`);
        const c = parseNamePart(part).cover;
        if (c) out.push(`Covering ${coverTarget(c, row, state.roster.rows) || c} (C-${c})`);
      }
    }
    if (cellParts(row, 'premed').some(is)) out.push(`Premed for ${row.label}`);
  }
  const g = effectiveGeneral();
  for (const [k, label] of TEAM_ROWS) for (const team of ['mot', 'sicu']) if (is(g[`${team}.${k}`] || '')) out.push(`${team.toUpperCase()} ${label.replace(':', '') || 'MO'}`);
  for (const d of DUTIES) for (const [f, label] of d.fields) if (is(g[`${d.key}.${f}`] || '')) out.push(`${d.label} ${label.toLowerCase()}`);
  const st = state.day.staff[p.id]?.status;
  if (st && st !== 'avail') out.push(STATUSES.find(s => s[0] === st)?.[1] || st);
  return out;
}
function whereCard(p) {
  const at = wherePerson(p);
  return h('div', { class: 'where' },
    h('b', {}, p.name), h('span', { class: 'seen' }, ` · ${p.grade}${postingOf(p) ? ' · ' + postingName(postingOf(p)) : ''}`),
    h('ul', {}, (at.length ? at : ['Not on any list today']).map(t => h('li', {}, t))));
}

export function closeTagEditor() {
  const open = document.querySelector('.tag-editor');
  open?.remove(); boxPerson = null; highlightPerson(null);
  // keyboard and screen-reader users land back on the name they opened (or the same person after a re-render)
  if (open && boxReturn) {
    const back = boxReturn.el?.isConnected ? boxReturn.el : boxReturn.pid ? document.querySelector(`[data-pid="${boxReturn.pid}"][tabindex]`) : null;
    boxReturn = null;
    if (back && (!document.activeElement || document.activeElement === document.body)) back.focus({ preventScroll: true });
  }
}
// A box just opened: take focus (the box itself, so phones don't pop the keyboard), keep Tab inside it.
let boxReturn = null;
export function focusBox(box, anchor) {
  boxReturn = { el: anchor, pid: anchor?.dataset?.pid || '' };
  box.tabIndex = -1;
  box.focus({ preventScroll: true });
  box.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = [...box.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter(x => !x.disabled && x.offsetParent);
    if (!f.length) return;
    if (e.shiftKey && (document.activeElement === f[0] || document.activeElement === box)) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
  });
  box.addEventListener('keydown', e => { if (e.key === 'Escape' && e.target === box) closeTagEditor(); });
}
// Light up every chip of one person (hover, or while their box is open), so double bookings show.
export let boxPerson = null;
export const setBoxPerson = v => (boxPerson = v);
export function highlightPerson(id) {
  const on = id || boxPerson;
  document.querySelectorAll('[data-pid].hl').forEach(e => { if (e.dataset.pid !== on) e.classList.remove('hl'); });
  if (on) document.querySelectorAll(`[data-pid="${on}"]`).forEach(e => e.classList.add('hl'));
}

export function openRawEditor(chip, src) {
  closeTagEditor();
  const row = state.roster.rows[src.row];
  const parts = cellParts(row, src.key);
  const cur = parseNamePart(parts[src.part] ?? '');
  const p = matchName(cur.name, state.staff).person;
  const on = new Set(cur.tags.filter(t => TAGS.includes(t)));
  const other = h('input', { value: cur.tags.filter(t => !TAGS.includes(t) && !/^C$/i.test(t)).join(', '), placeholder: 'e.g. AOH 1' });
  const juniorCell = src.key === 'junior';
  const coveredBox = h('input', { type: 'checkbox', checked: cur.tags.some(t => /^C$/i.test(t)) });
  const dash = h('input', { value: cur.dash, placeholder: 'e.g. mtg 3pm' });
  const leave = h('input', { value: cur.leave, placeholder: 'e.g. 4pm or 4-5pm' });
  const cover = h('input', { value: cur.cover, placeholder: 'e.g. OT13, KROR PACU' });
  const name = nameInput({ value: cur.name }, src.key === 'senior' ? 'senior' : 'junior');
  const chips = h('div', { class: 'chips' }, TAGS.map(t => {
    const c = h('span', { class: 'chip' + (on.has(t) ? ' on' : ''), title: t === 'L' ? (src.key === 'senior' ? 'Liver standby' : 'Liver posting') : '', onclick: () => {
      if (on.has(t)) on.delete(t); else on.add(t);
      c.classList.toggle('on', on.has(t));
    } }, t);
    return c;
  }));
  const apply = async () => {
    const tags = [...TAGS.filter(t => on.has(t)), ...splitNameList(other.value).filter(t => !/^C$/i.test(t)), ...(juniorCell && coveredBox.checked ? ['C'] : [])];
    let picked = name.value.trim() || cur.name;
    if (picked !== cur.name) {
      const person = await resolvePerson(picked, src.key === 'senior' ? 'senior' : 'junior');
      if (!person) return;
      picked = person.name;
    }
    const coverTo = cover.value.trim().replace(/^C-/i, '');
    const next = buildNamePart({ name: picked, tags, leave: leave.value.trim().replace(/^L-/i, ''), cover: coverTo, dash: dash.value.trim() });
    closeTagEditor();
    if (next === parts[src.part]) return;
    pushUndo(JSON.stringify(state.roster.rows));
    parts[src.part] = next;
    setCellParts(row, src.key, parts);
    // a junior covering another room (C-OT13) is shown there as "Name (C)"
    if (juniorCell && !coveredBox.checked) syncCoverEntry(row, cur.name, cur.cover, picked, coverTo);
    // keep the day's details in step so checks and regenerating agree with the sheet
    if (p) {
      const d = dayOf(p.id);
      if (src.key === 'senior') d.liverStandby = on.has('L');
      d.leaveTime = leave.value.trim().replace(/^L-/i, '');
    }
    afterRosterEdit();
  };
  const remove = () => {
    closeTagEditor();
    pushUndo(JSON.stringify(state.roster.rows));
    parts.splice(src.part, 1);
    setCellParts(row, src.key, parts);
    afterRosterEdit();
  };
  const box = h('div', { class: 'tag-editor', role: 'dialog', 'aria-label': 'Edit name',
    onkeydown: e => { if (e.key === 'Escape') closeTagEditor(); if (e.key === 'Enter') { e.preventDefault(); apply(); } } },
    p ? whereCard(p) : null,
    h('label', {}, 'Name'), name,
    h('label', {}, 'Tags'), chips,
    h('label', {}, 'Other tags'), other,
    h('label', {}, 'Leaving (L-)'), leave,
    h('label', {}, 'Covering (C-)'), cover,
    juniorCell && h('label', { class: 'check', title: 'No junior is physically in this room: this person only covers it ad hoc. Shown as "Name (C)" in red.' }, coveredBox, ' Covered (ad hoc cover, not physically here)'),
    h('label', {}, 'Comment (also shown in the comments box)'), dash,
    h('div', { class: 'bar', style: 'margin:8px 0 0' },
      h('button', { class: 'primary', onclick: apply }, 'Save'),
      h('button', { onclick: closeTagEditor }, 'Cancel'),
      h('span', { class: 'grow' }),
      h('button', { onclick: remove, title: 'Take this name out of the cell' }, 'Remove')),
  );
  document.body.append(box);
  focusBox(box, chip);
  const rc = chip.getBoundingClientRect();
  const w = box.offsetWidth, hgt = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, rc.left)) + 'px';
  box.style.top = (rc.bottom + hgt + 8 < window.innerHeight ? rc.bottom + 4 : Math.max(8, rc.top - hgt - 4)) + 'px';
  setTimeout(() => {
    const away = e => { if (!box.contains(e.target)) { closeTagEditor(); window.removeEventListener('pointerdown', away, true); } };
    window.addEventListener('pointerdown', away, true);
  });
}

// ---- the person box: one look for a person on every daily tab (Today, Cases, Roster, Premeds) ----

export const personOfPart = part => matchName(namesInCell(part)[0] || '', state.staff).person;
export const isAohTag = t => /^AOH\b/i.test(t);
// tags that belong to the roster cell rather than the person's day
export const CELL_TAGS = TAGS.filter(t => t !== 'L' && t !== 'AOH');
