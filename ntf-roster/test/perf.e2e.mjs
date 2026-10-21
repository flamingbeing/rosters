// Speed guard for NTF Roster: the practice department (?demo) on a phone-sized screen with the CPU slowed 4x (Chrome
// DevTools' "mid-tier mobile"), timing the three things a rosterer does most: tap a cell until its editor shows, tap
// a code until the grid shows it, and switch month until the new month is on screen. Each time runs from the input
// event to the frame that shows the result. Prints the numbers and fails when a median is over its budget.
// The budgets are about 2x what a laptop measured in Oct 2026 (tap 240 ms, code 290 ms, month 400 ms at 4x), so a
// slower CI machine passes but a real slowdown (the whole grid drawn at once again, say: 800+ ms) does not.
// Run (from the repo root, with a static server on the repo root at port 8080, e.g. python3 -m http.server 8080):
//   node ntf-roster/test/perf.e2e.mjs            PORT=8091 for another port; REPS=n (default 5)
// Not in the Checks workflow (timings vary with the machine); run it after changing the grid, the editor or the store.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';

const BASE = `http://localhost:${process.env.PORT || 8080}/ntf-roster/`;
const REPS = Math.max(3, Number(process.env.REPS) || 5);
const BUDGET = { tap: 500, toggle: 650, month: 800 };   // ms, medians, at 4x CPU slowdown

// In the page: remember when the input happened, then wait for a condition and for the frame that shows it. The frame
// loop is started before the input, so in that frame its callback runs before anything the app scheduled for later
// frames, and the message it posts runs right after the frame is painted.
const HELPER = `
window.__arm = () => { window.__t0 = null; };
['pointerdown', 'touchstart', 'mousedown', 'click'].forEach(t => addEventListener(t, e => { if (window.__t0 == null) window.__t0 = e.timeStamp; }, true));
window.__waitFor = (src, timeout = 20000) => new Promise((resolve, reject) => {
  const cond = new Function('return (' + src + ')'), start = performance.now();
  let ready = false;
  const check = () => { try { ready = ready || !!cond(); } catch (e) { /* not yet */ } };
  const mo = new MutationObserver(check);
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  (function loop() {
    check();
    if (ready) {
      mo.disconnect();
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve(performance.now() - (window.__t0 ?? start));
      ch.port2.postMessage(0);
    } else if (performance.now() - start > timeout) { mo.disconnect(); reject(new Error('timed out waiting for ' + src)); }
    else requestAnimationFrame(loop);
  })();
});`;
// every row of the grid drawn (rows below the screen are added over a few frames after a full redraw)
const ALL_ROWS = `(() => { const a = window.ntfApp, M = a.model, st = a.store.get(); const ppl = M.staffInView(st, a.month);
  return document.querySelectorAll('table.grid tbody tr').length === ppl.length + new Set(ppl.map(p => p.group)).size; })()`;

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const errors = [];
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await ctx.route('https://www.gstatic.com/**', r => r.abort());        // no Firebase
await ctx.route('https://fonts.googleapis.com/**', r => r.abort());   // no web font round trip in the timings
await ctx.addInitScript(HELPER);
await ctx.addInitScript(() => { try { localStorage.setItem('ntf-roster-tour', JSON.stringify({ v: 1, done: true })); } catch (e) { /* ignore */ } });   // (no first-time tour)
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
await page.goto(BASE + '?demo#roster');
await page.waitForFunction(() => document.body.classList.contains('ready'));
await page.waitForSelector('table.grid');
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await page.evaluate(c => window.__waitFor(c), ALL_ROWS);
await page.waitForTimeout(500);

// the middle of an element, brought to the middle of the grid when something (a sticky row) covers it
async function spot(sel) {
  const hit = () => page.evaluate(s => {
    const el = document.querySelector(s), r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const at = document.elementFromPoint(x, y);
    return at && (at === el || el.contains(at)) ? [x, y] : null;
  }, sel);
  let p = await hit();
  if (!p) { await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center', inline: 'center' }), sel); await page.waitForTimeout(200); p = await hit(); }
  assert.ok(p, `${sel} is on screen`);
  return p;
}
// tap at a point and time it until `cond` holds and is painted
async function timedTap([x, y], cond) {
  await page.evaluate(() => window.__arm());
  const done = page.evaluate(c => window.__waitFor(c), cond);
  await page.touchscreen.tap(x, y);
  return Math.round(await done);
}

// empty weekday cells of people in the middle of the list (one per round)
const cells = await page.evaluate(() => {
  const app = window.ntfApp, M = app.model, st = app.store.get(), out = [];
  const days = M.monthDays(app.month).filter(d => !M.isWeekend(d) && !M.isHoliday(st, d));
  for (const p of M.staffInView(st, app.month).slice(6, 30)) {
    const d = days.find(x => !M.getCell(st, x, p.id) && !M.effectiveCodes(st, x, p.id).length);
    if (d) out.push(`.cell[data-d="${d}"][data-s="${p.id}"]`);
  }
  return out;
});
assert.ok(cells.length >= REPS, 'found empty cells to edit');

const T = { tap: [], toggle: [], month: [], monthAll: [] };
for (let i = 0; i < REPS; i++) {
  const cell = cells[i];
  T.tap.push(await timedTap(await spot(cell), `document.querySelector('.sheet .tchip[data-code="MC"]')`));
  await page.waitForTimeout(400);   // the sheet has slid in
  T.toggle.push(await timedTap(await spot('.sheet .tchip[data-code="MC"]'), `document.querySelector('${cell} .chip')?.textContent === 'MC'`));
  await page.waitForTimeout(300);
  await page.click('.sheet-foot .btn-primary');   // Done
  await page.waitForTimeout(400);
}
// month switches from the top of the grid, there and back
await page.evaluate(() => { document.querySelector('.r-scroll').scrollTop = 0; });
for (let i = 0; i < REPS; i++) {
  for (const btn of ['#nextm', '#prevm']) {
    await page.waitForTimeout(400);
    const m0 = await page.evaluate(() => window.ntfApp.month);
    T.month.push(await timedTap(await spot(btn), `window.ntfApp.month !== '${m0}' && document.querySelector('table.grid .cell[data-d^="' + window.ntfApp.month + '"]')`));
    T.monthAll.push(Math.round(await page.evaluate(c => window.__waitFor(c), ALL_ROWS)));
  }
}
await b.close();

const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
const row = (label, a, budget) => console.log(`  ${label.padEnd(36)} median ${String(med(a)).padStart(4)} ms${budget ? ` (budget ${budget})` : ''}   [${a.join(', ')}]`);
console.log('ntf-roster speed (phone 390 px, CPU 4x slower):');
row('tap a cell → editor shown', T.tap, BUDGET.tap);
row('tap a code → grid shows it', T.toggle, BUDGET.toggle);
row('switch month → new month shown', T.month, BUDGET.month);
row('switch month → every row drawn', T.monthAll);
assert.ok(!errors.length, 'no page errors:\n' + errors.join('\n'));
assert.ok(med(T.tap) <= BUDGET.tap, `tap a cell → editor: ${med(T.tap)} ms is over the ${BUDGET.tap} ms budget`);
assert.ok(med(T.toggle) <= BUDGET.toggle, `tap a code → grid: ${med(T.toggle)} ms is over the ${BUDGET.toggle} ms budget`);
assert.ok(med(T.month) <= BUDGET.month, `switch month: ${med(T.month)} ms is over the ${BUDGET.month} ms budget`);
console.log('ntf-roster perf: all within budget');
