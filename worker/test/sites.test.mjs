// worker/sites.js with a stand-in for the static assets. Run: node --test 'worker/test/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../sites.js';

const FILES = { '/nuh-roster/index.html': '<h1>hi</h1>', '/nuh-roster/sw.js': '//', '/lib/exceljs.min.js': '//',
  '/__/auth/handler.html': '<p>auth</p>', '/__/auth/iframe.html': '<p>iframe</p>', '/ntf-auth/firebase/init.json': '{}' };
const env = { ASSETS: { fetch: async req => {
  const p = new URL(req.url).pathname;
  return p in FILES ? new Response(FILES[p], { status: 200 }) : new Response('', { status: 404 });
} } };
const get = (url, method = 'GET') => worker.fetch(new Request(url, { method }), env);

test('serves the folder index, noindex', async () => {
  const r = await get('https://nuhroster.anawj.com/');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<h1>hi</h1>');
  assert.equal(r.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});

test('folder without a slash redirects; missing files 404; unknown hosts 404', async () => {
  assert.equal((await get('https://nuhroster.anawj.com/nuh-roster')).status, 301);
  assert.equal((await get('https://nuhroster.anawj.com/nope.js')).status, 404);
  assert.equal((await get('https://x.workers.dev/nuh-roster/')).status, 404);
});

test('the shared exceljs on every host', async () => {
  for (const h of ['nuhroster', 'ntfroster', 'nuhjuniormonthly'])
    assert.equal((await get(`https://${h}.anawj.com/lib/exceljs.min.js`)).status, 200, h);
});

test('sign-in helper pages on the NTF host only (handler is handler.html)', async () => {
  for (const p of ['/__/auth/handler?apiKey=x&mode=y', '/__/auth/iframe?apiKey=x', '/__/auth/handler.html', '/__/firebase/init.json'])
    assert.equal((await get('https://ntfroster.anawj.com' + p)).status, 200, p);
  assert.equal((await get('https://nuhroster.anawj.com/__/auth/handler')).status, 404);
  assert.equal((await get('https://ntfroster.anawj.com/__/auth/nope')).status, 404);
});

test('only GET and HEAD', async () => {
  assert.equal((await get('https://nuhroster.anawj.com/', 'POST')).status, 405);
});
