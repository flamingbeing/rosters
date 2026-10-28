// Every call to Firebase goes through js/cloud.js (the app's one adapter), and Save to cloud goes through app-sync's
// outbox (js/unsent.js > lib/roster-core/docsync.js), never straight to cloud.saveAll. Fails if a page module reaches past them.
// Run: node ntf-roster/test/adapter.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const js = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
const files = readdirSync(js).filter(f => f.endsWith('.js'));
const src = Object.fromEntries(files.map(f => [f, readFileSync(join(js, f), 'utf8')]));
let n = 0;
const ok = (v, name) => { n++; assert.ok(v, name); };
const who = re => files.filter(f => re.test(src[f]));

// the Firebase SDK, its config and its REST hosts: cloud.js only (firebase-config.js is the config itself)
ok(who(/gstatic\.com\/firebasejs|firebase-(app|auth|firestore)\.js/).join() === 'cloud.js', 'only cloud.js loads the Firebase SDK');
ok(who(/from '\.\/firebase-config\.js'|import\('\.\/firebase-config\.js'\)/).join() === 'cloud.js', 'only cloud.js reads firebase-config.js');
ok(!who(/firestore\.googleapis|identitytoolkit|securetoken\.googleapis/).length, 'no Firebase REST calls');
// no SDK names used outside the adapter
for (const f of files.filter(f => f !== 'cloud.js'))
  ok(!/\b(getFirestore|runTransaction|writeBatch|onSnapshot|setDoc|getDocs?|updateDoc|deleteDoc|signInWithPopup|signInWithRedirect|onAuthStateChanged)\s*\(/.test(src[f]), `${f} uses no Firebase SDK call`);

// the roster's saves: only unsent.js calls the adapter's save functions; the panel saves through the outbox
const saves = /cloud(Mod)?\.(saveAll|saveTeam|saveMonth)\s*\(/;
ok(who(saves).join() === 'unsent.js', 'only unsent.js calls cloud.saveAll / saveTeam / saveMonth');
ok(/unsent\.save\(/.test(src['ui-team.js']), 'Save to cloud goes through unsent.save');
ok(/unsent\.leave\(/.test(src['ui-team.js']), 'sign-out goes through the outbox gate (forgetDevice)');
// app-sync is loaded in one place, at the exact pin
ok(who(/core\.anawj\.com\/sync\//).join() === 'unsent.js', 'only unsent.js loads app-sync');
ok(/core\.anawj\.com\/sync\/\d+\.\d+\.\d+\//.test(src['unsent.js']), 'app-sync is pinned to an exact version');
console.log(`ntf-roster adapter: ${n} checks passed`);
