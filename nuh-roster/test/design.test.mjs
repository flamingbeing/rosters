// The roster is on the NUHS app kit: it links the shared tokens and the kit (tokens.css, then app.css, then its own
// style.css), so its colours are the NUHS ones and its band is the kit's four equal quarters. Any token value style.css
// still copies says which token it is ("/* n-navy */"); this checks those copies still match nuhsdesign/tokens.css.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const tokens = await (await fetch('https://design.anawj.com/v1/tokens.css')).text();   // the live kit (design.anawj.com)
const kit = await (await fetch('https://design.anawj.com/v1/app.css')).text();   // the live kit (design.anawj.com)
const tok = Object.fromEntries([...tokens.matchAll(/--(n-[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim().toLowerCase()]));

// the shared files, in order, and offline too
const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
assert.deepEqual(links.slice(-4), ['https://design.anawj.com/v1/tokens.css', 'https://design.anawj.com/v1/app.css', '../lib/roster-core/kit.css', 'style.css'], 'tokens.css, then the kit, then the UI kit bridge (kit.css), then style.css');
assert.ok(html.includes('<script src="https://design.anawj.com/v1/app.js" defer></script>'), 'the kit\'s app.js');
assert.match(html, /<body class="a-app">/, 'the page is an app-kit app');
for (const f of ['https://design.anawj.com/v1/tokens.css', 'https://design.anawj.com/v1/app.css', 'https://design.anawj.com/v1/app.js']) assert.ok(sw.includes(`'${f}'`), `sw.js SHELL caches ${f}`);
// every app's worker is on app-update (one exact version), with register.js of the same version in SHELL and on the page
for (const app of ['nuh-roster', 'ntf-roster', 'nuh-junior-monthly']) {
  const w = fs.readFileSync(new URL(`../../${app}/sw.js`, import.meta.url), 'utf8');
  const core = w.match(/importScripts\('https:\/\/core\.anawj\.com\/update\/(\d+\.\d+\.\d+)\/sw-core\.js'\)/)?.[1];
  assert.ok(core, `${app}/sw.js loads sw-core.js from an exact version`);
  assert.match(w, new RegExp(`AppUpdate\\.init\\(\\{\\s*app: '${app}'`), `${app}: AppUpdate.init with its own prefix`);
  assert.match(w, /^const MANIFEST = \{\};$/m, `${app}: MANIFEST stays empty in git (the deploy fills it)`);
  assert.ok(!w.includes("'index.html'"), `${app}: pages are kept by the folder (./), never index.html`);
  assert.ok(w.includes(`'https://core.anawj.com/update/${core}/register.js'`), `${app}: register.js of the same version in SHELL`);
  const page = fs.readFileSync(new URL(`../../${app}/js/${app === 'nuh-roster' ? 'app' : 'version'}.js`, import.meta.url), 'utf8');
  assert.ok(page.includes(`'https://core.anawj.com/update/${core}/register.js'`), `${app}: the page loads the same register.js`);
  assert.ok(!/skipWaiting|Update available/.test(page), `${app}: no update toast or skipWaiting message left`);
}

// the band: the kit's four equal quarters along the top of the app bar, orange, red, blue (#178fd7, not cyan), navy
assert.match(html, /<header class="a-bar[^"]*">\s*<div class="a-band"><i><\/i><i><\/i><i><\/i><i><\/i><\/div>/, 'four-quarter band first in the app bar');
assert.match(kit, /\.a-band\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/, 'equal quarters');
const quarter = n => kit.match(new RegExp(`\\.a-band > :nth-child\\(${n}\\) \\{ background: var\\(--(n-[\\w-]+)\\); \\}`))?.[1];
assert.deepEqual([1, 2, 3, 4].map(n => tok[quarter(n)]), ['#e57200', '#e4002b', '#178fd7', '#002f6c'], 'band colours');
assert.ok(!/linear-gradient\(90deg, var\(--orange\)/.test(css), 'style.css no longer draws its own band');

// any copied token value still matches
let n = 0;
for (const m of css.matchAll(/--[\w-]+\s*:\s*([^;]+);\s*\/\*\s*(n-[\w-]+)\s*\*\//g)) {
  const [, value, name] = m;
  assert.ok(tok[name], `style.css names ${name}, which isn't in nuhsdesign/tokens.css`);
  assert.equal(value.trim().toLowerCase(), tok[name], `style.css copy of ${name}`);
  n++;
}
console.log(`design tests passed (kit linked, band, ${n} copied tokens match)`);
