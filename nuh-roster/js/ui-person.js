// The person box: one look for a person on every daily tab.
import { POSTINGS, postingName, COLOUR_ARGB, matchName, splitNameList, namesInCell, suggestFlags, generate, check, fmtSenior, fmtJunior, isCoverPart } from './engine.js';
import { shortName, isDouble } from './layout.js';
import { addDays } from './monthly.js';
import { clone, dayOf, dayStaff, h, plannedPosting, postingOf, save, select, staffColour, state, toast, undoToast, withPosting } from './ui-core.js';
import { app, longDate, render } from './ui-screen.js';
import { setStaffFilter, staffEditing, startStaffEdit } from './ui-staff.js';
import { afterRosterEdit, cellParts, dropToPool, editing, logRoster, nameInput, pushUndo, pushUndoAll, rankForCell, resolvePerson, setCellParts, setEditing, setLastRows, startNameDrag, startSwap, TOUCH, undoStack } from './ui-roster.js';
import { buildNamePart, CELL_TAGS, cellSafe, closeTagEditor, focusBox, highlightPerson, isAohTag, openRawEditor, parseNamePart, personOfPart, rosterPartsOf, setBoxPerson, syncCoverEntry, TAGS, tagTimer, wherePerson } from './ui-tags.js';
import { effectiveGeneral, generalPeople } from './ui-general.js';
import { BOARD, groupOf, setCarry, setStatus } from './ui-today.js';

// The day's markers after a short name: (L), (AOH), L-4pm
function dayMarks(p) {
  const d = state.day.staff[p.id] || {};
  return [d.liverStandby ? '(L)' : '', d.aoh ? `(${d.aoh})` : '', d.leaveTime ? `L-${d.leaveTime}` : ''].filter(Boolean).join(' ');
}
// The person chip for the daily tabs: short name in their colour, then the day's markers
export function personChip(p, attrs = {}, ...extra) {
  const marks = dayMarks(p);
  return h('span', { class: 'name pchip', 'data-pid': p.id, style: colourStyle(p.name), title: `${p.name} · ${p.grade}`, tabindex: 0, role: 'button', ...attrs },
    h('span', { class: 'label' }, shortName(p) || p.name), marks ? h('span', { class: 'marks' }, ' ' + marks) : null, ...extra);
}

// Write a person's day details (L-, (L), (AOH), comment) into every roster cell they're physically in.
function syncPersonCells(p) {
  if (!state.roster || state.roster.date !== state.day.date) return;
  const d = state.day.staff[p.id] || {};
  for (const row of state.roster.rows) for (const key of ['senior', 'junior']) {
    const parts = cellParts(row, key);
    let changed = false;
    parts.forEach((part, k) => {
      if (isCoverPart(part) || personOfPart(part) !== p) return;
      const cur = parseNamePart(part);
      const postingL = p.role === 'junior' && postingOf(p) === 'L';
      const tags = cur.tags.filter(t => !isAohTag(t) && !(t === 'L' && !postingL));
      if (d.liverStandby && !tags.includes('L')) tags.unshift('L');
      if (d.aoh) tags.push(d.aoh);
      const next = buildNamePart({ ...cur, tags, leave: d.leaveTime || '', dash: d.comment || '' });
      if (next !== part) { parts[k] = next; changed = true; }
    });
    if (changed) setCellParts(row, key, parts);
  }
}

// A junior's posting changed for the day: swap the posting tag in their roster cells ("(RA)" -> "(P)").
function retagPosting(p, from, to) {
  if (!state.roster || state.roster.date !== state.day.date) return;
  const isPostingTag = t => POSTINGS.some(([code]) => code && code === t);
  for (const row of state.roster.rows) {
    const parts = cellParts(row, 'junior');
    let changed = false;
    parts.forEach((part, k) => {
      if (isCoverPart(part) || personOfPart(part) !== p) return;
      const cur = parseNamePart(part);
      let tags = cur.tags.filter(t => !(t === from && from !== 'L') && !(from === 'L' && t === 'L' && !state.day.staff[p.id]?.liverStandby));
      if (!from && tags.some(isPostingTag)) tags = tags.filter(t => !isPostingTag(t) || t === 'L');
      if (to && !tags.includes(to)) tags.push(to);
      const next = buildNamePart({ ...cur, tags });
      if (next !== part) { parts[k] = next; changed = true; }
    });
    if (changed) setCellParts(row, 'junior', parts);
  }
}

// Open the Staff tab in edit mode on this person.
export let staffHighlight = null;
async function goEditStaff(p) {
  closeTagEditor();
  state.tab = 'staff';
  state.staffRole = p.role;
  setStaffFilter('');
  staffHighlight = p.id;
  if (!staffEditing()) startStaffEdit(); else render();
  setTimeout(() => app.querySelector(`tr[data-id="${p.id}"]`)?.scrollIntoView({ block: 'center' }), 50);
}

// ctx: { kind: 'roster', src } | { kind: 'today' } | { kind: 'lock', room, key } | { kind: 'premed', row, options }
export function openPersonBox(anchor, p, ctx) {
  closeTagEditor();
  setBoxPerson(p.id); setTimeout(() => highlightPerson(p.id));
  const d = state.day.staff[p.id] || {};
  const roster = ctx.kind === 'roster';
  const rrow = roster ? state.roster.rows[ctx.src.row] : null;
  const parts = roster ? cellParts(rrow, ctx.src.key) : [];
  const part = roster ? parts[ctx.src.part] ?? '' : '';
  const cur = roster ? parseNamePart(part) : { tags: [], leave: '', cover: '', dash: '' };
  const cover = roster && isCoverPart(part);
  // away from the roster tab, the day's details start from the person's first roster cell
  const firstPart = roster ? null : rosterPartsOf(p)[0];
  const seed = roster ? (cover ? { tags: [], leave: '', dash: '' } : cur) : firstPart ? parseNamePart(firstPart) : { tags: [], leave: '', dash: '' };

  // the person's day (shared by every tab)
  const leave = h('input', { value: d.leaveTime || seed.leave, placeholder: 'e.g. 4pm or 4-5pm' });
  const liver = h('input', { type: 'checkbox', checked: !!d.liverStandby || (p.role === 'senior' && seed.tags.includes('L')) });
  const aoh = h('input', { value: d.aoh || seed.tags.find(isAohTag) || '', placeholder: 'e.g. AOH or AOH 1' });
  const comment = h('input', { value: d.comment ?? seed.dash, placeholder: 'e.g. mtg 3pm' });
  const away = h('input', { type: 'checkbox', checked: !!d.notAroundPrev });
  // a status or comment that runs for several days (a course, an admin week): carried into those days
  const carried = (state.carry || []).find(c => c.pid === p.id && c.from <= state.day.date && state.day.date <= c.until);
  const until = h('input', { type: 'date', value: carried?.until || '', min: addDays(state.day.date, 1), title: 'The status and comment also go on each day up to this date' });
  // a junior's posting for this day only (the rotation is planned on Monthly › Rotations)
  const postingPick = p.role === 'junior' ? select(postingOf(p), POSTINGS, () => {}) : null;
  let status = groupOf(d.status);
  const statusBtns = BOARD.map(([k, label]) => h('button', { class: 'small', 'aria-pressed': String(k === status), onclick: e => {
    status = k; e.currentTarget.parentNode.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
  } }, label));

  // this roster cell only
  const on = new Set(cur.tags.filter(t => CELL_TAGS.includes(t)));
  const other = h('input', { value: cur.tags.filter(t => !TAGS.includes(t) && !/^C$/i.test(t) && !isAohTag(t)).join(', '), placeholder: 'e.g. KIV' });
  const coverTo = h('input', { value: cur.cover, placeholder: 'e.g. OT13, KROR PACU' });
  const coveredBox = h('input', { type: 'checkbox', checked: cover });
  const chips = h('div', { class: 'chips' }, CELL_TAGS.map(t => {
    const c = h('span', { class: 'chip' + (on.has(t) ? ' on' : ''), onclick: () => { if (on.has(t)) on.delete(t); else on.add(t); c.classList.toggle('on', on.has(t)); } }, t);
    return c;
  }));
  const premedPick = ctx.kind === 'premed' ? select(p.name, ctx.options, () => {}) : null;

  const apply = () => {
    const rosterNow = state.roster && state.roster.date === state.day.date;
    const s = dayOf(p.id);
    const before = JSON.stringify([state.day, rosterNow ? state.roster.rows : null]);
    pushUndoAll(`the change to ${p.name}`, { day: true });
    if (roster) {
      const juniorCell = ctx.src.key === 'junior';
      const coverText = coverTo.value.trim().replace(/^C-/i, '');
      // a Liver Transplant posting's (L) isn't one of the cell's tag chips; keep it
      const postingL = p.role === 'junior' && postingOf(p) === 'L' && cur.tags.includes('L');
      const tags = [...(postingL ? ['L'] : []), ...CELL_TAGS.filter(t => on.has(t)), ...splitNameList(other.value).map(cellSafe).filter(t => t && !/^C$/i.test(t)), ...(juniorCell && coveredBox.checked ? ['C'] : [])];
      parts[ctx.src.part] = buildNamePart({ name: cur.name, tags, leave: '', cover: coverText, dash: '' });
      setCellParts(rrow, ctx.src.key, parts);
      if (juniorCell && !coveredBox.checked) syncCoverEntry(rrow, cur.name, cur.cover, cur.name, coverText);
    }
    // only fields that changed are written, so a Save that changes nothing leaves no Undo step
    const put = (k, v) => { if ((s[k] || '') !== v) s[k] = v; };
    put('leaveTime', leave.value.trim().replace(/^L-/i, ''));
    if (liver.checked !== !!s.liverStandby) { s.liverStandby = liver.checked; s.manualLiver = true; delete s.autoLiver; }
    put('aoh', cellSafe(aoh.value.trim().replace(/^\(|\)$/g, '')));
    put('comment', cellSafe(comment.value.trim().replace(/^-\s*/, '')));
    if (s.carried?.comment && s.comment !== s.carried.comment) { delete s.carried.comment; if (!s.carried.status) delete s.carried; } // edited by hand
    if (postingPick) {
      const was = postingOf(p), v = postingPick.value;
      if (v === plannedPosting(p)) delete s.posting; else s.posting = v;
      if (v !== was) retagPosting(p, was, v);
    }
    if (p.role === 'junior' && away.checked !== !!s.notAroundPrev) { s.notAroundPrev = away.checked; s.manualAway = true; delete s.autoAway; }
    if (ctx.kind === 'today' && status !== groupOf(s.status)) { closeTagEditor(); setStatus(p, status, { quiet: true }); }
    setCarry(p, until.value, ctx.kind === 'today' ? status : groupOf(s.status), s.comment || '');
    if (ctx.kind === 'premed' && premedPick.value !== p.name) ctx.setCover(premedPick.value);
    syncPersonCells(p);
    closeTagEditor();
    if (JSON.stringify([state.day, rosterNow ? state.roster.rows : null]) === before) undoStack.pop(); // nothing changed
    if (rosterNow) afterRosterEdit(); else render();
  };
  const remove = () => {
    closeTagEditor();
    if (roster) dropToPool(ctx.src);
    else if (ctx.kind === 'lock') { ctx.room[ctx.key] = ''; render(); }
    else if (ctx.kind === 'premed') ctx.setCover('');
    else if (ctx.kind === 'call') ctx.remove();
  };
  const field = (label, el, title) => [h('label', { title: title || '' }, label), el];
  const box = h('div', { class: 'tag-editor person-box', role: 'dialog', 'aria-label': p.name,
    onkeydown: e => { if (e.key === 'Escape') closeTagEditor(); if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); apply(); } } },
    h('div', { class: 'where' },
      h('div', { class: 'bar', style: 'margin:0' },
        h('div', { class: 'grow' }, h('b', { style: colourStyle(p.name) }, p.name), h('div', { class: 'seen' }, [shortName(p) !== p.name ? shortName(p) : '', p.grade, postingOf(p) ? postingName(postingOf(p)) : ''].filter(Boolean).join(' · '))),
        h('button', { class: 'small', title: 'Edit their name, short names, grade and so on on the Staff tab', onclick: () => goEditStaff(p) }, 'Edit')),
      h('ul', {}, (wherePerson(p).length ? wherePerson(p) : ['Not on any list today']).map(t => h('li', {}, t)))),
    ctx.kind === 'today' ? [h('label', {}, 'Today'), h('div', { class: 'seg status-pick' }, statusBtns)] : null,
    roster ? [h('label', {}, 'Tags in this room'), chips, ...field('Other tags', other), ...field('Covering (C-)', coverTo, 'Covers another room, e.g. when someone there leaves early'),
      ctx.src.key === 'junior' ? h('label', { class: 'check', title: 'No junior is physically in this room: this person only covers it ad hoc. Shown as "Name (C)" in red.' }, coveredBox, ' Ad hoc cover here (C), not physically here') : null] : null,
    ctx.kind === 'premed' ? field('Premed cover', premedPick) : null,
    h('div', { class: 'seen', style: 'margin-top:6px; font-weight:600' }, 'For the whole day (shows wherever they are)'),
    ...field('Leaving (L-)', leave),
    h('label', { class: 'check' }, liver, ' Liver standby (L): no complex lists'),
    ...field('AOH tag', aoh, 'Shown as (AOH) after their name'),
    ...field('Comment (also shown in the comments box)', comment, 'Shown on the sent-out sheet: meetings, times, where they are. No patient details, NRIC, phone numbers or medical reasons.'),
    ...field('Same until (optional)', until, 'For something that runs several days: the status and comment go on each day up to this date'),
    carried ? h('div', { class: 'seen' }, `Carried from ${longDate(carried.from)} to ${longDate(carried.until)}. Clear the date to stop it.`) : null,
    p.role === 'junior' ? h('label', { class: 'check', title: 'Not around on the previous working day: needs premed cover' }, away, ' Away on the previous working day') : null,
    postingPick ? field(`Posting today${d.posting != null ? ` (rotation: ${postingName(plannedPosting(p)) || 'none'})` : ''}`, postingPick, 'Changes their posting for this day only; the weekly rotation is on Monthly › Rotations') : null,
    h('div', { class: 'bar', style: 'margin:8px 0 0' },
      h('button', { class: 'primary save', onclick: apply }, 'Save'),
      h('button', { onclick: closeTagEditor }, 'Cancel'),
      h('span', { class: 'grow' }),
      roster ? h('button', { title: 'Then tap another name to swap, or an empty cell or the Admin / no list box to move them there', onclick: () => startSwap(ctx.src, p) }, 'Move or swap') : null,
      ['roster', 'lock', 'premed', 'call'].includes(ctx.kind) ? h('button', { onclick: remove, title: ctx.kind === 'lock' ? 'Let the roster choose' : 'Take them off here' }, 'Remove') : null),
  );
  document.body.append(box);
  focusBox(box, anchor);
  const rc = anchor.getBoundingClientRect();
  const w = box.offsetWidth, hgt = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, rc.left)) + 'px';
  box.style.top = (rc.bottom + hgt + 8 < window.innerHeight ? rc.bottom + 4 : Math.max(8, rc.top - hgt - 4)) + 'px';
  setTimeout(() => {
    const awayClick = e => { if (!box.contains(e.target)) { closeTagEditor(); window.removeEventListener('pointerdown', awayClick, true); } };
    window.addEventListener('pointerdown', awayClick, true);
  });
}

// A name on the roster: the person box, or (for a name not on the staff list) the plain editor.
export function openTagEditor(chip, src) {
  const part = cellParts(state.roster.rows[src.row], src.key)[src.part] ?? '';
  const p = personOfPart(part);
  if (p) openPersonBox(chip, p, { kind: 'roster', src });
  else openRawEditor(chip, src);
}

// Case notes typed on the roster also update the day's room, so flags and checks follow.
function editNotes(i, value) {
  const row = state.roster.rows[i];
  if (!row || value === row.notes) return;
  pushUndo(JSON.stringify(state.roster.rows));
  logRoster([`${row.label} cases: ${row.notes || '—'} → ${value || '—'}`]);
  row.notes = value;
  setLastRows(JSON.stringify(state.roster.rows));
  const room = state.day.rooms.find(x => x.id === row.roomId);
  if (room) {
    room.notes = value;
    if (!room.flagsManual) room.flags = suggestFlags(value, state.settings, room.name);
  }
  const before = JSON.stringify(state.roster.checks);
  state.roster.checks = check({ rows: state.roster.rows, staff: dayStaff(), day: state.day, settings: state.settings });
  save();
  if (JSON.stringify(state.roster.checks) !== before) render();
}

export const notesCell = (row, i, attrs = {}) => h('td', {
  ...attrs, contenteditable: 'plaintext-only', spellcheck: 'false', title: 'Click to edit the case notes',
  onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
  onblur: e => editNotes(i, e.target.textContent.trim()),
}, row.notes || '');

// The colour of a roster name: red for an ad hoc cover ("Name (C)"), else the person's
// colour ('green', 'purple' or '', consultants always black).
export const colourCache = new Map();
export function colourOf(part) {
  if (isCoverPart(part)) return 'red';
  const n = namesInCell(part)[0];
  if (!n) return '';
  const k = n + '|' + state.staff.length;
  if (!colourCache.has(k)) colourCache.set(k, staffColour(matchName(n, state.staff).person));
  return colourCache.get(k);
}
// The sheet uses short names: "Koh Yi Wen (RA) L-4pm" -> "Koh YW (RA) L-4pm".
export function shortOf(part) {
  const n = namesInCell(part)[0];
  if (!n) return part;
  const p = matchName(n, state.staff).person;
  if (!p) return part;
  const s = shortName(p);
  const at = part.indexOf(n);
  return s && at >= 0 ? part.slice(0, at) + s + part.slice(at + n.length) : part;
}
// On screen the sheet's bright green (Baby MO) is darkened so it reads on white (2.9:1 → 5:1); the sheet itself,
// the .xlsx, PDF and image keep the department's colours.
export const SCREEN_COLOUR = { green: '#00803a', red: '#c00000' };
export const colourStyle = part => { const k = colourOf(part), c = COLOUR_ARGB[k]; return c ? `color:${SCREEN_COLOUR[k] || '#' + c.slice(2)}` : ''; };

// Add a person to a cell from the staff list (unknown names offer to add them to the staff list).
async function addToCell(i, key, text) {
  const p = await resolvePerson(text, key === 'senior' ? 'senior' : 'junior');
  if (!p) return false;
  if (state.roster.rows[i].roomId === 'aic' && !(['SC', 'C'].includes(p.grade) || p.grade === 'Senior resident')
    && !confirm(`AIC is usually a consultant or senior resident. Put ${p.name} (${p.grade}) there anyway?`)) return false;
  if (!p) return false;
  const row = state.roster.rows[i];
  const d = state.day.staff[p.id] || {};
  pushUndo(JSON.stringify(state.roster.rows));
  setCellParts(row, key, [...cellParts(row, key), p.role === 'senior' ? fmtSenior(p, d) : fmtJunior(withPosting(p), d)]);
  setEditing(null);
  afterRosterEdit();
  return true;
}

export function rosterCell(row, i, key, doubles) {
  const id = i + ':' + key;
  const parts = cellParts(row, key);
  let adder;
  if (editing === id) {
    // Enter and the change event can both fire for one pick: add the name once
    let busy = false;
    const add = v => { if (busy) return; busy = true; addToCell(i, key, v).then(ok => { if (!ok) busy = false; }); };
    adder = nameInput({ class: 'cell-input', placeholder: 'Type a name',
      onkeydown: e => { if (e.key === 'Escape') { setEditing(null); render(); } if (e.key === 'Enter') { e.preventDefault(); add(e.target.value); } },
      onchange: e => { if (state.staff.some(p => p.name === e.target.value)) add(e.target.value); },
      onblur: e => setTimeout(() => { if (editing === id && !e.target.value.trim()) { setEditing(null); render(); } }, 150),
    }, key === 'senior' && row.roomId !== 'aic' ? 'senior' : key === 'senior' ? null : 'junior', rankForCell(row, key));
    setTimeout(() => adder.focus());
  } else {
    adder = h('button', { class: 'add-name', title: 'Add a name', onclick: () => { clearTimeout(tagTimer); closeTagEditor(); setEditing(id); render(); } }, '+');
  }
  // each name shows the short name. With a mouse: drag the chip to move or swap it, drag the
  // C to add a junior to another room as an ad hoc cover, drag a senior's & to have them
  // double cover another room, × takes the name off. On a touchscreen there's no dragging
  // (so the page scrolls); tapping opens the name's details.
  const chip = (p, k) => {
    const src = { row: i, key, part: k };
    const icon = (cls, title, text, o) => h('span', { class: 'icon ' + cls, title, onpointerdown: e => { e.stopPropagation(); o.down?.(e); }, onclick: e => { e.stopPropagation(); o.click?.(); } }, text);
    const pid = personOfPart(p)?.id;
    const why = pid ? row.why?.[pid] : ''; // from the generator; stale after a hand move, so only for who is still here
    const el = h('span', { class: 'name', 'data-drop': '', 'data-row': i, 'data-key': key, 'data-part': k, 'data-pid': pid || '', style: colourStyle(p), title: why ? `${p}\nWhy here: ${why}` : p,
      onpointerenter: TOUCH || !pid ? null : () => highlightPerson(pid), onpointerleave: TOUCH || !pid ? null : () => highlightPerson(null),
      onpointerdown: TOUCH ? null : e => startNameDrag(e, src),
      onclick: TOUCH ? () => openTagEditor(el, src) : null,
      tabindex: 0, role: 'button', 'aria-label': `${p} (${key}, ${row.label}): open`,
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTagEditor(el, src); } } },
      !TOUCH && key === 'junior' && !isCoverPart(p) ? icon('cover', 'Drag to another room to add them there as an ad hoc cover (C). They stay in this room.', 'C', { down: e => startNameDrag(e, { ...src, cover: true }) }) : null,
      key === 'senior' && (!TOUCH || isDouble(p, doubles)) ? icon('dbl' + (isDouble(p, doubles) ? ' on' : ''),
        (isDouble(p, doubles) ? 'Double covering. ' : '') + (TOUCH ? '' : 'Drag to another room to have them double cover it too.'), '&',
        { down: TOUCH ? null : e => startNameDrag(e, { ...src, dup: true }) }) : null,
      h('span', { class: 'label' }, shortOf(p)),
      !TOUCH ? icon('del', isCoverPart(p) ? 'Remove this ad hoc cover' : 'Take off this list (they go to Admin / no list)', '×', { click: () => dropToPool(src) }) : null);
    return el;
  };
  return h('td', {
    class: 'cell', 'data-drop': '', 'data-row': i, 'data-key': key, title: 'Drag a name to swap or move it. Click a name to edit it.',
  }, h('div', { class: 'names' }, parts.map(chip), adder));
}

// The day as the generator sees it: people on the Calls/clinics tab are busy, and the
// cardiac call team goes to MOR 12.
function generatorDay() {
  const busy = generalPeople();
  const genDay = { ...state.day, staff: { ...state.day.staff }, rooms: state.day.rooms.map(r => ({ ...r })) };
  const mor12 = genDay.rooms.find(r => r.name === 'MOR 12' && r.running);
  if (mor12) {
    const eff = effectiveGeneral();
    const first = k => matchName(namesInCell(eff[k] || '')[0] || '', state.staff).person;
    const cs = first('cardiac.s'), ca = first('cardiac.a');
    if (cs && !mor12.lockSenior) mor12.lockSenior = cs.id;
    if (ca && !mor12.lockJunior) mor12.lockJunior = ca.id;
  }
  for (const id of busy) if ((genDay.staff[id]?.status || 'avail') === 'avail') genDay.staff[id] = { ...(genDay.staff[id] || {}), status: 'elsewhere' };
  return genDay;
}

export function canGenerate() {
  if (!state.staff.length) { toast('Add staff on the Staff tab first.'); return false; }
  if (!state.day.rooms.some(r => r.running)) { toast('Tick the running rooms on the Cases tab first.'); return false; }
  return true;
}

export function runGenerate(newSeed) {
  if (!canGenerate()) return;
  const seed = newSeed ? Math.floor(Math.random() * 1e9) : (state.roster?.seed || 1);
  const res = generate({ staff: dayStaff(), day: generatorDay(), settings: state.settings, seed });
  const log = state.roster?.date === state.day.date ? state.roster.log || [] : [];
  const replacing = state.roster?.rows?.length && state.roster.date === state.day.date;
  pushUndoAll('the new roster');
  setEditing(null);
  state.roster = { ...res, seed, date: state.day.date, log, checks: check({ rows: res.rows, staff: dayStaff(), day: state.day, settings: state.settings }) };
  logRoster([log.length ? 'Generated a new roster' : 'Generated the roster']);
  setLastRows(JSON.stringify(res.rows));
  render();
  if (replacing) undoToast('Made a new roster. Changes by hand were replaced (Fill empty gaps keeps them).');
}

// Keep every name already on the roster and generate only the empty cells: people already
// placed stay where they are (so the generator can pair or cover around them), everyone
// else rostered is left out.
export function fillGaps() {
  if (!canGenerate()) return;
  const r = state.roster;
  const genDay = generatorDay();
  const placed = new Set(), locked = new Set();
  const person = text => matchName(namesInCell(text)[0] || '', state.staff).person;
  for (const row of r.rows) for (const key of ['senior', 'junior']) for (const part of cellParts(row, key)) {
    const p = person(part);
    if (p) placed.add(p.id);
  }
  for (const row of r.rows) {
    const room = genDay.rooms.find(x => x.id === row.roomId);
    if (!room) continue;
    const s = person(cellParts(row, 'senior')[0] || '');
    const j = person(cellParts(row, 'junior').find(x => !isCoverPart(x)) || '');
    if (s && !locked.has(s.id)) { room.lockSenior = s.id; locked.add(s.id); }
    if (j && !locked.has(j.id)) { room.lockJunior = j.id; locked.add(j.id); }
  }
  for (const id of placed) {
    if (locked.has(id) || (genDay.staff[id]?.status || 'avail') !== 'avail') continue;
    genDay.staff[id] = { ...(genDay.staff[id] || {}), status: 'elsewhere' };
  }
  const special = id => r.rows.find(x => x.roomId === id) || {};
  const fixed = { ...(genDay.fixed || {}) };
  if (special('ahot').senior) fixed.ahot = special('ahot').senior;
  if (special('aic').senior) fixed.aic = special('aic').senior;
  if (special('aocc').senior || special('aocc').junior) { fixed['aocc.s'] = special('aocc').senior || ''; fixed['aocc.j'] = special('aocc').junior || ''; }
  genDay.fixed = fixed;
  const old = Object.fromEntries(r.rows.map(x => [x.roomId, x]));
  const fillFrom = res => {
    const filled = [];
    const rows = res.rows.map(g => {
      const o = old[g.roomId];
      if (!o) { if (g.senior || g.junior) filled.push(`${g.label} (new room)`); return g; }
      const row = { ...o };
      for (const key of ['senior', 'junior', 'premed']) if (!String(o[key] || '').trim() && g[key]) { row[key] = g[key]; filled.push(`${g.label} ${key}`); }
      return row;
    });
    return { res, rows, filled };
  };
  // a few tries: one seed can spend the last free senior on a room another try fills, leaving a gap it could have filled
  let best = null;
  for (let i = 0; i < 6; i++) {
    const t = fillFrom(generate({ staff: dayStaff(), day: clone(genDay), settings: state.settings, seed: Math.floor(Math.random() * 1e9) }));
    if (!best || t.filled.length > best.filled.length) best = t;
  }
  const { res, rows, filled } = best;
  // rows filled in by hand for rooms that aren't running any more stay
  const kept = new Set(rows.map(x => x.roomId));
  rows.push(...r.rows.filter(o => !kept.has(o.roomId) && (o.senior || o.junior || o.premed)));
  if (!filled.length) return toast('Nothing to fill: no one free for the empty cells.');
  pushUndo(JSON.stringify(r.rows));
  r.rows = rows;
  r.warnings = res.warnings;
  setEditing(null);
  afterRosterEdit(false, true);
  toast(`Filled ${filled.length} empty cell(s).`);
}
