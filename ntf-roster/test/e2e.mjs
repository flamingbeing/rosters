// Browser test of NTF Roster in Practice (?demo: a made-up department) and from a fresh start, with Firebase
// blocked, at desktop and phone size, with an axe accessibility check (WCAG 2 A/AA) on every tab.
// Run (from the repo root, with a static server on the repo root at port 8080, e.g. python3 -m http.server 8080):
//   node ntf-roster/test/e2e.mjs            SHOTS=<dir> also saves screenshots
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const AXE = new URL('../../tools/vendor/axe.min.js', import.meta.url).pathname;
const BASE = `http://localhost:${process.env.PORT || 8080}/ntf-roster/`;
const SHOTS = process.env.SHOTS;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ntf-roster-e2e-'));
const T0 = Date.now();

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const errors = [];
let n = 0, checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
async function newPage(viewport, tag, extra = {}) {
  const ctx = await b.newContext({ viewport, acceptDownloads: true, reducedMotion: 'reduce', ...extra });   // no fade-ins under axe
  await ctx.route('https://www.gstatic.com/**', r => r.abort()); // no Firebase: the app works without it
  // the first-time tour (practice opens it once) is tested in tour.e2e.mjs: seen already here
  await ctx.addInitScript(() => { try { localStorage.setItem('ntf-roster-tour', JSON.stringify({ v: 1, done: true })); } catch (e) { /* ignore */ } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${tag}] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource.*gstatic/.test(m.text())) errors.push(`[${tag}] console: ${m.text()}`); });
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png` }); };
const ready = page => page.waitForFunction(() => document.body.classList.contains('ready'));
const stored = (page, key = 'ntf-roster-demo') => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
const hard = page => page.evaluate(() => window.ntfApp.evaluation().hard);
const go = async (page, hash) => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(300); };
async function axe(page, label) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations
    .map(x => `${x.id} ${x.nodes.length}x ${x.nodes[0]?.target}`));
  ok(!v.length, `axe on ${label}: ${v.join('; ')}`);
}
const noSideScroll = async (page, label) => {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  ok(w[0] <= w[1] + 1, `${label}: no sideways page scroll (${w[0]} > ${w[1]})`);
};
// codes in one cell, sorted, for comparing states
const cellsOf = (s, m) => Object.fromEntries(Object.entries(s.cells).filter(([d]) => d.startsWith(m))
  .map(([d, day]) => [d, Object.fromEntries(Object.entries(day).map(([sid, c]) => [sid, [...(c.a || [])].sort().join(' ') + '|' + [...(c.r || [])].sort().join(' ')]))]));

// ================= desktop, practice department =================
let page = await newPage({ width: 1300, height: 900 }, 'desktop');
await page.goto(BASE + '?demo#roster');
await ready(page);
ok(await page.isVisible('#demobar'), 'practice bar shows');
ok(/Practice/.test(await page.textContent('#demobar')), 'practice bar text');
const M0 = await page.evaluate(() => window.ntfApp.month);
let s = await page.evaluate(() => window.ntfApp.store.get());   // saved to localStorage on the first change
ok(s.staff.length >= 60 && s.rules.length >= 15, `demo department loaded (${s.staff.length} staff, ${s.rules.length} rules)`);
ok(await hard(page) === 0, 'the demo month has no must-fix problems');
ok(await page.locator('.cell').count() > 900, 'the grid has a cell per junior-roster person per day');
await shot(page, 'roster');
await axe(page, 'roster (desktop)');

// cell editor: add and remove a leave code on an empty weekday cell
const pick = await page.evaluate(() => {
  const app = window.ntfApp, M = app.model, st = app.store.get();
  const days = M.monthDays(app.month).filter(d => !M.isWeekend(d) && !M.isHoliday(st, d));
  for (const p of M.staffInView(st, app.month).filter(x => x.group === 'mo')) {
    const run = days.filter(d => !M.getCell(st, d, p.id) && !M.effectiveCodes(st, d, p.id).length);
    for (let i = 0; i + 2 < run.length; i++) {
      if (M.addDays(run[i], 1) === run[i + 1] && M.addDays(run[i + 1], 1) === run[i + 2]) return { sid: p.id, d: [run[i], run[i + 1], run[i + 2]] };
    }
  }
  return null;
});
ok(pick, 'found three empty weekdays in a row for one person');
const cellSel = (d, sid) => `.cell[data-d="${d}"][data-s="${sid}"]`;
await page.click(cellSel(pick.d[0], pick.sid));
await page.waitForSelector('.popover .tchip[data-code="AL"]');
await shot(page, 'cell-editor');
await axe(page, 'cell editor');
await page.click('.popover .tchip[data-code="AL"]');
s = await stored(page);
ok(s.cells[pick.d[0]]?.[pick.sid]?.a?.includes('AL'), 'cell editor adds AL');
await page.click('.popover .tchip[data-code="AL"]');
s = await stored(page);
ok(!s.cells[pick.d[0]]?.[pick.sid], 'cell editor removes AL (empty cell deleted)');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
ok(!(await page.$('.popover .tchip')), 'Esc closes the editor');

// keyboard: type a request code then Enter; undo
await page.focus(cellSel(pick.d[1], pick.sid));
await page.keyboard.type('nc');
await page.keyboard.press('Enter');
s = await stored(page);
ok(s.cells[pick.d[1]]?.[pick.sid]?.r?.includes('Nc'), 'typing nc + Enter adds the No call request');
await page.keyboard.press('Control+z');
s = await stored(page);
ok(!s.cells[pick.d[1]]?.[pick.sid], 'Ctrl+Z undoes it');

// paint training leave across three days: one undo step; undo and redo
await page.click('.tbtn:has-text("Paint")');
await page.click('.pchip[data-code="TL"]');
const a = await page.locator(cellSel(pick.d[0], pick.sid)).boundingBox();
const z = await page.locator(cellSel(pick.d[2], pick.sid)).boundingBox();
await page.mouse.move(a.x + 6, a.y + 6); await page.mouse.down();
await page.mouse.move(z.x + 6, z.y + 6, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(150);
s = await stored(page);
ok(pick.d.every(d => s.cells[d]?.[pick.sid]?.a?.includes('TL')), 'paint puts TL on all three days');
ok(/Paint TL on 3 cells/.test(await page.evaluate(() => window.ntfApp.store.undoLabel())), 'the paint drag is one undo step');
await shot(page, 'paint');
await page.click('#undo');
s = await stored(page);
ok(pick.d.every(d => !s.cells[d]?.[pick.sid]), 'Undo removes the painted leave');
await page.click('#redo');
s = await stored(page);
ok(pick.d.every(d => s.cells[d]?.[pick.sid]?.a?.includes('TL')), 'Redo puts it back');
await page.keyboard.press('Control+z');
await page.click('.tbtn:has-text("Paint")');

// month switching: buttons and [ ]
const title = () => page.textContent('#month .m-long');
const t0 = await title();
await page.click('#nextm');
ok((await title()) !== t0 && await page.evaluate(() => window.ntfApp.month) !== M0, 'next month');
await page.keyboard.press('[');
ok((await title()) === t0, '[ goes back a month');
await page.keyboard.press(']');
await page.keyboard.press('[');
ok((await title()) === t0, '] and [ switch months');

// rules: add "two people never on call together" for two juniors on call the same night
const pair = await page.evaluate(() => {
  const app = window.ntfApp, M = app.model, st = app.store.get();
  for (const d of M.monthDays(app.month)) {
    const on = M.staffInView(st, app.month).filter(p => !['cons', 'ac', 'ext', 'vc'].includes(p.group) && (M.getCell(st, d, p.id)?.a || []).includes('C'));
    if (on.length >= 2) return { d, a: on[0].id, b: on[1].id };
  }
  return null;
});
ok(pair, 'found two juniors on call together');
await go(page, '#rules');
await page.waitForSelector('.rv-card');
await shot(page, 'rules');
await axe(page, 'rules (desktop)');
await page.click('.rv-add');
await page.waitForSelector('.rp-tpl');
await axe(page, 'add-rule picker');
await page.click('.rp-tpl:has-text("never on call together")');
await page.waitForSelector('.rb');
await page.locator('.rb .bx-who-sel').nth(0).selectOption(pair.a);
await page.locator('.rb .bx-who-sel').nth(2).selectOption(pair.b);
await page.waitForTimeout(250);
ok(/never/.test(await page.textContent('.rb-sentence')), 'the builder sentence describes the pairing');
ok(/problem/.test(await page.textContent('.rb-check')), 'the live check finds the clash before saving');
await shot(page, 'rule-builder');
await axe(page, 'rule builder');
const nRules = (await stored(page)).rules.length;
await page.click('.sheet-foot .btn-primary');
await page.waitForTimeout(250);
s = await stored(page);
ok(s.rules.length === nRules + 1, 'rule saved');
const newRule = s.rules[s.rules.length - 1];
ok(newRule.type === 'together' && newRule.params.mode === 'never' && [newRule.who.staff[0], newRule.params.other.staff[0]].sort().join() === [pair.a, pair.b].sort().join(), 'the saved rule is a together-never rule for the pair');
ok(s.rulesLog.at(-1)?.action === 'add' && s.rulesLog.at(-1)?.ruleId === newRule.id, 'the rules log records the add');
ok(await hard(page) > 0, 'the new rule makes a must-fix problem');
await go(page, '#roster?m=' + M0);
await page.waitForSelector('.cell');
ok(await page.locator(`${cellSel(pair.d, pair.a)} .vx.vh, ${cellSel(pair.d, pair.b)} .vx.vh`).count() >= 1, 'the clash shows as a red corner in the grid');
ok(/problem/.test(await page.textContent('#problems')), 'the header badge counts it');
await go(page, '#check');
await page.waitForSelector('.cv-group');
ok(await page.locator(`.cv-group:has-text("never")`).count() >= 1, 'Check lists the new rule\'s problems');
await shot(page, 'check');
await axe(page, 'check (desktop)');
for (const v of ['Fairness', 'Coverage']) {
  await page.click(`.bx-tab:has-text("${v}")`);
  await page.waitForTimeout(200);
  await axe(page, `check ${v}`);
}
// turn it off: the problem goes
await go(page, '#rules');
await page.locator(`.rv-card[data-rule="${newRule.id}"] .rv-sw`).click();
s = await stored(page);
ok(s.rules.find(r => r.id === newRule.id).enabled === false, 'the rule switch turns it off');
ok(await hard(page) === 0, 'no must-fix problems once it is off');

// Rules › Edit as text: change a number, add a line, remove a line; an unreadable line is named and nothing is saved
{
  const before = await stored(page);
  await page.click('.rv-tools [data-k="text"]');
  await page.waitForSelector('.rt-text');
  await axe(page, 'edit rules as text');
  const text = await page.inputValue('.rt-text');
  ok(/^MUST\s+.*at most 7 C a month, scaled by FTE\s+\[r-maxcall\]$/m.test(text), 'each rule is a plain line');
  const edited = text.replace('at most 7 C a month', 'at most 6 C a month').split('\n').filter(l => !/\[r-req-pr\]$/.test(l)).join('\n');
  await page.fill('.rt-text', edited + '\nMUST  Juniors: at most lots of C\n');
  await page.click('.sheet-foot .btn-primary');
  await page.waitForSelector('.rt .warn-box:not([hidden])');
  ok(/Line \d+/.test(await page.textContent('.rt .warn-box')), 'an unreadable line is named');
  await page.fill('.rt-text', edited + '\nPREF 30  No clinic after call = If C, then no Clinic on the next day\n');
  await page.click('.sheet-foot .btn-primary');
  await page.waitForSelector('.ri-list');
  await page.waitForSelector('.rt-text', { state: 'detached' });   // the editor closes for the review
  const review = await page.textContent('.ri:has(.ri-list)');
  ok(/1 new, 1 changed/.test(review) && /1 to delete/.test(review), `the review lists the changes (${review.slice(0, 120)})`);
  await axe(page, 'review of the text edit');
  await page.click('.sheet-foot .btn-primary');
  await page.waitForTimeout(250);
  s = await stored(page);
  ok(s.rules.find(r => r.id === 'r-maxcall').params.max === 6, 'the edited number is saved');
  ok(!s.rules.some(r => r.id === 'r-req-pr'), 'the removed line deleted its rule');
  const added = s.rules.find(r => r.name === 'No clinic after call');
  ok(added && added.type === 'sequence' && added.hard === false && added.weight === 30 && added.pool === 'junior', 'the new line is a new rule');
  ok(s.rules.length === before.rules.length, 'one added, one deleted');
  await page.evaluate(() => window.ntfApp.store.undo());
  await page.waitForTimeout(150);
  s = await stored(page);
  ok(s.rules.find(r => r.id === 'r-maxcall').params.max === 7 && s.rules.some(r => r.id === 'r-req-pr'), 'one undo brings it all back');
  // Paste / import reads the readable file (Export as text) and rule lines too
  const file = await page.evaluate(async () => (await import('./js/rules-text.js')).rulesToFile(window.ntfApp.store.get()));
  await page.click('.rv-tools [data-k="paste"]');
  await page.waitForSelector('.ri-text');
  await page.fill('.ri-text', file.replace(/at most 7 C a month/i, 'At most 5 C a month') + '\n- name: Clinic days\n  strength: preference 15\n  who: Juniors\n  rule: At most 2 Clinic a week\n');
  await page.click('.sheet-foot .btn-primary');
  await page.waitForSelector('.ri-list');
  const rv = await page.textContent('.ri:has(.ri-list)');
  ok(/1 new, 1 changed/.test(rv), `the text file imports with a review (${rv.slice(0, 300)})`);
  await page.click('.sheet-back:last-child .sheet-foot .btn-primary');
  await page.waitForTimeout(250);
  s = await stored(page);
  ok(s.rules.find(r => r.id === 'r-maxcall').params.max === 5 && s.rules.some(r => r.name === 'Clinic days' && r.weight === 15), 'imported from text');
  await page.evaluate(() => window.ntfApp.store.undo());
}

// the rule builder's sentence with blanks: change the number and a switch in the sentence, the form follows
{
  await go(page, '#rules?edit=r-maxcall');
  await page.waitForSelector('.rs-line');
  ok(/at most/.test(await page.textContent('.rs-line')) && /scaled by FTE/.test(await page.textContent('.rs-line')), 'the builder shows the rule as a sentence');
  ok(!(await page.isVisible('.rb-adv-body')), 'every field is under Advanced, closed');
  await page.fill('.rs-line input[aria-label="At most"]', '6');
  await page.locator('.rs-flag:has-text("scaled by FTE") input').uncheck();
  await page.click('.rs-blank[aria-label^="When"]');
  await page.click('.rs-panel .bx-pill:has-text("Weekends")');
  ok(/weekends/i.test(await page.textContent('.rs-line')), 'the When blank picks days');
  await page.click('.rb-adv > summary');
  await page.waitForTimeout(150);   // the toggle event redraws the fields
  ok(await page.inputValue('.rb-adv [data-key="max"] input') === '6', 'Advanced shows the number set in the sentence');
  await axe(page, 'rule builder sentence');
  await shot(page, 'rule-sentence');
  await page.click('.sheet-foot .btn-primary');
  await page.waitForTimeout(250);
  s = await stored(page);
  const mc = s.rules.find(r => r.id === 'r-maxcall');
  ok(mc.params.max === 6 && mc.params.fte === false && mc.when.days.join() === '0,6', 'saved from the sentence');
  await page.evaluate(() => window.ntfApp.store.undo());
}
// every kind of rule draws its sentence (one rule of each type the practice roster has, plus a new one of each type)
{
  const ids = await page.evaluate(() => { const seen = {}; for (const r of window.ntfApp.store.get().rules) if (r.pool === 'junior' || !r.pool) seen[r.type] ||= r.id; return Object.values(seen); });
  for (const id of ids) {
    await go(page, `#rules?edit=${id}`);
    await page.waitForSelector('.rs-line');
    ok((await page.textContent('.rs-line')).trim().length > 10, `sentence for ${id}`);
    await page.click('.sheet-foot .btn:has-text("Cancel")');
    await page.waitForSelector('.rs-line', { state: 'detached' });
  }
  ok(ids.length >= 7, `${ids.length} rule types drawn`);
}

// people and more tabs
await go(page, '#people');
await page.waitForSelector('.pv-row');
await shot(page, 'people');
await axe(page, 'people (desktop)');
await go(page, '#day');
await page.waitForSelector('.view-day');
await page.waitForTimeout(200);
await shot(page, 'day');
await axe(page, 'day (desktop)');

// auto-fill next month (no calls yet): apply, then no must-fix problems (one undo step)
await go(page, '#roster');
await page.click('#nextm');
await page.waitForTimeout(200);
const M1 = await page.evaluate(() => window.ntfApp.month);
const callsIn = (st, m) => Object.entries(st.cells).filter(([d]) => d.startsWith(m)).reduce((k, [, day]) => k + Object.values(day).filter(c => (c.a || []).includes('C')).length, 0);
ok(callsIn(await stored(page), M1) === 0, 'next month has no calls before auto-fill');
ok(await hard(page) > 0, 'next month has must-fix problems before auto-fill');
await page.click('#autofill');
await page.waitForSelector('.af');
await page.click('label[for="af-auto"]');   // untick Apply when done, to see the preview first
await page.click('label[for="af-t-15000"]');   // ends early once its search is done (under a second here); the slack is for slow CI machines
await page.click('.af .btn-primary');
await page.waitForSelector('.af-headline', { timeout: 30000 });
await shot(page, 'autofill-preview');
await page.click('.af .btn-primary:has-text("Apply")');
await page.waitForTimeout(300);
s = await stored(page);
ok(callsIn(s, M1) > 40, `auto-fill filled the calls (${callsIn(s, M1)})`);
ok(await hard(page) === 0, `auto-fill leaves no must-fix problems (${await hard(page)})`);
ok(Object.values(s.cells).some(day => Object.values(day).some(c => (c.auto || []).includes('C'))), 'filled codes are marked auto');
ok(/auto-fill/i.test(await page.evaluate(() => window.ntfApp.store.undoLabel())), 'Apply is one undo step');
await shot(page, 'autofilled');

// more: version lines, Excel round trip, backup and restore
await go(page, '#more');
await page.waitForSelector('.more-foot .appver');
ok(await page.isVisible('.more-foot button:has-text("Not updating? Get the latest version")'), 'More ends with "Get the latest version"');
await page.waitForFunction(() => /^App version /.test(document.querySelector('.more-foot .appver-line')?.textContent || ''), null, { timeout: 15000 });
ok(/^App version (v1|\d{4}-\d{2}-\d{2} \([0-9a-f]+\))$/.test(await page.textContent('.more-foot .appver-line')), 'More shows the app version from the cache name');
ok(await page.evaluate(() => { const r = document.querySelector('.more'); return r.lastElementChild.classList.contains('more-foot'); }), 'the version lines are the last thing on More');
await shot(page, 'more');
await axe(page, 'more (desktop)');

await page.evaluate(m => window.ntfApp.setMonth(m), M0);
await page.waitForTimeout(150);
const [xl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download this month")')]);
ok(/\.xlsx$/.test(xl.suggestedFilename()), `Excel download (${xl.suggestedFilename()})`);
const xlPath = path.join(TMP, xl.suggestedFilename());
await xl.saveAs(xlPath);
const beforeImport = cellsOf(await stored(page), M0);
await page.setInputFiles('section[aria-labelledby="more-import"] input[type=file]', xlPath);
await page.waitForSelector('.imp', { timeout: 15000 });
ok(/0 new/.test(await page.textContent('.imp')), 'every person in the exported sheet is matched');
await axe(page, 'import review');
await page.click('.sheet-foot .btn-primary:has-text("Apply import")');
await page.waitForTimeout(300);
const afterImport = cellsOf(await stored(page), M0);
ok(JSON.stringify(afterImport) === JSON.stringify(beforeImport), 'export then import gives the same cells');
ok(/Import/.test(await page.evaluate(() => window.ntfApp.store.undoLabel())), 'the import is one undo step');

// (The pull of rotations from APMES People needs the People app, which lives in the apmes repo; its browser test of
// the pull goes there with it.)

const [bk] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download backup")')]);
const bkPath = path.join(TMP, 'backup.json');
await bk.saveAs(bkPath);
const backup = JSON.parse(fs.readFileSync(bkPath, 'utf8'));
ok(backup.kind === 'ntf-roster-backup' && backup.state.staff.length === s.staff.length, 'backup has the whole state');
await page.evaluate(() => window.ntfApp.store.commit('Test change', d => { d.settings.dept = 'Changed for the test'; }));
await page.setInputFiles('section[aria-labelledby="more-backup"] input[type=file]', bkPath);
await page.waitForSelector('.sheet-foot .btn-danger:has-text("Restore")');
await page.click('.sheet-foot .btn-danger:has-text("Restore")');
await page.waitForTimeout(250);
s = await stored(page);
ok(s.settings.dept === backup.state.settings.dept && JSON.stringify(s.cells) === JSON.stringify(backup.state.cells), 'restore brings the backup back');
await page.context().close();

// ================= phone, practice department =================
page = await newPage({ width: 390, height: 844 }, 'phone', { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await page.goto(BASE + '?demo');
await ready(page);
ok(await page.evaluate(() => window.ntfApp.tab) === 'day', 'phones open on Day');
ok(await page.isVisible('#bottombar') && await page.locator('#bottombar .bb-tab').count() === 5, 'bottom tab bar with 5 tabs');
await page.waitForTimeout(200);
await shot(page, 'phone-day');
await axe(page, 'day (phone)');
await noSideScroll(page, 'day (phone)');
await page.click('.bb-tab[data-tab="roster"]');
await page.waitForSelector('.cell');
await page.waitForTimeout(200);
await shot(page, 'phone-roster');
await axe(page, 'roster (phone)');
await noSideScroll(page, 'roster (phone)');
const ph = await page.evaluate(() => {
  const app = window.ntfApp, M = app.model, st = app.store.get();
  const d = M.monthDays(app.month).find(x => !M.isWeekend(x) && !M.isHoliday(st, x));
  const p = M.staffInView(st, app.month).find(x => !M.getCell(st, d, x.id) && !M.effectiveCodes(st, d, x.id).length);
  return { d, sid: p.id };
});
await page.locator(cellSel(ph.d, ph.sid)).scrollIntoViewIfNeeded();
await page.tap(cellSel(ph.d, ph.sid));
await page.waitForSelector('.sheet .tchip[data-code="MC"]');
await shot(page, 'phone-editor');
await axe(page, 'cell editor (phone)');
await page.tap('.sheet .tchip[data-code="MC"]');
s = await stored(page);
ok(s.cells[ph.d]?.[ph.sid]?.a?.includes('MC'), 'phone cell editor adds MC');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
for (const t of ['check', 'rules', 'more']) {
  await page.click(`.bb-tab[data-tab="${t}"]`);
  await page.waitForTimeout(400);
  await shot(page, 'phone-' + t);
  await axe(page, `${t} (phone)`);
  await noSideScroll(page, `${t} (phone)`);
}
ok(await page.isVisible('.view-more .link-card[href="#people"]'), 'More has the People link on phones');
await page.click('.view-more .link-card[href="#people"]');
await page.waitForSelector('.pv-row');
await shot(page, 'phone-people');
await axe(page, 'people (phone)');
await noSideScroll(page, 'people (phone)');
await go(page, '#rules');
await page.waitForSelector('.rv-card');
await page.locator('.rv-card[data-rule="r-jcall"] .rv-open').click();
await page.waitForSelector('.rb');
await shot(page, 'phone-rule-builder');
await axe(page, 'rule builder (phone)');
await page.context().close();

// ================= fresh start (no practice data) =================
page = await newPage({ width: 1300, height: 900 }, 'fresh');
await page.goto(BASE + '#roster');
await ready(page);
ok(await page.isVisible('.welcome-card'), 'a fresh start shows the welcome card');
ok(!(await page.isVisible('#demobar')), 'no practice bar outside practice');
await axe(page, 'welcome');
await page.click('.welcome-card button:has-text("Add staff")');
await page.waitForSelector('.pv-bar .btn-primary');
await page.click('.pv-bar .btn-primary');
await page.waitForSelector('.sheet .bx-form');
await page.locator('.sheet input[type="text"]').first().fill('Test Person');
await page.click('.sheet-foot .btn-primary');
await page.waitForTimeout(200);
s = await stored(page, 'ntf-roster-v1');
ok(s && s.staff.length === 1 && s.staff[0].name === 'Test Person', 'the first person is saved under ntf-roster-v1');
ok(s.rules.length >= 15 && s.duties.some(d => d.code === 'C'), 'a fresh roster starts with the default rules and codes');
await go(page, '#roster');
await page.waitForSelector('.cell');
ok(await page.locator('.cell').count() >= 28, 'the roster grid shows the new person');
await go(page, '#more');
await page.waitForSelector('.more-foot .appver');
await page.waitForFunction(() => /Sign in with Google|could not start/.test(document.querySelector('section[aria-labelledby="more-team"]').textContent), null, { timeout: 15000 });
ok(true, 'team sharing is on: it offers Google sign-in (or says it could not start offline)');
await page.context().close();

await b.close();
fs.rmSync(TMP, { recursive: true, force: true });
ok(!errors.length, 'no page or console errors:\n' + errors.join('\n'));
console.log(`ntf-roster e2e: ${checks} checks passed in ${((Date.now() - T0) / 1000).toFixed(1)} s`);
