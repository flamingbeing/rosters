// The Settings tab and the app version card.
import { DEFAULT_SETTINGS, POSTINGS, splitNameList, suggestFlags } from './engine.js';
import { MONTHLY, NIGHT_DUTIES } from './monthly.js';
import { blankState, clone, DEMO, h, save, select, setState, state, syncRooms, toast } from './ui-core.js';
import { demoLink } from './ui-practice.js';
import { render } from './ui-screen.js';
import { setSettingsEditing, settingsEditing } from './ui-cases.js';
import { isAdmin, isMember, membersCard, teamSyncBar } from './ui-team.js';

// ----- settings tab -----

function roomEditor() {
  const t = state.roomTemplate;
  const changed = () => { syncRooms(); render(); };
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= t.length) return; [t[i], t[j]] = [t[j], t[i]]; changed(); };
  const complexes = [...new Set(['Other', 'KROR', 'MCOR', 'MOR', ...t.map(r => r.complex)])];
  return h('div', { class: 'scroll' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Complex', 'Room', 'Running by default', ''].map(x => h('th', {}, x)))),
    h('tbody', {},
      t.map((r, i) => h('tr', {},
        h('td', {}, select(r.complex, complexes, v => { r.complex = v; changed(); })),
        h('td', {}, h('input', { value: r.name, onchange: e => {
          const v = e.target.value.trim();
          if (!v || t.some(x => x !== r && x.name === v)) { toast(v ? `${v} is already in the list.` : 'A room needs a name.'); e.target.value = r.name; return; }
          (state.day.rooms || []).forEach(x => { if (x.name === r.name) x.name = v; });
          r.name = v; changed();
        } })),
        h('td', {}, h('input', { type: 'checkbox', checked: r.defaultOn, 'aria-label': 'Running by default', onchange: e => { r.defaultOn = e.target.checked; save(); } })),
        h('td', { style: 'white-space:nowrap' },
          h('button', { class: 'small', title: 'Move up', onclick: () => move(i, -1) }, '↑'), ' ',
          h('button', { class: 'small', title: 'Move down', onclick: () => move(i, 1) }, '↓'), ' ',
          h('button', { class: 'small', title: 'Remove room', onclick: () => { if (confirm(`Remove ${r.name} from the roster?`)) { t.splice(i, 1); changed(); } } }, '✕')))),
      h('tr', {}, h('td', { colspan: 4 }, h('button', { class: 'small', onclick: () => {
        const name = prompt('Room name, e.g. MOR 19');
        if (!name?.trim()) return;
        if (t.some(x => x.name === name.trim())) return toast(`${name.trim()} is already in the list.`);
        const complex = (name.match(/^(KROR|MCOR|MOR)/i)?.[1] || 'Other').toUpperCase().replace('OTHER', 'Other');
        let i = t.map(x => x.complex).lastIndexOf(complex);
        t.splice(i < 0 ? t.length : i + 1, 0, { complex, name: name.trim(), defaultOn: true });
        changed();
      } }, '+ Add room'))))));
}

export function renderSettings() {
  const st = state.settings;
  const subRow = s => h('tr', {},
    h('td', {}, h('input', { value: s.label, onchange: e => { s.label = e.target.value; save(); } })),
    h('td', {}, h('input', { value: s.keywords.join(', '), onchange: e => { s.keywords = splitNameList(e.target.value).map(x => x.toLowerCase()); save(); } })),
    h('td', {}, h('label', {}, h('input', { type: 'checkbox', checked: s.hard, onchange: e => { s.hard = e.target.checked; save(); } }), ' required')),
    h('td', {}, select(s.posting || '', POSTINGS, v => { s.posting = v; save(); })),
    h('td', {}, h('button', { class: 'small', onclick: () => { st.subspecs = st.subspecs.filter(x => x !== s); render(); } }, '✕')),
  );

  return h('div', {},
    h('section', { class: 'card' },
      h('div', { class: 'bar', style: 'margin:0' },
        h('h2', { class: 'grow', style: 'margin:0' }, 'Settings'),
        settingsEditing
          ? h('button', { class: 'primary', onclick: () => { setSettingsEditing(false); render(); toast(isMember() ? 'Settings kept here. Use "Save for the team" to share them.' : 'Settings saved.'); } }, 'Done')
          : h('button', { onclick: () => { setSettingsEditing(true); render(); } }, 'Edit settings')),
      h('p', { class: 'hint', style: 'margin:0' }, settingsEditing ? 'Editing: changes apply straight away.' : 'Read only. Press Edit settings to change anything.'),
      teamSyncBar()),
    h('fieldset', { class: 'lock', disabled: !settingsEditing },
    h('section', { class: 'card scroll' },
      h('h2', {}, 'Subspecialties'),
      h('p', { class: 'hint' }, 'Keywords are matched as whole words in the case notes. "Required" means only seniors with that subspec can take the list. The posting is the junior posting that suits it.'),
      h('table', {},
        h('thead', {}, h('tr', {}, ['Name', 'Keywords in case notes', 'Senior', 'Junior posting', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, st.subspecs.map(subRow))),
      h('div', { class: 'bar', style: 'margin-top:8px' },
        h('button', { onclick: () => { const label = prompt('Subspecialty name'); if (label) { st.subspecs.push({ key: label.toLowerCase().replace(/\W+/g, '-'), label, keywords: [], hard: false, posting: '' }); render(); } } }, '+ Add subspecialty')),
    ),
    h('section', { class: 'card' },
      h('h2', {}, 'Rules'),
      h('div', { class: 'paste' },
        h('div', {}, h('label', {}, 'Paeds if patient is younger than (years)'), h('input', { type: 'number', min: 1, max: 18, value: st.paedsAgeYears, onchange: e => { st.paedsAgeYears = +e.target.value || 12; save(); } })),
        h('div', {}, h('label', {}, 'Max rooms per premed cover'), h('input', { type: 'number', min: 1, max: 6, value: st.premedCap, onchange: e => { st.premedCap = +e.target.value || 3; save(); } })),
        h('div', {}, h('label', {}, 'Mark days with more people on leave than (0: off)'), h('input', { type: 'number', min: 0, max: 60, value: st.leaveLimit || 0, onchange: e => { st.leaveLimit = Math.max(0, +e.target.value || 0); save(); } })),
        h('div', {}, h('label', {}, 'Complex list keywords'), h('textarea', { value: st.complexKeywords.join(', '), onchange: e => { st.complexKeywords = splitNameList(e.target.value).map(x => x.toLowerCase()); save(); } })),
        h('div', {}, h('label', {}, 'Runs-late keywords'), h('textarea', { value: st.longKeywords.join(', '), onchange: e => { st.longKeywords = splitNameList(e.target.value).map(x => x.toLowerCase()); save(); } })),
      ),
    ),
    h('section', { class: 'card' },
      h('h2', {}, 'Post call'),
      h('p', { class: 'hint' }, 'Someone on one of these overnight duties in the monthly rosters is post call the next day.'),
      h('div', { class: 'chips' }, MONTHLY.flatMap(def => def.cols.filter(c => !def.list).map(c => {
        const key = `${def.id}.${c.key}`;
        const list = st.nightDuties || NIGHT_DUTIES;
        const on = list.includes(key);
        return h('span', { class: 'chip' + (on ? ' on' : ''), onclick: () => { st.nightDuties = on ? list.filter(k => k !== key) : [...list, key]; render(); } }, `${def.label.replace(' Monthly', '')}: ${c.label}`);
      })))),
    h('section', { class: 'card' },
      h('h2', {}, 'Rooms'),
      h('p', { class: 'hint' }, 'The rooms on the roster, in order. "Running by default" rooms are ticked when you set up a new day (Clear day). Rooms in the same complex can share a senior when seniors are short. MOR 7–9 are emergency OTs, so they have no line.'),
      roomEditor(),
      h('p', { class: 'hint', style: 'margin-top:12px' }, 'Room defaults: subspecs a room always needs, one room per line, e.g. "MOR 12: cardiac". Use the keys ' + st.subspecs.map(x => x.key).join(', ') + '.'),
      h('textarea', { rows: 3, 'aria-label': 'Room defaults', value: Object.entries(st.roomDefaults || {}).map(([room, ks]) => `${room}: ${ks.join(', ')}`).join('\n'), onchange: e => {
        const keys = new Set(st.subspecs.map(x => x.key));
        const out = {}, bad = [];
        for (const line of e.target.value.split('\n')) {
          const [room, ks] = line.split(':');
          if (!room?.trim() || ks == null) continue;
          const list = splitNameList(ks).map(x => x.toLowerCase());
          bad.push(...list.filter(k => !keys.has(k)));
          out[room.trim().toUpperCase().replace(/\s+/, ' ')] = list.filter(k => keys.has(k));
        }
        st.roomDefaults = out;
        state.day.rooms.forEach(r => { if (!r.flagsManual) r.flags = suggestFlags(r.notes, st, r.name); });
        save(); toast(bad.length ? `Unknown subspec: ${bad.join(', ')}` : 'Room defaults updated.');
      } }),
    ),
    ),
    isAdmin() ? membersCard() : null,
    h('section', { class: 'card' },
      h('h2', {}, 'Practice mode'),
      h('p', { class: 'hint' }, 'Try the app with a made-up department: invented staff, monthly rosters and cases, with a short tour. It is kept apart from your real data and never signs in or shares anything. Send the link to anyone who wants to learn it.'),
      h('div', { class: 'bar', style: 'margin:0' },
        DEMO ? null : h('a', { class: 'btn', href: demoLink(), target: '_blank', rel: 'noopener' }, 'Open practice'),
        h('button', { onclick: () => navigator.clipboard.writeText(demoLink()).then(() => toast('Practice link copied.'), () => prompt('Practice link', demoLink())) }, 'Copy practice link'),
        h('code', { class: 'seen' }, demoLink()))),
    h('fieldset', { class: 'lock', disabled: !settingsEditing },
    h('section', { class: 'card' },
      h('h2', {}, 'Reset'),
      h('div', { class: 'bar' },
        h('button', { onclick: () => { if (confirm('Reset rules and subspecialties to the defaults? Staff are kept.')) { state.settings = clone(DEFAULT_SETTINGS); render(); } } }, 'Reset rules'),
        h('button', { onclick: () => { if (confirm('Delete everything stored in this browser (staff, day, roster)?')) { setState(blankState()); syncRooms(); render(); } } }, 'Delete all data in this browser')),
    )),
    appVersion(),
  );
}

// App version and "Get the latest version" (owner, 14 Oct 2026; prewarm's pattern): which saved copy this phone runs,
// and a way out for a phone stuck on an old one. It only clears the app's own saved copy, never the roster data or sign-in.
function appVersion() {
  const ver = h('div', { id: 'appver' }), msg = h('span', { role: 'status' });
  if (window.caches) caches.keys().then(ks => {
    const k = ks.filter(x => x.startsWith('nuh-roster-') && !x.startsWith('nuh-roster-rt-')).sort().at(-1); if (!k) return;   // not the runtime caches
    const v = k.slice('nuh-roster-'.length), d = /^(\d{4}-\d{2}-\d{2})-([0-9a-f]+)$/.exec(v);
    ver.textContent = 'App version ' + (d ? `${d[1]} (${d[2]})` : v);
  }).catch(() => {});
  const getLatest = async btn => {
    btn.disabled = true; msg.textContent = '';
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const url = new URL(reg?.active?.scriptURL || new URL('sw.js', location.href));
      url.searchParams.set('fresh', Date.now());
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await reg?.unregister();
      if (window.caches) for (const k of await caches.keys()) if (k.startsWith('nuh-roster-')) await caches.delete(k);
      location.reload();
    } catch { msg.textContent = 'No signal: nothing was changed. Try again with signal.'; btn.disabled = false; }
  };
  return h('div', { class: 'appver hint' }, ver,
    h('div', {}, h('button', { type: 'button', class: 'link', onclick: e => getLatest(e.currentTarget) }, 'Not updating? Get the latest version'), ' ', msg));
}
