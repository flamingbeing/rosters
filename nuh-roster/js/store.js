// Saved data from older versions of the app, brought up to date. Pure: each takes the whole state and changes it
// in place (no DOM, no storage), so old saved files can be tested (test/engine.test.mjs).

// Load a saved state over a blank one: settings merge key by key (new settings get their defaults).
export function mergeSaved(blank, saved, defaultSettings) {
  if (!saved || typeof saved !== 'object') return blank;
  return { ...blank, ...saved, settings: { ...JSON.parse(JSON.stringify(defaultSettings)), ...saved.settings }, roomsVersion: saved.roomsVersion || 1 };
}

// v2: Remote Case -> Remote 1 + Remote 2, add KROR 1 and MCOR 9
export function migrateRooms(state) {
  const t = state.roomTemplate;
  if ((state.roomsVersion || 1) >= 2) return migratePacu(state);
  const rename = (from, to) => {
    t.forEach(r => { if (r.name === from) r.name = to; });
    (state.day?.rooms || []).forEach(r => { if (r.name === from) r.name = to; });
    (state.roster?.rows || []).forEach(r => { if (r.label === from) r.label = to; });
  };
  rename('Remote Case', 'Remote 1');
  const addAfter = (name, complex, after, before) => {
    if (t.some(r => r.name === name)) return;
    let i = t.findIndex(r => r.name === after);
    if (i >= 0) i++; else i = Math.max(0, t.findIndex(r => r.name === before));
    t.splice(i, 0, { complex, name, defaultOn: false });
  };
  addAfter('Remote 2', 'Other', 'Remote 1', 'KROR 2');
  addAfter('KROR 1', 'KROR', null, 'KROR 2');
  addAfter('MCOR 9', 'MCOR', 'MCOR 8', 'MCOR 10');
  t.forEach(r => { if (r.defaultOn === undefined) r.defaultOn = true; });
  state.roomsVersion = 2;
  migratePacu(state);
}

// v3: a PACU row above each complex
function migratePacu(state) {
  if ((state.roomsVersion || 1) >= 3) return migrateEct(state);
  const t = state.roomTemplate;
  for (const [complex, name] of [['KROR', 'KROR PACU'], ['MCOR', 'MCOR PACU'], ['MOR', 'MBOR PACU']]) {
    if (t.some(r => r.name === name)) continue;
    const i = t.findIndex(r => r.complex === complex);
    t.splice(i < 0 ? t.length : i, 0, { complex, name, defaultOn: true });
  }
  state.roomsVersion = 3;
  migrateEct(state);
}

// v4: ECT moves from the calls to the OT rows, just above MBOR PACU
function migrateEct(state) {
  if ((state.roomsVersion || 1) >= 4) return;
  const t = state.roomTemplate;
  if (!t.some(r => r.name === 'ECT')) {
    const i = t.findIndex(r => r.name === 'MBOR PACU');
    t.splice(i < 0 ? t.length : i, 0, { complex: 'ECT', name: 'ECT', defaultOn: true });
  }
  state.roomsVersion = 4;
}
