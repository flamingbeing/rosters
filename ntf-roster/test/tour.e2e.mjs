// Browser test of NTF Roster's first-time help: the Getting started checklist on a fresh install (each step ticks on
// the real action), the interface tour on a laptop and a phone (every step's control on screen and clear of the
// card, Next / Back / Esc, focus back afterwards, remembered after a reload, replay from Help and More), the tour
// opening once in practice, the three "Try it yourself" tasks, axe with the tour open, and no sideways scroll on
// small phones. Made-up names only. Firebase blocked.
// Run (from the repo root, with a static server on the repo root at port 8080, e.g. python3 -m http.server 8080):
//   node ntf-roster/test/tour.e2e.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
const AXE = new URL('../../tools/vendor/axe.min.js', import.meta.url).pathname;
const BASE = `http://localhost:${process.env.PORT || 8080}/ntf-roster/`;
const T0 = Date.now();

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const errors = [];
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
async function newPage(tag, extra = { viewport: { width: 1300, height: 900 } }) {
  const ctx = await b.newContext({ acceptDownloads: true, reducedMotion: 'reduce', ...extra });
  await ctx.route('https://www.gstatic.com/**', r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${tag}] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !(/Failed to load resource/.test(m.text()) && /gstatic/.test(m.text() + m.location().url))) errors.push(`[${tag}] console: ${m.text()}`); });
  return page;
}
const ready = page => page.waitForFunction(() => document.body.classList.contains('ready'));
const go = async (page, hash) => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(300); };
const sub = page => page.textContent('.gs-sub');
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('ntf-roster-v1')));
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

// The step on screen: its control is in the viewport, inside the first cut-out, and the card covers neither.
async function checkStep(page, label) {
  const r = await page.evaluate(async () => {
    const root = document.querySelector('.tour');
    const id = root.dataset.step;
    const { TOUR_STEPS } = await import('./js/tour.js');
    const s = TOUR_STEPS.find(x => x.id === id);
    const v = { ...s, ...((window.ntfApp.isPhone() ? s.phone : s.laptop) || {}) };
    const name = v.target ? [].concat(v.target)[0] : null;
    const card = document.querySelector('.tour-card').getBoundingClientRect();
    const vw = innerWidth, vh = innerHeight;
    const inView = x => x.left >= -1 && x.top >= -1 && x.right <= vw + 1 && x.bottom <= vh + 1;
    const out = { id, cardIn: inView(card), count: document.querySelector('.tour-count').textContent };
    if (!name) return { ...out, free: true };
    const els = [...document.querySelectorAll(`[data-tour="${name}"]`)].filter(e => e.getBoundingClientRect().width > 0);
    const ring = document.querySelector('.tour-ring')?.getBoundingClientRect();
    if (!els.length || !ring) return { ...out, missing: name };
    const t = els[0].getBoundingClientRect();
    const cx = t.left + t.width / 2, cy = Math.min(t.top + t.height / 2, ring.bottom - 2);
    const overlap = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
    return { ...out, name, ringIn: inView(ring), targetInRing: cx >= ring.left && cx <= ring.right && cy >= ring.top && cy <= ring.bottom,
      covered: overlap(card, ring), targetTopIn: t.top >= -1 && t.top < vh && t.left >= -1 && t.left < vw };
  });
  ok(r.cardIn, `${label} ${r.id}: the card is on screen`);
  if (r.free) return r;
  ok(!r.missing, `${label} ${r.id}: its control (${r.missing}) is there`);
  ok(r.ringIn && r.targetTopIn && r.targetInRing, `${label} ${r.id}: ${r.name} is lit and in view`);
  ok(!r.covered, `${label} ${r.id}: the card doesn't cover ${r.name}`);
  return r;
}
async function nextStep(page) {
  const before = await page.evaluate(() => document.querySelector('.tour')?.dataset.step);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(p => { const t = document.querySelector('.tour'); return !t || (t.dataset.step !== p && !t.classList.contains('is-leaving')); }, before);
  await page.waitForTimeout(120);
}
// walk the whole tour from the welcome card with →, checking every step; returns the ids seen
async function walk(page, label, each) {
  await page.waitForSelector('.tour-card');
  await page.waitForTimeout(150);
  const seen = [];
  for (let i = 0; i < 20; i++) {
    const r = await checkStep(page, label);
    seen.push(r.id);
    if (each) await each(r);
    if (r.id === 'end') break;
    await nextStep(page);
  }
  return seen;
}
const ALL = ['intro', 'month', 'grid', 'paint', 'layers', 'problems', 'autofill', 'rules', 'check', 'day', 'backup', 'end'];
const ALL_LAPTOP = [...ALL.slice(0, -2), 'people', ...ALL.slice(-2)];   // (People is a header tab on a laptop)

// ================= 1. fresh install: Getting started =================
let page = await newPage('fresh');
await page.goto(BASE + '#roster');
await ready(page);
ok(await page.isVisible('.welcome-card .gs'), 'a fresh install shows the welcome with Getting started');
ok(/0 of 6 done/.test(await sub(page)), 'checklist starts at 0 of 6');
ok(await page.isVisible('.welcome-card a.gs-tour[href*="tour"]'), 'the tour is offered (practice, a new tab, with no staff yet)');
await axe(page, 'welcome checklist');
await page.click('.welcome-card button:has-text("Add staff")');
await page.waitForSelector('.pv-bar .btn-primary');
await page.click('.pv-bar .btn-primary');
await page.waitForSelector('.sheet .bx-form');
await page.locator('.sheet input[type="text"]').first().fill('Test Person');
await page.click('.sheet-foot .btn-primary');
await page.waitForTimeout(200);
await go(page, '#roster');
await page.waitForSelector('.view-roster .gs');
ok(/1 of 6 done/.test(await sub(page)), 'adding a person ticks step 1');
ok(await page.locator('.gs-step.is-done').count() === 1, 'one step shows a tick');
await go(page, '#people?s=codes');
await go(page, '#roster');
await page.waitForSelector('.view-roster .gs');
ok(/2 of 6 done/.test(await sub(page)), 'opening People › Duty codes ticks step 2');
await go(page, '#rules');
await page.waitForSelector('.rv-open');
await page.locator('.rv-open').first().click();
await page.waitForSelector('.rb');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
await go(page, '#roster');
await page.waitForSelector('.view-roster .gs');
ok(/3 of 6 done/.test(await sub(page)), 'opening Rules and a rule ticks step 3');
let s = await stored(page);
ok(s.settings.onboarding.codes === true && s.settings.onboarding.rules === true, 'the ticks are kept in settings.onboarding');
// paint a day of leave
await page.click('[data-tour="paint"]');
await page.waitForSelector('.r-paintbar .pchip[data-code="AL"]');
await page.click('.r-paintbar .pchip[data-code="AL"]');
const d = await page.evaluate(() => { const a = window.ntfApp, M = a.model; return M.monthDays(a.month).find(x => !M.isWeekend(x) && !M.isHoliday(a.store.get(), x)); });
await page.click(`.cell[data-d="${d}"]`);
await page.click('.pb-done');
await page.waitForTimeout(200);
ok(/4 of 6 done/.test(await sub(page)), 'painting leave ticks step 4');
// Hide, then Undo from the toast
await page.click('.gs-hide');
await page.waitForTimeout(150);
ok(!(await page.isVisible('.view-roster .gs')), 'Hide takes the checklist away');
await page.click('.toast:has-text("Getting started hidden") .toast-act');
await page.waitForTimeout(150);
ok(await page.isVisible('.view-roster .gs'), 'Undo brings it back');
// Auto-fill
await page.click('#autofill');
await page.waitForSelector('.af-actions .btn-primary:has-text("Start")');
await page.click('.af-actions .btn-primary:has-text("Start")');
// (Apply when done is on by default: the fill applies itself when every rule is met)
await page.waitForFunction(() => /5 of 6 done/.test(document.querySelector('.gs-sub')?.textContent || '') || document.querySelector('.af-actions .btn-primary'), null, { timeout: 20000 });
if (await page.isVisible('.af-actions .btn-primary:has-text("Apply")')) await page.click('.af-actions .btn-primary:has-text("Apply")');   // it stops to show a result when a rule is unmet
await page.waitForTimeout(300);
ok(/5 of 6 done/.test(await sub(page)), 'applying Auto-fill ticks step 5');
// a backup: step 6, then "All set" and the card goes
await go(page, '#more');
await page.waitForSelector('[data-tour="backup"]');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-tour="backup"] button:has-text("Download backup")')]);
ok(/backup/.test(dl.suggestedFilename()), 'a backup downloads');
await go(page, '#roster');
await page.waitForSelector('.gs-allset');
ok(/All set/.test(await page.textContent('.gs-allset')), 'all six done shows "All set"');
await page.waitForSelector('.gs-allset', { state: 'detached', timeout: 6000 });
s = await stored(page);
ok(s.settings.onboarding.shared === true && s.settings.onboarding.done === true, 'the backup tick and "finished" are saved');
ok(!(await page.isVisible('.view-roster .gs')), 'the checklist is gone once finished');

// ================= 2. the tour on a laptop (your own roster, with staff) =================
ok(!(await page.isVisible('.tour')), 'the tour never opens by itself in your own roster');
await page.click('#help');
await page.waitForSelector('.help-sheet');
await axe(page, 'Help sheet');
await page.click('.help-row:has-text("Take the tour")');
await page.waitForSelector('.tour-card');
await axe(page, 'tour open (laptop)');
ok(await page.evaluate(() => document.querySelector(".tour-card").contains(document.activeElement)), "focus goes into the card");
ok(await page.evaluate(() => { const c = document.querySelector('.tour-card'); return c.getAttribute('role') === 'dialog' && !!document.getElementById(c.getAttribute('aria-labelledby')); }), 'the card is a labelled dialog');
const canUndo = await page.evaluate(() => window.ntfApp.store.canUndo());
const undoLabel = await page.evaluate(() => window.ntfApp.store.canUndo() && window.ntfApp.store.undoLabel());
await page.keyboard.press('Control+z');
ok(await page.evaluate(([c, l]) => window.ntfApp.store.canUndo() === c && (!c || window.ntfApp.store.undoLabel() === l), [canUndo, undoLabel]), 'Ctrl+Z does nothing behind the tour');
// Back and forward with the arrows
await nextStep(page); await nextStep(page);
const c2 = await page.textContent('.tour-count');
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(250);
ok((await page.textContent('.tour-count')) !== c2 && /1 of/.test(await page.textContent('.tour-count')), 'ArrowLeft goes back a step');
await page.keyboard.press('Escape');
await page.waitForSelector('.tour', { state: 'detached' });
await page.waitForTimeout(300);
ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'help'), 'Esc ends it and focus returns to Help');
// the whole tour, every step checked
await page.click('#help');
await page.waitForSelector('.help-sheet');
await page.click('.help-row:has-text("Take the tour")');
let seen = await walk(page, 'laptop');
ok(JSON.stringify(seen) === JSON.stringify(ALL_LAPTOP), `laptop: every step shows (${seen.join(', ')})`);
await page.click('.tour-next');   // Done
await page.waitForSelector('.tour', { state: 'detached' });
await page.waitForTimeout(400);
ok(await page.evaluate(() => window.ntfApp.tab) === 'roster', 'the tour ends where it started');
ok(await page.evaluate(() => JSON.parse(localStorage.getItem('ntf-roster-tour')).done === true), 'seen is remembered on this device');
// replay from More
await go(page, '#more');
await page.waitForSelector('[data-tour-return="walkthrough"]');
await page.click('[data-tour-return="walkthrough"]');
await page.waitForSelector('.tour-card');
await page.keyboard.press('Escape');
await page.waitForSelector('.tour', { state: 'detached' });
await page.waitForTimeout(500);
ok(await page.evaluate(() => document.activeElement && document.activeElement.dataset.tourReturn === 'walkthrough'), 'More › Show the walkthrough replays it, focus comes back');
await page.reload();
await ready(page);
await page.waitForTimeout(800);
ok(!(await page.isVisible('.tour')), 'no tour after a reload');
await page.context().close();

// ================= 3. practice on a laptop: the tour opens once; Try it yourself =================
page = await newPage('practice');
await page.goto(BASE + '?demo#roster');
await ready(page);
await page.waitForSelector('.tour-card');
ok(/Welcome/i.test(await page.textContent('.tour-count')), 'practice opens with the tour');
await page.click('.tour-skip');   // Not now
await page.waitForSelector('.tour', { state: 'detached' });
await page.reload();
await ready(page);
await page.waitForTimeout(1000);
ok(!(await page.isVisible('.tour')), 'skipped once, it stays away after a reload');
await page.click('#help');
await page.waitForSelector('.help-sheet');
await page.click('.help-row:has-text("Try it yourself")');
await page.waitForSelector('.task-card');
await axe(page, 'Try it yourself card');
ok(/1 of 3/.test(await page.textContent('.task-kicker')), 'task 1 of 3');
await page.click('.task-show');
await page.waitForSelector('.tour-spot');
ok(await page.isVisible('.tour-tip'), 'Show me lights a cell');
// (a) leave
const cell = await page.evaluate(() => {
  const a = window.ntfApp, M = a.model, st = a.store.get();
  for (const d of M.monthDays(a.month)) {
    if (M.isWeekend(d) || M.isHoliday(st, d)) continue;
    const p = M.staffInView(st, a.month).find(x => !M.getCell(st, d, x.id) && !M.effectiveCodes(st, d, x.id).length);
    if (p) return { d, sid: p.id };
  }
});
await page.locator(`.cell[data-d="${cell.d}"][data-s="${cell.sid}"]`).scrollIntoViewIfNeeded();
await page.click(`.cell[data-d="${cell.d}"][data-s="${cell.sid}"]`);
await page.waitForSelector('.popover .tchip[data-code="AL"]');
await page.click('.popover .tchip[data-code="AL"]');
await page.waitForSelector('.task-card.is-done');
await page.keyboard.press('Escape');
await page.waitForFunction(() => /2 of 3/.test(document.querySelector('.task-kicker').textContent), null, { timeout: 10000 });
ok(true, 'giving someone leave ticks task 1');
// (b) two people never on call together
const pair = await page.evaluate(() => {
  const a = window.ntfApp, M = a.model, st = a.store.get(), m = M.monthOf(M.iso(new Date()));
  const sen = new Set(st.groups.filter(g => g.kind === 'senior').map(g => g.id));
  const ppl = M.staffInView(st, m).filter(p => !sen.has(p.group));
  for (const d of M.monthDays(m)) { const on = ppl.filter(p => (M.getCell(st, d, p.id)?.a || []).includes('C')); if (on.length >= 2) return [on[0].id, on[1].id]; }
});
ok(!!pair, 'the practice month has two juniors on call together');
await go(page, '#rules');
await page.click('[data-tour="addrule"]');
await page.click('.rp-sheet [data-kind="together"]');
await page.waitForSelector('.rb-sheet .bx-who-sel');
await page.click('.task-show');   // (the task card stays above the window, and Show me finds the picker in it)
// (wait for the text, not just the tip: on slow machines the tip shows before its words are swapped in)
ok(await page.waitForFunction(() => /^Choose /.test(document.querySelector('.tour-tip')?.textContent || ''), null, { timeout: 10000 }).then(() => true, () => false), 'Show me works inside the rule builder');
await page.locator('.rb-sheet .bx-who-sel').nth(0).selectOption(pair[0]);   // Other people
await page.waitForTimeout(100);
await page.locator('.rb-sheet .bx-who-sel').nth(2).selectOption(pair[1]);   // Who
await page.waitForTimeout(100);
await page.click('.rb-sheet .sheet-foot .btn-primary');
await page.waitForSelector('.task-card.is-done');
ok(/finds \d+ must-fix problem/.test(await page.textContent('.task-text')), 'adding the rule ticks task 2 and names the problems it finds');
ok(await page.evaluate(() => window.ntfApp.evaluation().hard) > 0, 'the new rule shows as a problem');
await page.waitForFunction(() => /3 of 3/.test(document.querySelector('.task-kicker').textContent), null, { timeout: 12000 });
// (c) Auto-fill next month
await go(page, '#roster');
await page.click('#nextm');
await page.waitForTimeout(300);
await page.click('#autofill');
await page.click('.af-actions .btn-primary:has-text("Start")');
await page.waitForFunction(() => /All three done/.test(document.querySelector('.task-title')?.textContent || ''), null, { timeout: 12000 });
ok(true, 'applying Auto-fill ticks task 3 and finishes');
await page.click('.task-stop');
ok(!(await page.isVisible('.task-card')), 'Close takes the card away');
await page.context().close();

// ================= 4. practice on a phone: the whole tour =================
page = await newPage('phone', PHONE);
await page.goto(BASE + '?demo');
await ready(page);
let axed = false;
seen = await walk(page, 'phone', async r => {
  if (r.id === 'grid' && !axed) { axed = true; await axe(page, 'tour open (phone)'); }
  await noSideScroll(page, `phone tour ${r.id}`);
});
ok(JSON.stringify(seen) === JSON.stringify(ALL), `phone: every step shows (${seen.join(', ')})`);
ok(await page.evaluate(() => [...document.querySelectorAll('.tour-card .btn')].filter(x => !x.hidden).every(x => x.getBoundingClientRect().height >= 44)), 'phone: card buttons are 44 px');
await page.click('.tour-next');
await page.waitForSelector('.tour', { state: 'detached' });
await page.waitForTimeout(400);
ok(await page.evaluate(() => window.ntfApp.tab) === 'day', 'phone: back on Day, where it started');
await page.context().close();

// ================= 5. small phones: your own roster with the checklist and the tour =================
page = await newPage('small', PHONE);
await page.goto(BASE + '#roster');
await ready(page);
await page.evaluate(() => window.ntfApp.store.commit('Add staff', d => { ['Ava Tan', 'Ben Lim', 'Cara Goh'].forEach((n, i) => d.staff.push({ id: 'p' + i, name: n, short: '', group: 'mo', tags: [], fte: 1, start: '', end: '', note: '', active: true })); }));
await page.waitForSelector('.view-roster .gs');
await page.click('.gs-fold');
await page.waitForSelector('.gs-body:not([hidden])');
await axe(page, 'checklist open (phone)');
for (const w of [390, 360, 320]) {
  await page.setViewportSize({ width: w, height: 760 });
  await page.waitForTimeout(250);
  await noSideScroll(page, `checklist at ${w} px`);
}
await page.click('.gs-tour');
await page.waitForSelector('.tour-card');
for (let i = 0; i < 4; i++) { await nextStep(page); await checkStep(page, '320 px'); await noSideScroll(page, `tour at 320 px (${i})`); }
await page.keyboard.press('Escape');
await page.waitForSelector('.tour', { state: 'detached' });
await page.context().close();

await b.close();
ok(!errors.length, 'no page or console errors:\n' + errors.join('\n'));
console.log(`ntf-roster tour e2e: ${checks} checks passed in ${((Date.now() - T0) / 1000).toFixed(1)} s`);
