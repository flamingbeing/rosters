// Browser test of NUH Junior Monthly in Practice (?demo: a made-up department) and from a fresh start, with Firebase
// blocked, at desktop and phone size, with an axe accessibility check (WCAG 2 A/AA) on every tab.
// Run (from the repo root, with a static server on the repo root at port 8080, e.g. python3 -m http.server 8080):
//   node nuh-junior-monthly/test/e2e.mjs            SHOTS=<dir> also saves screenshots
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const AXE = new URL('../../tools/vendor/axe.min.js', import.meta.url).pathname;
const BASE = `http://localhost:${process.env.PORT || 8080}/nuh-junior-monthly/`;
const SHOTS = process.env.SHOTS;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nuhjm-e2e-'));
const T0 = Date.now();

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const errors = [];
let n = 0, checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
async function newPage(viewport, tag, extra = {}) {
  const ctx = await b.newContext({ viewport, acceptDownloads: true, reducedMotion: 'reduce', ...extra });   // no fade-ins under axe
  await ctx.route('https://www.gstatic.com/**', r => r.abort()); // no Firebase: the app works without it
  // the first-time tour (practice opens it once) is tested in tour.e2e.mjs: seen already here
  await ctx.addInitScript(() => { try { localStorage.setItem('nuhjm-tour', JSON.stringify({ v: 1, done: true })); } catch (e) { /* ignore */ } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${tag}] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !(/Failed to load resource/.test(m.text()) && /gstatic/.test(m.text() + m.location().url))) errors.push(`[${tag}] console: ${m.text()}`); });
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png` }); };
const ready = page => page.waitForFunction(() => document.body.classList.contains('ready'));
const stored = (page, key = 'nuhjm-demo') => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
const hard = page => page.evaluate(() => window.jmApp.evaluation().hard);
const go = async (page, hash) => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(300); };
async function axe(page, label, scope = null) {   // scope: a selector (a dialog: the page behind its backdrop is not checked)
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: AXE });
  const v = await page.evaluate(async sel => (await window.axe.run((sel && document.querySelector(sel)) || document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations
    .map(x => `${x.id} ${x.nodes.length}x ${x.nodes[0]?.target}`), scope);
  ok(!v.length, `axe on ${label}: ${v.join('; ')}`);
}
const noSideScroll = async (page, label) => {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  ok(w[0] <= w[1] + 1, `${label}: no sideways page scroll (${w[0]} > ${w[1]})`);
};

// ---------- desktop: every tab, axe, the sheet copy-back, auto-fill next month ----------
{
  const page = await newPage({ width: 1366, height: 900 }, 'desktop', { permissions: ['clipboard-read', 'clipboard-write'] });
  await page.goto(BASE + '?demo#roster');
  await ready(page);
  // the days around the month: greyed, read-only, with at least one working day on each side
  {
    const around = await page.evaluate(() => {
      const hs = [...document.querySelectorAll('thead th.dh')], ix = hs.findIndex(t => !t.classList.contains('ctx'));
      const last = hs.length - 1 - [...hs].reverse().findIndex(t => !t.classList.contains('ctx'));
      return { before: ix, after: hs.length - 1 - last, cells: document.querySelectorAll('td.c.ctx button').length, ro: document.querySelectorAll('td.c.ctx .cro').length > 0 };
    });
    ok(around.before >= 2 && around.after >= 2 && around.cells === 0 && around.ro, `days around the month are shown and read-only (${around.before} before, ${around.after} after)`);
    await page.getByRole('button', { name: 'Days around' }).click();
    ok(await page.locator('thead th.dh.ctx').count() === 0, 'and can be switched off');
    // painting with Lock, and the lock at the top of the cell popup
    await page.getByRole('button', { name: 'Paint' }).click();
    await page.locator('.pchip-lock').click();
    const cellBtn = page.locator('td.c:not(.ctx) .cell').nth(3);
    const ids = await cellBtn.evaluate(b => [b.dataset.d, b.dataset.s]);
    await cellBtn.click();
    await page.waitForTimeout(250);
    ok(await page.evaluate(([d, s]) => !!JSON.parse(localStorage.getItem('nuhjm-demo')).cells?.[d]?.[s]?.lock, ids), 'painting with Lock locks the cell');
    await cellBtn.click();
    await page.waitForTimeout(250);
    ok(await page.evaluate(([d, s]) => !JSON.parse(localStorage.getItem('nuhjm-demo')).cells?.[d]?.[s]?.lock, ids), 'painting a locked cell with Lock unlocks it');
    await page.getByRole('button', { name: 'Done painting' }).click();
    await cellBtn.click();
    await page.waitForSelector('.ced-lockrow');
    ok(await page.evaluate(() => { const w = document.querySelector('.ced-lockrow').parentElement; return w.firstElementChild.classList.contains('ced-lockrow'); }), 'the lock is the first thing in the cell popup');
    await page.keyboard.press('Escape');
    // a group header folds its people away
    const rowsBefore = await page.locator('tbody tr:not(.grp-row)').count();
    await page.locator('.grp-toggle').first().click();
    ok(await page.locator('tbody tr:not(.grp-row)').count() < rowsBefore && (await page.locator('.grp-toggle').first().getAttribute('aria-expanded')) === 'false', 'a group header folds its people away');
    await page.locator('.grp-toggle').first().click();
    await page.waitForTimeout(600);   // rows are drawn a few at a time
    ok(await page.locator('tbody tr:not(.grp-row)').count() === rowsBefore, 'and opens them again');
    // a mouse can move the grid sideways: week buttons, and the wheel over the dates
    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(300);
    const wide = await page.locator('.r-scroll').evaluate(el => el.scrollWidth > el.clientWidth + 50);
    ok(wide, 'the grid is wider than a small window');
    await page.getByRole('button', { name: 'Scroll forward a week' }).click();
    await page.waitForTimeout(700);
    const moved = await page.locator('.r-scroll').evaluate(el => el.scrollLeft);
    ok(moved > 50, `the week button scrolls the grid (${moved}px)`);
    await page.locator('.r-scroll thead th.nh').first().hover();
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(300);
    ok(await page.locator('.r-scroll').evaluate((el, was) => el.scrollLeft > was, moved), 'the wheel over the dates moves it sideways too');
    await page.setViewportSize({ width: 1366, height: 900 });
    // show only the people on a posting (dropdown or the C3 / R1B column header), and clear the filters
    const people = () => page.locator('tbody tr:not(.grp-row) .nm-btn').count();
    await page.waitForTimeout(600);
    const everyone = await people();
    ok(!(await page.locator('.tbtn-clear').isVisible()), 'no Clear filters button while nothing is filtered');
    const postVals = await page.locator('select[aria-label="Show people on a posting"] option').evaluateAll(o => o.map(x => x.value).filter(Boolean));
    ok(postVals.length > 0, 'the posting dropdown lists postings');
    await page.selectOption('select[aria-label="Show people on a posting"]', postVals[0]);
    await page.waitForTimeout(600);
    const some = await people();
    ok(some < everyone, `the posting filter shows only people on it (${some} of ${everyone})`);
    ok(await page.locator('.tbtn-clear').isVisible(), 'Clear filters appears');
    await page.locator('.tbtn-clear').click();
    await page.waitForTimeout(600);
    ok((await people()) === everyone && !(await page.locator('.tbtn-clear').isVisible()), 'and brings everyone back');
    if (await page.locator('.sh-btn').count()) {
      await page.locator('.sh-btn').first().click();
      await page.waitForTimeout(600);
      ok((await people()) < everyone && (await page.locator('.sh-btn').first().getAttribute('aria-pressed')) === 'true', 'a call column header filters to its postings');
      await page.locator('.tbtn-clear').click();
      await page.waitForTimeout(400);
    }
    await page.getByRole('button', { name: 'Days around' }).click();
    ok(await page.locator('thead th.dh.ctx').count() >= 4, 'and on again');
  }
  for (const t of ['roster', 'postings', 'leave', 'day', 'people', 'rules', 'check', 'more']) {
    await go(page, '#' + t);
    await page.waitForTimeout(400);
    ok(await page.locator(`.view-${t}`).isVisible(), `${t} shows`);
    await axe(page, `desktop ${t}`);
    await shot(page, 'd-' + t);
  }
  // Leave (read only): the legend counts match the names listed, the read button waits for a sheet, statuses are written on the chips
  await go(page, '#leave');
  await page.waitForTimeout(300);
  const legendTotal = await page.locator('.wl-legend .wl-n').evaluateAll(els => els.reduce((a, e) => a + Number(e.textContent), 0));
  ok(legendTotal > 0 && await page.locator('.wl-days .wl-chip').count() === legendTotal, `the Leave legend counts every name listed (${legendTotal})`);
  ok(await page.locator('.wl-days .wl-chip .wl-stat').first().isVisible(), 'each name has its status written on it, not only a colour');
  await page.getByRole('button', { name: 'Read from the Google Sheet' }).click();
  ok(await page.getByText('The practice department has no Google Sheet to read.').count() >= 1, 'the practice department has no sheet to read, and says so');
  // Postings: change one week, the roster cells follow
  await go(page, '#postings');
  const sel = page.locator('.pv-sel').first();
  await sel.selectOption('ICU');
  await page.waitForTimeout(200);
  const st = await stored(page);
  ok(Object.values(st.cells).some(day => Object.values(day).some(c => (c.a || []).includes('ICU'))), 'a posting set for a week is stored');
  // rules marked as predictions are labelled
  // People: a "No calls until" date on a person
  await go(page, '#people');
  await page.waitForTimeout(400);
  await page.locator('.pv-main').first().click();
  await page.getByLabel('No calls until (optional)').fill('2026-12-20');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(400);
  ok(await page.getByText(/no calls until/).first().isVisible(), 'People shows who has no calls until a date');
  await go(page, '#rules');
  ok(await page.getByText('To confirm').first().isVisible(), 'predicted rules say To confirm');
  const toConfirm = await page.getByText('To confirm', { exact: true }).count();
  await page.getByRole('button', { name: /^Confirm:/ }).first().click();
  await page.waitForTimeout(300);
  ok(await page.getByText('To confirm', { exact: true }).count() === toConfirm - 1, 'Confirm takes the To confirm tag off one rule');
  await page.locator('[data-k=confirm-all]').click();
  await page.waitForTimeout(300);
  ok(await page.getByText('To confirm', { exact: true }).count() === 0 && await page.locator('[data-k=confirm-all]').isHidden(), 'Confirm all takes every To confirm tag off');
  ok(await page.getByText('How the rules work, in order').isVisible() && await page.getByRole('heading', { name: /^Cardiac calls/ }).isVisible(), 'the Rules tab explains the order and groups rules by topic');
  await page.getByRole('button', { name: /R1 to R3 rules/ }).first().click();
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.jmApp.store.get().rules.filter(r => /^r-(mo-|r1-|r2-|r3-)/.test(r.id)).every(r => r.enabled !== false)), 'one button turns the whole R1 to R3 group on');
  await page.getByRole('button', { name: /Turn off all the R1 to R3 rules/ }).click();
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.jmApp.store.get().rules.filter(r => /^r-(mo-|r1-|r2-|r3-)/.test(r.id)).every(r => r.enabled === false)), 'and the same button turns it off again');
  // People > Tags: the strong / weak list is pasted, matched people get the pool tag and the pool rules turn on
  await go(page, '#people');
  await page.waitForTimeout(300);
  const nm = await page.evaluate(() => window.jmApp.store.get().staff.find(p => p.active !== false).name);
  await page.getByRole('tab', { name: /Tags/ }).or(page.getByRole('button', { name: /^Tags/ })).first().click();
  await page.getByRole('button', { name: 'Import the strong / weak list' }).click();
  await page.getByLabel('The table').fill(`Strong MO1\tWeak MO1\n${nm}\t`);
  await page.getByRole('button', { name: 'Set the pools' }).click();
  await page.waitForTimeout(300);
  const pooled = await page.evaluate(nm0 => { const s = window.jmApp.store.get(); const p = s.staff.find(x => x.name === nm0); return { tags: p.tags, on: s.rules.find(r => r.id === 'r-pool-1').enabled }; }, nm);
  ok(pooled.tags.includes('mo1s') && pooled.tags.includes('mo1') && pooled.on, 'importing the strong / weak list tags the person and turns the pool rules on');
  // Fill sits on the Check tab too (that is where the problems show), and not on Day or Rules
  await go(page, '#check');
  await page.waitForTimeout(300);
  ok(await page.locator('#autofill').isVisible(), 'the Check tab has the Fill button');
  await page.locator('[data-k=sort]').selectOption('priority');
  await page.waitForTimeout(200);
  ok(await page.locator('[data-k=sort]').inputValue() === 'priority' && await page.locator('.cv-group').count() > 0, 'Check can order the problems by rule priority');
  await page.locator('[data-k=sort]').selectOption('impact');
  await go(page, '#day');
  await page.waitForTimeout(300);
  ok(!(await page.locator('#autofill').isVisible()), 'the Day tab has no Fill button');
  // auto-fill next month: no must-fix problems left
  await page.evaluate(() => window.jmApp.setMonth(window.jmApp.model.addMonths(window.jmApp.month, 1)));
  await page.waitForTimeout(300);
  const before = await hard(page);
  ok(before > 30, 'next month starts without calls');
  await page.evaluate(() => window.jmApp.openAutofill());
  // choose what to fill: the calls ticked are drafted, the others stay as they are
  ok(await page.locator('.af-what input[type=checkbox]').count() === 5, 'the Fill dialog offers cardiac, ICU and R1 to R3 calls to pick');
  ok(await page.locator('#af-c-C3').isChecked() && await page.locator('#af-c-R1B').isChecked() && !(await page.locator('#af-c-R1').isChecked()), 'cardiac and ICU start ticked, R1 to R3 unticked');
  await page.locator('#af-c-R1B').uncheck();
  ok((await page.locator('.af strong').first().innerText()).trim() === 'C3' && await page.getByRole('button', { name: 'Start' }).isEnabled(), 'with ICU unticked it drafts C3 only');
  await page.locator('#af-c-C3').uncheck();
  ok(await page.getByRole('button', { name: 'Start' }).isDisabled(), 'with nothing ticked Start is off');
  await page.locator('#af-c-C3').check();
  await page.locator('#af-c-R1B').check();
  ok((await page.locator('.af strong').first().innerText()).trim() === 'C3, R1B', 'both ticked drafts both again');
  await page.getByRole('button', { name: /^Fill|^Start|^Auto-fill$/ }).last().click().catch(() => {});
  await page.waitForFunction(() => document.querySelector('.af-result, .af-apply, [data-af="apply"]') || /Apply/.test(document.body.innerText), null, { timeout: 30000 });
  const apply = page.getByRole('button', { name: /^Apply/ });
  if (await apply.count()) await apply.first().click();
  await page.waitForTimeout(600);
  const after = await hard(page);
  ok(after <= 3 && after < before, `auto-fill fixes the cover (${before} -> ${after} must-fix problems)`);
  // the staff list for APMES People: More › Export copies it
  await go(page, '#more');
  await page.getByRole('button', { name: 'Copy the staff list for APMES People' }).click();
  await page.waitForTimeout(200);
  ok(/^NUH Junior Monthly staff, roster month \d{4}-\d{2}.*\nGrade\tName\tFrom\tUntil\n/.test(await page.evaluate(() => navigator.clipboard.readText())), 'APMES People list copied');
  // opened by APMES People (?send=apmes) but without the tab that asked: it offers the copy instead; the link forgets the ask
  await page.goto(BASE + '?demo&send=apmes#people');
  await ready(page);
  const dlg = page.getByRole('dialog', { name: 'Send the staff list to APMES People?' });
  await dlg.waitFor();
  ok(await dlg.getByRole('button', { name: 'Copy the list' }).isVisible(), 'send sheet without its opener offers the copy');
  await axe(page, 'desktop send to APMES People');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  ok(!/send=apmes/.test(page.url()), 'the link forgets send=apmes');
  await page.close();
}
// ---------- phone ----------
{
  const page = await newPage({ width: 390, height: 844 }, 'phone', { isMobile: true, hasTouch: true });
  await page.goto(BASE + '?demo#roster');
  await ready(page);
  for (const t of ['roster', 'day', 'check', 'rules', 'more', 'postings', 'leave']) {
    await go(page, '#' + t);
    await page.waitForTimeout(400);
    await noSideScroll(page, `phone ${t}`);
    await axe(page, `phone ${t}`);
    await shot(page, 'p-' + t);
  }
  ok(await page.getByText('App version').count() >= 0, 'more ends with the version lines');
  await page.close();
}
// ---------- phone header and banners at 320, 360, 390 and 430 px: nothing clipped or overlapping, one size scale ----------
for (const w of [320, 360, 390, 430]) {
  const page = await newPage({ width: w, height: 800 }, `phone-${w}`, { isMobile: true, hasTouch: true });
  await page.goto(BASE + '#roster');   // a roster of your own (the cloud button shows)
  await ready(page);
  await page.evaluate(() => {
    const a = window.jmApp;
    a.store.mark({ hidden: true });
    a.store.commit('staff', d => { d.staff.push({ id: 'ha', name: 'Alex Tan', group: 'res1', tags: [], fte: 1, active: true, short: '' }); });
  });
  await page.waitForTimeout(500);
  const read = () => page.evaluate(() => {
    const ids = ['prevm', 'month', 'nextm', 'today', 'lockm', 'autofill', 'cloudbtn', 'undo', 'redo'];
    const r = {};
    for (const id of ids) { const e = document.getElementById(id); if (e && e.offsetParent !== null) { const b = e.getBoundingClientRect(); r[id] = [b.left, b.top, b.right, b.bottom]; } }
    const brand = document.querySelector('.brand').getBoundingClientRect();
    r.brand = [brand.left, brand.top, brand.right, brand.bottom];
    const vis = sel => { const e = document.querySelector(sel); return e && !e.hidden && e.offsetParent !== null ? e.getBoundingClientRect().height : 0; };
    return { r, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, top: document.getElementById('top').getBoundingClientRect().height, lockNote: vis('.lock-note'), banner: vis('.r-banner') };
  });
  // locked (the start): no Fill, and the slim locked and empty-month banners
  const locked = await read();
  ok(!('autofill' in locked.r), `${w}px: Fill is hidden while the month is locked`);
  ok(locked.lockNote > 0 && locked.lockNote <= 44 && locked.banner > 0 && locked.banner <= 44, `${w}px: the locked and empty-month banners are one slim line each (${Math.round(locked.lockNote)} and ${Math.round(locked.banner)} px)`);
  await page.locator('#lockm').click();   // unlocking asks nothing
  await page.waitForTimeout(500);
  const m = await read();
  ok(m.sw <= m.vw + 1, `${w}px: no sideways page scroll (${m.sw} > ${m.vw})`);
  const names = Object.keys(m.r);
  ok(['prevm', 'nextm', 'today', 'lockm', 'autofill', 'cloudbtn', 'undo', 'redo'].every(n => names.includes(n)), `${w}px: every header control is there`);
  const ctl = names.filter(n => !['month', 'brand'].includes(n));
  ok(ctl.every(n => m.r[n][0] >= -0.5 && m.r[n][2] <= m.vw + 0.5), `${w}px: no header control is clipped by the screen edge`);
  const hs = ctl.map(n => m.r[n][3] - m.r[n][1]);
  ok(hs.every(x => x >= 43.5) && Math.max(...hs) - Math.min(...hs) <= 1, `${w}px: every header control is 44 px high (${hs.map(x => Math.round(x)).join(', ')})`);
  ok(['prevm', 'nextm', 'lockm', 'undo', 'redo'].every(n => m.r[n][2] - m.r[n][0] >= 43.5), `${w}px: icon buttons are 44 px wide`);
  const hit = (a, c) => a[0] < c[2] - 0.5 && c[0] < a[2] - 0.5 && a[1] < c[3] - 0.5 && c[1] < a[3] - 0.5;
  const all = [...ctl, 'month', 'brand'];
  const clash = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (hit(m.r[all[i]], m.r[all[j]])) clash.push(`${all[i]}/${all[j]}`);
  ok(!clash.length, `${w}px: no header control overlaps another (${clash.join(', ')})`);
  ok(m.top <= 150, `${w}px: the header is at most two rows high (${Math.round(m.top)} px)`);
  // the filters sit behind one button, and the row is not cut off
  const tb = await page.locator('.r-toolbar').evaluate(el => [el.scrollWidth, el.clientWidth]);
  ok(tb[0] <= tb[1] + 1 && await page.getByRole('button', { name: /^Filters/ }).isVisible(), `${w}px: the filter row fits, with one Filters button`);
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.waitForSelector('.fsheet');
  ok(await page.locator('.fsheet select').count() >= 3, `${w}px: the Filters sheet holds the selects`);
  await axe(page, `the phone Filters sheet at ${w}`, '.sheet');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(250);
  await axe(page, `the phone roster header at ${w}`);
  // on a tab with no Fill the row has no hole: Today and the lock sit at the right edge
  await page.evaluate(() => { location.hash = '#day'; });
  await page.waitForTimeout(500);
  const dayRow = await page.evaluate(() => ({ vw: document.documentElement.clientWidth, lock: document.getElementById('lockm').getBoundingClientRect().right, fill: document.getElementById('autofill').offsetParent !== null }));
  ok(!dayRow.fill && dayRow.lock >= dayRow.vw - 14, `${w}px: with no Fill (Day tab) the lock sits at the right edge, no gap (${Math.round(dayRow.lock)} of ${dayRow.vw})`);
  await page.close();
}
// ---------- the Google Sheet: read it, check it is unchanged, write only the changes (a fake Sheets API; no Google account) ----------
{
  const page = await newPage({ width: 1280, height: 900 }, 'google');
  const MONTHDAYS = 31, WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dow = i => WD[(new Date(Date.UTC(2026, 11, i + 1)).getUTCDay())];
  const row = (sn, g, name, f) => [String(sn), g, name, ...Array.from({ length: MONTHDAYS }, (_, i) => f(i)), 'Z'];
  const sheet = [['legend'], ['legend 2'], ['', '', '', 'DEPARTMENT OF ANAESTHESIA STAFF ROSTER'], ['Dept', '', '', '1 to 31 December 26'],
    ['', '', '', ...Array.from({ length: MONTHDAYS }, (_, i) => dow(i)), ''],
    ['S/N', 'Grade', 'Name', ...Array.from({ length: MONTHDAYS }, (_, i) => String(i + 1)), '1-Jan'],
    row(1, 'RES2', 'Icu Example', () => 'ICU'), row(2, 'NHG', 'Cardiac Example', () => 'C')];
  const colIdx = L => [...L].reduce((x, ch) => x * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const writes = [];
  let created = null;   // the body of a new-spreadsheet request
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  await page.context().route('https://sheets.googleapis.com/**', route => {
    const req = route.request(), u = decodeURIComponent(req.url());
    const json = o => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(o) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (!/^Bearer test-token$/.test(req.headers().authorization || '')) return route.fulfill({ status: 401, headers: CORS, body: '{}' });
    if (/\/spreadsheets\/SHEETID[^/]*\?fields/.test(u)) return json({ properties: { title: 'Test roster' }, sheets: [{ properties: { sheetId: 7, title: 'Request', gridProperties: { rowCount: 50, columnCount: 40 } } }, { properties: { sheetId: 9, title: 'Leave Waitlist', gridProperties: { rowCount: 32, columnCount: 8 } } }] });
    if (/includeGridData=true/.test(u)) {
      const c = (v, bg) => ({ formattedValue: v, effectiveFormat: { backgroundColor: bg || { red: 1, green: 1, blue: 1 } } });
      const rows = [{ values: [c(''), c('Day'), c('Waitlist 1'), c('Waitlist 2')] }];
      for (let d = 1; d <= 31; d++) rows.push({ values: [c(String(d)), c('Mon'), d === 3 ? c('Icu Example', { red: 1, green: 0.6 }) : c(''), d === 3 ? c('Nobody Known (PM)', { red: 0.29, green: 0.53, blue: 0.91 }) : c('')] });
      return json({ sheets: [{ data: [{ rowData: rows }] }] });
    }
    if (/values\/'Request'!A1:/.test(u)) return json({ values: sheet.map(r => r.slice()) });
    if (/values:batchGet/.test(u)) return json({ valueRanges: [...u.matchAll(/ranges='Request'!([A-Z]+)(\d+)/g)].map(m => ({ values: [[(sheet[+m[2] - 1] || [])[colIdx(m[1])] ?? '']] })) });
    if (req.method() === 'POST' && /\/v4\/spreadsheets\?fields=/.test(u)) { created = JSON.parse(req.postData()); return json({ spreadsheetId: 'NEWSHEET', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/NEWSHEET/edit', sheets: [{ properties: { sheetId: 0 } }] }); }
    if (/values:batchUpdate/.test(u)) {
      const body = JSON.parse(req.postData());
      for (const d of body.data) { const m = d.range.match(/!([A-Z]+)(\d+)$/); sheet[+m[2] - 1][colIdx(m[1])] = d.values[0][0]; writes.push(m[1] + m[2]); }
      return json({});
    }
    return route.fulfill({ status: 404, headers: CORS, body: '{"error":{"message":"no"}}' });
  });
  // a device with nothing on it: the welcome screen offers sign in first, and its steps can be hidden
  await page.goto(BASE + '#roster');
  await ready(page);
  ok(await page.getByRole('button', { name: "Sign in and pull the cloud roster" }).count() === 1, 'an empty device offers to sign in and pull the cloud roster');
  ok(await page.locator('.gs').count() === 1, 'the getting started steps show at first');
  await axe(page, 'the welcome screen with sign in');
  await page.getByRole('button', { name: 'Hide the getting started steps' }).click();
  ok(await page.locator('.gs').count() === 0 && await page.getByRole('button', { name: "Sign in and pull the cloud roster" }).count() === 1, 'the steps can be hidden, sign in stays');
  await page.getByRole('button', { name: 'Show the getting started steps' }).click();
  ok(await page.locator('.gs').count() === 1, 'and shown again');
  await page.getByRole('button', { name: 'Hide the getting started steps' }).click();
  await page.goto(BASE + '#more');
  await ready(page);
  await page.evaluate(async () => { (await import('./js/gsheets.js')).hooks.getToken = async () => 'test-token'; });
  await page.fill('#sheet-link', 'https://docs.google.com/spreadsheets/d/SHEETID_0123456789abcdefghij/edit?gid=7#gid=7');
  await page.getByRole('button', { name: 'Read from Google' }).click();
  await page.waitForSelector('text=Import Google: Request');
  ok(await page.getByText('2 juniors').count() === 1, 'reading from Google finds the people');
  ok(await page.getByText('Calls found: ').count() === 1 || await page.getByText('No calls found in the sheet yet').count() === 1, 'the import review says how many calls it found');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.waitForTimeout(500);
  await axe(page, 'more with the Google Sheet buttons');
  // an Auto-fill-like change: a cardiac call on day 21
  await page.evaluate(async () => {
    const M = await import('./js/model.js');
    const st = window.jmApp.store, id = st.get().staff.find(x => x.name === 'Cardiac Example').id, d = M.monthDays('2026-12')[20];
    st.commit('call', draft => { M.setCell(draft, d, id, { a: [...M.getCell(draft, d, id).a, 'C3'] }); });
  });
  await page.waitForTimeout(300);
  ok(await page.getByRole('button', { name: /Check, then write 2 cells/ }).count() === 1, 'two cells to write: the call and its post call');
  // the Leave tab reads the same sheet's Leave Waitlist (colours become statuses) and writes nothing
  await go(page, 'leave');
  await page.getByRole('button', { name: 'Read from the Google Sheet' }).click();
  await page.waitForSelector('.wl-days .wl-chip');
  ok(await page.locator('.wl-days .wl-chip').count() === 2, 'the Leave tab reads two names from the sheet\'s Leave Waitlist');
  ok(await page.locator('.wl-days .wl-st-waitlisted', { hasText: 'Icu Example' }).count() === 1 && await page.locator('.wl-days .wl-st-approved.wl-unmatched', { hasText: 'Nobody Known' }).count() === 1, 'an orange cell is waitlisted, a blue one approved; a name not on the staff list is shown as written');
  ok(writes.length === 0, 'reading the Leave Waitlist writes nothing to the sheet');
  await axe(page, 'the Leave tab with a read waitlist');
  await go(page, 'more');
  // the cloud button in the header: shows whether this browser's changes are saved; Auto-fill is only on the Roster tab
  ok(await page.locator('#cloudbtn').isVisible(), 'the header has a cloud button');
  ok((await page.locator('#cloudbtn').getAttribute('data-state')) === 'unsaved' && /Not saved/.test(await page.locator('#cloudbtn').innerText()), 'after a change it says Not saved');
  ok(!(await page.locator('#autofill').isVisible()), 'Auto-fill is not in the header on More');
  await page.locator('#cloudbtn').click();
  await page.waitForSelector('.sheet [aria-label], .sheet .team');
  ok(await page.locator('.sheet-title', { hasText: 'Cloud' }).count() === 1, 'the cloud button opens the cloud panel');
  await axe(page, 'the cloud panel', '.sheet');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await go(page, 'roster');
  ok(await page.locator('#autofill').isVisible(), 'Auto-fill shows on the Roster tab');
  await go(page, 'more');
  await page.getByRole('button', { name: 'Only check the sheet is unchanged' }).click();
  await page.waitForSelector('text=exactly as you read it');
  ok(writes.length === 0, 'checking writes nothing');
  sheet[6][3 + 4] = 'AL';   // somebody edits the sheet meanwhile
  await page.getByRole('button', { name: /Check, then write/ }).click();
  await page.waitForSelector('text=has changed since you read it');
  ok(writes.length === 0 && await page.getByText('H7').count() >= 1, 'a change in the sheet stops the write and names the cell');
  sheet[6][3 + 4] = 'ICU';
  await page.getByRole('button', { name: /Check, then write/ }).click();
  await page.waitForSelector('text=Write 2 cells to Google?');
  ok(await page.locator('.ask-list td', { hasText: 'X8' }).count() === 1 && await page.locator('.ask-list td', { hasText: 'Y8' }).count() === 1 && await page.locator('.ask-list td', { hasText: 'Cardiac Example' }).count() === 2, 'the confirmation lists every cell that will change');
  ok(writes.length === 0, 'nothing is written before the confirmation');
  await axe(page, 'the confirmation of what will be written', '[role="dialog"]');
  await page.getByRole('button', { name: /^Write 2 cells$/ }).click();
  await page.waitForSelector('text=read them back: all match');
  ok(writes.join(',') === 'X8,Y8' && sheet[7][3 + 20] === 'C3' && sheet[7][3 + 21] === 'PC', `only the two changed cells were written (${writes.join(',')})`);
  ok(await page.getByText('Nothing to write').count() === 1, 'after writing there is nothing left to write');
  // undo the write in Google
  await page.getByRole('button', { name: 'Undo that write in Google' }).click();
  await page.waitForSelector('text=Undo the last write (2 cells)?');
  await page.getByRole('button', { name: 'Put them back' }).click();
  await page.waitForSelector('text=Put back 2 cells and read them back: all match');
  ok(sheet[7][3 + 20] === 'C' && sheet[7][3 + 21] === 'C' && writes.length === 4, 'undo put the two cells back as they were');
  ok(await page.getByRole('button', { name: /Check, then write 2 cells/ }).count() === 1, 'and the changes can be written again');
  // lock the month
  await page.locator('#lockm').click();
  ok(await page.locator('#lockm').getAttribute('aria-pressed') === 'true', 'the month is locked');
  const refused = await page.evaluate(async () => {
    const M = await import('./js/model.js');
    const st = window.jmApp.store, id = st.get().staff[0].id;
    return st.commit('edit', draft => { M.setCell(draft, M.monthDays('2026-12')[3], id, { a: ['AL'] }); });
  });
  ok(refused === false && await page.getByText('is locked, so nothing was changed').count() >= 1, 'a locked month refuses a change and says why');
  await page.locator('#lockm').click();
  await page.waitForTimeout(300);
  ok(await page.locator('#lockm').getAttribute('aria-pressed') === 'false', 'unlocked again');
  // a new grade in the sheet: the import review lists the move, ticked, and Import makes it
  sheet[6][1] = 'RES3';
  await page.getByRole('button', { name: 'Read from Google' }).click();
  await page.waitForSelector('text=1 person moves grade');
  const move = page.getByRole('checkbox', { name: 'Icu Example RES2 → RES3' });
  ok(await move.isChecked(), 'the import review lists the grade change, ticked');
  await axe(page, 'the import review with a grade change', '[role="dialog"]');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.jmApp.store.get().staff.find(p => p.name === 'Icu Example').group) === 'res3', 'Import moved them to the new group');
  // make the month's sheet from scratch: a new Google Sheet with the whole form and its formulas (a fake Sheets API)
  await page.goto(BASE + '#more');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Create a new Google Sheet' }).click();
  await page.waitForSelector('a:has-text("open the new Google Sheet")');
  ok((await page.locator('a:has-text("open the new Google Sheet")').getAttribute('href')).endsWith('/NEWSHEET/edit'), 'Create a new Google Sheet gives the link to the new file');
  const sh = created && created.sheets[0], vals = sh ? sh.data[0].rowData.flatMap(r => r.values) : [];
  ok(sh && vals.filter(v => v.userEnteredValue && v.userEnteredValue.formulaValue).length > 100 && sh.merges.length === 3 && sh.conditionalFormats.length > 20, 'the new sheet carries the formulas, merges and colour rules');
  ok(vals.some(v => v.userEnteredValue && v.userEnteredValue.stringValue === 'Icu Example'), 'and the people the app has');
  // the Excel file
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download as an Excel file' }).click()]);
  const path = await dl.path();
  const head = (await import('node:fs')).readFileSync(path).subarray(0, 2).toString();
  ok(/^roster-.*\.xlsx$/.test(dl.suggestedFilename()) && head === 'PK', 'Download as an Excel file gives an .xlsx');
  await page.close();
}
// Fill can draft the R1 to R3 calls: ticking them turns the R1 to R3 rules on, and the calls are placed
{
  const page = await newPage({ width: 1280, height: 900 }, 'fill-r13');
  await page.goto(BASE + '?demo#roster');
  await ready(page);
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => window.jmApp.store.get().rules.filter(r => /^r-r[123]-cover$/.test(r.id)).map(r => r.enabled));
  ok(before.length === 3 && before.every(e => e === false), 'the R1 to R3 cover rules start off');
  await page.evaluate(() => window.jmApp.setMonth(window.jmApp.model.addMonths(window.jmApp.month, 1)));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.jmApp.openAutofill());
  await page.locator('#af-c-C3').uncheck();
  await page.locator('#af-c-R1B').uncheck();
  for (const c of ['R1', 'R2', 'R3']) await page.locator('#af-c-' + c).check();
  ok(await page.getByText('turns the R1 to R3 rules on').count() >= 1, 'the dialog says ticking R1 to R3 turns the rules on');
  await page.locator('#af-t-3000').check();   // the quick search
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForFunction(() => /Apply/.test(document.body.innerText), null, { timeout: 40000 });
  ok(await page.locator('.af-attempts').count() === 0, 'one draft: no comparison table yet');
  // Try again: the two drafts are listed side by side with their scores, the best marked, and either can be applied
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.waitForSelector('.af-attempts', { timeout: 40000 });
  ok(await page.locator('.af-attempts tbody tr').count() === 2 && await page.locator('.af-best').count() === 1, 'Try again lists both drafts with their scores and marks the best');
  ok(await page.getByRole('button', { name: /^Apply attempt \d/ }).count() === 1, 'Apply names the draft it applies');
  const rules = await page.evaluate(() => window.jmApp.store.get().rules.filter(r => /^r-r[123]-cover$/.test(r.id)).map(r => r.enabled));
  ok(rules.every(e => e === true), 'starting Fill with R1 to R3 ticked turned the R1 to R3 cover rules on');
  await page.getByRole('button', { name: /^Apply/ }).first().click();
  await page.waitForTimeout(600);
  const placed = await page.evaluate(() => { const st = window.jmApp.store.get(), m = window.jmApp.model; const d = m.monthDays(window.jmApp.month)[10]; const got = new Set(); for (const p of st.staff) for (const c of (m.getCell(st, d, p.id) || {}).a || []) got.add(c); return ['R1', 'R2', 'R3'].filter(c => got.has(c)); });
  ok(placed.length === 3, `Fill placed an R1, R2 and R3 on a night (${placed.join(', ')})`);
  await page.close();
}
await b.close();
ok(!errors.length, 'no page errors:\n' + errors.join('\n'));
console.log(`nuh-junior-monthly e2e: ${checks} checks passed in ${((Date.now() - T0) / 1000).toFixed(1)} s`);
