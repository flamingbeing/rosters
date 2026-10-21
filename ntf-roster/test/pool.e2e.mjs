// Browser test of the junior pool screens in NTF Roster (practice department, ?demo): the pool switch, the Junior pool
// setup, junior rules with To confirm, APS weeks, leave dates and the quick request form, with axe on each.
// Run (repo root, static server on port 8080): node ntf-roster/test/pool.e2e.mjs      SHOTS=<dir> saves 390 px screenshots
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
import fs from 'node:fs';
const AXE = new URL('../../tools/vendor/axe.min.js', import.meta.url).pathname;
const BASE = `http://localhost:${process.env.PORT || 8080}/ntf-roster/`;
const SHOTS = process.env.SHOTS;
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const errors = [];
let checks = 0, shots = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
async function open(viewport) {
  const ctx = await b.newContext({ viewport, reducedMotion: 'reduce' });
  await ctx.route('https://www.gstatic.com/**', r => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('ntf-roster-tour', JSON.stringify({ v: 1, done: true })); } catch (e) { /* ignore */ } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/gstatic/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return page;
}
async function axe(page, label) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map(x => `${x.id} ${x.nodes.length}x ${x.nodes[0]?.target}`));
  ok(!v.length, `axe on ${label}: ${v.join('; ')}`);
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++shots).padStart(2, '0')}-${name}.png` }); };
const state = page => page.evaluate(() => JSON.parse(localStorage.getItem('ntf-roster-demo') || localStorage.getItem('ntf-roster-v1') || '{}'));

const page = await open({ width: 1300, height: 900 });
await page.goto(`${BASE}?demo#roster`);
await page.waitForSelector('.view-roster, .rv-grid, [data-view]', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(800);
const rows = () => page.locator('[data-staff], tr[data-sid], .rg-row').count();

// roster switch: two buttons, Junior at first; the grid shows that roster only
ok((await page.locator('#poolsw .pool-btn').count()) === 2, 'two roster buttons');
ok((await page.locator('#poolsw [data-pool="junior"]').getAttribute('aria-pressed')) === 'true', 'Junior is pressed at first');
let st = await state(page);
ok(!st.settings || !st.settings.pool || st.settings.pool === 'junior', 'junior at first (the practice copy is saved on its first change)');
await page.click('#poolsw [data-pool="senior"]'); await page.waitForTimeout(300);
await page.click('#poolsw [data-pool="junior"]'); await page.waitForTimeout(400);
st = await state(page);
ok(st.settings.pool === 'junior', 'the roster is saved in the state');
const poolOfId = id => { const p = st.staff.find(x => x.id === id); const t = p.tags || []; return p.pool || (t.includes('jpool') ? 'junior' : t.includes('spool') ? 'senior' : (st.groups.find(g => g.id === p.group) || {}).kind === 'junior' ? 'junior' : 'senior'); };
const gridIds = () => page.$$eval('.nm-btn', els => els.map(e => e.dataset.p));
let ids = await gridIds();
ok(ids.length > 5 && ids.every(id => poolOfId(id) === 'junior'), 'Junior: only the junior roster on the grid');
// the other roster: greyed rows, view only
await page.click('[data-k="other"]'); await page.waitForTimeout(400);
ok((await page.locator('tbody tr.ro').count()) > 3 && (await page.locator('tbody tr.ro .cell').count()) === 0, 'Senior roster button: greyed rows with nothing to edit');
ok((await gridIds()).length === ids.length, 'the editable rows are still the junior roster');
await axe(page, 'grid with the other roster');
await shot(page, 'other-roster');
await page.click('[data-k="other"]'); await page.waitForTimeout(300);
ok((await page.locator('tbody tr.ro').count()) === 0, 'hidden again');
// each roster locks its own month
await page.click('#lockm'); await page.waitForTimeout(300);
st = await state(page);
let mk = Object.keys(st.months || {}).find(m => st.months[m].locks && st.months[m].locks.junior);
ok(mk && !st.months[mk].locks.senior, 'the padlock locks the junior roster only');
await page.click('#poolsw [data-pool="senior"]'); await page.waitForTimeout(400);
ok((await page.locator('#poolsw [data-pool="senior"]').getAttribute('aria-pressed')) === 'true', 'Senior pressed');
ok((await page.locator('#lockm').getAttribute('aria-pressed')) === 'false', 'the senior roster is still open');
ids = await gridIds();
ok(ids.length > 3 && ids.every(id => poolOfId(id) === 'senior'), 'Senior: only the senior roster on the grid');
await page.click('#poolsw [data-pool="junior"]'); await page.waitForTimeout(400);
ok((await page.locator('#lockm').getAttribute('aria-pressed')) === 'true', 'back on Junior: still locked');
await page.click('#lockm'); await page.waitForTimeout(300);
void rows;

// Junior pool setup: choose the first person of the pool, set a call level, the junior rules arrive
await page.goto(`${BASE}?demo#people?s=pool`);
await page.waitForSelector('#jp-start', { timeout: 10000 });
await axe(page, 'junior pool setup');
const firstJunior = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('ntf-roster-demo')); const g = new Map(s.groups.map(x => [x.id, x.kind])); const p = s.staff.find(x => g.get(x.group) === 'junior'); return p && p.id; });
ok(!!firstJunior, 'the practice department has juniors');
await page.selectOption('#jp-start', firstJunior);
await page.click('button:has-text("Set")');
await page.waitForTimeout(400);
const selects = page.locator('.jp-row select');
ok((await selects.count()) >= 2, 'level and strength selects shown');
await selects.nth(0).selectOption('mo2');
await page.waitForTimeout(400);
st = await state(page);
ok(st.settings.jpRules === 1, 'junior rules installed with the first call level');
ok(st.rules.some(r => r.id === 'r-jp-weak'), 'weak/weak rule present');
ok(st.staff.some(p => (p.tags || []).includes('mo2')), 'level tag saved');
await shot(page, 'junior-pool');

// Rules: no To confirm tags, the Priorities sheet (bars, bulk change), add a request
await page.goto(`${BASE}?demo#rules`);
await page.waitForSelector('.rv-card', { timeout: 10000 });
ok((await page.locator('.bx-badge:has-text("To confirm")').count()) === 0, 'no To confirm badges');
await axe(page, 'rules with junior rules');
await page.click('[data-k="priorities"]');
await page.waitForSelector('.rq-row', { timeout: 5000 });
ok((await page.locator('.rq-range').count()) >= 3 && (await page.locator('.rq-fill.hard').count()) >= 3, 'bars for preferences and must-hold rules');
await axe(page, 'rule priorities');
await shot(page, 'rule-priorities');
// drag the fourth preference to the top by its grip, then move it back down one with the keyboard
const prefIds = () => page.$$eval('.rq-list[data-hard="0"] > li[data-id]', els => els.map(e => e.dataset.id));
let before = await prefIds();
const last = before[3];
await page.locator('.rq-list[data-hard="0"]').scrollIntoViewIfNeeded();
const gb = await page.locator(`li[data-id="${last}"] .rq-grip`).boundingBox();
const tb = await page.locator('.rq-list[data-hard="0"] > li[data-id]').first().boundingBox();
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
await page.mouse.down();
await page.mouse.move(gb.x + gb.width / 2, tb.y + 4, { steps: 12 });
await page.waitForTimeout(150);
await page.mouse.up();
await page.waitForTimeout(300);
let after = await prefIds();
ok(after[0] === last, 'dragged rule is now first');
st = await state(page);
const top = st.rules.find(r => r.id === last), second = st.rules.find(r => r.id === after[1]);
ok(top.weight >= second.weight, 'its priority is now at least the next one');
await page.locator(`li[data-id="${last}"] .rq-grip`).focus();
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(300);
ok((await prefIds())[1] === last, 'arrow key moves it down one');
ok(await page.evaluate(id => document.activeElement === document.querySelector(`li[data-id="${id}"] .rq-grip`), last), 'focus stays on its grip');
await page.click('button:has-text("Select preferences")');
await page.selectOption('.rq-bar select', '80');
await page.waitForTimeout(300);
st = await state(page);
ok(st.rules.filter(r => !r.hard && r.pool === 'junior').every(r => r.weight === 80), 'every junior preference set to 80 at once');
const seniorWeights = JSON.stringify(st.rules.filter(r => r.pool === 'senior').map(r => r.weight));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
// each roster has its own rules: Junior shows only the junior roster's, in the list and in Priorities
ok(st.rules.every(r => r.pool === 'junior' || r.pool === 'senior'), 'every rule has a roster');
ok(st.rules.some(r => r.id === 'r-gap') && st.rules.some(r => r.id === 'r-gap-s'), 'a rule about everyone is one per roster');
await page.click('#poolsw [data-pool="junior"]'); await page.waitForTimeout(400);
let shown = await page.$$eval('.rv-card[data-rule]', els => els.map(e => e.dataset.rule));
ok(shown.length > 5 && shown.every(id => st.rules.find(r => r.id === id).pool === 'junior'), 'Junior: only the junior roster\'s rules');
ok(/junior roster's rules/.test(await page.locator('.rv-pool').textContent()), 'says whose rules');
await page.click('[data-k="priorities"]');
await page.waitForSelector('.rq-row', { timeout: 5000 });
shown = await page.$$eval('.rq-row[data-id]', els => els.map(e => e.dataset.id));
ok(shown.length > 5 && shown.every(id => st.rules.find(r => r.id === id).pool === 'junior'), 'Priorities: only the junior roster\'s rules');
await page.click('button:has-text("Select all")');
await page.selectOption('.rq-bar select', '40');
await page.waitForTimeout(300);
st = await state(page);
ok(JSON.stringify(st.rules.filter(r => r.pool === 'senior').map(r => r.weight)) === seniorWeights, 'a bulk change in Junior leaves the senior rules alone');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.click('#poolsw [data-pool="senior"]'); await page.waitForTimeout(400);
shown = await page.$$eval('.rv-card[data-rule]', els => els.map(e => e.dataset.rule));
ok(shown.length > 3 && shown.every(id => st.rules.find(r => r.id === id).pool === 'senior'), 'Senior: only the senior roster\'s rules');
await page.click('#poolsw [data-pool="junior"]'); await page.waitForTimeout(400);
await page.click('button:has-text("Add a request")');
await page.waitForSelector('#rq-who', { timeout: 5000 });
await axe(page, 'request form');
await page.fill('#rq-from', '2026-11-10'); await page.fill('#rq-to', '2026-11-15');
await page.click('button:has-text("Add request")');
await page.waitForTimeout(400);
st = await state(page);
ok(st.rules.some(r => /^Request:/.test(r.name) && r.when.from === '2026-11-10'), 'request became a rule');

// Check: APS weeks and leave dates
await page.goto(`${BASE}?demo#check?v=aps`);
await page.waitForSelector('.aps-week, .bx-none', { timeout: 10000 });
ok((await page.locator('.aps-week').count()) >= 4, 'weeks shown');
await axe(page, 'APS weeks');
const assign = page.locator('button:has-text("Assign these weeks")');
if (await assign.count()) { await assign.click(); await page.waitForTimeout(400); st = await state(page); ok(Object.values(st.cells).some(d => Object.values(d).some(c => (c.a || []).includes('APS'))), 'APS weeks written'); }
await page.goto(`${BASE}?demo#check?v=leave`);
await page.waitForSelector('.cv-panel', { timeout: 10000 });
await axe(page, 'leave dates');

// request priority: the sheet lists Cr / Nc by person; selecting two and pressing Must marks them !
await page.goto(`${BASE}?demo#check`);
await page.waitForSelector('[data-k="reqprio"]', { timeout: 10000 });
await page.click('[data-k="reqprio"]');
await page.waitForSelector('button.rp-chip', { timeout: 5000 });
await axe(page, 'request priority');
await page.locator('button.rp-chip').nth(0).click();
await page.locator('button.rp-chip').nth(1).click();
await page.click('.rp-bar .btn-primary');
await page.waitForTimeout(300);
st = await state(page);
ok(Object.values(st.cells).flatMap(d => Object.values(d)).filter(c => c.rp && Object.values(c.rp).includes('!')).length >= 1, 'Must marks the selected requests !');
await page.keyboard.press('Escape');

// phone: switch and setup fit without sideways scroll
const phone = await open({ width: 390, height: 800 });
await phone.goto(`${BASE}?demo#roster`);
await phone.waitForSelector('#poolsw .pool-btn', { timeout: 15000 });
await shot(phone, 'phone-roster');
await phone.goto(`${BASE}?demo#people?s=pool`);
await phone.waitForSelector('#jp-start', { timeout: 10000 });
for (const [hash, label] of [['#people?s=pool', 'pool setup'], ['#check?v=aps', 'aps'], ['#rules', 'rules']]) {
  await phone.goto(`${BASE}?demo${hash}`);
  await phone.waitForTimeout(900);
  const w = await phone.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  ok(w[0] <= w[1] + 1, `${label}: no sideways scroll on a phone (${w[0]} > ${w[1]})`);
  await shot(phone, `phone-${label.replace(/ /g, '-')}`);
}
// Auto-fill: choose the codes, free APS weeks offered, applies itself; the last month seen comes back
{
  const pg = await open({ width: 1300, height: 900 });
  await pg.goto(`${BASE}?demo#roster`);
  await pg.waitForSelector('#nextm', { timeout: 15000 });
  await pg.click('#nextm'); await pg.waitForTimeout(400);
  const month = await pg.evaluate(() => window.ntfApp.month);
  await pg.goto(`${BASE}?demo#roster`); await pg.waitForSelector('#nextm', { timeout: 15000 });
  ok(await pg.evaluate(() => window.ntfApp.month) === month, 'the roster opens on the last month seen on this device');
  await pg.click('#autofill'); await pg.waitForSelector('.af');
  ok((await pg.locator('.af input[type=checkbox][id^="af-c-"]').count()) >= 2, 'Auto-fill lists the codes to fill');
  ok((await pg.locator('#af-auto').isChecked()), 'Apply when done is on by default');
  await pg.click('label[for="af-c-P"]');   // leave the PM shifts out
  await pg.click('.af-actions .btn-primary:has-text("Start")');
  await pg.waitForFunction(() => !document.querySelector('.af'), null, { timeout: 30000 }).catch(() => {});
  const cells = await pg.evaluate((m) => { const st = window.ntfApp.store.get(); const k = {}; for (const [d, day] of Object.entries(st.cells)) if (d.startsWith(m)) for (const c of Object.values(day)) for (const x of (c.auto || [])) k[x] = (k[x] || 0) + 1; return k; }, month);
  ok(!cells.P, `PM shifts were left out (${JSON.stringify(cells)})`);
  await pg.context().close();
}
// Rules: paste a rule (as Claude might send it), review it, add it; priorities: select by type, save, clear
{
  const pg = await open({ width: 1300, height: 900 });
  await pg.goto(`${BASE}?demo#rules`);
  await pg.waitForSelector('.rv-tools [data-k="paste"]', { timeout: 15000 });
  const before = await pg.evaluate(() => window.ntfApp.store.get().rules.length);
  await pg.click('.rv-tools [data-k="paste"]');
  await pg.fill('.ri-text', 'Sure!\n```json\n{"rules":[{"id":"r-e2e-paste","type":"limit","name":"Max 2 calls","hard":false,"weight":40,"params":{"codes":["C"],"period":"month","max":2}},{"id":"r-e2e-bad","type":"limit","params":{"codes":["ZZZ"],"period":"month","max":2}}]}\n```');
  await pg.click('.sheet-foot .btn-primary:has-text("Review")');
  await pg.waitForSelector('.ri-list');
  ok((await pg.locator('.ri-list li').count()) === 2, 'the review lists both pasted rules: ' + (await pg.textContent('.ri')));
  ok(/Needs fixing/.test(await pg.textContent('.ri-list')) && /ZZZ/.test(await pg.textContent('.ri-list')), 'the bad code is named in words');
  ok(/flag/.test(await pg.textContent('.ri-list')), 'a dry run says what the rule would flag');
  await pg.click('.sheet-foot .btn-primary:has-text("Import")');
  await pg.waitForTimeout(300);
  const ids = await pg.evaluate(() => window.ntfApp.store.get().rules.map(r => r.id));
  ok(ids.includes('r-e2e-paste') && !ids.includes('r-e2e-bad') && ids.length === before + 1, 'only the good rule was added');
  await pg.click('.rv-tools [data-k="priorities"]');
  await pg.waitForSelector('.rq-sets');
  await pg.selectOption('[data-k="bytype"]', 'limit');
  ok((await pg.locator('.rq-row.sel').count()) >= 2, 'select by type picks every rule of that type');
  await pg.fill('.rq-name-in', 'limits');
  await pg.click('[data-k="saveset"]');
  await pg.click('[data-k="clear"]');
  ok((await pg.locator('.rq-row.sel').count()) === 0, 'clear selection empties it');
  await pg.selectOption('[data-k="sets"]', 'limits');
  ok((await pg.locator('.rq-row.sel').count()) >= 2, 'a saved selection comes back');
  await pg.context().close();
}
await b.close();
ok(!errors.length, 'no page errors: ' + errors.join(' | '));
console.log(`ntf-roster pool e2e: ${checks} checks passed`);
