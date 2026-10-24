// worker/routes.js: which folder each address serves, and what it must never serve. Run: node --test 'worker/test/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve, SITES, api } from '../routes.js';

test('each host serves its own app at the root', () => {
  assert.deepEqual(resolve('nuhroster.anawj.com', '/'), { file: 'nuh-roster/' });
  assert.deepEqual(resolve('nuhroster.anawj.com', '/js/app.js'), { file: 'nuh-roster/js/app.js' });
  assert.deepEqual(resolve('NUHROSTER.anawj.com:443', '/'), { file: 'nuh-roster/' });
  assert.deepEqual(resolve('nuhroster.anawj.com', '/nuh-roster'), { redirect: '/nuh-roster/' });
  assert.deepEqual(resolve('nuhroster.anawj.com', '/nuh-roster/sw.js'), { file: 'nuh-roster/sw.js' });
  assert.deepEqual(resolve('nuhroster.anawj.com', '/vendor/jspdf.umd.min.js'), { file: 'nuh-roster/vendor/jspdf.umd.min.js' });
  assert.deepEqual(resolve('ntfroster.anawj.com', '/'), { file: 'ntf-roster/' });
  assert.deepEqual(resolve('nuhjuniormonthly.anawj.com', '/js/app.js'), { file: 'nuh-junior-monthly/js/app.js' });
});

test('the NTF host serves its Firebase sign-in helper pages', () => {
  assert.deepEqual(resolve('ntfroster.anawj.com', '/__/auth/handler'), { file: '__/auth/handler' });
  assert.deepEqual(resolve('ntfroster.anawj.com', '/__/firebase/init.json'), { file: 'ntf-auth/firebase/init.json' });
  // the other two sign in on firebaseapp.com: no helper pages of their own here
  assert.deepEqual(resolve('nuhroster.anawj.com', '/__/auth/handler'), { file: 'nuh-roster/__/auth/handler' });
});

test('every host shares /lib/ (one exceljs) and nothing else', () => {
  for (const h of Object.keys(SITES)) {
    assert.deepEqual(resolve(h, '/lib/exceljs.min.js'), { file: 'lib/exceljs.min.js' }, h);
    assert.deepEqual(resolve(h, '/lib'), { redirect: '/lib/' }, h);
  }
  assert.deepEqual(resolve('nuhroster.anawj.com', '/ntf-roster/'), { file: 'nuh-roster/ntf-roster/' });   // not the other app
});

test('unknown hosts serve nothing; localhost serves the repo', () => {
  assert.deepEqual(resolve('x.workers.dev', '/nuh-roster/'), { notFound: true });
  assert.deepEqual(resolve('anawj.com', '/'), { notFound: true });
  assert.deepEqual(resolve('localhost:8787', '/ntf-roster/'), { file: 'ntf-roster/' });
});

test('nothing escapes its folder', () => {
  for (const h of Object.keys(SITES))
    for (const p of ['/../wrangler.jsonc', '/%2e%2e/x', '/a%2fb', '/a\\b', '/./x'])
      assert.deepEqual(resolve(h, p), { notFound: true }, h + p);
});

test('every folder in SITES and SHARED exists', () => {
  for (const [host, s] of Object.entries(SITES))
    for (const f of [s.root, ...Object.values(s.prefixes || {})].filter(Boolean))
      assert.ok(fs.existsSync(new URL(`../../${f}`, import.meta.url)), `${host}: ${f}`);
  assert.ok(fs.existsSync(new URL('../../lib/exceljs.min.js', import.meta.url)), 'lib/exceljs.min.js');
});

test('the claims routes answer on the junior monthly host only', () => {
  for (const p of ['/api/claims', '/api/members/sync']) {
    assert.equal(api('nuhjuniormonthly.anawj.com', p), p);
    assert.equal(api('NUHJUNIORMONTHLY.anawj.com:443', p), p);
    assert.equal(api('nuhroster.anawj.com', p), null);
    assert.equal(api('ntfroster.anawj.com', p), null);
    assert.equal(api('localhost', p), null);
  }
  assert.equal(api('nuhjuniormonthly.anawj.com', '/api/other'), null);
});
