// Browser test of the NUH roster in Practice (?demo: made-up staff only), with Firebase blocked, at desktop and
// phone size, with an axe accessibility check on every tab.
// Run (from the repo root, with a static server on the repo root at port 8080, e.g. python3 -m http.server 8080):
//   node nuh-roster/test/e2e.mjs            SHOTS=<dir> also saves screenshots
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const AXE = new URL('../../tools/vendor/axe.min.js', import.meta.url).pathname;
const BASE = `http://localhost:${process.env.PORT || 8080}/nuh-roster/`;
const SHOTS = process.env.SHOTS;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-e2e-'));

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const errors = [];
let n = 0, checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
async function newPage(viewport, extra = {}) {
  const ctx = await b.newContext({ viewport, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], ...extra });
  await ctx.route('https://www.gstatic.com/**', r => r.abort()); // no Firebase: Practice works offline
  await ctx.addInitScript(() => { try { localStorage.setItem('nuh-roster-tour', 'done'); } catch { /* no storage */ } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png` }); };
const tab = async (page, name) => { await page.click(`.tabs button:has-text("${name}")`); await page.waitForTimeout(250); };
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('ot-roster-demo')));
const problems = page => page.$$eval('#problems li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ')).filter(Boolean));

// ---- desktop ----
let page = await newPage({ width: 1300, height: 900 });
await page.goto(BASE + '?demo');
await page.waitForSelector('#demo-bar');

// the tour's targets all exist once a roster is made (a missing one is skipped silently)
await tab(page, 'Roster');
const gen = await page.$('button:has-text("Generate roster")');
if (gen) { await gen.click(); await page.waitForTimeout(600); }
const tourSel = await page.evaluate(async () => {
  const src = await (await fetch('js/ui-tour.js')).text();
  return [...src.matchAll(/\{ (?:tab: '(\w+)', )?sel: '([^']+)'/g)].map(m => [m[1] || '', m[2]]);
});
ok(tourSel.length >= 6, 'tour steps found');
for (const [t, sel] of tourSel) {
  if (t) await tab(page, { monthly: 'Monthly', cases: 'Cases', roster: 'Roster' }[t]);
  ok(await page.$(sel), `tour target ${sel} on ${t || 'any'} tab`);
}

// a made roster has no problem beyond the demo's known short room
await tab(page, 'Roster');
const first = await problems(page);
ok(first.every(t => /no senior|Check:|Note:/.test(t)), 'generated roster: ' + first.join(' | '));
await shot(page, 'roster');

// live check after a hand edit: a double-covered room with no junior
const blanked = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('ot-roster-demo'));
  const cnt = {};
  s.roster.rows.forEach(r => String(r.senior || '').split('/').map(x => x.trim()).filter(Boolean).forEach(n => { cnt[n] = (cnt[n] || 0) + 1; }));
  let row = s.roster.rows.find(r => r.roomId && !/PACU/.test(r.label) && r.junior && String(r.senior).split('/').some(n => cnt[n.trim()] > 1));
  if (!row) { // make one: the first room's senior also takes the next room in its complex
    const a = s.roster.rows.find(r => r.complex === 'MOR' && r.senior && r.junior), c = s.roster.rows.find(r => r !== a && r.complex === 'MOR' && r.senior && r.junior);
    c.senior = a.senior; row = c;
  }
  row.junior = '';
  localStorage.setItem('ot-roster-demo', JSON.stringify(s));
  return row.label;
});
await page.reload(); await tab(page, 'Roster');
ok((await problems(page)).some(t => t.startsWith(`Problem: ${blanked}: no junior, and the senior is double covering`)), 'live double-cover check');
await page.click(`#problems li:has-text("${blanked}: no junior") button:has-text("Fill")`); await page.waitForTimeout(600);
ok(!(await problems(page)).some(t => t.includes(`${blanked}: no junior`)), 'Fill empty gaps fixes it');

// sending: a download counts as sent; a change afterwards is listed, and the resend is stamped
const [x1] = await Promise.all([page.waitForEvent('download'), page.click('.split > button >> nth=0')]);
ok(/\.xlsx$/.test(x1.suggestedFilename()), 'xlsx download');
await page.waitForTimeout(400);
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('ot-roster-demo')); const rows = s.roster.rows.filter(r => r.senior && r.junior); [rows[0].junior, rows[1].junior] = [rows[1].junior, rows[0].junior]; localStorage.setItem('ot-roster-demo', JSON.stringify(s)); });
await page.reload(); await tab(page, 'Roster');
ok(/Changed since sent at .* \(2\)/.test(await page.$eval('#changes h2', e => e.innerText)), 'changes since sent');
const [x2] = await Promise.all([page.waitForEvent('download'), page.click('#changes button:has-text("Send image")')]);
ok(/\.png$/.test(x2.suggestedFilename()), 'image resend');
await page.waitForTimeout(400);
ok(/^Updated \d\d:\d\d$/.test(Object.values((await stored(page)).outSent).pop().stamp), 'resend is stamped Updated');

// keyboard: a roster name opens its box, Tab stays inside, Escape returns focus
await page.focus('table.roster-edit .name[tabindex]');
await page.keyboard.press('Enter'); await page.waitForTimeout(250);
ok(await page.evaluate(() => !!document.activeElement.closest('.tag-editor')), 'box takes focus');
for (let i = 0; i < 30; i++) await page.keyboard.press('Tab');
ok(await page.evaluate(() => !!document.activeElement.closest('.tag-editor')), 'Tab stays in the box');
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok(await page.evaluate(() => document.activeElement.matches('.name[tabindex]')), 'focus back on the name');

// practice exercise
// from the day as Practice made it: earlier steps here use up the free seniors the fix buttons need. The planted
// problems are random and Fill can now and then give a freed senior another job, so up to three tries.
let practiceDone = false;
for (let attempt = 0; attempt < 3 && !practiceDone; attempt++) {
  await page.click('#demo-bar button:has-text("Reset this day")'); await page.waitForTimeout(300);
  await page.click('#demo-bar button:has-text("Fix 3 problems")'); await page.waitForTimeout(600);
  ok(/0 of 3/.test(await page.$eval('.practice-task h2', e => e.innerText)), 'practice task planted');
  const planted = (await stored(page)).practiceTask.items.map(i => i.match);
  for (let i = 0; i < 8; i++) {
    const fix = await page.evaluateHandle(m => [...document.querySelectorAll('#problems li.error')].find(li => m.some(x => li.innerText.includes(x)))?.querySelector('button.primary') || null, planted);
    if (!(await fix.evaluate(b => !!b))) break;
    await fix.click(); await page.waitForTimeout(500);
  }
  practiceDone = /Well done/.test(await page.$eval('.practice-task h2', e => e.innerText));
}
ok(/Well done/.test(await page.$eval('.practice-task h2', e => e.innerText)), 'practice task done with the fix buttons');

// practice draft round trip through Do it all
await page.click('#demo-bar button:has-text("Reset this day")'); await page.waitForTimeout(300);
await tab(page, 'Cases');
const before = (await stored(page)).day.rooms.filter(r => r.running).map(r => r.name + ':' + r.notes).join('|');
const [dr] = await Promise.all([page.waitForEvent('download'), page.click('main button:has-text("Download a practice draft")')]);
const draft = path.join(TMP, 'draft.xlsx'); await dr.saveAs(draft);
await page.setInputFiles('main label.btn.primary input', draft); await page.waitForTimeout(1200);
const after = await stored(page);
ok(after.day.rooms.filter(r => r.running).map(r => r.name + ':' + r.notes).join('|') === before, 'draft reads back the same rooms and cases');
ok(after.roster && after.tab === 'roster', 'Do it all made the roster');

// monthly: a clash shows in the grid; Clear and Undo
await tab(page, 'Monthly');
await page.click('main button:has-text("Junior Monthly")'); await page.waitForTimeout(300);
ok(!(await page.$('.month-issues')), 'demo month starts without clashes');
await page.evaluate(() => { const ins = document.querySelectorAll('table.monthly tbody tr')[4].querySelectorAll('input'); ins[1].value = ins[0].value; ins[1].dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(300);
ok(await page.$('td.clash'), 'two overnight duties marked');
const cells = async () => page.$$eval('table.monthly input', is => is.filter(i => i.value).length);
const full = await cells();
await page.click('main button:has-text("Clear")'); await page.waitForTimeout(200);
ok(await cells() === 0, 'cleared');
await page.click('#toast button:has-text("Undo")'); await page.waitForTimeout(400);
ok(await cells() === full, 'Undo brings the month back');

// Key and help: the marks and "How do I…?" answers
await page.click('#keyBtn'); await page.waitForTimeout(200);
ok((await page.$$('dialog .key-table tr')).length >= 15 && (await page.$$('dialog .how details')).length >= 8, 'key and help');
await page.keyboard.press('Escape'); await page.waitForTimeout(150);

// axe on every tab
if (fs.existsSync(AXE)) {
  await page.addScriptTag({ path: AXE });
  for (const t of ['Monthly', 'Cases', 'Roster', 'Premeds', 'Staff', 'Settings']) {
    await tab(page, t);
    // a toast fading in or out is measured mid-fade: let it go first
    await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
    await page.waitForTimeout(300);
    const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map(x => `${x.id} ${x.nodes[0]?.target}`));
    ok(!v.length, `axe on ${t}: ${v.join('; ')}`);
  }
}
await page.context().close();

// ---- phone ----
page = await newPage({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
await page.goto(BASE + '?demo'); await page.waitForSelector('#demo-bar');
// the header and an opened Practice tools box fit the phone: wider content would zoom the page out and put the
// Next step bar over the tab bar (a wide fallback font did that once)
await page.evaluate(() => { const d = document.querySelector('#demo-bar details'); if (d) d.open = true; });
ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'no sideways scroll on a phone with Practice tools open');
await tab(page, 'Roster');
const g2 = await page.$('button:has-text("Generate roster")'); if (g2) { await g2.tap(); await page.waitForTimeout(600); }
ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'no sideways scroll on a phone');
ok((await page.$$eval('input, select', es => [...new Set(es.map(e => getComputedStyle(e).fontSize))])).every(s => s === '16px'), 'fields are 16px (no iOS zoom)');
ok(await page.$$eval('.name, .chip, .add-name, button.small', es => es.filter(e => e.offsetParent && e.getBoundingClientRect().height < 30).length) === 0, 'touch targets 30px+');
await tab(page, 'Cases');
ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) && await page.$eval('table.cases-table', t => t.scrollWidth <= t.parentElement.clientWidth + 1), 'Cases fits a phone (room cards)');
await tab(page, 'Roster');
await page.locator('table.roster-edit .name').first().tap(); await page.waitForTimeout(300);
ok(await page.$('.tag-editor .bar button.save'), 'person box opens with its Save bar');
await shot(page, 'phone-box');
// My day for a person on the roster: lines, copy for logbook, My week
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('ot-roster-demo')); const row = s.roster.rows.find(r => r.junior && r.senior && r.notes); const p = s.staff.find(x => x.name === row.junior.split(' (')[0]); localStorage.setItem('nuh-roster-me', p.id); });
await page.goto(BASE + '?demo#myday'); await page.waitForTimeout(700);
ok((await page.$$('.myday-list li')).length >= 1, 'My day lists the room');
await page.click('.logbook-copy'); await page.waitForTimeout(200);
ok(/^Date: .*\nRoom: .*\nSupervisor: /.test(await page.evaluate(() => navigator.clipboard.readText())), 'copy for logbook');
await page.click('.myday-actions button:has-text("My week")'); await page.waitForTimeout(400);
ok((await page.$$('.myweek-list li')).length === 7, 'My week has 7 days');
await shot(page, 'myday');
await page.context().close();

// ---- a practice link with a scenario: the late MCs show as problems to fix ----
page = await newPage({ width: 1300, height: 900 });
await page.goto(BASE + '?demo=latemc'); await page.waitForTimeout(1200);
ok((await problems(page)).filter(t => /is on MC but rostered/.test(t)).length === 2, 'late MC scenario');
await page.context().close();

// ---- Settings: App version and "Get the latest version" (clears only the app's saved copy) ----
page = await newPage({ width: 390, height: 844 });
await page.goto(BASE + '?demo'); await page.waitForSelector('#demo-bar');
await page.evaluate(async () => { await navigator.serviceWorker.ready; for (let i = 0; i < 50 && !(await caches.keys()).some(k => k.startsWith('nuh-roster-')); i++) await new Promise(r => setTimeout(r, 100)); });
await tab(page, 'Settings');
const latest = page.locator('.appver button:has-text("Not updating? Get the latest version")');
ok(await latest.count() === 1, 'Get the latest version button on Settings');
await page.waitForFunction(() => /^App version \S/.test(document.getElementById('appver')?.textContent || ''));
ok(true, 'App version line after the service worker installs');
await page.evaluate(async () => { localStorage.setItem('appver-keep', '1'); await caches.open('nuh-roster-old'); await caches.open('other-app-v1'); });
await Promise.all([page.waitForEvent('load'), latest.click()]);
const after2 = await page.evaluate(async () => ({ keys: await caches.keys(), keep: localStorage.getItem('appver-keep'), demo: !!localStorage.getItem('ot-roster-demo') }));
ok(!after2.keys.includes('nuh-roster-old') && after2.keys.includes('other-app-v1') && after2.keep === '1' && after2.demo, 'Get the latest version clears only nuh-roster- caches and keeps localStorage: ' + JSON.stringify(after2));
await page.context().close();

// ---- the real app, empty: welcome card, tour points to Practice ----
page = await newPage({ width: 390, height: 844 });
await page.goto(BASE); await page.waitForTimeout(700);
ok(await page.$('.welcome'), 'welcome card on an empty app');
await page.click('#tourBtn'); await page.waitForTimeout(200);
ok(/Practice/.test(await page.$eval('#toast', e => e.innerText)), 'tour offers Practice');
await page.context().close();

await b.close();
fs.rmSync(TMP, { recursive: true, force: true });
assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
console.log(`roster e2e: ${checks} checks passed`);
